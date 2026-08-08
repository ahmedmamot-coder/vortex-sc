// Tests for the logic that has actually caused problems for the club.
// Every case here is a real bug that reached coaches or parents.

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
  globalThis.window = {
    __VX_AUTH: { token: "t", refresh: "r" },
    __vxSelect: (table, qs) => { asked.push(qs); return Promise.resolve([]); },
  };
  const newCtx = () => ({ attendLog: {}, todayISO: () => "2026-08-08", _saveLocalOnly() {}, forceUpdate() {} });

  itAsync("the live poll asks for one day, not the table", async () => {
    asked.length = 0;
    await bind("_attendFetch", newCtx(), ["shiftDate"])("2026-08-08");
    eq(asked[0].includes("day=eq.2026-08-08"), true);
  });
  itAsync("a bounded catch-up asks only for days since a date", async () => {
    asked.length = 0;
    await bind("_attendFetch", newCtx(), ["shiftDate"])(null, "2026-04-10");
    eq(asked[0].includes("day=gte.2026-04-10"), true);
  });
  itAsync("a single day never also carries a range", async () => {
    asked.length = 0;
    await bind("_attendFetch", newCtx(), ["shiftDate"])("2026-08-08", "2026-04-10");
    eq(asked[0].includes("gte"), false);
  });

  itAsync("signing in reads the recent window first, not all of history", async () => {
    asked.length = 0;
    const ctx = newCtx();
    bind("_attendFetchStaged", ctx, ["_attendFetch", "shiftDate"])();
    await new Promise((r) => setTimeout(r, 5));
    eq(asked.length, 1, "one read, not a full-table read as well");
    eq(asked[0].includes("day=gte.2026-04-10"), true, "120 days back from 2026-08-08");
  });
  itAsync("the full history follows later, so nothing is lost", async () => {
    const ctx = newCtx();
    bind("_attendFetchStaged", ctx, ["_attendFetch", "shiftDate"])();
    await new Promise((r) => setTimeout(r, 5));
    eq(!!ctx._attendFullTimer, true, "the catch-up must be scheduled, not skipped");
    clearTimeout(ctx._attendFullTimer);
  });
  itAsync("and the backfill of old marks is kept off the sign-in path", async () => {
    const ctx = newCtx();
    let migrated = false;
    ctx._attendMigrate = () => { migrated = true; };
    bind("_attendFetchStaged", ctx, ["_attendFetch", "shiftDate"])();
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
