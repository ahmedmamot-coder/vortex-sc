// Public, non-sensitive: which swimmers have a band linked (provider + last update).
// Returns NO tokens. The app uses this to show "Connected ✓ (WHOOP)" per swimmer.
import { getConnections, haveService } from "@/lib/wearable";

export async function GET() {
  if (!haveService()) return Response.json({ connected: [] });
  const conns = await getConnections();
  const connected = conns.map((c) => ({ sw_id: c.sw_id, provider: c.provider, updated_at: c.updated_at || null }));
  return Response.json({ connected });
}
