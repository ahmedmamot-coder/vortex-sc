import { notFound } from "next/navigation";
import { getSquadBySlug } from "@/lib/data/squads";
import { getOrCreatePlan } from "@/lib/data/plans";
import { reviewPlan } from "@/lib/plan-review";
import ToolShell from "../tool-shell";

const COLORS = { pass: "var(--vx-success)", review: "var(--vx-warning)", fail: "var(--vx-danger)" };
const LABELS = { pass: "Pass", review: "Review", fail: "Fail" };

export default async function PlanReviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const squad = await getSquadBySlug(slug);
  if (!squad) notFound();
  const plan = await getOrCreatePlan(squad.id);
  const result = reviewPlan(plan, slug);

  return (
    <ToolShell slug={slug} title="AI Plan Review">
      <div
        className="rounded-[var(--radius-lg)] p-4 mb-4 border"
        style={{ borderColor: COLORS[result.verdict], background: "rgba(255,255,255,0.03)" }}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-[var(--vx-slate-300)]">Verdict</p>
            <p className="text-xl font-bold" style={{ color: COLORS[result.verdict] }}>
              {LABELS[result.verdict]}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-[var(--vx-slate-300)]">{plan.title}</p>
            <p className="text-white font-semibold">{plan.total_metres}m</p>
          </div>
        </div>
      </div>

      <p className="text-xs text-[var(--vx-slate-300)] mb-2">
        Rules decide; the wording explains. Deterministic — no API key needed.
      </p>

      <div className="flex flex-col gap-2">
        {result.findings.map((f, i) => (
          <div key={i} className="flex gap-2 rounded-[var(--radius-md)] bg-white/5 border border-white/10 p-3">
            <span
              className="mt-0.5 w-2.5 h-2.5 rounded-full flex-none"
              style={{ background: COLORS[f.severity] }}
            />
            <p className="text-sm text-white/90">{f.message}</p>
          </div>
        ))}
      </div>
    </ToolShell>
  );
}
