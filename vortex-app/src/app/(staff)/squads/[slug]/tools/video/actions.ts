"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function detectKind(url: string): "youtube" | "vimeo" | "mp4" | null {
  if (!/^https?:\/\//i.test(url)) return null;
  if (/youtube\.com|youtu\.be/i.test(url)) return "youtube";
  if (/vimeo\.com/i.test(url)) return "vimeo";
  if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(url)) return "mp4";
  return "mp4"; // assume direct file otherwise
}

export async function addVideo(
  slug: string,
  squadId: string,
  fields: { title: string; url: string; race_type: string; swimmer_id: string | null },
): Promise<{ error?: string }> {
  const kind = detectKind(fields.url);
  if (!kind) return { error: "Enter a valid http(s) video link." };

  const supabase = await createClient();
  const { error } = await supabase.from("videos").insert({
    squad_id: squadId,
    swimmer_id: fields.swimmer_id,
    title: fields.title || "Untitled clip",
    url: fields.url,
    kind,
    race_type: fields.race_type || null,
  });
  if (error) return { error: error.message };
  revalidatePath(`/squads/${slug}/tools/video`);
  return {};
}

export async function deleteVideo(slug: string, id: string) {
  const supabase = await createClient();
  await supabase.from("videos").delete().eq("id", id);
  revalidatePath(`/squads/${slug}/tools/video`);
}

export async function saveSplits(
  slug: string,
  videoId: string,
  splits: { label: string; seconds: number }[],
) {
  const supabase = await createClient();
  await supabase.from("video_splits").delete().eq("video_id", videoId);
  if (splits.length) {
    await supabase.from("video_splits").insert(
      splits.map((s, i) => ({ video_id: videoId, label: s.label, seconds: s.seconds, sort_order: i })),
    );
  }
  revalidatePath(`/squads/${slug}/tools/video/${videoId}`);
}

export async function addNote(slug: string, videoId: string, timestampSeconds: number, note: string) {
  const supabase = await createClient();
  await supabase.from("video_notes").insert({ video_id: videoId, timestamp_seconds: timestampSeconds, note });
  revalidatePath(`/squads/${slug}/tools/video/${videoId}`);
}

export async function deleteNote(slug: string, videoId: string, id: string) {
  const supabase = await createClient();
  await supabase.from("video_notes").delete().eq("id", id);
  revalidatePath(`/squads/${slug}/tools/video/${videoId}`);
}
