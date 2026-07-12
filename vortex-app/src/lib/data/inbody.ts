import "server-only";
import { createClient } from "@/lib/supabase/server";

export interface InBodyScan {
  id: string;
  swimmer_id: string;
  scanned_at: string;
  weight_kg: number | null;
  muscle_mass_kg: number | null;
  body_fat_pct: number | null;
  bmr: number | null;
  visceral_fat: number | null;
  source: string | null;
}

export async function getScansForSwimmer(swimmerId: string): Promise<InBodyScan[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inbody_scans")
    .select("*")
    .eq("swimmer_id", swimmerId)
    .order("scanned_at", { ascending: false });
  if (error) throw error;
  return data as InBodyScan[];
}
