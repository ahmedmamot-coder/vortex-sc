import { notFound } from "next/navigation";
import { getSquadBySlug } from "@/lib/data/squads";
import { getFitnessPlan } from "@/lib/data/fitness";
import ToolShell from "../tool-shell";
import FitnessClient from "./fitness-client";

export default async function FitnessPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const squad = await getSquadBySlug(slug);
  if (!squad) notFound();
  const sections = await getFitnessPlan(squad.id);

  return (
    <ToolShell slug={slug} title="Fitness Plan">
      <FitnessClient slug={slug} squadId={squad.id} initialSections={sections} />
    </ToolShell>
  );
}
