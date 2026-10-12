# video-watched-player

Drop-in `<video>` factory + watched-interval tracker. Framework-agnostic TypeScript, builds to ESM + CJS + types. Works like any npm dependency: install, import, call public methods.

- Creates the `HTMLVideoElement` from `src` + any attributes
- Tracks **actually watched** time ranges (scrub-safe interval merging)
- `getLastWatchedPosition()`, `isVideoCompleted()`, `skipAheadToLastWatched()`, coverage %, events
- Persists to `localStorage` per `videoId`; optional WebSocket sync (`video-watched` event, disabled when no `serverUrl`)
- Optional skip-ahead blocking (`preventSkipping`)
- Auto-resume (automatic skip-ahead) on load

## Install

```bash
npm i video-watched-player
```

Repo: https://github.com/selerium/video-watched-player

## Quick start

```ts
import { createWatchedVideo } from 'video-watched-player';

const player = createWatchedVideo({
  src: 'https://cdn.example/lesson-3.mp4',
  videoId: 'course-101-lesson-3', // stable id: storage key + server key
  container: '#player',           // optional; else call player.mount(...)
  attributes: { controls: true, preload: 'metadata', playsInline: true },
  completionThreshold: 0.95,
});

// Anywhere in your code:
console.log(player.getLastWatchedPosition()); // resume target
console.log(player.getCoveragePercent());     // 0..100
console.log(player.isVideoCompleted());       // threshold reached?

document.querySelector('#resume')?.addEventListener('click', () => {
  player.skipAheadToLastWatched({ play: true });
});

player.on('complete', ({ snapshot }) => {
  console.log('done!', snapshot.watchedSeconds, '/', snapshot.duration);
});
```

## With server sync (WebSocket)

WS is **disabled** unless `serverUrl` is provided. When enabled, the client fire-and-forgets throttled messages; the server keeps `MAX(watched)` per `videoId`.

```ts
const player = createWatchedVideo({
  src: 'https://cdn.example/lesson-3.mp4',
  videoId: 'course-101-lesson-3',
  container: '#player',
  attributes: { controls: true },
  serverUrl: 'wss://api.example/progress',
  authToken: 'optional-token', // sent as `token` in payload if given
});
```

Wire payload (event name defaults to `video-watched`, overridable via `wsEventName`):

```json
{
  "event": "video-watched",
  "videoId": "course-101-lesson-3",
  "watched": 84.5,
  "furthest": 92.1,
  "lastPosition": 88.0,
  "completed": false
}
```

- `watched` = total unique seconds watched (sum of merged intervals) — **primary field**, cheat-proof.
- `furthest` = max end of intervals — for cross-device resume.
- Server logic: `stored = max(stored, msg.watched)`. No range merging needed server-side.

## Skip enforcement + auto-resume

```ts
const player = createWatchedVideo({
  src: 'vid.mp4',
  videoId: 'v1',
  preventSkipping: true, // block seeks past furthest + tolerance
  skipToleranceSec: 2,
  autoResume: true,      // default: auto-seek to lastPosition on load
});

player.on('seek-blocked', ({ attempted, clampedTo }) => {
  toast(`Watch first — jumped back from ${attempted}s to ${clampedTo}s`);
});
player.on('resume', ({ position }) => {
  toast(`Resumed from ${format(position)}`);
});

// Toggle at runtime:
player.setPreventSkipping(false);
```

Auto-resume rules: seeks to `lastPosition` on `loadedmetadata` if `>= resumeMinSec (5)` and not within `resumeEndGuardSec (10)` of the end. No auto-play — just seek.

## Full public API

| Method | Description |
|---|---|
| `getVideoElement()` | underlying `<video>` |
| `mount(target)` / `unmount()` | attach/detach element |
| `setSource(src, newVideoId?)` | swap video, restore new id state |
| `play()` / `pause()` / `toggle()` / `seekTo(s)` | transport |
| `getWatchedRanges()` | merged `[{start,end}]` |
| `getWatchedSeconds()` | sum of intervals |
| `getCoveragePercent()` | `watched/duration*100` |
| `getLastWatchedPosition()` / `getLastPosition()` | resume target |
| `getFurthestWatched()` | max watched end |
| `hasWatchedUpTo(s)` | inside any interval? |
| `isCompleted()` / `isVideoCompleted()` | threshold reached? |
| `getSnapshot()` | serializable state for UI/server |
| `skipAheadToLastWatched({play})` / `resume()` | seek to last position |
| `resetProgress(clearPersisted?)` | wipe in-memory + storage |
| `setPreventSkipping(bool)` | runtime toggle |
| `on/off('ready'\|'progress'\|'complete'\|'seek-blocked'\|'resume'\|'sync'\|'sync-error'\|'destroy')` | events |
| `destroy()` | remove listeners, close WS |

Options reference: see `CreateWatchedVideoOptions` in `src/types.ts` (all defaults documented there).

## Storage

- Default `localStorage` key `vwp:v1:{videoId}` (`{version:1, ranges, lastPosition, furthest, watchedSeconds, duration, completed, updatedAt}`).
- `storage: 'memory'` for SSR/tests; or pass a custom `StorageAdapter`.
- Saves are throttled (`persistThrottleMs`, default 1000) + flushed on pause/complete/unload. Quota errors fail silently (tracking continues in memory).

## Multiple sources / attributes

```ts
createWatchedVideo({
  src: [
    { src: 'vid.webm', type: 'video/webm' },
    { src: 'vid.mp4', type: 'video/mp4' },
  ],
  videoId: 'v1',
  attributes: { controls: true, muted: true, poster: '/thumb.jpg', crossOrigin: 'anonymous' },
});
```

Any key in `attributes` is set via `setAttribute` (boolean `true` = bare attribute).

## Dev

```bash
npm install
npm run typecheck
npm test
npm run build   # -> dist/ (ESM + CJS + .d.ts)
```

## Publishing (maintainers)

```bash
npm run build
npm pack --dry-run   # inspect tarball contents
npm publish --access public
```
