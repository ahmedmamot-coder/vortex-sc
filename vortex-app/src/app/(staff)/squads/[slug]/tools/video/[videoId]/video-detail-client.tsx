"use client";

import { useRef, useState, useTransition } from "react";
import type { Video, VideoSplit, VideoNote } from "@/lib/data/videos";
import { RACE_MARKERS } from "@/lib/race";
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

export default function VideoDetailClient({
  slug,
  detail,
}: {
  slug: string;
  detail: { video: Video; splits: VideoSplit[]; notes: VideoNote[] };
}) {
  const { video } = detail;
  const markers = RACE_MARKERS[video.race_type ?? "50"] ?? RACE_MARKERS["50"];

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [rate, setRate] = useState(1);
  const [splits, setSplits] = useState<{ label: string; seconds: number }[]>(
    detail.splits.map((s) => ({ label: s.label, seconds: s.seconds })),
  );
  const [manualStart, setManualStart] = useState<number | null>(null);
  const [notes, setNotes] = useState(detail.notes);
  const [noteText, setNoteText] = useState("");
  const [, startTransition] = useTransition();

  const nextMarker = markers[splits.length];
  const allDone = splits.length >= markers.length;

  // Current playback time: from the <video> element for mp4, or a wall-clock
  // stopwatch for embedded YouTube/Vimeo (whose currentTime we can't read).
  function currentTime(): number {
    if (video.kind === "mp4" && videoRef.current) return videoRef.current.currentTime;
    if (manualStart != null) return (Date.now() - manualStart) / 1000;
    return 0;
  }

  function tapSplit() {
    if (allDone) return;
    const t = currentTime();
    const updated = [...splits, { label: nextMarker, seconds: t }];
    setSplits(updated);
    startTransition(() => saveSplits(slug, video.id, updated));
  }

  function resetSplits() {
    setSplits([]);
    setManualStart(null);
    startTransition(() => saveSplits(slug, video.id, []));
  }

  function setSpeed(r: number) {
    setRate(r);
    if (videoRef.current) videoRef.current.playbackRate = r;
  }

  const ytId = video.kind === "youtube" ? youtubeId(video.url) : null;
  const vmId = video.kind === "vimeo" ? vimeoId(video.url) : null;

  return (
    <div>
      <div className="rounded-[var(--radius-lg)] overflow-hidden bg-black mb-3 aspect-video">
        {video.kind === "mp4" && (
          <video ref={videoRef} src={video.url} controls className="w-full h-full" />
        )}
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

      {video.kind === "mp4" && (
        <div className="flex gap-1.5 mb-3">
          <span className="text-xs text-[var(--vx-slate-300)] self-center mr-1">Speed:</span>
          {[0.25, 0.5, 0.75, 1].map((r) => (
            <button
              key={r}
              onClick={() => setSpeed(r)}
              className="px-2 py-1 rounded-[var(--radius-pill)] text-xs font-semibold"
              style={{ background: rate === r ? "var(--vx-blue)" : "rgba(255,255,255,0.06)", color: "#fff" }}
            >
              {r}x
            </button>
          ))}
          <a
            href={video.url}
            download
            className="ml-auto px-2 py-1 rounded-[var(--radius-pill)] text-xs font-semibold text-white border border-white/20"
          >
            Download
          </a>
        </div>
      )}

      {/* Split capture */}
      <div className="rounded-[var(--radius-lg)] bg-white/5 border border-white/10 p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-white font-semibold text-sm">
            Race splits · {video.race_type ?? "50"}m
          </p>
          <button onClick={resetSplits} className="text-xs text-[var(--vx-danger)]">
            Reset
          </button>
        </div>

        {video.kind !== "mp4" && manualStart == null && !allDone && (
          <button
            onClick={() => setManualStart(Date.now())}
            className="w-full rounded-[var(--radius-md)] py-2 text-sm font-semibold text-white mb-3"
            style={{ background: "var(--vx-success)" }}
          >
            Start stopwatch (at the beep/dive)
          </button>
        )}

        {!allDone ? (
          <button
            onClick={tapSplit}
            disabled={video.kind !== "mp4" && manualStart == null}
            className="w-full rounded-[var(--radius-md)] py-3 text-sm font-bold text-white disabled:opacity-40"
            style={{ background: "var(--vx-blue)" }}
          >
            Tap: {nextMarker}
          </button>
        ) : (
          <p className="text-sm text-[var(--vx-success)] text-center py-2">All splits captured ✓</p>
        )}

        {splits.length > 0 && (
          <div className="flex flex-col gap-1 mt-3">
            {splits.map((s, i) => {
              const delta = i === 0 ? s.seconds : s.seconds - splits[i - 1].seconds;
              return (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="text-white">{s.label}</span>
                  <span className="text-[var(--vx-slate-300)]">
                    {formatTime(s.seconds)} <span className="text-white/50">(+{formatTime(delta)})</span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Notes */}
      <div className="rounded-[var(--radius-lg)] bg-white/5 border border-white/10 p-4">
        <p className="text-white font-semibold text-sm mb-3">Notes</p>
        <div className="flex gap-2 mb-3">
          <input
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Note at current time…"
            className="flex-1 rounded-[var(--radius-sm)] px-3 py-2 bg-white/5 border border-white/10 text-white text-sm"
          />
          <button
            onClick={() => {
              if (!noteText.trim()) return;
              const t = currentTime();
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
                <span className="text-white">
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
          {notes.length === 0 && <p className="text-xs text-[var(--vx-slate-300)]">No notes yet.</p>}
        </div>
      </div>
    </div>
  );
}
