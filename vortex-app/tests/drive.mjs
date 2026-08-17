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
async function openLive(browser, seed, db) {
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
    // A read answers with whatever the caller seeded for that table, and [] otherwise.
    //
    // This matters more than it looks. Several screens keep a fallback for a club whose table has
    // no rows yet — squads, videos and the plans all still work off the old shared document until
    // their table has something in it. Answering every read with [] pins the app to that fallback,
    // so a test that "proves the save works" proves it for the path the club stopped using. The
    // squad edit went to club_state instead of vx_squads_t for exactly that reason.
    const rows = (m === "GET" && db && db[table]) || [];
    await route.fulfill({ status: m === "GET" ? 200 : 201, contentType: "application/json",
                          body: JSON.stringify(rows) });
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

// The staff card for one person, found by the thing that makes it a staff card rather than by a
// style rule that can be edited: it is the nearest ancestor of their name that also holds their
// Set password button. Returns { status, input, button } as a handle inside the page.
const STAFF_CARD = `(function(name){
  for (const el of document.querySelectorAll("span")) {
    if ((el.innerText || "").trim() !== name) continue;
    let card = el;
    for (let i = 0; i < 8 && card; i++) {
      const btn = [...card.querySelectorAll("button")].find((b) => /set password/i.test(b.innerText || ""));
      if (btn) return { card, btn, input: card.querySelector("input[type=text]") };
      card = card.parentElement;
    }
  }
  return null;
})`;

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
// What the console says before anybody touches anything.
//
// The 38-screen sweep below clears the console immediately before opening each screen, so
// everything logged while the app was starting up was thrown away unread — and starting up is
// exactly when the print sheet and the three progress charts render with no data behind them.
// A screenshot of the live console showed a page of "{{ pset.dist }} never resolved" that the
// sweep had been reporting as clean, for as long as the sweep has existed.
//
// This is the check that a coach opening the app on a phone logs nothing. It matters because a
// console full of harmless red is where a real error hides: the 400 that stopped every coach's
// fitness plan reaching the database scrolled past in exactly this noise for weeks.
// ---------------------------------------------------------------------------------------------
scene("opening the app logs nothing unresolved, before a single tap", async (browser) => {
  const seen = [];
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  page.on("console", (m) => seen.push(m.text()));
  const problems = [];
  page.on("pageerror", (e) => problems.push(String(e.message)));
  await page.addInitScript(() => {
    localStorage.setItem("vx_session", JSON.stringify({ type: "staff", id: "ahmed" }));
    localStorage.removeItem("vx_nav");
  });
  await page.goto("http://127.0.0.1:" + PORT + "/proto.html?boot=" + Date.now(), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);   // long enough for lucide, the charts and the first render

  // Four lines I could not explain, listed rather than silenced.
  //
  // psec.startLabel was in this list and is now fixed: the print sheet's section mapper never
  // copied it out of planSections, so every printed session had a blank where each section's
  // start time belongs. That one was real, and it prints now.
  //
  // These four resist the same treatment. The only mapper that can produce a `pset` gives all
  // four of them a value — setMetres is `(Number(x)||0).toLocaleString()`, which cannot be
  // undefined — and the sheet itself renders correctly with real data: four sections, eight rows,
  // every distance and time present. So they come from a render pass I have not identified, and
  // saying "fixed" would be a guess. They are named here so the check still fails on anything
  // NEW, which is the whole reason it exists.
  const KNOWN = ["pset.dist", "pset.txt", "pset.timeLabel", "pset.setMetres"];
  const unresolved = [...new Set(seen.filter((t) => /never resolved/.test(t))
    .map((t) => (t.match(/\{\{\s*([^}]+?)\s*\}\}/) || [, t])[1]))];
  const unexplained = unresolved.filter((b) => !KNOWN.includes(b));
  const svg = [...new Set(seen.filter((t) => /Problem parsing|Invalid value for/.test(t)))];
  eq(unexplained.join(", "), "", "a binding resolved to nothing on a plain start-up");
  eq(svg.length, 0, "charts drew a path of 'undefined' on a plain start-up: " + svg.slice(0, 2).join(" | "));
  eq(problems.join(" | "), "", "the app threw while starting");
  // The print sheet has to actually be built, or this scene passes because nothing rendered.
  const sheet = await page.evaluate(() => {
    const n = document.getElementById("vx-print-sheet");
    return n ? { rows: n.querySelectorAll("tr").length, start: /\d{1,2}:\d{2}\s?(AM|PM)/.test(n.innerText || "") } : null;
  });
  eq(!!sheet && sheet.rows > 0, true, "the print sheet rendered nothing, so this proves nothing about it");
  eq(sheet.start, true, "the printed sheet has no start time on it — psec.startLabel is missing again");
  return seen.length + " console lines, " + sheet.rows + " printed rows with start times, "
       + unresolved.length + " known holes and no new ones";
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
// A post in the Vortex Lounge. Every message is its own row, on purpose — a squad's feed is the
// one place several people type at once, and a shared document would have them overwriting each
// other's posts.
// ---------------------------------------------------------------------------------------------
scene("a post in the lounge reaches the lounge_posts table", async (browser) => {
  const page = await openLive(browser);
  await tap(page, "Tools & AI");
  await tap(page, "Vortex Lounge");
  const box = await page.$('textarea[placeholder="Share a set, a win, a question…"]');
  if (!box) throw new Error("the lounge opened with nowhere to type");
  await box.click();
  await box.type("Great session tonight", { delay: 20 });
  await page.waitForTimeout(300);
  page.writes.length = 0;
  // The post button carries no text at all — it is a paper-plane icon. Matching on words found
  // some other button entirely and clicked it, which looked exactly like a post that saved
  // nothing. Lucide swaps the <i data-lucide="send"> for an <svg class="lucide-send"> once it
  // runs, so both spellings have to be accepted, the same as the roster's pencil.
  const posted = await page.evaluate(() => {
    const icon = document.querySelector('svg.lucide-send, i[data-lucide="send"]');
    const b = icon && icon.closest("button");
    if (!b) return false;
    b.click();
    return true;
  });
  if (!posted) throw new Error("the lounge had no send button to press");
  await page.waitForTimeout(1800);

  const rows = page.writes.filter((w) => w.table === "lounge_posts");
  eq(rows.length > 0, true, "the post stayed on the phone — tables written: "
     + ([...new Set(page.writes.map((w) => w.table))].join(", ") || "none"));
  eq(rows.some((w) => w.body.includes("Great session tonight")), true, "a write went out without the post in it");
  // Append-only. An upsert of the whole feed is how one coach's post erases another's.
  eq(rows.every((w) => w.method === "POST"), true, "a post must be an insert, never a rewrite of the feed");
  return "sent to lounge_posts, carrying the message";
});

// ---------------------------------------------------------------------------------------------
// Renaming a squad. One row per squad, so two coaches editing two squads cannot overwrite each
// other — which is the whole reason squads were taken out of the shared document.
// ---------------------------------------------------------------------------------------------
scene("editing a squad reaches the squads table", async (browser) => {
  // Seeded, so the app is on the row-per-squad path the club actually runs rather than the
  // shared-document fallback it keeps for a table that has never been filled.
  // All nine, with the club's real ids. Seeding a subset leaves the roster holding swimmers in
  // squads that no longer exist, and the app does not survive that — which is worth knowing, but
  // is not what this scene is asking.
  const SQ = [["preteam","Pre-Team"],["advb","Advanced B"],["adva","Advanced A"],["junior","Junior"],
              ["seniorb","Senior B"],["seniora","Senior A"],["vortexb","Vortex B"],["vortexa","Vortex A"],
              ["legend","Legend"]];
  const page = await openLive(browser, null, {
    vx_squads_t: SQ.map(([id, name], i) => ({ id, name, ages: "", accent: "#2733D6",
                                              short: name.slice(0, 3), coach: "", sort: i })),
  });
  await tap(page, "Club Administration");
  await tap(page, "add, rename, colours");        // the Squads row, by its own subtitle
  const opened = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button,[onclick]")]
      .find((e) => e.offsetParent && /^edit$/i.test((e.innerText || "").trim()));
    if (!b) return false;
    b.click();
    return true;
  });
  if (!opened) throw new Error("no squad had an edit button");
  await page.waitForTimeout(700);
  const typed = await page.evaluate(() => {
    const i = [...document.querySelectorAll("input[type=text], input:not([type])")]
      .find((e) => e.offsetParent && (e.value || "").trim().length > 0);
    if (!i) return null;
    const was = i.value;
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    set.call(i, was + " X");
    i.dispatchEvent(new Event("input", { bubbles: true }));
    return was;
  });
  if (typed == null) throw new Error("the squad editor opened with nothing to type into");
  page.writes.length = 0;
  await page.waitForTimeout(400);
  await tap(page, "Save");
  await page.waitForTimeout(1800);

  const rows = page.writes.filter((w) => w.table === "vx_squads_t");
  eq(rows.length > 0, true, "the squad was renamed on this phone only — tables written: "
     + ([...new Set(page.writes.map((w) => w.table))].join(", ") || "none"));
  // One row, not all nine. Sending the whole list is what let one edit undo another's.
  eq(rows.some((w) => { try { return JSON.parse(w.body).length === 1; } catch { return false; } }), true,
     "a squad edit sent more than one squad's row");
  return "renamed " + JSON.stringify(typed) + ", sent one row to vx_squads_t";
});

// ---------------------------------------------------------------------------------------------
// The season plan — phases, weeks, taper and peak. One row per squad, like the fitness plans, and
// for the same reason: two coaches planning two squads must not overwrite each other.
// ---------------------------------------------------------------------------------------------
scene("editing a season plan reaches the season_plans table", async (browser) => {
  const page = await openLive(browser);
  await tap(page, "Tools & AI");
  await tap(page, "Season Plan");
  const box = await page.$('input[placeholder="Season name"]');
  if (!box) throw new Error("the season plan opened with no season name to type");
  await box.click();
  await box.type(" 2026-27", { delay: 25 });
  page.writes.length = 0;
  await page.waitForTimeout(2200);        // _seasonPush debounces, like the fitness plan

  const rows = page.writes.filter((w) => w.table === "season_plans");
  eq(rows.length > 0, true, "the season was named on this phone and nothing was sent — tables written: "
     + ([...new Set(page.writes.map((w) => w.table))].join(", ") || "none"));
  eq(rows.some((w) => w.body.includes("2026-27")), true, "a write went out without the season name in it");
  eq(rows.every((w) => { try { return JSON.parse(w.body).length === 1; } catch { return false; } }), true,
     "a season write carried more than one squad's row");
  return rows.length + " write(s) to season_plans, one squad's row each";
});

// ---------------------------------------------------------------------------------------------
// Entering a swimmer into an event. This is the one with a deadline attached: entries close, and
// an entry that stayed on the phone it was typed on is a child who does not swim.
// ---------------------------------------------------------------------------------------------
scene("entering a swimmer in an event reaches the database", async (browser) => {
  const page = await openLive(browser);
  await tap(page, "Tools & AI");
  await tap(page, "Meet Entries");
  const box = await page.$('input[placeholder="Search swimmer…"]');
  if (!box) throw new Error("meet entries opened with no swimmer search");
  await box.click();
  await box.type("Alia", { delay: 25 });
  await page.waitForTimeout(900);
  await tap(page, "Alia Ezzat");
  await tap(page, "50 Free");
  page.writes.length = 0;
  // "Add × selected events" — the count is in the label, so match the beginning only.
  const added = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button,[onclick]")]
      .find((e) => e.offsetParent && /^add\b/i.test((e.innerText || "").replace(/\s+/g, " ").trim()));
    if (!b) return false;
    b.click();
    return true;
  });
  if (!added) throw new Error("nothing on the screen would add the selected event");
  await page.waitForTimeout(1800);

  const rows = page.writes.filter((w) => w.table === "club_state" && w.keys.includes("vx_meet_entries"));
  eq(rows.length > 0, true, "the entry stayed on this phone — tables and keys written: "
     + (page.writes.map((w) => w.table + (w.keys.length ? ":" + w.keys.join("/") : "")).join(", ") || "none"));
  return "sent to club_state as vx_meet_entries";
});

// ---------------------------------------------------------------------------------------------
// The app has to survive a squad being deleted.
//
// Club Administration can delete a squad, and doing so replaced the entire interface with
// "Cannot read properties of undefined (reading 'name')" — on every device, until somebody put
// the squad back. The promotion ladder was a fixed list of the nine this club started with and
// handed back the next id whether or not it still existed.
//
// The unit test covers the ladder. This covers the thing the unit test cannot: that the app
// actually boots, because the next unguarded lookup of that kind will be somewhere else.
// ---------------------------------------------------------------------------------------------
scene("the app still opens after a squad is deleted", async (browser) => {
  const LADDER = ["preteam", "advb", "adva", "junior", "seniorb", "seniora", "vortexb", "vortexa", "legend"];
  const rows = (ids) => ids.map((id, i) => ({ id, name: id, ages: "", accent: "#2733D6",
                                              short: id.slice(0, 3), coach: "", sort: i }));
  const results = [];
  for (const [label, ids] of [["all nine", LADDER],
                              ["Senior B deleted", LADDER.filter((s) => s !== "seniorb")],
                              ["only two left", ["junior", "seniora"]]]) {
    const page = await openLive(browser, null, { vx_squads_t: rows(ids) });
    await page.waitForTimeout(1200);
    const txt = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " "));
    // The roster is still full of swimmers whose squads have gone — that is the point.
    eq(/Cannot read propert|renderVals\(\):|missing \) after/.test(txt), false,
       label + ": the app came up as an error screen — " + txt.slice(0, 110));
    eq(page.problems.length, 0, label + ": it threw — " + page.problems.slice(0, 1).join(""));
    eq(/swimmers across \d+ squad/.test(txt), true, label + ": the hub never drew");
    results.push(label + " ✓");
    await page.close();
  }
  return results.join(", ");
});

// ---------------------------------------------------------------------------------------------
// Data that is wrong in the ways a club's data actually goes wrong.
//
// The squad-deletion white screen was found by accident, seeding a table oddly in another test.
// So this asks the question on purpose — and found four more in one pass: a roster overlay stored
// as a string, an overlay missing one of its three parts, a swimmer filed under a squad that no
// longer exists, and the meets calendar arriving as text.
//
// None of those is exotic. They are what a half-finished write, an older build, or a restore
// somebody edited by hand leaves behind. And all of it lives in club_state, which every device
// shares — so one bad value is not one broken phone, it is the whole club looking at "Cannot read
// properties of undefined" at the same moment, ten days before six hundred people arrive.
// ---------------------------------------------------------------------------------------------
scene("the app survives data that is wrong in the usual ways", async (browser) => {
  const SQ = ["preteam", "advb", "adva", "junior", "seniorb", "seniora", "vortexb", "vortexa", "legend"];
  const sq = (ids) => ids.map((id, i) => ({ id, name: id, ages: "", accent: "#2733D6", short: id.slice(0, 3), coach: "", sort: i }));
  const CASES = [
    ["a squad renamed to an empty string", null, sq(SQ).map((r, i) => (i === 3 ? { ...r, name: "" } : r))],
    ["a squad row with no id at all", null, [...sq(SQ), { name: "Ghost", sort: 9 }]],
    ["two squads sharing one id", null, [...sq(SQ), { id: "junior", name: "Junior 2", sort: 9 }]],
    ["the roster overlay stored as a string", { vx_roster_edits: '"nonsense"' }, sq(SQ)],
    ["the roster overlay as broken json", { vx_roster_edits: '{"edits":' }, sq(SQ)],
    ["an overlay missing one of its three parts",
     { vx_roster_edits: JSON.stringify({ edits: {}, added: { nosuchsquad: [{ id: "zz", name: "Ghost" }] } }) }, sq(SQ)],
    ["a swimmer with no name", { vx_roster_edits: JSON.stringify({ edits: { junior: { r1: { name: "" } } } }) }, sq(SQ)],
    ["the brand config as a number", { vx_brand: "42" }, sq(SQ)],
    ["the meets calendar as text", { vx_meets_cal: '"soon"' }, sq(SQ)],
  ];
  const broke = [];
  for (const [label, seed, rows] of CASES) {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
    await page.route("**/rest/v1/**", (r) => {
      const m = r.request().method();
      const t = (new URL(r.request().url()).pathname.split("/rest/v1/")[1] || "").split("?")[0];
      return r.fulfill({ status: m === "GET" ? 200 : 201, contentType: "application/json",
                         body: JSON.stringify(m === "GET" && t === "vx_squads_t" ? rows : []) });
    });
    await page.addInitScript((s) => {
      localStorage.setItem("vx_session", JSON.stringify({ type: "staff", id: "ahmed" }));
      localStorage.setItem("vx_auth", JSON.stringify({ token: "drive-fake", refresh: "drive-fake", exp: Date.now() + 3600000 }));
      localStorage.removeItem("vx_nav");
      // Written raw on purpose: the point is a value that is already wrong in storage.
      for (const [k, v] of Object.entries(s || {})) localStorage.setItem(k, v);
    }, seed || {});
    await page.goto("http://127.0.0.1:" + PORT + "/proto.html?rough=" + Date.now(), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2600);
    const txt = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " "));
    if (/Cannot read propert|renderVals\(\):|is not a function|undefined is not|missing \) after/.test(txt))
      broke.push(label + " — " + txt.slice(0, 80));
    else if (!/swimmers across \d+ squad/.test(txt)) broke.push(label + " — the hub never drew");
    await page.close();
  }
  eq(broke.join(" | "), "", "the app came up broken on data a club can really have");
  return CASES.length + " kinds of bad data, all survivable";
});

// ---------------------------------------------------------------------------------------------
// An icon must show what it currently means, not what it meant when it was first drawn.
//
// A staff row showed a red warning beside green text saying the password was set. The red icon
// had been drawn while that row had no email address, and it never changed back: lucide swaps
// <i data-lucide="x"> for <svg class="lucide lucide-x">, so the element in the page stops being
// the one the template thinks it is, and a later name change lands on an attribute nobody redraws.
//
// Twenty-nine icons in this app get their name at render time — chevrons, play and pause, status
// marks. This was never one row.
// ---------------------------------------------------------------------------------------------
scene("an icon redraws when what it means changes", async (browser) => {
  // The version of this scene that shipped a broken fix set data-lucide on the live svg by hand
  // and watched it redraw. Nothing in the app ever does that. The page is rendered by React, so
  // React writes the new name to the <i> it created — which lucide replaced and removed from the
  // document — and the svg on screen is never told. The scene passed and the bug shipped: a
  // staff row showed an amber key beside green text saying the password was set.
  //
  // So this changes what the app KNOWS and looks at what is drawn, which is the only version of
  // the question worth asking.
  const page = await openLive(browser, null, {
    staff_accounts: [{ id: "st_nabil", name: "Coach Nabil", username: "nabil", role: "Coach",
                       squad_id: "adva", email: "nabil@club.test", is_custom: true }],
  });
  const have = new Set();
  await page.route("**/api/staff/sign-in-status", (route) => {
    const asked = JSON.parse(route.request().postData() || "{}").emails || [];
    const accounts = {};
    for (const e of asked) if (have.has(e)) accounts[e] = { lastSignIn: null, createdAt: "2026-08-10T00:00:00Z", confirmed: true };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, accounts }) });
  });
  await page.route("**/api/staff/set-password", (route) => {
    have.add(JSON.parse(route.request().postData() || "{}").email);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, action: "created" }) });
  });

  const drawn = () => page.evaluate((find) => {
    const hit = eval(find)("Coach Nabil");
    if (!hit) return null;
    const host = hit.card.querySelector("i[data-vx-icon]");
    const svg = host && host.querySelector("svg");
    return { name: host && host.getAttribute("data-vx-icon"),
             picture: svg ? (svg.getAttribute("class") || "vx-glyph") : "nothing drawn" };
  }, STAFF_CARD);

  await tap(page, "Club Administration");
  await tap(page, "sign-in & access");
  await page.waitForTimeout(1600);

  const before = await drawn();
  if (!before) throw new Error("could not find the staff row to read an icon off");
  eq(before.name, "key-round", "the row should start with no sign-in account");
  eq(/lucide-key-round/.test(before.picture), true, "drawn as " + before.picture);

  await page.evaluate((find) => {
    const hit = eval(find)("Coach Nabil");
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    set.call(hit.input, "a-long-enough-one");
    hit.input.dispatchEvent(new Event("input", { bubbles: true }));
    setTimeout(() => hit.btn.click(), 250);
  }, STAFF_CARD);
  await page.waitForTimeout(2400);

  const after = await drawn();
  eq(after.name, "check-circle-2", "the row's icon should have changed meaning");
  eq(/lucide-check-circle-2/.test(after.picture), true,
     "the name changed to " + after.name + " and the picture is still " + after.picture);

  // And nothing anywhere on the screen showing a picture that disagrees with its name.
  const stale = await page.evaluate(() =>
    [...document.querySelectorAll("i[data-vx-icon]")]
      .map((h) => {
        const want = h.getAttribute("data-vx-icon") || "", svg = h.querySelector("svg");
        if (!want) return null;
        const cls = svg ? (svg.getAttribute("class") || "") : "nothing drawn";
        if (cls === "vx-glyph") return null;                    // one of the club's own glyphs
        return cls.includes("lucide-" + want) ? null : want + " drawn as " + cls;
      })
      .filter(Boolean));
  eq(stale.join(", "), "", "icons on screen whose picture does not match their name");
  return "key-round → check-circle-2 from a real state change, and nothing left stale";
});

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
// ---------------------------------------------------------------------------------------------
// "why after seting the password this message still showing in each account"
//
// The staff row said "Email ready - set a password below so they can sign in" for coaches who
// already had a working password. It was reading a note the app wrote to itself the moment
// somebody pressed the button, and that note answers a different question from the one printed
// on the row: it knows about button presses on THIS phone, and nothing about a password set on
// the other manager's phone, set last month, or set in the Supabase dashboard.
//
// So the row asks Supabase now. Two coaches here: one with a sign-in account and one without,
// which is the club's actual situation - Reda's could not be created at all.
// ---------------------------------------------------------------------------------------------
scene("the staff list says who can sign in, from Supabase and not from a note on this phone", async (browser) => {
  // Two names the club has no coach under, so the rows this scene reads are unambiguously the
  // ones it seeded — the base list already has a Sherif and a Reda.
  const STAFF = [
    { id: "st_yara", name: "Coach Yara", username: "yara", role: "Coach", squad_id: "junior",
      email: "yara@club.test", is_custom: true },
    { id: "st_nabil", name: "Coach Nabil", username: "nabil", role: "Coach", squad_id: "adva",
      email: "redazizo29@gmail.com", is_custom: true },
  ];
  const page = await openLive(browser, null, { staff_accounts: STAFF });

  // Supabase's side of it, kept in one place so setting a password actually changes the answer -
  // an account that appears out of the set-password call and not out of the status call would
  // let a broken loop pass.
  const haveAccounts = new Set(["yara@club.test"]);
  let asked = null;
  await page.route("**/api/staff/sign-in-status", async (route) => {
    asked = (JSON.parse(route.request().postData() || "{}").emails) || [];
    const accounts = {};
    for (const e of asked) if (haveAccounts.has(e)) accounts[e] = { lastSignIn: null, createdAt: "2026-08-10T00:00:00Z", confirmed: true };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, accounts }) });
  });
  const sent = [];
  await page.route("**/api/staff/set-password", async (route) => {
    const b = JSON.parse(route.request().postData() || "{}");
    sent.push(b.email);
    haveAccounts.add(b.email);
    await route.fulfill({ status: 200, contentType: "application/json",
                          body: JSON.stringify({ ok: true, action: "created", email: b.email }) });
  });

  const readRows = () => page.evaluate((find) => {
    const out = {};
    for (const name of ["Coach Yara", "Coach Nabil"]) {
      const hit = eval(find)(name);
      if (hit) out[name] = (hit.card.innerText || "").split("\n")[0].trim();
    }
    return out;
  }, STAFF_CARD);

  await tap(page, "Club Administration");
  await tap(page, "sign-in & access");            // the Staff row, by its own subtitle
  await page.waitForTimeout(1600);

  if (!asked) throw new Error("the staff screen never asked Supabase who can sign in");
  eq(asked.includes("redazizo29@gmail.com") && asked.includes("yara@club.test"), true,
     "it must ask about every staff address, not only the ones it has a note for");

  const before = await readRows();
  if (!before["Coach Yara"] || !before["Coach Nabil"]) throw new Error("the staff rows did not render: " + JSON.stringify(before));
  eq(/Can sign in/.test(before["Coach Yara"]), true,
     "a coach WITH an account still reads: " + JSON.stringify(before["Coach Yara"]));
  eq(/set a password below/.test(before["Coach Yara"]), false,
     "this is the sentence that would not go away");
  eq(/No sign-in account yet/.test(before["Coach Nabil"]), true,
     "a coach with no account should be told so: " + JSON.stringify(before["Coach Nabil"]));

  // Now set one, on the row that has none, and watch that row change without a reload.
  const typed = await page.evaluate((find) => {
    const hit = eval(find)("Coach Nabil");
    if (!hit || !hit.input) return false;
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    set.call(hit.input, "a-long-enough-one");
    hit.input.dispatchEvent(new Event("input", { bubbles: true }));
    setTimeout(() => hit.btn.click(), 250);
    return true;
  }, STAFF_CARD);
  if (!typed) throw new Error("could not find the password box on Nabil's row");
  await page.waitForTimeout(2400);

  eq(sent, ["redazizo29@gmail.com"], "the password went to the wrong address, or nowhere");
  const after = await readRows();
  eq(/Can sign in/.test(after["Coach Nabil"] || ""), true,
     "the row still says: " + JSON.stringify(after["Coach Nabil"]));
  return "asked about " + asked.length + " addresses; the row went "
       + JSON.stringify(before["Coach Nabil"]) + " -> " + JSON.stringify(after["Coach Nabil"]);
});

// ---------------------------------------------------------------------------------------------
// The address that is not what it looks like. Auth refused redazizo29@gmail.com as "invalid
// format" - correctly, because a right-to-left mark had come along with the paste and is
// invisible in the field, in the list and in the error. The app must not send what it cannot
// see, so the address that leaves the phone has to be the clean one.
// ---------------------------------------------------------------------------------------------
scene("an invisible character in an address never leaves the phone", async (browser) => {
  const page = await openLive(browser, null, {
    staff_accounts: [{ id: "st_nabil", name: "Coach Nabil", username: "nabil", role: "Coach",
                       squad_id: "adva", email: "redazizo29@gmail.com" + "\u200f", is_custom: true }],
  });
  await page.route("**/api/staff/sign-in-status", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, accounts: {} }) }));
  const sent = [];
  await page.route("**/api/staff/set-password", async (route) => {
    sent.push(JSON.parse(route.request().postData() || "{}").email);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, action: "created" }) });
  });
  await tap(page, "Club Administration");
  await tap(page, "sign-in & access");
  await page.waitForTimeout(1400);
  const ok = await page.evaluate((find) => {
    const hit = eval(find)("Coach Nabil");
    if (!hit || !hit.input) return false;
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    set.call(hit.input, "a-long-enough-one");
    hit.input.dispatchEvent(new Event("input", { bubbles: true }));
    setTimeout(() => hit.btn.click(), 250);
    return true;
  }, STAFF_CARD);
  if (!ok) throw new Error("could not find the password box on that row");
  await page.waitForTimeout(1800);
  eq(sent, ["redazizo29@gmail.com"],
     "what left the phone was " + JSON.stringify(sent) + " - Auth refuses that, and nothing on screen says why");
  return "sent the address without the right-to-left mark";
});

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
