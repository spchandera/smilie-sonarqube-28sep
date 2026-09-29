import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@theme/section-renderer', () => ({
  morphSection: vi.fn(() => Promise.resolve()),
  sectionRenderer: { renderSection: vi.fn(() => Promise.resolve()) },
}));

const { morphSection, sectionRenderer } = await import('@theme/section-renderer');
await import('@theme/cart-discount');
await import('@theme/component-cart-items');
await import('@theme/component-cart-quantity-selector');
const { ThemeEvents, CartUpdateEvent, DiscountUpdateEvent, QuantitySelectorUpdateEvent } = await import('@theme/events');
const { cartPerformance } = await import('@theme/performance');

const flush = async (n = 4) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

function jsonResponse(data) {
  return Promise.resolve({ json: () => Promise.resolve(data), text: () => Promise.resolve(JSON.stringify(data)) });
}

beforeEach(() => {
  vi.stubGlobal('Theme', { routes: { cart_update_url: '/cart/update.js', cart_change_url: '/cart/change.js' } });
  vi.spyOn(cartPerformance, 'measureFromEvent').mockImplementation(() => {});
  vi.spyOn(cartPerformance, 'createStartingMarker').mockImplementation(() => ({ name: 'm:start' }));
  vi.spyOn(cartPerformance, 'measureFromMarker').mockImplementation(() => {});
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  morphSection.mockClear();
  sectionRenderer.renderSection.mockClear();
});

describe('cart-discount-component', () => {
  function mount(existing = []) {
    const pills = existing
      .map((code) => `<li class="cart-discount__pill" data-discount-code="${code}"><button class="remove" on:click="/removeDiscount">x</button></li>`)
      .join('');
    document.body.innerHTML = `
      <cart-discount-component id="discount" data-section-id="cart">
        <form on:submit="/applyDiscount"><input name="discount" value=""><button type="submit">Apply</button></form>
        <ul>${pills}</ul>
        <div ref="cartDiscountError" class="hidden"></div>
        <div ref="cartDiscountErrorDiscountCode" class="hidden"></div>
        <div ref="cartDiscountErrorShipping" class="hidden"></div>
      </cart-discount-component>`;
    const el = document.querySelector('cart-discount-component');
    return { el, form: el.querySelector('form'), input: el.querySelector('input') };
  }

  const submit = (form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  const sectionHtml = (codes) =>
    `<div id="shopify-section-cart">${codes.map((c) => `<li class="cart-discount__pill" data-discount-code="${c}"></li>`).join('')}</div>`;

  it('applies a new code alongside existing ones, dispatches an update and morphs the section', async () => {
    const data = {
      discount_codes: [
        { code: 'OLD', applicable: true },
        { code: 'SAVE10', applicable: true },
      ],
      sections: { cart: sectionHtml(['OLD', 'SAVE10']) },
    };
    const fetchMock = vi.fn(() => jsonResponse(data));
    vi.stubGlobal('fetch', fetchMock);
    const { el, form, input } = mount(['OLD']);
    el.refs.cartDiscountError.classList.remove('hidden');
    const updates = [];
    document.addEventListener(ThemeEvents.discountUpdate, (e) => updates.push(e), { once: true });

    input.value = 'SAVE10';
    submit(form);
    await flush();

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('/cart/update.js');
    expect(JSON.parse(options.body)).toEqual({ discount: 'OLD,SAVE10', sections: ['cart'] });
    expect(el.refs.cartDiscountError.classList.contains('hidden')).toBe(true);
    expect(updates[0].detail).toEqual({ resource: data, sourceId: 'discount' });
    expect(morphSection).toHaveBeenCalledWith('cart', data.sections.cart);
    expect(cartPerformance.measureFromEvent).toHaveBeenCalledWith('discount-update:user-action', expect.anything());
  });

  it('shows the discount code error when the code is not applicable', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ discount_codes: [{ code: 'BAD', applicable: false }], sections: {} })));
    const { el, form, input } = mount();
    input.value = 'BAD';
    submit(form);
    await flush();

    expect(input.value).toBe('');
    expect(el.refs.cartDiscountError.classList.contains('hidden')).toBe(false);
    expect(el.refs.cartDiscountErrorDiscountCode.classList.contains('hidden')).toBe(false);
    expect(el.refs.cartDiscountErrorShipping.classList.contains('hidden')).toBe(true);
    expect(morphSection).not.toHaveBeenCalled();
  });

  it('shows the shipping error when an applicable code does not appear in the rendered pills', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse({ discount_codes: [{ code: 'FREESHIP', applicable: true }], sections: { cart: sectionHtml(['OLD']) } }))
    );
    const { el, form, input } = mount(['OLD']);
    input.value = 'FREESHIP';
    submit(form);
    await flush();

    expect(input.value).toBe('');
    expect(el.refs.cartDiscountErrorShipping.classList.contains('hidden')).toBe(false);
    expect(el.refs.cartDiscountErrorDiscountCode.classList.contains('hidden')).toBe(true);
    expect(morphSection).not.toHaveBeenCalled();
  });

  it('skips codes that are already applied and swallows request failures', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('offline')));
    vi.stubGlobal('fetch', fetchMock);
    const { form, input } = mount(['OLD']);

    input.value = 'OLD';
    submit(form);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();

    input.value = 'NEW';
    submit(form);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(morphSection).not.toHaveBeenCalled();
  });

  it('aborts a pending apply when another starts', async () => {
    const signals = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_u, { signal }) => {
        signals.push(signal);
        return new Promise(() => {});
      })
    );
    const { el, form, input } = mount();
    input.value = 'A';
    submit(form);
    input.value = 'B';
    el.applyDiscount({ preventDefault() {}, stopPropagation() {}, target: form });
    await flush();
    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
  });

  it('removes a discount pill code on click', async () => {
    const data = { discount_codes: [], sections: { cart: '<div id="shopify-section-cart"></div>' } };
    const fetchMock = vi.fn(() => jsonResponse(data));
    vi.stubGlobal('fetch', fetchMock);
    const { el } = mount(['ONE', 'TWO']);
    const updates = [];
    document.addEventListener(ThemeEvents.discountUpdate, (e) => updates.push(e), { once: true });

    el.querySelectorAll('.remove')[0].click();
    await flush();

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ discount: 'TWO', sections: ['cart'] });
    expect(updates).toHaveLength(1);
    expect(morphSection).toHaveBeenCalledWith('cart', data.sections.cart);
  });

  it('ignores removals that are not a mouse event, not on a pill, or for an unknown code', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('fail')));
    vi.stubGlobal('fetch', fetchMock);
    const { el } = mount(['ONE']);
    const base = { preventDefault() {}, stopPropagation() {} };

    await el.removeDiscount(new KeyboardEvent('keydown', { key: 'Escape' }));
    await el.removeDiscount(Object.assign(new MouseEvent('click'), {}));
    const loose = document.createElement('span');
    el.append(loose);
    loose.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await el.removeDiscount({ ...base, target: loose });

    const unknown = document.createElement('li');
    unknown.className = 'cart-discount__pill';
    unknown.dataset.discountCode = 'NOPE';
    const stray = document.createElement('div');
    stray.append(unknown);
    const evt = new MouseEvent('click');
    Object.defineProperty(evt, 'target', { value: unknown });
    await el.removeDiscount(evt);
    expect(fetchMock).not.toHaveBeenCalled();

    const pillButton = el.querySelector('.remove');
    const valid = new MouseEvent('click');
    Object.defineProperty(valid, 'target', { value: pillButton });
    await el.removeDiscount(valid);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(morphSection).not.toHaveBeenCalled();
  });
});

describe('cart-items-component', () => {
  function mount({ drawer = false, rows = 2, nested = false, template = false } = {}) {
    let html = '';
    for (let i = 1; i <= rows; i++) {
      const parent = nested && i === 2 ? 'data-parent-key="k1"' : '';
      html += `
        <tr ref="cartItemRows[]" data-key="k${i}" ${parent}>
          <td>
            <cart-quantity-selector-component ref="quantitySelectors[]" data-variant-id="${100 + i}">
              <button ref="minusButton">-</button>
              <input ref="quantityInput" type="number" value="1" min="0" data-cart-line="${i}" data-cart-quantity="1">
              <button ref="plusButton">+</button>
            </cart-quantity-selector-component>
            <text-component class="line-price">$10</text-component>
            <div ref="cartItemErrorContainer-${i}" class="hidden"><span ref="cartItemError-${i}"></span></div>
          </td>
        </tr>`;
    }
    document.body.innerHTML = `
      ${template ? '<template id="empty-cart-template"><p class="empty">Your cart is empty</p></template>' : ''}
      <cart-items-component id="items" data-section-id="main-cart" ${drawer ? 'data-drawer' : ''}>
        <table><tbody>${html}</tbody></table>
        <text-component ref="cartTotal" shimmer>$20</text-component>
      </cart-items-component>
      <cart-items-component data-section-id="drawer-cart"></cart-items-component>`;
    const el = document.querySelector('#items');
    el.refs.cartTotal.shimmer = vi.fn();
    for (const t of el.querySelectorAll('.line-price')) t.shimmer = vi.fn();
    return el;
  }

  const cartResponse = (count = 3, extra = {}) => ({
    items: [{ variant_id: 101, quantity: 3 }],
    sections: {
      'main-cart': `<div><span ref="cartItemCount">${count}</span></div>`,
      'drawer-cart': '<div></div>',
    },
    ...extra,
  });

  it('posts quantity changes for every cart section and broadcasts the new cart', async () => {
    const data = cartResponse(3);
    const fetchMock = vi.fn(() => jsonResponse(data));
    vi.stubGlobal('fetch', fetchMock);
    const el = mount({ drawer: true });
    document.body.insertAdjacentHTML(
      'beforeend',
      `<quantity-selector-component id="pdp" data-variant-id="101">
        <button ref="minusButton"></button>
        <input ref="quantityInput" type="number" value="1" min="1" data-cart-quantity="1">
        <button ref="plusButton"></button>
      </quantity-selector-component>`
    );
    const productSelector = document.getElementById('pdp');
    vi.spyOn(productSelector, 'updateCartQuantity');
    const events = [];
    el.addEventListener(ThemeEvents.cartUpdate, (e) => events.push(e));

    el.updateQuantity({ line: 1, quantity: 3, action: 'change' });
    expect(el.classList.contains('cart-items-disabled')).toBe(true);
    expect(el.refs.cartTotal.shimmer).toHaveBeenCalled();
    await flush();

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('/cart/change.js');
    expect(JSON.parse(options.body)).toEqual({
      line: 1,
      quantity: 3,
      sections: 'main-cart,drawer-cart',
      sections_url: window.location.pathname,
    });
    expect(el.refs.cartTotal.hasAttribute('shimmer')).toBe(false);
    expect(events[0].detail.data).toEqual({ itemCount: 3, source: 'cart-items-component', sections: data.sections });
    expect(morphSection).toHaveBeenCalledWith('main-cart', data.sections['main-cart'], { mode: 'hydration' });
    expect(productSelector.querySelector("input").dataset.cartQuantity).toBe("3");
    expect(productSelector.updateCartQuantity).toHaveBeenCalled();
    expect(el.classList.contains('cart-items-disabled')).toBe(false);
    expect(cartPerformance.measureFromMarker).toHaveBeenCalled();
  });

  it('uses full morph mode on the cart page and defaults the count to zero', async () => {
    const data = cartResponse(0);
    data.sections['main-cart'] = '<div></div>';
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(data)));
    const el = mount();
    const events = [];
    el.addEventListener(ThemeEvents.cartUpdate, (e) => events.push(e));
    el.updateQuantity({ line: 2, quantity: 2, action: 'change' });
    await flush();
    expect(events[0].detail.data.itemCount).toBe(0);
    expect(morphSection).toHaveBeenCalledWith('main-cart', '<div></div>', { mode: 'full' });
  });

  it('restores the input and shows the line error when the cart rejects the change', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ errors: 'Only 2 left in stock' })));
    const el = mount();
    const input = el.querySelector('input[data-cart-line="2"]');
    input.value = '9';
    el.updateQuantity({ line: 2, quantity: 9, action: 'change' });
    await flush();

    expect(input.value).toBe('1');
    expect(el.refs['cartItemError-2'].textContent).toBe('Only 2 left in stock');
    expect(el.refs['cartItemErrorContainer-2'].classList.contains('hidden')).toBe(false);
    expect(morphSection).not.toHaveBeenCalled();
    expect(el.classList.contains('cart-items-disabled')).toBe(false);
  });

  it('logs and recovers when the request fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    const el = mount();
    el.updateQuantity({ line: 1, quantity: 2, action: 'change' });
    await flush();
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: 'offline' }));
    expect(el.classList.contains('cart-items-disabled')).toBe(false);
  });

  it('debounces quantity selector events from its own lines', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    const el = mount();
    const input = el.querySelector('input[data-cart-line="1"]');

    input.dispatchEvent(new QuantitySelectorUpdateEvent(2, 1));
    input.dispatchEvent(new QuantitySelectorUpdateEvent(4, 1));
    vi.advanceTimersByTime(300);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ line: 1, quantity: 4 });
    expect(el.querySelectorAll('.line-price')[0].shimmer).toHaveBeenCalled();

    // Events from outside the component or without a line are ignored
    document.body.dispatchEvent(new QuantitySelectorUpdateEvent(3, 1));
    input.dispatchEvent(new QuantitySelectorUpdateEvent(3));
    vi.advanceTimersByTime(300);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('removes a line and its nested lines with an animation when quantity reaches zero', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const el = mount({ rows: 3, nested: true });
    const [row1, row2, row3] = el.refs.cartItemRows;

    el.querySelector('input[data-cart-line="1"]').dispatchEvent(new QuantitySelectorUpdateEvent(0, 1));
    vi.advanceTimersByTime(300);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ line: 1, quantity: 0 });
    expect(row1.classList.contains('removing')).toBe(true);
    expect(row2.classList.contains('removing')).toBe(true);
    expect(row1.style.getPropertyValue('--row-height')).toBe('0px');

    vi.useRealTimers();
    await flush();
    expect(row1.isConnected).toBe(false);
    expect(row2.isConnected).toBe(false);
    expect(row3.isConnected).toBe(true);
  });

  it('shows the empty cart template when the last line is removed', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const el = mount({ rows: 1, template: true });
    el.onLineItemRemove(1);
    expect(el.querySelector('.empty').textContent).toBe('Your cart is empty');
    expect(el.querySelector('table')).toBeNull();
  });

  it('does nothing extra when the removed line has no row', () => {
    const fetchMock = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    const el = mount({ rows: 1 });
    el.onLineItemRemove(5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(el.refs.cartItemRows).toHaveLength(1);
  });

  it('reacts to cart updates from other components', () => {
    const el = mount();
    document.querySelector('[data-section-id="drawer-cart"]').remove();
    document.dispatchEvent(new CartUpdateEvent({}, 'other', { sections: { 'main-cart': '<div>new</div>' } }));
    expect(morphSection).toHaveBeenCalledWith('main-cart', '<div>new</div>');

    document.dispatchEvent(new CartUpdateEvent({}, 'other', {}));
    expect(sectionRenderer.renderSection).toHaveBeenCalledWith('main-cart', { cache: false });

    el.dispatchEvent(new CartUpdateEvent({}, 'items', { sections: { 'main-cart': 'x' } }));
    expect(morphSection).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new DiscountUpdateEvent({}, 'discount'));
    expect(sectionRenderer.renderSection).toHaveBeenCalledTimes(2);

    el.remove();
    document.dispatchEvent(new CartUpdateEvent({}, 'other', {}));
    expect(sectionRenderer.renderSection).toHaveBeenCalledTimes(2);
  });

  it('requires a section id', () => {
    document.body.innerHTML = '<cart-items-component></cart-items-component>';
    expect(() => document.querySelector('cart-items-component').sectionId).toThrow('Section id missing');
  });
});
