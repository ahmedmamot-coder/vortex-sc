"use client";

import { useTransition } from "react";
import type { Squad, Swimmer, Attendance } from "@/lib/types";
import { markAttendance } from "./actions";

export default function AttendanceClient({
  slug,
  squad,
  swimmers,
  today,
  todayRecords,
  recentDates,
}: {
  slug: string;
  squad: Squad;
  swimmers: Swimmer[];
  today: string;
  todayRecords: Attendance[];
  recentDates: { raw: string; label: string }[];
}) {
  const [, startTransition] = useTransition();
  const byId = new Map(todayRecords.map((r) => [r.swimmer_id, r.present]));

  const presentCount = todayRecords.filter((r) => r.present).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[#0C1116] font-bold">Attendance</h2>
        <span className="text-sm text-[#7A8296]">
          Today · {presentCount}/{swimmers.length} present
        </span>
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
                    background: present === true ? "var(--vx-success)" : "rgba(255,255,255,0.06)",
                    color: "#fff",
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
                    background: present === false ? "var(--vx-danger)" : "rgba(255,255,255,0.06)",
                    color: "#fff",
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
