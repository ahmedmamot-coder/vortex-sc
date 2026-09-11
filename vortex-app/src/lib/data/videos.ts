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
    splits: (splits ?? []) as VideoSplit[],
    notes: (notes ?? []) as VideoNote[],
  };
}
