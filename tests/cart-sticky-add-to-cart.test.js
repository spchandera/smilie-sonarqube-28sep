import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@theme/sticky-add-to-cart';
import {
  CartUpdateEvent,
  CartErrorEvent,
  QuantitySelectorUpdateEvent,
  VariantSelectedEvent,
  VariantUpdateEvent,
} from '@theme/events';

/** @type {Array<{ callback: Function, options: any, targets: Element[], disconnect: Function }>} */
let observers;

class FakeIntersectionObserver {
  constructor(callback, options) {
    this.callback = callback;
    this.options = options;
    this.targets = [];
    this.disconnected = false;
    observers.push(this);
  }
  observe(target) {
    this.targets.push(target);
  }
  disconnect() {
    this.disconnected = true;
  }
  trigger(isIntersecting) {
    this.callback([{ isIntersecting, target: this.targets[0] }]);
  }
}

beforeEach(() => {
  observers = [];
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stickyMarkup({ disabled = false, image = true, available = 'true', title = 'Small' } = {}) {
  return `
    <sticky-add-to-cart data-product-id="42" data-initial-quantity="2" data-variant-available="${available}">
      <div ref="stickyBar" data-stuck="false">
        ${image ? '<img ref="productImage" src="https://cdn.test/tee.jpg">' : ''}
        <span class="sticky-add-to-cart__variant">${title}</span>
        <button ref="addToCartButton" on:click="/handleAddToCartClick" ${disabled ? 'disabled' : ''}>
          Add <span ref="quantityDisplay">(<span ref="quantityNumber"></span>)</span>
        </button>
      </div>
    </sticky-add-to-cart>`;
}

function mount({ footer = true, disabled = false, image = true, cartIcon = true } = {}) {
  document.body.innerHTML = `
    ${cartIcon ? '<div class="header-actions__cart-icon"></div>' : ''}
    <div class="shopify-section" id="shopify-section-product">
      <div class="buy-buttons-block">
        <product-form-component data-product-id="42"><button ref="addToCartButton">Add to cart</button></product-form-component>
      </div>
      <variant-picker data-product-id="42">
        <input type="radio" value="Blue" checked><input type="radio" value="" checked><input type="radio" value="Large" checked>
      </variant-picker>
      ${stickyMarkup({ disabled, image })}
    </div>
    ${footer ? '<footer></footer>' : ''}`;
  const el = document.querySelector('sticky-add-to-cart');
  return {
    el,
    section: document.querySelector('.shopify-section'),
    buyButtons: document.querySelector('.buy-buttons-block'),
    mainButton: document.querySelector('product-form-component [ref="addToCartButton"]'),
  };
}

const rect = (top, bottom) => () => ({ top, bottom });

describe('sticky-add-to-cart', () => {
  it('shows the initial quantity only when it is above one and the button is enabled', () => {
    const { el } = mount();
    expect(el.refs.quantityNumber.textContent).toBe('2');
    expect(el.refs.quantityDisplay.style.display).toBe('inline');

    document.dispatchEvent(new QuantitySelectorUpdateEvent(1));
    expect(el.refs.quantityNumber.textContent).toBe('1');
    expect(el.refs.quantityDisplay.style.display).toBe('none');

    document.dispatchEvent(new QuantitySelectorUpdateEvent(5, 3));
    expect(el.refs.quantityNumber.textContent).toBe('1');

    const disabled = mount({ disabled: true }).el;
    expect(disabled.refs.quantityDisplay.style.display).toBe('none');
  });

  it('shows the bar once the buy buttons scroll above the viewport and hides it when they return', () => {
    const { el, buyButtons } = mount();
    const [buyObserver, footerObserver] = observers;
    expect(buyObserver.targets[0]).toBe(buyButtons);
    expect(footerObserver.targets[0]).toBe(document.querySelector('footer'));
    expect(footerObserver.options).toEqual({ rootMargin: '200px 0px 0px 0px' });

    buyButtons.getBoundingClientRect = rect(500, 600);
    buyObserver.trigger(false);
    expect(el.refs.stickyBar.dataset.stuck).toBe('false');

    buyButtons.getBoundingClientRect = rect(-200, -100);
    buyObserver.trigger(false);
    expect(el.refs.stickyBar.dataset.stuck).toBe('true');

    buyObserver.trigger(true);
    expect(el.refs.stickyBar.dataset.stuck).toBe('false');
  });

  it('hides at the footer and reappears once the footer leaves while still scrolled past', () => {
    const { el, buyButtons } = mount();
    const [buyObserver, footerObserver] = observers;
    buyButtons.getBoundingClientRect = rect(-200, -100);
    buyObserver.trigger(false);

    footerObserver.trigger(true);
    expect(el.refs.stickyBar.dataset.stuck).toBe('false');

    buyButtons.getBoundingClientRect = rect(100, 200);
    footerObserver.trigger(false);
    expect(el.refs.stickyBar.dataset.stuck).toBe('false');

    buyButtons.getBoundingClientRect = rect(-300, -200);
    footerObserver.trigger(false);
    expect(el.refs.stickyBar.dataset.stuck).toBe('true');

    buyObserver.callback([]);
    footerObserver.callback([]);
    expect(el.refs.stickyBar.dataset.stuck).toBe('true');
  });

  it('falls back to a footer group and skips observing without any footer', () => {
    document.body.innerHTML = `<div class="shopify-section" id="shopify-section-p">
      <div class="buy-buttons-block"><product-form-component data-product-id="42"></product-form-component></div>
      ${stickyMarkup()}</div>`;
    expect(observers).toHaveLength(0);

    document.body.innerHTML += '<div class="section-footer-group"></div>';
    expect(observers).toHaveLength(2);
    expect(observers[1].targets[0].className).toBe('section-footer-group');
  });

  it('clicks the real add to cart button as a puppet and flies the image to the cart', async () => {
    vi.useFakeTimers();
    const { el, mainButton } = mount();
    const clicks = vi.fn();
    mainButton.addEventListener('click', clicks);

    await el.handleAddToCartClick();

    expect(clicks).toHaveBeenCalledTimes(1);
    expect(mainButton.dataset.puppet).toBe('true');
    expect(el.refs.addToCartButton.dataset.added).toBe('true');
    const fly = document.querySelector('fly-to-cart');
    expect(fly.classList.contains('fly-to-cart--sticky')).toBe(true);
    expect(fly.style.getPropertyValue('background-image')).toContain('https://cdn.test/tee.jpg');
    expect(fly.source).toBe(el.refs.productImage);
    expect(fly.destination).toBe(document.querySelector('.header-actions__cart-icon'));

    vi.advanceTimersByTime(800);
    expect(el.refs.addToCartButton.dataset.added).toBeUndefined();

    document.dispatchEvent(new CartUpdateEvent({}, 'form', {}));
    expect(mainButton.dataset.puppet).toBe('false');
    mainButton.dataset.puppet = 'true';
    document.dispatchEvent(new CartErrorEvent('form', 'Sold out', {}, {}));
    expect(mainButton.dataset.puppet).toBe('false');
  });

  it('skips the fly animation without a cart icon and does nothing without a target button', async () => {
    const { el } = mount({ cartIcon: false });
    await el.handleAddToCartClick();
    expect(el.refs.addToCartButton.dataset.added).toBe('true');
    expect(document.querySelector('fly-to-cart')).toBeNull();

    const noFooter = mount({ footer: false }).el;
    await noFooter.handleAddToCartClick();
    expect(noFooter.refs.addToCartButton.dataset.added).toBeUndefined();
  });

  it('morphs the bar on a variant update for its product while keeping the stuck state', () => {
    const { el, section } = mount();
    el.refs.stickyBar.dataset.stuck = 'true';
    const html = new DOMParser().parseFromString(stickyMarkup({ available: 'false', title: 'Medium' }), 'text/html');

    section.dispatchEvent(new VariantUpdateEvent({ id: 77 }, 'picker', { html, productId: '42' }));

    expect(el.querySelector('.sticky-add-to-cart__variant').textContent).toBe('Medium');
    expect(el.refs.stickyBar.dataset.stuck).toBe('true');
    expect(el.dataset.variantAvailable).toBe('false');
    expect(el.dataset.currentVariantId).toBe('77');
  });

  it('shows the selected options when the chosen combination has no variant', () => {
    const { el, section } = mount();
    const html = new DOMParser().parseFromString(stickyMarkup({ title: 'Unavailable' }), 'text/html');
    section.dispatchEvent(new VariantUpdateEvent(null, 'picker', { html, productId: '42' }));
    expect(el.dataset.currentVariantId).toBe('');
    expect(el.querySelector('.sticky-add-to-cart__variant').textContent).toBe('Blue / Large');
  });

  it('ignores variant updates for other products or without sticky markup', () => {
    const { el, section } = mount();
    const empty = new DOMParser().parseFromString('<div></div>', 'text/html');
    section.dispatchEvent(new VariantUpdateEvent({ id: 1 }, 'p', { html: empty, productId: '99' }));
    section.dispatchEvent(new VariantUpdateEvent({ id: 1 }, 'p', { html: empty, productId: '42' }));
    const noBar = new DOMParser().parseFromString('<sticky-add-to-cart></sticky-add-to-cart>', 'text/html');
    section.dispatchEvent(new VariantUpdateEvent({ id: 1 }, 'p', { html: noBar, productId: '42' }));
    expect(el.dataset.currentVariantId).toBeUndefined();
  });

  it('tracks the selected variant id', () => {
    const { el, section } = mount();
    section.dispatchEvent(new VariantSelectedEvent({ id: 55 }));
    expect(el.dataset.currentVariantId).toBe('55');
    section.dispatchEvent(new VariantSelectedEvent({}));
    expect(el.dataset.currentVariantId).toBe('55');
  });

  it('disconnects its observers and listeners when removed', () => {
    const { el } = mount();
    el.remove();
    expect(observers.every((o) => o.disconnected)).toBe(true);
    document.dispatchEvent(new QuantitySelectorUpdateEvent(9));
    expect(el.refs.quantityNumber.textContent).toBe('2');
  });
});
