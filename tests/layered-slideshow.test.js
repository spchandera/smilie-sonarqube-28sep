import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mediaQueryLarge } from '@theme/utilities';
import { LayeredSlideshowComponent } from '@theme/layered-slideshow';

/** @type {Array<{ callback: Function, observed: Element[] }>} */
let resizeObservers = [];
/** @type {Set<Function>} */
let mediaListeners = new Set();
const originalAdd = mediaQueryLarge.addEventListener;
const originalRemove = mediaQueryLarge.removeEventListener;
const originalMatches = mediaQueryLarge.matches;

class TrackingResizeObserver {
  constructor(callback) {
    this.callback = callback;
    this.observed = [];
    resizeObservers.push(this);
  }
  observe(el) {
    this.observed.push(el);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
}

function setDesktop(isDesktop) {
  mediaQueryLarge.matches = isDesktop;
}

function panelHtml(i, { video = false, focusables = 1 } = {}) {
  const buttons = Array.from({ length: focusables }, (_, n) => `<button class="f${n}">b${i}-${n}</button>`).join('');
  return `
    <div ref="panels[]" role="tabpanel" class="panel-${i}">
      <div class="layered-slideshow__content"><div class="group-block-content">${buttons}</div></div>
      ${video ? '<video></video>' : ''}
    </div>`;
}

function mount({ count = 3, selected = 0, size = '', video = false, focusables = 1 } = {}) {
  const tabs = Array.from(
    { length: count },
    (_, i) => `<button ref="tabs[]" role="tab" aria-selected="${i === selected}">Tab ${i}</button>`
  ).join('');
  const panels = Array.from({ length: count }, (_, i) => panelHtml(i, { video, focusables })).join('');
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <layered-slideshow-component>
      <div ref="container" ${size ? `size="${size}"` : ''}>${tabs}${panels}</div>
    </layered-slideshow-component>`;
  const container = wrapper.querySelector('[ref="container"]');
  container.getBoundingClientRect = () => ({ width: 1000, height: 600, top: 0, left: 0, right: 1000, bottom: 600 });
  document.body.appendChild(wrapper);
  const el = wrapper.querySelector('layered-slideshow-component');
  return {
    el,
    container,
    tabs: [...el.querySelectorAll('[role="tab"]')],
    panels: [...el.querySelectorAll('[role="tabpanel"]')],
  };
}

function pointer(type, target, clientX) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  resizeObservers = [];
  mediaListeners = new Set();
  vi.stubGlobal('ResizeObserver', TrackingResizeObserver);
  vi.stubGlobal('requestAnimationFrame', (cb) => {
    cb(0);
    return 1;
  });
  mediaQueryLarge.addEventListener = (_type, fn) => mediaListeners.add(fn);
  mediaQueryLarge.removeEventListener = (_type, fn) => mediaListeners.delete(fn);
  setDesktop(true);
});

afterEach(() => {
  document.body.innerHTML = '';
  mediaQueryLarge.addEventListener = originalAdd;
  mediaQueryLarge.removeEventListener = originalRemove;
  mediaQueryLarge.matches = originalMatches;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('LayeredSlideshowComponent', () => {
  it('is registered as a custom element', () => {
    expect(customElements.get('layered-slideshow-component')).toBe(LayeredSlideshowComponent);
  });

  it('does nothing without tabs', () => {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = '<layered-slideshow-component><div ref="container"></div></layered-slideshow-component>';
    document.body.appendChild(wrapper);
    expect(mediaListeners.size).toBe(0);
    expect(wrapper.querySelector('[ref="container"]').style.getPropertyValue('--active-tab')).toBe('');
  });

  it('initialises the active tab from aria-selected and sets grid sizes', () => {
    const { tabs, panels, container } = mount({ selected: 1 });
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
    expect(panels.map((p) => p.hasAttribute('inert'))).toEqual([true, false, true]);
    // 1000 - 56 * 2 = 888
    expect(container.style.getPropertyValue('--active-tab')).toBe('56px 888px 56px');
  });

  it('activates a tab on click and via the public select method', () => {
    const { el, tabs, container } = mount();
    tabs[2].click();
    expect(tabs[2].getAttribute('aria-selected')).toBe('true');
    expect(container.style.getPropertyValue('--active-tab')).toBe('56px 56px 888px');

    el.select(0, { instant: true });
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(container.dataset.instantTransitions).toBeUndefined();

    // Out of range and same index are ignored
    el.select(5);
    el.select(-1);
    el.select(0);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  });

  it('keeps instant transitions until the double rAF completes', () => {
    const frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb) => frames.push(cb));
    const { el, container } = mount();
    el.select(1, { instant: true });
    expect(container.dataset.instantTransitions).toBe('');
    frames.shift()();
    frames.shift()();
    expect(container.dataset.instantTransitions).toBeUndefined();
  });

  it('plays the active panel video and pauses the rest', () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    mount({ video: true });
    expect(play).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalledTimes(2);
  });

  it('navigates with arrow, Home and End keys on desktop', () => {
    const { tabs } = mount();
    const key = (target, k) =>
      target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

    key(tabs[0], 'ArrowRight');
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs[1]);

    key(tabs[1], 'End');
    expect(tabs[2].getAttribute('aria-selected')).toBe('true');

    key(tabs[2], 'ArrowRight');
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');

    key(tabs[0], 'ArrowLeft');
    expect(tabs[2].getAttribute('aria-selected')).toBe('true');

    key(tabs[2], 'Home');
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');

    // Unmapped keys and non-tab targets are ignored
    key(tabs[0], 'a');
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  });

  it('ignores keydown from non-tab elements', () => {
    const { panels, tabs } = mount();
    panels[0]
      .querySelector('button')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  });

  it('uses vertical arrow keys on mobile', () => {
    setDesktop(false);
    const { tabs, container } = mount();
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    // Mobile uses height (600) and 44px inactive tabs: 600 - 88 = 512
    expect(container.style.getPropertyValue('--active-tab')).toBe('44px 512px 44px');
    tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  });

  it('activates on focus only when focus-visible', () => {
    const { tabs } = mount();
    const matches = vi.spyOn(Element.prototype, 'matches').mockReturnValue(false);
    tabs[1].dispatchEvent(new FocusEvent('focus'));
    expect(tabs[1].getAttribute('aria-selected')).toBe('false');
    matches.mockReturnValue(true);
    tabs[1].dispatchEvent(new FocusEvent('focus'));
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
  });

  it('moves between panels with Tab and Shift+Tab at the edges', () => {
    const { panels, tabs } = mount({ focusables: 2 });
    const last = panels[0].querySelector('.f1');
    last.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    last.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(panels[1].querySelector('.f0'));

    const first = panels[1].querySelector('.f0');
    const shiftTab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    first.dispatchEvent(shiftTab);
    expect(shiftTab.defaultPrevented).toBe(true);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(panels[0].querySelector('.f1'));

    // Shift+Tab on first panel does not move
    const f0 = panels[0].querySelector('.f0');
    f0.focus();
    const noop = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    f0.dispatchEvent(noop);
    expect(noop.defaultPrevented).toBe(false);

    // Other keys are ignored
    const other = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    f0.dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
  });

  it('moves focus to the panel itself when it has no focusable elements', () => {
    const { panels, tabs } = mount({ focusables: 0 });
    // panels have tabindex, but active panel is focusable via tabindex="0"; make panel 0 the active element
    panels[0].focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    panels[0].dispatchEvent(tab);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(panels[1]);

    const shiftTab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    panels[1].dispatchEvent(shiftTab);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(panels[0]);
  });

  it('completes a drag past the threshold and prevents the follow-up click', () => {
    vi.useFakeTimers();
    const { tabs, container } = mount();
    const down = pointer('pointerdown', container, 500);
    expect(down.defaultPrevented).toBe(true);

    // Below threshold: nothing happens
    pointer('pointermove', document, 502);
    expect(container.dataset.dragging).toBeUndefined();

    // Drag left towards next tab
    pointer('pointermove', document, 100);
    expect(container.dataset.dragging).toBe('');
    // max = 800, progress = 400/800 = 0.5 -> active 888 - 832*0.5 = 472, target 56 + 416 = 472
    expect(container.style.getPropertyValue('--active-tab')).toBe('472px 472px 56px');

    pointer('pointerup', document, 100);
    expect(container.hasAttribute('data-dragging')).toBe(false);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');

    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    tabs[2].dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(tabs[2].getAttribute('aria-selected')).toBe('false');

    vi.advanceTimersByTime(100);
    tabs[2].click();
    expect(tabs[2].getAttribute('aria-selected')).toBe('true');
  });

  it('reverts a short drag and handles wrong direction', () => {
    vi.useFakeTimers();
    const { tabs, container } = mount({ selected: 1 });
    pointer('pointerdown', container, 500);
    // Drag right towards previous tab
    pointer('pointermove', document, 600);
    expect(container.dataset.dragging).toBe('');
    // Wrong direction afterwards gives zero progress
    pointer('pointermove', document, 400);
    expect(container.style.getPropertyValue('--active-tab')).toBe('56px 888px 56px');
    pointer('pointercancel', document, 400);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    vi.advanceTimersByTime(100);
  });

  it('does not start dragging past the last tab or when no adjacent tab exists', () => {
    const { container, tabs } = mount({ selected: 2 });
    pointer('pointerdown', container, 500);
    pointer('pointermove', document, 100); // left drag, but active is last
    expect(container.dataset.dragging).toBeUndefined();
    pointer('pointerup', document, 100);
    expect(tabs[2].getAttribute('aria-selected')).toBe('true');

    // Pointer down on the active tab ignored
    const ev = pointer('pointerdown', tabs[2], 10);
    expect(ev.defaultPrevented).toBe(false);
    // Pointer down on an earlier tab starts a drag targeting it
    const ev2 = pointer('pointerdown', tabs[0], 10);
    expect(ev2.defaultPrevented).toBe(true);
    pointer('pointermove', document, 900);
    expect(container.dataset.dragging).toBe('');
    pointer('pointerup', document, 900);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  });

  it('ignores pointerdown on the tab after the active one when it is the last', () => {
    const { container, tabs } = mount({ selected: 1 });
    const ev = pointer('pointerdown', tabs[2], 10);
    expect(ev.defaultPrevented).toBe(false);
    expect(container.dataset.dragging).toBeUndefined();
  });

  it('does not attach drag handlers on mobile', () => {
    setDesktop(false);
    const { container } = mount();
    const ev = pointer('pointerdown', container, 10);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('updates grid sizes from ResizeObserver entries', () => {
    const { container } = mount();
    const observer = resizeObservers.find((o) => o.observed.includes(container));
    observer.callback([{ contentBoxSize: [{ inlineSize: 500, blockSize: 300 }] }]);
    expect(container.style.getPropertyValue('--active-tab')).toBe('388px 56px 56px');
    observer.callback([{ contentBoxSize: [], contentRect: { width: 400, height: 200 } }]);
    expect(container.style.getPropertyValue('--active-tab')).toBe('288px 56px 56px');
    observer.callback([{ contentRect: { width: 1 } }]);
    expect(container.style.getPropertyValue('--active-tab')).toBe('288px 56px 56px');
  });

  it('syncs desktop height to content in auto mode', () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 320 });
    try {
      const { el, container } = mount({ size: 'auto' });
      expect(container.style.height).toBe('320px');
      expect(el.style.minHeight).toBe('320px');
    } finally {
      delete HTMLElement.prototype.scrollHeight;
    }
  });

  it('syncs desktop height when content exceeds the CSS min height', () => {
    let height = 400;
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => height });
    try {
      const { el, container } = mount();
      expect(container.style.height).toBe('400px');
      expect(el.style.minHeight).toBe('400px');

      // Shrink content: inline heights are cleared
      height = 0;
      const heightObserver = resizeObservers.find((o) => o.observed.some((n) => n.classList?.contains('group-block-content')));
      heightObserver.callback([]);
      expect(container.style.height).toBe('');
      expect(el.style.minHeight).toBe('');
    } finally {
      delete HTMLElement.prototype.scrollHeight;
    }
  });

  it('syncs mobile height using the CSS variable or defaults', async () => {
    setDesktop(false);
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 100 });
    try {
      const { container } = mount();
      // default 260 + 2 * 44
      expect(container.style.getPropertyValue('--active-panel-height')).toBe('260px');
      expect(container.style.height).toBe('348px');
      document.body.innerHTML = '';

      const auto = mount({ size: 'auto' });
      expect(auto.container.style.getPropertyValue('--active-panel-height')).toBe('150px');
      document.body.innerHTML = '';

      const withVar = mount();
      withVar.el.style.setProperty('--layered-panel-height-mobile', '300px');
      withVar.container.querySelector('.group-block-content').appendChild(document.createElement('span'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(withVar.container.style.getPropertyValue('--active-panel-height')).toBe('300px');
    } finally {
      delete HTMLElement.prototype.scrollHeight;
    }
  });

  it('re-initialises when crossing the breakpoint', () => {
    const { container, tabs } = mount();
    expect(mediaListeners.size).toBe(1);
    const [handler] = mediaListeners;

    // No change: nothing happens
    handler();
    expect(container.style.getPropertyValue('--active-tab')).toBe('888px 56px 56px');

    setDesktop(false);
    handler();
    expect(container.dataset.instantTransitions).toBeUndefined();
    expect(container.style.getPropertyValue('--active-tab')).toBe('512px 44px 44px');
    expect(container.style.getPropertyValue('--active-panel-height')).not.toBe('');

    // Mobile no longer handles drag
    expect(pointer('pointerdown', container, 5).defaultPrevented).toBe(false);
    tabs[1].click();
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');

    setDesktop(true);
    handler();
    expect(container.style.getPropertyValue('--active-panel-height')).toBe('');
  });

  it('cleans up observers and listeners on disconnect', () => {
    const { el, tabs } = mount();
    const observers = [...resizeObservers];
    el.remove();
    expect(mediaListeners.size).toBe(0);
    expect(observers.every((o) => o.disconnected)).toBe(true);
    tabs[1].click();
    expect(tabs[1].getAttribute('aria-selected')).toBe('false');
  });
});
