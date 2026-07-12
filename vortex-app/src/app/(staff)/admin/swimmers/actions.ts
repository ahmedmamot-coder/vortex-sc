"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function addSwimmer(fields: {
  squad_id: string;
  first_name: string;
  last_name: string;
  age: number;
  gender: "Girls" | "Boys";
}) {
  const supabase = await createClient();
  const { error } = await supabase.from("swimmers").insert(fields);
  if (error) throw error;
  revalidatePath("/admin/swimmers");
}

export async function updateSwimmer(
  id: string,
  fields: Partial<{
    first_name: string;
    last_name: string;
    age: number;
    gender: "Girls" | "Boys";
    squad_id: string;
    active: boolean;
  }>,
) {
  const supabase = await createClient();
  const { error } = await supabase.from("swimmers").update(fields).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/swimmers");
}

export async function deleteSwimmer(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("swimmers").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/swimmers");
}

export async function addPersonalBest(
  swimmerId: string,
  event: string,
  course: "L" | "S",
  seconds: number,
  timeText: string,
) {
  const supabase = await createClient();
  const { error } = await supabase.from("personal_bests").upsert(
    {
      swimmer_id: swimmerId,
      event,
      course,
      seconds,
      time_text: timeText,
    },
    { onConflict: "swimmer_id,event,course" },
  );
  if (error) throw error;
  revalidatePath("/admin/swimmers");
}

export async function removePersonalBest(pbId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("personal_bests").delete().eq("id", pbId);
  if (error) throw error;
  revalidatePath("/admin/swimmers");
}
