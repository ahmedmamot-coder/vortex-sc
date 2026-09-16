import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Plan, PlanSection, PlanSet } from "@/lib/types";

export type PlanWithSections = Plan & {
  sections: (PlanSection & { sets: PlanSet[] })[];
};

const DEFAULT_SECTIONS = [
  { name: "Warm-up", sets: [{ distance: 400, description: "Easy swim, choice", zone: "EN1" }] },
  { name: "Pre-set", sets: [{ distance: 200, description: "Drill/swim by 50", zone: "EN1" }] },
  {
    name: "Main set",
    sets: [{ distance: 800, description: "8x100 @1:30, hold pace", zone: "EN2" }],
  },
  { name: "Cool-down", sets: [{ distance: 200, description: "Easy swim/kick", zone: "EN1" }] },
];

// Read a squad's single plan with all its sections and sets.
//
// A squad is meant to have exactly one plan, but a past race (two coaches, or one
// coach on two devices/tabs, opening Plans at the same moment before the plan
// existed) could leave more than one row. Order by updated_at and take a single row
// so we always return the most recently edited plan and never error on the extras —
// a plain .maybeSingle() throws when it sees more than one row, which is what made
// every Plans visit fall through and seed yet another duplicate plan.
async function fetchPlan(
  supabase: Awaited<ReturnType<typeof createClient>>,
  squadId: string,
) {
  const { data } = await supabase
    .from("plans")
    .select("*, plan_sections(*, plan_sets(*))")
    .eq("squad_id", squadId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export async function getOrCreatePlan(squadId: string): Promise<PlanWithSections> {
  const supabase = await createClient();

  const existing = await fetchPlan(supabase, squadId);
  if (existing) {
    return normalizePlan(existing);
  }

  // No plan yet — seed a default one. Guard the create against a race so two
  // simultaneous first-loads can't each insert a plan and double the squad's
  // training: if the unique squad_id constraint rejects our insert because another
  // request won, read that plan back instead of creating a second one.
  const { data: plan, error: planErr } = await supabase
    .from("plans")
    .insert({ squad_id: squadId, title: "Session", zone: "EN2" })
    .select()
    .single();
  if (planErr || !plan) {
    const raced = await fetchPlan(supabase, squadId);
    if (raced) return normalizePlan(raced);
    throw planErr ?? new Error("Could not create plan");
  }

  for (let i = 0; i < DEFAULT_SECTIONS.length; i++) {
    const def = DEFAULT_SECTIONS[i];
    const { data: section, error: sectionErr } = await supabase
      .from("plan_sections")
      .insert({ plan_id: plan.id, name: def.name, sort_order: i })
      .select()
      .single();
    if (sectionErr) throw sectionErr;

    for (let j = 0; j < def.sets.length; j++) {
      const s = def.sets[j];
      await supabase.from("plan_sets").insert({
        section_id: section.id,
        distance: s.distance,
        description: s.description,
        zone: s.zone,
        sort_order: j,
      });
    }
  }

  const created = await fetchPlan(supabase, squadId);
  if (!created) throw new Error("Plan created but could not be read back");
  return normalizePlan(created);
}

function normalizePlan(raw: Plan & { plan_sections: (PlanSection & { plan_sets: PlanSet[] })[] }): PlanWithSections {
  return {
    ...raw,
    sections: raw.plan_sections
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((s) => ({
        ...s,
        sets: s.plan_sets.sort((a, b) => a.sort_order - b.sort_order).map(normalizeSet),
      })),
  };
}

// The reps/stroke/focus columns arrived after the first plans shipped, so rows written
// before the migration have them absent. Fill sane defaults rather than leaking undefined
// into the editor: a set is at least one rep, has no chosen stroke, and no focus tags.
function normalizeSet(set: PlanSet): PlanSet {
  return {
    ...set,
    reps: set.reps ?? 1,
    stroke: set.stroke ?? null,
    focus: set.focus ?? [],
    equipment: set.equipment ?? [],
    set_types: set.set_types ?? [],
  };
}
