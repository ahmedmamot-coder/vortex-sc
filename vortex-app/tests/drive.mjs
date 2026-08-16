// Driving the real screens, because reading the code was not enough.
//
// Three times in one night a bug was found by a coach and not by this repo: a date of birth that
// would not save, a roster that reverted, an undo that could not be read. Every one of them lives
// between the button and the function — which the unit tests, which call the functions directly,
// cannot see at all.
//
// So this opens the actual app in a real browser, clicks the actual buttons, and reads what ends
// up in storage. It is slow and it is worth it.
//
//   node tests/drive.mjs            # run every scene
//   node tests/drive.mjs dob        # just the ones whose name contains "dob"
//
// It needs a static server on 8899 serving public/ (start() below does it) and the Chromium that
// ships with this image. It never touches the club's database: the app is loaded with a staff
// session already in localStorage and no Supabase token, so every write stays local — which is
// precisely the state we want to test anyway.

import { chromium } from "/tmp/node_modules/playwright-core/index.mjs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "..", "public");
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const PORT = 8899;

let server = null;
async function start() {
  const up = await fetch("http://127.0.0.1:" + PORT + "/proto.html").then(() => true).catch(() => false);
  if (up) return;
  server = spawn("python3", ["-m", "http.server", String(PORT)], { cwd: PUBLIC, stdio: "ignore" });
  for (let i = 0; i < 40; i++) {
    if (await fetch("http://127.0.0.1:" + PORT + "/proto.html").then(() => true).catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("the static server never came up");
}

/**
 * Clicking a tile.
 *
 * getByText finds the label and clicks the span, and the app's handlers sit on an ancestor — so
 * the click lands on nothing and the test walks on believing it navigated. That cost an hour.
 * This walks up to whatever actually carries the handler and clicks that.
 */
async function tap(page, text) {
  const ok = await page.evaluate((t) => {
    const wanted = String(t).toLowerCase();
    const all = [...document.querySelectorAll("div,button,a,li,span")];
    // The smallest element whose own text matches, then up to the first thing with a handler.
    const hits = all.filter((e) => (e.textContent || "").toLowerCase().includes(wanted));
    const leaf = hits.sort((a, b) => (a.textContent || "").length - (b.textContent || "").length)[0];
    if (!leaf) return false;
    let n = leaf;
    for (let i = 0; i < 8 && n; i++) {
      if (n.onclick || n.getAttribute?.("onclick")) { n.click(); return true; }
      n = n.parentElement;
    }
    leaf.click();
    return true;
  }, text);
  if (!ok) throw new Error('nothing on screen says "' + text + '"');
  await page.waitForTimeout(650);
}

async function openApp(browser, seed) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(String(e.message)));
  await page.addInitScript((s) => {
    localStorage.setItem("vx_session", JSON.stringify({ type: "staff", id: "ahmed" }));
    for (const [k, v] of Object.entries(s || {})) localStorage.setItem(k, JSON.stringify(v));
  }, seed || {});
  await page.goto("http://127.0.0.1:" + PORT + "/proto.html?drive=" + Date.now(), { waitUntil: "networkidle" });
  await page.waitForTimeout(1600);
  page.problems = problems;
  return page;
}

const scenes = [];
const scene = (name, fn) => scenes.push({ name, fn });
const eq = (got, want, why) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) throw new Error((why ? why + ": " : "") + "expected " + b + ", got " + a);
};

// ---------------------------------------------------------------------------------------------
// A date of birth typed into the swimmers screen has to be there after a reload. This is the one
// the club reported twice and this repo could not reproduce.
// ---------------------------------------------------------------------------------------------
scene("a date of birth typed in the admin list is still there after a reload", async (browser) => {
  const page = await openApp(browser);
  await tap(page, "Club Administration");
  await tap(page, "Roster · add / edit");

  const opened = await page.evaluate(() => {
    // Lucide replaces <i data-lucide="pencil"> with <svg class="lucide lucide-pencil"> once it
    // runs, so the attribute selector matches only for the first few hundred milliseconds of the
    // app's life. Accept either, and fall back to the first of the two buttons on a row.
    let icon = document.querySelector('svg.lucide-pencil, i[data-lucide="pencil"]');
    let btn = icon && icon.closest("button");
    if (!btn) {
      const row = [...document.querySelectorAll("div")]
        .filter((d) => d.querySelectorAll(":scope > button").length === 2)
        .sort((a, b) => (a.textContent || "").length - (b.textContent || "").length)[0];
      btn = row && row.querySelector(":scope > button");
    }
    if (!btn) return null;
    const row = btn.closest("div");
    const name = ((row && row.textContent) || "").trim().slice(0, 40);
    btn.click();
    return name;
  });
  if (!opened) throw new Error("no swimmer row had an edit button");
  await page.waitForTimeout(600);

  const box = await page.$('input[placeholder="DOB dd/mm/yyyy"]');
  if (!box) throw new Error("the editor opened without a date of birth box");
  await box.click();
  await box.type("17/04/2016", { delay: 25 });
  await page.waitForTimeout(300);
  await tap(page, "Save");
  await page.waitForTimeout(900);

  const after = await page.evaluate(() => {
    const ed = JSON.parse(localStorage.getItem("vx_roster_edits") || "{}");
    const hits = [];
    for (const [sq, m] of Object.entries(ed.edits || {}))
      for (const [id, p] of Object.entries(m || {})) if (p && p.dob === "17/04/2016") hits.push({ sq, id });
    for (const [sq, l] of Object.entries(ed.added || {}))
      for (const s of l || []) if (s && s.dob === "17/04/2016") hits.push({ sq: "added:" + sq, id: s.id });
    return hits;
  });
  eq(after.length > 0, true, "the date never reached the roster overlay (" + opened + ")");
  return "stored under " + JSON.stringify(after[0]);
});

// ---------------------------------------------------------------------------------------------
// The count on the header and the list underneath have to be the same roster.
// ---------------------------------------------------------------------------------------------
scene("the missing-date filter and the count agree", async (browser) => {
  const page = await openApp(browser);
  await tap(page, "Club Administration");
  await tap(page, "Roster · add / edit");
  const before = await page.evaluate(() => (document.body.innerText.match(/Missing DOB:\s*(\d+)/) || [])[1]);
  if (before == null) return "no missing-date chip on this roster (nothing to check)";
  await tap(page, "Missing DOB");
  await page.waitForTimeout(500);
  const shown = await page.evaluate(() => (document.body.innerText.match(/Showing\s+(\d+)\s+missing DOB/) || [])[1]);
  eq(shown, before, "the chip and the filtered list disagree");
  return before + " missing, and the list shows the same";
});

// ---------------------------------------------------------------------------------------------
// Nothing may be written to the database without a token. Signing in fires every fetch at once,
// and this is the window that filled a coach's banner four separate times.
// ---------------------------------------------------------------------------------------------
scene("no write leaves the device while there is no session", async (browser) => {
  const page = await openApp(browser);
  const sent = [];
  await page.route("**/rest/v1/**", (route) => { sent.push(route.request().method()); route.abort(); });
  await page.evaluate(() => { window.__VX_AUTH = null; });
  await tap(page, "Club Administration");
  await tap(page, "Roster · add / edit");
  await page.waitForTimeout(1200);
  const writes = sent.filter((m) => m !== "GET" && m !== "HEAD");
  eq(writes.length, 0, "writes went out anonymously: " + writes.join(","));
  return "no writes attempted with no session";
});

// ---------------------------------------------------------------------------------------------
// Every tool screen, opened, and told off for anything that did not render.
//
// The club's own console was full of the evidence and nobody was reading it: bindings that never
// resolved and were "rendered as empty", and SVG attributes left as the literal text "{{ d.x }}"
// — which is a chart that silently draws nothing. A coach does not report an empty chart as a
// bug; they assume the squad has no data. So this asks every screen, once, in one run.
// ---------------------------------------------------------------------------------------------
const TOOLS = [
  "AI Assistants","Daily Attendance","Activity log","Birthdays","Boards","Club Configuration",
  "Pace Clock","Communication","Dryland & Land Prep","Meet Entries","Family accounts",
  "Fitness Plan","Season Goals","Top Improvers","InBody Import","Vortex Lounge","Meet Day",
  "Meet Operations","The Vortex Pathway","Level-Up Review","Race Strategy","Rankings",
  "Recovery Board","Relay Builder","AI Plan Review","Load & Risk","Safety & Wellbeing",
  "Season Plan","Session Planning","Sponsors","Squads","Staff","Meet Standards","Swimmers",
  "Talent Board","Stroke Technique Cues","T-Pace Tests","Video Analysis",
];

scene("every tool screen renders without a broken binding or chart", async (browser) => {
  const page = await openApp(browser);
  const seen = [];
  page.on("console", (m) => seen.push(m.text()));
  // A fresh load per screen. The back arrow does not reliably return to the grid, and one screen
  // failing to close would report every screen after it as missing — which is a bug in the test,
  // not in the app, and the worst kind of noise to hand somebody.
  const broken = [];
  for (const name of TOOLS) {
    await page.goto("http://127.0.0.1:" + PORT + "/proto.html?drive=" + Date.now(), { waitUntil: "networkidle" });
    await page.waitForTimeout(1100);
    page.problems.length = 0;
    // Three ways in, because the tiles are not all in one place: most are under Tools & AI, the
    // club-level ones under Club Administration, and the squad-scoped ones only exist once a
    // squad is open. A screen this test cannot reach is a screen nobody is checking.
    let opened = false;
    for (const route of [["Tools & AI"], ["Club Administration"], ["Senior A", "Tools & AI"]]) {
      try {
        for (const step of route) await tap(page, step);
        seen.length = 0;
        await tap(page, name);
        opened = true;
        break;
      } catch {
        await page.goto("http://127.0.0.1:" + PORT + "/proto.html?drive=" + Date.now(), { waitUntil: "networkidle" });
        await page.waitForTimeout(900);
      }
    }
    if (!opened) { broken.push({ tool: name, why: "could not be reached from the hub at all" }); continue; }
    await page.waitForTimeout(600);

    const unresolved = [...new Set(seen.filter((t) => /never resolved/.test(t))
      .map((t) => (t.match(/\{\{\s*([^}]+?)\s*\}\}/) || [, t])[1]))];
    const svg = [...new Set(seen.filter((t) => /Problem parsing|Invalid value for/.test(t))
      .map((t) => (t.match(/"\{\{\s*([^}]+?)\s*\}\}"/) || [, "?"])[1]))];
    // Text the runtime could not fill, left visible to a coach.
    const litera = await page.evaluate(() => {
      const t = document.body.innerText || "";
      return [...new Set((t.match(/\{\{[^}]{1,40}\}\}/g) || []))].slice(0, 5);
    });
    if (unresolved.length || svg.length || litera.length || page.problems.length)
      broken.push({ tool: name, unresolved, svg, onScreen: litera, errors: page.problems.slice(0, 2) });
  }

  if (broken.length) {
    const lines = broken.map((b) => {
      const bits = [];
      if (b.why) bits.push(b.why);
      if (b.unresolved?.length) bits.push("empty: " + b.unresolved.join(", "));
      if (b.svg?.length) bits.push("chart not drawn: " + b.svg.join(", "));
      if (b.onScreen?.length) bits.push("raw on screen: " + b.onScreen.join(" "));
      if (b.errors?.length) bits.push("error: " + b.errors.join(" | "));
      return "\n       · " + b.tool.padEnd(24) + bits.join("  ");
    }).join("");
    throw new Error(broken.length + " of " + TOOLS.length + " screens have something unrendered:" + lines);
  }
  return TOOLS.length + " screens, nothing unrendered";
});

// ---------------------------------------------------------------------------------------------
const only = process.argv[2];
await start();
const browser = await chromium.launch({ executablePath: CHROME });
let failed = 0, ran = 0;
for (const s of scenes) {
  if (only && !s.name.toLowerCase().includes(only.toLowerCase())) continue;
  ran++;
  try {
    const note = await s.fn(browser);
    console.log("  ok   " + s.name + (note ? "  — " + note : ""));
  } catch (e) {
    failed++;
    console.log("  FAIL " + s.name + "\n       " + e.message);
  }
}
await browser.close();
if (server) server.kill();
console.log("\n  " + (ran - failed) + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
