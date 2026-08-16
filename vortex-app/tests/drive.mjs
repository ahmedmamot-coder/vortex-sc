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
    // The app remembers where you were and returns you there on a refresh, which is right for a
    // coach and wrong for this. The sweep reloads between screens to get back to the hub, and
    // instead every reload landed on the screen it had just left — so a screen reachable only
    // from the hub was reported "could not be reached from the hub at all". Fourteen of them
    // were, and none of them was actually broken. This runs on every navigation in the page.
    localStorage.removeItem("vx_nav");
    for (const [k, v] of Object.entries(s || {})) localStorage.setItem(k, JSON.stringify(v));
  }, seed || {});
  await page.goto("http://127.0.0.1:" + PORT + "/proto.html?drive=" + Date.now(), { waitUntil: "networkidle" });
  await page.waitForTimeout(1600);
  page.problems = problems;
  return page;
}

/**
 * The same app, but signed in — and with the database replaced by a recorder.
 *
 * openApp above deliberately has no token, which proves nothing goes out when nobody is signed
 * in. That is half the question. The other half is the one the club actually asked: when somebody
 * IS signed in, does pressing Save reach Supabase, or does it stop at the phone? Saving to
 * localStorage and saving to the database look identical on screen — both instant, both still
 * there after a refresh on that phone — and only one of them is there on the tablet tomorrow.
 *
 * So this seeds a live-looking token, intercepts every REST call, answers it as the database
 * would, and keeps the list. page.writes is then what actually left the device.
 */
async function openLive(browser, seed) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  const problems = [], writes = [];
  page.on("pageerror", (e) => problems.push(String(e.message)));
  await page.route("**/rest/v1/**", async (route) => {
    const req = route.request(), m = req.method();
    const table = (new URL(req.url()).pathname.split("/rest/v1/")[1] || "").split("?")[0];
    if (m !== "GET" && m !== "HEAD") {
      let keys = [];
      try {
        const body = JSON.parse(req.postData() || "[]");
        keys = (Array.isArray(body) ? body : [body]).map((r) => r && r.key).filter(Boolean);
      } catch {}
      writes.push({ method: m, table, keys, body: req.postData() || "" });
    }
    await route.fulfill({ status: m === "GET" ? 200 : 201, contentType: "application/json", body: "[]" });
  });
  await page.addInitScript((s) => {
    localStorage.setItem("vx_session", JSON.stringify({ type: "staff", id: "ahmed" }));
    // Read back at boot into window.__VX_AUTH. An hour of life, so no refresh is attempted.
    localStorage.setItem("vx_auth", JSON.stringify({ token: "drive-fake", refresh: "drive-fake", exp: Date.now() + 3600000 }));
    localStorage.removeItem("vx_nav");
    for (const [k, v] of Object.entries(s || {})) localStorage.setItem(k, JSON.stringify(v));
  }, seed || {});
  // Not networkidle: a signed-in app polls, so the network is never idle and the wait never ends.
  await page.goto("http://127.0.0.1:" + PORT + "/proto.html?drive=" + Date.now(), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
  page.problems = problems;
  page.writes = writes;
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
// The same date of birth again, but signed in — and this time the question is whether it left the
// phone. The scene above proves it reaches the roster overlay; a coach cannot tell that apart
// from it reaching Supabase, and the difference is the whole of what the club has been losing.
// ---------------------------------------------------------------------------------------------
scene("a date of birth typed in the admin list is sent to the database, not just the device", async (browser) => {
  const page = await openLive(browser);
  await tap(page, "Club Administration");
  await tap(page, "Roster · add / edit");
  const opened = await page.evaluate(() => {
    let icon = document.querySelector('svg.lucide-pencil, i[data-lucide="pencil"]');
    let btn = icon && icon.closest("button");
    if (!btn) {
      const row = [...document.querySelectorAll("div")]
        .filter((d) => d.querySelectorAll(":scope > button").length === 2)
        .sort((a, b) => (a.textContent || "").length - (b.textContent || "").length)[0];
      btn = row && row.querySelector(":scope > button");
    }
    if (!btn) return null;
    btn.click();
    return ((btn.closest("div") || {}).textContent || "").trim().slice(0, 40);
  });
  if (!opened) throw new Error("no swimmer row had an edit button");
  await page.waitForTimeout(600);
  const box = await page.$('input[placeholder="DOB dd/mm/yyyy"]');
  if (!box) throw new Error("the editor opened without a date of birth box");
  await box.click();
  await box.type("09/11/2015", { delay: 25 });
  page.writes.length = 0;
  await tap(page, "Save");
  await page.waitForTimeout(1800);

  const roster = page.writes.filter((w) => w.table === "club_state" && w.keys.includes("vx_roster_edits"));
  eq(roster.length > 0, true,
     "Save wrote the date to this phone and sent nothing — tables written: "
     + ([...new Set(page.writes.map((w) => w.table))].join(", ") || "none"));
  // And the date has to be IN what was sent, not merely a write of the same key triggered by
  // something else on the screen.
  eq(roster.some((w) => w.body.includes("09/11/2015")), true, "a write went out, but not carrying the date");
  return "sent to club_state, carrying the date";
});

// ---------------------------------------------------------------------------------------------
// Attendance is the most-pressed thing in the club — every coach, every squad, twice a day — and
// it is the one write where two coaches are marking at the same time on different phones. It has
// its own table for that reason. This checks a mark actually reaches it.
// ---------------------------------------------------------------------------------------------
scene("marking a swimmer on the register reaches the attendance table", async (browser) => {
  const page = await openLive(browser);
  await tap(page, "Tools & AI");
  await tap(page, "Daily Attendance");
  await tap(page, "Pre-Team");                  // opens that squad's summary in place
  // The club-wide screen lists everyone but marks nobody: cycleAttend works off the open squad,
  // so on this screen tapping a swimmer does nothing at all. "Take / edit this squad’s register" is
  // the way through to the register that does mark, and the route a coach actually takes.
  await tap(page, "Take / edit this squad");
  page.writes.length = 0;
  // On the register each swimmer has a small status button of its own, reading exactly
  // "Present", and tapping it cycles present → absent → late. Matching anything merely
  // CONTAINING the word finds the filter chip ("Present 272") and the squad header
  // ("Pre-Team · 3/3 present") first, and clicking either of those only filters or closes a
  // squad — indistinguishable, from the outside, from a mark that saved nothing.
  const who = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button,[onclick]")]
      .find((e) => e.offsetParent && /^(present|absent|late)$/i.test((e.innerText || "").trim()));
    if (!btn) return null;
    btn.click();
    const row = btn.closest("div");
    return ((row && row.innerText) || "").split("\n").find((s) => /[a-z]{2,}\s+[a-z]{2,}/i.test(s)) || "a swimmer";
  });
  if (!who) throw new Error("no swimmer on the register had a status button");
  await page.waitForTimeout(1600);

  const marks = page.writes.filter((w) => w.table === "attendance_marks");
  eq(marks.length > 0, true,
     "the register was marked on this phone and nothing was sent — tables written: "
     + ([...new Set(page.writes.map((w) => w.table))].join(", ") || "none"));
  return who + " marked, and it went to attendance_marks";
});

// ---------------------------------------------------------------------------------------------
// The fitness plans, which is the one that was actually broken.
//
// fitness_plans answered 400 to every read for as long as anyone knows, so the app fell back to
// the copy on the device and every coach's plan stayed on the phone it was typed on. The columns
// are back now. This is the check that the writing half works — because the read being fixed and
// the write reaching Supabase are two different claims, and only one of them was tested.
// ---------------------------------------------------------------------------------------------
scene("editing a fitness plan reaches the fitness_plans table", async (browser) => {
  const page = await openLive(browser);
  await tap(page, "Tools & AI");
  await tap(page, "Fitness Plan");
  const box = await page.$('input[placeholder="Exercise name"]');
  if (!box) throw new Error("the fitness plan opened with nowhere to type an exercise");
  page.writes.length = 0;
  await box.click();
  await box.type("Goblet squat", { delay: 25 });
  // _fitPlanPush debounces by 400ms so a coach typing a name does not send a row per keystroke.
  await page.waitForTimeout(2200);

  const plans = page.writes.filter((w) => w.table === "fitness_plans");
  eq(plans.length > 0, true,
     "typed into the plan and nothing was sent — tables written: "
     + ([...new Set(page.writes.map((w) => w.table))].join(", ") || "none"));
  eq(plans.some((w) => w.body.includes("Goblet squat")), true, "a write went out without the exercise in it");
  // One row per squad, not the whole club's plans in a blob — that is what stops two coaches
  // editing two squads from overwriting each other.
  eq(plans.every((w) => { try { return JSON.parse(w.body).length === 1; } catch { return false; } }), true,
     "a plan write carried more than one squad's row");
  return plans.length + " write(s), one squad's row each, carrying the exercise";
});

// ---------------------------------------------------------------------------------------------
// Sitting on a screen and touching nothing must not write to the database.
//
// Found by accident, while a fake database was answering every read with an empty list: the app
// posted the squad table three hundred times in two seconds and would have gone on until the tab
// was closed. The seed writes the rows, the write is accepted, so it re-reads — and if that read
// still comes back empty it seeds again, for ever. A write that succeeds and a read that returns
// nothing is what a table whose INSERT and SELECT policies disagree does, and this club has
// already had one policy written the permissive way and the other not.
//
// Nothing on screen would ever have said so. It would have looked like a slow app and a large bill.
// ---------------------------------------------------------------------------------------------
scene("an idle screen does not write to the database over and over", async (browser) => {
  // Every read answers empty — the state that turned one seed into an unbroken loop.
  const page = await openLive(browser);
  await page.waitForTimeout(1500);
  page.writes.length = 0;
  await page.waitForTimeout(6000);          // six seconds of doing absolutely nothing
  const byTable = {};
  for (const w of page.writes) byTable[w.table] = (byTable[w.table] || 0) + 1;
  const worst = Object.entries(byTable).sort((a, b) => b[1] - a[1])[0];
  eq(!worst || worst[1] <= 12, true,
     "idle for six seconds and it wrote " + (worst && worst[1]) + " times to " + (worst && worst[0])
     + " — every signed-in device would be doing this at once");
  return worst ? worst[1] + " writes to " + worst[0] + " in six idle seconds" : "no writes at all while idle";
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
// The first version of this list had all 38 names in one bucket and three routes to try. Seven of
// them are not tool screens at all — they are the cards on the Coaches Handbook, which expand in
// place rather than opening — so the sweep reported them "could not be reached" run after run,
// and that noise sat on top of the real answer. Two lists, each opened the way it actually opens.
const TOOLS = [
  "Insights","AI Assistants","Daily Attendance","Activity log","Birthdays","Boards",
  "Club Configuration","Pace Clock","Zone Engine","Meet Entries","Family accounts",
  "Fitness Plan","Season Goals","Top Improvers","InBody Import","Vortex Lounge","Meet Day",
  "Level-Up Review","Race Strategy","Rankings","Recovery Board","Relay Builder","AI Plan Review",
  "Load & Risk","Season Plan","Sponsors","Squads","Staff","Meet Standards","Swimmers",
  "Talent Board","T-Pace Tests","Video Analysis",
];
// Every card on the Coaches Handbook. These are what a new coach reads, so a section that renders
// empty is a section that teaches nothing — and it looks identical to one that is simply short.
const HANDBOOK = [
  "The Vortex Pathway","Energy-Zone System","Stroke Technique Cues","Session Planning",
  "Dryland & Land Prep","Meet Operations","Safety & Wellbeing","Communication",
];

scene("every tool screen renders without a broken binding or chart", async (browser) => {
  const page = await openApp(browser);
  const seen = [];
  page.on("console", (m) => seen.push(m.text()));
  // A fresh load per screen. The back arrow does not reliably return to the grid, and one screen
  // failing to close would report every screen after it as missing — which is a bug in the test,
  // not in the app, and the worst kind of noise to hand somebody.
  // Ways in, because the tiles are not all in one place: most are under Tools & AI, the
  // club-level ones under Club Administration, and the squad-scoped ones only exist once a squad
  // is open. A screen this test cannot reach is a screen nobody is checking.
  const SCREENS = [
    ...TOOLS.map((name) => ({ name, routes: [["Tools & AI"], ["Club Administration"], ["Senior A", "Tools & AI"]] })),
    ...HANDBOOK.map((name) => ({ name, routes: [["Coaches Handbook"]] })),
  ];
  const broken = [];
  for (const { name, routes } of SCREENS) {
    await page.goto("http://127.0.0.1:" + PORT + "/proto.html?drive=" + Date.now(), { waitUntil: "networkidle" });
    await page.waitForTimeout(1100);
    page.problems.length = 0;
    let opened = false;
    for (const route of routes) {
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
    throw new Error(broken.length + " of " + SCREENS.length + " screens have something unrendered:" + lines);
  }
  return SCREENS.length + " screens, nothing unrendered";
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
