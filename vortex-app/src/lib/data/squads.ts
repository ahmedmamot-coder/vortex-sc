import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Squad } from "@/lib/types";

export async function getSquads(): Promise<Squad[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("squads").select("*").order("sort_order");
  if (error) throw error;
  return data as Squad[];
}

export async function getSquadBySlug(slug: string): Promise<Squad | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("squads").select("*").eq("slug", slug).maybeSingle();
  if (error) throw error;
  return data as Squad | null;
}

export async function getSquadCounts(): Promise<Record<string, number>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("swimmers").select("squad_id");
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of data) counts[row.squad_id] = (counts[row.squad_id] || 0) + 1;
  return counts;
}
