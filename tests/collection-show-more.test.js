import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';

const mediaQuery = {
  matches: false,
  media: '(min-width: 750px)',
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
};
const originalMatchMedia = window.matchMedia;
const matchMediaStub = (query) => (query === '(min-width: 750px)' ? mediaQuery : originalMatchMedia(query));
vi.stubGlobal('matchMedia', matchMediaStub);
window.matchMedia = matchMediaStub;

await import('@theme/show-more');

afterAll(() => {
  vi.unstubAllGlobals();
  window.matchMedia = originalMatchMedia;
});

let animations;
let originalAnimate;

beforeEach(() => {
  animations = [];
  originalAnimate = HTMLElement.prototype.animate;
  HTMLElement.prototype.animate = vi.fn(function (keyframes, options) {
    const animation = { keyframes, options, cancel: vi.fn(), onfinish: null };
    animations.push(animation);
    return animation;
  });
  mediaQuery.matches = false;
});

afterEach(() => {
  HTMLElement.prototype.animate = originalAnimate;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function mount(attrs = '') {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <show-more-component ${attrs}>
      <div ref="showMoreContent">
        <p>always</p>
        <p ref="showMoreItems[]" class="hidden">extra 1</p>
        <p ref="showMoreItems[]" class="hidden">extra 2</p>
      </div>
      <button ref="showMoreButton" aria-expanded="false">Show more</button>
    </show-more-component>`;
  document.body.appendChild(wrapper);
  const el = wrapper.firstElementChild;
  const content = el.refs.showMoreContent;
  let offset = 50;
  Object.defineProperty(content, 'offsetHeight', { get: () => offset, configurable: true });
  Object.defineProperty(content, 'scrollHeight', { get: () => 200, configurable: true });
  return { el, content, setOffset: (v) => (offset = v) };
}

const clickEvent = () => ({ preventDefault: vi.fn() });

describe('ShowMoreComponent', () => {
  it('expands, animating from the collapsed height to the full height', () => {
    const { el, content } = mount();
    const event = clickEvent();

    el.toggle(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(el.dataset.expanded).toBe('true');
    expect(el.refs.showMoreButton.getAttribute('aria-expanded')).toBe('true');
    expect(el.refs.showMoreItems.every((i) => !i.classList.contains('hidden'))).toBe(true);
    expect(content.style.overflow).toBe('hidden');
    expect(animations[0].keyframes).toEqual({ height: ['50px', '200px'] });
    expect(animations[0].options).toEqual({ duration: 300, easing: 'ease-in-out' });

    content.style.height = '10px';
    animations[0].onfinish();
    expect(content.style.height).toBe('');
    expect(content.style.overflow).toBe('');
  });

  it('collapses back to the stored height and re-hides items', () => {
    const { el, setOffset } = mount();
    el.toggle(clickEvent());
    animations[0].onfinish();

    setOffset(200);
    el.toggle(clickEvent());

    expect(animations[0].cancel).toHaveBeenCalled();
    expect(el.dataset.expanded).toBe('false');
    expect(el.refs.showMoreButton.getAttribute('aria-expanded')).toBe('false');
    expect(animations[1].keyframes).toEqual({ height: ['200px', '50px'] });

    animations[1].onfinish();
    expect(el.refs.showMoreItems.every((i) => i.classList.contains('hidden'))).toBe(true);

    // Expands again after a full cycle
    el.toggle(clickEvent());
    expect(el.dataset.expanded).toBe('true');
  });

  it('uses the mobile-only hidden class when disabled on desktop', () => {
    const { el } = mount('data-disable-on-desktop="true"');
    el.refs.showMoreItems.forEach((i) => i.classList.replace('hidden', 'mobile:hidden'));

    el.toggle(clickEvent());
    expect(el.refs.showMoreItems.some((i) => i.classList.contains('mobile:hidden'))).toBe(false);
    animations[0].onfinish();
    el.toggle(clickEvent());
    animations[1].onfinish();
    expect(el.refs.showMoreItems.every((i) => i.classList.contains('mobile:hidden'))).toBe(true);
  });

  it('does nothing on desktop when disabled on desktop', () => {
    mediaQuery.matches = true;
    const { el } = mount('data-disable-on-desktop="true"');

    el.toggle(clickEvent());
    expect(el.dataset.expanded).toBeUndefined();
    expect(animations).toHaveLength(0);
  });

  it('still toggles on desktop when not disabled', () => {
    mediaQuery.matches = true;
    const { el } = mount();
    el.toggle(clickEvent());
    expect(el.dataset.expanded).toBe('true');
  });
});
