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

// ---------------------------------------------------------------------------------------------
// A parent linking their own child. Any parent, any child — none of them could.
//
// The screen said "Omar Abu Rezeq can't be linked automatically — there's no date of birth on
// file", with the box reading "Not available", about a boy whose date is 28/05/2008 and has been
// on the admin screen the whole time. It compared the typed date against sw.dob in the browser,
// and a parent registering is not signed in — so every table holding a date is closed to them,
// and the roster the page has is the one that ships inside it: names, squads, ages, no dates.
//
// This one opens the app the way a parent does: signed out, from the login screen.
// ---------------------------------------------------------------------------------------------
scene("a parent can link their own child", async (browser) => {
  const page = await (await browser.newContext({ viewport: { width: 430, height: 900 } })).newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(String(e.message)));
  await page.route("**/rest/v1/**", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  // The club's side of it. The date never reaches the page — the whole point — so the route
  // answers yes or no and nothing else.
  let asked = null;
  await page.route("**/api/family/verify-child", (r) => {
    asked = JSON.parse(r.request().postData() || "{}");
    return r.fulfill({ status: 200, contentType: "application/json",
                       body: JSON.stringify(asked.dob === "28/05/2008" ? { ok: true } : { ok: false, left: 4 }) });
  });
  await page.addInitScript(() => localStorage.clear());
  await page.goto("http://127.0.0.1:" + PORT + "/proto.html?drive=" + Date.now(), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);

  await tap(page, "Parent or swimmer?");
  await page.waitForTimeout(700);
  await tap(page, "Register");
  await page.waitForTimeout(700);

  const searched = await page.evaluate(() => {
    const i = [...document.querySelectorAll("input")].find((e) => e.offsetParent && /child/i.test(e.placeholder || ""));
    if (!i) return false;
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    set.call(i, "Omar");
    i.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  });
  if (!searched) throw new Error("the register screen had no box to search for a child in");
  await page.waitForTimeout(800);

  const picked = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((e) => e.offsetParent && /Omar/.test(e.innerText || ""));
    if (!b) return null;
    b.click();
    return (b.innerText || "").split("\n")[0];
  });
  if (!picked) throw new Error("searching for a child found nobody");
  await page.waitForTimeout(800);

  // What the parent is actually shown. This is the assertion the old behaviour fails.
  const panel = await page.evaluate(() => {
    const t = document.body.innerText || "";
    const i = [...document.querySelectorAll("input")]
      .find((e) => e.offsetParent && /dd\/mm|Not available/i.test(e.placeholder || ""));
    return { refused: /can.t be linked automatically/.test(t), placeholder: i ? i.placeholder : "(no date box)" };
  });
  eq(panel.refused, false, "every parent was told their child could not be linked, before typing anything");
  eq(panel.placeholder, "dd/mm/yyyy", "the box read " + JSON.stringify(panel.placeholder));

  await page.evaluate(() => {
    const i = [...document.querySelectorAll("input")].find((e) => e.offsetParent && /dd\/mm/i.test(e.placeholder || ""));
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    set.call(i, "28/05/2008");
    i.dispatchEvent(new Event("input", { bubbles: true }));
    const btn = [...document.querySelectorAll("button")].find((e) => e.offsetParent && /Confirm/i.test(e.innerText || ""));
    if (btn) setTimeout(() => btn.click(), 200);
  });
  await page.waitForTimeout(1800);

  if (!asked) throw new Error("the date was checked somewhere other than the club's records");
  eq(asked.dob, "28/05/2008", "what was sent to be checked was " + JSON.stringify(asked.dob));
  eq(/^[^:]+::.+/.test(String(asked.swimmerId || "")), true,
     "the child has to be named by squad and id: " + JSON.stringify(asked.swimmerId));
  eq(problems.length, 0, "the register screen threw: " + problems.slice(0, 2).join(" | "));
  await page.close();
  return "picked " + JSON.stringify(picked) + ", asked the club about " + asked.swimmerId;
});

// ---------------------------------------------------------------------------------------------
// "111 present · 191 absent · 0 late — 37% club attendance", on a morning when no coach had
// marked anybody. 191 of this club's swimmers are away for the summer and back in September;
// they are not absent from today's session, because there was no session to be absent from.
//
// Two scenes in one: the day nobody registered, and the same day after one squad's register is
// taken. The second is what proves the first is not simply showing zeroes for everything.
// ---------------------------------------------------------------------------------------------
scene("a day nobody registered is not reported as attendance", async (browser) => {
  // Two swimmers away for the summer, exactly as the club has them: a Break that started weeks
  // ago with no end date. Their status is true; it is not an absence from a register.
  const away = { r131: { active: false, reason: "break", from: "2026-07-22", to: "" },
                 r132: { active: false, reason: "break", from: "2026-07-22", to: "" } };
  const page = await openLive(browser, { vx_sw_status: away, vx_attend_log: {} });

  await tap(page, "Tools & AI");           // the tile lives here, not on the hub
  await tap(page, "Daily Attendance");
  await page.waitForTimeout(1400);

  const read = () => page.evaluate(() => {
    const t = (document.body.innerText || "").replace(/\s+/g, " ");
    const pct = (t.match(/(\d+%|—)\s*club attendance/i) || [])[1] || "(none)";
    return { pct, t };
  });

  const before = await read();
  eq(/No register taken/i.test(before.t), true,
     "the screen must say nobody has registered: " + before.t.slice(0, 160));
  eq(before.pct, "—", "it reported " + before.pct + " club attendance for a day with no register");
  eq(/\d+ present · \d+ absent/.test(before.t), false,
     "it counted swimmers present and absent on a day nobody marked");
  // And a squad's own line has to say which of the two it is — "0/22 present" and "nobody has
  // taken this register" look identical and mean opposite things.
  eq(/Register not taken/i.test(before.t), true);

  return "no register: " + JSON.stringify(before.pct) + ", and it says so in words";
});

scene("a register that WAS taken is still reported", async (browser) => {
  // One squad marked, the rest not. The club figure has to cover the squad that was registered
  // and say so, rather than dividing by the whole club.
  const log = { junior: { [new Date().toISOString().slice(0, 10)]: { r131: "present", r132: "absent" } } };
  const page = await openLive(browser, { vx_attend_log: log, vx_sw_status: {} });

  await tap(page, "Tools & AI");
  await tap(page, "Daily Attendance");
  await page.waitForTimeout(1400);

  const t = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " "));
  eq(/squads registered/i.test(t), true,
     "the club line must say how much of the club this covers: " + t.slice(0, 200));
  eq(/(\d+)%\s*club attendance/i.test(t), true,
     "a squad WAS registered, so there is a real figure — screen said: " + t.slice(0, 260));
  eq(/No register taken yet/i.test(t), false, "it said nobody had registered when somebody had");
  return "one squad registered, and the figure says so";
});

// ---------------------------------------------------------------------------------------------
// "I set him to Active and it did not save."
//
// On a clean machine it does: the change is written, pushed, and survives a reload — I drove
// exactly that and could not make it fail. What was missing is the app saying so. Every other
// write here that can fail says so; this one was mute, and a refused write and a saved one
// looked identical, so there was nothing to tell us which had happened.
//
// Both answers are driven from what the database actually said, so this scene runs it twice.
// ---------------------------------------------------------------------------------------------
async function statusScreen(browser, { refuse, session }) {
  const away = { r131: { active: false, reason: "break", from: "2026-07-22", to: "" } };
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(String(e.message)));
  let row = { key: "vx_sw_status", value: away, updated_at: new Date(Date.now() - 3600000).toISOString() };
  await page.route("**/rest/v1/**", (r) => {
    const req = r.request(), m = req.method();
    const table = (new URL(req.url()).pathname.split("/rest/v1/")[1] || "").split("?")[0];
    if (table === "club_state" && m === "GET")
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([row]) });
    if (table === "club_state" && m === "POST") {
      if (refuse) return r.fulfill({ status: 403, contentType: "application/json",
                                     body: JSON.stringify({ message: "new row violates row-level security policy" }) });
      try {
        for (const w of JSON.parse(req.postData() || "[]"))
          if (w.key === "vx_sw_status") row = { key: w.key, value: w.value, updated_at: new Date().toISOString() };
      } catch { /* the assertion below is what catches this */ }
      return r.fulfill({ status: 201, contentType: "application/json", body: "[]" });
    }
    return r.fulfill({ status: m === "GET" ? 200 : 201, contentType: "application/json", body: "[]" });
  });
  await page.addInitScript((c) => {
    localStorage.setItem("vx_session", JSON.stringify({ type: "staff", id: "ahmed" }));
    // "gone" is the state this club was actually in: signed into the app, with the database
    // session finished underneath it. The app looks exactly the same.
    if (c.session === "gone") localStorage.removeItem("vx_auth");
    else localStorage.setItem("vx_auth", JSON.stringify({ token: "drive-fake", refresh: "drive-fake", exp: Date.now() + 3600000 }));
    localStorage.removeItem("vx_nav");
    localStorage.removeItem("vx_failed_writes");
    localStorage.setItem("vx_sw_status", JSON.stringify(c.away));
  }, { away, session });
  await page.goto("http://127.0.0.1:" + PORT + "/proto.html?drive=" + Date.now(), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
  await tap(page, "Club Administration");
  await tap(page, "Roster · add / edit");
  await page.waitForTimeout(1100);
  // The swimmer who is actually away, found by the badge rather than by being first in the list.
  const opened = await page.evaluate(() => {
    const badge = [...document.querySelectorAll("*")]
      .find((e) => e.offsetParent && e.children.length === 0 && /ON BREAK/i.test(e.textContent || ""));
    let c = badge;
    for (let i = 0; i < 8 && c; i++) {
      const p = [...c.querySelectorAll("button")].find((b) => b.querySelector('[data-lucide="pencil"],svg.lucide-pencil'));
      if (p) { p.click(); return true; }
      c = c.parentElement;
    }
    return false;
  });
  if (!opened) throw new Error("no swimmer on the roster is showing as away");
  await page.waitForTimeout(900);
  const line = (re) => page.evaluate((r) => {
    const t = (document.body.innerText || "").split("\n");
    return t.find((l) => new RegExp(r, "i").test(l)) || "";
  }, re.source);
  const runsTo = await line(/back in the register|No end date/);
  await page.evaluate(() => {
    const all = [...document.querySelectorAll("button")].filter((e) => e.offsetParent && (e.innerText || "").trim() === "Active");
    const chip = all.find((b) => {
      const p = b.parentElement; if (!p) return false;
      const sib = [...p.querySelectorAll("button")].map((x) => (x.innerText || "").trim());
      return sib.includes("Break") && sib.includes("Injured");
    });
    if (chip) chip.click();
  });
  await page.waitForTimeout(2400);
  const said = await line(/saved|Saving/);
  await page.close();
  return { runsTo, said, problems, server: JSON.stringify(row.value) };
}

scene("changing a swimmer's status says whether the database took it", async (browser) => {
  const ok = await statusScreen(browser, { refuse: false });
  eq(ok.problems.length, 0, "the roster threw: " + ok.problems.slice(0, 2).join(" | "));
  // An open-ended break is what 191 of this club's swimmers are on, and the screen said nothing
  // about it meaning "away every day from now on".
  eq(/No end date/i.test(ok.runsTo), true, "it said: " + JSON.stringify(ok.runsTo));
  eq(/✓ saved/.test(ok.said), true, "after a successful write the screen said: " + JSON.stringify(ok.said));
  eq(ok.server, "{}", "the change did not reach the database: " + ok.server);
  return "said " + JSON.stringify(ok.said) + ", and the database has " + ok.server;
});

scene("a status that never left the phone is not reported as saved", async (browser) => {
  // The club's whole day, in one click. Signed into the app, no database session underneath,
  // a coach taps Active and reads "Active \u2713 saved" \u2014 because the code that answers that
  // question read window.__vxLastPush and treated "no entry" as a yes. There was no entry
  // because the write had returned before it ever recorded one: it was never sent.
  const gone = await statusScreen(browser, { refuse: false, session: "gone" });
  eq(gone.problems.length, 0, "the roster threw: " + gone.problems.slice(0, 2).join(" | "));
  eq(/\u2713 saved/.test(gone.said), false,
     "with no database session at all, the screen said: " + JSON.stringify(gone.said));
  eq(/NOT saved/.test(gone.said), true, "it said: " + JSON.stringify(gone.said));
  eq(/It is on this device only/.test(gone.said), true,
     "it has to say where the change actually is: " + JSON.stringify(gone.said));
  eq(/Sign out and back in/.test(gone.said), true,
     "and what to do about it, which is not the same as what went wrong: " + JSON.stringify(gone.said));
  eq(gone.server, JSON.stringify({ r131: { active: false, reason: "break", from: "2026-07-22", to: "" } }),
     "something reached the database with no session: " + gone.server);

  return "said " + JSON.stringify(gone.said.slice(0, 58));
});

scene("a status the database refuses is not reported as saved", async (browser) => {
  const no = await statusScreen(browser, { refuse: true });
  eq(no.problems.length, 0, "the roster threw: " + no.problems.slice(0, 2).join(" | "));
  eq(/NOT saved/.test(no.said), true, "a refused write reported: " + JSON.stringify(no.said));
  eq(/this device only/.test(no.said), true, "it has to say where the change actually is");
  eq(/✓ saved/.test(no.said), false, "a refused write must never read as saved");
  return "refused, and said so: " + JSON.stringify(no.said.slice(0, 60));
});

// ---------------------------------------------------------------------------------------------
// "The app is not saving anything since yesterday."
//
// It was not, and the reason it took a day to find is that the app had no opinion about it. A
// write it could not send was filed as "not sent yet", and "not sent yet" was excluded from the
// count on the banner — with no clock on the exclusion. So the count read zero, the screen showed
// a tick, and a club's registers and roster edits sat on phones for a working day.
//
// Two faults, one scene each.
//
//   1. Nothing in the write path ever asked for a new token. The gate that holds a write back
//      when the session is stale returned false and did nothing else; the only code that noticed
//      a stale token and refreshed it was in building the request headers, which that gate runs
//      before. Reads went on healing the session as a side effect of their own headers, which is
//      why this was survivable at all — but a device doing nothing except saving had no route to
//      a new token from anything it was doing.
//
//   2. Ninety seconds of forgiveness is right. A whole morning of it is not.
// ---------------------------------------------------------------------------------------------

// A signed-in app, its database replaced by a recorder, and an auth server that keeps count.
async function authScene(browser, { refresh }) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  const problems = [], writes = [], refreshes = [];
  page.on("pageerror", (e) => problems.push(String(e.message)));
  await page.route("**/auth/v1/token**", async (route) => {
    refreshes.push(Date.now());
    if (refresh === "refused")
      return route.fulfill({ status: 400, contentType: "application/json",
        body: JSON.stringify({ error: "invalid_grant", error_description: "Refresh Token Not Found" }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      access_token: "fresh-token", refresh_token: "fresh-refresh", expires_in: 3600,
      user: { id: "u1", email: "a@b.c" } }) });
  });
  await page.route("**/rest/v1/**", async (route) => {
    const req = route.request(), m = req.method();
    const table = (new URL(req.url()).pathname.split("/rest/v1/")[1] || "").split("?")[0];
    if (m !== "GET" && m !== "HEAD") {
      const auth = (await req.allHeaders())["authorization"] || "";
      let keys = [];
      try {
        const body = JSON.parse(req.postData() || "[]");
        keys = (Array.isArray(body) ? body : [body]).map((r) => r && r.key).filter(Boolean);
      } catch { /* the assertions read keys, so an unparseable body fails them */ }
      writes.push({ table, keys, token: auth.replace("Bearer ", "").slice(0, 12) });
    }
    return route.fulfill({ status: m === "GET" ? 200 : 201, contentType: "application/json", body: "[]" });
  });
  await page.addInitScript((expired) => {
    localStorage.setItem("vx_session", JSON.stringify({ type: "staff", id: "ahmed" }));
    localStorage.setItem("vx_auth", JSON.stringify({ token: "stale-token", refresh: "stale-refresh",
      exp: expired ? Date.now() - 3600000 : Date.now() + 3600000, uid: "u1", email: "a@b.c" }));
    localStorage.removeItem("vx_nav");
    localStorage.removeItem("vx_failed_writes");
  }, refresh === "refused");
  await page.goto("http://127.0.0.1:" + PORT + "/proto.html?drive=" + Date.now(), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  page.problems = problems;
  page.writes = writes;
  page.refreshes = refreshes;
  return page;
}

scene("a save is what refreshes a token that went stale while nothing was happening", async (browser) => {
  const page = await authScene(browser, { refresh: "works" });
  // The token expires with the app already open and idle — a phone asleep in a bag, a laptop
  // shut between sessions. Everything that happens from here is caused by the save and by
  // nothing else: the app's own 20-second poll is not due for another seventeen.
  const beforeRefreshes = page.refreshes.length;
  const beforeWrites = page.writes.length;
  await page.evaluate(() => { if (window.__VX_AUTH) window.__VX_AUTH.exp = Date.now() - 1000; });
  const at = Date.now();
  await page.evaluate(() => window.__vxpush("vx_squads", JSON.stringify({ drive: 1 })));
  await page.waitForTimeout(4000);
  const asked = page.refreshes.slice(beforeRefreshes);
  const landed = page.writes.slice(beforeWrites).filter((w) => w.keys.includes("vx_squads"));
  eq(page.problems.length, 0, "the app threw: " + page.problems.slice(0, 2).join(" | "));
  eq(asked.length > 0, true, "the save found the session stale and asked for nothing — it just waited");
  // How long the save waited before anything was done about the session it needs. The assertion
  // is on the clock rather than on the fact, and that is the honest shape of this fix.
  //
  // Without it the refresh still eventually happened: the next unrelated READ built its own
  // headers, and building headers is what noticed the stale token. Measured here that took 2.1
  // seconds, and only because a poll happened to be due. On a screen with no polling read behind
  // it the wait is the 45-second sweep, and a coach marking a register in that window watches
  // nothing happen at all. A save must not depend on some other part of the app going first.
  const waited = asked[0] - at;
  eq(waited < 1200, true, "the save waited " + waited + "ms for something else to refresh the session");
  eq(landed.length > 0, true, "the change never reached the database; it is still on the phone");
  eq(landed[0].token, "fresh-token", "it went out carrying " + JSON.stringify(landed[0].token)
     + ", which is not the refreshed session");
  await page.close();
  return "asked for a new token " + waited + "ms in, and sent itself with it";
});

scene("a session that cannot be refreshed is counted, not hidden", async (browser) => {
  const page = await authScene(browser, { refresh: "refused" });
  await page.evaluate(() => window.__vxpush("vx_sw_status", JSON.stringify({ r1: { active: true } })));
  await page.waitForTimeout(1500);
  const mine = (q) => q.filter((x) => String(x.table || "").includes("vx_sw_status"));
  const fresh = await page.evaluate(() => ({
    queue: window.__vxFailed() || [], counted: window.__vxFailedCount(), dead: !!window.__vxAuthDead }));
  eq(mine(fresh.queue).length, 1, "the change was not kept anywhere: " + JSON.stringify(fresh.queue.map(x => x.table)));
  eq(mine(fresh.queue)[0].status, -1, "it was recorded as a failure rather than as never sent");
  // Inside the grace period this is right and must stay right. A write made in the second after
  // a sign-in is queued while the token lands, and "1 change has not been saved" in front of
  // somebody who has just signed in successfully is the lie this exclusion exists to prevent.
  eq(fresh.counted, 0, "a write one second old was already being called unsaved work");
  eq(fresh.dead, true, "a refused refresh was not recognised as the session being finished");
  // Now the same queue, ten minutes on. Nothing else has changed — same writes, same session.
  const later = await page.evaluate(() => {
    const q = JSON.parse(localStorage.getItem("vx_failed_writes") || "[]");
    // since is when the write first found itself stranded; ts is the last attempt. Ageing both
    // is what "this has been sitting here for ten minutes" actually looks like on disk.
    q.forEach((x) => { x.ts = Date.now() - 600000; x.since = Date.now() - 600000; });
    localStorage.setItem("vx_failed_writes", JSON.stringify(q));
    return { counted: window.__vxFailedCount(), queued: q.length, why: window.__vxWhyNotSaving() };
  });
  eq(later.counted, later.queued,
     "ten minutes on, " + (later.queued - later.counted) + " of " + later.queued
     + " changes were still being filed as if the sign-in were about to land");
  eq(later.why.signedInToDatabase, false, "it reported a live database sign-in: " + JSON.stringify(later.why));
  eq(later.why.waitingToBeSent >= 1, true, "it did not report the waiting changes: " + JSON.stringify(later.why));
  eq(later.why.oldestWaitingMinutes, 10, "it did not say how long they had been waiting: "
     + JSON.stringify(later.why.oldestWaitingMinutes));
  eq(/NOT saving/.test(later.why.verdict), true, "asked outright, it said: " + JSON.stringify(later.why.verdict));
  // And the clock does not restart every time the same thing is saved again.
  //
  // Writes to one row collapse into the later one, which is right for the data and was wrong for
  // the clock: a coach marking a register writes the same key over and over, and the app's own
  // 20-second sweep re-pushes it besides. Each of those used to replace the entry with a
  // brand-new timestamp, so a change stranded since breakfast read as one second old all
  // morning and the grace period never once elapsed.
  const again = await page.evaluate(async () => {
    await window.__vxpush("vx_sw_status", JSON.stringify({ r1: { active: true }, r2: { active: false } }));
    return { counted: window.__vxFailedCount(), minutes: window.__vxWhyNotSaving().oldestWaitingMinutes };
  });
  eq(again.minutes, 10, "saving again reset how long it had been waiting, to " + again.minutes + " minutes");
  eq(again.counted, later.counted, "saving again took " + (later.counted - again.counted)
     + " stranded changes back off the count");
  eq(page.problems.length, 0, "the app threw: " + page.problems.slice(0, 2).join(" | "));
  await page.close();
  return "counted after the grace period: " + JSON.stringify(later.why.verdict.slice(0, 64));
});

// ---------------------------------------------------------------------------------------------
// "It is back to 317 and 123 dates of birth missing again."
//
// Both places that take the database's copy of a shared record decide it the same way, and both
// have the same hole: when this device has no __vxts_ marker for that key — the ordinary state of
// a device that has not itself edited it since the marker was written — localTs is 0, and the
// server's copy is taken whether it is newer or older. The copy it lands on is gone.
//
// The database being the truth is right. Overwriting a club's roster in the background with
// nothing kept and nothing said is not. This is the net: whatever a pull replaces is held, and
// one line puts it back.
// ---------------------------------------------------------------------------------------------
scene("a pull that replaces the roster keeps what it replaced", async (browser) => {
  // 304 swimmers with their dates of birth on the device; the older, wrong 317 on the server.
  const good = {}, bad = {};
  for (let i = 1; i <= 304; i++) good["r" + i] = { name: "S" + i, dob: "2012-01-01" };
  for (let i = 1; i <= 317; i++) bad["r" + i] = { name: "S" + i };
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  const problems = [], sent = [];
  page.on("pageerror", (e) => problems.push(String(e.message)));
  await page.route("**/rest/v1/**", async (route) => {
    const req = route.request(), m = req.method();
    const table = (new URL(req.url()).pathname.split("/rest/v1/")[1] || "").split("?")[0];
    if (table === "club_state" && m === "GET")
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(
        [{ key: "vx_roster_edits", value: bad, updated_at: new Date().toISOString() }]) });
    if (m !== "GET" && m !== "HEAD") {
      try {
        for (const w of JSON.parse(req.postData() || "[]"))
          if (w && w.key === "vx_roster_edits") sent.push(Object.keys(w.value || {}).length);
      } catch { /* the assertions read sent, so an unparseable body fails them */ }
    }
    return route.fulfill({ status: m === "GET" ? 200 : 201, contentType: "application/json", body: "[]" });
  });
  await page.addInitScript((g) => {
    localStorage.setItem("vx_session", JSON.stringify({ type: "staff", id: "ahmed" }));
    localStorage.setItem("vx_auth", JSON.stringify({ token: "drive-fake", refresh: "drive-fake", exp: Date.now() + 3600000 }));
    localStorage.removeItem("vx_nav");
    localStorage.setItem("vx_roster_edits", JSON.stringify(g));
    // No __vxts_ marker — which is exactly the state the hole lives in, and the ordinary state
    // of a device that has not edited this key since the marker was last written.
    localStorage.removeItem("__vxts_vx_roster_edits");
  }, good);
  await page.goto("http://127.0.0.1:" + PORT + "/proto.html?drive=" + Date.now(), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const after = await page.evaluate(() => ({
    onDevice: Object.keys(JSON.parse(localStorage.getItem("vx_roster_edits") || "{}")).length,
    held: window.__vxReplaced(),
  }));
  eq(problems.length, 0, "the app threw: " + problems.slice(0, 2).join(" | "));
  // The pull still wins — that is the design and this scene is not changing it.
  eq(after.onDevice, 317, "the server's copy did not land, so this scene is testing nothing");
  const roster = after.held.filter((h) => h.key === "vx_roster_edits")[0];
  eq(!!roster, true, "the 304 the device had were overwritten and nothing was kept: "
     + JSON.stringify(after.held.map((h) => h.key)));
  eq(roster.entriesInTheKeptCopy, 304, "what was kept is not the copy that was replaced: " + JSON.stringify(roster));
  // And one line puts it back — on the device and in the database, because a restore that only
  // fixes the phone is undone by the next sweep.
  const back = await page.evaluate(() => window.__vxRestore("vx_roster_edits"));
  await page.waitForTimeout(800);
  const now = await page.evaluate(() =>
    Object.keys(JSON.parse(localStorage.getItem("vx_roster_edits") || "{}")).length);
  eq(back.ok, true, "the restore reported: " + JSON.stringify(back));
  eq(now, 304, "after restoring, the device holds " + now);
  eq(sent.includes(304), true, "the restored roster never went to the database, so the next pull takes it away again");
  await page.close();
  return "kept the 304 it replaced, and put them back in the database";
});

// ---------------------------------------------------------------------------------------------
// An empty roster overlay never leaves the device, and the screen says so.
//
// 317 swimmers with 123 dates of birth missing is not an old copy of the club's overlay. It is
// the app showing the BASE list because the overlay is empty — nothing deleted, no dates, no
// edits. An empty overlay reaches the database like this: _loadJSON hands back its fallback,
// {edits:{},deleted:{},added:{}}, whenever the record cannot be read on this device, and the very
// next roster action saves that fallback over the club's. One phone having a bad moment, and
// every device loses the roster on its next pull.
//
// Three things have to hold, and this drives all three at once.
// ---------------------------------------------------------------------------------------------
scene("an empty roster overlay is not sent, and the screen stops pretending", async (browser) => {
  // What the club actually has: 300 swimmers' worth of edits and dates of birth.
  const real = { edits: {}, deleted: { r400: 1, r401: 1 }, added: {} };
  for (let i = 1; i <= 300; i++) real.edits["r" + i] = { dob: "2012-03-0" + (i % 9), name: "Swimmer " + i };
  const realJson = JSON.stringify(real);
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  const problems = [], sentRoster = [];
  page.on("pageerror", (e) => problems.push(String(e.message)));
  await page.route("**/rest/v1/**", async (route) => {
    const req = route.request(), m = req.method();
    const table = (new URL(req.url()).pathname.split("/rest/v1/")[1] || "").split("?")[0];
    if (table === "club_state" && m === "GET")
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(
        [{ key: "vx_roster_edits", value: real, updated_at: new Date().toISOString() }]) });
    if (m !== "GET" && m !== "HEAD") {
      try {
        for (const w of JSON.parse(req.postData() || "[]"))
          if (w && w.key === "vx_roster_edits") sentRoster.push(JSON.stringify(w.value).length);
      } catch { /* the assertions read sentRoster, so an unparseable body fails them */ }
    }
    return route.fulfill({ status: m === "GET" ? 200 : 201, contentType: "application/json", body: "[]" });
  });
  await page.addInitScript(() => {
    localStorage.setItem("vx_session", JSON.stringify({ type: "staff", id: "ahmed" }));
    localStorage.setItem("vx_auth", JSON.stringify({ token: "drive-fake", refresh: "drive-fake", exp: Date.now() + 3600000 }));
    localStorage.removeItem("vx_nav");
  });
  await page.goto("http://127.0.0.1:" + PORT + "/proto.html?drive=" + Date.now(), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2600);
  // The device loses its copy — a full storage, an evicted key, a Reset, a truncated write. Which
  // one does not matter, and that is the point: the rule below does not need to know.
  await page.evaluate(() => {
    localStorage.removeItem("vx_roster_edits");
    localStorage.removeItem("__vxprev_vx_roster_edits");
    try { delete window.__VX_PULLED["vx_roster_edits"]; } catch { /* mirror may be absent */ }
  });
  const before = sentRoster.length;
  // 1. The empty overlay does not leave the device, whatever asks it to.
  const refusal = await page.evaluate(() =>
    window.__vxpush("vx_roster_edits", JSON.stringify({ edits: {}, deleted: {}, added: {} })));
  await page.waitForTimeout(1200);
  const sentAfter = sentRoster.slice(before);
  eq(problems.length, 0, "the app threw: " + problems.slice(0, 2).join(" | "));
  eq(sentAfter.length, 0, "an empty overlay was sent to the database: " + JSON.stringify(sentAfter));
  eq(refusal.collapsed, true, "it was not recognised as a record collapsing: " + JSON.stringify(refusal));
  eq(/it is empty/.test(refusal.why || ""), true,
     "it did not say what it was refusing: " + JSON.stringify(refusal.why));
  eq(/Nothing in the database has changed/.test(refusal.why || ""), true,
     "a refusal has to say the club's data is untouched, or it reads as the loss it just prevented");
  // 2. The screen says the list it is showing is the raw one, rather than reading as normal.
  const said = await page.evaluate(() => {
    const el = [...document.querySelectorAll("*")].find(
      (e) => e.children.length === 0 && /Club Administration/i.test(e.textContent || ""));
    if (el) { let n = el; for (let i = 0; i < 8 && n; i++) { if (n.onclick) { n.click(); break; } n = n.parentElement; } }
    return true;
  });
  eq(said, true, "the hub never rendered");
  await page.waitForTimeout(700);
  await tap(page, "Roster · add / edit");
  await page.waitForTimeout(900);
  const text = await page.evaluate(() => document.body.innerText || "");
  eq(/showing the raw list/i.test(text), true,
     "the roster screen read as normal while the overlay was missing");
  await page.close();
  // _loadJSON recovering from the kept copy is the third part of this fix. It is checked in the
  // unit suite rather than here: no app instance is reachable from the page, so the assertion that
  // used to sit at this point could not run and quietly passed by doing nothing.
  return "refused the empty overlay, and the screen named it";
});

// ---------------------------------------------------------------------------------------------
// "Mary took Monday's register and it did not save."
//
// She did take it. Her laptop showed 75 present for Monday 17 August; every other device showed 1,
// for the same club on the same day. Nothing on either screen said anything was wrong.
//
// setAttendStatus fired the write and forgot it. __vxUpsert hands back whether the row reached
// the database and nobody read the answer, so a register taken with no live session went green
// tap by tap, forty times, and stayed on that one laptop.
//
// A message per tap would be noise on a forty-swimmer register. What the register needs is the
// total, and a way to send them.
// ---------------------------------------------------------------------------------------------
scene("a register the database did not take says so, and can be sent again", async (browser) => {
  let accept = false;                       // the database is refusing when Mary takes it
  const landed = [];
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(String(e.message)));
  await page.route("**/rest/v1/**", async (route) => {
    const req = route.request(), m = req.method();
    const table = (new URL(req.url()).pathname.split("/rest/v1/")[1] || "").split("?")[0];
    if (table === "attendance_marks" && m !== "GET" && m !== "HEAD") {
      if (!accept)
        return route.fulfill({ status: 403, contentType: "application/json",
          body: JSON.stringify({ message: "new row violates row-level security policy" }) });
      try { for (const r of JSON.parse(req.postData() || "[]")) landed.push(r.sw_id); }
      catch { /* the assertions read landed, so an unparseable body fails them */ }
      return route.fulfill({ status: 201, contentType: "application/json", body: "[]" });
    }
    return route.fulfill({ status: m === "GET" ? 200 : 201, contentType: "application/json", body: "[]" });
  });
  await page.addInitScript(() => {
    localStorage.setItem("vx_session", JSON.stringify({ type: "staff", id: "ahmed" }));
    localStorage.setItem("vx_auth", JSON.stringify({ token: "drive-fake", refresh: "drive-fake", exp: Date.now() + 3600000 }));
    localStorage.removeItem("vx_nav");
    localStorage.removeItem("vx_attend_unsent");
    localStorage.removeItem("vx_attend_log");
  });
  await page.goto("http://127.0.0.1:" + PORT + "/proto.html?drive=" + Date.now(), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
  await tap(page, "Tools & AI");
  await tap(page, "Daily Attendance");
  await tap(page, "Pre-Team");
  await tap(page, "Take / edit this squad");
  // Three swimmers marked, exactly as a coach does it, into a database that is refusing.
  for (let i = 0; i < 3; i++) {
    const hit = await page.evaluate((n) => {
      const btns = [...document.querySelectorAll("button,[onclick]")]
        .filter((e) => e.offsetParent && /^(present|absent|late|not taken)$/i.test((e.innerText || "").trim()));
      if (!btns[n]) return false;
      btns[n].click();
      return true;
    }, i);
    if (!hit) throw new Error("the register ran out of swimmers to mark at " + i);
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1600);
  const warned = await page.evaluate(() => document.body.innerText || "");
  eq(problems.length, 0, "the app threw: " + problems.slice(0, 2).join(" | "));
  eq(/have not reached the database|has not reached the database/i.test(warned), true,
     "the register said nothing about marks the database refused");
  eq(landed.length, 0, "the database was refusing, so nothing should have landed: " + JSON.stringify(landed));
  // The register is still on the device, and the button sends it — now that the database will take it.
  accept = true;
  const pressed = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (e) => e.offsetParent && /send these to the database|send this register again/i.test(e.innerText || ""));
    if (!b) return false;
    b.click();
    return true;
  });
  eq(pressed, true, "there was no way to send them — the marks are stranded with no action offered");
  await page.waitForTimeout(2000);
  const after = await page.evaluate(() => ({
    text: document.body.innerText || "",
    unsent: JSON.parse(localStorage.getItem("vx_attend_unsent") || "{}"),
  }));
  // On the unique swimmers, not the number of rows. The retry queue replays the refused writes
  // once the database starts accepting, so the same mark can arrive twice — which is exactly what
  // every row being keyed squad_day_swimmer and written as an upsert is for. Two arrivals of one
  // mark is not a fault; a swimmer missing is.
  eq(new Set(landed).size, 3,
     "sending again reached the database with " + new Set(landed).size + " of 3 swimmers: " + JSON.stringify(landed));
  eq(/sent/i.test(after.text), true, "it did not say the register had gone: " + JSON.stringify(after.text.slice(0, 120)));
  eq(Object.keys(after.unsent).length, 0,
     "marks that reached the database are still recorded as stranded: " + JSON.stringify(after.unsent));
  await page.close();
  return "warned about 3 stranded marks, then sent all 3";
});

// ---------------------------------------------------------------------------------------------
// "We cannot add swimmers any more — after a refresh it is gone."
//
// That was mine. The first version of the collapse guard refused any write under 40% of what the
// database held, on the reasoning that a record does not lose most of itself by somebody tapping
// a button. True, and irrelevant: devices legitimately hold overlays of very different sizes —
// one screen read 302 swimmers while another read 310, the same afternoon — and a device holding
// the smaller one had EVERY roster save refused. The database never changed, so the next refresh
// took the server's copy and the swimmer that had just been added disappeared.
//
// A ratio was never the right test. The fault being guarded is a record becoming EMPTY, not a
// record becoming smaller. So this drives the case my rule broke: a device whose overlay is a
// fraction of the server's adds a swimmer, and it has to reach the database.
// ---------------------------------------------------------------------------------------------
scene("a device holding a smaller roster than the database can still add a swimmer", async (browser) => {
  // The database holds a big overlay; this device holds a small one. Both are real states.
  const big = { edits: {}, deleted: {}, added: {} };
  for (let i = 1; i <= 300; i++) big.edits["r" + i] = { dob: "2012-04-05", name: "Swimmer " + i, squad: "junior" };
  const small = { edits: { r1: { dob: "2012-04-05", name: "Swimmer 1", squad: "junior" } }, deleted: {}, added: {} };
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  const problems = [], pushes = [];
  page.on("pageerror", (e) => problems.push(String(e.message)));
  await page.route("**/rest/v1/**", async (route) => {
    const req = route.request(), m = req.method();
    const table = (new URL(req.url()).pathname.split("/rest/v1/")[1] || "").split("?")[0];
    if (table === "club_state" && m === "GET")
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(
        [{ key: "vx_roster_edits", value: big, updated_at: new Date(Date.now() - 7200000).toISOString() }]) });
    if (m !== "GET" && m !== "HEAD") {
      try {
        for (const w of JSON.parse(req.postData() || "[]"))
          if (w && w.key === "vx_roster_edits") pushes.push(JSON.stringify(w.value).length);
      } catch { /* the assertions read pushes, so an unparseable body fails them */ }
    }
    return route.fulfill({ status: m === "GET" ? 200 : 201, contentType: "application/json", body: "[]" });
  });
  await page.addInitScript((sm) => {
    localStorage.setItem("vx_session", JSON.stringify({ type: "staff", id: "ahmed" }));
    localStorage.setItem("vx_auth", JSON.stringify({ token: "drive-fake", refresh: "drive-fake", exp: Date.now() + 3600000 }));
    localStorage.removeItem("vx_nav");
    localStorage.setItem("vx_roster_edits", JSON.stringify(sm));
    // Written more recently than the server's copy, so this device keeps its own — which is the
    // state that made every later save unsendable.
    localStorage.setItem("__vxts_vx_roster_edits", String(Date.now()));
  }, small);
  await page.goto("http://127.0.0.1:" + PORT + "/proto.html?drive=" + Date.now(), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2600);
  // The device was seeded holding far less than the database — the exact shape my rule refused.
  // It may not still be: sending the roster is a merge now, so a stale device heals itself on the
  // first write. What has to stay true is the fixture, and that the add reaches the database.
  const ratio = await page.evaluate(() => ({
    seen: parseInt(localStorage.getItem("__vxsize_vx_roster_edits") || "0", 10) || 0,
    here: (localStorage.getItem("vx_roster_edits") || "").length,
  }));
  eq(ratio.seen > 2048, true, "the database copy was not big enough for this scene to mean anything: " + JSON.stringify(ratio));
  eq(JSON.stringify(small).length < JSON.stringify(big).length * 0.4, true,
     "the fixture is not the smaller-copy case this scene exists for");
  const before = pushes.length;
  // Add a swimmer, through the sync layer the Add form goes through.
  const res = await page.evaluate(() => {
    const cur = JSON.parse(localStorage.getItem("vx_roster_edits") || "{}");
    cur.added = cur.added || {};
    cur.added.newkid = { name: "Nour Hassan", dob: "2015-06-01", squad: "junior" };
    return window.__vxpush("vx_roster_edits", JSON.stringify(cur));
  });
  await page.waitForTimeout(1500);
  eq(problems.length, 0, "the app threw: " + problems.slice(0, 2).join(" | "));
  eq(!res.collapsed, true, "adding a swimmer was refused as a collapse: " + JSON.stringify(res.why || ""));
  eq(pushes.length > before, true,
     "the new swimmer never reached the database, so a refresh takes them away again");
  // And the empty overlay is still refused — narrowing the rule must not switch it off.
  const empty = await page.evaluate(() =>
    window.__vxpush("vx_roster_edits", JSON.stringify({ edits: {}, deleted: {}, added: {} })));
  eq(empty.collapsed, true, "an empty overlay is no longer being refused: " + JSON.stringify(empty));
  await page.close();
  return "added a swimmer from a " + JSON.stringify(small).length + "-byte overlay against " + ratio.seen + " on the server";
});

// ---------------------------------------------------------------------------------------------
// 317 again. Every time.
//
// The base roster is 272 swimmers; the club's overlay adds 45 and deletes 14, which is the 303
// they keep asking for. 317 is 272 + 45 with the fourteen deletions gone — so what comes back is
// never the whole overlay, it is always exactly the deletions.
//
// The overlay is ONE document and whoever writes it last wins all of it. A device still holding
// yesterday's copy does not merely fail to see the fourteen deletions: it sends its copy over
// them and puts fourteen swimmers back for the entire club. applyPull makes it worse rather than
// better — when it judges the local copy newer it PUSHES it, so a tab left open overnight
// actively overwrites work done on another device this morning.
//
// So sending the roster is a merge now. This drives the exact collision.
// ---------------------------------------------------------------------------------------------
scene("a stale device cannot put deleted swimmers back", async (browser) => {
  // What the database holds: fourteen swimmers deleted, and a date of birth typed on that device.
  const theirs = { edits: { junior: { r5: { dob: "2011-02-03" } } }, deleted: { junior: {} }, added: {} };
  for (let i = 1; i <= 14; i++) theirs.deleted.junior["gone" + i] = true;
  // What this device holds: yesterday's copy. It has never heard about the deletions, and it has
  // its own edit made since — which is what makes it look newer and gives it the right to write.
  const mine = { edits: { junior: { r9: { dob: "2013-07-07" } } }, deleted: {}, added: {} };

  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  const problems = [], sent = [];
  page.on("pageerror", (e) => problems.push(String(e.message)));
  await page.route("**/rest/v1/**", async (route) => {
    const req = route.request(), m = req.method();
    const table = (new URL(req.url()).pathname.split("/rest/v1/")[1] || "").split("?")[0];
    if (table === "club_state" && m === "GET")
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(
        [{ key: "vx_roster_edits", value: theirs, updated_at: new Date(Date.now() - 7200000).toISOString() }]) });
    if (m !== "GET" && m !== "HEAD") {
      try {
        for (const w of JSON.parse(req.postData() || "[]"))
          if (w && w.key === "vx_roster_edits") sent.push(w.value);
      } catch { /* the assertions read sent, so an unparseable body fails them */ }
    }
    return route.fulfill({ status: m === "GET" ? 200 : 201, contentType: "application/json", body: "[]" });
  });
  await page.addInitScript((m) => {
    localStorage.setItem("vx_session", JSON.stringify({ type: "staff", id: "ahmed" }));
    localStorage.setItem("vx_auth", JSON.stringify({ token: "drive-fake", refresh: "drive-fake", exp: Date.now() + 3600000 }));
    localStorage.removeItem("vx_nav");
    localStorage.setItem("vx_roster_edits", JSON.stringify(m));
    localStorage.setItem("__vxts_vx_roster_edits", String(Date.now()));  // "mine is newer"
  }, mine);
  await page.goto("http://127.0.0.1:" + PORT + "/proto.html?drive=" + Date.now(), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2600);
  await page.evaluate((m) => window.__vxpush("vx_roster_edits", JSON.stringify(m)), mine);
  await page.waitForTimeout(1800);
  eq(problems.length, 0, "the app threw: " + problems.slice(0, 2).join(" | "));
  eq(sent.length > 0, true, "nothing was sent at all");
  const last = sent[sent.length - 1];
  const deletions = Object.keys((last.deleted && last.deleted.junior) || {}).length;
  eq(deletions, 14, "this device sent a roster with " + deletions + " of the 14 deletions — "
     + "the missing ones are swimmers who come back on every other device");
  // And its own work is still there. A merge that protects the database by dropping what the
  // coach just typed is the same bug pointing the other way.
  eq(((last.edits || {}).junior || {}).r9 !== undefined, true, "the edit made on this device was lost in the merge");
  eq(((last.edits || {}).junior || {}).r5 !== undefined, true, "the other device's date of birth was dropped");
  await page.close();
  return "kept all 14 deletions and both dates of birth";
});

// ---------------------------------------------------------------------------------------------
// "Every change and edit or delete must save automatically."
//
// persistRosterEdits wrote to localStorage, pushed, and told nobody what happened to the push.
// That is the shape of every silent loss in this app: the screen updates because the DEVICE
// saved, and whether the CLUB saved is a different question that nobody was asking. Add, edit
// and delete all go through that one function, so one answer covers all three.
//
// It also used to REFUSE the save outright when another device had written more recently —
// which was right while writing replaced the document, and became "we cannot add swimmers any
// more" the moment it was not. The merge protects that now; the refusal is gone.
// ---------------------------------------------------------------------------------------------
async function rosterSave(browser, { accept, keep = true }) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(String(e.message)));
  // The database's own copy, which the read-back reads. `keep:false` is the case this club hit:
  // the write is ACCEPTED and the record still does not contain the change afterwards.
  let doc = { edits: {}, deleted: {}, added: {} };
  await page.route("**/rest/v1/**", async (route) => {
    const req = route.request(), m = req.method();
    const table = (new URL(req.url()).pathname.split("/rest/v1/")[1] || "").split("?")[0];
    if (table === "club_state" && m === "POST") {
      if (!accept)
        return route.fulfill({ status: 403, contentType: "application/json",
          body: JSON.stringify({ message: "new row violates row-level security policy" }) });
      if (keep) {
        try {
          for (const w of JSON.parse(req.postData() || "[]")) if (w && w.key === "vx_roster_edits") doc = w.value;
        } catch { /* the assertions read doc, so an unparseable body fails them */ }
      }
      return route.fulfill({ status: 201, contentType: "application/json", body: "[]" });
    }
    if (table === "club_state" && m === "GET")
      return route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify([{ key: "vx_roster_edits", value: doc, updated_at: new Date().toISOString() }]) });
    return route.fulfill({ status: m === "GET" ? 200 : 201, contentType: "application/json", body: "[]" });
  });
  await page.addInitScript(() => {
    localStorage.setItem("vx_session", JSON.stringify({ type: "staff", id: "ahmed" }));
    localStorage.setItem("vx_auth", JSON.stringify({ token: "drive-fake", refresh: "drive-fake", exp: Date.now() + 3600000 }));
    localStorage.removeItem("vx_nav");
  });
  await page.goto("http://127.0.0.1:" + PORT + "/proto.html?drive=" + Date.now(), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2400);
  await tap(page, "Club Administration");
  await tap(page, "Roster · add / edit");
  await page.waitForTimeout(900);
  // Delete a swimmer — the change this club has lost most often, and the one that goes through
  // the same persist as add and edit.
  const gone = await page.evaluate(() => {
    const bin = [...document.querySelectorAll("button")]
      .find((b) => b.offsetParent && b.querySelector('[data-lucide="trash-2"],svg.lucide-trash-2'));
    if (!bin) return false;
    window.confirm = () => true;
    bin.click();
    return true;
  });
  if (!gone) throw new Error("no swimmer on the roster had a delete button");
  await page.waitForTimeout(2200);
  const said = await page.evaluate(() => {
    const t = (document.body.innerText || "").split("\n");
    return t.find((l) => /saved/i.test(l)) || "";
  });
  await page.close();
  return { said, problems };
}

scene("deleting a swimmer says whether the database took it", async (browser) => {
  const ok = await rosterSave(browser, { accept: true });
  eq(ok.problems.length, 0, "the roster threw: " + ok.problems.slice(0, 2).join(" | "));
  eq(/Saved ✓/.test(ok.said), true, "after a save the database took, the screen said: " + JSON.stringify(ok.said));
  eq(/the database holds/.test(ok.said), true,
     "saved has to be read back from the database, not inferred from a 201: " + JSON.stringify(ok.said));
  return "said " + JSON.stringify(ok.said.slice(0, 60));
});

// The case this club actually hit: the write is ACCEPTED, the screen says every device will show
// it, and the swimmer is not there. A 201 says the request was taken. It says nothing about what
// the record contains afterwards, and that gap is where "it says saved and it is not" lives.
scene("a save the database took but did not keep is not reported as saved", async (browser) => {
  const lost = await rosterSave(browser, { accept: true, keep: false });
  eq(lost.problems.length, 0, "the roster threw: " + lost.problems.slice(0, 2).join(" | "));
  eq(/Saved ✓/.test(lost.said), false,
     "the database did not keep the change and the screen still said: " + JSON.stringify(lost.said));
  eq(/NOT saved/.test(lost.said), true, "it said: " + JSON.stringify(lost.said));
  eq(/did not hold either/.test(lost.said), true,
     "it has to say the change is gone, not merely that something is inconsistent");
  // And name the cause worth acting on. The client-side merge only protects the roster if every
  // device is running it — a device on an older build still REPLACES the document, and no code
  // shipped here can stop it, so the person has to be told which action actually helps.
  eq(/older version/.test(lost.said), true,
     "a device on an old build is the likeliest reason, and the only fix is on the other device");
  return "caught a write that was accepted and not kept";
});

scene("a roster change the database refuses is not reported as saved", async (browser) => {
  const no = await rosterSave(browser, { accept: false });
  eq(no.problems.length, 0, "the roster threw: " + no.problems.slice(0, 2).join(" | "));
  eq(/NOT saved/.test(no.said), true, "a refused roster change reported: " + JSON.stringify(no.said));
  eq(/this device only/.test(no.said), true, "it has to say where the change actually is");
  eq(/Saved ✓/.test(no.said), false, "a refused change must never read as saved");
  return "refused, and said so: " + JSON.stringify(no.said.slice(0, 50));
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
