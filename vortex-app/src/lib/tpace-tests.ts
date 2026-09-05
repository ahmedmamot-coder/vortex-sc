// The T-pace trials, and the two directions they are measured in.
//
// A distance trial fixes the DISTANCE and times it. A fixed-clock test — the T30 and the T20 —
// fixes the CLOCK and measures how far the swimmer got: thirty (or twenty) minutes of continuous
// freestyle, no stopping, and the swimmer's own lap count is the result. Same division either way:
//
//   1000 m trial : T-pace/100 = time ÷ 10
//   400 m trial  : T-pace/100 = time × 2.5 ÷ 10
//   T30          : T-pace/100 = 1800 s ÷ (metres ÷ 100)
//   T20          : T-pace/100 = 1200 s ÷ (metres ÷ 100)
//
// These are the same numbers public/proto.html carries in its TPACE_FIXED table. The two apps
// keep their trials in different places — proto in the vx_tpace document, this route in the
// t_pace_tests table — so nothing forces them to agree, which is exactly why the figures live
// in one file per app and are asserted equal in tests/logic.test.mjs. A T30 has to mean the same
// thing to a coach whichever screen they opened.

export type TPaceTestType = "1000" | "400" | "t30" | "t20";

export interface FixedClockTest {
  /** How it reads on screen. */
  label: string;
  /** The clock, in minutes, as the protocol is spoken about. */
  mins: number;
  /** The clock, in seconds, as the pace is computed from. */
  sec: number;
  /**
   * The plausible band for a distance over this clock. Below `min` is a lap count entered where
   * metres belong (66 lengths, not 1650 m); above `max` is metres typed twice over. Either one
   * computes to a believable-looking T-pace that then drives every E-2 / E-3 set written off it,
   * so they are refused rather than warned about.
   *
   * `max` was 200 m per minute, described here as "well inside a world record". That was wrong:
   * 200 m/min is 3.33 m/s and the 1500 free world record is about 1.72 m/s, so the ceiling was
   * nearly twice a pace no human has swum and caught nothing. A 4500 m T30 was accepted in the
   * live app and produced a threshold speed of 2.50 m/s with a full zone table built on it.
   *
   * Both ceilings are now 1.75 m/s — a shade above the 1500 free world record, held for the
   * whole test. Still unreachable, and now low enough to catch a lap count taken against the
   * wrong pool length or a digit too many. It stays per-test: 3000 m is a plausible-looking T30
   * entry and an impossible T20 one.
   */
  min: number;
  max: number;
  /** A realistic distance, used as the field's example. */
  eg: number;
}

export const FIXED_CLOCK_TESTS: Record<"t30" | "t20", FixedClockTest> = {
  t30: { label: "T30", mins: 30, sec: 1800, min: 100, max: 3150, eg: 1650 },
  t20: { label: "T20", mins: 20, sec: 1200, min: 100, max: 2100, eg: 1100 },
};

export const DISTANCE_TRIALS = [1000, 400] as const;

export function fixedClockTest(type: string | null | undefined): FixedClockTest | null {
  if (type !== "t30" && type !== "t20") return null;
  return FIXED_CLOCK_TESTS[type];
}

/** A distance trial: the swimmer covered `distance` in `timeSeconds`. */
export function tPaceFromDistanceTrial(distance: number, timeSeconds: number): number {
  return timeSeconds / (distance / 100);
}

/** A fixed-clock test: the swimmer covered `metres` in the test's own fixed time. */
export function tPaceFromFixedClock(type: string, metres: number): number | null {
  const t = fixedClockTest(type);
  if (!t || !(metres > 0)) return null;
  return (t.sec * 100) / metres;
}

/**
 * What a stored row is. `test_type` was added by supabase/tpace_fixed_clock.sql; a row written
 * before that ran does not carry one, and the only two things the old screen could write were a
 * 400 m and a 1000 m trial — so the distance identifies it with no ambiguity to resolve.
 */
export function testTypeOf(row: { test_type?: string | null; distance: number }): TPaceTestType {
  const t = row.test_type;
  if (t === "1000" || t === "400" || t === "t30" || t === "t20") return t;
  return row.distance === 400 ? "400" : "1000";
}

/**
 * A T-pace is a speed, and /100 is only the unit it is quoted in. What a coach writes on the
 * board is "8 × 150 on the T-pace", so the number they need is the 150 — and doing that
 * multiplication in their head, poolside, for every rep length in a set, is where the errors come
 * from. These are the rep lengths the club's sets are built out of, and proto.html carries the
 * same list in TPACE_LADDER.
 */
export const PACE_LADDER = [50, 75, 100, 150, 200, 300, 400] as const;

export function paceLadder(tPacePer100: number): { metres: number; seconds: number }[] {
  if (!(tPacePer100 > 0)) return [];
  return PACE_LADDER.map((metres) => ({
    metres,
    seconds: Number(((tPacePer100 * metres) / 100).toFixed(2)),
  }));
}

export function formatMetres(m: number): string {
  const n = Number(m) || 0;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * The protocol, in the words the club uses poolside. Generated from the test rather than written
 * out per test, because a note that named the wrong number of minutes would be worse than none.
 */
export function fixedClockProtocol(t: FixedClockTest): string {
  return (
    `Steady, moderate-to-strong pace for the full ${t.mins} minutes — cover as much distance as ` +
    `possible. No stopping, for any reason. Count the laps carefully; the total distance swum is ` +
    `what gets written here.`
  );
}

/** The message for a distance that cannot be what the coach meant. */
export function fixedClockRangeError(t: FixedClockTest): string {
  return (
    `That does not look like a ${t.mins}-minute distance. ` +
    `Enter total metres swum, between ${t.min} and ${t.max}.`
  );
}
