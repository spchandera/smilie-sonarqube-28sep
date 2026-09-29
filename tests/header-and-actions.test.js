import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { CartUpdateEvent, ThemeEvents } from '@theme/events';

describe('header.js scrolled state', () => {
  let header;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="header-component"></div>';
    header = document.getElementById('header-component');
    Object.defineProperty(window, 'scrollY', { configurable: true, writable: true, value: 0 });
    await import('@theme/header');
  });

  afterEach(() => {
    window.scrollY = 0;
  });

  it('does not mark the header as scrolled at the top of the page', () => {
    expect(header.classList.contains('is-scrolled')).toBe(false);
  });

  it('toggles is-scrolled as the window scrolls', () => {
    window.scrollY = 120;
    window.dispatchEvent(new Event('scroll'));
    expect(header.classList.contains('is-scrolled')).toBe(true);

    window.scrollY = 0;
    window.dispatchEvent(new Event('scroll'));
    expect(header.classList.contains('is-scrolled')).toBe(false);
  });
});

describe('header-actions', () => {
  let actions;

  beforeAll(async () => {
    await import('@theme/header-actions');
  });

  beforeEach(() => {
    vi.stubGlobal('Theme', { translations: { cart_count: 'Cart count' } });
    document.body.innerHTML = `
      <header-actions>
        <span ref="liveRegion" aria-live="polite"></span>
      </header-actions>`;
    actions = document.querySelector('header-actions');
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('announces the new cart count on cart update', () => {
    document.dispatchEvent(new CartUpdateEvent({ item_count: 3 }, 'test'));
    expect(actions.refs.liveRegion.textContent).toBe('Cart count: 3');
  });

  it('announces a zero count', () => {
    document.dispatchEvent(new CartUpdateEvent({ item_count: 0 }, 'test'));
    expect(actions.refs.liveRegion.textContent).toBe('Cart count: 0');
  });

  it('ignores cart updates without an item count', () => {
    actions.refs.liveRegion.textContent = 'unchanged';
    const event = new Event(ThemeEvents.cartUpdate);
    event.detail = {};
    document.dispatchEvent(event);
    expect(actions.refs.liveRegion.textContent).toBe('unchanged');
  });

  it('stops listening once disconnected', () => {
    const region = actions.refs.liveRegion;
    actions.remove();
    document.dispatchEvent(new CartUpdateEvent({ item_count: 9 }, 'test'));
    expect(region.textContent).toBe('');
  });
});
