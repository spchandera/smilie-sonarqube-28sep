import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@theme/quick-add', () => {
  class QuickAddComponent extends HTMLElement {
    handleClick = vi.fn();
  }
  customElements.define('quick-add-component', QuickAddComponent);
  return { QuickAddComponent };
});

import { mediaQueryLarge } from '@theme/utilities';
import { ProductHotspotComponent } from '@theme/product-hotspot';

/** @type {Set<Function>} */
let mediaListeners = new Set();
const originalAdd = mediaQueryLarge.addEventListener;
const originalRemove = mediaQueryLarge.removeEventListener;
const originalMatches = mediaQueryLarge.matches;

const rect = (left, top, width, height) => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
  x: left,
  y: top,
});

/**
 * @param {{ container?: object, trigger?: object, dialog?: object, withQuickAdd?: boolean, withLink?: boolean }} [opts]
 */
function mount(opts = {}) {
  const {
    container = rect(0, 0, 1000, 800),
    trigger = rect(100, 100, 20, 20),
    dialog = rect(0, 0, 200, 150),
    withQuickAdd = true,
    withLink = true,
  } = opts;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <product-hotspot-component>
      <button ref="trigger">+</button>
      <dialog ref="dialog">
        ${withLink ? '<a ref="productLink" href="/products/x">Product</a>' : ''}
        <span class="inside">inside</span>
      </dialog>
      ${withQuickAdd ? '<quick-add-component></quick-add-component>' : ''}
    </product-hotspot-component>`;
  wrapper.getBoundingClientRect = () => container;
  document.body.appendChild(wrapper);
  const el = wrapper.querySelector('product-hotspot-component');
  el.refs.trigger.getBoundingClientRect = () => trigger;
  el.refs.dialog.getBoundingClientRect = () => dialog;
  return { el, wrapper, triggerEl: el.refs.trigger, dialogEl: el.refs.dialog };
}

async function open(el) {
  const promise = el.showDialog();
  await vi.advanceTimersByTimeAsync(100);
  await promise;
}

const dialogProto = HTMLDialogElement.prototype;
const originalShow = Object.getOwnPropertyDescriptor(dialogProto, 'show');
const originalClose = Object.getOwnPropertyDescriptor(dialogProto, 'close');

beforeEach(() => {
  Object.defineProperty(dialogProto, 'show', {
    configurable: true,
    writable: true,
    value() {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(dialogProto, 'close', {
    configurable: true,
    writable: true,
    value() {
      this.removeAttribute('open');
    },
  });
  vi.useFakeTimers();
  mediaListeners = new Set();
  mediaQueryLarge.addEventListener = (_t, fn) => mediaListeners.add(fn);
  mediaQueryLarge.removeEventListener = (_t, fn) => mediaListeners.delete(fn);
  mediaQueryLarge.matches = true; // desktop
});

afterEach(() => {
  document.body.innerHTML = '';
  for (const [name, desc] of [
    ['show', originalShow],
    ['close', originalClose],
  ]) {
    if (desc) Object.defineProperty(dialogProto, name, desc);
    else delete dialogProto[name];
  }
  mediaQueryLarge.addEventListener = originalAdd;
  mediaQueryLarge.removeEventListener = originalRemove;
  mediaQueryLarge.matches = originalMatches;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ProductHotspotComponent', () => {
  it('is registered and exposes the product link', () => {
    expect(customElements.get('product-hotspot-component')).toBe(ProductHotspotComponent);
    const { el } = mount();
    expect(el.getHotspotProductLink()?.getAttribute('href')).toBe('/products/x');
    document.body.innerHTML = '';
    expect(mount({ withLink: false }).el.getHotspotProductLink()).toBeNull();
  });

  it('opens on hover after a delay and places the dialog to the right', async () => {
    const { triggerEl, dialogEl } = mount();
    triggerEl.dispatchEvent(new Event('pointerenter'));
    expect(dialogEl.open).toBe(false);
    await vi.advanceTimersByTimeAsync(120);
    await vi.advanceTimersByTimeAsync(100);
    expect(dialogEl.open).toBe(true);
    expect(dialogEl.dataset.showing).toBe('true');
    expect(dialogEl.dataset.placement).toBe('right,bottom');
    expect(dialogEl.style.getPropertyValue('--dialog-vertical-offset')).toBe('');

    // Hovering again while open does nothing
    triggerEl.dispatchEvent(new Event('pointerenter'));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels the hover timer when leaving before it opens', async () => {
    const { el, triggerEl, dialogEl } = mount();
    triggerEl.dispatchEvent(new Event('pointerenter'));
    expect(el.timer).not.toBeNull();
    triggerEl.dispatchEvent(new Event('pointerleave'));
    expect(el.timer).toBeNull();
    await vi.advanceTimersByTimeAsync(500);
    expect(dialogEl.open).toBe(false);
  });

  it('closes when leaving the trigger to somewhere other than the dialog', async () => {
    const { el, triggerEl, dialogEl } = mount();
    triggerEl.dispatchEvent(new Event('pointerenter'));
    await vi.advanceTimersByTimeAsync(220);
    expect(dialogEl.open).toBe(true);

    // Moving into the dialog keeps it open
    const toDialog = new MouseEvent('pointerleave', { relatedTarget: dialogEl.querySelector('.inside') });
    triggerEl.dispatchEvent(toDialog);
    expect(dialogEl.open).toBe(true);

    // Leaving the dialog back to the trigger keeps it open
    dialogEl.dispatchEvent(new MouseEvent('pointerleave', { relatedTarget: triggerEl }));
    expect(dialogEl.open).toBe(true);

    // Leaving the dialog elsewhere closes
    dialogEl.dispatchEvent(new MouseEvent('pointerleave', { relatedTarget: document.body }));
    expect(dialogEl.open).toBe(false);
    expect(dialogEl.dataset.closing).toBe('true');
    await vi.advanceTimersByTimeAsync(0);
    expect(dialogEl.dataset.showing).toBeUndefined();
    expect(dialogEl.dataset.closing).toBeUndefined();
    expect(dialogEl.dataset.placement).toBeUndefined();
    expect(el.timer).toBeNull();
  });

  it('closes when leaving the trigger to the page', async () => {
    const { triggerEl, dialogEl } = mount();
    // The trigger pointerleave listener is attached on pointerenter
    triggerEl.dispatchEvent(new Event('pointerenter'));
    await vi.advanceTimersByTimeAsync(220);
    expect(dialogEl.open).toBe(true);
    triggerEl.dispatchEvent(new MouseEvent('pointerleave', { relatedTarget: document.body }));
    expect(dialogEl.open).toBe(false);
  });

  it('places the dialog to the left when there is no room on the right', async () => {
    const { el, dialogEl } = mount({ trigger: rect(900, 100, 20, 20) });
    await open(el);
    expect(dialogEl.dataset.placement).toBe('left,bottom');
  });

  it('centres the dialog below or above when neither side fits', async () => {
    const narrow = mount({ container: rect(0, 0, 300, 800), trigger: rect(140, 100, 20, 20) });
    await open(narrow.el);
    expect(narrow.dialogEl.dataset.placement).toBe('center,bottom');
    document.body.innerHTML = '';

    const above = mount({ container: rect(0, 0, 300, 800), trigger: rect(140, 700, 20, 20) });
    await open(above.el);
    expect(above.dialogEl.dataset.placement).toBe('center,top');
    document.body.innerHTML = '';

    const tightTop = mount({ container: rect(0, 0, 300, 200), trigger: rect(140, 20, 20, 20) });
    await open(tightTop.el);
    expect(tightTop.dialogEl.dataset.placement).toBe('center,bottom');
    document.body.innerHTML = '';

    const tightBottom = mount({ container: rect(0, 0, 300, 200), trigger: rect(140, 150, 20, 20) });
    await open(tightBottom.el);
    expect(tightBottom.dialogEl.dataset.placement).toBe('center,top');
  });

  it('applies vertical offsets for side placement near container edges', async () => {
    // Near top edge: bottom placement pushed down
    const top = mount({ trigger: rect(100, 2, 20, 20) });
    await open(top.el);
    expect(top.dialogEl.dataset.placement).toBe('right,bottom');
    expect(top.dialogEl.style.getPropertyValue('--dialog-vertical-offset')).toBe('8px');
    document.body.innerHTML = '';

    // Near bottom edge: top placement, fits without offset
    const bottom = mount({ trigger: rect(100, 700, 20, 20) });
    await open(bottom.el);
    expect(bottom.dialogEl.dataset.placement).toBe('right,top');
    expect(bottom.dialogEl.style.getPropertyValue('--dialog-vertical-offset')).toBe('');
    document.body.innerHTML = '';

    // Tall dialog in short container overflowing the top when bottom-aligned
    const tall = mount({ container: rect(0, 0, 1000, 200), trigger: rect(100, 60, 20, 20), dialog: rect(0, 0, 200, 190) });
    await open(tall.el);
    expect(tall.dialogEl.dataset.placement).toBe('right,top');
    expect(tall.dialogEl.style.getPropertyValue('--dialog-vertical-offset')).toBe('120px');
    document.body.innerHTML = '';

    // Trigger extending past the bottom limit
    const past = mount({ container: rect(0, 0, 1000, 200), trigger: rect(100, 150, 20, 45), dialog: rect(0, 0, 200, 100) });
    await open(past.el);
    expect(past.dialogEl.dataset.placement).toBe('right,top');
    expect(past.dialogEl.style.getPropertyValue('--dialog-vertical-offset')).toBe('-5px');
  });

  it('opens quick add on mobile click instead of the dialog', () => {
    mediaQueryLarge.matches = false;
    const { el, dialogEl } = mount();
    const event = new MouseEvent('click', { cancelable: true, bubbles: true });
    el.handleHotspotClick(event);
    expect(event.defaultPrevented).toBe(true);
    expect(el.querySelector('quick-add-component').handleClick).toHaveBeenCalledTimes(1);
    expect(dialogEl.open).toBe(false);
  });

  it('does nothing on mobile click without a quick add component', () => {
    mediaQueryLarge.matches = false;
    const { el } = mount({ withQuickAdd: false });
    const event = new MouseEvent('click', { cancelable: true });
    expect(() => el.handleHotspotClick(event)).not.toThrow();
    expect(event.defaultPrevented).toBe(true);
  });

  it('opens the dialog on desktop click', async () => {
    const { el, dialogEl } = mount();
    el.handleHotspotClick(new MouseEvent('click'));
    await vi.advanceTimersByTimeAsync(100);
    expect(dialogEl.open).toBe(true);
  });

  it('light dismisses on outside click and Escape', async () => {
    const { el, dialogEl } = mount();
    await open(el);
    dialogEl.querySelector('.inside').click();
    expect(dialogEl.open).toBe(true);
    document.body.click();
    expect(dialogEl.open).toBe(false);

    await open(el);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(dialogEl.open).toBe(true);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(dialogEl.open).toBe(false);

    await open(el);
    // keyup while focus is outside the dialog closes
    document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'Tab' }));
    expect(dialogEl.open).toBe(false);
  });

  it('removes hover listeners on mobile breakpoint and restores on desktop', async () => {
    const { el, triggerEl, dialogEl } = mount();
    triggerEl.dispatchEvent(new Event('pointerenter'));
    expect(el.timer).not.toBeNull();
    const [handler] = mediaListeners;

    mediaQueryLarge.matches = false;
    handler();
    expect(el.timer).toBeNull();
    triggerEl.dispatchEvent(new Event('pointerenter'));
    expect(el.timer).toBeNull();

    mediaQueryLarge.matches = true;
    handler();
    triggerEl.dispatchEvent(new Event('pointerenter'));
    await vi.advanceTimersByTimeAsync(220);
    expect(dialogEl.open).toBe(true);
  });

  it('cleans up on disconnect', () => {
    const { el, triggerEl } = mount();
    triggerEl.dispatchEvent(new Event('pointerenter'));
    el.remove();
    expect(mediaListeners.size).toBe(0);
    expect(el.timer).toBeNull();
  });

  it('skips placement when detached from a parent', async () => {
    const { el, dialogEl } = mount();
    vi.spyOn(el, 'parentElement', 'get').mockReturnValue(null);
    await el.showDialog();
    expect(dialogEl.open).toBe(true);
    expect(dialogEl.dataset.placement).toBeUndefined();
  });
});
