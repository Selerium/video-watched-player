import { RangeTracker } from './range-tracker.js';
import { resolveStorageAdapter } from './storage.js';
import { buildVideoElement, normalizeSources, resolveContainer } from './video-factory.js';
import { WsProgressSync } from './ws-sync.js';
import type {
  CreateWatchedVideoOptions,
  EventHandler,
  PlayerEventName,
  PlayerSnapshot,
  ProgressEvent,
  ResumeEvent,
  SeekBlockedEvent,
  StorageAdapter,
  StorageSnapshot,
  SyncEvent,
  VideoAttributes,
  VideoSourceInput,
} from './types.js';

/**
 * WatchedVideoPlayer — creates a <video> element and tracks actually-watched
 * intervals. Framework-agnostic; drop into any web project.
 *
 * ```ts
 * const player = createWatchedVideo({ src, videoId: 'lesson-1', container: '#app' });
 * player.on('complete', () => showBadge());
 * ```
 */
export class WatchedVideoPlayer {
  private video: HTMLVideoElement;
  private videoId: string;
  private tracker = new RangeTracker();
  private storage: StorageAdapter;
  private storagePrefix: string;
  private sync: WsProgressSync;
  private wsEventName: string;

  private autoResume: boolean;
  private completionThreshold: number;
  private preventSkipping: boolean;
  private skipToleranceSec: number;
  private resumeMinSec: number;
  private resumeEndGuardSec: number;
  private persistThrottleMs: number;
  private maxSampleGapSec: number;

  private lastSampleTime: number | null = null;
  private lastPosition = 0;
  private duration = 0;
  private completed = false;
  private completedEmitted = false;
  private lastPersistAt = 0;
  private destroyed = false;
  private listeners = new Map<PlayerEventName, Set<EventHandler<never>>>();
  private suppressSeekingGuard = false;

  private onTimeUpdate = (): void => this.handleSample();
  private onSeeking = (): void => this.handleSeeking();
  private onSeeked = (): void => this.handleSeeked();
  private onPlay = (): void => this.handlePlay();
  private onPause = (): void => this.handlePause(true);
  private onEnded = (): void => this.handleEnded();
  private onLoadedMetadata = (): void => this.handleLoadedMetadata();
  private onPageHide = (): void => this.handleUnload();

  constructor(options: CreateWatchedVideoOptions) {
    if (!options.videoId) throw new Error('videoId is required (used for persistence + sync).');
    const sources = normalizeSources(options.src);
    if (sources.length === 0) throw new Error('src is required (at least one video URL).');

    this.videoId = options.videoId;
    this.autoResume = options.autoResume ?? true;
    this.completionThreshold = clamp01(options.completionThreshold ?? 0.95);
    this.preventSkipping = options.preventSkipping ?? false;
    this.skipToleranceSec = options.skipToleranceSec ?? 2;
    this.resumeMinSec = options.resumeMinSec ?? 5;
    this.resumeEndGuardSec = options.resumeEndGuardSec ?? 10;
    this.persistThrottleMs = options.persistThrottleMs ?? 1000;
    this.maxSampleGapSec = options.maxSampleGapSec ?? 1.5;
    this.storagePrefix = options.storageKeyPrefix ?? 'vwp:v1:';
    this.storage = resolveStorageAdapter(options.storage, this.storagePrefix);
    this.wsEventName = options.wsEventName ?? 'video-watched';

    this.video = buildVideoElement(options.src, options.attributes ?? {});
    this.attachListeners();

    this.sync = new WsProgressSync({
      serverUrl: options.serverUrl,
      eventName: this.wsEventName,
      throttleMs: options.wsThrottleMs ?? 2000,
      authToken: options.authToken,
      onSync: (message) => this.emit<SyncEvent>('sync', { message }),
      onError: (error) => this.emit('sync-error', { error }),
    });

    if (options.onReady) this.on('ready', (p) => options.onReady?.(p.snapshot));
    if (options.onProgress)
      this.on('progress', (p) => options.onProgress?.(p.snapshot));
    if (options.onComplete)
      this.on('complete', (p) => options.onComplete?.(p.snapshot));
    if (options.onSeekBlocked) this.on('seek-blocked', (p) => options.onSeekBlocked?.(p));

    if (options.container) this.mount(options.container);

    // Restore persisted state eagerly so getters work even before metadata loads.
    this.restore();
  }

  // ---------- element / lifecycle ----------

  getVideoElement(): HTMLVideoElement {
    return this.video;
  }

  getVideoId(): string {
    return this.videoId;
  }

  mount(target: string | HTMLElement): void {
    this.assertAlive();
    const el = typeof target === 'string' ? resolveContainer(target) : target;
    if (!el) throw new Error(`mount target not found: ${String(target)}`);
    if (this.video.parentElement !== el) el.appendChild(this.video);
  }

  unmount(): void {
    this.video.remove();
  }

  setSource(src: VideoSourceInput, newVideoId?: string): void {
    this.assertAlive();
    const sources = normalizeSources(src);
    if (sources.length === 0) throw new Error('setSource requires at least one URL.');
    this.flushTracking('source-change');
    if (newVideoId) this.videoId = newVideoId;
    // Clear old <source> children + src, then rebuild.
    this.video.querySelectorAll('source').forEach((s) => s.remove());
    this.video.removeAttribute('src');
    if (sources.length === 1 && !sources[0]?.type) {
      this.video.src = sources[0]?.src ?? '';
    } else {
      for (const s of sources) {
        const el = document.createElement('source');
        el.src = s.src;
        if (s.type) el.type = s.type;
        this.video.appendChild(el);
      }
    }
    this.tracker.clear();
    this.lastSampleTime = null;
    this.lastPosition = 0;
    this.duration = 0;
    this.completed = false;
    this.completedEmitted = false;
    this.restore();
    this.video.load();
  }

  destroy(removeElement = true): void {
    if (this.destroyed) return;
    this.flushTracking('destroy');
    this.detachListeners();
    this.sync.destroy();
    if (removeElement) this.video.remove();
    this.emit('destroy', {});
    this.listeners.clear();
    this.destroyed = true;
  }

  // ---------- transport ----------

  async play(): Promise<void> {
    this.assertAlive();
    await this.video.play();
  }

  pause(): void {
    this.video.pause();
  }

  toggle(): void {
    if (this.video.paused) void this.play();
    else this.pause();
  }

  seekTo(seconds: number): void {
    this.assertAlive();
    if (!Number.isFinite(seconds) || seconds < 0) return;
    this.suppressSeekingGuard = true;
    try {
      this.video.currentTime = seconds;
    } finally {
      // Reset on next tick so programmatic seeks (incl. resume) aren't blocked.
      setTimeout(() => {
        this.suppressSeekingGuard = false;
      }, 0);
    }
    this.lastSampleTime = seconds;
  }

  setPreventSkipping(enabled: boolean): void {
    this.preventSkipping = enabled;
  }

  // ---------- queries ----------

  getWatchedRanges(): { start: number; end: number }[] {
    return this.tracker.getRanges();
  }

  getWatchedSeconds(): number {
    return this.tracker.totalSeconds();
  }

  getDuration(): number {
    return this.duration || this.video.duration || 0;
  }

  getCoveragePercent(): number {
    return this.tracker.coverage(this.getDuration()) * 100;
  }

  /** Where the playhead was at last save (best resume target). */
  getLastWatchedPosition(): number {
    return this.lastPosition;
  }

  /** Alias of getLastWatchedPosition. */
  getLastPosition(): number {
    return this.lastPosition;
  }

  /** Max end of watched intervals. */
  getFurthestWatched(): number {
    return this.tracker.furthest();
  }

  hasWatchedUpTo(seconds: number): boolean {
    return this.tracker.covers(seconds);
  }

  isCompleted(): boolean {
    return this.completed;
  }

  isVideoCompleted(): boolean {
    return this.completed;
  }

  getSnapshot(): PlayerSnapshot {
    const duration = this.getDuration();
    return {
      videoId: this.videoId,
      ranges: this.tracker.getRanges(),
      watchedSeconds: this.tracker.totalSeconds(),
      duration,
      coverage: this.tracker.coverage(duration),
      lastPosition: this.lastPosition,
      furthest: this.tracker.furthest(),
      completed: this.completed,
      updatedAt: Date.now(),
    };
  }

  // ---------- helpers ----------

  /**
   * Seek to the last watched position. No-op near 0.
   * @returns the position seeked to.
   */
  skipAheadToLastWatched(opts: { play?: boolean } = {}): number {
    this.assertAlive();
    const target = this.lastPosition;
    if (target > 1) this.seekTo(target);
    if (opts.play) void this.play().catch(() => undefined);
    return target > 1 ? target : this.video.currentTime;
  }

  /** Alias for skipAheadToLastWatched. */
  resume(opts: { play?: boolean } = {}): number {
    return this.skipAheadToLastWatched(opts);
  }

  resetProgress(clearPersisted = true): void {
    this.tracker.clear();
    this.lastPosition = 0;
    this.lastSampleTime = this.video.currentTime;
    this.completed = false;
    this.completedEmitted = false;
    if (clearPersisted) this.storage.clear(this.videoId);
    this.persist(true);
    this.emitProgress();
  }

  // ---------- events ----------

  on(event: 'ready' | 'progress' | 'complete', handler: (e: { snapshot: PlayerSnapshot }) => void): () => void;
  on(event: 'seek-blocked', handler: (e: SeekBlockedEvent) => void): () => void;
  on(event: 'resume', handler: (e: ResumeEvent) => void): () => void;
  on(event: 'sync', handler: (e: SyncEvent) => void): () => void;
  on(event: PlayerEventName, handler: EventHandler<never>): () => void;
  on(event: PlayerEventName, handler: EventHandler<never>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
    return () => this.off(event, handler);
  }

  off(event: PlayerEventName, handler: EventHandler<never>): void {
    this.listeners.get(event)?.delete(handler);
  }

  private emit<T>(event: PlayerEventName, payload: T): void {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;
    for (const fn of [...set]) {
      try {
        (fn as EventHandler<T>)(payload);
      } catch {
        // Listener errors must not break tracking.
      }
    }
  }

  // ---------- internals ----------

  private attachListeners(): void {
    this.video.addEventListener('timeupdate', this.onTimeUpdate);
    this.video.addEventListener('seeking', this.onSeeking);
    this.video.addEventListener('seeked', this.onSeeked);
    this.video.addEventListener('play', this.onPlay);
    this.video.addEventListener('pause', this.onPause);
    this.video.addEventListener('ended', this.onEnded);
    this.video.addEventListener('loadedmetadata', this.onLoadedMetadata);
    window.addEventListener('pagehide', this.onPageHide);
    document.addEventListener('visibilitychange', this.onPageHide);
  }

  private detachListeners(): void {
    this.video.removeEventListener('timeupdate', this.onTimeUpdate);
    this.video.removeEventListener('seeking', this.onSeeking);
    this.video.removeEventListener('seeked', this.onSeeked);
    this.video.removeEventListener('play', this.onPlay);
    this.video.removeEventListener('pause', this.onPause);
    this.video.removeEventListener('ended', this.onEnded);
    this.video.removeEventListener('loadedmetadata', this.onLoadedMetadata);
    window.removeEventListener('pagehide', this.onPageHide);
    document.removeEventListener('visibilitychange', this.onPageHide);
  }

  private handleSample(): void {
    if (this.destroyed || this.video.seeking || this.video.paused) {
      this.lastSampleTime = this.video.currentTime;
      return;
    }
    const now = this.video.currentTime;
    const prev = this.lastSampleTime;
    this.lastSampleTime = now;
    this.lastPosition = now;
    if (prev === null || !Number.isFinite(prev) || !Number.isFinite(now)) return;
    const delta = now - prev;
    // Only count forward, near-continuous playback (guards against seeks + stalls).
    const rate = this.video.playbackRate || 1;
    const maxGap = this.maxSampleGapSec * Math.max(rate, 1);
    if (delta > 0 && delta <= maxGap) {
      this.tracker.addRange(prev, now);
      this.afterProgress(false);
    }
  }

  private handleSeeking(): void {
    if (this.destroyed || this.suppressSeekingGuard || !this.preventSkipping) return;
    const target = this.video.currentTime;
    const furthest = this.tracker.furthest();
    // Always allow rewind; block jumps ahead past furthest + tolerance.
    if (target > furthest + this.skipToleranceSec && furthest > 0) {
      const attempted = target;
      this.suppressSeekingGuard = true;
      // Defer so we don't fight the browser mid-seek.
      requestAnimationFrame(() => {
        try {
          this.video.currentTime = furthest;
        } finally {
          setTimeout(() => {
            this.suppressSeekingGuard = false;
          }, 0);
        }
      });
      this.lastSampleTime = furthest;
      this.emit<SeekBlockedEvent>('seek-blocked', { attempted, clampedTo: furthest });
    }
  }

  private handleSeeked(): void {
    if (this.destroyed) return;
    // Break continuity so the jump itself is never counted as watched.
    this.lastSampleTime = this.video.currentTime;
    this.lastPosition = this.video.currentTime;
    this.persist(false);
  }

  private handlePlay(): void {
    this.lastSampleTime = this.video.currentTime;
  }

  private handlePause(flushSync: boolean): void {
    if (this.destroyed) return;
    this.handleSample();
    this.lastPosition = this.video.currentTime;
    this.persist(true);
    if (flushSync) this.queueSync(true);
  }

  private handleEnded(): void {
    if (this.destroyed) return;
    this.handleSample();
    this.lastPosition = this.video.currentTime;
    this.afterProgress(true);
    this.persist(true);
    this.queueSync(true);
  }

  private handleLoadedMetadata(): void {
    if (this.destroyed) return;
    this.duration = Number.isFinite(this.video.duration) ? this.video.duration : 0;
    this.restore();
    // Auto resume = automatic skipAheadToLastWatched on load.
    if (this.autoResume) {
      const pos = this.lastPosition;
      const dur = this.getDuration();
      const nearEnd = dur > 0 && pos > dur - this.resumeEndGuardSec;
      if (pos >= this.resumeMinSec && !nearEnd && Number.isFinite(pos)) {
        try {
          this.suppressSeekingGuard = true;
          this.video.currentTime = pos;
          this.lastSampleTime = pos;
          setTimeout(() => {
            this.suppressSeekingGuard = false;
          }, 0);
          this.emit<ResumeEvent>('resume', { position: pos });
        } catch {
          this.suppressSeekingGuard = false;
        }
      }
    }
    this.emit('ready', { snapshot: this.getSnapshot() });
  }

  private handleUnload(): void {
    if (this.destroyed) return;
    if (document.visibilityState === 'hidden' || true) {
      this.lastPosition = this.video.currentTime;
      this.persist(true);
      this.queueSync(true);
      this.sync.flush();
    }
  }

  private afterProgress(forceSync: boolean): void {
    this.checkCompletion();
    this.persist(false);
    this.emitProgress();
    this.queueSync(forceSync);
  }

  private checkCompletion(): void {
    if (this.completedEmitted) return;
    const duration = this.getDuration();
    if (!Number.isFinite(duration) || duration <= 0) return;
    const coverage = this.tracker.coverage(duration);
    if (coverage >= this.completionThreshold) {
      this.completed = true;
      this.completedEmitted = true;
      this.persist(true);
      const snap = this.getSnapshot();
      this.emit('complete', { snapshot: snap });
      this.queueSync(true);
    }
  }

  private emitProgress(): void {
    this.emit<ProgressEvent>('progress', { snapshot: this.getSnapshot() });
  }

  private restore(): void {
    try {
      const saved = this.storage.load(this.videoId);
      if (!saved) return;
      this.tracker = new RangeTracker(saved.ranges);
      this.lastPosition = Number.isFinite(saved.lastPosition) ? saved.lastPosition : 0;
      this.completed = saved.completed === true;
      this.completedEmitted = this.completed;
      if (Number.isFinite(saved.duration) && saved.duration > 0) this.duration = saved.duration;
    } catch {
      // Corrupt storage: start fresh.
    }
  }

  private persist(force: boolean): void {
    const now = Date.now();
    if (!force && now - this.lastPersistAt < this.persistThrottleMs) return;
    this.lastPersistAt = now;
    const snap = this.getSnapshot();
    const stored: StorageSnapshot = {
      version: 1,
      videoId: snap.videoId,
      ranges: snap.ranges,
      lastPosition: snap.lastPosition,
      furthest: snap.furthest,
      watchedSeconds: snap.watchedSeconds,
      duration: snap.duration,
      completed: snap.completed,
      updatedAt: snap.updatedAt,
    };
    try {
      this.storage.save(this.videoId, stored);
    } catch {
      // ignore
    }
  }

  private queueSync(force: boolean): void {
    if (!this.sync.enabled) return;
    const snap = this.getSnapshot();
    this.sync.send(
      {
        videoId: snap.videoId,
        watched: round1(snap.watchedSeconds),
        furthest: round1(snap.furthest),
        lastPosition: round1(snap.lastPosition),
        completed: snap.completed,
      },
      force,
    );
  }

  private flushTracking(_reason: string): void {
    try {
      this.handleSample();
    } catch {
      // ignore
    }
    this.lastPosition = safeCurrentTime(this.video);
    this.persist(true);
    this.queueSync(true);
    this.sync.flush();
  }

  private assertAlive(): void {
    if (this.destroyed) throw new Error('WatchedVideoPlayer has been destroyed.');
  }
}

/** Factory shorthand: `createWatchedVideo({...})`. */
export function createWatchedVideo(options: CreateWatchedVideoOptions): WatchedVideoPlayer {
  return new WatchedVideoPlayer(options);
}

export type { CreateWatchedVideoOptions, VideoAttributes, VideoSourceInput };

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.95;
  return Math.min(1, Math.max(0, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function safeCurrentTime(video: HTMLVideoElement): number {
  try {
    return Number.isFinite(video.currentTime) ? video.currentTime : 0;
  } catch {
    return 0;
  }
}
