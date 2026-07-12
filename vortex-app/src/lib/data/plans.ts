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

export async function getOrCreatePlan(squadId: string): Promise<PlanWithSections> {
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("plans")
    .select("*, plan_sections(*, plan_sets(*))")
    .eq("squad_id", squadId)
    .maybeSingle();

  if (existing) {
    return normalizePlan(existing);
  }

  const { data: plan, error: planErr } = await supabase
    .from("plans")
    .insert({ squad_id: squadId, title: "Session", zone: "EN2" })
    .select()
    .single();
  if (planErr) throw planErr;

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

  return getOrCreatePlan(squadId);
}

function normalizePlan(raw: Plan & { plan_sections: (PlanSection & { plan_sets: PlanSet[] })[] }): PlanWithSections {
  return {
    ...raw,
    sections: raw.plan_sections
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((s) => ({ ...s, sets: s.plan_sets.sort((a, b) => a.sort_order - b.sort_order) })),
  };
}
