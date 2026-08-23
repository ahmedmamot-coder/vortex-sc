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

const SQUADS = (rosterExport as { squads: RawSquad[] }).squads || [];

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

export function allSwimmers(): Swimmer[] {
  const out: Swimmer[] = [];
  for (const sq of SQUADS) {
    for (const s of sq.swimmers || []) {
      out.push({
        id: swimmerId(sq.slug, s),
        name: `${s.first} ${s.last}`.trim(),
        squad: sq.slug,
        squadName: sq.name,
        age: typeof s.age === "number" ? s.age : null,
        gender: s.gender || null,
      });
    }
  }
  return out;
}

export function squads() {
  return SQUADS.map((sq) => ({
    slug: sq.slug,
    name: sq.name,
    ageRange: sq.age_range || null,
    coach: sq.coach_name || null,
    swimmers: (sq.swimmers || []).length,
  }));
}

export function findSwimmers(query: string, limit = 10): Swimmer[] {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  return allSwimmers()
    .filter((s) => s.name.toLowerCase().includes(q))
    .slice(0, limit);
}

/** The raw PBs and results the roster carries for one swimmer. */
export function swimmerRecord(id: string): { swimmer: Swimmer; pbs: unknown[]; results: unknown[] } | null {
  for (const sq of SQUADS) {
    for (const s of sq.swimmers || []) {
      if (swimmerId(sq.slug, s) !== id) continue;
      return {
        swimmer: {
          id, name: `${s.first} ${s.last}`.trim(), squad: sq.slug, squadName: sq.name,
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

/** Map a bare or squad-qualified swimmer id to a display name, for rows that carry only an id. */
export function nameOf(swId: string): string {
  const bare = String(swId || "").split("::").pop() || "";
  const hit = allSwimmers().find((s) => s.id === swId || s.id.split("::").pop() === bare);
  return hit ? hit.name : swId;
}
