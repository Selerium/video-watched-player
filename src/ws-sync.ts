import type { VideoWatchedMessage } from './types.js';

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
export class WsProgressSync {
  private ws: WebSocket | null = null;
  private lastSendAt = 0;
  private pending: VideoWatchedMessage | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private destroyed = false;
  private opts: WsSyncOptions;

  constructor(opts: WsSyncOptions) {
    this.opts = opts;
  }

  get enabled(): boolean {
    return Boolean(this.opts.serverUrl);
  }

  /** Queue a message; throttled send unless force=true. */
  send(msg: Omit<VideoWatchedMessage, 'event' | 'token'>, force = false): void {
    if (!this.enabled || this.destroyed) return;
    const full: VideoWatchedMessage = {
      event: this.opts.eventName,
      ...msg,
      ...(this.opts.authToken ? { token: this.opts.authToken } : {}),
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
  flush(): void {
    if (this.pending && !this.destroyed) {
      this.transmit(this.pending);
      this.pending = null;
    }
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.pending = null;
    try {
      this.ws?.close();
    } catch {
      // ignore
    }
    this.ws = null;
  }

  private ensureSocket(): WebSocket | null {
    if (!this.opts.serverUrl || this.destroyed) return null;
    if (typeof WebSocket === 'undefined') return null;
    const current = this.ws;
    if (current && (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING)) {
      return current;
    }
    try {
      const ws = new WebSocket(this.opts.serverUrl);
      this.ws = ws;
      ws.addEventListener('open', () => {
        this.reconnectAttempts = 0;
      });
      ws.addEventListener('close', () => {
        if (this.destroyed) return;
        // Exponential backoff reconnect, max 5 attempts.
        if (this.reconnectAttempts < 5) {
          this.reconnectAttempts += 1;
          const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 15000);
          setTimeout(() => {
            if (!this.destroyed) this.ensureSocket();
          }, delay);
        }
      });
      ws.addEventListener('error', () => {
        // Errors are surfaced per-send; socket errors alone aren't fatal.
      });
      return ws;
    } catch (err) {
      this.opts.onError?.(err);
      return null;
    }
  }

  private transmit(msg: VideoWatchedMessage): void {
    const ws = this.ensureSocket();
    if (!ws) return;
    const payload = JSON.stringify(msg);
    const doSend = (): void => {
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
      ws.addEventListener('open', doSend, { once: true });
    } else {
      // CLOSED/CLOSING: drop this beat, next throttled send will reconnect.
    }
  }
}
