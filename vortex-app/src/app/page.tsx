import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import Image from "next/image";

export default async function Home() {
  const session = await getSession();
  if (session.kind === "staff") redirect("/squads");
  if (session.kind === "family") redirect("/family");

  return (
    <div
      className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center"
      style={{ background: "var(--vx-app-bg)" }}
    >
      <Image src="/images/vx-mark.png" alt="Vortex" width={72} height={72} className="mb-6" />
      <h1 className="text-3xl font-bold text-white mb-2">Vortex Swimming Club</h1>
      <p className="text-[var(--vx-slate-300)] mb-10 max-w-sm">
        Coaching, roster, plans, results and family access — all in one place.
      </p>
      <div className="flex flex-col gap-3 w-full max-w-xs">
        <Link
          href="/login"
          className="rounded-[var(--radius-md)] px-5 py-3 font-semibold text-white text-center"
          style={{ background: "var(--vx-blue)" }}
        >
          Staff sign in
        </Link>
        <Link
          href="/family/login"
          className="rounded-[var(--radius-md)] px-5 py-3 font-semibold text-center border border-white/20 text-white"
        >
          Parent / swimmer sign in
        </Link>
      </div>
    </div>
  );
}
