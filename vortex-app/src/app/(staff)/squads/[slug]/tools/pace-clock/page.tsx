import { notFound } from "next/navigation";
import { getSquadBySlug } from "@/lib/data/squads";
import { getOrCreatePlan } from "@/lib/data/plans";
import ToolShell from "../tool-shell";
import PaceClockClient from "./pace-clock-client";

export default async function PaceClockPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const squad = await getSquadBySlug(slug);
  if (!squad) notFound();
  const plan = await getOrCreatePlan(squad.id);

  const sets = plan.sections.flatMap((section) =>
    section.sets.map((s) => ({
      id: s.id,
      section: section.name,
      distance: s.distance,
      description: s.description,
      rest: s.rest,
    })),
  );

  return (
    <ToolShell slug={slug} title="Pace Clock">
      <PaceClockClient sets={sets} accent={squad.accent_color} />
    </ToolShell>
  );
}
