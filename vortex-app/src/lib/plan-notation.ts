/**
 * Coach's-notation parsing for the session plan builder (Option A).
 *
 * A coach types a set the way they'd write it on a whiteboard —
 *   "8x100 free en2 fins @1:30 descend"
 * — and this turns it into the structured fields plan_sets stores. Everything is
 * best-effort: whatever a token is not recognised as stays in the description, so
 * nothing a coach types is ever silently dropped.
 */

export interface ParsedNotation {
  reps: number;
  distance: number; // total metres for the whole set (reps × per-rep)
  stroke: string | null;
  zone: string | null;
  set_types: string[];
  equipment: string[];
  focus: string[];
  rest: string;
  description: string;
}

const STROKES: [RegExp, string][] = [
  [/^(free|fr|freestyle)$/, "Free"],
  [/^(fly|fl|butterfly)$/, "Fly"],
  [/^(back|bk|backstroke)$/, "BK"],
  [/^(breast|br|brs|breaststroke)$/, "BR"],
  [/^(im|medley)$/, "IM"],
  [/^(choice|ch)$/, "Choice"],
];

const EQUIPMENT: [RegExp, string][] = [
  [/^fins?$/, "Fins"],
  [/^(paddles?|pad)$/, "Paddles"],
  [/^(buoy|pullbuoy|pb)$/, "Pull buoy"],
  [/^(kickboard|board|kb)$/, "Kickboard"],
  [/^snorkel$/, "Snorkel"],
  [/^band$/, "Band"],
];

const TYPES: [RegExp, string][] = [
  [/^swim$/, "Swim"],
  [/^drill$/, "Drill"],
  [/^kick$/, "Kick"],
  [/^pull$/, "Pull"],
  [/^scull$/, "Scull"],
];

const FOCUS: [RegExp, string][] = [
  [/^(descend|desc|dsc)$/, "Descend"],
  [/^(ascend|asc)$/, "Ascend"],
  [/^build$/, "Build"],
  [/^(negsplit|neg|negative)$/, "Neg split"],
  [/^dps$/, "DPS"],
  [/^(strokecount|strokes|sc)$/, "Stroke count"],
  [/^sprint$/, "Sprint"],
  [/^(underwater|uw|under)$/, "Underwater"],
];

const ZONE = /^(en1|en2|en3|sp1|sp2|sp3)$/;

function match(table: [RegExp, string][], token: string): string | null {
  for (const [re, value] of table) if (re.test(token)) return value;
  return null;
}

/** Per-rep distance for display: total split across reps, rounded. */
export function perRepDistance(distance: number, reps: number): number {
  return reps > 1 ? Math.round(distance / reps) : distance;
}

export function parseSetNotation(raw: string): ParsedNotation {
  const out: ParsedNotation = {
    reps: 1,
    distance: 0,
    stroke: null,
    zone: null,
    set_types: [],
    equipment: [],
    focus: [],
    rest: "",
    description: "",
  };
  if (!raw || !raw.trim()) return out;

  // Glue "8 x 100" into "8x100" so reps read as one token, then pull the rest/
  // send-off out of the string before it is split into words.
  let text = raw.replace(/(\d)\s*[x×*]\s*(\d)/g, "$1x$2");

  const sendoff = text.match(/@\s*(\d{1,2}:\d{2}|\d{1,3})/);
  if (sendoff) {
    out.rest = "@" + sendoff[1];
    text = text.replace(sendoff[0], " ");
  } else {
    const rest = text.match(/\b(?:rest|r)\s*(\d{1,2}:\d{2}|\d{1,3})\b/i);
    if (rest) {
      out.rest = rest[1].includes(":") ? rest[1] : `0:${rest[1].padStart(2, "0")}`;
      text = text.replace(rest[0], " ");
    }
  }

  let repsFound = false;
  let distanceFound = false;
  const leftover: string[] = [];

  for (const original of text.split(/\s+/)) {
    if (!original) continue;
    const token = original.replace(/[,.;]+$/, "").toLowerCase();
    if (!token) continue;

    const reps = token.match(/^(\d+)x(\d+)m?$/);
    if (reps && !repsFound) {
      out.reps = Number(reps[1]);
      out.distance = Number(reps[1]) * Number(reps[2]);
      repsFound = true;
      distanceFound = true;
      continue;
    }
    const dist = token.match(/^(\d+)m?$/);
    if (dist && !distanceFound) {
      out.distance = Number(dist[1]);
      distanceFound = true;
      continue;
    }

    const stroke = match(STROKES, token);
    if (stroke && !out.stroke) {
      out.stroke = stroke;
      continue;
    }
    const type = match(TYPES, token);
    if (type) {
      if (!out.set_types.includes(type)) out.set_types.push(type);
      continue;
    }
    const equip = match(EQUIPMENT, token);
    if (equip) {
      if (!out.equipment.includes(equip)) out.equipment.push(equip);
      continue;
    }
    const focus = match(FOCUS, token);
    if (focus) {
      if (!out.focus.includes(focus)) out.focus.push(focus);
      continue;
    }
    if (ZONE.test(token) && !out.zone) {
      out.zone = token.toUpperCase();
      continue;
    }
    leftover.push(original);
  }

  out.description = leftover.join(" ").trim();
  return out;
}

/** A short, human label for a set — used as the default favourite name. */
export function describeSet(set: {
  reps: number;
  distance: number;
  stroke: string | null;
}): string {
  const per = perRepDistance(set.distance, set.reps);
  const head = set.reps > 1 ? `${set.reps} × ${per}` : `${set.distance}`;
  return `${head}m${set.stroke ? " " + set.stroke : ""}`.trim();
}
