import { notFound } from "next/navigation";
import { getSquadBySlug } from "@/lib/data/squads";
import { getSwimmer, getPersonalBests, getSwimmerResults } from "@/lib/data/swimmers";
import SwimmerProfileClient from "./profile-client";

export default async function SwimmerProfilePage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const squad = await getSquadBySlug(slug);
  if (!squad) notFound();
  const swimmer = await getSwimmer(id);
  if (!swimmer) notFound();

  const [pbs, results] = await Promise.all([getPersonalBests(id), getSwimmerResults(id)]);

  return (
    <SwimmerProfileClient
      swimmer={swimmer}
      squad={squad}
      pbs={pbs}
      results={results.map((r) => ({
        event: r.event,
        course: r.course,
        seconds: r.seconds,
        time_text: r.time_text,
        place: r.place,
        meet_name: r.meets?.name ?? "",
        meet_date: r.meets?.meet_date ?? "",
      }))}
    />
  );
}
