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
