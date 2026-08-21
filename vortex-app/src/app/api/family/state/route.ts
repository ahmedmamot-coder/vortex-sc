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
  "vx_custom_meets",
  "vx_meet_status",
  "vx_meet_events",
  "vx_meet_cuts",
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

type Json = Record<string, unknown>;

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
  const out = rows
    .map((r) => {
      if (CLUB_KEYS.includes(r.key)) return r;
      if (PER_SWIMMER_KEYS.includes(r.key)) return { ...r, value: pickBySwimmer(r.value, mine) };
      if (PERIOD_THEN_SWIMMER_KEYS.includes(r.key)) return { ...r, value: pickPeriodThenSwimmer(r.value, mine) };
      if (ARRAY_BY_SWID_KEYS.includes(r.key)) return { ...r, value: pickArraysBySwId(r.value, mine) };
      return null;   // unreachable — `wanted` is built from the four lists
    })
    .filter(Boolean);

  return Response.json(
    { rows: out, swimmers: [...mine] },
    { headers: { "Cache-Control": "no-store" } },
  );
}
