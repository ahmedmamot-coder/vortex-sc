"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function recomputeTotal(planId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("plan_sections")
    .select("plan_sets(distance)")
    .eq("plan_id", planId);
  const total = (data ?? []).reduce(
    (sum, section) =>
      sum + (section.plan_sets as { distance: number }[]).reduce((s, x) => s + (x.distance || 0), 0),
    0,
  );
  await supabase.from("plans").update({ total_metres: total, updated_at: new Date().toISOString() }).eq("id", planId);
}

export async function updatePlanMeta(planId: string, slug: string, fields: { title?: string; zone?: string }) {
  const supabase = await createClient();
  await supabase.from("plans").update(fields).eq("id", planId);
  revalidatePath(`/squads/${slug}/plans`);
}

export async function addSection(planId: string, slug: string, name: string, sortOrder: number) {
  const supabase = await createClient();
  await supabase.from("plan_sections").insert({ plan_id: planId, name, sort_order: sortOrder });
  revalidatePath(`/squads/${slug}/plans`);
}

export async function removeSection(sectionId: string, slug: string, planId: string) {
  const supabase = await createClient();
  await supabase.from("plan_sections").delete().eq("id", sectionId);
  await recomputeTotal(planId);
  revalidatePath(`/squads/${slug}/plans`);
}

export async function addSet(sectionId: string, slug: string, planId: string, sortOrder: number) {
  const supabase = await createClient();
  await supabase.from("plan_sets").insert({
    section_id: sectionId,
    distance: 100,
    description: "New set",
    sort_order: sortOrder,
  });
  await recomputeTotal(planId);
  revalidatePath(`/squads/${slug}/plans`);
}

export async function removeSet(setId: string, slug: string, planId: string) {
  const supabase = await createClient();
  await supabase.from("plan_sets").delete().eq("id", setId);
  await recomputeTotal(planId);
  revalidatePath(`/squads/${slug}/plans`);
}

export type ParsedSection = {
  name: string;
  sets: { distance: number; description: string; equipment: string[]; set_types: string[]; rest: string }[];
};

export async function replacePlanFromImport(planId: string, slug: string, sections: ParsedSection[]) {
  const supabase = await createClient();

  // Clear existing sections (cascades to sets), then rebuild from the import.
  await supabase.from("plan_sections").delete().eq("plan_id", planId);

  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    const { data: section, error } = await supabase
      .from("plan_sections")
      .insert({ plan_id: planId, name: sec.name, sort_order: i })
      .select()
      .single();
    if (error) throw error;
    for (let j = 0; j < sec.sets.length; j++) {
      const s = sec.sets[j];
      await supabase.from("plan_sets").insert({
        section_id: section.id,
        distance: s.distance,
        description: s.description,
        equipment: s.equipment,
        set_types: s.set_types,
        rest: s.rest,
        sort_order: j,
      });
    }
  }

  await recomputeTotal(planId);
  revalidatePath(`/squads/${slug}/plans`);
}

export async function updateSet(
  setId: string,
  slug: string,
  planId: string,
  fields: Partial<{
    distance: number;
    description: string;
    equipment: string[];
    set_types: string[];
    rest: string;
    zone: string | null;
  }>,
) {
  const supabase = await createClient();
  await supabase.from("plan_sets").update(fields).eq("id", setId);
  if (fields.distance !== undefined) await recomputeTotal(planId);
  revalidatePath(`/squads/${slug}/plans`);
}
