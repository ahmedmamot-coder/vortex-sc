import "server-only";
import { createClient } from "@/lib/supabase/server";

export interface Club {
  id: string;
  name: string;
  zone_method: string;
  locale: string;
  rtl: boolean;
  currency: string;
}

export async function getClub(): Promise<Club> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("club").select("*").limit(1).single();
  if (error) throw error;
  return data as Club;
}
