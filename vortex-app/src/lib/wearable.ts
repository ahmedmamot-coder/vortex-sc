// Shared server-only helpers for wearable providers (WHOOP, Fitbit). Uses the Supabase
// service-role key so it can read/write the private wearable_connections table (tokens)
// and upsert daily readings. Never import this into browser code.

export const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://qhrpwiakobgcxfmcoyfg.supabase.co";
export const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export function sbHeaders() {
  return { apikey: SB_SERVICE, Authorization: "Bearer " + SB_SERVICE, "Content-Type": "application/json" };
}
export function haveService() {
  return !!SB_SERVICE;
}

export type ProviderToken = { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
export type Connection = {
  sw_id: string;
  provider: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: number | null;
  provider_uid: string | null;
  scope: string | null;
  updated_at?: string;
};
export type Reading = { date: string; recovery: number | null; rhr: number | null; hrv: number | null; sleepH: number | null; strain: number | null };

export async function saveConnection(swId: string, tok: ProviderToken, providerUid: string | null, by: string, provider: string) {
  const row = {
    sw_id: swId,
    provider,
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

export async function upsertReading(swId: string, r: Reading, source: string) {
  const row = {
    id: swId + "_" + r.date,
    sw_id: swId,
    date: r.date,
    recovery: r.recovery,
    rhr: r.rhr,
    hrv: r.hrv,
    sleep_h: r.sleepH,
    strain: r.strain,
    source,
    ts: Date.now(),
    updated_at: new Date().toISOString(),
  };
  await fetch(SB_URL + "/rest/v1/wearable_readings", {
    method: "POST",
    headers: { ...sbHeaders(), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([row]),
  });
}
