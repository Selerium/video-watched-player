// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createWatchedVideo } from '../src/index.js';

function makeVideoMock() {
  const player = createWatchedVideo({
    src: 'https://example.com/v.mp4',
    videoId: 'test-' + Math.random().toString(36).slice(2),
    attributes: { controls: true },
    storage: 'memory',
    completionThreshold: 0.5,
    persistThrottleMs: 0,
  });
  const video = player.getVideoElement();
  document.body.appendChild(video);

  // jsdom media properties are stubs — make them writable/controllable.
  let currentTime = 0;
  let duration = 10;
  let paused = false;
  Object.defineProperty(video, 'currentTime', {
    get: () => currentTime,
    set: (v: number) => {
      currentTime = v;
    },
    configurable: true,
  });
  Object.defineProperty(video, 'duration', {
    get: () => duration,
    configurable: true,
  });
  Object.defineProperty(video, 'paused', { get: () => paused, configurable: true });
  Object.defineProperty(video, 'seeking', { get: () => false, configurable: true });
  Object.defineProperty(video, 'playbackRate', { get: () => 1, configurable: true });
  const setPaused = (v: boolean) => {
    paused = v;
  };
  const setDuration = (v: number) => {
    duration = v;
  };
  return { player, video, setPaused, setDuration };
}

describe('WatchedVideoPlayer', () => {
  it('creates a video element with attributes', () => {
    const { player, video } = makeVideoMock();
    expect(video.tagName).toBe('VIDEO');
    expect(video.hasAttribute('controls')).toBe(true);
    expect(video.getAttribute('preload')).toBe('metadata');
    player.destroy();
  });

  it('tracks watched intervals across timeupdates', () => {
    const { player, video } = makeVideoMock();
    video.dispatchEvent(new Event('loadedmetadata'));
    (video as unknown as { currentTime: number }).currentTime = 0;
    video.dispatchEvent(new Event('play'));
    for (let t = 0.25; t <= 3; t += 0.25) {
      (video as unknown as { currentTime: number }).currentTime = t;
      video.dispatchEvent(new Event('timeupdate'));
    }
    expect(player.getWatchedSeconds()).toBeGreaterThan(2);
    expect(player.getFurthestWatched()).toBeCloseTo(3, 1);
    expect(player.getCoveragePercent()).toBeGreaterThan(20);
    player.destroy();
  });

  it('skipAheadToLastWatched seeks to last position', () => {
    const { player, video } = makeVideoMock();
    video.dispatchEvent(new Event('loadedmetadata'));
    (video as unknown as { currentTime: number }).currentTime = 6;
    video.dispatchEvent(new Event('timeupdate'));
    video.dispatchEvent(new Event('pause'));
    (video as unknown as { currentTime: number }).currentTime = 0;
    player.skipAheadToLastWatched();
    expect(video.currentTime).toBeCloseTo(6, 5);
    player.destroy();
  });

  it('emits complete when threshold crossed', () => {
    const { player, video } = makeVideoMock(); // threshold 0.5, duration 10
    const onComplete = vi.fn();
    player.on('complete', onComplete);
    video.dispatchEvent(new Event('loadedmetadata'));
    video.dispatchEvent(new Event('play'));
    for (let t = 0.25; t <= 6; t += 0.25) {
      (video as unknown as { currentTime: number }).currentTime = t;
      video.dispatchEvent(new Event('timeupdate'));
    }
    expect(player.isVideoCompleted()).toBe(true);
    expect(player.isCompleted()).toBe(true);
    expect(onComplete).toHaveBeenCalledOnce();
    player.destroy();
  });

  it('blocks skipping ahead when preventSkipping is on', () => {
    const { player, video } = makeVideoMock();
    player.setPreventSkipping(true);
    video.dispatchEvent(new Event('loadedmetadata'));
    video.dispatchEvent(new Event('play'));
    for (let t = 0.25; t <= 2; t += 0.25) {
      (video as unknown as { currentTime: number }).currentTime = t;
      video.dispatchEvent(new Event('timeupdate'));
    }
    const blocked: number[] = [];
    player.on('seek-blocked', (e) => blocked.push(e.attempted));
    (video as unknown as { currentTime: number }).currentTime = 9;
    video.dispatchEvent(new Event('seeking'));
    expect(blocked.length).toBe(1);
    player.destroy();
  });
});
