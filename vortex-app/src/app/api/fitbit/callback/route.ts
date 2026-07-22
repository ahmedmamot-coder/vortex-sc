// Step 2 of Fitbit linking: exchange the code, store tokens, pull the first reading.
import { exchangeCode, saveFitbit, fitbitProfile, latestReading } from "@/lib/fitbit";
import { upsertReading, haveService } from "@/lib/wearable";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const appHome = process.env.APP_URL || url.origin + "/";
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state") || "";
  if (!code) return Response.redirect(appHome + "?fitbit=error", 302);
  if (!haveService()) return Response.json({ error: "server missing SUPABASE_SERVICE_ROLE_KEY" }, { status: 500 });

  let sw = "", by = "";
  try { const s = JSON.parse(decodeURIComponent(stateRaw)); sw = s.sw || ""; by = s.by || ""; } catch {}
  if (!sw) return Response.redirect(appHome + "?fitbit=error", 302);

  const tok = await exchangeCode(code);
  if (!tok || !tok.access_token) return Response.redirect(appHome + "?fitbit=error", 302);

  const uid = await fitbitProfile(tok.access_token);
  await saveFitbit(sw, tok, uid, by);
  try { const r = await latestReading(tok.access_token); if (r) await upsertReading(sw, r, "fitbit"); } catch {}

  return Response.redirect(appHome + "?fitbit=connected", 302);
}
