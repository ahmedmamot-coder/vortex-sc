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

// Which key is in SUPABASE_SERVICE_ROLE_KEY, as far as its shape can say.
//
// Presence is not enough: the publishable/anon key and the secret/service key sit next to each
// other on the same Supabase page, and the wrong one here passes every check and then reads and
// writes nothing, because row-level security still applies to it. A backup would come back
// empty and look like an empty club.
//
// Supabase has two generations of key and this has to know both. The current ones are opaque
// strings — `sb_secret_…` and `sb_publishable_…`. The legacy ones are JWTs carrying a `role`
// claim, which can be read without verification because it is our own key. Anything else is
// genuinely unrecognised, which is not the same as wrong: see serviceKeyWorks(), which settles
// it by asking Supabase rather than by reading the string.
export function serviceKeyRole(): "service_role" | "anon" | "unknown" | "missing" {
  if (!SB_SERVICE) return "missing";
  if (/^sb_secret_/.test(SB_SERVICE)) return "service_role";
  if (/^sb_publishable_/.test(SB_SERVICE)) return "anon";
  try {
    const body = SB_SERVICE.split(".")[1];
    if (!body) return "unknown";
    const json = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    const role = json && json.role;
    return role === "service_role" || role === "anon" ? role : "unknown";
  } catch {
    return "unknown";
  }
}

// The question the shape can only guess at: does this key actually carry service-role rights?
//
// Asked of GoTrue's admin endpoint, which no other key can reach at all — so the answer does
// not depend on knowing today's key format, and will still be right the next time Supabase
// changes it. Reads one user and keeps none of it.
export async function serviceKeyWorks(): Promise<boolean | null> {
  if (!SB_SERVICE) return false;
  try {
    const r = await fetch(SB_URL + "/auth/v1/admin/users?page=1&per_page=1", {
      headers: { apikey: SB_SERVICE, Authorization: "Bearer " + SB_SERVICE },
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    if (r.ok) return true;
    if (r.status === 401 || r.status === 403) return false;
    return null;                       // Supabase had a bad moment; "cannot tell" is not "no".
  } catch {
    return null;
  }
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
