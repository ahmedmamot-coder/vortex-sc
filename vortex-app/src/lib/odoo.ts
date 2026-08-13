// Talking to Odoo. Server-only — never import this into anything the browser loads.
//
// Odoo's external API is offered as XML-RPC and as JSON-RPC. Both do the same thing; JSON-RPC is
// used here because it needs no XML encoder, and one less hand-written parser between the club's
// invoices and its accounts is worth having.
//
// Every call is two steps: authenticate to get a numeric uid, then execute_kw to call a method on
// a model. The API key is used exactly where a password would be — it IS the credential, so it
// lives in the environment on the server and never reaches a phone.
//
// Env:
//   ODOO_URL      https://vortexaquatics.com   (no trailing /odoo)
//   ODOO_DB       the database name
//   ODOO_USER     the login email
//   ODOO_API_KEY  Settings → Users → Developer API Keys

export const ODOO_URL = (process.env.ODOO_URL || "").replace(/\/+$/, "").replace(/\/odoo$/i, "");
export const ODOO_DB = process.env.ODOO_DB || "";
export const ODOO_USER = process.env.ODOO_USER || "";
export const ODOO_KEY = process.env.ODOO_API_KEY || "";

export function odooMissing(): string[] {
  const missing: string[] = [];
  if (!ODOO_URL) missing.push("ODOO_URL");
  if (!ODOO_DB) missing.push("ODOO_DB");
  if (!ODOO_USER) missing.push("ODOO_USER");
  if (!ODOO_KEY) missing.push("ODOO_API_KEY");
  return missing;
}
export function odooConfigured() {
  return odooMissing().length === 0;
}

type RpcParams = { service: string; method: string; args: unknown[] };

// One JSON-RPC call. Odoo answers HTTP 200 even for a failure and puts the reason in `error`,
// so a bare `res.ok` means nothing here — the body has to be read either way.
async function rpc(params: RpcParams, timeoutMs = 20000): Promise<unknown> {
  const r = await fetch(`${ODOO_URL}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "call", params, id: Date.now() }),
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  const text = await r.text();
  let j: { result?: unknown; error?: { message?: string; data?: { message?: string } } };
  try {
    j = JSON.parse(text);
  } catch {
    // An HTML page back from /jsonrpc almost always means the URL points at the web client
    // rather than the API root, which is the one mistake worth naming outright.
    throw new Error(
      r.status === 404
        ? `Odoo has no /jsonrpc at ${ODOO_URL} — check ODOO_URL is the site root, with no /odoo on the end`
        : `Odoo answered HTTP ${r.status} with something that is not JSON`,
    );
  }
  if (j.error) {
    const msg = j.error.data?.message || j.error.message || "Odoo refused the call";
    throw new Error(msg);
  }
  return j.result;
}

// The uid, or null when the credentials are wrong. Odoo returns `false` rather than an error for
// a bad login, which reads as success to anything checking only for a thrown exception.
export async function odooLogin(): Promise<number | null> {
  const res = await rpc({ service: "common", method: "login", args: [ODOO_DB, ODOO_USER, ODOO_KEY] });
  return typeof res === "number" && res > 0 ? res : null;
}

export async function odooVersion(): Promise<Record<string, unknown> | null> {
  try {
    const v = await rpc({ service: "common", method: "version", args: [] }, 10000);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// The database names this server will admit to, when it is willing to say. Most production
// installs disable the list, which is not a fault — it just means ODOO_DB has to be typed in.
export async function odooDatabases(): Promise<string[] | null> {
  try {
    const v = await rpc({ service: "db", method: "list", args: [] }, 10000);
    return Array.isArray(v) ? (v as string[]) : null;
  } catch {
    return null;
  }
}

export async function odooCall<T = unknown>(
  uid: number,
  model: string,
  method: string,
  args: unknown[] = [],
  kwargs: Record<string, unknown> = {},
): Promise<T> {
  return (await rpc({
    service: "object",
    method: "execute_kw",
    args: [ODOO_DB, uid, ODOO_KEY, model, method, args, kwargs],
  })) as T;
}

// Whether this login may actually read and write what the club needs, rather than merely exist.
// A key with no accounting rights authenticates perfectly and then fails on the first invoice,
// which is the kind of thing worth finding out before a month of fees depends on it.
export async function odooCanBill(uid: number): Promise<{ ok: boolean; why?: string }> {
  try {
    await odooCall(uid, "res.partner", "search_read", [[]], { fields: ["id"], limit: 1 });
  } catch (e) {
    return { ok: false, why: "cannot read customers (res.partner): " + (e as Error).message };
  }
  try {
    await odooCall(uid, "account.move", "search_read", [[]], { fields: ["id"], limit: 1 });
  } catch (e) {
    return { ok: false, why: "cannot read invoices (account.move) — is Accounting or Invoicing installed? " + (e as Error).message };
  }
  return { ok: true };
}
