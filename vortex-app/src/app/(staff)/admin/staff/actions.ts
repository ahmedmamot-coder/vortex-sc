"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function updateSquadCoach(
  squadId: string,
  fields: { coach_name?: string; assistant_coach_name?: string | null },
) {
  const supabase = await createClient();
  const { error } = await supabase.from("squads").update(fields).eq("id", squadId);
  if (error) throw error;
  revalidatePath("/admin/staff");
}
