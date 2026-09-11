import "server-only";
import { createClient } from "@/lib/supabase/server";

export interface Video {
  id: string;
  swimmer_id: string | null;
  squad_id: string | null;
  title: string;
  url: string;
  kind: "youtube" | "vimeo" | "mp4";
  race_type: string | null;
}

export interface VideoSplit {
  id: string;
  video_id: string;
  label: string;
  seconds: number;
  sort_order: number;
  /** Strokes taken in the segment ending at this marker. Null until the
   *  video_split_strokes.sql migration is run, or when nobody counted. */
  strokes: number | null;
}

export interface VideoNote {
  id: string;
  video_id: string;
  timestamp_seconds: number;
  note: string;
}

export async function getVideosForSquad(squadId: string): Promise<Video[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("videos")
    .select("*")
    .eq("squad_id", squadId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as Video[];
}

export async function getVideoDetail(
  videoId: string,
): Promise<{ video: Video; splits: VideoSplit[]; notes: VideoNote[] } | null> {
  const supabase = await createClient();
  const { data: video } = await supabase.from("videos").select("*").eq("id", videoId).maybeSingle();
  if (!video) return null;
  const [{ data: splits }, { data: notes }] = await Promise.all([
    supabase.from("video_splits").select("*").eq("video_id", videoId).order("sort_order"),
    supabase.from("video_notes").select("*").eq("video_id", videoId).order("timestamp_seconds"),
  ]);
  return {
    video: video as Video,
    // Normalise strokes to null so the UI needn't care whether the column exists
    // yet (it is absent until video_split_strokes.sql is run).
    splits: (splits ?? []).map((s) => ({
      ...s,
      strokes: (s as { strokes?: number | null }).strokes ?? null,
    })) as VideoSplit[],
    notes: (notes ?? []) as VideoNote[],
  };
}
