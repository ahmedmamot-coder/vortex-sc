// Server-side birthday logic — a faithful port of the date and roster maths that lives in
// public/proto.html (the app), so the automatic daily cron finds exactly the same birthdays the
// app would, and wishes them exactly once.
//
// Why this exists: the app only ever worked out whose birthday it is when a *staff* device opened
// it (see birthdayRun() in proto.html — it runs six seconds after load, once per staff session).
// If no coach opened the app on a child's birthday, nobody was wished. This module lets a Vercel
// cron do the same work on a schedule, with no phone required. It is pure and dependency-free so
// the port can be tested against the same cases the app's own reader is trusted on.
//
// The one reader for every date of birth. It takes ISO natively and refuses anything that is not a
// real calendar date, the club writes dates day-first (17/04/2017), and an American date the other
// way round (08/20/2014) is swapped back rather than dropped. This mirrors _dobParts() exactly.

export type DobParts = { y: number; mo: number; d: number; iso: string; label: string };

export function dobParts(v: unknown): DobParts | null {
  const t = String(v == null ? "" : v).trim();
  if (!t) return null;
  const p = t.split(/[/\-.]/);
  if (p.length !== 3) return null;
  let y: number, mo: number, d: number;
  if (p[0].length === 4) {
    y = +p[0];
    mo = +p[1];
    d = +p[2];
  } else {
    d = +p[0];
    mo = +p[1];
    y = +p[2];
  }
  // 08/20/2014 is the 20th of August, not month twenty. Read strictly, month 20 is not a date, so
  // those children simply had no birthday. A month above twelve cannot be a month; if the other
  // half can be, the two are the wrong way round. Where BOTH could be a month, leave them (dd/mm).
  if (mo > 12 && d >= 1 && d <= 12) {
    const t2 = d;
    d = mo;
    mo = t2;
  }
  if (!y || !mo || !d) return null;
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const b = new Date(y, mo - 1, d);
  if (b.getFullYear() !== y || b.getMonth() !== mo - 1 || b.getDate() !== d) return null; // 31/02 is nobody's birthday
  return {
    y,
    mo,
    d,
    iso: y + "-" + String(mo).padStart(2, "0") + "-" + String(d).padStart(2, "0"),
    label: String(d).padStart(2, "0") + "/" + String(mo).padStart(2, "0") + "/" + y,
  };
}

/** The full ISO date of birth, or null when there is no real date on file. */
export function bdayISO(dob: unknown): string | null {
  const p = dobParts(dob);
  return p ? p.iso : null;
}

// A swimmer born on 29 February has a birthday in three years out of four. Mark it on the 28th in a
// common year rather than skipping the child altogether. (Port of _bdayDateIn.)
export function bdayDateIn(year: number, md: string): Date {
  const mm = parseInt(md.slice(0, 2), 10);
  const dd = parseInt(md.slice(3, 5), 10);
  const d = new Date(year, mm - 1, dd);
  if (d.getMonth() !== mm - 1) d.setDate(0);
  return d;
}

/** Is `dob`'s birthday the calendar day `todayISO` (YYYY-MM-DD)? Port of _bdayIsToday. */
export function bdayIsToday(dob: unknown, todayISO: string): boolean {
  const iso = bdayISO(dob);
  if (!iso) return false;
  const md = iso.slice(5);
  const t = new Date(todayISO + "T00:00:00");
  const d = bdayDateIn(t.getFullYear(), md);
  return d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
}

/** The age reached on `onISO`, or null. Port of _bdayTurning. */
export function bdayTurning(dob: unknown, onISO: string): number | null {
  const b = bdayISO(dob);
  if (!b) return null;
  const on = new Date(onISO + "T00:00:00");
  let age = on.getFullYear() - parseInt(b.slice(0, 4), 10);
  const md = b.slice(5);
  if (bdayDateIn(on.getFullYear(), md) > on) age--; // hasn't come round yet this year
  return age >= 0 && age < 100 ? age : null;
}

/** Today's date (YYYY-MM-DD) in a given IANA time zone — the club runs on Doha time. */
export function todayISOInZone(tz: string, now?: Date): string {
  const d = now || new Date();
  // en-CA formats as YYYY-MM-DD, so the parts come out already in the shape we want.
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
}

// ---- Roster reconstruction -------------------------------------------------------------------
// The app's roster is the base seed (public/assets/roster.js → window.VX_ROSTER) with a single
// club_state document of edits laid over it (vx_roster_edits: { edits, deleted, added }). Dates of
// birth live entirely in that overlay — the base seed carries none. Squad names come from the base
// squads with the vx_squads overlay on top. This reproduces rebuildRoster()/_rebuildSquads() down
// to the fields a birthday needs: who the swimmer is, which squad, and their date of birth.

export type BaseSwimmer = { id?: string; name?: string; dob?: string; [k: string]: unknown };
export type BaseRoster = Record<string, BaseSwimmer[]>;
export type RosterEdits = {
  edits?: Record<string, Record<string, Record<string, unknown>>>;
  deleted?: Record<string, Record<string, boolean>>;
  added?: Record<string, Array<Record<string, unknown>>>;
};
export type SquadOverlay = {
  ovr?: Record<string, { name?: string }>;
  added?: Array<{ id?: string; name?: string }>;
  removed?: Record<string, boolean>;
  order?: string[];
};
export type Squad = { id: string; name: string };
export type FlatSwimmer = { id: string; name: string; squadId: string; squadName: string; dob: string };

// The nine squads the club started with. Kept in step with _baseSquads in proto.html — only id and
// name matter here, so that is all this carries.
export const BASE_SQUADS: Squad[] = [
  { id: "preteam", name: "Pre-Team" },
  { id: "advb", name: "Advanced B" },
  { id: "adva", name: "Advanced A" },
  { id: "junior", name: "Junior" },
  { id: "seniorb", name: "Senior B" },
  { id: "seniora", name: "Senior A" },
  { id: "vortexb", name: "Vortex B" },
  { id: "vortexa", name: "Vortex A" },
  { id: "legend", name: "Legend" },
];

export function buildSquads(squadEdits?: SquadOverlay | null): Squad[] {
  const e: SquadOverlay = squadEdits && typeof squadEdits === "object" ? squadEdits : {};
  const all: Squad[] = [
    ...BASE_SQUADS.map((s) => ({ ...s })),
    ...((e.added || []).filter((s) => s && s.id).map((s) => ({ id: String(s.id), name: String(s.name || s.id) })) as Squad[]),
  ].filter((s) => !(e.removed || {})[s.id]);
  all.forEach((s) => {
    const o = (e.ovr || {})[s.id];
    if (o && o.name) s.name = o.name;
  });
  return all;
}

// Fills gaps from every squad's edits for a swimmer, so a date typed before a move (filed under the
// squad they left) is still found. Port of _patchAnywhere.
function patchAnywhere(ed: RosterEdits): Record<string, Record<string, unknown>> {
  const idx: Record<string, Record<string, unknown>> = {};
  Object.keys(ed.edits || {}).forEach((sqid) => {
    const squad = (ed.edits || {})[sqid] || {};
    Object.keys(squad).forEach((id) => {
      const p = squad[id];
      if (!p || typeof p !== "object") return;
      idx[id] = idx[id] ? { ...(p as object), ...idx[id] } : { ...(p as object) };
    });
  });
  return idx;
}

/**
 * The whole club roster, one entry per swimmer, with the date of birth resolved the way the app
 * resolves it. Deduped by swimmer id — a swimmer who lingers in two squad overlays (an old move
 * that never recorded the removal) is one child with one birthday, not two.
 */
export function reconstructRoster(
  base: BaseRoster,
  squads: Squad[],
  rosterEdits?: RosterEdits | null,
): FlatSwimmer[] {
  const _e = rosterEdits;
  const ed: Required<RosterEdits> = {
    edits: {},
    deleted: {},
    added: {},
    ...(_e && typeof _e === "object" && !Array.isArray(_e) ? _e : {}),
  };
  if (!ed.edits || typeof ed.edits !== "object") ed.edits = {};
  if (!ed.deleted || typeof ed.deleted !== "object") ed.deleted = {};
  if (!ed.added || typeof ed.added !== "object") ed.added = {};

  const anywhere = patchAnywhere(ed);
  // The swimmer's current squad wins field by field; a squad they have left only fills blanks.
  const patchFor = (sqid: string, id: string): Record<string, unknown> | null => {
    const here = (ed.edits[sqid] || {})[id];
    const other = anywhere[id];
    return here && other ? { ...other, ...here } : here || other || null;
  };

  // Which squad an added swimmer really belongs to: the one moved to most recently. Port of the
  // addedHome pass in rebuildRoster.
  const addedHome: Record<string, { sq: string; rank: [number, number] }> = {};
  squads.forEach((sq) => {
    (ed.added[sq.id] || []).forEach((sw) => {
      if (!sw || !sw.id) return;
      const swid = String(sw.id);
      const at = typeof sw.movedAt === "number" ? (sw.movedAt as number) : 0;
      const left = !!(ed.deleted[sq.id] || {})[swid];
      const rank: [number, number] = [at, left ? 0 : 1];
      const cur = addedHome[swid];
      if (!cur || rank[0] > cur.rank[0] || (rank[0] === cur.rank[0] && rank[1] > cur.rank[1]))
        addedHome[swid] = { sq: sq.id, rank };
    });
  });

  const seen = new Set<string>();
  const out: FlatSwimmer[] = [];
  const nameOf = (sw: Record<string, unknown>): string => {
    const n = sw.name != null ? String(sw.name).trim() : "";
    if (n) return n;
    const first = sw.first != null ? String(sw.first) : "";
    const last = sw.last != null ? String(sw.last) : "";
    return (first + " " + last).trim();
  };
  const emit = (id: string, sw: Record<string, unknown>, sq: Squad) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({
      id,
      name: nameOf(sw),
      squadId: sq.id,
      squadName: sq.name,
      dob: sw.dob != null ? String(sw.dob) : "",
    });
  };

  squads.forEach((sq) => {
    (base[sq.id] || []).forEach((sw) => {
      if (!sw || !sw.id) return;
      const id = String(sw.id);
      if ((ed.deleted[sq.id] || {})[id]) return;
      const patch = patchFor(sq.id, id);
      emit(id, patch ? { ...sw, ...patch } : sw, sq);
    });
    (ed.added[sq.id] || []).forEach((sw) => {
      if (!sw) return;
      const id = sw.id != null ? String(sw.id) : "";
      // An added swimmer only counts under the squad they were most recently moved to.
      if (id && (addedHome[id] || {}).sq !== sq.id) return;
      const p = id ? patchFor(sq.id, id) : null;
      emit(id, p ? { ...p, ...sw } : sw, sq);
    });
  });

  return out;
}

/** Parse `window.VX_ROSTER={...};window.VX_MEETS=[...];` and hand back just the roster object. */
export function parseBaseRoster(js: string): BaseRoster {
  const marker = "window.VX_ROSTER=";
  const start = js.indexOf(marker);
  if (start < 0) return {};
  let i = start + marker.length;
  // Walk the balanced braces of the object literal so a "};" inside a string can never end it
  // early. The value is pure JSON, so quotes and escapes are all we have to respect.
  const open = js[i];
  if (open !== "{") return {};
  let depth = 0;
  let inStr = false;
  let esc = false;
  const from = i;
  for (; i < js.length; i++) {
    const c = js[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  try {
    return JSON.parse(js.slice(from, i)) as BaseRoster;
  } catch {
    return {};
  }
}

/**
 * The swimmers whose birthday is `todayISO` and who have a real date on file — deduped, and each
 * carrying the age they are turning. This is the list the cron wishes.
 */
export function birthdaysToday(roster: FlatSwimmer[], todayISO: string): Array<FlatSwimmer & { turning: number | null }> {
  return roster
    .filter((sw) => bdayIsToday(sw.dob, todayISO))
    .map((sw) => ({ ...sw, turning: bdayTurning(sw.dob, todayISO) }));
}
