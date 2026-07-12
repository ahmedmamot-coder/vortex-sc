import Link from "next/link";
import { notFound } from "next/navigation";
import { getSquadBySlug } from "@/lib/data/squads";
import { getOrCreatePlan } from "@/lib/data/plans";
import { ZONE_DEFS } from "@/lib/types";
import PrintButton from "./print-button";

export default async function PlanPrintPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const squad = await getSquadBySlug(slug);
  if (!squad) notFound();
  const plan = await getOrCreatePlan(squad.id);
  const zoneDef = ZONE_DEFS.find((z) => z.id === plan.zone);

  return (
    <div className="min-h-screen bg-[#0C1116]">
      <div className="print:hidden flex justify-center gap-3 py-4">
        <Link href={`/squads/${slug}/plans`} className="px-4 py-2 rounded-[var(--radius-md)] border border-white/20 text-white text-sm">
          Back to edit
        </Link>
        <PrintButton />
      </div>

      <div
        id="vx-print-sheet"
        className="vx-pattern-bg mx-auto max-w-[800px] p-10 text-[#0C1116]"
        style={{ minHeight: "1000px" }}
      >
        <div className="flex items-center justify-between mb-8">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">Vortex Swimming Club</p>
            <h1 className="text-2xl font-bold">{plan.title}</h1>
            <p className="text-sm text-gray-600">
              {squad.name} · {squad.coach_name} · {new Date().toLocaleDateString()}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-gray-500">Session zone</p>
            <p className="font-bold" style={{ color: zoneDef?.color }}>
              {plan.zone} · {zoneDef?.name}
            </p>
            <p className="text-sm text-gray-600">{plan.total_metres}m total</p>
          </div>
        </div>

        {plan.sections.map((section) => (
          <div key={section.id} style={{ breakInside: "avoid" }} className="mb-6">
            <h2 className="font-bold text-lg mb-2 border-b-2 border-[#C9B8F5] pb-1">{section.name}</h2>
            <table className="w-full">
              <tbody>
                {section.sets.map((set) => (
                  <tr key={set.id} className="border-b-2" style={{ borderColor: "#C9B8F5" }}>
                    <td className="py-3 font-bold w-20 align-top">{set.distance}m</td>
                    <td className="py-3 align-top">
                      <p>{set.description}</p>
                      <p className="text-xs mt-1" style={{ color: "#3B2FD6", fontWeight: 700 }}>
                        {[
                          set.set_types.length ? `Type: ${set.set_types.join(", ")}` : "",
                          set.equipment.length ? `Tools: ${set.equipment.join(", ")}` : "",
                          set.rest ? `Rest: ${set.rest}` : "",
                        ]
                          .filter(Boolean)
                          .join("  ·  ")}
                      </p>
                    </td>
                    <td className="py-3 text-right align-top text-sm text-gray-600">{set.zone ?? plan.zone}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        <div className="flex items-center justify-end gap-2 mt-10 text-sm font-semibold">
          Vortex Swimming Club
        </div>
      </div>
    </div>
  );
}
