// The club, cut down to one family.
//
// Audit finding D3. Every device pulls club_state with `pull(SYNC)` — all 35 keys, the whole
// club — and club_state's policy is `for select to authenticated using (true)`. Anybody can
// create a family login; that is what registration is. So "authenticated" is not a boundary, and
// one registration is the distance between a stranger and the club's roster, fees, memberships,
// billing and staff overrides.
//
// DEVELOPMENT.md already names the fix and this is it: the family portal asks the server, the
// server holds the service key, and what comes back is this family's slice and nothing else.
//
// WHAT MAKES THIS SAFE IS THE ALLOWLIST, not the filtering. Two families of key:
//
//   CLUB     — the same for everybody and carrying nobody's data: the club's name and currency,
//              the squad list, the fee table. Returned whole.
//   PER_SWIMMER — keyed by, or containing, a swimmer id. Returned with every id that is not
//              this family's removed.
//
// A key in neither list is not returned. That is the point: when somebody adds a key next year,
// the default is that families do not get it, rather than that somebody remembers to exclude it.

import { SB_URL, SB_SERVICE, haveService } from "@/lib/wearable";
import { requireUser } from "@/lib/callerAuth";

export const maxDuration = 20;

/** Club-wide and carrying no personal data. Returned as they are. */
const CLUB_KEYS = [
  "vx_brand",        // club name, currency, zone method, locale
  "vx_squads",       // squad order and names
  "vx_fee_plans",    // the price list
  "vx_meets_cal",    // the meet calendar
  "vx_meet_events",
  "vx_meet_cuts",
  // A meet's own details — entry deadline, warm-up, sessions, fee, the club's note and the link
  // to its information sheet — and the camps beside it. Both are the same for every family and
  // name nobody: they are the club telling its members what is happening, which is the whole
  // reason a family opens this screen.
  "vx_meet_info",
  "vx_camps",
  "vx_season",
];

/**
 * Keyed by swimmer id at the top level: { "r3": {...}, "r76": {...} }.
 * Everything not this family's is dropped.
 */
const PER_SWIMMER_KEYS = [
  "vx_sw_meta",
  "vx_memberships",
  "vx_race_splits",
  "vx_tpace",
  "vx_fitness_tests",
  "vx_swimmer_goals",
];

/** { "2026-07": { "r3": false } } — a period, then swimmer ids. */
const PERIOD_THEN_SWIMMER_KEYS = ["vx_invoices"];

/** { "Meet name": [ { swId, name, ... } ] } — arrays of entries carrying other children's names. */
const ARRAY_BY_SWID_KEYS = ["vx_meet_entries"];

/**
 * The roster document, cut to this family's children.
 *
 * rebuildRoster() is base + overlay: the base is `window.VX_ROSTER`, assigned by
 * public/assets/roster.js (272 swimmers, loaded by proto.html at line 93 and shipped with the
 * app), and this document is the overlay — `edits` patching a swimmer field by field, `deleted`
 * removing them from a squad and `added` putting them in another, which together are how a
 * squad move is recorded.
 *
 * So withholding it does not empty a parent's roster; the base still resolves their child by id.
 * What it does is serve them a stale one. Measured against the live record for the 8 linked
 * children: the name is identical in every case (roster.js was regenerated on 20 August), but
 * the date of birth differs for six of them, the age for two, and six of the eight sit in a
 * different squad in the overlay than in the base. A parent would have seen their own child,
 * correctly named, filed under the squad they left, with a date of birth the club had since
 * corrected.
 *
 * Hence: returned, and sliced the same way as everything else — this family's children and
 * nobody else's, in all three parts of the document.
 */
const ROSTER_DOC_KEYS = ["vx_roster_edits"];

type Json = Record<string, unknown>;

type MeetRow = {
  name: string;
  meet_date?: string;
  location?: string;
  course?: string;
  events?: unknown;
  status?: string;
  club_built?: boolean;
  updated_at?: string;
};

/** The club's meets, one row each. Null when the table cannot be read, so the caller can tell
 *  "no meets" apart from "no answer" and simply leave the two keys out rather than send empties. */
async function fetchMeets(): Promise<MeetRow[] | null> {
  try {
    const r = await fetch(SB_URL + "/rest/v1/club_meets?select=*&limit=2000", {
      headers: svc(),
      cache: "no-store",
    });
    if (!r.ok) return null;
    const rows = (await r.json().catch(() => null)) as MeetRow[] | null;
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

/** Back into the two shapes the app has always read: the array of the club's own meets, and the
 *  map of every meet's status. */
export function meetsAsClubStateRows(rows: MeetRow[]) {
  const at = rows.reduce((a, r) => (r.updated_at && r.updated_at > a ? r.updated_at : a), "");
  const updated_at = at || new Date().toISOString();
  const custom = rows
    .filter((r) => r.club_built && r.name)
    .map((r) => ({
      name: r.name,
      location: r.location || "",
      date: r.meet_date || "",
      course: r.course || "LCM",
      entries: 0,
      events: Array.isArray(r.events) ? r.events : [],
    }));
  const status: Record<string, string> = {};
  for (const r of rows) if (r.name) status[r.name] = r.status || "Upcoming";
  return [
    { key: "vx_custom_meets", value: custom, updated_at },
    { key: "vx_meet_status", value: status, updated_at },
  ];
}

function svc() {
  return { apikey: SB_SERVICE, Authorization: "Bearer " + SB_SERVICE };
}

/** "preteam::r3" and "r3" both mean r3. The app stores the first, club_state uses the second. */
export function bareId(id: unknown): string {
  return String(id ?? "").split("::").pop() || "";
}

export function pickBySwimmer(value: unknown, mine: Set<string>): Json {
  const out: Json = {};
  if (!value || typeof value !== "object") return out;
  for (const [k, v] of Object.entries(value as Json)) {
    if (mine.has(bareId(k))) out[k] = v;
  }
  return out;
}

export function pickPeriodThenSwimmer(value: unknown, mine: Set<string>): Json {
  const out: Json = {};
  if (!value || typeof value !== "object") return out;
  for (const [period, inner] of Object.entries(value as Json)) {
    const kept = pickBySwimmer(inner, mine);
    if (Object.keys(kept).length) out[period] = kept;
  }
  return out;
}

/**
 * { edits:{sqid:{swid:patch}}, deleted:{sqid:{swid:true}}, added:{sqid:[{id,...}]} }
 *
 * All three parts are filtered to `mine`. The three keys are always present in the result, even
 * when empty: rebuildRoster() defends against a missing one, and a half-shaped document there is
 * a white screen on every device rather than a wrong roster.
 */
export function pickRosterDoc(value: unknown, mine: Set<string>): Json {
  const out: Json = { edits: {}, deleted: {}, added: {} };
  if (!value || typeof value !== "object") return out;
  const doc = value as Json;

  for (const part of ["edits", "deleted"] as const) {
    const kept: Json = {};
    const src = doc[part];
    if (src && typeof src === "object") {
      for (const [sqid, inner] of Object.entries(src as Json)) {
        const swimmers = pickBySwimmer(inner, mine);
        if (Object.keys(swimmers).length) kept[sqid] = swimmers;
      }
    }
    out[part] = kept;
  }

  const added: Json = {};
  const src = doc.added;
  if (src && typeof src === "object") {
    for (const [sqid, rows] of Object.entries(src as Json)) {
      if (!Array.isArray(rows)) continue;
      const kept = rows.filter((r) => mine.has(bareId((r as Json)?.id)));
      if (kept.length) added[sqid] = kept;
    }
  }
  out.added = added;

  return out;
}

export function pickArraysBySwId(value: unknown, mine: Set<string>): Json {
  const out: Json = {};
  if (!value || typeof value !== "object") return out;
  for (const [group, rows] of Object.entries(value as Json)) {
    if (!Array.isArray(rows)) continue;
    const kept = rows.filter((r) => mine.has(bareId((r as Json)?.swId ?? (r as Json)?.sw_id)));
    if (kept.length) out[group] = kept;
  }
  return out;
}

export async function GET(request: Request) {
  if (!haveService()) {
    return Response.json({ error: "server missing SUPABASE_SERVICE_ROLE_KEY" }, { status: 500 });
  }

  const who = await requireUser(request);
  if (!who.ok) return who.response;
  const email = who.caller.email;

  // Which children are theirs — read with the service key, from their own row only.
  const famRes = await fetch(
    `${SB_URL}/rest/v1/family_accounts?select=swimmer_ids&email=eq.${encodeURIComponent(email)}&limit=1`,
    { headers: svc(), cache: "no-store" },
  );
  if (!famRes.ok) {
    return Response.json({ error: "could not look up this account" }, { status: 502 });
  }
  const famRows = (await famRes.json().catch(() => null)) as Array<{ swimmer_ids?: unknown }> | null;
  if (!Array.isArray(famRows) || !famRows.length) {
    // A staff member calling this is not an error, but it is not what this route is for —
    // they read club_state directly and always will.
    return Response.json({ error: "this is for family accounts" }, { status: 403 });
  }

  const raw = famRows[0]?.swimmer_ids;
  const mine = new Set<string>(
    (Array.isArray(raw) ? raw : []).map(bareId).filter(Boolean),
  );

  const wanted = [
    ...CLUB_KEYS, ...PER_SWIMMER_KEYS, ...PERIOD_THEN_SWIMMER_KEYS, ...ARRAY_BY_SWID_KEYS,
    ...ROSTER_DOC_KEYS,
  ];
  const stateRes = await fetch(
    `${SB_URL}/rest/v1/club_state?select=key,value,updated_at&key=in.(${wanted.join(",")})`,
    { headers: svc(), cache: "no-store" },
  );
  if (!stateRes.ok) return Response.json({ error: "could not read the club record" }, { status: 502 });
  const rows = (await stateRes.json().catch(() => null)) as
    | Array<{ key: string; value: unknown; updated_at: string }>
    | null;
  if (!Array.isArray(rows)) return Response.json({ error: "could not read the club record" }, { status: 502 });

  // Same row shape the client's own pull() returns, so applyPull needs no special case.
  // The meets and their statuses left club_state for a table of their own (club_meets), because
  // the shared document is last-write-wins and a device replaying unsent writes put its whole
  // stale calendar back over a corrected date. A family still reads them the way it always has:
  // the two keys are rebuilt here from the table, so the portal needs no change and no parent
  // gets a direct read of the club's meets.
  const meetRows = await fetchMeets();
  const out = rows
    .map((r) => {
      if (CLUB_KEYS.includes(r.key)) return r;
      if (PER_SWIMMER_KEYS.includes(r.key)) return { ...r, value: pickBySwimmer(r.value, mine) };
      if (PERIOD_THEN_SWIMMER_KEYS.includes(r.key)) return { ...r, value: pickPeriodThenSwimmer(r.value, mine) };
      if (ARRAY_BY_SWID_KEYS.includes(r.key)) return { ...r, value: pickArraysBySwId(r.value, mine) };
      if (ROSTER_DOC_KEYS.includes(r.key)) return { ...r, value: pickRosterDoc(r.value, mine) };
      return null;   // unreachable — `wanted` is built from the five lists
    })
    .filter(Boolean);

  if (meetRows) out.push(...meetsAsClubStateRows(meetRows));

  return Response.json(
    { rows: out, swimmers: [...mine] },
    { headers: { "Cache-Control": "no-store" } },
  );
}
