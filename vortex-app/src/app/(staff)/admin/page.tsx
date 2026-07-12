import Link from "next/link";
const ROWS = [
  { href: "/admin/swimmers", label: "Swimmers", desc: "Search, edit, add, delete the roster" },
  { href: "/admin/meets", label: "Meets", desc: "Real meet history and results" },
  { href: "/admin/staff", label: "Staff", desc: "Coaches per squad" },
  { href: "/admin/promotions", label: "Promotion engine", desc: "Flag & approve squad move-ups" },
  { href: "/admin/academy", label: "Academy", desc: "Trials intake and fee table" },
  { href: "/admin/settings", label: "Settings", desc: "Club name, zone method, currency" },
];

export default function AdminHome() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">Club Administration</h1>
      <div className="flex flex-col gap-2">
        {ROWS.map((r) => (
          <Link
            key={r.href}
            href={r.href}
            className="rounded-[var(--radius-md)] bg-white/5 border border-white/10 px-4 py-4 hover:border-white/25"
          >
            <p className="text-white font-semibold">{r.label}</p>
            <p className="text-sm text-[var(--vx-slate-300)]">{r.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
