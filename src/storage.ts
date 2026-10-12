import type { StorageAdapter, StorageSnapshot } from './types.js';

export function storageKey(prefix: string, videoId: string): string {
  return `${prefix}${videoId}`;
}

export class MemoryStorageAdapter implements StorageAdapter {
  private map = new Map<string, StorageSnapshot>();

  load(videoId: string): StorageSnapshot | null {
    return this.map.get(videoId) ?? null;
  }

  save(videoId: string, snap: StorageSnapshot): void {
    this.map.set(videoId, { ...snap, ranges: snap.ranges.map((r) => ({ ...r })) });
  }

  clear(videoId: string): void {
    this.map.delete(videoId);
  }
}

export class LocalStorageAdapter implements StorageAdapter {
  private prefix: string;

  constructor(prefix = 'vwp:v1:') {
    this.prefix = prefix;
  }

  private get ls(): Storage | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      return localStorage;
    } catch {
      return null;
    }
  }

  load(videoId: string): StorageSnapshot | null {
    const store = this.ls;
    if (!store) return null;
    try {
      const raw = store.getItem(storageKey(this.prefix, videoId));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as StorageSnapshot;
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.ranges)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  save(videoId: string, snap: StorageSnapshot): void {
    const store = this.ls;
    if (!store) return;
    try {
      store.setItem(storageKey(this.prefix, videoId), JSON.stringify(snap));
    } catch {
      // Quota / private mode: fail silently, tracking continues in memory.
    }
  }

  clear(videoId: string): void {
    const store = this.ls;
    if (!store) return;
    try {
      store.removeItem(storageKey(this.prefix, videoId));
    } catch {
      // ignore
    }
  }
}

export function resolveStorageAdapter(
  input: 'localStorage' | 'memory' | StorageAdapter | undefined,
  prefix: string,
): StorageAdapter {
  if (!input || input === 'localStorage') return new LocalStorageAdapter(prefix);
  if (input === 'memory') return new MemoryStorageAdapter();
  return input;
}
