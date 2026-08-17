// Delete a family account (admin only).
//
// Anyone can create a parent login from the family portal — that is what registration is — so
// the club ends up with accounts nobody recognises: a coach who signed up through the wrong tab,
// a test account, somebody who typed their email twice. Until now there was no way to remove one.
//
// Two things have to happen or it does not stick:
//
//  1. the row in family_accounts goes, and
//  2. the Supabase Auth user goes with it.
//
// Deleting only the row is worse than doing nothing: the person can still sign in, and the app
// rebuilds their account row from the Auth user's own metadata the moment they do. The account
// would reappear, and look like the deletion had silently failed.
//
// THE TRAP THIS AVOIDS: a coach's staff sign-in and their parent registration can be the same
// email address. Deleting that Auth user to remove a stray parent account would take away their
// staff login as well — a coach locked out of the club with no explanation. So the Auth user is
// deleted only when the address belongs to nobody else; when it is also a staff address, the
// family row is removed and the login is left alone, and the answer says which happened.
//
// POST /api/family/delete
//   headers: Authorization: Bearer <the admin's own Supabase JWT>
//   body:    { email }

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
  if (!(await isClubAdmin(email))) return { ok: false, email, reason: "only an admin can delete an account" };
  return { ok: true, email };
}

async function findUserByEmail(email: string): Promise<string | null> {
  const r = await fetch(`${SB_URL}/auth/v1/admin/users?page=1&per_page=200`, {
    headers: { apikey: SB_SERVICE, Authorization: "Bearer " + SB_SERVICE },
    cache: "no-store",
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  const users: Array<{ id: string; email?: string }> = (j && (j.users || j)) || [];
  const hit = users.find((u) => (u.email || "").toLowerCase() === email);
  return hit ? hit.id : null;
}

async function isStaffEmail(email: string): Promise<boolean> {
  const r = await fetch(
    `${SB_URL}/rest/v1/staff_accounts?select=email&email=eq.${encodeURIComponent(email)}&limit=1`,
    { headers: { apikey: SB_SERVICE, Authorization: "Bearer " + SB_SERVICE }, cache: "no-store" },
  );
  if (!r.ok) return true;               // cannot tell → assume it is, and keep the login
  const rows = await r.json().catch(() => null);
  return Array.isArray(rows) && rows.length > 0;
}

export async function POST(request: Request) {
  if (!haveService()) {
    return Response.json({ error: "server missing SUPABASE_SERVICE_ROLE_KEY" }, { status: 500 });
  }
  const who = await callerIsAdmin(request);
  if (!who.ok) return Response.json({ error: who.reason }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "which account? an email address is required" }, { status: 400 });
  }
  // An admin deleting their own login would lock the club out of its own administration, and is
  // never what was meant.
  if (email === who.email) {
    return Response.json({ error: "that is your own account" }, { status: 400 });
  }
  if (await isClubAdmin(email)) {
    return Response.json({ error: "that is a manager's account and cannot be deleted here" }, { status: 400 });
  }

  const del = await fetch(`${SB_URL}/rest/v1/family_accounts?email=eq.${encodeURIComponent(email)}`, {
    method: "DELETE",
    headers: { apikey: SB_SERVICE, Authorization: "Bearer " + SB_SERVICE, Prefer: "return=minimal" },
  });
  if (!del.ok) {
    return Response.json(
      { error: `the account row could not be removed: ${(await del.text().catch(() => "")).slice(0, 200)}` },
      { status: 502 },
    );
  }

  const staff = await isStaffEmail(email);
  if (staff) {
    return Response.json({
      ok: true,
      action: "family-row-only",
      email,
      by: who.email,
      note: "This address is also a staff login, so the sign-in was kept. Only the parent account was removed.",
    });
  }

  const uid = await findUserByEmail(email);
  if (!uid) {
    return Response.json({ ok: true, action: "row-removed-no-login", email, by: who.email });
  }
  const r = await fetch(`${SB_URL}/auth/v1/admin/users/${uid}`, {
    method: "DELETE",
    headers: { apikey: SB_SERVICE, Authorization: "Bearer " + SB_SERVICE },
  });
  if (!r.ok) {
    return Response.json(
      {
        error:
          "the account row was removed but the sign-in could not be deleted, so it would come back next time they signed in: " +
          (await r.text().catch(() => "")).slice(0, 200),
      },
      { status: 502 },
    );
  }
  return Response.json({ ok: true, action: "deleted", email, by: who.email });
}
