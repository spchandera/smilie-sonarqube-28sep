import { describe, it, expect, vi, afterEach } from 'vitest';
import { Component, DeclarativeShadowElement } from '@theme/component';

class TestComponent extends Component {
  handled = [];

  record(...args) {
    this.handled.push(args);
  }

  broken() {
    throw new Error('handler failed');
  }
}
customElements.define('test-component', TestComponent);

class StrictComponent extends Component {
  requiredRefs = ['title'];
}
customElements.define('strict-component', StrictComponent);

class ShadowHost extends DeclarativeShadowElement {}
customElements.define('shadow-host', ShadowHost);

class ShadowComponent extends Component {}
customElements.define('shadow-component', ShadowComponent);

function mount(html) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper);
  return wrapper;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('DeclarativeShadowElement', () => {
  it('hydrates an open shadow root from a template', () => {
    const root = mount('<shadow-host><template shadowrootmode="open"><p>shadow</p></template></shadow-host>');
    const host = root.querySelector('shadow-host');
    expect(host.shadowRoot?.querySelector('p')?.textContent).toBe('shadow');
  });

  it('does nothing without a template', () => {
    const root = mount('<shadow-host><p>light</p></shadow-host>');
    expect(root.querySelector('shadow-host').shadowRoot).toBeNull();
  });
});

describe('Component refs', () => {
  it('collects single and array refs', () => {
    const root = mount(`
      <test-component>
        <h2 ref="title">Title</h2>
        <li ref="items[]">a</li>
        <li ref="items[]">b</li>
      </test-component>`);
    const el = root.querySelector('test-component');

    expect(el.refs.title.textContent).toBe('Title');
    expect(el.refs.items.map((i) => i.textContent)).toEqual(['a', 'b']);
    expect(el.roots).toEqual([el]);
  });

  it('ignores refs that belong to a nested component', () => {
    const root = mount(`
      <test-component id="outer">
        <span ref="own"></span>
        <test-component id="inner"><span ref="nested"></span></test-component>
      </test-component>`);
    const outer = root.querySelector('#outer');
    const inner = root.querySelector('#inner');

    expect(Object.keys(outer.refs)).toEqual(['own']);
    expect(Object.keys(inner.refs)).toEqual(['nested']);
  });

  it('treats any *-component tag as a boundary', () => {
    const root = mount('<test-component><plain-component><span ref="x"></span></plain-component></test-component>');
    expect(root.querySelector('test-component').refs).toEqual({});
  });

  it('includes refs inside its shadow root', () => {
    const root = mount(
      '<shadow-component><template shadowrootmode="open"><b ref="shadowRef"></b></template><i ref="lightRef"></i></shadow-component>'
    );
    const el = root.querySelector('shadow-component');
    expect(el.roots).toHaveLength(2);
    expect(Object.keys(el.refs).sort()).toEqual(['lightRef', 'shadowRef']);
  });

  it('throws when a required ref is missing', () => {
    const el = document.createElement('strict-component');
    expect(() => el.connectedCallback()).toThrow('Required ref "title" not found in component strict-component');
  });

  it('refreshes refs on updatedCallback', () => {
    const root = mount('<test-component><span ref="a"></span></test-component>');
    const el = root.querySelector('test-component');
    el.insertAdjacentHTML('beforeend', '<span ref="b"></span>');
    el.updatedCallback();
    expect(Object.keys(el.refs)).toEqual(['a', 'b']);
  });

  it('keeps refs in sync with DOM mutations once observing', async () => {
    const root = mount('<test-component><span ref="a"></span></test-component>');
    const el = root.querySelector('test-component');
    // The mutation observer is attached in an idle callback
    await new Promise((resolve) => setTimeout(resolve, 50));

    el.insertAdjacentHTML('beforeend', '<span ref="added"></span>');
    await vi.waitFor(() => expect(el.refs.added).toBeDefined());

    el.querySelector('[ref="a"]').setAttribute('ref', 'renamed');
    await vi.waitFor(() => expect(el.refs.renamed).toBeDefined());
    expect(el.refs.a).toBeUndefined();

    el.remove();
  });
});

describe('declarative event listeners', () => {
  it('calls the closest component method with the event', () => {
    const root = mount('<test-component><button on:click="/record">Go</button></test-component>');
    const el = root.querySelector('test-component');
    const button = root.querySelector('button');

    button.click();

    expect(el.handled).toHaveLength(1);
    expect(el.handled[0][0].type).toBe('click');
    expect(el.handled[0][0].target).toBe(button);
  });

  it('proxies the target to the element that declares the listener', () => {
    const root = mount('<test-component><div on:click="/record"><span>inner</span></div></test-component>');
    const el = root.querySelector('test-component');
    const div = root.querySelector('div');

    root.querySelector('span').click();

    const event = el.handled[0][0];
    expect(event.target).toBe(div);
    expect(typeof event.preventDefault).toBe('function');
    expect(() => event.preventDefault()).not.toThrow();
  });

  it.each([
    ['/record/42', 42],
    ['/record/true', true],
    ['/record/false', false],
    ['/record/hello', 'hello'],
  ])('passes path data from %s', (attr, expected) => {
    const root = mount(`<test-component><button on:click="${attr}"></button></test-component>`);
    root.querySelector('button').click();
    expect(root.querySelector('test-component').handled[0][0]).toBe(expected);
  });

  it('passes query data as an object', () => {
    const root = mount('<test-component><button on:click="/record?qty=2&gift=true&note=hi"></button></test-component>');
    root.querySelector('button').click();
    expect(root.querySelector('test-component').handled[0][0]).toEqual({ qty: 2, gift: true, note: 'hi' });
  });

  it('targets a component by id selector', () => {
    const root = mount(`
      <test-component id="target"></test-component>
      <test-component id="host"><button on:click="#target/record"></button></test-component>`);
    root.querySelector('button').click();
    expect(root.querySelector('#target').handled).toHaveLength(1);
    expect(root.querySelector('#host').handled).toHaveLength(0);
  });

  it('targets an ancestor component by selector', () => {
    const root = mount(
      '<test-component class="outer"><test-component class="inner"><button on:click="test-component.outer/record"></button></test-component></test-component>'
    );
    root.querySelector('button').click();
    expect(root.querySelector('.outer').handled).toHaveLength(1);
    expect(root.querySelector('.inner').handled).toHaveLength(0);
  });

  it('handles non-bubbling focus events', () => {
    const root = mount('<test-component><div on:focus="/record"><input></div></test-component>');
    root.querySelector('input').dispatchEvent(new FocusEvent('focus'));
    expect(root.querySelector('test-component').handled).toHaveLength(1);
  });

  it('ignores missing methods, missing components and non-bubbling events', () => {
    const root = mount(`
      <test-component>
        <button id="a" on:click="/doesNotExist"></button>
        <button id="b" on:click="/"></button>
        <div on:change="/record"><span id="c"></span></div>
      </test-component>
      <button id="d" on:click="/record"></button>`);
    const el = root.querySelector('test-component');

    root.querySelector('#a').click();
    root.querySelector('#b').click();
    root.querySelector('#c').dispatchEvent(new Event('change'));
    root.querySelector('#d').click();

    expect(el.handled).toHaveLength(0);
  });

  it('logs handler errors instead of throwing', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const root = mount('<test-component><button on:click="/broken"></button></test-component>');
    expect(() => root.querySelector('button').click()).not.toThrow();
    expect(error).toHaveBeenCalled();
  });
});
