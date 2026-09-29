import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** @type {Array<{callback: Function, observed: Element[], disconnect: import('vitest').Mock}>} */
let observers = [];

class FakeIntersectionObserver {
  constructor(callback) {
    this.callback = callback;
    this.observed = [];
    this.disconnect = vi.fn();
    observers.push(this);
  }
  observe(element) {
    this.observed.push(element);
  }
}

const rect = (left, top, width, height) => ({ left, top, width, height });

beforeEach(async () => {
  observers = [];
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  await import('@theme/fly-to-cart');
  document.body.innerHTML = '<button id="source"></button><span id="cart"></span>';
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function launch({ useSourceSize = false } = {}) {
  const fly = document.createElement('fly-to-cart');
  fly.source = document.getElementById('source');
  fly.destination = document.getElementById('cart');
  fly.useSourceSize = useSourceSize;
  document.body.append(fly);
  return { fly, observer: observers.at(-1) };
}

describe('fly-to-cart', () => {
  it('observes the source and destination', () => {
    const { fly, observer } = launch();
    expect(observer.observed).toEqual([fly.source, fly.destination]);
  });

  it('sets the travel path between the two rects and removes itself when done', async () => {
    const { fly, observer } = launch({ useSourceSize: true });
    let finish;
    const finished = new Promise((resolve) => (finish = resolve));
    vi.spyOn(fly, 'getAnimations').mockReturnValue([{ finished }]);

    observer.callback([
      { target: fly.source, boundingClientRect: rect(10, 20, 100, 40) },
      { target: fly.destination, boundingClientRect: rect(500, 0, 20, 20) },
    ]);

    expect(observer.disconnect).toHaveBeenCalled();
    expect(fly.style.getPropertyValue('--width')).toBe('100px');
    expect(fly.style.getPropertyValue('--height')).toBe('40px');
    expect(fly.style.getPropertyValue('--start-x')).toBe('60px');
    expect(fly.style.getPropertyValue('--start-y')).toBe('40px');
    expect(fly.style.getPropertyValue('--travel-x')).toBe('450px');
    expect(fly.style.getPropertyValue('--travel-y')).toBe('-30px');

    await new Promise((r) => setTimeout(r, 30));
    expect(fly.isConnected).toBe(true);
    finish();
    await vi.waitFor(() => expect(fly.isConnected).toBe(false));
  });

  it('keeps its own size by default', async () => {
    const { fly, observer } = launch();
    observer.callback([
      { target: fly.source, boundingClientRect: rect(0, 0, 10, 10) },
      { target: fly.destination, boundingClientRect: rect(0, 0, 10, 10) },
    ]);
    expect(fly.style.getPropertyValue('--width')).toBe('');
    expect(fly.style.getPropertyValue('--travel-x')).toBe('0px');
    await vi.waitFor(() => expect(fly.isConnected).toBe(false));
  });

  it('does not animate unless both rects are known', async () => {
    const { fly, observer } = launch();
    observer.callback([
      { target: fly.source, boundingClientRect: rect(0, 0, 10, 10) },
      { target: document.body, boundingClientRect: rect(0, 0, 10, 10) },
    ]);
    expect(observer.disconnect).toHaveBeenCalled();
    expect(fly.style.getPropertyValue('--start-x')).toBe('');
    await new Promise((r) => setTimeout(r, 30));
    expect(fly.isConnected).toBe(true);
  });
});
