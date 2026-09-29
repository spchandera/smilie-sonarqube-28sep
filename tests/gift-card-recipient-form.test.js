import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CartErrorEvent, ThemeEvents } from '@theme/events';
import '@theme/gift-card-recipient-form';

const CONTROL = 'input[name="properties[__shopify_send_gift_card_to_recipient]"]';

function errorBox(ref) {
  return `<div ref="${ref}" class="hidden"><span></span></div>`;
}

function mount({ optional = true } = {}) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <gift-card-recipient-form data-section-id="main">
      <input type="radio" ref="myEmailButton">
      <input type="radio" ref="recipientEmailButton">
      <div ref="recipientFields">
        <input ref="recipientEmail" value="a@b.c">
        ${optional ? errorBox('emailError') : ''}
        <input ref="recipientName" value="Name">
        ${optional ? errorBox('nameError') : ''}
        <textarea ref="recipientMessage" maxlength="200">hello</textarea>
        ${optional ? errorBox('messageError') : ''}
        <input type="date" ref="recipientSendOn">
        ${optional ? errorBox('sendOnError') : ''}
        ${optional ? '<input type="hidden" ref="timezoneOffset" value="x">' : ''}
        ${optional ? '<span ref="characterCount" data-template="[current] of [max]"></span>' : ''}
        ${optional ? '<div ref="liveRegion"></div>' : ''}
      </div>
      <input type="hidden" name="properties[__shopify_send_gift_card_to_recipient]" value="on">
    </gift-card-recipient-form>`;
  document.body.appendChild(wrapper);
  const el = wrapper.querySelector('gift-card-recipient-form');
  return { el, refs: el.refs };
}

const fmt = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 0, 15, 12));
  globalThis.Theme = { translations: {} };
});

afterEach(() => {
  document.body.innerHTML = '';
  delete globalThis.Theme;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('GiftCardRecipientForm', () => {
  it('initialises in self-delivery mode with fields cleared and disabled', () => {
    const { el, refs } = mount();
    expect(refs.myEmailButton.checked).toBe(true);
    expect(refs.recipientEmailButton.checked).toBe(false);
    expect(refs.recipientFields.hidden).toBe(true);
    for (const f of [refs.recipientEmail, refs.recipientName, refs.recipientMessage, refs.recipientSendOn]) {
      expect(f.value).toBe('');
      expect(f.disabled).toBe(true);
    }
    expect(el.querySelector(CONTROL)).toBeNull();
    expect(refs.timezoneOffset.disabled).toBe(true);
    expect(refs.timezoneOffset.value).toBe('');
    expect(refs.characterCount.textContent).toBe('0 of 200');
    expect(refs.recipientSendOn.getAttribute('min')).toBe('2026-01-15');
    expect(refs.recipientSendOn.getAttribute('max')).toBe(fmt(new Date(2026, 3, 15)));
  });

  it('switches to recipient mode and back, dispatching toggle events', () => {
    const { el, refs } = mount();
    const events = [];
    const onToggle = (e) => events.push(e.detail);
    document.addEventListener('recipient:toggle', onToggle);

    el.toggleRecipientForm('recipient_form', new Event('change'));
    expect(refs.recipientEmailButton.checked).toBe(true);
    expect(refs.myEmailButton.checked).toBe(false);
    expect(refs.recipientFields.hidden).toBe(false);
    expect(refs.recipientEmail.disabled).toBe(false);
    expect(refs.recipientEmail.getAttribute('required')).toBe('required');
    expect(refs.recipientName.hasAttribute('required')).toBe(false);
    expect(el.querySelectorAll(CONTROL)).toHaveLength(1);
    expect(refs.timezoneOffset.disabled).toBe(false);
    expect(refs.timezoneOffset.value).toBe(String(new Date().getTimezoneOffset()));
    expect(refs.liveRegion.textContent).toBe('Recipient form fields are now visible');
    expect(document.activeElement).toBe(refs.recipientEmail);

    // Same mode is a no-op
    el.toggleRecipientForm('recipient_form');
    expect(events).toHaveLength(1);

    refs.recipientMessage.value = 'abc';
    refs.recipientMessage.dispatchEvent(new Event('input'));
    expect(refs.characterCount.textContent).toBe('3 of 200');

    el.toggleRecipientForm('self');
    expect(refs.recipientFields.hidden).toBe(true);
    expect(refs.recipientMessage.value).toBe('');
    expect(el.querySelector(CONTROL)).toBeNull();
    expect(refs.liveRegion.textContent).toBe('Recipient form fields are now hidden');

    expect(events).toEqual([
      { mode: 'recipient_form', recipientFormVisible: true },
      { mode: 'self', recipientFormVisible: false },
    ]);
    document.removeEventListener('recipient:toggle', onToggle);
  });

  it('uses translated live region messages when available', () => {
    globalThis.Theme = { translations: { recipient_form_fields_visible: 'Visible!' } };
    const { el, refs } = mount();
    el.toggleRecipientForm('recipient_form');
    expect(refs.liveRegion.textContent).toBe('Visible!');
  });

  it('rejects invalid delivery modes', () => {
    const { el } = mount();
    expect(() => el.toggleRecipientForm('nope')).toThrow(/Invalid delivery mode: nope/);
  });

  it('shows field errors from a cart error event', () => {
    const { el, refs } = mount();
    el.toggleRecipientForm('recipient_form');
    document.dispatchEvent(
      new CartErrorEvent('x', 'Bad input', null, {
        email: ['is invalid', 'is required'],
        send_on: 'is too late',
        unknown: ['ignored'],
      })
    );
    const emailError = el.querySelector('[ref="emailError"]');
    expect(emailError.classList.contains('hidden')).toBe(false);
    expect(emailError.querySelector('span').textContent).toBe('is invalid, is required.');
    expect(el.querySelector('[ref="sendOnError"] span').textContent).toBe('is too late.');
    expect(el.querySelector('[ref="nameError"]').classList.contains('hidden')).toBe(true);
    expect(refs.recipientEmail.getAttribute('aria-invalid')).toBe('true');
    expect(refs.recipientEmail.getAttribute('aria-describedby')).toBe('RecipientForm-email-error-main');
    expect(refs.liveRegion.textContent).toBe('Bad input');

    // A cart update clears the errors
    document.dispatchEvent(new Event(ThemeEvents.cartUpdate));
    expect(emailError.classList.contains('hidden')).toBe(true);
    expect(emailError.querySelector('span').textContent).toBe('');
    expect(refs.recipientEmail.hasAttribute('aria-invalid')).toBe(false);
    expect(refs.liveRegion.textContent).toBe('');
  });

  it('falls back to default titles and message-only errors', () => {
    const { el, refs } = mount();
    document.dispatchEvent(new CartErrorEvent('x', '', null, { name: 'missing' }));
    expect(refs.liveRegion.textContent).toBe('There was an error');
    expect(el.querySelector('[ref="nameError"] span').textContent).toBe('missing.');

    document.dispatchEvent(new CartErrorEvent('x', 'Only a message', 'desc', null));
    expect(refs.liveRegion.textContent).toBe('Only a message');
    expect(el.querySelector('[ref="nameError"]').classList.contains('hidden')).toBe(true);

    // Events without data or message are ignored
    refs.liveRegion.textContent = 'keep';
    document.dispatchEvent(new CartErrorEvent('x', '', null, null));
    const bare = new Event(ThemeEvents.cartError);
    document.dispatchEvent(bare);
    expect(refs.liveRegion.textContent).toBe('keep');
  });

  it('works without the optional refs', () => {
    const { el, refs } = mount({ optional: false });
    el.toggleRecipientForm('recipient_form');
    expect(refs.recipientFields.hidden).toBe(false);
    document.dispatchEvent(new CartErrorEvent('x', 'Oops', null, { email: 'bad', message: ['long'] }));
    expect(refs.recipientEmail.getAttribute('aria-invalid')).toBe('true');
    expect(refs.recipientMessage.getAttribute('aria-describedby')).toBe('RecipientForm-message-error-main');
    el.toggleRecipientForm('self');
    expect(refs.recipientEmail.hasAttribute('aria-invalid')).toBe(false);
  });

  it('skips character count without a template', () => {
    const { el, refs } = mount();
    delete refs.characterCount.dataset.template;
    refs.characterCount.textContent = 'static';
    el.toggleRecipientForm('recipient_form');
    expect(refs.characterCount.textContent).toBe('static');
  });

  it('removes document listeners on disconnect', () => {
    const { el, refs } = mount();
    el.remove();
    document.dispatchEvent(new CartErrorEvent('x', 'After removal', null, { email: 'x' }));
    expect(refs.liveRegion.textContent).toBe('');
    refs.recipientMessage.value = 'abcd';
    refs.recipientMessage.dispatchEvent(new Event('input'));
    expect(refs.characterCount.textContent).toBe('0 of 200');
    // Second disconnect path with already-cleared handlers
    document.body.appendChild(el);
    el.remove();
  });
});
