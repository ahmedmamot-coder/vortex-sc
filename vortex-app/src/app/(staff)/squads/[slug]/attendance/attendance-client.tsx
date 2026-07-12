"use client";

import { useTransition } from "react";
import type { Squad, Swimmer, Attendance } from "@/lib/types";
import type { AttendanceSummary } from "@/lib/data/attendance";
import { markAttendance } from "./actions";

export default function AttendanceClient({
  slug,
  squad,
  swimmers,
  today,
  todayRecords,
  recentDates,
  summary,
}: {
  slug: string;
  squad: Squad;
  swimmers: Swimmer[];
  today: string;
  todayRecords: Attendance[];
  recentDates: { raw: string; label: string }[];
  summary: AttendanceSummary;
}) {
  const [, startTransition] = useTransition();
  const byId = new Map(todayRecords.map((r) => [r.swimmer_id, r.present]));

  const presentCount = todayRecords.filter((r) => r.present).length;
  const monthName = new Date().toLocaleDateString("en-GB", { month: "long" });
  const year = new Date().getFullYear();

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[#0C1116] font-bold">Attendance</h2>
        <span className="text-sm text-[#7A8296]">
          Today · {presentCount}/{swimmers.length} present
        </span>
      </div>

      {/* Monthly & yearly summary */}
      <div className="grid grid-cols-2 gap-2 mb-6">
        <div className="rounded-[var(--radius-lg)] bg-white p-4" style={{ border: "1px solid #E5E9F0" }}>
          <p className="text-xs text-[#7A8296]">{monthName} attendance</p>
          <p className="text-2xl font-bold text-[#0C1116]">
            {summary.monthPct != null ? `${summary.monthPct}%` : "—"}
          </p>
          <p className="text-[11px] text-[#9AA2B4]">
            {summary.monthPresent}/{summary.monthTotal} marks
          </p>
        </div>
        <div className="rounded-[var(--radius-lg)] bg-white p-4" style={{ border: "1px solid #E5E9F0" }}>
          <p className="text-xs text-[#7A8296]">{year} attendance</p>
          <p className="text-2xl font-bold text-[#0C1116]">
            {summary.yearPct != null ? `${summary.yearPct}%` : "—"}
          </p>
          <p className="text-[11px] text-[#9AA2B4]">
            {summary.yearPresent}/{summary.yearTotal} marks
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1 mb-6">
        {swimmers.map((s) => {
          const present = byId.get(s.id);
          return (
            <div key={s.id} className="flex items-center justify-between rounded-[var(--radius-md)] px-3 py-2 hover:bg-white">
              <span className="text-[#0C1116] text-sm">
                {s.first_name} {s.last_name}
              </span>
              <div className="flex gap-1.5">
                <button
                  onClick={() =>
                    startTransition(() => markAttendance(slug, squad.id, s.id, today, true))
                  }
                  className="px-3 py-1 rounded-[var(--radius-pill)] text-xs font-semibold"
                  style={{
                    background: present === true ? "var(--vx-success)" : "#EEF1F5",
                    color: present === true? "#fff" : "#4A5568",
                  }}
                >
                  Present
                </button>
                <button
                  onClick={() =>
                    startTransition(() => markAttendance(slug, squad.id, s.id, today, false))
                  }
                  className="px-3 py-1 rounded-[var(--radius-pill)] text-xs font-semibold"
                  style={{
                    background: present === false ? "var(--vx-danger)" : "#EEF1F5",
                    color: present === false? "#fff" : "#4A5568",
                  }}
                >
                  Absent
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <h3 className="text-[#0C1116] font-bold mb-2 text-sm">Recent sessions</h3>
      <div className="flex flex-wrap gap-2">
        {recentDates.map((d) => (
          <span
            key={d.raw}
            className="px-3 py-1.5 rounded-[var(--radius-pill)] text-xs bg-white border border-[#E5E9F0] text-[#7A8296]"
          >
            {d.label}
          </span>
        ))}
        {recentDates.length === 0 && (
          <p className="text-sm text-[#7A8296]">No sessions recorded yet.</p>
        )}
      </div>
    </div>
  );
}
