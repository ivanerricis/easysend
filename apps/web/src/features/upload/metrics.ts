/** Pure progress maths for the upload engine: moving-average speed, ETA and percentages. */

export const SPEED_WINDOW_MS = 5000;

/** Moving average of the transfer speed over the last `windowMs` of samples. */
export class SpeedTracker {
  private samples: { time: number; bytes: number }[] = [];
  private readonly windowMs: number;

  constructor(windowMs: number = SPEED_WINDOW_MS) {
    this.windowMs = windowMs;
  }

  /** Records the cumulative number of bytes sent at `time` (ms) and returns bytes/second. */
  add(time: number, totalBytes: number): number {
    this.samples.push({ time, bytes: totalBytes });
    const limit = time - this.windowMs;
    // Keep one sample older than the window so the average always spans the full window.
    while (this.samples.length > 2 && (this.samples[1]?.time ?? Infinity) <= limit) {
      this.samples.shift();
    }
    return this.speed();
  }

  speed(): number {
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    if (!first || !last || last.time <= first.time) return 0;
    const bytes = Math.max(0, last.bytes - first.bytes);
    return (bytes * 1000) / (last.time - first.time);
  }

  /** Forget everything (after a pause: the idle time must not lower the average). */
  reset(): void {
    this.samples = [];
  }
}

/** Seconds left at the current speed, or `null` while the speed is unknown. */
export function etaSeconds(
  sentBytes: number,
  totalBytes: number,
  bytesPerSecond: number,
): number | null {
  if (totalBytes <= sentBytes) return 0;
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return null;
  return (totalBytes - sentBytes) / bytesPerSecond;
}

/** Whole percentage 0..100; an empty total counts as complete. */
export function percentOf(sentBytes: number, totalBytes: number): number {
  if (totalBytes <= 0) return 100;
  return Math.max(0, Math.min(100, Math.floor((sentBytes / totalBytes) * 100)));
}
