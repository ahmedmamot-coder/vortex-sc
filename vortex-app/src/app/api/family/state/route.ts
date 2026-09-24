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
 * A flat array of rows, each naming one swimmer: [ { id, swId, meetName, event, status } ].
 *
 * vx_event_requests is the races a family has asked the coach for, and it is the one list in
 * this route a family WRITES as well as reads — club_state's policy pins a non-staff write to
 * exactly this key and vx_notifications. Withholding it was not a smaller risk than sending it,
 * it was a different one: the portal showed every request as "Pending" for ever, because the
 * only copy of the answer was on the coach's device, and a parent who could not see that a race
 * had been approved asked for it again.
 *
 * Cut to this family's children like everything else. Which races another child has asked for is
 * exactly the kind of thing this route exists to keep off a stranger's phone.
 */
const FLAT_ARRAY_BY_SWID_KEYS = ["vx_event_requests"];

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
 * nobody else's, in all three parts of the document. Everybody else's SWIMS ride along too, cut
 * to public fields only: see pickRosterDocForFamily().
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

type SharePlan = {
  _slot?: string;
  _time?: string;
  _pub?: boolean;
  _shareAll?: boolean;
  _shareIds?: unknown[];
} & Record<string, unknown>;

type PlanRow = {
  id?: string;
  squad_id?: string;
  title?: string;
  zone?: string;
  total_m?: number;
  total_exs?: number;
  sday?: string;
  plan?: SharePlan;
  ts?: number;
};

/**
 * Is a published session visible to THIS family's children?
 *
 * A coach shares a session with the whole squad (`_shareAll`) or with specific swimmers
 * (`_shareIds`). A session published before selective sharing existed carries neither field and
 * stays visible to the whole squad — the same grandfathering the client's `_shareVisible` applies.
 * Unpublished drafts (`_pub` falsy) never reach a family.
 */
export function sharedWithFamily(plan: SharePlan | undefined, mine: Set<string>): boolean {
  if (!plan || !plan._pub) return false;
  if (plan._shareAll) return true;
  const ids = plan._shareIds;
  if (!Array.isArray(ids) || !ids.length) return true; // legacy published = whole squad
  return ids.some((id) => mine.has(bareId(id)));
}

/** The club's saved training sessions, one row each. Null when the table cannot be read, so the
 *  caller can leave the key out rather than send an empty document that would wipe the portal. */
async function fetchPlans(): Promise<PlanRow[] | null> {
  try {
    const r = await fetch(SB_URL + "/rest/v1/plan_sessions?select=*&order=ts.desc&limit=500", {
      headers: svc(),
      cache: "no-store",
    });
    if (!r.ok) return null;
    const rows = (await r.json().catch(() => null)) as PlanRow[] | null;
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

/**
 * Back into the shape the app reads at `savedPlans` (and re-hydrates from the `vx_saved_plans`
 * key): a map of squad id → its sessions, matching the client's own `_plansFetch` grouping.
 *
 * Only sessions SHARED WITH THIS FAMILY'S CHILDREN are returned — published, and either shared
 * with the whole squad or with a swimmer of theirs (see sharedWithFamily). A coach's unpublished
 * draft, or a session shared only with other swimmers, never reaches them. Sessions carry no
 * personal data (distances, sets, rest, equipment, a zone).
 */
export function plansAsClubStateRow(rows: PlanRow[], mine: Set<string>) {
  const at = rows.reduce((a, r) => (r.ts && r.ts > a ? r.ts : a), 0);
  const updated_at = at ? new Date(at).toISOString() : new Date().toISOString();
  const grouped: Record<string, unknown[]> = {};
  for (const r of rows) {
    const plan = r.plan || {};
    if (!sharedWithFamily(plan, mine)) continue;
    const sq = r.squad_id || "?";
    (grouped[sq] = grouped[sq] || []).push({
      id: r.id,
      date: r.sday || "",
      title: r.title || "Session",
      zone: r.zone || "",
      totalM: r.total_m || 0,
      slot: plan._slot || "",
      time: plan._time || "",
      pub: true,
      plan,
    });
  }
  return { key: "vx_saved_plans", value: grouped, updated_at };
}

/** The club's fitness/dryland sessions, one row each. Null when the table cannot be read. */
async function fetchFitPlans(): Promise<PlanRow[] | null> {
  try {
    const r = await fetch(SB_URL + "/rest/v1/fitness_sessions?select=*&order=ts.desc&limit=500", {
      headers: svc(),
      cache: "no-store",
    });
    if (!r.ok) return null;
    const rows = (await r.json().catch(() => null)) as PlanRow[] | null;
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

/**
 * Fitness sessions in the shape the app re-hydrates from `vx_fit_saved` (a map of squad id → its
 * sessions, matching the client's `_fitSessFetch` grouping). Same sharing rule as swim plans:
 * shared with this family's children only.
 */
export function fitPlansAsClubStateRow(rows: PlanRow[], mine: Set<string>) {
  const at = rows.reduce((a, r) => (r.ts && r.ts > a ? r.ts : a), 0);
  const updated_at = at ? new Date(at).toISOString() : new Date().toISOString();
  const grouped: Record<string, unknown[]> = {};
  for (const r of rows) {
    const plan = r.plan || {};
    if (!sharedWithFamily(plan, mine)) continue;
    const sq = r.squad_id || "?";
    (grouped[sq] = grouped[sq] || []).push({
      id: r.id,
      date: r.sday || "",
      title: r.title || "Session",
      totalEx: r.total_exs || 0,
      slot: plan._slot || "",
      time: plan._time || "",
      pub: true,
      plan,
    });
  }
  return { key: "vx_fit_saved", value: grouped, updated_at };
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
 * { edits:{sqid:{swid:patch}}, deleted:{sqid:{swid:true}}, added:{sqid:[{id,...}]},
 *   removed:{swid:true} }
 *
 * Every part is filtered to `mine`. The core keys are always present in the result, even when
 * empty: rebuildRoster() defends against a missing one, and a half-shaped document there is a
 * white screen on every device rather than a wrong roster. `removed` rides along so a parent whose
 * child the club deleted stops seeing them, the same as staff do.
 */
export function pickRosterDoc(value: unknown, mine: Set<string>): Json {
  const out: Json = { edits: {}, deleted: {}, added: {}, removed: {} };
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

  // Deleted-from-the-club tombstones, keyed by swimmer id — same shape as pickBySwimmer handles.
  out.removed = pickBySwimmer(doc.removed, mine);

  return out;
}

/**
 * Everybody else's swims, for the club's results and records.
 *
 * The club asked for families to see every meet result, not only their own child's. The base
 * roster (public/assets/roster.js) already ships every swimmer's name, age, gender and results to
 * every device, so the club's results were never the private part of the overlay. What the overlay
 * adds is the newer ones: every meet imported since roster.js was generated lives only here, so a
 * family's "Club results" stopped at 20 August for everybody but their own child.
 *
 * So the overlay is sent for everybody, BUT ONLY THROUGH AN ALLOWLIST — the same fields roster.js
 * already makes public, and the fields of a swim. A date of birth never leaves: it is used here to
 * stamp each swim with the swimmer's age that day (`ageAt`) and each club meet with it
 * (`ageAtMeet`), so records land in the same age band as they do for coaches, without the device
 * ever holding the date. Anything added to a swimmer next year is not sent, by default.
 */
const PUBLIC_SWIMMER_FIELDS = [
  "id", "first", "last", "name", "initials", "age", "gender",
  "results", "entries", "pbs", "meets", "meetCount", "topEvent", "topTime", "topSec",
  "movedAt",   // which squad a swimmer moved to last: rebuildRoster() files them by it
];
const PUBLIC_SWIM_FIELDS = [
  "meet", "date", "meetDate", "event", "time", "sec", "place", "course", "courseLabel",
  "splits", "relay", "dq", "valid", "drop",
];
const SWIM_LIST_FIELDS = new Set(["results", "entries", "pbs"]);

/** The app's _dobParts(): yyyy-mm-dd, or dd/mm/yyyy with an impossible month swapped back. */
export function dobParts(v: unknown): { y: number; mo: number; d: number } | null {
  const t = String(v ?? "").trim();
  if (!t) return null;
  const p = t.split(/[/\-.]/);
  if (p.length !== 3) return null;
  let y: number, mo: number, d: number;
  if (p[0].length === 4) { y = +p[0]; mo = +p[1]; d = +p[2]; }
  else { d = +p[0]; mo = +p[1]; y = +p[2]; }
  if (mo > 12 && d >= 1 && d <= 12) { const t2 = d; d = mo; mo = t2; }
  if (!y || !mo || !d || mo > 12 || d > 31) return null;
  return { y, mo, d };
}

/** The app's _toISODate() for the shapes a swim's date is stored in: ISO, or M/D/YYYY. */
export function swimISO(v: unknown): string {
  const t = String(v ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const us = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return "";
}

/** The app's _ageOnDate(): whole years on that day, or null. */
export function ageOn(dob: unknown, iso: string): number | null {
  const p = dobParts(dob);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!p || !m) return null;
  let a = +m[1] - p.y;
  if (+m[2] < p.mo || (+m[2] === p.mo && +m[3] < p.d)) a--;
  return a >= 0 && a < 120 ? a : null;
}

function publicSwim(swim: unknown, dob: unknown, meetDates: Map<string, string>): Json | null {
  if (!swim || typeof swim !== "object") return null;
  const src = swim as Json;
  const out: Json = {};
  for (const f of PUBLIC_SWIM_FIELDS) if (src[f] !== undefined) out[f] = src[f];
  const iso = swimISO(src.meetDate) || swimISO(src.date) || meetDates.get(String(src.meet ?? "").trim()) || "";
  const a = ageOn(dob, iso);
  if (a != null) out.ageAt = a;
  return out;
}

/** One swimmer (a patch or a whole row) cut to what roster.js already makes public. */
export function publicSwimmer(row: unknown, meetDates: Map<string, string>): Json {
  const out: Json = {};
  if (!row || typeof row !== "object") return out;
  const src = row as Json;
  for (const f of PUBLIC_SWIMMER_FIELDS) {
    if (src[f] === undefined) continue;
    out[f] = SWIM_LIST_FIELDS.has(f) && Array.isArray(src[f])
      ? (src[f] as unknown[]).map((s) => publicSwim(s, src.dob, meetDates)).filter(Boolean)
      : src[f];
  }
  if (dobParts(src.dob) && meetDates.size) {
    const byMeet: Json = {};
    for (const [name, iso] of meetDates) { const a = ageOn(src.dob, iso); if (a != null) byMeet[name] = a; }
    out.ageAtMeet = byMeet;
  }
  return out;
}

/**
 * The roster document for a family: their own children whole (pickRosterDoc), everybody else
 * through publicSwimmer(). Squad moves (deleted / added / removed) go to everyone, so a swimmer
 * who changed squad is filed under the squad they are in now — squad membership is on roster.js
 * already, and a swim credited to the wrong squad is its own kind of wrong.
 */
export function pickRosterDocForFamily(value: unknown, mine: Set<string>, meetDates: Map<string, string>): Json {
  const out = pickRosterDoc(value, mine);
  if (!value || typeof value !== "object") return out;
  const doc = value as Json;
  const others = (id: unknown) => !mine.has(bareId(id));

  const edits = out.edits as Json;
  if (doc.edits && typeof doc.edits === "object") {
    for (const [sqid, inner] of Object.entries(doc.edits as Json)) {
      if (!inner || typeof inner !== "object") continue;
      for (const [swid, patch] of Object.entries(inner as Json)) {
        if (!others(swid)) continue;
        const kept = publicSwimmer(patch, meetDates);
        // A patch that is only a date of birth still carries the ages it implies.
        if (Object.keys(kept).length) ((edits[sqid] ||= {}) as Json)[swid] = kept;
      }
    }
  }
  const deleted = out.deleted as Json;
  if (doc.deleted && typeof doc.deleted === "object") {
    for (const [sqid, inner] of Object.entries(doc.deleted as Json)) {
      if (!inner || typeof inner !== "object") continue;
      for (const [swid, v] of Object.entries(inner as Json)) {
        if (others(swid)) ((deleted[sqid] ||= {}) as Json)[swid] = v === true ? true : !!v;
      }
    }
  }
  const added = out.added as Json;
  if (doc.added && typeof doc.added === "object") {
    for (const [sqid, rows] of Object.entries(doc.added as Json)) {
      if (!Array.isArray(rows)) continue;
      const kept = rows.filter((r) => others((r as Json)?.id)).map((r) => publicSwimmer(r, meetDates));
      if (kept.length) added[sqid] = [...((added[sqid] as unknown[]) || []), ...kept];
    }
  }
  const removed = out.removed as Json;
  if (doc.removed && typeof doc.removed === "object") {
    for (const [swid, v] of Object.entries(doc.removed as Json)) if (others(swid)) removed[swid] = !!v;
  }
  return out;
}

/** meet name → ISO date, from the club's meets table. */
export function meetDateMap(rows: MeetRow[] | null): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows || []) {
    const iso = swimISO(r.meet_date);
    if (r.name && iso) m.set(String(r.name).trim(), iso);
  }
  return m;
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

export function pickFlatArrayBySwId(value: unknown, mine: Set<string>): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.filter((r) => mine.has(bareId((r as Json)?.swId ?? (r as Json)?.sw_id)));
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
    ...FLAT_ARRAY_BY_SWID_KEYS, ...ROSTER_DOC_KEYS,
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
  const [meetRows, planRows, fitRows] = await Promise.all([fetchMeets(), fetchPlans(), fetchFitPlans()]);
  const meetDates = meetDateMap(meetRows);
  const out = rows
    .map((r) => {
      if (CLUB_KEYS.includes(r.key)) return r;
      if (PER_SWIMMER_KEYS.includes(r.key)) return { ...r, value: pickBySwimmer(r.value, mine) };
      if (PERIOD_THEN_SWIMMER_KEYS.includes(r.key)) return { ...r, value: pickPeriodThenSwimmer(r.value, mine) };
      if (ARRAY_BY_SWID_KEYS.includes(r.key)) return { ...r, value: pickArraysBySwId(r.value, mine) };
      if (FLAT_ARRAY_BY_SWID_KEYS.includes(r.key)) return { ...r, value: pickFlatArrayBySwId(r.value, mine) };
      if (ROSTER_DOC_KEYS.includes(r.key)) return { ...r, value: pickRosterDocForFamily(r.value, mine, meetDates) };
      return null;   // unreachable — `wanted` is built from the six lists
    })
    .filter(Boolean);

  if (meetRows) out.push(...meetsAsClubStateRows(meetRows));
  if (planRows) out.push(plansAsClubStateRow(planRows, mine));
  if (fitRows) out.push(fitPlansAsClubStateRow(fitRows, mine));

  return Response.json(
    { rows: out, swimmers: [...mine] },
    { headers: { "Cache-Control": "no-store" } },
  );
}
