"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseSetNotation, describeSet } from "@/lib/plan-notation";

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

// Fields a set carries besides its position — shared by a blank add, a quick-add from
// typed notation, and a drop from the favourites shelf.
type SetFields = Partial<{
  distance: number;
  reps: number;
  description: string;
  equipment: string[];
  set_types: string[];
  stroke: string | null;
  focus: string[];
  rest: string;
  zone: string | null;
}>;

export async function addSet(
  sectionId: string,
  slug: string,
  planId: string,
  sortOrder: number,
  fields: SetFields = {},
) {
  const supabase = await createClient();
  await supabase.from("plan_sets").insert({
    section_id: sectionId,
    distance: fields.distance ?? 100,
    description: fields.description ?? "New set",
    sort_order: sortOrder,
    ...fields,
  });
  await recomputeTotal(planId);
  revalidatePath(`/squads/${slug}/plans`);
}

// Quick-add: a coach types "8x100 free en2 fins @1:30" and gets a structured set.
export async function addSetFromNotation(
  sectionId: string,
  slug: string,
  planId: string,
  text: string,
  sortOrder: number,
) {
  const p = parseSetNotation(text);
  await addSet(sectionId, slug, planId, sortOrder, {
    distance: p.distance,
    reps: p.reps,
    stroke: p.stroke,
    set_types: p.set_types,
    equipment: p.equipment,
    focus: p.focus,
    rest: p.rest,
    zone: p.zone,
    description: p.description,
  });
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
  fields: SetFields,
) {
  const supabase = await createClient();
  await supabase.from("plan_sets").update(fields).eq("id", setId);
  if (fields.distance !== undefined) await recomputeTotal(planId);
  revalidatePath(`/squads/${slug}/plans`);
}

/**
 * Move a set up or down within its own section by swapping sort_order with the
 * neighbour in that direction. A no-op at the top/bottom edge.
 */
export async function moveSet(setId: string, slug: string, planId: string, dir: "up" | "down") {
  const supabase = await createClient();
  const { data: set } = await supabase
    .from("plan_sets")
    .select("id, section_id, sort_order")
    .eq("id", setId)
    .single();
  if (!set) return;

  const { data: siblings } = await supabase
    .from("plan_sets")
    .select("id, sort_order")
    .eq("section_id", set.section_id)
    .order("sort_order", { ascending: true });

  const ordered = siblings ?? [];
  const i = ordered.findIndex((s) => s.id === setId);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= ordered.length) return;

  // Swap the two rows' positions.
  await supabase.from("plan_sets").update({ sort_order: ordered[j].sort_order }).eq("id", ordered[i].id);
  await supabase.from("plan_sets").update({ sort_order: ordered[i].sort_order }).eq("id", ordered[j].id);
  revalidatePath(`/squads/${slug}/plans`);
}

/**
 * Move a set to another section (e.g. Pre-set → Main set, or back). It lands at the
 * end of the target section. Total metres is unchanged, so no recompute.
 */
export async function moveSetToSection(
  setId: string,
  slug: string,
  planId: string,
  targetSectionId: string,
) {
  const supabase = await createClient();
  const { data: tail } = await supabase
    .from("plan_sets")
    .select("sort_order")
    .eq("section_id", targetSectionId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (tail?.sort_order ?? -1) + 1;
  await supabase
    .from("plan_sets")
    .update({ section_id: targetSectionId, sort_order: nextOrder })
    .eq("id", setId);
  revalidatePath(`/squads/${slug}/plans`);
}

/** Star a set: copy its writable shape onto the squad's favourites shelf. */
export async function saveFavorite(squadId: string, slug: string, fields: SetFields) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const label = describeSet({
    reps: fields.reps ?? 1,
    distance: fields.distance ?? 0,
    stroke: fields.stroke ?? null,
  });
  await supabase.from("plan_set_favorites").insert({
    squad_id: squadId,
    label,
    reps: fields.reps ?? 1,
    distance: fields.distance ?? 0,
    stroke: fields.stroke ?? null,
    description: fields.description ?? "",
    equipment: fields.equipment ?? [],
    set_types: fields.set_types ?? [],
    focus: fields.focus ?? [],
    rest: fields.rest ?? "",
    zone: fields.zone ?? null,
    created_by: user?.id ?? null,
  });
  revalidatePath(`/squads/${slug}/plans`);
}

/** Drop a starred set into a section as a new, fully editable set. */
export async function addSetFromFavorite(
  sectionId: string,
  slug: string,
  planId: string,
  favoriteId: string,
  sortOrder: number,
) {
  const supabase = await createClient();
  const { data: fav } = await supabase
    .from("plan_set_favorites")
    .select("*")
    .eq("id", favoriteId)
    .single();
  if (!fav) return;
  await addSet(sectionId, slug, planId, sortOrder, {
    distance: fav.distance,
    reps: fav.reps,
    stroke: fav.stroke,
    description: fav.description,
    equipment: fav.equipment,
    set_types: fav.set_types,
    focus: fav.focus,
    rest: fav.rest,
    zone: fav.zone,
  });
}

export async function deleteFavorite(favoriteId: string, slug: string) {
  const supabase = await createClient();
  await supabase.from("plan_set_favorites").delete().eq("id", favoriteId);
  revalidatePath(`/squads/${slug}/plans`);
}
