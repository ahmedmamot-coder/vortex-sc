// Step 3: pull fresh data for every connected swimmer (or one ?sw=). Call this on a
// schedule (e.g. a Vercel Cron once or twice a day) so each band's latest recovery,
// HR, HRV, sleep and strain land in wearable_readings automatically.
//
// Optional: set WHOOP_SYNC_SECRET and call with header  x-sync-secret: <that value>
// (or ?key=<value>) so only your cron can trigger it.
import { getConnections, freshToken, latestReading, upsertReading, haveService } from "@/lib/whoop";

async function run(request: Request) {
  if (!haveService()) return Response.json({ error: "server missing SUPABASE_SERVICE_ROLE_KEY" }, { status: 500 });

  const secret = process.env.WHOOP_SYNC_SECRET;
  if (secret) {
    const url = new URL(request.url);
    const given = request.headers.get("x-sync-secret") || url.searchParams.get("key") || "";
    if (given !== secret) return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const only = url.searchParams.get("sw") || "";
  const conns = await getConnections(only || undefined);

  let synced = 0, failed = 0;
  for (const c of conns) {
    try {
      const at = await freshToken(c);
      if (!at) { failed++; continue; }
      const r = await latestReading(at);
      if (r) { await upsertReading(c.sw_id, r); synced++; } else { failed++; }
    } catch { failed++; }
  }
  return Response.json({ connections: conns.length, synced, failed });
}

export async function GET(request: Request) { return run(request); }
export async function POST(request: Request) { return run(request); }
