/**
 * Seeds a fresh Supabase project with the real Vortex SC roster:
 * 9 squads, 272 swimmers, their personal bests, 10 real meets and
 * every recorded meet result.
 *
 * Usage:
 *   1. Copy .env.local.example to .env.local and fill in the three
 *      Supabase values (Settings -> API in the dashboard).
 *   2. Run the SQL in supabase/migrations/0001_init.sql once, in the
 *      Supabase SQL editor.
 *   3. npx tsx scripts/seed.ts
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";

config({ path: path.join(__dirname, "..", ".env.local") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local — see the header of this file.",
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

type RawSwimmer = {
  first: string;
  last: string;
  age: number;
  gender: "Girls" | "Boys";
  pbs: { event: string; sec: number; time: string; drop: string; course: "L" | "S" }[];
  results: {
    meet: string;
    date: string;
    event: string;
    time: string;
    sec: number | null;
    place: number | null;
    course: "L" | "S";
  }[];
};

type RawSquad = {
  slug: string;
  name: string;
  age_range: string;
  coach_name: string;
  assistant_coach_name: string | null;
  accent_color: string;
  sort_order: number;
  swimmers: RawSwimmer[];
};

type ExportShape = {
  squads: RawSquad[];
  meets: { name: string; date: string; course: "L" | "S" }[];
};

function toIsoDate(mmddyyyy: string): string {
  const [m, d, y] = mmddyyyy.split("/").map(Number);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

async function main() {
  const raw: ExportShape = JSON.parse(
    fs.readFileSync(path.join(__dirname, "data", "roster-export.json"), "utf8"),
  );

  console.log(`Seeding ${raw.squads.length} squads, ${raw.squads.reduce((a, s) => a + s.swimmers.length, 0)} swimmers, ${raw.meets.length} meets...`);

  // 1. Squads
  const squadIdBySlug = new Map<string, string>();
  for (const sq of raw.squads) {
    const { data, error } = await supabase
      .from("squads")
      .upsert(
        {
          slug: sq.slug,
          name: sq.name,
          age_range: sq.age_range,
          coach_name: sq.coach_name,
          assistant_coach_name: sq.assistant_coach_name,
          accent_color: sq.accent_color,
          sort_order: sq.sort_order,
        },
        { onConflict: "slug" },
      )
      .select("id, slug")
      .single();
    if (error) throw error;
    squadIdBySlug.set(sq.slug, data.id);
  }
  console.log("Squads seeded.");

  // 2. Meets
  const meetIdByKey = new Map<string, string>();
  for (const m of raw.meets) {
    const meetDate = toIsoDate(m.date);
    const { data: existing } = await supabase
      .from("meets")
      .select("id")
      .eq("name", m.name)
      .eq("meet_date", meetDate)
      .maybeSingle();
    let id = existing?.id as string | undefined;
    if (!id) {
      const { data, error } = await supabase
        .from("meets")
        .insert({ name: m.name, meet_date: meetDate, course: m.course, status: "completed" })
        .select("id")
        .single();
      if (error) throw error;
      id = data.id;
    }
    meetIdByKey.set(`${m.name}|${m.date}|${m.course}`, id!);
  }
  console.log("Meets seeded.");

  // 3. Swimmers + PBs + results, squad by squad (batched inserts)
  let swimmerCount = 0;
  for (const sq of raw.squads) {
    const squadId = squadIdBySlug.get(sq.slug)!;
    for (const sw of sq.swimmers) {
      const { data: swimmerRow, error: swErr } = await supabase
        .from("swimmers")
        .insert({
          squad_id: squadId,
          first_name: sw.first,
          last_name: sw.last,
          age: sw.age,
          gender: sw.gender,
        })
        .select("id")
        .single();
      if (swErr) throw swErr;
      const swimmerId = swimmerRow.id;
      swimmerCount++;

      if (sw.pbs.length) {
        const pbRows = sw.pbs.map((pb) => ({
          swimmer_id: swimmerId,
          event: pb.event,
          course: pb.course,
          seconds: pb.sec,
          time_text: pb.time,
          drop_text: pb.drop || "",
        }));
        const { error: pbErr } = await supabase.from("personal_bests").insert(pbRows);
        if (pbErr) throw pbErr;
      }

      if (sw.results.length) {
        const resultRows = sw.results
          .map((r) => {
            const meetId = meetIdByKey.get(`${r.meet}|${r.date}|${r.course}`);
            if (!meetId) return null;
            return {
              meet_id: meetId,
              swimmer_id: swimmerId,
              event: r.event,
              course: r.course,
              seconds: r.sec,
              time_text: r.time,
              place: r.place,
            };
          })
          .filter((row): row is NonNullable<typeof row> => row !== null);
        if (resultRows.length) {
          const { error: resErr } = await supabase.from("meet_results").insert(resultRows);
          if (resErr) throw resErr;
        }
      }
    }
    console.log(`  ${sq.name}: ${sq.swimmers.length} swimmers seeded (${swimmerCount} total so far)`);
  }

  console.log(`Done. ${swimmerCount} swimmers seeded across ${raw.squads.length} squads.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
