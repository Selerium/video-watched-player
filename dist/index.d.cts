/** A single watched interval: [start, end) in seconds. */
interface WatchedRange {
    start: number;
    end: number;
}
type VideoSourceInput = string | string[] | VideoSourceObject[] | (string | VideoSourceObject)[];
interface VideoSourceObject {
    src: string;
    type?: string;
}
/** Arbitrary <video> attributes. `src`/`id` handled separately. */
type VideoAttributes = Record<string, string | number | boolean | null | undefined>;
interface StorageSnapshot {
    version: 1;
    videoId: string;
    ranges: WatchedRange[];
    /** Where the playhead was when last saved (for resume UX). */
    lastPosition: number;
    /** Max end of merged intervals. */
    furthest: number;
    /** Sum of merged interval lengths. */
    watchedSeconds: number;
    duration: number;
    completed: boolean;
    updatedAt: number;
}
/** Serializable state for UI + server sync. */
interface PlayerSnapshot {
    videoId: string;
    ranges: WatchedRange[];
    watchedSeconds: number;
    duration: number;
    coverage: number;
    lastPosition: number;
    furthest: number;
    completed: boolean;
    updatedAt: number;
}
/** Wire payload sent over WebSocket. Server does MAX(watched) per videoId. */
interface VideoWatchedMessage {
    event: string;
    videoId: string;
    /** Total unique seconds watched (sum of merged intervals). Primary field. */
    watched: number;
    /** Max end of intervals, for cross-device resume. */
    furthest: number;
    lastPosition: number;
    completed: boolean;
    token?: string;
}
interface StorageAdapter {
    load(videoId: string): StorageSnapshot | null;
    save(videoId: string, snap: StorageSnapshot): void;
    clear(videoId: string): void;
}
type PlayerEventName = 'ready' | 'progress' | 'complete' | 'seek-blocked' | 'resume' | 'sync' | 'sync-error' | 'destroy';
interface ProgressEvent {
    snapshot: PlayerSnapshot;
}
interface SeekBlockedEvent {
    attempted: number;
    clampedTo: number;
}
interface ResumeEvent {
    position: number;
}
interface SyncEvent {
    message: VideoWatchedMessage;
}
type EventHandler<T = unknown> = (payload: T) => void;
interface CreateWatchedVideoOptions {
    /** Video file URL(s). String, list, or [{src, type}]. */
    src: VideoSourceInput;
    /** Stable id used for localStorage key + server sync. Required. */
    videoId: string;
    /** Optional mount target. If omitted, element is detached until mount() is called. */
    container?: string | HTMLElement;
    /** Passed through to the <video> element (controls, muted, poster, ...). */
    attributes?: VideoAttributes;
    /** Auto-seek to lastPosition on loadedmetadata. Default true. */
    autoResume?: boolean;
    /** watchedSeconds / duration needed to count as completed. Default 0.95. */
    completionThreshold?: number;
    /** If true, seeks past furthestWatched + tolerance are clamped back. Default false. */
    preventSkipping?: boolean;
    /** Leeway past furthest before a seek is blocked. Default 2 (seconds). */
    skipToleranceSec?: number;
    /** Min seconds since video start before autoResume applies. Default 5. */
    resumeMinSec?: number;
    /** Don't autoResume into the last N seconds (credits). Default 10. */
    resumeEndGuardSec?: number;
    /** How often timeupdate sampling runs. Default 250ms (uses video events, not polling). */
    sampleIntervalMs?: number;
    /** Throttle for localStorage writes. Default 1000ms. */
    persistThrottleMs?: number;
    /** 'localStorage' (default) | 'memory' | custom adapter. */
    storage?: 'localStorage' | 'memory' | StorageAdapter;
    /** Storage key prefix. Default 'vwp:v1:'. */
    storageKeyPrefix?: string;
    /** WebSocket endpoint. If omitted, WS sync is fully disabled. */
    serverUrl?: string;
    /** Throttle for WS sends. Default 2000ms. */
    wsThrottleMs?: number;
    /** WS event name. Default 'video-watched'. */
    wsEventName?: string;
    /** Optional auth token included in WS payload. */
    authToken?: string;
    /** Max sample gap (sec) still counted as continuous watching. Default 1.5. */
    maxSampleGapSec?: number;
    onReady?: (snapshot: PlayerSnapshot) => void;
    onProgress?: (snapshot: PlayerSnapshot) => void;
    onComplete?: (snapshot: PlayerSnapshot) => void;
    onSeekBlocked?: (e: SeekBlockedEvent) => void;
}

/**
 * WatchedVideoPlayer — creates a <video> element and tracks actually-watched
 * intervals. Framework-agnostic; drop into any web project.
 *
 * ```ts
 * const player = createWatchedVideo({ src, videoId: 'lesson-1', container: '#app' });
 * player.on('complete', () => showBadge());
 * ```
 */
declare class WatchedVideoPlayer {
    private video;
    private videoId;
    private tracker;
    private storage;
    private storagePrefix;
    private sync;
    private wsEventName;
    private autoResume;
    private completionThreshold;
    private preventSkipping;
    private skipToleranceSec;
    private resumeMinSec;
    private resumeEndGuardSec;
    private persistThrottleMs;
    private maxSampleGapSec;
    private lastSampleTime;
    private lastPosition;
    private duration;
    private completed;
    private completedEmitted;
    private lastPersistAt;
    private destroyed;
    private listeners;
    private suppressSeekingGuard;
    private onTimeUpdate;
    private onSeeking;
    private onSeeked;
    private onPlay;
    private onPause;
    private onEnded;
    private onLoadedMetadata;
    private onPageHide;
    constructor(options: CreateWatchedVideoOptions);
    getVideoElement(): HTMLVideoElement;
    getVideoId(): string;
    mount(target: string | HTMLElement): void;
    unmount(): void;
    setSource(src: VideoSourceInput, newVideoId?: string): void;
    destroy(removeElement?: boolean): void;
    play(): Promise<void>;
    pause(): void;
    toggle(): void;
    seekTo(seconds: number): void;
    setPreventSkipping(enabled: boolean): void;
    getWatchedRanges(): {
        start: number;
        end: number;
    }[];
    getWatchedSeconds(): number;
    getDuration(): number;
    getCoveragePercent(): number;
    /** Where the playhead was at last save (best resume target). */
    getLastWatchedPosition(): number;
    /** Alias of getLastWatchedPosition. */
    getLastPosition(): number;
    /** Max end of watched intervals. */
    getFurthestWatched(): number;
    hasWatchedUpTo(seconds: number): boolean;
    isCompleted(): boolean;
    isVideoCompleted(): boolean;
    getSnapshot(): PlayerSnapshot;
    /**
     * Seek to the last watched position. No-op near 0.
     * @returns the position seeked to.
     */
    skipAheadToLastWatched(opts?: {
        play?: boolean;
    }): number;
    /** Alias for skipAheadToLastWatched. */
    resume(opts?: {
        play?: boolean;
    }): number;
    resetProgress(clearPersisted?: boolean): void;
    on(event: 'ready' | 'progress' | 'complete', handler: (e: {
        snapshot: PlayerSnapshot;
    }) => void): () => void;
    on(event: 'seek-blocked', handler: (e: SeekBlockedEvent) => void): () => void;
    on(event: 'resume', handler: (e: ResumeEvent) => void): () => void;
    on(event: 'sync', handler: (e: SyncEvent) => void): () => void;
    on(event: PlayerEventName, handler: EventHandler<never>): () => void;
    off(event: PlayerEventName, handler: EventHandler<never>): void;
    private emit;
    private attachListeners;
    private detachListeners;
    private handleSample;
    private handleSeeking;
    private handleSeeked;
    private handlePlay;
    private handlePause;
    private handleEnded;
    private handleLoadedMetadata;
    private handleUnload;
    private afterProgress;
    private checkCompletion;
    private emitProgress;
    private restore;
    private persist;
    private queueSync;
    private flushTracking;
    private assertAlive;
}
/** Factory shorthand: `createWatchedVideo({...})`. */
declare function createWatchedVideo(options: CreateWatchedVideoOptions): WatchedVideoPlayer;

/**
 * Pure interval tracker. No DOM. All merging / coverage math lives here
 * so it is unit-testable and reusable.
 */
declare class RangeTracker {
    private ranges;
    constructor(initial?: WatchedRange[]);
    /** Add a single [start, end) interval and merge overlaps. No-op for invalid input. */
    addRange(start: number, end: number): void;
    addRanges(list: WatchedRange[]): void;
    /** Sorted, non-overlapping copy. */
    getRanges(): WatchedRange[];
    /** Sum of merged interval lengths. */
    totalSeconds(): number;
    /** Max end of all intervals, 0 when empty. */
    furthest(): number;
    /** Fraction 0..1 of duration covered. 0 when duration invalid. */
    coverage(duration: number): number;
    /** True if time t falls inside any watched interval. */
    covers(t: number): boolean;
    clear(): void;
    private normalize;
}

declare class MemoryStorageAdapter implements StorageAdapter {
    private map;
    load(videoId: string): StorageSnapshot | null;
    save(videoId: string, snap: StorageSnapshot): void;
    clear(videoId: string): void;
}
declare class LocalStorageAdapter implements StorageAdapter {
    private prefix;
    constructor(prefix?: string);
    private get ls();
    load(videoId: string): StorageSnapshot | null;
    save(videoId: string, snap: StorageSnapshot): void;
    clear(videoId: string): void;
}

interface WsSyncOptions {
    serverUrl?: string | undefined;
    eventName: string;
    throttleMs: number;
    authToken?: string | undefined;
    onSync?: ((message: VideoWatchedMessage) => void) | undefined;
    onError?: ((error: unknown) => void) | undefined;
}
/**
 * Fire-and-forget WebSocket sync. Fully disabled when no serverUrl.
 * Server contract: { event: 'video-watched', videoId, watched, furthest, lastPosition, completed }
 * Server keeps MAX(watched) per videoId.
 */
declare class WsProgressSync {
    private ws;
    private lastSendAt;
    private pending;
    private flushTimer;
    private reconnectAttempts;
    private destroyed;
    private opts;
    constructor(opts: WsSyncOptions);
    get enabled(): boolean;
    /** Queue a message; throttled send unless force=true. */
    send(msg: Omit<VideoWatchedMessage, 'event' | 'token'>, force?: boolean): void;
    /** Immediately send anything pending (pause / complete / unload). */
    flush(): void;
    destroy(): void;
    private ensureSocket;
    private transmit;
}

/**
 * Create a <video> element from a source + attribute bag.
 * Handles <source> children so multiple formats/codecs work.
 */
declare function buildVideoElement(src: VideoSourceInput, attributes?: VideoAttributes): HTMLVideoElement;

export { type CreateWatchedVideoOptions, LocalStorageAdapter, MemoryStorageAdapter, type PlayerEventName, type PlayerSnapshot, type ProgressEvent, RangeTracker, type ResumeEvent, type SeekBlockedEvent, type StorageAdapter, type StorageSnapshot, type SyncEvent, type VideoAttributes, type VideoSourceInput, type VideoSourceObject, type VideoWatchedMessage, type WatchedRange, WatchedVideoPlayer, WsProgressSync, buildVideoElement, createWatchedVideo };
