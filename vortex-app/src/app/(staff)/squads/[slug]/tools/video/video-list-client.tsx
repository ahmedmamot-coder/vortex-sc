"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { Video } from "@/lib/data/videos";
import { RACE_TYPES } from "@/lib/race";
import { addVideo, deleteVideo } from "./actions";

export default function VideoListClient({
  slug,
  squadId,
  swimmers,
  videos,
}: {
  slug: string;
  squadId: string;
  swimmers: { id: string; name: string }[];
  videos: Video[];
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [raceType, setRaceType] = useState(RACE_TYPES[0]);
  const [swimmerId, setSwimmerId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function submit(fileUrl?: string) {
    const finalUrl = fileUrl ?? url;
    startTransition(async () => {
      const res = await addVideo(slug, squadId, {
        title,
        url: finalUrl,
        race_type: raceType,
        swimmer_id: swimmerId || null,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      setError(null);
      setTitle("");
      setUrl("");
      setOpen(false);
    });
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Object URLs are per-session; for a real deployment upload to Supabase
    // Storage. Here we store the blob URL so the coach can analyse immediately.
    const blobUrl = URL.createObjectURL(file);
    submit(blobUrl);
  }

  return (
    <div>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="w-full rounded-[var(--radius-md)] border border-dashed border-[#CDD3E2] py-3 text-sm font-semibold text-[#0C1116] mb-4"
        >
          + Add video
        </button>
      ) : (
        <div className="rounded-[var(--radius-lg)] bg-white border border-[#E5E9F0] p-4 mb-4">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Clip title"
            className="w-full rounded-[var(--radius-sm)] px-3 py-2 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm mb-2"
          />
          <select
            value={swimmerId}
            onChange={(e) => setSwimmerId(e.target.value)}
            className="w-full rounded-[var(--radius-sm)] px-3 py-2 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm mb-2"
          >
            <option value="">Squad (no specific swimmer)</option>
            {swimmers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            value={raceType}
            onChange={(e) => setRaceType(e.target.value)}
            className="w-full rounded-[var(--radius-sm)] px-3 py-2 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm mb-2"
          >
            {RACE_TYPES.map((r) => (
              <option key={r} value={r}>
                {r}m race
              </option>
            ))}
          </select>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="YouTube / Vimeo / video URL"
            className="w-full rounded-[var(--radius-sm)] px-3 py-2 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm mb-2"
          />
          {error && <p className="text-sm text-[var(--vx-danger)] mb-2">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => submit()}
              disabled={!url}
              className="flex-1 rounded-[var(--radius-md)] py-2 text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: "var(--vx-blue)" }}
            >
              Add YouTube / link
            </button>
            <label className="flex-1 rounded-[var(--radius-md)] py-2 text-sm font-semibold text-[#0C1116] border border-[#E5E9F0] text-center cursor-pointer">
              Upload file
              <input type="file" accept="video/*" onChange={onFile} className="hidden" />
            </label>
          </div>
          <button onClick={() => setOpen(false)} className="mt-2 text-xs text-[#7A8296]">
            Cancel
          </button>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {videos.map((v) => (
          <div key={v.id} className="flex items-center justify-between rounded-[var(--radius-md)] bg-white border border-[#E5E9F0] px-3 py-3">
            <Link href={`/squads/${slug}/tools/video/${v.id}`} className="flex-1">
              <p className="text-[#0C1116] text-sm font-medium">{v.title}</p>
              <p className="text-xs text-[#7A8296]">
                {v.kind.toUpperCase()}
                {v.race_type ? ` · ${v.race_type}m` : ""}
              </p>
            </Link>
            <button
              onClick={() => startTransition(() => deleteVideo(slug, v.id))}
              className="text-[var(--vx-danger)] text-xs ml-3"
            >
              ✕
            </button>
          </div>
        ))}
        {videos.length === 0 && (
          <p className="text-sm text-[#7A8296]">No videos yet.</p>
        )}
      </div>
    </div>
  );
}
