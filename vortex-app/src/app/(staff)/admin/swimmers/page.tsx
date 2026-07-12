import { getAllSwimmersWithPbs } from "@/lib/data/swimmers";
import { getSquads } from "@/lib/data/squads";
import SwimmersAdminClient from "./swimmers-client";

export default async function AdminSwimmersPage() {
  const [swimmers, squads] = await Promise.all([getAllSwimmersWithPbs(), getSquads()]);
  return <SwimmersAdminClient swimmers={swimmers} squads={squads} />;
}
