import { describe, expect, it } from 'vitest';
import { SpeedTracker, etaSeconds, percentOf } from './metrics';

describe('SpeedTracker', () => {
  it('is zero until two samples exist', () => {
    const tracker = new SpeedTracker();
    expect(tracker.speed()).toBe(0);
    expect(tracker.add(0, 0)).toBe(0);
  });

  it('averages bytes per second over the samples', () => {
    const tracker = new SpeedTracker();
    tracker.add(0, 0);
    expect(tracker.add(1000, 1_000_000)).toBeCloseTo(1_000_000);
    expect(tracker.add(2000, 3_000_000)).toBeCloseTo(1_500_000);
  });

  it('forgets samples older than the window', () => {
    const tracker = new SpeedTracker(5000);
    tracker.add(0, 0);
    tracker.add(1000, 10_000_000); // a fast start
    tracker.add(10_000, 10_000_000);
    // From the sample just before the window (t=1000) to t=11000: nothing moved.
    expect(tracker.add(11_000, 10_000_000)).toBeCloseTo(0);
  });

  it('starts over after a reset (pause)', () => {
    const tracker = new SpeedTracker();
    tracker.add(0, 0);
    tracker.add(1000, 1000);
    tracker.reset();
    expect(tracker.speed()).toBe(0);
  });
});

describe('etaSeconds', () => {
  it('divides what is left by the speed', () => {
    expect(etaSeconds(1000, 11_000, 1000)).toBe(10);
  });

  it('is unknown without a speed and zero when done', () => {
    expect(etaSeconds(0, 100, 0)).toBeNull();
    expect(etaSeconds(100, 100, 0)).toBe(0);
  });
});

describe('percentOf', () => {
  it('floors the percentage and clamps it', () => {
    expect(percentOf(449, 1000)).toBe(44);
    expect(percentOf(2000, 1000)).toBe(100);
    expect(percentOf(-5, 1000)).toBe(0);
  });

  it('treats an empty total as complete', () => {
    expect(percentOf(0, 0)).toBe(100);
  });
});
