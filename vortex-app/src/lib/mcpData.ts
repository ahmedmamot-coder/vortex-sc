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

type RawSwimmer = { first: string; last: string; age?: number; gender?: string; pbs?: unknown[]; results?: unknown[] };
type RawSquad = { slug: string; name: string; age_range?: string; coach_name?: string; swimmers?: RawSwimmer[] };

export type Swimmer = { id: string; name: string; squad: string; squadName: string; age: number | null; gender: string | null };

const SQUADS = (rosterExport as { squads: RawSquad[] }).squads || [];

/** A swimmer's id as the rest of the app writes it: the squad slug and a slug of the name. */
function swimmerId(squadSlug: string, s: RawSwimmer): string {
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
