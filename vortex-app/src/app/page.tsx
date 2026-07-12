import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export default async function Home() {
  const session = await getSession();
  if (session.kind === "staff") redirect("/squads");
  if (session.kind === "family") redirect("/family");

  return (
    <div className="vx-frame">
      <div
        className="relative flex flex-col min-h-dvh text-white"
        style={{ background: "#0A0F1A" }}
      >
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: "url(/images/hero-dive.jpg)",
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
        <div className="vx-hero-overlay" />

        <div className="relative flex flex-col h-full px-7 pt-16 pb-8 flex-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/vx-mark.png" alt="Vortex" style={{ width: 52, height: 52 }} />
          <h1
            className="font-bold mt-5 mb-1"
            style={{ fontSize: 31, letterSpacing: "-0.02em", lineHeight: 1.04 }}
          >
            Welcome back.
          </h1>
          <p
            className="m-0 text-[14px]"
            style={{ color: "rgba(255,255,255,.6)", lineHeight: 1.45, maxWidth: 272 }}
          >
            Vortex SC — squad management for the technical team, coaches &amp; families.
          </p>

          <div className="mt-auto flex flex-col gap-3">
            <Link
              href="/login"
              className="rounded-[16px] px-4 py-4 font-semibold text-white text-center"
              style={{ background: "var(--vx-blue)", boxShadow: "var(--shadow-brand)" }}
            >
              Staff sign in
            </Link>
            <Link
              href="/family/login"
              className="vx-glass rounded-[16px] px-4 py-4 font-semibold text-center text-white flex items-center justify-center gap-2"
            >
              Parent or swimmer? Sign in / register
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
