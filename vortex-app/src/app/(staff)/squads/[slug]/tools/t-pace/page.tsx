import { notFound } from "next/navigation";
import { getSquadBySlug } from "@/lib/data/squads";
import { getSwimmersBySquad } from "@/lib/data/swimmers";
import { getTPaceTestsForSquad } from "@/lib/data/tpace";
import ToolShell from "../tool-shell";
import TPaceClient from "./t-pace-client";

export default async function TPacePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const squad = await getSquadBySlug(slug);
  if (!squad) notFound();

  const [swimmers, tests] = await Promise.all([
    getSwimmersBySquad(squad.id),
    getTPaceTestsForSquad(squad.id),
  ]);

  return (
    <ToolShell slug={slug} title="T-Pace Tests">
      <TPaceClient
        slug={slug}
        swimmers={swimmers.map((s) => ({ id: s.id, name: `${s.first_name} ${s.last_name}` }))}
        tests={tests.map((t) => ({
          id: t.id,
          name: `${t.swimmers.first_name} ${t.swimmers.last_name}`,
          distance: t.distance,
          time_seconds: t.time_seconds,
          t_pace_seconds: t.t_pace_seconds,
          tested_at: t.tested_at,
          retest_due: t.retest_due,
        }))}
      />
    </ToolShell>
  );
}
