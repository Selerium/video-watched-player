import type { VideoSourceInput, VideoSourceObject, VideoAttributes } from './types.js';

export function normalizeSources(src: VideoSourceInput): VideoSourceObject[] {
  const list = Array.isArray(src) ? src : [src];
  const out: VideoSourceObject[] = [];
  for (const item of list) {
    if (typeof item === 'string') {
      if (item) out.push({ src: item });
    } else if (item && typeof item.src === 'string' && item.src) {
      out.push(item.type ? { src: item.src, type: item.type } : { src: item.src });
    }
  }
  return out;
}

/**
 * Create a <video> element from a source + attribute bag.
 * Handles <source> children so multiple formats/codecs work.
 */
export function buildVideoElement(
  src: VideoSourceInput,
  attributes: VideoAttributes = {},
): HTMLVideoElement {
  const video = document.createElement('video');
  const sources = normalizeSources(src);

  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (value === true) {
      video.setAttribute(key, '');
      // Reflect common boolean props.
      Reflect.set(video, key, true);
    } else {
      video.setAttribute(key, String(value));
      // Reflect useful props (muted, loop, autoplay, controls, playsInline...).
      try {
        if (key in video) Reflect.set(video, key, value);
      } catch {
        // Non-reflectable attribute: attribute alone is enough.
      }
    }
  }

  // Prefer <source> children when >1 source or explicit type given.
  if (sources.length === 1 && !sources[0]?.type) {
    video.src = sources[0]?.src ?? '';
  } else {
    for (const s of sources) {
      const el = document.createElement('source');
      el.src = s.src;
      if (s.type) el.type = s.type;
      video.appendChild(el);
    }
  }

  if (!video.getAttribute('preload')) video.preload = 'metadata';
  return video;
}

export function resolveContainer(target: string | HTMLElement): HTMLElement | null {
  if (typeof target !== 'string') return target;
  try {
    return document.querySelector<HTMLElement>(target);
  } catch {
    return null;
  }
}
