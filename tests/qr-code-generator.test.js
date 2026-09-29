import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import jsQR from 'jsqr';

/**
 * Rasterises a QR model into RGBA pixels and decodes it with jsQR,
 * proving the generated matrix is a valid, scannable QR code.
 */
function decode(model) {
  const count = model.getModuleCount();
  const scale = 4;
  const quiet = 4;
  const size = (count + quiet * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);

  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (!model.isDark(row, col)) continue;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const px = ((row + quiet) * scale + y) * size + (col + quiet) * scale + x;
          data[px * 4] = 0;
          data[px * 4 + 1] = 0;
          data[px * 4 + 2] = 0;
        }
      }
    }
  }

  return jsQR(data, size, size)?.data;
}

async function loadModule() {
  vi.resetModules();
  return import('@theme/qr-code-generator');
}

describe('QRCode (table drawing fallback)', () => {
  let QRCode;
  let el;

  beforeEach(async () => {
    ({ QRCode } = await loadModule());
    el = document.createElement('div');
    el.id = 'qr';
    document.body.appendChild(el);
  });

  afterEach(() => {
    el.remove();
  });

  it('exposes the error correction levels', () => {
    expect(QRCode.CorrectLevel).toEqual({ L: 1, M: 0, Q: 3, H: 2 });
  });

  it.each([
    ['L', 'https://example.com/products/smile-kit'],
    ['M', 'https://example.com/products/smile-kit'],
    ['Q', 'https://example.com/products/smile-kit'],
    ['H', 'https://example.com/products/smile-kit'],
  ])('generates a scannable code at correction level %s', (level, text) => {
    const qr = new QRCode(el, { text, correctLevel: QRCode.CorrectLevel[level] });
    expect(decode(qr._oQRCode)).toBe(text);
    expect(el.querySelector('table')).not.toBeNull();
    expect(el.title).toBe(text);
  });

  it.each([
    ['short text', 'Hi'],
    ['numeric data', '0123456789'],
    ['a long URL', `https://example.com/cart?${'item=12345&'.repeat(30)}`],
    ['a very long payload', 'x'.repeat(300)],
  ])('round-trips %s', (_, text) => {
    const qr = new QRCode(el, { text, correctLevel: QRCode.CorrectLevel.L });
    expect(decode(qr._oQRCode)).toBe(text);
  });

  it('prefixes non-ASCII text with a UTF-8 byte order mark so scanners decode it correctly', () => {
    const text = 'Café smile ✓';
    const qr = new QRCode(el, { text, correctLevel: QRCode.CorrectLevel.L });
    expect(decode(qr._oQRCode)).toBe(`﻿${text}`);
  });

  it('grows the symbol size with the payload length', () => {
    const small = new QRCode(el, { text: 'a', correctLevel: QRCode.CorrectLevel.L });
    const smallCount = small._oQRCode.getModuleCount();
    const large = new QRCode(el, { text: 'a'.repeat(500), correctLevel: QRCode.CorrectLevel.L });
    const largeCount = large._oQRCode.getModuleCount();

    expect(smallCount).toBe(21);
    expect(largeCount).toBeGreaterThan(smallCount);
    expect((largeCount - 17) % 4).toBe(0);
  });

  it('accepts a plain string as the options argument', () => {
    const qr = new QRCode(el, 'plain-string');
    expect(decode(qr._oQRCode)).toBe('plain-string');
  });

  it('looks up the target element by id', () => {
    const qr = new QRCode('qr', { text: 'by-id' });
    expect(qr._el).toBe(el);
    expect(decode(qr._oQRCode)).toBe('by-id');
  });

  it('throws when the target id does not exist', () => {
    expect(() => new QRCode('missing-element', { text: 'x' })).toThrow('Element with id missing-element not found');
  });

  it('does not draw until text is provided', () => {
    const qr = new QRCode(el, {});
    expect(qr._oQRCode).toBeNull();
    expect(el.innerHTML).toBe('');
  });

  it('re-renders with makeCode and empties the element with clear', () => {
    const qr = new QRCode(el, { text: 'first' });
    qr.makeCode('second');
    expect(decode(qr._oQRCode)).toBe('second');
    expect(el.title).toBe('second');

    qr.clear();
    expect(el.innerHTML).toBe('');
  });

  it('uses the configured colours for dark and light modules', () => {
    const qr = new QRCode(el, { text: 'colours', colorDark: 'rgb(1, 2, 3)', colorLight: 'rgb(4, 5, 6)' });
    expect(qr._htOption.colorDark).toBe('rgb(1, 2, 3)');
    const cells = [...el.querySelectorAll('td')].map((td) => td.style.backgroundColor);
    expect(cells).toContain('rgb(1, 2, 3)');
    expect(cells).toContain('rgb(4, 5, 6)');
  });

  it('rejects data beyond the maximum QR capacity', () => {
    expect(() => new QRCode(el, { text: 'x'.repeat(3000), correctLevel: QRCode.CorrectLevel.H })).toThrow();
  });
});

describe('QRCode (SVG drawing)', () => {
  it('renders an SVG with one <use> per dark module', async () => {
    const { QRCode } = await loadModule();
    const el = document.createElement('div');
    const qr = new QRCode(el, { text: 'svg-mode', useSVG: true, colorDark: '#111111', colorLight: '#eeeeee' });

    const svg = el.querySelector('svg');
    const count = qr._oQRCode.getModuleCount();
    let dark = 0;
    for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (qr._oQRCode.isDark(r, c)) dark++;

    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${count} ${count}`);
    expect(svg.querySelector('#template').getAttribute('fill')).toBe('#111111');
    expect(svg.querySelectorAll('use')).toHaveLength(dark);
    expect(decode(qr._oQRCode)).toBe('svg-mode');

    qr.clear();
    expect(el.childNodes).toHaveLength(0);
  });
});

describe('QRCode (canvas drawing)', () => {
  let context;
  let OriginalImage;

  beforeEach(() => {
    context = { fillRect: vi.fn(), strokeRect: vi.fn(), clearRect: vi.fn() };
    globalThis.CanvasRenderingContext2D = class {};
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAAA');

    // Resolve the data URI support probe synchronously
    OriginalImage = globalThis.Image;
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      configurable: true,
      set(value) {
        this.setAttribute('src', value);
        if (value.startsWith('data:image/gif') && this.onload) this.onload();
      },
      get() {
        return this.getAttribute('src');
      },
    });
  });

  afterEach(() => {
    delete globalThis.CanvasRenderingContext2D;
    delete HTMLImageElement.prototype.src;
    globalThis.Image = OriginalImage;
    vi.restoreAllMocks();
  });

  it('paints every module and swaps the canvas for an image', async () => {
    const { QRCode } = await loadModule();
    const el = document.createElement('div');
    const qr = new QRCode(el, { text: 'canvas-mode', width: 100, height: 100, alt: 'Scan me' });
    const count = qr._oQRCode.getModuleCount();

    expect(context.fillRect).toHaveBeenCalledTimes(count * count);
    expect(context.strokeRect).toHaveBeenCalledTimes(count * count * 2);
    expect(qr._oDrawing.isPainted()).toBe(true);

    const img = el.querySelector('img');
    expect(img.alt).toBe('Scan me');
    expect(img.getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(img.style.display).toBe('block');
    expect(el.querySelector('canvas').style.display).toBe('none');

    // Second render reuses the cached data URI support result
    qr.makeCode('again');
    expect(img.style.display).toBe('block');

    qr.clear();
    expect(context.clearRect).toHaveBeenCalled();
    expect(qr._oDrawing.isPainted()).toBe(false);
  });

  it('rounds values to three decimals', async () => {
    const { QRCode } = await loadModule();
    const qr = new QRCode(document.createElement('div'), {});
    expect(qr._oDrawing.round(1.23456)).toBeCloseTo(1.234, 6);
    expect(qr._oDrawing.round(0)).toBe(0);
  });

  it('calls the failure callback when data URIs are unsupported', async () => {
    const { QRCode } = await loadModule();
    const qr = new QRCode(document.createElement('div'), {});
    const fail = vi.fn();

    qr._oDrawing._bSupportDataURI = false;
    qr._oDrawing.safeSetDataURI(vi.fn(), fail);
    expect(fail).toHaveBeenCalledTimes(1);
  });

  it('throws when a 2D context is unavailable', async () => {
    HTMLCanvasElement.prototype.getContext.mockReturnValue(null);
    const { QRCode } = await loadModule();
    expect(() => new QRCode(document.createElement('div'), {})).toThrow('Canvas is not supported');
  });
});
