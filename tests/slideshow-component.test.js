import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { Slideshow } from '@theme/slideshow';
import { viewTransition } from '@theme/utilities';

/** Controllable IntersectionObserver stub (jsdom has none). */
class FakeIntersectionObserver {
  static instances = [];
  static all = [];
  constructor(callback, options = {}) {
    this.callback = callback;
    this.options = options;
    this.targets = new Set();
    FakeIntersectionObserver.instances.push(this);
    FakeIntersectionObserver.all.push(this);
  }
  observe(el) {
    this.targets.add(el);
  }
  unobserve(el) {
    this.targets.delete(el);
  }
  disconnect() {
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
let scrollToCalls;
let scrollByCalls;

beforeAll(() => {
  originals.IntersectionObserver = globalThis.IntersectionObserver;
  originals.scrollTo = Element.prototype.scrollTo;
  originals.scrollBy = Element.prototype.scrollBy;
  originals.setPointerCapture = Element.prototype.setPointerCapture;
  originals.releasePointerCapture = Element.prototype.releasePointerCapture;
  originals.roObserve = ResizeObserver.prototype.observe;

  globalThis.IntersectionObserver = FakeIntersectionObserver;
  Element.prototype.scrollTo = function (options) {
    scrollToCalls.push({ el: this, options });
  };
  Element.prototype.scrollBy = function (options) {
    scrollByCalls.push({ el: this, options });
  };
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

afterAll(() => {
  globalThis.IntersectionObserver = originals.IntersectionObserver;
  Element.prototype.scrollTo = originals.scrollTo;
  Element.prototype.scrollBy = originals.scrollBy;
  Element.prototype.setPointerCapture = originals.setPointerCapture;
  Element.prototype.releasePointerCapture = originals.releasePointerCapture;
});

let resizeObservers;

beforeEach(() => {
  vi.useFakeTimers();
  scrollToCalls = [];
  scrollByCalls = [];
  resizeObservers = [];
  FakeIntersectionObserver.instances = [];
  ResizeObserver.prototype.observe = function (el) {
    resizeObservers.push({ observer: this, el });
  };
});

afterEach(async () => {
  document.body.innerHTML = '';
  // Let the shared scheduler finish any pending flush so it is not left in a scheduled state.
  await vi.advanceTimersByTimeAsync(100);
  vi.clearAllTimers();
  vi.useRealTimers();
  ResizeObserver.prototype.observe = originals.roObserve;
  delete document.hidden;
  viewTransition.current = undefined;
  vi.restoreAllMocks();
});

function markup({ attrs = '', count = 4, hidden = [], thumbnails = true } = {}) {
  const slides = Array.from(
    { length: count },
    (_, i) =>
      `<slideshow-slide ref="slides[]" slide-id="s${i}" aria-hidden="true"${hidden.includes(i) ? ' hidden' : ''}>${i}</slideshow-slide>`
  ).join('');
  const dots = Array.from({ length: count }, () => '<button ref="dots[]"></button>').join('');
  const thumbs = thumbnails
    ? `<div ref="thumbnailsContainer">${Array.from({ length: count }, () => '<button ref="thumbnails[]"></button>').join('')}</div>`
    : '';
  return `<slideshow-component ${attrs}>
    <div ref="slideshowContainer"><div ref="scroller">${slides}</div></div>
    <div ref="slideshowControls">
      <span ref="current"></span>
      <button ref="previous"></button>
      <button ref="next"></button>
      ${dots}
      ${thumbs}
    </div>
  </slideshow-component>`;
}

async function mount(options, container = document.body) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = markup(options);
  const el = wrapper.querySelector('slideshow-component');
  el.querySelectorAll('slideshow-slide').forEach((slide, i) => {
    Object.defineProperty(slide, 'offsetTop', { configurable: true, value: i * 100 });
  });
  container.appendChild(wrapper);
  await vi.advanceTimersByTimeAsync(60);
  return el;
}

function slideObserver(el) {
  return FakeIntersectionObserver.instances.find((o) => o.options.root === el.refs.scroller);
}

function viewportObserver() {
  return FakeIntersectionObserver.all.find((o) => o.options.rootMargin === '100px');
}

function scrollerCalls(el) {
  return scrollToCalls.filter((c) => c.el === el.refs.scroller);
}

function makeVisible(el, indexes) {
  const io = slideObserver(el);
  io.trigger(el.refs.slides.map((slide, i) => ({ target: slide, intersectionRatio: indexes.includes(i) ? 1 : 0 })));
}

function captureSelects(el) {
  const events = [];
  el.addEventListener('slideshow:select', (e) => events.push(e.detail));
  return events;
}

describe('Slideshow setup', () => {
  it('is registered as slideshow-component', () => {
    expect(customElements.get('slideshow-component')).toBe(Slideshow);
  });

  it('hides controls and reveals the only slide when there is a single slide', async () => {
    const el = await mount({ attrs: 'auto-hide-controls', count: 1 });
    expect(el.refs.slideshowControls.hidden).toBe(true);
    expect(el.refs.slides[0].getAttribute('aria-hidden')).toBe('false');
    expect(el.refs.current.textContent).toBe('1');
    expect(slideObserver(el)).toBeUndefined();

    // Without a Scroller, select is a no-op
    await el.select(0);
    expect(el.current).toBe(0);
  });

  it('handles a slideshow with no slides', async () => {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = '<slideshow-component><div ref="scroller"></div></slideshow-component>';
    document.body.appendChild(wrapper);
    await vi.advanceTimersByTimeAsync(20);
    const el = wrapper.firstElementChild;
    expect(el.slides).toBeUndefined();
    expect(el.atStart).toBe(false);
    expect(el.atEnd).toBe(false);
    expect(el.initialSlide).toBeUndefined();
  });

  it('initialises controls for multiple slides', async () => {
    const el = await mount();
    expect(el.current).toBe(0);
    expect(el.refs.current.textContent).toBe('1');
    expect(el.refs.previous.disabled).toBe(true);
    expect(el.refs.next.disabled).toBe(false);
    expect(el.refs.dots.map((d) => d.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false']);
    expect(el.getAttribute('disabled')).toBe('false');
    expect(el.disabled).toBe(false);
    expect(el.isNested).toBe(false);
    expect(el.infinite).toBe(false);
    expect(el.atStart).toBe(true);
    expect(el.atEnd).toBe(false);
    expect(el.initialSlide).toBe(el.refs.slides[0]);
    expect(resizeObservers.some((r) => r.el === el.refs.slideshowContainer)).toBe(true);
  });

  it('keeps the previous button enabled when infinite', async () => {
    const el = await mount({ attrs: 'infinite' });
    expect(el.infinite).toBe(true);
    expect(el.refs.previous.disabled).toBe(false);
  });

  it('auto-hides controls when the scroller does not overflow', async () => {
    const el = await mount({ attrs: 'auto-hide-controls' });
    expect(el.refs.slideshowControls.hidden).toBe(true);

    Object.defineProperty(el.refs.scroller, 'scrollWidth', { configurable: true, value: 500 });
    Object.defineProperty(el.refs.scroller, 'offsetWidth', { configurable: true, value: 200 });
    const { observer } = resizeObservers.find((r) => r.el === el.refs.slideshowContainer);
    await observer.callback([]);
    expect(el.refs.slideshowControls.hidden).toBe(false);
  });

  it('disables a nested slideshow', async () => {
    const outer = await mount();
    const inner = await mount({}, outer.refs.slides[0]);
    expect(inner.isNested).toBe(true);
    expect(inner.disabled).toBe(true);
    expect(outer.isNested).toBe(false);
  });

  it('treats mobile-disabled as disabled on small screens', async () => {
    const el = await mount({ attrs: 'mobile-disabled' });
    expect(el.disabled).toBe(true);
    el.disabled = false;
    expect(el.getAttribute('disabled')).toBe('false');
  });

  it('waits for an in-progress view transition before initialising', async () => {
    let finish;
    viewTransition.current = new Promise((resolve) => (finish = resolve));
    const wrapper = document.createElement('div');
    wrapper.innerHTML = markup();
    document.body.appendChild(wrapper);
    const el = wrapper.querySelector('slideshow-component');

    expect(slideObserver(el)).toBeUndefined();
    finish();
    viewTransition.current = undefined;
    await vi.advanceTimersByTimeAsync(60);
    expect(slideObserver(el)).toBeDefined();
  });

  it('skips initialisation if disconnected during a view transition', async () => {
    let finish;
    viewTransition.current = new Promise((resolve) => (finish = resolve));
    const wrapper = document.createElement('div');
    wrapper.innerHTML = markup();
    document.body.appendChild(wrapper);
    const el = wrapper.querySelector('slideshow-component');
    wrapper.remove();

    finish();
    viewTransition.current = undefined;
    await vi.advanceTimersByTimeAsync(60);
    expect(slideObserver(el)).toBeUndefined();
  });

  it('selects the initial slide from the initial-slide attribute', async () => {
    const el = await mount({ attrs: 'initial-slide="2"' });
    expect(el.initialSlideIndex).toBe(2);
    expect(el.current).toBe(2);
    expect(el.refs.current.textContent).toBe('3');
    expect(el.refs.dots[2].getAttribute('aria-selected')).toBe('true');
  });

  it('re-selects when the initial-slide attribute changes after init', async () => {
    const el = await mount();
    const events = captureSelects(el);
    el.setAttribute('initial-slide', '3');
    await vi.advanceTimersByTimeAsync(0);
    expect(el.current).toBe(3);
    expect(events.at(-1)).toMatchObject({ index: 3, id: 's3', trigger: 'select', userInitiated: false });
    expect(scrollerCalls(el).at(-1).options).toEqual({ top: 300, behavior: 'instant' });

    // Unparsable values fall back to the first slide
    el.setAttribute('initial-slide', 'x');
    await vi.advanceTimersByTimeAsync(0);
    expect(el.current).toBe(0);
  });
});

describe('Slideshow viewport observer', () => {
  it('toggles in-viewport and cleans up on disconnect', async () => {
    const el = await mount();
    const io = viewportObserver();
    expect(io.targets.has(el)).toBe(true);

    io.trigger([{ target: el, isIntersecting: true }]);
    expect(el.hasAttribute('in-viewport')).toBe(true);
    io.trigger([{ target: el, isIntersecting: false }]);
    expect(el.hasAttribute('in-viewport')).toBe(false);

    io.trigger([{ target: el, isIntersecting: true }]);
    el.remove();
    expect(el.hasAttribute('in-viewport')).toBe(false);
    expect(io.targets.has(el)).toBe(false);
    expect(slideObserver(el).targets.size).toBe(0);
  });
});

describe('Slideshow visibility tracking', () => {
  it('updates aria-hidden from intersection entries', async () => {
    const el = await mount();
    makeVisible(el, [0, 1]);
    await vi.advanceTimersByTimeAsync(40);

    expect(el.visibleSlides).toEqual([el.refs.slides[0], el.refs.slides[1]]);
    expect(el.refs.slides.map((s) => s.getAttribute('aria-hidden'))).toEqual(['false', 'false', 'true', 'true']);
    expect(el.nextIndex).toBe(2);
    expect(el.previousIndex).toBe(-2);

    makeVisible(el, [1]);
    await vi.advanceTimersByTimeAsync(40);
    expect(el.visibleSlides).toEqual([el.refs.slides[1]]);
    expect(el.refs.slides[0].getAttribute('aria-hidden')).toBe('true');
  });

  it('refreshes visible slides on resize when several are visible', async () => {
    const el = await mount();
    makeVisible(el, [0, 1]);
    await vi.advanceTimersByTimeAsync(40);
    // Initial rAF has already run with 0 visible slides, so a resize alone does not refresh aria-hidden.
    el.refs.slides[0].setAttribute('aria-hidden', 'true');
    const { observer } = resizeObservers.find((r) => r.el === el.refs.slideshowContainer);
    await observer.callback([]);
    await vi.advanceTimersByTimeAsync(40);
    expect(el.refs.slides[0].getAttribute('aria-hidden')).toBe('true');
  });
});

describe('Slideshow selection', () => {
  it('advances with next() and dispatches a select event', async () => {
    const el = await mount();
    makeVisible(el, [0]);
    const events = captureSelects(el);

    el.next();
    await vi.advanceTimersByTimeAsync(0);

    expect(el.current).toBe(1);
    expect(el.refs.current.textContent).toBe('2');
    expect(el.refs.previous.disabled).toBe(false);
    expect(events).toEqual([
      expect.objectContaining({ index: 1, previousIndex: 0, userInitiated: false, trigger: 'select', id: 's1' }),
    ]);
    expect(scrollerCalls(el).at(-1).options).toEqual({ top: 100, behavior: 'smooth' });
    // Selected thumbnail is centred within its container
    expect(scrollToCalls.some((c) => c.el === el.refs.thumbnailsContainer)).toBe(true);
  });

  it('marks user-initiated selections and prevents the triggering event', async () => {
    const el = await mount();
    makeVisible(el, [0]);
    const events = captureSelects(el);
    const event = new Event('click', { cancelable: true });

    el.next(event);
    await vi.advanceTimersByTimeAsync(0);
    expect(event.defaultPrevented).toBe(true);
    expect(events[0].userInitiated).toBe(true);

    el.previous(new Event('click', { cancelable: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(el.current).toBe(0);
  });

  it('disables next on the last slide', async () => {
    const el = await mount({ count: 2 });
    makeVisible(el, [0]);
    await el.select(1, undefined, { animate: false });
    expect(el.atEnd).toBe(true);
    expect(el.refs.next.disabled).toBe(true);
    expect(scrollerCalls(el).at(-1).options).toEqual({ top: 100, behavior: 'instant' });
  });

  it('clamps out-of-range indexes when not infinite', async () => {
    const el = await mount();
    const events = captureSelects(el);
    await el.select(10);
    expect(el.current).toBe(3);
    await el.select(-5);
    expect(el.current).toBe(0);
    expect(events.map((e) => e.index)).toEqual([3, 0]);
  });

  it('accepts string indexes and ignores invalid input', async () => {
    const el = await mount();
    const events = captureSelects(el);
    await el.select('2', undefined, { animate: false });
    expect(el.current).toBe(2);

    await el.select('abc');
    await el.select({ id: 'missing' });
    await el.select(2);
    expect(events).toHaveLength(1);
  });

  it('selects by id and temporarily reveals hidden slides', async () => {
    const el = await mount({ hidden: [3] });
    expect(el.slides).toHaveLength(3);

    await el.select({ id: 's3' }, undefined, { animate: false });
    const hiddenSlide = el.refs.slides[3];
    expect(hiddenSlide.hasAttribute('reveal')).toBe(true);
    expect(hiddenSlide.getAttribute('aria-hidden')).toBe('false');
    expect(el.slides).toHaveLength(4);
    expect(el.current).toBe(3);

    await el.select(0, undefined, { animate: false });
    expect(hiddenSlide.hasAttribute('reveal')).toBe(false);
    expect(hiddenSlide.getAttribute('aria-hidden')).toBe('true');
    expect(el.current).toBe(0);
  });

  it('loops from the first to the last slide using a placeholder reorder', async () => {
    const el = await mount({ attrs: 'infinite' });
    makeVisible(el, [0]);
    const events = captureSelects(el);
    const { scroller } = el.refs;
    const last = el.refs.slides[3];

    const pending = el.previous();
    await vi.advanceTimersByTimeAsync(0);
    await pending;

    // Target slide sits before the current one while the scroll runs
    expect(scroller.firstElementChild).toBe(last);
    expect(scroller.children).toHaveLength(5);
    expect(events.at(-1)).toMatchObject({ index: 3, previousIndex: 0, id: 's3' });

    // Further selects are ignored while the loop transition is in progress
    await el.select(1);
    expect(events).toHaveLength(1);

    // Finish the smooth scroll: a scroll event followed by the scroll-end debounce
    scroller.dispatchEvent(new Event('scroll'));
    expect(el.hasAttribute('transitioning')).toBe(true);
    await vi.advanceTimersByTimeAsync(60);
    expect(el.hasAttribute('refreshing-timeline')).toBe(true);
    await vi.advanceTimersByTimeAsync(60);

    expect(scroller.lastElementChild).toBe(last);
    expect(scroller.children).toHaveLength(4);
    expect(scroller.querySelectorAll('slideshow-slide:not([slide-id])')).toHaveLength(0);
    expect(el.hasAttribute('refreshing-timeline')).toBe(false);
  });

  it('loops from the last to the first slide', async () => {
    const el = await mount({ attrs: 'infinite initial-slide="3"' });
    makeVisible(el, [3]);
    await vi.advanceTimersByTimeAsync(0);
    expect(el.current).toBe(3);
    const events = captureSelects(el);
    const first = el.refs.slides[0];

    el.next();
    await vi.advanceTimersByTimeAsync(0);
    expect(events.at(-1)).toMatchObject({ index: 0, previousIndex: 3, id: 's0' });
    expect(el.current).toBe(0);

    // The first slide is already at scroll position 0, so no smooth scroll is pending and
    // the DOM is restored straight away.
    expect([...el.refs.scroller.children].map((c) => c.getAttribute('slide-id'))).toEqual(['s0', 's1', 's2', 's3']);
    expect(el.refs.scroller.firstElementChild).toBe(first);
    expect(el.refs.scroller.children).toHaveLength(4);
  });
});

describe('Slideshow scrolling and interaction', () => {
  it('syncs the current slide on user scroll', async () => {
    const el = await mount();
    const events = captureSelects(el);
    makeVisible(el, [2]);

    el.refs.scroller.dispatchEvent(new Event('scroll'));
    expect(el.hasAttribute('transitioning')).toBe(true);
    expect(el.current).toBe(2);
    expect(events[0]).toMatchObject({ index: 2, previousIndex: 0, trigger: 'scroll', userInitiated: true });

    await vi.advanceTimersByTimeAsync(60);
    expect(el.hasAttribute('transitioning')).toBe(false);
    expect(events).toHaveLength(1);
  });

  it('keeps the current index when no slide is visible during a scroll', async () => {
    const el = await mount();
    const events = captureSelects(el);
    el.refs.scroller.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(60);
    expect(el.current).toBe(0);
    expect(events).toHaveLength(0);
  });

  it('pauses on hover, resumes on leave and marks pointer interaction', async () => {
    const el = await mount({ attrs: 'autoplay="1"' });
    makeVisible(el, [0]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(el.current).toBe(1);

    el.dispatchEvent(new Event('mouseenter'));
    makeVisible(el, [1]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(el.current).toBe(1);

    el.dispatchEvent(new Event('mouseleave'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(el.current).toBe(2);

    el.dispatchEvent(new Event('pointerenter'));
    expect(el.hasAttribute('actioned')).toBe(true);
  });

  it('suspends autoplay while the page is hidden', async () => {
    const el = await mount({ attrs: 'autoplay="1"' });
    makeVisible(el, [0]);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(el.current).toBe(0);
    expect(el.paused).toBe(false);

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(el.current).toBe(1);
  });

  function pointer(type, y) {
    return new MouseEvent(type, { clientY: y, bubbles: true, cancelable: true });
  }

  it('drags between slides with the mouse', async () => {
    const el = await mount();
    makeVisible(el, [0]);
    const events = captureSelects(el);
    const down = pointer('mousedown', 300);
    el.refs.slides[0].dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(el.refs.scroller.style.getPropertyValue('scroll-snap-type')).toBe('none');

    vi.advanceTimersByTime(100);
    document.dispatchEvent(pointer('pointermove', 300)); // no movement yet
    expect(el.hasAttribute('dragging')).toBe(false);
    document.dispatchEvent(pointer('pointermove', 250));
    expect(el.hasAttribute('dragging')).toBe(true);
    expect(el.paused).toBe(true);
    expect(Element.prototype.setPointerCapture).toHaveBeenCalled();
    expect(scrollByCalls.at(-1).options).toEqual({ top: 50, behavior: 'instant' });

    // A second mousedown while dragging is ignored
    el.refs.slides[0].dispatchEvent(pointer('mousedown', 250));

    makeVisible(el, [1]);
    document.dispatchEvent(pointer('pointerup', 250));
    expect(el.hasAttribute('dragging')).toBe(false);
    expect(el.current).toBe(1);
    expect(events.at(-1)).toMatchObject({ index: 1, trigger: 'drag', userInitiated: true, id: 's1' });
    expect(Element.prototype.releasePointerCapture).toHaveBeenCalled();

    // Documents current behaviour: the click-suppression listener shares the drag AbortController,
    // which pointerup aborts, so the click that follows a drag is not prevented.
    const click = new MouseEvent('click', { cancelable: true, bubbles: true });
    document.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);

    el.refs.scroller.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(60);
    expect(el.refs.scroller.style.getPropertyValue('scroll-snap-type')).toBe('y mandatory');
  });

  it('flicks to the next slide based on drag velocity', async () => {
    const el = await mount();
    makeVisible(el, [0]);
    el.refs.slides[0].dispatchEvent(pointer('mousedown', 300));
    vi.advanceTimersByTime(10);
    document.dispatchEvent(pointer('pointermove', 280));
    document.dispatchEvent(pointer('pointermove', 260));
    document.dispatchEvent(pointer('pointercancel', 260));
    expect(el.current).toBe(1);
  });

  it('ignores drags on 3D models, when disabled, or with a non-element target', async () => {
    const el = await mount();
    const model = document.createElement('model-viewer');
    el.refs.slides[0].appendChild(model);
    const down = pointer('mousedown', 10);
    model.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);

    el.disabled = true;
    const down2 = pointer('mousedown', 10);
    el.refs.slides[0].dispatchEvent(down2);
    expect(down2.defaultPrevented).toBe(false);

    const text = el.refs.slides[1].firstChild;
    const down3 = pointer('mousedown', 10);
    text.dispatchEvent(down3);
    expect(down3.defaultPrevented).toBe(false);
  });

  it('lets the parent handle drags a nested slideshow cannot perform', async () => {
    const outer = await mount();
    const inner = await mount({}, outer.refs.slides[0]);
    inner.removeAttribute('disabled');
    makeVisible(inner, [0]);

    inner.refs.slides[0].dispatchEvent(pointer('mousedown', 100));
    // Moving "right" (positive direction) at the start: nested slideshow cannot move
    document.dispatchEvent(pointer('pointermove', 150));
    expect(inner.hasAttribute('dragging')).toBe(false);
    // The event bubbles to the outer slideshow, which takes over the drag
    expect(outer.hasAttribute('dragging')).toBe(true);
    expect(scrollByCalls.every((c) => c.el === outer.refs.scroller)).toBe(true);
    document.dispatchEvent(pointer('pointerup', 150));
  });

  it('removes listeners on disconnect', async () => {
    const el = await mount({ attrs: 'autoplay="1"' });
    const scroller = el.refs.scroller;
    el.remove();

    const down = pointer('mousedown', 10);
    scroller.firstElementChild.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);

    el.dispatchEvent(new Event('pointerenter'));
    expect(el.hasAttribute('actioned')).toBe(false);
  });
});
