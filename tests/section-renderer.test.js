import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

globalThis.Shopify = { designMode: false };

const { sectionRenderer, morphSection, buildSectionSelector, normalizeSectionId } = await import('@theme/section-renderer');

function sectionMarkup(id, inner, extra = '') {
  return `<html><body>${extra}<div id="shopify-section-${id}" class="shopify-section">${inner}</div></body></html>`;
}

function mockFetch(bodies) {
  const queue = [...bodies];
  return vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
    Promise.resolve({ text: () => Promise.resolve(queue.length > 1 ? queue.shift() : queue[0]) })
  );
}

beforeEach(() => {
  document.body.innerHTML = '<div id="shopify-section-main" class="shopify-section"><p>old</p></div>';
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('section id helpers', () => {
  it('builds and normalises section ids', () => {
    expect(buildSectionSelector('main')).toBe('shopify-section-main');
    expect(normalizeSectionId('shopify-section-main')).toBe('main');
    expect(normalizeSectionId('main')).toBe('main');
  });
});

describe('morphSection', () => {
  it('morphs the live section with the new markup', async () => {
    const p = document.querySelector('p');
    await morphSection('main', sectionMarkup('main', '<p>new</p>'));
    expect(document.querySelector('p')).toBe(p);
    expect(p.textContent).toBe('new');
  });

  it('throws when the section is missing from the page or the response', async () => {
    await expect(morphSection('other', sectionMarkup('other', ''))).rejects.toThrow('Section other not found');
    await expect(morphSection('main', sectionMarkup('other', ''))).rejects.toThrow(
      'Section main not found in the section rendering response'
    );
  });

  it('injects or replaces the section stylesheet on request', async () => {
    const withStyle = (css) => sectionMarkup('main', `<style data-section-stylesheet>${css}</style><p>x</p>`);

    document.body.innerHTML = '<div id="shopify-section-main"><p>x</p></div>';
    await morphSection('main', sectionMarkup('main', '<p>x</p>'), { injectStylesheet: true });
    expect(document.querySelector('style')).toBeNull();

    await morphSection('main', withStyle('.a{}'), { injectStylesheet: true, mode: 'hydration' });
    expect(document.querySelector('style[data-section-stylesheet]').textContent).toBe('.a{}');

    await morphSection('main', withStyle('.b{}'), { injectStylesheet: true, mode: 'hydration' });
    expect(document.querySelectorAll('style')).toHaveLength(1);
    expect(document.querySelector('style').textContent).toBe('.b{}');
  });
});

describe('sectionRenderer', () => {
  it('fetches the section through the Section Rendering API and morphs it', async () => {
    const fetch = mockFetch([sectionMarkup('main', '<p>rendered</p>')]);
    const url = new URL('https://shop.example/collections/all?b=2&a=1');

    const html = await sectionRenderer.renderSection('main', { cache: false, url });

    expect(fetch).toHaveBeenCalledWith('https://shop.example/collections/all?a=1&b=2&section_id=main');
    expect(html).toContain('rendered');
    expect(document.querySelector('p').textContent).toBe('rendered');
  });

  it('serves repeat requests from the cache and bypasses it on demand', async () => {
    const fetch = mockFetch([sectionMarkup('main', '<p>first</p>'), sectionMarkup('main', '<p>second</p>')]);
    const url = () => new URL('https://shop.example/cached');

    await sectionRenderer.getSectionHTML('main', false, url());
    const cached = await sectionRenderer.getSectionHTML('main', true, url());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cached).toContain('first');

    const fresh = await sectionRenderer.getSectionHTML('main', false, url());
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fresh).toContain('second');
  });

  it('shares in-flight requests for the same URL', async () => {
    const fetch = mockFetch([sectionMarkup('main', '<p>shared</p>')]);
    const url = () => new URL('https://shop.example/in-flight');
    const [a, b] = await Promise.all([
      sectionRenderer.getSectionHTML('main', false, url()),
      sectionRenderer.getSectionHTML('main', false, url()),
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it('only applies the latest render when calls overlap', async () => {
    let resolveFirst;
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockImplementationOnce(() => Promise.resolve({ text: () => Promise.resolve(sectionMarkup('main', '<p>latest</p>')) }));

    const first = sectionRenderer.renderSection('main', { cache: false, url: new URL('https://shop.example/slow') });
    const second = sectionRenderer.renderSection('main', { cache: false, url: new URL('https://shop.example/fast') });
    await second;
    resolveFirst({ text: () => Promise.resolve(sectionMarkup('main', '<p>stale</p>')) });
    await first;

    expect(document.querySelector('p').textContent).toBe('latest');
  });

  it('caches the page sections on load', async () => {
    window.history.replaceState({}, '', '/pages/about');
    document.body.innerHTML = sectionMarkup('main', '<p>from page</p>');
    window.dispatchEvent(new Event('load'));

    const fetch = vi.spyOn(globalThis, 'fetch');
    const html = await sectionRenderer.getSectionHTML('main');
    expect(fetch).not.toHaveBeenCalled();
    expect(html).toContain('from page');
    window.history.replaceState({}, '', '/');
  });

  it('skips caching sections that contain a shadow root', async () => {
    window.history.replaceState({}, '', '/pages/shadow');
    document.body.innerHTML = '<div id="shopify-section-main" class="shopify-section"><div><span></span></div></div>';
    document.querySelector('span').attachShadow({ mode: 'open' });
    window.dispatchEvent(new Event('load'));

    const fetch = mockFetch([sectionMarkup('main', '<p>fetched</p>')]);
    await sectionRenderer.getSectionHTML('main');
    expect(fetch).toHaveBeenCalledTimes(1);
    window.history.replaceState({}, '', '/');
  });
});
