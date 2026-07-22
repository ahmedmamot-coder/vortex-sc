// Step 1 of WHOOP linking: send the family to WHOOP's consent screen.
// Open this in the app with:  /api/whoop/connect?sw=<swimmerId>&by=<familyId>
// After they approve, WHOOP redirects to /api/whoop/callback.
//
// Required env (set in Vercel): WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET, WHOOP_REDIRECT_URI
//   WHOOP_REDIRECT_URI must be exactly  https://vortexswimmingclub.com/api/whoop/callback
//   and registered on your WHOOP developer app.

const WHOOP_AUTH = "https://api.prod.whoop.com/oauth/oauth2/auth";
const SCOPE = "read:recovery read:sleep read:cycles read:profile offline";

export async function GET(request: Request) {
  const clientId = process.env.WHOOP_CLIENT_ID;
  const redirect = process.env.WHOOP_REDIRECT_URI;
  if (!clientId || !redirect) {
    return Response.json({ error: "WHOOP not configured (missing WHOOP_CLIENT_ID / WHOOP_REDIRECT_URI)" }, { status: 500 });
  }
  const url = new URL(request.url);
  const sw = url.searchParams.get("sw") || "";
  const by = url.searchParams.get("by") || "";
  if (!sw) return Response.json({ error: "missing swimmer id (?sw=)" }, { status: 400 });

  // state carries who we're linking, plus a random nonce (CSRF guard).
  const nonce = Math.random().toString(36).slice(2);
  const state = encodeURIComponent(JSON.stringify({ sw, by, n: nonce }));

  const auth = new URL(WHOOP_AUTH);
  auth.searchParams.set("client_id", clientId);
  auth.searchParams.set("redirect_uri", redirect);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", SCOPE);
  auth.searchParams.set("state", state);

  return Response.redirect(auth.toString(), 302);
}
