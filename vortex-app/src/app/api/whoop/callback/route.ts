// Step 2 of WHOOP linking: WHOOP redirects here with ?code=...&state=...
// We exchange the code for tokens, store them (server-side only), pull the first
// reading, then bounce the user back into the app.
import { exchangeCode, saveConnection, whoopProfile, latestReading, upsertReading, haveService } from "@/lib/whoop";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const appHome = process.env.APP_URL || url.origin + "/";
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state") || "";
  if (!code) return Response.redirect(appHome + "?whoop=error", 302);
  if (!haveService()) return Response.json({ error: "server missing SUPABASE_SERVICE_ROLE_KEY" }, { status: 500 });

  let sw = "", by = "";
  try { const s = JSON.parse(decodeURIComponent(stateRaw)); sw = s.sw || ""; by = s.by || ""; } catch {}
  if (!sw) return Response.redirect(appHome + "?whoop=error", 302);

  const tok = await exchangeCode(code);
  if (!tok || !tok.access_token) return Response.redirect(appHome + "?whoop=error", 302);

  const uid = await whoopProfile(tok.access_token);
  await saveConnection(sw, tok, uid, by);

  // Pull the first reading right away so the swimmer's card fills in immediately.
  try { const r = await latestReading(tok.access_token); if (r) await upsertReading(sw, r); } catch {}

  return Response.redirect(appHome + "?whoop=connected", 302);
}
