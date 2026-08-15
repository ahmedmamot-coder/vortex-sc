// What the database's copy of the roster would actually give the club.
//
// The club is looking at 317 swimmers with 123 missing dates of birth, and has been ready to
// rewind the whole database to get those dates back. The database's own copy of the roster is
// not the one on that phone: it describes 304 swimmers and it is carrying 304 dates.
//
// So before anyone restores anything, this answers the only question that matters — if the club
// took the database's copy, how many swimmers would there be and how many would still have no
// date? It works it out the same way the app does, from the same two pieces, and it writes
// nothing.
//
//   /api/roster/compare

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { guard, svc, rosterFromAsset, type RosterEdits } from "@/lib/backupStore";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://qhrpwiakobgcxfmcoyfg.supabase.co";

type Swimmer = { id?: string; name?: string; dob?: string; age?: number };

/**
 * The club's own roster, as shipped in the app bundle. It has ages and no dates at all.
 *
 * Fetched over HTTP from this same deployment, not read off the disk. `public/` is served by the
 * CDN and is not part of the serverless bundle, so the disk read could only ever work on a
 * laptop — in production this endpoint answered "could not read the bundled roster" every single
 * time it was asked, which is worse than not having it, because it was written to be the thing
 * that settles an argument about a club's missing dates of birth.
 */
async function baseRoster(origin: string): Promise<Record<string, Swimmer[]> | null> {
  try {
    const r = await fetch(origin + "/assets/roster.js", { cache: "no-store" });
    if (r.ok) {
      const got = rosterFromAsset(await r.text());
      if (got) return got;
    }
  } catch {
    /* fall through to the disk, which is where it lives when this runs on a laptop */
  }
  try {
    return rosterFromAsset(await readFile(join(process.cwd(), "public", "assets", "roster.js"), "utf8"));
  } catch {
    return null;
  }
}

async function liveEdits(): Promise<RosterEdits | null> {
  const r = await fetch(SB_URL + "/rest/v1/club_state?select=value&key=eq.vx_roster_edits", { headers: svc() });
  if (!r.ok) return null;
  const rows = (await r.json()) as Array<{ value?: unknown }>;
  const v = rows && rows[0] ? rows[0].value : null;
  if (v == null) return null;
  return (typeof v === "string" ? JSON.parse(v) : v) as RosterEdits;
}

export async function GET(request: Request) {
  const bad = guard(request);
  if (bad) return bad;
  const head = { "cache-control": "no-store" } as const;

  const base = await baseRoster(new URL(request.url).origin);
  if (!base)
    return Response.json(
      {
        error: "could not read the bundled roster",
        hint: "It is fetched from /assets/roster.js on this same deployment. Open that URL: if it does not load, the asset is missing from the build.",
      },
      { status: 500, headers: head },
    );
  const ed = await liveEdits();
  if (!ed) return Response.json({ error: "the database has no roster document" }, { status: 404, headers: head });

  // Exactly what rebuildRoster() does: keep everyone the club has not removed from a squad,
  // apply that squad's patch, then append the swimmers the club added to it.
  const perSquad: Record<string, { swimmers: number; withDob: number; missing: string[] }> = {};
  let total = 0, withDob = 0;
  const missingAll: Array<{ id: string; name: string; squad: string }> = [];

  for (const squadId of Object.keys(base)) {
    const removed = (ed.deleted || {})[squadId] || {};
    const patches = (ed.edits || {})[squadId] || {};
    const kept = (base[squadId] || []).filter((sw) => sw && sw.id && !removed[sw.id]);
    const merged: Swimmer[] = kept.map((sw) => ({ ...sw, ...((patches[sw.id as string] || {}) as Swimmer) }));
    for (const sw of ((ed.added || {})[squadId] || []) as Swimmer[]) merged.push({ ...sw });

    const missing: string[] = [];
    let n = 0;
    for (const sw of merged) {
      total++;
      const dob = typeof sw.dob === "string" ? sw.dob.trim() : "";
      if (dob) { withDob++; n++; }
      else {
        missing.push(String(sw.id || "?"));
        missingAll.push({ id: String(sw.id || "?"), name: String(sw.name || "?"), squad: squadId });
      }
    }
    perSquad[squadId] = { swimmers: merged.length, withDob: n, missing };
  }

  // A date filed under a squad the swimmer has since left. rebuildRoster only looks in the
  // swimmer's current squad, so one of these is a date the club has but cannot see.
  const everywhere: Record<string, string> = {};
  for (const squad of Object.values(ed.edits || {}))
    for (const [id, patch] of Object.entries(squad || {})) {
      const dob = (patch as Swimmer).dob;
      if (typeof dob === "string" && dob.trim()) everywhere[id] = dob.trim();
    }
  const recoverable = missingAll.filter((m) => everywhere[m.id]);

  return Response.json(
    {
      ifYouTakeTheDatabaseCopy: {
        swimmers: total,
        withDateOfBirth: withDob,
        missingDateOfBirth: total - withDob,
      },
      perSquad: Object.fromEntries(
        Object.entries(perSquad).map(([k, v]) => [k, { swimmers: v.swimmers, withDob: v.withDob, missing: v.swimmers - v.withDob }]),
      ),
      // Dates the document holds for a swimmer whose current squad's patch does not carry one.
      datesFiledUnderAnOldSquad: recoverable.length,
      sample: recoverable.slice(0, 15),
      note:
        "This is read-only. To take this copy, open the app as owner and use the roster check's \"Use the database copy\".",
    },
    { headers: head },
  );
}
