// Which staff addresses can actually sign in (admin only).
//
// The staff list used to answer this from a note the app wrote to itself the moment somebody
// pressed "Set password". That note is not the truth — it is one device's memory of one button
// press. It says nothing about a password set last month, set by the other manager on her own
// phone, or set in the Supabase dashboard directly, and if it never made it out of the browser
// it says nothing at all. So the row went on reading "set a password below so they can sign in"
// for accounts that had a working password, which is exactly what was reported: "after setting
// the password this message still shows in each account".
//
// This asks Supabase Auth instead. The answer is the same on every device, for every account,
// however the password was set.
//
// POST /api/staff/sign-in-status
//   headers: Authorization: Bearer <the admin's own Supabase JWT>
//   body:    { emails: string[] }   — the addresses on the staff list
//   →        { ok, accounts: { "<email>": { lastSignIn, createdAt, confirmed } } }
//
// Only the addresses asked about come back, and never a user id — the staff screen needs to
// know "yes, this one can sign in", not the shape of the club's auth table.

import { haveService } from "@/lib/wearable";
import { authAccounts, callerIsAdmin, cleanEmail } from "@/lib/staffAuth";

export async function POST(request: Request) {
  if (!haveService()) {
    return Response.json({ error: "server missing SUPABASE_SERVICE_ROLE_KEY" }, { status: 500 });
  }
  const who = await callerIsAdmin(request);
  if (!who.ok) return Response.json({ error: who.reason }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const asked = Array.isArray(body.emails) ? body.emails.map(cleanEmail).filter(Boolean) : [];
  if (!asked.length) return Response.json({ ok: true, accounts: {} });

  const found = await authAccounts();
  // Null means Auth could not be read, which is not the same as "none of them have accounts".
  // Saying so lets the staff list keep its own note rather than turn every row amber on a blip.
  if (found === null) return Response.json({ error: "could not read the sign-in accounts from Supabase" }, { status: 502 });

  const accounts: Record<string, { lastSignIn: string | null; createdAt: string | null; confirmed: boolean }> = {};
  for (const e of asked) {
    const a = found.get(e);
    if (a) accounts[e] = { lastSignIn: a.lastSignIn, createdAt: a.createdAt, confirmed: a.confirmed };
  }
  return Response.json({ ok: true, accounts, checked: asked.length });
}
