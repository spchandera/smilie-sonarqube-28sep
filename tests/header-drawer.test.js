import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('header-drawer', () => {
  let drawer;
  let details;
  let summary;
  let sub;

  beforeAll(async () => {
    await import('@theme/header-drawer');
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    document.body.innerHTML = `
      <header-drawer>
        <details ref="details" tabindex="-1">
          <summary aria-expanded="false">Menu</summary>
          <div ref="menuDrawer" class="menu-drawer">
            <a href="/a" id="top-link">A</a>
            <span class="menu-drawer__animated-element" id="anim"></span>
            <accordion-custom><details><summary>acc</summary><div class="details-content" id="acc-content"></div></details></accordion-custom>
            <details id="sub" open>
              <summary aria-expanded="false">Sub</summary>
              <div class="menu-drawer__submenu"><a href="/b" id="sub-link">B</a></div>
            </details>
          </div>
        </details>
      </header-drawer>`;
    drawer = document.querySelector('header-drawer');
    details = drawer.refs.details;
    summary = details.querySelector(':scope > summary');
    sub = document.getElementById('sub');
  });

  afterEach(() => {
    drawer.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reports open state from the details element', () => {
    expect(drawer.isOpen).toBe(false);
    details.setAttribute('open', '');
    expect(drawer.isOpen).toBe(true);
  });

  it('opens the main drawer and traps focus after the animation', async () => {
    drawer.open();

    expect(summary.getAttribute('aria-expanded')).toBe('true');
    expect(details.classList.contains('menu-open')).toBe(true);
    expect(drawer.refs.menuDrawer.classList.contains('menu-drawer--has-submenu-opened')).toBe(false);

    await flush();
    expect(document.activeElement).toBe(details);
  });

  it('suppresses accordion animations briefly while opening', () => {
    const content = document.getElementById('acc-content');
    drawer.open();
    expect(content.classList.contains('details-content--no-animation')).toBe(true);
    vi.advanceTimersByTime(100);
    expect(content.classList.contains('details-content--no-animation')).toBe(false);
  });

  it('opens a submenu from an event target and flags the drawer', () => {
    const event = { target: sub.querySelector('summary') };
    drawer.open('submenu', event);

    expect(sub.querySelector('summary').getAttribute('aria-expanded')).toBe('true');
    expect(sub.classList.contains('menu-open')).toBe(true);
    expect(drawer.refs.menuDrawer.classList.contains('menu-drawer--has-submenu-opened')).toBe(true);
  });

  it('does nothing when the details element has no summary', () => {
    const bare = document.createElement('details');
    const child = document.createElement('span');
    bare.append(child);
    drawer.refs.menuDrawer.append(bare);
    drawer.open(undefined, { target: child });
    expect(bare.classList.contains('menu-open')).toBe(false);
    drawer.back({ target: child });
    expect(bare.hasAttribute('open')).toBe(false);
  });

  it('toggle opens then closes, resetting nested open details', async () => {
    details.setAttribute('open', '');
    drawer.toggle();
    // isOpen was true, so toggle closes
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    await flush();
    expect(details.hasAttribute('open')).toBe(false);
    expect(sub.hasAttribute('open')).toBe(false);
    expect(details.classList.contains('menu-open')).toBe(false);

    drawer.toggle();
    expect(summary.getAttribute('aria-expanded')).toBe('true');
  });

  it('back closes only the submenu and re-traps focus in the drawer', async () => {
    details.setAttribute('open', '');
    drawer.open('submenu', { target: sub.querySelector('summary') });
    drawer.back({ target: sub.querySelector('a') });

    expect(sub.classList.contains('menu-open')).toBe(false);
    expect(drawer.refs.menuDrawer.classList.contains('menu-drawer--has-submenu-opened')).toBe(false);
    await flush();
    expect(sub.hasAttribute('open')).toBe(false);
    expect(details.hasAttribute('open')).toBe(true);
    expect(document.activeElement).toBe(details);
  });

  it('closes the closest menu on Escape keyup', async () => {
    details.setAttribute('open', '');
    document.getElementById('sub-link').dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }));
    await flush();
    expect(sub.hasAttribute('open')).toBe(false);
    expect(details.hasAttribute('open')).toBe(true);
  });

  it('ignores non-Escape keyup', async () => {
    details.setAttribute('open', '');
    drawer.dispatchEvent(new KeyboardEvent('keyup', { key: 'a' }));
    await flush();
    expect(details.hasAttribute('open')).toBe(true);
  });

  it('back without an event closes the main drawer', async () => {
    details.setAttribute('open', '');
    drawer.back();
    await flush();
    expect(details.hasAttribute('open')).toBe(false);
  });

  it('removes will-change from animated elements when their animation ends', () => {
    const anim = document.getElementById('anim');
    anim.style.willChange = 'transform';
    anim.dispatchEvent(new Event('animationend'));
    expect(anim.style.getPropertyValue('will-change')).toBe('unset');
  });
});
