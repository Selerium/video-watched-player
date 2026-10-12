var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/range-tracker.ts
var RangeTracker = class {
  constructor(initial = []) {
    __publicField(this, "ranges", []);
    if (initial.length > 0) this.addRanges(initial);
  }
  /** Add a single [start, end) interval and merge overlaps. No-op for invalid input. */
  addRange(start, end) {
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    if (end <= start) return;
    if (start < 0) start = 0;
    this.ranges.push({ start, end });
    this.normalize();
  }
  addRanges(list) {
    for (const r of list) this.addRange(r.start, r.end);
  }
  /** Sorted, non-overlapping copy. */
  getRanges() {
    return this.ranges.map((r) => ({ ...r }));
  }
  /** Sum of merged interval lengths. */
  totalSeconds() {
    let total = 0;
    for (const r of this.ranges) total += r.end - r.start;
    return total;
  }
  /** Max end of all intervals, 0 when empty. */
  furthest() {
    let max = 0;
    for (const r of this.ranges) if (r.end > max) max = r.end;
    return max;
  }
  /** Fraction 0..1 of duration covered. 0 when duration invalid. */
  coverage(duration) {
    if (!Number.isFinite(duration) || duration <= 0) return 0;
    return Math.min(1, this.totalSeconds() / duration);
  }
  /** True if time t falls inside any watched interval. */
  covers(t) {
    for (const r of this.ranges) {
      if (t >= r.start && t < r.end) return true;
    }
    return false;
  }
  clear() {
    this.ranges = [];
  }
  normalize() {
    const sorted = [...this.ranges].sort((a, b) => a.start - b.start);
    const merged = [];
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
};

// src/storage.ts
function storageKey(prefix, videoId) {
  return `${prefix}${videoId}`;
}
var MemoryStorageAdapter = class {
  constructor() {
    __publicField(this, "map", /* @__PURE__ */ new Map());
  }
  load(videoId) {
    return this.map.get(videoId) ?? null;
  }
  save(videoId, snap) {
    this.map.set(videoId, { ...snap, ranges: snap.ranges.map((r) => ({ ...r })) });
  }
  clear(videoId) {
    this.map.delete(videoId);
  }
};
var LocalStorageAdapter = class {
  constructor(prefix = "vwp:v1:") {
    __publicField(this, "prefix");
    this.prefix = prefix;
  }
  get ls() {
    try {
      if (typeof localStorage === "undefined") return null;
      return localStorage;
    } catch {
      return null;
    }
  }
  load(videoId) {
    const store = this.ls;
    if (!store) return null;
    try {
      const raw = store.getItem(storageKey(this.prefix, videoId));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.ranges)) return null;
      return parsed;
    } catch {
      return null;
    }
  }
  save(videoId, snap) {
    const store = this.ls;
    if (!store) return;
    try {
      store.setItem(storageKey(this.prefix, videoId), JSON.stringify(snap));
    } catch {
    }
  }
  clear(videoId) {
    const store = this.ls;
    if (!store) return;
    try {
      store.removeItem(storageKey(this.prefix, videoId));
    } catch {
    }
  }
};
function resolveStorageAdapter(input, prefix) {
  if (!input || input === "localStorage") return new LocalStorageAdapter(prefix);
  if (input === "memory") return new MemoryStorageAdapter();
  return input;
}

// src/video-factory.ts
function normalizeSources(src) {
  const list = Array.isArray(src) ? src : [src];
  const out = [];
  for (const item of list) {
    if (typeof item === "string") {
      if (item) out.push({ src: item });
    } else if (item && typeof item.src === "string" && item.src) {
      out.push(item.type ? { src: item.src, type: item.type } : { src: item.src });
    }
  }
  return out;
}
function buildVideoElement(src, attributes = {}) {
  const video = document.createElement("video");
  const sources = normalizeSources(src);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === void 0 || value === false) continue;
    if (value === true) {
      video.setAttribute(key, "");
      Reflect.set(video, key, true);
    } else {
      video.setAttribute(key, String(value));
      try {
        if (key in video) Reflect.set(video, key, value);
      } catch {
      }
    }
  }
  if (sources.length === 1 && !sources[0]?.type) {
    video.src = sources[0]?.src ?? "";
  } else {
    for (const s of sources) {
      const el = document.createElement("source");
      el.src = s.src;
      if (s.type) el.type = s.type;
      video.appendChild(el);
    }
  }
  if (!video.getAttribute("preload")) video.preload = "metadata";
  return video;
}
function resolveContainer(target) {
  if (typeof target !== "string") return target;
  try {
    return document.querySelector(target);
  } catch {
    return null;
  }
}

// src/ws-sync.ts
var WsProgressSync = class {
  constructor(opts) {
    __publicField(this, "ws", null);
    __publicField(this, "lastSendAt", 0);
    __publicField(this, "pending", null);
    __publicField(this, "flushTimer", null);
    __publicField(this, "reconnectAttempts", 0);
    __publicField(this, "destroyed", false);
    __publicField(this, "opts");
    this.opts = opts;
  }
  get enabled() {
    return Boolean(this.opts.serverUrl);
  }
  /** Queue a message; throttled send unless force=true. */
  send(msg, force = false) {
    if (!this.enabled || this.destroyed) return;
    const full = {
      event: this.opts.eventName,
      ...msg,
      ...this.opts.authToken ? { token: this.opts.authToken } : {}
    };
    if (force) {
      this.transmit(full);
      return;
    }
    this.pending = full;
    const now = Date.now();
    const elapsed = now - this.lastSendAt;
    if (elapsed >= this.opts.throttleMs) {
      this.transmit(full);
      this.pending = null;
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        if (this.pending && !this.destroyed) {
          this.transmit(this.pending);
          this.pending = null;
        }
      }, this.opts.throttleMs - elapsed);
    }
  }
  /** Immediately send anything pending (pause / complete / unload). */
  flush() {
    if (this.pending && !this.destroyed) {
      this.transmit(this.pending);
      this.pending = null;
    }
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
  destroy() {
    this.destroyed = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.pending = null;
    try {
      this.ws?.close();
    } catch {
    }
    this.ws = null;
  }
  ensureSocket() {
    if (!this.opts.serverUrl || this.destroyed) return null;
    if (typeof WebSocket === "undefined") return null;
    const current = this.ws;
    if (current && (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING)) {
      return current;
    }
    try {
      const ws = new WebSocket(this.opts.serverUrl);
      this.ws = ws;
      ws.addEventListener("open", () => {
        this.reconnectAttempts = 0;
      });
      ws.addEventListener("close", () => {
        if (this.destroyed) return;
        if (this.reconnectAttempts < 5) {
          this.reconnectAttempts += 1;
          const delay = Math.min(1e3 * 2 ** this.reconnectAttempts, 15e3);
          setTimeout(() => {
            if (!this.destroyed) this.ensureSocket();
          }, delay);
        }
      });
      ws.addEventListener("error", () => {
      });
      return ws;
    } catch (err) {
      this.opts.onError?.(err);
      return null;
    }
  }
  transmit(msg) {
    const ws = this.ensureSocket();
    if (!ws) return;
    const payload = JSON.stringify(msg);
    const doSend = () => {
      try {
        ws.send(payload);
        this.lastSendAt = Date.now();
        this.opts.onSync?.(msg);
      } catch (err) {
        this.opts.onError?.(err);
      }
    };
    if (ws.readyState === WebSocket.OPEN) {
      doSend();
    } else if (ws.readyState === WebSocket.CONNECTING) {
      ws.addEventListener("open", doSend, { once: true });
    } else {
    }
  }
};

// src/player.ts
var WatchedVideoPlayer = class {
  constructor(options) {
    __publicField(this, "video");
    __publicField(this, "videoId");
    __publicField(this, "tracker", new RangeTracker());
    __publicField(this, "storage");
    __publicField(this, "storagePrefix");
    __publicField(this, "sync");
    __publicField(this, "wsEventName");
    __publicField(this, "autoResume");
    __publicField(this, "completionThreshold");
    __publicField(this, "preventSkipping");
    __publicField(this, "skipToleranceSec");
    __publicField(this, "resumeMinSec");
    __publicField(this, "resumeEndGuardSec");
    __publicField(this, "persistThrottleMs");
    __publicField(this, "maxSampleGapSec");
    __publicField(this, "lastSampleTime", null);
    __publicField(this, "lastPosition", 0);
    __publicField(this, "duration", 0);
    __publicField(this, "completed", false);
    __publicField(this, "completedEmitted", false);
    __publicField(this, "lastPersistAt", 0);
    __publicField(this, "destroyed", false);
    __publicField(this, "listeners", /* @__PURE__ */ new Map());
    __publicField(this, "suppressSeekingGuard", false);
    __publicField(this, "onTimeUpdate", () => this.handleSample());
    __publicField(this, "onSeeking", () => this.handleSeeking());
    __publicField(this, "onSeeked", () => this.handleSeeked());
    __publicField(this, "onPlay", () => this.handlePlay());
    __publicField(this, "onPause", () => this.handlePause(true));
    __publicField(this, "onEnded", () => this.handleEnded());
    __publicField(this, "onLoadedMetadata", () => this.handleLoadedMetadata());
    __publicField(this, "onPageHide", () => this.handleUnload());
    if (!options.videoId) throw new Error("videoId is required (used for persistence + sync).");
    const sources = normalizeSources(options.src);
    if (sources.length === 0) throw new Error("src is required (at least one video URL).");
    this.videoId = options.videoId;
    this.autoResume = options.autoResume ?? true;
    this.completionThreshold = clamp01(options.completionThreshold ?? 0.95);
    this.preventSkipping = options.preventSkipping ?? false;
    this.skipToleranceSec = options.skipToleranceSec ?? 2;
    this.resumeMinSec = options.resumeMinSec ?? 5;
    this.resumeEndGuardSec = options.resumeEndGuardSec ?? 10;
    this.persistThrottleMs = options.persistThrottleMs ?? 1e3;
    this.maxSampleGapSec = options.maxSampleGapSec ?? 1.5;
    this.storagePrefix = options.storageKeyPrefix ?? "vwp:v1:";
    this.storage = resolveStorageAdapter(options.storage, this.storagePrefix);
    this.wsEventName = options.wsEventName ?? "video-watched";
    this.video = buildVideoElement(options.src, options.attributes ?? {});
    this.attachListeners();
    this.sync = new WsProgressSync({
      serverUrl: options.serverUrl,
      eventName: this.wsEventName,
      throttleMs: options.wsThrottleMs ?? 2e3,
      authToken: options.authToken,
      onSync: (message) => this.emit("sync", { message }),
      onError: (error) => this.emit("sync-error", { error })
    });
    if (options.onReady) this.on("ready", (p) => options.onReady?.(p.snapshot));
    if (options.onProgress)
      this.on("progress", (p) => options.onProgress?.(p.snapshot));
    if (options.onComplete)
      this.on("complete", (p) => options.onComplete?.(p.snapshot));
    if (options.onSeekBlocked) this.on("seek-blocked", (p) => options.onSeekBlocked?.(p));
    if (options.container) this.mount(options.container);
    this.restore();
  }
  // ---------- element / lifecycle ----------
  getVideoElement() {
    return this.video;
  }
  getVideoId() {
    return this.videoId;
  }
  mount(target) {
    this.assertAlive();
    const el = typeof target === "string" ? resolveContainer(target) : target;
    if (!el) throw new Error(`mount target not found: ${String(target)}`);
    if (this.video.parentElement !== el) el.appendChild(this.video);
  }
  unmount() {
    this.video.remove();
  }
  setSource(src, newVideoId) {
    this.assertAlive();
    const sources = normalizeSources(src);
    if (sources.length === 0) throw new Error("setSource requires at least one URL.");
    this.flushTracking("source-change");
    if (newVideoId) this.videoId = newVideoId;
    this.video.querySelectorAll("source").forEach((s) => s.remove());
    this.video.removeAttribute("src");
    if (sources.length === 1 && !sources[0]?.type) {
      this.video.src = sources[0]?.src ?? "";
    } else {
      for (const s of sources) {
        const el = document.createElement("source");
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
  destroy(removeElement = true) {
    if (this.destroyed) return;
    this.flushTracking("destroy");
    this.detachListeners();
    this.sync.destroy();
    if (removeElement) this.video.remove();
    this.emit("destroy", {});
    this.listeners.clear();
    this.destroyed = true;
  }
  // ---------- transport ----------
  async play() {
    this.assertAlive();
    await this.video.play();
  }
  pause() {
    this.video.pause();
  }
  toggle() {
    if (this.video.paused) void this.play();
    else this.pause();
  }
  seekTo(seconds) {
    this.assertAlive();
    if (!Number.isFinite(seconds) || seconds < 0) return;
    this.suppressSeekingGuard = true;
    try {
      this.video.currentTime = seconds;
    } finally {
      setTimeout(() => {
        this.suppressSeekingGuard = false;
      }, 0);
    }
    this.lastSampleTime = seconds;
  }
  setPreventSkipping(enabled) {
    this.preventSkipping = enabled;
  }
  // ---------- queries ----------
  getWatchedRanges() {
    return this.tracker.getRanges();
  }
  getWatchedSeconds() {
    return this.tracker.totalSeconds();
  }
  getDuration() {
    return this.duration || this.video.duration || 0;
  }
  getCoveragePercent() {
    return this.tracker.coverage(this.getDuration()) * 100;
  }
  /** Where the playhead was at last save (best resume target). */
  getLastWatchedPosition() {
    return this.lastPosition;
  }
  /** Alias of getLastWatchedPosition. */
  getLastPosition() {
    return this.lastPosition;
  }
  /** Max end of watched intervals. */
  getFurthestWatched() {
    return this.tracker.furthest();
  }
  hasWatchedUpTo(seconds) {
    return this.tracker.covers(seconds);
  }
  isCompleted() {
    return this.completed;
  }
  isVideoCompleted() {
    return this.completed;
  }
  getSnapshot() {
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
      updatedAt: Date.now()
    };
  }
  // ---------- helpers ----------
  /**
   * Seek to the last watched position. No-op near 0.
   * @returns the position seeked to.
   */
  skipAheadToLastWatched(opts = {}) {
    this.assertAlive();
    const target = this.lastPosition;
    if (target > 1) this.seekTo(target);
    if (opts.play) void this.play().catch(() => void 0);
    return target > 1 ? target : this.video.currentTime;
  }
  /** Alias for skipAheadToLastWatched. */
  resume(opts = {}) {
    return this.skipAheadToLastWatched(opts);
  }
  resetProgress(clearPersisted = true) {
    this.tracker.clear();
    this.lastPosition = 0;
    this.lastSampleTime = this.video.currentTime;
    this.completed = false;
    this.completedEmitted = false;
    if (clearPersisted) this.storage.clear(this.videoId);
    this.persist(true);
    this.emitProgress();
  }
  on(event, handler) {
    let set = this.listeners.get(event);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
    return () => this.off(event, handler);
  }
  off(event, handler) {
    this.listeners.get(event)?.delete(handler);
  }
  emit(event, payload) {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch {
      }
    }
  }
  // ---------- internals ----------
  attachListeners() {
    this.video.addEventListener("timeupdate", this.onTimeUpdate);
    this.video.addEventListener("seeking", this.onSeeking);
    this.video.addEventListener("seeked", this.onSeeked);
    this.video.addEventListener("play", this.onPlay);
    this.video.addEventListener("pause", this.onPause);
    this.video.addEventListener("ended", this.onEnded);
    this.video.addEventListener("loadedmetadata", this.onLoadedMetadata);
    window.addEventListener("pagehide", this.onPageHide);
    document.addEventListener("visibilitychange", this.onPageHide);
  }
  detachListeners() {
    this.video.removeEventListener("timeupdate", this.onTimeUpdate);
    this.video.removeEventListener("seeking", this.onSeeking);
    this.video.removeEventListener("seeked", this.onSeeked);
    this.video.removeEventListener("play", this.onPlay);
    this.video.removeEventListener("pause", this.onPause);
    this.video.removeEventListener("ended", this.onEnded);
    this.video.removeEventListener("loadedmetadata", this.onLoadedMetadata);
    window.removeEventListener("pagehide", this.onPageHide);
    document.removeEventListener("visibilitychange", this.onPageHide);
  }
  handleSample() {
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
    const rate = this.video.playbackRate || 1;
    const maxGap = this.maxSampleGapSec * Math.max(rate, 1);
    if (delta > 0 && delta <= maxGap) {
      this.tracker.addRange(prev, now);
      this.afterProgress(false);
    }
  }
  handleSeeking() {
    if (this.destroyed || this.suppressSeekingGuard || !this.preventSkipping) return;
    const target = this.video.currentTime;
    const furthest = this.tracker.furthest();
    if (target > furthest + this.skipToleranceSec && furthest > 0) {
      const attempted = target;
      this.suppressSeekingGuard = true;
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
      this.emit("seek-blocked", { attempted, clampedTo: furthest });
    }
  }
  handleSeeked() {
    if (this.destroyed) return;
    this.lastSampleTime = this.video.currentTime;
    this.lastPosition = this.video.currentTime;
    this.persist(false);
  }
  handlePlay() {
    this.lastSampleTime = this.video.currentTime;
  }
  handlePause(flushSync) {
    if (this.destroyed) return;
    this.handleSample();
    this.lastPosition = this.video.currentTime;
    this.persist(true);
    if (flushSync) this.queueSync(true);
  }
  handleEnded() {
    if (this.destroyed) return;
    this.handleSample();
    this.lastPosition = this.video.currentTime;
    this.afterProgress(true);
    this.persist(true);
    this.queueSync(true);
  }
  handleLoadedMetadata() {
    if (this.destroyed) return;
    this.duration = Number.isFinite(this.video.duration) ? this.video.duration : 0;
    this.restore();
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
          this.emit("resume", { position: pos });
        } catch {
          this.suppressSeekingGuard = false;
        }
      }
    }
    this.emit("ready", { snapshot: this.getSnapshot() });
  }
  handleUnload() {
    if (this.destroyed) return;
    if (document.visibilityState === "hidden" || true) {
      this.lastPosition = this.video.currentTime;
      this.persist(true);
      this.queueSync(true);
      this.sync.flush();
    }
  }
  afterProgress(forceSync) {
    this.checkCompletion();
    this.persist(false);
    this.emitProgress();
    this.queueSync(forceSync);
  }
  checkCompletion() {
    if (this.completedEmitted) return;
    const duration = this.getDuration();
    if (!Number.isFinite(duration) || duration <= 0) return;
    const coverage = this.tracker.coverage(duration);
    if (coverage >= this.completionThreshold) {
      this.completed = true;
      this.completedEmitted = true;
      this.persist(true);
      const snap = this.getSnapshot();
      this.emit("complete", { snapshot: snap });
      this.queueSync(true);
    }
  }
  emitProgress() {
    this.emit("progress", { snapshot: this.getSnapshot() });
  }
  restore() {
    try {
      const saved = this.storage.load(this.videoId);
      if (!saved) return;
      this.tracker = new RangeTracker(saved.ranges);
      this.lastPosition = Number.isFinite(saved.lastPosition) ? saved.lastPosition : 0;
      this.completed = saved.completed === true;
      this.completedEmitted = this.completed;
      if (Number.isFinite(saved.duration) && saved.duration > 0) this.duration = saved.duration;
    } catch {
    }
  }
  persist(force) {
    const now = Date.now();
    if (!force && now - this.lastPersistAt < this.persistThrottleMs) return;
    this.lastPersistAt = now;
    const snap = this.getSnapshot();
    const stored = {
      version: 1,
      videoId: snap.videoId,
      ranges: snap.ranges,
      lastPosition: snap.lastPosition,
      furthest: snap.furthest,
      watchedSeconds: snap.watchedSeconds,
      duration: snap.duration,
      completed: snap.completed,
      updatedAt: snap.updatedAt
    };
    try {
      this.storage.save(this.videoId, stored);
    } catch {
    }
  }
  queueSync(force) {
    if (!this.sync.enabled) return;
    const snap = this.getSnapshot();
    this.sync.send(
      {
        videoId: snap.videoId,
        watched: round1(snap.watchedSeconds),
        furthest: round1(snap.furthest),
        lastPosition: round1(snap.lastPosition),
        completed: snap.completed
      },
      force
    );
  }
  flushTracking(_reason) {
    try {
      this.handleSample();
    } catch {
    }
    this.lastPosition = safeCurrentTime(this.video);
    this.persist(true);
    this.queueSync(true);
    this.sync.flush();
  }
  assertAlive() {
    if (this.destroyed) throw new Error("WatchedVideoPlayer has been destroyed.");
  }
};
function createWatchedVideo(options) {
  return new WatchedVideoPlayer(options);
}
function clamp01(n) {
  if (!Number.isFinite(n)) return 0.95;
  return Math.min(1, Math.max(0, n));
}
function round1(n) {
  return Math.round(n * 10) / 10;
}
function safeCurrentTime(video) {
  try {
    return Number.isFinite(video.currentTime) ? video.currentTime : 0;
  } catch {
    return 0;
  }
}
export {
  LocalStorageAdapter,
  MemoryStorageAdapter,
  RangeTracker,
  WatchedVideoPlayer,
  WsProgressSync,
  buildVideoElement,
  createWatchedVideo
};
//# sourceMappingURL=index.js.map