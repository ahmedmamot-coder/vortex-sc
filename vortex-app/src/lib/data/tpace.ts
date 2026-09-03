import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { TPaceTestType } from "@/lib/tpace-tests";

export interface TPaceTest {
  id: string;
  swimmer_id: string;
  distance: number;
  time_seconds: number;
  t_pace_seconds: number;
  /**
   * Which test it was. Added by supabase/tpace_fixed_clock.sql — rows written before that ran
   * do not carry one, and `select *` simply does not return the column until it exists, so
   * every reader goes through testTypeOf() rather than trusting this to be there.
   */
  test_type?: TPaceTestType | null;
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
