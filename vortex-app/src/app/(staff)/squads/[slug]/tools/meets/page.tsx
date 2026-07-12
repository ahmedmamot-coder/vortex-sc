import { notFound } from "next/navigation";
import { getSquadBySlug } from "@/lib/data/squads";
import { getSwimmersBySquad } from "@/lib/data/swimmers";
import { getMeets } from "@/lib/data/meets";
import ToolShell from "../tool-shell";
import MeetsClient from "./meets-client";

export default async function MeetsToolPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const squad = await getSquadBySlug(slug);
  if (!squad) notFound();

  const [meets, swimmers] = await Promise.all([getMeets(), getSwimmersBySquad(squad.id)]);

  return (
    <ToolShell slug={slug} title="Meet Management">
      <MeetsClient
        slug={slug}
        squadId={squad.id}
        squadName={squad.name}
        meets={meets}
        swimmers={swimmers.map((s) => ({ id: s.id, name: `${s.first_name} ${s.last_name}` }))}
      />
    </ToolShell>
  );
}
