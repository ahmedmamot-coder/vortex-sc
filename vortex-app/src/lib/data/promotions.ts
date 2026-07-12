import "server-only";
import { createClient } from "@/lib/supabase/server";
import { squadRung } from "@/lib/promotion";

export interface PromotionCandidate {
  swimmerId: string;
  name: string;
  age: number;
  fromSquadId: string;
  fromSquadName: string;
  fromSlug: string;
  toSlug: string;
}

export interface PromotionRow {
  id: string;
  swimmer_id: string;
  status: string;
  reason: string | null;
  swimmers: { first_name: string; last_name: string };
  from_squad: { name: string };
  to_squad: { name: string; id: string };
}

/** Swimmers older than their squad's max age → ready to move up. */
export async function getPromotionCandidates(): Promise<PromotionCandidate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("swimmers")
    .select("id, first_name, last_name, age, squad_id, squads(name, slug)")
    .eq("active", true);
  if (error) throw error;

  const candidates: PromotionCandidate[] = [];
  for (const s of data as unknown as {
    id: string;
    first_name: string;
    last_name: string;
    age: number;
    squad_id: string;
    squads: { name: string; slug: string };
  }[]) {
    const rung = squadRung(s.squads.slug);
    if (rung && rung.next && s.age > rung.maxAge) {
      candidates.push({
        swimmerId: s.id,
        name: `${s.first_name} ${s.last_name}`,
        age: s.age,
        fromSquadId: s.squad_id,
        fromSquadName: s.squads.name,
        fromSlug: s.squads.slug,
        toSlug: rung.next,
      });
    }
  }
  return candidates;
}

export async function getPendingPromotions(): Promise<PromotionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("promotions")
    .select("id, swimmer_id, status, reason, swimmers(first_name, last_name), from_squad:from_squad_id(name), to_squad:to_squad_id(name, id)")
    .eq("status", "suggested")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as unknown as PromotionRow[];
}
