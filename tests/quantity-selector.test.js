import { describe, it, expect, vi, afterEach } from 'vitest';
import '@theme/component-quantity-selector';
import { ThemeEvents } from '@theme/events';

function mount({ value = '1', min = '1', max = '', step = '1', cart = '', line = '', minusDisabled = false } = {}) {
  document.body.innerHTML = `
    <quantity-selector-component>
      <button ref="minusButton" on:click="/decreaseQuantity" ${minusDisabled ? 'disabled' : ''}>-</button>
      <input ref="quantityInput" type="number" value="${value}" min="${min}" ${max ? `max="${max}"` : ''} step="${step}"
        ${cart ? `data-cart-quantity="${cart}"` : ''} ${line ? `data-cart-line="${line}"` : ''}
        on:blur="/setQuantity" on:focus="/selectInputValue">
      <button ref="plusButton" on:click="/increaseQuantity">+</button>
    </quantity-selector-component>`;
  const el = document.querySelector('quantity-selector-component');
  return { el, input: el.refs.quantityInput, minus: el.refs.minusButton, plus: el.refs.plusButton };
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('quantity-selector-component', () => {
  it('disables minus at the minimum and plus at the maximum', () => {
    const { minus, plus } = mount({ value: '1', max: '1' });
    expect(minus.disabled).toBe(true);
    expect(plus.disabled).toBe(true);
  });

  it('steps the value with the buttons and broadcasts the change', () => {
    const { el, input, minus, plus } = mount({ value: '2', step: '2', min: '0', line: '3' });
    const events = [];
    document.addEventListener(ThemeEvents.quantitySelectorUpdate, (e) => events.push(e.detail), { once: true });

    plus.click();
    expect(input.value).toBe('4');
    expect(events).toEqual([{ quantity: 4, cartLine: 3 }]);

    minus.click();
    minus.click();
    minus.click();
    expect(input.value).toBe('0');
    expect(minus.disabled).toBe(true);
    expect(el.getValue()).toBe('0');
  });

  it('never exceeds what is left to add after the cart quantity', () => {
    const { input, plus, el } = mount({ value: '2', max: '5', cart: '2' });
    plus.click();
    plus.click();
    expect(input.value).toBe('3');
    expect(plus.disabled).toBe(true);
    expect(el.canAddToCart()).toEqual({ canAdd: true, maxQuantity: 5, cartQuantity: 2, quantityToAdd: 3 });

    el.setValue('4');
    expect(el.canAddToCart().canAdd).toBe(false);
  });

  it('clamps the value when the cart quantity changes', () => {
    const { input, el } = mount({ value: '4', max: '5' });
    el.setCartQuantity(3);
    expect(input.dataset.cartQuantity).toBe('3');
    expect(input.value).toBe('2');
  });

  it('keeps server-disabled buttons disabled', () => {
    const { el, minus } = mount({ value: '3', minusDisabled: true });
    el.updateButtonStates();
    expect(el.serverDisabledMinus).toBe(true);
    expect(minus.disabled).toBe(true);
  });

  it('snaps a typed value to the bounds on blur', () => {
    const { input } = mount({ value: '1', max: '10' });
    input.value = '50';
    input.dispatchEvent(new FocusEvent('blur'));
    expect(input.value).toBe('10');

    input.value = 'abc';
    input.dispatchEvent(new FocusEvent('blur'));
    expect(input.value).toBe('1');
  });

  it('reports invalid step increments instead of accepting them', () => {
    const { input } = mount({ value: '2', step: '2', min: '2' });
    const report = vi.spyOn(input, 'reportValidity').mockReturnValue(false);
    input.value = '3';
    input.dispatchEvent(new FocusEvent('blur'));
    expect(report).toHaveBeenCalled();
    expect(input.value).toBe('3');
  });

  it('selects the input text on focus', () => {
    const { input } = mount();
    const select = vi.spyOn(input, 'select');
    input.focus();
    expect(select).toHaveBeenCalled();
  });

  it('updates constraints and snaps the value to the new step and range', () => {
    const { el, input } = mount({ value: '7' });
    el.updateConstraints('2', '6', '2');
    expect(input.min).toBe('2');
    expect(input.max).toBe('6');
    expect(input.step).toBe('2');
    expect(input.value).toBe('6');

    el.updateConstraints('1', null, '1');
    expect(input.hasAttribute('max')).toBe(false);
    expect(input.value).toBe('6');
  });

  it('exposes the quantity input', () => {
    const { el, input } = mount();
    expect(el.quantityInput).toBe(input);
    el.refs = {};
    expect(() => el.quantityInput).toThrow('Missing <input ref="quantityInput" />');
  });

  it('ignores button events without an element target', () => {
    const { el, input } = mount({ value: '2' });
    el.increaseQuantity({ target: null });
    el.decreaseQuantity({ target: null });
    el.setQuantity({ target: null });
    expect(input.value).toBe('2');
  });
});
