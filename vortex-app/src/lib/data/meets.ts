import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Meet, MeetResult, Swimmer } from "@/lib/types";

export async function getMeets(): Promise<Meet[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("meets").select("*").order("meet_date", { ascending: false });
  if (error) throw error;
  return data as Meet[];
}

export async function getResultsForSquad(
  squadId: string,
): Promise<(MeetResult & { meets: Pick<Meet, "name" | "meet_date">; swimmers: Pick<Swimmer, "first_name" | "last_name"> })[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("meet_results")
    .select("*, meets(name, meet_date), swimmers!inner(first_name, last_name, squad_id)")
    .eq("swimmers.squad_id", squadId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as unknown as (MeetResult & {
    meets: Pick<Meet, "name" | "meet_date">;
    swimmers: Pick<Swimmer, "first_name" | "last_name">;
  })[];
}
