"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  fixedClockTest,
  fixedClockRangeError,
  tPaceFromDistanceTrial,
  tPaceFromFixedClock,
} from "@/lib/tpace-tests";

/** Postgres: column does not exist. Means supabase/tpace_fixed_clock.sql has not been run here. */
const UNDEFINED_COLUMN = "42703";

export type LogResult = { ok: true } | { ok: false; message: string };

/**
 * Log a trial. Two kinds arrive here and they are measured in opposite directions:
 *
 *  - a distance trial (1000 / 400) — the coach enters the TIME, and `value` is seconds;
 *  - a fixed-clock test (t30 / t20) — the coach enters the DISTANCE, and `value` is metres.
 *
 * Returning the failure rather than throwing is deliberate: the interesting failure here is a
 * club whose database has not had tpace_fixed_clock.sql run yet, and a coach who taps Save needs
 * to be told that in words, not shown a stack trace or — worse — nothing at all.
 */
export async function logTPaceTest(
  slug: string,
  swimmerId: string,
  type: string,
  value: number,
): Promise<LogResult> {
  if (!swimmerId) return { ok: false, message: "Pick a swimmer first." };

  const fixed = fixedClockTest(type);
  let distance: number;
  let timeSeconds: number;
  let tPace: number;

  if (fixed) {
    if (!Number.isFinite(value) || value <= 0) {
      return { ok: false, message: `Enter the distance swum in metres, e.g. ${fixed.eg}.` };
    }
    if (value < fixed.min || value > fixed.max) {
      return { ok: false, message: fixedClockRangeError(fixed) };
    }
    // The distance is what was measured; the clock is the protocol, the same for every swimmer.
    distance = Number(value.toFixed(1));
    timeSeconds = fixed.sec;
    tPace = tPaceFromFixedClock(type, distance)!;
  } else {
    if (type !== "1000" && type !== "400") {
      return { ok: false, message: "Unknown test type." };
    }
    if (!Number.isFinite(value) || value <= 0) {
      return { ok: false, message: "Enter a valid time, e.g. 14:32.50." };
    }
    distance = Number(type);
    timeSeconds = Number(value.toFixed(2));
    tPace = tPaceFromDistanceTrial(distance, timeSeconds);
  }

  const retest = new Date();
  retest.setDate(retest.getDate() + 42); // retest in ~6 weeks

  const row = {
    swimmer_id: swimmerId,
    distance,
    time_seconds: timeSeconds,
    t_pace_seconds: Number(tPace.toFixed(2)),
    retest_due: retest.toISOString().slice(0, 10),
  };

  const supabase = await createClient();
  const { error } = await supabase.from("t_pace_tests").insert({ ...row, test_type: type });

  if (error?.code === UNDEFINED_COLUMN) {
    // The column is not there yet. A 400 or 1000 trial is still safe to write without it —
    // the distance identifies it, which is how every row predating the column is read. A T30 or
    // T20 is not: stored with no type it would come back as a distance trial and be read as a
    // pace it never was, so it is refused instead of quietly mislabelled.
    if (fixed) {
      return {
        ok: false,
        message:
          `The ${fixed.label} needs a one-off database update the club has not run yet ` +
          `(supabase/tpace_fixed_clock.sql). The 1000 m and 400 m trials work as normal.`,
      };
    }
    const retry = await supabase.from("t_pace_tests").insert(row);
    if (retry.error) return { ok: false, message: retry.error.message };
  } else if (error) {
    return { ok: false, message: error.message };
  }

  revalidatePath(`/squads/${slug}/tools/t-pace`);
  return { ok: true };
}

export async function deleteTPaceTest(slug: string, id: string): Promise<LogResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("t_pace_tests").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/squads/${slug}/tools/t-pace`);
  return { ok: true };
}
