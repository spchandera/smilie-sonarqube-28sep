import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@theme/variant-picker';
import { OverflowList } from '@theme/overflow-list';
import { ThemeEvents } from '@theme/events';

// Minimal OverflowList that skips the shadow DOM layout logic jsdom cannot run.
class TestOverflowList extends OverflowList {
  connectedCallback() {}
  attributeChangedCallback() {}
  showAll() {
    this.shown = true;
  }
}
customElements.define('product-form-test-overflow', TestOverflowList);

const radio = (id, variant, index, { checked = false, url = '' } = {}) => `
  <label data-key="label-${id}"><input type="radio" name="Color" value="v${id}" data-key="radio-${id}"
    data-option-value-id="${id}" data-variant-id="${variant}" data-fieldset-index="0" data-input-index="${index}"
    ${url ? `data-connected-product-url="${url}"` : ''}
    ${checked ? 'checked data-current-checked="true"' : ''}></label>`;

function pickerMarkup({ productId = '1', productUrl = '/products/shirt', checked = 0, json = '{"id":11,"available":true}', urls = [] } = {}) {
  return `
    <variant-picker data-product-id="${productId}" data-product-url="${productUrl}" data-template-product-match="true">
      <fieldset ref="fieldsets[]">
        ${radio('101', '11', 0, { checked: checked === 0, url: urls[0] })}
        ${radio('102', '12', 1, { checked: checked === 1, url: urls[1] })}
        ${radio('103', '', 2, { checked: checked === 2, url: urls[2] })}
      </fieldset>
      <select name="Size">
        <option value="S" data-option-value-id="201" selected>S</option>
        <option value="M" data-option-value-id="202">M</option>
      </select>
      <script type="application/json">${json}</script>
    </variant-picker>`;
}

function mount({ wrap = (html) => `<div class="shopify-section">${html}</div>`, ...options } = {}) {
  document.body.innerHTML = `<main>${wrap(pickerMarkup(options))}</main>`;
  const el = document.querySelector('variant-picker');
  return { el, radios: [...el.querySelectorAll('input[type="radio"]')], select: el.querySelector('select') };
}

function mockFetch(responseHtml) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
    Promise.resolve({ text: () => Promise.resolve(responseHtml) })
  );
}

const choose = (input) => {
  input.checked = true;
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

beforeEach(() => {
  window.history.replaceState({}, '', '/products/shirt');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  document.body.innerHTML = '';
  window.history.replaceState({}, '', '/');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('variant-picker', () => {
  it('fetches the new variant, morphs itself, dispatches events and updates the url', async () => {
    const fetchSpy = mockFetch(`<body>${pickerMarkup({ checked: 1, json: '{"id":12,"available":true}' })}</body>`);
    const { el, radios } = mount();
    const selected = [];
    const updates = [];
    el.addEventListener(ThemeEvents.variantSelected, (e) => selected.push(e.detail));
    el.addEventListener(ThemeEvents.variantUpdate, (e) => updates.push(e.detail));

    choose(radios[1]);

    expect(selected).toEqual([{ resource: { id: '102' } }]);
    expect(fetchSpy.mock.calls[0][0]).toBe('/products/shirt?option_values=102,201');
    expect(fetchSpy.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(radios[1].dataset.currentChecked).toBe('true');
    expect(radios[0].dataset.previousChecked).toBe('true');
    expect(radios[0].dataset.currentChecked).toBe('false');

    await vi.waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0].resource).toEqual({ id: 12, available: true });
    expect(updates[0].sourceId).toBe('102');
    expect(updates[0].data.productId).toBe('1');
    expect(updates[0].data.newProduct).toBeUndefined();
    expect(updates[0].data.html).toBeInstanceOf(Document);

    await vi.waitFor(() => expect(window.location.search).toBe('?variant=12'));
  });

  it('keeps only the last two selections per fieldset', () => {
    mockFetch('<body></body>');
    const { radios } = mount();
    choose(radios[1]);
    choose(radios[2]);
    expect(radios[2].dataset.currentChecked).toBe('true');
    expect(radios[1].dataset.previousChecked).toBe('true');
    expect(radios[0].dataset.previousChecked).toBe('false');
  });

  it('removes the variant param when the option has no variant', async () => {
    window.history.replaceState({}, '', '/products/shirt?variant=11');
    mockFetch('<body></body>');
    const { radios } = mount();
    choose(radios[2]);
    await vi.waitFor(() => expect(window.location.search).toBe(''));
  });

  it('reports a new product when the morphed picker belongs to another product', async () => {
    mockFetch(`<body>${pickerMarkup({ productId: '2', productUrl: '/products/other' })}</body>`);
    const { el, radios } = mount();
    const updates = [];
    el.addEventListener(ThemeEvents.variantUpdate, (e) => updates.push(e.detail));
    choose(radios[1]);
    await vi.waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0].data.newProduct).toEqual({ id: '2', url: '/products/other' });
    expect(el.dataset.productId).toBe('2');
    expect(el.dataset.productUrl).toBe('/products/other');
  });

  it('morphs the whole main element for combined listing products', async () => {
    const fetchSpy = mockFetch(
      `<body><main><div class="shopify-section"><h1>Other product</h1>${pickerMarkup({ productUrl: '/products/other', checked: 1 })}</div></main></body>`
    );
    const { el, radios } = mount({ urls: ['/products/shirt', '/products/other'] });
    const updates = [];
    el.addEventListener(ThemeEvents.variantUpdate, (e) => updates.push(e.detail));

    choose(radios[1]);
    expect(fetchSpy.mock.calls[0][0]).toBe('/products/other?option_values=102,201');

    await vi.waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('Other product'));
    await vi.waitFor(() => expect(window.location.pathname).toBe('/products/other'));
    expect(window.location.search).toBe('?variant=12');
    expect(updates).toHaveLength(1);
  });

  it('logs when the combined listing response has no main', async () => {
    mockFetch(`<body>${pickerMarkup()}</body>`);
    const { radios } = mount({ urls: ['', '/products/other'] });
    choose(radios[1]);
    await vi.waitFor(() =>
      expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ message: 'No new main source found' }))
    );
  });

  it('morphs the featured product section and requests its section id', async () => {
    const fetchSpy = mockFetch(
      `<body><featured-product-information id="featured-1"><p class="title">New</p>${pickerMarkup({ checked: 1 })}</featured-product-information></body>`
    );
    const { radios } = mount({
      productUrl: '/products/shirt?foo=bar',
      wrap: (html) => `<featured-product-information id="featured-1"><p class="title">Old</p>${html}</featured-product-information>`,
    });
    choose(radios[1]);
    expect(fetchSpy.mock.calls[0][0]).toBe('/products/shirt?section_id=featured-1&option_values=102,201');
    await vi.waitFor(() => expect(document.querySelector('.title').textContent).toBe('New'));
  });

  it('logs when the featured product section is missing from the response', async () => {
    mockFetch(`<body>${pickerMarkup()}</body>`);
    const { radios } = mount({
      wrap: (html) => `<featured-product-information id="featured-1">${html}</featured-product-information>`,
    });
    choose(radios[1]);
    await vi.waitFor(() =>
      expect(console.error).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'No new element source found for featured-product-information' })
      )
    );
  });

  it('does not touch the url inside product cards and uses the card section', () => {
    const fetchSpy = mockFetch('<body></body>');
    const { radios } = mount({
      wrap: (html) => `<product-card><quick-add-component>${html}</quick-add-component></product-card>`,
    });
    const replace = vi.spyOn(window.history, 'replaceState');
    choose(radios[1]);
    expect(fetchSpy.mock.calls[0][0]).toBe('/products/shirt?section_id=section-rendering-product-card&option_values=102,201');
    expect(replace).not.toHaveBeenCalled();
  });

  it('builds product card and view specific request urls', () => {
    window.history.replaceState({}, '', '/products/shirt?view=alt');
    const { el, radios } = mount();
    expect(el.buildRequestUrl(radios[0])).toBe('/products/shirt?view=alt&option_values=101,201');
    expect(el.buildRequestUrl(radios[0], 'product-card', ['9', '8'])).toBe('/products/shirt?view=alt&option_values=9,8');

    radios[0].checked = false;
    el.querySelector('option[selected]').removeAttribute('selected');
    expect(el.selectedOptionsValues).toEqual([]);
    expect(el.buildRequestUrl(radios[1], 'product-card')).toBe('/products/shirt?view=alt&option_values=102');
    expect(el.buildRequestUrl(radios[1], 'other')).toBe('/products/shirt?view=alt');
  });

  it('marks the chosen select option and supports selecting by id', () => {
    mockFetch('<body></body>');
    const { el, select, radios } = mount();
    select.value = 'M';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(select.options[1].hasAttribute('selected')).toBe(true);
    expect(select.options[0].hasAttribute('selected')).toBe(false);

    el.updateSelectedOption('103');
    expect(radios[2].checked).toBe(true);
    expect(el.selectedOptionId).toBe('103');
    expect(() => el.updateSelectedOption('999')).toThrow('Target element not found');
  });

  it('throws for a select without the chosen option and missing option ids', () => {
    const { el, radios } = mount();
    const fakeSelect = document.createElement('select');
    Object.defineProperty(fakeSelect, 'value', { get: () => 'missing' });
    expect(() => el.updateSelectedOption(fakeSelect)).toThrow('Option not found');

    delete radios[0].dataset.optionValueId;
    expect(() => el.selectedOptionId).toThrow('No option value ID found');
    expect(() => el.selectedOptionsValues).toThrow('No option value ID found');

    radios[0].checked = false;
    el.querySelector('option[selected]').removeAttribute('selected');
    expect(el.selectedOptionId).toBeUndefined();
  });

  it('ignores radios without indices and change events without a target element', () => {
    const fetchSpy = mockFetch('<body></body>');
    const { el, radios } = mount();
    delete radios[1].dataset.fieldsetIndex;
    el.updateSelectedOption(radios[1]);
    expect(radios[1].checked).toBe(true);
    expect(radios[1].dataset.currentChecked).toBeUndefined();

    el.variantChanged(new Event('change'));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('skips the update event when the response has no variant json', async () => {
    const fetchSpy = mockFetch('<body><variant-picker></variant-picker></body>');
    const { el, radios } = mount();
    const updates = [];
    el.addEventListener(ThemeEvents.variantUpdate, (e) => updates.push(e));
    choose(radios[1]);
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 10));
    expect(updates).toHaveLength(0);
  });

  it('aborts the previous request when a new variant is chosen', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        })
    );
    const { radios } = mount();
    choose(radios[1]);
    choose(radios[2]);
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalledWith('Fetch aborted by user'));
  });

  it('throws when re-rendering from markup without a variant picker', () => {
    const { el } = mount();
    expect(() => el.updateVariantPicker(document.createElement('div'))).toThrow('No new variant picker source found');
  });

  it('re-expands the swatch overflow list after morphing', async () => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    const withOverflow = (html) =>
      html.replace(
        '<fieldset ref="fieldsets[]">',
        '<product-form-test-overflow ref="overflowList" data-key="overflow" disabled="true"></product-form-test-overflow><fieldset ref="fieldsets[]">'
      );
    mockFetch(`<body>${withOverflow(pickerMarkup({ checked: 1 }))}</body>`);
    document.body.innerHTML = `<div class="shopify-section">${withOverflow(pickerMarkup())}</div>`;
    const el = document.querySelector('variant-picker');
    const overflow = el.refs.overflowList;
    expect(overflow).toBeInstanceOf(OverflowList);

    choose(el.querySelectorAll('input[type="radio"]')[1]);
    await vi.waitFor(() => expect(overflow.shown).toBe(true));
  });

  it('writes pill widths for the current and previous selection', () => {
    mockFetch('<body></body>');
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(48);
    const { el, radios } = mount();
    const fieldset = el.querySelector('fieldset');
    choose(radios[1]);
    expect(fieldset.style.getPropertyValue('--pill-width-current')).toBe('48px');
    expect(fieldset.style.getPropertyValue('--pill-width-previous')).toBe('48px');

    width.mockReturnValue(0);
    el.updateVariantPickerCss();
    expect(fieldset.style.getPropertyValue('--pill-width-current')).toBe('');
    expect(fieldset.style.getPropertyValue('--pill-width-previous')).toBe('');

    el.updateFieldsetCss(Number.NaN);
    el.updateFieldsetCss(5);
    el.remove();
  });
});
