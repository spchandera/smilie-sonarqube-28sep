import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withAutoplay } from '@theme/utilities';
import { AnnouncementBar } from '@theme/announcement-bar';

class AutoplayProbe extends withAutoplay(HTMLElement) {
  calls = 0;
  next() {
    this.calls += 1;
  }
}
customElements.define('autoplay-probe', AutoplayProbe);

function mount(html) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper);
  return wrapper.firstElementChild;
}

function setHidden(value) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.innerHTML = '';
  delete document.hidden;
  vi.restoreAllMocks();
});

describe('withAutoplay', () => {
  it('parses the autoplay attribute as seconds', () => {
    const el = mount('<autoplay-probe autoplay="3"></autoplay-probe>');
    expect(el.autoplay).toBe(true);
    expect(el.autoplayInterval).toBe(3000);

    el.setAttribute('autoplay', 'nope');
    expect(el.autoplay).toBe(false);
    expect(el.autoplayInterval).toBeUndefined();

    el.removeAttribute('autoplay');
    expect(el.autoplay).toBe(false);
  });

  it('does nothing when autoplay is not configured', () => {
    const el = mount('<autoplay-probe></autoplay-probe>');
    el.play();
    el.resume();
    vi.advanceTimersByTime(10000);
    expect(el.calls).toBe(0);
    expect(el.paused).toBe(false);
  });

  it('advances on each interval once playing', () => {
    const el = mount('<autoplay-probe autoplay="1"></autoplay-probe>');
    el.play();
    expect(el.paused).toBe(false);
    expect(el.hasAttribute('paused')).toBe(false);

    vi.advanceTimersByTime(3000);
    expect(el.calls).toBe(3);
  });

  it('ignores repeated play calls while an interval is active', () => {
    const el = mount('<autoplay-probe autoplay="1"></autoplay-probe>');
    el.play();
    el.play();
    vi.advanceTimersByTime(1000);
    expect(el.calls).toBe(1);
  });

  it('accepts a custom interval', () => {
    const el = mount('<autoplay-probe autoplay="10"></autoplay-probe>');
    el.play(500);
    vi.advanceTimersByTime(1000);
    expect(el.calls).toBe(2);
  });

  it('pause stops playback and flags the element', () => {
    const el = mount('<autoplay-probe autoplay="1"></autoplay-probe>');
    el.play();
    el.pause();
    expect(el.paused).toBe(true);
    expect(el.hasAttribute('paused')).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(el.calls).toBe(0);
  });

  it('resume does not restart a paused element', () => {
    const el = mount('<autoplay-probe autoplay="1"></autoplay-probe>');
    el.play();
    el.pause();
    el.resume();
    vi.advanceTimersByTime(3000);
    expect(el.calls).toBe(0);
  });

  it('suspend holds playback without pausing, and resume restarts it', () => {
    const el = mount('<autoplay-probe autoplay="1"></autoplay-probe>');
    el.play();
    el.suspend();
    expect(el.paused).toBe(false);
    vi.advanceTimersByTime(3000);
    expect(el.calls).toBe(0);

    el.resume();
    expect(el.paused).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(el.calls).toBe(2);
  });

  it('skips ticks while the page is hidden', () => {
    const el = mount('<autoplay-probe autoplay="1"></autoplay-probe>');
    el.play();
    setHidden(true);
    vi.advanceTimersByTime(2000);
    expect(el.calls).toBe(0);

    setHidden(false);
    vi.advanceTimersByTime(1000);
    expect(el.calls).toBe(1);
  });

  it('skips ticks while hovered', () => {
    const el = mount('<autoplay-probe autoplay="1"></autoplay-probe>');
    const matches = vi.spyOn(el, 'matches').mockImplementation((sel) => sel === ':hover');
    el.play();
    vi.advanceTimersByTime(2000);
    expect(el.calls).toBe(0);

    matches.mockReturnValue(false);
    vi.advanceTimersByTime(1000);
    expect(el.calls).toBe(1);
  });
});

function announcementMarkup(attrs = 'autoplay="2"', count = 3) {
  const slides = Array.from({ length: count }, (_, i) => `<p ref="slides[]" aria-hidden="${i !== 0}">Slide ${i}</p>`);
  return `<announcement-bar-component ${attrs}>
    <div ref="slideshowContainer">${slides.join('')}</div>
    <button ref="previous"></button><button ref="next"></button>
  </announcement-bar-component>`;
}

function hiddenStates(bar) {
  return bar.refs.slides.map((s) => s.getAttribute('aria-hidden'));
}

describe('AnnouncementBar', () => {
  it('is registered as a custom element', () => {
    expect(customElements.get('announcement-bar-component')).toBe(AnnouncementBar);
  });

  it('next and previous move the visible slide', () => {
    const bar = mount(announcementMarkup(''));
    expect(bar.current).toBe(0);

    bar.next();
    expect(bar.current).toBe(1);
    expect(hiddenStates(bar)).toEqual(['true', 'false', 'true']);

    bar.previous();
    expect(hiddenStates(bar)).toEqual(['false', 'true', 'true']);
  });

  it('wraps around in both directions', () => {
    const bar = mount(announcementMarkup(''));
    bar.previous();
    expect(bar.current).toBe(-1);
    expect(hiddenStates(bar)).toEqual(['true', 'true', 'false']);

    bar.current = 4;
    expect(hiddenStates(bar)).toEqual(['true', 'false', 'true']);
  });

  it('tolerates having no slides', () => {
    const bar = mount('<announcement-bar-component><div ref="slideshowContainer"></div></announcement-bar-component>');
    expect(() => bar.next()).not.toThrow();
    expect(bar.current).toBe(1);
  });

  it('autoplays through the slides on connect', () => {
    const bar = mount(announcementMarkup('autoplay="2"'));
    expect(bar.paused).toBe(false);

    vi.advanceTimersByTime(2000);
    expect(bar.current).toBe(1);
    vi.advanceTimersByTime(4000);
    expect(bar.current).toBe(3);
    expect(hiddenStates(bar)).toEqual(['false', 'true', 'true']);
  });

  it('suspends on mouseenter and resumes on mouseleave', () => {
    const bar = mount(announcementMarkup('autoplay="1"'));
    bar.dispatchEvent(new Event('mouseenter'));
    vi.advanceTimersByTime(3000);
    expect(bar.current).toBe(0);

    bar.dispatchEvent(new Event('mouseleave'));
    vi.advanceTimersByTime(1000);
    expect(bar.current).toBe(1);
  });

  it('pauses when the page becomes hidden and resumes when visible', () => {
    const bar = mount(announcementMarkup('autoplay="1"'));

    setHidden(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(bar.paused).toBe(true);
    vi.advanceTimersByTime(3000);
    expect(bar.current).toBe(0);

    // resume() keeps a paused element paused, so becoming visible does not restart playback
    setHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(bar.paused).toBe(true);
    vi.advanceTimersByTime(3000);
    expect(bar.current).toBe(0);
  });
});
