import { getSquads } from "@/lib/data/squads";
import StaffClient from "./staff-client";

export default async function AdminStaffPage() {
  const squads = await getSquads();
  return <StaffClient squads={squads} />;
}
