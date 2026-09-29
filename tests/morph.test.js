import { describe, it, expect, vi } from 'vitest';
import { morph, MORPH_OPTIONS } from '@theme/morph';
import { Component } from '@theme/component';

function html(markup) {
  const template = document.createElement('template');
  template.innerHTML = markup.trim();
  return /** @type {Element} */ (template.content.firstElementChild);
}

const FULL = { ...MORPH_OPTIONS, childrenOnly: false };

describe('morph', () => {
  it('requires both trees', () => {
    expect(() => morph(null, html('<div></div>'))).toThrow('Both oldTree and newTree must be provided');
  });

  it('accepts an HTML string as the new tree', () => {
    const oldTree = html('<div><p>old</p></div>');
    morph(oldTree, '<div><p>new</p></div>');
    expect(oldTree.innerHTML).toBe('<p>new</p>');
  });

  it('rejects an empty HTML string', () => {
    expect(() => morph(html('<div></div>'), ' ')).toThrow('newTree string is not valid HTML');
  });

  it('rejects document fragments when morphing the root', () => {
    expect(() => morph(html('<div></div>'), document.createDocumentFragment(), FULL)).toThrow(
      'newTree should have one root node'
    );
  });

  it('keeps existing nodes and updates text in place', () => {
    const oldTree = html('<div><p id="a">one</p></div>');
    const p = oldTree.querySelector('p');
    morph(oldTree, html('<div><p id="a">two</p></div>'));
    expect(oldTree.querySelector('p')).toBe(p);
    expect(p.textContent).toBe('two');
  });

  it('adds, removes and reorders children', () => {
    const oldTree = html('<ul><li id="a">A</li><li id="b">B</li><li id="c">C</li></ul>');
    const b = oldTree.querySelector('#b');
    morph(oldTree, html('<ul><li id="b">B</li><li id="d">D</li></ul>'));
    expect([...oldTree.children].map((li) => li.id)).toEqual(['b', 'd']);
    expect(oldTree.querySelector('#b')).toBe(b);
  });

  it('replaces nodes whose tag or type changes', () => {
    const oldTree = html('<div><span>x</span>text</div>');
    morph(oldTree, html('<div><em>x</em><b>bold</b></div>'));
    expect(oldTree.innerHTML).toBe('<em>x</em><b>bold</b>');
  });

  it('syncs attributes, removing ones that are gone', () => {
    const oldTree = html('<div><a class="old" data-x="1" title="t" href="/a">link</a></div>');
    morph(oldTree, html('<div><a class="new" href="/a" data-y="2" title="undefined">link</a></div>'));
    const a = oldTree.querySelector('a');
    expect(a.getAttribute('class')).toBe('new');
    expect(a.getAttribute('data-y')).toBe('2');
    expect(a.hasAttribute('data-x')).toBe(false);
    expect(a.hasAttribute('title')).toBe(false);
  });

  it('does not reset unchanged resource attributes', () => {
    const oldTree = html('<div><img src="/a.jpg" alt="a"></div>');
    const img = oldTree.querySelector('img');
    const spy = vi.spyOn(img, 'setAttribute');
    morph(oldTree, html('<div><img src="/a.jpg" alt="b"></div>'));
    expect(spy).not.toHaveBeenCalledWith('src', expect.anything());
    expect(img.alt).toBe('b');
  });

  it('handles namespaced attributes', () => {
    const XLINK = 'http://www.w3.org/1999/xlink';
    const make = (href) => {
      const div = document.createElement('div');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      if (href) use.setAttributeNS(XLINK, 'xlink:href', href);
      svg.appendChild(use);
      div.appendChild(svg);
      return div;
    };
    const oldTree = make('#a');
    morph(oldTree, make('#b'));
    expect(oldTree.querySelector('use').getAttributeNS(XLINK, 'href')).toBe('#b');
    morph(oldTree, make(null));
    expect(oldTree.querySelector('use').hasAttributeNS(XLINK, 'href')).toBe(false);
  });

  it('preserves open state of details unless declared', () => {
    const oldTree = html('<div><details open><summary>s</summary></details></div>');
    morph(oldTree, html('<div><details><summary>s</summary></details></div>'));
    expect(oldTree.querySelector('details').open).toBe(true);

    morph(oldTree, html('<div><details declarative-open><summary>s</summary></details></div>'));
    expect(oldTree.querySelector('details').open).toBe(false);
  });

  it('preserves slot, sizes and persistent attributes', () => {
    const oldTree = html('<div><img slot="media" sizes="100vw" product-grid-view="zoom-out" src="/a.jpg"></div>');
    morph(oldTree, html('<div><img src="/a.jpg" product-grid-view="default"></div>'));
    const img = oldTree.querySelector('img');
    expect(img.getAttribute('slot')).toBe('media');
    expect(img.getAttribute('sizes')).toBe('100vw');
    expect(img.getAttribute('product-grid-view')).toBe('zoom-out');

    morph(html('<div><img></div>'), html('<div><img slot="x"></div>'));
  });

  it('removes slot when the old node had none', () => {
    const oldTree = html('<div><span>a</span></div>');
    morph(oldTree, html('<div><span slot="x">a</span></div>'));
    expect(oldTree.querySelector('span').hasAttribute('slot')).toBe(false);
  });

  it('preserves inline styles of floating panels and view transition names', () => {
    const oldTree = html(
      '<div><floating-panel-component style="top: 10px"></floating-panel-component><p style="view-transition-name: card"></p></div>'
    );
    morph(oldTree, html('<div><floating-panel-component></floating-panel-component><p></p></div>'));
    expect(oldTree.querySelector('floating-panel-component').getAttribute('style')).toBe('top: 10px');
    expect(oldTree.querySelector('p').style.viewTransitionName).toBe('card');
  });

  it('updates input state and value', () => {
    const oldTree = html('<form><input type="checkbox"><input type="text" value="a"><input type="range" value="1"></form>');
    morph(
      oldTree,
      html('<form><input type="checkbox" checked disabled><input type="text" value="b"><input type="range" value="5"></form>')
    );
    const [checkbox, text, range] = oldTree.querySelectorAll('input');
    expect(checkbox.checked).toBe(true);
    expect(checkbox.disabled).toBe(true);
    expect(text.value).toBe('b');
    expect(range.value).toBe('5');
  });

  it('clears input values set to "null" and removes missing value attributes', () => {
    const oldTree = html('<form><input value="x"><input value="y"></form>');
    morph(oldTree, html('<form><input value="null"><input></form>'));
    const [a, b] = oldTree.querySelectorAll('input');
    expect(a.value).toBe('');
    expect(a.hasAttribute('value')).toBe(false);
    expect(b.hasAttribute('value')).toBe(false);
  });

  it('syncs indeterminate state and skips file inputs', () => {
    const oldTree = html('<form><input type="checkbox"><input type="file"></form>');
    const next = html('<form><input type="checkbox"><input type="file"></form>');
    next.querySelector('input').indeterminate = true;
    morph(oldTree, next);
    expect(oldTree.querySelector('input').indeterminate).toBe(true);
  });

  it('updates selected options and textareas', () => {
    const oldTree = html('<form><select><option>a</option><option>b</option></select><textarea>old</textarea></form>');
    morph(oldTree, html('<form><select><option>a</option><option selected>b</option></select><textarea>new</textarea></form>'));
    expect(oldTree.querySelectorAll('option')[1].selected).toBe(true);
    expect(oldTree.querySelector('textarea').value).toBe('new');
  });

  it('keeps a textarea placeholder when the new value is empty', () => {
    const oldTree = html('<form><textarea placeholder="Note">Note</textarea></form>');
    morph(oldTree, html('<form><textarea placeholder="Note"></textarea></form>'));
    const textarea = oldTree.querySelector('textarea');
    expect(textarea.value).toBe('');
    expect(textarea.placeholder).toBe('Note');
  });

  it('respects skip flags', () => {
    const oldTree = html('<div><section data-skip-subtree-update><p>keep</p></section><aside data-skip-node-update class="a"><p>x</p></aside></div>');
    morph(
      oldTree,
      html('<div><section data-skip-subtree-update><p>replace</p></section><aside data-skip-node-update class="b"><p>y</p></aside></div>')
    );
    expect(oldTree.querySelector('section p').textContent).toBe('keep');
    expect(oldTree.querySelector('aside').className).toBe('a');
    expect(oldTree.querySelector('aside p').textContent).toBe('y');
  });

  it('never morphs accelerated checkout buttons', () => {
    const oldTree = html('<div><shopify-accelerated-checkout-cart data-a="1"></shopify-accelerated-checkout-cart></div>');
    const el = oldTree.firstElementChild;
    morph(oldTree, html('<div><shopify-accelerated-checkout-cart data-a="2"></shopify-accelerated-checkout-cart></div>'));
    expect(oldTree.firstElementChild).toBe(el);
    expect(el.dataset.a).toBe('1');
  });

  it('rejects whitespace text and section rendering comments', () => {
    const oldTree = html('<div><p>a</p></div>');
    const next = html('<div><!--shopify:rendered_by_section_api--><p>a</p></div>');
    next.prepend(document.createTextNode('   '));
    morph(oldTree, next);
    expect(oldTree.childNodes).toHaveLength(1);
  });

  it('updates comments and matches unkeyed siblings in place', () => {
    const oldTree = html('<div><!--one--><span>a</span><b>x</b></div>');
    morph(oldTree, html('<div><!--two--><b>y</b><span>a</span></div>'));
    expect(oldTree.innerHTML).toBe('<!--two--><b>y</b><span>a</span>');
  });

  it('inserts keyed nodes that have no match', () => {
    const oldTree = html('<div><p id="x">x</p></div>');
    morph(oldTree, html('<div><p id="y">y</p><p id="x">x</p></div>'));
    expect([...oldTree.children].map((p) => p.id)).toEqual(['y', 'x']);
  });

  it('uses a custom node key', () => {
    const options = { ...MORPH_OPTIONS, getNodeKey: (node) => node?.dataset?.key };
    const oldTree = html('<ul><li data-key="1">1</li><li data-key="2">2</li></ul>');
    const second = oldTree.children[1];
    morph(oldTree, html('<ul><li data-key="2">2</li></ul>'), options);
    expect(oldTree.children).toHaveLength(1);
    expect(oldTree.firstElementChild).toBe(second);
  });

  it('morphs the root node when childrenOnly is false', () => {
    const oldTree = html('<div class="a"><p>1</p></div>');
    expect(morph(oldTree, html('<div class="b"><p>2</p></div>'), FULL)).toBe(oldTree);
    expect(oldTree.className).toBe('b');
    expect(morph(oldTree, oldTree, FULL)).toBe(oldTree);
  });

  it('runs the after-update hook for each morphed node', () => {
    const onAfterUpdate = vi.fn();
    const oldTree = html('<div><p><b>a</b></p></div>');
    morph(oldTree, html('<div><p><b>b</b></p></div>'), { ...MORPH_OPTIONS, onAfterUpdate });
    expect(onAfterUpdate).toHaveBeenCalled();
  });

  it('the default after-update hook notifies components', async () => {
    class MorphTarget extends Component {
      updatedCallback = vi.fn();
    }
    customElements.define('morph-target', MorphTarget);
    const component = document.createElement('morph-target');

    MORPH_OPTIONS.onAfterUpdate(component);
    MORPH_OPTIONS.onAfterUpdate(document.createElement('div'));
    await Promise.resolve();
    expect(component.updatedCallback).toHaveBeenCalledTimes(1);
  });

  it('ignores shadow root templates of initialised components', () => {
    const oldTree = document.createElement('div');
    oldTree.innerHTML = '<x-host></x-host>';
    const host = oldTree.firstElementChild;
    host.attachShadow({ mode: 'open' });
    host.innerHTML = '<span>light</span>';

    const next = html('<div><x-host><template shadowrootmode="open"><p>s</p></template><span>light</span></x-host></div>');
    // jsdom does not reflect the shadowrootmode attribute as a property
    Object.defineProperty(next.querySelector('template'), 'shadowRootMode', { value: 'open' });
    morph(oldTree, next);
    expect(host.querySelector('template')).toBeNull();
  });

  it('recreates app block scripts so they re-execute', () => {
    const oldTree = html('<div></div>');
    morph(oldTree, html('<div><div class="shopify-app-block"><script src="/app.js" data-a="1">init()</script></div></div>'));
    const script = oldTree.querySelector('script');
    expect(script.getAttribute('src')).toBe('/app.js');
    expect(script.dataset.a).toBe('1');
    expect(script.textContent).toBe('init()');
  });

  describe('hydration mode', () => {
    const options = { ...MORPH_OPTIONS, hydrationMode: true };

    it('only updates existing keyed targets', () => {
      const oldTree = html(`
        <nav>
          <div data-hydration-key="menu-1" class="old"><span>loading</span></div>
          <p>static</p>
          <div data-hydration-key="">skip</div>
        </nav>`);
      const target = oldTree.querySelector('[data-hydration-key="menu-1"]');

      morph(
        oldTree,
        html(`
        <nav>
          <div data-hydration-key="menu-1" class="new"><span>loaded</span></div>
          <p>changed</p>
          <div data-hydration-key="menu-2">new target</div>
          <div data-hydration-key="">x</div>
        </nav>`),
        options
      );

      expect(oldTree.querySelector('[data-hydration-key="menu-1"]')).toBe(target);
      expect(target.className).toBe('new');
      expect(target.textContent).toBe('loaded');
      expect(oldTree.querySelector('p').textContent).toBe('static');
      expect(oldTree.querySelector('[data-hydration-key="menu-2"]')).toBeNull();
    });

    it('can hydrate the root itself', () => {
      const oldTree = html('<div data-hydration-key="root"><i>old</i></div>');
      morph(oldTree, html('<div data-hydration-key="root"><i>new</i></div>'), options);
      expect(oldTree.textContent).toBe('new');
    });
  });
});
