import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as utils from '@theme/utilities';

/** Gives an element a fixed bounding box, since jsdom has no layout engine. */
function withRect(el, { left = 0, top = 0, width = 0, height = 0 }) {
  el.getBoundingClientRect = () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top });
  return el;
}

function box(rect) {
  return withRect(document.createElement('div'), rect);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});

describe('fetchConfig', () => {
  it('builds a JSON POST request by default', () => {
    expect(utils.fetchConfig()).toEqual({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: undefined,
    });
  });

  it('merges custom headers and body', () => {
    const config = utils.fetchConfig('json', { body: '{"a":1}', headers: { 'X-Test': '1' } });
    expect(config.headers).toEqual({ 'Content-Type': 'application/json', Accept: 'application/json', 'X-Test': '1' });
    expect(config.body).toBe('{"a":1}');
  });

  it('marks javascript requests as XHR and drops the content type', () => {
    expect(utils.fetchConfig('javascript').headers).toEqual({
      Accept: 'application/javascript',
      'X-Requested-With': 'XMLHttpRequest',
    });
  });
});

describe('debounce', () => {
  beforeEach(() => vi.useFakeTimers());

  it('only calls the function once after the wait, with the latest arguments', () => {
    const fn = vi.fn();
    const debounced = utils.debounce(fn, 100);

    debounced(1);
    debounced(2);
    vi.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(2);
  });

  it('preserves the calling context', () => {
    const obj = { value: 42, read: vi.fn(function () { return this.value; }) };
    obj.debounced = utils.debounce(obj.read, 10);
    obj.debounced();
    vi.advanceTimersByTime(10);
    expect(obj.read.mock.contexts[0]).toBe(obj);
  });

  it('can be cancelled', () => {
    const fn = vi.fn();
    const debounced = utils.debounce(fn, 50);
    debounced();
    debounced.cancel();
    vi.advanceTimersByTime(100);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('throttle', () => {
  it('calls at most once per delay and can be cancelled', () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const fn = vi.fn();
    const throttled = utils.throttle(fn, 100);

    throttled('a');
    throttled('b');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('a');

    now += 100;
    throttled('c');
    expect(fn).toHaveBeenCalledTimes(2);

    now += 100;
    throttled.cancel();
    throttled('d');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('small helpers', () => {
  it('normalizeString strips diacritics and lowercases', () => {
    expect(utils.normalizeString('Crème BRÛLÉE')).toBe('creme brulee');
  });

  it('clamp keeps values within range', () => {
    expect(utils.clamp(5, 0, 10)).toBe(5);
    expect(utils.clamp(-5, 0, 10)).toBe(0);
    expect(utils.clamp(15, 0, 10)).toBe(10);
  });

  it('closest returns the nearest value', () => {
    expect(utils.closest([0, 10, 20, 30], 14)).toBe(10);
    expect(utils.closest([0, 10, 20, 30], 26)).toBe(30);
  });

  it('preventDefault cancels the event', () => {
    const event = new Event('click', { cancelable: true });
    utils.preventDefault(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it.each([
    ['12', null, 12],
    [7, null, 7],
    ['0', 5, 0],
    ['', 5, 5],
    [null, 5, 5],
    [undefined, null, null],
    ['abc', 3, 3],
  ])('parseIntOrDefault(%j, %j) is %j', (value, fallback, expected) => {
    expect(utils.parseIntOrDefault(value, fallback)).toBe(expected);
  });

  it('prefersReducedMotion and breakpoints read media queries', () => {
    expect(utils.prefersReducedMotion()).toBe(false);
    expect(utils.isDesktopBreakpoint()).toBe(false);
    expect(utils.isMobileBreakpoint()).toBe(true);
  });

  it('isTouchDevice requires touch support and touch points', () => {
    expect(utils.isTouchDevice()).toBe(false);
  });

  it('isLowPowerDevice checks cores and memory', () => {
    vi.spyOn(navigator, 'hardwareConcurrency', 'get').mockReturnValue(2);
    expect(utils.isLowPowerDevice()).toBe(true);
    vi.spyOn(navigator, 'hardwareConcurrency', 'get').mockReturnValue(8);
    expect(utils.isLowPowerDevice()).toBe(false);
  });

  it('supportsViewTransitions reflects the document API', () => {
    expect(utils.supportsViewTransitions()).toBe(false);
  });

  it('getViewParameterValue reads the view query parameter', () => {
    window.history.replaceState({}, '', '/?view=quick');
    expect(utils.getViewParameterValue()).toBe('quick');
    window.history.replaceState({}, '', '/');
    expect(utils.getViewParameterValue()).toBeNull();
  });

  it('preloadImage creates an image with the source', () => {
    const spy = vi.spyOn(globalThis, 'Image');
    utils.preloadImage('https://cdn.example.com/a.jpg');
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.results[0].value.src).toBe('https://cdn.example.com/a.jpg');
  });
});

describe('getIOSVersion', () => {
  const setUA = (ua) => vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);

  it('returns null on non-iOS devices', () => {
    setUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    expect(utils.getIOSVersion()).toBeNull();
  });

  it('parses the major and minor version', () => {
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)');
    expect(utils.getIOSVersion()).toEqual({ fullString: '17.4', major: 17, minor: 4 });
  });

  it('defaults the minor version to zero', () => {
    setUA('Mozilla/5.0 (iPad; CPU OS 16 like Mac OS X)');
    expect(utils.getIOSVersion()).toEqual({ fullString: '16', major: 16, minor: 0 });
  });

  it('returns null when no version is present', () => {
    setUA('Mozilla/5.0 (iPhone)');
    expect(utils.getIOSVersion()).toBeNull();
  });
});

describe('document lifecycle helpers', () => {
  it('onDocumentLoaded runs immediately once loaded', () => {
    const cb = vi.fn();
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete');
    utils.onDocumentLoaded(cb);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('onDocumentLoaded waits for the load event otherwise', () => {
    const cb = vi.fn();
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('interactive');
    utils.onDocumentLoaded(cb);
    expect(cb).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('load'));
    expect(cb).toHaveBeenCalledTimes(1);
    window.removeEventListener('load', cb);
  });

  it('onDocumentReady waits for DOMContentLoaded while loading', () => {
    const cb = vi.fn();
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    utils.onDocumentReady(cb);
    expect(cb).not.toHaveBeenCalled();
    document.dispatchEvent(new Event('DOMContentLoaded'));
    expect(cb).toHaveBeenCalledTimes(1);
    document.removeEventListener('DOMContentLoaded', cb);
  });

  it('onDocumentReady runs immediately after parsing', () => {
    const cb = vi.fn();
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('interactive');
    utils.onDocumentReady(cb);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe('animation helpers', () => {
  it('removeWillChangeOnAnimationEnd resets will-change on the target', () => {
    const el = document.createElement('div');
    el.style.setProperty('will-change', 'transform');
    el.addEventListener('animationend', utils.removeWillChangeOnAnimationEnd);
    el.dispatchEvent(new Event('animationend'));
    expect(el.style.getPropertyValue('will-change')).toBe('unset');
  });

  it('removeWillChangeOnAnimationEnd ignores non-element targets', () => {
    expect(() => utils.removeWillChangeOnAnimationEnd({ target: null })).not.toThrow();
  });

  it('onAnimationEnd waits for document timeline animations only', async () => {
    const finished = Promise.resolve();
    const docAnimation = { timeline: new DocumentTimeline(), finished };
    const viewAnimation = { timeline: {}, finished: new Promise(() => {}) };
    const a = document.createElement('div');
    const b = document.createElement('div');
    a.getAnimations = () => [docAnimation];
    b.getAnimations = () => [viewAnimation];

    const cb = vi.fn();
    await utils.onAnimationEnd([a, b], cb);
    expect(cb).toHaveBeenCalledTimes(1);

    const single = vi.fn();
    await utils.onAnimationEnd(a, single);
    expect(single).toHaveBeenCalledTimes(1);
  });
});

describe('geometry helpers', () => {
  const el = () => box({ left: 10, top: 20, width: 100, height: 50 });

  it('center returns the midpoint', () => {
    expect(utils.center(el())).toEqual({ x: 60, y: 45 });
    expect(utils.center(el(), 'x')).toBe(60);
    expect(utils.center(el(), 'y')).toBe(45);
  });

  it('start returns the top-left corner', () => {
    expect(utils.start(el())).toEqual({ x: 10, y: 20 });
    expect(utils.start(el(), 'y')).toBe(20);
  });

  it('isPointWithinElement checks bounds inclusively', () => {
    expect(utils.isPointWithinElement(10, 20, el())).toBe(true);
    expect(utils.isPointWithinElement(110, 70, el())).toBe(true);
    expect(utils.isPointWithinElement(111, 70, el())).toBe(false);
  });

  it('isClickedOutside uses containment for regular elements', () => {
    const parent = el();
    const child = document.createElement('span');
    parent.appendChild(child);
    const outside = document.createElement('p');

    expect(utils.isClickedOutside({ target: child }, parent)).toBe(false);
    expect(utils.isClickedOutside({ target: outside }, parent)).toBe(true);
  });

  it('isClickedOutside uses coordinates for dialog backdrops', () => {
    const dialog = document.createElement('dialog');
    const target = el();
    expect(utils.isClickedOutside({ target: dialog, clientX: 50, clientY: 30 }, target)).toBe(false);
    expect(utils.isClickedOutside({ target: dialog, clientX: 500, clientY: 30 }, target)).toBe(true);
    expect(utils.isClickedOutside({ target: null, clientX: 500, clientY: 30 }, target)).toBe(true);
  });

  describe('getVisibleElements', () => {
    const root = box({ left: 0, top: 0, width: 100, height: 100 });
    const inside = box({ left: 10, top: 10, width: 20, height: 20 });
    const halfRight = box({ left: 90, top: 10, width: 20, height: 20 });
    const halfBelow = box({ left: 10, top: 90, width: 20, height: 20 });
    const outside = box({ left: 200, top: 200, width: 20, height: 20 });
    const empty = box({ left: 10, top: 10, width: 0, height: 0 });
    const all = [inside, halfRight, halfBelow, outside, empty];

    it('returns an empty array without elements', () => {
      expect(utils.getVisibleElements(root, undefined)).toEqual([]);
      expect(utils.getVisibleElements(root, [])).toEqual([]);
    });

    it('requires full visibility by default', () => {
      expect(utils.getVisibleElements(root, all)).toEqual([inside, empty]);
      expect(utils.getVisibleElements(root, all, 1, 'x')).toEqual([inside, halfBelow, empty]);
      expect(utils.getVisibleElements(root, all, 1, 'y')).toEqual([inside, halfRight, empty]);
    });

    it('supports partial visibility ratios per axis', () => {
      expect(utils.getVisibleElements(root, all, 0.5)).toEqual([inside, halfRight, halfBelow]);
      expect(utils.getVisibleElements(root, all, 0.6, 'x')).toEqual([inside, halfBelow]);
      expect(utils.getVisibleElements(root, all, 0.6, 'y')).toEqual([inside, halfRight]);
    });
  });
});

describe('DOM helpers', () => {
  it('TextComponent is registered and can shimmer', () => {
    const el = document.createElement('text-component');
    expect(el).toBeInstanceOf(utils.TextComponent);
    el.shimmer();
    expect(el.hasAttribute('shimmer')).toBe(true);
  });

  it('resetShimmer removes the attribute within a container', () => {
    document.body.innerHTML = '<div shimmer></div><section><span shimmer></span></section>';
    utils.resetShimmer();
    expect(document.querySelectorAll('[shimmer]')).toHaveLength(0);

    document.body.innerHTML = '<div id="a"><i shimmer></i></div><b shimmer></b>';
    utils.resetShimmer(document.getElementById('a'));
    expect(document.querySelectorAll('[shimmer]')).toHaveLength(1);
  });

  it('changeMetaThemeColor updates the meta tag when present', () => {
    expect(() => utils.changeMetaThemeColor('red')).not.toThrow();
    document.head.innerHTML = '<meta name="theme-color" content="white">';
    utils.changeMetaThemeColor('rgb(0, 0, 0)');
    expect(document.head.querySelector('meta').getAttribute('content')).toBe('rgb(0, 0, 0)');
    utils.changeMetaThemeColor('');
    expect(document.head.querySelector('meta').getAttribute('content')).toBe('rgb(0, 0, 0)');
  });

  describe('oncePerEditorSession', () => {
    afterEach(() => {
      delete window.Shopify;
      sessionStorage.clear();
    });

    it('always runs outside the theme editor', () => {
      const el = document.createElement('div');
      const cb = vi.fn();
      utils.oncePerEditorSession(el, 'key', cb);
      utils.oncePerEditorSession(el, 'key', cb);
      expect(cb).toHaveBeenCalledTimes(2);
    });

    it('runs once per section in the theme editor', () => {
      window.Shopify = { designMode: true };
      const el = document.createElement('div');
      el.dataset.shopifyEditorSection = JSON.stringify({ id: 'sec-1' });
      const cb = vi.fn();

      utils.oncePerEditorSession(el, 'intro', cb);
      utils.oncePerEditorSession(el, 'intro', cb);
      expect(cb).toHaveBeenCalledTimes(1);
      expect(sessionStorage.getItem('intro-sec-1')).toBe('true');
    });

    it('falls back to the block id', () => {
      window.Shopify = { designMode: true };
      const el = document.createElement('div');
      el.dataset.shopifyEditorBlock = JSON.stringify({ id: 'blk-9' });
      utils.oncePerEditorSession(el, 'intro', vi.fn());
      expect(sessionStorage.getItem('intro-blk-9')).toBe('true');
    });
  });

  it('ResizeNotifier skips the initial observation callback', () => {
    const cb = vi.fn();
    const notifier = new utils.ResizeNotifier(cb);
    const fire = notifier.callback;

    fire([]);
    expect(cb).not.toHaveBeenCalled();
    fire(['entry']);
    expect(cb).toHaveBeenCalledWith(['entry'], notifier);

    notifier.disconnect();
    fire([]);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe('header helpers', () => {
  function setHeight(el, value) {
    Object.defineProperty(el, 'offsetHeight', { configurable: true, value });
  }

  function buildHeader({ transparent = false, withSibling = true } = {}) {
    document.body.innerHTML = `
      <div id="header-group">
        <div class="announcement"></div>
        <div class="header-section">
          <header-component id="header-component" ${transparent ? 'transparent' : ''}>
            <div class="header__row--top"></div>
            <overflow-list></overflow-list>
          </header-component>
        </div>
        ${withSibling ? '<div class="shopify-section"></div>' : ''}
      </div>`;
    const header = document.getElementById('header-component');
    setHeight(document.querySelector('.announcement'), 40);
    setHeight(document.querySelector('.header-section'), 80);
    setHeight(header, 80);
    setHeight(header.querySelector('.header__row--top'), 30);
    if (withSibling) setHeight(document.querySelector('.shopify-section'), 0);
    return header;
  }

  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });
  });

  it('calculateHeaderGroupHeight returns 0 without a header group', () => {
    expect(utils.calculateHeaderGroupHeight(null, null)).toBe(0);
  });

  it('calculateHeaderGroupHeight sums sibling sections, excluding the header', () => {
    const header = buildHeader();
    const group = document.getElementById('header-group');
    expect(utils.calculateHeaderGroupHeight(header, group)).toBe(40 + 80);
  });

  it('calculateHeaderGroupHeight adds a transparent header with a following section', () => {
    buildHeader({ transparent: true });
    const header = document.getElementById('header-component');
    expect(utils.calculateHeaderGroupHeight(header, document.getElementById('header-group'))).toBe(40 + 80 + 80);
  });

  it('updateAllHeaderCustomProperties sets header CSS variables', () => {
    buildHeader();
    utils.updateAllHeaderCustomProperties();
    const body = document.body.style;
    const header = document.getElementById('header-component');

    expect(body.getPropertyValue('--header-height')).toBe('80px');
    expect(body.getPropertyValue('--header-group-height')).toBe('120px');
    expect(body.getPropertyValue('--transparent-header-offset-boolean')).toBe('0');
    expect(header.style.getPropertyValue('--top-row-height')).toBe('30px');
    expect(header.dataset.menuStyle).toBe('menu');
  });

  it('applies the transparent header offset when no section follows', () => {
    buildHeader({ transparent: true, withSibling: false });
    utils.updateAllHeaderCustomProperties();
    expect(document.body.style.getPropertyValue('--transparent-header-offset-boolean')).toBe('1');
  });

  it('switches to the drawer menu when the overflow list reaches its minimum', () => {
    const header = buildHeader();
    header.querySelector('overflow-list').setAttribute('minimum-reached', '');
    utils.setHeaderMenuStyle();
    expect(header.dataset.menuStyle).toBe('drawer');
  });

  it('does nothing without a header', () => {
    expect(() => utils.updateAllHeaderCustomProperties()).not.toThrow();
    expect(document.body.style.getPropertyValue('--transparent-header-offset-boolean')).toBe('0');
  });
});

describe('scheduling', () => {
  it('yieldToMainThread resolves after a frame', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });
    await expect(utils.yieldToMainThread()).resolves.toBeUndefined();
  });

  it('scheduler batches tasks into one frame', async () => {
    vi.useFakeTimers();
    const frames = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => frames.push(cb));
    const a = vi.fn();
    const b = vi.fn();

    await utils.scheduler.schedule(a);
    await utils.scheduler.schedule(b);
    expect(frames).toHaveLength(1);

    frames[0]();
    vi.runAllTimers();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('requestIdleCallback is callable', () => {
    expect(typeof utils.requestIdleCallback).toBe('function');
  });
});

describe('startViewTransition', () => {
  afterEach(() => {
    delete document.startViewTransition;
  });

  it('runs the callback directly when view transitions are unsupported', async () => {
    const cb = vi.fn();
    await utils.startViewTransition(cb);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('uses the View Transitions API and prepares product grid cards', async () => {
    vi.spyOn(navigator, 'hardwareConcurrency', 'get').mockReturnValue(8);
    Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value: 8 });

    document.body.innerHTML = `
      <div class="product-grid">
        <div class="product-grid__item" data-product-id="1"><product-card></product-card></div>
        <div class="product-grid__item" data-product-id="2"></div>
      </div>`;
    withRect(document.querySelector('.product-grid'), { left: 0, top: 0, width: 300, height: 400 });
    const types = new Set();
    let finish;
    document.startViewTransition = vi.fn((cb) => {
      cb();
      return { types, finished: new Promise((resolve) => (finish = resolve)) };
    });

    const cb = vi.fn();
    const done = utils.startViewTransition(cb, ['product-grid', 'unknown']);
    await vi.waitFor(() => expect(document.startViewTransition).toHaveBeenCalled());

    const cards = document.querySelectorAll('.product-grid__item');
    expect(cards[0].style.getPropertyValue('view-transition-name')).toBe('product-card-1');
    expect(utils.viewTransition.current).toBeInstanceOf(Promise);
    expect([...types]).toEqual(['product-grid', 'unknown']);

    finish();
    await done;
    expect(cb).toHaveBeenCalledTimes(1);
    expect(utils.viewTransition.current).toBeUndefined();
    expect(cards[0].style.getPropertyValue('view-transition-name')).toBe('');

    delete navigator.deviceMemory;
  });
});
