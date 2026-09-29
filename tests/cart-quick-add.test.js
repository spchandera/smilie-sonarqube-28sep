import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

vi.mock('@theme/variant-picker', () => ({ default: class {} }));

const { QuickAddComponent } = await import('@theme/quick-add');
const { CartUpdateEvent, VariantSelectedEvent, VariantUpdateEvent } = await import('@theme/events');
const { mediaQueryLarge } = await import('@theme/utilities');

const updateVariantPicker = vi.fn();
const raf = () => new Promise((resolve) => requestAnimationFrame(resolve));
const flush = async (n = 4) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

const dialogProto = HTMLDialogElement.prototype;
const original = { showModal: dialogProto.showModal, close: dialogProto.close };

beforeAll(() => {
  dialogProto.showModal = function () {
    this.setAttribute('open', '');
  };
  dialogProto.close = function () {
    this.removeAttribute('open');
  };

  customElements.define(
    'product-card',
    class extends HTMLElement {
      getProductCardLink() {
        return this.querySelector('a.card-link');
      }
      getSelectedVariantId() {
        return this.dataset.selectedVariant || null;
      }
    }
  );
  customElements.define(
    'variant-picker',
    class extends HTMLElement {
      updateVariantPicker(html) {
        updateVariantPicker(html);
      }
    }
  );
});

afterAll(() => {
  dialogProto.showModal = original.showModal;
  dialogProto.close = original.close;
});

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});

afterEach(() => {
  document.body.innerHTML = '';
  document.body.removeAttribute('style');
  mediaQueryLarge.matches = false;
  updateVariantPicker.mockClear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const PRODUCT_PAGE = `
  <html><body>
    <div data-product-grid-content>
      <div class="product-information__media">media</div>
      <div class="product-details">
        <product-price>$20</product-price>
        <variant-picker>
          <input type="radio" name="size" data-variant-id="11" value="S" checked>
          <input type="radio" name="size" data-variant-id="22" value="M">
        </variant-picker>
        <product-form-component>form</product-form-component>
      </div>
    </div>
  </body></html>`;

function mount({ href = 'https://shop.test/products/tee', selected = '', link = true } = {}) {
  document.body.innerHTML = `
    <product-card ${selected ? `data-selected-variant="${selected}"` : ''}>
      ${link ? `<a class="card-link" href="${href}">Tee</a>` : ''}
      <quick-add-component data-product-title="Classic Tee" data-product-options-count="1">
        <button class="quick-add" on:click="/handleClick">Add</button>
      </quick-add-component>
    </product-card>
    <product-card id="other"><span class="swatch"></span></product-card>
    <quick-add-dialog id="quick-add-dialog">
      <dialog ref="dialog"><div id="quick-add-modal-content"></div></dialog>
    </quick-add-dialog>`;
  return {
    el: document.querySelector('quick-add-component'),
    dialog: document.getElementById('quick-add-dialog'),
    modal: document.getElementById('quick-add-modal-content'),
  };
}

function okFetch(body = PRODUCT_PAGE) {
  const fn = vi.fn(() => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(body) }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('quick-add-component', () => {
  it('builds the product url from the card link, adding the selected variant', () => {
    const { el } = mount({ selected: '22' });
    expect(el.productPageUrl).toBe('https://shop.test/products/tee?variant=22');

    document.querySelector('a.card-link').href = 'https://shop.test/products/tee?variant=5';
    expect(el.productPageUrl).toBe('https://shop.test/products/tee?variant=5');
  });

  it('returns an empty url without a product link and skips fetching', async () => {
    const fetchMock = okFetch();
    const { el } = mount({ link: false });
    expect(el.productPageUrl).toBe('');
    expect(await el.fetchProductPage('')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches, renders a mobile layout into the modal and opens the dialog', async () => {
    const fetchMock = okFetch();
    const { el, dialog, modal } = mount({ selected: '22' });

    el.querySelector('button').click();
    await flush();
    await raf();

    expect(fetchMock.mock.calls[0][0]).toBe('https://shop.test/products/tee?variant=22');
    const header = modal.querySelector('.product-header');
    expect(header.querySelector('a').textContent).toBe('Classic Tee');
    expect(header.querySelector('a').getAttribute('href')).toBe('https://shop.test/products/tee?variant=22');
    expect(header.querySelector('product-price')).not.toBeNull();
    expect(modal.querySelector('.product-details')).toBeNull();
    expect(modal.querySelector('product-form-component')).not.toBeNull();
    expect(modal.querySelector('input[data-variant-id="22"]').checked).toBe(true);
    expect(updateVariantPicker).toHaveBeenCalledTimes(1);
    expect(dialog.refs.dialog.open).toBe(true);
    expect(el.hasAttribute('stay-visible')).toBe(true);

    const media = modal.querySelector('.product-information__media');
    media.scrollTo = vi.fn();
    dialog.refs.dialog.dispatchEvent(new Event('animationstart'));
    expect(media.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' });

    await dialog.closeDialog();
    expect(el.hasAttribute('stay-visible')).toBe(false);
  });

  it('keeps the desktop layout and reuses cached content until the cart changes', async () => {
    mediaQueryLarge.matches = true;
    const fetchMock = okFetch();
    const { el, dialog, modal } = mount();

    await el.handleClick(new Event('click'));
    expect(modal.querySelector('.product-details')).not.toBeNull();
    expect(modal.querySelector('.product-header')).toBeNull();
    await raf();
    await dialog.closeDialog();

    await el.handleClick(new Event('click'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await raf();
    await dialog.closeDialog();

    document.dispatchEvent(new CartUpdateEvent({}, 'x', {}));
    await el.handleClick(new Event('click'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('opens the dialog even when the page has no product grid', async () => {
    okFetch('<html><body><p>nothing</p></body></html>');
    const { el, dialog, modal } = mount();
    await el.handleClick(new Event('click'));
    await raf();
    expect(modal.innerHTML).toBe('');
    expect(dialog.refs.dialog.open).toBe(true);
  });

  it('throws on HTTP errors and returns null for aborted requests', async () => {
    const { el } = mount();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 404 })));
    await expect(el.fetchProductPage('/products/missing')).rejects.toThrow('HTTP error 404');

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    );
    expect(await el.fetchProductPage('/products/tee')).toBeNull();
  });

  it('aborts a pending fetch when a new one starts', async () => {
    const signals = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_u, { signal }) => {
        signals.push(signal);
        return new Promise(() => {});
      })
    );
    const { el } = mount();
    el.fetchProductPage('/a');
    el.fetchProductPage('/b');
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  it('updates the button mode when a swatch in its own card is selected', () => {
    const { el } = mount();
    document.querySelector('#other .swatch').dispatchEvent(new VariantSelectedEvent({ id: '1' }));
    expect(el.dataset.quickAddButton).toBeUndefined();

    el.dispatchEvent(new VariantSelectedEvent({ id: '1' }));
    expect(el.dataset.quickAddButton).toBe('add');

    el.dataset.productOptionsCount = '3';
    el.dispatchEvent(new VariantSelectedEvent({ id: '1' }));
    expect(el.dataset.quickAddButton).toBe('choose');
  });

  it('is exported for reuse', () => {
    expect(customElements.get('quick-add-component')).toBe(QuickAddComponent);
  });
});

describe('quick-add-dialog', () => {
  async function openDialog() {
    const { dialog } = mount();
    dialog.showDialog();
    await raf();
    return dialog;
  }

  it('closes after a successful cart update but not after a failed one', async () => {
    const dialog = await openDialog();
    dialog.dispatchEvent(new CartUpdateEvent({}, 'x', { didError: true }));
    await flush();
    expect(dialog.refs.dialog.open).toBe(true);

    dialog.dispatchEvent(new CartUpdateEvent({}, 'x', {}));
    await flush();
    expect(dialog.refs.dialog.open).toBe(false);
  });

  it('updates product title links from variant update html', () => {
    const { dialog, modal } = mount();
    modal.innerHTML = `
      <div class="view-product-title"><a href="/old">View</a></div>
      <div class="product-header"><a href="/old">Tee</a></div>`;
    const html = new DOMParser().parseFromString(
      '<div class="view-product-title"><a href="https://shop.test/products/tee?variant=9">View</a></div>',
      'text/html'
    );

    modal.dispatchEvent(new VariantUpdateEvent({ id: 9 }, 'picker', { html, productId: '1' }));
    expect(modal.querySelector('.view-product-title a').href).toBe('https://shop.test/products/tee?variant=9');
    expect(modal.querySelector('.product-header a').href).toBe('https://shop.test/products/tee?variant=9');

    modal.dispatchEvent(new VariantUpdateEvent({ id: 9 }, 'picker', { html: null, productId: '1' }));
    expect(modal.querySelector('.product-header a').href).toBe('https://shop.test/products/tee?variant=9');
  });

  it('nudges the results grid width on close for iOS below 16.4', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)');
    const dialog = await openDialog();
    document.body.insertAdjacentHTML('beforeend', '<div id="ResultsList"><div product-grid-view></div></div>');
    const grid = document.querySelector('[product-grid-view]');
    grid.getBoundingClientRect = () => ({ width: 300 });

    await dialog.closeDialog();
    await raf();
    expect(grid.style.width).toBe('299px');
    await raf();
    expect(grid.style.width).toBe('');
  });

  it('leaves the grid alone on modern iOS', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X)');
    const dialog = await openDialog();
    document.body.insertAdjacentHTML('beforeend', '<div id="ResultsList"><div product-grid-view></div></div>');
    const grid = document.querySelector('[product-grid-view]');
    await dialog.closeDialog();
    await raf();
    expect(grid.style.width).toBe('');
  });
});
