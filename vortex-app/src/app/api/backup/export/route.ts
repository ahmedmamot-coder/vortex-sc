// Automated backup: dumps every important table to a single JSON snapshot and stores it
// in the private "vx-backups" Storage bucket (server-only). Runs daily via the Vercel cron.
// Manual: open /api/backup/export?download=1&key=<BACKUP_SECRET> to download the JSON now.
//
// Env: SUPABASE_SERVICE_ROLE_KEY (required). Optional: BACKUP_SECRET to gate access.

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://qhrpwiakobgcxfmcoyfg.supabase.co";
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// Tokens are deliberately NOT backed up here (wearable_connections holds secrets).
const TABLES = [
  "club_state",
  "plan_sessions", "fitness_sessions", "squad_plans", "season_plans", "fitness_plans",
  "family_accounts", "staff_accounts", "swimmer_docs", "push_subscriptions",
  "announcements", "family_messages", "signup_alerts", "lounge_posts", "lounge_comments",
  "wearable_readings", "hr_sets",
];

function svc() {
  return { apikey: SB_SERVICE, Authorization: "Bearer " + SB_SERVICE };
}

async function dumpTable(t: string): Promise<unknown[]> {
  const rows: unknown[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const r = await fetch(SB_URL + "/rest/v1/" + t + "?select=*", {
      headers: { ...svc(), Range: `${from}-${from + pageSize - 1}`, "Range-Unit": "items" },
    });
    if (!r.ok) break;
    const chunk = (await r.json()) as unknown[];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return rows;
}

async function run(request: Request) {
  if (!SB_SERVICE) return Response.json({ error: "server missing SUPABASE_SERVICE_ROLE_KEY" }, { status: 500 });

  const url = new URL(request.url);
  const secret = process.env.BACKUP_SECRET;
  if (secret) {
    const given = request.headers.get("x-backup-secret") || url.searchParams.get("key") || "";
    if (given !== secret) return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const data: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  for (const t of TABLES) {
    try { const rows = await dumpTable(t); data[t] = rows; counts[t] = rows.length; }
    catch { data[t] = []; counts[t] = -1; }
  }

  const snapshot = { takenAt: new Date().toISOString(), counts, data };
  const json = JSON.stringify(snapshot);

  if (url.searchParams.get("download")) {
    return new Response(json, {
      headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="vortex-backup-${new Date().toISOString().slice(0, 10)}.json"` },
    });
  }

  // Store the snapshot in the private vx-backups bucket (upsert by date).
  const path = `backup-${new Date().toISOString().slice(0, 10)}.json`;
  let stored = false;
  try {
    const up = await fetch(SB_URL + "/storage/v1/object/vx-backups/" + path, {
      method: "POST",
      headers: { ...svc(), "Content-Type": "application/json", "x-upsert": "true" },
      body: json,
    });
    stored = up.ok;
  } catch {}

  return Response.json({ stored, path, counts, bytes: json.length });
}

export async function GET(request: Request) { return run(request); }
export async function POST(request: Request) { return run(request); }
