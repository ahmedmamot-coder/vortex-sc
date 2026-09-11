"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { Video, VideoSplit, VideoNote } from "@/lib/data/videos";
import { RACE_MARKERS, computeRaceMetrics, type SplitInput } from "@/lib/race";
import { OnsetDetector } from "@/lib/audio-onset";
import { formatTime } from "@/lib/format";
import { saveSplits, addNote, deleteNote } from "../actions";

function youtubeId(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/))([\w-]{11})/);
  return m ? m[1] : null;
}
function vimeoId(url: string): string | null {
  const m = url.match(/vimeo\.com\/(\d+)/);
  return m ? m[1] : null;
}

type Split = { label: string; seconds: number; strokes: number | null };
type Audio = { ctx: AudioContext; analyser: AnalyserNode; src: MediaElementAudioSourceNode };

export default function VideoDetailClient({
  slug,
  detail,
}: {
  slug: string;
  detail: { video: Video; splits: VideoSplit[]; notes: VideoNote[] };
}) {
  const { video } = detail;
  const raceType = video.race_type ?? "50";
  const markers = RACE_MARKERS[raceType] ?? RACE_MARKERS["50"];
  const isMp4 = video.kind === "mp4";

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [rate, setRate] = useState(1);
  const [splits, setSplits] = useState<Split[]>(
    detail.splits.map((s) => ({ label: s.label, seconds: s.seconds, strokes: s.strokes })),
  );
  // The gun. For mp4 it is a timestamp inside the clip; for an embed it is a
  // wall-clock moment. Every split time is measured from here, so out/back,
  // reaction and average speed are all relative to the start — not the footage.
  const [startAt, setStartAt] = useState<number | null>(null);
  const [autoListening, setAutoListening] = useState(false);
  const [autoStatus, setAutoStatus] = useState<string | null>(null);
  const [notes, setNotes] = useState(detail.notes);
  const [noteText, setNoteText] = useState("");
  const [, startTransition] = useTransition();

  const audioRef = useRef<Audio | null>(null);
  const detectorRef = useRef<OnsetDetector | null>(null);
  const rafRef = useRef<number | null>(null);

  const nextMarker = markers[splits.length];
  const allDone = splits.length >= markers.length;
  const started = startAt != null;

  const metrics = computeRaceMetrics(
    raceType,
    splits.map<SplitInput>((s) => ({ label: s.label, seconds: s.seconds, strokes: s.strokes })),
  );

  // A raw clock in seconds, in the same frame as startAt.
  function rawTime(): number {
    if (isMp4) return videoRef.current?.currentTime ?? 0;
    return Date.now() / 1000;
  }
  function elapsed(): number {
    if (startAt == null) return 0;
    return Math.max(0, rawTime() - startAt);
  }

  function persist(next: Split[]) {
    startTransition(() => saveSplits(slug, video.id, next));
  }

  function stopAuto() {
    setAutoListening(false);
    detectorRef.current = null;
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }

  // Tear the audio graph down when leaving the page.
  useEffect(() => {
    return () => {
      stopAuto();
      audioRef.current?.ctx.close().catch(() => {});
      audioRef.current = null;
    };
  }, []);

  function setStartHere() {
    stopAuto();
    setStartAt(rawTime());
    setAutoStatus(null);
  }

  function clearStart() {
    stopAuto();
    setStartAt(null);
    setAutoStatus(null);
  }

  // Lock the clock to the starter's beep by listening to the clip's audio.
  function armAuto() {
    const el = videoRef.current;
    if (!el) return;
    try {
      let a = audioRef.current;
      if (!a) {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
        // createMediaElementSource may be called only once per element.
        const src = ctx.createMediaElementSource(el);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0;
        src.connect(analyser);
        analyser.connect(ctx.destination); // keep the sound audible
        a = { ctx, analyser, src };
        audioRef.current = a;
      }
      a.ctx.resume().catch(() => {});
      detectorRef.current = new OnsetDetector();
      setStartAt(null);
      setAutoListening(true);
      setAutoStatus("Listening for the start signal — press play from before the beep.");

      const bins = new Uint8Array(a.analyser.frequencyBinCount);
      const spec = new Array<number>(bins.length);
      const tick = () => {
        const aa = audioRef.current;
        const det = detectorRef.current;
        const v = videoRef.current;
        if (!aa || !det || !v) return;
        aa.analyser.getByteFrequencyData(bins);
        for (let i = 0; i < bins.length; i++) spec[i] = bins[i] / 255;
        if (!v.paused && det.push(spec)) {
          const t = v.currentTime;
          setStartAt(t);
          setAutoStatus(`Start locked to the beep at ${formatTime(t)} in the clip.`);
          stopAuto();
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      stopAuto();
      setAutoStatus("Couldn't read this clip's audio — tap “Set start” on the gun frame instead.");
    }
  }

  function tapSplit() {
    if (allDone || !started) return;
    const updated = [...splits, { label: nextMarker, seconds: elapsed(), strokes: null }];
    setSplits(updated);
    persist(updated);
  }

  function resetSplits() {
    setSplits([]);
    clearStart();
    persist([]);
  }

  function setStrokes(index: number, next: number | null) {
    const updated = splits.map((s, i) =>
      i === index ? { ...s, strokes: next != null && next > 0 ? next : null } : s,
    );
    setSplits(updated);
    persist(updated);
  }

  function setSpeed(r: number) {
    setRate(r);
    if (videoRef.current) videoRef.current.playbackRate = r;
  }

  function noteTime(): number {
    if (isMp4) return videoRef.current?.currentTime ?? 0;
    return elapsed();
  }

  const ytId = video.kind === "youtube" ? youtubeId(video.url) : null;
  const vmId = video.kind === "vimeo" ? vimeoId(video.url) : null;

  return (
    <div>
      <div className="rounded-[var(--radius-lg)] overflow-hidden bg-black mb-3 aspect-video">
        {isMp4 && <video ref={videoRef} src={video.url} controls className="w-full h-full" />}
        {ytId && (
          <iframe
            src={`https://www.youtube.com/embed/${ytId}`}
            className="w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        )}
        {vmId && (
          <iframe src={`https://player.vimeo.com/video/${vmId}`} className="w-full h-full" allowFullScreen />
        )}
      </div>

      {isMp4 && (
        <div className="flex gap-1.5 mb-3">
          <span className="text-xs text-[#7A8296] self-center mr-1">Speed:</span>
          {[0.25, 0.5, 0.75, 1].map((r) => (
            <button
              key={r}
              onClick={() => setSpeed(r)}
              className="px-2 py-1 rounded-[var(--radius-pill)] text-xs font-semibold"
              style={{ background: rate === r ? "var(--vx-blue)" : "#EEF1F5", color: rate === r ? "#fff" : "#4A5568" }}
            >
              {r}x
            </button>
          ))}
          <a
            href={video.url}
            download
            className="ml-auto px-2 py-1 rounded-[var(--radius-pill)] text-xs font-semibold text-[#0C1116] border border-[#E5E9F0]"
          >
            Download
          </a>
        </div>
      )}

      {/* Race summary — the headline numbers */}
      {(metrics.total != null || metrics.reaction != null || metrics.out != null) && (
        <RaceSummary metrics={metrics} raceType={raceType} />
      )}

      {/* Split capture */}
      <div className="rounded-[var(--radius-lg)] bg-white border border-[#E5E9F0] p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[#0C1116] font-semibold text-sm">Race splits · {raceType}m</p>
          {(splits.length > 0 || started) && (
            <button onClick={resetSplits} className="text-xs text-[var(--vx-danger)]">
              Reset
            </button>
          )}
        </div>

        {/* Set the gun first, then the tap flow unlocks. */}
        {!started ? (
          <div className="mb-1">
            <button
              onClick={setStartHere}
              className="w-full rounded-[var(--radius-md)] py-3 text-sm font-bold text-white"
              style={{ background: "var(--vx-success)" }}
            >
              {isMp4 ? "Set start — on the gun frame" : "Start stopwatch (at the beep/dive)"}
            </button>

            {isMp4 &&
              (autoListening ? (
                <button
                  onClick={stopAuto}
                  className="w-full mt-2 rounded-[var(--radius-md)] py-2.5 text-sm font-semibold border border-[var(--vx-blue)] text-[var(--vx-blue)] flex items-center justify-center gap-2"
                >
                  <span className="inline-block w-2 h-2 rounded-full bg-[var(--vx-danger)] animate-pulse" />
                  Listening for the beep… tap to cancel
                </button>
              ) : (
                <button
                  onClick={armAuto}
                  className="w-full mt-2 rounded-[var(--radius-md)] py-2.5 text-sm font-semibold border border-[#E5E9F0] text-[#0C1116]"
                >
                  🔊 Auto-start on the beep
                </button>
              ))}

            <p className="text-[11px] text-[#7A8296] mt-2 leading-relaxed">
              {isMp4
                ? "Pause on the flash/gun and “Set start” for a frame-exact zero, or arm the beep detector and play from before the start."
                : "Embedded clips have no readable audio — start the stopwatch by hand on the beep."}
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between text-[11px] text-[#7A8296] mb-2">
              <span>
                Gun set{isMp4 && startAt != null ? ` · ${formatTime(startAt)} in clip` : ""} — all splits
                measured from here.
              </span>
              <button onClick={clearStart} className="text-[var(--vx-blue)] font-semibold">
                Change
              </button>
            </div>

            {!allDone ? (
              <button
                onClick={tapSplit}
                className="w-full rounded-[var(--radius-md)] py-3 text-sm font-bold text-white"
                style={{ background: "var(--vx-blue)" }}
              >
                Tap: {nextMarker}
              </button>
            ) : (
              <p className="text-sm text-[var(--vx-success)] text-center py-2">All splits captured ✓</p>
            )}
          </>
        )}

        {autoStatus && <p className="text-[11px] text-[var(--vx-blue)] mt-2">{autoStatus}</p>}

        {splits.length > 0 && (
          <RaceBreakdown
            metrics={metrics}
            fastest={metrics.fastestLabel}
            slowest={metrics.slowestLabel}
            onStrokes={setStrokes}
          />
        )}
      </div>

      {/* Notes */}
      <div className="rounded-[var(--radius-lg)] bg-white border border-[#E5E9F0] p-4">
        <p className="text-[#0C1116] font-semibold text-sm mb-3">Notes</p>
        <div className="flex gap-2 mb-3">
          <input
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Note at current time…"
            className="flex-1 rounded-[var(--radius-sm)] px-3 py-2 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm"
          />
          <button
            onClick={() => {
              if (!noteText.trim()) return;
              const t = noteTime();
              startTransition(async () => {
                await addNote(slug, video.id, t, noteText.trim());
              });
              setNotes((n) => [
                ...n,
                { id: `tmp-${Date.now()}`, video_id: video.id, timestamp_seconds: t, note: noteText.trim() },
              ]);
              setNoteText("");
            }}
            className="px-3 py-2 rounded-[var(--radius-sm)] text-sm font-semibold text-white"
            style={{ background: "var(--vx-blue)" }}
          >
            Add
          </button>
        </div>
        <div className="flex flex-col gap-1">
          {[...notes]
            .sort((a, b) => a.timestamp_seconds - b.timestamp_seconds)
            .map((n) => (
              <div key={n.id} className="flex items-center justify-between text-sm">
                <span className="text-[#0C1116]">
                  <span className="text-[var(--vx-blue)] font-semibold mr-2">
                    {formatTime(n.timestamp_seconds)}
                  </span>
                  {n.note}
                </span>
                <button
                  onClick={() => {
                    startTransition(() => deleteNote(slug, video.id, n.id));
                    setNotes((list) => list.filter((x) => x.id !== n.id));
                  }}
                  className="text-[var(--vx-danger)] text-xs"
                >
                  ✕
                </button>
              </div>
            ))}
          {notes.length === 0 && <p className="text-xs text-[#7A8296]">No notes yet.</p>}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ summary */

function RaceSummary({
  metrics,
  raceType,
}: {
  metrics: ReturnType<typeof computeRaceMetrics>;
  raceType: string;
}) {
  return (
    <div className="rounded-[var(--radius-lg)] p-4 mb-4 text-white" style={{ background: "#0A0F1A" }}>
      <div className="flex items-end justify-between mb-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-[#7A8296] font-bold">Final time</p>
          <p className="text-4xl font-bold tabular-nums leading-none mt-1">
            {metrics.total != null ? formatTime(metrics.total) : "—"}
          </p>
        </div>
        {metrics.avgVelocity != null && (
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-[0.14em] text-[#7A8296] font-bold">Avg speed</p>
            <p className="text-2xl font-bold tabular-nums leading-none mt-1">
              {metrics.avgVelocity.toFixed(2)}
              <span className="text-sm text-[#7A8296] ml-1">m/s</span>
            </p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <SummaryTile label="Out" value={metrics.out != null ? formatTime(metrics.out) : "—"} />
        <SummaryTile label="Back" value={metrics.back != null ? formatTime(metrics.back) : "—"} />
        <SummaryTile
          label="Reaction"
          value={metrics.reaction != null ? `${metrics.reaction.toFixed(2)}s` : "—"}
        />
      </div>
      {metrics.out != null && metrics.back != null && (
        <p className="text-[11px] text-[#7A8296] mt-2.5">
          {metrics.back > metrics.out
            ? `Faded ${formatTime(metrics.back - metrics.out)} on the back half — a ${raceType}m to build into.`
            : `Held the back half within ${formatTime(metrics.out - metrics.back)} — strong pacing.`}
        </p>
      )}
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-md)] py-2 px-2.5" style={{ background: "rgba(255,255,255,0.06)" }}>
      <p className="text-[10px] uppercase tracking-[0.1em] text-[#7A8296] font-bold">{label}</p>
      <p className="text-lg font-bold tabular-nums leading-tight mt-0.5">{value}</p>
    </div>
  );
}

/* ---------------------------------------------------------------- breakdown */

function RaceBreakdown({
  metrics,
  fastest,
  slowest,
  onStrokes,
}: {
  metrics: ReturnType<typeof computeRaceMetrics>;
  fastest: string | null;
  slowest: string | null;
  onStrokes: (index: number, next: number | null) => void;
}) {
  return (
    <div className="mt-3 -mx-1 overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-[10px] uppercase tracking-[0.06em] text-[#9AA2B4]">
            <th className="text-left font-bold py-1.5 px-1">Split</th>
            <th className="text-right font-bold py-1.5 px-1">Time</th>
            <th className="text-right font-bold py-1.5 px-1">Seg</th>
            <th className="text-right font-bold py-1.5 px-1" title="Metres per second">
              m/s
            </th>
            <th className="text-right font-bold py-1.5 px-1" title="Strokes per minute">
              SR
            </th>
            <th className="text-right font-bold py-1.5 px-1" title="Distance per stroke (m)">
              DPS
            </th>
            <th className="text-right font-bold py-1.5 px-1" title="Stroke index = speed × DPS">
              SI
            </th>
            <th className="text-center font-bold py-1.5 px-1">Strokes</th>
          </tr>
        </thead>
        <tbody>
          {metrics.rows.map((r, i) => {
            const hi =
              r.label === fastest ? "var(--vx-success)" : r.label === slowest ? "var(--vx-danger)" : undefined;
            const strokeable = r.distance != null;
            return (
              <tr key={i} className="border-t border-[#EEF1F5]">
                <td className="py-1.5 px-1 text-[#0C1116] font-semibold whitespace-nowrap">
                  {hi && (
                    <span
                      className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle"
                      style={{ background: hi }}
                    />
                  )}
                  {r.label}
                </td>
                <td className="py-1.5 px-1 text-right tabular-nums text-[#0C1116]">
                  {formatTime(r.cumulative)}
                </td>
                <td className="py-1.5 px-1 text-right tabular-nums text-[#7A8296]">
                  {r.segment != null ? formatTime(r.segment) : "—"}
                </td>
                <td
                  className="py-1.5 px-1 text-right tabular-nums font-semibold"
                  style={{ color: hi ?? "#3A4152" }}
                >
                  {r.velocity != null ? r.velocity.toFixed(2) : "—"}
                </td>
                <td className="py-1.5 px-1 text-right tabular-nums text-[#3A4152]">
                  {r.sr != null ? r.sr.toFixed(1) : "—"}
                </td>
                <td className="py-1.5 px-1 text-right tabular-nums text-[#3A4152]">
                  {r.dps != null ? r.dps.toFixed(2) : "—"}
                </td>
                <td className="py-1.5 px-1 text-right tabular-nums text-[var(--vx-blue)] font-semibold">
                  {r.si != null ? r.si.toFixed(2) : "—"}
                </td>
                <td className="py-1.5 px-1">
                  {strokeable ? (
                    <StrokeStepper value={r.strokes} onChange={(v) => onStrokes(i, v)} />
                  ) : (
                    <span className="block text-center text-[#C4CAD6]">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-[11px] text-[#9AA2B4] mt-2 px-1 leading-relaxed">
        Count strokes per segment to unlock <span className="font-semibold text-[#7A8296]">SR</span> (rate),{" "}
        <span className="font-semibold text-[#7A8296]">DPS</span> (distance/stroke) and{" "}
        <span className="font-semibold text-[#7A8296]">SI</span> (stroke index — higher is more efficient).
      </p>
    </div>
  );
}

function StrokeStepper({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (next: number | null) => void;
}) {
  return (
    <div className="flex items-center justify-center gap-1">
      <button
        onClick={() => onChange((value ?? 0) - 1)}
        disabled={!value}
        className="w-6 h-6 rounded-full text-[#4A5568] bg-[#EEF1F5] disabled:opacity-40 leading-none"
        aria-label="One fewer stroke"
      >
        −
      </button>
      <span className="w-5 text-center tabular-nums font-semibold text-[#0C1116]">{value ?? "·"}</span>
      <button
        onClick={() => onChange((value ?? 0) + 1)}
        className="w-6 h-6 rounded-full text-white bg-[var(--vx-blue)] leading-none"
        aria-label="One more stroke"
      >
        +
      </button>
    </div>
  );
}
