import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';

const ensurePointerEvent = () => {
  if (typeof globalThis.PointerEvent !== 'function') {
    vi.stubGlobal(
      'PointerEvent',
      class PointerEvent extends MouseEvent {
        constructor(type, init = {}) {
          super(type, init);
          this.pointerType = init.pointerType ?? '';
        }
      }
    );
  }
};

const { SlideshowSelectEvent } = await import('@theme/events');
await import('@theme/collection-links');

afterAll(() => {
  vi.unstubAllGlobals();
});

let rafCallbacks;

beforeEach(() => {
  ensurePointerEvent();
  rafCallbacks = [];
  vi.stubGlobal('requestAnimationFrame', (cb) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1000);
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const rect = (left, width, top = 0, height = 50) => ({
  left,
  width,
  right: left + width,
  top,
  height,
  bottom: top + height,
  x: left,
  y: top,
});

function mount({ slideshow = true, images = true } = {}) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <collection-links-component>
      <div ref="container">
        <a href="#" ref="links[]" aria-current="true">One</a>
        <a href="#" ref="links[]" aria-current="false">Two</a>
        <a href="#" ref="links[]" aria-current="false">Three</a>
      </div>
      ${images ? '<img ref="images[]"><img ref="images[]"><img ref="images[]">' : ''}
      ${slideshow ? '<div ref="slideshow"></div>' : ''}
    </collection-links-component>`;
  document.body.appendChild(wrapper);
  const el = wrapper.firstElementChild;
  if (el.refs.slideshow) el.refs.slideshow.select = vi.fn();
  return el;
}

const current = (el) => el.links.map((l) => l.getAttribute('aria-current'));

describe('CollectionLinks', () => {
  it('exposes links and the current index', () => {
    const el = mount();
    expect(el.links).toHaveLength(3);
    expect(el.currentIndex).toBe(0);

    el.refs = { container: el.refs.container };
    expect(el.links).toEqual([]);
    expect(el.currentIndex).toBe(-1);
  });

  it('selects a link, clamping the index, and syncs the slideshow', () => {
    const el = mount();
    el.select(1);
    expect(current(el)).toEqual(['false', 'true', 'false']);
    expect(el.refs.slideshow.select).toHaveBeenCalledWith(1, undefined, { animate: false });

    el.select(10);
    expect(el.currentIndex).toBe(2);

    const noSlideshow = mount({ slideshow: false });
    noSlideshow.select(-3);
    expect(noSlideshow.currentIndex).toBe(0);
  });

  it('cycles focus with the arrow keys', () => {
    const el = mount();
    const [one, two, three] = el.links;
    one.focus();

    const down = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    one.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(two);

    two.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(three);

    three.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    three.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(document.activeElement).toBe(one);

    const other = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    one.dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
  });

  it('follows user-initiated slideshow selections', async () => {
    const el = mount();
    const container = el.refs.container;
    container.scrollTo = vi.fn();
    Object.defineProperty(el.links[2], 'offsetLeft', { value: 300 });
    Object.defineProperty(el.links[2], 'offsetTop', { value: 300 });

    el.dispatchEvent(new SlideshowSelectEvent({ index: 2, userInitiated: false }));
    expect(el.currentIndex).toBe(0);

    el.dispatchEvent(new SlideshowSelectEvent({ index: 0, userInitiated: true }));
    el.dispatchEvent(new SlideshowSelectEvent({ index: 9, userInitiated: true }));
    expect(el.currentIndex).toBe(0);
    expect(container.scrollTo).not.toHaveBeenCalled();

    el.dispatchEvent(new SlideshowSelectEvent({ index: 2, userInitiated: true }));
    expect(el.currentIndex).toBe(2);
    expect(container.scrollTo).toHaveBeenCalledTimes(1);
    expect(el.refs.slideshow.select).not.toHaveBeenCalled();
  });

  it('selects the visible link closest to the centre on scroll', () => {
    vi.useFakeTimers();
    const el = mount();
    const container = el.refs.container;
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(rect(0, 300));
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(rect(0, 300));
    vi.spyOn(el.links[0], 'getBoundingClientRect').mockReturnValue(rect(-200, 100));
    vi.spyOn(el.links[1], 'getBoundingClientRect').mockReturnValue(rect(20, 100));
    vi.spyOn(el.links[2], 'getBoundingClientRect').mockReturnValue(rect(130, 100));

    vi.advanceTimersByTime(100);
    container.dispatchEvent(new Event('scroll'));

    expect(el.currentIndex).toBe(2);
    expect(el.refs.slideshow.select).toHaveBeenCalledWith(2, undefined, { animate: false });
  });

  it('does nothing on scroll when no link is visible', () => {
    vi.useFakeTimers();
    const el = mount();
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(rect(0, 300));
    vi.advanceTimersByTime(100);
    el.refs.container.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(100);
    expect(el.currentIndex).toBe(0);
  });

  it('stops listening to scrolls after disconnecting', () => {
    vi.useFakeTimers();
    const el = mount();
    const container = el.refs.container;
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(rect(0, 300));
    vi.spyOn(el.links[1], 'getBoundingClientRect').mockReturnValue(rect(100, 100));
    el.remove();
    vi.advanceTimersByTime(100);
    container.dispatchEvent(new Event('scroll'));
    expect(el.currentIndex).toBe(0);
  });

  it('clears selections and revealed images', () => {
    const el = mount();
    el.refs.images[1].setAttribute('reveal', '');
    el.clearSelections();
    expect(current(el)).toEqual(['false', 'false', 'false']);
    expect(el.refs.images[1].hasAttribute('reveal')).toBe(false);

    const noImages = mount({ images: false });
    noImages.clearSelections();
    expect(current(noImages)).toEqual(['false', 'false', 'false']);
  });

  it('reveals the hovered image and positions it near the pointer', () => {
    const el = mount();
    const target = el.links[1];
    const [img0, img1] = el.refs.images;
    img0.setAttribute('reveal', '');
    Object.defineProperty(img1, 'offsetHeight', { value: 200 });
    Object.defineProperty(img1, 'offsetWidth', { value: 150 });

    const event = new PointerEvent('pointerenter', { clientX: 100, clientY: 100, pointerType: 'mouse' });
    Object.defineProperty(event, 'target', { value: target });
    el.select(1, event);

    expect(img1.hasAttribute('reveal')).toBe(true);
    expect(img0.hasAttribute('reveal')).toBe(false);
    expect(rafCallbacks).toHaveLength(1);
    rafCallbacks.shift()();
    expect(img1.style.getPropertyValue('--x')).toBe('115px');
    expect(img1.style.getPropertyValue('--y')).toBe('115px');

    // Near the bottom-right edge the image flips above and is clamped horizontally
    target.dispatchEvent(new MouseEvent('mousemove', { clientX: 990, clientY: 700 }));
    target.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 1 }));
    expect(rafCallbacks).toHaveLength(1);
    rafCallbacks.shift()();
    expect(img1.style.getPropertyValue('--x')).toBe('835px');
    expect(img1.style.getPropertyValue('--y')).toBe('485px');

    target.dispatchEvent(new MouseEvent('mousemove', { clientX: 5, clientY: 5 }));
    target.dispatchEvent(new MouseEvent('mouseleave'));
    expect(cancelAnimationFrame).toHaveBeenCalled();
    expect(img1.hasAttribute('reveal')).toBe(false);

    target.dispatchEvent(new MouseEvent('mousemove', { clientX: 5, clientY: 5 }));
    expect(rafCallbacks).toHaveLength(1);
  });

  it('does not reveal images for touch, non-pointer or unmatched targets', () => {
    const el = mount();
    const touch = new PointerEvent('pointerenter', { pointerType: 'touch' });
    Object.defineProperty(touch, 'target', { value: el.links[0] });
    el.select(0, touch);
    el.select(0, new MouseEvent('click'));

    const textTarget = new PointerEvent('pointerenter', { pointerType: 'mouse' });
    Object.defineProperty(textTarget, 'target', { value: document.createTextNode('x') });
    el.select(0, textTarget);

    const outside = new PointerEvent('pointerenter', { pointerType: 'mouse' });
    Object.defineProperty(outside, 'target', { value: document.body });
    el.select(0, outside);

    const leaveEarly = new PointerEvent('pointerenter', { pointerType: 'pen' });
    Object.defineProperty(leaveEarly, 'target', { value: el.links[2] });
    el.select(2, leaveEarly);
    rafCallbacks.shift()();
    el.links[2].dispatchEvent(new MouseEvent('mouseleave'));

    expect(el.refs.images.some((i) => i.hasAttribute('reveal'))).toBe(false);
    expect(cancelAnimationFrame).not.toHaveBeenCalled();
  });
});
