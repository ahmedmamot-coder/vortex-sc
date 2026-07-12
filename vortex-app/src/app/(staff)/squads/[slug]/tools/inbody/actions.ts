"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getScansForSwimmer } from "@/lib/data/inbody";

export async function fetchScans(swimmerId: string) {
  return getScansForSwimmer(swimmerId);
}


export async function logScan(
  slug: string,
  swimmerId: string,
  fields: {
    weight_kg: number | null;
    muscle_mass_kg: number | null;
    body_fat_pct: number | null;
    bmr: number | null;
    visceral_fat: number | null;
    source: string;
  },
) {
  const supabase = await createClient();
  const { error } = await supabase.from("inbody_scans").insert({ swimmer_id: swimmerId, ...fields });
  if (error) throw error;
  revalidatePath(`/squads/${slug}/tools/inbody`);
}

export async function deleteScan(slug: string, id: string) {
  const supabase = await createClient();
  await supabase.from("inbody_scans").delete().eq("id", id);
  revalidatePath(`/squads/${slug}/tools/inbody`);
}
