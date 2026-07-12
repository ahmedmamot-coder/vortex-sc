import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Swimmer } from "@/lib/types";

export async function getLinkedSwimmers(
  familyAccountId: string,
): Promise<(Swimmer & { squads: { name: string; coach_name: string } })[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("family_links")
    .select("swimmers(*, squads(name, coach_name))")
    .eq("family_account_id", familyAccountId);
  if (error) throw error;
  return (data ?? []).map((row) => row.swimmers) as unknown as (Swimmer & {
    squads: { name: string; coach_name: string };
  })[];
}
