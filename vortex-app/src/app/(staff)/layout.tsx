import Link from "next/link";
import { redirect } from "next/navigation";
import Image from "next/image";
import { getSession } from "@/lib/auth";
import { signOut } from "@/app/login/actions";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (session.kind !== "staff") redirect("/login");
  const { profile } = session;

  return (
    <div className="flex flex-1 flex-col" style={{ background: "var(--vx-app-bg)" }}>
      <header className="flex items-center justify-between px-5 py-4 border-b border-white/10">
        <Link href="/squads" className="flex items-center gap-2">
          <Image src="/images/vx-mark.png" alt="Vortex" width={28} height={28} />
          <span className="text-white font-bold tracking-tight hidden sm:inline">
            Vortex Swimming Club
          </span>
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-xs text-[var(--vx-slate-300)] capitalize hidden sm:inline">
            {profile.full_name} · {profile.role.replace("_", " ")}
          </span>
          <form action={signOut}>
            <button
              type="submit"
              className="text-xs font-semibold text-white/80 border border-white/15 rounded-[var(--radius-pill)] px-3 py-1.5 hover:bg-white/10"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1 vx-screen">{children}</main>
    </div>
  );
}
