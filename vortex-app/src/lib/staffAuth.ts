// The Supabase Auth side of a staff account: who is asking, what their address really is, and
// whether a sign-in account for it exists.
//
// Two problems put this in one place.
//
// The first is an address that is not what it looks like. Two coaches — both with Arabic
// keyboards on their phones — could not have a password set at all, and Auth answered
// "Unable to validate email address: invalid format" about addresses that read as perfectly
// ordinary on screen. A right-to-left mark or a zero-width space pasted in with the address is
// invisible everywhere: in the field, in the staff list, in the error, and in JSON.stringify.
// cleanEmail removes the ones that carry no meaning in an address, so the address that is sent
// is the address that was meant; describe names anything left that it cannot safely remove,
// with its position, so a report can be answered instead of guessed at.
//
// The second is that the app had no way to ask whether an account exists. It kept its own note
// of "we set a password here", which is true only on the device that pressed the button and
// says nothing about a password set last month, set by somebody else, or set in Supabase
// directly. authAccounts asks the question that actually matters.

import { SB_URL, SB_SERVICE } from "@/lib/wearable";
import { isClubAdmin } from "@/lib/clubAdmins";

// Code points that are invisible, carry no meaning inside an email address, and are what a
// phone keyboard, a spreadsheet or a pasted message leaves behind: control codes, the
// non-breaking space, zero-width spaces and joiners, the direction marks and isolates, and the
// byte-order mark. Removing these changes no address that was correct to begin with.
//
// Listed as numbers rather than written into a regular expression on purpose — a character
// nobody can see in the fix is how the fix stops being reviewable.
const INVISIBLE: Array<[number, number]> = [
  [0x0000, 0x001f], // control codes
  [0x007f, 0x009f], // delete and the C1 controls
  [0x00a0, 0x00a0], // no-break space
  [0x180e, 0x180e], // Mongolian vowel separator
  [0x200b, 0x200f], // zero-width space/joiners, left-to-right and right-to-left marks
  [0x202a, 0x202e], // bidi embeddings and overrides
  [0x2060, 0x2064], // word joiner and the invisible operators
  [0x2066, 0x2069], // bidi isolates
  [0xfeff, 0xfeff], // byte-order mark
];

function invisible(code: number): boolean {
  return INVISIBLE.some(([lo, hi]) => code >= lo && code <= hi);
}

function strip(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c != null && !invisible(c)) out += ch;
  }
  return out;
}

/** An address with the invisible characters taken out, trimmed and lowercased. */
export function cleanEmail(email: unknown): string {
  return strip(String(email == null ? "" : email)).trim().toLowerCase();
}

/** True when cleaning actually removed something — worth saying so rather than silently fixing. */
export function hadInvisible(email: unknown): boolean {
  const raw = String(email == null ? "" : email);
  return strip(raw) !== raw;
}

/**
 * An address written so a character that is not what it looks like can be seen.
 *
 * JSON.stringify was not enough. It escapes control characters and quotes and leaves every
 * ordinary-looking letter alone — including a Cyrillic "а" or a Greek "ο", which print exactly
 * like the Latin ones and cannot be removed automatically because they might genuinely be part
 * of the address. Anything outside plain printable ASCII is named here with its position and
 * code point, because that is the difference between an answerable report and a week of guessing.
 */
export function describe(email: string): string {
  const odd: string[] = [];
  for (let i = 0; i < email.length; i++) {
    const c = email.charCodeAt(i);
    if (c < 32 || c > 126)
      odd.push(`position ${i + 1} is U+${c.toString(16).toUpperCase().padStart(4, "0")}, not a plain letter`);
  }
  return JSON.stringify(email) + (odd.length ? ` — ${odd.join("; ")}` : "");
}

/** The caller's own token, verified against Supabase, and their address checked against the admins. */
export async function callerIsAdmin(request: Request): Promise<{ ok: boolean; email?: string; reason?: string }> {
  const auth = request.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, reason: "not signed in" };
  const r = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: SB_SERVICE, Authorization: "Bearer " + token },
    cache: "no-store",
  });
  if (!r.ok) return { ok: false, reason: "session is not valid — sign in again" };
  const u = await r.json().catch(() => null);
  const email = cleanEmail(u && u.email);
  if (!email) return { ok: false, reason: "session has no email" };
  if (!(await isClubAdmin(email))) return { ok: false, email, reason: "only an admin can set staff passwords" };
  return { ok: true, email };
}

export type AuthAccount = {
  id: string;
  email: string;
  lastSignIn: string | null;
  createdAt: string | null;
  confirmed: boolean;
};

/**
 * Every sign-in account, keyed by cleaned address.
 *
 * Paged to the end rather than reading one page of 200. This club has over three hundred
 * families: anybody created after the first two hundred simply was not found, and "not found"
 * does not mean "no account" — it means the caller stops trying to update a password and tries
 * to create one on an address that already has one. Returns null when Auth could not be read at
 * all, which is a different answer from "no accounts" and has to stay different.
 */
export async function authAccounts(): Promise<Map<string, AuthAccount> | null> {
  const PER = 200;
  const out = new Map<string, AuthAccount>();
  for (let page = 1; page <= 25; page++) {
    const r = await fetch(`${SB_URL}/auth/v1/admin/users?page=${page}&per_page=${PER}`, {
      headers: { apikey: SB_SERVICE, Authorization: "Bearer " + SB_SERVICE },
      cache: "no-store",
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    const raw = j && (j as { users?: unknown }).users !== undefined ? (j as { users?: unknown }).users : j;
    if (!Array.isArray(raw)) return null;
    const users = raw as Array<Record<string, unknown>>;
    for (const u of users) {
      const email = cleanEmail(u.email);
      if (!email) continue;
      out.set(email, {
        id: String(u.id || ""),
        email,
        lastSignIn: (u.last_sign_in_at as string) || null,
        createdAt: (u.created_at as string) || null,
        confirmed: !!(u.email_confirmed_at || u.confirmed_at),
      });
    }
    if (users.length < PER) break; // that was the last page
  }
  return out;
}
