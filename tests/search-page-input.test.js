import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';

describe('search-page-input-component', () => {
  let component;
  let input;
  let submit;

  beforeAll(async () => {
    await import('@theme/search-page-input');
  });

  beforeEach(() => {
    vi.useFakeTimers();
    submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});
    document.body.innerHTML = `
      <form action="/search">
        <search-page-input-component>
          <input ref="searchPageInput" name="q" />
        </search-page-input-component>
      </form>`;
    component = document.querySelector('search-page-input-component');
    input = component.refs.searchPageInput;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.history.replaceState({}, '', '/');
    document.body.innerHTML = '';
  });

  const press = (key) => {
    component.handleKeyDown(new KeyboardEvent('keydown', { key }));
    vi.advanceTimersByTime(100);
  };

  it('submits an empty search on Escape when the URL has a query', () => {
    window.history.replaceState({}, '', '/search?q=shoes');
    input.value = '   ';

    press('Escape');

    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('does not submit when the page is already an empty search', () => {
    window.history.replaceState({}, '', '/search?q=%20');
    press('Escape');
    expect(submit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
  });

  it('ignores Escape when the input has text', () => {
    window.history.replaceState({}, '', '/search?q=shoes');
    input.value = 'boots';
    press('Escape');
    expect(submit).not.toHaveBeenCalled();
    expect(input.value).toBe('boots');
  });

  it('ignores other keys', () => {
    window.history.replaceState({}, '', '/search?q=shoes');
    press('Enter');
    expect(submit).not.toHaveBeenCalled();
  });

  it('debounces rapid key presses', () => {
    window.history.replaceState({}, '', '/search?q=shoes');
    component.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));
    vi.advanceTimersByTime(50);
    expect(submit).not.toHaveBeenCalled();
    component.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));
    vi.advanceTimersByTime(100);
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
