/** A single watched interval: [start, end) in seconds. */
export interface WatchedRange {
  start: number;
  end: number;
}

export type VideoSourceInput =
  | string
  | string[]
  | VideoSourceObject[]
  | (string | VideoSourceObject)[];

export interface VideoSourceObject {
  src: string;
  type?: string;
}

/** Arbitrary <video> attributes. `src`/`id` handled separately. */
export type VideoAttributes = Record<string, string | number | boolean | null | undefined>;

export interface StorageSnapshot {
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
export interface PlayerSnapshot {
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
export interface VideoWatchedMessage {
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

export interface StorageAdapter {
  load(videoId: string): StorageSnapshot | null;
  save(videoId: string, snap: StorageSnapshot): void;
  clear(videoId: string): void;
}

export type PlayerEventName =
  | 'ready'
  | 'progress'
  | 'complete'
  | 'seek-blocked'
  | 'resume'
  | 'sync'
  | 'sync-error'
  | 'destroy';

export interface ProgressEvent {
  snapshot: PlayerSnapshot;
}

export interface SeekBlockedEvent {
  attempted: number;
  clampedTo: number;
}

export interface ResumeEvent {
  position: number;
}

export interface SyncEvent {
  message: VideoWatchedMessage;
}

export type PlayerEventPayload =
  | ProgressEvent
  | SeekBlockedEvent
  | ResumeEvent
  | SyncEvent
  | { snapshot: PlayerSnapshot }
  | { error: unknown }
  | Record<string, never>;

export type EventHandler<T = unknown> = (payload: T) => void;

export interface CreateWatchedVideoOptions {
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
