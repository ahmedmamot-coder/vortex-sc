"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMeets } from "@/lib/data/meets";

export async function fetchMeets() {
  return getMeets();
}

export async function setMeetStatus(slug: string, meetId: string, status: string) {
  const supabase = await createClient();
  await supabase.from("meets").update({ status }).eq("id", meetId);
  revalidatePath(`/squads/${slug}/tools/meets`);
}

export async function fetchEntries(meetId: string, squadId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("meet_entries")
    .select("*, swimmers(first_name, last_name)")
    .eq("meet_id", meetId)
    .eq("squad_id", squadId)
    .order("heat")
    .order("lane");
  return data ?? [];
}

export async function addEntry(
  slug: string,
  meetId: string,
  squadId: string,
  swimmerId: string,
  event: string,
  heat: number,
  lane: number,
) {
  const supabase = await createClient();
  await supabase.from("meet_entries").insert({
    meet_id: meetId,
    squad_id: squadId,
    swimmer_id: swimmerId,
    event,
    heat,
    lane,
  });
  revalidatePath(`/squads/${slug}/tools/meets`);
}

export async function deleteEntry(slug: string, id: string) {
  const supabase = await createClient();
  await supabase.from("meet_entries").delete().eq("id", id);
  revalidatePath(`/squads/${slug}/tools/meets`);
}
