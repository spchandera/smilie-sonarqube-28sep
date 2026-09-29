import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';

vi.stubGlobal('Shopify', { designMode: false });

const { sectionRenderer } = await import('@theme/section-renderer');
const { FilterUpdateEvent, ThemeEvents } = await import('@theme/events');
await import('@theme/facets');

afterAll(() => {
  vi.unstubAllGlobals();
});

function mount(html) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper);
  return wrapper;
}

const facetsMarkup = ({ filterStyle = 'vertical', facetType = '' } = {}) => `
  <div class="shopify-section" id="shopify-section-main">
    <facets-form-component section-id="main" id="FacetsForm">
      <form ref="facetsForm">
        <input type="hidden" name="page" value="3">
        <details id="vendor-details">
          <summary>
            Vendor
            <facet-status-component data-filter-style="${filterStyle}" facet-type="${facetType}">
              <span ref="facetStatus"></span>
            </facet-status-component>
          </summary>
          <facet-inputs-component>
            <label id="label-a"><input type="checkbox" ref="facetInputs[]" name="filter.p.vendor" value="A" data-label="Alpha" aria-label="Alpha"><span class="swatch" style="--c:red"></span></label>
            <label id="label-b"><input type="checkbox" ref="facetInputs[]" name="filter.p.vendor" value="B" data-label="Beta" aria-label="Beta"><span class="swatch"></span></label>
            <label id="label-c"><input type="checkbox" ref="facetInputs[]" name="filter.p.vendor" value="C" data-label="Gamma" aria-label="Gamma"></label>
            <label id="label-d"><input type="checkbox" ref="facetInputs[]" name="filter.p.vendor" value="D" data-label="Delta" aria-label="Delta"></label>
            <span id="inside-inputs"></span>
          </facet-inputs-component>
          <facet-clear-component>
            <button type="button" ref="clearButton" id="vendor-clear">Clear</button>
          </facet-clear-component>
        </details>
        <details id="price-details">
          <summary>
            Price
            <facet-status-component>
              <span ref="facetStatus" data-currency="USD" data-range-max="100.00"></span>
              <template ref="moneyFormat">\${{amount}}</template>
            </facet-status-component>
          </summary>
          <price-facet-component data-currency="USD" data-money-format="\${{amount}} USD">
            <input ref="minInput" name="filter.v.price.gte" value="" data-min="10" data-max="100">
            <input ref="maxInput" name="filter.v.price.lte" value="" data-min="10" data-max="100">
          </price-facet-component>
        </details>
      </form>
      <facet-remove-component data-url="/collections/all?filter.p.vendor=B" active-class="is-on">
        <button ref="clearButton">Remove</button>
      </facet-remove-component>
    </facets-form-component>
  </div>`;

let renderSpy;
let htmlSpy;

beforeEach(() => {
  history.replaceState(null, '', '/collections/all');
  renderSpy = vi.spyOn(sectionRenderer, 'renderSection').mockResolvedValue(undefined);
  htmlSpy = vi.spyOn(sectionRenderer, 'getSectionHTML').mockResolvedValue('');
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.useRealTimers();
  history.replaceState(null, '', '/');
});

describe('FacetsFormComponent', () => {
  it('builds URL parameters, dropping empty prices and page, keeping the search query', () => {
    history.replaceState(null, '', '/search?q=shoes&page=2');
    const root = mount(facetsMarkup());
    const form = root.querySelector('facets-form-component');
    root.querySelector('#label-a input').checked = true;

    const params = form.createURLParameters();

    expect(params.getAll('filter.p.vendor')).toEqual(['A']);
    expect(params.has('filter.v.price.gte')).toBe(false);
    expect(params.has('filter.v.price.lte')).toBe(false);
    expect(params.has('page')).toBe(false);
    expect(params.get('q')).toBe('shoes');
  });

  it('keeps non-empty price values and omits q when there is no search', () => {
    const root = mount(facetsMarkup());
    const form = root.querySelector('facets-form-component');
    const data = new FormData();
    data.append('filter.v.price.gte', '5');
    data.append('filter.v.price.lte', '50');

    const params = form.createURLParameters(data);
    expect(params.toString()).toBe('filter.v.price.gte=5&filter.v.price.lte=50');
  });

  it('pushes the new URL, dispatches a filter update and renders the section', () => {
    const root = mount(facetsMarkup());
    const form = root.querySelector('facets-form-component');
    root.querySelector('#label-b input').checked = true;
    const events = [];
    const listener = (e) => events.push(e);
    document.addEventListener(ThemeEvents.FilterUpdate, listener);

    form.updateFilters();

    document.removeEventListener(ThemeEvents.FilterUpdate, listener);
    expect(window.location.search).toBe('?filter.p.vendor=B');
    expect(history.state).toEqual({ urlParameters: 'filter.p.vendor=B' });
    expect(events).toHaveLength(1);
    expect(events[0]).toBeInstanceOf(FilterUpdateEvent);
    expect(events[0].detail.queryParams.get('filter.p.vendor')).toBe('B');
    expect(renderSpy).toHaveBeenCalledWith('main');
  });

  it('renders without a view transition when inside a dialog', () => {
    const dialog = document.createElement('dialog');
    document.body.appendChild(dialog);
    dialog.innerHTML = facetsMarkup();
    const form = dialog.querySelector('facets-form-component');

    form.updateFilters();
    expect(renderSpy).toHaveBeenCalledWith('main');
  });

  it('updates filters from a URL', () => {
    const root = mount(facetsMarkup());
    const form = root.querySelector('facets-form-component');
    const listener = vi.fn();
    document.addEventListener(ThemeEvents.FilterUpdate, listener);

    form.updateFiltersByURL('/collections/all?filter.p.vendor=C');

    document.removeEventListener(ThemeEvents.FilterUpdate, listener);
    expect(window.location.search).toBe('?filter.p.vendor=C');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(renderSpy).toHaveBeenCalledWith('main');
  });

  it('requires a section-id attribute', () => {
    const root = mount(facetsMarkup());
    const form = root.querySelector('facets-form-component');
    form.removeAttribute('section-id');
    expect(() => form.sectionId).toThrow('Section ID is required');
  });
});

describe('FacetInputsComponent', () => {
  it('reports its section id and throws outside a section', () => {
    const root = mount(facetsMarkup());
    expect(root.querySelector('facet-inputs-component').sectionId).toBe('shopify-section-main');

    const orphan = mount('<facet-inputs-component></facet-inputs-component>').firstElementChild;
    expect(() => orphan.sectionId).toThrow('must be a child of a section');
  });

  it('updates filters and a bubble summary of the checked inputs', () => {
    const root = mount(facetsMarkup());
    const inputs = root.querySelector('facet-inputs-component');
    const status = root.querySelector('#vendor-details [ref="facetStatus"]');
    root.querySelector('#label-a input').checked = true;
    root.querySelector('#label-b input').checked = true;

    inputs.updateFilters();

    expect(renderSpy).toHaveBeenCalledWith('main');
    expect(status.textContent).toBe('2');
    expect(status.classList.contains('facets__bubble')).toBe(true);
  });

  it('does nothing outside a facets form', () => {
    const el = mount('<facet-inputs-component></facet-inputs-component>').firstElementChild;
    el.updateFilters();
    expect(renderSpy).not.toHaveBeenCalled();
  });

  it('toggles the inner input with Enter or Space and ignores other keys', () => {
    const root = mount(facetsMarkup());
    const inputs = root.querySelector('facet-inputs-component');
    const label = root.querySelector('#label-c');
    const input = label.querySelector('input');

    const enter = { key: 'Enter', target: label, preventDefault: vi.fn() };
    inputs.handleKeyDown(enter);
    expect(input.checked).toBe(true);
    expect(enter.preventDefault).toHaveBeenCalled();

    inputs.handleKeyDown({ key: ' ', target: label, preventDefault: vi.fn() });
    expect(input.checked).toBe(false);

    inputs.handleKeyDown({ key: 'a', target: label, preventDefault: vi.fn() });
    expect(input.checked).toBe(false);

    // Targets without an input, or non-elements, are ignored
    inputs.handleKeyDown({ key: 'Enter', target: root.querySelector('#inside-inputs') });
    inputs.handleKeyDown({ key: 'Enter', target: {} });
    expect(renderSpy).toHaveBeenCalledTimes(2);
  });

  it('prefetches the page that hovering a facet would produce (debounced)', () => {
    vi.useFakeTimers();
    const root = mount(facetsMarkup());
    const inputs = root.querySelector('facet-inputs-component');
    root.querySelector('#label-a input').checked = true;

    inputs.prefetchPage({ target: root.querySelector('#label-b') });
    expect(htmlSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);

    expect(htmlSpy).toHaveBeenCalledTimes(1);
    const [sectionId, useCache, url] = htmlSpy.mock.calls[0];
    expect(sectionId).toBe('shopify-section-main');
    expect(useCache).toBe(true);
    expect(url.pathname).toBe('/collections/all');
    expect(url.searchParams.getAll('filter.p.vendor')).toEqual(['A', 'B']);
  });

  it('prefetches the page without an already checked facet', () => {
    vi.useFakeTimers();
    const root = mount(facetsMarkup());
    const inputs = root.querySelector('facet-inputs-component');
    root.querySelector('#label-a input').checked = true;
    root.querySelector('#label-b input').checked = true;

    inputs.prefetchPage({ target: root.querySelector('#label-a') });
    vi.advanceTimersByTime(200);

    expect(htmlSpy.mock.calls[0][2].searchParams.getAll('filter.p.vendor')).toEqual(['B']);
  });

  it('can cancel a pending prefetch and ignores invalid targets', () => {
    vi.useFakeTimers();
    const root = mount(facetsMarkup());
    const inputs = root.querySelector('facet-inputs-component');

    inputs.prefetchPage({ target: root.querySelector('#label-a') });
    inputs.cancelPrefetchPage();
    vi.advanceTimersByTime(500);

    inputs.prefetchPage({ target: {} });
    vi.advanceTimersByTime(200);
    inputs.prefetchPage({ target: root.querySelector('#inside-inputs') });
    vi.advanceTimersByTime(200);

    const orphan = mount('<facet-inputs-component><label><input></label></facet-inputs-component>');
    orphan.firstElementChild.prefetchPage({ target: orphan.querySelector('label') });
    vi.advanceTimersByTime(200);

    const formWithoutFacets = mount(
      '<form><facet-inputs-component><label><input name="x" value="1"></label></facet-inputs-component></form>'
    );
    formWithoutFacets.querySelector('facet-inputs-component').prefetchPage({
      target: formWithoutFacets.querySelector('label'),
    });
    vi.advanceTimersByTime(200);

    expect(htmlSpy).not.toHaveBeenCalled();
  });
});

describe('FacetStatusComponent', () => {
  it('shows the label for a single horizontal filter and clears for none', () => {
    const root = mount(facetsMarkup({ filterStyle: 'horizontal' }));
    const status = root.querySelector('#vendor-details facet-status-component');
    const span = status.querySelector('[ref="facetStatus"]');
    const input = root.querySelector('#label-a input');

    status.updateListSummary([input]);
    expect(span.textContent).toBe('Alpha');
    expect(span.classList.contains('bubble')).toBe(false);

    status.updateListSummary([]);
    expect(span.innerHTML).toBe('');
  });

  it('renders swatches for up to three selections and a count beyond that', () => {
    const root = mount(facetsMarkup({ facetType: 'swatches' }));
    const status = root.querySelector('#vendor-details facet-status-component');
    const span = status.querySelector('[ref="facetStatus"]');
    const all = [...root.querySelectorAll('facet-inputs-component input')];

    status.updateListSummary(all.slice(0, 3));
    expect(span.querySelectorAll('span.swatch')).toHaveLength(2);
    expect([...span.querySelectorAll('.visually-hidden')].map((s) => s.textContent)).toEqual([
      'Alpha',
      'Beta',
      'Gamma',
    ]);

    status.updateListSummary(all);
    expect(span.textContent).toBe('4');
    expect(span.classList.contains('facets__bubble')).toBe(true);

    status.updateListSummary([]);
    expect(span.innerHTML).toBe('');
    expect(span.classList.contains('bubble')).toBe(false);
  });

  it('formats a price range summary with fallbacks', () => {
    const root = mount(facetsMarkup());
    const status = root.querySelector('#price-details facet-status-component');
    const span = status.querySelector('[ref="facetStatus"]');
    const min = document.createElement('input');
    const max = document.createElement('input');

    status.updatePriceSummary(min, max);
    expect(span.innerHTML).toBe('');

    min.value = '12.5';
    max.value = '80';
    status.updatePriceSummary(min, max);
    expect(span.textContent).toBe('$12.50–$80.00');

    min.value = '';
    max.value = 'abc';
    status.updatePriceSummary(min, max);
    expect(span.textContent).toBe('$0.00–$100.00');

    span.dataset.rangeMax = 'n/a';
    status.updatePriceSummary(min, max);
    expect(span.textContent).toBe('$0.00–$0.00');

    status.clearSummary();
    expect(span.innerHTML).toBe('');
  });

  it('renders an empty amount when no money format template exists', () => {
    const root = mount('<facet-status-component><span ref="facetStatus"></span></facet-status-component>');
    const status = root.firstElementChild;
    const min = Object.assign(document.createElement('input'), { value: '1' });
    const max = Object.assign(document.createElement('input'), { value: '2' });
    status.updatePriceSummary(min, max);
    expect(status.refs.facetStatus.textContent).toBe('–');
  });
});

describe('PriceFacetComponent', () => {
  it('reads currency and strips symbols from the money format', () => {
    const root = mount(facetsMarkup());
    const price = root.querySelector('price-facet-component');
    expect(price.currency).toBe('USD');
    expect(price.moneyFormat).toBe('{{amount}}');

    const defaults = mount('<price-facet-component data-money-format="no placeholder"></price-facet-component>');
    expect(defaults.firstElementChild.currency).toBe('USD');
    expect(defaults.firstElementChild.moneyFormat).toBe('{{amount}}');
  });

  it('only allows numeric and navigation keys', () => {
    const root = mount(facetsMarkup());
    const price = root.querySelector('price-facet-component');
    const press = (key, init = {}) => {
      const event = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true, ...init });
      price.dispatchEvent(event);
      return event.defaultPrevented;
    };

    expect(press('5')).toBe(false);
    expect(press('Backspace')).toBe(false);
    expect(press('x')).toBe(true);
    expect(press('x', { metaKey: true })).toBe(false);

    price.remove();
    expect(press('x')).toBe(false);
  });

  it('clamps values to the allowed range, updates filters and the summary', () => {
    const root = mount(facetsMarkup());
    const price = root.querySelector('price-facet-component');
    const { minInput, maxInput } = price.refs;
    const summary = root.querySelector('#price-details [ref="facetStatus"]');

    minInput.value = '5';
    maxInput.value = '500';
    price.updatePriceFilterAndResults();

    expect(minInput.value).toBe('10.00');
    expect(maxInput.value).toBe('100.00');
    expect(minInput.dataset.max).toBe('100.00');
    expect(maxInput.dataset.min).toBe('10.00');
    expect(renderSpy).toHaveBeenCalledWith('main');
    expect(window.location.search).toContain('filter.v.price.gte=10.00');
    expect(summary.textContent).toBe('$10.00–$100.00');
  });

  it('resets bounds when inputs are cleared and leaves in-range values', () => {
    const root = mount(facetsMarkup());
    const price = root.querySelector('price-facet-component');
    const { minInput, maxInput } = price.refs;

    minInput.value = '';
    maxInput.value = '';
    price.updatePriceFilterAndResults();
    expect(maxInput.dataset.min).toBe('0');
    expect(minInput.dataset.max).toBe('100');

    minInput.value = '20';
    price.updatePriceFilterAndResults();
    expect(minInput.value).toBe('20');
  });

  it('stops before filtering outside a facets form', () => {
    const root = mount(
      '<price-facet-component><input ref="minInput" value="1" data-min="0" data-max="5"><input ref="maxInput" value="" data-max="5"></price-facet-component>'
    );
    root.firstElementChild.updatePriceFilterAndResults();
    expect(renderSpy).not.toHaveBeenCalled();
  });
});

describe('FacetClearComponent', () => {
  it('clears inputs, the summary and re-filters', () => {
    const root = mount(facetsMarkup());
    const clear = root.querySelector('facet-clear-component');
    const status = root.querySelector('#vendor-details [ref="facetStatus"]');
    const inputs = [...root.querySelectorAll('facet-inputs-component input')];
    inputs[0].checked = true;
    status.textContent = '1';

    clear.clearFilter({ target: root.querySelector('#inside-inputs') });

    expect(inputs.every((i) => !i.checked && i.value === '')).toBe(true);
    expect(status.innerHTML).toBe('');
    expect(renderSpy).toHaveBeenCalledWith('main');
  });

  it('handles keyboard activation and ignores other keys', () => {
    const root = mount(facetsMarkup());
    const clear = root.querySelector('facet-clear-component');
    const target = root.querySelector('#inside-inputs');

    const other = new KeyboardEvent('keyup', { key: 'a' });
    Object.defineProperty(other, 'target', { value: target });
    clear.clearFilter(other);
    expect(renderSpy).not.toHaveBeenCalled();

    clear.clearFilter({ target: {} });
    expect(renderSpy).not.toHaveBeenCalled();

    const space = new KeyboardEvent('keyup', { key: ' ', cancelable: true });
    Object.defineProperty(space, 'target', { value: target });
    clear.clearFilter(space);
    expect(space.defaultPrevented).toBe(true);
    expect(renderSpy).toHaveBeenCalledTimes(1);

    root.querySelector('#vendor-clear').dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
    expect(renderSpy).toHaveBeenCalledTimes(2);

    root.querySelector('#vendor-clear').dispatchEvent(
      new KeyboardEvent('keyup', { key: 'Enter', metaKey: true, bubbles: true })
    );
    expect(renderSpy).toHaveBeenCalledTimes(2);
  });

  it('stops when there is no status component or facets form', () => {
    const root = mount(
      '<facet-clear-component><button ref="clearButton"></button></facet-clear-component><details><facet-status-component><span ref="facetStatus">x</span></facet-status-component><span id="t"></span></details>'
    );
    const clear = root.querySelector('facet-clear-component');
    clear.clearFilter({ target: clear.refs.clearButton });
    clear.clearFilter({ target: root.querySelector('#t') });
    expect(root.querySelector('[ref="facetStatus"]').innerHTML).toBe('');
    expect(renderSpy).not.toHaveBeenCalled();
  });

  it('toggles the clear button on filter updates until disconnected', () => {
    const root = mount(facetsMarkup());
    const button = root.querySelector('#vendor-clear');

    document.dispatchEvent(new FilterUpdateEvent(new URLSearchParams('filter.p.vendor=A')));
    expect(button.classList.contains('facets__clear--active')).toBe(true);

    document.dispatchEvent(new FilterUpdateEvent(new URLSearchParams('sort_by=price')));
    expect(button.classList.contains('facets__clear--active')).toBe(false);

    root.querySelector('facet-clear-component').remove();
    document.dispatchEvent(new FilterUpdateEvent(new URLSearchParams('filter.p.vendor=A')));
    expect(button.classList.contains('facets__clear--active')).toBe(false);
  });
});

describe('FacetRemoveComponent', () => {
  it('updates filters from its URL via the form id or closest form', () => {
    const root = mount(facetsMarkup());
    const remove = root.querySelector('facet-remove-component');

    remove.removeFilter({ form: 'FacetsForm' }, new MouseEvent('click'));
    expect(window.location.search).toBe('?filter.p.vendor=B');

    remove.dataset.url = '/collections/all?filter.p.vendor=D';
    remove.removeFilter({}, new MouseEvent('click'));
    expect(window.location.search).toBe('?filter.p.vendor=D');
    expect(renderSpy).toHaveBeenCalledTimes(2);
  });

  it('respects keyboard keys, missing URLs and unknown forms', () => {
    const root = mount(facetsMarkup());
    const remove = root.querySelector('facet-remove-component');

    remove.removeFilter({}, new KeyboardEvent('keydown', { key: 'a' }));
    remove.removeFilter({ form: 'missing' }, new MouseEvent('click'));
    delete remove.dataset.url;
    remove.removeFilter({}, new MouseEvent('click'));
    expect(renderSpy).not.toHaveBeenCalled();

    remove.dataset.url = '/collections/all?x=1';
    const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    remove.removeFilter({}, enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(renderSpy).toHaveBeenCalledTimes(1);
  });

  it('toggles its configured active class on filter updates', () => {
    const root = mount(facetsMarkup());
    const remove = root.querySelector('facet-remove-component');
    const button = remove.querySelector('button');

    document.dispatchEvent(new FilterUpdateEvent(new URLSearchParams('filter.p.vendor=A')));
    expect(button.classList.contains('is-on')).toBe(true);

    remove.removeAttribute('active-class');
    document.dispatchEvent(new FilterUpdateEvent(new URLSearchParams('filter.x=1')));
    expect(button.classList.contains('active')).toBe(true);

    remove.remove();
    document.dispatchEvent(new FilterUpdateEvent(new URLSearchParams('')));
    expect(button.classList.contains('active')).toBe(true);
  });
});

describe('SortingFilterComponent', () => {
  const sortingMarkup = (attrs = 'data-should-use-select-on-mobile="true"') => `
    <div class="shopify-section" id="shopify-section-main">
      <facets-form-component section-id="main">
        <form ref="facetsForm"></form>
      </facets-form-component>
      <sorting-filter-component ${attrs}>
        <details ref="details" data-default-sort-by="manual">
          <summary ref="summary" tabindex="0">Sort
            <facet-status-component><span ref="facetStatus"></span></facet-status-component>
          </summary>
          <div ref="listbox">
            <div role="option" id="opt-0" tabindex="0" aria-selected="true"><input type="radio" name="sort_by" value="manual"></div>
            <div role="option" id="opt-1" tabindex="-1" aria-selected="false"><input type="radio" name="sort_by" value="price"></div>
            <div role="option" id="opt-2" tabindex="-1" aria-selected="false"><span>no input</span></div>
          </div>
        </details>
        <select name="sort_by"><option value="manual">Manual</option><option value="price" data-option-name="Price">Price</option></select>
      </sorting-filter-component>
    </div>`;

  let widthSpy;
  beforeEach(() => {
    widthSpy = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1024);
  });

  const key = (k, target) => ({ key: k, target, preventDefault: vi.fn() });

  it('moves focus through options with the arrow keys', () => {
    const root = mount(sortingMarkup());
    const sorting = root.querySelector('sorting-filter-component');
    const opts = [...root.querySelectorAll('[role="option"]')];

    sorting.handleKeyDown(key('ArrowDown'));
    expect(opts[1].tabIndex).toBe(0);
    expect(opts[0].tabIndex).toBe(-1);
    expect(document.activeElement).toBe(opts[1]);

    sorting.handleKeyDown(key('ArrowDown'));
    sorting.handleKeyDown(key('ArrowDown'));
    expect(opts[2].tabIndex).toBe(0);

    sorting.handleKeyDown(key('ArrowUp'));
    expect(opts[1].tabIndex).toBe(0);

    opts.forEach((o) => (o.tabIndex = -1));
    sorting.handleKeyDown(key('ArrowUp'));
    expect(opts[0].tabIndex).toBe(0);
  });

  it('selects an option with Enter and closes the dropdown', () => {
    const root = mount(sortingMarkup());
    const sorting = root.querySelector('sorting-filter-component');
    const details = sorting.refs.details;
    details.open = true;
    const radio = root.querySelector('#opt-1 input');
    const click = vi.spyOn(radio, 'click');

    const event = key('Enter', root.querySelector('#opt-1 input'));
    sorting.handleKeyDown(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(root.querySelector('#opt-1').getAttribute('aria-selected')).toBe('true');
    expect(root.querySelector('#opt-0').getAttribute('aria-selected')).toBe('false');
    expect(root.querySelector('#opt-1').tabIndex).toBe(0);
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(sorting.refs.summary);
  });

  it('ignores Enter on options without a radio or outside options, and Escape closes', () => {
    const root = mount(sortingMarkup());
    const sorting = root.querySelector('sorting-filter-component');
    const details = sorting.refs.details;
    details.open = true;

    sorting.handleKeyDown(key(' ', root.querySelector('#opt-2 span')));
    expect(details.open).toBe(true);
    const outside = key('Enter', sorting.refs.summary);
    sorting.handleKeyDown(outside);
    expect(outside.preventDefault).not.toHaveBeenCalled();
    sorting.handleKeyDown(key('Enter', {}));
    sorting.handleKeyDown(key('Tab'));
    expect(details.open).toBe(true);

    sorting.handleKeyDown(key('Escape'));
    expect(details.open).toBe(false);
  });

  it('syncs aria-expanded and focuses the selected option on toggle', () => {
    const root = mount(sortingMarkup());
    const sorting = root.querySelector('sorting-filter-component');
    const { details, summary } = sorting.refs;

    details.open = true;
    sorting.handleToggle();
    expect(summary.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(root.querySelector('#opt-0'));

    details.open = false;
    sorting.handleToggle();
    expect(summary.getAttribute('aria-expanded')).toBe('false');
  });

  it('updates sorting on desktop, toggling the select and facet status', () => {
    const root = mount(sortingMarkup());
    const sorting = root.querySelector('sorting-filter-component');
    const select = root.querySelector('select');
    const status = root.querySelector('facet-status-component');
    select.value = 'price';
    select.dataset.optionName = 'Price';
    sorting.refs.details.open = true;

    sorting.updateFilterAndSorting({ target: select });

    expect(renderSpy).toHaveBeenCalledWith('main');
    expect(status.textContent).toBe('Price');
    expect(select.disabled).toBe(false);
    expect(sorting.refs.details.open).toBe(false);

    select.value = 'manual';
    sorting.updateFacetStatus({ target: select });
    expect(status.textContent).toBe('');
  });

  it('disables radio inputs on mobile while submitting', () => {
    widthSpy.mockReturnValue(375);
    const root = mount(sortingMarkup());
    const sorting = root.querySelector('sorting-filter-component');
    const radios = [...root.querySelectorAll('input[name="sort_by"]')];
    const states = [];
    renderSpy.mockImplementation(() => {
      states.push(radios.map((r) => r.disabled));
      return Promise.resolve();
    });

    sorting.updateFilterAndSorting({ target: radios[1] });

    expect(states).toEqual([[true, true]]);
    expect(radios.every((r) => !r.disabled)).toBe(true);
  });

  it('bails out when the desktop select is missing or no form exists', () => {
    const root = mount(sortingMarkup());
    const sorting = root.querySelector('sorting-filter-component');
    root.querySelector('select').remove();
    sorting.updateFilterAndSorting({ target: null });
    expect(renderSpy).not.toHaveBeenCalled();

    const noSelectDisabled = mount(sortingMarkup('')).querySelector('sorting-filter-component');
    noSelectDisabled.querySelector('select').remove();
    noSelectDisabled.updateFilterAndSorting({ target: null });
    expect(renderSpy).toHaveBeenCalledTimes(1);

    document.body.innerHTML = '';
    const lone = mount(sortingMarkup().replace(/<facets-form-component[\s\S]*?<\/facets-form-component>/, ''));
    lone.querySelector('sorting-filter-component').updateFilterAndSorting({ target: null });
    expect(renderSpy).toHaveBeenCalledTimes(1);
  });

  it('ignores status updates without a select, details or status', () => {
    const root = mount(sortingMarkup());
    const sorting = root.querySelector('sorting-filter-component');
    const status = root.querySelector('facet-status-component');
    status.textContent = 'keep';
    sorting.updateFacetStatus({ target: document.createElement('input') });
    expect(status.textContent).toBe('keep');

    status.remove();
    sorting.updateFacetStatus({ target: root.querySelector('select') });
    sorting.refs.details.remove();
    sorting.updateFacetStatus({ target: root.querySelector('select') });
  });
});
