import { notFound } from "next/navigation";
import { getSquadBySlug } from "@/lib/data/squads";
import { getResultsForSquad } from "@/lib/data/meets";
import { formatShortDate } from "@/lib/format";

export default async function ResultsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const squad = await getSquadBySlug(slug);
  if (!squad) notFound();

  const results = await getResultsForSquad(squad.id);

  const byMeet = new Map<string, typeof results>();
  for (const r of results) {
    const key = r.meets?.name ?? "Unknown meet";
    if (!byMeet.has(key)) byMeet.set(key, []);
    byMeet.get(key)!.push(r);
  }

  return (
    <div>
      <h2 className="text-[#0C1116] font-bold mb-4">Results</h2>
      <div className="flex flex-col gap-6">
        {[...byMeet.entries()].map(([meetName, rows]) => (
          <div key={meetName}>
            <p className="text-[#0C1116] font-semibold mb-2">
              {meetName}{" "}
              <span className="text-xs text-[#7A8296] font-normal">
                {rows[0]?.meets?.meet_date ? formatShortDate(rows[0].meets.meet_date) : ""}
              </span>
            </p>
            <div className="flex flex-col gap-1">
              {rows.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between text-sm rounded-[var(--radius-sm)] px-3 py-2 bg-white"
                >
                  <span className="text-[#0C1116]">
                    {r.swimmers.first_name} {r.swimmers.last_name}
                  </span>
                  <span className="text-[#7A8296]">{r.event}</span>
                  <span className="text-[#0C1116] font-semibold">{r.time_text}</span>
                  <span className="text-[#7A8296]">{r.place ? `#${r.place}` : "—"}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
        {results.length === 0 && (
          <p className="text-sm text-[#7A8296]">No results recorded yet for this squad.</p>
        )}
      </div>
    </div>
  );
}
