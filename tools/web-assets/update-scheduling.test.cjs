const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { load } = require('cheerio/slim');
const assets = path.resolve(__dirname, '../../src/main/resources/markmap');

// DOM adapter for tree preparation only. Layout and animation are deliberately stubbed.
function element($, node) {
  return {
    tagName: node.name?.toUpperCase(),
    getAttribute: name => $(node).attr(name) ?? null,
    setAttribute: (name, value) => $(node).attr(name, value),
    removeAttribute: name => $(node).removeAttr(name),
    get children() { return $(node).children().toArray().map(n => element($, n)); },
    get parentElement() { return node.parent?.name ? element($, node.parent) : null; },
    get textContent() { return $(node).text(); },
    querySelectorAll: selector => $(node).find(selector).toArray().map(n => element($, n)),
    closest: selector => { const match = $(node).closest(selector)[0]; return match ? element($, match) : null; },
    cloneNode: () => element($, $(node).clone()[0]),
    remove: () => $(node).remove(),
  };
}
function parse(html) {
  const $ = load(html);
  return { querySelectorAll: selector => $(selector).toArray().map(n => element($, n)) };
}
async function harness() {
  const messages = [], stats = { parses: 0, transforms: 0, highlights: 0, reveals: 0, commits: [] };
  const listeners = {};
  const nodes = { error: {}, 'custom-css': {}, 'markmap-svg': {
    clientWidth: 1000, clientHeight: 600,
    addEventListener(type, handler) { listeners[type] = handler; },
  } };
  const context = { console, navigator: { userAgent: 'node' }, document: {} };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(assets, 'vendor/markmap-bundle.js'), 'utf8'), context);
  nodes['markmap-svg'].__zoom = context.d3.zoomIdentity;
  stats.viewportUpdates = 0;
  const RealTransformer = context.markmap.Transformer;
  class Transformer extends RealTransformer {
    constructor() {
      super();
      const render = this.md.render.bind(this.md);
      this.md.render = (...args) => { stats.parses++; return render(...args); };
    }
    transform(...args) { stats.transforms++; return super.transform(...args); }
  }
  const map = { options: { zoom: true, pan: true, scrollForPan: true }, state: {}, g: { selectAll: () => ({ remove() {} }) },
    async setData(root) { stats.commits.push(root); this.state.data = root; if (this.pause) await this.pause; },
    async setHighlight() { stats.highlights++; }, async ensureVisible() { stats.reveals++; },
    async fit() {}, async renderData() {}, async toggleNode() {}, rescale() {},
  };
  map.svg = { node: () => nodes['markmap-svg'], interrupt() { return this; }, call(fn, value) { fn(this, value); return this; } };
  map.zoom = { scaleExtent: () => [0, Infinity], transform(selection, value) {
    stats.viewportUpdates++;
    nodes['markmap-svg'].__zoom = value;
  } };
  Object.assign(context, {
    DOMParser: class { parseFromString(html) { return parse(html); } },
    requestAnimationFrame: callback => { queueMicrotask(callback); return 1; },
    markmapSend: message => messages.push(message), markmapSanitize: html => html,
    document: { getElementById: id => nodes[id], createElement() {
      let $ = load('');
      return { set innerHTML(value) { $ = load(value); }, get innerHTML() { return $.html(); },
        get textContent() { return $.text(); },
        querySelectorAll: selector => $(selector).toArray().map(n => element($, n)) };
    } },
    markmap: { ...context.markmap, Transformer, Markmap: { create: () => map } },
  });
  vm.runInContext(fs.readFileSync(path.join(assets, 'app.js'), 'utf8'), context);
  async function exported() {
    const count = messages.filter(m => m.type === 'htmlReady').length;
    context.requestHtmlExport();
    for (let i = 0; i < 100; i++) {
      await new Promise(resolve => setImmediate(resolve));
      const snapshots = messages.filter(m => m.type === 'htmlReady');
      if (snapshots.length > count) { assert.equal(nodes.error.textContent || '', ''); return snapshots.at(-1).value; }
    }
    throw Error('Update/export queue did not settle');
  }
  return { context, stats, map, exported, listeners, svg: nodes['markmap-svg'] };
}
const descendants = node => [node, ...(node.children || []).flatMap(descendants)];
(async () => {
  const h = await harness();
  const mixed = '---\nmarkmap:\n  maxWidth: 125\n---\n# Root\n## Mixed\n1. First\n- Second\n```python\nprint(1)\n```\n```python\nprint(2)\n```';
  h.context.setMarkmapContent('# Superseded one');
  h.context.setMarkmapContent('# Superseded two');
  h.context.setMarkmapContent(mixed);
  assert.equal((await h.exported()).content, mixed);
  assert.equal(h.stats.transforms, 1);
  assert.equal(h.stats.parses, 1, 'Each content update must render Markdown once');
  const heading = descendants(h.map.state.data).find(n => n.content === 'Mixed');
  assert.deepEqual(Array.from(heading.children, n => n.payload.tag), ['li', 'li', 'pre', 'pre']);
  assert.deepEqual(Array.from(heading.children, n => n.payload.lines), ['6,7', '7,8', '8,11', '11,14']);
  // Same content must not trigger another parse or layout.
  h.context.setMarkmapContent(mixed);
  await h.exported();
  assert.equal(h.stats.parses, 1);
  const before = h.stats.highlights;
  for (let i = 0; i < 100; i++) h.context.setMarkmapCursor(i % 2 ? 9 : 8);
  await new Promise(resolve => setImmediate(resolve));
  await h.exported();
  assert.equal(h.stats.highlights - before, 1);
  const reveals = h.stats.reveals;
  h.context.setMarkmapCursor(10); // another line in the same code block
  await new Promise(resolve => setImmediate(resolve));
  await h.exported();
  assert.equal(h.stats.reveals, reveals, 'Same node must not move the viewport again');
  assert.equal(h.stats.highlights - before, 1);
  // While an asynchronous layout is in flight, retain only the latest pending document.
  let release;
  h.map.pause = new Promise(resolve => { release = resolve; });
  h.context.setMarkmapContent('# In flight');
  await new Promise(resolve => setImmediate(resolve));
  const started = h.stats.transforms;
  for (let i = 0; i < 100; i++) h.context.setMarkmapContent(`# Latest ${i}`);
  release();
  h.map.pause = undefined;
  assert.equal((await h.exported()).content, '# Latest 99');
  assert.equal(h.stats.transforms, started + 1);
  assert.equal(h.stats.parses, h.stats.transforms);
  // Discard obsolete preparation before committing layout if an image bridge was pending.
  let releaseImage;
  h.context.markmapResolveImage = () => new Promise(resolve => { releaseImage = resolve; });
  const commits = h.stats.commits.length;
  h.context.setMarkmapContent('# Obsolete image\n- ![local](a.png)');
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(releaseImage, 'Image resolution must be in flight');
  h.context.setMarkmapContent('# After image');
  releaseImage('data:image/png;base64,AA==');
  assert.equal((await h.exported()).content, '# After image');
  assert.equal(h.stats.commits.length, commits + 1, 'Obsolete image document must not reach layout');
  h.context.setMarkmapContent('');
  assert.equal((await h.exported()).content, '');
  assert.equal(h.map.state.data, undefined);
  // Trackpad updates preserve the anchor, use absolute gesture scale, and apply wheel input immediately.
  const g = await harness();
  const wheel = (extra = {}) => ({ ctrlKey: false, deltaX: 0.2, deltaY: 0.1, deltaMode: 0,
    prevented: false, stopped: false,
    preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...extra });
  for (let i = 0; i < 100; i++) { const e = wheel(); g.listeners.wheel(e); assert.ok(e.prevented && e.stopped); }
  assert.equal(g.stats.viewportUpdates, 100, 'Wheel input must update without waiting for an animation frame');
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(Math.abs(g.svg.__zoom.x + 20) < 1e-9 && Math.abs(g.svg.__zoom.y + 10) < 1e-9);
  g.context.beginNativePinch(0.5, 0.5);
  g.context.updateNativePinch(1.5);
  g.context.updateNativePinch(2);
  const duplicate = wheel({ ctrlKey: true });
  g.listeners.wheel(duplicate);
  assert.ok(duplicate.prevented && duplicate.stopped, 'Native pinch must not also zoom through ctrl+wheel');
  g.context.endNativePinch();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(g.stats.viewportUpdates, 101);
  assert.equal(g.svg.__zoom.k, 2);
  assert.ok(Math.abs((500 - g.svg.__zoom.x) / g.svg.__zoom.k - 520) < 1e-9);
  g.context.beginNativePinch(0.5, 0.5);
  g.context.updateNativePinch(0.5);
  g.context.endNativePinch();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(g.svg.__zoom.k, 1, 'A second gesture must start from the current zoom');
  g.map.options.zoom = false;
  g.context.beginNativePinch(0.5, 0.5);
  g.context.updateNativePinch(2);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(g.svg.__zoom.k, 1);
  g.map.options.pan = false;
  const ignored = wheel(); g.listeners.wheel(ignored); assert.equal(ignored.prevented, false);
  console.log('Passed: native pinch anchoring, immediate wheel panning, gesture deduplication, disabled controls.');
  console.log('Passed: single parse, mixed lists/code with frontmatter offsets, update coalescing, cursor deduplication, export ordering, clearing.');
})().catch(error => { console.error(error); process.exitCode = 1; });
