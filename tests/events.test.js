import { describe, it, expect } from 'vitest';
import {
  ThemeEvents,
  VariantSelectedEvent,
  VariantUpdateEvent,
  CartAddEvent,
  CartUpdateEvent,
  CartErrorEvent,
  QuantitySelectorUpdateEvent,
  DiscountUpdateEvent,
  MediaStartedPlayingEvent,
  SlideshowSelectEvent,
  ZoomMediaSelectedEvent,
  MegaMenuHoverEvent,
  FilterUpdateEvent,
} from '@theme/events';

describe('ThemeEvents', () => {
  it('defines stable event names used across the theme', () => {
    expect(ThemeEvents.variantSelected).toBe('variant:selected');
    expect(ThemeEvents.variantUpdate).toBe('variant:update');
    expect(ThemeEvents.cartUpdate).toBe('cart:update');
    expect(ThemeEvents.cartError).toBe('cart:error');
    expect(ThemeEvents.mediaStartedPlaying).toBe('media:started-playing');
    expect(ThemeEvents.quantitySelectorUpdate).toBe('quantity-selector:update');
    expect(ThemeEvents.megaMenuHover).toBe('megaMenu:hover');
    expect(ThemeEvents.zoomMediaSelected).toBe('zoom-media:selected');
    expect(ThemeEvents.discountUpdate).toBe('discount:update');
    expect(ThemeEvents.FilterUpdate).toBe('filter:update');
  });
});

describe('theme event classes', () => {
  it('VariantSelectedEvent carries the selected resource', () => {
    const event = new VariantSelectedEvent({ id: '1' });
    expect(event.type).toBe('variant:selected');
    expect(event.bubbles).toBe(true);
    expect(event.detail).toEqual({ resource: { id: '1' } });
  });

  it('VariantUpdateEvent normalises a missing resource to null', () => {
    const html = document.implementation.createHTMLDocument();
    const event = new VariantUpdateEvent(undefined, 'src', { html, productId: 'p1' });
    expect(event.type).toBe('variant:update');
    expect(event.detail).toEqual({
      resource: null,
      sourceId: 'src',
      data: { html, productId: 'p1', newProduct: undefined },
    });
  });

  it('CartAddEvent uses the cart update event name and copies data', () => {
    const data = { itemCount: 2 };
    const event = new CartAddEvent({ token: 't' }, 'form', data);
    expect(CartAddEvent.eventName).toBe('cart:update');
    expect(event.type).toBe('cart:update');
    expect(event.detail.data).toEqual(data);
    expect(event.detail.data).not.toBe(data);
  });

  it('CartUpdateEvent tolerates missing data', () => {
    const event = new CartUpdateEvent({ token: 't' }, 'drawer');
    expect(event.type).toBe('cart:update');
    expect(event.detail).toEqual({ resource: { token: 't' }, sourceId: 'drawer', data: {} });
  });

  it('CartErrorEvent carries the server error details', () => {
    const event = new CartErrorEvent('form', 'Sold out', 'Not enough stock', { qty: 1 });
    expect(event.type).toBe('cart:error');
    expect(event.detail).toEqual({
      sourceId: 'form',
      data: { message: 'Sold out', errors: { qty: 1 }, description: 'Not enough stock' },
    });
  });

  it('QuantitySelectorUpdateEvent carries quantity and cart line', () => {
    const event = new QuantitySelectorUpdateEvent(3, 7);
    expect(event.type).toBe('quantity-selector:update');
    expect(event.detail).toEqual({ quantity: 3, cartLine: 7 });
  });

  it('DiscountUpdateEvent carries the cart and source', () => {
    const event = new DiscountUpdateEvent({ total: 1 }, 'discount');
    expect(event.type).toBe('discount:update');
    expect(event.detail).toEqual({ resource: { total: 1 }, sourceId: 'discount' });
  });

  it('MediaStartedPlayingEvent carries the media element', () => {
    const el = document.createElement('video');
    const event = new MediaStartedPlayingEvent(el);
    expect(event.type).toBe('media:started-playing');
    expect(event.detail.resource).toBe(el);
  });

  it('SlideshowSelectEvent exposes the slide data as detail', () => {
    const data = { index: 1, id: 's', slide: document.createElement('div'), previousIndex: 0, userInitiated: true, trigger: 'select' };
    const event = new SlideshowSelectEvent(data);
    expect(SlideshowSelectEvent.eventName).toBe('slideshow:select');
    expect(event.type).toBe('slideshow:select');
    expect(event.detail).toBe(data);
  });

  it('ZoomMediaSelectedEvent carries the media index', () => {
    const event = new ZoomMediaSelectedEvent(4);
    expect(event.type).toBe('zoom-media:selected');
    expect(event.detail).toEqual({ index: 4 });
  });

  it('MegaMenuHoverEvent bubbles', () => {
    const event = new MegaMenuHoverEvent();
    expect(event.type).toBe('megaMenu:hover');
    expect(event.bubbles).toBe(true);
  });

  it('FilterUpdateEvent shows "clear all" only when a filter is applied', () => {
    expect(new FilterUpdateEvent(new URLSearchParams('sort_by=price')).shouldShowClearAll()).toBe(false);
    expect(new FilterUpdateEvent(new URLSearchParams('filter.v.price.gte=10')).shouldShowClearAll()).toBe(true);
  });

  it('events reach document listeners when dispatched from an element', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    let received;
    const listener = (e) => (received = e.detail);
    document.addEventListener(ThemeEvents.quantitySelectorUpdate, listener);

    el.dispatchEvent(new QuantitySelectorUpdateEvent(5));

    document.removeEventListener(ThemeEvents.quantitySelectorUpdate, listener);
    el.remove();
    expect(received).toEqual({ quantity: 5, cartLine: undefined });
  });
});
