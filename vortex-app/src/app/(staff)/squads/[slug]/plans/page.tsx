import { notFound } from "next/navigation";
import { getSquadBySlug } from "@/lib/data/squads";
import { getOrCreatePlan } from "@/lib/data/plans";
import PlansClient from "./plans-client";

export default async function PlansPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const squad = await getSquadBySlug(slug);
  if (!squad) notFound();

  const plan = await getOrCreatePlan(squad.id);

  return <PlansClient slug={slug} squad={squad} plan={plan} />;
}
