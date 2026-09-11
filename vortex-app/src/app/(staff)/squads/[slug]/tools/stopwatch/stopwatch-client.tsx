"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  type Lap,
  formatStopwatch,
  recordLap,
  lapExtremes,
  totalStrokes,
  averageStrokes,
} from "@/lib/stopwatch";
import StopwatchIcon from "./stopwatch-icon";

// The club's logo blues (the azure→indigo of the Vortex "X") and the pale wave
// pattern behind the dark surfaces, so the tool wears the brand rather than an
// arbitrary accent.
const BRAND = "linear-gradient(135deg,#067EEA 0%,#2221D7 100%)";
const PATTERN =
  "radial-gradient(120% 90% at 85% -8%, rgba(6,126,234,.45) 0%, rgba(34,33,215,.2) 38%, transparent 66%), " +
  "url('/assets/pattern-transparent.png') right top/360px auto no-repeat, #0A0F1A";

export default function StopwatchClient({ accent: _accent }: { accent: string }) {
  const accent = "#067EEA"; // solid brand blue (valid as an SVG stroke); Lap buttons use BRAND
  const [elapsedMs, setElapsedMs] = useState(0);
  const [running, setRunning] = useState(false);
  const [laps, setLaps] = useState<Lap[]>([]);
  const [strokes, setStrokes] = useState(0);
  const [soundOn, setSoundOn] = useState(true);
  const [fs, setFs] = useState(false);

  // Accumulated time before the current run, and the timestamp the current run
  // began. Kept in refs so ticking never goes stale between renders and the
  // clock stays accurate across pause/resume.
  const baseRef = useRef(0);
  const startRef = useRef(0);
  const audioRef = useRef<AudioContext | null>(null);
  const fsClockRef = useRef<HTMLDivElement>(null);

  // A loud electronic starting signal, synthesised (no audio file, works offline)
  // in the register of a competition start beep — our own tone, not a recording of
  // any brand's system. Fired on the user's Start tap, the gesture browsers require
  // before a page may play sound.
  function beep() {
    if (!soundOn) return;
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = audioRef.current || (audioRef.current = new AC());
      if (ctx.state === "suspended") ctx.resume();
      const t = ctx.currentTime;
      // A clipped square is already the loudest waveform there is, so extra gain buys nothing. What
      // does is WHERE the energy sits: hearing peaks around 2–4 kHz, and this stack carries ~2.3×
      // the old tone's energy in the 2–5 kHz band. The 1.25 kHz voice keeps it a horn, not a whistle.
      const master = ctx.createGain();
      master.gain.setValueAtTime(1, t);
      master.connect(ctx.destination);
      ([[2500, 1], [1250, 0.7], [3750, 0.5]] as [number, number][]).forEach(([f, peak]) => {
        const o = ctx.createOscillator();
        o.type = "square";
        o.frequency.setValueAtTime(f, t);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
        g.gain.setValueAtTime(peak, t + 0.55);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.78);
        o.connect(g);
        g.connect(master);
        o.start(t);
        o.stop(t + 0.8);
      });
    } catch {
      /* no audio available */
    }
  }

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

  // Keep the full-screen time on screen once it grows a minutes field. The font is sized off the
  // viewport for a big readout, but "1:24.72" is much wider than "24.72" and ran off both edges;
  // shrink to fit the width. Keyed on the character count and the fs state (and window resize), so
  // it only measures on the rare rollover, not every frame.
  const fmtLen = formatStopwatch(elapsedMs).length;
  useLayoutEffect(() => {
    if (!fs) return;
    const fit = () => {
      const el = fsClockRef.current;
      const parent = el?.parentElement;
      if (!el || !parent) return;
      // Intended big size mirrors the CSS min(40vw,60vh); computed here rather than read back from
      // the inline style (clearing that to read it would drop the clock to the 16px default).
      const base = Math.min(0.4 * window.innerWidth, 0.6 * window.innerHeight);
      const cs = getComputedStyle(parent);
      const avail = (parent.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0)) * 0.98;
      const widthFit = avail / ((el.textContent?.length || 1) * 0.62); // monospace ≈ 0.62em/glyph
      el.style.fontSize = Math.floor(Math.max(14, Math.min(base, widthFit))) + "px";
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [fs, fmtLen]);

  // The exact elapsed time right now, whether or not a frame has ticked yet.
  function nowMs() {
    return running ? baseRef.current + (performance.now() - startRef.current) : baseRef.current;
  }

  function toggle() {
    // The start signal fires on the gun (a fresh start from zero), not on every
    // resume after a pause.
    if (!running && baseRef.current === 0) beep();
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

  // Poolside board: fill the whole screen and, where the browser allows it, turn to landscape.
  function enterFs() {
    setFs(true);
    try {
      const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
      (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
    } catch {
      /* fullscreen not permitted */
    }
    try {
      (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })?.lock?.("landscape").catch(() => {});
    } catch {
      /* orientation lock unsupported (e.g. iOS) */
    }
  }
  function exitFs() {
    setFs(false);
    try {
      const d = document as Document & { webkitExitFullscreen?: () => Promise<void> };
      if (document.fullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen)?.call(d);
    } catch {
      /* nothing to exit */
    }
    try {
      (screen.orientation as ScreenOrientation & { unlock?: () => void })?.unlock?.();
    } catch {
      /* no-op */
    }
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
            <span className="text-5xl font-bold text-[#0C1116] tabular-nums tracking-tight">
              {formatStopwatch(elapsedMs)}
            </span>
            <span className="text-xs text-[#7A8296] mt-1">
              {laps.length > 0 ? `lap ${laps.length + 1}` : running ? "running" : "ready"}
            </span>
          </div>
        </div>

        {/* Primary controls: Start/Pause + Sound + Reset on top, then a big full-width Lap. Lap is
            the tap made at every wall, over and over, so it is by far the largest target. */}
        <div className="w-full flex flex-col gap-2.5">
          <div className="flex gap-2.5">
            <button
              onClick={toggle}
              className="flex-1 h-[52px] rounded-[var(--radius-md)] font-semibold text-white"
              style={{ background: running ? "var(--vx-warning)" : "#0A0F1A" }}
            >
              {running ? "Pause" : started ? "Resume" : "Start"}
            </button>
            <button
              onClick={() => setSoundOn((v) => !v)}
              title="Start beep on/off"
              className="w-[52px] h-[52px] rounded-[var(--radius-md)] font-semibold text-[#0C1116] border border-[#E5E9F0]"
            >
              {soundOn ? "🔊" : "🔇"}
            </button>
            <button
              onClick={reset}
              disabled={!started}
              className="w-[52px] h-[52px] rounded-[var(--radius-md)] font-semibold text-[#0C1116] border border-[#E5E9F0] disabled:opacity-40"
            >
              ↺
            </button>
          </div>
          <button
            onClick={lap}
            disabled={!started}
            className="w-full h-[84px] rounded-[var(--radius-lg)] font-bold text-white text-2xl disabled:opacity-40"
            style={{ background: BRAND }}
          >
            Lap
          </button>
          <button
            onClick={enterFs}
            className="w-full h-[46px] rounded-[var(--radius-md)] font-semibold text-[#0C1116] border border-[#E5E9F0] flex items-center justify-center gap-2 text-sm"
          >
            ⛶ Full screen for poolside
          </button>
        </div>
      </div>

      {/* Poolside full-screen display: a huge timer visible across the pool. */}
      {fs && (
        <div
          className="fixed inset-0 z-50 text-white flex flex-col items-center justify-center px-4 overflow-hidden"
          style={{ background: PATTERN }}
        >
          <button
            onClick={exitFs}
            className="absolute top-4 right-4 w-11 h-11 rounded-xl bg-white/10"
            aria-label="Exit full screen"
          >
            ✕
          </button>
          <button
            onClick={() => setSoundOn((v) => !v)}
            className="absolute top-4 left-4 w-11 h-11 rounded-xl bg-white/10"
            title="Start beep on/off"
          >
            {soundOn ? "🔊" : "🔇"}
          </button>
          <p className="uppercase tracking-[0.16em] text-white/50 font-bold text-sm mb-1">
            {running ? `Running · lap ${laps.length + 1}` : started ? "Paused" : "Ready"}
          </p>
          <div
            ref={fsClockRef}
            className="font-bold tabular-nums leading-none inline-block whitespace-nowrap max-w-full"
            style={{ fontSize: "min(40vw, 60vh)", letterSpacing: "-0.02em" }}
          >
            {formatStopwatch(elapsedMs)}
          </div>
          <p className="mt-2 text-white/70 font-semibold" style={{ fontSize: "clamp(13px,2.2vh,20px)" }}>
            {laps.length > 0
              ? `Last lap ${formatStopwatch(laps[laps.length - 1].splitMs)} · ${laps.length} ${laps.length === 1 ? "lap" : "laps"}`
              : "Tap Lap at each wall"}
          </p>
          <div className="flex items-center flex-wrap justify-center" style={{ gap: "clamp(10px,2vw,20px)", marginTop: "clamp(16px,4vh,40px)" }}>
            <button
              onClick={toggle}
              className="rounded-2xl bg-[#111826] border border-white/15 font-bold"
              style={{ minWidth: "clamp(112px,16vw,190px)", height: "clamp(50px,8vh,78px)", fontSize: "clamp(15px,2.2vh,20px)", padding: "0 clamp(18px,2.5vw,30px)" }}
            >
              {running ? "Pause" : started ? "Resume" : "Start"}
            </button>
            <button
              onClick={lap}
              disabled={!started}
              className="rounded-2xl font-extrabold disabled:opacity-40"
              style={{ background: BRAND, minWidth: "clamp(200px,32vw,380px)", height: "clamp(66px,11vh,108px)", fontSize: "clamp(24px,3.6vh,38px)", padding: "0 clamp(30px,4vw,52px)" }}
            >
              Lap
            </button>
            <button
              onClick={reset}
              disabled={!started}
              className="rounded-2xl bg-white/10 disabled:opacity-40"
              style={{ width: "clamp(50px,8vh,78px)", height: "clamp(50px,8vh,78px)" }}
            >
              ↺
            </button>
          </div>
        </div>
      )}

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
