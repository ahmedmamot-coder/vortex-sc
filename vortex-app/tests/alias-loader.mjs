// Teach plain `node` the "@/..." alias, so tests can import route files as they are written.
//
// tests/logic.test.mjs imports src/app/api/ai/coach/route.ts for real, and that route — like the
// rest of the codebase — imports "@/lib/...". Node resolves tsconfig paths for nobody, so the
// whole suite died on the first import with a module-not-found naming a package that does not
// exist. The alternatives were to write relative imports into the source only for the benefit of
// the test runner, or to run the suite under tsx — which resolves the alias but caches modules
// differently and breaks the six wearable-key tests that re-import with a ?probe= query.
//
// So: a resolver hook, twelve lines, changing nothing about how the tests run.
import { register } from "node:module";
import { pathToFileURL } from "node:url";

const SRC = pathToFileURL(new URL("../src/", import.meta.url).pathname).href;

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    // Preserve any query string (?probe=…) — that is how the wearable tests get a fresh module.
    const q = specifier.indexOf("?");
    const bare = q < 0 ? specifier : specifier.slice(0, q);
    const query = q < 0 ? "" : specifier.slice(q);
    const base = SRC + bare.slice(2);
    for (const ext of ["", ".ts", ".tsx", ".mjs", ".js", "/index.ts"]) {
      try {
        return await next(base + ext + query, context);
      } catch {
        /* try the next extension — the last failure falls through below */
      }
    }
  }
  return next(specifier, context);
}

register("./alias-loader.mjs", import.meta.url);
