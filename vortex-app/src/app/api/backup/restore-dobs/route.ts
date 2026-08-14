// Put back the dates of birth, and nothing else.
//
// This is written narrow on purpose. The last repair run against this roster read a document the
// migration had disturbed and rewrote the whole thing from it, and the club went from 344
// swimmers to 272 with every date gone. So this one cannot do that, by construction:
//
//   * it only ever WRITES a dob field
//   * it only writes one where there is no dob now
//   * it never adds, removes or moves a swimmer — the shape of the overlay is asserted
//     unchanged before the write, and the write is abandoned if it is not
//   * it saves the current overlay to the backups bucket first, so this is itself undoable
//   * it refuses unless the caller passes the exact number of dates /inspect just reported
//
//   POST /api/backup/restore-dobs?file=backup-2026-08-12.json&confirm=123

import {
  guard, svc, BUCKET, readBackup, clubStateKey, dobsIn, shapeOf, type RosterEdits,
} from "@/lib/backupStore";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://qhrpwiakobgcxfmcoyfg.supabase.co";

async function readLive(): Promise<RosterEdits | null> {
  const r = await fetch(SB_URL + "/rest/v1/club_state?select=value&key=eq.vx_roster_edits", { headers: svc() });
  if (!r.ok) return null;
  const rows = (await r.json()) as Array<{ value?: unknown }>;
  const v = rows && rows[0] ? rows[0].value : null;
  if (v == null) return null;
  return (typeof v === "string" ? JSON.parse(v) : v) as RosterEdits;
}

export async function POST(request: Request) {
  const bad = guard(request);
  if (bad) return bad;
  const head = { "cache-control": "no-store" } as const;
  const q = new URL(request.url).searchParams;
  const file = q.get("file") || "";
  const confirm = parseInt(q.get("confirm") || "", 10);

  if (!file) return Response.json({ error: "pass ?file= — see /api/backup/list" }, { status: 400, headers: head });
  if (!Number.isFinite(confirm))
    return Response.json({ error: "pass ?confirm=<the number /api/backup/inspect reported>" }, { status: 400, headers: head });

  const snap = await readBackup(file);
  if (!snap) return Response.json({ error: "could not read that backup", file }, { status: 404, headers: head });

  const backupDobs = dobsIn(clubStateKey(snap, "vx_roster_edits") as RosterEdits | null);
  const live = await readLive();
  if (!live) return Response.json({ error: "could not read the club's current roster — nothing was changed" }, { status: 502, headers: head });

  const liveDobs = dobsIn(live);
  const toAdd = Object.keys(backupDobs).filter((id) => !liveDobs[id]);
  if (toAdd.length !== confirm)
    return Response.json(
      { error: "the number changed since you looked", wouldRestore: toAdd.length, youConfirmed: confirm,
        hint: "Run /api/backup/inspect again and use the number it gives." },
      { status: 409, headers: head },
    );
  if (!toAdd.length) return Response.json({ restored: 0, note: "nothing to put back" }, { headers: head });

  const before = shapeOf(live);

  // Where each swimmer's date has to go. A swimmer edited in the club's own roster gets it in
  // `edits`; a swimmer the club added carries it on their own record in `added`. Anyone the
  // current overlay does not mention at all is skipped — inventing a place for them is exactly
  // the kind of guess that broke this before.
  const next: RosterEdits = JSON.parse(JSON.stringify(live));
  let placed = 0;
  const skipped: string[] = [];
  for (const id of toAdd) {
    let done = false;
    for (const squad of Object.values(next.edits || {})) {
      if (squad && Object.prototype.hasOwnProperty.call(squad, id)) {
        squad[id] = { ...(squad[id] || {}), dob: backupDobs[id] };
        done = true;
        break;
      }
    }
    if (!done) {
      for (const list of Object.values(next.added || {})) {
        const sw = (list || []).find((x) => x && (x as { id?: string }).id === id);
        if (sw) { (sw as { dob?: string }).dob = backupDobs[id]; done = true; break; }
      }
    }
    if (done) placed++; else skipped.push(id);
  }

  // The shape must be identical. If a single swimmer has appeared, vanished or moved, something
  // is wrong with this code and the club's roster is not the place to find that out.
  const after = shapeOf(next);
  if (after.edited !== before.edited || after.added !== before.added || after.deleted !== before.deleted)
    return Response.json(
      { error: "the roster changed shape — abandoned without writing", before, after },
      { status: 500, headers: head },
    );

  // Undo, taken before the write and stored beside the backups.
  const undoName = `undo-roster-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  let undoSaved = false;
  try {
    const up = await fetch(SB_URL + "/storage/v1/object/" + BUCKET + "/" + undoName, {
      method: "POST",
      headers: { ...svc(), "Content-Type": "application/json", "x-upsert": "true" },
      body: JSON.stringify({ takenAt: new Date().toISOString(), counts: {}, data: { club_state: [{ key: "vx_roster_edits", value: live }] } }),
    });
    undoSaved = up.ok;
  } catch {}
  if (!undoSaved)
    return Response.json(
      { error: "could not save an undo copy first, so nothing was changed", undoName },
      { status: 502, headers: head },
    );

  const w = await fetch(SB_URL + "/rest/v1/club_state", {
    method: "POST",
    headers: { ...svc(), "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ key: "vx_roster_edits", value: next, updated_at: new Date().toISOString() }]),
  });
  if (!w.ok) {
    const said = await w.text().catch(() => "");
    return Response.json({ error: "the write was refused", status: w.status, said: said.slice(0, 300), undoName }, { status: 502, headers: head });
  }

  return Response.json(
    {
      restored: placed,
      skipped: skipped.length,
      skippedIds: skipped.slice(0, 20),
      shape: after,
      undo: undoName,
      next: "Open the app and pull down to refresh. The Missing DOB count on Swimmers should have dropped by " + placed + ".",
    },
    { headers: head },
  );
}
