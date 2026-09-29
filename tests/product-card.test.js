import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProductCard, ProductCardLink } from '@theme/product-card';
import { OverflowList } from '@theme/overflow-list';
import { mediaQueryLarge } from '@theme/utilities';
import { VariantSelectedEvent, VariantUpdateEvent, SlideshowSelectEvent } from '@theme/events';

const PRODUCT_URL = 'https://shop.test/products/shirt';

class FakeIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function pickerMarkup({ checkedIndex = 0, swatchAttrs = '' } = {}) {
  const inputs = [
    { id: 'v1', variant: '11', media: 'm1', available: 'true' },
    { id: 'v2', variant: '22', media: 'm2', available: 'false' },
  ]
    .map(
      (o, i) => `
        <label>
          <input type="radio" name="color-swatch" value="${o.id}" data-option-value-id="${o.id}"
            data-variant-id="${o.variant}" data-option-media-id="${o.media}" data-option-available="${o.available}"
            data-fieldset-index="0" data-input-index="${i}" ${i === checkedIndex ? 'checked data-current-checked="true"' : ''}
            ${swatchAttrs}>
        </label>`
    )
    .join('');
  return `
    <swatches-variant-picker-component data-product-url="/products/shirt?variant=11" data-product-id="1">
      <fieldset ref="fieldsets[]">${inputs}</fieldset>
    </swatches-variant-picker-component>`;
}

function mount({ picker = true, attrs = 'data-product-transition="true"', extra = '' } = {}) {
  document.body.innerHTML = `
    <ul><li data-page="3"><results-list infinite-scroll="true">
    <product-card ${attrs}>
      <a ref="productCardLink" id="card-1" href="${PRODUCT_URL}">Shirt</a>
      <a ref="productTitleLink" href="${PRODUCT_URL}">Shirt title</a>
      <div ref="cardGallery" data-view-transition-to-main-product>
        <a ref="cardGalleryLink" href="${PRODUCT_URL}"></a>
        <div ref="slideshow">
          <slideshow-slide aria-hidden="false" slide-id="m1"><img ref="imagesToTransition[]" id="img1"></slideshow-slide>
          <slideshow-slide aria-hidden="true" slide-id="m2" variant-image><img ref="imagesToTransition[]" id="img2" loading="lazy"></slideshow-slide>
        </div>
      </div>
      <product-price><div ref="priceContainer">$10</div></product-price>
      <product-price><div ref="priceContainer" id="price">$10</div></product-price>
      <div class="add-to-cart__button"><button id="atc">Add</button></div>
      <span id="body">body</span>
      ${picker ? pickerMarkup() : ''}
      ${extra}
    </product-card>
    </results-list></li></ul>`;
  const card = /** @type {ProductCard} */ (document.querySelector('product-card'));
  const slideshow = card.refs.slideshow;
  const slides = [...slideshow.querySelectorAll('slideshow-slide')];
  Object.assign(slideshow, {
    slides,
    current: 0,
    isNested: false,
    initialSlide: slides[0],
    refs: { slides },
    select: vi.fn(),
    next: vi.fn(),
    previous: vi.fn(),
  });
  return { card, slideshow, slides, picker: card.querySelector('swatches-variant-picker-component') };
}

function responseDoc(body) {
  return new DOMParser().parseFromString(`<body>${body}</body>`, 'text/html');
}

beforeEach(() => {
  vi.stubGlobal('Shopify', { designMode: false });
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
});

afterEach(() => {
  document.body.innerHTML = '';
  mediaQueryLarge.matches = false;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('product-card-link', () => {
  function mountLink(attrs = 'data-product-transition="true" data-featured-media-url="//cdn.test/featured.jpg"') {
    document.body.innerHTML = `
      <product-card-link ${attrs}>
        <div ref="cardGallery" data-view-transition-to-main-product>
          <slideshow-slide aria-hidden="true"><img ref="imagesToTransition[]" id="a"></slideshow-slide>
          <slideshow-slide aria-hidden="false"><img ref="imagesToTransition[]" id="b"></slideshow-slide>
          <button id="btn">btn</button>
        </div>
      </product-card-link>`;
    const el = /** @type {ProductCardLink} */ (document.querySelector('product-card-link'));
    return { el, gallery: el.refs.cardGallery };
  }

  function stubImage(img, src) {
    Object.defineProperty(img, 'currentSrc', { configurable: true, value: src });
    const animation = {};
    img.animate = vi.fn(() => animation);
    return animation;
  }

  it('exposes transition settings from data attributes', () => {
    const { el } = mountLink();
    expect(el).toBeInstanceOf(ProductCardLink);
    expect(el.productTransitionEnabled).toBe(true);
    expect(el.featuredMediaUrl).toBe('//cdn.test/featured.jpg');

    const { el: plain } = mountLink('');
    expect(plain.productTransitionEnabled).toBe(false);
    expect(plain.featuredMediaUrl).toBeNull();
  });

  it('marks the gallery for a view transition and swaps the active image to the featured media', () => {
    const { el, gallery } = mountLink();
    const active = document.getElementById('b');
    const animation = stubImage(active, 'https://cdn.test/other.jpg');

    el.handleViewTransition(new MouseEvent('click'));

    expect(gallery.dataset.viewTransitionType).toBe('product-image-transition');
    expect(gallery.dataset.viewTransitionTriggered).toBe('true');
    expect(active.animate).toHaveBeenCalledWith([{ opacity: 0.8 }, { opacity: 1 }], expect.any(Object));
    animation.onfinish();
    expect(active.srcset).toBe('//cdn.test/featured.jpg');
  });

  it('does not animate when the active image already is the featured media', () => {
    const { el } = mountLink();
    const active = document.getElementById('b');
    stubImage(active, 'https://cdn.test/featured.jpg?width=400');

    el.handleViewTransition(new MouseEvent('click'));
    expect(active.animate).not.toHaveBeenCalled();
  });

  it('falls back to the last image when no slide is visible', () => {
    const { el } = mountLink();
    document.querySelectorAll('slideshow-slide').forEach((s) => s.setAttribute('aria-hidden', 'true'));
    const last = document.getElementById('b');
    stubImage(last, 'https://cdn.test/x.jpg');
    el.handleViewTransition(new MouseEvent('click'));
    expect(last.animate).toHaveBeenCalled();
  });

  it('skips the transition for prevented events, interactive targets, disabled transitions or missing flags', () => {
    const { el, gallery } = mountLink();

    const prevented = new MouseEvent('click', { cancelable: true });
    prevented.preventDefault();
    el.handleViewTransition(prevented);

    const btnEvent = new MouseEvent('click', { bubbles: true });
    document.getElementById('btn').addEventListener('click', (e) => el.handleViewTransition(e), { once: true });
    document.getElementById('btn').dispatchEvent(btnEvent);
    expect(gallery.dataset.viewTransitionTriggered).toBeUndefined();

    delete gallery.dataset.viewTransitionToMainProduct;
    el.handleViewTransition(new MouseEvent('click'));
    expect(gallery.dataset.viewTransitionTriggered).toBeUndefined();

    const { el: disabled, gallery: g2 } = mountLink('');
    disabled.handleViewTransition(new MouseEvent('click'));
    expect(g2.dataset.viewTransitionTriggered).toBeUndefined();
  });

  it('does not touch the image srcset without a featured media url', () => {
    const { el, gallery } = mountLink('data-product-transition="true"');
    const active = document.getElementById('b');
    stubImage(active, 'https://cdn.test/x.jpg');
    el.handleViewTransition(new MouseEvent('click'));
    expect(active.animate).not.toHaveBeenCalled();
    expect(gallery.dataset.viewTransitionTriggered).toBe('true');
  });
});

describe('product-card', () => {
  it('throws when the product card link is not an anchor', () => {
    const errors = [];
    const handler = (e) => {
      errors.push(e.error);
      e.preventDefault();
    };
    window.addEventListener('error', handler);
    document.body.innerHTML = '<product-card><div ref="productCardLink"></div></product-card>';
    window.removeEventListener('error', handler);
    expect(errors.some((e) => /Product card link not found/.test(e?.message))).toBe(true);
  });

  it('exposes the link, product url, selected variant and variant inputs', () => {
    const { card } = mount();
    expect(card).toBeInstanceOf(ProductCard);
    expect(card.productPageUrl).toBe(PRODUCT_URL);
    expect(card.getProductCardLink()).toBe(card.refs.productCardLink);
    expect(card.getSelectedVariantId()).toBe('11');
    expect(card.allVariants).toHaveLength(2);
    expect(card.variantPicker?.tagName).toBe('SWATCHES-VARIANT-PICKER-COMPONENT');

    const { card: noPicker } = mount({ picker: false });
    expect(noPicker.getSelectedVariantId()).toBeNull();
    expect(noPicker.variantPicker).toBeNull();
  });

  it('prefetches the product page on hover and focus at desktop sizes only', () => {
    mediaQueryLarge.matches = true;
    const { card } = mount();
    const quickAdd = { fetchProductPage: vi.fn() };
    card.refs.quickAdd = quickAdd;

    card.dispatchEvent(new Event('pointerenter'));
    card.dispatchEvent(new Event('focusin'));
    expect(quickAdd.fetchProductPage).toHaveBeenCalledTimes(2);
    expect(quickAdd.fetchProductPage).toHaveBeenCalledWith(PRODUCT_URL);

    mediaQueryLarge.matches = false;
    const { card: mobile } = mount();
    const mobileQuickAdd = { fetchProductPage: vi.fn() };
    mobile.refs.quickAdd = mobileQuickAdd;
    mobile.dispatchEvent(new Event('pointerenter'));
    expect(mobileQuickAdd.fetchProductPage).not.toHaveBeenCalled();
  });

  it('preloads the next lazy slide image for nested slideshows', () => {
    vi.useFakeTimers();
    const { slideshow } = mount();
    slideshow.isNested = true;
    const next = document.getElementById('img2');
    expect(next.getAttribute('loading')).toBe('lazy');
    vi.runAllTimers();
    expect(next.hasAttribute('loading')).toBe(false);
  });

  it('forwards variant selections from elsewhere to its own picker', () => {
    const { card, picker } = mount();
    const spy = vi.spyOn(picker, 'updateSelectedOption');

    card.dispatchEvent(new VariantSelectedEvent({ id: 'v2' }));
    expect(spy).toHaveBeenCalledWith('v2');
    expect(card.querySelector('[data-option-value-id="v2"]').checked).toBe(true);

    spy.mockClear();
    picker.dispatchEvent(new VariantSelectedEvent({ id: 'v1' }));
    expect(spy).not.toHaveBeenCalled();
  });

  it('applies a variant update from the picker: price, availability, urls, images', () => {
    const { card, picker, slideshow, slides } = mount();
    const quickAdd = { fetchProductPage: vi.fn() };
    card.refs.quickAdd = quickAdd;
    card.dataset.noSwatchSelected = '';
    picker.pendingVariantId = '22';
    const updatePicker = vi.spyOn(picker, 'updateVariantPicker');

    // Select the second (unavailable) variant visually before the update arrives
    card.querySelector('[data-option-value-id="v2"]').checked = true;

    const html = responseDoc(`
      <product-card data-featured-media-url="//cdn.test/new.jpg">
        <a href="https://shop.test/products/shirt?variant=22">x</a>
        <product-price><div ref="priceContainer">$25</div></product-price>
        <input type="radio" checked data-option-available="false">
      </product-card>`);
    const outer = vi.fn();
    document.body.addEventListener('variant:update', outer);

    picker.dispatchEvent(new VariantUpdateEvent({ id: '22' }, 'v2', { html, productId: '1' }));

    expect(outer).not.toHaveBeenCalled();
    expect(document.getElementById('price').textContent).toBe('$25');
    expect(document.getElementById('atc').disabled).toBe(true);
    expect(card.dataset.featuredMediaUrl).toBe('//cdn.test/new.jpg');
    expect(card.refs.productCardLink.href).toBe('https://shop.test/products/shirt?variant=22');
    expect(card.refs.productTitleLink.href).toBe('https://shop.test/products/shirt?variant=22');
    expect(card.refs.cardGalleryLink.href).toBe('https://shop.test/products/shirt?variant=22');
    expect(quickAdd.fetchProductPage).toHaveBeenCalledWith('https://shop.test/products/shirt?variant=22');
    expect(updatePicker).not.toHaveBeenCalled();
    expect(picker.pendingVariantId).toBeNull();
    expect(slides[1].hidden).toBe(false);
    expect(slideshow.select).toHaveBeenCalledWith({ id: 'm2' }, undefined, { animate: false });
    expect('noSwatchSelected' in card.dataset).toBe(false);
  });

  it('re-renders its picker for updates triggered elsewhere and keeps urls for unavailable variants', () => {
    const { card, picker, slides } = mount();
    const updatePicker = vi.spyOn(picker, 'updateVariantPicker').mockImplementation(() => undefined);
    const html = responseDoc(`
      <product-card><a href=" ">x</a></product-card>
      <input type="radio" checked data-option-available="true">`);

    card.dispatchEvent(new VariantUpdateEvent({ id: '11' }, 'v1', { html, productId: '1' }));

    expect(updatePicker).toHaveBeenCalledWith(html);
    expect(card.refs.productCardLink.href).toBe(PRODUCT_URL);
    expect(document.getElementById('atc').disabled).toBe(false);
    // Selected option media is m1, so the variant-only slide m2 is hidden
    expect(slides[1].hidden).toBe(true);
  });

  it('asks an active overflow list to reflow after a variant update', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    const { card, picker } = mount();
    const overflow = document.createElement('overflow-list');
    overflow.innerHTML = `<template shadowrootmode="open"><ul part="list"><slot></slot><li part="placeholder"></li></ul><div part="overflow"><slot name="overflow"></slot></div><slot name="more"></slot></template><span slot="overflow">+2</span>`;
    picker.appendChild(overflow);
    const dispatch = vi.spyOn(overflow, 'dispatchEvent').mockImplementation(() => true);

    const html = responseDoc('<input type="radio" checked data-option-available="true">');
    picker.dispatchEvent(new VariantUpdateEvent({ id: '11' }, 'v1', { html, productId: '1' }));

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0].type).toBe('reflow');
    expect(card).toBeTruthy();
  });

  it('records user-initiated slideshow selections for hover previews', () => {
    const { card, slideshow } = mount();
    card.dispatchEvent(new SlideshowSelectEvent({ index: 2, userInitiated: false }));
    card.previewImage(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    expect(slideshow.next).toHaveBeenCalledWith(undefined, { animate: false });

    card.dispatchEvent(new SlideshowSelectEvent({ index: 2, userInitiated: true }));
    card.previewImage(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    expect(slideshow.select).toHaveBeenCalledWith(2, undefined, { animate: false });
  });

  it('ignores hover previews from touch pointers or without a slideshow', () => {
    const { card, slideshow } = mount();
    card.previewImage(new PointerEvent('pointerenter', { pointerType: 'touch' }));
    card.resetImage(new PointerEvent('pointerleave', { pointerType: 'touch' }));
    expect(slideshow.next).not.toHaveBeenCalled();
    expect(slideshow.select).not.toHaveBeenCalled();

    card.refs.slideshow = undefined;
    expect(() => card.previewImage(new PointerEvent('pointerenter', { pointerType: 'mouse' }))).not.toThrow();
    expect(() => card.previewVariant('m2')).not.toThrow();
  });

  it('previews a variant image and cancels a pending reset', () => {
    const { card, slideshow } = mount();
    const cancel = vi.spyOn(card.resetVariant, 'cancel');
    card.previewVariant('m2');
    expect(cancel).toHaveBeenCalled();
    expect(slideshow.select).toHaveBeenCalledWith({ id: 'm2' }, undefined, { animate: false });
  });

  it('resets to the selected variant image on pointer leave', () => {
    const { card, slideshow } = mount();
    card.resetImage(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    expect(slideshow.select).toHaveBeenCalledWith({ id: 'm1' }, undefined, { animate: false });
  });

  it('resets to the initial slide, or the previous slide, when no variant media is selected', () => {
    const { card, slideshow, slides } = mount();
    card.querySelectorAll('input').forEach((i) => (i.checked = false));

    card.resetImage(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    expect(slideshow.select).toHaveBeenCalledWith({ id: 'm1' }, undefined, { animate: false });

    slides[0].removeAttribute('slide-id');
    card.resetImage(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    expect(slideshow.previous).toHaveBeenCalledWith(undefined, { animate: false });
  });

  it('steps back when there is no variant picker, and debounces resetVariant', () => {
    vi.useFakeTimers();
    const { card, slideshow } = mount({ picker: false });
    card.resetImage(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    expect(slideshow.previous).toHaveBeenCalledTimes(1);

    card.resetVariant();
    expect(slideshow.select).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(slideshow.select).toHaveBeenCalledWith({ id: 'm1' }, undefined, { animate: false });

    card.refs.slideshow = undefined;
    expect(() => card.resetImage(new PointerEvent('pointerleave', { pointerType: 'mouse' }))).not.toThrow();
  });

  it('navigates to the product when the card body is clicked and remembers the list position', async () => {
    const replaceState = vi.spyOn(history, 'replaceState');
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    const { card } = mount();
    const base = window.location.href.split('#')[0];
    card.refs.productCardLink.href = `${base}#product`;

    document.getElementById('body').dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(window.location.hash).toBe('#product');
    await vi.waitFor(() => expect(replaceState).toHaveBeenCalled());
    const url = new URL(replaceState.mock.calls[0][2]);
    expect(url.hash).toBe('#card-1');
    expect(url.searchParams.get('page')).toBe('3');
    expect(card).toBeTruthy();
  });

  it('opens the product in a new tab when a modifier key is held', () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    window.open = open;
    mount();
    window.Shopify.designMode = true;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true });
    document.getElementById('body').dispatchEvent(event);
    expect(open).toHaveBeenCalledWith(PRODUCT_URL, '_blank');
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not navigate for interactive targets, links, no-navigation cards or missing anchors', () => {
    const open = vi.fn();
    window.open = open;
    vi.stubGlobal('open', open);
    const { card } = mount();
    const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));

    click(document.getElementById('atc'));
    // Native anchor navigation is not implemented by jsdom, so suppress it
    card.refs.productTitleLink.addEventListener('click', (e) => e.preventDefault());
    click(card.refs.productTitleLink);
    card.navigateToProduct(new Event('click'));
    expect(open).not.toHaveBeenCalled();

    card.dataset.noNavigation = '';
    click(document.getElementById('body'));
    delete card.dataset.noNavigation;

    card.refs.productCardLink.removeAttribute('id');
    click(document.getElementById('body'));

    card.refs.productCardLink.removeAttribute('href');
    click(document.getElementById('body'));
    expect(open).not.toHaveBeenCalled();
  });

  it('stops handling clicks once disconnected', () => {
    const open = vi.fn();
    window.open = open;
    vi.stubGlobal('open', open);
    const { card } = mount();
    const body = document.getElementById('body');
    card.remove();
    body.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
    expect(open).not.toHaveBeenCalled();
  });
});

describe('swatches-variant-picker-component', () => {
  it('fetches the first available variant when an unavailable swatch has alternatives', () => {
    const { picker } = mount();
    const input = picker.querySelector('[data-option-value-id="v2"]');
    input.dataset.availableCount = '2';
    input.dataset.firstAvailableOrFirstVariantId = '33';
    const fetchSection = vi.spyOn(picker, 'fetchUpdatedSection').mockImplementation(() => {});
    const selected = vi.fn();
    picker.addEventListener('variant:selected', selected);

    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));

    expect(fetchSection).toHaveBeenCalledTimes(1);
    const url = new URL(fetchSection.mock.calls[0][0]);
    expect(url.pathname).toBe('/products/shirt');
    expect(url.searchParams.get('variant')).toBe('33');
    expect(url.searchParams.get('section_id')).toBe('section-rendering-product-card');
    expect(picker.pendingVariantId).toBe('33');
    expect(input.dataset.currentChecked).toBe('true');
    expect(selected).not.toHaveBeenCalled();
  });

  it('bails out when the picker has no product url', () => {
    const { picker } = mount();
    delete picker.dataset.productUrl;
    const input = picker.querySelector('[data-option-value-id="v2"]');
    input.dataset.availableCount = '1';
    input.dataset.firstAvailableOrFirstVariantId = '33';
    const fetchSection = vi.spyOn(picker, 'fetchUpdatedSection').mockImplementation(() => {});
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(fetchSection).not.toHaveBeenCalled();
    expect(picker.pendingVariantId).toBeUndefined();
  });

  it('falls back to the default variant change behaviour for regular options', () => {
    const { picker } = mount();
    const fetchSection = vi.spyOn(picker, 'fetchUpdatedSection').mockImplementation(() => {});
    const selected = vi.fn();
    picker.addEventListener('variant:selected', selected);
    const input = picker.querySelector('[data-option-value-id="v2"]');
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));

    expect(selected).toHaveBeenCalledTimes(1);
    expect(fetchSection.mock.calls[0][0]).toContain('section_id=section-rendering-product-card');

    picker.variantChanged(new Event('change'));
    expect(fetchSection).toHaveBeenCalledTimes(1);
  });

  it('expands all swatches through the overflow list', () => {
    const { picker } = mount();
    const overflowList = Object.create(OverflowList.prototype);
    overflowList.showAll = vi.fn();
    const event = new Event('click', { cancelable: true });

    picker.refs = { ...picker.refs, overflowList };
    picker.showAllSwatches(event);
    expect(overflowList.showAll).toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);

    picker.refs = { ...picker.refs, overflowList: document.createElement('div') };
    expect(() => picker.showAllSwatches()).not.toThrow();
  });
});
