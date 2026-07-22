// Fitbit-specific OAuth + data. Shared Supabase helpers live in ./wearable.
// Fitbit gives resting HR, HRV and sleep; it has no "recovery %" or "strain", so those stay null.
import { saveConnection, type ProviderToken, type Connection, type Reading } from "@/lib/wearable";

const FITBIT_TOKEN = "https://api.fitbit.com/oauth2/token";
const FITBIT_API = "https://api.fitbit.com";

export const FITBIT_AUTH = "https://www.fitbit.com/oauth2/authorize";
export const FITBIT_SCOPE = "heartrate sleep profile";

function basicAuth() {
  const id = process.env.FITBIT_CLIENT_ID || "";
  const secret = process.env.FITBIT_CLIENT_SECRET || "";
  return "Basic " + Buffer.from(id + ":" + secret).toString("base64");
}

export async function exchangeCode(code: string): Promise<ProviderToken | null> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: process.env.FITBIT_REDIRECT_URI || "",
  });
  const r = await fetch(FITBIT_TOKEN, { method: "POST", headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded" }, body });
  return r.ok ? ((await r.json()) as ProviderToken) : null;
}

export async function refreshToken(refresh: string): Promise<ProviderToken | null> {
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh });
  const r = await fetch(FITBIT_TOKEN, { method: "POST", headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded" }, body });
  return r.ok ? ((await r.json()) as ProviderToken) : null;
}

export async function saveFitbit(swId: string, tok: ProviderToken, uid: string | null, by: string) {
  return saveConnection(swId, tok, uid, by, "fitbit");
}

export async function freshToken(c: Connection): Promise<string | null> {
  if (c.expires_at && Date.now() < c.expires_at - 60000) return c.access_token;
  if (!c.refresh_token) return c.access_token || null;
  const t = await refreshToken(c.refresh_token);
  if (!t) return null;
  await saveConnection(c.sw_id, t, c.provider_uid, "", "fitbit");
  return t.access_token;
}

export async function fitbitProfile(accessToken: string): Promise<string | null> {
  const r = await fetch(FITBIT_API + "/1/user/-/profile.json", { headers: { Authorization: "Bearer " + accessToken } });
  if (!r.ok) return null;
  const j = (await r.json()) as { user?: { encodedId?: string } };
  return j.user?.encodedId || null;
}

export async function latestReading(accessToken: string): Promise<Reading | null> {
  const H = { Authorization: "Bearer " + accessToken };
  const date = new Date().toISOString().slice(0, 10);

  let rhr: number | null = null;
  const hr = await fetch(FITBIT_API + "/1/user/-/activities/heart/date/today/1d.json", { headers: H });
  if (hr.ok) {
    const hj = (await hr.json()) as { "activities-heart"?: Array<{ value?: { restingHeartRate?: number } }> };
    const v = hj["activities-heart"]?.[0]?.value?.restingHeartRate;
    if (v != null) rhr = Math.round(v);
  }

  let hrv: number | null = null;
  const h = await fetch(FITBIT_API + "/1/user/-/hrv/date/today.json", { headers: H });
  if (h.ok) {
    const hj = (await h.json()) as { hrv?: Array<{ value?: { dailyRmssd?: number } }> };
    const v = hj.hrv?.[0]?.value?.dailyRmssd;
    if (v != null) hrv = Math.round(v);
  }

  let sleepH: number | null = null;
  const s = await fetch(FITBIT_API + "/1.2/user/-/sleep/date/today.json", { headers: H });
  if (s.ok) {
    const sj = (await s.json()) as { summary?: { totalMinutesAsleep?: number } };
    const m = sj.summary?.totalMinutesAsleep;
    if (m != null) sleepH = Math.round((m / 60) * 10) / 10;
  }

  if (rhr == null && hrv == null && sleepH == null) return null;
  return { date, recovery: null, rhr, hrv, sleepH, strain: null };
}
