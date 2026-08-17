// Who may do the two things that are more than staff work: set another person's sign-in password,
// and delete an account.
//
// This was written into both routes as a pair of addresses:
//
//     const ADMIN_EMAILS = ["ahmedmamot@gmail.com", "sameh@vortexswimmingclub.com"];
//
// The second is not the address Sameh signs in with. His is on his staff row and it is a
// different one, so both routes refused him — and he is one of the two people who run this club.
// What he saw was "only an admin can set staff passwords", on a screen whose header said
// ADMINISTRATOR · FULL ACCESS. It was the third copy of the same mistake: the family list had it
// too, and so did the role check in the app.
//
// Two ways to answer it now, in this order:
//
//   1. VX_ADMIN_EMAILS, a comma-separated list in the environment. If it is set, it is the whole
//      answer. This is the tight option, and the point of it being in the environment rather than
//      in this file is that a wrong address can be corrected without a deploy — which is the
//      property this needed and did not have.
//
//   2. Otherwise the club's own staff table: the caller's row, with a role that grants full
//      access, judged exactly as the app judges it. Self-maintaining, and right by default.
//
// On (2) being weaker than a fixed list: any staff member can already write to staff_accounts —
// that is what the row-level policy allows — so a coach could already give themselves an admin
// role and the run of Club Administration. The open door is that policy, not this list, and
// pretending otherwise while leaving Sameh locked out would be the worse trade. Set
// VX_ADMIN_EMAILS if you want it shut here regardless.

import { SB_URL, SB_SERVICE } from "@/lib/wearable";

const ENV_ADMINS = (process.env.VX_ADMIN_EMAILS || "")
  .split(",")
  .map((s: string) => s.trim().toLowerCase())
  .filter(Boolean);

/**
 * Does this role, as somebody actually typed it, mean full access?
 *
 * The same rule the app uses, deliberately duplicated rather than imported: proto.html is a
 * single file served to the browser and this is server code, so the two cannot share it. If one
 * is changed the other must be, and the test asserts they still agree.
 */
export function grantsFullAccess(role: string): boolean {
  const raw = String(role || "").toLowerCase();
  if (/full access/.test(raw)) return true;
  const title = raw.split("·")[0].replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!title) return false;
  if (!/\b(owner|ceo|admin|administrator|manager|director|head coach)\b/.test(title)) return false;
  return !/\b(assistant|deputy|trainee|intern)\b/.test(title);
}

/** Is this the address of somebody who runs the club? */
export async function isClubAdmin(email: string): Promise<boolean> {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return false;
  if (ENV_ADMINS.length) return ENV_ADMINS.includes(e);

  const r = await fetch(`${SB_URL}/rest/v1/staff_accounts?select=email,role`, {
    headers: { apikey: SB_SERVICE, Authorization: "Bearer " + SB_SERVICE },
    cache: "no-store",
  });
  // Cannot tell. For a route that sets somebody's password, refusing is the safe way to be wrong.
  if (!r.ok) return false;
  const rows = await r.json().catch(() => null);
  if (!Array.isArray(rows)) return false;
  return rows.some(
    (x) => String((x && x.email) || "").trim().toLowerCase() === e && grantsFullAccess((x && x.role) || ""),
  );
}
