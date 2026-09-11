// Pure stopwatch logic — kept out of the React component so the split/format
// rules that coaches read off the poolside can be unit-tested directly.

export type Lap = {
  /** 1-based lap number (a length of the pool). */
  n: number;
  /** Split: the time for this lap alone, in milliseconds. */
  splitMs: number;
  /** Cumulative elapsed time when the lap was taken, in milliseconds. */
  totalMs: number;
  /** Strokes counted during this lap. */
  strokes: number;
};

/**
 * Format milliseconds as `m:ss.cs` (centiseconds), the standard stopwatch
 * readout — e.g. 65230 → "1:05.23", 900 → "0:00.90".
 * Negative or non-finite input is clamped to zero rather than shown as junk.
 */
export function formatStopwatch(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalCs = Math.floor(ms / 10);
  const cs = totalCs % 100;
  const totalSecs = Math.floor(totalCs / 100);
  const secs = totalSecs % 60;
  const mins = Math.floor(totalSecs / 60);
  return `${mins}:${String(secs).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

/**
 * Build the next lap from the running total and the laps already taken.
 * The split is the total minus the previous lap's total, never negative.
 */
export function recordLap(laps: Lap[], totalMs: number, strokes: number): Lap {
  const prevTotal = laps.length ? laps[laps.length - 1].totalMs : 0;
  return {
    n: laps.length + 1,
    splitMs: Math.max(0, totalMs - prevTotal),
    totalMs,
    strokes,
  };
}

/**
 * Indices of the fastest and slowest laps by split. Returns nulls until there
 * are at least two laps to compare, so a lone lap is never flagged.
 */
export function lapExtremes(laps: Lap[]): { fastest: number | null; slowest: number | null } {
  if (laps.length < 2) return { fastest: null, slowest: null };
  let fastest = 0;
  let slowest = 0;
  laps.forEach((l, i) => {
    if (l.splitMs < laps[fastest].splitMs) fastest = i;
    if (l.splitMs > laps[slowest].splitMs) slowest = i;
  });
  return { fastest, slowest };
}

/** Total strokes across every recorded lap. */
export function totalStrokes(laps: Lap[]): number {
  return laps.reduce((sum, l) => sum + l.strokes, 0);
}

/**
 * Average strokes per lap, counting only laps that actually logged strokes,
 * rounded to one decimal. Returns 0 when nothing was counted.
 */
export function averageStrokes(laps: Lap[]): number {
  const counted = laps.filter((l) => l.strokes > 0);
  if (counted.length === 0) return 0;
  const avg = totalStrokes(counted) / counted.length;
  return Math.round(avg * 10) / 10;
}
