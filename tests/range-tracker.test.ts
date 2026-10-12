import { describe, expect, it } from 'vitest';
import { RangeTracker } from '../src/range-tracker.js';

describe('RangeTracker', () => {
  it('merges overlapping intervals', () => {
    const t = new RangeTracker();
    t.addRange(0, 5);
    t.addRange(3, 8);
    expect(t.getRanges()).toEqual([{ start: 0, end: 8 }]);
    expect(t.totalSeconds()).toBe(8);
  });

  it('keeps disjoint intervals separate', () => {
    const t = new RangeTracker();
    t.addRange(0, 5);
    t.addRange(10, 15);
    expect(t.getRanges()).toEqual([
      { start: 0, end: 5 },
      { start: 10, end: 15 },
    ]);
    expect(t.totalSeconds()).toBe(10);
  });

  it('does not count scrub jumps (caller simply never adds them)', () => {
    const t = new RangeTracker();
    t.addRange(0, 5);
    // A seek from 5 -> 60 adds nothing; only real playback adds.
    t.addRange(60, 62);
    expect(t.totalSeconds()).toBe(7);
    expect(t.furthest()).toBe(62);
  });

  it('computes coverage and furthest', () => {
    const t = new RangeTracker([{ start: 0, end: 90 }]);
    expect(t.coverage(100)).toBeCloseTo(0.9);
    expect(t.coverage(0)).toBe(0);
    expect(t.furthest()).toBe(90);
  });

  it('ignores invalid ranges', () => {
    const t = new RangeTracker();
    t.addRange(5, 5);
    t.addRange(8, 3);
    t.addRange(NaN, 10);
    expect(t.getRanges()).toEqual([]);
  });

  it('covers() detects watched positions', () => {
    const t = new RangeTracker([{ start: 10, end: 20 }]);
    expect(t.covers(15)).toBe(true);
    expect(t.covers(20)).toBe(false);
    expect(t.covers(5)).toBe(false);
  });
});
