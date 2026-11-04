const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const resources = path.resolve(__dirname, '../../src/main/resources/markmap');
const read = name => fs.readFileSync(path.join(resources, name), 'utf8');
const escapeScript = value => value.replace(/<\/script/ig, '<\\/script');
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=';
const content = '---\nmarkmap:\n  maxWidth: 125\n---\n# 中文标题\n\n## 公式\n\n- $x^2$\n- ![图片](a.png)\n\n## 节点\n\n- 测试 😀\n- [链接](docs/example.md)\n- [跳到公式](#公式)\n\n## 代码\n\n```js\nconsole.log(1)\n```';

function createHtml(bridge, bootstrap = '') {
  return read('template.html').replaceAll('__BACKGROUND__', '#ffffff').replaceAll('__FOREGROUND__', '#222222')
    .replace('__KATEX_CSS__', () => read('vendor/katex.css'))
    .replace('__VENDOR_JS__', () => escapeScript(read('vendor/markmap-bundle.js')))
    .replace('__BRIDGE_JS__', () => escapeScript(bridge))
    .replace('__APP_JS__', () => escapeScript(read('app.js') + '\n' + bootstrap));
}

let browser;
(async () => {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  const errors = [];
  const network = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/*', route => { network.push(route.request().url()); route.abort(); });
  const bridge = `window.messages=[];window.markmapSend=m=>messages.push(m);window.markmapResolveImage=async s=>s==='a.png'?${JSON.stringify(pixel)}:'';`;
  await page.setContent(createHtml(bridge));
  await page.waitForFunction(() => window.messages.some(m => m.type === 'ready'));
  await page.evaluate(text => window.setMarkmapContent(text, { initialExpandLevel: -1 }, '.markmap { opacity: 0.99; }'), content);
  await page.waitForFunction(() => document.querySelectorAll('.markmap-node').length >= 7);
  assert.match(await page.locator('#markmap-svg').textContent(), /中文标题/);
  assert.equal(await page.locator('.katex').count(), 1);
  assert.equal(await page.locator('img[src^="data:image/png"]').count(), 1);
  assert.match(await page.locator('#custom-css').textContent(), /opacity/);
  assert.equal(await page.locator('#markmap-svg').evaluate(el => el.style.getPropertyValue('--markmap-max-width')), '125px');
  if (process.env.MARKMAP_SCREENSHOT) {
    await page.waitForTimeout(1200);
    await page.screenshot({ path: process.env.MARKMAP_SCREENSHOT });
  }
  await page.evaluate(() => window.setMarkmapCursor(13));
  await page.waitForTimeout(400);
  await page.locator('.markmap-node').filter({ hasText: '测试 😀' }).locator('foreignObject').dblclick();
  await page.waitForFunction(() => messages.some(m => m.type === 'focus' && m.value === 13));
  await page.getByText('链接', { exact: true }).click();
  await page.waitForFunction(() => messages.some(m => m.type === 'link' && m.value === 'docs/example.md'));
  await page.getByText('跳到公式', { exact: true }).click();
  await page.evaluate(() => window.setMarkmapCursor(11));
  await page.waitForTimeout(400);
  await page.evaluate(() => window.toggleActive(false));
  await page.waitForFunction(() => ![...document.querySelectorAll('.markmap-node')].some(n => n.textContent.includes('测试 😀')));
  await page.evaluate(text => window.setMarkmapContent(text), content + '\n');
  await page.waitForFunction(() => [...document.querySelectorAll('.markmap-node.markmap-fold')].some(n => n.textContent.includes('节点')));
  assert.equal(await page.getByText('测试 😀', { exact: true }).count(), 0);
  await page.evaluate(() => window.toggleActive(false));
  await page.waitForFunction(() => [...document.querySelectorAll('.markmap-node')].some(n => n.textContent.includes('测试 😀')));
  await page.evaluate(() => { window.zoomIn(); window.zoomOut(); window.centerMap(); window.exportSvg(); window.requestHtmlExport(); });
  await page.waitForFunction(() => messages.some(m => m.type === 'svg') && messages.some(m => m.type === 'htmlReady'));
  const svg = await page.evaluate(() => messages.find(m => m.type === 'svg').value);
  const exportedSnapshot = await page.evaluate(() => messages.find(m => m.type === 'htmlReady').value);
  assert.deepEqual(exportedSnapshot.images, ['a.png']);
  assert.equal(exportedSnapshot.content, content + '\n');
  assert.match(svg, /中文标题/);
  assert.match(svg, /data:image\/png/);
  assert.match(svg, /font\/woff2;base64/);
  await page.evaluate(() => { window.setMarkmapContent('# 新文档'); window.requestHtmlExport(); });
  await page.waitForFunction(() => messages.filter(m => m.type === 'htmlReady').length === 2);
  const newSnapshot = await page.evaluate(() => messages.filter(m => m.type === 'htmlReady')[1].value);
  assert.equal(newSnapshot.content, '# 新文档');
  assert.deepEqual(newSnapshot.images, []);
  await page.evaluate(() => window.setMarkmapContent(''));
  await page.waitForFunction(() => document.querySelectorAll('.markmap-node').length === 0);
  await page.evaluate(text => window.setMarkmapContent(text), content);
  await page.waitForFunction(() => document.querySelectorAll('.markmap-node').length >= 7);
  await page.evaluate(() => window.setMarkmapContent('# 安全\n\n- <img src="data:image/png;base64,broken" onerror="window.markmapXss=true">\n- <a href="javascript:alert(1)">不安全链接</a>'));
  await page.waitForFunction(() => document.querySelector('#markmap-svg').textContent.includes('不安全链接'));
  assert.equal(await page.evaluate(() => window.markmapXss), undefined);
  assert.equal(await page.locator('#markmap-svg img[onerror]').count(), 0);
  assert.equal(await page.locator('#markmap-svg a[href^="javascript:"]').count(), 0);
  await page.evaluate(() => window.setMarkmapContent('# 路径检查\n\n- ![parent](../secret.png)\n- ![absolute](/secret.png)\n- ![file](file:///secret.png)\n- ![missing](missing.png)'));
  await page.waitForFunction(() => document.querySelector('#markmap-svg').textContent.includes('路径检查'));
  await page.waitForFunction(() => ['parent', 'absolute', 'missing'].every(alt => document.querySelector(`#markmap-svg img[alt="${alt}"]`)));
  for (const alt of ['parent', 'absolute', 'missing']) {
    assert.equal(await page.locator(`#markmap-svg img[alt="${alt}"]`).getAttribute('src'), null);
  }
  const exported = await browser.newPage();
  await exported.route('**/*', route => { network.push(route.request().url()); route.abort(); });
  const bootstrap = `window.setMarkmapContent(${JSON.stringify(content)}, {}, '');`;
  await exported.setContent(createHtml(`window.markmapResolveImage=async s=>s==='a.png'?${JSON.stringify(pixel)}:'';`, bootstrap));
  await exported.waitForFunction(() => document.querySelectorAll('.markmap-node').length >= 7);
  assert.match(await exported.locator('#markmap-svg').textContent(), /中文标题/);
  assert.equal(await exported.locator('img[src^="data:image/png"]').count(), 1);
  if (network.length || errors.length) console.error({ network, errors });
  assert.deepEqual(errors, []);
  assert.deepEqual(network, []);
  console.log('Offline browser checks passed: Unicode, math, images, options, CSS, source navigation, SVG, HTML, and clearing.');
  await browser.close();
})().catch(async error => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});
