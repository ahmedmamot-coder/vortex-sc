"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function suggestPromotion(
  swimmerId: string,
  fromSquadId: string,
  toSlug: string,
  reason: string,
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: toSquad } = await supabase.from("squads").select("id").eq("slug", toSlug).single();

  await supabase.from("promotions").insert({
    swimmer_id: swimmerId,
    from_squad_id: fromSquadId,
    to_squad_id: toSquad!.id,
    status: "suggested",
    reason,
    suggested_by: user?.id,
  });
  revalidatePath("/admin/promotions");
}

export async function approvePromotion(promotionId: string, swimmerId: string, toSquadId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Move the swimmer, then mark the promotion approved.
  await supabase.from("swimmers").update({ squad_id: toSquadId }).eq("id", swimmerId);
  await supabase
    .from("promotions")
    .update({ status: "approved", approved_by: user?.id, decided_at: new Date().toISOString() })
    .eq("id", promotionId);
  revalidatePath("/admin/promotions");
}

export async function rejectPromotion(promotionId: string) {
  const supabase = await createClient();
  await supabase
    .from("promotions")
    .update({ status: "rejected", decided_at: new Date().toISOString() })
    .eq("id", promotionId);
  revalidatePath("/admin/promotions");
}
