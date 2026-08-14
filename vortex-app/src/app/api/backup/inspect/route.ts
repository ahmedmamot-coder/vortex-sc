// What one backup would give back, before anything is changed.
//
// Read-only, and deliberately so: the club has already had one repair run against a document it
// had not looked at, and it cost 301 dates of birth. Nothing here writes.
//
//   /api/backup/inspect?file=backup-2026-08-12.json

import {
  guard, readBackup, clubStateKey, dobsIn, dobsFromRosterTable, shapeOf, type RosterEdits,
} from "@/lib/backupStore";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://qhrpwiakobgcxfmcoyfg.supabase.co";

export async function GET(request: Request) {
  const bad = guard(request);
  if (bad) return bad;
  const head = { "cache-control": "no-store" } as const;

  const q = new URL(request.url).searchParams;
  const from = q.get("from") || "";
  const file = q.get("file") || "";

  // Two places the lost dates can be read from, checked the same way and applied by the same
  // repair: a nightly snapshot, or the rows the abandoned migration left behind in vx_roster.
  let backupDobs: Record<string, string>;
  let source: string;
  let takenAt: string | null = null;
  let sourceShape: ReturnType<typeof shapeOf> | null = null;

  if (from === "vx_roster") {
    const rows = await dobsFromRosterTable();
    if (!rows) return Response.json({ error: "could not read vx_roster" }, { status: 502, headers: head });
    backupDobs = rows;
    source = "vx_roster (rows left by the abandoned migration)";
  } else {
    if (!file) return Response.json({ error: "pass ?file=backup-YYYY-MM-DD.json (see /api/backup/list), or ?from=vx_roster" }, { status: 400, headers: head });
    const snap = await readBackup(file);
    if (!snap) return Response.json({ error: "could not read that backup", file }, { status: 404, headers: head });
    const fromBackup = clubStateKey(snap, "vx_roster_edits") as RosterEdits | null;
    backupDobs = dobsIn(fromBackup);
    source = file;
    takenAt = snap.takenAt || null;
    sourceShape = shapeOf(fromBackup);
  }

  // And what the club has right now, so the two can be compared rather than assumed.
  let live: RosterEdits | null = null;
  try {
    const r = await fetch(
      SB_URL + "/rest/v1/club_state?select=value&key=eq.vx_roster_edits",
      { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY || "", Authorization: "Bearer " + (process.env.SUPABASE_SERVICE_ROLE_KEY || "") } },
    );
    if (r.ok) {
      const rows = (await r.json()) as Array<{ value?: unknown }>;
      const v = rows && rows[0] ? rows[0].value : null;
      live = (typeof v === "string" ? JSON.parse(v) : v) as RosterEdits | null;
    }
  } catch {}
  const liveDobs = dobsIn(live);

  // The only thing a repair would actually do: fill in a date that is missing now and present in
  // the backup. Never overwrite one the club has since typed, never touch the swimmer list.
  const wouldAdd = Object.keys(backupDobs).filter((id) => !liveDobs[id]);
  const wouldDiffer = Object.keys(backupDobs).filter((id) => liveDobs[id] && liveDobs[id] !== backupDobs[id]);

  return Response.json(
    {
      source,
      takenAt,
      backup: { dobs: Object.keys(backupDobs).length, shape: sourceShape },
      liveNow: { dobs: Object.keys(liveDobs).length, shape: shapeOf(live) },
      wouldRestore: wouldAdd.length,
      // Named, so somebody who knows these children can check the answer before it is applied.
      sample: wouldAdd.slice(0, 15).map((id) => ({ id, dob: backupDobs[id] })),
      // Left alone on purpose. A date the club typed after the backup is the newer truth.
      keptAsIs: wouldDiffer.length,
      willNotDo: [
        "add, remove or move a single swimmer",
        "overwrite a date of birth that is filled in now",
        "touch anything other than dates of birth",
      ],
      next: wouldAdd.length
        ? `POST /api/backup/restore-dobs?${from === "vx_roster" ? "from=vx_roster" : "file=" + file}&confirm=${wouldAdd.length} — the count has to match what you were just shown.`
        : "There is nothing here that the club does not already have.",
    },
    { headers: head },
  );
}
