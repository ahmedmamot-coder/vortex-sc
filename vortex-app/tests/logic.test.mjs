// Tests for the logic that has actually caused problems for the club.
// Every case here is a real bug that reached coaches or parents.

import { readFileSync } from "node:fs";
import { bind, describe, it, itAsync, eq, report, SOURCE, sourceBetween, runInSandbox } from "./harness.mjs";

/* ---------------------------------------------------------------- attendance
   A swimmer signed off (traveling / sick / inactive) must count as absent, and a
   past day nobody marked must NOT be invented. */
describe("attendance", () => {
  const ctx = {
    swimmerStatus: {
      amy: { active: false, reason: "travel", from: "2026-08-01", to: "" },
      ben: { active: false, reason: "injured", from: "2026-08-01", to: "2026-08-10" },
    },
    attendLog: { squadA: { "2026-08-05": { cara: "late" } } },
    todayISO: () => "2026-08-15",
  };
  const away = bind("_swAwayOn", ctx, ["_swStatus"]);
  const status = bind("getAttendStatus", ctx, ["_swStatus", "_swAwayOn"]);

  it("signed-off swimmer is away inside the window", () => eq(away("amy", "2026-08-05"), "travel"));
  it("not yet away before the start date", () => eq(away("amy", "2026-07-30"), null));
  it("back automatically after the end date", () => eq(away("ben", "2026-08-15"), null));
  it("still away on the end date itself", () => eq(away("ben", "2026-08-10"), "injured"));
  it("active swimmer is never away", () => eq(away("cara", "2026-08-05"), null));

  it("away overrides any stored mark", () => eq(status("squadA", "2026-08-05", "amy", 0), "absent"));
  it("a real mark is kept", () => eq(status("squadA", "2026-08-05", "cara", 0), "late"));
  it("unmarked past day is NOT invented", () => eq(status("squadA", "2026-08-04", "cara", 0), "unmarked"));
  it("today defaults to present", () => eq(status("squadA", "2026-08-15", "cara", 0), "present"));
});

/* ------------------------------------------------------------ family linking
   A link that cannot be resolved must return null. It must never fall back to
   another swimmer — that is how a parent was shown a stranger's child. */
describe("family child linking", () => {
  const ctx = {
    roster: {
      junior: [{ id: "s1", name: "Hannah Millen" }, { id: "s9", name: "Aleksander A" }],
      vortexa: [{ id: "s2", name: "Lilliana Millen" }],
    },
  };
  const resolve = bind("_famResolve", ctx);

  it("resolves a correct link", () => eq(resolve("junior::s1").sw.name, "Hannah Millen"));
  it("follows a child who changed squad", () => eq(resolve("junior::s2").sw.name, "Lilliana Millen"));
  it("reports the child's new squad", () => eq(resolve("junior::s2").sqid, "vortexa"));
  it("returns null for an unknown child", () => eq(resolve("junior::nope"), null));
  it("never substitutes another swimmer", () => eq(resolve("junior::nope"), null, "must not fall back to roster[0]"));
  it("handles a missing link", () => eq(resolve(""), null));
});

/* ------------------------------------------------------------- session clock
   Set duration drives the printed timings on every plan. */
describe("session clock", () => {
  const ctx = {};
  const dur = bind("_setDurSec", ctx, ["_restToSec"]);
  const clock = bind("_fmtClockAmPm", ctx);

  it("send-off governs the whole set", () => eq(dur({ reps: 4, dist: 100, sendoff: "2:00" }, 120), 480));
  it("rounds multiply the set", () => eq(dur({ reps: 4, dist: 25, sendoff: "0:45", circuit: 3 }, 120), 540));
  it("falls back to pace plus rest", () => eq(dur({ reps: 2, dist: 100, rest: "0:20" }, 120), 280));
  it("formats midday correctly", () => eq(clock(12 * 3600), "12:00 PM"));
  it("formats midnight correctly", () => eq(clock(0), "12:00 AM"));
  it("formats an evening start", () => eq(clock(18 * 3600), "6:00 PM"));
});

/* --------------------------------------------------------------- membership
   Package pricing and renewal windows the club bills against. */
describe("academy membership", () => {
  const ctx = { feePlans: { "3x": 650, "4x": 750, "6x": 850, fitness: 360 }, todayISO: () => "2026-08-07" };
  const cost = bind("_membershipCost", ctx, ["_feePlans"]);
  const left = bind("_renewalDaysLeft", ctx);

  it("3x per week", () => eq(cost({ pkg: "3x" }), 650));
  it("6x per week", () => eq(cost({ pkg: "6x" }), 850));
  it("adds fitness on top", () => eq(cost({ pkg: "6x", fitness: true }), 1210));
  it("fitness on its own", () => eq(cost({ fitness: true }), 360));
  it("no package costs nothing", () => eq(cost({}), 0));

  // The cases above pass prices in, so they only prove the arithmetic. These read the
  // defaults out of the shipped code, so a wrong price in the app fails the build.
  const defaults = bind("_feePlans", { feePlans: {} });
  it("ships 3x at 650", () => eq(defaults()["3x"], 650));
  it("ships 4x at 750", () => eq(defaults()["4x"], 750));
  it("ships 6x at 850", () => eq(defaults()["6x"], 850));
  it("ships fitness at 360", () => eq(defaults().fitness, 360));

  it("counts days to renewal", () => eq(left({ end: "2026-08-12" }), 5));
  it("zero on the last day", () => eq(left({ end: "2026-08-07" }), 0));
  it("goes negative once expired", () => eq(left({ end: "2026-07-28" }), -10));
  it("null when open-ended", () => eq(left({ end: "" }), null));
});

/* ------------------------------------------------------------- Hy-Tek import
   Reads the club's real meet export. Times are stored as total seconds. */
describe("Hy-Tek .hy3 import", () => {
  const ctx = {};
  const parse = bind("meetParseHy3", ctx);
  const hy3 = [
    "A107Results From MM to TM    Hy-Tek, Ltd    MM5 8.0Ge     06062026  5:03 PM",
    "B1H2O Long Course Spring Cup 2026              Aspire Dome Doha Qatar",
    "D1F 4113Abu Taleb           Jana                                                     38004052016 10     0",
    "E1F 4113Abu TFW   100B 10 11  0S 50.00  3C  112.59L  112.59L    0.00    0.00   NN               N",
    "E2F  115.27L       0  2  6  6  11  0  115.27    0.00    0.00       119.18     0.00     06052026K",
    "E1F 4113Abu TFW    50A 10 11  0S 60.00 31C   44.15L   44.15L    0.00    0.00   NN               N",
    "E2F   41.10L       0  7  7  2  16  0   41.10    0.00    0.00        43.36     0.00     06062026K",
  ].join("\n");
  const out = parse(hy3);

  it("finds the swimmer", () => eq(out.length, 1));
  it("reads the name", () => eq(out[0].name, "Jana Abu Taleb"));
  it("reads gender and age", () => eq([out[0].gender, out[0].age], ["G", 10]));
  it("reads both swims", () => eq(out[0].results.length, 2));
  it("reads event and stroke", () => eq(out[0].results[0].event ?? `${out[0].results[0].dist} ${out[0].results[0].stroke}`, "100 Back"));
  it("keeps seconds, not the entry time", () => eq(out[0].results[0].sec, 115.27));
  it("reads the swim date", () => eq(out[0].results[0].date, "6/5/2026"));
  it("picks up the meet name", () => eq(out[0].results[0].meet, "H2O Long Course Spring Cup 2026"));
  it("marks it long course", () => eq(out[0].results[1].course, "L"));

  // The D1 record carries MMDDYYYY before the age. It was matched and discarded, so the
  // club's own meet files held every swimmer's birthday and the app kept only "age 10".
  it("reads the date of birth the file was already carrying", () => eq(out[0].dob, "2016-04-05"));
  it("the date agrees with the age in the same record", () =>
    eq(2026 - Number(out[0].dob.slice(0, 4)), out[0].age));
  it("a nonsense date is left empty rather than guessed at", () => {
    const bad = parse([
      "B1Test Meet                                     Doha Qatar",
      "D1F 4113Nobody              Test                                                     38013452016 10     0",
    ].join("\n"));
    eq(bad[0].dob, "");
  });
});

/* ------------------------------------------------------- shipped-source guards
   Cheap checks for the exact regressions that have bitten before. */
describe("shipped source", () => {
  it("no staff PINs in the page source", () =>
    eq(/pin:'\d{4}'/.test(SOURCE), false, "PINs must never ship to the browser"));
  it("no PIN-derived database password", () =>
    eq(SOURCE.includes("'vxsc_'+acct.id"), false, "would let anyone compute a coach's password"));
  it("no plaintext password comparison at login", () =>
    eq(/f\.pass\|\|''\)\)\.trim\(\)===\(pass/.test(SOURCE), false, "auth bypass"));
  it("attendance is never invented", () =>
    eq(SOURCE.includes("seededDayStatus(squadId"), false, "fabricated history"));

  // The app is one enormous class, so a new method can silently collide with a field the
  // constructor or a timer already parks on `this`. The instance property wins, and the
  // method becomes whatever that field holds — which is how `this._t()` shipped as
  // "486 is not a function" and white-screened the live site. Nothing catches this at
  // parse time and unit tests bind methods onto a bare object where the field never exists,
  // so it has to be checked against the shipped source.
  // The home-screen icon and the app shell are both served by the service worker's
  // cache-first path, which is never revalidated. A failure stored there is stored for good.
  it("the service worker never caches a failed response", () => {
    const sw = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
    const puts = [...sw.matchAll(/caches\.open\((APP_SHELL|STATIC)\)/g)].length;
    const guards = [...sw.matchAll(/res && res\.ok/g)].length;
    eq(guards >= puts - 1, true, "a cached 404 is how the icon stayed broken forever");
  });
  it("the app HTML may be kept and revalidated, not re-downloaded whole", () => {
    const cfg = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
    const header = (cfg.match(/value:\s*"([^"]*must-revalidate[^"]*)"/) || [])[1] || "";
    eq(/no-store/.test(header), false, "no-store re-downloaded 1.2MB on every single open");
    eq(/no-cache, must-revalidate/.test(cfg), true, "deploys must still show immediately");
  });
  it("iOS gets an apple-touch-icon at a size it actually is", () =>
    eq(/apple-touch-icon" sizes="192x192" href="\/assets\/icon-192\.png"/.test(SOURCE), true));
  it("the icon paths do not depend on the page's URL", () =>
    eq(/apple-touch-icon" href="assets\//.test(SOURCE), false, "a relative icon path resolves against whatever URL was opened"));

  // A blob: URL lives only in the tab that made it. Keeping a video record that points at
  // one is keeping a reference to something already gone — with the splits and notes still
  // attached to it.
  it("a video is only kept once it has a URL that outlives the tab", () => {
    const fn = SOURCE.slice(SOURCE.indexOf("async videoUploadFile"), SOURCE.indexOf("videoSplitLabels"));
    const saveAt = fn.indexOf("_saveJSON('vx_videos'");
    const clearAt = fn.indexOf("_isBlob:false");
    eq(saveAt > -1 && clearAt > -1 && clearAt < saveAt, true, "it must be uploaded before it is saved");
  });
  it("a failed upload says the video will be lost, rather than nothing", () =>
    eq(/on this device only and will be lost/.test(SOURCE), true));
  it("'uploaded' is not read from the flag that means the opposite", () =>
    eq(/videoIsUploaded = activeVid \? !activeVid\._isBlob/.test(SOURCE), true));

  it("no method name is shadowed by a field on the same instance", () => {
    const body = SOURCE.slice(SOURCE.indexOf("class Component"));
    const methods = new Set(
      [...body.matchAll(/^ {2}(?:async )?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm)].map((m) => m[1]),
    );
    for (const skip of ["if", "for", "while", "switch", "catch", "return", "constructor"]) methods.delete(skip);
    const assigned = new Set([...body.matchAll(/\bthis\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)].map((m) => m[1]));
    const clashes = [...methods].filter((n) => assigned.has(n));
    eq(clashes, [], "these methods are overwritten by a value on `this` and stop being callable");
  });
  it("template conditionals stay balanced", () => {
    const o = (SOURCE.match(/<sc-if/g) || []).length, c = (SOURCE.match(/<\/sc-if>/g) || []).length;
    eq(o - c, -2, "sc-if open/close delta");
  });
  it("template loops stay balanced", () => {
    const o = (SOURCE.match(/<sc-for/g) || []).length, c = (SOURCE.match(/<\/sc-for>/g) || []).length;
    eq(o - c, 0, "sc-for open/close delta");
  });
});

/* ------------------------------------------------------------------- icons
   The custom glyphs are injected as raw SVG, so a malformed path would break
   the icon silently rather than throw. */
describe("icon glyphs", () => {
  const map = SOURCE.match(/_glyphs\(\)\{[\s\S]*?this\._glyphMap=G/)[0];
  const entries = [...map.matchAll(/'([a-z-]+)':'([^']+)'/g)];

  it("draws a glyph set", () => eq(entries.length >= 12, true));
  it("every glyph is well-formed", () => {
    for (const [, name, svg] of entries) {
      const opens = (svg.match(/<(path|rect|circle)\b/g) || []).length;
      const closes = (svg.match(/\/>/g) || []).length;
      eq(opens === closes && opens > 0, true, `${name} has ${opens} shapes but ${closes} closers`);
    }
  });
  it("redraws the screens used most", () => {
    for (const n of ["clipboard-check", "trophy", "heart-pulse", "list-ordered", "medal"])
      eq(entries.some(([, k]) => k === n), true, `${n} missing`);
  });
  it("custom glyphs render before lucide", () =>
    eq(/this\._customIcons\(\);[\s\S]{0,80}lucide\.createIcons/.test(SOURCE), true));
  it("tool tiles use the 2027 gradient", () =>
    eq(/tint:this\._gradTile\(t\.color\), color:'#fff'/.test(SOURCE), true));
});

/* ----------------------------------------------------------- bottom tab bar
   Waterline: the pool slides under the open tab and the glyph fills in. */
describe("tab bar", () => {
  const tabs = ["group", "plans", "attend", "results", "more"];
  const left = (id) => Math.max(0, tabs.indexOf(id)) * (100 / tabs.length) + "%";

  it("pool sits under the first tab", () => eq(left("group"), "0%"));
  it("pool slides to the middle tab", () => eq(left("attend"), "40%"));
  it("pool slides to the last tab", () => eq(left("more"), "80%"));
  it("an unknown tab falls back to the first", () => eq(left("nope"), "0%"));

  it("ships a filled glyph for every tab", () => {
    for (const n of tabs) {
      const icon = { group: "users", plans: "list-checks", attend: "calendar-check", results: "medal", more: "layout-grid" }[n];
      eq(SOURCE.includes(`'vxf-${icon}'`), true, `vxf-${icon} missing`);
    }
  });
  it("the open tab uses the filled glyph", () =>
    eq(/on\?\('vxf-'\+t\.icon\):t\.icon/.test(SOURCE), true));
  it("the water surface animates", () =>
    eq(SOURCE.includes("@keyframes vxdrift") && SOURCE.includes('class="vx-wave"'), true));
  it("motion stops for Reduce Motion", () =>
    eq(/prefers-reduced-motion:reduce\)\{ \.vx-wave\{animation:none\}/.test(SOURCE), true));
});

/* -------------------------------------------------------------------- arabic
   The family screens are what a parent who reads Arabic actually opens. The
   choice has to be theirs and stay on their phone — a parent switching to Arabic
   must not flip the language on the coach's iPad, and they cannot reach the admin
   settings to put it back. */
describe("arabic", () => {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  const ctx = (locale, device) => {
    for (const k of Object.keys(store)) delete store[k];
    if (device) store.vx_lang = device;
    return { brandConfig: { locale } };
  };

  const langOf = (c) => bind("_lang", c, ["_langKey"])();
  it("falls back to the club's configured language", () => eq(langOf(ctx("ar")), "ar"));
  it("English club, English app", () => eq(langOf(ctx("en")), "en"));
  it("the device's own choice wins over the club default", () => eq(langOf(ctx("en", "ar")), "ar"));
  it("and wins the other way too", () => eq(langOf(ctx("ar", "en")), "en"));
  it("a junk stored value does not leave the app in no language", () => eq(langOf(ctx("en", "klingon")), "en"));

  const t = (c) => bind("_strings", c, ["_i18n", "_lang", "_langKey"])();
  it("Arabic really is Arabic", () => eq(/[؀-ۿ]/.test(t(ctx("ar")).tabFees), true));
  it("English really is English", () => eq(t(ctx("en")).tabFees, "Fees"));
  it("the fees tab a parent taps is translated", () => eq(t(ctx("ar")).tabFees !== "Fees", true));

  const dict = bind("_i18n", {})();
  it("every phrase carries both languages", () => {
    const missing = Object.keys(dict).filter((k) => !dict[k][1] || !dict[k][0]);
    eq(missing, [], "an untranslated key renders English inside an Arabic screen");
  });
  it("no Arabic string was left as a copy of the English", () => {
    const copies = Object.keys(dict).filter((k) => dict[k][0] === dict[k][1]);
    eq(copies, []);
  });
  it("every Arabic string actually contains Arabic", () => {
    const notArabic = Object.keys(dict).filter((k) => !/[؀-ۿ]/.test(dict[k][1]));
    eq(notArabic, []);
  });

  it("the family screens go through the dictionary, not hardcoded English", () => {
    const tpl = SOURCE.slice(0, SOURCE.indexOf("class Component"));
    const portal = tpl.slice(tpl.indexOf('value="{{ showFamily }}"'), tpl.indexOf('value="{{ showSquad }}"'));
    for (const gone of ["-->Fees<", ">Documents</button>", ">Personal bests</p>", ">Nutrition</"])
      eq(portal.includes(gone), false, `${gone} is still hardcoded`);
    eq(portal.includes("{{ tx.tabFees }}"), true);
  });
  it("the direction is set on the document, not patched per element", () =>
    eq(/document\.documentElement\.setAttribute\('dir'/.test(SOURCE), true));
  it("Arabic has a font fallback — Funnel Display has no Arabic glyphs", () =>
    eq(/\[dir="rtl"\] body[\s\S]{0,200}Noto Naskh Arabic/.test(SOURCE), true));
  it("letter-spacing is off in Arabic, or the letters stop joining", () =>
    eq(/\[dir="rtl"\] \*\{letter-spacing:normal/.test(SOURCE), true));
});

/* -------------------------------------------------------------- race strategy
   The split targets are what a swimmer is told to swim to. They have to add back
   up to the goal exactly, and they have to describe a race a coach recognises —
   out quick off the dive, drifting through the middle, coming back on the finish. */
describe("race strategy", () => {
  const ctx = { parseTimeStr: null };
  const splits = bind("raceSplits", ctx, ["_raceDistance", "_raceShape"]);
  const dist = bind("_raceDistance", ctx);
  const sum = (rows) => +rows.reduce((a, r) => a + r.split, 0).toFixed(2);

  it("reads the distance out of the event name", () => eq(dist("200 Breast"), 200));
  it("reads it out of an IM too", () => eq(dist("400 IM"), 400));
  it("an event with no distance plans nothing", () => eq(splits("Mystery", 60).length, 0));

  it("a 50 is one leg, not zero", () => eq(splits("50 Free", 26.2).length, 1));
  it("a 100 splits into two 50s", () => eq(splits("100 Free", 60).length, 2));
  it("a 400 splits into eight", () => eq(splits("400 Free", 300).length, 8));

  it("the legs add back up to the goal (100)", () => eq(sum(splits("100 Free", 60)), 60));
  it("the legs add back up to the goal (200)", () => eq(sum(splits("200 Free", 130)), 130));
  it("the legs add back up to the goal (400)", () => eq(sum(splits("400 Free", 300)), 300));
  it("the last cumulative IS the goal", () => {
    const r = splits("200 Free", 130);
    eq(r[r.length - 1].cumulative, 130);
  });

  it("the first 50 is the quickest — that is the dive", () => {
    const r = splits("100 Free", 60);
    eq(r[0].split < r[1].split, true);
  });
  it("a 200 comes home faster than its third 50", () => {
    const r = splits("200 Free", 130);
    eq(r[3].split < r[2].split, true);
  });
  it("a 400 finishes faster than it drifted", () => {
    const r = splits("400 Free", 300);
    eq(r[7].split < r[6].split, true);
  });
  it("nobody is asked to negative-split the whole race", () => {
    const r = splits("100 Free", 60);
    eq(r[0].split < 30 && r[1].split > 30, true);
  });

  it("a target of nothing plans nothing rather than dividing by zero", () => eq(splits("100 Free", 0).length, 0));

  const setActual = bind("raceActualSet", {
    raceSplitLog: {}, todayISO: () => "2026-08-08", _saveJSON: () => {}, forceUpdate: () => {},
  }, ["parseTimeStr"]);
  it("a typed split is stored against its leg", () => {
    const c = { raceSplitLog: {}, todayISO: () => "2026-08-08", _saveJSON: () => {}, forceUpdate: () => {} };
    const set = bind("raceActualSet", c, ["parseTimeStr"]);
    set("s1", "100 Free", 2, "31.40");
    eq(c.raceSplitLog.s1["100 Free"].splits[1], 31.4);
  });
  it("clearing a box removes the split instead of storing a 0.00 length", () => {
    const c = { raceSplitLog: {}, todayISO: () => "2026-08-08", _saveJSON: () => {}, forceUpdate: () => {} };
    const set = bind("raceActualSet", c, ["parseTimeStr"]);
    set("s1", "100 Free", 1, "28.10");
    set("s1", "100 Free", 1, "");
    eq(c.raceSplitLog.s1["100 Free"].splits[0], null);
  });
  it("a minutes:seconds split is understood", () => {
    const c = { raceSplitLog: {}, todayISO: () => "2026-08-08", _saveJSON: () => {}, forceUpdate: () => {} };
    const set = bind("raceActualSet", c, ["parseTimeStr"]);
    set("s1", "400 Free", 1, "1:05.50");
    eq(c.raceSplitLog.s1["400 Free"].splits[0], 65.5);
  });
  void setActual;
});

/* ------------------------------------------------------------------ load risk
   This flags children to their coach. Flagging one who is fine wastes a
   conversation; flagging on data that does not exist destroys trust in the whole
   board, so "nothing recorded" must never read as "something is wrong". */
describe("load risk", () => {
  const DAY = 86400000;
  const iso = (back) => new Date(Date.parse("2026-08-28T00:00:00Z") - back * DAY).toISOString().slice(0, 10);
  // 28 days of sessions, 3000m each, every day.
  const plans = (metres) => Array.from({ length: 28 }, (_, k) => ({ date: iso(k), totalM: metres }));

  const ctxFor = ({ sessions, present, wellness = [], status = {} }) => ({
    squads: [{ id: "junior", name: "Junior" }],
    squadById: { junior: { name: "Junior" } },
    roster: { junior: [{ id: "s1", name: "Hannah Millen" }] },
    savedPlans: { junior: sessions },
    wellness: { s1: wellness },
    swimmerStatus: status,
    todayISO: () => "2026-08-28",
    getAttendStatus: (sq, day) => present(day),
  });

  const riskOf = (ctx) => bind("_riskFor", ctx, [
    "_swLoadSeries", "_attendPct", "_wellReadiness", "_swStatus", "shiftDate",
  ])("junior", ctx.roster.junior[0], 0);

  it("a steady swimmer is not flagged", () => {
    const r = riskOf(ctxFor({ sessions: plans(3000), present: () => "present" }));
    eq(r.level, "ok");
  });
  it("a steady swimmer's load ratio sits around 1", () => {
    const r = riskOf(ctxFor({ sessions: plans(3000), present: () => "present" }));
    eq(r.acwr, 1);
  });
  it("a swimmer with nothing recorded is not flagged as fine OR as at risk", () => {
    const r = riskOf(ctxFor({ sessions: [], present: () => "unmarked" }));
    eq(r.acwr, null);
    eq(r.level, "ok");
    eq(r.attNow, null, "no register marked must not read as 0% attendance");
  });
  it("a load spike is flagged", () => {
    // Triple the metres for the last 7 days only.
    const sessions = plans(3000).map((p, k) => (k < 7 ? { ...p, totalM: 9000 } : p));
    const r = riskOf(ctxFor({ sessions, present: () => "present" }));
    eq(r.acwr, 3);
    eq(r.flags.some((f) => f.key === "spike"), true);
    eq(r.level, "check");
  });
  it("a swimmer who has stopped training is flagged, but more gently", () => {
    const sessions = plans(3000).map((p, k) => (k < 7 ? { ...p, totalM: 0 } : p));
    const r = riskOf(ctxFor({ sessions, present: () => "present" }));
    eq(r.flags.some((f) => f.key === "drop"), true);
    eq(r.level, "watch");
  });
  it("a run of poor check-ins is flagged", () => {
    const wellness = Array.from({ length: 7 }, () => ({ sleep: 2, energy: 2, mood: 2, hydration: 2, soreness: 4 }));
    const r = riskOf(ctxFor({ sessions: plans(3000), present: () => "present", wellness }));
    eq(r.flags.some((f) => f.key === "readiness"), true);
    eq(r.flags.some((f) => f.key === "soreness"), true);
  });
  it("good check-ins are not flagged", () => {
    const wellness = Array.from({ length: 7 }, () => ({ sleep: 5, energy: 5, mood: 5, hydration: 5, soreness: 1 }));
    const r = riskOf(ctxFor({ sessions: plans(3000), present: () => "present", wellness }));
    eq(r.flags.length, 0);
  });
  it("attendance falling away is flagged", () => {
    const cut = iso(13);
    const r = riskOf(ctxFor({ sessions: plans(3000), present: (d) => (d > cut ? "absent" : "present") }));
    eq(r.flags.some((f) => f.key === "attendance"), true);
  });
  it("a swimmer already signed off injured is surfaced, not hidden", () => {
    const r = riskOf(ctxFor({
      sessions: plans(3000), present: () => "present",
      status: { s1: { active: false, reason: "injured", from: "2026-08-01", to: "" } },
    }));
    eq(r.flags.some((f) => f.key === "signed-off"), true);
  });
  it("the board leaves out everyone with nothing to say about them", () => {
    const ctx = ctxFor({ sessions: plans(3000), present: () => "present" });
    const board = bind("_riskBoard", ctx, ["_riskFor", "_swLoadSeries", "_attendPct", "_wellReadiness", "_swStatus", "shiftDate"]);
    eq(board(["junior"]).length, 0);
  });
});

/* ------------------------------------------------------------------- meet day
   Times typed poolside go straight into the swimmer's permanent history, so a
   mistake here is not a display glitch — it is a race that never happened sitting
   in a child's record and, if it is fast enough, in their PB. */
describe("meet day", () => {
  const swimmers = () => ({
    junior: [
      { id: "s1", name: "Hannah Millen", entries: [
        { event: "50 Free", sec: 31.20, meet: "Spring Cup", meetDate: "2026-03-01" },
        { event: "50 Free", sec: 30.80, meet: "Doha Open", meetDate: "2026-08-08" },
        { event: "100 Free", sec: 68.10, meet: "Spring Cup", meetDate: "2026-03-01" },
      ] },
      { id: "s2", name: "Omar Ali", entries: [
        { event: "50 Free", sec: 29.90, meet: "Doha Open", meetDate: "2026-08-08" },
      ] },
    ],
    senior: [
      { id: "s3", name: "Lilliana Millen", entries: [
        { event: "50 Free", sec: 30.10, meet: "Doha Open", meetDate: "2026-08-08" },
      ] },
    ],
  });
  const baseCtx = () => ({
    squads: [{ id: "junior", name: "Junior" }, { id: "senior", name: "Senior" }],
    roster: swimmers(),
    state: {},
    todayISO: () => "2026-08-08",
    notify: () => {},
    _pushSend: () => {},
    setState: function (p) { Object.assign(this.state, p); },
  });

  describeIso();
  function describeIso() {
    const ctx = baseCtx();
    const iso = bind("_meetISO", ctx);
    it("reads the meet's American date order", () => eq(iso({ date: "3/9/2026" }), "2026-03-09"));
    it("pads a single-digit month and day", () => eq(iso({ date: "3/9/2026" }).length, 10));
    it("a meet with no date falls back to today, not to nothing", () => eq(iso({}), "2026-08-08"));
    it("an unparseable date does not produce a broken ISO string", () => eq(iso({ date: "next Friday" }), "2026-08-08"));
  }

  describeSwims();
  function describeSwims() {
    const ctx = baseCtx();
    const swims = bind("_meetSwims", ctx, ["_swEntries"]);
    const out = swims("Doha Open");
    it("collects this meet's swims across every squad", () => eq(Object.keys(out).length, 3));
    it("leaves another meet's swims alone", () => eq(out["s1|100 Free"], undefined));
    it("keys a swim by swimmer and event", () => eq(out["s1|50 Free"].sec, 30.8));
  }

  describePlaces();
  function describePlaces() {
    const ctx = baseCtx();
    const places = bind("_meetPlaces", ctx, ["_meetSwims", "_swEntries"]);
    const p = places("Doha Open");
    it("first place is the fastest of the whole event", () => eq(p["s2|50 Free"], 1));
    it("places run across heats, not within one", () => eq(p["s3|50 Free"], 2));
    it("the slowest of the event is last", () => eq(p["s1|50 Free"], 3));
  }

  describeBest();
  function describeBest() {
    const ctx = baseCtx();
    const best = bind("_bestBefore", ctx, ["_swEntries"]);
    const hannah = ctx.roster.junior[0];
    it("the best they came in with", () => eq(best(hannah, "50 Free", "Doha Open"), 31.2));
    it("without today's meet excluded it would beat itself", () => eq(best(hannah, "50 Free", ""), 30.8));
    it("an event they have never swum has no best", () => eq(best(hannah, "200 Fly", "Doha Open"), null));
  }

  describeSave();
  function describeSave() {
    const ctx = baseCtx();
    ctx.allSwimmersFlat = () => [{ ...ctx.roster.junior[0], squadId: "junior" }];
    let saved = null;
    ctx.adminEditSwimmer = (sqId, id, patch) => { saved = { sqId, id, patch }; };
    const save = bind("meetLiveSave", ctx, ["parseTimeStr", "_bestBefore", "_swEntries", "fmt"]);

    save("Doha Open", "2026-08-08", "LCM", "s1", "50 Free", "30.10");
    it("saves against the swimmer's own squad", () => eq(saved.sqId, "junior"));
    it("correcting a time replaces the swim, it does not stack a second one", () =>
      eq(saved.patch.pbs.filter((p) => p.event === "50 Free" && p.meet === "Doha Open").length, 1));
    it("the corrected time is the one kept", () =>
      eq(saved.patch.pbs.find((p) => p.event === "50 Free" && p.meet === "Doha Open").sec, 30.1));
    it("their other races are untouched", () =>
      eq(saved.patch.pbs.filter((p) => p.meet === "Spring Cup").length, 2));
    it("a PB is measured against what they came in with", () =>
      eq(/PB by 1\.10s/.test(ctx.state.meetDayMsg), true));
    it("SCM is recorded as short course", () => {
      save("Doha Open", "2026-08-08", "SCM", "s1", "50 Free", "29.00");
      eq(saved.patch.pbs.find((p) => p.meet === "Doha Open").course, "S");
    });

    it("a time that is not a time is refused, not saved as NaN", () => {
      saved = null;
      save("Doha Open", "2026-08-08", "LCM", "s1", "50 Free", "hand timed");
      eq(saved, null);
      eq(/Enter a time/.test(ctx.state.meetDayMsg), true);
    });
    it("a swimmer who has left the club is refused", () => {
      saved = null;
      save("Doha Open", "2026-08-08", "LCM", "gone", "50 Free", "30.00");
      eq(saved, null);
    });
  }

  describeClear();
  function describeClear() {
    const ctx = baseCtx();
    ctx.allSwimmersFlat = () => [{ ...ctx.roster.junior[0], squadId: "junior" }];
    let saved = null;
    ctx.adminEditSwimmer = (sqId, id, patch) => { saved = patch; };
    const clear = bind("meetLiveClear", ctx, ["_swEntries"]);
    clear("Doha Open", "s1", "50 Free");
    it("undo takes the swim back out of the record", () =>
      eq(saved.pbs.some((p) => p.event === "50 Free" && p.meet === "Doha Open"), false));
    it("and leaves every other race in place", () => eq(saved.pbs.length, 2));
  }
});

/* -------------------------------------------------------------------- billing
   Money is the one place where "roughly right" is not good enough. A fee that is
   billed twice, billed to a swimmer who is signed off injured, or counted as
   collected before the club has seen it, all end up as an argument with a parent. */
describe("billing", () => {
  const clubCtx = () => ({
    squads: [{ id: "junior", name: "Junior" }, { id: "senior", name: "Senior" }],
    roster: {
      junior: [{ id: "s1", name: "Hannah Millen" }, { id: "s2", name: "Omar Ali" }],
      senior: [{ id: "s3", name: "Lilliana Millen" }],
    },
    academyFees: { junior: 550, senior: 650 },
    feePlans: { "3x": 650, "4x": 750, "6x": 850, fitness: 360 },
    memberships: { s3: { pkg: "4x", fitness: true } },
    swimmerStatus: { s2: { active: false, reason: "injured", from: "2026-08-01", to: "" } },
    invoices: {},
    billing: { invoices: [], migrated: true },
    state: {},
    brandConfig: { currency: "QAR" },
    todayISO: () => "2026-08-15",
    _uid: (p) => p + "_" + Math.random().toString(36).slice(2, 7),
    _saveJSON: () => {},
    forceUpdate: () => {},
    setState: function (p) { Object.assign(this.state, p); },
    _pushSend: () => {},
    notify: () => {},
    _me: () => ({ label: "Coach" }),
  });

  const FEE_DEPS = ["_membership", "_membershipCost", "_feePlans", "allSwimmersFlat"];

  describeFee();
  function describeFee() {
    const ctx = clubCtx();
    const feeFor = bind("_feeFor", ctx, FEE_DEPS);
    it("a membership package is what the swimmer owes", () => eq(feeFor("s3", "senior"), 750 + 360));
    it("without a package it falls back to the squad fee", () => eq(feeFor("s1", "junior"), 550));
    it("the squad is found even when the caller does not pass it", () => eq(feeFor("s1"), 550));
    it("a swimmer in no squad owes nothing", () => eq(feeFor("ghost"), 0));
  }

  describeOverdue();
  function describeOverdue() {
    const ctx = clubCtx();
    const overdue = bind("_invOverdue", ctx);
    it("unpaid and past the due date is overdue", () => eq(overdue({ status: "unpaid", due: "2026-08-07" }), true));
    it("unpaid but not yet due is not overdue", () => eq(overdue({ status: "unpaid", due: "2026-08-31" }), false));
    it("paid is never overdue, however late", () => eq(overdue({ status: "paid", due: "2026-01-07" }), false));
    it("a voided invoice is never overdue", () => eq(overdue({ status: "void", due: "2026-01-07" }), false));
    it("a family's reported payment can still be overdue", () => eq(overdue({ status: "sent", due: "2026-08-07" }), true));
  }

  describeIssue();
  function describeIssue() {
    const ctx = clubCtx();
    const issue = bind("billingIssue", ctx, [
      "_billing", "_billingSave", "billPeriod", "_periodDue", "_periodLabel", "_feeFor", "_feeLabel", ...FEE_DEPS, "_swStatus",
    ]);
    issue("2026-08");
    const first = ctx.billing.invoices.slice();

    it("bills every swimmer who owes something", () => eq(first.length, 2));
    it("leaves out a swimmer signed off injured", () => eq(first.some((iv) => iv.swId === "s2"), false));
    it("bills the membership amount, not the squad fee", () => eq(first.find((iv) => iv.swId === "s3").total, 1110));
    it("says what the invoice is for", () => eq(first.find((iv) => iv.swId === "s3").items[0].label, "Membership — 4x per week + Fitness 3x"));
    it("falls due on the 7th of the month it covers", () => eq(first[0].due, "2026-08-07"));
    it("starts unpaid", () => eq(first.every((iv) => iv.status === "unpaid"), true));

    issue("2026-08");
    it("running it again bills nobody twice", () => eq(ctx.billing.invoices.length, 2));
    it("and says so instead of failing silently", () => eq(/already has an invoice/.test(ctx.state.billMsg), true));

    // A swimmer who comes back from injury mid-month should be billable without
    // re-billing the squad.
    ctx.swimmerStatus = {};
    issue("2026-08");
    it("a late joiner can still be added on a second run", () => eq(ctx.billing.invoices.length, 3));
  }

  describeTotals();
  function describeTotals() {
    const ctx = clubCtx();
    ctx.billing = { migrated: true, invoices: [
      { id: "a", swId: "s1", period: "2026-08", total: 550, status: "paid", due: "2026-08-07" },
      { id: "b", swId: "s2", period: "2026-08", total: 550, status: "unpaid", due: "2026-08-07" },
      { id: "c", swId: "s3", period: "2026-08", total: 1110, status: "sent", due: "2026-08-31" },
      { id: "d", swId: "s1", period: "2026-08", total: 900, status: "void", due: "2026-08-07" },
      { id: "e", swId: "s1", period: "2026-07", total: 550, status: "unpaid", due: "2026-07-07" },
    ] };
    const totals = bind("_billingTotals", ctx, ["_billing", "_invOverdue", ...FEE_DEPS, "_feeFor"]);
    const t = totals("2026-08");

    it("only counts money the club has actually seen", () => eq(t.paid, 550));
    it("a family's own 'I have paid' is not collected yet", () => eq(t.due, 1660));
    it("overdue is a subset of outstanding, not a third bucket", () => eq(t.overdue, 550));
    it("a voided invoice is in no total", () => eq(t.count, 3));
    it("another month's debt does not leak in", () => eq(totals("2026-07").due, 550));
  }

  describeMigration();
  function describeMigration() {
    const ctx = clubCtx();
    ctx.billing = null;
    ctx.invoices = { "2026-06": { s1: true, s2: false }, "2026-07": { s3: true } };
    const billing = bind("_billing", ctx, ["_feeFor", ...FEE_DEPS]);
    const out = billing();

    it("the old paid ticks become real invoices", () => eq(out.invoices.length, 2));
    it("an unticked swimmer is not invented as paid", () => eq(out.invoices.some((iv) => iv.swId === "s2"), false));
    it("they come across as paid, since that is what the tick meant", () => eq(out.invoices.every((iv) => iv.status === "paid"), true));
    it("the amount is the fee in force today", () => eq(out.invoices.find((iv) => iv.swId === "s3").total, 1110));
    it("and the row admits where the number came from", () => eq(/Imported/.test(out.invoices[0].note), true));
    it("migrating twice does not double the history", () => eq(billing().invoices.length, 2));
  }

  describePeriods();
  function describePeriods() {
    const ctx = clubCtx();
    const shift = bind("_periodShift", ctx);
    it("steps back a month", () => eq(shift("2026-08", -1), "2026-07"));
    it("steps back over new year", () => eq(shift("2026-01", -1), "2025-12"));
    it("steps forward over new year", () => eq(shift("2026-12", 1), "2027-01"));
    it("keeps the two-digit month", () => eq(shift("2026-10", -1), "2026-09"));
  }
});

/* ------------------------------------------------------------ expired session
   A coach leaves the app open on the poolside iPad, it sleeps for an hour, and the
   Supabase token quietly expires. iOS suspends the refresh timer, so the app carried
   on sending the anon key — every attendance mark came back 401. The marks were queued
   but nothing replayed them, and the reads came back empty, so the squad looked blank.
   These drive the real sync layer out of proto.html against a stubbed network. */
describe("expired session", () => {
  const SYNC_SRC = sourceBetween('var SB_URL = "https://', "window.__vxCount = function");

  const res = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body ?? "")),
  });
  const flush = () => new Promise((r) => setTimeout(r, 1));
  const NOW = 1_760_000_000_000;

  /** Boot the shipped sync layer with a chosen stored session, write queue and network. */
  function boot({ auth = null, failed = [], reply }) {
    const store = {};
    if (auth) store.vx_auth = JSON.stringify(auth);
    if (failed.length) store.vx_failed_writes = JSON.stringify(failed);

    const requests = [];
    const upserted = [];
    const domListeners = {};
    const win = {
      __vxUpsert: (table, payload) => { upserted.push({ table, payload }); return Promise.resolve(true); },
      __vxFlushAuthQ: () => {},
      addEventListener: (t, f) => { (domListeners[t] ||= []).push(f); },
      dispatchEvent: () => true,
    };
    const doc = {
      visibilityState: "visible",
      addEventListener: (t, f) => { (domListeners[t] ||= []).push(f); },
    };
    runInSandbox(SYNC_SRC, {
      window: win,
      document: doc,
      navigator: { onLine: true },
      localStorage: {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
      },
      fetch: (url, opts) => {
        requests.push({ url: String(url), opts });
        return Promise.resolve(reply(String(url), requests.length));
      },
      // Only the "run this now" timers fire; the hour-away refresh timer and the 45s
      // sweep are recorded and ignored, so a test never waits on the clock.
      setTimeout: (fn, ms) => (ms ? 0 : setTimeout(fn, 0)),
      clearTimeout: () => {},
      setInterval: () => 0,
      CustomEvent: function (type, init) { return { type, detail: init && init.detail }; },
      console: { warn: () => {}, log: () => {} },
      Date: { now: () => NOW },
    });
    const fire = (type) => (domListeners[type] || []).forEach((f) => f({}));
    const refreshes = () => requests.filter((r) => r.url.includes("grant_type=refresh_token")).length;
    return { win, store, requests, upserted, fire, refreshes };
  }

  const EXPIRED = { token: "old.jwt", refresh: "r1", exp: NOW - 60_000, uid: "u1", email: "coach@vortex.qa" };
  const LIVE = { token: "live.jwt", refresh: "r1", exp: NOW + 3_600_000, uid: "u1", email: "coach@vortex.qa" };
  const QUEUED = [{ id: "q1", op: "upsert", table: "attendance_marks", payload: [{ sw_id: "s1", status: "present" }], status: 401, ts: NOW }];
  const GOOD_TOKEN = res(200, { access_token: "new.jwt", refresh_token: "r2", expires_in: 3600, user: { id: "u1" } });

  itAsync("a token that expired while the app slept is refreshed on boot", async () => {
    const t = boot({ auth: EXPIRED, reply: () => GOOD_TOKEN });
    await flush();
    eq(t.refreshes(), 1);
    eq(t.win.__VX_AUTH.token, "new.jwt");
  });

  itAsync("the attendance mark that failed while the token was dead is replayed", async () => {
    const t = boot({ auth: EXPIRED, failed: QUEUED, reply: () => GOOD_TOKEN });
    await flush();
    eq(t.upserted.length, 1);
    eq(t.upserted[0].table, "attendance_marks");
  });

  itAsync("the unsaved-changes banner clears once the replay lands", async () => {
    const t = boot({ auth: EXPIRED, failed: QUEUED, reply: () => GOOD_TOKEN });
    await flush();
    eq(t.win.__vxFailedCount(), 0);
  });

  itAsync("coming back to the app replays what failed while it was away", async () => {
    const t = boot({ auth: LIVE, failed: QUEUED, reply: () => GOOD_TOKEN });
    await flush();
    eq(t.upserted.length, 0, "a live token needs no refresh, so nothing has replayed yet");
    t.fire("visibilitychange");
    await flush();
    eq(t.upserted.length, 1);
  });

  itAsync("signing in again saves the waiting changes at once", async () => {
    const t = boot({ failed: QUEUED, reply: () => GOOD_TOKEN });
    await flush();
    eq(t.upserted.length, 0, "signed out: nothing can be saved yet");
    t.win.__vxSetAuth({ access_token: "fresh.jwt", refresh_token: "r9", expires_in: 3600, user: { id: "u1" } });
    await flush();
    eq(t.upserted.length, 1, "must not wait for the 45s sweep — the banner promises 'automatically'");
  });

  itAsync("a dead refresh token is reported, not retried forever", async () => {
    const t = boot({ auth: EXPIRED, failed: QUEUED, reply: () => res(400, { error: "invalid_grant" }) });
    await flush();
    eq(t.win.__vxAuthDead, true, "the banner needs this to say 'sign in again'");
    eq(t.win.__VX_AUTH, null);
    eq("vx_auth" in t.store, false, "a dead session must not survive a reload");
    eq(t.win.__vxFailedCount(), 1, "the coach's mark is kept until it can actually be saved");
    eq(t.upserted.length, 0);
  });

  // The state a coach was actually stuck in: the app still signed in, the database session
  // long gone, so every attendance mark came back 401 under "retrying automatically" — a
  // retry that could never work, for as long as the app stayed open.
  itAsync("no database session at all is reported as signed out, not as retrying", async () => {
    const t = boot({
      failed: QUEUED,
      reply: (url) => (url.includes("/attendance_marks") ? res(401, { message: "JWT expired" }) : GOOD_TOKEN),
    });
    await flush();
    eq(t.win.__vxAuthDead, false, "nothing has been refused yet");
    // A write is refused, exactly as attendance_marks was.
    t.win.__vxInsert("attendance_marks", [{ sw_id: "s1", status: "present" }]);
    await flush();
    await flush();
    eq(t.win.__vxAuthDead, true, "the banner must say sign in, not 'retrying automatically'");
  });
  itAsync("and the pointless retrying stops until somebody signs in", async () => {
    const t = boot({ failed: QUEUED, reply: () => GOOD_TOKEN });
    t.win.__vxAuthDead = true;
    const r = await t.win.__vxRetryFailed();
    eq(r.signedOut, true);
    eq(t.upserted.length, 0, "no request can succeed, so none should be sent");
    eq(t.win.__vxFailedCount(), 1, "and the coach's mark is still held, not dropped");
  });
  itAsync("signing in again clears it and the held marks go through", async () => {
    const t = boot({ failed: QUEUED, reply: () => GOOD_TOKEN });
    t.win.__vxAuthDead = true;
    t.win.__vxSetAuth({ access_token: "fresh.jwt", refresh_token: "r9", expires_in: 3600, user: { id: "u1" } });
    await flush();
    eq(t.win.__vxAuthDead, false);
    eq(t.upserted.length, 1);
  });
  // The banner's own state is only re-read on a 20-second poll. Until it catches up the
  // banner still says "Signed out" and its button still goes to the sign-in screen — which
  // would throw a coach straight back out of the app they had just signed into.
  itAsync("a successful sign-in tells the banner at once, not 20 seconds later", async () => {
    const t = boot({ failed: QUEUED, reply: () => GOOD_TOKEN });
    let told = 0;
    t.win.dispatchEvent = () => { told++; return true; };
    t.win.__vxAuthDead = true;
    t.win.__vxSetAuth({ access_token: "fresh.jwt", refresh_token: "r9", expires_in: 3600, user: { id: "u1" } });
    await flush();
    eq(t.win.__vxAuthDead, false);
    eq(told > 0, true, "the app must be told the session is good again");
  });
  it("the banner's button checks the live flag, not the rendered one", () =>
    eq(/const dead = \(typeof window!=='undefined'\) \? !!window\.__vxAuthDead/.test(SOURCE), true));

  // Once the database tells staff and families apart, a parent's phone will be refused
  // writes it was never meant to make. A refusal retried for ever is a red banner that
  // never clears, about a change that was never theirs.
  itAsync("a refused write is not retried, because the answer cannot change", async () => {
    const REFUSED = [{ id: "r1", op: "upsert", table: "attendance_marks", payload: [{}], status: 403, refused: true, ts: NOW }];
    const t = boot({ auth: LIVE, failed: REFUSED, reply: () => GOOD_TOKEN });
    const r = await t.win.__vxRetryFailed();
    eq(r.tried, 0);
    eq(t.upserted.length, 0);
  });
  itAsync("but it is kept on file rather than silently dropped", async () => {
    const REFUSED = [{ id: "r1", op: "upsert", table: "attendance_marks", payload: [{}], status: 403, refused: true, ts: NOW }];
    const t = boot({ auth: LIVE, failed: REFUSED, reply: () => GOOD_TOKEN });
    await t.win.__vxRetryFailed();
    eq(t.win.__vxFailedCount(), 1, "somebody has to be able to see what was refused");
  });
  itAsync("a refusal does not hold up the writes that can still succeed", async () => {
    const mixed = [
      { id: "r1", op: "upsert", table: "attendance_marks", payload: [{}], status: 403, refused: true, ts: NOW },
      { id: "q1", op: "upsert", table: "attendance_marks", payload: [{ sw_id: "s1" }], status: 401, ts: NOW },
    ];
    const t = boot({ auth: LIVE, failed: mixed, reply: () => GOOD_TOKEN });
    await t.win.__vxRetryFailed();
    eq(t.upserted.length, 1, "the recoverable one must still go through");
  });
  it("the backfill of the whole register is staff-only", () =>
    eq(/window\.__VX_AUTH\.token && this\._isStaffSession\(\)/.test(SOURCE), true));

  itAsync("signing out on purpose is not the same as being thrown out", async () => {
    const t = boot({ auth: LIVE, reply: () => GOOD_TOKEN });
    t.win.__vxAuthDead = true;
    t.win.__vxClearAuth();
    eq(t.win.__vxAuthDead, false, "the login screen must not warn the next person");
  });

  itAsync("many stale calls at once cause one refresh, not a stampede", async () => {
    let release;
    const held = new Promise((r) => { release = r; });
    const t = boot({ auth: EXPIRED, reply: () => held });
    t.win.__vxEnsureAuth();
    t.win.__vxEnsureAuth();
    t.win.__vxEnsureAuth();
    await flush();
    eq(t.refreshes(), 1);
    release(GOOD_TOKEN);
    await flush();
  });

  itAsync("a read rejected as 401 is asked again with a fresh token", async () => {
    const rows = [{ sw_id: "s1", status: "present" }];
    const t = boot({
      auth: LIVE,
      reply: (url) => (url.includes("grant_type=refresh_token") ? GOOD_TOKEN
        : t.requests.filter((r) => r.url.includes("/attendance_marks")).length === 1 ? res(401, { message: "JWT expired" })
        : res(200, rows)),
    });
    const got = await t.win.__vxSelect("attendance_marks", "select=*");
    eq(got, rows, "an expired token must not look like an empty squad");
    eq(t.refreshes(), 1);
  });

  itAsync("a read that is still refused after refreshing gives up quietly", async () => {
    const t = boot({ auth: LIVE, reply: (url) => (url.includes("grant_type=refresh_token") ? GOOD_TOKEN : res(401, {})) });
    const got = await t.win.__vxSelect("attendance_marks", "select=*");
    eq(got, null);
    eq(t.requests.filter((r) => r.url.includes("/attendance_marks")).length, 2, "one retry, never a loop");
  });
});

/* ------------------------------------------------------------ InBody sheets
   Read from a real InBody 580 result the club sent in — a CamScanner photograph,
   so the text below carries the damage OCR actually does: spaces inside numbers,
   O for 0, labels running together. A misread here puts a wrong body-fat figure on
   a child's record looking exactly as authoritative as a correct one. */
describe("InBody sheet", () => {
  const parse = bind("_extractInbodyFields", {});

  // The club's own sheet: InBody 580, 14 July 2026, 15-year-old boy, 167cm.
  const sheet = `
    InBody [InBody580]
    ID 7189****5  Height 167cm  Age 15  Gender Male  Test Date / Time 2026.07.14 08:42
    Body Composition Analysis
    Total Body Water (L) 36. 3 (30.9~37.7)  Soft Lean Mass 46. 7  Fat Free Mass 49. 5  Weight 55. 8
    Protein (kg) 9. 7 (8.3~10.1)
    Minerals (kg) 3. 50 (2.86~3.50)
    Body Fat Mass (kg) 6. 3 (6.6~13.2)
    Muscle-Fat Analysis
    Weight (kg) 55 70 85 100 115 130 145 160 175 190 205 % 55. 8
    SMM Skeletal Muscle Mass (kg) 70 80 90 100 110 120 130 140 150 160 170 % 27. 4
    Body Fat Mass (kg) 40 60 80 100 160 220 280 340 400 460 520 % 6. 3
    Obesity Analysis
    BMI Body Mass Index (kg/m2) 10.2 13.2 16.2 19.8 22.8 25.2 27.2 29.2 31.2 33.2 35.2 2O. O
    PBF Percent Body Fat (%) 0.0 5.0 10.0 15.0 20.0 25.0 30.0 35.0 40.0 45.0 50.0 11. 4
    ECW Ratio-Phase Angle  ECW Ratio 0. 379  Phase Angle 5. 7
    InBody Score 83 /100 Points
    Visceral Fat Area VFA(cm2) 25. 5
    Weight Control  Target Weight 55. 8 kg  Weight Control 0. 0 kg  Fat Control 0. 0 kg  Muscle Control 0. 0 kg
    Research Parameters
    Intracellular Water 22. 5 L (19.2~23.4)
    Extracellular Water 13. 8 L (11.7~14.3)
    Basal Metabolic Rate 1438 kcal (1292~1490)
    Waist-Hip Ratio 0. 78 (0.80~0.90)
    Obesity Degree 102 % (90~110)
    Bone Mineral Content 2. 85 kg (2.36~2.88)
    Body Cell Mass 32. 2 kg (27.5~33.6)
    SMI 7. 1 kg/m2
  `;
  const out = parse(sheet);

  it("reads the weight", () => eq(out.weight, 55.8));
  it("a space inside the number does not cost 800 grams", () =>
    eq(out.weight, 55.8, "OCR writes '55. 8' — matching only '55' is silently wrong"));
  it("reads skeletal muscle mass", () => eq(out.smm, 27.4));
  it("reads percent body fat", () => eq(out.pbf, 11.4));
  it("reads body fat mass", () => eq(out.bodyFatMass, 6.3));
  it("reads BMI even when OCR wrote it as 2O.O", () => eq(out.bmi, 20));
  it("reads basal metabolic rate", () => eq(out.bmr, 1438));
  it("reads visceral fat area", () => eq(out.visceralFat, 25.5));
  it("reads total body water", () => eq(out.tbw, 36.3));
  it("reads protein", () => eq(out.protein, 9.7));
  it("reads minerals", () => eq(out.minerals, 3.5));
  it("reads the InBody score", () => eq(out.score, 83));
  it("reads the phase angle", () => eq(out.phaseAngle, 5.7));
  it("reads the ECW ratio", () => eq(out.ecwRatio, 0.379));
  it("reads intracellular water", () => eq(out.icw, 22.5));
  it("reads extracellular water", () => eq(out.ecw, 13.8));
  it("reads the waist-hip ratio", () => eq(out.whr, 0.78));
  it("reads bone mineral content", () => eq(out.boneMineral, 2.85));
  it("reads body cell mass", () => eq(out.bodyCellMass, 32.2));
  it("reads obesity degree", () => eq(out.obesityDegree, 102));
  it("reads SMI", () => eq(out.smi, 7.1));
  it("reads fat free mass", () => eq(out.ffm, 49.5));
  it("reads height", () => eq(out.height, 167));

  it("takes the swimmer's weight, not the target beside it", () =>
    eq(out.weight !== 0, true, "Weight Control reads 0.0 kg on this sheet"));
  it("dates the record from the test, not the day it was scanned", () =>
    eq(out.testDate, "2026-07-14", "a July test must not land on the chart as today"));

  // In-browser OCR must fetch a worker, a WASM core and a large language model before it can
  // read a thing. Without a deadline the app sat on "reading it as a picture" and never came
  // back — which is what a coach actually saw.
  it("reading a photo has a deadline it cannot outlive", () =>
    eq(/Promise\.race\(\[work, deadline\]\)/.test(SOURCE), true));
  it("the server is asked first, and a missing key falls back instead of stalling", () => {
    eq(/_readSheetOnServer/.test(SOURCE), true);
    eq(/if\(j\.notConfigured\) return \{notConfigured:true\}/.test(SOURCE), true);
    // "no key", "key rejected" and "read nothing" are different problems and were all
    // reported as the same sentence, which sent a coach hunting for a key already set.
    eq(/the key was rejected/.test(SOURCE), true);
  });
  it("the photo is shrunk before it is sent, not posted at 12 megapixels", () =>
    eq(/const max=1600/.test(SOURCE), true));
  it("the key never leaves the server", () => {
    const route = readFileSync(new URL("../src/app/api/inbody/read/route.ts", import.meta.url), "utf8");
    eq(/process\.env\.ANTHROPIC_API_KEY/.test(route), true);
    eq(/x-api-key/.test(SOURCE), false, "a secret key must never be in the page");
  });
  it("only the fields we asked for come back, as numbers", () => {
    const route = readFileSync(new URL("../src/app/api/inbody/read/route.ts", import.meta.url), "utf8");
    eq(/Number\.isFinite\(n\)/.test(route), true, "a stray sentence must not reach a child's record");
  });
  it("every reading the import stores is shown, not just three", () => {
    const shown = (SOURCE.match(/const IB_FIELDS=\[[\s\S]*?\];/) || [""])[0];
    for (const k of ["bmi", "score", "tbw", "icw", "ecw", "ecwRatio", "phaseAngle", "smi", "bmr", "visceralFat", "whr", "boneMineral", "bodyCellMass", "obesityDegree"])
      eq(shown.includes("'" + k + "'"), true, k + " is parsed and stored but never shown");
  });

  // What a phone camera actually produced from this sheet: 5 kg of muscle, a protein figure
  // lifted off a printed axis, a phase angle of 10. Every one of those looks like a reading.
  describeSanity();
  function describeSanity() {
    const check = bind("_inbodySanity", {});

    it("the real sheet reconciles", () => {
      const r = check({ weight: 55.8, bodyFatMass: 6.3, ffm: 49.5, pbf: 11.4, bmi: 20, height: 167,
                        tbw: 36.3, icw: 22.5, ecw: 13.8, ecwRatio: 0.379, smm: 27.4, protein: 9.7, minerals: 3.5 });
      eq(r.reconciled, true);
      eq(r.values.smm, 27.4);
      eq(r.values.pbf, 11.4);
    });
    it("5 kg of muscle on a 55.8 kg swimmer is thrown out", () => {
      const r = check({ weight: 55.8, muscle: 5, smm: 5 });
      eq(r.values.smm, undefined);
    });
    it("a phase angle read off an axis does not survive an unreconciled sheet", () => {
      const r = check({ weight: 55.8, phaseAngle: 10, visceralFat: 60 });
      eq(r.reconciled, false, "nothing cross-checks, so nothing should be trusted");
    });
    it("a percent body fat that contradicts the fat mass is dropped", () => {
      const r = check({ weight: 55.8, bodyFatMass: 6.3, pbf: 35 });
      eq(r.values.pbf, undefined);
      eq(r.values.bodyFatMass, 6.3, "the two disagree; the one with an arithmetic basis stays");
    });
    it("a BMI that does not follow from height and weight is dropped", () => {
      const r = check({ weight: 55.8, height: 167, bmi: 31 });
      eq(r.values.bmi, undefined);
    });
    it("body waters that do not add up to the total are dropped", () => {
      const r = check({ weight: 55.8, tbw: 36.3, icw: 22.5, ecw: 30 });
      eq(r.values.icw, undefined);
      eq(r.values.ecw, undefined);
    });
    it("without a weight there is nothing to check anything against", () => {
      const r = check({ pbf: 11.4, smm: 27.4 });
      eq(r.reconciled, false);
      eq(r.values.smm, undefined);
    });
    it("the test date survives a sheet that could not be read", () => {
      const r = check({ testDate: "2026-07-14", pbf: 11.4 });
      eq(r.values.testDate, "2026-07-14");
    });
  }

  it("height is kept, not read and thrown away", () => {
    eq(/height:data\.height\|\|null/.test(SOURCE), true);
    eq(/\['height','Height',' cm'\]/.test(SOURCE), true);
  });

  it("an unreadable photo yields nothing rather than a guess", () => {
    const junk = parse("~~~ blurry ~~~ 3 4 5 ~~~");
    eq(junk.weight, undefined);
    eq(junk.pbf, undefined);
  });
  it("a value outside anything a person could be is rejected", () => {
    const silly = parse("Weight (kg) 4231.9  PBF 980");
    eq(silly.weight, undefined);
    eq(silly.pbf, undefined);
  });
});

/* --------------------------------------------------- editing from the profile
   A manager fixing a swimmer's record must not lose the rest of it, and must not
   lose the swimmer either — an edit that moves them to another squad while you are
   looking at them has to keep them on screen. */
describe("editing a swimmer", () => {
  const base = () => ({
    roster: { junior: [{ id: "s1", name: "Tamara Aly", dob: "17/04/2017", pbs: [{ event: "50 Free", sec: 40 }], results: [{ meet: "Cup", sec: 40 }] }],
              adva: [] },
    squads: [{ id: "junior", name: "Junior" }, { id: "adva", name: "Advanced A" }],
    rosterEdits: { edits: { junior: { s1: { results: [{ meet: "Cup", sec: 40 }] } } }, deleted: {}, added: {} },
    persistRosterEdits() { this.persisted = true; },
    setState() {},
  });

  it("an edit keeps everything it did not touch", () => {
    const c = base();
    bind("adminEditSwimmer", c, ["_deriveFromEntries"])("junior", "s1", { name: "Tamara Aly", dob: "2017-04-17" });
    const saved = c.rosterEdits.edits.junior.s1;
    eq(saved.dob, "2017-04-17");
    eq(saved.results.length, 1, "the swimmer's meet history must survive a name change");
  });
  it("the edit is written where the roster reads it back from", () => {
    const c = base();
    bind("adminEditSwimmer", c, ["_deriveFromEntries"])("junior", "s1", { dob: "2017-04-17" });
    eq(c.persisted, true, "without this the change would not survive a reload");
  });
  it("moving a swimmer takes them out of the old squad", () => {
    const c = base();
    bind("adminEditSwimmer", c, ["_deriveFromEntries"])("junior", "s1", { name: "Tamara Aly" }, "adva");
    eq(c.rosterEdits.deleted.junior.s1, true);
    eq(c.rosterEdits.added.adva.length, 1);
  });
  it("and carries their record with them", () => {
    const c = base();
    bind("adminEditSwimmer", c, ["_deriveFromEntries"])("junior", "s1", { name: "Tamara Aly" }, "adva");
    eq(c.rosterEdits.added.adva[0].pbs.length, 1, "a moved swimmer must not arrive empty");
  });

  // The roster is where ~20 places read a swimmer's age straight off the object: the talent
  // board, the promotion checks, the relay age bands, the age-scaled suggestions, the export.
  // Deriving it once here is what makes all of them right at the same time.
  it("the age on the roster follows the date of birth", () => {
    const c = {
      squads: [{ id: "junior", name: "Junior", count: 0 }],
      rosterEdits: { edits: {}, deleted: {}, added: {} },
    };
    globalThis.window = { VX_ROSTER: { junior: [
      { id: "s1", name: "Tamara Aly", dob: "17/04/2017", age: 8 },   // stale stored age
      { id: "s2", name: "No Dob", age: 11 },                          // nothing to derive from
    ] } };
    bind("rebuildRoster", c, ["_ageFromDob", "_dobParts"])();
    const now = new Date();
    let expected = now.getFullYear() - 2017;
    if (now.getMonth() + 1 < 4 || (now.getMonth() + 1 === 4 && now.getDate() < 17)) expected--;
    eq(c.roster.junior[0].age, expected, "the stored 8 must not survive a real date of birth");
    eq(c.roster.junior[1].age, 11, "a swimmer with no date keeps the age the club typed");
  });

  it("only the club's managers get the editor", () =>
    eq(/const canEdit=this\._isAdmin\(\);\s*\n\s*if\(!canEdit\) return \{profCanEdit:false\}/.test(SOURCE), true));
  it("a date that is not a date is refused before it is saved", () =>
    eq(/That date of birth is not a real date/.test(SOURCE), true));
  it("saving follows the swimmer if the edit moved them", () =>
    eq(/squadId: moved \|\| S\.squadId, swimmerId: swObj\.id/.test(SOURCE), true));
});

/* --------------------------------------------------------- dates of birth
   The club writes them day first. Reading 17/04/2017 as month 17 does not throw —
   JavaScript rolls it into May 2018 — so a real child was shown a year younger than
   she is, and the same slip sat inside every age band, promotion check and
   age-scaled suggestion in the app. */
describe("dates of birth", () => {
  const ctx = {};
  const parts = bind("_dobParts", ctx);
  const age = bind("_ageFromDob", ctx, ["_dobParts"]);
  const swDob = bind("_swDob", ctx, ["_dobParts"]);

  it("reads the club's own format, day first", () => eq(parts("17/04/2017").iso, "2017-04-17"));
  it("17 is not a month, and is not rolled into one", () => eq(parts("17/04/2017").mo, 4));
  it("Tamara Aly is 9, not 8", () => {
    // The screenshot that found this: "Age 8 · DOB 17/04/2017".
    const p = parts("17/04/2017");
    const now = new Date("2026-08-08T00:00:00");
    let a = now.getFullYear() - p.y;
    if (now.getMonth() + 1 < p.mo || (now.getMonth() + 1 === p.mo && now.getDate() < p.d)) a--;
    eq(a, 9);
  });
  it("an ambiguous date is still read day first, not swapped", () => {
    const p = parts("04/05/2017");
    eq([p.d, p.mo], [4, 5], "4 May, the way the club writes it");
  });
  it("an ISO date is still understood", () => eq(parts("2017-04-17").iso, "2017-04-17"));
  it("both formats agree on the same day", () => eq(parts("17/04/2017").iso, parts("2017-04-17").iso));

  it("31 February is refused, not rolled into March", () => eq(parts("31/02/2017"), null));
  it("month 13 is refused", () => eq(parts("01/13/2017"), null));
  it("day 32 is refused", () => eq(parts("32/01/2017"), null));
  it("a year nobody was born in is refused", () => eq(parts("17/04/1750"), null));
  it("nonsense is refused rather than half-read", () => eq(parts("not a date"), null));
  it("an empty value is simply missing", () => eq(parts(""), null));

  it("age comes back as a number for a real date", () => eq(typeof age("17/04/2017"), "number"));
  it("and as nothing for a date we do not have", () => eq(age(""), null));

  it("a swimmer with no date shows it as missing", () => eq(swDob({ age: 8 }), "—"));
  it("not as a date invented from their age", () => eq(/2018|01\/01/.test(swDob({ age: 8 })), false));
  it("a real date is shown the way the club writes it", () => eq(swDob({ dob: "2017-04-17" }), "17/04/2017"));

  it("the birthday check sees a date in the club's format", () => {
    const c = {};
    const iso = bind("_bdayISO", c, ["_dobParts"]);
    eq(iso({ dob: "17/04/2017" }), "2017-04-17", "298 swimmers were invisible to it");
  });
});

/* ------------------------------------------------------------------ birthdays
   This messages children and their parents in the club's name, on its own. Wishing
   the wrong child, wishing one twice, or wishing one on a date the app made up are
   all worse than never sending anything. */
describe("birthdays", () => {
  const ctx = () => ({
    squads: [{ id: "junior", name: "Junior" }],
    roster: { junior: [
      { id: "s1", name: "Hannah Millen", dob: "2013-08-08" },
      { id: "s2", name: "Omar Ali", dob: "2012-02-29" },   // leap-year birthday
      { id: "s3", name: "No Dob Kid", age: 12 },           // age only — no real date
    ] },
    todayISO: () => "2026-08-08",
    brandConfig: { clubName: "Vortex Swimming Club" },
    bdaySent: {},
    famMessages: {},
    state: {},
    setState() {}, forceUpdate() {}, notify() {}, _pushSend() {}, _saveJSON() {},
  });
  const sw = (c, id) => c.roster.junior.find((x) => x.id === id);

  const c0 = ctx();
  const isToday = bind("_bdayIsToday", c0, ["_bdayMD", "_bdayISO", "_bdayDateIn", "_dobParts"]);
  const away = bind("_bdayDaysAway", c0, ["_bdayMD", "_bdayISO", "_bdayDateIn", "_dobParts"]);
  const turning = bind("_bdayTurning", c0, ["_bdayISO", "_bdayDateIn", "_dobParts"]);
  const dobOf = bind("_bdayISO", c0, ["_dobParts"]);

  it("a swimmer whose birthday is today is found", () => eq(isToday(sw(c0, "s1"), "2026-08-08"), true));
  it("and not on any other day", () => eq(isToday(sw(c0, "s1"), "2026-08-09"), false));
  it("a swimmer with only an age has no birthday to wish", () => eq(dobOf(sw(c0, "s3")), null));
  it("an age-derived date is never treated as a birthday", () =>
    eq(isToday({ id: "x", age: 12 }, "2026-08-08"), false, "_swDob() invents one — this must not use it"));

  it("counts the days to the next birthday", () => eq(away(sw(c0, "s1"), "2026-08-01"), 7));
  it("today is zero days away", () => eq(away(sw(c0, "s1"), "2026-08-08"), 0));
  it("a birthday just gone rolls to next year", () => eq(away(sw(c0, "s1"), "2026-08-09"), 364));

  it("29 February is wished on the 28th in a common year", () => eq(isToday(sw(c0, "s2"), "2027-02-28"), true));
  it("and on the 29th in a leap year", () => eq(isToday(sw(c0, "s2"), "2028-02-29"), true));
  it("a leap-year child is never simply skipped", () => eq(away(sw(c0, "s2"), "2027-01-01") <= 365, true));

  it("the age they turn is right on the day", () => eq(turning(sw(c0, "s1"), "2026-08-08"), 13));
  it("and the day before, they are still the year younger", () => eq(turning(sw(c0, "s1"), "2026-08-07"), 12));

  itAsync("a coach opening the app wishes today's birthdays", async () => {
    const c = ctx();
    c.allSwimmersFlat = () => c.roster.junior.map((x) => ({ ...x, squadName: "Junior" }));
    const wished = [];
    c.birthdayWish = (id) => { wished.push(id); return Promise.resolve(); };
    c._isStaffSession = () => true;
    globalThis.window = { __VX_AUTH: { token: "t" } };
    const run = bind("birthdayRun", c, ["_bdayIsToday", "_bdayMD", "_bdayISO", "_bdayDateIn", "_dobParts", "_bdayTurning", "_bdaySentMap"]);
    await run();
    eq(wished, ["s1"], "only the swimmer whose birthday it actually is");
    eq(c.bdaySent.s1, "2026", "and it is recorded so it cannot go twice");
  });

  itAsync("a second device the same day sends nothing", async () => {
    const c = ctx();
    c.allSwimmersFlat = () => c.roster.junior.map((x) => ({ ...x, squadName: "Junior" }));
    c.bdaySent = { s1: "2026" };
    const wished = [];
    c.birthdayWish = (id) => { wished.push(id); return Promise.resolve(); };
    c._isStaffSession = () => true;
    globalThis.window = { __VX_AUTH: { token: "t" } };
    const run = bind("birthdayRun", c, ["_bdayIsToday", "_bdayMD", "_bdayISO", "_bdayDateIn", "_dobParts", "_bdayTurning", "_bdaySentMap"]);
    await run();
    eq(wished, [], "five coaches opening the app is still one greeting");
  });

  itAsync("a parent's phone never sends in the club's name", async () => {
    const c = ctx();
    c.allSwimmersFlat = () => c.roster.junior.map((x) => ({ ...x, squadName: "Junior" }));
    const wished = [];
    c.birthdayWish = (id) => { wished.push(id); return Promise.resolve(); };
    c._isStaffSession = () => false;
    globalThis.window = { __VX_AUTH: { token: "t" } };
    const run = bind("birthdayRun", c, ["_bdayIsToday", "_bdayMD", "_bdayISO", "_bdayDateIn", "_dobParts", "_bdayTurning", "_bdaySentMap"]);
    await run();
    eq(wished, []);
  });

  itAsync("a signed-out device does not claim the send it cannot make", async () => {
    const c = ctx();
    c.allSwimmersFlat = () => c.roster.junior.map((x) => ({ ...x, squadName: "Junior" }));
    const wished = [];
    c.birthdayWish = (id) => { wished.push(id); return Promise.resolve(); };
    c._isStaffSession = () => true;
    globalThis.window = {};                       // no token
    const run = bind("birthdayRun", c, ["_bdayIsToday", "_bdayMD", "_bdayISO", "_bdayDateIn", "_dobParts", "_bdayTurning", "_bdaySentMap"]);
    await run();
    eq(wished, []);
    eq(c.bdaySent.s1, undefined, "marking it sent here would lose the greeting for good");
  });

  it("the managers get their own notification, not the whole coaching staff", () =>
    eq(/this\.notify\('admin', 'cake'/.test(SOURCE), true));
  it("and the feed actually understands an admin-only note", () =>
    eq(/n\.audience==='admin' && this\._isAdmin\(\)/.test(SOURCE), true));
});

/* ----------------------------------------------------------- the club's week
   Qatar: the training week runs Saturday → Friday. Get this wrong and every
   calendar is shifted by two columns and every "this week" total counts the
   wrong days — quietly, in a way that looks plausible. */
describe("club week", () => {
  const ctx = {};
  const dow = bind("_dowIndex", ctx, ["_weekStartDow"]);
  const weekStart = bind("_weekStartISO", ctx, ["_dowIndex", "_weekStartDow"]);
  const labels = bind("_weekdayLabels", ctx);
  const d = (iso) => new Date(iso + "T00:00:00");

  it("Saturday is the first day", () => eq(dow(d("2026-08-08")), 0));
  it("Sunday is the second", () => eq(dow(d("2026-08-09")), 1));
  it("Monday is the third", () => eq(dow(d("2026-08-10")), 2));
  it("Friday is the last", () => eq(dow(d("2026-08-14")), 6));
  it("every day of the week has its own column", () => {
    const seen = [0, 1, 2, 3, 4, 5, 6].map((k) => dow(d("2026-08-" + String(8 + k).padStart(2, "0"))));
    eq(seen, [0, 1, 2, 3, 4, 5, 6]);
  });

  it("a Saturday is its own week start", () => eq(weekStart("2026-08-08"), "2026-08-08"));
  it("Sunday belongs to the Saturday before it", () => eq(weekStart("2026-08-09"), "2026-08-08"));
  it("Friday belongs to the Saturday six days back", () => eq(weekStart("2026-08-14"), "2026-08-08"));
  it("the next Saturday starts a new week", () => eq(weekStart("2026-08-15"), "2026-08-15"));
  it("a week start can cross into the previous month", () => eq(weekStart("2026-09-01"), "2026-08-29"));
  it("and into the previous year", () => eq(weekStart("2026-01-01"), "2025-12-27"));

  it("the labels start on Saturday", () => eq(labels()[0], "Sa"));
  it("and end on Friday", () => eq(labels()[6], "F"));
  it("there are seven of them", () => eq(labels().length, 7));

  // Every calendar and weekly total must read the week from that one place, or one of them
  // will quietly drift back to Monday the next time somebody edits it.
  it("no Monday-first arithmetic is left anywhere", () =>
    eq((SOURCE.match(/getDay\(\)\+6\)%7/g) || []).length, 0));
  it("no hardcoded Monday-first weekday strip is left", () =>
    eq(SOURCE.includes("['M','T','W','T','F','S','S']"), false));
  it("the admin chart is measured, not a fixed array", () =>
    eq(SOURCE.includes("[38,42,31,46,40,52,22]"), false, "invented numbers that never moved"));
  it("the attendance ring is measured, not a fixed 87%", () =>
    eq(SOURCE.includes("pct:'87%'"), false));
});

/* ------------------------------------------------------------- sign-in speed
   Signing in used to reload the whole page and then read the club's entire
   attendance history before showing anything. On mobile data that is the
   difference between "Checking…" for a few seconds and for half a minute. */
describe("sign-in speed", () => {
  const asked = [];
  // Installed per test, not once: these run interleaved with other suites that also stub
  // globalThis.window, and whichever ran last would otherwise own it.
  const stubWindow = () => {
    globalThis.window = {
      __VX_AUTH: { token: "t", refresh: "r" },
      __vxSelect: (table, qs) => { asked.push(qs); return Promise.resolve([]); },
    };
  };
  const newCtx = () => ({ attendLog: {}, todayISO: () => "2026-08-08", _saveLocalOnly() {}, forceUpdate() {} });

  itAsync("the live poll asks for one day, not the table", async () => {
    stubWindow(); asked.length = 0;
    await bind("_attendFetch", newCtx(), ["shiftDate"])("2026-08-08");
    eq(asked[0].includes("day=eq.2026-08-08"), true);
  });
  itAsync("a bounded catch-up asks only for days since a date", async () => {
    stubWindow(); asked.length = 0;
    await bind("_attendFetch", newCtx(), ["shiftDate"])(null, "2026-04-10");
    eq(asked[0].includes("day=gte.2026-04-10"), true);
  });
  itAsync("a single day never also carries a range", async () => {
    stubWindow(); asked.length = 0;
    await bind("_attendFetch", newCtx(), ["shiftDate"])("2026-08-08", "2026-04-10");
    eq(asked[0].includes("gte"), false);
  });

  itAsync("signing in reads the recent window first, not all of history", async () => {
    stubWindow(); asked.length = 0;
    stubWindow();
    const ctx = newCtx();
    bind("_attendFetchStaged", ctx, ["_attendFetch", "shiftDate", "_isStaffSession"])();
    await new Promise((r) => setTimeout(r, 5));
    eq(asked.length, 1, "one read, not a full-table read as well");
    eq(asked[0].includes("day=gte.2026-04-10"), true, "120 days back from 2026-08-08");
  });
  itAsync("the full history follows later, so nothing is lost", async () => {
    stubWindow();
    const ctx = newCtx();
    bind("_attendFetchStaged", ctx, ["_attendFetch", "shiftDate", "_isStaffSession"])();
    await new Promise((r) => setTimeout(r, 5));
    eq(!!ctx._attendFullTimer, true, "the catch-up must be scheduled, not skipped");
    clearTimeout(ctx._attendFullTimer);
  });
  itAsync("and the backfill of old marks is kept off the sign-in path", async () => {
    const ctx = newCtx();
    let migrated = false;
    ctx._attendMigrate = () => { migrated = true; };
    bind("_attendFetchStaged", ctx, ["_attendFetch", "shiftDate", "_isStaffSession"])();
    await new Promise((r) => setTimeout(r, 5));
    eq(migrated, false, "it uploads the whole history in batches — never while signing in");
    clearTimeout(ctx._attendFullTimer);
  });

  it("signing in no longer reloads the whole app", () => {
    const login = SOURCE.slice(SOURCE.indexOf("_postLoginRefresh()"), SOURCE.indexOf("_refetchAll()"));
    eq(/location\.reload/.test(login), false, "re-downloading 1.1MB on mobile data was the wait");
  });
  it("the app is shown before the background fetches, not after", () => {
    const i = SOURCE.indexOf("doLogin(acct);\n            try{ this._refetchAll()");
    eq(i > -1, true, "doLogin must run first so the screen switches immediately");
  });
  it("the shared club data is pulled once per sign-in, not twice", () =>
    eq(/_repullOnce\(\)/.test(SOURCE) && !/if\(window\.__vxRepull\) window\.__vxRepull\(\);\s*\}catch\(e\)\{\}\s*\['_plansFetch','_squadPlansFetch','_seasonFetch','_fitSessFetch','_fitPlansFetch','_famMsgFetch','_alertsFetch','_annFetch','_docsFetch','_wearFetch'/.test(SOURCE), true));
});

await report();
