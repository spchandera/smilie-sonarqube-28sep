import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import '@theme/marquee';
import '@theme/jumbo-text';
import { ComparisonSliderComponent } from '@theme/comparison-slider';

/** Controllable IntersectionObserver stub (jsdom has none). */
class FakeIntersectionObserver {
  static instances = [];
  constructor(callback, options = {}) {
    this.callback = callback;
    this.options = options;
    this.targets = new Set();
    this.disconnected = false;
    FakeIntersectionObserver.instances.push(this);
  }
  observe(el) {
    this.targets.add(el);
  }
  unobserve(el) {
    this.targets.delete(el);
  }
  disconnect() {
    this.disconnected = true;
    this.targets.clear();
  }
  takeRecords() {
    return [];
  }
  trigger(entries) {
    this.callback(entries, this);
  }
}

const originals = {};
let resizeObservers;

beforeAll(() => {
  originals.IntersectionObserver = globalThis.IntersectionObserver;
  originals.roObserve = ResizeObserver.prototype.observe;
  originals.roDisconnect = ResizeObserver.prototype.disconnect;
  globalThis.IntersectionObserver = FakeIntersectionObserver;
});

afterAll(() => {
  globalThis.IntersectionObserver = originals.IntersectionObserver;
});

beforeEach(() => {
  vi.useFakeTimers();
  FakeIntersectionObserver.instances = [];
  resizeObservers = [];
  ResizeObserver.prototype.observe = function (el) {
    resizeObservers.push({ observer: this, el });
    this.observing = true;
  };
  ResizeObserver.prototype.disconnect = function () {
    this.observing = false;
  };
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllTimers();
  vi.useRealTimers();
  ResizeObserver.prototype.observe = originals.roObserve;
  ResizeObserver.prototype.disconnect = originals.roDisconnect;
  vi.restoreAllMocks();
  delete window.Shopify;
  sessionStorage.clear();
});

function mount(html) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper);
  return wrapper.firstElementChild;
}

function lastObserver() {
  return FakeIntersectionObserver.instances.at(-1);
}

/* -------------------------------------------------------------------------- */
/* Marquee                                                                    */
/* -------------------------------------------------------------------------- */

const marqueeMarkup = (attrs = 'data-speed-factor="4"') => `
  <marquee-component ${attrs}>
    <div ref="wrapper">
      <div ref="content"><span ref="marqueeItems[]">Item</span></div>
    </div>
  </marquee-component>`;

async function mountMarquee({ rootWidth = 500, itemWidth = 100, attrs } = {}) {
  const el = mount(marqueeMarkup(attrs));
  const io = lastObserver();
  io.trigger([{ rootBounds: { width: rootWidth }, boundingClientRect: { width: itemWidth } }]);
  await vi.advanceTimersByTimeAsync(0);
  return el;
}

function fakeAnimation(playbackRate = 1) {
  const animation = {
    playbackRate,
    currentTime: 42,
    updatePlaybackRate: vi.fn((value) => {
      animation.playbackRate = value;
    }),
  };
  return animation;
}

describe('MarqueeComponent', () => {
  it('observes the first item relative to itself', () => {
    const el = mount(marqueeMarkup());
    const io = lastObserver();
    expect(io.options.root).toBe(el);
    expect(io.targets.has(el.refs.marqueeItems[0])).toBe(true);
  });

  it('fills the marquee with enough copies and duplicates the content', async () => {
    const el = await mountMarquee({ rootWidth: 500, itemWidth: 100 });
    const { wrapper, content } = el.refs;

    expect(content.children).toHaveLength(5);
    expect(wrapper.children).toHaveLength(2);

    const clone = wrapper.lastElementChild;
    expect(el.clonedContent).toBe(clone);
    expect(clone.getAttribute('aria-hidden')).toBe('true');
    expect(clone.hasAttribute('ref')).toBe(false);
    expect(clone.children).toHaveLength(5);
    expect(lastObserver().disconnected).toBe(true);

    expect(el.style.getPropertyValue('--marquee-speed')).toBe(`${Math.sqrt(5) * 4}s`);
  });

  it('uses a single copy when items have no width', async () => {
    const el = await mountMarquee({ rootWidth: 500, itemWidth: 0 });
    expect(el.refs.content.children).toHaveLength(1);
    expect(el.style.getPropertyValue('--marquee-speed')).toBe('4s');
  });

  it('defaults the speed factor to zero and tolerates missing root bounds', async () => {
    const el = mount(marqueeMarkup(''));
    lastObserver().trigger([{ rootBounds: null, boundingClientRect: { width: 50 } }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(el.style.getPropertyValue('--marquee-speed')).toBe('0s');
    expect(el.clonedContent).not.toBeNull();
  });

  it('ignores empty observer callbacks', async () => {
    const el = mount(marqueeMarkup());
    lastObserver().trigger([]);
    await vi.advanceTimersByTimeAsync(10);
    expect(el.clonedContent).toBeNull();
    expect(el.style.getPropertyValue('--marquee-speed')).toBe('');
  });

  it('slows down on pointer enter and speeds back up on leave', async () => {
    const el = await mountMarquee();
    const animation = fakeAnimation();
    el.refs.wrapper.getAnimations = () => [animation];

    el.dispatchEvent(new Event('pointerenter'));
    await vi.advanceTimersByTimeAsync(499);
    expect(animation.updatePlaybackRate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(700);
    expect(animation.updatePlaybackRate).toHaveBeenCalled();
    expect(animation.playbackRate).toBe(0);

    animation.updatePlaybackRate.mockClear();
    el.dispatchEvent(new Event('pointerleave'));
    await vi.advanceTimersByTimeAsync(700);
    expect(animation.updatePlaybackRate).toHaveBeenCalled();
    expect(animation.playbackRate).toBe(1);
  });

  it('reverses a slow-down that is still in progress', async () => {
    const el = await mountMarquee();
    const animation = fakeAnimation();
    el.refs.wrapper.getAnimations = () => [animation];

    el.dispatchEvent(new Event('pointerenter'));
    await vi.advanceTimersByTimeAsync(750);
    const midway = animation.playbackRate;
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(1);

    // A second enter while animating is ignored
    el.dispatchEvent(new Event('pointerenter'));

    el.dispatchEvent(new Event('pointerleave'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(animation.playbackRate).toBe(1);
  });

  it('cancels a pending slow-down and skips speed-up when already at full speed', async () => {
    const el = await mountMarquee();
    const animation = fakeAnimation(1);
    el.refs.wrapper.getAnimations = () => [animation];

    el.dispatchEvent(new Event('pointerenter'));
    el.dispatchEvent(new Event('pointerleave'));
    await vi.advanceTimersByTimeAsync(1500);
    expect(animation.updatePlaybackRate).not.toHaveBeenCalled();
  });

  it('does nothing on hover without a running animation', async () => {
    const el = await mountMarquee();
    el.dispatchEvent(new Event('pointerenter'));
    el.dispatchEvent(new Event('pointerleave'));
    await expect(vi.advanceTimersByTimeAsync(1500)).resolves.not.toThrow();
  });

  it('opts out of rebuilding on vertical-only resizes', async () => {
    const el = await mountMarquee({ rootWidth: 500 });
    const clone = el.clonedContent;

    window.dispatchEvent(new Event('resize'));
    await vi.advanceTimersByTimeAsync(250);
    lastObserver().trigger([{ rootBounds: { width: 500 }, boundingClientRect: { width: 100 } }]);
    await vi.advanceTimersByTimeAsync(0);

    expect(el.clonedContent).toBe(clone);
  });

  it('rebuilds the duplicate content and restarts animations on horizontal resize', async () => {
    const el = await mountMarquee({ rootWidth: 500 });
    const clone = el.clonedContent;
    const animation = fakeAnimation();
    el.refs.wrapper.getAnimations = () => [animation];

    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('resize'));
    await vi.advanceTimersByTimeAsync(250);
    expect(FakeIntersectionObserver.instances).toHaveLength(2);

    lastObserver().trigger([{ rootBounds: { width: 900 }, boundingClientRect: { width: 100 } }]);
    await vi.advanceTimersByTimeAsync(20);

    expect(el.clonedContent).not.toBe(clone);
    expect(el.refs.wrapper.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
    expect(animation.currentTime).toBe(0);
  });

  it('removes its listeners on disconnect', async () => {
    const el = await mountMarquee();
    el.remove();
    window.dispatchEvent(new Event('resize'));
    await vi.advanceTimersByTimeAsync(300);
    expect(FakeIntersectionObserver.instances).toHaveLength(1);
  });

  it('requires its refs', async () => {
    const el = document.createElement('marquee-component');
    el.innerHTML = '<div ref="wrapper"></div>';
    await expect(el.connectedCallback()).rejects.toThrow('Required ref "content" not found');
  });
});

/* -------------------------------------------------------------------------- */
/* Jumbo text                                                                 */
/* -------------------------------------------------------------------------- */

function mountJumbo(attrs = '', text = 'Big headline') {
  const el = mount(`<jumbo-text ${attrs}><span>${text}</span></jumbo-text>`);
  const child = el.firstElementChild;
  // Rendered width scales with the element's font size (20px default).
  child.getBoundingClientRect = () => ({ width: Number.parseFloat(el.style.fontSize || '20') * 5 });
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({ fontSize: el.style.fontSize || '20px' }));
  return el;
}

function intersect(el, { width = 400, isIntersecting = true, ratio = 1 } = {}) {
  lastObserver().trigger([
    { target: el, isIntersecting, intersectionRatio: ratio, boundingClientRect: { width } },
  ]);
}

describe('JumboText', () => {
  it('ignores empty observer callbacks', () => {
    const el = mountJumbo();
    lastObserver().trigger([]);
    expect(el.style.fontSize).toBe('');
  });

  it('fits the font size to the container on first intersection', () => {
    const el = mountJumbo();
    intersect(el, { width: 400 });

    // First pass: 20 * 400 / 100 = 80px, second pass refines to 79.85px
    expect(el.style.fontSize).toBe('79.85px');
    expect(el.classList.contains('ready')).toBe(true);
    expect(el.dataset.capText).toBe('true');
    expect(resizeObservers.some((r) => r.el === el)).toBe(true);
  });

  it('clamps the font size to the supported range', () => {
    const el = mountJumbo();
    intersect(el, { width: 100000 });
    expect(el.style.fontSize).toBe('500px');
  });

  it('keeps the first pass when the second pass would overshoot', () => {
    const el = mountJumbo();
    const child = el.firstElementChild;
    let calls = 0;
    child.getBoundingClientRect = () => ({ width: calls++ === 0 ? 100 : 10 });
    intersect(el, { width: 400 });
    expect(el.style.fontSize).toBe('80px');
  });

  it('stops when the second measurement has no width', () => {
    const el = mountJumbo();
    const child = el.firstElementChild;
    let calls = 0;
    child.getBoundingClientRect = () => ({ width: calls++ === 0 ? 100 : 0 });
    intersect(el, { width: 400 });
    expect(el.style.fontSize).toBe('80px');
    expect(el.classList.contains('ready')).toBe(false);
  });

  it('skips sizing for empty text, zero width, or no measurable children', () => {
    const empty = mountJumbo('', '   ');
    intersect(empty);
    expect(empty.style.fontSize).toBe('');

    const narrow = mountJumbo();
    intersect(narrow, { width: 0 });
    expect(narrow.style.fontSize).toBe('');

    const unmeasured = mountJumbo();
    unmeasured.firstElementChild.getBoundingClientRect = () => ({ width: 0 });
    intersect(unmeasured);
    expect(unmeasured.style.fontSize).toBe('');
  });

  it('only sizes on the first intersection', () => {
    const el = mountJumbo();
    intersect(el, { width: 400 });
    intersect(el, { width: 200 });
    expect(el.style.fontSize).toBe('79.85px');
  });

  it('respects an explicit cap-text setting', () => {
    const el = mountJumbo('data-cap-text="true"');
    intersect(el);
    expect(el.dataset.capText).toBe('true');
  });

  it('does not measure page position unless inside the last section', () => {
    document.body.innerHTML = '<div class="shopify-section" id="a"></div><div class="shopify-section" id="b"></div>';
    const wrapper = document.createElement('div');
    wrapper.innerHTML = '<jumbo-text><span>Hello</span></jumbo-text>';
    document.getElementById('a').appendChild(wrapper);
    const el = wrapper.firstElementChild;
    el.firstElementChild.getBoundingClientRect = () => ({ width: 100 });
    vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({ fontSize: '20px' }));

    intersect(el);
    expect(el.style.fontSize).not.toBe('');
    expect(el.dataset.capText).toBeUndefined();
  });

  it('uses cap alphabetic when far from the bottom of the page', () => {
    const el = mountJumbo();
    vi.spyOn(document.documentElement, 'offsetHeight', 'get').mockReturnValue(5000);
    intersect(el);
    expect(el.dataset.capText).toBe('false');
  });

  it('recalculates on window resize using its own width', () => {
    const el = mountJumbo();
    intersect(el, { width: 400 });

    Object.defineProperty(el, 'offsetWidth', { configurable: true, value: 200 });
    el.dataset.capText = 'true';
    window.dispatchEvent(new Event('resize'));
    // Font size is reset to 20px before measuring: 20 * 200 / 100 = 40px, refined to 39.85px
    expect(el.style.fontSize).toBe('39.85px');
    expect(el.classList.contains('ready')).toBe(true);
  });

  it('recalculates when the resize observer reports a new size', () => {
    const el = mountJumbo();
    intersect(el, { width: 400 });
    const { observer } = resizeObservers.find((r) => r.el === el);

    // ResizeNotifier swallows the initial observation callback
    observer.callback([{ borderBoxSize: [{ inlineSize: 100 }] }]);
    expect(el.style.fontSize).toBe('79.85px');

    observer.callback([{ borderBoxSize: [{ inlineSize: 100 }] }]);
    expect(el.style.fontSize).toBe('19.85px');
  });

  it('reveals the text effect when sufficiently visible', async () => {
    const el = mountJumbo('data-text-effect="blur"');
    intersect(el, { ratio: 0.5 });
    expect(el.classList.contains('ready')).toBe(true);
    await vi.advanceTimersByTimeAsync(40);
    expect(el.classList.contains('jumbo-text-visible')).toBe(true);
    expect(lastObserver().targets.has(el)).toBe(true);

    intersect(el, { ratio: 0.1 });
    expect(el.classList.contains('ready')).toBe(false);
    expect(el.classList.contains('jumbo-text-visible')).toBe(false);
  });

  it('stops observing after the first reveal when the animation does not repeat', () => {
    const el = mountJumbo('data-text-effect="blur" data-animation-repeat="false"');
    intersect(el, { ratio: 0.5 });
    expect(lastObserver().targets.has(el)).toBe(false);
  });

  it('ignores the text effect when set to none', () => {
    const el = mountJumbo('data-text-effect="none"');
    intersect(el, { width: 0, ratio: 1 });
    expect(el.classList.contains('ready')).toBe(false);
  });

  it('disconnects observers and listeners when removed', () => {
    const el = mountJumbo();
    intersect(el, { width: 400 });
    const io = lastObserver();
    const { observer } = resizeObservers.find((r) => r.el === el);
    el.remove();

    expect(io.disconnected).toBe(true);
    expect(observer.observing).toBe(false);

    Object.defineProperty(el, 'offsetWidth', { configurable: true, value: 200 });
    window.dispatchEvent(new Event('resize'));
    expect(el.style.fontSize).toBe('79.85px');
  });
});

/* -------------------------------------------------------------------------- */
/* Comparison slider                                                          */
/* -------------------------------------------------------------------------- */

const sliderMarkup = (orientation = '') => `
  <comparison-slider-component>
    <div ref="mediaWrapper" ${orientation ? `data-orientation="${orientation}"` : ''}>
      <img ref="afterImage" alt="">
    </div>
    <input ref="slider" type="range" min="0" max="100" value="30">
  </comparison-slider-component>`;

describe('ComparisonSliderComponent', () => {
  it('is registered', () => {
    expect(customElements.get('comparison-slider-component')).toBe(ComparisonSliderComponent);
  });

  it('syncs the compare property and reads the orientation', () => {
    const el = mount(sliderMarkup('vertical'));
    expect(el.orientation).toBe('vertical');
    expect(el.refs.mediaWrapper.style.getPropertyValue('--compare')).toBe('30');

    el.setValue(72);
    expect(el.refs.slider.value).toBe('72');
    expect(el.refs.mediaWrapper.style.getPropertyValue('--compare')).toBe('72');
  });

  it('defaults to horizontal orientation and handles custom ranges', () => {
    const el = mount(sliderMarkup());
    expect(el.orientation).toBe('horizontal');

    el.refs.slider.min = '10';
    el.refs.slider.max = '20';
    el.setValue(15);
    expect(el.refs.mediaWrapper.style.getPropertyValue('--compare')).toBe('50');
  });

  it('plays a hint animation once it scrolls into view', async () => {
    const el = mount(sliderMarkup());
    const io = lastObserver();
    expect(io.options.threshold).toBe(0.5);
    const { mediaWrapper, slider } = el.refs;
    const compare = () => mediaWrapper.style.getPropertyValue('--compare');

    io.trigger([{ isIntersecting: false }]);
    expect(io.disconnected).toBe(false);

    io.trigger([{ isIntersecting: true }]);
    expect(io.disconnected).toBe(true);

    await vi.advanceTimersByTimeAsync(300);
    expect(el.hasAnimated).toBe(true);
    expect(el.isAnimating).toBe(true);
    expect(mediaWrapper.style.getPropertyValue('--transition-duration')).toBe('0.5s');

    // User input is ignored while the hint plays
    el.setValue(90);
    expect(compare()).toBe('30');

    await vi.advanceTimersByTimeAsync(100);
    expect(compare()).toBe('40');
    await vi.advanceTimersByTimeAsync(500);
    expect(compare()).toBe('60');
    await vi.advanceTimersByTimeAsync(500);
    expect(compare()).toBe('50');
    await vi.advanceTimersByTimeAsync(500);
    expect(el.isAnimating).toBe(false);
    expect(slider.value).toBe('50');
    expect(mediaWrapper.style.getPropertyValue('--transition-duration')).toBe('0s');

    // It only animates once
    el.animateSlider();
    expect(el.isAnimating).toBe(false);
  });

  it('skips the hint in the theme editor once it has played this session', async () => {
    window.Shopify = { designMode: true };
    const first = mount(sliderMarkup());
    first.dataset.shopifyEditorSection = JSON.stringify({ id: 'sec-1' });
    lastObserver().trigger([{ isIntersecting: true }]);
    await vi.advanceTimersByTimeAsync(300);
    expect(first.hasAnimated).toBe(true);
    expect(sessionStorage.getItem('comparison-slider-animated-sec-1')).toBe('true');

    const second = mount(sliderMarkup());
    second.dataset.shopifyEditorSection = JSON.stringify({ id: 'sec-1' });
    lastObserver().trigger([{ isIntersecting: true }]);
    await vi.advanceTimersByTimeAsync(300);
    expect(second.hasAnimated).toBe(false);
  });

  it('works without IntersectionObserver support', () => {
    const saved = window.IntersectionObserver;
    delete window.IntersectionObserver;
    try {
      const el = mount(sliderMarkup());
      expect(el.intersectionObserver).toBeUndefined();
      expect(() => el.remove()).not.toThrow();
    } finally {
      window.IntersectionObserver = saved;
    }
  });

  it('disconnects its observer when removed', () => {
    const el = mount(sliderMarkup());
    const io = lastObserver();
    el.remove();
    expect(io.disconnected).toBe(true);
  });
});
