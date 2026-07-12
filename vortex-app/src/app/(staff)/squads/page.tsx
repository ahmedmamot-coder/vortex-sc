import Link from "next/link";
import { getSquads, getSquadCounts } from "@/lib/data/squads";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function SquadsHubPage() {
  const session = await getSession();
  if (session.kind !== "staff") redirect("/login");

  const [squads, counts] = await Promise.all([getSquads(), getSquadCounts()]);
  const { profile } = session;

  const visibleSquads =
    profile.role === "coach" && profile.squad_id
      ? squads.filter((s) => s.id === profile.squad_id)
      : squads;

  return (
    <div className="px-5 py-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-1">Squads</h1>
      <p className="text-[var(--vx-slate-300)] text-sm mb-6">
        {visibleSquads.length === squads.length
          ? `All ${squads.length} squads`
          : "Your squad"}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {visibleSquads.map((sq) => (
          <Link
            key={sq.id}
            href={`/squads/${sq.slug}`}
            className="rounded-[var(--radius-lg)] p-5 flex flex-col gap-1 border border-white/10 hover:border-white/25 transition-colors"
            style={{
              background: `linear-gradient(135deg, ${sq.accent_color}22, transparent)`,
            }}
          >
            <div className="flex items-center justify-between">
              <span className="text-white font-bold text-lg">{sq.name}</span>
              <span
                className="text-xs font-semibold px-2 py-1 rounded-[var(--radius-pill)]"
                style={{ background: sq.accent_color, color: "#fff" }}
              >
                {counts[sq.id] || 0}
              </span>
            </div>
            <span className="text-sm text-[var(--vx-slate-300)]">Ages {sq.age_range}</span>
            <span className="text-sm text-[var(--vx-slate-300)]">{sq.coach_name}</span>
          </Link>
        ))}
      </div>

      {(profile.role === "admin" || profile.role === "head_coach") && (
        <Link
          href="/admin"
          className="mt-6 inline-block rounded-[var(--radius-md)] px-5 py-3 font-semibold text-white"
          style={{ background: "var(--vx-blue)" }}
        >
          Club Administration
        </Link>
      )}
    </div>
  );
}
