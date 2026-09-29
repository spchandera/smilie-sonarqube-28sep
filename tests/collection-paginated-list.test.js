import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';

/** Captures IntersectionObserver instances so tests can trigger intersections. */
class FakeIntersectionObserver {
  static instances = [];
  constructor(callback, options) {
    this.callback = callback;
    this.options = options;
    this.observed = [];
    this.disconnect = vi.fn();
    FakeIntersectionObserver.instances.push(this);
  }
  observe(el) {
    this.observed.push(el);
  }
  unobserve() {}
  trigger(entries) {
    return this.callback(entries, this);
  }
}

vi.stubGlobal('Shopify', { designMode: false });
vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);

const { sectionRenderer } = await import('@theme/section-renderer');
const { FilterUpdateEvent } = await import('@theme/events');
const { viewTransition } = await import('@theme/utilities');
const { default: PaginatedList } = await import('@theme/paginated-list');

customElements.define('test-paginated-list', class extends PaginatedList {});

afterAll(() => {
  vi.unstubAllGlobals();
});

const flush = async (times = 5) => {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0));
};

const pageHTML = (page, count = 2) =>
  `<html><body><div id="shopify-section-main"><ul ref="grid">${Array.from(
    { length: count },
    (_, i) => `<li ref="cards[]" data-page="${page}">p${page}-${i}</li>`
  ).join('')}</ul></div></body></html>`;

const listMarkup = ({ lastPage = '3', page = 2, viewMore = true, gallery = true } = {}) => `
  <test-paginated-list section-id="main">
    ${gallery ? '<div ref="cardGallery" data-image-ratio="square"></div>' : ''}
    ${viewMore ? '<span ref="viewMorePrevious"></span>' : ''}
    <ul ref="grid" ${lastPage ? `data-last-page="${lastPage}"` : ''}>
      <li ref="cards[]" data-page="${page}">p${page}-0</li>
      <li ref="cards[]" data-page="${page}">p${page}-1</li>
    </ul>
    ${viewMore ? '<span ref="viewMoreNext"></span>' : ''}
  </test-paginated-list>`;

function mount(html) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper);
  return wrapper.firstElementChild;
}

let htmlSpy;
let scrollSpy;

const requestedPages = () => htmlSpy.mock.calls.map(([, , url]) => url.searchParams.get('page'));

beforeEach(() => {
  FakeIntersectionObserver.instances = [];
  history.replaceState(null, '', '/collections/all?page=2#top');
  htmlSpy = vi
    .spyOn(sectionRenderer, 'getSectionHTML')
    .mockImplementation(async (_id, _cache, url) => pageHTML(Number(url.searchParams.get('page'))));
  scrollSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.useRealTimers();
  viewTransition.current = undefined;
  history.replaceState(null, '', '/');
});

describe('PaginatedList', () => {
  it('prefetches the adjacent pages and observes the view more elements', async () => {
    const list = mount(listMarkup());
    await flush();

    expect(htmlSpy).toHaveBeenCalledTimes(2);
    expect(requestedPages().sort()).toEqual(['1', '3']);
    const [sectionId, useCache, url] = htmlSpy.mock.calls[0];
    expect(sectionId).toBe('main');
    expect(useCache).toBe(true);
    expect(url.hash).toBe('');
    expect([...list.pages.keys()].sort()).toEqual([1, 3]);

    const [observer] = FakeIntersectionObserver.instances;
    expect(observer.options).toEqual({ rootMargin: '100px' });
    expect(observer.observed).toEqual([list.refs.viewMorePrevious, list.refs.viewMoreNext]);
  });

  it('does not fetch pages outside the known range', async () => {
    mount(listMarkup({ lastPage: '1', page: 1 }));
    await flush();
    expect(htmlSpy).not.toHaveBeenCalled();

    document.body.innerHTML = '';
    mount(listMarkup({ lastPage: '' }));
    await flush();
    expect(htmlSpy).not.toHaveBeenCalled();
    expect(FakeIntersectionObserver.instances).toHaveLength(2);
  });

  it('skips observing when there are no view more elements or no cards', async () => {
    const list = mount(listMarkup({ viewMore: false }));
    await flush();
    expect(FakeIntersectionObserver.instances).toHaveLength(0);
    list.remove();

    const empty = mount('<test-paginated-list section-id="main"><ul ref="grid" data-last-page="3"></ul></test-paginated-list>');
    await flush();
    expect(empty.pages.size).toBe(0);
  });

  it('appends the next page when the next trigger intersects', async () => {
    const list = mount(listMarkup());
    await flush();
    const [observer] = FakeIntersectionObserver.instances;

    await observer.trigger([
      { isIntersecting: false, target: list.refs.viewMorePrevious },
      { isIntersecting: true, target: list.refs.viewMoreNext },
    ]);
    await flush();

    const items = [...list.refs.grid.children].map((li) => li.textContent);
    expect(items).toEqual(['p2-0', 'p2-1', 'p3-0', 'p3-1']);
    expect(window.location.search).toBe('?page=3');
    // Page 4 is beyond the last page, so nothing further is fetched
    expect(requestedPages()).not.toContain('4');
  });

  it('prepends the previous page and keeps the scroll position', async () => {
    const list = mount(listMarkup());
    await flush();
    const firstCard = list.refs.grid.firstElementChild;
    let top = 100;
    vi.spyOn(firstCard, 'getBoundingClientRect').mockImplementation(() => ({ top }));

    const [observer] = FakeIntersectionObserver.instances;
    const render = observer.trigger([{ isIntersecting: true, target: list.refs.viewMorePrevious }]);
    top = 400;
    await render;
    await flush();

    expect([...list.refs.grid.children].map((li) => li.textContent)).toEqual(['p1-0', 'p1-1', 'p2-0', 'p2-1']);
    expect(window.location.search).toBe('?page=1');
    expect(scrollSpy).toHaveBeenCalledWith({ top: expect.any(Number), behavior: 'instant' });
  });

  it('waits for a pending view transition before rendering', async () => {
    const list = mount(listMarkup());
    await flush();
    let finish;
    viewTransition.current = new Promise((r) => (finish = r));

    const [observer] = FakeIntersectionObserver.instances;
    const render = observer.trigger([{ isIntersecting: true, target: list.refs.viewMoreNext }]);
    await flush();
    expect(list.refs.grid.children).toHaveLength(2);

    finish();
    await render;
    await flush();
    expect(list.refs.grid.children).toHaveLength(4);
  });

  it('fetches and waits for a page that is not cached yet', async () => {
    const list = mount(listMarkup());
    await flush();
    list.pages.clear();

    const [observer] = FakeIntersectionObserver.instances;
    await observer.trigger([{ isIntersecting: true, target: list.refs.viewMoreNext }]);
    await flush();
    expect(list.refs.grid.children).toHaveLength(4);

    list.pages.clear();
    await observer.trigger([{ isIntersecting: true, target: list.refs.viewMorePrevious }]);
    await flush();
    expect(list.refs.grid.firstElementChild.textContent).toBe('p1-0');
  });

  it('gives up when a fetched page has no grid', async () => {
    htmlSpy.mockResolvedValue('<html><body><p>nothing</p></body></html>');
    const list = mount(listMarkup());
    await flush();

    const [observer] = FakeIntersectionObserver.instances;
    await observer.trigger([{ isIntersecting: true, target: list.refs.viewMoreNext }]);
    await observer.trigger([{ isIntersecting: true, target: list.refs.viewMorePrevious }]);
    await flush();

    expect(list.refs.grid.children).toHaveLength(2);
    expect(window.location.search).toBe('?page=2');
  });

  it('ignores intersections when the grid or valid pages are missing', async () => {
    const list = mount(listMarkup({ lastPage: '2', page: 2 }));
    await flush();
    const [observer] = FakeIntersectionObserver.instances;

    // Next page (3) is beyond the last page; nothing is rendered
    await observer.trigger([{ isIntersecting: true, target: list.refs.viewMoreNext }]);
    expect(list.refs.grid.children).toHaveLength(2);

    list.refs.grid.dataset.lastPage = '0';
    await observer.trigger([{ isIntersecting: true, target: list.refs.viewMorePrevious }]);
    expect(list.refs.grid.children).toHaveLength(2);

    list.refs = {};
    await observer.trigger([
      { isIntersecting: true, target: document.body },
      { isIntersecting: true, target: list },
    ]);
    expect(window.location.search).toBe('?page=2');
  });

  it('clears cached pages on filter updates and refetches once the grid changes', async () => {
    const list = mount(listMarkup());
    await flush();
    expect(list.pages.size).toBe(2);
    htmlSpy.mockClear();

    document.dispatchEvent(new FilterUpdateEvent(new URLSearchParams('filter.x=1')));
    expect(list.pages.size).toBe(0);

    list.refs.grid.dataset.lastPage = '5';
    await flush();

    expect(requestedPages()).toEqual(['3']);
    expect(FakeIntersectionObserver.instances).toHaveLength(1);
  });

  it('does not refetch after a filter update when disconnected', async () => {
    const list = mount(listMarkup());
    await flush();
    const grid = list.refs.grid;
    htmlSpy.mockClear();

    document.dispatchEvent(new FilterUpdateEvent(new URLSearchParams('')));
    // Disconnect the observer before mutating so we reach the isConnected branch
    list.remove();
    document.body.appendChild(grid);
    grid.dataset.lastPage = '7';
    await flush();

    expect(htmlSpy).not.toHaveBeenCalled();
    expect(FakeIntersectionObserver.instances[0].disconnect).toHaveBeenCalled();
  });

  it('stops watching for grid changes after the fallback timeout', async () => {
    const list = mount(listMarkup());
    await flush();
    htmlSpy.mockClear();
    vi.useFakeTimers();

    document.dispatchEvent(new FilterUpdateEvent(new URLSearchParams('')));
    vi.advanceTimersByTime(3000);
    vi.useRealTimers();

    list.refs.grid.dataset.lastPage = '9';
    await flush();
    expect(htmlSpy).not.toHaveBeenCalled();
  });

  it('unblocks a render that is waiting when filters update', async () => {
    let resolveFetch;
    const list = mount(listMarkup());
    await flush();
    list.pages.clear();
    htmlSpy.mockImplementation(() => new Promise((r) => (resolveFetch = r)));

    const [observer] = FakeIntersectionObserver.instances;
    const render = observer.trigger([{ isIntersecting: true, target: list.refs.viewMoreNext }]);
    await flush();

    document.dispatchEvent(new FilterUpdateEvent(new URLSearchParams('')));
    await render;
    expect(list.refs.grid.children).toHaveLength(2);
    resolveFetch('');
  });

  it('handles filter updates without a grid', async () => {
    const list = mount('<test-paginated-list section-id="main"></test-paginated-list>');
    document.dispatchEvent(new FilterUpdateEvent(new URLSearchParams('')));
    expect(list.pages.size).toBe(0);
  });

  it('requires a section id', () => {
    const list = mount('<test-paginated-list></test-paginated-list>');
    expect(() => list.sectionId).toThrow('The section-id attribute is required');
  });
});
