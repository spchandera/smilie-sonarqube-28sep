import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { ThemeEvents } from '@theme/events';

const setHeight = (el, prop, value) =>
  Object.defineProperty(el, prop, { configurable: true, get: () => value });

const rect = (el, r) => {
  el.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, ...r });
};

function pointerMove(x, y, movementX, movementY) {
  const event = new Event('pointermove');
  Object.defineProperties(event, {
    clientX: { value: x },
    clientY: { value: y },
    movementX: { value: movementX },
    movementY: { value: movementY },
  });
  document.body.dispatchEvent(event);
}

describe('header-menu', () => {
  let header;
  let menu;
  let overflowList;
  let overflowPart;
  let items;
  let submenu1;
  let rafQueue;

  const runFrames = () => {
    while (rafQueue.length) rafQueue.shift()(0);
  };

  beforeAll(async () => {
    await import('@theme/header-menu');
  });

  beforeEach(() => {
    vi.useFakeTimers();
    rafQueue = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    document.elementFromPoint = vi.fn(() => null);

    header = document.createElement('header-component');
    header.innerHTML = '<div class="header__row--top"></div>';
    setHeight(header, 'offsetHeight', 60);
    setHeight(header.querySelector('.header__row--top'), 'offsetHeight', 40);
    rect(header, { bottom: 100 });
    rect(header.querySelector('.header__row--top'), { bottom: 40 });

    menu = document.createElement('header-menu');
    overflowList = document.createElement('overflow-list');
    overflowList.setAttribute('ref', 'overflowMenu');
    const shadow = overflowList.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <div part="overflow-list"><slot></slot><slot name="more"></slot></div>
      <div part="overflow"><slot name="overflow"></slot></div>`;
    overflowPart = shadow.querySelector('[part="overflow"]');
    setHeight(overflowPart, 'offsetHeight', 150);

    overflowList.innerHTML = `
      <li class="menu-list__list-item" id="item1">
        <a ref="menuitem" href="/one">One</a>
        <div ref="submenu[]"><div class="inner">Mega</div><img loading="lazy" src="a.jpg" /></div>
      </li>
      <li class="menu-list__list-item" id="item2"><a ref="menuitem" href="/two">Two</a></li>
      <li class="menu-list__list-item" id="item3" slot="overflow">
        <a ref="menuitem" href="/three">Three</a>
        <div ref="submenu[]">Sub three</div>
      </li>
      <li class="menu-list__list-item" id="item4" slot="overflow"><a ref="menuitem" href="/four">Four</a></li>
      <li class="menu-list__list-item" id="more" slot="more"><button>More</button></li>`;
    menu.append(overflowList);
    header.append(menu);
    document.body.append(header);

    items = Object.fromEntries(
      [...overflowList.querySelectorAll('li')].map((li) => [li.id, li.querySelector('[ref="menuitem"]')])
    );
    submenu1 = document.querySelector('#item1 [ref="submenu[]"]');
    setHeight(submenu1, 'offsetHeight', 200);
    rect(items.item1, { top: 20 });
  });

  afterEach(() => {
    header.remove();
    delete document.elementFromPoint;
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const li = (id) => document.getElementById(id);

  it('preloads lazy images once connected', () => {
    expect(menu.querySelector('img').hasAttribute('loading')).toBe(false);
  });

  it('dispatches a mega menu hover event on activation', () => {
    const handler = vi.fn();
    document.addEventListener(ThemeEvents.megaMenuHover, handler);
    menu.activate({ target: li('item1') });
    document.removeEventListener(ThemeEvents.megaMenuHover, handler);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('opens a default-slot item with a submenu and sets header heights', () => {
    menu.activate({ target: li('item1') });

    expect(menu.dataset.overflowExpanded).toBe('false');
    expect(menu.getAttribute('aria-expanded')).toBe('true');
    expect(items.item1.getAttribute('aria-expanded')).toBe('true');
    expect('active' in submenu1.dataset).toBe(true);
    expect(header.style.getPropertyValue('--submenu-height')).toBe('200px');
    expect(header.style.getPropertyValue('--full-open-header-height')).toBe('260px');
    expect(menu.style.getPropertyValue('--submenu-opacity')).toBe('1');
    expect(items.item1.style.getPropertyValue('--box-height')).toBe('80px');
  });

  it('uses the top row height when the submenu overlaps the bottom row', () => {
    header.dataset.submenuOverlapBottomRow = '';
    menu.activate({ target: li('item1') });
    expect(header.style.getPropertyValue('--full-open-header-height')).toBe('240px');
    expect(items.item1.style.getPropertyValue('--box-height')).toBe('20px');
  });

  it('opens nothing for a default item without a submenu', () => {
    menu.activate({ target: li('item2') });
    expect(header.style.getPropertyValue('--submenu-height')).toBe('0px');
    expect(header.style.getPropertyValue('--full-open-header-height')).toBe('0px');
    expect(items.item2.getAttribute('aria-expanded')).toBe('true');
  });

  it('uses the overflow menu for overflow items without their own submenu', () => {
    menu.activate({ target: li('item4') });
    expect(menu.dataset.overflowExpanded).toBe('true');
    expect('active' in overflowPart.dataset).toBe(true);
    expect(header.style.getPropertyValue('--submenu-height')).toBe('150px');
  });

  it('measures overflow items with a submenu using the larger of the overflow heights', () => {
    const assigned = vi.fn(() => [li('item3')]);
    overflowPart.querySelector('slot').assignedElements = assigned;
    const sub3 = document.querySelector('#item3 [ref="submenu[]"]');
    const displays = [];
    let calls = 0;
    Object.defineProperty(overflowPart, 'offsetHeight', {
      configurable: true,
      get: () => {
        displays.push(sub3.style.display);
        calls++;
        return calls === 1 ? 120 : 180;
      },
    });

    menu.activate({ target: li('item3') });

    expect(assigned).toHaveBeenCalled();
    expect(displays[0]).toBe('none');
    expect(sub3.style.display).toBe('');
    expect(header.style.getPropertyValue('--submenu-height')).toBe('180px');
  });

  it('activates the first overflow item when hovering "More"', () => {
    menu.activate({ target: li('more') });
    expect(items.item3.getAttribute('aria-expanded')).toBe('true');
    expect(menu.dataset.overflowExpanded).toBe('true');
  });

  it('ignores invalid targets, missing header and repeat activation', () => {
    menu.activate({ target: null });
    expect(menu.getAttribute('aria-expanded')).toBeNull();

    menu.activate({ target: li('item1') });
    header.style.setProperty('--submenu-height', 'x');
    menu.activate({ target: li('item1') });
    expect(header.style.getPropertyValue('--submenu-height')).toBe('x');
  });

  it('switches between items and resets the previous one', () => {
    menu.activate({ target: li('item1') });
    menu.activate({ target: li('item2') });
    expect(items.item1.getAttribute('aria-expanded')).toBe('false');
    expect(items.item1.style.getPropertyValue('--box-height')).toBe('');
    expect(items.item2.getAttribute('aria-expanded')).toBe('true');
  });

  it('updates the submenu height when deferred content is injected', async () => {
    menu.activate({ target: li('item1') });
    setHeight(submenu1, 'offsetHeight', 320);
    submenu1.append(document.createElement('p'));
    await Promise.resolve();
    runFrames();
    runFrames();
    expect(header.style.getPropertyValue('--submenu-height')).toBe('320px');
  });

  it('deactivates and clears state', () => {
    menu.activate({ target: li('item1') });
    menu.deactivate({ target: li('item1'), relatedTarget: document.body });

    expect(header.style.getPropertyValue('--submenu-height')).toBe('0px');
    expect(header.style.getPropertyValue('--full-open-header-height')).toBe('0px');
    expect(menu.style.getPropertyValue('--submenu-opacity')).toBe('0');
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    expect(items.item1.getAttribute('aria-expanded')).toBe('false');
    expect('active' in submenu1.dataset).toBe(false);
  });

  it('keeps the menu open when moving into the submenu', () => {
    menu.activate({ target: li('item1') });
    menu.deactivate({ target: li('item1'), relatedTarget: submenu1.firstElementChild, type: 'pointerleave' });
    expect(menu.getAttribute('aria-expanded')).toBe('true');
    expect(items.item1.style.getPropertyValue('--box-height')).toBe('');
  });

  it('keeps the menu open when moving to an overflow item', () => {
    menu.activate({ target: li('item1') });
    menu.deactivate({ target: li('item1'), relatedTarget: items.item3 });
    expect(menu.getAttribute('aria-expanded')).toBe('true');
  });

  it('ignores deactivate with a non-element target or nothing active', () => {
    menu.deactivate({ target: null });
    menu.deactivate({ target: li('item1'), relatedTarget: null });
    expect(menu.getAttribute('aria-expanded')).toBeNull();
  });

  it('does not deactivate while the submenu is hovered', () => {
    menu.activate({ target: li('item1') });
    const matches = vi.spyOn(submenu1, 'matches').mockImplementation((s) => s === ':hover');
    menu.deactivate({ target: li('item1'), relatedTarget: document.body });
    expect(menu.getAttribute('aria-expanded')).toBe('true');
    matches.mockRestore();
  });

  it('deactivates when the pointer leaves the overflow menu', () => {
    menu.activate({ target: li('item4') });
    overflowPart.dispatchEvent(new Event('pointerleave'));
    expect(menu.dataset.overflowExpanded).toBe('false');
    expect(menu.getAttribute('aria-expanded')).toBe('false');
  });

  it('tracks pointer movement for the safety box and reconciles hover targets', () => {
    menu.activate({ target: li('item1') });

    pointerMove(10, 10, 5, 0);
    expect(items.item1.dataset.safetyBox).toBe('true');

    const entered = vi.fn();
    li('item2').addEventListener('pointerenter', entered);
    document.elementFromPoint.mockReturnValue(items.item2);

    vi.advanceTimersByTime(350);
    expect(items.item1.dataset.safetyBox).toBe('false');
    runFrames();
    expect(document.elementFromPoint).toHaveBeenCalledWith(10, 10);
    expect(entered).toHaveBeenCalledTimes(1);

    pointerMove(12, 12, 0, 0);
    expect(items.item1.dataset.safetyBox).toBe('false');
    document.elementFromPoint.mockReturnValue(null);
    runFrames();
    expect(entered).toHaveBeenCalledTimes(1);

    // Pointer still over the active item: no re-dispatch
    document.elementFromPoint.mockReturnValue(items.item1);
    pointerMove(12, 12, 0, 0);
    runFrames();
    expect(entered).toHaveBeenCalledTimes(1);
  });

  it('ignores pointer moves when nothing is active', () => {
    menu.activate({ target: li('item1') });
    menu.deactivate({ target: li('item1'), relatedTarget: document.body });
    pointerMove(1, 1, 5, 5);
    expect(items.item1.dataset.safetyBox).toBeUndefined();
  });

  it('recalculates the menu style on resize (debounced)', () => {
    header.id = 'header-component';
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(100);
    runFrames();
    expect(header.dataset.menuStyle).toBe('menu');
  });

  it('cleans up tracking when disconnected while active', () => {
    menu.activate({ target: li('item1') });
    menu.remove();
    expect(items.item1.style.getPropertyValue('--box-height')).toBe('');
    expect(items.item1.dataset.safetyBox).toBeUndefined();
  });
});
