// Which swimmers have a band linked, and whether the band integration is switched on at all.
// Returns NO tokens and no secret values — only whether each piece of configuration exists.
//
// The linking code is complete and real: OAuth, token refresh, live calls to WHOOP and Fitbit.
// What it cannot do is invent credentials. Without them "Connect WHOOP" used to hand a coach a
// raw JSON error, which looks exactly like a broken feature rather than an unfinished setup —
// so the app asks here first and says which piece is missing.
import { getConnections, haveService, serviceKeyRole, serviceKeyWorks } from "@/lib/wearable";

export async function GET() {
  const service = haveService();
  // Set, but is it the right key? The wrong one in this slot passes every presence check and
  // then reads nothing, because row-level security still applies to it. The shape is a hint;
  // serviceKeyWorks asks Supabase, which is the only answer that survives a change of format.
  const serviceRole = serviceKeyRole();
  const serviceOk = service ? await serviceKeyWorks() : false;
  const whoop = !!(process.env.WHOOP_CLIENT_ID && process.env.WHOOP_CLIENT_SECRET && process.env.WHOOP_REDIRECT_URI);
  const fitbit = !!(process.env.FITBIT_CLIENT_ID && process.env.FITBIT_CLIENT_SECRET && process.env.FITBIT_REDIRECT_URI);

  const missing: string[] = [];
  if (!service) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  else if (serviceOk === false)
    missing.push(
      "SUPABASE_SERVICE_ROLE_KEY is set but does not carry service-role rights"
        + (serviceRole === "anon" ? " — it holds the publishable/anon key" : "")
        + ". Backups, band sync and staff password resets will read and write nothing.");
  if (!whoop) missing.push("WHOOP_CLIENT_ID / WHOOP_CLIENT_SECRET / WHOOP_REDIRECT_URI");
  if (!fitbit) missing.push("FITBIT_CLIENT_ID / FITBIT_CLIENT_SECRET / FITBIT_REDIRECT_URI");

  if (!service) {
    // Without the service key the connections table cannot be read at all, so there is
    // nothing truthful to say about who is linked.
    return Response.json({ connected: [], config: { service, serviceRole, serviceOk, whoop, fitbit }, missing }, { headers: { "cache-control": "no-store" } });
  }

  const conns = await getConnections();
  const connected = conns.map((c) => ({ sw_id: c.sw_id, provider: c.provider, updated_at: c.updated_at || null }));
  return Response.json({ connected, config: { service, serviceRole, serviceOk, whoop, fitbit }, missing }, { headers: { "cache-control": "no-store" } });
}
