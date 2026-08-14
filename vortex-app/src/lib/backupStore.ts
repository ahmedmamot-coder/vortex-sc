// Reading the nightly backups back out again.
//
// The club has 123 swimmers whose date of birth is gone. They were never in the bundled roster —
// that file has ages and no dates at all — so they only ever lived in the roster overlay inside
// club_state, which the abandoned per-row migration disturbed.
//
// club_state is in every nightly snapshot. So the dates are recoverable from a backup taken
// before the loss, without rewinding the whole database to Tuesday and throwing away everything
// the club has done since.

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://qhrpwiakobgcxfmcoyfg.supabase.co";
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
export const BUCKET = "vx-backups";

export function svc() {
  return { apikey: SB_SERVICE, Authorization: "Bearer " + SB_SERVICE };
}
export function haveService() {
  return !!SB_SERVICE;
}
/** Shared gate for every one of these routes. Returns an error Response, or null to proceed. */
export function guard(request: Request): Response | null {
  if (!SB_SERVICE)
    return Response.json({ error: "server missing SUPABASE_SERVICE_ROLE_KEY" }, { status: 500 });
  const secret = process.env.BACKUP_SECRET;
  if (secret) {
    const given =
      request.headers.get("x-backup-secret") || new URL(request.url).searchParams.get("key") || "";
    if (given !== secret) return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export type Snapshot = {
  takenAt?: string;
  counts?: Record<string, number>;
  data?: Record<string, unknown[]>;
};

export async function listBackups() {
  const r = await fetch(SB_URL + "/storage/v1/object/list/" + BUCKET, {
    method: "POST",
    headers: { ...svc(), "Content-Type": "application/json" },
    body: JSON.stringify({ prefix: "", limit: 200, sortBy: { column: "name", order: "desc" } }),
  });
  if (!r.ok) return null;
  const rows = (await r.json()) as Array<{
    name: string;
    updated_at?: string;
    created_at?: string;
    metadata?: { size?: number };
  }>;
  return rows
    .filter((x) => x && x.name && x.name.endsWith(".json"))
    .map((x) => ({
      name: x.name,
      takenAt: x.created_at || x.updated_at || "",
      bytes: (x.metadata && x.metadata.size) || 0,
    }));
}

export async function readBackup(name: string): Promise<Snapshot | null> {
  // The name comes off the wire, and it is pasted straight into a URL path. A backup called
  // "../../other-bucket/thing" would read somebody else's object.
  if (!/^[A-Za-z0-9._-]+\.json$/.test(name)) return null;
  const r = await fetch(SB_URL + "/storage/v1/object/" + BUCKET + "/" + name, { headers: svc() });
  if (!r.ok) return null;
  try {
    return (await r.json()) as Snapshot;
  } catch {
    return null;
  }
}

/** club_state is a key/value table; this pulls one key's value out of a snapshot. */
export function clubStateKey(snap: Snapshot | null, key: string): unknown {
  const rows = (snap && snap.data && snap.data["club_state"]) || [];
  for (const row of rows as Array<{ key?: string; value?: unknown }>) {
    if (row && row.key === key) {
      const v = row.value;
      if (typeof v === "string") {
        try {
          return JSON.parse(v);
        } catch {
          return null;
        }
      }
      return v;
    }
  }
  return null;
}

export type RosterEdits = {
  edits?: Record<string, Record<string, Record<string, unknown>>>;
  added?: Record<string, Array<Record<string, unknown>>>;
  deleted?: Record<string, Record<string, boolean>>;
};

/**
 * Every date of birth an overlay holds, as swimmerId → dob.
 *
 * A swimmer can carry one in either half: an edit to somebody from the club's own roster, or an
 * added swimmer whose whole record is in the overlay. Both count.
 */
export function dobsIn(edits: RosterEdits | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!edits || typeof edits !== "object") return out;
  const take = (id: unknown, dob: unknown) => {
    if (typeof id !== "string" || !id) return;
    if (typeof dob !== "string" || !dob.trim()) return;
    out[id] = dob.trim();
  };
  for (const squad of Object.values(edits.edits || {})) {
    for (const [id, patch] of Object.entries(squad || {})) take(id, (patch || {}).dob);
  }
  for (const list of Object.values(edits.added || {})) {
    for (const sw of list || []) take((sw || {}).id, (sw || {}).dob);
  }
  return out;
}

/**
 * The dates of birth stranded in vx_roster.
 *
 * The per-row migration wrote 72 rows before Postgres began rejecting whole batches, and 71 of
 * them carry a date. Those rows are debris — the app has not read that table since the migration
 * was switched off — but they were written FROM the roster while it was still whole, so they are
 * a copy of exactly what was lost, sitting in the same database.
 */
export async function dobsFromRosterTable(): Promise<Record<string, string> | null> {
  const r = await fetch(SB_URL + "/rest/v1/vx_roster?select=sw_id,state,patch&limit=5000", { headers: svc() });
  if (!r.ok) return null;
  let rows: Array<{ sw_id?: string; state?: string; patch?: Record<string, unknown> }>;
  try {
    rows = await r.json();
  } catch {
    return null;
  }
  const out: Record<string, string> = {};
  for (const row of rows || []) {
    // A row marking a swimmer removed from a squad says nothing about their date of birth, and
    // the same swimmer's real row is elsewhere in the same table.
    if (!row || row.state === "deleted") continue;
    const id = row.sw_id;
    const dob = row.patch && (row.patch as { dob?: unknown }).dob;
    if (typeof id !== "string" || !id) continue;
    if (typeof dob !== "string" || !dob.trim()) continue;
    out[id] = dob.trim();
  }
  return out;
}

/** How many swimmers an overlay describes, per half — for reporting, never for deciding. */
export function shapeOf(edits: RosterEdits | null) {
  let edited = 0,
    added = 0,
    deleted = 0;
  for (const squad of Object.values((edits && edits.edits) || {})) edited += Object.keys(squad || {}).length;
  for (const list of Object.values((edits && edits.added) || {})) added += (list || []).length;
  for (const squad of Object.values((edits && edits.deleted) || {}))
    deleted += Object.values(squad || {}).filter(Boolean).length;
  return { edited, added, deleted };
}
