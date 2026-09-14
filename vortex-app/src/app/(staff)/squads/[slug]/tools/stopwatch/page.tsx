import { notFound } from "next/navigation";
import { getSquadBySlug } from "@/lib/data/squads";
import ToolShell from "../tool-shell";
import StopwatchClient from "./stopwatch-client";

export default async function StopwatchPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const squad = await getSquadBySlug(slug);
  if (!squad) notFound();

  return (
    <ToolShell slug={slug} title="Stopwatch">
      <StopwatchClient accent={squad.accent_color} />
    </ToolShell>
  );
}
