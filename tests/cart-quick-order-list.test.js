import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@theme/section-renderer', () => ({
  morphSection: vi.fn(() => Promise.resolve()),
  sectionRenderer: { renderSection: vi.fn(() => Promise.resolve()) },
}));

const { morphSection, sectionRenderer } = await import('@theme/section-renderer');
await import('@theme/quick-order-list');
const { ThemeEvents, CartUpdateEvent, QuantitySelectorUpdateEvent } = await import('@theme/events');

const flush = async (n = 4) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};
const clickEvent = () => ({ preventDefault: vi.fn(), target: null });

function jsonResponse(data) {
  return Promise.resolve({ text: () => Promise.resolve(JSON.stringify(data)) });
}

beforeEach(() => {
  vi.stubGlobal('Theme', {
    routes: { cart_update_url: '/cart/update.js' },
    translations: { items_added_to_cart_one: 'One added', items_added_to_cart_other: '{{ count }} added' },
  });
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  morphSection.mockClear();
  sectionRenderer.renderSection.mockClear();
});

function row(id, cartQty, line) {
  return `
    <tr ref="variantRows[]" data-variant-id="${id}">
      <td><input type="number" value="${cartQty}" data-cart-quantity="${cartQty}" data-cart-line="${line}"></td>
      <td><text-component class="variant-item__total-price">$0</text-component></td>
    </tr>`;
}

function mount({ cartIds = [1, 2], page = '', url = '/collections/all' } = {}) {
  document.body.innerHTML = `
    <quick-order-list-component id="qol" data-section-id="qol-section" data-url="${url}"
      data-cart-variant-ids='${JSON.stringify(cartIds)}'>
      <table><tbody>${row(1, 0, 1)}${row(2, 2, 2)}</tbody></table>
      <div ref="totalInfo"><text-component ref="totalPrice" shimmer>$40</text-component></div>
      <div ref="confirmationPanel" class="hidden"></div>
      <div ref="errorContainer" class="hidden"><span ref="errorText"></span></div>
      <div ref="successContainer" class="hidden"><span ref="successText"></span></div>
      ${page ? `<nav ref="paginationNav" data-current_page="${page}"></nav>` : ''}
    </quick-order-list-component>
    <cart-items-component data-section-id="cart-drawer"></cart-items-component>`;
  const el = document.getElementById('qol');
  for (const t of el.querySelectorAll('text-component')) t.shimmer = vi.fn();
  return { el, inputs: [...el.querySelectorAll('input')] };
}

describe('quick-order-list-component', () => {
  it('reads the current page and cart variant ids from data attributes', () => {
    expect(mount({ page: '3' }).el.currentPage).toBe(3);
    expect(mount({ page: 'abc' }).el.currentPage).toBe(1);
    const { el } = mount();
    expect(el.currentPage).toBe(1);
    expect(el.cartVariantIds).toEqual([1, 2]);
    delete el.dataset.cartVariantIds;
    expect(el.cartVariantIds).toEqual([]);
  });

  it('debounces quantity updates and posts them with every cart section', async () => {
    vi.useFakeTimers();
    const data = { sections: { 'qol-section': '<div>updated</div>' } };
    let respond;
    const fetchMock = vi.fn(() => new Promise((resolve) => (respond = resolve)));
    vi.stubGlobal('fetch', fetchMock);
    const { el, inputs } = mount({ page: '2' });
    const added = [];
    document.addEventListener(ThemeEvents.cartUpdate, (e) => added.push(e), { once: true });

    inputs[0].dispatchEvent(new QuantitySelectorUpdateEvent(1, 1));
    inputs[0].dispatchEvent(new QuantitySelectorUpdateEvent(3, 1));
    await vi.advanceTimersByTimeAsync(300);
    expect(el.classList.contains('quick-order-list-disabled')).toBe(true);
    respond({ text: () => Promise.resolve(JSON.stringify(data)) });
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('/cart/update.js');
    expect(JSON.parse(options.body)).toEqual({
      updates: { 1: 3 },
      sections: 'qol-section,cart-drawer',
      sections_url: `${window.location.pathname}?page=2`,
    });
    expect(el.querySelector('.variant-item__total-price').shimmer).toHaveBeenCalled();
    expect(el.refs.totalInfo.querySelector('text-component').shimmer).toHaveBeenCalled();
    // The component also receives its own CartAddEvent (the self-check reads detail.source rather
    // than detail.data.source), which re-enables the list and morphs the section a second time.
    expect(el.classList.contains('quick-order-list-disabled')).toBe(false);
    expect(morphSection).toHaveBeenCalledWith('qol-section', '<div>updated</div>');
    expect(morphSection).toHaveBeenCalledTimes(2);
    expect(el.refs.successText.textContent).toBe('3 added');
    expect(el.refs.successContainer.classList.contains('hidden')).toBe(false);
    expect(added[0].detail.data).toMatchObject({ source: 'quick-order-quantity', variantId: '1' });
    expect(added[0].detail.sourceId).toBe('qol');
  });

  it('uses the singular success message and none when reducing', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ sections: {} })));
    const { el, inputs } = mount();

    inputs[0].dispatchEvent(new QuantitySelectorUpdateEvent(1, 1));
    await vi.advanceTimersByTimeAsync(300);
    expect(el.refs.successText.textContent).toBe('One added');

    inputs[1].dispatchEvent(new QuantitySelectorUpdateEvent(1, 2));
    await vi.advanceTimersByTimeAsync(300);
    expect(el.refs.successContainer.classList.contains('hidden')).toBe(true);
  });

  it('falls back to default translations', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('Theme', { routes: { cart_update_url: '/cart/update.js' } });
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({})));
    const { el, inputs } = mount();
    inputs[0].dispatchEvent(new QuantitySelectorUpdateEvent(4, 1));
    await vi.advanceTimersByTimeAsync(300);
    expect(el.refs.successText.textContent).toBe('4 items added to cart');
  });

  it('skips unchanged quantities and events from outside its rows', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { el, inputs } = mount();

    inputs[1].dispatchEvent(new QuantitySelectorUpdateEvent(2, 2));
    const stray = document.createElement('input');
    el.append(stray);
    stray.dispatchEvent(new QuantitySelectorUpdateEvent(5));
    el.dispatchEvent(new CustomEvent(ThemeEvents.quantitySelectorUpdate, { detail: { quantity: 1 } }));
    await vi.advanceTimersByTimeAsync(300);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows cart errors and re-renders the section', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ errors: 'Not enough stock' })));
    const { el, inputs } = mount();

    inputs[0].dispatchEvent(new QuantitySelectorUpdateEvent(9, 1));
    await vi.advanceTimersByTimeAsync(300);

    expect(el.refs.errorText.textContent).toBe('Not enough stock');
    expect(el.refs.errorContainer.classList.contains('hidden')).toBe(false);
    const [sectionId, options] = sectionRenderer.renderSection.mock.calls[0];
    expect(sectionId).toBe('qol-section');
    expect(options.cache).toBe(false);
    expect(options.url.searchParams.get('page')).toBe('1');
  });

  it('removes a single line by zeroing its quantity input', async () => {
    vi.useFakeTimers();
    const { el, inputs } = mount();
    const events = [];
    inputs[1].addEventListener(ThemeEvents.quantitySelectorUpdate, (e) => events.push(e.detail));
    const event = clickEvent();

    await el.onLineItemRemove(2, event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(inputs[1].value).toBe('0');
    expect(events).toEqual([{ quantity: 0, cartLine: 2 }]);

    await el.onLineItemRemove(404, clickEvent());
    expect(events).toHaveLength(1);
  });

  it('confirms and removes all cart variants', async () => {
    const data = { sections: { 'qol-section': '<div>empty</div>' } };
    const fetchMock = vi.fn(() => jsonResponse(data));
    vi.stubGlobal('fetch', fetchMock);
    const { el } = mount();
    const trigger = document.createElement('button');
    el.append(trigger);
    const added = [];
    document.addEventListener(ThemeEvents.cartUpdate, (e) => added.push(e), { once: true });

    el.showRemoveAllConfirmation({ preventDefault() {}, target: trigger });
    expect(el.refs.confirmationPanel.classList.contains('hidden')).toBe(false);
    expect(el.refs.totalInfo.classList.contains('confirmation-visible')).toBe(true);

    await el.onRemoveAll(clickEvent());

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      updates: { 1: 0, 2: 0 },
      sections: 'qol-section,cart-drawer',
      sections_url: `${window.location.pathname}?page=1`,
    });
    expect(morphSection).toHaveBeenCalledWith('qol-section', '<div>empty</div>');
    expect(el.refs.confirmationPanel.classList.contains('hidden')).toBe(true);
    expect(added[0].detail.data.source).toBe('quick-order-remove-all');
  });

  it('shows remove-all errors and does nothing when the cart has no variants', async () => {
    const fetchMock = vi.fn(() => jsonResponse({ errors: 'Cart locked' }));
    vi.stubGlobal('fetch', fetchMock);
    const { el } = mount();
    await el.onRemoveAll(clickEvent());
    expect(el.refs.errorText.textContent).toBe('Cart locked');
    expect(el.refs.errorContainer.classList.contains('hidden')).toBe(false);

    const empty = mount({ cartIds: [] }).el;
    await empty.onRemoveAll(clickEvent());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rethrows unexpected remove-all failures but ignores aborts', async () => {
    const { el } = mount();
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('boom'))));
    await expect(el.onRemoveAll(clickEvent())).rejects.toThrow('boom');

    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' }))));
    await expect(el.onRemoveAll(clickEvent())).resolves.toBeUndefined();
  });

  it('hides the confirmation and returns focus to the trigger', () => {
    const { el } = mount();
    const trigger = document.createElement('button');
    el.append(trigger);
    el.showRemoveAllConfirmation({ preventDefault() {}, target: trigger });
    el.hideRemoveAllConfirmation({ preventDefault() {} });
    expect(el.refs.confirmationPanel.classList.contains('hidden')).toBe(true);
    expect(document.activeElement).toBe(trigger);
  });

  it('paginates by re-rendering the section with the new page', async () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const { el, inputs } = mount();
    Object.defineProperty(inputs[0], 'offsetParent', { get: () => document.body });
    const event = clickEvent();

    await el.onPaginationControlClick({ page: '2' }, event);

    expect(event.preventDefault).toHaveBeenCalled();
    const [sectionId, { url }] = sectionRenderer.renderSection.mock.calls[0];
    expect(sectionId).toBe('qol-section');
    expect(url.pathname).toBe('/collections/all');
    expect(url.searchParams.get('page')).toBe('2');
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    expect(window.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
    expect(document.activeElement).toBe(inputs[0]);

    delete el.dataset.url;
    await el.onPaginationControlClick({ page: '3' }, clickEvent());
    expect(sectionRenderer.renderSection).toHaveBeenCalledTimes(1);
  });

  it('moves between visible quantity inputs with Enter and Shift+Enter', () => {
    const { inputs } = mount();
    for (const input of inputs) Object.defineProperty(input, 'offsetParent', { get: () => document.body });
    const selected = inputs.map((input) => vi.spyOn(input, 'select'));
    inputs.forEach((i) => (i.scrollIntoView = vi.fn()));

    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    inputs[0].dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(selected[1]).toHaveBeenCalled();

    inputs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
    expect(selected[1]).toHaveBeenCalledTimes(2);

    inputs[1].dispatchEvent(new KeyboardEvent('keyup', { key: 'Tab', bubbles: true }));
    expect(inputs[1].scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });

    const other = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    inputs[0].dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
  });

  it('does not navigate when only one input is visible', () => {
    const { inputs } = mount();
    Object.defineProperty(inputs[0], 'offsetParent', { get: () => document.body });
    const select = vi.spyOn(inputs[1], 'select');
    inputs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(select).not.toHaveBeenCalled();
  });

  it('updates from other cart events, using sections when provided', async () => {
    const { el } = mount();
    el.classList.add('quick-order-list-disabled');

    document.dispatchEvent(new CartUpdateEvent({}, 'drawer', { sections: { 'qol-section': '<div>x</div>' } }));
    await flush();
    expect(el.classList.contains('quick-order-list-disabled')).toBe(false);
    expect(morphSection).toHaveBeenCalledWith('qol-section', '<div>x</div>');
    expect(sectionRenderer.renderSection).not.toHaveBeenCalled();

    document.dispatchEvent(new CartUpdateEvent({}, 'drawer', { sections: { other: 'y' } }));
    await flush();
    expect(sectionRenderer.renderSection).toHaveBeenCalledTimes(1);
    expect(sectionRenderer.renderSection.mock.calls[0][1].cache).toBe(false);

    // A detail shaped with top-level source/sourceId is treated as its own event and skipped.
    document.dispatchEvent(
      new CustomEvent(ThemeEvents.cartUpdate, { detail: { source: 'quick-order-quantity', sourceId: 'qol' } })
    );
    await flush();
    expect(sectionRenderer.renderSection).toHaveBeenCalledTimes(1);
  });

  it('stops listening once removed', async () => {
    const { el } = mount();
    el.remove();
    document.dispatchEvent(new CartUpdateEvent({}, 'drawer', {}));
    await flush();
    expect(sectionRenderer.renderSection).not.toHaveBeenCalled();
  });
});
