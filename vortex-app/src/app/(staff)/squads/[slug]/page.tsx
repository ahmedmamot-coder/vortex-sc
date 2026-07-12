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
      <div className="flex items-center justify-between mb-3 px-1">
        <h2 className="font-bold text-[#0C1116] text-[15px]">Roster</h2>
        <span className="text-[12px] text-[#7A8296]">{swimmers.length} swimmers</span>
      </div>
      <div className="flex flex-col gap-2">
        {swimmers.map((s) => (
          <Link
            key={s.id}
            href={`/squads/${slug}/swimmers/${s.id}`}
            className="flex items-center gap-3 bg-white rounded-[15px] px-3 py-2.5"
            style={{ border: "1px solid #E5E9F0", boxShadow: "0 2px 7px rgba(11,20,40,.05)" }}
          >
            <div
              className="w-11 h-11 rounded-[12px] flex items-center justify-center text-white text-[13px] font-bold flex-none"
              style={{ background: squad.accent_color }}
            >
              {s.first_name[0]}
              {s.last_name[0]}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-[14.5px] text-[#0C1116]">
                {s.first_name} {s.last_name}{" "}
                <span className="text-[12px]" style={{ color: s.gender === "Girls" ? "#E5497D" : "#2A63E0" }}>
                  {s.gender === "Girls" ? "♀" : "♂"}
                </span>
              </p>
              <p className="text-[12px] text-[#7A8296]">Age {s.age}</p>
            </div>
            <span className="text-[#C7CDDA]">›</span>
          </Link>
        ))}
        {swimmers.length === 0 && (
          <p className="text-[13px] text-[#7A8296] py-6 text-center">No swimmers in this squad yet.</p>
        )}
      </div>
    </div>
  );
}
