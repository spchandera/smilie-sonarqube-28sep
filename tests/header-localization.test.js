import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

const FORM = `
  <localization-form-component data-label-results-count="[count] results">
    <form ref="form" action="/localization">
      <input type="hidden" ref="countryInput" name="country_code" />
      <select ref="languageInput" name="locale_code" on:change="/changeLanguage">
        <option value="en" selected>English</option>
        <option value="fr">Français</option>
      </select>
      <div class="country-filter">
        <input ref="search" type="search" />
        <button type="button" ref="resetButton" hidden>Reset</button>
      </div>
      <div class="country-selector-form__wrapper">
        <ul ref="popularCountries"><li>Popular</li></ul>
        <div ref="countryList">
          <li ref="countryListItems[]" id="c-au" tabindex="-1" data-value="AU" data-aliases="Oz,Straya">
            <span class="country">Australia</span><span class="localization-form__currency">AUD $</span>
          </li>
          <li ref="countryListItems[]" id="c-ci" tabindex="-1" data-value="CI">
            <span class="country">Côte d'Ivoire</span><span class="localization-form__currency">XOF Fr</span>
          </li>
          <li ref="countryListItems[]" id="c-us" tabindex="-1" data-value="US" data-aliases="America,USA">
            <span class="country">United States</span><span class="localization-form__currency">USD $</span>
          </li>
        </div>
      </div>
      <div ref="liveRegion" aria-live="polite"></div>
      <span ref="noResultsMessage" hidden>No results</span>
    </form>
  </localization-form-component>`;

describe('localization components', () => {
  let submit;

  beforeAll(async () => {
    await import('@theme/localization');
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('CSS', { supports: vi.fn(() => false) });
    submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('localization-form-component', () => {
    let form;
    let refs;

    beforeEach(() => {
      document.body.innerHTML = FORM;
      form = document.querySelector('localization-form-component');
      refs = form.refs;
    });

    const visible = () => refs.countryListItems.filter((el) => !el.hidden).map((el) => el.dataset.value);
    const typeSearch = (value) => {
      refs.search.value = value;
      form.filterCountries();
    };

    it('filters by label and highlights the non-matching parts', () => {
      typeSearch('stral');

      expect(visible()).toEqual(['AU']);
      expect(refs.countryListItems[0].querySelector('.country').innerHTML).toBe('<mark>Au</mark>stral<mark>ia</mark>');
      expect(refs.resetButton.hidden).toBe(false);
      expect(refs.popularCountries.hidden).toBe(true);
      expect(form.querySelector('.country-selector-form__wrapper').classList.contains('is-searching')).toBe(true);
      expect(refs.liveRegion.innerText).toBe('1 results');
      expect(refs.noResultsMessage.hidden).toBe(true);
    });

    it('matches ignoring diacritics and case', () => {
      typeSearch('COTE');
      expect(visible()).toEqual(['CI']);
    });

    it('matches by alias prefix, ISO code and currency', () => {
      typeSearch('str');
      expect(visible()).toEqual(['AU']);

      typeSearch('us');
      expect(visible()).toEqual(expect.arrayContaining(['US']));

      typeSearch('xof');
      expect(visible()).toEqual(['CI']);
    });

    it('shows the no results message when nothing matches', () => {
      typeSearch('zzzz');
      expect(visible()).toEqual([]);
      expect(refs.noResultsMessage.hidden).toBe(false);
      expect(refs.liveRegion.innerText).toBe('0 results');
    });

    it('restores all countries when the search is cleared', () => {
      typeSearch('stral');
      typeSearch('');
      expect(visible()).toEqual(['AU', 'CI', 'US']);
      expect(refs.countryListItems[0].querySelector('.country').innerHTML).toBe('Australia');
      expect(refs.resetButton.hidden).toBe(true);
      expect(refs.popularCountries.hidden).toBe(false);
      expect(refs.noResultsMessage.hidden).toBe(true);
    });

    it('resetCountriesFilter clears the search and focuses it', () => {
      typeSearch('stral');
      const event = new Event('click');
      const stop = vi.spyOn(event, 'stopPropagation');
      form.resetCountriesFilter(event);

      expect(stop).toHaveBeenCalled();
      expect(refs.search.value).toBe('');
      expect(visible()).toHaveLength(3);
      expect(refs.search.getAttribute('aria-activedescendant')).toBe('');
      expect(document.activeElement).toBe(refs.search);
    });

    it('resetForm only acts when the search has a value', () => {
      form.resetForm();
      expect(refs.search.hasAttribute('aria-activedescendant')).toBe(false);

      typeSearch('stral');
      form.resetForm();
      expect(refs.search.value).toBe('');
      expect(visible()).toHaveLength(3);
      expect(refs.search.getAttribute('aria-activedescendant')).toBe('');
    });

    it('selectCountry sets the country code and submits', () => {
      const event = new Event('click', { cancelable: true });
      form.selectCountry('US', event);
      expect(event.defaultPrevented).toBe(true);
      expect(refs.countryInput.value).toBe('US');
      expect(submit).toHaveBeenCalledTimes(1);
    });

    it('changeLanguage updates the language and submits', () => {
      refs.languageInput.value = 'fr';
      refs.languageInput.dispatchEvent(new Event('change', { bubbles: true }));
      expect(submit).toHaveBeenCalledTimes(1);
      expect(refs.languageInput.value).toBe('fr');

      form.changeLanguage({ target: document.body });
      expect(submit).toHaveBeenCalledTimes(1);
    });

    it('resizes the language select to the selected option width', () => {
      Object.defineProperty(refs.languageInput, 'offsetWidth', { configurable: true, value: 80.2 });
      form.resizeLanguageInput();
      expect(refs.languageInput.style.width).toBe('82px');
      expect(refs.languageInput.options[1].textContent).toBe('Français');
      expect(refs.languageInput.options[1].dataset.optionLabel).toBeUndefined();
    });

    it('skips resizing when field-sizing is supported', () => {
      CSS.supports.mockReturnValue(true);
      form.resizeLanguageInput();
      expect(refs.languageInput.style.width).toBe('');
    });

    it('moves focus through visible countries with arrow keys and updates aria-activedescendant', () => {
      typeSearch('');
      const down = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true, bubbles: true });
      refs.search.dispatchEvent(down);
      expect(down.defaultPrevented).toBe(true);
      expect(document.activeElement.id).toBe('c-au');
      expect(refs.countryListItems[0].getAttribute('aria-selected')).toBe('true');
      vi.runAllTimers();
      expect(refs.search.getAttribute('aria-activedescendant')).toBe('c-au');

      refs.countryList.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      expect(document.activeElement.id).toBe('c-ci');
      expect(refs.countryListItems[0].getAttribute('aria-selected')).toBe('false');

      refs.countryList.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      refs.countryList.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      expect(document.activeElement.id).toBe('c-us');

      refs.countryList.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      expect(document.activeElement.id).toBe('c-au');
    });

    it('clears aria-activedescendant when focus is not on a country', () => {
      refs.search.setAttribute('aria-activedescendant', 'x');
      refs.search.focus();
      refs.countryList.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
      vi.runAllTimers();
      expect(refs.search.getAttribute('aria-activedescendant')).toBe('');
    });

    it('submits the selected country on Enter in the list', () => {
      refs.countryList.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(submit).not.toHaveBeenCalled();

      refs.countryListItems[2].setAttribute('aria-selected', 'true');
      refs.countryList.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(refs.countryInput.value).toBe('US');
      expect(submit).toHaveBeenCalledTimes(1);
    });

    it('swallows Enter in the search input', () => {
      refs.countryListItems[2].setAttribute('aria-selected', 'true');
      const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
      refs.search.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(submit).not.toHaveBeenCalled();
    });

    it('toggles the filter border when the list scrolls', () => {
      refs.countryList.scrollTop = 20;
      refs.countryList.dispatchEvent(new Event('scroll'));
      expect(form.querySelector('.country-filter').classList.contains('is-scrolled')).toBe(true);
      refs.countryList.scrollTop = 0;
      refs.countryList.dispatchEvent(new Event('scroll'));
      expect(form.querySelector('.country-filter').classList.contains('is-scrolled')).toBe(false);
    });

    it('focusSearchInput focuses the search input', () => {
      form.focusSearchInput();
      expect(document.activeElement).toBe(refs.search);
    });

    it('removes listeners when disconnected', () => {
      const list = refs.countryList;
      form.remove();
      document.body.append(list);
      list.scrollTop = 10;
      list.dispatchEvent(new Event('scroll'));
      expect(document.querySelector('.is-scrolled')).toBeNull();
    });
  });

  describe('dropdown-localization-component', () => {
    let dropdown;
    let button;
    let panel;

    beforeEach(() => {
      document.body.innerHTML = `
        <dropdown-localization-component>
          <button ref="button" aria-expanded="false">Country</button>
          <div ref="panel" hidden>
            ${FORM.replace('<localization-form-component', '<localization-form-component ref="localizationForm"')}
          </div>
        </dropdown-localization-component>
        <p id="outside">outside</p>`;
      dropdown = document.querySelector('dropdown-localization-component');
      button = dropdown.refs.button;
      panel = dropdown.refs.panel;
      Object.defineProperty(dropdown.refs.localizationForm, 'offsetWidth', { configurable: true, value: 240 });
    });

    it('shows the panel, sizes it and focuses the search', async () => {
      dropdown.toggleSelector();
      expect(panel.hidden).toBe(false);
      expect(button.getAttribute('aria-expanded')).toBe('true');
      await flush();
      expect(dropdown.style.getPropertyValue('--width')).toBe('240px');
      expect(document.activeElement).toBe(dropdown.refs.localizationForm.refs.search);

      dropdown.showPanel();
      expect(panel.hidden).toBe(false);
    });

    it('hides the panel and resets the form', () => {
      dropdown.showPanel();
      const search = dropdown.refs.localizationForm.refs.search;
      search.value = 'aus';
      dropdown.toggleSelector();
      expect(panel.hidden).toBe(true);
      expect(button.getAttribute('aria-expanded')).toBe('false');
      expect(search.value).toBe('');

      dropdown.hidePanel();
      expect(panel.hidden).toBe(true);
    });

    it('closes on Escape and returns focus to the button', () => {
      dropdown.showPanel();
      dropdown.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape' }));
      expect(panel.hidden).toBe(true);
      expect(document.activeElement).toBe(button);
    });

    it('ignores other keys', () => {
      dropdown.showPanel();
      dropdown.dispatchEvent(new KeyboardEvent('keyup', { key: 'a' }));
      expect(panel.hidden).toBe(false);
    });

    it('closes when clicking outside but not inside', () => {
      dropdown.showPanel();
      panel.querySelector('li').click();
      expect(panel.hidden).toBe(false);
      document.getElementById('outside').click();
      expect(panel.hidden).toBe(true);
    });
  });

  describe('drawer-localization-component', () => {
    let drawer;
    let details;

    beforeEach(() => {
      document.body.innerHTML = `
        <drawer-localization-component>
          <details id="drawer-details">
            <summary>Country</summary>
            ${FORM.replace('<localization-form-component', '<localization-form-component ref="localizationForm"')}
          </details>
        </drawer-localization-component>`;
      drawer = document.querySelector('drawer-localization-component');
      details = document.getElementById('drawer-details');
    });

    it('focuses the search when opened and toggles the scrolled border', async () => {
      details.open = true;
      drawer.toggle({ target: details });
      await flush();
      expect(document.activeElement).toBe(drawer.refs.localizationForm.refs.search);

      const wrapper = drawer.querySelector('.country-selector-form__wrapper');
      wrapper.scrollTop = 5;
      wrapper.dispatchEvent(new Event('scroll'));
      expect(drawer.querySelector('.country-filter').classList.contains('is-scrolled')).toBe(true);
    });

    it('resets the form and stops tracking scroll when closed', () => {
      const search = drawer.refs.localizationForm.refs.search;
      details.open = true;
      drawer.toggle({ target: details });
      search.value = 'aus';

      details.open = false;
      drawer.toggle({ target: details });
      expect(search.value).toBe('');

      const wrapper = drawer.querySelector('.country-selector-form__wrapper');
      wrapper.scrollTop = 5;
      wrapper.dispatchEvent(new Event('scroll'));
      expect(drawer.querySelector('.country-filter').classList.contains('is-scrolled')).toBe(false);
    });

    it('ignores toggles from non-details targets', () => {
      const search = drawer.refs.localizationForm.refs.search;
      search.value = 'aus';
      drawer.toggle({ target: document.body });
      expect(search.value).toBe('aus');
    });
  });
});
