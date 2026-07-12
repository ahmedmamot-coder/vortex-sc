"use client";

import Link from "next/link";
import { useState } from "react";
import type { Swimmer, PersonalBest, FamilyAccount, Attendance, Meet } from "@/lib/types";
import { formatShortDate } from "@/lib/format";
import { signOut } from "@/app/login/actions";

type ResultRow = {
  event: string;
  time_text: string;
  place: number | null;
  meet_name: string;
  meet_date: string;
};

const TABS = ["Performance", "Attendance", "Results", "Meets"] as const;

export default function FamilyPortalClient({
  account,
  linked,
  active,
  pbs,
  results,
  attendancePct,
  attendanceHistory,
  upcomingMeets,
}: {
  account: FamilyAccount;
  linked: (Swimmer & { squads: { name: string; coach_name: string } })[];
  active: Swimmer & { squads: { name: string; coach_name: string } };
  pbs: PersonalBest[];
  results: ResultRow[];
  attendancePct: number | null;
  attendanceHistory: Attendance[];
  upcomingMeets: Meet[];
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Performance");

  return (
    <div className="vx-frame">
      <header className="px-5 py-5 text-white" style={{ background: "#0A0F1A" }}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs" style={{ color: "rgba(255,255,255,.55)" }}>
            {account.role === "parent" ? "Parent" : "Swimmer"} · {account.full_name}
          </p>
          <form action={signOut}>
            <button
              className="text-xs font-semibold rounded-[var(--radius-pill)] px-3 py-1"
              style={{ color: "#fff", border: "1px solid rgba(255,255,255,.16)" }}
            >
              Sign out
            </button>
          </form>
        </div>
        <h1 className="text-xl font-bold text-white">
          {active.first_name} {active.last_name}
        </h1>
        <p className="text-sm" style={{ color: "rgba(255,255,255,.6)" }}>
          {active.squads.name} · {active.squads.coach_name}
        </p>

        {linked.length > 1 && (
          <div className="flex gap-2 mt-3 flex-wrap">
            {linked.map((s) => (
              <Link
                key={s.id}
                href={`/family?child=${s.id}`}
                className="text-xs px-3 py-1.5 rounded-[var(--radius-pill)]"
                style={{
                  background: s.id === active.id ? "var(--vx-blue)" : "rgba(255,255,255,0.1)",
                  color: "#fff",
                }}
              >
                {s.first_name}
              </Link>
            ))}
          </div>
        )}
      </header>

      <nav className="flex border-b border-[#E5E9F0] px-5 gap-1 bg-white">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-3 py-3 text-sm font-semibold whitespace-nowrap"
            style={{
              color: tab === t ? "#0C1116" : "#7A8296",
              borderBottom: tab === t ? "2px solid var(--vx-blue)" : "2px solid transparent",
            }}
          >
            {t}
          </button>
        ))}
      </nav>

      <div className="px-5 py-5 max-w-2xl mx-auto w-full">
        {tab === "Performance" && (
          <div className="grid grid-cols-2 gap-2">
            {pbs.map((pb) => (
              <div key={pb.id} className="rounded-[var(--radius-md)] bg-white border border-[#E5E9F0] p-3">
                <p className="text-xs text-[#7A8296]">{pb.event}</p>
                <p className="text-[#0C1116] font-bold">{pb.time_text}</p>
              </div>
            ))}
            {pbs.length === 0 && <p className="text-sm text-[#7A8296]">No recorded PBs.</p>}
          </div>
        )}

        {tab === "Attendance" && (
          <div>
            <p className="text-3xl font-bold text-[#0C1116] mb-1">
              {attendancePct != null ? `${attendancePct}%` : "—"}
            </p>
            <p className="text-sm text-[#7A8296] mb-4">Season attendance</p>
            <div className="flex flex-col gap-1">
              {attendanceHistory.map((a) => (
                <div key={a.id} className="flex items-center justify-between text-sm py-1.5 border-b border-white/5">
                  <span className="text-[#7A8296]">{formatShortDate(a.session_date)}</span>
                  <span style={{ color: a.present ? "var(--vx-success)" : "var(--vx-danger)" }}>
                    {a.present ? "Present" : "Absent"}
                  </span>
                </div>
              ))}
              {attendanceHistory.length === 0 && (
                <p className="text-sm text-[#7A8296]">No attendance recorded yet.</p>
              )}
            </div>
          </div>
        )}

        {tab === "Results" && (
          <div className="flex flex-col gap-1.5">
            {results.map((r, i) => (
              <div key={i} className="flex items-center justify-between text-sm rounded-[var(--radius-sm)] px-3 py-2 bg-white">
                <div>
                  <p className="text-[#0C1116]">{r.event}</p>
                  <p className="text-xs text-[#7A8296]">
                    {r.meet_name} · {formatShortDate(r.meet_date)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[#0C1116] font-semibold">{r.time_text}</p>
                  <p className="text-xs text-[#7A8296]">{r.place ? `#${r.place}` : ""}</p>
                </div>
              </div>
            ))}
            {results.length === 0 && <p className="text-sm text-[#7A8296]">No results yet.</p>}
          </div>
        )}

        {tab === "Meets" && (
          <div className="flex flex-col gap-1.5">
            {upcomingMeets.map((m) => (
              <div key={m.id} className="rounded-[var(--radius-sm)] px-3 py-2 bg-white">
                <p className="text-[#0C1116]">{m.name}</p>
                <p className="text-xs text-[#7A8296]">{formatShortDate(m.meet_date)}</p>
              </div>
            ))}
            {upcomingMeets.length === 0 && (
              <p className="text-sm text-[#7A8296]">No upcoming meets scheduled.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
