import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';

function mount(html) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper);
  return wrapper;
}

function defineNavigator(name, value) {
  const original = Object.getOwnPropertyDescriptor(navigator, name);
  Object.defineProperty(navigator, name, { configurable: true, value });
  return () => {
    if (original) Object.defineProperty(navigator, name, original);
    else delete navigator[name];
  };
}

describe('view-transitions', () => {
  class FakeViewTransition {
    types = new Set(['initial']);
    skipTransition = vi.fn();
    finished = Promise.resolve();
  }

  /** @type {Array<() => void>} */
  let restorers = [];

  /**
   * Imports the script fresh, capturing its window listeners instead of registering them.
   * @param {{ reducedMotion?: boolean }} [opts]
   */
  async function load({ reducedMotion = false } = {}) {
    vi.resetModules();
    const handlers = {};
    const realAdd = window.addEventListener.bind(window);
    const spy = vi.spyOn(window, 'addEventListener').mockImplementation((type, fn, opts) => {
      if (type === 'pageswap' || type === 'pagereveal') handlers[type] = fn;
      else realAdd(type, fn, opts);
    });
    const mm = vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: reducedMotion && query.includes('reduce'),
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }));
    await import('../assets/view-transitions.js');
    spy.mockRestore();
    mm.mockRestore();
    return handlers;
  }

  beforeEach(() => {
    restorers = [defineNavigator('hardwareConcurrency', 8), defineNavigator('deviceMemory', 8)];
    vi.stubGlobal('ViewTransition', FakeViewTransition);
    vi.stubGlobal('requestIdleCallback', (cb) => cb());
    sessionStorage.clear();
  });

  afterEach(() => {
    for (const restore of restorers) restore();
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
    sessionStorage.clear();
  });

  it('removes the render blocker after the FCP budget elapses', async () => {
    vi.useFakeTimers();
    mount('<div id="view-transition-render-blocker"></div>');
    await load();
    expect(document.getElementById('view-transition-render-blocker')).not.toBeNull();
    vi.advanceTimersByTime(1800);
    expect(document.getElementById('view-transition-render-blocker')).toBeNull();
  });

  it('removes the render blocker immediately for reduced motion', async () => {
    mount('<div id="view-transition-render-blocker"></div>');
    await load({ reducedMotion: true });
    expect(document.getElementById('view-transition-render-blocker')).toBeNull();
  });

  it('removes the render blocker immediately and skips transitions on low power devices', async () => {
    restorers.push(defineNavigator('hardwareConcurrency', 2));
    mount('<div id="view-transition-render-blocker"></div>');
    const handlers = await load();
    expect(document.getElementById('view-transition-render-blocker')).toBeNull();

    const vt = new FakeViewTransition();
    await handlers.pageswap({ viewTransition: vt });
    await handlers.pagereveal({ viewTransition: vt });
    expect(vt.skipTransition).toHaveBeenCalledTimes(2);
    expect(vt.types.has('initial')).toBe(true);
  });

  it('ignores events without a real view transition', async () => {
    const handlers = await load();
    await expect(handlers.pageswap({ viewTransition: null })).resolves.toBeUndefined();
    await expect(handlers.pagereveal({ viewTransition: { skipTransition: vi.fn() } })).resolves.toBeUndefined();
  });

  it('uses the triggered element transition type on pageswap', async () => {
    const handlers = await load();
    const root = mount(`
      <div class="stale" data-view-transition-type="product-image"></div>
      <a class="trigger" data-view-transition-type="product-image" data-view-transition-triggered></a>`);
    const vt = new FakeViewTransition();
    await handlers.pageswap({ viewTransition: vt });
    expect([...vt.types]).toEqual(['product-image']);
    expect(sessionStorage.getItem('custom-transition-type')).toBe('product-image');
    expect(root.querySelector('.stale').dataset.viewTransitionType).toBeUndefined();
    expect(root.querySelector('.trigger').dataset.viewTransitionType).toBe('product-image');

    // User interaction skips the running transition
    document.dispatchEvent(new Event('pointerdown'));
    expect(vt.skipTransition).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event('keydown'));
    expect(vt.skipTransition).toHaveBeenCalledTimes(2);
  });

  it('falls back to page-navigation on pageswap', async () => {
    const handlers = await load();
    sessionStorage.setItem('custom-transition-type', 'old');
    const vt = new FakeViewTransition();
    await handlers.pageswap({ viewTransition: vt });
    expect([...vt.types]).toEqual(['page-navigation']);
    expect(sessionStorage.getItem('custom-transition-type')).toBeNull();
  });

  it('applies and then clears a stored transition type on pagereveal', async () => {
    const handlers = await load();
    sessionStorage.setItem('custom-transition-type', 'product-image');
    const root = mount('<div data-view-transition-type="product-image"></div>');
    const vt = new FakeViewTransition();
    let resolveFinished;
    vt.finished = new Promise((r) => (resolveFinished = r));

    const pending = handlers.pagereveal({ viewTransition: vt });
    expect([...vt.types]).toEqual(['product-image']);
    resolveFinished();
    await pending;
    expect([...vt.types]).toEqual(['page-navigation']);
    expect(sessionStorage.getItem('custom-transition-type')).toBeNull();
    expect(root.firstElementChild.dataset.viewTransitionType).toBeUndefined();
  });

  it('uses page-navigation on pagereveal without a stored type', async () => {
    const handlers = await load();
    const vt = new FakeViewTransition();
    await handlers.pagereveal({ viewTransition: vt });
    expect([...vt.types]).toEqual(['page-navigation']);
  });
});

describe('custom.js mega menu promos and bundle colours', () => {
  beforeAll(async () => {
    await import('../assets/custom.js');
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const menu = () =>
    mount(`
      <nav>
        <a class="menu-list__link" aria-controls="submenu-1" href="#"><span class="label">Shop</span></a>
        <a class="menu-list__link" aria-controls="missing" href="#">Missing</a>
        <a class="menu-list__link" aria-controls="submenu-2" href="#">No handle</a>
        <a class="plain" href="#">Plain</a>
      </nav>
      <div id="submenu-1" data-menu-handle="Shop">
        <div class="mega-menu-promo-block" data-promo-handle="shop"></div>
        <div class="mega-menu-promo-block is-active" data-handle="other"></div>
        <div class="mega-menu-promo-block is-active"></div>
      </div>
      <div id="submenu-2">
        <div class="mega-menu-promo-block" data-promo-handle="shop"></div>
      </div>`);

  it('activates the promo matching the submenu handle on pointerenter and focus', () => {
    const root = menu();
    const blocks = root.querySelectorAll('#submenu-1 .mega-menu-promo-block');
    root.querySelector('.label').dispatchEvent(new Event('pointerenter'));
    expect([...blocks].map((b) => b.classList.contains('is-active'))).toEqual([true, false, false]);

    blocks[0].classList.remove('is-active');
    root.querySelector('[aria-controls="submenu-1"]').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(blocks[0].classList.contains('is-active')).toBe(true);
  });

  it('ignores links without targets or handles', () => {
    const root = menu();
    const noHandle = root.querySelector('#submenu-2 .mega-menu-promo-block');
    root.querySelector('[aria-controls="missing"]').dispatchEvent(new Event('pointerenter'));
    root.querySelector('[aria-controls="submenu-2"]').dispatchEvent(new Event('pointerenter'));
    root.querySelector('.plain').dispatchEvent(new Event('pointerenter'));
    expect(noHandle.classList.contains('is-active')).toBe(false);
  });

  it('ignores links with an empty aria-controls', () => {
    const root = mount('<a class="menu-list__link" aria-controls="">x</a><div id=""></div>');
    expect(() => root.firstElementChild.dispatchEvent(new Event('pointerenter'))).not.toThrow();
  });

  it('copies the colour scheme background onto bundle selectors on DOMContentLoaded', () => {
    const real = window.getComputedStyle;
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el) =>
      el.classList?.contains('color-scheme-2')
        ? { getPropertyValue: (p) => (p === '--color-background' ? ' #ffeecc ' : '') }
        : real(el)
    );
    const root = mount(`
      <div class="color-scheme-2"><div class="bundle-selector__options" id="in"></div></div>
      <div class="bundle-selector__options" id="out"></div>`);
    document.dispatchEvent(new Event('DOMContentLoaded'));
    expect(root.querySelector('#in').style.getPropertyValue('--color-background')).toBe('#ffeecc');
    expect(root.querySelector('#out').style.getPropertyValue('--color-background')).toBe('');
  });
});

describe('auto-close-details', () => {
  let originalWidth;

  beforeAll(async () => {
    await import('../assets/auto-close-details.js');
  });

  beforeEach(() => {
    originalWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
  });

  afterEach(() => {
    if (originalWidth) Object.defineProperty(window, 'innerWidth', originalWidth);
    document.body.innerHTML = '';
  });

  const setWidth = (value) => Object.defineProperty(window, 'innerWidth', { configurable: true, value });

  const markup = () =>
    mount(`
      <details open data-auto-close-details="desktop" id="desk"><summary>a</summary><p>in desk</p></details>
      <details open data-auto-close-details="mobile" id="mob"><summary>b</summary></details>
      <details open data-auto-close-details="mobile,desktop" id="both"><summary>c</summary></details>
      <details open id="plain"><summary>d</summary></details>
      <button id="outside">x</button>`);

  it('closes desktop details when clicking outside on desktop', () => {
    setWidth(1200);
    const root = markup();
    root.querySelector('#outside').click();
    expect(root.querySelector('#desk').open).toBe(false);
    expect(root.querySelector('#both').open).toBe(false);
    expect(root.querySelector('#mob').open).toBe(true);
    expect(root.querySelector('#plain').open).toBe(true);
  });

  it('closes mobile details on mobile and keeps the clicked one open', () => {
    setWidth(400);
    const root = markup();
    root.querySelector('#outside').click();
    expect(root.querySelector('#mob').open).toBe(false);
    expect(root.querySelector('#both').open).toBe(false);
    expect(root.querySelector('#desk').open).toBe(true);
  });

  it('keeps details open when the click happens inside them', () => {
    setWidth(1200);
    const root = markup();
    root.querySelector('#desk p').click();
    expect(root.querySelector('#desk').open).toBe(true);
    expect(root.querySelector('#both').open).toBe(false);
  });
});
