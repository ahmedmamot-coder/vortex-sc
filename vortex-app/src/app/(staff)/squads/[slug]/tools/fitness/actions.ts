"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { FitnessSection } from "@/lib/data/fitness";

export async function saveFitnessPlan(slug: string, squadId: string, sections: FitnessSection[]) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("fitness_plans")
    .upsert({ squad_id: squadId, sections, updated_at: new Date().toISOString() }, { onConflict: "squad_id" });
  if (error) throw error;
  revalidatePath(`/squads/${slug}/tools/fitness`);
}
