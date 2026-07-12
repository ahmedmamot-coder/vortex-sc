"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function updateClub(
  id: string,
  fields: Partial<{ name: string; zone_method: string; locale: string; rtl: boolean; currency: string }>,
) {
  const supabase = await createClient();
  const { error } = await supabase.from("club").update(fields).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/settings");
}
