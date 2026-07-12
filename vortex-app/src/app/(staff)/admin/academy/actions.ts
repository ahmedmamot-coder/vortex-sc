"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function addTrial(fields: { child_name: string; age: number | null; phone: string }) {
  const supabase = await createClient();
  await supabase.from("academy_trials").insert(fields);
  revalidatePath("/admin/academy");
}

export async function setTrialStatus(id: string, status: string) {
  const supabase = await createClient();
  await supabase.from("academy_trials").update({ status }).eq("id", id);
  revalidatePath("/admin/academy");
}

export async function addFee(fields: { program_name: string; price: number; currency: string }) {
  const supabase = await createClient();
  await supabase.from("academy_fees").insert(fields);
  revalidatePath("/admin/academy");
}

export async function deleteFee(id: string) {
  const supabase = await createClient();
  await supabase.from("academy_fees").delete().eq("id", id);
  revalidatePath("/admin/academy");
}
