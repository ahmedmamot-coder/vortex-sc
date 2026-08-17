// Set a staff member's sign-in password (admin only).
//
// Staff used to "log in" with a 4-digit PIN that was hardcoded in the page source and
// checked in the browser, so anyone who viewed source had full admin. Staff now sign in
// with a password verified by Supabase Auth, exactly like families. Because the coaches'
// @vortexswimmingclub.com addresses are not real mailboxes, they cannot use reset emails,
// so an admin sets the password here instead.
//
// POST /api/staff/set-password
//   headers: Authorization: Bearer <the admin's own Supabase JWT>
//   body:    { email, password, name? }
//
// Authorisation: the caller's token is verified against Supabase, and their email must be
// on the admin list. A stolen anon key is not enough.

import { SB_URL, SB_SERVICE, haveService } from "@/lib/wearable";
import { isClubAdmin } from "@/lib/clubAdmins";

async function callerIsAdmin(request: Request): Promise<{ ok: boolean; email?: string; reason?: string }> {
  const auth = request.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, reason: "not signed in" };
  const r = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: SB_SERVICE, Authorization: "Bearer " + token },
    cache: "no-store",
  });
  if (!r.ok) return { ok: false, reason: "session is not valid — sign in again" };
  const u = await r.json().catch(() => null);
  const email = (u && u.email ? String(u.email) : "").toLowerCase();
  if (!email) return { ok: false, reason: "session has no email" };
  if (!(await isClubAdmin(email))) return { ok: false, email, reason: "only an admin can set staff passwords" };
  return { ok: true, email };
}

// Find the sign-in account for an address, however far down the list it is.
//
// This read one page of 200 and stopped. This club has over three hundred families, so anybody
// whose account was created after the first two hundred simply was not found — and "not found"
// here does not mean "no account", it means the route stops trying to UPDATE a password and
// tries to CREATE one instead, on an address that already has an account. What comes back then
// is an error about the address, which reads like the address is wrong when it is not.
//
// Every page now, until a short one says there are no more. Capped so a broken pager cannot spin.
async function findUserByEmail(email: string): Promise<string | null> {
  const PER = 200;
  for (let page = 1; page <= 25; page++) {
    const r = await fetch(`${SB_URL}/auth/v1/admin/users?page=${page}&per_page=${PER}`, {
      headers: { apikey: SB_SERVICE, Authorization: "Bearer " + SB_SERVICE },
      cache: "no-store",
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    const users: Array<{ id: string; email?: string }> = (j && (j.users || j)) || [];
    const hit = users.find((u) => (u.email || "").toLowerCase() === email);
    if (hit) return hit.id;
    if (users.length < PER) return null;          // that was the last page
  }
  return null;
}

export async function POST(request: Request) {
  if (!haveService()) {
    return Response.json({ error: "server missing SUPABASE_SERVICE_ROLE_KEY" }, { status: 500 });
  }
  const who = await callerIsAdmin(request);
  if (!who.ok) return Response.json({ error: who.reason }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const name = String(body.name || "").trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: "a valid staff email is required" }, { status: 400 });
  if (password.length < 8) return Response.json({ error: "password must be at least 8 characters" }, { status: 400 });

  const existingId = await findUserByEmail(email);

  if (existingId) {
    const r = await fetch(`${SB_URL}/auth/v1/admin/users/${existingId}`, {
      method: "PUT",
      headers: { apikey: SB_SERVICE, Authorization: "Bearer " + SB_SERVICE, "Content-Type": "application/json" },
      body: JSON.stringify({ password, email_confirm: true, user_metadata: { name, role: "staff" } }),
    });
    if (!r.ok) {
      const said = (await r.text().catch(() => "")).slice(0, 200);
      return Response.json({ error: `could not update ${JSON.stringify(email)}: ${said}` }, { status: 502 });
    }
    return Response.json({ ok: true, action: "updated", email, by: who.email });
  }

  const r = await fetch(`${SB_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SB_SERVICE, Authorization: "Bearer " + SB_SERVICE, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name, role: "staff" } }),
  });
  if (!r.ok) {
    // JSON.stringify so a stray space, a non-breaking space or a lookalike character is visible
    // rather than invisible. "invalid format" about an address that looks perfectly ordinary is
    // otherwise unanswerable from a screenshot.
    const said = (await r.text().catch(() => "")).slice(0, 200);
    return Response.json({ error: `could not create ${JSON.stringify(email)}: ${said}` }, { status: 502 });
  }
  return Response.json({ ok: true, action: "created", email, by: who.email });
}
