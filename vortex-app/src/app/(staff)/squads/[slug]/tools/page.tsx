import Link from "next/link";
import { ZONE_DEFS } from "@/lib/types";
import { ZONE_GUIDE, SQUAD_ZONE_MATRIX } from "@/lib/zones";

const HANDBOOK = [
  { title: "The Vortex Pathway", body: "Pre-Team → Advanced B/A → Junior → Senior B/A → Vortex B/A → Legend, progressing by age and readiness." },
  { title: "Energy-Zone System", body: "6 zones (EN1–EN3, SP1–SP3) following Maglischo/Olbrecht energy-system principles. Younger squads live in EN1–EN2; layer in EN3 and SP work progressively." },
  { title: "Stroke Technique Cues", body: "Squad-appropriate cues for each stroke, reviewed each block with video where available." },
  { title: "Session Planning", body: "Warm-up → Pre-set → Main set → Cool-down, with equipment and rest specified per set." },
  { title: "Dryland & Land Prep", body: "Activation, strength, core and mobility work scheduled alongside pool sessions." },
  { title: "Meet Operations", body: "Entries, heats/lanes, and on-deck logistics for competition days." },
  { title: "Safety & Wellbeing", body: "Supervision ratios, hydration, injury reporting, and athlete welfare standards." },
  { title: "Communication", body: "Coach-to-family updates via the app feed and the family portal." },
];

const TOOL_TILES = [
  { href: "pace-clock", label: "Pace Clock", desc: "Live poolside countdown from your plan" },
  { href: "plan-review", label: "AI Plan Review", desc: "Rules-based check of the current plan" },
  { href: "t-pace", label: "T-Pace Tests", desc: "Log 400/1000 trials → T-pace/100" },
  { href: "video", label: "Video Analysis", desc: "YouTube/upload, race splits & notes" },
  { href: "inbody", label: "InBody & Nutrition", desc: "Log scans, BMI, calorie/protein targets" },
  { href: "fitness", label: "Fitness Plan", desc: "Dryland: activation, strength, core, mobility" },
  { href: "meets", label: "Meet Management", desc: "Status, heat/lane entries, printable program" },
];

export default async function ToolsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const allowed = SQUAD_ZONE_MATRIX[slug] ?? [];

  return (
    <div>
      <h2 className="text-[#0C1116] font-bold mb-4">Tools &amp; AI</h2>

      <div className="grid grid-cols-2 gap-2 mb-8">
        {TOOL_TILES.map((t) => (
          <Link
            key={t.href}
            href={`/squads/${slug}/tools/${t.href}`}
            className="rounded-[var(--radius-md)] bg-white border border-[#E5E9F0] p-3 hover:border-[#CDD3E2]"
          >
            <p className="text-[#0C1116] font-semibold text-sm">{t.label}</p>
            <p className="text-xs text-[#7A8296] mt-0.5">{t.desc}</p>
          </Link>
        ))}
      </div>

      <section className="mb-8">
        <h3 className="text-[#0C1116] font-semibold mb-3">Zone Engine</h3>
        <p className="text-xs text-[#7A8296] mb-3">
          This squad is cleared to train:{" "}
          <span className="text-[#0C1116] font-semibold">{allowed.join(", ") || "—"}</span>
        </p>
        <div className="flex flex-col gap-2">
          {ZONE_DEFS.map((z) => {
            const g = ZONE_GUIDE[z.id];
            const permitted = allowed.includes(z.id);
            return (
              <div
                key={z.id}
                className="rounded-[var(--radius-md)] bg-white border border-[#E5E9F0] p-3"
                style={{ opacity: permitted ? 1 : 0.45 }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="text-xs font-bold px-2 py-0.5 rounded-[var(--radius-pill)]"
                    style={{ background: z.color, color: "#fff" }}
                  >
                    {z.id}
                  </span>
                  <span className="text-[#0C1116] font-semibold text-sm">{z.name}</span>
                  {!permitted && (
                    <span className="text-[10px] text-[#7A8296] ml-auto">not for this squad</span>
                  )}
                </div>
                <p className="text-xs text-[#7A8296]">
                  {g.pct} · HR {g.hr} · La {g.lactate}
                </p>
                <p className="text-xs text-[#7A8296] mt-1">{g.purpose}</p>
                <p className="text-xs text-[#4A5568] mt-1 italic">e.g. {g.example}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="text-[#0C1116] font-semibold mb-3">Coaches Handbook</h3>
        <div className="flex flex-col gap-2">
          {HANDBOOK.map((h) => (
            <details key={h.title} className="rounded-[var(--radius-md)] bg-white border border-[#E5E9F0] p-3">
              <summary className="text-[#0C1116] font-medium text-sm cursor-pointer">{h.title}</summary>
              <p className="text-xs text-[#7A8296] mt-2">{h.body}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
