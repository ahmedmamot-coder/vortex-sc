// Who is asking, answered once, for every route that needs to know.
//
// Three routes had each answered it differently, and each of them was wrong in its own way.
// /api/push/send checked that a token was valid and stopped there, so any parent who had just
// registered could notify all 304 families. /api/ai/coach did not ask at all, so the club's
// Anthropic key was spendable by anyone who found the URL. /api/backup/* asked for a secret only
// if one happened to be configured, which on a deployment without BACKUP_SECRET set means the
// whole club is exportable by anyone.
//
// The shape below is deliberate: a caller is identified by their own Supabase JWT, never by
// anything they can assert about themselves in the body. `service` is only ever used to *look up*
// the answer — never to authorise the caller who sent the request.

import { SB_URL, SB_SERVICE } from "@/lib/wearable";
import { isClubAdmin, grantsFullAccess } from "@/lib/clubAdmins";

export type Caller = { email: string; uid: string };
export type CallerResult = { ok: true; caller: Caller } | { ok: false; response: Response };

function no(reason: string, status: number): { ok: false; response: Response } {
  return { ok: false, response: Response.json({ error: reason }, { status }) };
}

/** The bearer token on the request, or "" — never a key of ours. */
function bearer(request: Request): string {
  return (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
}

/**
 * The signed-in user behind this request.
 *
 * Verified against Supabase Auth rather than decoded here: a JWT this process merely *parses* is
 * a claim, and the signature is the whole point.
 */
export async function requireUser(request: Request): Promise<CallerResult> {
  if (!SB_SERVICE) return no("server missing SUPABASE_SERVICE_ROLE_KEY", 500);
  const token = bearer(request);
  if (!token) return no("not signed in", 401);

  const r = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: SB_SERVICE, Authorization: "Bearer " + token },
    cache: "no-store",
  });
  if (!r.ok) return no("session is not valid — sign in again", 401);

  const u = await r.json().catch(() => null);
  const email = String((u && u.email) || "").trim().toLowerCase();
  const uid = String((u && u.id) || "");
  if (!email || !uid) return no("session has no account behind it", 401);
  return { ok: true, caller: { email, uid } };
}

/** Is this address on the club's staff table at all — any role? */
export async function isStaff(email: string): Promise<boolean> {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return false;
  const r = await fetch(
    `${SB_URL}/rest/v1/staff_accounts?select=email&email=eq.${encodeURIComponent(e)}&limit=1`,
    { headers: { apikey: SB_SERVICE, Authorization: "Bearer " + SB_SERVICE }, cache: "no-store" },
  );
  // Cannot tell. For a gate, refusing is the safe way to be wrong — the opposite of the
  // isStaffEmail() in /api/family/delete, which assumes true because there it *protects* a login.
  if (!r.ok) return false;
  const rows = await r.json().catch(() => null);
  return Array.isArray(rows) && rows.length > 0;
}

/** A signed-in coach or admin. Parents are refused. */
export async function requireStaff(request: Request): Promise<CallerResult> {
  const who = await requireUser(request);
  if (!who.ok) return who;
  if (await isStaff(who.caller.email)) return who;
  if (await isClubAdmin(who.caller.email)) return who;
  return no("this is for club staff", 403);
}

/** Somebody who runs the club. */
export async function requireAdmin(request: Request): Promise<CallerResult> {
  const who = await requireUser(request);
  if (!who.ok) return who;
  if (await isClubAdmin(who.caller.email)) return who;
  return no("only an admin can do that", 403);
}

export { grantsFullAccess };
