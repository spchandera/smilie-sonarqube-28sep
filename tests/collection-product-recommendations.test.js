import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';

vi.mock('@theme/section-renderer', async (importOriginal) => ({
  ...(await importOriginal()),
  morphSection: vi.fn(() => Promise.resolve()),
}));

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
  trigger(isIntersecting) {
    return this.callback([{ isIntersecting, target: this.observed[0] }], this);
  }
}

vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
vi.stubGlobal('Shopify', { designMode: false });

const { morphSection } = await import('@theme/section-renderer');
await import('@theme/product-recommendations');

afterAll(() => {
  vi.unstubAllGlobals();
});

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

let fetchMock;

beforeEach(() => {
  FakeIntersectionObserver.instances = [];
  Shopify.designMode = false;
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => '<div>recs</div>' }));
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  morphSection.mockClear();
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function mount(attrs = 'data-product-id="42" data-section-id="recs" data-intent="related"') {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `<product-recommendations data-url="/recommendations/products?limit=4" ${attrs}></product-recommendations>`;
  document.body.appendChild(wrapper);
  const el = wrapper.firstElementChild;
  const observer = FakeIntersectionObserver.instances.at(-1);
  return { el, observer };
}

describe('ProductRecommendations', () => {
  it('observes itself with a lookahead margin', () => {
    const { el, observer } = mount();
    expect(observer.observed).toEqual([el]);
    expect(observer.options).toEqual({ rootMargin: '0px 0px 400px 0px' });
  });

  it('loads and morphs recommendations once visible', async () => {
    const { el, observer } = mount();

    observer.trigger(false);
    expect(fetchMock).not.toHaveBeenCalled();

    observer.trigger(true);
    expect(observer.disconnect).toHaveBeenCalled();
    await flush();

    expect(fetchMock).toHaveBeenCalledWith(
      '/recommendations/products?limit=4&product_id=42&section_id=recs&intent=related',
      { signal: expect.any(AbortSignal) }
    );
    expect(el.dataset.recommendationsPerformed).toBe('true');
    expect(morphSection).toHaveBeenCalledWith('recs', '<div>recs</div>', { mode: 'hydration', injectStylesheet: true });
  });

  it('skips loading when recommendations were already performed', async () => {
    const { observer } = mount('data-product-id="1" data-section-id="s" data-recommendations-performed="true"');
    observer.trigger(true);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires a product and section id', () => {
    const { observer } = mount('data-section-id="s"');
    expect(() => observer.trigger(true)).toThrow('Product ID and a section ID are required');
  });

  it('hides itself when the server errors outside the editor', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const { el, observer } = mount();
    observer.trigger(true);
    await flush();

    expect(el.classList.contains('hidden')).toBe(true);
    expect(el.dataset.error).toBe('Error loading product recommendations');
    expect(console.error).toHaveBeenCalledWith('Product recommendations error:', 'Server returned 500');
  });

  it('ignores server errors in the theme editor', async () => {
    Shopify.designMode = true;
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    const { el, observer } = mount();
    observer.trigger(true);
    await flush();
    expect(el.classList.contains('hidden')).toBe(false);
  });

  it('reports empty responses and fetch failures', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, text: async () => '   ' });
    const { el, observer } = mount();
    observer.trigger(true);
    await flush();
    expect(console.error).toHaveBeenCalledWith('Product recommendations error:', 'No recommendations available');
    expect(el.dataset.error).toBeDefined();

    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const second = mount();
    second.observer.trigger(true);
    await flush();
    expect(console.error).toHaveBeenCalledWith('Product recommendations error:', 'offline');
    expect(second.el.classList.contains('hidden')).toBe(true);
  });

  it('reloads on relevant attribute changes and serves repeats from cache', async () => {
    const { el } = mount();

    el.dataset.productId = '43';
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('product_id=43');
    expect(morphSection).toHaveBeenCalledTimes(1);

    // Setting performed=true is ignored, then resetting it with the same product hits the cache
    el.dataset.recommendationsPerformed = 'false';
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(morphSection).toHaveBeenCalledTimes(2);
  });

  it('ignores error, hidden class and performed attribute mutations', async () => {
    const { el } = mount();
    el.dataset.error = 'x';
    el.classList.add('hidden');
    el.dataset.recommendationsPerformed = 'true';
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts an in-flight request when a new one starts', async () => {
    const signals = [];
    fetchMock.mockImplementation((_url, { signal }) => {
      signals.push(signal);
      return new Promise(() => {});
    });
    const { el } = mount();

    el.dataset.productId = '1';
    await flush();
    el.dataset.productId = '2';
    await flush();

    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  it('disconnects its observers when removed', async () => {
    const { el, observer } = mount();
    el.remove();
    expect(observer.disconnect).toHaveBeenCalled();

    el.dataset.productId = '99';
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
