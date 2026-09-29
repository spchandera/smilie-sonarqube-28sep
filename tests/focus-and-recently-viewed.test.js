import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { trapFocus, removeTrapFocus, cycleFocus } from '@theme/focus';
import { RecentlyViewed } from '@theme/recently-viewed-products';

describe('RecentlyViewed', () => {
  beforeEach(() => localStorage.clear());

  it('starts empty', () => {
    expect(RecentlyViewed.getProducts()).toEqual([]);
  });

  it('stores the most recent products first, without duplicates, up to four', () => {
    ['1', '2', '3', '4', '5'].forEach((id) => RecentlyViewed.addProduct(id));
    expect(RecentlyViewed.getProducts()).toEqual(['5', '4', '3', '2']);

    RecentlyViewed.addProduct('3');
    expect(RecentlyViewed.getProducts()).toEqual(['3', '5', '4', '2']);
  });

  it('can be cleared', () => {
    RecentlyViewed.addProduct('1');
    RecentlyViewed.clearProducts();
    expect(RecentlyViewed.getProducts()).toEqual([]);
  });
});

describe('focus management', () => {
  let container;
  let outside;

  const tab = (shiftKey = false) => {
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
    document.activeElement.dispatchEvent(event);
    return event;
  };

  beforeEach(() => {
    document.body.innerHTML = `
      <button id="outside">outside</button>
      <div id="dialog" tabindex="-1">
        <button id="first">first</button>
        <input id="hidden" type="hidden">
        <a id="last" href="#">last</a>
      </div>`;
    container = document.getElementById('dialog');
    outside = document.getElementById('outside');
  });

  afterEach(() => {
    removeTrapFocus();
    document.body.innerHTML = '';
  });

  it('moves focus into the container', () => {
    trapFocus(container);
    expect(document.activeElement).toBe(container);
  });

  it('wraps Tab from the last element to the first', () => {
    trapFocus(container);
    document.getElementById('last').focus();
    expect(tab().defaultPrevented).toBe(true);
    expect(document.activeElement.id).toBe('first');
  });

  it('wraps Shift+Tab from the first element or container to the last', () => {
    trapFocus(container);
    expect(tab(true).defaultPrevented).toBe(true);
    expect(document.activeElement.id).toBe('last');

    document.getElementById('first').focus();
    tab(true);
    expect(document.activeElement.id).toBe('last');
  });

  it('leaves other keys and middle positions alone', () => {
    trapFocus(container);
    document.getElementById('first').focus();
    expect(tab().defaultPrevented).toBe(false);
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    document.activeElement.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
  });

  it('pulls focus back when it escapes the container', () => {
    trapFocus(container);
    outside.focus();
    expect(document.activeElement.id).toBe('first');
  });

  it('releases the trap', () => {
    trapFocus(container);
    removeTrapFocus();
    outside.focus();
    expect(document.activeElement).toBe(outside);
  });

  it('does not trap a container with nothing focusable', () => {
    const empty = document.createElement('div');
    document.body.appendChild(empty);
    trapFocus(empty);
    outside.focus();
    expect(document.activeElement).toBe(outside);
  });

  it('cycles focus forwards and backwards with wrapping', () => {
    const items = [...container.querySelectorAll('button, a')];
    items[0].focus();
    cycleFocus(items, 1);
    expect(document.activeElement.id).toBe('last');
    cycleFocus(items, 1);
    expect(document.activeElement.id).toBe('first');
    cycleFocus(items, -1);
    expect(document.activeElement.id).toBe('last');
    expect(() => cycleFocus([], 1)).not.toThrow();
  });
});
