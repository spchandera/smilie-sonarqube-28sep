import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DragZoomWrapper } from '@theme/drag-zoom-wrapper';
import { DialogCloseEvent } from '@theme/dialog';
import { mediaQueryLarge } from '@theme/utilities';

/** @type {Map<number, FrameRequestCallback>} */
let frames;
let frameId;
/** @type {Array<{ callback: Function, observed: Element[] }>} */
let resizeObservers;
let now;

class RecordingResizeObserver {
  constructor(callback) {
    this.callback = callback;
    this.observed = [];
    resizeObservers.push(this);
  }
  observe(el) {
    this.observed.push(el);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
}

function flushFrames() {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((cb) => cb(0));
}

function mount({ width = 200, height = 200, natural } = {}) {
  document.body.innerHTML = `<drag-zoom-wrapper><img ref="image" alt=""></drag-zoom-wrapper>`;
  const el = /** @type {DragZoomWrapper} */ (document.querySelector('drag-zoom-wrapper'));
  const box = { clientWidth: width, clientHeight: height };
  for (const [key, value] of Object.entries(box)) Object.defineProperty(el, key, { configurable: true, value });
  el.getBoundingClientRect = () => /** @type {DOMRect} */ ({ width, height, top: 0, left: 0, right: width, bottom: height });
  if (natural) {
    Object.defineProperty(el.refs.image, 'naturalWidth', { configurable: true, value: natural[0] });
    Object.defineProperty(el.refs.image, 'naturalHeight', { configurable: true, value: natural[1] });
  }
  return el;
}

/**
 * @param {Element} el
 * @param {string} type
 * @param {Array<[number, number] | undefined>} points
 */
function touch(el, type, points) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', {
    value: points.map((p) => (p ? { clientX: p[0], clientY: p[1] } : undefined)),
  });
  el.dispatchEvent(event);
  return event;
}

const styleOf = (el) => ({
  scale: el.style.getPropertyValue('--drag-zoom-scale'),
  x: Number.parseFloat(el.style.getPropertyValue('--drag-zoom-translate-x')),
  y: Number.parseFloat(el.style.getPropertyValue('--drag-zoom-translate-y')),
});

/** Double taps at a point, advancing the fake clock between taps. */
function doubleTap(el, point) {
  now += 1000;
  touch(el, 'touchstart', [point]);
  touch(el, 'touchend', []);
  now += 100;
  touch(el, 'touchstart', [point]);
  flushFrames();
}

beforeEach(() => {
  frames = new Map();
  frameId = 0;
  resizeObservers = [];
  now = 10_000;
  vi.stubGlobal('requestAnimationFrame', (cb) => {
    frameId += 1;
    frames.set(frameId, cb);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id) => frames.delete(id)));
  vi.stubGlobal('ResizeObserver', RecordingResizeObserver);
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  mediaQueryLarge.matches = false;
});

afterEach(() => {
  document.body.innerHTML = '';
  mediaQueryLarge.matches = false;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('drag-zoom-wrapper', () => {
  it('starts at the default zoom, centred, and observes its size', () => {
    const el = mount();
    expect(el).toBeInstanceOf(DragZoomWrapper);
    expect(styleOf(el)).toEqual({ scale: '1.5', x: 0, y: 0 });
    expect(resizeObservers.at(-1).observed).toContain(el);
  });

  it('prevents default scrolling on touch gestures', () => {
    const el = mount();
    expect(touch(el, 'touchstart', [[10, 10]]).defaultPrevented).toBe(true);
    expect(touch(el, 'touchmove', [[12, 12]]).defaultPrevented).toBe(true);
  });

  it('toggles between 1x and 1.5x on double tap, zooming towards the tap point', () => {
    const el = mount();

    doubleTap(el, [150, 100]);
    expect(styleOf(el)).toEqual({ scale: '1', x: 0, y: 0 });

    doubleTap(el, [150, 100]);
    const zoomed = styleOf(el);
    expect(zoomed.scale).toBe('1.5');
    // (150 - 100) * (1.5 / 1 - 1) / 1.5
    expect(zoomed.x).toBeCloseTo(-16.667, 2);
    expect(zoomed.y).toBe(0);
  });

  it('treats distant consecutive taps as separate drags rather than a double tap', () => {
    const el = mount();
    touch(el, 'touchstart', [[10, 10]]);
    now += 100;
    touch(el, 'touchstart', [[150, 150]]);
    flushFrames();
    expect(styleOf(el).scale).toBe('1.5');
  });

  it('pinch zooms around the gesture midpoint, clamped to 5x', () => {
    const el = mount();
    touch(el, 'touchstart', [
      [50, 100],
      [150, 100],
    ]);
    touch(el, 'touchmove', [
      [0, 100],
      [200, 100],
    ]);
    flushFrames();
    expect(styleOf(el).scale).toBe('3');

    touch(el, 'touchmove', [
      [-1000, 100],
      [1200, 100],
    ]);
    flushFrames();
    expect(styleOf(el).scale).toBe('5');

    touch(el, 'touchmove', [
      [99, 100],
      [101, 100],
    ]);
    flushFrames();
    expect(styleOf(el)).toEqual({ scale: '1', x: 0, y: 0 });
  });

  it('keeps an off-centre pinch midpoint stationary and resets manual zoom on double tap', () => {
    const el = mount();
    touch(el, 'touchstart', [
      [140, 100],
      [160, 100],
    ]);
    touch(el, 'touchmove', [
      [130, 100],
      [170, 100],
    ]);
    flushFrames();
    const pinched = styleOf(el);
    expect(pinched.scale).toBe('3');
    // midpoint 150 is 50px right of centre: -(50 * (3 / 1.5 - 1)) / 3
    expect(pinched.x).toBeCloseTo(-16.667, 2);

    touch(el, 'touchend', []);
    doubleTap(el, [100, 100]);
    expect(styleOf(el)).toEqual({ scale: '1', x: 0, y: 0 });
  });

  it('ignores incomplete multi-touch lists', () => {
    const el = mount();
    touch(el, 'touchstart', [undefined, undefined]);
    touch(el, 'touchmove', [undefined, undefined]);
    touch(el, 'touchstart', [undefined]);
    touch(el, 'touchmove', [undefined]);
    expect(frames.size).toBe(0);
  });

  it('drags the image beyond a threshold and constrains it to the overflow', () => {
    const el = mount();
    touch(el, 'touchstart', [[100, 100]]);

    touch(el, 'touchmove', [[105, 100]]);
    expect(frames.size).toBe(0);

    touch(el, 'touchmove', [[130, 100]]);
    flushFrames();
    expect(styleOf(el).x).toBeCloseTo(20, 5);

    touch(el, 'touchmove', [[400, 400]]);
    flushFrames();
    // 200px square at 1.5x overflows by 100px, so at most 100 / 2 / 1.5
    expect(styleOf(el).x).toBeCloseTo(33.333, 2);
    expect(styleOf(el).y).toBeCloseTo(33.333, 2);

    touch(el, 'touchend', [[400, 400]]);
    expect(frames.size).toBe(0);
    touch(el, 'touchend', []);
    expect(frames.size).toBe(1);
    flushFrames();

    // No longer dragging once released
    touch(el, 'touchmove', [[0, 0]]);
    expect(frames.size).toBe(0);
  });

  it('constrains letterboxed images by their natural aspect ratio', () => {
    const wide = mount({ natural: [400, 200] });
    touch(wide, 'touchstart', [[100, 100]]);
    touch(wide, 'touchmove', [[400, 400]]);
    flushFrames();
    // Wide image is 200x100 at 1x, 300x150 at 1.5x: only horizontal overflow
    expect(styleOf(wide).x).toBeCloseTo(33.333, 2);
    expect(styleOf(wide).y).toBe(0);

    const tall = mount({ natural: [200, 400] });
    touch(tall, 'touchstart', [[100, 100]]);
    touch(tall, 'touchmove', [[400, 400]]);
    flushFrames();
    expect(styleOf(tall).x).toBe(0);
    expect(styleOf(tall).y).toBeCloseTo(33.333, 2);
  });

  it('resets zoom and position when a dialog closes', () => {
    const el = mount();
    touch(el, 'touchstart', [[100, 100]]);
    touch(el, 'touchmove', [[150, 150]]);
    flushFrames();
    expect(styleOf(el).x).not.toBe(0);

    window.dispatchEvent(new DialogCloseEvent());
    expect(styleOf(el)).toEqual({ scale: '1.5', x: 0, y: 0 });
  });

  it('only enables touch gestures once resized into the mobile breakpoint', () => {
    mediaQueryLarge.matches = true;
    const el = mount();
    const observer = resizeObservers.find((o) => o.observed.includes(el));
    expect(el.style.getPropertyValue('--drag-zoom-scale')).toBe('');

    observer.callback([]);
    touch(el, 'touchstart', [[100, 100]]);
    touch(el, 'touchmove', [[150, 150]]);
    expect(frames.size).toBe(0);

    mediaQueryLarge.matches = false;
    observer.callback([]);
    expect(el.style.getPropertyValue('--drag-zoom-scale')).toBe('1.5');
    observer.callback([]);
    expect(frames.size).toBe(1);
    flushFrames();

    touch(el, 'touchstart', [[100, 100]]);
    touch(el, 'touchmove', [[150, 150]]);
    expect(frames.size).toBe(1);
  });

  it('cleans up listeners, observers and pending frames when disconnected', () => {
    const el = mount();
    const observer = resizeObservers.find((o) => o.observed.includes(el));
    touch(el, 'touchstart', [[100, 100]]);
    touch(el, 'touchmove', [[150, 150]]);
    expect(frames.size).toBe(1);

    el.remove();
    expect(cancelAnimationFrame).toHaveBeenCalled();
    expect(frames.size).toBe(0);
    expect(observer.disconnected).toBe(true);

    touch(el, 'touchstart', [[0, 0]]);
    touch(el, 'touchmove', [[80, 80]]);
    expect(frames.size).toBe(0);

    el.style.setProperty('--drag-zoom-scale', '9');
    window.dispatchEvent(new DialogCloseEvent());
    expect(el.style.getPropertyValue('--drag-zoom-scale')).toBe('9');
  });

  it('destroy() stops gestures and cancels a pending frame', () => {
    const el = mount();
    touch(el, 'touchstart', [[100, 100]]);
    touch(el, 'touchmove', [[150, 150]]);
    el.destroy();
    expect(frames.size).toBe(0);
    touch(el, 'touchmove', [[180, 180]]);
    expect(frames.size).toBe(0);
    el.destroy();
  });

  it('requires an image ref', () => {
    const errors = [];
    const handler = (e) => {
      errors.push(e.error);
      e.preventDefault();
    };
    window.addEventListener('error', handler);
    document.body.innerHTML = '<drag-zoom-wrapper></drag-zoom-wrapper>';
    window.removeEventListener('error', handler);
    expect(errors.some((e) => /Required ref "image"/.test(e?.message))).toBe(true);
  });
});
