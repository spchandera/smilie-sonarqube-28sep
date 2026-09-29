import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';

// A controllable media query so the large-breakpoint change handler can be exercised.
const mediaListeners = new Set();
const mediaQuery = {
  matches: false,
  media: '(min-width: 750px)',
  addEventListener: vi.fn((_type, fn) => mediaListeners.add(fn)),
  removeEventListener: vi.fn((_type, fn) => mediaListeners.delete(fn)),
  addListener() {},
  removeListener() {},
};
const originalMatchMedia = globalThis.matchMedia;
const matchMediaStub = (query) => (query === '(min-width: 750px)' ? mediaQuery : originalMatchMedia(query));

vi.stubGlobal('matchMedia', matchMediaStub);
window.matchMedia = matchMediaStub;
vi.stubGlobal('Shopify', { designMode: false });
vi.stubGlobal(
  'IntersectionObserver',
  class {
    observe() {}
    disconnect() {}
  }
);

const { sectionRenderer } = await import('@theme/section-renderer');
await import('@theme/results-list');

afterAll(() => {
  vi.unstubAllGlobals();
  window.matchMedia = originalMatchMedia;
});

const flush = async () => {
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
};

function mount() {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <results-list section-id="main">
      <input type="radio" name="layout" value="default" data-grid-layout="desktop-default-option">
      <input type="radio" name="layout" value="default" data-grid-layout="mobile-option">
      <input type="radio" name="layout" value="zoom-out" id="zoom">
      <ul ref="grid" product-grid-view="default"></ul>
    </results-list>`;
  document.body.appendChild(wrapper);
  return wrapper.firstElementChild;
}

const emit = (matches) => mediaListeners.forEach((fn) => fn({ matches }));

beforeEach(() => {
  vi.spyOn(sectionRenderer, 'getSectionHTML').mockResolvedValue('');
  sessionStorage.clear();
  mediaQuery.matches = false;
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  mediaListeners.clear();
});

describe('ResultsList', () => {
  it('marks itself initialised and listens to the breakpoint', () => {
    const list = mount();
    expect(list.hasAttribute('initialized')).toBe(true);
    expect(mediaListeners.size).toBe(1);

    list.remove();
    expect(mediaListeners.size).toBe(0);
  });

  it('updates the grid layout and remembers it per viewport', async () => {
    const list = mount();
    const zoom = list.querySelector('#zoom');

    list.updateLayout({ target: zoom });
    await flush();
    expect(list.refs.grid.getAttribute('product-grid-view')).toBe('zoom-out');
    expect(sessionStorage.getItem('product-grid-view-mobile')).toBe('zoom-out');

    mediaQuery.matches = true;
    zoom.value = 'mobile-column';
    list.updateLayout({ target: zoom });
    await flush();
    expect(sessionStorage.getItem('product-grid-view-desktop')).toBe('mobile-column');
  });

  it('ignores non-input targets and a missing grid', async () => {
    const list = mount();
    list.updateLayout({ target: document.createElement('div') });
    list.refs.grid.remove();
    list.refs = {};
    list.updateLayout({ target: list.querySelector('#zoom') });
    await flush();
    expect(sessionStorage.length).toBe(0);
  });

  it('resets to the default layout for the new breakpoint', () => {
    const list = mount();
    const grid = list.refs.grid;
    grid.setAttribute('product-grid-view', 'zoom-out');

    emit(true);
    expect(list.querySelector('[data-grid-layout="desktop-default-option"]').checked).toBe(true);
    expect(grid.getAttribute('product-grid-view')).toBe('default');

    grid.setAttribute('product-grid-view', 'zoom-out');
    emit(false);
    expect(list.querySelector('[data-grid-layout="mobile-option"]').checked).toBe(true);
    expect(grid.getAttribute('product-grid-view')).toBe('default');
  });

  it('does nothing on breakpoint change without layout options', () => {
    const list = mount();
    list.querySelectorAll('[data-grid-layout]').forEach((el) => el.remove());
    list.refs.grid.setAttribute('product-grid-view', 'zoom-out');
    emit(true);
    expect(list.refs.grid.getAttribute('product-grid-view')).toBe('zoom-out');
  });
});
