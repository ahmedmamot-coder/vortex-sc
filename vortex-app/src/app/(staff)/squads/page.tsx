import Link from "next/link";
import { getSquads, getSquadCounts } from "@/lib/data/squads";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { signOut } from "@/app/login/actions";

const SQUAD_SLUG_TO_PHOTO: Record<string, string | undefined> = {
  preteam: "/images/vx/coach-fathy.jpg",
  seniorb: "/images/vx/coach-chafik.jpg",
  vortexa: "/images/vx/coach-mahmoud.jpg",
  legend: "/images/vx/coach-martin.jpg",
};

export default async function SquadsHubPage() {
  const session = await getSession();
  if (session.kind !== "staff") redirect("/login");

  const [squads, counts] = await Promise.all([getSquads(), getSquadCounts()]);
  const { profile } = session;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const isAdmin = profile.role === "admin" || profile.role === "head_coach";

  const visibleSquads =
    profile.role === "coach" && profile.squad_id
      ? squads.filter((s) => s.id === profile.squad_id)
      : squads;

  return (
    <div className="relative">
      {/* Dark hero header */}
      <div className="relative overflow-hidden text-white" style={{ background: "#0A0F1A", padding: "8px 22px 46px" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/pattern-source.jpg"
          alt=""
          style={{ position: "absolute", top: -30, right: -40, width: "78%", height: "200%", objectFit: "cover", opacity: 0.55, mixBlendMode: "screen" }}
        />
        <div className="relative flex items-center justify-between pt-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/vx-wordmark-white.png" alt="Vortex SC" style={{ height: 20 }} />
          <form action={signOut}>
            <button
              className="flex items-center justify-center rounded-[11px] text-white"
              style={{ width: 37, height: 37, background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.12)" }}
              title="Sign out"
            >
              ⎋
            </button>
          </form>
        </div>
        <div className="relative mt-5">
          <p className="m-0 text-[11px] font-semibold uppercase" style={{ letterSpacing: ".13em", color: "rgba(255,255,255,.5)" }}>
            {profile.role.replace("_", " ")}
          </p>
          <h1 className="font-bold" style={{ fontSize: 23, letterSpacing: "-.02em", margin: "2px 0 0" }}>
            {profile.full_name}
          </h1>
          <p className="relative m-0 mt-4 text-[13.5px]" style={{ color: "rgba(255,255,255,.62)", lineHeight: 1.4 }}>
            {total} swimmers · {squads.length} squads · season 25/26
          </p>
        </div>
      </div>

      {/* Body */}
      <div className="relative z-[1] flex flex-col gap-4" style={{ padding: "16px 15px 28px", marginTop: -16 }}>
        {isAdmin && (
          <div className="grid grid-cols-2 gap-2.5">
            <Link
              href="/admin"
              className="vx-card col-span-2 flex items-center gap-3 p-4"
              style={{ border: "1px solid #E5E9F0" }}
            >
              <span className="flex items-center justify-center flex-none rounded-[13px]" style={{ width: 46, height: 46, background: "var(--vx-blue-tint)", color: "var(--vx-blue)", fontSize: 22 }}>🏛</span>
              <span className="flex-1">
                <span className="block font-bold text-[15px] text-[#0C1116]">Club Administration</span>
                <span className="block text-[12.5px] text-[#7A8296] mt-0.5">Swimmers · meets · staff · academy</span>
              </span>
              <span className="text-[#AEB6C7]">→</span>
            </Link>
          </div>
        )}

        <div>
          <div className="flex items-baseline justify-between mb-2.5 px-1">
            <h2 className="m-0 font-bold uppercase text-[11.5px] text-[#7A8296]" style={{ letterSpacing: ".11em" }}>
              {visibleSquads.length === squads.length ? "The 9 squads" : "Your squad"}
            </h2>
            <span className="text-[11.5px] text-[#9AA2B4]">Tap to coach</span>
          </div>
          <div className="flex flex-col gap-2">
            {visibleSquads.map((sq) => {
              const photo = SQUAD_SLUG_TO_PHOTO[sq.slug];
              return (
                <Link
                  key={sq.id}
                  href={`/squads/${sq.slug}`}
                  className="flex items-center gap-3 w-full bg-white rounded-[15px] px-3 py-2.5"
                  style={{ border: "1px solid #E5E9F0", boxShadow: "0 2px 7px rgba(11,20,40,.05)" }}
                >
                  <span
                    className="flex items-center justify-center flex-none rounded-[12px] overflow-hidden text-white font-bold"
                    style={{ width: 44, height: 44, background: sq.accent_color }}
                  >
                    {photo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />
                    ) : (
                      sq.name.slice(0, 2)
                    )}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-bold text-[14.5px] text-[#0C1116]">{sq.name}</span>
                    <span className="block text-[12px] text-[#7A8296]">
                      Ages {sq.age_range} · {sq.coach_name}
                    </span>
                  </span>
                  <span className="text-right flex-none mr-0.5">
                    <span className="block font-bold text-[16px] text-[#0C1116] leading-none">{counts[sq.id] || 0}</span>
                    <span className="block text-[9.5px] uppercase text-[#9AA2B4] mt-0.5" style={{ letterSpacing: ".06em" }}>
                      swimmers
                    </span>
                  </span>
                  <span className="text-[#C7CDDA]">›</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
