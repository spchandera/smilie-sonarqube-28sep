import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';

const POPOVER_PROPS = ['popover', 'showPopover', 'hidePopover', 'togglePopover'];
const savedDescriptors = {};
const documentListeners = {};

function mount(html) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper);
  return wrapper;
}

function trustedPointer(type, target) {
  return { isTrusted: true, type, composedPath: () => [target] };
}

function lightDismiss(target) {
  for (const handler of documentListeners.pointerdown) handler(trustedPointer('pointerdown', target));
  for (const handler of documentListeners.pointerup) handler(trustedPointer('pointerup', target));
}

beforeAll(async () => {
  // Remove any native implementation so the polyfill installs itself.
  for (const prop of POPOVER_PROPS) {
    savedDescriptors[prop] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
    delete HTMLElement.prototype[prop];
  }

  const originalAdd = document.addEventListener.bind(document);
  const spy = vi.spyOn(document, 'addEventListener').mockImplementation((type, handler, options) => {
    (documentListeners[type] ||= []).push(handler);
    return originalAdd(type, handler, options);
  });

  // jsdom has constructable stylesheets but no adoptedStyleSheets; force the <style> fallback.
  vi.stubGlobal(
    'CSSStyleSheet',
    class {
      replaceSync() {
        throw new Error('not supported');
      }
    }
  );

  vi.resetModules();
  await import('@theme/popover-polyfill');
  spy.mockRestore();
});

afterAll(() => {
  vi.unstubAllGlobals();
  for (const prop of POPOVER_PROPS) {
    delete HTMLElement.prototype[prop];
    if (savedDescriptors[prop]) Object.defineProperty(HTMLElement.prototype, prop, savedDescriptors[prop]);
  }
});

afterEach(() => {
  for (const element of document.querySelectorAll('.\\:popover-open')) {
    element.hidePopover();
  }
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('installation', () => {
  it('registers the popover API, ToggleEvent and document listeners', () => {
    expect(typeof HTMLElement.prototype.showPopover).toBe('function');
    expect(typeof HTMLElement.prototype.hidePopover).toBe('function');
    expect(typeof HTMLElement.prototype.togglePopover).toBe('function');
    expect(typeof window.ToggleEvent).toBe('function');
    expect(Object.keys(documentListeners)).toEqual(
      expect.arrayContaining(['click', 'keydown', 'pointerdown', 'pointerup'])
    );
  });

  it('creates ToggleEvent instances with normalised states', () => {
    const event = new window.ToggleEvent('toggle', { oldState: 'open', newState: 'closed' });
    expect(event.oldState).toBe('open');
    expect(event.newState).toBe('closed');
    const empty = new window.ToggleEvent('toggle');
    expect(empty.oldState).toBe('');
    expect(empty.newState).toBe('');
  });

  it('injects polyfill styles into new shadow roots', () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    expect(shadow.querySelector('style')?.textContent).toContain(':popover-open');
    expect(document.head.querySelector('style')?.textContent).toContain('[popover]');
  });

  it('wraps attachInternals without breaking it', () => {
    class InternalsHost extends HTMLElement {
      static formAssociated = true;
    }
    customElements.define('internals-host', InternalsHost);
    const el = document.createElement('internals-host');
    el.attachShadow({ mode: 'open' });
    const internals = el.attachInternals();
    expect(internals).toBeTruthy();
  });
});

describe('popover attribute reflection', () => {
  it('maps attribute values to popover states', () => {
    const el = document.createElement('div');
    expect(el.popover).toBeNull();
    el.setAttribute('popover', '');
    expect(el.popover).toBe('auto');
    el.setAttribute('popover', 'AUTO');
    expect(el.popover).toBe('auto');
    el.setAttribute('popover', 'hint');
    expect(el.popover).toBe('hint');
    el.setAttribute('popover', 'manual');
    expect(el.popover).toBe('manual');
    el.setAttribute('popover', 'bogus');
    expect(el.popover).toBe('manual');
  });

  it('sets and removes the attribute through the property', () => {
    const el = document.createElement('div');
    el.popover = 'manual';
    expect(el.getAttribute('popover')).toBe('manual');
    el.popover = null;
    expect(el.hasAttribute('popover')).toBe(false);
  });
});

describe('showPopover / hidePopover', () => {
  it('opens an auto popover, firing beforetoggle then toggle', () => {
    vi.useFakeTimers();
    const root = mount('<div id="p" popover>content</div>');
    const popover = root.querySelector('#p');
    const events = [];
    popover.addEventListener('beforetoggle', (e) => events.push(['beforetoggle', e.oldState, e.newState]));
    popover.addEventListener('toggle', (e) => events.push(['toggle', e.oldState, e.newState]));

    popover.showPopover();

    expect(popover.classList.contains(':popover-open')).toBe(true);
    expect(popover.matches(':popover-open')).toBe(true);
    expect(document.querySelector(':popover-open')).toBe(popover);
    expect(root.querySelectorAll('[popover]:popover-open')).toHaveLength(1);
    expect(popover.closest(':popover-open')).toBe(popover);
    expect(events).toEqual([['beforetoggle', 'closed', 'open']]);

    vi.runAllTimers();
    expect(events.at(-1)).toEqual(['toggle', 'closed', 'open']);

    popover.hidePopover();
    expect(popover.matches(':popover-open')).toBe(false);
    vi.runAllTimers();
    expect(events.slice(2)).toEqual([
      ['beforetoggle', 'open', 'closed'],
      ['toggle', 'open', 'closed'],
    ]);
  });

  it('does not open when beforetoggle is cancelled', () => {
    const root = mount('<div id="p" popover>content</div>');
    const popover = root.querySelector('#p');
    popover.addEventListener('beforetoggle', (e) => e.preventDefault());
    popover.showPopover();
    expect(popover.matches(':popover-open')).toBe(false);
  });

  it('ignores elements that are not valid popovers', () => {
    const root = mount('<div id="plain">x</div><dialog id="d" popover open>d</dialog>');
    const plain = root.querySelector('#plain');
    const listener = vi.fn();
    plain.addEventListener('beforetoggle', listener);
    plain.showPopover();
    expect(listener).not.toHaveBeenCalled();

    const dialog = root.querySelector('#d');
    dialog.showPopover();
    expect(dialog.classList.contains(':popover-open')).toBe(false);

    const detached = document.createElement('div');
    detached.popover = 'auto';
    detached.showPopover();
    expect(detached.classList.contains(':popover-open')).toBe(false);
  });

  it('does not reopen an already open popover or hide a closed one', () => {
    const root = mount('<div id="p" popover="manual">content</div>');
    const popover = root.querySelector('#p');
    const listener = vi.fn();
    popover.addEventListener('beforetoggle', listener);
    popover.hidePopover();
    expect(listener).not.toHaveBeenCalled();
    popover.showPopover();
    popover.showPopover();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('aborts showing if beforetoggle changes the popover type', () => {
    const root = mount('<div id="other" popover>other</div><div id="p" popover>content</div>');
    const other = root.querySelector('#other');
    const popover = root.querySelector('#p');
    other.showPopover();
    // Closing the other auto popover mutates the popover being shown.
    other.addEventListener('beforetoggle', () => popover.setAttribute('popover', 'manual'), { once: true });
    popover.showPopover();
    expect(other.matches(':popover-open')).toBe(false);
    expect(popover.matches(':popover-open')).toBe(false);
  });
});

describe('togglePopover', () => {
  it('toggles and honours the force argument', () => {
    const root = mount('<div id="p" popover="manual">content</div>');
    const popover = root.querySelector('#p');
    expect(popover.togglePopover()).toBe(true);
    expect(popover.togglePopover()).toBe(false);
    expect(popover.togglePopover(true)).toBe(true);
    expect(popover.togglePopover(true)).toBe(true);
    expect(popover.togglePopover({ force: false })).toBe(false);
    expect(popover.togglePopover(false)).toBe(false);
    expect(popover.togglePopover({ force: true })).toBe(true);
  });
});

describe('popover stacking', () => {
  it('closes other auto popovers but leaves manual ones open', () => {
    const root = mount(`
      <div id="a" popover>a</div>
      <div id="b" popover>b</div>
      <div id="m" popover="manual">m</div>`);
    const [a, b, m] = ['#a', '#b', '#m'].map((s) => root.querySelector(s));
    m.showPopover();
    a.showPopover();
    b.showPopover();
    expect(a.matches(':popover-open')).toBe(false);
    expect(b.matches(':popover-open')).toBe(true);
    expect(m.matches(':popover-open')).toBe(true);
    m.hidePopover();
  });

  it('keeps an ancestor auto popover open when showing a nested one', () => {
    const root = mount(`
      <div id="parent" popover>
        <div id="child" popover>child</div>
      </div>`);
    const parent = root.querySelector('#parent');
    const child = root.querySelector('#child');
    parent.showPopover();
    child.showPopover();
    expect(parent.matches(':popover-open')).toBe(true);
    expect(child.matches(':popover-open')).toBe(true);

    // Hiding the parent hides the nested popover as well.
    parent.hidePopover();
    expect(child.matches(':popover-open')).toBe(false);
    expect(parent.matches(':popover-open')).toBe(false);
  });

  it('manages hint popovers alongside auto popovers', () => {
    const root = mount(`
      <div id="auto" popover>
        <div id="nestedHint" popover="hint">nested</div>
      </div>
      <div id="hint1" popover="hint">h1</div>
      <div id="hint2" popover="hint">h2</div>`);
    const auto = root.querySelector('#auto');
    const nestedHint = root.querySelector('#nestedHint');
    const hint1 = root.querySelector('#hint1');
    const hint2 = root.querySelector('#hint2');

    hint1.showPopover();
    expect(hint1.matches(':popover-open')).toBe(true);
    hint2.showPopover();
    expect(hint1.matches(':popover-open')).toBe(false);
    expect(hint2.matches(':popover-open')).toBe(true);

    // Opening an auto popover closes all hints.
    auto.showPopover();
    expect(hint2.matches(':popover-open')).toBe(false);

    // A hint nested in an open auto popover keeps the auto open.
    nestedHint.showPopover();
    expect(auto.matches(':popover-open')).toBe(true);
    expect(nestedHint.matches(':popover-open')).toBe(true);

    nestedHint.hidePopover();
    expect(auto.matches(':popover-open')).toBe(true);
    auto.hidePopover();
  });

  it('replaces a hint parent when showing a nested hint (only auto popovers act as ancestors)', () => {
    const root = mount(`
      <div id="outer" popover="hint">
        <div id="inner" popover="hint">inner</div>
      </div>`);
    const outer = root.querySelector('#outer');
    const inner = root.querySelector('#inner');
    outer.showPopover();
    inner.showPopover();
    expect(outer.matches(':popover-open')).toBe(false);
    expect(inner.matches(':popover-open')).toBe(true);
    inner.hidePopover();
  });

  it('prunes disconnected popovers from the stack', () => {
    const root = mount('<div id="a" popover>a</div><div id="b" popover>b</div>');
    const a = root.querySelector('#a');
    const b = root.querySelector('#b');
    a.showPopover();
    a.remove();
    b.showPopover();
    expect(b.matches(':popover-open')).toBe(true);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(b.matches(':popover-open')).toBe(false);
  });
});

describe('keyboard and light dismiss', () => {
  it('closes auto popovers on Escape but not on other keys or prevented events', () => {
    const root = mount('<div id="p" popover>content</div>');
    const popover = root.querySelector('#p');
    popover.showPopover();

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(popover.matches(':popover-open')).toBe(true);

    const prevented = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    prevented.preventDefault();
    document.body.dispatchEvent(prevented);
    expect(popover.matches(':popover-open')).toBe(true);

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Esc', bubbles: true }));
    expect(popover.matches(':popover-open')).toBe(false);
  });

  it('closes an auto popover when clicking outside of it', () => {
    const root = mount('<div id="p" popover><span id="inside">in</span></div><p id="outside">out</p>');
    const popover = root.querySelector('#p');
    popover.showPopover();

    lightDismiss(root.querySelector('#inside'));
    expect(popover.matches(':popover-open')).toBe(true);

    lightDismiss(root.querySelector('#outside'));
    expect(popover.matches(':popover-open')).toBe(false);
  });

  it('ignores untrusted pointer events and events with no open popover', () => {
    const root = mount('<div id="p" popover>in</div><p id="outside">out</p>');
    const popover = root.querySelector('#p');
    const outside = root.querySelector('#outside');

    // Nothing open: handler returns early.
    lightDismiss(outside);

    popover.showPopover();
    for (const handler of documentListeners.pointerup) {
      handler({ isTrusted: false, type: 'pointerup', composedPath: () => [outside] });
      handler({ isTrusted: true, type: 'pointerup', composedPath: () => [] });
    }
    expect(popover.matches(':popover-open')).toBe(true);

    // Pointer down inside but up outside does not dismiss.
    for (const h of documentListeners.pointerdown) h(trustedPointer('pointerdown', popover));
    for (const h of documentListeners.pointerup) h(trustedPointer('pointerup', outside));
    expect(popover.matches(':popover-open')).toBe(true);
  });

  it('treats a click on an invoker of a nested popover as inside the stack', () => {
    const root = mount(`
      <div id="parent" popover>
        <button id="btn" popovertarget="child">open</button>
      </div>
      <div id="child" popover>child</div>`);
    const parent = root.querySelector('#parent');
    const child = root.querySelector('#child');
    parent.showPopover();
    lightDismiss(root.querySelector('#btn'));
    expect(parent.matches(':popover-open')).toBe(true);
    expect(child.matches(':popover-open')).toBe(false);
  });
});

describe('popovertarget invokers', () => {
  it('toggles the target popover and syncs aria-expanded', () => {
    const root = mount('<button id="btn" popovertarget="p">Open</button><div id="p" popover>content</div>');
    const button = root.querySelector('#btn');
    const popover = root.querySelector('#p');

    expect(button.popoverTargetElement).toBe(popover);
    expect(button.popoverTargetAction).toBe('toggle');

    button.click();
    expect(popover.matches(':popover-open')).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('true');

    button.click();
    expect(popover.matches(':popover-open')).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('restores aria-expanded for manual popovers', () => {
    const root = mount(`
      <button id="b1" popovertarget="p">Open</button>
      <button id="b2" popovertarget="p" aria-expanded="maybe">Open</button>
      <div id="p" popover="manual">content</div>`);
    const popover = root.querySelector('#p');
    root.querySelector('#b1').click();
    expect(popover.matches(':popover-open')).toBe(true);
    expect(root.querySelector('#b1').hasAttribute('aria-expanded')).toBe(false);
    popover.hidePopover();

    root.querySelector('#b2').click();
    expect(root.querySelector('#b2').getAttribute('aria-expanded')).toBe('maybe');
    popover.hidePopover();
  });

  it('respects popovertargetaction show and hide', () => {
    const root = mount(`
      <button id="show" popovertarget="p" popovertargetaction="show">Show</button>
      <button id="hide" popovertarget="p" popovertargetaction="HIDE">Hide</button>
      <div id="p" popover>content</div>`);
    const popover = root.querySelector('#p');
    const show = root.querySelector('#show');
    const hide = root.querySelector('#hide');
    expect(hide.popoverTargetAction).toBe('hide');

    hide.click();
    expect(popover.matches(':popover-open')).toBe(false);
    show.click();
    expect(popover.matches(':popover-open')).toBe(true);
    show.click();
    expect(popover.matches(':popover-open')).toBe(true);
    hide.click();
    expect(popover.matches(':popover-open')).toBe(false);

    show.popoverTargetAction = 'hide';
    expect(show.getAttribute('popovertargetaction')).toBe('hide');
  });

  it('ignores prevented clicks and invokers without a target', () => {
    const root = mount(`
      <button id="btn" popovertarget="p">Open</button>
      <button id="missing" popovertarget="nope">Missing</button>
      <div id="p" popover>content</div>`);
    const button = root.querySelector('#btn');
    const popover = root.querySelector('#p');
    button.addEventListener('click', (e) => e.preventDefault());
    button.click();
    expect(popover.matches(':popover-open')).toBe(false);

    root.querySelector('#missing').click();
    expect(root.querySelector('#missing').popoverTargetElement).toBeNull();
  });

  it('resolves popoverTargetElement according to element type and state', () => {
    const root = mount(`
      <div id="p" popover>content</div>
      <a id="link" popovertarget="p">link</a>
      <input id="text" type="text" popovertarget="p" />
      <input id="inputBtn" type="button" popovertarget="p" />
      <button id="disabled" disabled popovertarget="p">x</button>
      <form><button id="submit" type="submit" popovertarget="p">x</button></form>`);
    const popover = root.querySelector('#p');
    expect(root.querySelector('#link').popoverTargetElement).toBeUndefined();
    expect(root.querySelector('#text').popoverTargetElement).toBeNull();
    expect(root.querySelector('#inputBtn').popoverTargetElement).toBe(popover);
    expect(root.querySelector('#disabled').popoverTargetElement).toBeNull();
    expect(root.querySelector('#submit').popoverTargetElement).toBeNull();

    const detachedButton = document.createElement('button');
    detachedButton.setAttribute('popovertarget', 'p');
    expect(detachedButton.popoverTargetElement).toBeNull();
  });

  it('supports assigning popoverTargetElement directly', () => {
    const root = mount('<button id="btn">Open</button><div id="p" popover>content</div>');
    const button = root.querySelector('#btn');
    const popover = root.querySelector('#p');

    button.popoverTargetElement = popover;
    expect(button.hasAttribute('popovertarget')).toBe(true);
    expect(button.popoverTargetElement).toBe(popover);
    button.click();
    expect(popover.matches(':popover-open')).toBe(true);
    popover.hidePopover();

    expect(() => {
      button.popoverTargetElement = 'nope';
    }).toThrow(TypeError);

    button.popoverTargetElement = null;
    expect(button.hasAttribute('popovertarget')).toBe(false);

    const detached = document.createElement('div');
    detached.popover = 'auto';
    button.popoverTargetElement = detached;
    expect(button.popoverTargetElement).toBeNull();
  });

  it('works for invokers inside a shadow root', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<button id="btn" popovertarget="sp">x</button><div id="sp" popover>shadow</div>';
    const button = shadow.querySelector('#btn');
    const popover = shadow.querySelector('#sp');
    expect(button.popoverTargetElement).toBe(popover);
    button.click();
    expect(popover.matches(':popover-open')).toBe(true);
    popover.hidePopover();
  });
});

describe('focus management', () => {
  it('focuses an autofocus descendant and restores focus on hide', () => {
    const root = mount(`
      <button id="opener">opener</button>
      <div id="p" popover><input id="field" autofocus /></div>`);
    const opener = root.querySelector('#opener');
    const popover = root.querySelector('#p');
    opener.focus();
    popover.showPopover();
    expect(document.activeElement).toBe(root.querySelector('#field'));
    popover.hidePopover();
    expect(document.activeElement).toBe(opener);
  });

  it('focuses the first focusable descendant, skipping unfocusable ones', () => {
    const root = mount(`
      <div id="p" popover="manual">
        <span>text</span>
        <button disabled>disabled</button>
        <input type="hidden" />
        <a>no href</a>
        <button hidden>hidden</button>
        <button id="target">target</button>
      </div>`);
    const popover = root.querySelector('#p');
    popover.showPopover();
    expect(document.activeElement).toBe(root.querySelector('#target'));
  });

  it('does not delegate focus into a shadow root without delegatesFocus', () => {
    const root = mount('<div id="p" popover="manual"></div>');
    const popover = root.querySelector('#p');
    const shadow = popover.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<button>inside</button>';
    popover.showPopover();
    expect(document.activeElement).toBe(document.body);
  });

  it('finds focus targets inside a delegatesFocus shadow root and slots', () => {
    const root = mount('<div id="p" popover="manual"><input id="slotted" autofocus /></div>');
    const popover = root.querySelector('#p');
    const shadow = popover.attachShadow({ mode: 'open', delegatesFocus: true });
    // jsdom does not expose ShadowRoot#delegatesFocus.
    Object.defineProperty(shadow, 'delegatesFocus', { value: true });
    shadow.innerHTML = '<slot></slot>';
    popover.showPopover();
    expect(document.activeElement).toBe(root.querySelector('#slotted'));
  });
});
