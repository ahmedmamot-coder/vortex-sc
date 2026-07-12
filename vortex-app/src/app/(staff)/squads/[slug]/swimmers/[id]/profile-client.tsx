"use client";

import { useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Dot,
} from "recharts";
import type { Swimmer, Squad, PersonalBest, Course } from "@/lib/types";
import { formatTime, formatShortDate, DOT_COLORS } from "@/lib/format";

type ResultRow = {
  event: string;
  course: Course;
  seconds: number | null;
  time_text: string;
  place: number | null;
  meet_name: string;
  meet_date: string;
};

export default function SwimmerProfileClient({
  swimmer,
  squad,
  pbs,
  results,
}: {
  swimmer: Swimmer;
  squad: Squad;
  pbs: PersonalBest[];
  results: ResultRow[];
}) {
  const [course, setCourse] = useState<Course>("L");

  const eventsForCourse = useMemo(() => {
    const set = new Set(results.filter((r) => r.course === course).map((r) => r.event));
    return [...set];
  }, [results, course]);

  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const activeEvent = selectedEvent && eventsForCourse.includes(selectedEvent)
    ? selectedEvent
    : eventsForCourse[0] ?? null;

  const series = useMemo(() => {
    if (!activeEvent) return [];
    return results
      .filter((r) => r.course === course && r.event === activeEvent && r.seconds != null)
      .sort((a, b) => new Date(a.meet_date).getTime() - new Date(b.meet_date).getTime())
      .map((r, i) => ({
        idx: i,
        seconds: r.seconds!,
        label: formatTime(r.seconds),
        date: formatShortDate(r.meet_date),
        meet: r.meet_name,
        color: DOT_COLORS[i % DOT_COLORS.length],
      }));
  }, [results, course, activeEvent]);

  const best = series.length ? Math.min(...series.map((s) => s.seconds)) : null;

  return (
    <div className="px-4 py-5 max-w-3xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <div
          className="w-16 h-16 rounded-[16px] flex items-center justify-center text-white text-xl font-bold relative"
          style={{ background: squad.accent_color }}
        >
          {swimmer.first_name[0]}
          {swimmer.last_name[0]}
          <span
            className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center text-xs bg-white border-2 border-white shadow"
            style={{ color: swimmer.gender === "Girls" ? "#E5497D" : "#2A63E0" }}
          >
            {swimmer.gender === "Girls" ? "♀" : "♂"}
          </span>
        </div>
        <div>
          <h1 className="text-xl font-bold text-[#0C1116]">
            {swimmer.first_name} {swimmer.last_name}
          </h1>
          <p className="text-sm text-[#7A8296]">
            {squad.name} · Age {swimmer.age}
          </p>
        </div>
      </div>

      <h2 className="text-[#0C1116] font-bold mb-2">Personal Bests</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-8">
        {pbs.map((pb) => (
          <div key={pb.id} className="rounded-[var(--radius-md)] bg-white p-3" style={{ border: "1px solid #E5E9F0" }}>
            <p className="text-xs text-[#7A8296]">
              {pb.event} · {pb.course === "L" ? "LCM" : "SCM"}
            </p>
            <p className="text-[#0C1116] font-bold">{pb.time_text}</p>
            {pb.drop_text && <p className="text-xs text-[var(--vx-success)]">{pb.drop_text}</p>}
          </div>
        ))}
        {pbs.length === 0 && (
          <p className="text-sm text-[#7A8296] col-span-full">No recorded PBs.</p>
        )}
      </div>

      <div className="flex rounded-[var(--radius-md)] overflow-hidden mb-4 w-fit" style={{ border: "1px solid #E5E9F0" }}>
        {(["L", "S"] as Course[]).map((c) => (
          <button
            key={c}
            onClick={() => {
              setCourse(c);
              setSelectedEvent(null);
            }}
            className="px-4 py-2 text-sm font-semibold"
            style={{
              background: course === c ? "var(--vx-blue)" : "transparent",
              color: course === c ? "#fff" : "#7A8296",
            }}
          >
            {c === "L" ? "Long Course" : "Short Course"}
          </button>
        ))}
      </div>

      <div className="flex gap-2 flex-wrap mb-4">
        {eventsForCourse.map((ev) => (
          <button
            key={ev}
            onClick={() => setSelectedEvent(ev)}
            className="px-3 py-1.5 rounded-[var(--radius-pill)] text-xs font-semibold"
            style={{
              background: ev === activeEvent ? squad.accent_color : "#EEF1F5",
              color: ev === activeEvent ? "#fff" : "#4A5568",
            }}
          >
            {ev}
          </button>
        ))}
        {eventsForCourse.length === 0 && (
          <p className="text-sm text-[#7A8296]">
            No recorded swims for this course.
          </p>
        )}
      </div>

      {series.length > 0 && (
        <div className="rounded-[var(--radius-lg)] bg-white p-4 mb-4" style={{ border: "1px solid #E5E9F0" }}>
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-[#0C1116] font-bold">{activeEvent}</p>
            {best != null && (
              <p className="text-sm text-[var(--vx-success)] font-semibold">
                Best {formatTime(best)}
              </p>
            )}
          </div>
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer>
              <LineChart data={series} margin={{ top: 20, right: 10, left: 0, bottom: 0 }}>
                <XAxis dataKey="date" tick={{ fill: "#8A97AD", fontSize: 11 }} />
                <YAxis reversed hide domain={["dataMin - 1", "dataMax + 1"]} />
                <Tooltip
                  contentStyle={{ background: "#12182B", border: "none", borderRadius: 8 }}
                  labelStyle={{ color: "#fff" }}
                  formatter={(_, __, entry) => [entry.payload.label, entry.payload.meet]}
                />
                <Line
                  type="monotone"
                  dataKey="seconds"
                  stroke="#3B82F6"
                  strokeWidth={2}
                  dot={(props: { cx?: number; cy?: number; payload?: { color?: string } }) => (
                    <Dot
                      key={`dot-${props.cx}-${props.cy}`}
                      cx={props.cx}
                      cy={props.cy}
                      r={5}
                      fill={props.payload?.color ?? "#3B82F6"}
                      stroke="#fff"
                    />
                  )}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="flex flex-col gap-1.5 mt-3">
            {[...series].reverse().map((s, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
                <span className="text-[#7A8296] flex-1">
                  {s.date} · {s.meet}
                </span>
                <span
                  className="font-semibold"
                  style={{ color: s.seconds === best ? "var(--vx-success)" : "#0C1116" }}
                >
                  {s.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
