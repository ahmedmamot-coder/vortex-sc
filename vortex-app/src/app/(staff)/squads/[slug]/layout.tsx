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
      {/* Dark squad header, tinted with the squad accent */}
      <div
        className="relative overflow-hidden text-white"
        style={{ background: "#0A0F1A", padding: "10px 20px 20px" }}
      >
        <div
          className="absolute inset-0"
          style={{ background: `linear-gradient(135deg, ${squad.accent_color}55, transparent 60%)` }}
        />
        <div className="relative flex items-center gap-3">
          <Link
            href="/squads"
            className="flex items-center justify-center rounded-[11px] flex-none"
            style={{ width: 37, height: 37, background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.14)" }}
          >
            ‹
          </Link>
          <div>
            <p className="m-0 text-[11px] uppercase" style={{ letterSpacing: ".12em", color: "rgba(255,255,255,.5)" }}>
              Ages {squad.age_range}
            </p>
            <h1 className="font-bold m-0" style={{ fontSize: 22, letterSpacing: "-.02em" }}>
              {squad.name}
            </h1>
            <p className="m-0 text-[12.5px]" style={{ color: "rgba(255,255,255,.6)" }}>
              {squad.coach_name}
            </p>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <nav
        className="flex gap-1 overflow-x-auto vx-scroll px-3 bg-white"
        style={{ borderBottom: "1px solid #E5E9F0" }}
      >
        {tabs.map((t) => (
          <Link
            key={t.label}
            href={`/squads/${slug}${t.href}`}
            className="px-3 py-3 text-[13px] font-semibold whitespace-nowrap text-[#7A8296]"
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="px-4 py-5">{children}</div>
    </div>
  );
}
