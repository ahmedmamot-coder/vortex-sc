/**
 * Generates a plain-SQL seed file from scripts/data/roster-export.json so the
 * roster can be loaded by pasting into the Supabase SQL Editor (no network from
 * this environment required). Emits deterministic UUIDs so PBs/results link up.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

type RawSwimmer = {
  first: string;
  last: string;
  age: number;
  gender: "Girls" | "Boys";
  pbs: { event: string; sec: number; time: string; drop: string; course: "L" | "S" }[];
  results: { meet: string; date: string; event: string; time: string; sec: number | null; place: number | null; course: "L" | "S" }[];
};
type RawSquad = {
  slug: string; name: string; age_range: string; coach_name: string;
  assistant_coach_name: string | null; accent_color: string; sort_order: number;
  swimmers: RawSwimmer[];
};
type ExportShape = { squads: RawSquad[]; meets: { name: string; date: string; course: "L" | "S" }[] };

const q = (s: string | null) => (s == null ? "null" : `'${s.replace(/'/g, "''")}'`);
const n = (v: number | null) => (v == null ? "null" : String(v));
const isoDate = (mdY: string) => {
  const [m, d, y] = mdY.split("/").map(Number);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

const raw: ExportShape = JSON.parse(
  fs.readFileSync(path.join(__dirname, "data", "roster-export.json"), "utf8"),
);

const lines: string[] = [];
lines.push("-- Vortex SC roster seed. Paste into the Supabase SQL Editor and Run.");
lines.push("-- Safe to run once on the empty schema created by combined_setup.sql.");
lines.push("begin;");

// Squads
const squadId = new Map<string, string>();
lines.push("\ninsert into squads (id, slug, name, age_range, coach_name, assistant_coach_name, accent_color, sort_order) values");
lines.push(
  raw.squads
    .map((s) => {
      const id = randomUUID();
      squadId.set(s.slug, id);
      return `  ('${id}', ${q(s.slug)}, ${q(s.name)}, ${q(s.age_range)}, ${q(s.coach_name)}, ${q(s.assistant_coach_name)}, ${q(s.accent_color)}, ${s.sort_order})`;
    })
    .join(",\n") + ";",
);

// Meets
const meetId = new Map<string, string>();
lines.push("\ninsert into meets (id, name, meet_date, course, status) values");
lines.push(
  raw.meets
    .map((m) => {
      const id = randomUUID();
      meetId.set(`${m.name}|${m.date}|${m.course}`, id);
      return `  ('${id}', ${q(m.name)}, '${isoDate(m.date)}', '${m.course}', 'completed')`;
    })
    .join(",\n") + ";",
);

// Swimmers + PBs + results
const swimmerRows: string[] = [];
const pbRows: string[] = [];
const resultRows: string[] = [];

for (const sq of raw.squads) {
  const sid = squadId.get(sq.slug)!;
  for (const sw of sq.swimmers) {
    const id = randomUUID();
    swimmerRows.push(
      `  ('${id}', '${sid}', ${q(sw.first)}, ${q(sw.last)}, ${sw.age}, '${sw.gender}')`,
    );
    for (const pb of sw.pbs) {
      pbRows.push(
        `  ('${id}', ${q(pb.event)}, '${pb.course}', ${pb.sec}, ${q(pb.time)}, ${q(pb.drop || "")})`,
      );
    }
    for (const r of sw.results) {
      const mid = meetId.get(`${r.meet}|${r.date}|${r.course}`);
      if (!mid) continue;
      resultRows.push(
        `  ('${mid}', '${id}', ${q(r.event)}, '${r.course}', ${n(r.sec)}, ${q(r.time)}, ${n(r.place)})`,
      );
    }
  }
}

function emitBatched(header: string, rows: string[], chunk = 200) {
  for (let i = 0; i < rows.length; i += chunk) {
    lines.push("\n" + header);
    lines.push(rows.slice(i, i + chunk).join(",\n") + ";");
  }
}

emitBatched("insert into swimmers (id, squad_id, first_name, last_name, age, gender) values", swimmerRows);
emitBatched("insert into personal_bests (swimmer_id, event, course, seconds, time_text, drop_text) values", pbRows);
emitBatched("insert into meet_results (meet_id, swimmer_id, event, course, seconds, time_text, place) values", resultRows);

lines.push("\ncommit;");
lines.push(
  `\n-- Seeded: ${raw.squads.length} squads, ${swimmerRows.length} swimmers, ${raw.meets.length} meets, ${pbRows.length} PBs, ${resultRows.length} results.`,
);

const out = path.join(__dirname, "..", "supabase", "seed_data.sql");
fs.writeFileSync(out, lines.join("\n"));
console.log(`Wrote ${out}`);
console.log(`${raw.squads.length} squads, ${swimmerRows.length} swimmers, ${raw.meets.length} meets, ${pbRows.length} PBs, ${resultRows.length} results`);
