import { describe, it, expect, vi, afterEach } from 'vitest';
import '@theme/product-price';
import '@theme/product-sku';
import '@theme/product-inventory';
import '@theme/price-per-item';
import '@theme/volume-pricing';
import '@theme/volume-pricing-info';
import '@theme/product-custom-property';
import { Component } from '@theme/component';
import { VariantUpdateEvent, CartUpdateEvent, QuantitySelectorUpdateEvent } from '@theme/events';

/** Parses a HTML string into a document to use as a section rendering response. */
const parse = (html) => new DOMParser().parseFromString(html, 'text/html');

/**
 * Dispatches a variant update event from an element inside the section.
 * @param {Element} source
 */
function dispatchVariantUpdate(source, resource, html, data = {}) {
  source.dispatchEvent(new VariantUpdateEvent(resource, 'option-1', { html: parse(html), productId: '1', ...data }));
}

if (!customElements.get('anchored-popover-component')) {
  customElements.define(
    'anchored-popover-component',
    class extends Component {
      updatedCallback() {
        this.updates = (this.updates ?? 0) + 1;
        super.updatedCallback();
      }
    }
  );
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('product-price', () => {
  function mount({ note = true, installments = false } = {}) {
    document.body.innerHTML = `
      <div class="shopify-section">
        <div id="source" data-product-id="1"></div>
        <product-price data-block-id="b1" data-product-id="1">
          <div ref="priceContainer">$10</div>
          ${note ? '<p ref="volumePricingNote">old note</p>' : ''}
          ${
            installments
              ? '<form id="product-form-installment-b1"><input name="id" value="old"></form>'
              : ''
          }
        </product-price>
      </div>`;
    return {
      el: document.querySelector('product-price'),
      source: document.getElementById('source'),
    };
  }

  it('replaces the price and the volume pricing note from the new html', () => {
    const { el, source } = mount();
    dispatchVariantUpdate(
      source,
      { id: 5 },
      `<product-price data-block-id="b1"><div ref="priceContainer">$20</div><p ref="volumePricingNote">new note</p></product-price>`
    );
    expect(el.querySelector('[ref="priceContainer"]').textContent).toBe('$20');
    expect(el.querySelector('[ref="volumePricingNote"]').textContent).toBe('new note');
  });

  it('removes the note when the new html has none, and adds it back after the price', () => {
    const { el, source } = mount();
    dispatchVariantUpdate(
      source,
      { id: 5 },
      `<product-price data-block-id="b1"><div ref="priceContainer">$20</div></product-price>`
    );
    expect(el.querySelector('[ref="volumePricingNote"]')).toBeNull();

    el.updatedCallback();
    dispatchVariantUpdate(
      source,
      { id: 6 },
      `<product-price data-block-id="b1"><div ref="priceContainer">$30</div><p ref="volumePricingNote">back</p></product-price>`
    );
    const price = el.querySelector('[ref="priceContainer"]');
    expect(price.textContent).toBe('$30');
    expect(price.nextElementSibling.textContent).toBe('back');
  });

  it('ignores updates for other products and missing blocks', () => {
    const { el, source } = mount();
    source.dataset.productId = '2';
    dispatchVariantUpdate(
      source,
      { id: 5 },
      `<product-price data-block-id="b1"><div ref="priceContainer">$99</div></product-price>`
    );
    expect(el.textContent).toContain('$10');

    source.dataset.productId = '1';
    dispatchVariantUpdate(source, { id: 5 }, `<product-price data-block-id="other"></product-price>`);
    expect(el.textContent).toContain('$10');
  });

  it('adopts the new product id and updates the installments variant input', () => {
    const { el, source } = mount({ installments: true, note: false });
    source.dataset.productId = '99';
    const input = el.querySelector('input[name="id"]');
    const onChange = vi.fn();
    input.addEventListener('change', onChange);

    dispatchVariantUpdate(
      source,
      { id: 42 },
      `<product-price data-block-id="b1"><div ref="priceContainer">$5</div></product-price>`,
      { newProduct: { id: '99', url: '/products/other' } }
    );

    expect(el.dataset.productId).toBe('99');
    expect(input.value).toBe('42');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('removes its listener when disconnectedCallback runs inside the section', () => {
    const { el, source } = mount();
    el.disconnectedCallback();
    dispatchVariantUpdate(
      source,
      { id: 5 },
      `<product-price data-block-id="b1"><div ref="priceContainer">$20</div></product-price>`
    );
    expect(el.querySelector('[ref="priceContainer"]').textContent).toBe('$10');
  });

  it('does nothing when not inside a section', () => {
    document.body.innerHTML = `<product-price data-block-id="b1"><div ref="priceContainer">$1</div></product-price>`;
    const el = document.querySelector('product-price');
    expect(() => el.remove()).not.toThrow();
  });
});

describe('product-sku-component', () => {
  function mount() {
    document.body.innerHTML = `
      <div id="ProductInformation-1" data-product-id="1">
        <product-sku-component data-product-id="1">
          <div ref="skuContainer">SKU: <span ref="sku">OLD</span></div>
        </product-sku-component>
      </div>`;
    return {
      el: document.querySelector('product-sku-component'),
      target: document.getElementById('ProductInformation-1'),
    };
  }

  it('shows the new variant sku', () => {
    const { el, target } = mount();
    dispatchVariantUpdate(target, { id: 1, sku: 'NEW-1' }, '<div></div>');
    expect(el.refs.sku.textContent).toBe('NEW-1');
    expect(el.style.display).toBe('block');
  });

  it('hides itself when the variant has no sku', () => {
    const { el, target } = mount();
    dispatchVariantUpdate(target, { id: 1, sku: '' }, '<div></div>');
    expect(el.refs.sku.textContent).toBe('');
    expect(el.style.display).toBe('none');
  });

  it('ignores updates for other products and updates without a variant', () => {
    const { el, target } = mount();
    target.dataset.productId = '2';
    dispatchVariantUpdate(target, { id: 1, sku: 'X' }, '<div></div>');
    expect(el.refs.sku.textContent).toBe('OLD');

    target.dataset.productId = '1';
    dispatchVariantUpdate(target, null, '<div></div>');
    expect(el.refs.sku.textContent).toBe('OLD');
  });

  it('switches to the new product id for combined listings', () => {
    const { el, target } = mount();
    target.dataset.productId = '7';
    dispatchVariantUpdate(target, { id: 1, sku: 'COMBO' }, '<div></div>', { newProduct: { id: '7', url: '/p' } });
    expect(el.dataset.productId).toBe('7');
    expect(el.refs.sku.textContent).toBe('COMBO');
  });

  it('removes its listener when disconnectedCallback runs inside the container', () => {
    const { el, target } = mount();
    el.disconnectedCallback();
    dispatchVariantUpdate(target, { id: 1, sku: 'LATE' }, '<div></div>');
    expect(el.refs.sku.textContent).toBe('OLD');
  });

  it('works without a matching container', () => {
    document.body.innerHTML = `<product-sku-component><div ref="skuContainer"><span ref="sku"></span></div></product-sku-component>`;
    expect(() => document.querySelector('product-sku-component').remove()).not.toThrow();
  });
});

describe('product-inventory', () => {
  function mount() {
    document.body.innerHTML = `
      <dialog>
        <div id="source" data-product-id="1"></div>
        <product-inventory data-product-id="1"><span class="status">In stock</span></product-inventory>
      </dialog>`;
    return { el: document.querySelector('product-inventory'), source: document.getElementById('source') };
  }

  it('morphs its children from the new html', () => {
    const { el, source } = mount();
    dispatchVariantUpdate(source, { id: 1 }, '<product-inventory><span class="status">Low stock</span></product-inventory>');
    expect(el.textContent).toBe('Low stock');
  });

  it('ignores other products, missing markup, and adopts new products', () => {
    const { el, source } = mount();
    source.dataset.productId = '3';
    dispatchVariantUpdate(source, { id: 1 }, '<product-inventory><span>Sold out</span></product-inventory>');
    expect(el.textContent).toBe('In stock');

    source.dataset.productId = '1';
    dispatchVariantUpdate(source, { id: 1 }, '<div></div>');
    expect(el.textContent).toBe('In stock');

    dispatchVariantUpdate(source, { id: 1 }, '<product-inventory><span>Sold out</span></product-inventory>', {
      newProduct: { id: '3', url: '/p' },
    });
    expect(el.dataset.productId).toBe('3');
    expect(el.textContent).toBe('Sold out');
  });

  it('removes its listener when disconnectedCallback runs inside the dialog', () => {
    const { el, source } = mount();
    el.disconnectedCallback();
    dispatchVariantUpdate(source, { id: 1 }, '<product-inventory><span>Gone</span></product-inventory>');
    expect(el.textContent).toBe('In stock');
  });
});

describe('price-per-item', () => {
  function mount({ value = '1', cart = '0', breaks = '[{"quantity":"5","price":"$8"},{"quantity":"10","price":"$6"}]' } = {}) {
    document.body.innerHTML = `
      <product-form-component>
        <input name="quantity" value="${value}" data-cart-quantity="${cart}">
        <price-per-item data-min-quantity="1" data-variant-price="$10" data-price-breaks='${breaks}'
          data-at-text="at" data-each-text="ea">
          <span ref="pricePerItemText"></span>
        </price-per-item>
      </product-form-component>
      <input id="outside">`;
    const el = document.querySelector('price-per-item');
    return { el, input: document.querySelector('input[name="quantity"]'), text: el.refs.pricePerItemText };
  }

  it('shows the base price for the minimum quantity', () => {
    const { text } = mount();
    expect(text.innerHTML).toBe('at $10/ea');
  });

  it('picks the tier matching cart plus input quantity', () => {
    const { text } = mount({ value: '3', cart: '3' });
    expect(text.innerHTML).toBe('at $8/ea');
  });

  it('refreshes on quantity updates from inside its form only', () => {
    const { input, text } = mount();
    input.value = '12';
    document.getElementById('outside').dispatchEvent(new QuantitySelectorUpdateEvent(12));
    expect(text.innerHTML).toBe('at $10/ea');

    input.dispatchEvent(new QuantitySelectorUpdateEvent(12));
    expect(text.innerHTML).toBe('at $6/ea');
  });

  it('refreshes on cart updates and stops after disconnect', () => {
    const { el, input, text } = mount();
    input.dataset.cartQuantity = '4';
    document.dispatchEvent(new CartUpdateEvent({}, 'x'));
    expect(text.innerHTML).toBe('at $8/ea');

    el.remove();
    input.dataset.cartQuantity = '20';
    document.dispatchEvent(new CartUpdateEvent({}, 'x'));
    expect(text.innerHTML).toBe('at $8/ea');
  });

  it('falls back to the lowest tier and to quantity 1 without an input', () => {
    document.body.innerHTML = `
      <price-per-item data-min-quantity="3" data-variant-price="$10" data-price-breaks='[{"quantity":"","price":"$1"}]'
        data-at-text="at" data-each-text="ea"><span ref="pricePerItemText"></span></price-per-item>`;
    const el = document.querySelector('price-per-item');
    expect(el.refs.pricePerItemText.innerHTML).toBe('at $10/ea');
  });

  it('renders nothing without price data', () => {
    document.body.innerHTML = `<price-per-item><span ref="pricePerItemText">keep</span></price-per-item>`;
    expect(document.querySelector('[ref="pricePerItemText"]').innerHTML).toBe('keep');
  });
});

describe('volume-pricing', () => {
  it('toggles the expanded class', () => {
    document.body.innerHTML = `<volume-pricing><button on:click="/toggleExpanded">More</button></volume-pricing>`;
    const el = document.querySelector('volume-pricing');
    el.querySelector('button').click();
    expect(el.classList.contains('volume-pricing--expanded')).toBe(true);
    el.toggleExpanded();
    expect(el.classList.contains('volume-pricing--expanded')).toBe(false);
  });
});

describe('volume-pricing-info', () => {
  function mount() {
    document.body.innerHTML = `
      <anchored-popover-component>
        <div ref="popover">
          <volume-pricing-info>
            <div class="volume-pricing-info__row" data-quantity="1"></div>
            <div class="volume-pricing-info__row" data-quantity="5"></div>
            <div class="volume-pricing-info__row" data-quantity="10"></div>
          </volume-pricing-info>
        </div>
      </anchored-popover-component>`;
    return {
      popover: document.querySelector('anchored-popover-component'),
      el: document.querySelector('volume-pricing-info'),
      rows: [...document.querySelectorAll('.volume-pricing-info__row')],
    };
  }

  it('refreshes the parent popover refs on connect and update', () => {
    const { popover, el } = mount();
    expect(popover.updates).toBe(1);
    el.updatedCallback();
    expect(popover.updates).toBe(2);
  });

  it('highlights the highest tier the quantity qualifies for', () => {
    const { el, rows } = mount();
    el.updateActiveTier(7);
    expect(rows.map((r) => r.classList.contains('volume-pricing-info__row--active'))).toEqual([false, true, false]);
    el.updateActiveTier(10);
    expect(rows.map((r) => r.classList.contains('volume-pricing-info__row--active'))).toEqual([false, false, true]);
    el.updateActiveTier(0);
    expect(rows.some((r) => r.classList.contains('volume-pricing-info__row--active'))).toBe(false);
  });

  it('retries the popover refresh on a microtask when it throws', async () => {
    const spy = vi
      .spyOn(customElements.get('anchored-popover-component').prototype, 'updatedCallback')
      .mockImplementationOnce(() => {
        throw new Error('not ready');
      });
    mount();
    await Promise.resolve();
    await Promise.resolve();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('is a no-op outside a popover', () => {
    document.body.innerHTML = `<volume-pricing-info></volume-pricing-info>`;
    const el = document.querySelector('volume-pricing-info');
    expect(() => {
      el.updatedCallback();
      el.updateActiveTier(3);
    }).not.toThrow();
  });
});

describe('product-custom-property-component', () => {
  it('updates the character count from the template on input', () => {
    document.body.innerHTML = `
      <product-custom-property-component>
        <textarea ref="textInput" maxlength="20" on:input="/handleInput"></textarea>
        <span ref="characterCount" data-template="[current]/[max] characters"></span>
      </product-custom-property-component>`;
    const input = document.querySelector('textarea');
    input.value = 'Hello';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.querySelector('[ref="characterCount"]').textContent).toBe('5/20 characters');
  });

  it('leaves the count alone without a template', () => {
    document.body.innerHTML = `
      <product-custom-property-component>
        <input ref="textInput" maxlength="5">
        <span ref="characterCount">keep</span>
      </product-custom-property-component>`;
    document.querySelector('product-custom-property-component').handleInput();
    expect(document.querySelector('[ref="characterCount"]').textContent).toBe('keep');
  });
});
