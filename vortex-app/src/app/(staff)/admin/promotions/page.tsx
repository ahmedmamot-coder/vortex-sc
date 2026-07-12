import { getPromotionCandidates, getPendingPromotions } from "@/lib/data/promotions";
import PromotionsClient from "./promotions-client";

export default async function PromotionsPage() {
  const [candidates, pending] = await Promise.all([
    getPromotionCandidates(),
    getPendingPromotions(),
  ]);

  // Hide candidates that already have a pending suggestion.
  const pendingSwimmerIds = new Set(pending.map((p) => p.swimmer_id));
  const openCandidates = candidates.filter((c) => !pendingSwimmerIds.has(c.swimmerId));

  return <PromotionsClient candidates={openCandidates} pending={pending} />;
}
