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
import { authAccounts, callerIsAdmin, cleanEmail, describe, hadInvisible } from "@/lib/staffAuth";

export async function POST(request: Request) {
  if (!haveService()) {
    return Response.json({ error: "server missing SUPABASE_SERVICE_ROLE_KEY" }, { status: 500 });
  }
  const who = await callerIsAdmin(request);
  if (!who.ok) return Response.json({ error: who.reason }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const raw = String(body.email || "");
  // Two coaches could not be given a password at all, on addresses that read as perfectly
  // ordinary, because something invisible had come along with the paste. Take those out before
  // anything is judged — Auth judges the bytes, not what the address looks like.
  const email = cleanEmail(raw);
  const cleaned = hadInvisible(raw);
  const password = String(body.password || "");
  const name = String(body.name || "").trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return Response.json({ error: `a valid staff email is required — this one is ${describe(raw.trim())}` }, { status: 400 });
  if (password.length < 8) return Response.json({ error: "password must be at least 8 characters" }, { status: 400 });

  // One read of Auth answers both questions: is there already an account (update, not create),
  // and — for the caller — what the staff list should say about every other address it holds.
  const accounts = await authAccounts();
  if (accounts === null) return Response.json({ error: "could not read the sign-in accounts from Supabase" }, { status: 502 });
  const existing = accounts.get(email);

  if (existing) {
    const r = await fetch(`${SB_URL}/auth/v1/admin/users/${existing.id}`, {
      method: "PUT",
      headers: { apikey: SB_SERVICE, Authorization: "Bearer " + SB_SERVICE, "Content-Type": "application/json" },
      body: JSON.stringify({ password, email_confirm: true, user_metadata: { name, role: "staff" } }),
    });
    if (!r.ok) {
      const said = (await r.text().catch(() => "")).slice(0, 200);
      return Response.json({ error: `could not update ${describe(email)}: ${said}` }, { status: 502 });
    }
    return Response.json({ ok: true, action: "updated", email, cleaned, by: who.email });
  }

  const r = await fetch(`${SB_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SB_SERVICE, Authorization: "Bearer " + SB_SERVICE, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name, role: "staff" } }),
  });
  if (!r.ok) {
    const said = (await r.text().catch(() => "")).slice(0, 200);
    return Response.json({ error: `could not create ${describe(email)}: ${said}` }, { status: 502 });
  }
  return Response.json({ ok: true, action: "created", email, cleaned, by: who.email });
}
