// A parent deletes their own account, from inside the app.
//
// Apple requires this of any app that lets people create an account (App Store Review Guideline
// 5.1.1(v)), and it has to be doing rather than asking: a link that opens an email to the club is
// explicitly not enough. The club already had /api/family/delete, but only an admin can call it,
// so until now the honest answer to "how do I delete my account" was "email us and wait".
//
// This route is the same operation with the caller as its own subject. It inherits two things
// from the admin one because both were learned the hard way:
//
//  1. The row and the Auth user go together. Deleting only the row leaves a login that works, and
//     the app rebuilds the account from the Auth user's metadata the moment they sign in — the
//     deletion appears to have silently failed.
//
//  2. A coach's staff sign-in and their parent registration can share an email address. Deleting
//     that Auth user would take away their staff login too. So when the address is also a staff
//     address the family row goes and the login stays, and the answer says which happened.
//
// WHAT IS NOT DELETED, and why the answer says so out loud: the swimmer's own coaching record —
// attendance, results, training history — belongs to the club, not to the parent account that
// happened to be linked to it. The privacy policy says this in section 7. What goes is the
// account, the parent's own contact details, and the link between them.

import { SB_URL, SB_SERVICE, haveService } from "@/lib/wearable";
import { requireUser, isStaff } from "@/lib/callerAuth";
import { isClubAdmin } from "@/lib/clubAdmins";

async function findUserByEmail(email: string): Promise<string | null> {
  // The admin route pages through /admin/users and matches by hand. Here the caller has already
  // been identified by their own token, so their uid is known and no search is needed — but the
  // lookup stays as a fallback for an account whose token predates the id being carried.
  const r = await fetch(
    `${SB_URL}/auth/v1/admin/users?page=1&per_page=200`,
    { headers: { apikey: SB_SERVICE, Authorization: "Bearer " + SB_SERVICE }, cache: "no-store" },
  );
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  const users: Array<{ id: string; email?: string }> = (j && (j.users || j)) || [];
  const hit = users.find((u) => (u.email || "").toLowerCase() === email);
  return hit ? hit.id : null;
}

export async function POST(request: Request) {
  if (!haveService()) {
    return Response.json({ error: "server missing SUPABASE_SERVICE_ROLE_KEY" }, { status: 500 });
  }

  const who = await requireUser(request);
  if (!who.ok) return who.response;
  const { email, uid } = who.caller;

  // Typing the word is the whole confirmation. A button that deletes an account on one tap is one
  // mis-tap away from a parent losing their children's records, and the undo does not exist.
  const body = await request.json().catch(() => ({}));
  if (String(body.confirm || "").trim().toUpperCase() !== "DELETE") {
    return Response.json(
      { error: "type DELETE to confirm" },
      { status: 400 },
    );
  }

  // An admin deleting their own login would lock the club out of its own administration, and is
  // never what was meant. Same rule as the admin route, pointed the other way.
  if (await isClubAdmin(email)) {
    return Response.json(
      {
        error:
          "This is a club manager's account. Ask the other manager to remove it, so the club is never left without an administrator.",
      },
      { status: 400 },
    );
  }

  const del = await fetch(
    `${SB_URL}/rest/v1/family_accounts?email=eq.${encodeURIComponent(email)}`,
    {
      method: "DELETE",
      headers: { apikey: SB_SERVICE, Authorization: "Bearer " + SB_SERVICE, Prefer: "return=minimal" },
    },
  );
  if (!del.ok) {
    return Response.json(
      {
        error:
          "Your account could not be removed just now. Nothing has been deleted — please try again, or email privacy@vortexswimmingclub.com.",
        detail: (await del.text().catch(() => "")).slice(0, 200),
      },
      { status: 502 },
    );
  }

  if (await isStaff(email)) {
    return Response.json({
      ok: true,
      action: "family-row-only",
      note:
        "Your parent account has been deleted. This address is also a coach sign-in for the club, so that login has been kept.",
    });
  }

  const id = uid || (await findUserByEmail(email));
  if (!id) return Response.json({ ok: true, action: "row-removed-no-login" });

  const r = await fetch(`${SB_URL}/auth/v1/admin/users/${id}`, {
    method: "DELETE",
    headers: { apikey: SB_SERVICE, Authorization: "Bearer " + SB_SERVICE },
  });
  if (!r.ok) {
    return Response.json(
      {
        error:
          "Your account details were removed, but the sign-in itself could not be deleted — so it would come back next time you signed in. Please email privacy@vortexswimmingclub.com and we will finish it by hand.",
        detail: (await r.text().catch(() => "")).slice(0, 200),
      },
      { status: 502 },
    );
  }

  return Response.json({
    ok: true,
    action: "deleted",
    note: "Your account and sign-in have been deleted.",
  });
}
