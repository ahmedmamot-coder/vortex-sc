// Server-only WHOOP + Supabase helpers. Uses the Supabase service-role key so it can
// read/write the private wearable_connections table (tokens) and upsert readings.

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://qhrpwiakobgcxfmcoyfg.supabase.co";
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const WHOOP_TOKEN = "https://api.prod.whoop.com/oauth/oauth2/token";
const WHOOP_API = "https://api.prod.whoop.com/developer";

export type WhoopToken = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

export type Connection = {
  sw_id: string;
  provider: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: number | null;
  provider_uid: string | null;
  scope: string | null;
};

function sbHeaders() {
  return { apikey: SB_SERVICE, Authorization: "Bearer " + SB_SERVICE, "Content-Type": "application/json" };
}

export function haveService() {
  return !!SB_SERVICE;
}

export async function exchangeCode(code: string): Promise<WhoopToken | null> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: process.env.WHOOP_CLIENT_ID || "",
    client_secret: process.env.WHOOP_CLIENT_SECRET || "",
    redirect_uri: process.env.WHOOP_REDIRECT_URI || "",
  });
  const r = await fetch(WHOOP_TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!r.ok) return null;
  return (await r.json()) as WhoopToken;
}

export async function refreshToken(refresh: string): Promise<WhoopToken | null> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refresh,
    client_id: process.env.WHOOP_CLIENT_ID || "",
    client_secret: process.env.WHOOP_CLIENT_SECRET || "",
    scope: "offline",
  });
  const r = await fetch(WHOOP_TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!r.ok) return null;
  return (await r.json()) as WhoopToken;
}

export async function saveConnection(swId: string, tok: WhoopToken, providerUid: string | null, by: string) {
  const row = {
    sw_id: swId,
    provider: "whoop",
    access_token: tok.access_token,
    refresh_token: tok.refresh_token || null,
    expires_at: Date.now() + (tok.expires_in ? tok.expires_in * 1000 : 3600 * 1000),
    provider_uid: providerUid,
    scope: tok.scope || null,
    connected_by: by || null,
    updated_at: new Date().toISOString(),
  };
  await fetch(SB_URL + "/rest/v1/wearable_connections", {
    method: "POST",
    headers: { ...sbHeaders(), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([row]),
  });
}

export async function getConnections(swId?: string): Promise<Connection[]> {
  const q = swId ? "?sw_id=eq." + encodeURIComponent(swId) : "?select=*";
  const r = await fetch(SB_URL + "/rest/v1/wearable_connections" + q, { headers: sbHeaders() });
  return r.ok ? ((await r.json()) as Connection[]) : [];
}

// Make sure the access token is fresh; refresh + persist if it's within 60s of expiry.
export async function freshToken(c: Connection): Promise<string | null> {
  if (c.expires_at && Date.now() < c.expires_at - 60000) return c.access_token;
  if (!c.refresh_token) return c.access_token || null;
  const t = await refreshToken(c.refresh_token);
  if (!t) return null;
  await saveConnection(c.sw_id, t, c.provider_uid, "");
  return t.access_token;
}

export async function whoopProfile(accessToken: string): Promise<string | null> {
  const r = await fetch(WHOOP_API + "/v1/user/profile/basic", { headers: { Authorization: "Bearer " + accessToken } });
  if (!r.ok) return null;
  const j = (await r.json()) as { user_id?: number | string };
  return j.user_id != null ? String(j.user_id) : null;
}

type Reading = { date: string; recovery: number | null; rhr: number | null; hrv: number | null; sleepH: number | null; strain: number | null };

// Pull the most recent recovery (has recovery %, resting HR, HRV) and sleep, and the cycle strain.
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

export async function upsertReading(swId: string, r: Reading) {
  const row = {
    id: swId + "_" + r.date,
    sw_id: swId,
    date: r.date,
    recovery: r.recovery,
    rhr: r.rhr,
    hrv: r.hrv,
    sleep_h: r.sleepH,
    strain: r.strain,
    source: "whoop",
    ts: Date.now(),
    updated_at: new Date().toISOString(),
  };
  await fetch(SB_URL + "/rest/v1/wearable_readings", {
    method: "POST",
    headers: { ...sbHeaders(), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([row]),
  });
}
