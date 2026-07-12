import { createClient } from "@/lib/supabase/server";
import { getClub } from "@/lib/data/club";
import AcademyClient from "./academy-client";

export default async function AcademyPage() {
  const supabase = await createClient();
  const [{ data: trials }, { data: fees }, club] = await Promise.all([
    supabase.from("academy_trials").select("*").order("created_at", { ascending: false }),
    supabase.from("academy_fees").select("*").order("sort_order"),
    getClub(),
  ]);

  return (
    <AcademyClient
      trials={(trials ?? []) as { id: string; child_name: string; age: number | null; phone: string | null; status: string }[]}
      fees={(fees ?? []) as { id: string; program_name: string; price: number; currency: string }[]}
      currency={club.currency}
    />
  );
}
