import { notFound } from "next/navigation";
import { getSquadBySlug } from "@/lib/data/squads";
import { getVideoDetail } from "@/lib/data/videos";
import ToolShell from "../../tool-shell";
import VideoDetailClient from "./video-detail-client";

export default async function VideoDetailPage({
  params,
}: {
  params: Promise<{ slug: string; videoId: string }>;
}) {
  const { slug, videoId } = await params;
  const squad = await getSquadBySlug(slug);
  if (!squad) notFound();
  const detail = await getVideoDetail(videoId);
  if (!detail) notFound();

  return (
    <ToolShell slug={slug} title={detail.video.title}>
      <VideoDetailClient slug={slug} detail={detail} />
    </ToolShell>
  );
}
