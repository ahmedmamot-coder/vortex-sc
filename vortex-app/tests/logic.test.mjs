// Tests for the logic that has actually caused problems for the club.
// Every case here is a real bug that reached coaches or parents.

import { readFileSync } from "node:fs";
import { bind, describe, it, itAsync, eq, report, SOURCE, sourceBetween, runInSandbox } from "./harness.mjs";
// The real route module. Node strips the types, so these tests run the filter that ships
// rather than a regex-mangled copy of it.
const AI_ROUTE = await import("../src/app/api/ai/coach/route.ts");

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
  // A coach typed an InBody sheet in, saved it, saw it on the record, refreshed, and it was
  // gone. It had not failed to save: it was in localStorage the whole time. The pull sets an
  // in-memory mirror of the database and the app reads that mirror in preference to disk, and
  // the mirror was being assigned the server's copy before the newer-than check was even made.
  // So the check protected the copy on disk while the screen showed the stale one. Losing a
  // coach's work in silence is the worst thing this file can do.
  describe("a pull never shows an older copy than the one on disk", () => {
    const applyPull = (rows, disk, ts) => {
      const store = { ...disk };
      Object.keys(ts).forEach((k) => { store["__vxts_" + k] = String(ts[k]); });
      const pushed = [];
      const env = {
        localStorage: {
          getItem: (k) => (k in store ? store[k] : null),
          setItem: (k, v) => { store[k] = v; },
          get length() { return Object.keys(store).length; },
          key: (i) => Object.keys(store)[i],
        },
        window: { __VX_PULLED: {} },
        origSet: (k, v) => { store[k] = v; },
        pushKey: (k, v) => pushed.push([k, v]),
        SYNC: [],
      };
      const src = sourceBetween("function applyPull(rows, seed){", "\n  // Re-pull the shared club");
      runInSandbox(src + "\napplyPull(rows, false);", { ...env, rows });
      return { mirror: env.window.__VX_PULLED, disk: store, pushed };
    };
    const SHEET = { s1: { inbody: [{ date: "2026-07-14", weight: 55.8 }] } };
    const EMPTY = { s1: { inbody: [] } };

    it("the newer local sheet is what the app reads, not the stale server one", () => {
      const out = applyPull(
        [{ key: "vx_sw_meta", value: EMPTY, updated_at: "2026-08-09T12:00:00Z" }],
        { vx_sw_meta: JSON.stringify(SHEET) },
        { vx_sw_meta: Date.parse("2026-08-09T13:00:00Z") });
      eq(JSON.stringify(out.mirror.vx_sw_meta), JSON.stringify(SHEET), "the mirror handed back the empty server copy — this is the bug");
      eq(JSON.parse(out.disk.vx_sw_meta).s1.inbody.length, 1, "and disk must keep it too");
      eq(out.pushed.length, 1, "the newer copy is pushed up so the server catches up");
    });
    it("a genuinely newer server copy is still taken", () => {
      const out = applyPull(
        [{ key: "vx_sw_meta", value: SHEET, updated_at: "2026-08-09T14:00:00Z" }],
        { vx_sw_meta: JSON.stringify(EMPTY) },
        { vx_sw_meta: Date.parse("2026-08-09T13:00:00Z") });
      eq(JSON.stringify(out.mirror.vx_sw_meta), JSON.stringify(SHEET));
      eq(out.pushed.length, 0);
    });
    it("with nothing on this device the server copy is taken", () => {
      const out = applyPull([{ key: "vx_sw_meta", value: SHEET, updated_at: "2026-08-09T14:00:00Z" }], {}, {});
      eq(JSON.stringify(out.mirror.vx_sw_meta), JSON.stringify(SHEET));
    });

    // The marker on disk is only written when the write to disk succeeded, and vx_sw_meta holds
    // every swimmer in the club. On a full browser storage that write fails, no marker is left,
    // and the value — which is in memory and has already been sent to the database — was judged
    // older than everything. The server's copy came back, the app saved it and pushed it up,
    // and the newer record was destroyed for good. This is the loop that ate the sheet twice.
    const applyPullFull = (rows, diskVal, diskTs, mirror, pushedTs) => {
      const store = diskVal == null ? {} : { vx_sw_meta: diskVal };
      if (diskTs) store["__vxts_vx_sw_meta"] = String(diskTs);
      const pushed = [];
      const env = {
        localStorage: {
          getItem: (k) => (k in store ? store[k] : null),
          setItem: (k, v) => { store[k] = v; },
          get length() { return Object.keys(store).length; },
          key: (i) => Object.keys(store)[i],
        },
        window: { __VX_PULLED: { ...mirror }, __vxWriteTs: { vx_sw_meta: pushedTs } },
        origSet: (k, v) => { store[k] = v; },
        pushKey: (k, v) => pushed.push([k, v]),
        SYNC: [],
      };
      const src = sourceBetween("function applyPull(rows, seed){", "\n  // Re-pull the shared club");
      runInSandbox(src + "\napplyPull(rows, false);", { ...env, rows });
      return { mirror: env.window.__VX_PULLED, disk: store, pushed };
    };

    it("a sheet the browser had no room to store is still the newest copy", () => {
      const out = applyPullFull(
        [{ key: "vx_sw_meta", value: EMPTY, updated_at: "2026-08-09T12:00:00Z" }],
        JSON.stringify(EMPTY),                       // disk still holds the old value: the write failed
        0,                                           // and left no marker behind
        { vx_sw_meta: SHEET },                        // but it is in memory
        Date.parse("2026-08-09T13:00:00Z"));          // and it has been sent to the database
      eq(JSON.stringify(out.mirror.vx_sw_meta), JSON.stringify(SHEET),
        "the server's empty copy came back and the sheet vanished from the screen");
      eq(out.pushed.length, 1, "and the newest copy must go back up");
      eq(JSON.parse(out.pushed[0][1]).s1.inbody.length, 1,
        "pushing the stale copy from disk is what destroyed the record on the server");
    });
    it("the stale copy on disk is never the thing that gets pushed up", () => {
      const out = applyPullFull(
        [{ key: "vx_sw_meta", value: EMPTY, updated_at: "2026-08-09T12:00:00Z" }],
        JSON.stringify(EMPTY), 0, { vx_sw_meta: SHEET }, Date.parse("2026-08-09T13:00:00Z"));
      for (const [, v] of out.pushed) eq(JSON.stringify(JSON.parse(v)), JSON.stringify(SHEET));
    });
  });
  // These markers are the record of which copy is newer. They were the first thing thrown away
  // when storage filled up, described as cheap to lose; without them every unsynced local edit
  // loses to whatever the server last heard, across the whole app, from one full-storage moment.
  it("a full storage reclaims space before giving up the newer-than markers", () => {
    const set = sourceBetween("localStorage.setItem = function(k,v){", "var booted = false;");
    eq(set.indexOf("vxReclaim()") < set.indexOf("__vxts_"), true,
      "dropping the markers must be the last resort, not the first move");
  });

  // Installed to the home screen, this app suspends and resumes without ever reloading. A coach
  // spent an afternoon reporting screens as broken that had already been replaced, and a build
  // stamp only helps if something is looking at it.
  describe("a device running an old build is told so", () => {
    const newCtx = () => {
      const ctx = { state: {}, setState(s) { Object.assign(ctx.state, s); } };
      return ctx;
    };
    const check = async (serverBuild, ctx) => {
      const restore = [globalThis.fetch, globalThis.VX_BUILD, globalThis.document];
      globalThis.VX_BUILD = "2026-08-09m";
      globalThis.document = { hidden: false, addEventListener() {} };
      globalThis.fetch = async () => ({ json: async () => ({ build: serverBuild }) });
      try { await bind("_checkForUpdate", ctx, [])(); }
      finally { [globalThis.fetch, globalThis.VX_BUILD, globalThis.document] = restore; }
      return ctx.state;
    };
    itAsync("a newer build on the server raises the prompt", async () => {
      const st = await check("2026-08-09n", newCtx());
      eq(st.updateReady, true);
      eq(st.updateLatest, "2026-08-09n", "naming both builds is what makes it believable");
    });
    itAsync("the same build says nothing", async () =>
      eq(!!(await check("2026-08-09m", newCtx())).updateReady, false));
    itAsync("a server that cannot say is treated as no news", async () =>
      eq(!!(await check("", newCtx())).updateReady, false, "a reload we cannot justify is worse than none"));
    itAsync("resuming the app does not mean a request every time", async () => {
      const ctx = newCtx();
      await check("2026-08-09n", ctx);
      ctx.state.updateReady = false;
      await check("2026-08-09n", ctx);
      eq(!!ctx.state.updateReady, false, "the second check inside the window must not run");
    });
  });
  // Half a day went on arguing about which build a phone was running, from screenshots that
  // could not say. Settings is the screen most likely to be photographed.
  it("Settings shows the build, so a screenshot dates itself", () => {
    eq(/App build \{\{ appBuild \}\} on this device/.test(SOURCE), true);
    eq(/appBuild: VX_BUILD/.test(SOURCE), true, "it must be the running build, not one written out by hand");
  });
  it("the Settings screen no longer describes itself as an API key box", () => {
    const subs = [...SOURCE.matchAll(/settings:'([^']*)'|sub:'([^']*reset data[^']*)'/g)].map((m) => m[1] || m[2]);
    eq(subs.length > 0, true, "the subtitles must still be found by this test");
    for (const s of subs) eq(/API key/.test(s), false, "the box it names was deleted: " + s);
  });

  it("updating clears the offline copy, or the button does nothing", () => {
    const fn = sourceBetween("async _applyUpdate(){", "_forgetDeviceApiKey(){");
    eq(/getRegistrations\(\)/.test(fn) && /unregister\(\)/.test(fn), true,
      "the service worker serves the shell it kept, so a plain reload returns the same old app");
    eq(/caches\.delete/.test(fn), true);
  });
  it("the build the app reports comes from the file that goes stale", () => {
    const v = readFileSync(new URL("../src/app/api/version/route.ts", import.meta.url), "utf8");
    eq(/proto\.html/.test(v) && /VX_BUILD='\(\[\^'\]\+\)'/.test(v), true,
      "a second copy of the stamp could disagree with the app it is meant to describe");
  });

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
  // These two pages exist to answer "is it set up right, now?" — they are the instrument you
  // reach for when something is misconfigured. A browser that serves one from its cache hands
  // back the previous answer looking exactly like a fresh one, so you keep reading the state
  // you were trying to change and conclude the change did nothing. Whatever they say has to be
  // measured at the moment it is asked, and checkedAt is there so a stale copy is visible
  // rather than merely wrong.
  for (const [name, path] of [["inbody", "inbody/read"], ["wearable", "wearable/status"]])
    it("the " + name + " status page cannot be served from a cache", () => {
      const src = readFileSync(new URL("../src/app/api/" + path + "/route.ts", import.meta.url), "utf8");
      eq(/["']cache-control["']\s*:\s*["']no-store["']/i.test(src), true,
        "a cached status page reports the problem you already fixed");
    });
  it("the inbody status page says when it was measured", () => {
    const src = readFileSync(new URL("../src/app/api/inbody/read/route.ts", import.meta.url), "utf8");
    eq(/checkedAt:\s*new Date\(\)\.toISOString\(\)/.test(src), true,
      "without a timestamp there is no way to tell a fresh answer from a kept one");
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
      // Constructible as well as callable: pushKey does `new Date().toISOString()`, and a
      // bare { now } threw there — which silently routed every blob write down the catch arm,
      // so no test had ever exercised it.
      Date: Object.assign(function (...a) { return a.length ? new Date(...a) : new Date(NOW); },
                          { now: () => NOW }),
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
  // The banner a manager was actually looking at: "8 changes have not been saved —
  // family_accounts · HTTP 400 · retrying automatically". A 400 is the database rejecting the
  // SHAPE of the write — a column that does not exist, a value the column will not take. The
  // same bytes get the same answer, so it was retried every 45 seconds for as long as the app
  // stayed open, on every device, and the banner could never clear.
  describe("a write the database will never accept", () => {
    const FOUR_HUNDRED = res(400, { message: "column family_accounts.pass does not exist", code: "42703" });

    itAsync("a rejected shape is not retried", async () => {
      const t = boot({ auth: LIVE, reply: (url) => (url.includes("/family_accounts") ? FOUR_HUNDRED : GOOD_TOKEN) });
      await t.win.__vxInsert("family_accounts", [{ id: "fam1", name: "A" }]);
      await flush();
      const held = t.win.__vxFailed();
      eq(held.length, 1);
      eq(held[0].refused, true, "retrying identical bytes cannot change the answer");
    });
    itAsync("what the database said is kept, because it is the whole fix", async () => {
      const t = boot({ auth: LIVE, reply: (url) => (url.includes("/family_accounts") ? FOUR_HUNDRED : GOOD_TOKEN) });
      await t.win.__vxInsert("family_accounts", [{ id: "fam1" }]);
      await flush();
      eq(/column family_accounts\.pass does not exist/.test(t.win.__vxFailed()[0].said), true);
    });
    itAsync("one rejected write is one entry, however many times it is tried", async () => {
      const t = boot({ auth: LIVE, reply: (url) => (url.includes("/family_accounts") ? FOUR_HUNDRED : GOOD_TOKEN) });
      const row = [{ id: "fam1", name: "A" }];
      await t.win.__vxInsert("family_accounts", row);
      await flush();
      await t.win.__vxInsert("family_accounts", row);
      await flush();
      await t.win.__vxInsert("family_accounts", row);
      await flush();
      eq(t.win.__vxFailedCount(), 1, "'8 changes' read as eight lost registrations; it was one");
    });
    itAsync("an expired token is still retried — that one a refresh does fix", async () => {
      const t = boot({ auth: LIVE, reply: (url) => (url.includes("/family_accounts") ? res(401, { message: "JWT expired" }) : GOOD_TOKEN) });
      await t.win.__vxInsert("family_accounts", [{ id: "fam1" }]);
      await flush();
      const held = t.win.__vxFailed();
      eq(held.length, 1);
      eq(!!held[0].refused, false, "a 401 clears the moment the token is refreshed");
    });
    itAsync("a server having a bad moment is still retried", async () => {
      const t = boot({ auth: LIVE, reply: (url) => (url.includes("/family_accounts") ? res(503, { message: "upstream" }) : GOOD_TOKEN) });
      await t.win.__vxInsert("family_accounts", [{ id: "fam1" }]);
      await flush();
      eq(!!t.win.__vxFailed()[0].refused, false, "5xx is not the request being wrong");
    });
    it("the banner stops promising a retry that cannot happen", () => {
      eq(/the database rejected it, so retrying cannot help/.test(SOURCE), true);
      eq(/Show this to whoever looks after the database/.test(SOURCE), true,
         "a rejected shape is not the club's to fix, and the banner has to say whose it is");
    });
    it("a permission and a rejected shape are told apart", () =>
      eq(/S\.saveFailLast\.status===403 \|\| S\.saveFailLast\.status===401\)\s*\n\s*\? ' · refused/.test(SOURCE), true,
         "they need different people, so they cannot share one message"));
    it("a banner that can never clear has a way out", () => {
      eq(/saveFailDiscardShow: \(S\.saveFailCount>0 && !S\.authDead\)/.test(SOURCE), true,
         "Retry cannot work and the x only hides it until the count moves");
      eq(/window\.__vxClearFailed\(\)/.test(SOURCE), true);
    });
    // A database restored from a backup is the case that forced this open: everything queued was
    // made against the copy the restore replaced, and replaying it puts the old data straight
    // back. So Discard is always reachable, and the confirmation carries the weight.
    it("discarding recoverable writes says they are recoverable", () => {
      const fn = sourceBetween("onSaveFailDiscard: ()=>{", "updateBarBottom:");
      eq(/These CAN still succeed/.test(fn), true, "or somebody throws away a coach's register");
      eq(/restored from a backup/.test(fn), true, "and the one time it is the right thing to do");
      eq(/const permanent=\(S\.saveRefused>0 && S\.saveRefused>=n\)/.test(fn), true,
         "a refusal and an outage are different questions and get different words");
    });
    it("the update bar and the unsaved banner do not cover each other", () => {
      eq(/bottom:\{\{ updateBarBottom \}\}/.test(SOURCE), true);
      eq(/updateBarBottom: \(\(S\.saveFailCount>0 \|\| S\.authDead\) && !S\.saveFailHidden\) \? '62px' : '0'/.test(SOURCE), true,
         "the hidden one was Update, on the device that most needed it");
    });
    it("a stuck device is allowed to look for the fix sooner", () =>
      eq(/\(stuck \? 30000 : 240000\)/.test(SOURCE), true,
         "four minutes of a red banner with the fix already live"));
    // Opening the app is the moment to be told there is a newer one. The throttle meant a coach
    // could reopen a stale build three times in a row and be told nothing.
    it("opening the app always asks whether there is a newer build", () => {
      eq(/const floor = force \? 15000 :/.test(SOURCE), true, "a forced check is not on the schedule");
      eq(/this\._checkForUpdate\(true\)/.test(SOURCE), true);
      const mount = SOURCE.slice(SOURCE.indexOf("this._checkForUpdate(true);"), SOURCE.indexOf("this._refreshFailState();"));
      for (const ev of ["visibilitychange", "pageshow", "focus"])
        eq(mount.includes(ev), true,
           "an installed app can come back without a " + ev + " neighbour firing");
    });
    itAsync("a refused blob write reaches the banner instead of a console nobody has open", async () => {
      const t = boot({ auth: LIVE, reply: (url) => (url.includes("/club_state") ? res(403, { message: "new row violates row-level security policy" }) : GOOD_TOKEN) });
      await t.win.__vxpush("vx_squads", JSON.stringify({ ovr: { junior: { accent: "#FF0000" } } }));
      await flush();
      const held = t.win.__vxFailed();
      eq(held.length, 1, "squads, brand, goals and the meets calendar all failed in silence");
      eq(held[0].op, "push");
      eq(/row-level security/.test(held[0].said || held[0].body || ""), true, "the reason has to travel with it");
    });
    // A 403 is permanent and is deliberately not retried — pushKey queues that one for when a
    // token arrives. A server having a bad moment is the case the replay arm is for.
    itAsync("and a recoverable one is replayed, not just recorded", async () => {
      let calls = 0;
      const t = boot({ auth: LIVE, reply: (url) => { if (!url.includes("/club_state")) return GOOD_TOKEN;
        calls++; return calls === 1 ? res(503, { message: "upstream" }) : res(200, {}); } });
      await t.win.__vxpush("vx_squads", JSON.stringify({ ovr: {} }));
      await flush();
      eq(t.win.__vxFailedCount(), 1);
      await t.win.__vxRetryFailed();
      await flush();
      eq(t.win.__vxFailedCount(), 0, "a blob key has to be replayable through pushKey");
    });
    it("the repair does not undo the lockdown", () => {
      const sql = readFileSync(new URL("../supabase/family_accounts_repair.sql", import.meta.url), "utf8");
      eq(/create policy/i.test(sql), false,
         "the earlier repair scripts recreated the anon-open policies as part of the fix");
      eq(/notify pgrst, 'reload schema'/.test(sql), true, "PostgREST caches the table's shape");
    });
    // What the database actually said: null value in column "full_name" violates not-null.
    // full_name is required, has no default, and the app writes `name`.
    it("the repair answers the constraint that was rejecting every save", () => {
      const sql = readFileSync(new URL("../supabase/family_accounts_repair.sql", import.meta.url), "utf8");
      eq(/alter column full_name drop not null/.test(sql), true);
      eq(/alter column full_name set default ''/.test(sql), true, "a raw insert must work too");
      eq(/create trigger family_accounts_fill_full_name_trg/.test(sql), true,
         "so it holds the parent's name rather than an empty string");
      eq(/drop not null', c\.column_name/.test(sql), true,
         "one required column the app never sends rejects 100% of writes — fix them, don't just name them");
    });
    // The first version of the repair widened id to text so the app's invented ids would fit.
    // The database refused: 42804, family_accounts_id_fkey cannot be implemented, text vs uuid.
    // That key says an account row must belong to a real Auth user — the app was wrong, not it.
    it("the repair does not break the link to the Auth user", () => {
      const sql = readFileSync(new URL("../supabase/family_accounts_repair.sql", import.meta.url), "utf8");
      eq(/alter column id type text/.test(sql), false,
         "widening id has to break family_accounts_id_fkey, and that key is worth keeping");
    });
    it("the app never invents an id for a table keyed on the Auth user", () => {
      const writes = [...SOURCE.matchAll(/__vx(?:Insert|Upsert)\('family_accounts',/g)];
      eq(writes.length >= 5, true, "the call sites must still be found by this test");
      for (const m of writes) {
        const before = SOURCE.slice(Math.max(0, m.index - 220), m.index);
        eq(/_isUuid\(/.test(before), true,
           "a made-up id is refused by the column, and a refused write blocks the queue");
      }
      eq(/rec\.id=_uid/.test(SOURCE), true, "registration must use the uuid sign-up just minted");
    });
    // With the ids finally correct, every write hit the row that was already there:
    // 409, duplicate key value violates unique constraint "family_accounts_pkey".
    it("writing a family account is an upsert, never a plain insert", () => {
      eq(/__vxInsert\('family_accounts'/.test(SOURCE), false,
         "the id is the Auth user's, so the row always exists after the first write");
      eq((SOURCE.match(/__vxUpsert\('family_accounts'/g) || []).length >= 5, true);
    });
    // Driven through __vxInsert because that is what this sandbox carries, but the counting
    // lives in _failAdd, which every write path shares.
    itAsync("a repeat of the same row does not count as another lost change", async () => {
      const conflict = res(409, { message: 'duplicate key value violates unique constraint "family_accounts_pkey"' });
      const t = boot({ auth: LIVE, reply: (url) => (url.includes("/family_accounts") ? conflict : GOOD_TOKEN) });
      // Every write carries ts:Date.now(), so the payloads differ even for one unchanged row.
      const ID = "9f2a1c3e-5b7d-4e21-9a08-6c3f1b2d4e5a";
      for (const ts of [1, 2, 3]) {
        await t.win.__vxInsert("family_accounts", [{ id: ID, name: "A", ts }]);
        await flush();
      }
      eq(t.win.__vxFailedCount(), 1, "15 became 30 with nothing new going wrong");
    });
    itAsync("two different rows are still two changes", async () => {
      const conflict = res(409, { message: "duplicate key" });
      const t = boot({ auth: LIVE, reply: (url) => (url.includes("/family_accounts") ? conflict : GOOD_TOKEN) });
      await t.win.__vxInsert("family_accounts", [{ id: "aaaaaaaa-0000-4000-8000-000000000001", ts: 1 }]);
      await flush();
      await t.win.__vxInsert("family_accounts", [{ id: "bbbbbbbb-0000-4000-8000-000000000002", ts: 2 }]);
      await flush();
      eq(t.win.__vxFailedCount(), 2, "collapsing unrelated rows would hide a real loss");
    });
    it("a uuid is checked properly, not just for being a string", () => {
      const isUuid = bind("_isUuid", {});
      eq(isUuid("9f2a1c3e-5b7d-4e21-9a08-6c3f1b2d4e5a"), true);
      eq(isUuid("fam1a2b3c_x9"), false, "the id the app used to invent");
      eq(isUuid(""), false);
      eq(isUuid(null), false);
      eq(isUuid("9f2a1c3e5b7d4e219a086c3f1b2d4e5a"), false, "no dashes is not a uuid PostgREST accepts");
    });
    it("the repair reports its result as a row, not only a notice", () => {
      const sql = readFileSync(new URL("../supabase/family_accounts_repair.sql", import.meta.url), "utf8");
      eq(/still_required_but_never_sent/.test(sql), true, "notices are in a tab people miss");
    });
    it("every column the app writes is one the repair guarantees", () => {
      const sql = readFileSync(new URL("../supabase/family_accounts_repair.sql", import.meta.url), "utf8");
      const written = [...SOURCE.matchAll(/__vx(?:Insert|Upsert)\('family_accounts', \[\{([^}]*)\}/g)]
        .flatMap((m) => [...m[1].matchAll(/(\w+)\s*:/g)].map((x) => x[1]));
      eq(written.length > 0, true, "the call sites must still be found by this test");
      eq(/create table if not exists public\.family_accounts \(\s*id text primary key/.test(sql), true,
         "id is the key the table is created with, not an added column");
      for (const col of new Set(written.filter((c) => c !== "id")))
        eq(new RegExp("add column if not exists\\s+" + col + "\\b").test(sql), true,
           col + " is written by the app but the repair does not ensure it exists");
    });
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
    eq(/const max=longEdge\|\|1600/.test(SOURCE), true));
  // The second attempt used to send the identical picture down the identical pipe, which is
  // not much of a second attempt when the first one was too big to leave the phone.
  it("the retry sends a smaller picture, not the same one again", () =>
    eq(/_sheetToJpeg\(dataUrl, 1100, 0\.7\)/.test(SOURCE), true));
  // A scanner app's PDF goes down the other path, which rendered at a flat scale of 2 — that is
  // whatever the page happened to be, doubled. A large scan became a picture of several
  // megabytes, and the thing carrying it is a phone at the poolside on one bar.
  it("a scanned PDF is rendered to a fixed size too, not just doubled", () =>
    eq(/1600\/Math\.max\(base\.width\|\|1, base\.height\|\|1\)/.test(SOURCE), true,
      "scale:2 of an already-large page is how the upload got big enough to drop"));

  // Sending the sheet is most of a megabyte up from a phone on a weak signal, and a request
  // dropped in flight is the ordinary way that fails — not a sign anything is misconfigured.
  // Reported as a dead end, it sent the coach back to typing over a lost packet.
  describe("a dropped upload is retried, a settled refusal is not", () => {
    const newCtx = () => {
      const ctx = { tries: [], _readSheetOnce: null };
      ctx._readSheetOnServer = bind("_readSheetOnServer", ctx, []);
      return ctx;
    };
    itAsync("a network drop is tried again", async () => {
      const ctx = newCtx();
      let n = 0;
      ctx._readSheetOnce = async () => {
        n++;
        return n === 1 ? { failed: true, retryable: true, why: "load failed" } : { values: { weight: 55.8 } };
      };
      const out = await ctx._readSheetOnServer("data:image/jpeg;base64,x");
      eq(n, 2, "one lost packet must not end the attempt");
      eq(out.values.weight, 55.8);
    });
    itAsync("a rejected key is not asked twice", async () => {
      const ctx = newCtx();
      let n = 0;
      ctx._readSheetOnce = async () => { n++; return { failed: true, retryable: false, why: "the key was rejected" }; };
      const out = await ctx._readSheetOnServer("data:image/jpeg;base64,x");
      eq(n, 1, "asking again cannot fix a wrong key, it only makes the coach wait");
      eq(out.why, "the key was rejected", "and the reason must survive to the screen");
    });
    itAsync("it gives up after the second try rather than looping", async () => {
      const ctx = newCtx();
      let n = 0;
      ctx._readSheetOnce = async () => { n++; return { failed: true, retryable: true, why: "load failed" }; };
      const out = await ctx._readSheetOnServer("data:image/jpeg;base64,x");
      eq(n, 2);
      eq(out.failed, true, "and it must still fall back to typing, not hang");
    });
  });
  // A coach holding a phone had no way to tell "the app cannot reach the server", "no key is
  // set" and "the sheet was too big to send" apart — all three arrived as one sentence, and
  // each one sends you somewhere completely different to fix it.
  describe("the reader can be checked from the app, and says which stage broke", () => {
    const run = async (fetchImpl) => {
      const ctx = { msgs: [] };
      ctx.setState = (s) => { if (s.profileIbMsg != null) ctx.msgs.push(s.profileIbMsg); };
      ctx._readSheetOnce = async () => ({ values: {} });
      const restore = [globalThis.fetch, globalThis.document, globalThis.VX_BUILD];
      globalThis.fetch = fetchImpl;
      globalThis.VX_BUILD = "test-build";
      globalThis.document = { createElement: () => ({
        getContext: () => ({ fillRect() {}, fillText() {} }),
        toDataURL: () => "data:image/jpeg;base64,x",
      }) };
      try {
        await bind("profileInbodyCheck", ctx, [])();
      } finally {
        [globalThis.fetch, globalThis.document, globalThis.VX_BUILD] = restore;
      }
      return ctx.msgs[ctx.msgs.length - 1];
    };

    itAsync("an unreachable server is not blamed on the key", async () => {
      const msg = await run(async () => { throw new Error("Load failed"); });
      eq(/cannot reach the server/.test(msg), true);
      eq(/Load failed/.test(msg), true, "the browser's own words save the next hour of guessing");
      eq(/not the key/.test(msg), true);
    });
    itAsync("a missing key is named as a missing key", async () => {
      const msg = await run(async () => ({ json: async () => ({ configured: false, notes: ["it is not set"] }) }));
      eq(/no key is set/.test(msg), true);
      eq(/it is not set/.test(msg), true, "the server's own note must reach the screen");
    });
    // "So it is the connection out of this device" printed directly underneath the reader's own
    // words — "your credit balance is too low" — sends somebody to check their signal while the
    // real answer is already on the screen in front of them.
    itAsync("a reader that answered is not blamed on the phone's connection", async () => {
      const ctx = { msgs: [] };
      ctx.setState = (s) => { if (s.profileIbMsg != null) ctx.msgs.push(s.profileIbMsg); };
      ctx._readSheetOnce = async () => ({ failed: true, answered: true, why: "your credit balance is too low" });
      const restore = [globalThis.fetch, globalThis.document, globalThis.VX_BUILD];
      globalThis.fetch = async () => ({ json: async () => ({ configured: true, keyLength: 108 }) });
      globalThis.VX_BUILD = "test-build";
      globalThis.document = { createElement: () => ({
        getContext: () => ({ fillRect() {}, fillText() {} }), toDataURL: () => "data:image/jpeg;base64,x" }) };
      try { await bind("profileInbodyCheck", ctx, [])(); }
      finally { [globalThis.fetch, globalThis.document, globalThis.VX_BUILD] = restore; }
      const msg = ctx.msgs[ctx.msgs.length - 1];
      eq(/credit balance is too low/.test(msg), true, "the reader's own words are the answer");
      eq(/connection out of this device/.test(msg), false, "and must not be contradicted in the same sentence");
    });
    itAsync("everything working says so, with the key's length as proof", async () => {
      const msg = await run(async () => ({ json: async () => ({ configured: true, keyLength: 108 }) }));
      eq(/all working/.test(msg), true);
      eq(/108/.test(msg), true);
    });
    itAsync("every answer names the build, so a stale app is caught first", async () => {
      const msg = await run(async () => ({ json: async () => ({ configured: true, keyLength: 108 }) }));
      eq(/test-build/.test(msg), true, "otherwise a cached app makes a shipped fix look broken");
    });
  });
  it("the build stamp is bumped when this file changes", () => {
    const stamp = (SOURCE.match(/const VX_BUILD='([^']+)'/) || [])[1] || "";
    eq(/^\d{4}-\d{2}-\d{2}/.test(stamp), true, "a stamp nobody can date tells nobody anything");
  });
  it("a stalled upload is cut off rather than left hanging", () => {
    eq(/new AbortController\(\)/.test(SOURCE), true);
    eq(/sending the sheet timed out/.test(SOURCE), true, "waiting and broken must not read the same");
  });

  // The failure that cost an afternoon: the call out to the reader had no deadline of its own,
  // so it could hang until the platform killed the whole invocation — and a killed invocation
  // never answers. The browser saw a request die with no status and no message, which reads
  // exactly like a phone with no signal, and sent us checking the network, the key and the
  // size of the upload: everything except what actually happened.
  it("the call out to the reader gives up before the platform kills it", () => {
    const route = readFileSync(new URL("../src/app/api/inbody/read/route.ts", import.meta.url), "utf8");
    const outbound = +((route.match(/AbortSignal\.timeout\((\d+)_?(\d*)\)/) || []).slice(1).join("") || 0);
    const maxRun = +((route.match(/maxDuration\s*=\s*(\d+)/) || [])[1] || 0) * 1000;
    eq(outbound > 0, true, "without a deadline a hang becomes a dropped connection");
    eq(outbound < maxRun, true, "a deadline longer than the function's life never gets to fire");
  });
  it("a reader that never answers still produces a reply, not a dropped connection", () => {
    const route = readFileSync(new URL("../src/app/api/inbody/read/route.ts", import.meta.url), "utf8");
    eq(/did not answer in time/.test(route), true);
    eq(/TimeoutError/.test(route), true, "a hang and a refused connection are different problems");
  });
  it("the app gives up before the server is killed, so there is something to report", () => {
    const client = +((SOURCE.match(/ctl && ctl\.abort\(\); \}catch\(e\)\{\} \}, (\d+)\)/) || [])[1] || 0);
    const route = readFileSync(new URL("../src/app/api/inbody/read/route.ts", import.meta.url), "utf8");
    const maxRun = +((route.match(/maxDuration\s*=\s*(\d+)/) || [])[1] || 0) * 1000;
    eq(client > 0 && maxRun > 0, true);
    eq(client < maxRun, true, "wait longer than the platform does and the platform wins, silently");
  });
  // The whole afternoon's fault, and it was never the network, the plan or the variable name:
  // the key had been pasted out of a notes app on a phone, which brought the line wrapping with
  // it, so it arrived with spaces in the middle. trim() removes whitespace at the ends and
  // nothing in between, the settings box shows a key that looks perfect, and it fails only at
  // the last possible moment — when a header is built from it.
  // Pull the real function out of the route and run it, rather than restating what it should
  // do. A test that reimplements the thing it is testing agrees with itself for ever.
  const ROUTE_SRC = readFileSync(new URL("../src/app/api/inbody/read/route.ts", import.meta.url), "utf8");
  const routeFn = (name) => {
    const from = ROUTE_SRC.indexOf("function " + name + "(");
    if (from < 0) throw new Error("no function " + name + " in the route");
    let depth = 0, i = ROUTE_SRC.indexOf("{", from);
    for (; i < ROUTE_SRC.length; i++) {
      if (ROUTE_SRC[i] === "{") depth++;
      else if (ROUTE_SRC[i] === "}" && !--depth) break;
    }
    // The route is TypeScript; a parameter's type annotation is not valid JavaScript.
    return ROUTE_SRC.slice(from, i + 1).replace(/(\(\s*\w+)\s*:\s*[\w<>[\]|]+/g, "$1");
  };

  describe("a key pasted from a phone", () => {
    const clean = (raw) => runInSandbox(routeFn("apiKey") + "\nreturn apiKey();", { process: { env: { ANTHROPIC_API_KEY: raw } } });
    it("survives the line wrapping a notes app adds", () =>
      eq(clean("sk-ant-api03-2X60Pf44_z18 PyMzpnd_NEJ2df7VB\nggbf80K09Z4"), "sk-ant-api03-2X60Pf44_z18PyMzpnd_NEJ2df7VBggbf80K09Z4"));
    it("still loses quotes, a Bearer prefix and the spaces around it", () =>
      eq(clean('  "Bearer sk-ant-api03-abc"  '), "sk-ant-api03-abc"));
    it("a key with nothing wrong with it is left exactly alone", () =>
      eq(clean("sk-ant-api03-abcDEF123_-xyz"), "sk-ant-api03-abcDEF123_-xyz"));
  });

  // An error message from the header builder quoted the whole key back, that message was handed
  // to the browser to help with debugging, and the key was printed on a coach's screen and into
  // a screenshot. A secret that can reach a client eventually does.
  describe("nothing sent to the browser may carry the key", () => {
    const scrub = (t) => runInSandbox(routeFn("scrub") + "\nreturn scrub(t);", { t });
    it("the exact message that leaked it is scrubbed", () =>
      eq(/sk-ant/.test(scrub('Headers.append: "sk-ant-api03-2X60Pf44_z18PyMzpnd_NEJ2df7VB ggbf80K09Z4" is an invalid header value.')), false));
    it("a key broken across spaces is caught too, not just an unbroken one", () =>
      eq(/2X60Pf44/.test(scrub("bad key: sk-ant-api03-2X60Pf44 z18PyMzpnd NEJ2df7VB")), false));
    it("a refusal quoting the key back is scrubbed the same way", () =>
      eq(/sk-ant/.test(scrub("invalid x-api-key: sk-ant-api03-abcdefghijklmnop")), false));
    it("and the rest of the message survives, or there is nothing to act on", () =>
      eq(/invalid header value/.test(scrub('Headers.append: "sk-ant-api03-abcdefghij" is an invalid header value.')), true));
  });
  it("every path that returns an exception or a refusal scrubs it first", () => {
    const route = readFileSync(new URL("../src/app/api/inbody/read/route.ts", import.meta.url), "utf8");
    const saids = [...route.matchAll(/said:\s*([^\n]+)/g)].map((m) => m[1]);
    eq(saids.length > 0, true, "the field that leaked must still be found by this test");
    for (const s of saids) eq(/scrub\(/.test(s), true, "an unscrubbed said: is how the key reached a screen: " + s);
  });

  it("a failure with no message still says something usable", () =>
    eq(/the request was dropped rather than refused/.test(SOURCE), true,
      "one blank sentence for every possible cause is what made this take all afternoon"));
  // Settings offered a box for an Anthropic key and kept it on the device. Nothing ever read
  // it — no page in this app calls Anthropic, and none should: a key in a browser can be read
  // off the phone by whoever is holding it, and it bills the club. The box was an invitation to
  // paste a live secret somewhere it did nothing but leak.
  describe("no key is ever asked for, or kept, on a device", () => {
    it("there is no box to type one into", () => {
      eq(/placeholder="sk-ant-…"/.test(SOURCE), false, "a box asking for a key is an instruction to put one there");
      eq(/onApiKeySave|settingsSaveKey/.test(SOURCE), false, "and nothing may save one");
    });
    it("a key an earlier build stored is deleted on start-up", () => {
      eq(/_forgetDeviceApiKey\(\)\{ try\{ localStorage\.removeItem\('vx_api_key'\)/.test(SOURCE), true);
      eq(/this\._forgetDeviceApiKey\(\);/.test(SOURCE), true, "waiting for someone to clear it is not a plan");
    });
    it("the page still never calls Anthropic itself", () =>
      eq(/api\.anthropic\.com/.test(SOURCE), false, "that request would carry the key out of the server"));
    it("Settings says where the key actually lives", () =>
      eq(/ANTHROPIC_API_KEY/.test(SOURCE) && /lives on the server/.test(SOURCE), true));
  });

  // The assistants used to return a paragraph written months earlier after a delay dressed up
  // as thinking. Now they call a model — which means a club of children's data is one careless
  // field away from an external service, so the route accepts a fixed list and drops the rest.
  describe("nothing that identifies a child reaches the assistant", () => {
    const clean = AI_ROUTE.cleanContext;

    it("a name is dropped even when the app sends one", () => {
      const out = clean({ name: "Tamara Aly", firstName: "Tamara", age: 9 });
      eq("name" in out || "firstName" in out, false, "a later change to the app must not be able to start leaking names");
      eq(out.age, 9, "age changes the advice and identifies nobody on its own");
    });
    it("a date of birth is dropped, and so is a swimmer id", () =>
      eq(Object.keys(clean({ dob: "2017-04-17", swId: "tamara-aly", id: "abc" })).length, 0));
    it("a squad label is kept but a sentence smuggled into it is not", () => {
      eq(clean({ squadLevel: "Senior A" }).squadLevel, "Senior A");
      eq("squadLevel" in clean({ squadLevel: "Senior A, coached by Sameh, swimmer Tamara Aly" }), false);
    });
    it("best times keep the event and the seconds, and nothing else", () => {
      const out = clean({ bests: [{ event: "100 Free", seconds: 57.5, meet: "Doha Open", date: "2026-06-05", swimmer: "Tamara" }] });
      eq(JSON.stringify(out.bests), JSON.stringify([{ event: "100 Free", seconds: 57.5 }]),
        "a meet and a date and an age band together name a child");
    });
    it("something shaped like a name in an event field is refused", () =>
      eq("bests" in clean({ bests: [{ event: "Tamara Aly", seconds: 57.5 }] }), false));
    it("a number arriving as text is still a number, not free text", () =>
      eq(clean({ attendancePct: "84" }).attendancePct, 84));
  });
  it("the assistant is told these are children, and what it may not say", () => {
    const AI = readFileSync(new URL("../src/app/api/ai/coach/route.ts", import.meta.url), "utf8");
    for (const rule of ["calorie", "supplement", "medical", "minors"])
      eq(new RegExp(rule, "i").test(AI), true, "the prompt must rule out " + rule);
  });
  it("a malformed answer never reaches the screen half-rendered", () => {
    const AI = readFileSync(new URL("../src/app/api/ai/coach/route.ts", import.meta.url), "utf8");
    eq(/if \(!blocks\.length\) return Response\.json\(\{ error/.test(AI), true);
    eq(/color: COLORS\[i % COLORS\.length\]/.test(AI), true, "colours are ours, not the model's");
  });
  it("the assistants no longer answer from a script", () => {
    const gen = sourceBetween("async aiGenerate(){", "async _aiAsk(");
    eq(/setTimeout/.test(gen), false, "a canned paragraph behind a fake delay is worse than no assistant");
    eq(/_aiAsk\('?\w*'?/.test(gen) || /this\._aiAsk\(/.test(gen), true);
  });
  it("the assistant call gives up before the server is killed", () => {
    const client = +((SOURCE.match(/ctl && ctl\.abort\(\); \}catch\(e\)\{\} \}, (\d+)\);\s*try\{\s*const r=await fetch\('\/api\/ai\/coach'/) || [])[1] || 0);
    const AI = readFileSync(new URL("../src/app/api/ai/coach/route.ts", import.meta.url), "utf8");
    const outbound = +((AI.match(/AbortSignal\.timeout\((\d+)_?(\d*)\)/) || []).slice(1).join("") || 0);
    const maxRun = +((AI.match(/maxDuration = (\d+)/) || [])[1] || 0) * 1000;
    eq(outbound > 0 && outbound < maxRun, true, "a deadline longer than the function's life never fires");
    eq(client > 0 && client < maxRun, true, "and waiting longer than the platform does loses the explanation");
  });

  it("the key never leaves the server", () => {
    const route = readFileSync(new URL("../src/app/api/inbody/read/route.ts", import.meta.url), "utf8");
    eq(/process\.env\.ANTHROPIC_API_KEY/.test(route), true);
    // Look for the header actually being sent, not the words appearing anywhere — a comment
    // quoting an error message is not a leaked key.
    eq(/["']x-api-key["']\s*:/.test(SOURCE), false, "a secret key must never be sent from the page");
    eq(/sk-ant-[A-Za-z0-9_-]{20}/.test(SOURCE), false, "and no key literal in the page either");
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
    const ctx = {};
    ctx._weightImplausible = bind("_weightImplausible", ctx);
    const check = bind("_inbodySanity", ctx);

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

    // The scan that started this: 167 in the Weight box on a swimmer 167 cm tall. Weighed
    // against 167 kg, protein, minerals, total body water, fat free mass and body cell mass are
    // each impossible, so they were dropped and the reconciliation failed — 23 readings came
    // back as 8, and the only figure that survived was the wrong one.
    it("the height typed into the weight box does not condemn the sheet", () => {
      const sheet = { testDate: "2026-07-14", weight: 167, height: 167, smm: 27.4, protein: 9.7,
                      minerals: 3.5, tbw: 36.3, ffm: 49.5, bodyCellMass: 32.2, pbf: 11.4 };
      const r = check(sheet);
      eq(r.values.weight, undefined, "167 kg must not reach a child's record");
      eq(!!r.badWeight, true, "the app has to be able to say what was wrong");
      eq(/167 kg against a height of 167 cm/.test(r.badWeight), true);
      eq(r.reconciled, false, "nothing is offered rather than a sheet anchored to a wrong weight");
      eq(r.values.height, 167, "the height is the one figure that is plainly a height");
    });
    it("a weight no swimmer has is refused on its own, with no height to compare", () => {
      eq(!!check({ weight: 167, smm: 27.4 }).badWeight, true);
      eq(!!check({ weight: 4.2, smm: 27.4 }).badWeight, true, "a decimal point in the wrong place");
      eq(!!check({ weight: 55.8, height: 167 }).badWeight, false, "a real weight is not refused");
    });
    it("a heavy adult and a small child are still weights", () => {
      const heavy = check({ weight: 148, height: 190, bodyFatMass: 30, ffm: 118 });
      eq(!!heavy.badWeight, false, "a masters swimmer is not a misread");
      eq(!!check({ weight: 18.5, height: 110 }).badWeight, false, "a five-year-old in the learn-to-swim squad");
    });
  }

  // The reconciliation above runs only on what this device's own OCR guessed at. The 167 came
  // off the server reader — and a text PDF takes a third path that saves itself with nobody
  // seeing the figure at all. The weight has to be checked on all three, or the guard is in a
  // place the bug never goes.
  it("the weight is checked whichever way the sheet came in", () => {
    const fn = (SOURCE.match(/async profileInbodyPdf\(e, swId\)\{[\s\S]*?\n  \}\n/) || [""])[0];
    const guardAt = fn.indexOf("_weightImplausible");
    const ocrAt = fn.indexOf("if(pictureRead && !serverRead)");
    eq(guardAt > -1, true, "the import never checks the weight");
    eq(ocrAt > -1 && guardAt < ocrAt, true, "the check sits inside the OCR-only branch again");
    eq(/badWeight\)\{ delete data\.weight; fromPhoto=true; \}/.test(fn), true,
       "a bad weight must be dropped and the sheet held back for a person to check");
  });
  it("a sheet held back for a bad weight says which number was wrong", () => {
    eq(/badWeight \? \('The weight read as '\+badWeight/.test(SOURCE), true,
       "'did not add up' does not tell anyone what to correct");
  });
  it("the same mix-up typed by hand is refused before it is saved", () => {
    const add = (SOURCE.match(/  addInbody\(swId\)\{[\s\S]*?\n    const m=this\._swMeta/) || [""])[0];
    eq(/const wWhy=this\._weightImplausible\(w, isNaN\(typedH\)\?null:typedH\);/.test(add), true);
    eq(/if\(wWhy\)\{[\s\S]*?return;/.test(add), true, "it has to stop, not just warn");
  });

  // Automatic reading needs an account somebody has to set up and pay for. Typing the sheet
  // out has to be a real option, not three boxes and a shrug.
  it("the whole sheet can be typed, not just three boxes", () => {
    const fields = (SOURCE.match(/ibFullFields: \[[\s\S]*?\]\.map/) || [""])[0];
    for (const k of ["height", "bodyFatMass", "bmi", "score", "visceralFat", "tbw", "icw", "ecw",
                     "ecwRatio", "protein", "minerals", "ffm", "slm", "boneMineral",
                     "bodyCellMass", "bmr", "whr", "obesityDegree", "smi", "phaseAngle"])
      eq(fields.includes("'" + k + "'"), true, k + " cannot be entered by hand");
  });
  it("a typed value beats an import's reading of the same field", () =>
    eq(/const extra=\{\.\.\.\(\(pend&&pend\.extra\)\|\|\{\}\), \.\.\.typed\}/.test(SOURCE), true,
       "the person has the paper in front of them"));
  it("a typed test date puts the scan on the right day", () =>
    eq(/const typedDate=\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test/.test(SOURCE), true));

  // An InBody sheet dated 14 July was labelled " 7". The stored date is ISO, and every caller
  // was reversing it into dd/mm/yyyy before handing it to a reader that takes the month first —
  // so 14 became a month that does not exist, leaving the month blank and printing 07 as the
  // day. Where the day was 12 or less it was far worse: 2026-01-05 read back as "May 1", a real
  // date, the wrong one, with nothing at all to hint at it. Same swap as the birthdays.
  describe("dates the app stores are read, not reshaped", () => {
    // VX_MONTHS is a module-level constant in the app, not a field on the component, so it has
    // to exist as a global here rather than on the context object.
    globalThis.VX_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const label = bind("shortDateISO", {}, ["_dobParts"]);
    it("the sheet dated 14 July says July", () => eq(label("2026-07-14"), "Jul 14"));
    it("a day of 12 or less is not silently swapped with its month", () => {
      eq(label("2026-01-05"), "Jan 5");
      eq(label("2026-07-04"), "Jul 4");
    });
    it("the last day of the year survives", () => eq(label("2026-12-31"), "Dec 31"));
    it("a stored timestamp keeps its date and drops the time", () =>
      eq(label("2026-08-09T11:56:19.371Z"), "Aug 9"));
    it("nothing in, nothing out — never a made-up day", () => {
      eq(label(""), "");
      eq(label(null), "");
      eq(label("2026-02-31"), "", "a date that is not on the calendar is refused, not rolled");
    });
  });
  // Results come in month-first from Hy-Tek and SwimCloud, but a swim entered by hand is stored
  // already formatted — and splitting "14 Jul" on "/" gave one piece, so the month came out
  // empty and the day as NaN. Every swim of a hand-added swimmer read " NaN" in the family app.
  describe("a results date, whatever shape it arrived in", () => {
    globalThis.VX_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const label = bind("shortDate", {}, ["shortDateISO", "_dobParts"]);
    it("an imported date stays month-first: 6/5/2026 is 5 June", () => eq(label("6/5/2026"), "Jun 5"));
    it("and 4/30/2026 is 30 April, not the 4th", () => eq(label("4/30/2026"), "Apr 30"));
    it("a label that is already a label is left alone", () => eq(label("14 Jul"), "14 Jul"));
    it("an ISO date is read as ISO, not as month-first", () => eq(label("2026-07-14"), "Jul 14"));
    it("nothing in, nothing out", () => eq(label(""), ""));
  });

  it("no caller reshapes an ISO date to suit the month-first reader", () =>
    eq(/reverse\(\)\.join\('\/'\)/.test(SOURCE), false,
      "that reshaping is the bug itself — shortDateISO reads ISO directly"));

  it("height is kept, not read and thrown away", () => {
    eq(/height:data\.height\|\|null/.test(SOURCE), true);
    eq(/\['height','Height',' cm','[^']+'\]/.test(SOURCE), true);
  });

  // Twenty-three tiles of small grey capitals all look alike, and a coach at the poolside is
  // hunting for one of them. The icon is how it is found, so every row needs one and the two
  // views must agree — the sheet you type into and the sheet you read back are the same sheet.
  it("every reading carries an icon, in both the typed sheet and the saved one", () => {
    const rows = (list) => [...(SOURCE.match(new RegExp(list + "\\s*[:=]\\s*\\[[\\s\\S]*?\\n\\s*\\]"))[0]
      .matchAll(/\['(\w+)','[^']*','[^']*'(?:,'([^']*)')?\]/g))].map((m) => [m[1], m[2]]);
    const shown = rows("IB_FIELDS"), typed = rows("ibFullFields");
    eq(shown.length, 23, "every reading the sheet gives must still be listed");
    eq(typed.length, 20);
    for (const [k, icon] of shown.concat(typed)) eq(!!icon, true, k + " has no icon to find it by");
    // The same reading must not be a barbell in one view and a bone in the other.
    const byKey = Object.fromEntries(shown);
    for (const [k, icon] of typed) if (byKey[k]) eq(icon, byKey[k], k + " is a different picture in each view");
  });
  it("a sheet can be saved from the panel it was typed into", () =>
    eq(/onclick="\{\{ onInbodyAdd \}\}"[^>]*>[\s\S]{0,200}?Save this sheet/.test(SOURCE), true,
      "the only way to save was a small + button above the panel, far from the last field typed"));
  // "Saved" used to appear the moment the value reached the phone, whether or not it ever left
  // it — so a record the database refused looked exactly like one that worked, until a refresh,
  // when it was gone. A sheet is twenty-three readings copied off a printout by hand.
  describe("a saved sheet says where it went", () => {
    // What was written, so the test proves the scan reaches its own row rather than the
    // club-wide blob that lost it twice.
    let sent = null;
    const run = async (accepted, lastErr) => {
      const ctx = { msgs: [], _fmtDMY: () => "14 Jul", _inbodyFetch: async () => {} };
      ctx.setState = (s) => { if (s.profileIbMsg != null) ctx.msgs.push(s.profileIbMsg); };
      const restore = globalThis.window;
      sent = null;
      globalThis.window = accepted === undefined ? {} : {
        __vxUpsert: async (table, rows) => { sent = { table, rows }; return accepted; },
        __vxLastWriteErr: lastErr || null,
      };
      try { await bind("_ibConfirmSave", ctx, ["_ibToRow", "_ibRowId"])("s1", { date: "2026-07-14", weight: 55.8, fat: 11.4, muscle: 27.4, bmi: 20, phaseAngle: 5.7 }); }
      finally { globalThis.window = restore; }
      return ctx.msgs[ctx.msgs.length - 1];
    };
    itAsync("the scan goes to its own row, not the club-wide blob", async () => {
      await run(true);
      eq(sent.table, "inbody_readings", "one row per scan is the whole point");
      eq(sent.rows[0].id, "s1::2026-07-14");
      eq(sent.rows[0].weight, 55.8);
      eq(sent.rows[0].vals.phaseAngle, 5.7, "the rest of the sheet travels with it");
      eq("bmi" in sent.rows[0].vals && !("weight" in sent.rows[0].vals), true, "the charted figures are columns, the rest is not duplicated");
    });
    itAsync("a save that reached the database says so", async () =>
      eq(/Saved to the club database ✓/.test(await run(true)), true));
    itAsync("a refused save is not dressed up as a success", async () => {
      const msg = await run(false, { table: "inbody_readings", status: 403, said: "permission denied" });
      eq(/NOT saved to the club database/.test(msg), true);
      eq(/permission denied/.test(msg), true, "the reason has to reach the person holding the printout");
      eq(/✓/.test(msg), false, "a tick here is a lie, and it is also what turns the line green");
    });
    itAsync("a table that was never created says so by name", async () => {
      const msg = await run(false, { table: "inbody_readings", status: 404, said: 'relation "public.inbody_readings" does not exist' });
      eq(/run supabase\/inbody_readings\.sql/.test(msg), true, "otherwise this looks like a permissions problem for ever");
    });
    itAsync("it says not to type the sheet out a second time", async () =>
      eq(/do not type it in again/.test(await run(false, { table: "inbody_readings", said: "x" })), true));
    itAsync("with no sync layer it claims only what it knows", async () =>
      eq(await run(undefined), "Saved on this device ✓"));
  });
  // Signing in with Google or Apple must be a different door into the same building, not a
  // side entrance. If it skipped the second factor it would be the strongest-looking button on
  // the screen and the weakest way in.
  describe("signing in with Google or Apple", () => {
    const runReturn = async (hash) => {
      const ctx = { state: {}, setState(o) { Object.assign(ctx.state, o); },
        _sbAuthUrl: () => "https://x/auth/v1", _sbAnon: () => "anon",
        _oauthEmail: async () => "parent@example.com",
        _oauthFinish: async (t, after) => { ctx.finished = { t, after }; } };
      const restore = [globalThis.location, globalThis.history, globalThis.sessionStorage, globalThis.window];
      globalThis.location = { hash, pathname: "/", search: "", origin: "https://c" };
      globalThis.history = { replaceState() { ctx.urlCleaned = true; } };
      globalThis.sessionStorage = { getItem: () => "family", removeItem() {}, setItem() {} };
      globalThis.window = { __vxSetAuth: (sess) => { ctx.authSet = sess; } };
      try { await bind("_checkOAuthHash", ctx, [])(); }
      finally { [globalThis.location, globalThis.history, globalThis.sessionStorage, globalThis.window] = restore; }
      return ctx;
    };

    itAsync("a valid return opens the app", async () => {
      const ctx = await runReturn("#access_token=abc&refresh_token=r&expires_in=3600");
      eq(ctx.finished.after, "family");
    });
    itAsync("the token is taken out of the address bar immediately", async () => {
      const ctx = await runReturn("#access_token=abc&refresh_token=r");
      eq(ctx.urlCleaned, true, "a token left in a URL gets bookmarked, screenshotted and pasted into chats");
      eq(ctx.authSet.access_token, "abc");
    });
    itAsync("a password-reset link is left alone", async () => {
      const ctx = await runReturn("#access_token=abc&type=recovery");
      eq(ctx.authSet, undefined, "recovery has its own handler and must not be swallowed here");
    });
    itAsync("a return with no token does nothing at all", async () => {
      const ctx = await runReturn("#hello");
      eq(ctx.authSet, undefined);
      eq(ctx.finished, undefined);
    });

    it("a coach can only arrive as an account an admin already recorded", () => {
      const fn = sourceBetween("async _oauthFinish(token, after){", "// Forgot password");
      eq(/No staff account here uses /.test(fn), true,
        "otherwise any Google account could walk into the staff side");
      eq(/\(a\.email\|\|''\)\)\.trim\(\)\.toLowerCase\(\)===email/.test(fn), true);
    });
    it("the buttons are offered in Arabic too, like the rest of the family side", () => {
      for (const k of ["continueGoogle", "continueApple", "oauthNote", "orWord"]) {
        const m = SOURCE.match(new RegExp(k + ":\\['([^']*)','([^']*)'\\]"));
        eq(!!m, true, k + " has no entry");
        eq(m[2].length > 0 && m[2] !== m[1], true, k + " is not actually translated");
      }
    });
    it("the Google mark is inlined, not fetched from a path that does not exist", () => {
      eq(/assets\/google\.svg/.test(SOURCE), false,
        "the service worker serves /assets/ cache-first — a missing icon there stays missing");
      eq(/data:image\/svg\+xml;utf8,%3Csvg/.test(SOURCE), true);
    });
  });

  // The vx-media bucket holds children's birth certificates, passports, medical certificates,
  // photographs and race videos. A public bucket serves those through an endpoint that bypasses
  // row-level security entirely, so locking the swimmer_docs table hid the index and not the
  // documents. Short-lived signed links are the only thing that closes it.
  describe("signed links for children's files", () => {
    const path = bind("_mediaPath", {}, []);
    it("a stored public URL yields its path", () =>
      eq(path("https://x.supabase.co/storage/v1/object/public/vx-media/docs/s1/birth.pdf"), "docs/s1/birth.pdf"));
    it("the private shape works too, since both have been stored", () =>
      eq(path("https://x.supabase.co/storage/v1/object/vx-media/photos/s1.jpg"), "photos/s1.jpg"));
    it("a token on the end is not part of the path", () =>
      eq(path("https://x.supabase.co/storage/v1/object/public/vx-media/videos/v1.mp4?token=abc"), "videos/v1.mp4"));
    it("an escaped space comes back as a space", () =>
      eq(path("https://x.supabase.co/storage/v1/object/public/vx-media/meets/Doha%20Open.pdf"), "meets/Doha Open.pdf"));
    it("someone else's link is left alone", () => {
      eq(path("https://youtube.com/watch?v=abc"), "");
      eq(path("assets/logo-mark.png"), "");
      eq(path(""), "");
    });

    const src = (url, cache, token) => {
      const ctx = { _signCache: cache || {}, _signing: {}, forceUpdate() {},
        _sbAnon: () => "anon", _sbUrl: () => "https://x.supabase.co" };
      const restore = globalThis.window;
      globalThis.window = { __VX_AUTH: token ? { token } : null, __VX_SB: { url: "https://x.supabase.co" } };
      try { return bind("_mediaSrc", ctx, ["_mediaPath", "_signMedia", "_sbUrl", "_sbAnon"])(url); }
      finally { globalThis.window = restore; }
    };
    it("a fresh signature is used when there is one", () => {
      const cache = { "docs/s1/birth.pdf": { url: "SIGNED", exp: Date.now() + 60000 } };
      eq(src("https://x.supabase.co/storage/v1/object/public/vx-media/docs/s1/birth.pdf", cache, "t"), "SIGNED");
    });
    it("an expired one is not used", () => {
      const cache = { "docs/s1/birth.pdf": { url: "OLD", exp: Date.now() - 1000 } };
      const out = src("https://x.supabase.co/storage/v1/object/public/vx-media/docs/s1/birth.pdf", cache, "t");
      eq(out, "OLD", "the stale link is shown for one render while a new one is fetched, not a blank");
    });
    it("with nothing signed yet the stored URL is handed back, not an empty box", () => {
      const u = "https://x.supabase.co/storage/v1/object/public/vx-media/photos/s1.jpg";
      eq(src(u, {}, "t"), u, "this is what makes flipping the bucket safe to do in one step");
    });
    it("a link that is not ours is returned untouched", () =>
      eq(src("https://youtube.com/watch?v=abc", {}, "t"), "https://youtube.com/watch?v=abc"));

    it("everything that shows a stored file goes through it", () => {
      // Avatars, documents, InBody sheets, the video player and the download link.
      eq(/av\(photo, initials[\s\S]{0,400}?photo=this\._mediaSrc\(photo\)/.test(SOURCE), true, "swimmer photographs");
      eq(/vidEl\.src=this\._mediaSrc\(v\.url\)/.test(SOURCE), true, "the video player");
      eq(/activeVideoDownloadUrl: activeVid\?this\._mediaSrc\(/.test(SOURCE), true, "the download link");
      eq(/const ready=this\._mediaSrc\(url\);/.test(SOURCE), true, "documents and scans opened in a tab");
    });
    it("opening a document never waits on a request first", () => {
      // A window opened after an await is a blocked pop-up and the document simply never
      // appears. _mediaSrc returns what it has and signs in the background, so the window is
      // opened in the same tick as the tap.
      const fn = sourceBetween("_openUrl(url){", "_openDoc(doc){");
      eq(/await/.test(fn), false, "awaiting here is what gets the pop-up blocked");
      eq(/const ready=this\._mediaSrc\(url\);/.test(fn), true);
    });
    it("one signing request per file, not one per render", () => {
      const fn = sourceBetween("_signMedia(path){", "_sbUrl(){");
      eq(/if\(this\._signing\[path\]\) return;/.test(fn), true);
      eq(/exp:Date\.now\(\)\+life\*800/.test(fn), true, "re-signed at 80% of its life, so it cannot expire mid-view");
    });
  });

  // An audit log is read by more people than the thing it describes, and it is worthless if the
  // people it records can edit it or if it can stop them working.
  // Stage 4 makes every per-swimmer table staff-only to write. That is right for a register and
  // wrong for the handful of things a family fills in themselves — and a policy that is too
  // tight fails silently, which is the kind of breakage nobody reports for a fortnight.
  describe("what a family is still allowed to write", () => {
    const s4 = readFileSync(new URL("../supabase/security_4_roles.sql", import.meta.url), "utf8");
    // Every table the family portal writes to, taken from the family view's own handlers.
    const famWrites = { wellness_checkins: "onWellSave", wearable_readings: "onFamWearAdd",
                        family_messages: "onFamSendMsg", invoices: null, family_accounts: null };

    it("the family portal's own writes are all still possible", () => {
      for (const t of Object.keys(famWrites))
        eq(new RegExp("on public\\." + t).test(s4), true,
           t + " is written from the family portal but Stage 4 gives a family no way to");
    });
    it("the daily check-in can be saved twice in one day", () => {
      // It is an upsert, so insert alone passes the first check-in and fails the second.
      for (const t of ["wellness_checkins", "wearable_readings"]) {
        const block = (s4.match(new RegExp("public\\." + t + "[\\s\\S]*?end \\$\\$;")) || [""])[0];
        eq(/for insert to authenticated/.test(block), true, t + " cannot be created by a family");
        eq(/for update to authenticated/.test(block), true,
           t + " is an upsert — without update it fails on the second save, not the first");
      }
    });
    it("a family writes only for their own child", () => {
      for (const p of ["vx_s4_family_wellness_new", "vx_s4_family_wellness_edit",
                       "vx_s4_family_wear_new", "vx_s4_family_wear_edit"]) {
        const line = (s4.match(new RegExp(p + "[\\s\\S]*?;")) || [""])[0];
        eq(/vx_is_my_swimmer\(sw_id::text\)/.test(line), true, p + " does not check whose child it is");
        eq(/using \(true\)|with check \(true\)/.test(line), false, p + " is open to any signed-in user");
      }
    });
    it("the handlers this is derived from still exist", () => {
      for (const [t, handler] of Object.entries(famWrites))
        if (handler) eq(SOURCE.includes(handler + ":"), true,
          "the family portal no longer has " + handler + " — recheck what it writes to " + t);
    });
  });

  // The anon key and the service_role key sit next to each other on the same Supabase page and
  // look identical. Pasted into the wrong slot, the anon key passes every presence check and
  // then reads nothing, because row-level security still applies to it — a backup would come
  // back empty and look like an empty club.
  describe("the service key is the right key", () => {
    const claim = (role) =>
      "x." + Buffer.from(JSON.stringify({ iss: "supabase", role })).toString("base64") + ".y";
    const roleOf = async (val) => {
      const prev = process.env.SUPABASE_SERVICE_ROLE_KEY;
      process.env.SUPABASE_SERVICE_ROLE_KEY = val;
      // The module reads the env at import, so each case needs its own instance.
      const m = await import("../src/lib/wearable.ts?probe=" + encodeURIComponent(String(val)));
      if (prev === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = prev;
      return m.serviceKeyRole();
    };

    itAsync("the legacy service_role JWT is recognised", async () =>
      eq(await roleOf(claim("service_role")), "service_role"));
    itAsync("the legacy anon JWT in that slot is named, not accepted", async () =>
      eq(await roleOf(claim("anon")), "anon"));
    // Supabase's current keys are opaque strings, not JWTs. Reading them as JWTs reported a
    // perfectly good key as unrecognised, which is a false alarm about a working club.
    itAsync("the current secret key is recognised", async () =>
      eq(await roleOf("sb_secret_A1b2C3d4E5f6G7h8"), "service_role"));
    itAsync("the current publishable key in that slot is named", async () =>
      eq(await roleOf("sb_publishable_A1b2C3d4E5f6"), "anon"));
    itAsync("an empty setting is 'missing', not 'unknown'", async () =>
      eq(await roleOf(""), "missing"));
    itAsync("something that is not a key at all does not throw", async () =>
      eq(await roleOf("not-a-jwt"), "unknown"));

    it("the wrong key is reported as loudly as no key", () => {
      const route = readFileSync(new URL("../src/app/api/wearable/status/route.ts", import.meta.url), "utf8");
      eq(/read and write nothing/.test(route), true,
         "saying what it will do is the whole point of saying it");
      eq(/missing\.push/.test(route.slice(route.indexOf("serviceOk === false"))), true,
         "it has to reach the same list a missing key reaches");
    });
    // A shape check can only ever guess, and guessed wrong the moment the format changed. The
    // admin endpoint no other key can reach settles it, and will still be right next time.
    it("the verdict comes from Supabase, not from reading the string", () => {
      const lib = readFileSync(new URL("../src/lib/wearable.ts", import.meta.url), "utf8");
      eq(/auth\/v1\/admin\/users/.test(lib), true, "the one endpoint only service-role reaches");
      eq(/if \(r\.status === 401 \|\| r\.status === 403\) return false/.test(lib), true);
      eq(/return null;\s*\/\/ Supabase had a bad moment/.test(lib), true,
         "an outage must not be reported as a wrong key");
    });
    it("only a definite no is called a fault", () => {
      const route = readFileSync(new URL("../src/app/api/wearable/status/route.ts", import.meta.url), "utf8");
      eq(/serviceOk === false/.test(route), true, "null means cannot tell, and must not raise an alarm");
      eq(/!serviceOk\)/.test(route), false, "that would treat 'cannot tell' as 'wrong'");
    });
    it("the key itself is never returned", () => {
      const route = readFileSync(new URL("../src/app/api/wearable/status/route.ts", import.meta.url), "utf8");
      eq(/SB_SERVICE|process\.env\.SUPABASE_SERVICE_ROLE_KEY/.test(route), false,
         "this endpoint reports configuration, never values");
    });
  });

  // Sign-in is an email and a password checked by Supabase. The Add staff form asked for a
  // username and a PIN, which sign-in reads for neither purpose — so every account it created
  // looked complete in Admin and could not be signed into at all.
  describe("adding a coach creates an account they can sign in with", () => {
    const fn = sourceBetween("async staffAddCreate(){", "\n  staffAddDelete(");

    it("it asks for the two things sign-in actually uses", () => {
      const form = SOURCE.slice(SOURCE.indexOf("{{ staffAddOpen }}"), SOURCE.indexOf("{{ staffCreateLabel }}"));
      eq(/\{\{ staffForm\.email \}\}/.test(form), true, "the email is what they sign in with");
      eq(/\{\{ staffForm\.pass \}\}/.test(form), true, "and there is no way to set a password later without one");
    });
    it("the sign-in account is created before the row, not after", () => {
      const authAt = fn.indexOf("/api/staff/set-password");
      const rowAt = fn.indexOf("__vxUpsert('staff_accounts'");
      eq(authAt > -1 && rowAt > authAt, true,
         "a row with no login is the state this exists to stop, and must not be left behind");
    });
    it("a failed sign-in account saves nothing at all", () => {
      const block = fn.slice(fn.indexOf("if(!r.ok)"), fn.indexOf("const id='st_"));
      eq(/return bad\(/.test(block), true, "it has to stop before the row is written");
      eq(/Nothing has been saved/.test(fn), true, "and say so, or the coach is told to try a login that does not exist");
    });
    it("the row carries the email, or the database treats the coach as a parent", () => {
      eq(/email:email/.test(fn), true,
         "vx_staff_emails is filled from this column — without it: no squads, no plans, no register");
    });
    it("a password Supabase will refuse is refused here first", () =>
      eq(/pass\.length<8/.test(fn), true, "a 502 from the server is not an explanation"));
    it("an email already in use is caught before the server is asked", () =>
      eq(/some\(a=>\(a\.email\|\|''\)\.trim\(\)\.toLowerCase\(\)===email\)/.test(fn), true,
         "otherwise adding a coach twice silently resets their password"));
    it("the PIN is no longer required to create an account", () => {
      eq(/if\(!name\|\|!user\|\|!pin\)/.test(fn), false, "nothing reads the PIN at sign-in");
      eq(/pin:''/.test(fn), true, "and none is stored");
    });
    it("the new coach's access level is recorded", () => {
      eq(/access:\(_n\?\(_n\+' squad'/.test(fn), true, "how many squads they were given");
      eq(/this\._isFullAccess\(o\)\?' \+ full access':''/.test(fn), true,
         "who was given the run of the club is exactly what the log is for");
    });
  });

  // One dropdown was answering two questions: "no squad" meant every squad AND the run of the
  // club. So a fitness coach who needs all nine squads could only be given them by making them
  // a manager, and a coach could have one squad or none — never two.
  describe("squad access and full access are different questions", () => {
    const squads = [{ id: "junior" }, { id: "seniora" }, { id: "vortexa" }];
    // The real list, read out of the page rather than repeated here — a copy would keep passing
    // after somebody gave Fitness Coach the run of the club.
    globalThis.VX_FULL_ACCESS_ROLES = JSON.parse(
      (SOURCE.match(/const VX_FULL_ACCESS_ROLES=(\[[^\]]*\])/) || [])[1].replace(/'/g, '"'));
    const ctx = () => {
      const c = { squads, squadById: Object.fromEntries(squads.map((s) => [s.id, s])), _me: () => null };
      c._squadIdsOf = bind("_squadIdsOf", c);
      c._mySquadIds = bind("_mySquadIds", c);
      c._canSeeSquad = bind("_canSeeSquad", c);
      c._rolesOf = bind("_rolesOf", c, ["_me"]);
      c._roleLabel = bind("_roleLabel", c, ["_rolesOf"]);
      c._isFullAccess = bind("_isFullAccess", c, ["_me", "_rolesOf"]);
      return c;
    };

    it("two squads is now something that can be said", () => {
      const c = ctx();
      const a = { squadId: "junior,seniora" };
      eq(c._mySquadIds(a).length, 2);
      eq(c._canSeeSquad("junior", a), true);
      eq(c._canSeeSquad("seniora", a), true);
      eq(c._canSeeSquad("vortexa", a), false, "a third squad was not granted");
    });
    it("one squad still works exactly as it did", () => {
      const c = ctx();
      eq(c._canSeeSquad("junior", { squadId: "junior" }), true);
      eq(c._canSeeSquad("seniora", { squadId: "junior" }), false);
    });
    it("none means every squad, as it always has", () => {
      const c = ctx();
      eq(c._mySquadIds({ squadId: "" }), null);
      for (const s of squads) eq(c._canSeeSquad(s.id, { squadId: "" }), true);
    });
    it("a squad that no longer exists is ignored, not treated as a lock", () => {
      const c = ctx();
      eq(c._mySquadIds({ squadId: "deleted_squad" }), null,
         "a stale id must not leave a coach seeing nothing at all");
      eq(c._mySquadIds({ squadId: "junior,deleted_squad" }).length, 1);
    });
    it("a fitness coach can have every squad without the run of the club", () => {
      const c = ctx();
      const fitness = { role: "Fitness Coach", squadId: "" };
      eq(c._mySquadIds(fitness), null, "every squad");
      eq(c._isFullAccess(fitness), false, "and still cannot open Club Administration");
    });
    it("a coach locked to one squad is still not an admin", () =>
      eq(ctx()._isFullAccess({ role: "Coach", squadId: "junior" }), false));
    it("the roles that do carry full access", () => {
      const c = ctx();
      for (const role of ["Owner", "CEO", "Aquatic Director", "Technical Manager", "Head Coach", "Manager", "Admin"])
        eq(c._isFullAccess({ role }), true, role + " must be able to run the club");
      for (const role of ["Coach", "Assistant Coach", "Fitness Coach"])
        eq(c._isFullAccess({ role }), false, role + " must not be able to rewrite the club");
    });
    it("the two managers keep it whatever their role says", () => {
      const c = ctx();
      eq(c._isFullAccess({ id: "ahmed", role: "Coach" }), true);
      eq(c._isFullAccess({ id: "sameh", role: "Coach" }), true);
    });
    // One person, two jobs: an assistant coach who also runs the fitness work is one login,
    // not two accounts.
    it("somebody can hold two positions", () => {
      const c = ctx();
      const a = { role: "Assistant Coach,Fitness Coach" };
      eq(c._rolesOf(a).length, 2);
      eq(c._roleLabel(a), "Assistant Coach · Fitness Coach");
      eq(c._isFullAccess(a), false, "neither job carries the run of the club");
    });
    it("one full-access position is enough, whatever the other one is", () => {
      const c = ctx();
      eq(c._isFullAccess({ role: "Head Coach,Fitness Coach" }), true,
         "taking on the fitness work must not cost a head coach the run of the club");
      eq(c._isFullAccess({ role: "Fitness Coach,Coach" }), false);
    });
    it("a single position still works exactly as it did", () => {
      const c = ctx();
      eq(c._roleLabel({ role: "Coach" }), "Coach");
      eq(c._isFullAccess({ role: "Manager" }), true);
    });
    it("spacing around the comma does not change who can do what", () => {
      const c = ctx();
      eq(c._isFullAccess({ role: " Head Coach , Fitness Coach " }), true);
      eq(c._rolesOf({ role: "Coach, ,Fitness Coach" }).length, 2, "an empty entry is not a position");
    });
    it("no position at all is not full access", () =>
      eq(ctx()._isFullAccess({ role: "" }), false));
    it("the position catalogue is shared by both forms", () => {
      eq(/const VX_ROLES=\[/.test(SOURCE), true);
      for (const r of ["Assistant Coach", "Fitness Coach", "Head Coach", "Owner"])
        eq(new RegExp("'" + r + "'").test((SOURCE.match(/const VX_ROLES=\[[^\]]*\]/) || [""])[0]), true,
           r + " is missing from the list both forms draw from");
      eq(/<option>Owner<\/option>/.test(SOURCE), false, "the single-choice dropdown is gone");
    });
    it("creating a coach with no position at all is refused", () =>
      eq(/Choose at least one position/.test(SOURCE), true,
         "the position decides what they can do, so it cannot be left empty"));

    it("full access is no longer two hardcoded ids", () =>
      eq(/isAdminUser: \(\(\)=>\{ const acc=.*acc\.id==='ahmed'/.test(SOURCE), false,
         "every other manager was locked out of Club Administration by that"));
    it("the dashboard counts every squad a coach can see, not just one", () => {
      const line = (SOURCE.match(/const scopeIds = [^\n]*/) || [""])[0];
      eq(/_myIds \? _myIds\.slice\(\) : this\.squads\.map/.test(line), true,
         "it read one squad or all, so two squads would have counted as none of them");
    });
    it("the form can express all of it", () => {
      eq(/onStaffSquadAll/.test(SOURCE), true, "'all squads' has to be reachable in one tap");
      eq(/staffSquadChips/.test(SOURCE), true, "and each squad individually, to make two");
      eq(/<option value="">Full access — all squads/.test(SOURCE), false,
         "that option is what conflated the two questions");
    });
    it("the form says what the choice actually grants", () =>
      eq(/they can coach and record, but not open Club Administration/.test(SOURCE), true,
         "'all squads' and 'full access' read as the same thing until one of them says otherwise"));
  });

  // A white screen and "Can't find variable: _lockSquad" — the whole app, on every device,
  // because a rename left one reference behind. `new Function(src)` parses it happily: an
  // undeclared variable is not a syntax error, it is a runtime one, and the runtime here is a
  // coach's phone at the poolside.
  //
  // renderVals() builds every value the page renders and is where these locals live. They are
  // written with a leading underscore by convention, which makes them findable: each one used
  // must be declared in the same function.
  it("every local in renderVals is one that exists", () => {
    const start = SOURCE.indexOf("  renderVals(){");
    eq(start > -1, true, "renderVals must still be findable by this test");
    // Bounded by the method's own closing brace — the first line that is exactly two spaces
    // and a brace. Getting this wrong once meant the slice ran to the end of the file and the
    // check reported a property from a different method.
    const end = SOURCE.indexOf("\n  }\n", start);
    eq(end > start, true, "renderVals must have a findable end");
    const body = SOURCE.slice(start, end + 4);   // include the closing brace itself
    eq(body.length > 10000, true, "the slice must actually cover the function");
    // The failure that made this check useless the first time: indexOf returned -1, the slice
    // ran to the end of the file, and it reported a property from a different method.
    eq(end !== -1 && body.trimEnd().endsWith("}"), true, "the slice must stop at the method's end");

    const declared = new Set();
    for (const m of body.matchAll(/\b(?:const|let|var)\s+(_\w+)/g)) declared.add(m[1]);
    // Destructuring and parameters, e.g. `const [_a, _b] =` or `.map((_x)=>`.
    for (const m of body.matchAll(/[[({,]\s*(_\w+)\s*[,\])=]/g)) declared.add(m[1]);

    // Comments name these variables when explaining them, and a mention in prose is not a use —
    // scanning them reported _isBlob, which is a property of a video and always was.
    const code = body.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    const used = new Set();
    for (const m of code.matchAll(/(^|[^\w.$'"])(_[a-zA-Z]\w*)/gm)) used.add(m[2]);

    const missing = [...used].filter((n) => !declared.has(n));
    eq(missing.join(", "), "", "used in renderVals but never declared there");
  });

  // A build that throws while drawing the screen takes the whole interface with it — including
  // the Update bar, which is the only thing that could fetch the build that fixes it. The advice
  // left was "close the tab and hope".
  describe("a way out of a build that will not start", () => {
    const boot = sourceBetween("---- A way out of a broken build", "</script>");

    it("it lives outside the app, before any of it runs", () => {
      const at = SOURCE.indexOf("A way out of a broken build");
      eq(at > -1 && at < SOURCE.indexOf("class Component extends"), true,
         "inside the app it would be taken down by the same error it exists to survive");
      eq(at < SOURCE.indexOf('<script src="assets/react.js">'), true, "and before the framework");
    });
    it("an uncaught error is what triggers it", () => {
      eq(/addEventListener\('error'/.test(boot), true);
      eq(/unhandledrejection/.test(boot), true, "a failed promise leaves the same blank screen");
    });
    it("a broken image is not a broken app", () =>
      eq(/e\.target !== window && e\.target\.tagName\) return/.test(boot), true,
         "a missing photo must not put a scary bar on a working app"));
    it("it clears the saved copy, which is the thing a plain reload will not", () => {
      eq(/getRegistrations\(\)/.test(boot), true, "the service worker serves the old shell");
      eq(/caches\.delete\(k\)/.test(boot), true);
      eq(/location\.replace\(location\.pathname \+ '\?v=' \+ Date\.now\(\)\)/.test(boot), true,
         "and the URL has to change, or the browser answers from its own cache");
    });
    it("the button can never be left spinning", () =>
      eq(/setTimeout\(done, 4000\)/.test(boot), true,
         "if clearing hangs, reloading anyway is better than a dead button"));
    it("it says nothing at all while the app is working", () =>
      eq(/var shown = false;/.test(boot), true, "and never twice"));
  });

  // The update bar only appears once a background check has noticed a newer build. That check
  // runs every few minutes and can be late — and the moment it matters most is when the app is
  // misbehaving and nobody can tell which build a phone is on.
  describe("getting the latest version without waiting to be told", () => {
    it("there is a button that is always there", () => {
      eq(/onclick="\{\{ onForceUpdate \}\}"/.test(SOURCE), true);
      eq(/onForceUpdate: \(\)=>\{[\s\S]{0,200}?this\._applyUpdate\(\)/.test(SOURCE), true,
         "it has to clear the saved copy, not just reload");
    });
    it("it is inside About this club, next to the build number", () => {
      const about = SOURCE.slice(SOURCE.indexOf("About this club"), SOURCE.indexOf("Reset local data"));
      eq(/\{\{ onForceUpdate \}\}/.test(about), true, "that is where somebody looks when checking a build");
      eq(/\{\{ appBuild \}\}/.test(about), true);
    });
    it("it names the newer build when one is known", () =>
      eq(/forceUpdateLabel: S\.updateReady \? \('Update to '/.test(SOURCE), true));
    it("it promises nothing about losing data, because it loses none", () =>
      eq(/Nothing on the record is affected/.test(SOURCE), true));
  });

  // Squads were written into the page: nine of them, fixed. Now they can be added, renamed,
  // recoloured and reordered — and the two ways that could lose a child's history are the ones
  // worth pinning down.
  describe("squads can be changed without losing what is filed under them", () => {
    const mk = (roster, edits) => {
      const c = {
        _baseSquads: [
          { id: "junior", name: "Junior", ages: "11–12", accent: "#2A63E0", short: "Jr" },
          { id: "seniora", name: "Senior A", ages: "14", accent: "#3B23C7", short: "SrA" },
        ],
        roster: roster || {},
        squadEdits: edits || { ovr: {}, added: [], removed: {}, order: [] },
        state: { squadForm: {} },
        setState(p) { Object.assign(this.state, p); },
        forceUpdate() {},
        rebuildRoster() {},
        _saveJSON() {},
        audit() {},
        _loadJSON: () => ({}),
      };
      c._glowFrom = bind("_glowFrom", c);
      c._rebuildSquads = bind("_rebuildSquads", c, ["_glowFrom"]);
      c._loadJSON = () => null;   // nothing stored: fall back to the in-memory overlay
      c._currentSquadEdits = bind("_currentSquadEdits", c, ["_loadJSON"]);
      c._saveSquads = bind("_saveSquads", c, ["_rebuildSquads", "rebuildRoster", "forceUpdate", "_saveJSON"]);
      c.squadAdd = bind("squadAdd", c, ["_glowFrom", "_saveSquads", "audit", "_currentSquadEdits"]);
      c.squadDelete = bind("squadDelete", c, ["_saveSquads", "audit", "_currentSquadEdits"]);
      c._squadSaveWatch = () => {};
      c.squadFieldSave = bind("squadFieldSave", c, ["_saveSquads", "audit", "_squadSaveWatch", "_currentSquadEdits"]);
      c.squadMove = bind("squadMove", c, ["_saveSquads", "_currentSquadEdits"]);
      c._rebuildSquads();
      return c;
    };

    it("a squad with swimmers in it cannot be deleted", () => {
      const c = mk({ junior: [{ id: "s1" }, { id: "s2" }], seniora: [] });
      c.squadDelete("junior");
      eq(!!c.squadById.junior, true, "the squad must still be there");
      eq(/still has 2 swimmers/.test(c.state.squadMsg), true);
      eq(c.state.squadOk, false);
    });
    it("and it says where to move them, because that is the only safe order", () => {
      const c = mk({ junior: [{ id: "s1" }], seniora: [] });
      c.squadDelete("junior");
      eq(/Move swimmers/.test(c.state.squadMsg), true);
      eq(/pointing at nothing/.test(c.state.squadMsg), true, "the reason is not obvious from outside");
    });
    it("an empty squad can be deleted", () => {
      const c = mk({ junior: [{ id: "s1" }], seniora: [] });
      globalThis.window = { confirm: () => true };
      c.squadDelete("seniora");
      eq(!!c.squadById.seniora, false);
      eq(c.squads.length, 1);
    });
    it("the last squad is never deleted, even when empty", () => {
      const c = mk({ junior: [], seniora: [] });
      globalThis.window = { confirm: () => true };
      c.squadDelete("seniora");
      c.squadDelete("junior");
      eq(c.squads.length, 1, "a club with no squads has nowhere to put anybody");
    });
    it("declining the confirmation deletes nothing", () => {
      const c = mk({ junior: [{ id: "s1" }], seniora: [] });
      globalThis.window = { confirm: () => false };
      c.squadDelete("seniora");
      eq(!!c.squadById.seniora, true);
    });

    // The id is what every register mark, plan, invoice, membership, meet entry and coach's
    // access is keyed to. A rename that changed it would detach all of it, silently.
    it("renaming changes the label and never the id", () => {
      const c = mk({});
      c.squadFieldSave("junior", { name: "Juniors 11-12" });
      eq(c.squadById.junior.name, "Juniors 11-12");
      eq(c.squads.filter((s) => s.id === "junior").length, 1, "the id must survive a rename");
      eq(!!c.squadById.juniors1112, false, "and no new id may appear");
    });
    it("a new squad gets an id of its own, never a used one", () => {
      const c = mk({});
      c.state.squadForm = { name: "Junior", ages: "11" };
      c.squadAdd();
      eq(/already a squad called Junior/.test(c.state.squadMsg), true, "a duplicate name is refused");
      c.state.squadForm = { name: "Juniors B", ages: "12" };
      c.squadAdd();
      const added = c.squads.find((s) => s.name === "Juniors B");
      eq(!!added, true);
      eq(added.id !== "junior", true, "a fresh squad must not inherit another's history");
      eq(added.count, 0);
    });
    it("a squad with no name is refused", () => {
      const c = mk({});
      c.state.squadForm = { name: "   " };
      c.squadAdd();
      eq(/Give the squad a name/.test(c.state.squadMsg), true);
    });
    it("the glow follows the colour rather than being left behind", () => {
      const c = mk({});
      c.squadFieldSave("junior", { accent: "#FF0000" });
      eq(c.squadById.junior.glow, "rgba(255,0,0,.35)");
    });
    it("reordering keeps every squad", () => {
      const c = mk({});
      c.squadMove("seniora", -1);
      eq(c.squads.map((s) => s.id).join(","), "seniora,junior");
      eq(c.squads.length, 2, "moving must not drop one");
      c.squadMove("seniora", -1);
      eq(c.squads.map((s) => s.id).join(","), "seniora,junior", "moving past the top does nothing");
    });
    // Deleting a squad makes a target that no longer exists possible for the first time. The
    // roster is rebuilt only from squads that exist, so a swimmer sent to a missing one would
    // vanish from every screen while still sitting in the stored edits.
    it("nobody can be moved into a squad that no longer exists", () => {
      eq(/if\(!this\.squadById\[mv\.to\]\)\{ lost\+\+; return; \}/.test(SOURCE), true,
         "a batch move must skip a missing target, not write it");
      eq(/that squad no longer exists/.test(SOURCE), true, "and say so rather than losing them quietly");
      eq(/if\(!this\.squadById\[toSquadId\]\) return this\.setState/.test(SOURCE), true,
         "the single move needs the same check");
    });
    it("auto-assign leaves alone any squad that has been deleted", () =>
      eq(/return to!==m\.homeId && !!this\.squadById\[to\];/.test(SOURCE), true,
         "the age map names the original nine, and any of them may be gone"));
    // A coach with two squads signed in and got a white screen: undefined is not an object,
    // evaluating 'squad.count'. The account's squads are held as 'vortexb,vortexa', and that
    // whole string was stored as the CURRENT squad — which matches no squad at all.
    it("the current squad is one squad, never the list", () => {
      const signIn = (SOURCE.match(/\{ const _first=this\._squadIdsOf\(acct\)\[0\][^\n]*/) || [""])[0];
      eq(/if\(_first\) st\.squadId=_first;/.test(signIn), true,
         "storing the whole list makes every squad lookup fail");
      eq(/if\(acct\.squadId\)\{ st\.squadId=acct\.squadId; \}/.test(SOURCE), false,
         "that assignment is what took the app down for a two-squad coach");
    });
    it("a restored session picks a squad that exists", () => {
      const restore = (SOURCE.match(/var _fs=String\(_a\.squadId\|\|''\)[\s\S]{0,220}?if\(_fs\)/) || [""])[0];
      eq(/this\.squadById\[x\]/.test(restore), true, "a deleted squad must not come back as the current one");
      eq(/\[0\]/.test(restore), true, "one of them, not all of them");
    });
    it("the page never draws with a squad that is not there", () => {
      const fallback = (SOURCE.match(/const squad = this\.squadById\[S\.squadId\][\s\S]{0,220}?;/) || [""])[0];
      eq(/this\.squadById\[\(this\._mySquadIds\(\)\|\|\[\]\)\[0\]\]/.test(fallback), true,
         "fall back to a squad this account can see");
      eq(/\|\| this\.squads\[0\];/.test(fallback), true, "and to the first squad rather than nothing at all");
    });
    it("the first of a coach's squads is a real one", () => {
      const c = mk({});
      c._squadIdsOf = bind("_squadIdsOf", c);
      eq(c._squadIdsOf({ squadId: "seniora,junior" })[0], "seniora");
      eq(c._squadIdsOf({ squadId: "deleted,junior" })[0], "junior", "a stale id must not become the current squad");
      eq(c._squadIdsOf({ squadId: "" })[0], undefined, "all squads has no first one, and must not invent it");
    });
    // Three bugs in one day came from the same mistake: reading an ACCOUNT's squadId as if it
    // were one squad. It is a list now, so `this.roster[acc.squadId]` is undefined and
    // `state.squadId = acc.squadId` is a squad that does not exist. A swimmer's squadId is
    // still single and is not what this is about.
    it("no account's squad list is ever used as a single squad", () => {
      const offenders = [];
      const patterns = [
        /this\.roster\[(?:acc|acct|a|_a)\.squadId\]/g,     // the whole list as a roster key
        /squadId:\s*\(?(?:acc|acct|_a)\.squadId/g,          // stored as the current squad
        /squadById\[(?:acc|acct|a|_a)\.squadId\]/g,         // looked up as one squad
      ];
      for (const re of patterns)
        for (const m of SOURCE.matchAll(re)) offenders.push(m[0]);
      eq(offenders.join(" | "), "", "read through _squadIdsOf / _mySquadIds instead");
    });
    it("a two-squad coach's dashboard counts both squads", () => {
      const line = (SOURCE.match(/const scopeSw = [\s\S]{0,260}?;\n/) || [""])[0];
      eq(/_myIds\s*\n?\s*\? _myIds\.reduce/.test(line), true,
         "it counted nobody at all, because roster has no 'vortexb,vortexa' key");
    });
    it("the managers' gate is the same one everywhere", () => {
      eq(/_isAdmin\(\)\{ return this\._isFullAccess\(this\._me\(\)\); \}/.test(SOURCE), true,
         "two hardcoded ids locked every other manager out of the alerts and the data check");
      eq(/m\.id==='ahmed'\|\|m\.id==='sameh'/.test(SOURCE), false);
    });
    // Colours changed one day were gone the next. Two causes, and neither said anything at the
    // time — which is the part that made it look like the panel simply did not work.
    // The editor holds a draft; nothing is written until Save. Writing on every keystroke meant
    // a re-render between each letter, which fights whoever is typing, and left "Done" as a
    // button that closed the panel without ever being the thing that saved.
    it("editing a squad writes nothing until Save is pressed", () => {
      const row = sourceBetween("squadRows: this.squads.map((sq, i)=>{", "dirty: editing");
      for (const h of ["onEditName", "onEditAges", "onEditShort", "onEditAccent"])
        eq(new RegExp(h + ":\\(e\\)=>setD\\(").test(row), true, h + " must only touch the draft");
      eq(/squadFieldSave/.test(row.slice(0, row.indexOf("onSaveSquad"))), false,
         "no field may save on its own any more");
      eq(/onSaveSquad:\(\)=>\{ this\.squadFieldSave/.test(row), true, "Save is what writes");
    });
    it("the button that closes is not the button that saves", () => {
      const row = sourceBetween("squadRows: this.squads.map((sq, i)=>{", "dirty: editing");
      eq(/editLabel: editing\?'Close':'Edit'/.test(row), true,
         "'Done' read as 'save and close' and did neither");
      eq(/\{\{ sq\.onSaveSquad \}\}/.test(SOURCE), true, "and there is a real Save in the panel");
    });
    it("closing the editor throws the draft away rather than half-applying it", () => {
      const row = sourceBetween("squadRows: this.squads.map((sq, i)=>{", "dirty: editing");
      eq(/squadDraft: editing\?null:/.test(row), true);
    });
    it("a colour picked but never committed is still caught", () => {
      const row = (SOURCE.match(/<input type="color" value="\{\{ sq\.editAccent \}\}"[^>]*>/) || [""])[0];
      eq(/oninput=/.test(row) && /onchange=/.test(row), true,
         "some pickers fire only one of the two, and both now cost nothing because they only "
         + "touch the draft");
    });
    it("a squad change reaches the other devices without a reload", () => {
      eq(/this\.squadEdits=g\('vx_squads', this\.squadEdits\)/.test(SOURCE), true,
         "every other synced key is applied here and this one was missing");
      const line = (SOURCE.match(/this\.squadEdits=g\('vx_squads'[^\n]*/) || [""])[0];
      eq(/this\._rebuildSquads\(\)/.test(line), true, "and the list has to be rebuilt from it");
    });
    it("a save the database refused says so, rather than looking fine until tomorrow", () => {
      eq(/_squadSaveWatch/.test(SOURCE), true);
      const fn = sourceBetween("async _squadSaveWatch(patch){", "\n  rebuildRoster(){");
      eq(/r\.ok===false/.test(fn), true);
      eq(/it will be lost when the app is reopened/.test(fn), true,
         "a silent refusal looks exactly like a save until the next time the app is opened");
    });
    it("a successful blob write leaves nothing behind", () => {
      const retry = sourceBetween('if(it.op==="push"){', "var fn = it.op===");
      eq(/pushKey\(it\.table, pv\)/.test(retry), true, "only pushKey knows how to write one");
    });
    // An edit built on the copy loaded at start-up pushes that older overlay back over a newer
    // one, losing a change that had already saved correctly.
    it("an edit is built on the freshest overlay, not the one from start-up", () => {
      for (const fn of ["squadFieldSave(id, patch){", "squadAdd(){", "squadDelete(id){", "squadMove(id, dir){"]) {
        const at = SOURCE.indexOf("  " + fn);
        eq(at > -1, true, fn + " must still be findable");
        const body = SOURCE.slice(at, SOURCE.indexOf("\n  }", at));
        eq(/_currentSquadEdits\(\)/.test(body), true, fn + " still builds on this.squadEdits");
      }
      const cur = sourceBetween("_currentSquadEdits(){", "\n  }");
      eq(/this\._loadJSON\('vx_squads', null\)/.test(cur), true, "the sync refreshes that on every pull");
    });
    // The sync keeps whichever copy was written most recently, decided by a timestamp the device
    // stores for itself. A device that wrote last is pinned to its own copy for good — so a
    // correction made on another phone, or in the SQL editor, can never reach it.
    it("a device pinned to its own copy can be told to take the shared one", () => {
      const fn = sourceBetween("async squadUseDatabase(){", "\n  // ---- adding");
      eq(/localStorage\.removeItem\('__vxts_vx_squads'\)/.test(fn), true,
         "the newer-than claim has to go first, or the next pull undoes it");
      const clearAt = fn.indexOf("removeItem('__vxts_vx_squads')");
      const storeAt = fn.indexOf("'vx_squads', JSON.stringify(v)");
      eq(clearAt > -1 && clearAt < storeAt, true, "and before the value is stored, not after");
      eq(/this\._rebuildSquads\(\)/.test(fn), true, "and the screen has to follow");
    });
    it("the check reports all three copies, not just one", () => {
      const fn = sourceBetween("async squadDiagnose(){", "\n  // The escape hatch");
      for (const w of ["Database:", "This device:", "On screen:"])
        eq(fn.includes(w), true, "it has to say where they disagree, not just that they do");
      eq(/pinned/.test(fn), true, "and name the pinning, which is the one cause nothing else shows");
    });
    it("a value stored as text is read as well as one stored as json", () => {
      const fn = sourceBetween("async squadDiagnose(){", "\n  // The escape hatch");
      eq(/typeof row\.value==='string'/.test(fn), true,
         "club_state.value can come back either way and one of them would read as no changes");
    });
    // 304 swimmers became 317: a device holding an older roster changed something and published
    // the lot, replacing every addition and removal every other device had made.
    it("a stale device cannot publish the whole roster over a newer one", () => {
      const fn = sourceBetween("  persistRosterEdits(){", "\n  }");
      eq(/_blobIsStale\('vx_roster_edits'\)/.test(fn), true, "it has to check before writing");
      const guard = fn.slice(0, fn.indexOf("this._saveJSON"));
      eq(/return this\.setState/.test(guard), true, "and stop, not warn and write anyway");
      eq(/replace every swimmer they added or removed/.test(fn), true,
         "the person needs to know what was at stake, not just that it did not save");
    });
    it("staleness is judged against what the database actually said", () => {
      eq(/window\.__vxRemoteTs\[r\.key\]=remoteTs/.test(SOURCE), true,
         "recorded even when this device's copy is kept, or a later write cannot tell");
      const fn = sourceBetween("_blobIsStale(key){", "\n  }");
      eq(/remote > mine \+ 60000/.test(fn), true, "clocks differ; a device that just wrote is not stale");
    });
    it("squad edits sync to the database like everything else", () =>
      eq(/var SYNC = \["vx_squads"/.test(SOURCE), true,
         "a squad added on one device has to exist on all of them"));
    it("the panel shows the swimmer count, so Delete is never a surprise", () =>
      eq(/deleteHint: n>0 \? \('Move its '\+n\+' swimmer'/.test(SOURCE), true));
  });

  // Registration is open to anyone, so the club collects logins nobody recognises — a coach who
  // signed up through the parent tab, a test account, an address typed twice. There was no way
  // to remove one.
  describe("deleting a family account", () => {
    const route = readFileSync(new URL("../src/app/api/family/delete/route.ts", import.meta.url), "utf8");

    it("only a manager may ask for it", () => {
      eq(/ADMIN_EMAILS\.includes\(email\)/.test(route), true, "the caller's own token is checked");
      eq(/status: 403/.test(route), true);
      eq(/this\._isFullAccess\(\) &&/.test(SOURCE), true, "and the button is not shown to a coach");
    });
    // Deleting only the row is worse than doing nothing: the person can still sign in, and the
    // app rebuilds their account from the Auth user's metadata the moment they do.
    it("the sign-in goes with the row, or it comes straight back", () => {
      eq(/auth\/v1\/admin\/users\/\$\{uid\}/.test(route), true);
      eq(/method: "DELETE"/.test(route), true);
      eq(/it would come back next time they signed in/.test(route), true,
         "a half-delete has to be reported as a failure, not a success");
    });
    // A coach's staff login and their stray parent registration can be the same address.
    it("a staff address keeps its login", () => {
      eq(/isStaffEmail/.test(route), true);
      const guard = route.slice(route.indexOf("const staff = await isStaffEmail"));
      eq(/if \(staff\) \{[\s\S]*?action: "family-row-only"/.test(guard), true,
         "deleting that Auth user would lock a coach out of the club");
      eq(/return true;\s*\/\/ cannot tell/.test(route), true,
         "if the staff table cannot be read, keeping the login is the safe way to be wrong");
    });
    it("a manager cannot delete themselves or the other manager", () => {
      eq(/email === who\.email/.test(route), true);
      eq(/that is a manager's account and cannot be deleted here/.test(route), true);
      eq(/'sameh@vortexswimmingclub\.com'\]\.includes/.test(SOURCE), true,
         "and the button is hidden on those rows too");
    });
    it("the confirmation says how many children are attached", () => {
      const fn = sourceBetween("async famAdminDelete(famId){", "\n  famAdminUnlink(");
      eq(/child'\+\(kids===1\?'':'ren'\)\+' linked/.test(fn), true,
         "no children means a stray registration; two means somebody's parent");
      eq(/Nothing about the swimmers themselves is deleted/.test(fn), true);
      eq(/window\.confirm\(warn\)/.test(fn), true);
    });
    it("it is recorded in the activity log", () => {
      const fn = sourceBetween("async famAdminDelete(famId){", "\n  famAdminUnlink(");
      eq(/this\.audit\('family\.delete'/.test(fn), true, "removing somebody's access is exactly what a log is for");
    });
    it("a failure leaves the list alone rather than pretending", () => {
      const fn = sourceBetween("async famAdminDelete(famId){", "\n  famAdminUnlink(");
      const afterErr = fn.slice(fn.indexOf("if(!r.ok)"));
      eq(afterErr.indexOf("return this.setState") < afterErr.indexOf("_saveFamily"), true,
         "the row must not disappear from the screen when the server refused");
    });
  });

  // Fees are going to Odoo. Nothing is pushed yet — this is the part that has to be right first,
  // because "it did not work" is a useless thing to be told about a month of fees.
  describe("the Odoo connection", () => {
    const lib = readFileSync(new URL("../src/lib/odoo.ts", import.meta.url), "utf8");
    const status = readFileSync(new URL("../src/app/api/odoo/status/route.ts", import.meta.url), "utf8");

    it("the key lives on the server and is never returned", () => {
      eq(/process\.env\.ODOO_API_KEY/.test(lib), true);
      eq(/ODOO_KEY/.test(status), false, "the status route must not even import the key");
      eq(/process\.env\.ODOO_API_KEY/.test(status), false, "a status page reports configuration, never values");
    });
    // Odoo answers HTTP 200 with the reason inside the body, and returns `false` — not an error —
    // for a bad login. Both read as success to anything checking the obvious thing.
    it("an Odoo failure is not mistaken for success", () => {
      eq(/if \(j\.error\)/.test(lib), true, "HTTP 200 with an error in the body is the normal failure");
      eq(/typeof res === "number" && res > 0 \? res : null/.test(lib), true,
         "login returns false for wrong credentials, which is truthy-adjacent enough to catch people out");
    });
    it("the address mistake it is easiest to make is named outright", () =>
      eq(/no \/odoo on the end/.test(lib), true,
         "the URL in the browser ends in /odoo and that is not the API root"));
    it("the /odoo suffix is stripped rather than merely complained about", () =>
      eq(/\.replace\(\/\\\/odoo\$\/i, ""\)/.test(lib), true));
    it("a login that works but cannot bill is caught before the first invoice", () => {
      eq(/odooCanBill/.test(lib), true);
      eq(/account\.move/.test(lib), true, "invoices");
      eq(/res\.partner/.test(lib), true, "customers");
      eq(/is Accounting or Invoicing installed/.test(lib), true,
         "a key with no accounting rights authenticates perfectly and fails on the first push");
    });
    it("it helps find the database name rather than just demanding it", () => {
      eq(/odooDatabases/.test(lib), true);
      eq(/will not list its databases, which is normal/.test(status), true,
         "a disabled list is not a fault and must not read like one");
    });
    it("every call gives up rather than hanging", () =>
      eq(/AbortSignal\.timeout\(timeoutMs\)/.test(lib), true));
  });

  describe("the activity log", () => {
    // navigator is a getter-only global in Node, so it is replaced by descriptor and put back.
    const withNav = (ua, fn) => {
      const had = Object.getOwnPropertyDescriptor(globalThis, "navigator");
      Object.defineProperty(globalThis, "navigator", { value: { userAgent: ua }, configurable: true });
      try { return fn(); }
      finally { if (had) Object.defineProperty(globalThis, "navigator", had); else delete globalThis.navigator; }
    };
    const run = (fn, ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)") => {
      const sent = [];
      const restore = globalThis.window;
      globalThis.window = { __vxInsert: (t, rows) => { sent.push([t, rows]); return Promise.resolve(true); } };
      try { withNav(ua, fn); } finally { globalThis.window = restore; }
      return sent;
    };
    const ctxStaff = () => ({ state: { familyUser: null }, _me: () => ({ email: "A@Club.com", label: "Ahmed", role: "Owner" }) });

    it("an entry names who, what and where — and carries no timestamp", () => {
      const ctx = ctxStaff();
      const sent = run(() => bind("audit", ctx, ["_auditWho"])("plan.save", "Vortex B", { metres: 6700 }));
      const row = sent[0][1][0];
      eq(sent[0][0], "audit_log");
      eq(row.actor, "a@club.com");
      eq(row.actor_name, "Ahmed");
      eq(row.action, "plan.save");
      eq(row.detail.metres, 6700);
      eq("at" in row, false, "the server stamps the time — a timeline built from twelve phones' clocks is not a timeline");
    });
    it("a parent is recorded as the parent, not as whichever coach used the device last", () => {
      const ctx = { state: { familyUser: { email: "P@x.com", name: "A Parent" } }, _me: () => ({ label: "Ahmed" }) };
      const row = run(() => bind("audit", ctx, ["_auditWho"])("sign-in", "A Parent", {}))[0][1][0];
      eq(row.actor, "p@x.com");
      eq(row.actor_role, "parent");
    });
    it("the device is a kind, not a fingerprint", () => {
      const row = run(() => bind("audit", ctxStaff(), ["_auditWho"])("sign-in", "", {}))[0][1][0];
      eq(row.ua, "iPhone");
      eq(/Mozilla|CPU iPhone OS/.test(row.ua), false, "the full user-agent is a fingerprint and answers no question here");
    });
    it("recording something can never stop it happening", () => {
      const ctx = ctxStaff();
      const restore = globalThis.window;
      globalThis.window = { __vxInsert: () => { throw new Error("database is down"); } };
      try { bind("audit", ctx, ["_auditWho"])("attendance.mark", "x", {}); }
      finally { globalThis.window = restore; }
      // Reaching here at all is the assertion: a register must be markable with the log broken.
      eq(true, true);
    });
    it("with no sync layer it does nothing rather than failing", () => {
      const restore = globalThis.window;
      globalThis.window = {};
      try { bind("audit", ctxStaff(), ["_auditWho"])("sign-in", "", {}); }
      finally { globalThis.window = restore; }
      eq(true, true);
    });

    // A coach signed in and the log named nobody. The actor is worked out from the account held
    // in state, and at the moment a sign-in is recorded state still holds the previous one —
    // setState has not run, and would not be synchronous if it had. So every sign-in went in as
    // 'Staff' with no email: the one question the log exists to answer.
    describe("a sign-in says who signed in", () => {
      const rowFor = (call) => {
        const ctx = { state: {}, _auditWho: () => ({ email: "", name: "Staff", role: "Staff" }),
                      _roleLabel: (a) => String((a && a.role) || "").split(",").map((x) => x.trim()).filter(Boolean).join(" · ") };
        let sent = null;
        const restore = globalThis.window;
        globalThis.window = { __vxInsert: (t, rows) => { sent = rows[0]; return Promise.resolve(true); } };
        try { call(bind("audit", ctx, ["_auditWho"])); } finally { globalThis.window = restore; }
        return sent;
      };

      it("an explicit actor beats whatever state still holds", () => {
        const row = rowFor((audit) => audit("sign-in", "Ahmed Abdelwahab", { side: "staff" },
          { email: "ahmed.a@vortex.qa", name: "Ahmed Abdelwahab", role: "Assistant Coach · Fitness Coach" }));
        eq(row.actor, "ahmed.a@vortex.qa", "'Staff' with no email answers nothing");
        eq(row.actor_name, "Ahmed Abdelwahab");
      });
      it("without one it still falls back rather than failing", () => {
        const row = rowFor((audit) => audit("plan.save", "Vortex B", {}));
        eq(row.actor_name, "Staff", "every other action is recorded after state has caught up");
      });
      it("both sign-in paths name the account", () => {
        eq(/\{email:\(acct\.email\|\|''\)\.toLowerCase\(\)/.test(SOURCE), true, "staff sign-in");
        eq(/\{email:\(rec\.email\|\|''\)\.toLowerCase\(\)/.test(SOURCE), true, "family sign-in has the same problem");
      });
      it("the position is spelled out, not comma-jammed", () => {
        eq(/hubUserRole: this\._roleLabel\(acc\)/.test(SOURCE), true,
           "the header read 'ASSISTANT COACH,FITNESS COACH' straight from storage");
      });
    });

    it("the actions worth answering questions about are all recorded", () => {
      for (const a of ["sign-in", "sign-out", "plan.save", "attendance.mark", "invoice.issue",
                       "invoice.paid", "membership.set", "document.upload", "inbody.save",
                       "inbody.delete", "meet.entries", "staff.password", "staff.delete",
                       // A child joining, leaving or changing squad, a coach account being
                       // created, a parent registering: the roster questions somebody actually
                       // comes back and asks, and not one of them was recorded.
                       "swimmer.add", "swimmer.delete", "swimmer.move", "staff.add", "family.register"])
        eq(SOURCE.includes("'" + a + "'"), true, a + " is not recorded anywhere");
    });

    // The panel showed "Nothing recorded yet" whether the log was empty, unread, still loading,
    // or refused by the database — so pressing Load and pressing nothing looked identical, and
    // there was no way to tell an empty log from a broken one.
    describeAuditRead();
    function describeAuditRead() {
      const fetchWith = async (answer) => {
        const ctx = { state: { auditQuery: "" }, setState(p) { Object.assign(this.state, p); } };
        const restore = globalThis.window;
        globalThis.window = { __vxSelectRaw: async () => answer };
        try { await bind("_auditFetch", ctx)(); } finally { globalThis.window = restore; }
        return ctx;
      };

      itAsync("a table that does not exist names the file that creates it", async () => {
        const ctx = await fetchWith({ status: 404, rows: null, said: "" });
        eq(ctx.state.auditState, "error");
        eq(/audit_log\.sql/.test(ctx.state.auditErr), true, "the fix has to be in the message");
      });
      itAsync("a refused read is not reported as an empty log", async () => {
        const ctx = await fetchWith({ status: 403, rows: null, said: "" });
        eq(ctx.state.auditState, "error");
        eq(/refused/.test(ctx.state.auditErr), true);
      });
      itAsync("a log that reads back empty says so, and is not an error", async () => {
        const ctx = await fetchWith({ status: 200, rows: [], said: "" });
        eq(ctx.state.auditState, "empty");
        eq(ctx.state.auditErr, "");
      });
      itAsync("entries load", async () => {
        const ctx = await fetchWith({ status: 200, rows: [{ id: 1, action: "sign-in" }], said: "" });
        eq(ctx.state.auditState, "ok");
        eq(ctx.auditRows.length, 1);
      });
    }

    // A read alone cannot tell an empty log from one nothing can be written to, and those need
    // opposite actions — so the check writes an entry and reads it back.
    describeAuditTest();
    function describeAuditTest() {
      const run = async ({ insert, rows }) => {
        const ctx = { state: {}, setState(p) { Object.assign(this.state, p); },
                      _auditWho: () => ({ email: "a@b.c", name: "Ahmed", role: "Manager" }),
                      _auditFetch: () => {} };
        const restore = globalThis.window;
        globalThis.window = { __vxInsert: insert, __vxSelectRaw: async () => ({ status: 200, rows, said: "" }),
                              __vxLastError: { status: 403 } };
        try { await bind("_auditSelfTest", ctx)(); } finally { globalThis.window = restore; }
        return ctx.state.auditTestMsg;
      };
      itAsync("a refused write is reported as the log not recording at all", async () => {
        const msg = await run({ insert: async () => false, rows: [] });
        eq(/Nothing is being recorded/.test(msg), true);
        eq(/403/.test(msg), true, "the status sends a person to the right place");
      });
      itAsync("a write that cannot be read back is not called success", async () => {
        const msg = await run({ insert: async () => true, rows: [] });
        eq(/cannot be read back/.test(msg), true);
      });
      itAsync("written and read back is the only thing called working", async () => {
        let sent = null;
        const msg = await run({ insert: async (t, r) => { sent = r[0]; return true; },
                                rows: [{ detail: { mark: "x" } }] });
        // The mark is random, so the fake has to echo the one that was sent.
        eq(sent.action, "log.check");
        eq(/cannot be read back|Nothing is being recorded/.test(msg), true,
           "an echo of the wrong mark must not pass");
      });
    }

    it("the log is read on the way into the panel, not on request", () =>
      eq(/if\(r\.id==='audit'\)\{ try\{ this\._auditFetch\(\); \}catch\(e\)\{\} \}/.test(SOURCE), true,
         "an empty page was the first thing anyone saw"));
    it("the search box cannot be filled by the browser behind the user", () => {
      const box = (SOURCE.match(/<input value="\{\{ auditQuery \}\}"[^>]*>/) || [""])[0];
      eq(/autocomplete="off"/.test(box), true, "Safari filled it with the account's own email");
      eq(/name="vx-audit-search"/.test(box), true, "an unnamed field is a field the browser guesses at");
    });
    it("a search that hides every entry says so rather than looking empty", () =>
      eq(/No entry matches that search/.test(SOURCE), true));
    it("a refused entry is remembered, not dropped", () =>
      eq(/this\._auditWriteErr = \(e\.status\|\|0\)/.test(SOURCE), true,
         "a write refused every time and reported nowhere is not a log"));
    it("no child's name or document is copied into the log", () => {
      // Every call site passes an id, a date or a count — never a name or a file.
      const calls = [...SOURCE.matchAll(/this\.audit\('([\w.-]+)',\s*([^,]*),/g)].map((m) => m[2]);
      eq(calls.length >= 13, true, "the call sites must still be found by this test");
      for (const arg of calls)
        eq(/\bsw\.name\b|\bswimmer\.name\b|dataUrl|fileUrl|\bfile\b/.test(arg), false,
          "a log is read by more people than the record it describes: " + arg);
    });
    it("it cannot be edited or deleted from the app", () => {
      const sql = readFileSync(new URL("../supabase/audit_log.sql", import.meta.url), "utf8");
      eq(/for insert to authenticated/.test(sql), true);
      eq(/for update/i.test(sql), false, "an update policy would make it a list of events, not a log");
      eq(/for delete/i.test(sql), false);
      eq(/at\s+timestamptz not null default now\(\)/.test(sql), true, "the server's clock, not the phone's");
    });
  });

  // The plan review counted a session's volume by summing the distances alone, so 8x100 counted
  // as 100. A real 6,700 m session was reviewed as 4,150 m against a 6,000 m guide — so it
  // passed a check that exists to stop a squad of children being over-trained, and the sessions
  // it most needed to flag were exactly the ones it waved through.
  describe("the plan review measures the session the coach actually wrote", () => {
    const metres = bind("planMetres", {}, []);
    const plan = {
      sections: [
        { title: "Warm-up", sets: [{ dist: 400, reps: 1 }] },
        { title: "Main set", rounds: 3, sets: [{ dist: 100, reps: 8 }, { dist: 50, reps: 4, circuit: 2 }] },
        { title: "Cool-down", sets: [{ dist: 300, reps: 1 }] },
      ],
    };
    it("reps are counted, not just the distance", () => {
      eq(metres({ sections: [{ sets: [{ dist: 100, reps: 8 }] }] }), 800);
    });
    it("a section's rounds multiply everything in it", () =>
      eq(metres({ sections: [{ rounds: 3, sets: [{ dist: 100, reps: 8 }] }] }), 2400));
    it("a circuit counts too", () =>
      eq(metres({ sections: [{ sets: [{ dist: 50, reps: 4, circuit: 2 }] }] }), 400));
    it("the whole session adds up the way the plan screen shows it", () =>
      eq(metres(plan), 400 + 3 * (800 + 400) + 300));
    it("the review uses that one calculation and not its own", () => {
      const src = sourceBetween("// ---- AI Plan Review", "const rvChecks=[");
      eq(/const rvTotal=this\.planMetres\(rvPlan\)/.test(src), true);
      eq(/rvTotal\+=\(\+st\.dist/.test(src), false, "summing distances ignores reps and under-counts every session");
    });
  });
  // The screen promised "the AI writes the explanations" while printing hardcoded strings.
  it("Claude explains the verdicts and is never allowed to change one", () => {
    const fn = sourceBetween("async reviewAiExplain(plan, checks, squad, total, cap){", "async _aiAsk(");
    eq(/these verdicts are settled/.test(fn) && /Do not re-judge them/.test(fn), true,
      "the rules decide; the model only puts them into words");
    eq(/reviewAiOut/.test(fn), true);
    // The panel it writes must be additional, not a replacement for the rule list.
    eq(/reviewChecksV/.test(SOURCE) && /reviewAiHasOut/.test(SOURCE), true,
      "the verdicts must still be on screen alongside whatever the model says");
  });

  // Changing one swimmer's package used to rewrite all 304 of them. A membership is what a
  // family is charged, so a stale copy winning does not announce itself — it quietly bills the
  // wrong amount next month.
  describe("a membership is one swimmer's row", () => {
    const run = (existing, swId, patch) => {
      const sent = [], deleted = [];
      const ctx = { memberships: existing, forceUpdate() {}, _saveJSON() {} };
      const restore = globalThis.window;
      globalThis.window = {
        __vxUpsert: (t, rows) => { sent.push([t, rows]); return Promise.resolve(true); },
        __vxDelete: (t, qs) => { deleted.push([t, qs]); return Promise.resolve(true); },
      };
      try { bind("setMembership", ctx, ["_membership", "_memToRow"])(swId, patch); }
      finally { globalThis.window = restore; }
      return { sent, deleted, ctx };
    };
    it("setting one package writes one row", () => {
      const { sent } = run({ s1: { pkg: "3x" }, s2: { pkg: "4x" } }, "s1", { pkg: "6x" });
      const rows = sent.flatMap(([, r]) => r);
      eq(rows.length, 1);
      eq(rows[0].sw_id, "s1");
      eq(rows[0].pkg, "6x");
    });
    it("clearing a package deletes that row rather than leaving it behind", () => {
      const { deleted, sent } = run({ s1: { pkg: "3x" } }, "s1", { pkg: "", fitness: false });
      eq(sent.length, 0);
      eq(/sw_id=eq\.s1/.test(deleted[0][1]), true);
    });
    it("a blank date is stored as nothing, not an empty string", () => {
      const rows = run({}, "s1", { pkg: "3x", start: "", end: "2026-12-31" }).sent.flatMap(([, r]) => r);
      eq(rows[0].start_date, null, "a date column refuses an empty string and loses the write");
      eq(rows[0].end_date, "2026-12-31");
    });
    it("a round trip changes nothing", () => {
      const m = { pkg: "4x", fitness: true, paid: true, start: "2026-01-01", end: "2026-12-31", note: "n" };
      eq(JSON.stringify(bind("_memFromRow", {}, [])(bind("_memToRow", {}, [])("s1", m))), JSON.stringify(m));
    });
  });

  // An entry has a closing date. One that disappears after the deadline is a child who does not
  // swim, and nobody finds out until the heat sheets go up.
  describe("a meet entry is a row, not a rewrite of every meet", () => {
    const E = (swId, event, heat, lane) => ({ swId, name: swId, event, heat, lane });
    const run = (before, after, meet = "Doha Open") => {
      const sent = [], deleted = [];
      const ctx = { meetEntries: { [meet]: before, "Other Meet": [E("s9", "50 Free", 1, 1)] },
        forceUpdate() {}, _saveJSON() {} };
      const restore = globalThis.window;
      globalThis.window = {
        __vxUpsert: (t, rows) => { sent.push([t, rows]); return Promise.resolve(true); },
        __vxDelete: (t, qs) => { deleted.push([t, qs]); return Promise.resolve(true); },
      };
      try { bind("_entriesSave", ctx, ["_entryId", "_entryToRow"])(meet, after); }
      finally { globalThis.window = restore; }
      return { sent, deleted, ctx };
    };
    it("adding one entry writes one row", () => {
      const rows = run([E("s1", "100 Free", 1, 1)], [E("s1", "100 Free", 1, 1), E("s2", "50 Fly", 1, 2)])
        .sent.flatMap(([, r]) => r);
      eq(rows.length, 1);
      eq(rows[0].id, "Doha Open::s2::50 Fly");
    });
    it("re-seeding writes the entries whose heat or lane moved, and only those", () => {
      const rows = run([E("s1", "100 Free", 1, 1), E("s2", "100 Free", 1, 2)],
        [E("s1", "100 Free", 2, 4), E("s2", "100 Free", 1, 2)]).sent.flatMap(([, r]) => r);
      eq(rows.length, 1);
      eq(rows[0].heat, 2);
      eq(rows[0].lane, 4);
    });
    it("a scratched entry is deleted, or the swimmer is still on the sheet", () => {
      const { deleted } = run([E("s1", "100 Free", 1, 1), E("s2", "50 Fly", 1, 2)], [E("s1", "100 Free", 1, 1)]);
      eq(/id=in\.\(/.test(deleted[0][1]), true);
      eq(/s2%3A%3A50%20Fly|s2::50 Fly/.test(decodeURIComponent(deleted[0][1])) || /s2/.test(deleted[0][1]), true);
    });
    it("another meet's entries are never touched", () => {
      const { sent, deleted, ctx } = run([E("s1", "100 Free", 1, 1)], [E("s1", "100 Free", 1, 1), E("s2", "50 Fly", 1, 2)]);
      for (const [, rows] of sent) for (const r of rows) eq(r.meet, "Doha Open");
      eq(deleted.length, 0);
      eq(ctx.meetEntries["Other Meet"].length, 1, "the other meet must survive untouched in memory too");
    });
    it("one swimmer swims an event once, so re-entering corrects rather than duplicates", () => {
      const id = bind("_entryId", {}, [])("Doha Open", E("s1", "100 Free", 3, 5));
      eq(id, "Doha Open::s1::100 Free", "heat and lane are not part of the identity");
    });
  });

  // Marking one family paid used to rewrite the club's entire billing history, which is the
  // shape that lost the InBody scans twice. It is worse here: a lost scan gets retyped from a
  // printout, a lost payment is a family told they still owe money they have already handed over.
  describe("an invoice is a row, not a rewrite of the whole ledger", () => {
    const run = (before, after) => {
      const sent = [], deleted = [];
      const ctx = {
        billing: { invoices: before, migrated: true }, forceUpdate() {}, _saveJSON() {},
        _invToRow: bind("_invToRow", {}, []),
      };
      const restore = globalThis.window;
      globalThis.window = {
        __vxUpsert: async (t, rows) => { sent.push([t, rows]); return true; },
        __vxDelete: async (t, qs) => { deleted.push([t, qs]); return true; },
      };
      try { bind("_billingSave", ctx, ["_invToRow"])(after); }
      finally { globalThis.window = restore; }
      return { sent, deleted, ctx };
    };
    const A = { id: "i1", swId: "s1", period: "2026-07", total: 650, status: "unpaid", items: [] };
    const B = { id: "i2", swId: "s2", period: "2026-07", total: 650, status: "unpaid", items: [] };

    it("marking one paid writes that one, not the other", () => {
      const { sent } = run([A, B], [{ ...A, status: "paid" }, B]);
      const rows = sent.flatMap(([, r]) => r);
      eq(rows.length, 1, "the untouched invoice must not be rewritten");
      eq(rows[0].id, "i1");
      eq(rows[0].status, "paid");
    });
    it("issuing a new one writes only the new one", () => {
      const rows = run([A], [A, B]).sent.flatMap(([, r]) => r);
      eq(rows.length, 1);
      eq(rows[0].id, "i2");
    });
    it("nothing changed writes nothing at all", () =>
      eq(run([A, B], [A, B]).sent.length, 0));
    it("a deleted invoice is removed from the table, or it comes back on the next read", () => {
      const { deleted } = run([A, B], [A]);
      eq(deleted.length, 1);
      eq(/id=in\.\(i2\)/.test(deleted[0][1]), true);
    });
    it("the money is a column, so the database can add it up", () => {
      const rows = run([], [A]).sent.flatMap(([, r]) => r);
      eq(rows[0].total, 650);
      eq(rows[0].sw_id, "s1");
      eq(Array.isArray(rows[0].items), true, "line items vary per invoice and are only read whole");
    });
    it("a blank date is stored as nothing, not as an empty string", () => {
      const rows = run([], [{ ...A, issued: "", due: "2026-07-07" }]).sent.flatMap(([, r]) => r);
      eq(rows[0].issued, null, "a date column will refuse an empty string and lose the whole write");
      eq(rows[0].due, "2026-07-07");
    });
  });
  it("a round trip through the table changes nothing about an invoice", () => {
    const toRow = bind("_invToRow", {}, []), fromRow = bind("_invFromRow", {}, []);
    const iv = { id: "i1", swId: "s1", sqId: "sq1", period: "2026-07", issued: "2026-07-01",
      due: "2026-07-07", total: 650, status: "paid", items: [{ label: "Monthly", amount: 650 }],
      paid: { date: "2026-07-03", method: "cash", ref: "", by: "" }, note: "" };
    eq(JSON.stringify(fromRow(toRow(iv))), JSON.stringify(iv));
  });

  // Moving these into their own table must not lose a scan recorded before the table existed,
  // and must not show one twice while both copies are around.
  describe("scans recorded before the table existed", () => {
    const read = (rows, legacy) => {
      const ctx = { inbodyRows: rows, swimmerMeta: { s1: { inbody: legacy } } };
      return bind("_swInbody", ctx, ["_swMeta"])("s1");
    };
    it("with no table yet, the old records are still shown", () => {
      const out = read(undefined, [{ date: "2026-07-14", weight: 55.8 }]);
      eq(out.length, 1);
      eq(out[0].weight, 55.8, "nothing recorded before today may disappear");
    });
    it("a scan in both places appears once, from the table", () => {
      const out = read({ s1: [{ date: "2026-07-14", weight: 55.8, muscle: 27.4 }] }, [{ date: "2026-07-14", weight: 55.8 }]);
      eq(out.length, 1, "the same sheet listed twice is its own kind of wrong");
      eq(out[0].muscle, 27.4, "and the table's copy is the fuller one");
    });
    it("an old scan the table has not got is kept alongside", () => {
      const out = read({ s1: [{ date: "2026-07-14" }] }, [{ date: "2026-01-05" }]);
      eq(out.map((r) => r.date).join(","), "2026-07-14,2026-01-05", "newest first");
    });
    it("a swimmer with nothing anywhere has nothing", () => eq(read({ s1: [] }, []).length, 0));
  });
  it("the club-wide blob is never written to when a scan is saved", () => {
    const fn = sourceBetween("addInbody(swId){", "async _ibConfirmSave");
    eq(/_saveSwMeta/.test(fn), false,
      "rewriting every swimmer's record to save one scan is what lost these twice");
    eq(/inbodyRows/.test(fn), true);
  });

  // Any new warning had to remember to contain the word "fail" or "error" to come out red, so
  // "Kept on this device, but NOT yet in the club database" was shown in success green.
  it("good news earns the green rather than bad news asking for the red", () => {
    const rule = sourceBetween("profileIbMsgColor: /", "'#B42318'");
    eq(/✓/.test(rule), true, "a tick is the only thing that means finished");
    eq(/fail\|couldn\|error/.test(rule), false, "matching on words means the next warning is green again");
  });

  it("a save that is refused says why instead of doing nothing", () => {
    const fn = sourceBetween("addInbody(swId){", "_saveSwMeta");
    eq(/if\(!w\)\{ this\.setState\(\{profileIbMsg:/.test(fn), true,
      "twenty figures typed, Save pressed, nothing happens and nothing to read");
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
  // Under the role policies staff_accounts is staff-only, so to anyone not yet signed in it
  // reads as empty. A sign-in that has to look the account up in it first would turn away every
  // coach on a device that has never been used here — including whoever had to set the next one
  // up. The family side has never read a table before signing in; the staff side did.
  describe("signing in cannot depend on reading the staff table", () => {
    const submit = sourceBetween("onLoginSubmit: async ()=>{", "pickedAcct:{");
    it("an email address is used as typed, with no lookup", () =>
      eq(/const email = u\.includes\('@'\) \? u/.test(submit), true,
         "the one identifier that needs nothing read to resolve it"));
    it("an unknown username sends the coach to their email, not to a dead end", () => {
      eq(/sign in with your email address/.test(submit), true);
      eq(/'No account with that username or email'/.test(submit), false,
         "that message was a dead end on a new device");
    });
    it("the staff row is read after the token, not before", () => {
      const at = submit.indexOf("__vxSetAuth"), fetchAt = submit.indexOf("this._staffFetch()");
      eq(fetchAt > at && at > -1, true, "reading it earlier is the thing that cannot work");
    });
    it("an email the app has never seen still gets in", () =>
      eq(/if\(!real\) real=\{id:'st_'\+email/.test(submit), true,
         "a coach whose row has not arrived yet must not be refused"));
    it("a known account still signs in without any extra fetch", () =>
      eq(/if\(!real \|\| !real\.email\)\{ try\{ await this\._staffFetch\(\); \}catch\(e\)\{\}/.test(submit), true,
         "the common path must not pay for the new-device path"));
  });

  // The order is the point — the screen switches the moment the session is good, and the dozen
  // background fetches fill it in afterwards. Pinning the indentation as well meant this broke
  // the first time the code moved, saying nothing about whether the order had changed.
  it("the app is shown before the background fetches, not after", () => {
    // Matched by shape, not by the variable's name — the account passed in stopped being the
    // one found before sign-in once staff_accounts became unreadable to anonymous visitors.
    const hits = [...SOURCE.matchAll(/doLogin\(\w+\);\s*\}?\s*\n\s*try\{ this\._refetchAll\(\); this\._postLoginRefresh\(\);/g)];
    eq(hits.length > 0, true, "doLogin must run first so the screen switches immediately");
  });
  it("the shared club data is pulled once per sign-in, not twice", () =>
    eq(/_repullOnce\(\)/.test(SOURCE) && !/if\(window\.__vxRepull\) window\.__vxRepull\(\);\s*\}catch\(e\)\{\}\s*\['_plansFetch','_squadPlansFetch','_seasonFetch','_fitSessFetch','_fitPlansFetch','_famMsgFetch','_alertsFetch','_annFetch','_docsFetch','_wearFetch'/.test(SOURCE), true));
});

await report();
