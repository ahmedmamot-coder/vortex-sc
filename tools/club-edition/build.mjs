#!/usr/bin/env node
// Builds the "club edition" of Vortex SC: the same app, the same name and the same features, with
// none of the club's data in it — no swimmers, no results, no staff, no photos, no Supabase keys.
// It is what we hand to another club. They connect it to their own Supabase project and start empty.
//
//   node tools/club-edition/build.mjs
//
// Output: dist/club-edition/vortex-sc/ and dist/vortex-sc-club-edition.zip (both git-ignored).
//
// The build is checked before it is zipped: every swimmer name and staff name from the real roster,
// every personal address and the Supabase project ref are searched for in the output, and the build
// fails if any of them is still there. A new file or a new hard-coded name in the app shows up here
// rather than in another club's hands.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIST = path.join(ROOT, "dist");
const OUT = path.join(DIST, "club-edition", "vortex-sc");
const ZIP = path.join(DIST, "vortex-sc-club-edition.zip");
const APP = path.join(OUT, "vortex-app");
const HERE = path.join(ROOT, "tools", "club-edition");

// ---------- what goes in ----------

// Top-level folders that are the app. Everything else at the root (the design handoff in project/
// and chats/, the old vortex-static copy with the roster in it, App Store and staging notes) stays
// with this club.
const INCLUDE = ["vortex-app", "supabase", "ios"];

// Never copied, at any depth.
const SKIP_NAMES = new Set(["node_modules", ".next", ".git", ".vercel", "coverage", "tsconfig.tsbuildinfo"]);
const SKIP_PATHS = new Set([
  "vortex-app/tests", // the test suite runs against the real roster
  "vortex-app/scripts/data/roster-export.json", // the roster itself; replaced by an empty one below
  "vortex-app/supabase/seed_data.sql", // the roster as SQL
  "vortex-app/supabase/vx_roster_patch.sql", // one-off fix to named swimmers
  "vortex-app/supabase/mary_same_as_sameh.sql", // one-off fix to named staff
  "vortex-app/supabase/staff_access_check.sql", // carries a staff address
]);

// ---------- the club's own people and addresses ----------

const roster = JSON.parse(fs.readFileSync(path.join(ROOT, "vortex-app/scripts/data/roster-export.json"), "utf8"));

const STAFF_NAMES = [
  "Ahmed Mamo", "Ahmed Abdelwahab", "Ahmed Aly", "Abdel Wahab", "Abdelwahab", "Sameh", "Fathy", "Mahady",
  "Matuze", "Sherif", "Reda", "Chafik", "Baisher", "Wassim", "Mahmoud", "Martin", "Nedhal", "Nidal", "Mary",
];

const EMAILS = [
  ["ahmedmamot@gmail.com", "admin@example.com"],
  ["mosame7100@gmail.com", "admin2@example.com"],
  ["sameh4142@gmail.com", "admin2@example.com"],
  ["marycrispcleopas@gmail.com", "staff@example.com"],
  ["ahmed.a@vortex.qa", "staff@example.com"],
];

const SUPABASE_REF = "qhrpwiakobgcxfmcoyfg";
const JWT = /eyJhbGciOi[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

// Squad structure is the app's, not the club's data: ids, names, ages and colours stay.
const SQUADS = roster.squads.map((s) => ({ slug: s.slug, name: s.name }));

// ---------- helpers ----------

const rel = (p) => path.relative(OUT, p).split(path.sep).join("/");
const read = (p) => fs.readFileSync(p, "utf8");
const write = (p, s) => fs.writeFileSync(p, s);
const TEXT = /\.(m?[jt]sx?|json|sql|md|html|css|txt|plist|sh|swift|m|webmanifest|yml|yaml|example|xml|mjs|cjs)$/i;

function copyTree(src, dst, relSrc) {
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP_NAMES.has(ent.name) || ent.name.startsWith(".env")) continue;
    const r = relSrc + "/" + ent.name;
    if (SKIP_PATHS.has(r)) continue;
    const s = path.join(src, ent.name), d = path.join(dst, ent.name);
    if (ent.isDirectory()) { fs.mkdirSync(d, { recursive: true }); copyTree(s, d, r); }
    else if (ent.isFile()) fs.copyFileSync(s, d);
  }
}

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

// Replace exactly once (or `count` times); a miss means the app changed and this script must be
// looked at, so it stops rather than shipping something half-cleaned.
function must(file, s, find, repl, count = 1) {
  let n = 0;
  const outStr = s.replace(find instanceof RegExp ? find : new RegExp(escapeRe(find), "g"), (...m) => {
    n++;
    return typeof repl === "function" ? repl(...m) : repl;
  });
  if (n !== count && !(count === "+" && n > 0)) {
    throw new Error(`${file}: expected ${count} match(es) for ${String(find).slice(0, 80)}, found ${n}`);
  }
  return outStr;
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------- 1. copy ----------

fs.rmSync(path.join(DIST, "club-edition"), { recursive: true, force: true });
fs.rmSync(ZIP, { force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const dir of INCLUDE) {
  fs.mkdirSync(path.join(OUT, dir), { recursive: true });
  copyTree(path.join(ROOT, dir), path.join(OUT, dir), dir);
}

// ---------- 2. data files, emptied ----------

const A = (p) => path.join(APP, p);

// The roster the app boots with: the nine squads, nobody in them, no meets.
write(A("public/assets/roster.js"),
  "window.VX_ROSTER=" + JSON.stringify(Object.fromEntries(SQUADS.map((s) => [s.slug, []]))) + ";window.VX_MEETS=[];\n");

// Staff and swimmer photos.
write(A("public/assets/vx-photos.js"), "window.VX_PHOTOS={};\n");

// The seed file `npm run seed` loads: squads only.
fs.mkdirSync(A("scripts/data"), { recursive: true });
write(A("scripts/data/roster-export.json"), JSON.stringify({
  squads: roster.squads.map(({ swimmers, coach_name, assistant_coach_name, ...s }) => ({
    ...s, swimmers: [],
  })),
  meets: [],
}, null, 2) + "\n");

// Photographs of the club's staff and swimmers. The layouts that show one as a background get
// the club's blue pattern in its place, so every screen keeps its look.
fs.rmSync(A("public/images/vx"), { recursive: true, force: true });
for (const p of ["public/images/hero-coach.jpg", "public/images/hero-dive.jpg", "public/assets/acb9bc6a.jpg", "public/assets/394fd938.jpg"]) {
  fs.copyFileSync(A("public/images/pattern-source.jpg"), A(p));
}
{
  const f = A("src/app/(staff)/squads/page.tsx");
  write(f, must(f, read(f), /(const SQUAD_SLUG_TO_PHOTO: Record<string, string \| undefined> = \{)[^}]*(\};)/, (_, a, b) => a + b));
}

// The tests are gone, so are the scripts that run them.
{
  const pkg = JSON.parse(read(A("package.json")));
  for (const k of ["test", "drive", "sql"]) delete pkg.scripts[k];
  write(A("package.json"), JSON.stringify(pkg, null, 2) + "\n");
}

// Per-club settings for the browser app, read by proto.html at start-up.
fs.copyFileSync(path.join(HERE, "club-config.js"), A("public/assets/club-config.js"));
fs.copyFileSync(path.join(HERE, "env.example"), A(".env.local.example"));
fs.copyFileSync(path.join(HERE, "SETUP.md"), path.join(OUT, "SETUP.md"));
fs.copyFileSync(path.join(HERE, "SETUP.md"), path.join(OUT, "README.md"));

// ---------- 3. proto.html: the app itself ----------

{
  const f = A("public/proto.html");
  let s = read(f);
  const CFG = "(window.VX_CONFIG||{})";

  // Load the club's settings before anything talks to Supabase.
  s = must(f, s, /\n<script>\n\(function\(\)\{\n  var SB_URL = /, (m) => '\n<script src="assets/club-config.js"></script>' + m);
  s = must(f, s, /var SB_URL = "https:\/\/[a-z]+\.supabase\.co";/, `var SB_URL = ${CFG}.supabaseUrl || "";`);
  s = must(f, s, /var SB_ANON = "eyJ[^"]+";/, `var SB_ANON = ${CFG}.supabaseAnonKey || "";`);
  s = must(f, s, /this\.VAPID_PUBLIC='[^']+';/, `this.VAPID_PUBLIC=${CFG}.vapidPublicKey||'';`);

  // Built-in staff: the two admin seats and one coach seat per squad, with nobody's name on them.
  // The ids stay the shape the app expects; the admins' ids are renamed off people's names.
  const coaches = [
    ["preteam", "Pre-Team", "#22C1DA", "PT"], ["advb", "Advanced B", "#1BA5E6", "AB"],
    ["adva", "Advanced A", "#067EEA", "AA"], ["junior", "Junior", "#2A63E0", "JR"],
    ["seniorb", "Senior B", "#2733D6", "SB"], ["seniora", "Senior A", "#3B23C7", "SA"],
    ["vortexb", "Vortex LD", "#5D22CF", "LD"], ["vortexa", "Vortex SD", "#8A22D5", "SD"],
    ["legend", "Legend", "#1B22E4", "LG"],
  ];
  const accounts = [
    `      {id:'admin1', user:'admin', label:'Club Admin', role:'Technical Director · full access', accent:'#067EEA', photo:'', initials:'CA', recommended:true, email:${CFG}.adminEmail||''},`,
    `      {id:'admin2', user:'admin2', label:'Administrator', role:'Administrator \\u00b7 full access', accent:'#3B23C7', photo:'', initials:'AD', email:${CFG}.admin2Email||''},`,
    ...coaches.map(([id, name, accent, ini]) =>
      `      {id:'coach_${id}', user:'${id}', label:'${name} Coach', role:'${name} coach', accent:'${accent}', photo:'', initials:'${ini}', squadId:'${id}', email:''},`),
  ].join("\n");
  s = must(f, s, /(this\._baseAccounts = \[\n)[\s\S]*?(\n    \];)/, (_, a, b) => a + accounts + b);
  s = must(f, s, /'ahmed'/g, "'admin1'", "+");
  s = must(f, s, /'sameh'/g, "'admin2'", "+");

  // Squads: same squads, no coach names, no photos, nobody counted.
  s = must(f, s, /(this\._baseSquads = \[\n)([\s\S]*?)(\n    \];)/, (_, a, body, b) =>
    a + body.replace(/count:\d+/g, "count:0").replace(/coach:'[^']*'/g, "coach:''").replace(/photo:'[^']*'/g, "photo:''") + b);

  // The sample posts in the lounge carry staff names and photos.
  s = must(f, s, /(\n      feed:\[)\n[\s\S]*?\n      \],/, (_, a) => a + "],");

  // The Vortex International Championships pool records: real children, ages and times.
  s = must(f, s, /(VIC_POOL_RECORDS\(\)\{[\s\S]*?const raw=\[)[\s\S]*?(\n    \];)/, (_, a, b) => a + b);

  // Two staff-specific exceptions to the fitness-coach lock.
  s = must(f, s, /if\(_email==='ahmed\.a@vortex\.qa' \|\| \/abdel\\s\*wahab\/i\.test\(_name\)\) return false;/, "");
  s = must(f, s, / \|\| \/nedhal\/i\.test\(a\.label\|\|''\) \|\| \/nedhal\/i\.test\(a\.user\|\|''\)/, "");

  // The orange STAGING bar shows on any host but the club's own domain, which is now the club's
  // setting. With none set, no bar.
  s = must(f, s, "return !(h==='vortexswimmingclub.com' || h==='www.vortexswimmingclub.com' || h==='localhost' || h==='127.0.0.1');",
    `const d=String(${CFG}.liveDomain||'').toLowerCase(); return !!d && !(h===d || h==='www.'+d || h==='localhost' || h==='127.0.0.1');`);

  s = must(f, s, "you and Sameh get a notification", "you and the other administrator get a notification");

  // The request box's example mentions a person.
  s = must(f, s, "(e.g. @Ahmed can we", "(e.g. @Admin can we");

  write(f, s);
}

// ---------- 4. server code: no fallback to this club's Supabase ----------

for (const f of walk(path.join(APP, "src"))) {
  if (!/\.(ts|tsx)$/.test(f)) continue;
  let s = read(f);
  const before = s;
  s = s.replace(/\s*\|\|\s*"https:\/\/[a-z]+\.supabase\.co"/g, ' || ""');
  s = s.replace(/\|\|\s*\n?\s*"eyJ[^"]+"/g, '|| ""');
  if (s !== before) write(f, s);
}

// ---------- 5. every text file: addresses, domain, names in comments ----------

const fullNames = new Set();
const nameTokens = new Set();
// Capitalised words that are names in the roster and ordinary words or app vocabulary elsewhere.
const KEEP = new Set(["May", "June", "Will", "Grace", "Hope", "Joy", "Rose", "Summer", "Mark", "Star", "Sky",
  "Page", "Long", "Free", "Back", "Fly", "Junior", "Senior", "Legend", "Vortex", "Coach", "Team", "Club",
  "Hamilton", "Doha", "Qatar", "Ali", "Jan", "Jun", "Mar", "Kim", "Lee", "Max", "Sun", "Amber", "Ruby"]);
for (const sq of roster.squads) {
  for (const w of sq.swimmers) {
    const full = `${w.first} ${w.last}`.replace(/\s+/g, " ").trim();
    if (full.includes(" ")) fullNames.add(full);
    for (const t of full.split(/[\s-]+/)) if (t.length >= 3 && /^[A-Z]/.test(t) && !KEEP.has(t)) nameTokens.add(t);
  }
}
for (const n of STAFF_NAMES) { if (n.includes(" ")) fullNames.add(n); else nameTokens.add(n); }
const byLength = (a, b) => b.length - a.length;
const fullRe = new RegExp("\\b(" + [...fullNames].sort(byLength).map(escapeRe).join("|") + ")\\b", "g");
const tokenRe = new RegExp("\\b(" + [...nameTokens].sort(byLength).map(escapeRe).join("|") + ")\\b", "g");
const scrubNames = (t) => t.replace(fullRe, "[name]").replace(tokenRe, "[name]");

// Comment text only: code is checked below, and a name in code needs a deliberate edit above.
function scrubComments(src, ext) {
  // Names in Markdown and SQL are prose or note values, never identifiers.
  if (ext === ".md" || ext === ".sql") return scrubNames(src);
  const lineComment = ext === ".sql" ? "--" : "//";
  return src.split("\n").map((line) => {
    const t = line.trimStart();
    if (t.startsWith(lineComment) || t.startsWith("* ") || t === "*" || t.startsWith("/*") || t.startsWith("<!--")) return scrubNames(line);
    // A trailing comment after code, when the code before it has no open string.
    const i = line.indexOf(" " + lineComment + " ");
    if (i > 0) {
      const code = line.slice(0, i);
      const balanced = [`"`, `'`, "`"].every((q) => (code.split(q).length - 1) % 2 === 0);
      if (balanced) return code + scrubNames(line.slice(i));
    }
    return line;
  }).join("\n");
}

for (const f of walk(OUT)) {
  if (!TEXT.test(f)) continue;
  let s = read(f);
  const before = s;
  for (const [from, to] of EMAILS) s = s.replace(new RegExp(escapeRe(from), "gi"), to);
  s = s.replace(/com\.vortexswimmingclub\.app/g, "com.example.vortex");
  s = s.replace(/(vortexswimmingclub|vortexaquatics)(\\?)\.com/g, "example$2.com");
  s = s.replace(new RegExp(SUPABASE_REF, "g"), "YOUR-PROJECT");
  s = scrubComments(s, path.extname(f).toLowerCase());
  if (s !== before) write(f, s);
}

// ---------- 6. check: nothing of the club's is left ----------

const problems = [];
const exactRe = new RegExp("\\b(" + [...fullNames].sort(byLength).map(escapeRe).join("|") + ")\\b");
const staffRe = new RegExp("\\b(" + STAFF_NAMES.filter((n) => !n.includes(" ")).map(escapeRe).join("|") + ")\\b");
for (const f of walk(OUT)) {
  if (!TEXT.test(f)) continue;
  const lines = read(f).split("\n");
  lines.forEach((line, i) => {
    const where = `${rel(f)}:${i + 1}`;
    if (line.includes(SUPABASE_REF)) problems.push(`${where}  Supabase project ref`);
    if (JWT.test(line)) problems.push(`${where}  a JWT (Supabase key?)`);
    JWT.lastIndex = 0;
    for (const [from] of EMAILS) if (line.toLowerCase().includes(from)) problems.push(`${where}  ${from}`);
    if (/vortexswimmingclub|vortexaquatics/i.test(line)) problems.push(`${where}  club domain`);
    const m = line.match(exactRe) || line.match(staffRe);
    if (m) problems.push(`${where}  "${m[0]}"  ${line.trim().slice(0, 100)}`);
  });
}
// Binary files that are photographs of people or the club's own documents are listed explicitly;
// anything new under these folders is flagged for a look.
const KNOWN_MEDIA = new Set([
  "vortex-app/public/vortex-handbook.pdf", // coaching methodology handbook — same club, same name
]);
for (const f of walk(path.join(APP, "public"))) {
  const r = rel(f);
  if (/\.pdf$/i.test(r) && !KNOWN_MEDIA.has(r)) problems.push(`${r}  unreviewed PDF`);
}
for (const r of ["public/images/vx", "public/images/hero-coach.jpg", "public/images/hero-dive.jpg"]) {
  const p = A(r);
  if (fs.existsSync(p) && fs.statSync(p).isFile() && !fs.readFileSync(p).equals(fs.readFileSync(A("public/images/pattern-source.jpg")))) problems.push(`vortex-app/${r}  photograph of a person`);
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) problems.push(`vortex-app/${r}  staff photos`);
}
if (problems.length) {
  console.error("Club edition NOT built — still carries the club's data:\n  " + problems.join("\n  "));
  process.exit(1);
}

// ---------- 7. zip ----------

execFileSync("zip", ["-qr", ZIP, "vortex-sc"], { cwd: path.dirname(OUT) });
const mb = (fs.statSync(ZIP).size / 1e6).toFixed(1);
console.log(`Club edition built: ${path.relative(ROOT, OUT)}\n  ${path.relative(ROOT, ZIP)} (${mb} MB)`);
