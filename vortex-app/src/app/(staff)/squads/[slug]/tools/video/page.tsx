import { notFound } from "next/navigation";
import { getSquadBySlug } from "@/lib/data/squads";
import { getSwimmersBySquad } from "@/lib/data/swimmers";
import { getVideosForSquad } from "@/lib/data/videos";
import ToolShell from "../tool-shell";
import VideoListClient from "./video-list-client";

export default async function VideoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const squad = await getSquadBySlug(slug);
  if (!squad) notFound();

  const [swimmers, videos] = await Promise.all([
    getSwimmersBySquad(squad.id),
    getVideosForSquad(squad.id),
  ]);

  return (
    <ToolShell slug={slug} title="Video Analysis">
      <VideoListClient
        slug={slug}
        squadId={squad.id}
        swimmers={swimmers.map((s) => ({ id: s.id, name: `${s.first_name} ${s.last_name}` }))}
        videos={videos}
      />
    </ToolShell>
  );
}
