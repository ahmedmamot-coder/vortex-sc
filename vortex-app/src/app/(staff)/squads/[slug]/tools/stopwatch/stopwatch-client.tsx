"use client";

import { useEffect, useRef, useState } from "react";
import {
  type Lap,
  formatStopwatch,
  recordLap,
  lapExtremes,
  totalStrokes,
  averageStrokes,
} from "@/lib/stopwatch";
import StopwatchIcon from "./stopwatch-icon";

export default function StopwatchClient({ accent }: { accent: string }) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [running, setRunning] = useState(false);
  const [laps, setLaps] = useState<Lap[]>([]);
  const [strokes, setStrokes] = useState(0);

  // Accumulated time before the current run, and the timestamp the current run
  // began. Kept in refs so ticking never goes stale between renders and the
  // clock stays accurate across pause/resume.
  const baseRef = useRef(0);
  const startRef = useRef(0);

  useEffect(() => {
    if (!running) return;
    startRef.current = performance.now();
    let raf = 0;
    const loop = () => {
      setElapsedMs(baseRef.current + (performance.now() - startRef.current));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      baseRef.current += performance.now() - startRef.current;
      setElapsedMs(baseRef.current);
    };
  }, [running]);

  // The exact elapsed time right now, whether or not a frame has ticked yet.
  function nowMs() {
    return running ? baseRef.current + (performance.now() - startRef.current) : baseRef.current;
  }

  function toggle() {
    setRunning((v) => !v);
  }

  function reset() {
    setRunning(false);
    baseRef.current = 0;
    setElapsedMs(0);
    setLaps([]);
    setStrokes(0);
  }

  function lap() {
    if (nowMs() <= 0) return;
    setLaps((prev) => [...prev, recordLap(prev, Math.round(nowMs()), strokes)]);
    setStrokes(0);
  }

  const started = elapsedMs > 0 || running || laps.length > 0;
  const { fastest, slowest } = lapExtremes(laps);
  const strokeTotal = totalStrokes(laps) + strokes;
  const strokeAvg = averageStrokes(laps);

  // Progress ring sweeps once per minute — a simple visual pulse for the second hand.
  const ringPct = ((elapsedMs / 1000) % 60) / 60;
  const C = 2 * Math.PI * 45;

  return (
    <div>
      {/* Clock face */}
      <div className="flex flex-col items-center mb-6">
        <div className="relative w-56 h-56 mb-4">
          <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
            <circle cx="50" cy="50" r="45" fill="none" stroke="#E5E9F0" strokeWidth="5" />
            <circle
              cx="50"
              cy="50"
              r="45"
              fill="none"
              stroke={accent}
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={`${C}`}
              strokeDashoffset={`${C * (1 - ringPct)}`}
              style={{ transition: running ? "none" : "stroke-dashoffset 0.2s linear" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <StopwatchIcon size={22} color="#7A8296" className="mb-1" />
            <span className="text-4xl font-bold text-[#0C1116] tabular-nums tracking-tight">
              {formatStopwatch(elapsedMs)}
            </span>
            <span className="text-xs text-[#7A8296] mt-1">
              {laps.length > 0 ? `lap ${laps.length + 1}` : running ? "running" : "ready"}
            </span>
          </div>
        </div>

        {/* Primary controls */}
        <div className="flex gap-2">
          <button
            onClick={toggle}
            className="px-6 py-2 rounded-[var(--radius-pill)] font-semibold text-white"
            style={{ background: running ? "var(--vx-warning)" : "var(--vx-success)" }}
          >
            {running ? "Pause" : started ? "Resume" : "Start"}
          </button>
          <button
            onClick={lap}
            disabled={!started}
            className="px-6 py-2 rounded-[var(--radius-pill)] font-semibold text-white disabled:opacity-40"
            style={{ background: accent }}
          >
            Lap
          </button>
          <button
            onClick={reset}
            disabled={!started}
            className="px-6 py-2 rounded-[var(--radius-pill)] font-semibold text-[#0C1116] border border-[#E5E9F0] disabled:opacity-40"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Stroke counter for the current (in-progress) lap */}
      <div className="rounded-[var(--radius-md)] bg-white border border-[#E5E9F0] p-3 mb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[#0C1116] font-semibold text-sm">Strokes this lap</p>
            <p className="text-xs text-[#7A8296]">Tallied onto the next lap you record</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setStrokes((s) => Math.max(0, s - 1))}
              disabled={strokes === 0}
              className="w-9 h-9 rounded-[var(--radius-pill)] border border-[#E5E9F0] text-[#0C1116] font-bold text-lg leading-none disabled:opacity-40"
              aria-label="Remove a stroke"
            >
              −
            </button>
            <span className="text-2xl font-bold text-[#0C1116] tabular-nums w-8 text-center">
              {strokes}
            </span>
            <button
              onClick={() => setStrokes((s) => s + 1)}
              className="w-9 h-9 rounded-[var(--radius-pill)] text-white font-bold text-lg leading-none"
              style={{ background: accent }}
              aria-label="Add a stroke"
            >
              +
            </button>
          </div>
        </div>
      </div>

      {/* Summary stats */}
      {laps.length > 0 && (
        <div className="grid grid-cols-3 gap-2 mb-4">
          <Stat label="Laps" value={String(laps.length)} />
          <Stat label="Strokes" value={String(strokeTotal)} />
          <Stat label="Avg / lap" value={strokeAvg > 0 ? String(strokeAvg) : "—"} />
        </div>
      )}

      {/* Laps & splits */}
      {laps.length > 0 ? (
        <div className="rounded-[var(--radius-md)] bg-white border border-[#E5E9F0] overflow-hidden">
          <div className="grid grid-cols-[auto_1fr_1fr_auto] gap-2 px-3 py-2 text-[11px] font-semibold uppercase text-[#7A8296] border-b border-[#E5E9F0]" style={{ letterSpacing: ".06em" }}>
            <span>Lap</span>
            <span>Split</span>
            <span>Total</span>
            <span className="text-right">Strokes</span>
          </div>
          {[...laps].reverse().map((l) => {
            const idx = l.n - 1;
            const isFastest = idx === fastest;
            const isSlowest = idx === slowest;
            return (
              <div
                key={l.n}
                className="grid grid-cols-[auto_1fr_1fr_auto] gap-2 px-3 py-2 text-sm border-b border-[#F1F3F8] last:border-b-0"
              >
                <span className="text-[#7A8296] tabular-nums w-6">{l.n}</span>
                <span
                  className="tabular-nums font-semibold"
                  style={{
                    color: isFastest ? "var(--vx-success)" : isSlowest ? "var(--vx-danger)" : "#0C1116",
                  }}
                >
                  {formatStopwatch(l.splitMs)}
                  {isFastest && <span className="text-[10px] font-normal ml-1">fastest</span>}
                  {isSlowest && <span className="text-[10px] font-normal ml-1">slowest</span>}
                </span>
                <span className="tabular-nums text-[#4A5568]">{formatStopwatch(l.totalMs)}</span>
                <span className="tabular-nums text-[#0C1116] text-right">
                  {l.strokes > 0 ? l.strokes : "—"}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-[#7A8296]">
          Start the clock, then tap <span className="font-semibold text-[#0C1116]">Lap</span> at each
          wall to capture splits and stroke counts.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-md)] bg-white border border-[#E5E9F0] p-3 text-center">
      <p className="text-2xl font-bold text-[#0C1116] tabular-nums">{value}</p>
      <p className="text-[11px] uppercase text-[#7A8296] mt-0.5" style={{ letterSpacing: ".06em" }}>
        {label}
      </p>
    </div>
  );
}
