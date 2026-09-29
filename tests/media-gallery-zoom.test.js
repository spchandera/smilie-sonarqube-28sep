import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ZoomDialog } from '@theme/zoom-dialog';
import { MediaGallery } from '@theme/media-gallery';
import { DialogCloseEvent } from '@theme/dialog';
import { ThemeEvents, VariantUpdateEvent, ZoomMediaSelectedEvent } from '@theme/events';

/** Visibility ratios reported by the fake IntersectionObserver, keyed by element. */
let ratios;
/** Images created through `new Image()`. */
let createdImages;

class FakeIntersectionObserver {
  constructor(callback, options) {
    this.callback = callback;
    this.options = options;
    this.targets = [];
  }
  observe(el) {
    if (this.targets.length === 0) {
      queueMicrotask(() =>
        this.callback(this.targets.map((target) => ({ target, intersectionRatio: ratios.get(target) ?? 0 })))
      );
    }
    this.targets.push(el);
  }
  unobserve() {}
  disconnect() {}
}

/** Prototype methods jsdom lacks; installed for the test and removed afterwards. */
const protoStubs = [
  [HTMLDialogElement.prototype, 'showModal', function () {
    this.setAttribute('open', '');
  }],
  [HTMLDialogElement.prototype, 'close', function () {
    this.removeAttribute('open');
  }],
  [Element.prototype, 'scrollIntoView', function () {}],
  [Element.prototype, 'scrollTo', function () {}],
];
let savedProto;

function enableViewTransitions() {
  const transitions = [];
  document.startViewTransition = vi.fn((cb) => {
    cb();
    const transition = { finished: Promise.resolve(), types: new Set() };
    transitions.push(transition);
    return transition;
  });
  return transitions;
}

function mount({ presentation = 'carousel', thumbnails = true } = {}) {
  document.body.innerHTML = `
    <div class="shopify-section">
      <media-gallery data-presentation="${presentation}">
        <div ref="slideshow"></div>
        <ul>
          <li ref="media[]" id="g0" data-focal-point="10% 20%"><img id="g0-img"></li>
          <li ref="media[]" id="g1"><img id="g1-img"></li>
        </ul>
        <zoom-dialog ref="zoomDialogComponent">
          <dialog ref="dialog">
            <div ref="media[]" id="z0" class="product-media-container--image">
              <img class="product-media__image" data_max_resolution="https://cdn.test/hi-0.jpg" alt="First">
            </div>
            <div ref="media[]" id="z1" class="product-media-container--video"></div>
            <div ref="media[]" id="z2" class="product-media-container--image"></div>
            <div ref="thumbnails">${thumbnails ? '<button></button><button></button><button></button>' : ''}</div>
          </dialog>
        </zoom-dialog>
      </media-gallery>
    </div>`;
  const gallery = /** @type {MediaGallery} */ (document.querySelector('media-gallery'));
  const zoom = /** @type {ZoomDialog} */ (document.querySelector('zoom-dialog'));
  // The gallery connects before <zoom-dialog> is upgraded, so re-collect refs now that it owns its children
  gallery.updatedCallback();
  const slideshowEl = gallery.refs.slideshow;
  const slides = [document.createElement('div'), document.createElement('div')];
  slides[0].dataset.focalPoint = '50% 50%';
  Object.assign(slideshowEl, { slides, select: vi.fn() });
  return { gallery, zoom, dialog: zoom.refs.dialog, slides, slideshow: slideshowEl };
}

const pointer = (target) => {
  const event = new MouseEvent('click', { cancelable: true });
  Object.defineProperty(event, 'target', { value: target });
  return event;
};

const selectedStates = (zoom) =>
  [...zoom.refs.thumbnails.querySelectorAll('button')].map((b) => b.getAttribute('aria-selected'));

beforeEach(() => {
  ratios = new Map();
  createdImages = [];
  savedProto = protoStubs.map(([proto, name]) => [proto, name, Object.getOwnPropertyDescriptor(proto, name)]);
  for (const [proto, name, fn] of protoStubs) {
    Object.defineProperty(proto, name, { configurable: true, writable: true, value: fn });
  }
  Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, value: 8 });
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  vi.stubGlobal('Image', function FakeImage() {
    const img = document.createElement('img');
    createdImages.push(img);
    return img;
  });
});

afterEach(() => {
  document.body.innerHTML = '';
  delete document.startViewTransition;
  delete navigator.hardwareConcurrency;
  for (const [proto, name, descriptor] of savedProto) {
    if (descriptor) Object.defineProperty(proto, name, descriptor);
    else delete proto[name];
  }
  document.documentElement.removeAttribute('style');
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('zoom-dialog', () => {
  it('opens as a modal and jumps to the chosen media without view transitions', async () => {
    const { zoom, dialog } = mount();
    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView');
    const event = pointer(document.getElementById('g1-img'));

    await zoom.open(1, event);

    expect(zoom).toBeInstanceOf(ZoomDialog);
    expect(event.defaultPrevented).toBe(true);
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(scrolled.mock.contexts).toEqual([zoom.refs.thumbnails.children[1], document.getElementById('z1')]);
    expect(scrolled).toHaveBeenCalledWith({ behavior: 'instant' });
  });

  it('opens directly on low power devices or when the source is not a gallery item', async () => {
    enableViewTransitions();
    const { zoom, dialog } = mount();

    await zoom.open(0, pointer(null));
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(document.startViewTransition).not.toHaveBeenCalled();

    dialog.removeAttribute('open');
    Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, value: 2 });
    await zoom.open(0, pointer(document.getElementById('g0-img')));
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(document.startViewTransition).not.toHaveBeenCalled();
  });

  it('animates from the gallery item into the dialog with a view transition', async () => {
    enableViewTransitions();
    const { zoom, dialog, slideshow } = mount();
    const source = document.getElementById('g0');
    const target = document.getElementById('z0');
    const during = {};
    document.startViewTransition.mockImplementation((cb) => {
      during.sourceBefore = source.style.getPropertyValue('view-transition-name');
      during.focal = document.documentElement.style.getPropertyValue('--gallery-media-focal-point');
      cb();
      during.sourceAfter = source.style.getPropertyValue('view-transition-name');
      during.target = target.style.getPropertyValue('view-transition-name');
      return { finished: Promise.resolve(), types: new Set() };
    });
    const selected = vi.fn();
    zoom.addEventListener(ThemeEvents.zoomMediaSelected, selected);

    await zoom.open(0, pointer(document.getElementById('g0-img')));

    expect(dialog.hasAttribute('open')).toBe(true);
    expect(during).toEqual({ sourceBefore: 'gallery-item-open', focal: '10% 20%', sourceAfter: '', target: 'gallery-item-open' });
    expect(target.style.getPropertyValue('view-transition-name')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--gallery-media-focal-point')).toBe('');
    expect(selectedStates(zoom)).toEqual(['true', 'false', 'false']);
    expect(selected.mock.calls[0][0].detail).toEqual({ index: 0 });
    // The gallery syncs its slideshow to the zoomed media
    expect(slideshow.select).toHaveBeenCalledWith(0, undefined, { animate: false });
    // The high resolution image is requested for the zoomed media
    expect(createdImages.map((i) => i.src)).toContain('https://cdn.test/hi-0.jpg');
  });

  it('closes immediately and announces it without view transitions', async () => {
    const { zoom, dialog } = mount();
    dialog.setAttribute('open', '');
    const closed = vi.fn();
    window.addEventListener(DialogCloseEvent.eventName, closed, { once: true });

    await zoom.close();

    expect(dialog.hasAttribute('open')).toBe(false);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('closes with a view transition back to the matching carousel slide', async () => {
    enableViewTransitions();
    const { zoom, dialog, slides } = mount();
    dialog.setAttribute('open', '');
    const visible = document.getElementById('z0');
    ratios.set(visible, 0.9);
    const during = {};
    document.startViewTransition.mockImplementation((cb) => {
      during.closedClass = dialog.classList.contains('dialog--closed');
      during.focal = document.documentElement.style.getPropertyValue('--gallery-media-focal-point');
      during.before = visible.style.getPropertyValue('view-transition-name');
      cb();
      during.slide = slides[0].style.getPropertyValue('view-transition-name');
      return { finished: Promise.resolve(), types: new Set() };
    });

    await zoom.close();

    expect(during).toEqual({ closedClass: true, focal: '50% 50%', before: 'gallery-item-close', slide: 'gallery-item-close' });
    expect(dialog.hasAttribute('open')).toBe(false);
    expect(dialog.classList.contains('dialog--closed')).toBe(false);
    expect(slides[0].style.getPropertyValue('view-transition-name')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--gallery-media-focal-point')).toBe('');
  });

  it('uses the grid media when the gallery is not a carousel, and closes directly without a match', async () => {
    const transitions = enableViewTransitions();
    const { zoom, dialog } = mount({ presentation: 'grid' });
    ratios.set(document.getElementById('z1'), 0.6);
    dialog.setAttribute('open', '');

    await zoom.close();
    expect(transitions).toHaveLength(1);
    expect(dialog.hasAttribute('open')).toBe(false);

    // The third zoom item has no gallery counterpart
    ratios.clear();
    ratios.set(document.getElementById('z2'), 1);
    dialog.setAttribute('open', '');
    await zoom.close();
    expect(transitions).toHaveLength(1);
    expect(dialog.hasAttribute('open')).toBe(false);
  });

  it('closes on Escape only', () => {
    const { zoom } = mount();
    const close = vi.spyOn(zoom, 'close').mockResolvedValue(undefined);

    const other = new KeyboardEvent('keydown', { key: 'a', cancelable: true });
    zoom.handleKeyDown(other);
    expect(close).not.toHaveBeenCalled();

    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    zoom.handleKeyDown(escape);
    expect(close).toHaveBeenCalledTimes(1);
    expect(escape.defaultPrevented).toBe(true);
  });

  it('selects thumbnails, scrolls both strips and ignores invalid indexes', async () => {
    const { zoom } = mount();
    const scrollTo = vi.spyOn(Element.prototype, 'scrollTo');
    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView');
    const selected = vi.fn();
    zoom.addEventListener(ThemeEvents.zoomMediaSelected, selected);

    await zoom.handleThumbnailClick(2);
    expect(selectedStates(zoom)).toEqual(['false', 'false', 'true']);
    expect(scrollTo.mock.contexts[0]).toBe(zoom.refs.thumbnails);
    expect(scrollTo.mock.calls[0][0].behavior).toBe('smooth');
    expect(scrolled.mock.contexts).toContain(document.getElementById('z2'));
    expect(selected.mock.calls[0][0]).toBeInstanceOf(ZoomMediaSelectedEvent);

    for (const bad of [-1, 3, Number.NaN]) await zoom.selectThumbnail(bad);
    expect(selected).toHaveBeenCalledTimes(1);

    zoom.refs.thumbnails.innerHTML = '';
    await zoom.selectThumbnail(0);
    expect(selected).toHaveBeenCalledTimes(1);
  });

  it('loads each high resolution image once and swaps it in when ready', () => {
    const { zoom } = mount();
    const container = document.getElementById('z0');
    const original = container.querySelector('img');

    zoom.handleThumbnailPointerEnter(0);
    // One image for the preload, one to swap in
    expect(createdImages).toHaveLength(2);
    const replacement = createdImages[1];
    expect(replacement.src).toBe('https://cdn.test/hi-0.jpg');
    expect(replacement.alt).toBe('First');
    expect(replacement.getAttribute('ref')).toBe('image');
    expect(container.contains(original)).toBe(true);

    replacement.onload();
    expect(container.querySelector('img')).toBe(replacement);
    expect(zoom.loadHighResolutionImage(container)).toBe(false);
    expect(createdImages).toHaveLength(2);
  });

  it('skips high resolution loading for non-images, missing images and missing urls', () => {
    const { zoom } = mount();
    expect(zoom.loadHighResolutionImage(document.getElementById('z1'))).toBe(false);
    expect(zoom.loadHighResolutionImage(document.getElementById('z2'))).toBe(false);
    document.getElementById('z2').innerHTML = '<img class="product-media__image">';
    expect(zoom.loadHighResolutionImage(document.getElementById('z2'))).toBe(false);
    zoom.handleThumbnailPointerEnter(9);
    expect(createdImages).toHaveLength(0);
  });

  it('highlights the thumbnail for the most visible media while scrolling', async () => {
    vi.useFakeTimers();
    const { zoom, dialog } = mount();
    ratios.set(document.getElementById('z1'), 0.7);
    ratios.set(document.getElementById('z0'), 0.2);
    const selected = vi.fn();
    zoom.addEventListener(ThemeEvents.zoomMediaSelected, selected);

    dialog.dispatchEvent(new Event('scroll'));
    dialog.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(50);

    expect(selectedStates(zoom)).toEqual(['false', 'true', 'false']);
    expect(selected).toHaveBeenCalledTimes(1);
    expect(selected.mock.calls[0][0].detail.index).toBe(1);
  });

  it('ignores scroll updates without a matching thumbnail and after disconnect', async () => {
    vi.useFakeTimers();
    const { zoom, dialog } = mount({ thumbnails: false });
    const selected = vi.fn();
    zoom.addEventListener(ThemeEvents.zoomMediaSelected, selected);

    dialog.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(50);
    expect(selected).not.toHaveBeenCalled();

    zoom.remove();
    dialog.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(50);
    expect(selected).not.toHaveBeenCalled();
  });
});

describe('media-gallery', () => {
  it('exposes its slideshow, media and presentation', () => {
    const { gallery, slideshow } = mount({ presentation: 'grid' });
    expect(gallery).toBeInstanceOf(MediaGallery);
    expect(gallery.slideshow).toBe(slideshow);
    expect(gallery.media.map((m) => m.id)).toEqual(['g0', 'g1']);
    expect(gallery.presentation).toBe('grid');
  });

  it('opens the zoom dialog and preloads zoom media on demand', () => {
    const { gallery, zoom } = mount();
    const open = vi.spyOn(zoom, 'open').mockResolvedValue(undefined);
    const load = vi.spyOn(zoom, 'loadHighResolutionImage');
    const event = pointer(null);

    gallery.zoom(1, event);
    expect(open).toHaveBeenCalledWith(1, event);

    gallery.preloadImage(0);
    expect(load).toHaveBeenCalledWith(document.getElementById('z0'));
    gallery.preloadImage(7);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('replaces itself with the gallery from a variant update', () => {
    const { gallery } = mount();
    const section = document.querySelector('.shopify-section');
    const html = new DOMParser().parseFromString('<media-gallery id="next"></media-gallery>', 'text/html');

    section.dispatchEvent(new VariantUpdateEvent({ id: '1' }, 'x', { html: undefined, productId: '1' }));
    section.dispatchEvent(
      new VariantUpdateEvent({ id: '1' }, 'x', { html: new DOMParser().parseFromString('', 'text/html'), productId: '1' })
    );
    expect(gallery.isConnected).toBe(true);

    section.dispatchEvent(new VariantUpdateEvent({ id: '1' }, 'x', { html, productId: '1' }));
    expect(gallery.isConnected).toBe(false);
    expect(section.querySelector('media-gallery').id).toBe('next');
  });

  it('stops listening once disconnected', () => {
    const { gallery, zoom, slideshow } = mount();
    const section = document.querySelector('.shopify-section');
    gallery.remove();

    zoom.dispatchEvent(new ZoomMediaSelectedEvent(1));
    expect(slideshow.select).not.toHaveBeenCalled();

    const html = new DOMParser().parseFromString('<media-gallery id="next"></media-gallery>', 'text/html');
    section.dispatchEvent(new VariantUpdateEvent({ id: '1' }, 'x', { html, productId: '1' }));
    expect(section.querySelector('#next')).toBeNull();
  });
});
