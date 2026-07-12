import { getClub } from "@/lib/data/club";
import { getSquadCounts } from "@/lib/data/squads";
import SettingsClient from "./settings-client";

export default async function AdminSettingsPage() {
  const club = await getClub();
  const counts = await getSquadCounts();
  const totalSwimmers = Object.values(counts).reduce((a, b) => a + b, 0);

  return <SettingsClient club={club} totalSwimmers={totalSwimmers} />;
}
