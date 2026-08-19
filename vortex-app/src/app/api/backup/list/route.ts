// Which backups exist, and what each one holds for the roster.
//
// Read-only. Open it in a browser: /api/backup/list  (add ?key=<BACKUP_SECRET> if one is set.)
//
// The point of this is the `dobs` column: it says, per snapshot, how many dates of birth that
// night's copy of the roster overlay was carrying. Picking a backup to recover from is otherwise
// guesswork, and guessing is what turned 304 swimmers into 317.

import { guard, listBackups, readBackup, clubStateKey, dobsIn, shapeOf, type RosterEdits } from "@/lib/backupStore";

// public/assets/roster.js, counted. Every overlay is added and deleted on top of this.
const BASE_ROSTER = 272;

export async function GET(request: Request) {
  const bad = guard(request);
  if (bad) return bad;

  const files = await listBackups();
  const head = { "cache-control": "no-store" } as const;
  if (!files)
    return Response.json(
      {
        error: "could not list the vx-backups bucket",
        hint: "The bucket may not exist yet. It is created the first time /api/backup/export runs.",
      },
      { status: 502, headers: head },
    );
  if (!files.length)
    return Response.json(
      {
        backups: [],
        hint: "No snapshots yet. The nightly cron writes one at 03:00 UTC, and it only runs once SUPABASE_SERVICE_ROLE_KEY is set. Run /api/backup/export now to take one.",
      },
      { headers: head },
    );

  // Reading every snapshot to count its dates is the whole job here, but a snapshot is a few MB
  // and there could be months of them. The newest thirty is far enough back to cover this.
  const recent = files.slice(0, 30);
  const backups = [];
  for (const f of recent) {
    let dobs = -1;
    let shape: ReturnType<typeof shapeOf> | null = null;
    let takenAt = f.takenAt;
    try {
      const snap = await readBackup(f.name);
      if (snap) {
        if (snap.takenAt) takenAt = snap.takenAt;
        const edits = clubStateKey(snap, "vx_roster_edits") as RosterEdits | null;
        dobs = Object.keys(dobsIn(edits)).length;
        shape = shapeOf(edits);
      }
    } catch {}
    // The number the club actually reads off a screen.
    //
    // "dobs: 194" does not answer "which backup has our 303 swimmers in it", and that is the
    // question every one of these restores has been trying to answer. The base roster is 272; an
    // overlay adds and deletes on top of it, so the total this snapshot would show is arithmetic
    // we can do here instead of making somebody restore one to find out.
    const swimmers = shape ? BASE_ROSTER + shape.added - shape.deleted : null;
    backups.push({ name: f.name, takenAt, bytes: f.bytes, dobs, swimmers, shape });
  }

  // Most dates of birth, and the deletions still in it.
  //
  // Sorting on dates alone recommended a snapshot with every date and no deletions — which is
  // 317 swimmers, the exact number this club keeps having to undo. A snapshot that has lost the
  // deletions has lost real work just as much as one that has lost the dates.
  const scored = backups.filter((b) => b.dobs > 0);
  const withDeletions = scored.filter((b) => (b.shape?.deleted ?? 0) > 0);
  const best = (withDeletions.length ? withDeletions : scored)
    .sort((a, b) => (b.shape?.deleted ?? 0) - (a.shape?.deleted ?? 0) || b.dobs - a.dobs)[0] || null;
  return Response.json(
    {
      backups,
      best: best
        ? { name: best.name, dobs: best.dobs, swimmers: best.swimmers,
            deletions: best.shape?.deleted ?? 0, takenAt: best.takenAt }
        : null,
      next: best
        ? `Check it first: /api/backup/inspect?file=${best.name} — it changes nothing.`
        : "None of these snapshots carry any dates of birth.",
    },
    { headers: head },
  );
}
