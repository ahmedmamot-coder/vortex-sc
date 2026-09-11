/**
 * Spectral-flux onset detection — for locking the split clock to the starter's
 * beep in a race clip instead of a hand tap.
 *
 * The caller feeds it one frequency spectrum per animation frame (the Web Audio
 * analyser's bytes, normalised to 0..1). Each frame it measures spectral flux —
 * the total *rise* in energy across the bins since the last frame — which spikes
 * hard when a tone suddenly appears (the beep) and stays near zero through steady
 * crowd noise. It fires the first time that spike clears an adaptive threshold
 * built from the recent baseline, so a loud-but-steady room does not trip it.
 *
 * Pure and deterministic: no Web Audio here, so the decision can be unit-tested
 * with synthetic spectra. The thin analyser wiring lives in the video client.
 */
export interface OnsetOptions {
  /** How many recent flux samples form the adaptive baseline (~0.7s at 60fps). */
  windowSize?: number;
  /** Standard deviations above the rolling mean that count as an onset. */
  sensitivity?: number;
  /** Absolute flux floor, so a near-silent baseline can't fire on a ripple. */
  minFlux?: number;
  /** Frames to observe before it may fire, so the baseline can settle. */
  warmup?: number;
}

const DEFAULTS: Required<OnsetOptions> = {
  windowSize: 43,
  sensitivity: 4,
  minFlux: 0.03,
  warmup: 8,
};

export class OnsetDetector {
  private prev: number[] | null = null;
  private history: number[] = [];
  private count = 0;
  private readonly opts: Required<OnsetOptions>;

  constructor(opts: OnsetOptions = {}) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  /**
   * Feed one spectrum frame (magnitudes normalised to 0..1). Returns true on the
   * frame an onset is detected. The caller is expected to stop feeding after the
   * first true — a start happens once.
   */
  push(spectrum: ArrayLike<number>): boolean {
    const n = spectrum.length;
    const cur = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const v = spectrum[i];
      cur[i] = v > 0 ? v : 0;
    }

    let flux = 0;
    if (this.prev) {
      for (let i = 0; i < n; i++) {
        const d = cur[i] - this.prev[i];
        if (d > 0) flux += d;
      }
      if (n > 0) flux /= n; // per-bin average rise, so it stays in 0..1
    }
    this.prev = cur;
    this.count++;

    const { windowSize, sensitivity, minFlux, warmup } = this.opts;
    let fired = false;
    if (this.count > warmup && this.history.length >= warmup) {
      const mean = this.history.reduce((a, b) => a + b, 0) / this.history.length;
      const variance =
        this.history.reduce((a, b) => a + (b - mean) ** 2, 0) / this.history.length;
      const std = Math.sqrt(variance);
      const threshold = Math.max(minFlux, mean + sensitivity * std);
      if (flux > threshold) fired = true;
    }

    this.history.push(flux);
    if (this.history.length > windowSize) this.history.shift();

    return fired;
  }
}
