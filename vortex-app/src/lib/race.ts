/** Standard split markers per race distance (metres from the wall). */
export const RACE_MARKERS: Record<string, string[]> = {
  "50": ["Reaction", "15m", "Breakout", "25m", "35m", "45m", "50m"],
  "100": ["Reaction", "15m", "Breakout", "25m", "50m", "75m", "100m"],
  "200": ["Reaction", "50m", "100m", "150m", "200m"],
  "400": ["Reaction", "100m", "200m", "300m", "400m"],
  "800": ["Reaction", "200m", "400m", "600m", "800m"],
  "1500": ["Reaction", "300m", "600m", "900m", "1200m", "1500m"],
};

export const RACE_TYPES = Object.keys(RACE_MARKERS);

/**
 * The metres-from-the-wall a marker sits at, or null when it has no fixed
 * distance. "15m" → 15, "100m" → 100, "Reaction" → 0 (the gun, at the wall),
 * "Breakout" → null (where the swimmer surfaces varies swim to swim, so it is a
 * timing landmark only — never a distance we can compute a speed from).
 */
export function markerMetres(label: string): number | null {
  if (/^reaction$/i.test(label)) return 0;
  const m = label.match(/^(\d+(?:\.\d+)?)\s*m$/i);
  return m ? Number(m[1]) : null;
}

/** The race distance a set of markers finishes at (its last numbered marker). */
export function raceDistance(raceType: string): number | null {
  const labels = RACE_MARKERS[raceType];
  if (!labels) return null;
  for (let i = labels.length - 1; i >= 0; i--) {
    const d = markerMetres(labels[i]);
    if (d != null && d > 0) return d;
  }
  return null;
}

export interface SplitInput {
  label: string;
  /** Cumulative seconds from the gun. */
  seconds: number;
  /**
   * Strokes taken across the segment that ENDS at this marker — i.e. between the
   * previous numbered marker and this one. Optional; without it a segment shows
   * its time but no rate/DPS/index.
   */
  strokes?: number | null;
}

export interface SegmentMetric {
  label: string;
  metres: number | null;
  /** Seconds from the gun to this marker. */
  cumulative: number;
  /** Seconds since the previous marker (the raw split). */
  segment: number | null;
  /** Metres covered since the previous numbered marker. */
  distance: number | null;
  /** Metres per second across the segment ending here. */
  velocity: number | null;
  strokes: number | null;
  /** Strokes per minute across the segment ending here. */
  sr: number | null;
  /** Distance per stroke, in metres. */
  dps: number | null;
  /** Stroke index = velocity × DPS (m²/s) — the single number that rewards a
   *  swimmer for going fast AND holding water. Higher is more efficient. */
  si: number | null;
}

export interface RaceMetrics {
  rows: SegmentMetric[];
  /** Final cumulative time, or null until the last marker is captured. */
  total: number | null;
  distance: number | null;
  /** The "Reaction" split, if one was captured. */
  reaction: number | null;
  /** Time to the halfway wall (distance / 2), when a marker sits exactly there. */
  out: number | null;
  /** Time for the second half — total minus out. */
  back: number | null;
  /** Whole-race average speed, m/s. */
  avgVelocity: number | null;
  /** The fastest and slowest full segments, for at-a-glance highlighting. */
  fastestLabel: string | null;
  slowestLabel: string | null;
}

function round(n: number | null, dp: number): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * Turn raw split taps (and optional stroke counts) into the full race-analysis
 * table: per-segment velocity, stroke rate, distance-per-stroke and stroke
 * index, plus the out/back split and whole-race averages.
 *
 * `splits` must be in marker order, each carrying a cumulative time from the gun.
 * Robust to a half-captured race, missing stroke counts, and non-monotonic taps.
 */
export function computeRaceMetrics(
  raceType: string,
  splits: SplitInput[],
): RaceMetrics {
  const rows: SegmentMetric[] = [];
  // The most recent row that sat at a known distance, so a numbered marker can
  // measure its segment back to the last numbered marker even across a Breakout.
  let prevNumbered: { metres: number; cumulative: number } | null = null;

  for (let i = 0; i < splits.length; i++) {
    const s = splits[i];
    const metres = markerMetres(s.label);
    const cumulative = s.seconds;
    const segment = i === 0 ? cumulative : cumulative - splits[i - 1].seconds;

    let distance: number | null = null;
    let velocity: number | null = null;
    let sr: number | null = null;
    let dps: number | null = null;
    let si: number | null = null;
    const strokes = s.strokes != null && s.strokes > 0 ? s.strokes : null;

    if (metres != null && prevNumbered) {
      const d = metres - prevNumbered.metres;
      const t = cumulative - prevNumbered.cumulative;
      if (d > 0 && t > 0) {
        distance = d;
        velocity = d / t;
        if (strokes) {
          dps = d / strokes;
          sr = (strokes / t) * 60;
          si = velocity * dps;
        }
      }
    }

    rows.push({
      label: s.label,
      metres,
      cumulative: round(cumulative, 2)!,
      segment: round(segment, 2),
      distance,
      velocity: round(velocity, 2),
      strokes,
      sr: round(sr, 1),
      dps: round(dps, 2),
      si: round(si, 2),
    });

    if (metres != null) prevNumbered = { metres, cumulative };
  }

  const distance = raceDistance(raceType);
  const finishRow = distance != null
    ? rows.find((r) => r.metres === distance)
    : undefined;
  const total = finishRow ? finishRow.cumulative : null;

  const reactionRow = rows.find((r) => /^reaction$/i.test(r.label));
  const reaction = reactionRow ? reactionRow.cumulative : null;

  let out: number | null = null;
  let back: number | null = null;
  if (distance != null && total != null) {
    const half = rows.find((r) => r.metres === distance / 2);
    if (half) {
      out = half.cumulative;
      back = round(total - half.cumulative, 2);
    }
  }

  const avgVelocity =
    distance != null && total != null && total > 0
      ? round(distance / total, 2)
      : null;

  // Highlight the best and worst full (velocity-bearing) segments.
  const timed = rows.filter((r) => r.velocity != null);
  let fastestLabel: string | null = null;
  let slowestLabel: string | null = null;
  if (timed.length > 1) {
    fastestLabel = timed.reduce((a, b) => (b.velocity! > a.velocity! ? b : a)).label;
    slowestLabel = timed.reduce((a, b) => (b.velocity! < a.velocity! ? b : a)).label;
  }

  return {
    rows,
    total,
    distance,
    reaction,
    out,
    back,
    avgVelocity,
    fastestLabel,
    slowestLabel,
  };
}
