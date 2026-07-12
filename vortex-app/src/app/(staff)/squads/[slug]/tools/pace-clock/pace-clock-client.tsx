"use client";

import { useEffect, useRef, useState } from "react";

type PlanSet = {
  id: string;
  section: string;
  distance: number;
  description: string;
  rest: string | null;
};

// Parse a rest string like "@1:30" or "0:45" or "30s" into seconds.
function parseInterval(rest: string | null): number {
  if (!rest) return 60;
  const cleaned = rest.replace(/[@\s]/g, "");
  if (cleaned.includes(":")) {
    const [m, s] = cleaned.split(":");
    return Number(m) * 60 + Number(s || 0);
  }
  const n = parseInt(cleaned, 10);
  return Number.isNaN(n) ? 60 : n;
}

export default function PaceClockClient({ sets, accent }: { sets: PlanSet[]; accent: string }) {
  const [index, setIndex] = useState(0);
  const [remaining, setRemaining] = useState(() => (sets[0] ? parseInterval(sets[0].rest) : 60));
  const [running, setRunning] = useState(false);
  const [reps, setReps] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const current = sets[index];
  const total = current ? parseInterval(current.rest) : 60;

  useEffect(() => {
    if (running) {
      timer.current = setInterval(() => {
        setRemaining((r) => {
          if (r <= 1) {
            setReps((n) => n + 1);
            return total;
          }
          return r - 1;
        });
      }, 1000);
    }
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [running, total]);

  function selectSet(i: number) {
    setIndex(i);
    setRemaining(parseInterval(sets[i].rest));
    setReps(0);
    setRunning(false);
  }

  const pct = total ? (remaining / total) * 100 : 0;
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;

  if (sets.length === 0) {
    return <p className="text-sm text-[var(--vx-slate-300)]">Add sets to the plan first.</p>;
  }

  return (
    <div>
      <div className="flex flex-col items-center mb-6">
        <div className="relative w-52 h-52 mb-4">
          <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
            <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
            <circle
              cx="50"
              cy="50"
              r="45"
              fill="none"
              stroke={accent}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 45}`}
              strokeDashoffset={`${2 * Math.PI * 45 * (1 - pct / 100)}`}
              style={{ transition: "stroke-dashoffset 1s linear" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-4xl font-bold text-white tabular-nums">
              {mins}:{String(secs).padStart(2, "0")}
            </span>
            <span className="text-xs text-[var(--vx-slate-300)] mt-1">rep {reps}</span>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setRunning((v) => !v)}
            className="px-5 py-2 rounded-[var(--radius-pill)] font-semibold text-white"
            style={{ background: running ? "var(--vx-warning)" : "var(--vx-success)" }}
          >
            {running ? "Pause" : "Start"}
          </button>
          <button
            onClick={() => selectSet(index)}
            className="px-5 py-2 rounded-[var(--radius-pill)] font-semibold text-white border border-white/20"
          >
            Reset
          </button>
        </div>
      </div>

      <p className="text-white font-semibold mb-2">
        {current.section} · {current.distance}m
      </p>
      <p className="text-sm text-[var(--vx-slate-300)] mb-4">{current.description}</p>

      <div className="flex flex-col gap-1">
        {sets.map((s, i) => (
          <button
            key={s.id}
            onClick={() => selectSet(i)}
            className="flex items-center justify-between text-left rounded-[var(--radius-sm)] px-3 py-2 text-sm"
            style={{ background: i === index ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.03)" }}
          >
            <span className="text-white">
              {s.distance}m · {s.description}
            </span>
            <span className="text-xs text-[var(--vx-slate-300)]">{s.rest || "—"}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
