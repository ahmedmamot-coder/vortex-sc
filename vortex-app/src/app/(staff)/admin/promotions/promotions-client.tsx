"use client";

import { useTransition } from "react";
import type { PromotionCandidate, PromotionRow } from "@/lib/data/promotions";
import { suggestPromotion, approvePromotion, rejectPromotion } from "./actions";

export default function PromotionsClient({
  candidates,
  pending,
}: {
  candidates: PromotionCandidate[];
  pending: PromotionRow[];
}) {
  const [, startTransition] = useTransition();

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#0C1116] mb-6">Promotion engine</h1>

      <section className="mb-8">
        <h2 className="text-[#0C1116] font-semibold mb-2 text-sm">Awaiting approval ({pending.length})</h2>
        <div className="flex flex-col gap-2">
          {pending.map((p) => (
            <div key={p.id} className="rounded-[var(--radius-md)] bg-white border border-[#E5E9F0] px-3 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[#0C1116] text-sm font-medium">
                    {p.swimmers.first_name} {p.swimmers.last_name}
                  </p>
                  <p className="text-xs text-[#7A8296]">
                    {p.from_squad.name} → {p.to_squad.name}
                  </p>
                  {p.reason && <p className="text-xs text-[#7A8296] mt-1">{p.reason}</p>}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => startTransition(() => approvePromotion(p.id, p.swimmer_id, p.to_squad.id))}
                    className="text-xs font-semibold px-3 py-1.5 rounded-[var(--radius-pill)] text-white"
                    style={{ background: "var(--vx-success)" }}
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => startTransition(() => rejectPromotion(p.id))}
                    className="text-xs font-semibold px-3 py-1.5 rounded-[var(--radius-pill)] text-[#0C1116] border border-[#E5E9F0]"
                  >
                    Reject
                  </button>
                </div>
              </div>
            </div>
          ))}
          {pending.length === 0 && <p className="text-sm text-[#7A8296]">Nothing awaiting approval.</p>}
        </div>
      </section>

      <section>
        <h2 className="text-[#0C1116] font-semibold mb-2 text-sm">
          Flagged — over squad age ({candidates.length})
        </h2>
        <div className="flex flex-col gap-2">
          {candidates.map((c) => (
            <div key={c.swimmerId} className="flex items-center justify-between rounded-[var(--radius-md)] bg-white border border-[#E5E9F0] px-3 py-3">
              <div>
                <p className="text-[#0C1116] text-sm font-medium">{c.name}</p>
                <p className="text-xs text-[#7A8296]">
                  Age {c.age} · {c.fromSquadName} → {c.toSlug}
                </p>
              </div>
              <button
                onClick={() =>
                  startTransition(() =>
                    suggestPromotion(
                      c.swimmerId,
                      c.fromSquadId,
                      c.toSlug,
                      `Age ${c.age} exceeds ${c.fromSquadName} band`,
                    ),
                  )
                }
                className="text-xs font-semibold px-3 py-1.5 rounded-[var(--radius-pill)] text-white"
                style={{ background: "var(--vx-blue)" }}
              >
                Suggest
              </button>
            </div>
          ))}
          {candidates.length === 0 && (
            <p className="text-sm text-[#7A8296]">No swimmers currently over their squad age band.</p>
          )}
        </div>
      </section>
    </div>
  );
}
