import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

const saveState = (name, isOpen, instanceId) =>
  sessionStorage.setItem(`editor-save-state-${name}`, JSON.stringify({ isOpen, instanceId }));

const readState = (name) => JSON.parse(sessionStorage.getItem(`editor-save-state-${name}`) ?? 'null');

const fire = (target, type) => target.dispatchEvent(new Event(type, { bubbles: true }));

/** Builds a fixture where every stateful editor feature exists with spy-able open methods. */
function buildFixture() {
  document.body.innerHTML = `
    <header-component id="header-component"></header-component>
    <shopify-account id="account"></shopify-account>
    <dropdown-localization-component id="dropdown"><button id="dropdown-button" aria-expanded="false">x</button></dropdown-localization-component>
    <div class="search-modal" id="search-modal"></div>
    <cart-drawer-component id="cart"></cart-drawer-component>
    <header-drawer id="drawer"><details id="drawer-details"></details></header-drawer>
    <dialog-component id="pickup-wrapper"><div class="pickup-location__dialog" id="pickup"></div></dialog-component>
    <div class="quick-add-modal" id="quick-add"><product-price data-product-id="42"></product-price></div>
    <product-form-component data-product-id="42"><button class="quick-add__button--choose" id="choose">Choose</button></product-form-component>
    <div class="facets__panel" id="panel-1"></div>
    <div class="facets--drawer" id="facets-drawer"></div>

    <div class="shopify-section" id="cards-section">
      <product-card id="card-a"><span id="card-a-child"></span></product-card>
      <product-card id="card-b"></product-card>
    </div>
    <div class="shopify-section"><product-card id="card-other"></product-card></div>

    <slideshow-component id="slideshow">
      <div><slideshow-slide id="slide-0"></slideshow-slide><slideshow-slide id="slide-1"><span id="slide-1-block"></span></slideshow-slide></div>
    </slideshow-component>
    <slideshow-slide id="orphan-slide"></slideshow-slide>

    <slideshow-component id="carousel">
      <div><div data-carousel-card id="card-0"></div><div data-carousel-card id="card-1"><span id="card-1-block"></span></div></div>
    </slideshow-component>

    <layered-slideshow-component id="layered">
      <div role="tabpanel" id="panel-0"></div><div role="tabpanel" id="panel-1b"><span id="panel-1b-block"></span></div>
    </layered-slideshow-component>`;

  const account = document.getElementById('account');
  account.attachShadow({ mode: 'open' }).innerHTML = '<button popovertarget="p" id="account-button">Account</button><dialog></dialog>';

  const els = {
    account,
    accountButton: account.shadowRoot.getElementById('account-button'),
    dropdown: document.getElementById('dropdown'),
    searchModal: document.getElementById('search-modal'),
    cart: document.getElementById('cart'),
    drawer: document.getElementById('drawer'),
    pickupWrapper: document.getElementById('pickup-wrapper'),
    choose: document.getElementById('choose'),
    slideshow: document.getElementById('slideshow'),
    carousel: document.getElementById('carousel'),
    layered: document.getElementById('layered'),
  };
  els.dropdown.showPanel = vi.fn();
  els.searchModal.showDialog = vi.fn();
  els.cart.open = vi.fn();
  els.drawer.open = vi.fn();
  els.drawer.refs = { details: document.getElementById('drawer-details') };
  els.pickupWrapper.toggleDialog = vi.fn();
  els.chooseClick = vi.fn();
  els.choose.addEventListener('click', els.chooseClick);
  els.accountClick = vi.fn();
  els.accountButton.addEventListener('click', els.accountClick);
  for (const s of [els.slideshow, els.carousel]) {
    s.pause = vi.fn();
    s.select = vi.fn();
    s.resume = vi.fn();
  }
  els.layered.select = vi.fn();
  return els;
}

describe('theme-editor (design mode)', () => {
  let els;
  let restored;

  beforeAll(async () => {
    vi.useFakeTimers();
    Element.prototype.scrollIntoView ??= function () {};
    vi.stubGlobal('Shopify', { designMode: true });
    sessionStorage.clear();
    els = buildFixture();
    for (const name of [
      'account-popover',
      'localization-dropdown',
      'search-modal',
      'cart-drawer',
      'header-drawer',
      'local-pickup-modal',
      'facets-panel',
    ]) {
      saveState(name, true);
    }
    saveState('quick-add-modal', true, '42');
    saveState('floating-panel-component', true, 'panel-1');

    await import('@theme/theme-editor');
    vi.runOnlyPendingTimers();
    await flush();
    restored = {
      dropdown: els.dropdown.showPanel.mock.calls.length,
      searchModal: els.searchModal.showDialog.mock.calls.length,
      cart: els.cart.open.mock.calls.length,
      drawer: els.drawer.open.mock.calls.length,
      pickup: els.pickupWrapper.toggleDialog.mock.calls.length,
      choose: els.chooseClick.mock.calls.length,
    };
  });

  afterAll(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    sessionStorage.clear();
    document.body.innerHTML = '';
  });

  it('restores every saved open overlay after a refresh', async () => {
    // vitest clears mock call history between tests, so counts were captured in beforeAll.
    expect(restored).toEqual({ dropdown: 1, searchModal: 1, cart: 1, drawer: 1, pickup: 1, choose: 1 });
    expect(els.drawer.refs.details.hasAttribute('open')).toBe(true);
    expect(document.getElementById('panel-1').hasAttribute('open')).toBe(true);
    expect(document.getElementById('facets-drawer').hasAttribute('open')).toBe(true);

    // The account popover waits until shopify-account is defined.
    expect(els.accountClick).not.toHaveBeenCalled();
    customElements.define('shopify-account', class extends HTMLElement {});
    await customElements.whenDefined('shopify-account');
    await flush();
    expect(els.accountClick).toHaveBeenCalledTimes(1);
  });

  it('saves state when tracked attributes change', async () => {
    document.getElementById('dropdown-button').setAttribute('aria-expanded', 'true');
    await flush();
    expect(readState('localization-dropdown')).toEqual({ isOpen: true });

    els.searchModal.removeAttribute('open');
    els.searchModal.setAttribute('open', '');
    els.searchModal.removeAttribute('open');
    await flush();
    expect(readState('search-modal')).toEqual({ isOpen: false });

    document.getElementById('quick-add').setAttribute('open', '');
    await flush();
    expect(readState('quick-add-modal')).toEqual({ isOpen: true, instanceId: '42' });

    document.getElementById('panel-1').removeAttribute('open');
    await flush();
    expect(readState('floating-panel-component')).toEqual({ isOpen: false, instanceId: 'panel-1' });

    const unrelated = document.createElement('div');
    document.body.append(unrelated);
    unrelated.setAttribute('open', '');
    await flush();
    expect(Object.keys(sessionStorage).filter((k) => k.startsWith('editor-save-state'))).toHaveLength(9);
  });

  it('tracks the account popover through its shadow root and toggle events', async () => {
    const dialog = els.account.shadowRoot.querySelector('dialog');
    dialog.setAttribute('open', '');
    await flush();
    expect(readState('account-popover')).toEqual({ isOpen: true });

    dialog.removeAttribute('open');
    els.account.dispatchEvent(new Event('toggle'));
    expect(readState('account-popover')).toEqual({ isOpen: false });
  });

  it('disables navigation on all product cards of a selected card section', () => {
    fire(document.getElementById('card-a'), 'shopify:block:select');
    expect(document.getElementById('card-a').dataset.noNavigation).toBe('true');
    expect(document.getElementById('card-b').dataset.noNavigation).toBe('true');
    expect(document.getElementById('card-other').dataset.noNavigation).toBeUndefined();

    fire(document.getElementById('card-a-child'), 'shopify:block:select');
    expect(document.getElementById('card-a').dataset.noNavigation).toBeUndefined();

    fire(document.getElementById('card-b'), 'shopify:block:select');
    fire(document.getElementById('card-b'), 'shopify:block:deselect');
    expect(document.getElementById('card-b').dataset.noNavigation).toBeUndefined();
  });

  it('selects the slideshow slide, animating only on a new selection', () => {
    fire(document.getElementById('slide-1-block'), 'shopify:block:select');
    expect(els.slideshow.pause).toHaveBeenCalled();
    expect(els.slideshow.select).toHaveBeenLastCalledWith(1, undefined, { animate: true });

    fire(document.getElementById('slide-1'), 'shopify:block:select');
    expect(els.slideshow.select).toHaveBeenLastCalledWith(1, undefined, { animate: false });

    fire(document.getElementById('slide-1'), 'shopify:block:deselect');
    expect(els.slideshow.resume).toHaveBeenCalledTimes(1);

    els.slideshow.select.mockClear();
    fire(document.getElementById('orphan-slide'), 'shopify:block:select');
    expect(els.slideshow.select).not.toHaveBeenCalled();
  });

  it('scrolls the selected carousel card into view', () => {
    const card = document.getElementById('card-1');
    const scroll = vi.spyOn(card, 'scrollIntoView');
    fire(document.getElementById('card-1-block'), 'shopify:block:select');
    expect(scroll).toHaveBeenLastCalledWith({ behavior: 'smooth', inline: 'center' });
    fire(card, 'shopify:block:select');
    expect(scroll).toHaveBeenLastCalledWith({ behavior: 'instant', inline: 'center' });
  });

  it('selects the layered slideshow panel, instantly when re-selected', () => {
    fire(document.getElementById('panel-1b-block'), 'shopify:block:select');
    expect(els.layered.select).toHaveBeenLastCalledWith(1, { instant: false });
    fire(document.getElementById('panel-1b'), 'shopify:block:select');
    expect(els.layered.select).toHaveBeenLastCalledWith(1, { instant: true });
  });

  it('updates header custom properties when the header group section loads or unloads', () => {
    const section = document.createElement('div');
    section.className = 'shopify-section-group-header-group';
    document.body.append(section);
    document.body.style.removeProperty('--header-height');

    fire(section, 'shopify:section:load');
    expect(document.body.style.getPropertyValue('--header-height')).toBe('0px');

    document.body.style.removeProperty('--header-height');
    fire(section, 'shopify:section:unload');
    expect(document.body.style.getPropertyValue('--header-height')).toBe('');
    vi.advanceTimersByTime(500);
    expect(document.body.style.getPropertyValue('--header-height')).toBe('0px');

    document.body.style.removeProperty('--header-height');
    fire(document.getElementById('cart'), 'shopify:section:load');
    expect(document.body.style.getPropertyValue('--header-height')).toBe('');
  });

  it('flags a real navigation on beforeunload', () => {
    window.dispatchEvent(new Event('beforeunload'));
    expect(sessionStorage.getItem('editor-page-unloading')).toBe('true');
  });
});

describe('theme-editor after a real navigation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    document.body.innerHTML = '';
  });

  it('clears saved editor states instead of restoring them', async () => {
    vi.resetModules();
    vi.stubGlobal('Shopify', { designMode: true });
    const els = buildFixture();
    saveState('cart-drawer', true);
    sessionStorage.setItem('other-key', 'keep');
    sessionStorage.setItem('editor-page-unloading', 'true');

    await import('@theme/theme-editor');
    await new Promise((r) => setTimeout(r, 0));

    expect(els.cart.open).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('editor-save-state-cart-drawer')).toBeNull();
    expect(sessionStorage.getItem('editor-page-unloading')).toBeNull();
    expect(sessionStorage.getItem('other-key')).toBe('keep');
  });
});
