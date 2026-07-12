import Link from "next/link";
import { getSquadBySlug } from "@/lib/data/squads";
import { getSwimmersBySquad } from "@/lib/data/swimmers";
import { notFound } from "next/navigation";

export default async function RosterPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const squad = await getSquadBySlug(slug);
  if (!squad) notFound();

  const swimmers = await getSwimmersBySquad(squad.id);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-white font-bold">Roster</h2>
        <span className="text-sm text-[var(--vx-slate-300)]">{swimmers.length} swimmers</span>
      </div>
      <div className="flex flex-col gap-1">
        {swimmers.map((s) => (
          <Link
            key={s.id}
            href={`/squads/${slug}/swimmers/${s.id}`}
            className="flex items-center justify-between rounded-[var(--radius-md)] px-3 py-3 hover:bg-white/5"
          >
            <div className="flex items-center gap-3">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold"
                style={{ background: squad.accent_color }}
              >
                {s.first_name[0]}
                {s.last_name[0]}
              </div>
              <div>
                <p className="text-white font-medium">
                  {s.first_name} {s.last_name}{" "}
                  <span
                    className="text-xs"
                    style={{ color: s.gender === "Girls" ? "#E5497D" : "#2A63E0" }}
                  >
                    {s.gender === "Girls" ? "♀" : "♂"}
                  </span>
                </p>
                <p className="text-xs text-[var(--vx-slate-300)]">Age {s.age}</p>
              </div>
            </div>
          </Link>
        ))}
        {swimmers.length === 0 && (
          <p className="text-sm text-[var(--vx-slate-300)] py-6 text-center">
            No swimmers in this squad yet.
          </p>
        )}
      </div>
    </div>
  );
}
