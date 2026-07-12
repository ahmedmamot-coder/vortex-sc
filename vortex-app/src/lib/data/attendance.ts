import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Attendance } from "@/lib/types";

export async function getAttendanceForDate(squadId: string, date: string): Promise<Attendance[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attendance")
    .select("*")
    .eq("squad_id", squadId)
    .eq("session_date", date);
  if (error) throw error;
  return data as Attendance[];
}

export async function getRecentSessionDates(squadId: string, limit = 6): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attendance")
    .select("session_date")
    .eq("squad_id", squadId)
    .order("session_date", { ascending: false });
  if (error) throw error;
  const unique = [...new Set((data ?? []).map((r) => r.session_date))];
  return unique.slice(0, limit);
}

export interface AttendanceSummary {
  monthPct: number | null;
  monthPresent: number;
  monthTotal: number;
  yearPct: number | null;
  yearPresent: number;
  yearTotal: number;
}

/** Squad-wide attendance rate for the current calendar month and year. */
export async function getSquadAttendanceSummary(squadId: string): Promise<AttendanceSummary> {
  const supabase = await createClient();
  const now = new Date();
  const yearStart = `${now.getFullYear()}-01-01`;
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

  const { data, error } = await supabase
    .from("attendance")
    .select("session_date, present")
    .eq("squad_id", squadId)
    .gte("session_date", yearStart);
  if (error) throw error;

  const rows = data ?? [];
  const yearTotal = rows.length;
  const yearPresent = rows.filter((r) => r.present).length;
  const monthRows = rows.filter((r) => r.session_date >= monthStart);
  const monthTotal = monthRows.length;
  const monthPresent = monthRows.filter((r) => r.present).length;

  return {
    monthTotal,
    monthPresent,
    monthPct: monthTotal ? Math.round((monthPresent / monthTotal) * 100) : null,
    yearTotal,
    yearPresent,
    yearPct: yearTotal ? Math.round((yearPresent / yearTotal) * 100) : null,
  };
}

export async function getSwimmerAttendanceHistory(swimmerId: string): Promise<Attendance[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attendance")
    .select("*")
    .eq("swimmer_id", swimmerId)
    .order("session_date", { ascending: false });
  if (error) throw error;
  return data as Attendance[];
}
