/**
 * Per-frame stability counters for the OpenVR-paced overlay loop. Averages hide the
 * one-frame hitches that read as stutter, so every frame is classified:
 *
 * - `skipped`: display frames that passed with no overlay frame (vsync index gap).
 * - `unpaced`: frames that rendered without waiting for a new vsync.
 * - `stale`: the scene was captured before r3f advanced since the previous capture, so
 *   input, lasers and moving objects repeat a frame.
 * - `doubled`: r3f advanced more than once between captures, so a state was never shown.
 * - `late`: the loop interval exceeded 1.5x the display period.
 */
export type FrameStabilitySample = {
  frames: number;
  skipped: number;
  unpaced: number;
  stale: number;
  doubled: number;
  late: number;
  maxIntervalMs: number;
};

const emptySample = (): FrameStabilitySample => ({
  frames: 0,
  skipped: 0,
  unpaced: 0,
  stale: 0,
  doubled: 0,
  late: 0,
  maxIntervalMs: 0,
});

export class FrameStabilityTracker {
  private window = emptySample();
  /** Since start; the agent REPL reads it to measure a run. */
  readonly total = emptySample();
  private lastFrameAt = 0;
  private lastHostFrameCount = -1;

  /**
   * One rendered overlay frame. `hostFrameCount` is the r3f tick count at capture;
   * `periodMs` is the nominal display period.
   */
  record(
    pace: { skippedDisplayFrames: number; waitedForVsync: boolean } | null,
    hostFrameCount: number,
    periodMs: number,
    now = performance.now(),
  ): void {
    const interval = this.lastFrameAt > 0 ? now - this.lastFrameAt : 0;
    this.lastFrameAt = now;
    const advanced = this.lastHostFrameCount >= 0 ? hostFrameCount - this.lastHostFrameCount : 1;
    this.lastHostFrameCount = hostFrameCount;
    for (const sample of [this.window, this.total]) {
      sample.frames++;
      if (pace) {
        sample.skipped += pace.skippedDisplayFrames;
        if (!pace.waitedForVsync) sample.unpaced++;
      }
      if (advanced === 0) sample.stale++;
      if (advanced > 1) sample.doubled++;
      if (interval > periodMs * 1.5) sample.late++;
      sample.maxIntervalMs = Math.max(sample.maxIntervalMs, interval);
    }
  }

  flush(): FrameStabilitySample {
    const sample = this.window;
    this.window = emptySample();
    return sample;
  }

  reset(): void {
    this.window = emptySample();
    Object.assign(this.total, emptySample());
    this.lastFrameAt = 0;
    this.lastHostFrameCount = -1;
  }
}

export function formatFrameStability(sample: FrameStabilitySample): string {
  return `frames=${sample.frames} skipped=${sample.skipped} unpaced=${sample.unpaced} ` +
    `stale=${sample.stale} doubled=${sample.doubled} late=${sample.late} ` +
    `maxInterval=${sample.maxIntervalMs.toFixed(2)}ms`;
}
