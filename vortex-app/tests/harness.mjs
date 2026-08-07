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
  return { args, body: SOURCE.slice(open + 1, i) };
}

/**
 * Build a callable from real app source, bound to `ctx` as `this`.
 * Any other methods it calls must be listed in `deps` so they are attached too.
 */
export function bind(name, ctx = {}, deps = []) {
  for (const d of [...deps, name]) {
    if (typeof ctx[d] === "function") continue;
    const { args, body } = methodSource(d);
    ctx[d] = new Function(...args.split(",").map((s) => s.trim()).filter(Boolean), body);
  }
  const out = {};
  for (const k of Object.keys(ctx)) {
    out[k] = typeof ctx[k] === "function" ? ctx[k].bind(ctx) : ctx[k];
  }
  // rebind so methods calling each other via `this` resolve against the same object
  for (const k of Object.keys(ctx)) if (typeof ctx[k] === "function") ctx[k] = ctx[k].bind(ctx);
  return ctx[name];
}

// ---- tiny assertion runner -------------------------------------------------
let passed = 0;
const failures = [];
let group = "";

export function describe(name, fn) { group = name; fn(); }
export function it(what, fn) {
  try { fn(); passed++; }
  catch (e) { failures.push(`${group} → ${what}\n      ${e.message}`); }
}
export function eq(actual, expected, note = "") {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`expected ${b}, got ${a}${note ? ` (${note})` : ""}`);
}
export function report() {
  console.log(`\n  ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log(`\n  ✗ ${f}`);
  if (failures.length) process.exit(1);
  console.log("");
}
