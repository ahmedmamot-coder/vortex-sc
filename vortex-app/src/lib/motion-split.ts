/**
 * Ordered motion-crossing detection — the brain of fixed-camera auto-split.
 *
 * On a still camera each distance marker (15/25/35/45/50m) sits at a fixed column
 * of pixels. As the swimmer's bow wave sweeps through that column, frame-to-frame
 * motion there rises to a peak and falls. This sequences those peaks in race
 * order: it watches one marker's column at a time, finalises a crossing at the
 * moment motion peaks (not the leading edge, which runs a touch early), then
 * advances to the next marker — so turbulence at a later line can't be mistaken
 * for an earlier split, and one long wave can't score twice.
 *
 * Pure and deterministic: the caller supplies the motion number for the *current*
 * expected column each frame (a mean pixel-difference the client computes on a
 * canvas), and a timestamp in seconds from the gun. No canvas or DOM here, so the
 * sequencing logic is unit-tested with synthetic motion.
 */
export interface CrossingMarker {
  label: string;
  metres: number;
}

export interface SequencerOptions {
  /** Standard deviations above the column's rolling baseline that count as motion. */
  sensitivity?: number;
  /** Absolute motion floor, so a dead-still column can't trip on noise. */
  minFloor?: number;
  /** Frames to let a fresh column's baseline settle before it may fire. */
  settle?: number;
  /** Minimum seconds between two crossings — a swimmer can't be at two marks at once. */
  cooldownS?: number;
  /** Once over threshold, how long to keep tracking for the true peak. */
  peakWindowS?: number;
}

export interface Crossing {
  label: string;
  metres: number;
  seconds: number;
}

const DEFAULTS: Required<SequencerOptions> = {
  sensitivity: 3,
  minFloor: 0.015,
  settle: 6,
  cooldownS: 1.2,
  peakWindowS: 0.6,
};

export class CrossingSequencer {
  private readonly markers: CrossingMarker[];
  private readonly opts: Required<SequencerOptions>;
  private idx = 0;
  private history: number[] = [];
  private seen = 0; // frames observed on the current column
  private lastCrossingT = -Infinity;
  private peaking = false;
  private peakVal = 0;
  private peakT = 0;
  private peakStartT = 0;

  constructor(markers: CrossingMarker[], opts: SequencerOptions = {}) {
    this.markers = markers;
    this.opts = { ...DEFAULTS, ...opts };
  }

  get done(): boolean {
    return this.idx >= this.markers.length;
  }

  /** The marker the sequencer is currently watching, or null once finished. */
  get current(): CrossingMarker | null {
    return this.markers[this.idx] ?? null;
  }

  private advance() {
    this.idx++;
    this.history = [];
    this.seen = 0;
    this.peaking = false;
    this.peakVal = 0;
  }

  /**
   * Feed the motion for the current expected column at time `t` (seconds from the
   * gun). Returns a Crossing on the frame a crossing is finalised, else null.
   */
  push(motion: number, t: number): Crossing | null {
    if (this.done) return null;
    const m = motion > 0 ? motion : 0;
    this.seen++;

    const { sensitivity, minFloor, settle, cooldownS, peakWindowS } = this.opts;

    let threshold = Infinity;
    if (this.history.length >= settle) {
      const mean = this.history.reduce((a, b) => a + b, 0) / this.history.length;
      const variance =
        this.history.reduce((a, b) => a + (b - mean) ** 2, 0) / this.history.length;
      const std = Math.sqrt(variance);
      threshold = Math.max(minFloor, mean + sensitivity * std);
    }

    const ready = this.seen > settle && t - this.lastCrossingT >= cooldownS;

    if (this.peaking) {
      if (m > this.peakVal) {
        this.peakVal = m;
        this.peakT = t;
      }
      // Finalise when the wave has passed (motion fell well back) or the window closed.
      if (m < threshold * 0.5 || t - this.peakStartT >= peakWindowS) {
        const crossing: Crossing = {
          label: this.markers[this.idx].label,
          metres: this.markers[this.idx].metres,
          seconds: this.peakT,
        };
        this.lastCrossingT = this.peakT;
        this.advance();
        return crossing;
      }
    } else if (ready && m > threshold) {
      this.peaking = true;
      this.peakVal = m;
      this.peakT = t;
      this.peakStartT = t;
    }

    // Grow the baseline only while quiet, so a rising wave doesn't inflate its own threshold.
    if (!this.peaking) {
      this.history.push(m);
      if (this.history.length > 90) this.history.shift();
    }

    return null;
  }
}
