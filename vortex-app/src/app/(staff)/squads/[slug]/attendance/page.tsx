import { notFound } from "next/navigation";
import { getSquadBySlug } from "@/lib/data/squads";
import { getSwimmersBySquad } from "@/lib/data/swimmers";
import {
  getAttendanceForDate,
  getRecentSessionDates,
  getSquadAttendanceSummary,
} from "@/lib/data/attendance";
import { formatShortDate } from "@/lib/format";
import AttendanceClient from "./attendance-client";

export default async function AttendancePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const squad = await getSquadBySlug(slug);
  if (!squad) notFound();

  const today = new Date().toISOString().slice(0, 10);
  const [swimmers, todayRecords, recentDates, summary] = await Promise.all([
    getSwimmersBySquad(squad.id),
    getAttendanceForDate(squad.id, today),
    getRecentSessionDates(squad.id),
    getSquadAttendanceSummary(squad.id),
  ]);

  return (
    <AttendanceClient
      slug={slug}
      squad={squad}
      swimmers={swimmers}
      today={today}
      todayRecords={todayRecords}
      recentDates={recentDates.map((d) => ({ raw: d, label: formatShortDate(d) }))}
      summary={summary}
    />
  );
}
