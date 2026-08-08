// Test harness for the single-file app.
//
// The app is one 500KB proto.html with the logic inside a class, so there is nothing to
// `import`. Rather than re-implement the logic in the tests — which would only prove the
// copy works — this pulls the REAL method source straight out of proto.html and runs it
// with a stub `this`. If someone edits the shipped method, these tests see the edit.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
export const SOURCE = readFileSync(join(HERE, "..", "public", "proto.html"), "utf8");

/** Pull one class method's source out of proto.html by brace-matching from its signature. */
export function methodSource(name) {
  const re = new RegExp(`^  (?:async )?${name}\\s*\\(`, "m");
  const m = re.exec(SOURCE);
  if (!m) throw new Error(`method ${name}() not found in proto.html`);
  const open = SOURCE.indexOf("{", m.index + m[0].length - 1);
  // Must skip comments as well as strings: an apostrophe in a comment ("the swimmer's own
  // id") otherwise looks like the start of a string and swallows the rest of the class.
  let depth = 0, i = open, inStr = null, inLine = false, inBlock = false, prev = "";
  for (; i < SOURCE.length; i++) {
    const c = SOURCE[i], next = SOURCE[i + 1];
    if (inLine) { if (c === "\n") inLine = false; prev = c; continue; }
    if (inBlock) { if (c === "*" && next === "/") { inBlock = false; i++; } prev = c; continue; }
    if (inStr) {
      if (c === inStr && prev !== "\\") inStr = null;
    } else if (c === "/" && next === "/") { inLine = true; i++; }
    else if (c === "/" && next === "*") { inBlock = true; i++; }
    else if (c === '"' || c === "'" || c === "`") inStr = c;
    else if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) break; }
    prev = c;
  }
  if (depth !== 0) throw new Error(`could not brace-match ${name}()`);
  const sig = SOURCE.slice(m.index, open).trim().replace(/^async\s+/, "");
  const args = sig.slice(sig.indexOf("(") + 1, sig.lastIndexOf(")"));
  return { args, body: SOURCE.slice(open + 1, i), isAsync: /^\s*async\s/.test(m[0]) };
}

// An async method's body contains `await`, which plain Function() refuses to compile.
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/**
 * Build a callable from real app source, bound to `ctx` as `this`.
 * Any other methods it calls must be listed in `deps` so they are attached too.
 */
export function bind(name, ctx = {}, deps = []) {
  for (const d of [...deps, name]) {
    if (typeof ctx[d] === "function") continue;
    const { args, body, isAsync } = methodSource(d);
    const Make = isAsync ? AsyncFunction : Function;
    ctx[d] = new Make(...args.split(",").map((s) => s.trim()).filter(Boolean), body);
  }
  const out = {};
  for (const k of Object.keys(ctx)) {
    out[k] = typeof ctx[k] === "function" ? ctx[k].bind(ctx) : ctx[k];
  }
  // rebind so methods calling each other via `this` resolve against the same object
  for (const k of Object.keys(ctx)) if (typeof ctx[k] === "function") ctx[k] = ctx[k].bind(ctx);
  return ctx[name];
}

/**
 * Pull a contiguous run of the page's top-level script out of proto.html: everything from
 * `start` up to (but not including) `end`. The sync/auth layer is a plain IIFE, not class
 * methods, so `methodSource` cannot reach it — but it is still real shipped code, and it is
 * the part that decides whether a coach's save is kept.
 */
export function sourceBetween(start, end) {
  const a = SOURCE.indexOf(start);
  if (a === -1) throw new Error(`start marker not found: ${start}`);
  const b = SOURCE.indexOf(end, a);
  if (b === -1) throw new Error(`end marker not found: ${end}`);
  return SOURCE.slice(a, b);
}

/**
 * Run a slice of that script against stubs. Everything it reaches for — the browser
 * globals, the network, the clock — is passed in, so a test can put the app in a state
 * (expired token, dead refresh token, queued writes) that is impossible to sit and wait for.
 */
export function runInSandbox(src, globals) {
  const names = Object.keys(globals);
  return new Function(...names, src)(...names.map((n) => globals[n]));
}

// ---- tiny assertion runner -------------------------------------------------
let passed = 0;
const failures = [];
let group = "";

const pending = [];

export function describe(name, fn) { group = name; fn(); }
export function it(what, fn) {
  try { fn(); passed++; }
  catch (e) { failures.push(`${group} → ${what}\n      ${e.message}`); }
}
/**
 * Same, for a case that has to wait on a promise (a token refresh, a replayed write).
 * These run one after another, never interleaved: they drive real app code that reaches for
 * globals like window and localStorage, and two of them in flight at once would read each
 * other's stubs and fail for a reason that has nothing to do with the app.
 */
let chain = Promise.resolve();
export function itAsync(what, fn) {
  const where = group;
  chain = chain.then(() =>
    Promise.resolve()
      .then(fn)
      .then(() => { passed++; })
      .catch((e) => { failures.push(`${where} → ${what}\n      ${e.message}`); }),
  );
  pending.push(chain);
}
export function eq(actual, expected, note = "") {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`expected ${b}, got ${a}${note ? ` (${note})` : ""}`);
}
export async function report() {
  await Promise.all(pending);
  console.log(`\n  ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log(`\n  ✗ ${f}`);
  if (failures.length) process.exit(1);
  console.log("");
}
