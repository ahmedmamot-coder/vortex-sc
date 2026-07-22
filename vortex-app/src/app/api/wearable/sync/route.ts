// Pull fresh data for every connected swimmer, WHOOP or Fitbit. Runs daily via the
// Vercel cron (see vercel.json). Optional guard: set WHOOP_SYNC_SECRET and pass it as
// header x-sync-secret or ?key=.
import { getConnections, upsertReading, haveService } from "@/lib/wearable";
import * as whoop from "@/lib/whoop";
import * as fitbit from "@/lib/fitbit";

async function run(request: Request) {
  if (!haveService()) return Response.json({ error: "server missing SUPABASE_SERVICE_ROLE_KEY" }, { status: 500 });

  const secret = process.env.WHOOP_SYNC_SECRET;
  const url = new URL(request.url);
  if (secret) {
    const given = request.headers.get("x-sync-secret") || url.searchParams.get("key") || "";
    if (given !== secret) return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const only = url.searchParams.get("sw") || "";
  const conns = await getConnections(only || undefined);

  let synced = 0, failed = 0;
  for (const c of conns) {
    try {
      const isFitbit = c.provider === "fitbit";
      const at = isFitbit ? await fitbit.freshToken(c) : await whoop.freshToken(c);
      if (!at) { failed++; continue; }
      const r = isFitbit ? await fitbit.latestReading(at) : await whoop.latestReading(at);
      if (r) { await upsertReading(c.sw_id, r, c.provider); synced++; } else { failed++; }
    } catch { failed++; }
  }
  return Response.json({ connections: conns.length, synced, failed });
}

export async function GET(request: Request) { return run(request); }
export async function POST(request: Request) { return run(request); }
