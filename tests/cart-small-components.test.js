import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@theme/cart-note';
import '@theme/component-cart-quantity-selector';
import '@theme/local-pickup';
import '@theme/cart-icon';
import { CartUpdateEvent, VariantUpdateEvent } from '@theme/events';
import { cartPerformance } from '@theme/performance';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.stubGlobal('Theme', { routes: { cart_update_url: '/cart/update.js' } });
  vi.spyOn(cartPerformance, 'measureFromEvent').mockImplementation(() => {});
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe('cart-note', () => {
  function mount() {
    document.body.innerHTML = `<cart-note><textarea on:input="/updateCartNote"></textarea></cart-note>`;
    return { el: document.querySelector('cart-note'), textarea: document.querySelector('textarea') };
  }

  it('debounces input and posts the latest note to the cart', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const { textarea } = mount();

    textarea.value = 'Gift';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.value = 'Gift wrap please';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    vi.advanceTimersByTime(199);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('/cart/update.js');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ note: 'Gift wrap please' });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(cartPerformance.measureFromEvent).toHaveBeenCalledWith('note-update:user-action', expect.any(Event));
  });

  it('aborts an in-flight request when a new note arrives and swallows failures', async () => {
    vi.useFakeTimers();
    const signals = [];
    const fetchMock = vi.fn((_url, { signal }) => {
      signals.push(signal);
      return signals.length === 1 ? new Promise(() => {}) : Promise.reject(new Error('offline'));
    });
    vi.stubGlobal('fetch', fetchMock);
    const { el, textarea } = mount();

    textarea.value = 'first';
    el.updateCartNote({ target: textarea });
    await vi.advanceTimersByTimeAsync(200);
    textarea.value = 'second';
    el.updateCartNote({ target: textarea });
    await vi.advanceTimersByTimeAsync(200);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  it('ignores events that do not come from a textarea', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { el } = mount();
    el.updateCartNote({ target: document.createElement('input') });
    await vi.advanceTimersByTimeAsync(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('cart-quantity-selector-component', () => {
  function mount({ value, max = '', cart = '', minusDisabled = false }) {
    document.body.innerHTML = `
      <cart-quantity-selector-component>
        <button ref="minusButton" ${minusDisabled ? 'disabled' : ''}>-</button>
        <input ref="quantityInput" type="number" value="${value}" min="1" ${max ? `max="${max}"` : ''} step="1"
          ${cart ? `data-cart-quantity="${cart}"` : ''}>
        <button ref="plusButton">+</button>
      </cart-quantity-selector-component>`;
    return document.querySelector('cart-quantity-selector-component');
  }

  it('uses the absolute max rather than max minus the cart quantity', () => {
    const el = mount({ value: '3', max: '5', cart: '3' });
    expect(el.getEffectiveMax()).toBe(5);
    el.updateButtonStates();
    expect(el.refs.plusButton.disabled).toBe(false);
    expect(el.refs.minusButton.disabled).toBe(false);
  });

  it('manages button states client-side, ignoring server-disabled state', () => {
    const el = mount({ value: '5', max: '5', minusDisabled: true });
    el.updateButtonStates();
    expect(el.refs.minusButton.disabled).toBe(false);
    expect(el.refs.plusButton.disabled).toBe(true);

    el.refs.quantityInput.value = '1';
    el.updateButtonStates();
    expect(el.refs.minusButton.disabled).toBe(true);
  });

  it('never disables plus when there is no max', () => {
    const el = mount({ value: '99' });
    expect(el.getEffectiveMax()).toBeNull();
    el.updateButtonStates();
    expect(el.refs.plusButton.disabled).toBe(false);
  });
});

describe('local-pickup', () => {
  function mount() {
    document.body.innerHTML = `
      <div class="shopify-section" id="shopify-section-main">
        <local-pickup data-product-url="/products/shirt" data-section-id="main" data-variant-id="1" hidden>
          <p>old</p>
        </local-pickup>
      </div>`;
    return { section: document.querySelector('.shopify-section'), el: document.querySelector('local-pickup') };
  }

  const update = (resource, data = {}) => new VariantUpdateEvent(resource, 'src', { html: null, productId: 'p', ...data });

  it('fetches availability for a new available variant and morphs the result', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        text: () => Promise.resolve('<local-pickup data-variant-id="2"><p>Pickup available at Store</p></local-pickup>'),
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const { section, el } = mount();

    section.dispatchEvent(update({ id: '2', available: true }, { newProduct: { url: '/products/new-shirt' } }));

    expect(el.hasAttribute('hidden')).toBe(false);
    expect(el.dataset.variantId).toBe('2');
    expect(fetchMock.mock.calls[0][0]).toBe('/products/new-shirt?variant=2&section_id=main');
    await flush();
    await flush();
    expect(el.textContent).toContain('Pickup available at Store');
  });

  it('hides itself when the response has no matching block or the request fails', async () => {
    const { section, el } = mount();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ text: () => Promise.resolve('<div></div>') })));
    section.dispatchEvent(update({ id: '3', available: true }));
    expect(el.hasAttribute('hidden')).toBe(false);
    await flush();
    await flush();
    expect(el.hasAttribute('hidden')).toBe(true);

    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network'))));
    section.dispatchEvent(update({ id: '4', available: true }));
    await flush();
    await flush();
    expect(el.hasAttribute('hidden')).toBe(true);
  });

  it('hides for unavailable or missing variants and ignores the current variant', () => {
    const fetchMock = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    const { section, el } = mount();

    el.removeAttribute('hidden');
    section.dispatchEvent(update({ id: '1', available: true }));
    expect(fetchMock).not.toHaveBeenCalled();

    section.dispatchEvent(update({ id: '5', available: false }));
    expect(el.hasAttribute('hidden')).toBe(true);

    el.removeAttribute('hidden');
    section.dispatchEvent(update(null));
    expect(el.hasAttribute('hidden')).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts the previous request and its teardown removes the section listener', async () => {
    const signals = [];
    const fetchMock = vi.fn((_url, { signal }) => {
      signals.push(signal);
      return new Promise(() => {});
    });
    vi.stubGlobal('fetch', fetchMock);
    const { section, el } = mount();

    section.dispatchEvent(update({ id: '6', available: true }));
    section.dispatchEvent(update({ id: '7', available: true }));
    expect(signals[0].aborted).toBe(true);

    // The instance-level disconnectedCallback override is not picked up by the custom element
    // lifecycle (callbacks are read from the prototype at define time), so it is invoked directly.
    el.disconnectedCallback();
    section.dispatchEvent(update({ id: '8', available: true }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('cart-icon', () => {
  function mount(count = '') {
    document.body.innerHTML = `
      <cart-icon>
        <span ref="cartBubble" class="${count ? '' : 'visually-hidden'}">
          <span ref="cartBubbleText"><span ref="cartBubbleCount">${count}</span></span>
        </span>
      </cart-icon>`;
    return document.querySelector('cart-icon');
  }

  it('sets the count from cart updates and persists it to session storage', async () => {
    const el = mount();
    document.dispatchEvent(new CartUpdateEvent({}, 'x', { itemCount: 3, source: 'cart-items-component' }));

    const { cartBubble, cartBubbleCount } = el.refs;
    expect(cartBubbleCount.textContent).toBe('3');
    expect(cartBubbleCount.classList.contains('hidden')).toBe(false);
    expect(cartBubble.classList.contains('visually-hidden')).toBe(false);
    expect(el.classList.contains('header-actions__cart-icon--has-cart')).toBe(true);
    expect(JSON.parse(sessionStorage.getItem('cart-count')).value).toBe('3');

    await new Promise((r) => requestAnimationFrame(r));
    await flush();
    expect(cartBubble.classList.contains('cart-bubble--animating')).toBe(false);
  });

  it('adds to the current count for product form additions and hides for an empty cart', () => {
    const el = mount('2');
    document.dispatchEvent(new CartUpdateEvent({}, 'x', { itemCount: 1, source: 'product-form-component' }));
    expect(el.currentCartCount).toBe(3);

    document.dispatchEvent(new CartUpdateEvent({}, 'x', {}));
    expect(el.refs.cartBubbleCount.classList.contains('hidden')).toBe(true);
    expect(el.refs.cartBubble.classList.contains('visually-hidden')).toBe(true);
    expect(el.classList.contains('header-actions__cart-icon--has-cart')).toBe(false);
  });

  it('blanks the count text at 100 or more', () => {
    const el = mount();
    el.renderCartBubble(120, false, false);
    expect(el.refs.cartBubbleCount.textContent).toBe('');
  });

  it('restores a recent session count on connect and on bfcache page show', () => {
    sessionStorage.setItem('cart-count', JSON.stringify({ value: '4', timestamp: Date.now() }));
    const el = mount('1');
    expect(el.refs.cartBubbleCount.textContent).toBe('4');

    sessionStorage.setItem('cart-count', JSON.stringify({ value: '6', timestamp: Date.now() }));
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }));
    expect(el.refs.cartBubbleCount.textContent).toBe('4');
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    expect(el.refs.cartBubbleCount.textContent).toBe('6');
  });

  it('ignores stale, matching or malformed session data', () => {
    sessionStorage.setItem('cart-count', JSON.stringify({ value: '9', timestamp: Date.now() - 20000 }));
    const el = mount('1');
    expect(el.refs.cartBubbleCount.textContent).toBe('1');

    sessionStorage.setItem('cart-count', JSON.stringify({ value: '1', timestamp: Date.now() }));
    el.ensureCartBubbleIsCorrect();
    expect(el.refs.cartBubbleCount.textContent).toBe('1');

    sessionStorage.setItem('cart-count', '{not json');
    expect(() => el.ensureCartBubbleIsCorrect()).not.toThrow();
    expect(el.refs.cartBubbleCount.textContent).toBe('1');
  });

  it('stops listening once disconnected', () => {
    const el = mount('1');
    el.remove();
    document.dispatchEvent(new CartUpdateEvent({}, 'x', { itemCount: 5 }));
    expect(el.refs.cartBubbleCount.textContent).toBe('1');
  });
});
