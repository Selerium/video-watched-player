import { describe, expect, it } from 'vitest';
import { MemoryStorageAdapter } from '../src/storage.js';

describe('MemoryStorageAdapter', () => {
  it('round-trips snapshots per videoId', () => {
    const s = new MemoryStorageAdapter();
    expect(s.load('a')).toBeNull();
    s.save('a', {
      version: 1,
      videoId: 'a',
      ranges: [{ start: 0, end: 5 }],
      lastPosition: 5,
      furthest: 5,
      watchedSeconds: 5,
      duration: 100,
      completed: false,
      updatedAt: 1,
    });
    expect(s.load('a')?.watchedSeconds).toBe(5);
    s.clear('a');
    expect(s.load('a')).toBeNull();
  });
});
