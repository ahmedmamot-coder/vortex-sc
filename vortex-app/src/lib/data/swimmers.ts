import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Swimmer, PersonalBest, MeetResult, Meet } from "@/lib/types";

export async function getSwimmersBySquad(squadId: string): Promise<Swimmer[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("swimmers")
    .select("*")
    .eq("squad_id", squadId)
    .eq("active", true)
    .order("last_name");
  if (error) throw error;
  return data as Swimmer[];
}

export async function getAllSwimmersWithPbs(): Promise<
  (Swimmer & { squads: { name: string; slug: string }; personal_bests: PersonalBest[] })[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("swimmers")
    .select("*, squads(name, slug), personal_bests(*)")
    .eq("active", true)
    .order("last_name");
  if (error) throw error;
  return data as unknown as (Swimmer & {
    squads: { name: string; slug: string };
    personal_bests: PersonalBest[];
  })[];
}

export async function getSwimmer(id: string): Promise<Swimmer | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("swimmers").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as Swimmer | null;
}

export async function getPersonalBests(swimmerId: string): Promise<PersonalBest[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("personal_bests")
    .select("*")
    .eq("swimmer_id", swimmerId)
    .order("event");
  if (error) throw error;
  return data as PersonalBest[];
}

export async function getSwimmerResults(
  swimmerId: string,
): Promise<(MeetResult & { meets: Pick<Meet, "name" | "meet_date"> })[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("meet_results")
    .select("*, meets(name, meet_date)")
    .eq("swimmer_id", swimmerId);
  if (error) throw error;
  return data as unknown as (MeetResult & { meets: Pick<Meet, "name" | "meet_date"> })[];
}
