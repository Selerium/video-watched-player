import type { WatchedRange } from './types.js';

/**
 * Pure interval tracker. No DOM. All merging / coverage math lives here
 * so it is unit-testable and reusable.
 */
export class RangeTracker {
  private ranges: WatchedRange[] = [];

  constructor(initial: WatchedRange[] = []) {
    if (initial.length > 0) this.addRanges(initial);
  }

  /** Add a single [start, end) interval and merge overlaps. No-op for invalid input. */
  addRange(start: number, end: number): void {
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    if (end <= start) return;
    if (start < 0) start = 0;
    this.ranges.push({ start, end });
    this.normalize();
  }

  addRanges(list: WatchedRange[]): void {
    for (const r of list) this.addRange(r.start, r.end);
  }

  /** Sorted, non-overlapping copy. */
  getRanges(): WatchedRange[] {
    return this.ranges.map((r) => ({ ...r }));
  }

  /** Sum of merged interval lengths. */
  totalSeconds(): number {
    let total = 0;
    for (const r of this.ranges) total += r.end - r.start;
    return total;
  }

  /** Max end of all intervals, 0 when empty. */
  furthest(): number {
    let max = 0;
    for (const r of this.ranges) if (r.end > max) max = r.end;
    return max;
  }

  /** Fraction 0..1 of duration covered. 0 when duration invalid. */
  coverage(duration: number): number {
    if (!Number.isFinite(duration) || duration <= 0) return 0;
    return Math.min(1, this.totalSeconds() / duration);
  }

  /** True if time t falls inside any watched interval. */
  covers(t: number): boolean {
    for (const r of this.ranges) {
      if (t >= r.start && t < r.end) return true;
    }
    return false;
  }

  clear(): void {
    this.ranges = [];
  }

  private normalize(): void {
    const sorted = [...this.ranges].sort((a, b) => a.start - b.start);
    const merged: WatchedRange[] = [];
    for (const r of sorted) {
      const last = merged[merged.length - 1];
      if (!last || r.start > last.end) {
        merged.push({ ...r });
      } else if (r.end > last.end) {
        last.end = r.end;
      }
    }
    this.ranges = merged;
  }
}
