import Link from "next/link";
import { notFound } from "next/navigation";
import { getSquadBySlug } from "@/lib/data/squads";

export default async function SquadLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const squad = await getSquadBySlug(slug);
  if (!squad) notFound();

  const tabs = [
    { href: "", label: "Roster" },
    { href: "/plans", label: "Plans" },
    { href: "/attendance", label: "Attend" },
    { href: "/results", label: "Results" },
    { href: "/tools", label: "More" },
  ];

  return (
    <div>
      <div
        className="px-5 py-5"
        style={{ background: `linear-gradient(135deg, ${squad.accent_color}33, transparent)` }}
      >
        <p className="text-xs text-[var(--vx-slate-300)]">Ages {squad.age_range}</p>
        <h1 className="text-2xl font-bold text-white">{squad.name}</h1>
        <p className="text-sm text-[var(--vx-slate-300)]">{squad.coach_name}</p>
      </div>
      <nav className="flex border-b border-white/10 px-5 gap-1 overflow-x-auto vx-scroll">
        {tabs.map((t) => (
          <Link
            key={t.label}
            href={`/squads/${slug}${t.href}`}
            className="px-3 py-3 text-sm font-semibold text-[var(--vx-slate-300)] hover:text-white whitespace-nowrap border-b-2 border-transparent"
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <div className="px-5 py-5 max-w-3xl mx-auto">{children}</div>
    </div>
  );
}
