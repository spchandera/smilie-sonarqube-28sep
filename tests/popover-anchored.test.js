import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';

const POPOVER_PROPS = ['popover', 'showPopover', 'hidePopover', 'togglePopover'];
const savedDescriptors = {};
let cssSupports = false;

beforeAll(async () => {
  // utilities.js captures setTimeout as its requestIdleCallback fallback at import time,
  // so fake timers must be installed before the modules load.
  vi.useFakeTimers();
  vi.stubGlobal('CSS', { supports: vi.fn(() => cssSupports) });

  // Install the popover polyfill so :popover-open and showPopover work in jsdom.
  for (const prop of POPOVER_PROPS) {
    savedDescriptors[prop] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
    delete HTMLElement.prototype[prop];
  }
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
  await import('@theme/anchored-popover');
});

afterAll(() => {
  for (const prop of POPOVER_PROPS) {
    delete HTMLElement.prototype[prop];
    if (savedDescriptors[prop]) Object.defineProperty(HTMLElement.prototype, prop, savedDescriptors[prop]);
  }
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

afterEach(() => {
  for (const element of document.querySelectorAll('.\\:popover-open')) element.hidePopover();
  document.body.innerHTML = '';
  vi.clearAllTimers();
  cssSupports = false;
  vi.restoreAllMocks();
});

function mount(attrs = '') {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <anchored-popover-component ${attrs}>
      <button ref="trigger" popovertarget="menu">Open</button>
      <div ref="popover" id="menu" popover>Menu</div>
    </anchored-popover-component>`;
  const component = wrapper.querySelector('anchored-popover-component');
  const trigger = wrapper.querySelector('button');
  trigger.getBoundingClientRect = () => ({ top: 10, left: 20, right: 120, bottom: 50, width: 100, height: 40 });
  document.body.appendChild(wrapper);
  return { component, trigger, popover: wrapper.querySelector('#menu') };
}

const isOpen = (popover) => popover.matches(':popover-open');

describe('AnchoredPopoverComponent', () => {
  it('is registered and exposes its defaults', async () => {
    const { AnchoredPopoverComponent } = await import('@theme/anchored-popover');
    expect(customElements.get('anchored-popover-component')).toBe(AnchoredPopoverComponent);
    const { component } = mount();
    expect(component.requiredRefs).toEqual(['popover', 'trigger']);
    expect(component.interaction_delay).toBe(200);
  });

  it('inlines anchor custom properties when CSS anchor positioning is unsupported', () => {
    vi.stubGlobal('innerWidth', 1000);
    vi.stubGlobal('innerHeight', 800);
    const { popover, trigger } = mount();

    // Idle callback computes the initial position.
    vi.runOnlyPendingTimers();
    expect(popover.style.getPropertyValue('--anchor-top')).toBe('10');
    expect(popover.style.getPropertyValue('--anchor-right')).toBe('880');
    expect(popover.style.getPropertyValue('--anchor-bottom')).toBe('750');
    expect(popover.style.getPropertyValue('--anchor-left')).toBe('20');
    expect(popover.style.getPropertyValue('--anchor-height')).toBe('40');
    expect(popover.style.getPropertyValue('--anchor-width')).toBe('100');

    // Position is refreshed each time the popover toggles.
    trigger.getBoundingClientRect = () => ({ top: 5, left: 0, right: 10, bottom: 15, width: 10, height: 10 });
    popover.showPopover();
    expect(popover.style.getPropertyValue('--anchor-top')).toBe('5');
    expect(popover.style.getPropertyValue('--anchor-width')).toBe('10');
  });

  it('leaves positioning to CSS when anchor positioning is supported', () => {
    cssSupports = true;
    const { popover } = mount();
    vi.runOnlyPendingTimers();
    popover.showPopover();
    expect(CSS.supports).toHaveBeenCalledWith('position-anchor: --trigger');
    expect(popover.style.getPropertyValue('--anchor-top')).toBe('');
  });

  it('closes the popover on window resize when data-close-on-resize is set', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { popover } = mount('data-close-on-resize="true"');

    popover.showPopover();
    expect(isOpen(popover)).toBe(true);
    expect(addSpy).toHaveBeenCalledWith('resize', expect.any(Function));

    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(99);
    expect(isOpen(popover)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(isOpen(popover)).toBe(false);
    expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function));
  });

  it('does nothing on resize when the popover is already closed', () => {
    const { popover } = mount('data-close-on-resize="true"');
    popover.showPopover();
    popover.hidePopover();
    const hideSpy = vi.spyOn(popover, 'hidePopover');
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(200);
    expect(hideSpy).not.toHaveBeenCalled();
  });

  it('opens and closes on hover when data-hover-triggered is set', () => {
    const { component, trigger, popover } = mount('data-hover-triggered="true"');

    trigger.dispatchEvent(new Event('pointerenter'));
    expect(trigger.dataset.hoverActive).toBe('true');
    vi.advanceTimersByTime(component.interaction_delay - 1);
    expect(isOpen(popover)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(isOpen(popover)).toBe(true);

    // Entering again while open does not schedule another show.
    trigger.dispatchEvent(new Event('pointerenter'));

    trigger.dispatchEvent(new Event('pointerleave'));
    expect(trigger.dataset.hoverActive).toBeUndefined();
    vi.advanceTimersByTime(component.interaction_delay);
    expect(isOpen(popover)).toBe(false);
  });

  it('cancels a pending show when the pointer leaves quickly', () => {
    const { trigger, popover } = mount('data-hover-triggered="true"');
    trigger.dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(50);
    trigger.dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(500);
    expect(isOpen(popover)).toBe(false);
  });

  it('does not show if hover ended without the leave handler clearing the timer', () => {
    const { trigger, popover } = mount('data-hover-triggered="true"');
    trigger.dispatchEvent(new Event('pointerenter'));
    delete trigger.dataset.hoverActive;
    vi.advanceTimersByTime(500);
    expect(isOpen(popover)).toBe(false);
  });

  it('keeps the popover open while hovered and closes after leaving it', () => {
    const { trigger, popover } = mount('data-hover-triggered="true"');
    trigger.dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(200);
    expect(isOpen(popover)).toBe(true);

    trigger.dispatchEvent(new Event('pointerleave'));
    popover.dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(500);
    expect(isOpen(popover)).toBe(true);

    popover.dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(199);
    expect(isOpen(popover)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(isOpen(popover)).toBe(false);
  });

  it('removes its resize listener when disconnected', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { component } = mount('data-close-on-resize="true"');
    component.remove();
    expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function));
  });
});
