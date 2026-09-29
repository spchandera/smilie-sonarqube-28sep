import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@theme/media';
import { DialogCloseEvent } from '@theme/dialog';
import { MediaStartedPlayingEvent, ThemeEvents } from '@theme/events';

const toggleButton = `
  <button ref="toggleMediaButton" class="hidden">
    <span class="icon-play"></span><span class="icon-pause"></span>
  </button>`;

function mount(inner, tag = 'deferred-media') {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `<${tag}>${inner}</${tag}>`;
  document.body.appendChild(wrapper);
  return wrapper.firstElementChild;
}

const iconState = (el) => ({
  button: el.refs.toggleMediaButton.classList.contains('hidden'),
  play: el.querySelector('.icon-play').classList.contains('hidden'),
  pause: el.querySelector('.icon-pause').classList.contains('hidden'),
});

let play;
let pause;

beforeEach(() => {
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('deferred-media', () => {
  it('reveals the templated media, focuses it and announces playback', () => {
    const el = mount(`
      <button ref="deferredMediaPlayButton"></button>
      ${toggleButton}
      <template><video autoplay="true" tabindex="0"></video></template>`);
    const started = vi.fn();
    document.addEventListener(ThemeEvents.mediaStartedPlaying, started, { once: true });

    el.showDeferredMedia();

    const video = el.querySelector(':scope > video');
    expect(video).not.toBeNull();
    expect(document.activeElement).toBe(video);
    expect(el.dataset.mediaLoaded).toBe('true');
    expect(el.refs.deferredMediaPlayButton.classList.contains('deferred-media__playing')).toBe(true);
    expect(play).toHaveBeenCalledTimes(1);
    expect(started.mock.calls[0][0]).toBeInstanceOf(MediaStartedPlayingEvent);
    expect(started.mock.calls[0][0].detail.resource).toBe(el);
    expect(el.isPlaying).toBe(true);
    expect(iconState(el)).toEqual({ button: false, play: true, pause: false });

    el.loadContent();
    expect(el.querySelectorAll(':scope > video')).toHaveLength(1);
  });

  it('can load without focusing and without autoplaying', () => {
    const el = mount('<template><video tabindex="0"></video></template>');
    el.loadContent(false);
    expect(el.querySelector(':scope > video')).not.toBeNull();
    expect(document.activeElement).not.toBe(el.querySelector(':scope > video'));
    expect(play).not.toHaveBeenCalled();
  });

  it('does not mark media as loaded when there is no template content', () => {
    const el = mount('<template></template>');
    el.loadContent();
    expect(el.dataset.mediaLoaded).toBeUndefined();
    const bare = mount('');
    bare.loadContent();
    expect(bare.dataset.mediaLoaded).toBeUndefined();
  });

  it('toggles a native video between playing and paused', () => {
    const el = mount(`${toggleButton}<video></video>`);
    el.toggleMedia();
    expect(play).toHaveBeenCalledTimes(1);
    expect(el.isPlaying).toBe(true);
    expect(iconState(el)).toEqual({ button: false, play: true, pause: false });

    el.dataset.mediaLoaded = 'true';
    el.toggleMedia();
    expect(pause).toHaveBeenCalledTimes(1);
    expect(el.isPlaying).toBe(false);
    expect(iconState(el)).toEqual({ button: false, play: false, pause: true });
  });

  it('only updates the hint on pause once the media has been revealed', () => {
    const el = mount(`${toggleButton}<video></video>`);
    el.pauseMedia();
    expect(pause).toHaveBeenCalledTimes(1);
    expect(iconState(el).button).toBe(true);
  });

  it('tolerates missing hint buttons, icons and media', () => {
    const el = mount('<button ref="toggleMediaButton" class="hidden"></button>');
    el.playMedia();
    expect(el.refs.toggleMediaButton.classList.contains('hidden')).toBe(false);
    const bare = mount('');
    expect(() => bare.playMedia()).not.toThrow();
    expect(() => bare.pauseMedia()).not.toThrow();
  });

  it('controls YouTube embeds through postMessage using the player origin', () => {
    const el = mount('<iframe data-video-type="youtube" src="https://www.youtube.com/embed/abc"></iframe>');
    const post = vi.spyOn(el.querySelector('iframe').contentWindow, 'postMessage').mockImplementation(() => {});

    el.playMedia();
    el.pauseMedia();

    expect(post.mock.calls).toEqual([
      ['{"event":"command","func":"playVideo","args":""}', 'https://www.youtube.com'],
      ['{"event":"command","func":"pauseVideo","args":""}', 'https://www.youtube.com'],
    ]);
    expect(play).not.toHaveBeenCalled();
  });

  it('controls Vimeo embeds and falls back to the page origin for opaque iframe origins', () => {
    const el = mount('<iframe data-video-type="vimeo" src="about:blank"></iframe>');
    const post = vi.spyOn(el.querySelector('iframe').contentWindow, 'postMessage').mockImplementation(() => {});

    el.playMedia();
    el.pauseMedia();

    expect(post.mock.calls).toEqual([
      ['{"method":"play"}', window.location.origin],
      ['{"method":"pause"}', window.location.origin],
    ]);
  });

  it('pauses when other media starts playing or a dialog closes, until disconnected', () => {
    const el = mount('<video></video>');
    el.isPlaying = true;

    document.dispatchEvent(new MediaStartedPlayingEvent(document.body));
    expect(pause).toHaveBeenCalledTimes(1);
    expect(el.isPlaying).toBe(false);

    window.dispatchEvent(new DialogCloseEvent());
    expect(pause).toHaveBeenCalledTimes(2);

    const video = el.querySelector('video');
    el.remove();
    document.dispatchEvent(new MediaStartedPlayingEvent(document.body));
    window.dispatchEvent(new DialogCloseEvent());
    expect(pause).toHaveBeenCalledTimes(2);
    expect(video).toBeTruthy();
  });
});

describe('product-model', () => {
  function stubShopify(ModelViewerUI) {
    const shopify = {
      ModelViewerUI,
      loadFeatures: vi.fn(),
    };
    vi.stubGlobal('Shopify', shopify);
    return shopify;
  }

  function createViewerUI() {
    const instances = [];
    class ModelViewerUI {
      constructor(element) {
        this.element = element;
        this.play = vi.fn();
        this.pause = vi.fn();
        instances.push(this);
      }
    }
    return { ModelViewerUI, instances };
  }

  const pointerAt = (type, x, y) => new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });

  it('loads the model viewer UI feature, starts playback and pauses on tap', async () => {
    const { ModelViewerUI, instances } = createViewerUI();
    const shopify = stubShopify(ModelViewerUI);
    const el = mount('<template><model-viewer></model-viewer></template>', 'product-model');

    el.loadContent();

    expect(el.dataset.mediaLoaded).toBe('true');
    expect(shopify.loadFeatures).toHaveBeenCalledTimes(1);
    const [feature] = shopify.loadFeatures.mock.calls[0][0];
    expect(feature).toMatchObject({ name: 'model-viewer-ui', version: '1.0' });

    await feature.onLoad();
    const viewer = el.querySelector('model-viewer');
    expect(instances).toHaveLength(1);
    expect(instances[0].element).toBe(viewer);
    expect(instances[0].play).toHaveBeenCalledTimes(1);
    expect(el.isPlaying).toBe(true);

    // A drag is not a tap
    viewer.dispatchEvent(pointerAt('pointerdown', 10, 10));
    viewer.dispatchEvent(pointerAt('click', 60, 60));
    expect(instances[0].pause).not.toHaveBeenCalled();

    viewer.dispatchEvent(pointerAt('pointerdown', 10, 10));
    viewer.dispatchEvent(pointerAt('click', 13, 14));
    expect(instances[0].pause).toHaveBeenCalledTimes(1);
    expect(el.isPlaying).toBe(false);

    el.remove();
    viewer.dispatchEvent(pointerAt('click', 10, 10));
    expect(instances[0].pause).toHaveBeenCalledTimes(1);
  });

  it('forwards play and pause to the model viewer UI', () => {
    stubShopify(undefined);
    const el = mount('', 'product-model');
    el.playMedia();
    el.pauseMedia();
    const ui = { play: vi.fn(), pause: vi.fn() };
    el.modelViewerUI = ui;
    el.toggleMedia();
    el.toggleMedia();
    expect(ui.play).toHaveBeenCalledTimes(1);
    expect(ui.pause).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the feature fails to load or there is no model element', async () => {
    const { ModelViewerUI, instances } = createViewerUI();
    stubShopify(ModelViewerUI);
    const el = mount('', 'product-model');

    await el.setupModelViewerUI([new Error('failed')]);
    await el.setupModelViewerUI(undefined);
    expect(instances).toHaveLength(0);
    expect(el.modelViewerUI).toBeUndefined();
  });

  it('waits for a late ModelViewerUI and gives up after the retry budget', async () => {
    vi.useFakeTimers();
    const shopify = stubShopify(undefined);
    const el = mount('<model-viewer></model-viewer>', 'product-model');

    const gaveUp = el.setupModelViewerUI(undefined);
    await vi.advanceTimersByTimeAsync(500);
    await gaveUp;
    expect(el.modelViewerUI).toBeUndefined();

    const { ModelViewerUI, instances } = createViewerUI();
    const late = el.setupModelViewerUI(undefined);
    await vi.advanceTimersByTimeAsync(100);
    shopify.ModelViewerUI = ModelViewerUI;
    await vi.advanceTimersByTimeAsync(50);
    await late;
    expect(instances).toHaveLength(1);
    expect(el.modelViewerUI).toBe(instances[0]);
  });
});
