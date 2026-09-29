import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let intersectionInstances = [];

class FakeIntersectionObserver {
  constructor(callback, options) {
    this.callback = callback;
    this.options = options;
    this.observed = [];
    this.disconnect = vi.fn();
    intersectionInstances.push(this);
  }
  observe(element) {
    this.observed.push(element);
  }
  unobserve() {}
}

vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
const { OverflowList, OverflowMinimumEvent } = await import('@theme/overflow-list');

const SHADOW = `
  <template shadowrootmode="open">
    <ul part="list">
      <slot></slot>
      <slot name="more" part="more"><button>More</button></slot>
      <li part="placeholder"></li>
    </ul>
    <div part="overflow"><ul part="overflow-list"><slot name="overflow"></slot></ul></div>
  </template>`;

function rect(top, width = 50, height = 20) {
  return { top, left: 0, right: width, bottom: top + height, width, height, x: 0, y: top };
}

/**
 * Mount an <overflow-list> with the given item tops (items with top > 0 overflow).
 */
async function mountList(tops, attrs = '') {
  const wrapper = document.createElement('div');
  const items = tops.map((_, i) => `<li id="item-${i}">Item ${i}</li>`).join('');
  wrapper.innerHTML = `<overflow-list ${attrs}>${SHADOW}${items}</overflow-list>`;
  const list = wrapper.querySelector('overflow-list');
  tops.forEach((top, i) => {
    list.querySelector(`#item-${i}`).getBoundingClientRect = () => rect(top, 40 + i);
  });
  document.body.appendChild(wrapper);
  // connectedCallback awaits styles (a resolved promise) before initialising.
  await Promise.resolve();
  await Promise.resolve();
  const more = list.shadowRoot.querySelector('slot[name="more"]');
  more.getBoundingClientRect = () => rect(0);
  return list;
}

function parts(list) {
  const root = list.shadowRoot;
  return {
    list: root.querySelector('[part="list"]'),
    more: root.querySelector('slot[name="more"]'),
    placeholder: root.querySelector('[part="placeholder"]'),
  };
}

function intersect(height = 30) {
  const io = intersectionInstances.at(-1);
  io.callback([{ isIntersecting: true, boundingClientRect: { height } }]);
  vi.runOnlyPendingTimers();
  return io;
}

beforeEach(() => {
  vi.useFakeTimers();
  intersectionInstances = [];
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
});

describe('OverflowMinimumEvent', () => {
  it('bubbles with the minimumReached detail', () => {
    const event = new OverflowMinimumEvent(true);
    expect(event.type).toBe('overflowMinimum');
    expect(event.bubbles).toBe(true);
    expect(event.detail).toEqual({ minimumReached: true });
  });
});

describe('OverflowList', () => {
  it('is registered as a custom element', () => {
    expect(customElements.get('overflow-list')).toBe(OverflowList);
  });

  it('observes the first and last items for intersection', async () => {
    const list = await mountList([0, 0, 0]);
    const io = intersectionInstances.at(-1);
    expect(io.options.rootMargin).toBe('640px 360px 640px 360px');
    expect(io.observed).toEqual([list.querySelector('#item-0'), list.querySelector('#item-2')]);
    expect(list.defaultSlot).toBeInstanceOf(HTMLSlotElement);
    expect(list.overflowSlot.name).toBe('overflow');
  });

  it('observes a single item only once', async () => {
    await mountList([0]);
    expect(intersectionInstances.at(-1).observed).toHaveLength(1);
  });

  it('moves overflowing items to the overflow slot on first intersection', async () => {
    const list = await mountList([0, 0, 20, 20], 'minimum-items="3"');
    const events = [];
    list.addEventListener('overflowMinimum', (e) => events.push(e.detail.minimumReached));
    const template = list.querySelector(':scope > template');
    expect(template).not.toBeNull();

    const io = intersect(36);

    const { list: ul, more, placeholder } = parts(list);
    expect(io.disconnect).toHaveBeenCalled();
    expect(list.querySelector(':scope > template')).toBeNull();
    expect(ul.style.height).toBe('36px');
    expect(ul.style.flexWrap).toBe('wrap');
    expect(ul.style.overflow).toBe('unset');
    expect(list.querySelector('#item-0').slot).toBe('');
    expect(list.querySelector('#item-1').slot).toBe('');
    expect(list.querySelector('#item-2').slot).toBe('overflow');
    expect(list.querySelector('#item-3').slot).toBe('overflow');
    expect(list.style.getPropertyValue('--overflow-count')).toBe('2');
    expect(ul.style.getPropertyValue('counter-reset')).toBe('overflow-count 2');
    expect(more.hidden).toBe(false);
    expect(more.style.getPropertyValue('order')).toBe('');
    expect(placeholder.hidden).toBe(false);
    expect(placeholder.style.width).toBe('42px');
    expect(list.overflowSlot.assignedElements()).toHaveLength(2);

    // Two visible items is below the minimum of three.
    expect(list.hasAttribute('minimum-reached')).toBe(true);
    expect(events).toEqual([true]);
  });

  it('ignores non-intersecting entries', async () => {
    const list = await mountList([0, 20]);
    const io = intersectionInstances.at(-1);
    io.callback([{ isIntersecting: false }]);
    io.callback([]);
    vi.runOnlyPendingTimers();
    expect(io.disconnect).not.toHaveBeenCalled();
    expect(list.querySelector('#item-1').slot).toBe('');
  });

  it('hides the More slot when everything fits', async () => {
    const list = await mountList([0, 0], 'minimum-items="1"');
    const listener = vi.fn();
    list.addEventListener('overflowMinimum', listener);
    intersect(0);
    const { list: ul, more, placeholder } = parts(list);
    expect(ul.style.height).toBe('');
    expect(more.hidden).toBe(true);
    expect(more.style.getPropertyValue('order')).toBe('-1');
    expect(placeholder.hidden).toBe(true);
    expect(list.style.getPropertyValue('--overflow-count')).toBe('0');
    // No overflow, so the minimum state is not evaluated.
    expect(listener).not.toHaveBeenCalled();
  });

  it('clears minimum-reached when enough items remain visible', async () => {
    const list = await mountList([0, 0, 0, 20], 'minimum-items="2"');
    list.setAttribute('minimum-reached', '');
    const events = [];
    list.addEventListener('overflowMinimum', (e) => events.push(e.detail.minimumReached));
    intersect();
    expect(list.hasAttribute('minimum-reached')).toBe(false);
    expect(events).toEqual([false]);
    expect(list.minimumItems).toBe(2);
  });

  it('reports a null minimum when the attribute is missing', async () => {
    const list = await mountList([0, 20]);
    expect(list.minimumItems).toBeNull();
    intersect();
    expect(list.hasAttribute('minimum-reached')).toBe(false);
  });

  it('reflows on request, restoring previously overflowing items', async () => {
    const list = await mountList([0, 20, 20]);
    intersect();
    expect(list.querySelector('#item-1').slot).toBe('overflow');

    // The layout changes so everything fits.
    list.querySelector('#item-1').getBoundingClientRect = () => rect(0);
    list.querySelector('#item-2').getBoundingClientRect = () => rect(0);
    const lastVisible = list.querySelector('#item-2');
    const orders = [];
    const original = lastVisible.style.setProperty.bind(lastVisible.style);
    lastVisible.style.setProperty = (name, value) => {
      orders.push([name, value]);
      original(name, value);
    };

    list.dispatchEvent(new CustomEvent('reflow', { detail: { lastVisibleElement: lastVisible } }));

    expect(orders).toContainEqual(['order', '-1']);
    expect(lastVisible.style.getPropertyValue('order')).toBe('');
    expect(list.querySelector('#item-1').slot).toBe('');
    expect(list.querySelector('#item-2').slot).toBe('');
    expect(list.style.getPropertyValue('--overflow-count')).toBe('0');
  });

  it('observes changes when there are no items to reflow', async () => {
    const list = await mountList([]);
    expect(intersectionInstances.at(-1).observed).toHaveLength(0);
    // The leftover declarative <template> would otherwise count as an assigned element.
    list.querySelector(':scope > template').remove();
    list.dispatchEvent(new CustomEvent('reflow', { detail: {} }));
    expect(list.style.getPropertyValue('--overflow-count')).toBe('');
  });

  it('schedules a reflow when children change', async () => {
    const list = await mountList([0, 0]);
    intersect();
    expect(list.style.getPropertyValue('--overflow-count')).toBe('0');

    const extra = document.createElement('li');
    extra.getBoundingClientRect = () => rect(20);
    const extra2 = document.createElement('li');
    extra2.getBoundingClientRect = () => rect(20);
    list.append(extra);
    await Promise.resolve();
    list.append(extra2);
    await Promise.resolve();

    await vi.runAllTimersAsync();
    expect(extra.slot).toBe('overflow');
    expect(extra2.slot).toBe('overflow');
    expect(list.style.getPropertyValue('--overflow-count')).toBe('2');
  });

  it('showAll disables overflow and moves items back to the default slot', async () => {
    const list = await mountList([0, 20]);
    intersect();
    expect(list.querySelector('#item-1').slot).toBe('overflow');

    list.showAll();

    const { list: ul, placeholder } = parts(list);
    expect(list.getAttribute('disabled')).toBe('true');
    expect(placeholder.style.display).toBe('none');
    expect(placeholder.style.width).toBe('0px');
    expect(list.querySelector('#item-1').slot).toBe('');
    expect(ul.style.height).toBe('');
    expect(list.style.getPropertyValue('--overflow-count')).toBe('0');

    // Re-enabling triggers a reflow.
    list.setAttribute('disabled', 'false');
    expect(list.querySelector('#item-1').slot).toBe('overflow');
  });

  it('ignores changes to other observed attributes', async () => {
    const list = await mountList([0, 20]);
    intersect();
    list.setAttribute('minimum-items', '5');
    expect(list.querySelector('#item-1').slot).toBe('overflow');
  });

  it('waits for an unloaded stylesheet before initialising', async () => {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `<overflow-list>
      <template shadowrootmode="open">
        <link rel="stylesheet" href="about:blank">
        <ul part="list"><slot></slot><slot name="more"></slot><li part="placeholder"></li></ul>
        <div part="overflow"><slot name="overflow"></slot></div>
      </template>
      <li>One</li>
    </overflow-list>`;
    document.body.appendChild(wrapper);
    await Promise.resolve();
    const io = intersectionInstances.at(-1);
    expect(io.observed).toHaveLength(0);

    const link = wrapper.querySelector('overflow-list').shadowRoot.querySelector('link');
    link.dispatchEvent(new Event('load'));
    await Promise.resolve();
    await Promise.resolve();
    expect(io.observed).toHaveLength(1);
  });

  it('rejects when the shadow root has the wrong structure', async () => {
    const element = new OverflowList();
    await expect(element.connectedCallback()).rejects.toThrow('Missing shadow root');

    element.attachShadow({ mode: 'open' }).innerHTML = '<div part="list"></div>';
    await expect(element.connectedCallback()).rejects.toThrow(TypeError);
  });

  it('disconnects its observers when removed', async () => {
    const list = await mountList([0]);
    const io = intersectionInstances.at(-1);
    list.remove();
    expect(io.disconnect).toHaveBeenCalled();
  });

  it('uses the theme scheduler when available and falls back to rAF + timeout', async () => {
    const list = await mountList([0]);
    const schedule = vi.fn();
    vi.stubGlobal('Theme', { utilities: { scheduler: { schedule } } });
    expect(list.schedule).toBe(schedule);

    vi.stubGlobal('Theme', {});
    const callback = vi.fn();
    list.schedule(callback);
    await vi.runAllTimersAsync();
    expect(callback).toHaveBeenCalled();
  });
});
