"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function logTPaceTest(
  slug: string,
  swimmerId: string,
  distance: number,
  timeSeconds: number,
) {
  // T-pace per 100 = total time / (distance / 100)
  const tPace = timeSeconds / (distance / 100);
  const retest = new Date();
  retest.setDate(retest.getDate() + 42); // retest in ~6 weeks

  const supabase = await createClient();
  const { error } = await supabase.from("t_pace_tests").insert({
    swimmer_id: swimmerId,
    distance,
    time_seconds: timeSeconds,
    t_pace_seconds: tPace,
    retest_due: retest.toISOString().slice(0, 10),
  });
  if (error) throw error;
  revalidatePath(`/squads/${slug}/tools/t-pace`);
}

export async function deleteTPaceTest(slug: string, id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("t_pace_tests").delete().eq("id", id);
  if (error) throw error;
  revalidatePath(`/squads/${slug}/tools/t-pace`);
}
