"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function markAttendance(
  slug: string,
  squadId: string,
  swimmerId: string,
  date: string,
  present: boolean,
) {
  const supabase = await createClient();
  await supabase
    .from("attendance")
    .upsert(
      { squad_id: squadId, swimmer_id: swimmerId, session_date: date, present },
      { onConflict: "swimmer_id,session_date" },
    );
  revalidatePath(`/squads/${slug}/attendance`);
}
