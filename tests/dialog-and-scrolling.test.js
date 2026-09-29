import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DialogOpenEvent, DialogCloseEvent } from '@theme/dialog';
import { Scroller, scrollIntoView } from '@theme/scrolling';
import { PaginatedListAspectRatioHelper } from '@theme/paginated-list-aspect-ratio';

const frame = (cb) => {
  cb(0);
  return 1;
};

/** Gives an element fixed scroll dimensions, since jsdom has no layout engine. */
function setScrollBox(el, dims) {
  for (const [key, value] of Object.entries(dims)) {
    Object.defineProperty(el, key, { configurable: true, writable: true, value });
  }
}

describe('dialog-component', () => {
  let component;
  let dialog;

  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(frame);
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    HTMLDialogElement.prototype.showModal ??= function () {
      this.open = true;
    };
    HTMLDialogElement.prototype.close ??= function () {
      this.open = false;
    };
    document.body.innerHTML = `
      <dialog-component dialog-active-max-width="749">
        <dialog ref="dialog"><button id="inside">x</button></dialog>
      </dialog-component>`;
    component = document.querySelector('dialog-component');
    dialog = component.refs.dialog;
  });

  afterEach(() => {
    component.remove();
    vi.restoreAllMocks();
    document.body.removeAttribute('style');
  });

  it('opens as a modal, locks page scroll and announces it', () => {
    const opened = vi.fn();
    component.addEventListener(DialogOpenEvent.eventName, opened);

    component.showDialog();

    expect(dialog.open).toBe(true);
    expect(document.body.style.position).toBe('fixed');
    expect(opened).toHaveBeenCalledTimes(1);

    component.showDialog();
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it('closes, restores page scroll and announces it', async () => {
    const closed = vi.fn();
    component.addEventListener(DialogCloseEvent.eventName, closed);
    component.showDialog();

    await component.closeDialog();

    expect(dialog.open).toBe(false);
    expect(dialog.classList.contains('dialog-closing')).toBe(false);
    expect(document.body.style.position).toBe('');
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' });
    expect(closed).toHaveBeenCalledTimes(1);

    await component.closeDialog();
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('toggles between open and closed', async () => {
    component.toggleDialog();
    expect(dialog.open).toBe(true);
    component.toggleDialog();
    await vi.waitFor(() => expect(dialog.open).toBe(false));
  });

  it('closes on Escape and ignores other keys', async () => {
    component.showDialog();
    component.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(dialog.open).toBe(true);
    component.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await vi.waitFor(() => expect(dialog.open).toBe(false));
  });

  it('closes when clicking outside the dialog only', async () => {
    component.showDialog();
    document.getElementById('inside').click();
    expect(dialog.open).toBe(true);

    dialog.getBoundingClientRect = () => ({ left: 0, right: 10, top: 0, bottom: 10 });
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 500, clientY: 500 }));
    await vi.waitFor(() => expect(dialog.open).toBe(false));
  });

  it('closes when the viewport leaves the active width range', async () => {
    vi.useFakeTimers();
    component.showDialog();
    window.innerWidth = 1200;
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(60);
    vi.useRealTimers();
    await vi.waitFor(() => expect(dialog.open).toBe(false));
    expect(component.maxWidth).toBe(749);
    expect(component.minWidth).toBe(0);
  });

  it('locks scrolling while a scroll-lock details element is open', () => {
    const details = document.createElement('details');
    details.setAttribute('scroll-lock', '');
    document.body.appendChild(details);

    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    expect(document.documentElement.hasAttribute('scroll-lock')).toBe(true);

    details.open = false;
    details.dispatchEvent(new Event('toggle'));
    expect(document.documentElement.hasAttribute('scroll-lock')).toBe(false);
  });
});

describe('Scroller', () => {
  let el;

  beforeEach(() => {
    el = document.createElement('div');
    setScrollBox(el, { scrollWidth: 1000, clientWidth: 200, scrollHeight: 100, clientHeight: 100, scrollLeft: 0 });
    el.scrollTo = vi.fn(({ left }) => (el.scrollLeft = left));
    el.scrollBy = vi.fn(({ left }) => (el.scrollLeft += left));
    document.body.appendChild(el);
  });

  afterEach(() => {
    vi.useRealTimers();
    el.remove();
  });

  it('detects the scroll axis', () => {
    const scroller = new Scroller(el, { onScroll: vi.fn() });
    expect(scroller.axis).toBe('x');

    setScrollBox(el, { scrollWidth: 100, clientWidth: 100, scrollHeight: 900, clientHeight: 100 });
    expect(scroller.axis).toBe('y');

    setScrollBox(el, { scrollWidth: 500, clientWidth: 100, scrollHeight: 400, clientHeight: 100 });
    expect(scroller.axis).toBe('x');
  });

  it('scrolls to a position smoothly and resolves when the scroll settles', async () => {
    vi.useFakeTimers();
    const onScrollStart = vi.fn();
    const onScrollEnd = vi.fn();
    const onScroll = vi.fn();
    const scroller = new Scroller(el, { onScroll, onScrollStart, onScrollEnd });

    scroller.to(300);
    expect(el.scrollTo).toHaveBeenCalledWith({ left: 300, behavior: 'smooth' });

    el.dispatchEvent(new Event('scroll'));
    expect(onScrollStart).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60);
    await scroller.finished;
    expect(onScrollEnd).toHaveBeenCalledTimes(1);
    // Programmatic scrolls do not trigger the user scroll callback
    expect(onScroll).not.toHaveBeenCalled();
  });

  it('scrolls instantly and to child elements', () => {
    const child = document.createElement('div');
    Object.defineProperty(child, 'offsetLeft', { value: 400 });
    const scroller = new Scroller(el, { onScroll: vi.fn() });

    scroller.to(child, { instant: true });
    expect(el.scrollTo).toHaveBeenCalledWith({ left: 400, behavior: 'instant' });

    el.dispatchEvent(new Event('scroll'));
    scroller.by(50, { instant: true });
    expect(el.scrollBy).toHaveBeenCalledWith({ left: 50, behavior: 'instant' });
  });

  it('skips negligible scrolls', () => {
    const scroller = new Scroller(el, { onScroll: vi.fn() });
    scroller.by(0.5);
    scroller.to(0);
    expect(el.scrollBy).not.toHaveBeenCalled();
    expect(el.scrollTo).not.toHaveBeenCalled();
  });

  it('reports user scrolls to the callback', () => {
    vi.useFakeTimers();
    const onScroll = vi.fn();
    const scroller = new Scroller(el, { onScroll });

    el.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(60);
    expect(onScroll).toHaveBeenCalled();

    // Returning to the same position mid-scroll still ends the scroll
    el.dispatchEvent(new Event('scroll'));
    scroller.to(0);
    vi.advanceTimersByTime(60);

    const calls = onScroll.mock.calls.length;
    scroller.destroy();
    el.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(60);
    expect(onScroll).toHaveBeenCalledTimes(calls);
  });

  it('toggles scroll snapping without reporting a user scroll', () => {
    vi.useFakeTimers();
    const onScroll = vi.fn();
    const scroller = new Scroller(el, { onScroll });

    scroller.snap = false;
    expect(el.style.getPropertyValue('scroll-snap-type')).toBe('none');
    el.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(60);
    expect(onScroll).not.toHaveBeenCalled();

    scroller.snap = true;
    expect(el.style.getPropertyValue('scroll-snap-type')).toBe('x mandatory');
  });
});

describe('scrollIntoView', () => {
  it('defers to the native API without an ancestor', () => {
    const el = document.createElement('div');
    el.scrollIntoView = vi.fn();
    scrollIntoView(el);
    expect(el.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start', inline: 'start' });
  });

  it.each([
    ['start', 'start', 150, 350],
    ['center', 'center', 125, 325],
    ['end', 'end', 100, 300],
    ['nearest', 'nearest', 50, 50],
  ])('aligns within the ancestor (%s)', (block, inline, top, left) => {
    const ancestor = document.createElement('div');
    const el = document.createElement('div');
    setScrollBox(ancestor, {
      scrollHeight: 1000,
      clientHeight: 100,
      scrollWidth: 1000,
      clientWidth: 100,
      scrollTop: 50,
      scrollLeft: 50,
    });
    ancestor.getBoundingClientRect = () => ({ top: 0, left: 0 });
    el.getBoundingClientRect = () => ({ top: 100, left: 300, height: 50, width: 50 });
    ancestor.scrollTo = vi.fn();

    scrollIntoView(el, { ancestor, block, inline, behavior: 'instant' });
    expect(ancestor.scrollTo).toHaveBeenCalledWith({ top, left, behavior: 'instant' });
  });

  it('keeps the current offset on axes that do not scroll', () => {
    const ancestor = document.createElement('div');
    const el = document.createElement('div');
    setScrollBox(ancestor, { scrollHeight: 100, clientHeight: 100, scrollWidth: 100, clientWidth: 100, scrollTop: 7, scrollLeft: 9 });
    ancestor.scrollTo = vi.fn();
    scrollIntoView(el, { ancestor });
    expect(ancestor.scrollTo).toHaveBeenCalledWith({ top: 7, left: 9, behavior: 'smooth' });
  });
});

describe('scroll-hint', () => {
  it('masks the edges based on scroll position', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return null;
    });
    const hint = document.createElement('scroll-hint');
    document.body.appendChild(hint);

    setScrollBox(hint, { scrollWidth: 100, clientWidth: 100, scrollHeight: 100, clientHeight: 100, scrollTop: 0, scrollLeft: 0 });
    hint.dispatchEvent(new Event('scroll'));
    expect(hint.style.maskImage ?? '').toBe('');

    setScrollBox(hint, { scrollHeight: 300, scrollTop: 100 });
    hint.dispatchEvent(new Event('scroll'));
    // "to bottom" is the default direction, so jsdom omits it when serialising
    expect(hint.style.maskImage).toMatch(/^linear-gradient\(transparent 1%, black 10%, black 90%, transparent 100%\)$/);

    setScrollBox(hint, { scrollWidth: 300, scrollLeft: 200 });
    hint.dispatchEvent(new Event('scroll'));
    expect(hint.style.maskImage).toContain('to right');

    hint.remove();
    vi.restoreAllMocks();
  });
});

describe('PaginatedListAspectRatioHelper', () => {
  beforeEach(() => {
    globalThis.Shopify = { designMode: true };
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(frame);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    delete globalThis.Shopify;
  });

  it('does nothing outside the theme editor', () => {
    globalThis.Shopify.designMode = false;
    document.body.innerHTML = '<div class="card-gallery"></div>';
    const tpl = document.createElement('div');
    tpl.dataset.imageRatio = 'square';
    new PaginatedListAspectRatioHelper({ templateCard: tpl }).processNewElements();
    expect(document.querySelector('[data-aspect-ratio-applied]')).toBeNull();
  });

  it.each([
    ['square', '1'],
    ['portrait', '0.8'],
    ['landscape', '1.778'],
  ])('applies the fixed %s ratio to new galleries', (setting, value) => {
    document.body.innerHTML = '<div class="card-gallery"><div class="product-media-container"></div></div>';
    const tpl = document.createElement('div');
    tpl.dataset.imageRatio = setting;
    new PaginatedListAspectRatioHelper({ templateCard: tpl }).processNewElements();

    const gallery = document.querySelector('.card-gallery');
    expect(gallery.style.getPropertyValue('--gallery-aspect-ratio')).toBe(value);
    expect(gallery.dataset.aspectRatioApplied).toBe('true');
    // jsdom serialises a single-number aspect-ratio as "n / 1"
    expect(gallery.querySelector('.product-media-container').style.aspectRatio.startsWith(value)).toBe(true);
  });

  it('ignores unknown or missing ratio settings', () => {
    document.body.innerHTML = '<div class="card-gallery"></div>';
    new PaginatedListAspectRatioHelper({ templateCard: document.createElement('div') }).processNewElements();
    const tpl = document.createElement('div');
    tpl.dataset.imageRatio = 'unknown';
    new PaginatedListAspectRatioHelper({ templateCard: tpl }).processNewElements();
    expect(document.querySelector('[data-aspect-ratio-applied]')).toBeNull();
  });

  it('uses each product image ratio in adaptive mode', () => {
    document.body.innerHTML = `
      <div class="card-gallery" data-product-id="1"><img id="a"></div>
      <div class="card-gallery" data-product-id="1"><img id="b"></div>
      <div class="card-gallery" data-product-id="2"></div>
      <div class="card-gallery" data-product-id="3"><img id="c"></div>`;
    const setImage = (id, w, h, complete = true) => {
      const img = document.getElementById(id);
      Object.defineProperty(img, 'naturalWidth', { configurable: true, value: w });
      Object.defineProperty(img, 'naturalHeight', { configurable: true, value: h });
      Object.defineProperty(img, 'complete', { configurable: true, value: complete });
      return img;
    };
    setImage('a', 400, 200);
    setImage('b', 100, 100);
    const pending = setImage('c', 0, 0, false);

    const tpl = document.createElement('div');
    tpl.dataset.imageRatio = 'adapt';
    new PaginatedListAspectRatioHelper({ templateCard: tpl }).processNewElements();

    const galleries = document.querySelectorAll('.card-gallery');
    expect(galleries[0].style.getPropertyValue('--gallery-aspect-ratio')).toBe('2.000');
    expect(galleries[1].style.getPropertyValue('--gallery-aspect-ratio')).toBe('2.000');
    expect(galleries[2].style.getPropertyValue('--gallery-aspect-ratio')).toBe('1');
    expect(galleries[3].dataset.aspectRatioApplied).toBeUndefined();

    Object.defineProperty(pending, 'naturalWidth', { value: 1000 });
    Object.defineProperty(pending, 'naturalHeight', { value: 10 });
    pending.dispatchEvent(new Event('load'));
    expect(galleries[3].style.getPropertyValue('--gallery-aspect-ratio')).toBe('10.000');
  });
});
