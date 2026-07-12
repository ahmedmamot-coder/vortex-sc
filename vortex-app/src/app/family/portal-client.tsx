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
    <div className="flex-1 flex flex-col" style={{ background: "var(--vx-app-bg)" }}>
      <header className="px-5 py-5" style={{ background: "linear-gradient(135deg,#067EEA33,transparent)" }}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-[var(--vx-slate-300)]">
            {account.role === "parent" ? "Parent" : "Swimmer"} · {account.full_name}
          </p>
          <form action={signOut}>
            <button className="text-xs font-semibold text-white/80 border border-white/15 rounded-[var(--radius-pill)] px-3 py-1">
              Sign out
            </button>
          </form>
        </div>
        <h1 className="text-xl font-bold text-white">
          {active.first_name} {active.last_name}
        </h1>
        <p className="text-sm text-[var(--vx-slate-300)]">
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
                  background: s.id === active.id ? "var(--vx-blue)" : "rgba(255,255,255,0.08)",
                  color: "#fff",
                }}
              >
                {s.first_name}
              </Link>
            ))}
          </div>
        )}
      </header>

      <nav className="flex border-b border-white/10 px-5 gap-1">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-3 py-3 text-sm font-semibold whitespace-nowrap"
            style={{ color: tab === t ? "#fff" : "var(--vx-slate-300)" }}
          >
            {t}
          </button>
        ))}
      </nav>

      <div className="px-5 py-5 max-w-2xl mx-auto w-full">
        {tab === "Performance" && (
          <div className="grid grid-cols-2 gap-2">
            {pbs.map((pb) => (
              <div key={pb.id} className="rounded-[var(--radius-md)] bg-white/5 border border-white/10 p-3">
                <p className="text-xs text-[var(--vx-slate-300)]">{pb.event}</p>
                <p className="text-white font-bold">{pb.time_text}</p>
              </div>
            ))}
            {pbs.length === 0 && <p className="text-sm text-[var(--vx-slate-300)]">No recorded PBs.</p>}
          </div>
        )}

        {tab === "Attendance" && (
          <div>
            <p className="text-3xl font-bold text-white mb-1">
              {attendancePct != null ? `${attendancePct}%` : "—"}
            </p>
            <p className="text-sm text-[var(--vx-slate-300)] mb-4">Season attendance</p>
            <div className="flex flex-col gap-1">
              {attendanceHistory.map((a) => (
                <div key={a.id} className="flex items-center justify-between text-sm py-1.5 border-b border-white/5">
                  <span className="text-[var(--vx-slate-300)]">{formatShortDate(a.session_date)}</span>
                  <span style={{ color: a.present ? "var(--vx-success)" : "var(--vx-danger)" }}>
                    {a.present ? "Present" : "Absent"}
                  </span>
                </div>
              ))}
              {attendanceHistory.length === 0 && (
                <p className="text-sm text-[var(--vx-slate-300)]">No attendance recorded yet.</p>
              )}
            </div>
          </div>
        )}

        {tab === "Results" && (
          <div className="flex flex-col gap-1.5">
            {results.map((r, i) => (
              <div key={i} className="flex items-center justify-between text-sm rounded-[var(--radius-sm)] px-3 py-2 bg-white/5">
                <div>
                  <p className="text-white">{r.event}</p>
                  <p className="text-xs text-[var(--vx-slate-300)]">
                    {r.meet_name} · {formatShortDate(r.meet_date)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-white font-semibold">{r.time_text}</p>
                  <p className="text-xs text-[var(--vx-slate-300)]">{r.place ? `#${r.place}` : ""}</p>
                </div>
              </div>
            ))}
            {results.length === 0 && <p className="text-sm text-[var(--vx-slate-300)]">No results yet.</p>}
          </div>
        )}

        {tab === "Meets" && (
          <div className="flex flex-col gap-1.5">
            {upcomingMeets.map((m) => (
              <div key={m.id} className="rounded-[var(--radius-sm)] px-3 py-2 bg-white/5">
                <p className="text-white">{m.name}</p>
                <p className="text-xs text-[var(--vx-slate-300)]">{formatShortDate(m.meet_date)}</p>
              </div>
            ))}
            {upcomingMeets.length === 0 && (
              <p className="text-sm text-[var(--vx-slate-300)]">No upcoming meets scheduled.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
