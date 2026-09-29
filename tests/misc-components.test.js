import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mediaQueryLarge } from '@theme/utilities';
import { sectionRenderer } from '@theme/section-renderer';
import PaginatedList from '@theme/paginated-list';
import '@theme/accordion-custom';
import ProductTitle from '@theme/product-title-truncation';
import '@theme/qr-code-image';
import '@theme/copy-to-clipboard';
import { VideoBackgroundComponent } from '@theme/video-background';
import '@theme/rte-formatter';
import BlogPostsList from '@theme/blog-posts-list';
import { hydrate } from '@theme/section-hydration';
import { cartPerformance } from '@theme/performance';

function mount(html) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper);
  return wrapper;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('accordion-custom', () => {
  /** @type {Set<Function>} */
  let listeners;
  const originalAdd = mediaQueryLarge.addEventListener;
  const originalMatches = mediaQueryLarge.matches;

  beforeEach(() => {
    listeners = new Set();
    mediaQueryLarge.addEventListener = (_t, fn, opts) => {
      listeners.add(fn);
      opts?.signal?.addEventListener('abort', () => listeners.delete(fn));
    };
  });

  afterEach(() => {
    mediaQueryLarge.addEventListener = originalAdd;
    mediaQueryLarge.matches = originalMatches;
  });

  const html = (attrs = '') =>
    `<accordion-custom ${attrs}><details><summary>Title</summary><p>Body</p></details></accordion-custom>`;

  it('opens by default according to the breakpoint attributes', () => {
    mediaQueryLarge.matches = false; // mobile
    const mobile = mount(html('open-by-default-on-mobile')).querySelector('details');
    expect(mobile.open).toBe(true);

    mediaQueryLarge.matches = true; // desktop
    const desktop = mount(html('open-by-default-on-mobile')).querySelector('details');
    expect(desktop.open).toBe(false);
    const desktopOpen = mount(html('open-by-default-on-desktop')).querySelector('details');
    expect(desktopOpen.open).toBe(true);
  });

  it('re-evaluates the open state when the media query changes', () => {
    mediaQueryLarge.matches = true;
    const details = mount(html('open-by-default-on-desktop')).querySelector('details');
    expect(details.open).toBe(true);
    mediaQueryLarge.matches = false;
    for (const fn of listeners) fn();
    expect(details.open).toBe(false);
  });

  it('prevents toggling when disabled for the current breakpoint', () => {
    mediaQueryLarge.matches = false;
    const root = mount(html('data-disable-on-mobile="true"'));
    const summary = root.querySelector('summary');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    summary.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);

    mediaQueryLarge.matches = true;
    const desktop = mount(html('data-disable-on-desktop="true"')).querySelector('summary');
    const e2 = new MouseEvent('click', { bubbles: true, cancelable: true });
    desktop.dispatchEvent(e2);
    expect(e2.defaultPrevented).toBe(true);

    const enabled = mount(html('data-disable-on-mobile="true"')).querySelector('summary');
    const e3 = new MouseEvent('click', { bubbles: true, cancelable: true });
    enabled.dispatchEvent(e3);
    expect(e3.defaultPrevented).toBe(false);
  });

  it('closes on Escape only when configured', () => {
    mediaQueryLarge.matches = true;
    const root = mount(html('data-close-with-escape="true" open-by-default-on-desktop'));
    const details = root.querySelector('details');
    const summary = root.querySelector('summary');
    root.querySelector('p').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(details.open).toBe(true);
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    root.querySelector('p').dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(true);
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(summary);

    const other = mount(html('open-by-default-on-desktop'));
    other.querySelector('p').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(other.querySelector('details').open).toBe(true);
  });

  it('removes listeners on disconnect', () => {
    const root = mount(html());
    expect(listeners.size).toBe(1);
    root.querySelector('accordion-custom').remove();
    expect(listeners.size).toBe(0);
  });

  it('throws when the details or summary element is missing', () => {
    const Accordion = customElements.get('accordion-custom');
    const noDetails = new Accordion();
    expect(() => noDetails.details).toThrow('Details element not found');
    const noSummary = new Accordion();
    noSummary.appendChild(document.createElement('details'));
    expect(() => noSummary.summary).toThrow('Summary element not found');
  });
});

describe('product-title-truncation', () => {
  function stubStyles() {
    const real = window.getComputedStyle;
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el) =>
      el.tagName === 'PRODUCT-TITLE' ? { lineHeight: '20px', paddingTop: '5px', paddingBottom: '5px' } : real(el)
    );
  }

  it('clamps the text to the lines that fit', () => {
    stubStyles();
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(70);
    const root = mount('<product-title><span ref="text">A long product title</span></product-title>');
    const text = root.querySelector('span');
    expect(text.style.overflow).toBe('hidden');
    expect(text.style.textOverflow).toBe('ellipsis');
    expect(text.style.display).toBe('-webkit-box');
    expect(text.style.webkitLineClamp).toBe('3');
    const observer = root.querySelector('product-title').resizeObserver;
    expect(observer).toBeInstanceOf(ResizeObserver);

    // Resizing recalculates the clamp
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(30);
    observer.callback([]);
    expect(text.style.webkitLineClamp).toBe('1');
  });

  it('falls back to .title-text and at least one line', () => {
    stubStyles();
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(0);
    const root = mount('<product-title><span class="title-text">Title</span></product-title>');
    expect(root.querySelector('.title-text').style.webkitLineClamp).toBe('1');
  });

  it('skips empty titles and disconnects the observer', () => {
    const root = mount('<product-title></product-title>');
    const el = root.querySelector('product-title');
    expect(el.style.overflow).toBe('');
    const disconnect = vi.spyOn(el.resizeObserver, 'disconnect');
    el.remove();
    expect(disconnect).toHaveBeenCalled();
  });

  it('uses a resize listener when ResizeObserver is unavailable', () => {
    stubStyles();
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(50);
    const saved = window.ResizeObserver;
    delete window.ResizeObserver;
    const savedGlobal = globalThis.ResizeObserver;
    delete globalThis.ResizeObserver;
    const addSpy = vi.spyOn(window, 'addEventListener');
    try {
      const el = new ProductTitle();
      el.textContent = 'Title';
      document.body.appendChild(el);
      expect(el.resizeObserver).toBeUndefined();
      expect(addSpy).toHaveBeenCalledWith('resize', expect.any(Function));
      expect(el.style.webkitLineClamp).toBe('2');
      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(90);
      window.dispatchEvent(new Event('resize'));
      expect(el.style.webkitLineClamp).toBe('4');
      el.remove();
    } finally {
      window.ResizeObserver = saved;
      globalThis.ResizeObserver = savedGlobal;
    }
  });
});

describe('qr-code-image', () => {
  it('renders a QR code with attributes', () => {
    const root = mount('<qr-code-image width="100" height="90" alt="Scan me" data-identifier="GIFT-123"></qr-code-image>');
    const el = root.querySelector('qr-code-image');
    expect(el.qrCode._htOption).toMatchObject({ text: 'GIFT-123', width: 100, height: 90, alt: 'Scan me' });
    expect(el.children.length).toBeGreaterThan(0);
    expect(el.title).toBe('GIFT-123');
  });

  it('falls back to default dimensions', () => {
    const root = mount('<qr-code-image width="abc" data-identifier="X"></qr-code-image>');
    expect(root.querySelector('qr-code-image').qrCode._htOption).toMatchObject({ width: 72, height: 72, alt: '' });
  });
});

describe('copy-to-clipboard-component', () => {
  let writeText;
  let original;

  beforeEach(() => {
    writeText = vi.fn();
    original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  });

  afterEach(() => {
    if (original) Object.defineProperty(navigator, 'clipboard', original);
    else delete navigator.clipboard;
  });

  it('copies the text and reveals the success message', () => {
    const root = mount(
      '<copy-to-clipboard-component text-to-copy="CODE10"><span ref="copySuccessMessage" class="visually-hidden">Copied</span></copy-to-clipboard-component>'
    );
    const el = root.querySelector('copy-to-clipboard-component');
    el.copyToClipboard();
    expect(writeText).toHaveBeenCalledWith('CODE10');
    expect(el.querySelector('span').classList.contains('visually-hidden')).toBe(false);
  });

  it('copies without a success message and ignores empty text', () => {
    const root = mount(
      '<copy-to-clipboard-component text-to-copy="A"></copy-to-clipboard-component><copy-to-clipboard-component></copy-to-clipboard-component>'
    );
    const [withText, empty] = root.querySelectorAll('copy-to-clipboard-component');
    withText.copyToClipboard();
    empty.copyToClipboard();
    expect(writeText).toHaveBeenCalledTimes(1);
  });
});

describe('video-background-component', () => {
  it('moves data-video-source into src and loads the video', () => {
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    const root = mount(`
      <video-background-component>
        <video ref="videoElement">
          <source ref="videoSources[]" data-video-source="/a.mp4">
          <source ref="videoSources[]">
        </video>
      </video-background-component>`);
    const [a, b] = root.querySelectorAll('source');
    expect(a.getAttribute('src')).toBe('/a.mp4');
    expect(b.hasAttribute('src')).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
    expect(root.querySelector('video-background-component')).toBeInstanceOf(VideoBackgroundComponent);
  });
});

describe('rte-formatter', () => {
  it('wraps tables for styling', () => {
    const root = mount('<rte-formatter><table><tr><td>1</td></tr></table><p>x</p><table></table></rte-formatter>');
    const wrappers = root.querySelectorAll('.rte-table-wrapper');
    expect(wrappers).toHaveLength(2);
    for (const w of wrappers) expect(w.firstElementChild.tagName).toBe('TABLE');
    expect(root.querySelector('rte-formatter > p')).not.toBeNull();
  });
});

describe('blog-posts-list', () => {
  it('registers a PaginatedList subclass', () => {
    expect(customElements.get('blog-posts-list')).toBe(BlogPostsList);
    expect(Object.getPrototypeOf(BlogPostsList)).toBe(PaginatedList);
  });
});

describe('section-hydration', () => {
  const tick = () => new Promise((r) => setTimeout(r, 5));

  it('renders the section once and marks it hydrated', async () => {
    const render = vi.spyOn(sectionRenderer, 'renderSection').mockResolvedValue(undefined);
    mount('<div id="shopify-section-main"></div>');
    const url = new URL('https://example.com/products/x');
    hydrate('shopify-section-main', url);
    await tick();
    expect(render).toHaveBeenCalledWith('main', { cache: false, url, mode: 'hydration' });
    expect(document.getElementById('shopify-section-main').dataset.hydrated).toBe('true');

    hydrate('main');
    await tick();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('skips missing sections', async () => {
    const render = vi.spyOn(sectionRenderer, 'renderSection').mockResolvedValue(undefined);
    hydrate('missing');
    await tick();
    expect(render).not.toHaveBeenCalled();
  });
});

describe('performance', () => {
  it('creates markers and measures between them', () => {
    const mark = vi.fn((name) => ({ name }));
    const measure = vi.fn();
    vi.stubGlobal('performance', { mark, measure, now: () => 0 });

    const start = cartPerformance.createStartingMarker('add');
    expect(start.name).toBe('cart-performance:add:start');

    cartPerformance.measureFromMarker(start);
    expect(mark).toHaveBeenLastCalledWith('cart-performance:add:end');
    expect(measure).toHaveBeenLastCalledWith(
      'cart-performance:add',
      'cart-performance:add:start',
      'cart-performance:add:end'
    );

    cartPerformance.measureFromEvent('click', { timeStamp: 42 });
    expect(mark).toHaveBeenCalledWith('cart-performance:click:start', { startTime: 42 });
    expect(measure).toHaveBeenLastCalledWith(
      'cart-performance:click',
      'cart-performance:click:start',
      'cart-performance:click:end'
    );

    const cb = vi.fn();
    cartPerformance.measure('update', cb);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(measure).toHaveBeenLastCalledWith(
      'update',
      'cart-performance:update:start',
      'cart-performance:update:end'
    );
  });
});
