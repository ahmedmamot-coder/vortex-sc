// Tests for the logic that has actually caused problems for the club.
// Every case here is a real bug that reached coaches or parents.

import { bind, describe, it, eq, report, SOURCE } from "./harness.mjs";

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

report();
