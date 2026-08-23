// The club, as the connector is allowed to see it.
//
// This is the boundary that matters. Everything reachable from here ends up in a Claude
// conversation, so what it can read is an allowlist, not a filter — a filter is something you
// forget to update when a column is added.
//
// NEVER exposed, and the reason each one is out:
//   swimmer_docs        birth certificates, passports, medical certificates. There is no question
//                       worth answering that needs these in a chat window.
//   dates of birth      identifying on their own, and the app only ever needs an age.
//   family_accounts     parents' names, emails, phone numbers.
//   family_messages     a private thread between a parent and a coach.
//   lounge_posts        members' own words, written to the club and not to us.
//   inbody / wellness   body composition and how a child says they feel. Coaching data about a
//                       minor's body, which stays in the app where consent was given for it.
//
// What IS exposed is the coaching and administrative picture: who is in which squad, who is
// turning up, what they swam, and what is owed. Names come with it, because "which swimmers
// missed training" is unanswerable without them and is the question this exists for.

import { SB_URL, SB_SERVICE } from "@/lib/wearable";
import rosterExport from "../../scripts/data/roster-export.json";

type RawSwimmer = { id?: string; first: string; last: string; age?: number; gender?: string; pbs?: unknown[]; results?: unknown[] };
type RawSquad = { slug: string; name: string; age_range?: string; coach_name?: string; swimmers?: RawSwimmer[] };

export type Swimmer = { id: string; name: string; squad: string; squadName: string; age: number | null; gender: string | null };

const BASE = (rosterExport as { squads: RawSquad[] }).squads || [];

/**
 * A swimmer's id, as the DATABASE writes it — "r3", not a slug of their name.
 *
 * This used to build `squad::first-last` and call it "the id the rest of the app writes", which
 * it never was. attendance_marks and invoices are keyed by the app's own roster ids, so nothing
 * built here could ever join against them: nameOf() fell through to printing the raw id, so
 * "who is missing training" answered with a column of "r222", and swimmer_progress matched no
 * marks at all and reported "no register taken for this swimmer" for children who had simply
 * been marked absent. A wrong answer given confidently, which is the one thing this connector
 * was supposed not to do.
 *
 * The ids live in scripts/data/roster-export.json now, joined from public/assets/roster.js,
 * which is where the app has always kept them. A swimmer without one — an export regenerated
 * by something that drops the field — falls back to the old slug so nothing throws, and the
 * "every swimmer carries the id the database knows them by" test fails loudly instead.
 */
function swimmerId(squadSlug: string, s: RawSwimmer): string {
  if (s.id) return s.id;
  const base = `${s.first} ${s.last}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${squadSlug}::${base}`;
}

// ------------------------------------------------------- the club as it is now, not as exported
//
// roster-export.json is a snapshot. The club has moved on from it: Pre-Team reads as 3 swimmers
// there while its register covers 36, because every squad move since the export lives in the
// club's own overlay and not in the file. Answering "how many swimmers are in Pre-Team" out of
// the snapshot is the same class of mistake as the ids were — a confident number that is not
// the club.
//
// The overlay is vx_roster_edits in club_state, and it is the same three parts the app itself
// merges in rebuildRoster(): `deleted` per squad, `edits` per squad per swimmer, and `added`
// per squad. A squad move is recorded as deleted-here plus added-there, which is why membership
// cannot be read off the base alone.

export type Patch = { name?: string; first?: string; last?: string; age?: number; gender?: string };
export type Edits = {
  edits: Record<string, Record<string, Patch>>;
  deleted: Record<string, Record<string, unknown>>;
  added: Record<string, RawSwimmer[]>;
};

/**
 * The club's roster overlay, or null if it could not be read.
 *
 * Null is not "there are no edits" — it is "we do not know", and the caller has to say so rather
 * than serve the snapshot as though it were the club.
 */
async function rosterEdits(): Promise<Edits | null> {
  const rows = await rest("club_state?select=key,value&key=eq.vx_roster_edits");
  if (!rows) return null;
  const raw = (rows[0] as { value?: unknown } | undefined)?.value;
  // An overlay written by an older build, or half written, can be missing a part. The app guards
  // this the same way: a missing `deleted` is not a wrong roster, it is every device crashing.
  const e = (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw as Partial<Edits> : {};
  const obj = <T,>(v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? v as T : {} as T);
  return {
    edits: obj<Edits["edits"]>(e.edits),
    deleted: obj<Edits["deleted"]>(e.deleted),
    added: obj<Edits["added"]>(e.added),
  };
}

/** A swimmer's edits filed under any squad — a rename typed before a move stays under the old one. */
function patchAnywhere(ed: Edits): Record<string, Patch> {
  const out: Record<string, Patch> = {};
  for (const bySwimmer of Object.values(ed.edits)) {
    for (const [id, patch] of Object.entries(bySwimmer || {})) out[id] = { ...out[id], ...patch };
  }
  return out;
}

function applyPatch(s: RawSwimmer, patch?: Patch): RawSwimmer {
  if (!patch) return s;
  const out: RawSwimmer = { ...s, ...patch };
  // The app stores a rename as one `name`; first and last are what everything else reads.
  if (patch.name) {
    const parts = patch.name.trim().split(/\s+/);
    out.first = parts[0] || s.first;
    out.last = parts.slice(1).join(" ") || s.last;
  }
  return out;
}

function fullName(s: RawSwimmer): string {
  return `${s.first || ""} ${s.last || ""}`.trim();
}

export type Roster = {
  /** Squad membership as it stands, once the club's own edits are applied. */
  squads: RawSquad[];
  /** False when the overlay could not be read and these are the bundled snapshot's squads. */
  live: boolean;
  /**
   * Every id ever seen, base and added alike, mapped to a name.
   *
   * Deliberately a superset of current membership. attendance_marks and invoices keep rows for
   * swimmers who have since left, and resolving those to an id again — after the whole point of
   * the last fix was that they resolve to children — would be a quiet regression.
   */
  names: Map<string, string>;
};

/**
 * The snapshot with the club's edits applied — pure, so the merge can be tested without a
 * database. Squad moves, departures, additions and renames all land here, and each one of them
 * is a way the exported file and the club disagree.
 */
export function mergeRoster(base: RawSquad[], ed: Edits): RawSquad[] {
  const anywhere = patchAnywhere(ed);
  const patchFor = (slug: string, id: string): Patch | undefined => {
    const here = (ed.edits[slug] || {})[id];
    const other = anywhere[id];
    return (here && other) ? { ...other, ...here } : (here || other);
  };

  const merged: RawSquad[] = base.map((sq) => {
    const gone = ed.deleted[sq.slug] || {};
    const kept = (sq.swimmers || [])
      .filter((s) => !gone[swimmerId(sq.slug, s)])
      .map((s) => applyPatch(s, patchFor(sq.slug, swimmerId(sq.slug, s))));
    // A swimmer the club added carries their whole record; an edit typed for them before a move
    // is filed under the squad they left, so the patch goes on underneath rather than over.
    const added = (ed.added[sq.slug] || [])
      .filter((s) => s && s.id && !gone[s.id])
      .map((s) => applyPatch(s, patchFor(sq.slug, s.id as string)));
    return { ...sq, swimmers: [...kept, ...added] };
  });
  return merged;
}

export async function loadRoster(): Promise<Roster> {
  // Base names first, and never removed: a swimmer who has left the club still has marks and
  // invoices with their id on them, and those rows should name a child, not an id.
  const names = new Map<string, string>();
  for (const sq of BASE) {
    for (const s of sq.swimmers || []) names.set(swimmerId(sq.slug, s), fullName(s));
  }

  const ed = await rosterEdits();
  if (!ed) return { squads: BASE, live: false, names };

  const merged = mergeRoster(BASE, ed);
  for (const sq of merged) {
    for (const s of sq.swimmers || []) names.set(swimmerId(sq.slug, s), fullName(s));
  }
  return { squads: merged, live: true, names };
}

export function allSwimmers(roster: Roster): Swimmer[] {
  const out: Swimmer[] = [];
  for (const sq of roster.squads) {
    for (const s of sq.swimmers || []) {
      out.push({
        id: swimmerId(sq.slug, s),
        name: fullName(s),
        squad: sq.slug,
        squadName: sq.name,
        age: typeof s.age === "number" ? s.age : null,
        gender: s.gender || null,
      });
    }
  }
  return out;
}

export function squads(roster: Roster) {
  return roster.squads.map((sq) => ({
    slug: sq.slug,
    name: sq.name,
    ageRange: sq.age_range || null,
    coach: sq.coach_name || null,
    swimmers: (sq.swimmers || []).length,
  }));
}

export function findSwimmers(roster: Roster, query: string, limit = 10): Swimmer[] {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  return allSwimmers(roster)
    .filter((s) => s.name.toLowerCase().includes(q))
    .slice(0, limit);
}

/** The raw PBs and results the roster carries for one swimmer. */
export function swimmerRecord(roster: Roster, id: string): { swimmer: Swimmer; pbs: unknown[]; results: unknown[] } | null {
  for (const sq of roster.squads) {
    for (const s of sq.swimmers || []) {
      if (swimmerId(sq.slug, s) !== id) continue;
      return {
        swimmer: {
          id, name: fullName(s), squad: sq.slug, squadName: sq.name,
          age: typeof s.age === "number" ? s.age : null, gender: s.gender || null,
        },
        pbs: s.pbs || [],
        results: s.results || [],
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------- the database side

async function rest(path: string): Promise<unknown[] | null> {
  if (!SB_SERVICE) return null;
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_SERVICE, Authorization: "Bearer " + SB_SERVICE },
    cache: "no-store",
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  return Array.isArray(j) ? j : null;
}

export type Mark = { squad_id: string; day: string; sw_id: string; status: string };

/** Attendance rows for a squad (or all squads) between two yyyy-mm-dd days, inclusive. */
export async function attendance(from: string, to: string, squad?: string): Promise<Mark[] | null> {
  const qs = [
    "select=squad_id,day,sw_id,status",
    `day=gte.${encodeURIComponent(from)}`,
    `day=lte.${encodeURIComponent(to)}`,
    squad ? `squad_id=eq.${encodeURIComponent(squad)}` : "",
    "limit=20000",
  ].filter(Boolean).join("&");
  return (await rest(`attendance_marks?${qs}`)) as Mark[] | null;
}

export type Invoice = { id: string; sw_id: string; sq_id: string | null; period: string; total: number; status: string; due: string | null };

export async function invoices(period?: string, status?: string): Promise<Invoice[] | null> {
  const qs = [
    "select=id,sw_id,sq_id,period,total,status,due",
    period ? `period=eq.${encodeURIComponent(period)}` : "",
    status ? `status=eq.${encodeURIComponent(status)}` : "",
    "order=period.desc",
    "limit=5000",
  ].filter(Boolean).join("&");
  return (await rest(`invoices?${qs}`)) as Invoice[] | null;
}

/**
 * Map a bare or squad-qualified swimmer id to a display name, for rows that carry only an id.
 *
 * Resolved against every id the roster has ever carried, not just current membership: the marks
 * and invoices this names include swimmers who have since left the club, and printing "r222" for
 * them again would undo the fix that made this column readable in the first place.
 */
export function nameOf(roster: Roster, swId: string): string {
  const bare = String(swId || "").split("::").pop() || "";
  return roster.names.get(swId) || roster.names.get(bare) || swId;
}
