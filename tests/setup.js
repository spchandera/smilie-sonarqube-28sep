// Browser APIs the theme relies on that jsdom does not implement.

if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  });
}
globalThis.matchMedia = window.matchMedia;

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (!globalThis.DocumentTimeline) {
  globalThis.DocumentTimeline = class {};
}

if (!Element.prototype.getAnimations) {
  Element.prototype.getAnimations = () => [];
}
