import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';

let utilities;
let FloatingPanelComponent;

beforeAll(async () => {
  // utilities.js captures setTimeout as its requestIdleCallback fallback at import time,
  // so fake timers must be installed before the modules load.
  vi.useFakeTimers();
  vi.resetModules();
  utilities = await import('@theme/utilities');
  ({ FloatingPanelComponent } = await import('@theme/floating-panel'));
});

afterAll(() => {
  vi.useRealTimers();
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  utilities.viewTransition.current = undefined;
});

function mount(html, rect) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  const panel = wrapper.querySelector('floating-panel-component');
  panel.getBoundingClientRect = () => rect;
  document.body.appendChild(wrapper);
  return { wrapper, panel };
}

const rect = (left, right) => ({ left, right, top: 0, bottom: 10, width: right - left, height: 10 });

describe('FloatingPanelComponent', () => {
  it('is registered as a custom element', () => {
    expect(customElements.get('floating-panel-component')).toBe(FloatingPanelComponent);
  });

  it('offsets the panel from the top when it fits in the viewport', async () => {
    vi.stubGlobal('innerWidth', 1000);
    const { panel } = mount('<floating-panel-component></floating-panel-component>', rect(100, 400));
    await vi.runOnlyPendingTimersAsync();
    expect(panel.style.top).toBe('40px');
    expect(panel.style.left).toBe('');
  });

  it('shifts left when overflowing the right edge of the viewport', async () => {
    vi.stubGlobal('innerWidth', 1000);
    const { panel } = mount('<floating-panel-component></floating-panel-component>', rect(800, 1100));
    await vi.runOnlyPendingTimersAsync();
    expect(panel.style.left).toBe('-140px');
  });

  it('shifts right when overflowing the left edge of the viewport', async () => {
    vi.stubGlobal('innerWidth', 1000);
    const { panel } = mount('<floating-panel-component></floating-panel-component>', rect(-60, 200));
    await vi.runOnlyPendingTimersAsync();
    expect(panel.style.left).toBe('100px');
  });

  it('waits for an active view transition before measuring', async () => {
    vi.stubGlobal('innerWidth', 1000);
    let finish;
    utilities.viewTransition.current = new Promise((resolve) => {
      finish = resolve;
    });
    const { panel } = mount('<floating-panel-component></floating-panel-component>', rect(0, 100));
    await vi.runOnlyPendingTimersAsync();
    expect(panel.style.top).toBe('');
    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(panel.style.top).toBe('40px');
  });

  it('repositions when its attributes change', async () => {
    vi.stubGlobal('innerWidth', 1000);
    let current = rect(100, 200);
    const { panel } = mount('<floating-panel-component></floating-panel-component>', current);
    panel.getBoundingClientRect = () => current;
    await vi.runOnlyPendingTimersAsync();
    expect(panel.style.left).toBe('');

    current = rect(900, 1050);
    panel.setAttribute('data-state', 'open');
    await vi.advanceTimersByTimeAsync(0);
    expect(panel.style.left).toBe('-90px');
  });

  it('closes its parent details on resize when data-close-on-resize is true', async () => {
    vi.stubGlobal('innerWidth', 1000);
    const { wrapper } = mount(
      '<details open><summary>Menu</summary><floating-panel-component data-close-on-resize="true"></floating-panel-component></details>',
      rect(0, 100)
    );
    const details = wrapper.querySelector('details');
    await vi.runOnlyPendingTimersAsync();

    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(99);
    expect(details.open).toBe(true);
    vi.advanceTimersByTime(1);
    expect(details.open).toBe(false);
    expect(details.hasAttribute('open')).toBe(false);
  });

  it('keeps the parent details open without data-close-on-resize', async () => {
    const { wrapper } = mount(
      '<details open><summary>Menu</summary><floating-panel-component></floating-panel-component></details>',
      rect(0, 100)
    );
    window.dispatchEvent(new Event('resize'));
    await vi.advanceTimersByTimeAsync(200);
    expect(wrapper.querySelector('details').open).toBe(true);
  });

  it('removes its resize listener when disconnected', async () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { panel } = mount('<floating-panel-component></floating-panel-component>', rect(0, 100));
    await vi.runOnlyPendingTimersAsync();
    panel.remove();
    expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function));
  });
});
