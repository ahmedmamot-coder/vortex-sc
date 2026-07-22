// WHOOP-specific OAuth + data. Shared Supabase helpers live in ./wearable.
import { saveConnection, type ProviderToken, type Connection, type Reading } from "@/lib/wearable";
export { haveService, getConnections, upsertReading } from "@/lib/wearable";
export type { Connection, Reading } from "@/lib/wearable";

const WHOOP_TOKEN = "https://api.prod.whoop.com/oauth/oauth2/token";
const WHOOP_API = "https://api.prod.whoop.com/developer";

export async function exchangeCode(code: string): Promise<ProviderToken | null> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: process.env.WHOOP_CLIENT_ID || "",
    client_secret: process.env.WHOOP_CLIENT_SECRET || "",
    redirect_uri: process.env.WHOOP_REDIRECT_URI || "",
  });
  const r = await fetch(WHOOP_TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  return r.ok ? ((await r.json()) as ProviderToken) : null;
}

export async function refreshToken(refresh: string): Promise<ProviderToken | null> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refresh,
    client_id: process.env.WHOOP_CLIENT_ID || "",
    client_secret: process.env.WHOOP_CLIENT_SECRET || "",
    scope: "offline",
  });
  const r = await fetch(WHOOP_TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  return r.ok ? ((await r.json()) as ProviderToken) : null;
}

export async function saveWhoop(swId: string, tok: ProviderToken, uid: string | null, by: string) {
  return saveConnection(swId, tok, uid, by, "whoop");
}

// Ensure a fresh access token; refresh + persist if within 60s of expiry.
export async function freshToken(c: Connection): Promise<string | null> {
  if (c.expires_at && Date.now() < c.expires_at - 60000) return c.access_token;
  if (!c.refresh_token) return c.access_token || null;
  const t = await refreshToken(c.refresh_token);
  if (!t) return null;
  await saveConnection(c.sw_id, t, c.provider_uid, "", "whoop");
  return t.access_token;
}

export async function whoopProfile(accessToken: string): Promise<string | null> {
  const r = await fetch(WHOOP_API + "/v1/user/profile/basic", { headers: { Authorization: "Bearer " + accessToken } });
  if (!r.ok) return null;
  const j = (await r.json()) as { user_id?: number | string };
  return j.user_id != null ? String(j.user_id) : null;
}

export async function latestReading(accessToken: string): Promise<Reading | null> {
  const rec = await fetch(WHOOP_API + "/v1/recovery?limit=1", { headers: { Authorization: "Bearer " + accessToken } });
  if (!rec.ok) return null;
  const recJson = (await rec.json()) as { records?: Array<{ created_at?: string; score?: { recovery_score?: number; resting_heart_rate?: number; hrv_rmssd_milli?: number } }> };
  const r0 = recJson.records && recJson.records[0];
  if (!r0) return null;
  const date = (r0.created_at || new Date().toISOString()).slice(0, 10);
  const recovery = r0.score?.recovery_score != null ? Math.round(r0.score.recovery_score) : null;
  const rhr = r0.score?.resting_heart_rate != null ? Math.round(r0.score.resting_heart_rate) : null;
  const hrv = r0.score?.hrv_rmssd_milli != null ? Math.round(r0.score.hrv_rmssd_milli) : null;

  let sleepH: number | null = null;
  const slp = await fetch(WHOOP_API + "/v1/activity/sleep?limit=1", { headers: { Authorization: "Bearer " + accessToken } });
  if (slp.ok) {
    const sj = (await slp.json()) as { records?: Array<{ score?: { stage_summary?: { total_in_bed_time_milli?: number } } }> };
    const ms = sj.records?.[0]?.score?.stage_summary?.total_in_bed_time_milli;
    if (ms) sleepH = Math.round((ms / 3600000) * 10) / 10;
  }

  let strain: number | null = null;
  const cyc = await fetch(WHOOP_API + "/v1/cycle?limit=1", { headers: { Authorization: "Bearer " + accessToken } });
  if (cyc.ok) {
    const cj = (await cyc.json()) as { records?: Array<{ score?: { strain?: number } }> };
    const st = cj.records?.[0]?.score?.strain;
    if (st != null) strain = Math.round(st * 10) / 10;
  }

  return { date, recovery, rhr, hrv, sleepH, strain };
}
