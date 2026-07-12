import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getLinkedSwimmers } from "@/lib/data/family";
import { getPersonalBests, getSwimmerResults } from "@/lib/data/swimmers";
import { getSwimmerAttendanceHistory } from "@/lib/data/attendance";
import { getMeets } from "@/lib/data/meets";
import FamilyPortalClient from "./portal-client";

export default async function FamilyPortalPage({
  searchParams,
}: {
  searchParams: Promise<{ child?: string }>;
}) {
  const session = await getSession();
  if (session.kind !== "family") redirect("/family/login");

  const linked = await getLinkedSwimmers(session.account.id);
  if (linked.length === 0) redirect("/family/link");

  const { child } = await searchParams;
  const active = linked.find((s) => s.id === child) ?? linked[0];

  const [pbs, results, attendance, meets] = await Promise.all([
    getPersonalBests(active.id),
    getSwimmerResults(active.id),
    getSwimmerAttendanceHistory(active.id),
    getMeets(),
  ]);

  const presentCount = attendance.filter((a) => a.present).length;
  const attendancePct = attendance.length ? Math.round((presentCount / attendance.length) * 100) : null;

  return (
    <FamilyPortalClient
      account={session.account}
      linked={linked}
      active={active}
      pbs={pbs}
      results={results.map((r) => ({
        event: r.event,
        time_text: r.time_text,
        place: r.place,
        meet_name: r.meets?.name ?? "",
        meet_date: r.meets?.meet_date ?? "",
      }))}
      attendancePct={attendancePct}
      attendanceHistory={attendance.slice(0, 10)}
      upcomingMeets={meets.filter((m) => m.status !== "completed")}
    />
  );
}
