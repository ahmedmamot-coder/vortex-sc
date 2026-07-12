import { notFound } from "next/navigation";
import { getSquadBySlug } from "@/lib/data/squads";
import { getSwimmersBySquad } from "@/lib/data/swimmers";
import ToolShell from "../tool-shell";
import InBodyClient from "./inbody-client";

export default async function InBodyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const squad = await getSquadBySlug(slug);
  if (!squad) notFound();

  const swimmers = await getSwimmersBySquad(squad.id);

  return (
    <ToolShell slug={slug} title="InBody & Nutrition">
      <InBodyClient
        slug={slug}
        swimmers={swimmers.map((s) => ({ id: s.id, name: `${s.first_name} ${s.last_name}` }))}
      />
    </ToolShell>
  );
}
