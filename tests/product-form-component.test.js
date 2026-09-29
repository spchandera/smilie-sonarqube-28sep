import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@theme/component-quantity-selector';
import '@theme/product-form';
import { cartPerformance } from '@theme/performance';
import { ThemeEvents, VariantSelectedEvent, VariantUpdateEvent, CartUpdateEvent } from '@theme/events';

const CART_ADD_URL = '/cart/add.js';

const parse = (html) => new DOMParser().parseFromString(html, 'text/html');

const quantitySelector = ({ value = '1', max = '', cart = '0', min = '1', step = '1' } = {}) => `
  <quantity-selector-component ref="quantitySelector">
    <button ref="minusButton" type="button">-</button>
    <input ref="quantityInput" name="quantity" type="number" value="${value}" min="${min}" step="${step}"
      ${max ? `max="${max}"` : ''} data-cart-quantity="${cart}">
    <button ref="plusButton" type="button">+</button>
  </quantity-selector-component>`;

const addToCart = ({ disabled = false, puppet = false, animation = true, quick = false } = {}) => `
  <add-to-cart-component ref="addToCartButtonContainer" data-add-to-cart-animation="${animation}"
    data-product-variant-media="https://cdn.test/img.jpg">
    <button ref="addToCartButton" type="submit" on:click="/handleClick" class="${quick ? 'quick-add__button' : ''}"
      ${disabled ? 'disabled' : ''} ${puppet ? 'data-puppet="true"' : ''}>
      <span class="add-to-cart-text--added"> Added! </span>
    </button>
  </add-to-cart-component>`;

function mount({ qs = {}, atc = {}, extra = '', buttonsExtra = '', label = '(0 in cart)' } = {}) {
  document.body.innerHTML = `
    <span class="header-actions__cart-icon"></span>
    <cart-items-component data-section-id="cart-drawer"></cart-items-component>
    <div class="shopify-section">
      <div id="picker"></div>
      <product-form-component id="pf" data-product-id="1" data-quantity-default="1"
        data-quantity-error-max="You can only add {{ maximum }}">
        <form id="form-1" on:submit="/handleSubmit">
          <input ref="variantId" type="hidden" name="id" value="11">
          <span ref="quantityLabelCartCount" class="hidden">${label}</span>
          <div class="product-form-buttons" ref="productFormButtons">
            <div ref="quantitySelectorWrapper">${quantitySelector(qs)}</div>
            ${buttonsExtra}
            ${addToCart(atc)}
          </div>
          <div ref="acceleratedCheckoutButtonContainer"></div>
          <p ref="addToCartTextError" class="hidden"><svg></svg><span>!</span></p>
          ${extra}
        </form>
        <div ref="liveRegion" aria-live="polite"></div>
      </product-form-component>
    </div>`;
  const el = document.querySelector('product-form-component');
  return {
    el,
    form: el.querySelector('form'),
    button: el.querySelector('[ref="addToCartButton"]'),
    atc: el.querySelector('add-to-cart-component'),
    error: el.querySelector('[ref="addToCartTextError"]'),
    live: el.querySelector('[ref="liveRegion"]'),
    label: el.querySelector('[ref="quantityLabelCartCount"]'),
    input: el.querySelector('input[name="quantity"]'),
    picker: document.getElementById('picker'),
  };
}

/** Routes fetch calls: add requests get `addResponses` in order, /cart.js gets `cart`. */
function mockFetch({ add = [{ sections: { 'cart-drawer': '<div></div>' } }], cart = { items: [] }, cartFails = false } = {}) {
  const queue = [...add];
  return vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    if (url === '/cart.js') {
      if (cartFails) return Promise.reject(new Error('offline'));
      return Promise.resolve({ json: () => Promise.resolve(cart) });
    }
    const body = queue.length > 1 ? queue.shift() : queue[0];
    return Promise.resolve({ json: () => Promise.resolve(body) });
  });
}

const flush = () => vi.advanceTimersByTimeAsync(0);

function collect(eventName) {
  const events = [];
  const listener = (e) => events.push(e);
  document.addEventListener(eventName, listener);
  return events;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('Theme', { routes: { cart_add_url: CART_ADD_URL }, translations: { added: 'Added to cart' } });
  vi.spyOn(cartPerformance, 'measureFromEvent').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('product-form-component add to cart', () => {
  it('posts the form, announces success and syncs the cart quantity', async () => {
    const fetchSpy = mockFetch({ cart: { items: [{ variant_id: 11, quantity: 3 }] } });
    const { form, live, label, input } = mount();
    const cartEvents = collect(ThemeEvents.cartUpdate);

    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();

    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe(CART_ADD_URL);
    expect(options.method).toBe('POST');
    expect(options.headers).toMatchObject({ Accept: 'text/html', 'X-Requested-With': 'XMLHttpRequest' });
    expect(options.body.get('id')).toBe('11');
    expect(options.body.get('quantity')).toBe('1');
    expect(options.body.getAll('sections')).toEqual(['cart-drawer']);
    expect(fetchSpy).toHaveBeenCalledWith('/cart.js');

    expect(cartEvents).toHaveLength(1);
    expect(cartEvents[0].detail).toMatchObject({
      resource: { items: [{ variant_id: 11, quantity: 3 }] },
      sourceId: '11',
      data: { source: 'product-form-component', itemCount: 1, productId: '1', sections: { 'cart-drawer': '<div></div>' } },
    });

    expect(live.textContent).toBe('Added!');
    expect(label.textContent).toBe('(3 in cart)');
    expect(label.classList.contains('hidden')).toBe(false);
    expect(input.dataset.cartQuantity).toBe('3');
    expect(cartPerformance.measureFromEvent).toHaveBeenCalledWith('add:user-action', expect.any(Event));

    await vi.advanceTimersByTimeAsync(5000);
    expect(live.textContent).toBe('');
  });

  it('falls back to the translated added text and a missing cart', async () => {
    mockFetch({ cartFails: true });
    const { el, button } = mount();
    button.querySelector('.add-to-cart-text--added').remove();
    const cartEvents = collect(ThemeEvents.cartUpdate);

    el.handleSubmit(new Event('submit', { cancelable: true }));
    await flush();

    expect(el.refs.liveRegion.textContent).toBe('Added to cart');
    expect(cartEvents[0].detail.resource).toBeUndefined();
    expect(console.error).toHaveBeenCalledWith('Failed to fetch cart quantity:', expect.any(Error));
  });

  it('shows the server error, dispatches error events and hides the message later', async () => {
    mockFetch({ add: [{ status: 422, message: 'Sold out', description: 'None left', errors: {} }] });
    const { el, error, live } = mount();
    const errors = collect(ThemeEvents.cartError);
    const updates = collect(ThemeEvents.cartUpdate);

    el.handleSubmit(new Event('submit', { cancelable: true }));
    await flush();

    expect(errors[0].detail).toEqual({
      sourceId: 'form-1',
      data: { message: 'Sold out', description: 'None left', errors: {} },
    });
    expect(updates[0].detail.data).toMatchObject({ didError: true, itemCount: 1, productId: '1' });
    expect(error.classList.contains('hidden')).toBe(false);
    expect(error.childNodes[2].textContent).toBe('Sold out');
    expect(live.textContent).toBe('Sold out');

    // A second failure reuses the same text node
    el.handleSubmit(new Event('submit', { cancelable: true }));
    await flush();
    expect(error.childNodes).toHaveLength(3);

    await vi.advanceTimersByTimeAsync(10000);
    expect(error.classList.contains('hidden')).toBe(true);
    expect(live.textContent).toBe('');
  });

  it('refuses to add beyond the maximum and re-enables the buttons after a delay', async () => {
    const fetchSpy = mockFetch();
    const { el, button, error, live } = mount({ qs: { value: '2', max: '3', cart: '2' } });

    el.handleSubmit(new Event('submit', { cancelable: true }));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(button.disabled).toBe(true);
    expect(error.textContent).toContain('You can only add 3');
    expect(live.textContent).toBe('You can only add 3');

    await vi.advanceTimersByTimeAsync(1000);
    expect(button.disabled).toBe(false);
    await vi.advanceTimersByTimeAsync(9000);
    expect(error.classList.contains('hidden')).toBe(true);
    expect(live.textContent).toBe('');
  });

  it('does nothing while an add to cart button is disabled', () => {
    const fetchSpy = mockFetch();
    const { el } = mount({ atc: { disabled: true } });
    el.handleSubmit(new Event('submit', { cancelable: true }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws when the form element is missing', () => {
    mockFetch();
    const { el, form } = mount();
    const container = document.createElement('div');
    container.append(...form.childNodes);
    form.replaceWith(container);
    expect(() => el.handleSubmit(new Event('submit', { cancelable: true }))).toThrow('Product form element missing');
  });

  it('logs network failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));
    const { el } = mount();
    el.handleSubmit(new Event('submit', { cancelable: true }));
    await flush();
    expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ message: 'network' }));
  });
});

describe('product-form-component queued adds during variant changes', () => {
  const variantHtml = parse(`<product-form-component>${addToCart()}</product-form-component>`);

  it('queues submits while the variant changes and sends them as one batch', async () => {
    const fetchSpy = mockFetch({ cart: { items: [{ variant_id: 22, quantity: 2 }] } });
    const { el, picker } = mount();
    const updates = collect(ThemeEvents.cartUpdate);
    const animate = vi.spyOn(el.refs.addToCartButtonContainer, 'animateAddToCart');

    picker.dispatchEvent(new VariantSelectedEvent({ id: 'opt' }));
    window.history.replaceState({}, '', '/products/x?variant=22');
    el.handleSubmit(new Event('submit', { cancelable: true }));
    el.handleSubmit(new Event('submit', { cancelable: true }));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(animate).toHaveBeenCalledTimes(2);

    picker.dispatchEvent(new VariantUpdateEvent({ id: 22, available: true }, 'opt', { html: variantHtml, productId: '1' }));
    await flush();

    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe(CART_ADD_URL);
    expect(options.headers).toEqual({ 'Content-Type': 'application/json', Accept: 'application/json' });
    expect(JSON.parse(options.body)).toEqual({
      items: [
        { id: 22, quantity: 1 },
        { id: 22, quantity: 1 },
      ],
      sections: 'cart-drawer',
    });
    expect(el.refs.variantId.value).toBe('22');
    expect(updates[0].detail).toMatchObject({ sourceId: 'pf', data: { itemCount: 2, source: 'product-form-component' } });
    expect(el.refs.liveRegion.textContent).toBe('Added!');

    window.history.replaceState({}, '', '/');
  });

  it('reports batch errors', async () => {
    mockFetch({ add: [{ status: 422, message: 'Limit reached', description: 'd', errors: {} }] });
    const { el, picker, error } = mount();
    const errors = collect(ThemeEvents.cartError);
    const updates = collect(ThemeEvents.cartUpdate);

    picker.dispatchEvent(new VariantSelectedEvent({ id: 'opt' }));
    el.handleSubmit(new Event('submit', { cancelable: true }));
    picker.dispatchEvent(new VariantUpdateEvent({ id: 11, available: true }, 'opt', { html: variantHtml, productId: '1' }));
    await flush();

    expect(errors[0].detail.sourceId).toBe('pf');
    expect(updates[0].detail.data).toMatchObject({ didError: true, itemCount: 1 });
    expect(error.childNodes[2].textContent).toBe('Limit reached');

    // Second failure reuses the text node
    picker.dispatchEvent(new VariantSelectedEvent({ id: 'opt' }));
    el.handleSubmit(new Event('submit', { cancelable: true }));
    picker.dispatchEvent(new VariantUpdateEvent({ id: 11, available: true }, 'opt', { html: variantHtml, productId: '1' }));
    await flush();
    expect(error.childNodes).toHaveLength(3);

    await vi.advanceTimersByTimeAsync(10000);
    expect(error.classList.contains('hidden')).toBe(true);
  });

  it('logs batch network failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('batch down'));
    const { el, picker } = mount();
    picker.dispatchEvent(new VariantSelectedEvent({ id: 'opt' }));
    el.handleSubmit(new Event('submit', { cancelable: true }));
    picker.dispatchEvent(new VariantUpdateEvent({ id: 11, available: true }, 'opt', { html: variantHtml, productId: '1' }));
    await flush();
    expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ message: 'batch down' }));
  });
});

describe('product-form-component cart sync', () => {
  it('updates the cart quantity from cart update events of other components', async () => {
    const fetchSpy = mockFetch({ cart: { items: [{ variant_id: 11, quantity: 4 }] } });
    const { label, input } = mount();

    document.dispatchEvent(new CartUpdateEvent({ items: [{ variant_id: 11, quantity: 2 }] }, 'drawer'));
    expect(label.textContent).toBe('(2 in cart)');
    expect(input.dataset.cartQuantity).toBe('2');

    document.dispatchEvent(new CartUpdateEvent({ items: [] }, 'drawer'));
    expect(label.classList.contains('hidden')).toBe(true);

    document.dispatchEvent(new CartUpdateEvent({}, 'drawer'));
    await flush();
    expect(fetchSpy).toHaveBeenCalledWith('/cart.js');
    expect(label.textContent).toBe('(4 in cart)');
  });

  it('ignores its own cart events', () => {
    const fetchSpy = mockFetch();
    const { label } = mount();
    document.dispatchEvent(new CartUpdateEvent({ items: [{ variant_id: 11, quantity: 9 }] }, 'pf'));
    document.dispatchEvent(
      new CartUpdateEvent({ items: [{ variant_id: 11, quantity: 9 }] }, 'x', { source: 'product-form-component' })
    );
    expect(label.textContent).toBe('(0 in cart)');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('skips fetching without a variant id and stops listening after disconnect', async () => {
    const fetchSpy = mockFetch();
    const { el } = mount();
    el.refs.variantId.value = '';
    document.dispatchEvent(new CartUpdateEvent({ items: [{ variant_id: 11, quantity: 1 }] }, 'drawer'));
    document.dispatchEvent(new CartUpdateEvent({}, 'drawer'));
    await flush();
    expect(fetchSpy).not.toHaveBeenCalled();

    el.refs.variantId.value = '11';
    el.remove();
    document.dispatchEvent(new CartUpdateEvent({}, 'drawer'));
    await flush();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('product-form-component variant updates', () => {
  const dispatch = (picker, resource, html, data = {}) =>
    picker.dispatchEvent(new VariantUpdateEvent(resource, 'opt', { html: parse(html), productId: '1', ...data }));

  it('ignores updates for other products', () => {
    const { el, picker } = mount();
    dispatch(picker, { id: 99 }, '<div></div>', { productId: '2' });
    expect(el.refs.variantId.value).toBe('11');
  });

  it('disables buttons and hides accelerated checkout for unavailable variants', async () => {
    mockFetch();
    const { el, picker, button } = mount();
    const accelerated = el.refs.acceleratedCheckoutButtonContainer;

    dispatch(
      picker,
      { id: 12, available: false },
      `<product-form-component><button ref="addToCartButton" class="sold-out">Sold out</button></product-form-component>`
    );
    expect(el.refs.variantId.value).toBe('12');
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Sold out');
    expect(accelerated.hasAttribute('hidden')).toBe(true);

    dispatch(picker, { id: 13, available: true, featured_media: { preview_image: { src: 'https://cdn.test/v.jpg?v=1' } } }, '<div></div>');
    expect(button.disabled).toBe(false);
    expect(accelerated.hasAttribute('hidden')).toBe(false);
    expect(el.refs.addToCartButtonContainer.dataset.productVariantMedia).toBe('https://cdn.test/v.jpg?v=1&width=100');
  });

  it('treats a null variant as unavailable and adopts new product ids', () => {
    const { el, picker, button } = mount();
    dispatch(picker, null, '<div></div>', { productId: '5', newProduct: { id: '5', url: '/products/other' } });
    expect(el.dataset.productId).toBe('5');
    expect(el.refs.variantId.value).toBe('');
    expect(button.disabled).toBe(true);
  });

  it('stops when there is no add to cart container', () => {
    const { el, picker } = mount();
    el.querySelector('add-to-cart-component').remove();
    el.updatedCallback();
    const fetchSpy = mockFetch();
    dispatch(picker, { id: 14, available: true }, '<volume-pricing></volume-pricing>');
    expect(el.refs.variantId.value).toBe('14');
    expect(el.querySelector('volume-pricing')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('morphs the whole button area when quantity rules appear and keeps the chosen quantity', async () => {
    const fetchSpy = mockFetch({ cart: { items: [{ variant_id: 15, quantity: 1 }] } });
    const { el, picker, input } = mount({ qs: { value: '4' } });
    input.value = '5';

    dispatch(
      picker,
      { id: 15, available: true },
      `<product-form-component>
        <div class="product-form-buttons">
          <div ref="quantitySelectorWrapper">${quantitySelector({ value: '1', min: '2', step: '2', max: '10' })}</div>
          <div class="quantity-rules" ref="quantityRules">Min 2</div>
          ${addToCart()}
        </div>
      </product-form-component>`
    );
    await flush();

    expect(el.querySelector('.quantity-rules').textContent).toBe('Min 2');
    // 5 snapped down to the step of 2 starting at 2
    expect(el.querySelector('input[name="quantity"]').value).toBe('4');
    expect(el.querySelector('input[name="quantity"]').max).toBe('10');
    expect(fetchSpy).toHaveBeenCalledWith('/cart.js');
  });

  it('updates quantity label, rules, price per item and volume pricing individually', async () => {
    const fetchSpy = mockFetch({ cart: { items: [] } });
    const { el, picker } = mount({
      buttonsExtra: '<div class="quantity-rules" ref="quantityRules">Old rules</div><price-per-item ref="pricePerItem">old</price-per-item>',
      extra: '<label class="quantity-label" ref="quantityLabel">Quantity</label>',
    });
    await flush();

    dispatch(
      picker,
      { id: 16, available: true },
      `<product-form-component>
        ${quantitySelector({ min: '1', step: '1', max: '' })}
        <div class="quantity-rules">New rules</div>
        <price-per-item>new</price-per-item>
        <volume-pricing ref="volumePricing">tiers</volume-pricing>
      </product-form-component>`
    );
    await flush();

    expect(el.querySelector('.quantity-rules').textContent).toBe('New rules');
    expect(el.querySelector('price-per-item').textContent).toBe('new');
    expect(el.querySelector('.quantity-label')).toBeNull();
    const volume = el.querySelector('volume-pricing');
    expect(volume.textContent).toBe('tiers');
    expect(volume.nextElementSibling).toBe(el.querySelector('.product-form-buttons'));
    expect(fetchSpy).toHaveBeenCalledWith('/cart.js');

    // Volume pricing now exists and gets morphed, then removed
    el.updatedCallback();
    dispatch(
      picker,
      { id: 17, available: true },
      `<product-form-component><div class="quantity-rules">R</div><price-per-item>p</price-per-item><volume-pricing ref="volumePricing">more tiers</volume-pricing></product-form-component>`
    );
    expect(el.querySelector('volume-pricing').textContent).toBe('more tiers');

    el.updatedCallback();
    dispatch(
      picker,
      { id: 18, available: true },
      `<product-form-component><div class="quantity-rules">R</div><price-per-item>p</price-per-item></product-form-component>`
    );
    expect(el.querySelector('volume-pricing')).toBeNull();
  });

  it('skips the cart fetch when there are no B2B features', async () => {
    const fetchSpy = mockFetch();
    const { picker } = mount();
    dispatch(picker, { id: 19, available: true }, '<div></div>');
    await flush();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('add-to-cart-component', () => {
  it('animates the button and launches the fly to cart element on click', async () => {
    const { button } = mount();
    button.click();

    const fly = document.querySelector('fly-to-cart');
    expect(fly.classList.contains('fly-to-cart--main')).toBe(true);
    expect(fly.style.getPropertyValue('background-image')).toContain('https://cdn.test/img.jpg');
    expect(fly.source).toBe(button);
    expect(fly.destination).toBe(document.querySelector('.header-actions__cart-icon'));
    expect(button.dataset.added).toBe('true');

    await vi.advanceTimersByTimeAsync(50);
    expect(button.dataset.added).toBe('true');
    await vi.advanceTimersByTimeAsync(800);
    expect(button.dataset.added).toBeUndefined();
  });

  it('uses the quick add class and restarts the reset timer on repeated clicks', async () => {
    const { atc, button } = mount({ atc: { quick: true } });
    button.click();
    expect(document.querySelector('fly-to-cart').classList.contains('fly-to-cart--quick')).toBe(true);
    await vi.advanceTimersByTimeAsync(700);
    atc.animateAddToCart();
    await vi.advanceTimersByTimeAsync(700);
    expect(button.dataset.added).toBe('true');
    await vi.advanceTimersByTimeAsync(200);
    expect(button.dataset.added).toBeUndefined();
  });

  it('skips animation for puppet buttons, disabled animation and invalid forms', () => {
    const { button, form } = mount({ atc: { puppet: true } });
    button.click();
    expect(button.dataset.added).toBeUndefined();

    const second = mount({ atc: { animation: false } });
    second.button.click();
    expect(document.querySelector('fly-to-cart')).toBeNull();
    expect(second.button.dataset.added).toBe('true');

    const third = mount({ extra: '<input required name="engraving">' });
    third.button.click();
    expect(third.button.dataset.added).toBeUndefined();
    expect(form).not.toBe(third.form);
  });

  it('does not animate when the quantity would exceed the maximum', () => {
    const { button } = mount({ qs: { value: '2', max: '2', cart: '1' } });
    button.click();
    expect(button.dataset.added).toBeUndefined();
    expect(document.querySelector('fly-to-cart')).toBeNull();
  });

  it('does not fly inside the quick add modal or without a cart icon', () => {
    const { button, el } = mount();
    const modal = document.createElement('div');
    modal.className = 'quick-add-modal';
    el.before(modal);
    modal.append(el);
    button.click();
    expect(document.querySelector('fly-to-cart')).toBeNull();

    const other = mount();
    document.querySelector('.header-actions__cart-icon').remove();
    other.button.click();
    expect(document.querySelector('fly-to-cart')).toBeNull();
  });

  it('preloads the variant image on hover and clears timers on disconnect', async () => {
    const images = [];
    vi.stubGlobal(
      'Image',
      class {
        set src(value) {
          images.push(value);
        }
      }
    );
    const { atc, button } = mount();
    atc.dispatchEvent(new Event('pointerenter'));
    expect(images).toEqual(['https://cdn.test/img.jpg']);

    delete atc.dataset.productVariantMedia;
    atc.dispatchEvent(new Event('pointerenter'));
    expect(images).toHaveLength(1);

    atc.disable();
    expect(button.disabled).toBe(true);
    atc.enable();
    expect(button.disabled).toBe(false);

    atc.animateAddToCart();
    await vi.advanceTimersByTimeAsync(50);
    atc.remove();
    await vi.advanceTimersByTimeAsync(1000);
    expect(button.dataset.added).toBe('true');
  });
});
