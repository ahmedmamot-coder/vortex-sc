// Step 1 of Fitbit linking. Open:  /api/fitbit/connect?sw=<swimmerId>&by=<familyId>
// Required env: FITBIT_CLIENT_ID, FITBIT_CLIENT_SECRET, FITBIT_REDIRECT_URI
//   FITBIT_REDIRECT_URI = https://vortexswimmingclub.com/api/fitbit/callback (register it on Fitbit).
import { FITBIT_AUTH, FITBIT_SCOPE } from "@/lib/fitbit";

export async function GET(request: Request) {
  const clientId = process.env.FITBIT_CLIENT_ID;
  const redirect = process.env.FITBIT_REDIRECT_URI;
  if (!clientId || !redirect) {
    return Response.json({ error: "Fitbit not configured (missing FITBIT_CLIENT_ID / FITBIT_REDIRECT_URI)" }, { status: 500 });
  }
  const url = new URL(request.url);
  const sw = url.searchParams.get("sw") || "";
  const by = url.searchParams.get("by") || "";
  if (!sw) return Response.json({ error: "missing swimmer id (?sw=)" }, { status: 400 });

  const state = encodeURIComponent(JSON.stringify({ sw, by, n: Math.random().toString(36).slice(2) }));
  const auth = new URL(FITBIT_AUTH);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("client_id", clientId);
  auth.searchParams.set("redirect_uri", redirect);
  auth.searchParams.set("scope", FITBIT_SCOPE);
  auth.searchParams.set("state", state);
  return Response.redirect(auth.toString(), 302);
}
