import "server-only";
import { createClient } from "@/lib/supabase/server";

export interface TPaceTest {
  id: string;
  swimmer_id: string;
  distance: number;
  time_seconds: number;
  t_pace_seconds: number;
  tested_at: string;
  retest_due: string | null;
}

export async function getTPaceTestsForSquad(
  squadId: string,
): Promise<(TPaceTest & { swimmers: { first_name: string; last_name: string } })[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("t_pace_tests")
    .select("*, swimmers!inner(first_name, last_name, squad_id)")
    .eq("swimmers.squad_id", squadId)
    .order("tested_at", { ascending: false });
  if (error) throw error;
  return data as unknown as (TPaceTest & { swimmers: { first_name: string; last_name: string } })[];
}
