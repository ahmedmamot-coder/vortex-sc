// Is this the date of birth the club holds for this child?
//
// A parent registering is not signed in yet, and every table that holds a date of birth is
// closed to anonymous readers — correctly. So the browser had nothing to check against, and the
// registration screen told every parent the same thing:
//
//     "Omar Abu Rezeq can't be linked automatically — there's no date of birth on file.
//      Please ask the club to link this child to your account."
//
// The club does have his date of birth. It is 28/05/2008 and it is on the admin screen. What the
// parent's phone had was the roster that ships inside the page, which carries names, squads and
// ages and no dates at all. So this was not one child missing a date; it was self-linking not
// working for anybody, and every family arriving at launch would have needed the club to link
// them by hand.
//
// The obvious repair — send the dates to the page so the browser can compare them — is the one
// that must not be made. That would put 300 children's dates of birth in a file anyone can open
// without signing in. The comparison belongs on the server, and only the answer travels.
//
// POST /api/family/verify-child
//   body: { swimmerId: "junior::r138", dob: "28/05/2008" }
//   →     { ok: true } | { ok: false, reason } | { ok: false, noDob: true }
//
// No authentication, by necessity — the person asking has no account yet. What stops it being a
// way to read a child's date of birth is that it never says one: the answer is yes or no, a wrong
// answer costs an attempt, and five wrong attempts close that child for an hour. Guessing a date
// blind is 1 in several thousand; five tries an hour makes that useless.

import { svc, rosterFromAsset } from "@/lib/backupStore";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://qhrpwiakobgcxfmcoyfg.supabase.co";

type Swimmer = { id?: string; name?: string; dob?: string };
type Edits = {
  edits?: Record<string, Record<string, Record<string, unknown>>>;
  added?: Record<string, Array<Record<string, unknown>>>;
  deleted?: Record<string, Record<string, boolean>>;
};

// One process's memory, which is the honest description of it: a serverless deployment can run
// several, so this is a speed bump rather than a wall. It is enough for what it is for — a person
// on a phone trying dates one at a time — and the real protection is that a right answer is the
// only thing that ever comes back.
const tries = new Map<string, { n: number; until: number }>();
const MAX = 5, WINDOW = 60 * 60 * 1000;

function tooMany(key: string): boolean {
  const t = tries.get(key);
  if (!t) return false;
  if (Date.now() > t.until) { tries.delete(key); return false; }
  return t.n >= MAX;
}

function countWrong(key: string) {
  const t = tries.get(key);
  if (t && Date.now() <= t.until) t.n++;
  else tries.set(key, { n: 1, until: Date.now() + WINDOW });
}

// Exported for the tests, for the same reason cleanContext is: what ships has to be what is
// checked. A test against a copy of a date parser agrees with itself for ever.
/** A date as three numbers, however it was written. The club writes 28/05/2008; a parent may not. */
export function parts(s: unknown): { y: number; m: number; d: number } | null {
  const raw = String(s ?? "").trim();
  if (!raw) return null;
  let m = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);          // 2008-05-28
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  m = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);              // 28/05/2008
  if (m) return { y: +m[3], m: +m[2], d: +m[1] };
  return null;
}

export function same(a: unknown, b: unknown): boolean {
  const x = parts(a), y = parts(b);
  return !!(x && y && x.y === y.y && x.m === y.m && x.d === y.d);
}

async function baseRoster(origin: string): Promise<Record<string, Swimmer[]> | null> {
  try {
    const r = await fetch(origin + "/assets/roster.js", { cache: "no-store" });
    if (r.ok) return rosterFromAsset(await r.text());
  } catch { /* the overlay may still hold this child */ }
  return null;
}

async function overlay(): Promise<Edits | null> {
  const r = await fetch(SB_URL + "/rest/v1/club_state?select=value&key=eq.vx_roster_edits", {
    headers: svc(), cache: "no-store",
  });
  if (!r.ok) return null;
  const rows = (await r.json().catch(() => null)) as Array<{ value?: unknown }> | null;
  const v = rows && rows[0] ? rows[0].value : null;
  if (v == null) return null;
  try { return (typeof v === "string" ? JSON.parse(v) : v) as Edits; } catch { return null; }
}

/**
 * The date the club holds for one swimmer, read the way the app reads it: the roster that ships
 * with the page, with the overlay on top. The overlay wins, because that is where every date
 * typed into the admin screen goes.
 */
export function dobOf(base: Record<string, Swimmer[]> | null, ed: Edits | null, squad: string, id: string): string {
  const patch = ed?.edits?.[squad]?.[id];
  if (patch && typeof patch.dob === "string" && patch.dob.trim()) return patch.dob.trim();
  for (const sw of ed?.added?.[squad] || []) {
    if (sw && sw.id === id && typeof sw.dob === "string" && sw.dob.trim()) return String(sw.dob).trim();
  }
  for (const sw of base?.[squad] || []) {
    if (sw && sw.id === id && typeof sw.dob === "string" && sw.dob.trim()) return sw.dob.trim();
  }
  return "";
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const uid = String(body.swimmerId || "").trim();
  const answer = String(body.dob || "").trim();

  // "squad::id" is how the registration screen names a child, and it is the only shape accepted —
  // the squad is half the lookup and an id on its own would search the whole club.
  const bits = uid.split("::");
  if (bits.length !== 2 || !bits[0] || !bits[1] || uid.length > 120)
    return Response.json({ ok: false, reason: "that swimmer could not be found" }, { status: 400 });
  const [squad, id] = bits;

  if (tooMany(uid))
    return Response.json({ ok: false, reason: "Too many incorrect attempts for this swimmer. Please ask the club to link your child." }, { status: 429 });

  if (!parts(answer))
    return Response.json({ ok: false, reason: "Enter the date as DD/MM/YYYY." }, { status: 400 });

  const origin = new URL(request.url).origin;
  const [base, ed] = await Promise.all([baseRoster(origin), overlay()]);
  if (!base && !ed)
    return Response.json({ ok: false, reason: "We could not check that just now. Please try again in a moment." }, { status: 503 });

  if (ed?.deleted?.[squad]?.[id])
    return Response.json({ ok: false, reason: "that swimmer could not be found" }, { status: 404 });

  const dob = dobOf(base, ed, squad, id);
  // No date on file is a different answer from a wrong date, and it does not cost an attempt:
  // the parent has done nothing wrong and no amount of trying will help them.
  if (!dob) return Response.json({ ok: false, noDob: true });

  if (!same(answer, dob)) {
    countWrong(uid);
    const t = tries.get(uid);
    return Response.json({ ok: false, left: Math.max(0, MAX - (t ? t.n : 0)) });
  }
  tries.delete(uid);
  return Response.json({ ok: true });
}
