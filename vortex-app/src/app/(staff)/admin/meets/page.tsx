import { getMeets } from "@/lib/data/meets";
import { formatShortDate } from "@/lib/format";

export default async function AdminMeetsPage() {
  const meets = await getMeets();

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#0C1116] mb-6">Meets</h1>
      <div className="flex flex-col gap-2">
        {meets.map((m) => (
          <div key={m.id} className="rounded-[var(--radius-md)] bg-white border border-[#E5E9F0] px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-[#0C1116] font-semibold">{m.name}</p>
              <p className="text-xs text-[#7A8296]">
                {formatShortDate(m.meet_date)} · {m.course === "L" ? "Long Course" : "Short Course"}
              </p>
            </div>
            <span className="text-xs px-2 py-1 rounded-[var(--radius-pill)] bg-[#EEF1F5] text-[#0C1116] capitalize">
              {m.status.replace("_", " ")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
