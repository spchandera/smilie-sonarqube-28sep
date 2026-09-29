import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import '@theme/cart-drawer';
import { CartAddEvent } from '@theme/events';
import { mediaQueryLarge } from '@theme/utilities';

const raf = () => new Promise((resolve) => requestAnimationFrame(resolve));
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const dialogProto = HTMLDialogElement.prototype;
const original = { showModal: dialogProto.showModal, close: dialogProto.close };

beforeAll(() => {
  dialogProto.showModal = function () {
    this.setAttribute('open', '');
  };
  dialogProto.close = function () {
    this.removeAttribute('open');
  };
});

afterAll(() => {
  dialogProto.showModal = original.showModal;
  dialogProto.close = original.close;
});

beforeEach(() => {
  vi.stubGlobal('Theme', { translations: { cart_count: 'Cart count' } });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});

afterEach(() => {
  document.body.innerHTML = '';
  document.body.removeAttribute('style');
  history.replaceState(null, '');
  mediaQueryLarge.matches = false;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount({ autoOpen = false, summary = true, liveRegion = true } = {}) {
  document.body.innerHTML = `
    <cart-drawer-component ${autoOpen ? 'auto-open' : ''}>
      <dialog ref="dialog">
        <div class="cart-drawer__content"></div>
        ${summary ? '<div class="cart-drawer__summary"></div>' : ''}
        ${liveRegion ? '<div ref="liveRegion" aria-live="polite"></div>' : ''}
      </dialog>
    </cart-drawer-component>`;
  const el = document.querySelector('cart-drawer-component');
  return { el, dialog: el.refs.dialog };
}

function setHeights(dialog, drawer, summary) {
  dialog.getBoundingClientRect = () => ({ height: drawer });
  dialog.querySelector('.cart-drawer__summary').getBoundingClientRect = () => ({ height: summary });
}

describe('cart-drawer-component', () => {
  it('opens, marks the summary sticky when it is small and pushes a history entry on mobile', async () => {
    const { el, dialog } = mount();
    setHeights(dialog, 800, 200);
    const push = vi.spyOn(history, 'pushState');

    el.open();
    await raf();

    expect(dialog.open).toBe(true);
    expect(document.body.style.position).toBe('fixed');
    expect(dialog.getAttribute('cart-summary-sticky')).toBe('true');
    expect(push).toHaveBeenCalledWith({ cartDrawerOpen: true }, '');
  });

  it('makes the summary non-sticky when it takes more than half the drawer', async () => {
    const { el, dialog } = mount();
    setHeights(dialog, 400, 300);
    el.open();
    await raf();
    expect(dialog.getAttribute('cart-summary-sticky')).toBe('false');
  });

  it('falls back to non-sticky when the summary is missing', async () => {
    const { el, dialog } = mount({ summary: false });
    el.open();
    await raf();
    expect(dialog.getAttribute('cart-summary-sticky')).toBe('false');
  });

  it('does not touch history on desktop', async () => {
    mediaQueryLarge.matches = true;
    const { el, dialog } = mount();
    setHeights(dialog, 800, 100);
    const push = vi.spyOn(history, 'pushState');
    el.open();
    await raf();
    expect(dialog.open).toBe(true);
    expect(push).not.toHaveBeenCalled();
  });

  it('closes and goes back in history when the drawer pushed a state', async () => {
    const { el, dialog } = mount();
    setHeights(dialog, 800, 100);
    el.open();
    await raf();
    const back = vi.spyOn(history, 'back').mockImplementation(() => {});

    el.close();
    await flush();

    expect(dialog.open).toBe(false);
    expect(document.body.style.position).toBe('');
    expect(back).toHaveBeenCalled();
  });

  it('closes without animation when the browser back button pops the state', async () => {
    const { el, dialog } = mount();
    setHeights(dialog, 800, 100);
    el.open();
    await raf();
    const setProperty = vi.spyOn(dialog.style, 'setProperty');
    vi.spyOn(history, 'back').mockImplementation(() => {});

    window.dispatchEvent(new PopStateEvent('popstate'));
    await flush();
    await flush();

    expect(setProperty).toHaveBeenCalledWith('--dialog-drawer-closing-animation', 'none');
    expect(dialog.open).toBe(false);
    expect(dialog.style.getPropertyValue('--dialog-drawer-closing-animation')).toBe('');
  });

  it('auto-opens on cart add and announces the count once open', async () => {
    const { dialog } = mount({ autoOpen: true });
    setHeights(dialog, 800, 100);

    document.dispatchEvent(new CartAddEvent({ item_count: 2 }, 'form'));
    await raf();
    expect(dialog.open).toBe(true);

    document.dispatchEvent(new CartAddEvent({ item_count: 3 }, 'form'));
    expect(document.querySelector('[ref="liveRegion"]').textContent).toBe('Cart count: 3');

    document.dispatchEvent(new CartAddEvent({}, 'form'));
    expect(document.querySelector('[ref="liveRegion"]').textContent).toBe('Cart count: 3');
  });

  it('does not open or announce without auto-open while closed', async () => {
    const { dialog } = mount();
    document.dispatchEvent(new CartAddEvent({ item_count: 1 }, 'form'));
    await raf();
    expect(dialog.open).toBe(false);
    expect(document.querySelector('[ref="liveRegion"]').textContent).toBe('');
  });

  it('clears a stale drawer history state on connect and stops listening once removed', async () => {
    history.replaceState({ cartDrawerOpen: true }, '');
    const { el, dialog } = mount({ autoOpen: true });
    expect(history.state).toBeNull();

    el.remove();
    document.dispatchEvent(new CartAddEvent({ item_count: 1 }, 'form'));
    await raf();
    expect(dialog.open).toBe(false);
  });

  it('closes when the installments CTA is clicked', async () => {
    const { el, dialog } = mount();
    setHeights(dialog, 800, 100);
    const terms = document.createElement('shopify-payment-terms');
    terms.attachShadow({ mode: 'open' }).innerHTML = '<button id="shopify-installments-cta"></button>';
    document.body.append(terms);
    if (!customElements.get('shopify-payment-terms')) {
      customElements.define('shopify-payment-terms', class extends HTMLElement {});
    }
    vi.spyOn(history, 'back').mockImplementation(() => {});

    el.open();
    await raf();
    await flush();
    terms.shadowRoot.querySelector('button').click();
    await flush();
    expect(dialog.open).toBe(false);
  });
});
