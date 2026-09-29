import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { sectionRenderer } from '@theme/section-renderer';
import { DialogCloseEvent, DialogOpenEvent } from '@theme/dialog';

const EMPTY_SECTION = `
  <div class="predictive-search-empty-section">
    <div id="predictive-search-products"><p class="empty-copy">Popular products</p></div>
  </div>`;

const RESULTS = `
  <div class="predictive-search-results__inner">
    <ul class="predictive-search-results__list">
      <li ref="resultsItems[]" id="r1"><a href="/products/a">A</a></li>
      <li ref="resultsItems[]" id="r2"><a href="/products/b">B</a></li>
    </ul>
    <div class="predictive-search-results__wrapper-products">
      <div class="predictive-search-results__card" id="r3"><a href="/products/c">C</a></div>
    </div>
  </div>`;

const RECENT = `
  <div id="predictive-search-products"><div class="recent-card" id="recent">Recent</div></div>`;

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('predictive-search-component', () => {
  let getSectionHTML;
  let component;
  let dialog;
  let input;
  let results;

  beforeAll(async () => {
    await import('@theme/predictive-search');
  });

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    vi.stubGlobal('Theme', {
      routes: { search_url: '/search', predictive_search_url: '/search/suggest' },
    });
    vi.stubGlobal('requestIdleCallback', (cb) => setTimeout(cb, 0));
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    Element.prototype.scrollIntoView ??= function () {};
    Element.prototype.scrollTo ??= function () {};
    getSectionHTML = vi.spyOn(sectionRenderer, 'getSectionHTML').mockImplementation(async (id, _cache, url) => {
      if (id === 'predictive-search-empty') return EMPTY_SECTION;
      if (url?.pathname === '/search') return RECENT;
      return RESULTS;
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function mount({ value = '', inDialog = true, sectionId = 'search-section' } = {}) {
    const inner = `
      <predictive-search-component data-section-id="${sectionId}">
        <form class="predictive-search-form__content">
          <input ref="searchInput" value="${value}" />
          <button type="button" ref="resetButton" hidden>Reset</button>
          <span id="plain">text</span>
        </form>
        <div ref="predictiveSearchResults"></div>
      </predictive-search-component>`;
    document.body.innerHTML = inDialog ? `<dialog-component><dialog ref="dialog">${inner}</dialog></dialog-component>` : inner;
    component = document.querySelector('predictive-search-component');
    dialog = document.querySelector('dialog-component');
    input = component.refs.searchInput;
    results = component.refs.predictiveSearchResults;
  }

  async function searchFor(term) {
    input.value = term;
    component.search({ inputType: 'insertText' });
    vi.advanceTimersByTime(200);
    await flush();
  }

  const key = (k, extra = {}) => {
    const event = new KeyboardEvent('keydown', { key: k, cancelable: true, ...extra });
    component.onSearchKeyDown(event);
    return event;
  };

  it('shows the reset button when the input starts with a value', () => {
    mount({ value: 'shoe' });
    expect(component.refs.resetButton.hidden).toBe(false);
  });

  it('fetches predictive results and morphs them into the results container', async () => {
    mount();
    await searchFor('  shoe ');

    expect(component.refs.resetButton.hidden).toBe(false);
    const [sectionId, useCache, url] = getSectionHTML.mock.calls.at(-1);
    expect(sectionId).toBe('search-section');
    expect(useCache).toBe(false);
    expect(url.pathname).toBe('/search/suggest');
    expect(url.searchParams.get('q')).toBe('shoe');
    expect(url.searchParams.get('resources[limit_scope]')).toBe('each');
    expect(results.querySelector('#r1')).not.toBeNull();
  });

  it('does not search for non-text input events', async () => {
    mount();
    input.value = 'shoe';
    component.search({});
    vi.advanceTimersByTime(200);
    await flush();
    expect(getSectionHTML).not.toHaveBeenCalled();
  });

  it('does not fetch results without a section id', async () => {
    mount({ sectionId: '' });
    await searchFor('shoe');
    expect(getSectionHTML).not.toHaveBeenCalled();
  });

  it('ignores empty result markup', async () => {
    mount();
    getSectionHTML.mockResolvedValueOnce('');
    await searchFor('shoe');
    expect(results.innerHTML).toBe('');
  });

  it('resets to the empty state when the search term is cleared', async () => {
    mount();
    await searchFor('shoe');
    await searchFor('   ');

    expect(getSectionHTML.mock.calls.at(-1)[0]).toBe('predictive-search-empty');
    expect(component.refs.resetButton.hidden).toBe(true);
    expect(results.querySelector('.empty-copy')).not.toBeNull();
    expect(results.querySelector('#r1')).toBeNull();
  });

  it('navigates results with arrow keys and Tab, wrapping around', async () => {
    mount();
    await searchFor('shoe');
    const selected = () => component.querySelector('[aria-selected="true"]')?.id;

    const down = key('ArrowDown');
    expect(down.defaultPrevented).toBe(true);
    expect(selected()).toBe('r1');
    expect(component.querySelector('#r1').classList.contains('keyboard-focus')).toBe(true);

    key('Tab');
    expect(selected()).toBe('r2');
    key('ArrowDown');
    expect(selected()).toBe('r3');
    key('ArrowDown');
    expect(selected()).toBe('r1');
    key('ArrowUp');
    expect(selected()).toBe('r3');
    key('Tab', { shiftKey: true });
    expect(selected()).toBe('r2');
    expect(component.querySelector('#r1').classList.contains('keyboard-focus')).toBe(false);
    expect(document.activeElement).toBe(input);

    key('ArrowLeft');
    expect(selected()).toBe('r2');
  });

  it('ignores navigation keys when there are no results', () => {
    mount();
    const event = key('ArrowDown');
    expect(event.defaultPrevented).toBe(false);
  });

  it('clicks the focused result link on Enter', async () => {
    mount();
    await searchFor('shoe');
    key('ArrowDown');
    const click = vi.fn((e) => e.preventDefault());
    component.querySelector('#r1 a').addEventListener('click', click);

    const event = key('Enter');
    expect(event.defaultPrevented).toBe(true);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('navigates to the single result URL on Enter', async () => {
    mount();
    await searchFor('shoe');
    results.insertAdjacentHTML('beforeend', '<div data-single-result-url="#single"></div>');

    const event = key('Enter');
    expect(event.defaultPrevented).toBe(true);
    expect(window.location.hash).toBe('#single');
  });

  it('navigates to the full search page on Enter without a selection', async () => {
    mount();
    await searchFor('shoe');
    const hrefSetter = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        origin: original.origin,
        get href() {
          return original.href;
        },
        set href(v) {
          hrefSetter(v);
        },
      },
    });

    try {
      key('Enter');
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }

    expect(hrefSetter).toHaveBeenCalledWith(`${original.origin}/search?q=shoe`);
  });

  it('resets on Escape', async () => {
    mount();
    await searchFor('shoe');
    key('Escape');
    await flush();
    expect(input.value).toBe('');
    expect(results.querySelector('.empty-copy')).not.toBeNull();
  });

  it('resetSearch focuses the input and resets after the debounce', async () => {
    mount();
    input.value = 'x';
    component.resetSearch();
    vi.advanceTimersByTime(100);
    await flush();
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('');
  });

  it('prepends recently viewed products to the empty state', async () => {
    localStorage.setItem('viewedProducts', JSON.stringify(['11', '22']));
    mount();
    vi.advanceTimersByTime(0); // requestIdleCallback -> loadEmptyState -> resetSearch (debounced)
    vi.advanceTimersByTime(100);
    await flush();

    const recentCall = getSectionHTML.mock.calls.find(([, , url]) => url?.pathname === '/search');
    expect(recentCall[2].searchParams.get('q')).toBe('id:11 OR id:22');
    expect(recentCall[2].searchParams.get('resources[type]')).toBe('product');
    const recent = results.querySelector('#recent');
    expect(recent.getAttribute('ref')).toBe('recentlyViewedWrapper');
    expect(recent.nextElementSibling.classList.contains('empty-copy')).toBe(true);
    // Did not steal focus
    expect(document.activeElement).not.toBe(input);
  });

  it('keeps the empty state unchanged when recently viewed markup has no products list', async () => {
    localStorage.setItem('viewedProducts', JSON.stringify(['11']));
    mount({ inDialog: false });
    getSectionHTML.mockImplementation(async (id) => (id === 'predictive-search-empty' ? EMPTY_SECTION : '<div></div>'));
    vi.advanceTimersByTime(100);
    await flush();
    expect(results.innerHTML).toBe('');
  });

  it('loads the empty state on first dialog open when products exist', async () => {
    mount();
    vi.runOnlyPendingTimers();
    getSectionHTML.mockClear();
    // Already loaded via idle callback, so the open event does not reload.
    dialog.dispatchEvent(new DialogOpenEvent());
    vi.advanceTimersByTime(100);
    await flush();
    expect(getSectionHTML).not.toHaveBeenCalled();

    localStorage.setItem('viewedProducts', JSON.stringify(['5']));
    mount();
    dialog.dispatchEvent(new DialogOpenEvent());
    vi.advanceTimersByTime(100);
    await flush();
    expect(getSectionHTML).toHaveBeenCalledWith('predictive-search-empty', false, expect.any(URL));
  });

  it('resets when the dialog closes', async () => {
    mount();
    input.value = 'abc';
    dialog.dispatchEvent(new DialogCloseEvent());
    await flush();
    expect(input.value).toBe('');
    expect(component.refs.resetButton.hidden).toBe(true);
  });

  it('toggles the dialog with Cmd+K', () => {
    mount();
    dialog.toggleDialog = vi.fn();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }));
    expect(dialog.toggleDialog).toHaveBeenCalledTimes(1);
  });

  it('refocuses the input on non-interactive clicks inside the modal', () => {
    mount();
    component.querySelector('#plain').click();
    expect(document.activeElement).toBe(input);

    component.refs.resetButton.hidden = false;
    component.refs.resetButton.focus();
    component.refs.resetButton.click();
    expect(document.activeElement).toBe(component.refs.resetButton);
  });

  it('removes listeners on disconnect', () => {
    mount();
    dialog.toggleDialog = vi.fn();
    component.remove();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
    expect(dialog.toggleDialog).not.toHaveBeenCalled();
  });

  it('clears recently viewed products and animates the wrapper out', async () => {
    localStorage.setItem('viewedProducts', JSON.stringify(['1']));
    mount({ inDialog: false });
    results.innerHTML = '<div ref="recentlyViewedWrapper"><h3 ref="recentlyViewedTitle[]">Recent</h3><div ref="recentlyViewedItems[]"></div></div>';
    component.updatedCallback();
    const wrapper = component.refs.recentlyViewedWrapper;
    const event = new Event('click');
    const stop = vi.spyOn(event, 'stopPropagation');

    component.clearRecentlyViewedProducts(event);

    expect(stop).toHaveBeenCalled();
    expect(localStorage.getItem('viewedProducts')).toBeNull();
    expect(wrapper.classList.contains('removing')).toBe(true);
    await flush();
    expect(wrapper.isConnected).toBe(false);
  });

  it('clearing with no recently viewed elements only clears storage', () => {
    localStorage.setItem('viewedProducts', JSON.stringify(['1']));
    mount({ inDialog: false });
    component.clearRecentlyViewedProducts(new Event('click'));
    expect(localStorage.getItem('viewedProducts')).toBeNull();
  });
});
