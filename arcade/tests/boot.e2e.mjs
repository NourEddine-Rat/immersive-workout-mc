import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

async function server() {
  const child = spawn('python3', ['-u', '-c', "import serve; s=serve.Dual(('127.0.0.1',0),serve.Handler); print(s.server_port,flush=True); s.serve_forever()"], { cwd: new URL('../', import.meta.url), stdio: ['ignore', 'pipe', 'ignore'] });
  const port = await new Promise((resolve, reject) => { child.stdout.once('data', data => resolve(Number(data.toString().trim()))); child.once('error', reject); });
  return { base: `http://localhost:${port}`, close: () => new Promise(resolve => { child.once('exit', resolve); child.kill(); }) };
}
const launch = () => chromium.launch({ channel: process.env.ARCADE_BROWSER || 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
async function trainedPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(() => localStorage.setItem('arcade.profile.v1', JSON.stringify({ v: 1, created: Date.now(), cfg: {}, run: {} })));
  return page;
}

test('glass cover displays measured progress and blocks unfinished game input until the first frame', { timeout: 90000 }, async () => {
  const app = await server(), browser = await launch();
  let releaseArena;
  try {
    const page = await trainedPage(browser);
    const held = new Promise(resolve => { releaseArena = resolve; });
    let sawArena;
    const requested = new Promise(resolve => { sawArena = resolve; });
    await page.route('**/red-light/models/arena.glb', async route => { sawArena(); await held; await route.continue(); });
    await page.goto(app.base + '/games/squid/red-light/', { waitUntil: 'domcontentloaded' });
    await requested;
    await page.locator('#gameBoot').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#overlay').evaluate(node => node.inert), true);
    assert.equal(await page.locator('#splat').evaluate(node => getComputedStyle(node).visibility), 'hidden');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => boot.state), 'loading');
    await page.evaluate(() => boot.progress('Red Light arena', 1048576, 4194304, { completed: 1, resources: 3 }));
    assert.equal(await page.locator('#bootProgress').getAttribute('aria-valuenow'), '25');
    assert.equal(await page.locator('#bootPercent').textContent(), '25%');
    assert.match(await page.locator('#bootDetail').textContent(), /1\.0 MB of 4\.0 MB/);
    await page.screenshot({ path: 'test-results/game-loading-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: 'test-results/game-loading-narrow.png' });
    await page.evaluate(() => boot.progress('Red Light arena', 1048576, 0, { completed: 1, resources: 3 }));
    assert.equal(await page.locator('#bootProgress').getAttribute('aria-valuenow'), null, 'unknown download size cannot report a made-up percentage');
    await page.evaluate(() => boot.step('Preparing the first frame…'));
    assert.equal(await page.locator('#bootPercent').textContent(), 'Preparing');
    assert.equal(await page.evaluate(() => boot.state), 'loading');
    releaseArena();
    await page.waitForFunction(() => window.boot?.state === 'ready', {}, { timeout: 60000 });
    await page.locator('#gameBoot').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#overlay').evaluate(node => node.inert), false);
    assert.equal(await page.locator('#splat').evaluate(node => getComputedStyle(node).visibility), 'visible');
  } finally { releaseArena?.(); await browser.close(); await app.close(); }
});

test('a required module download failure shows a working Retry before game code starts', { timeout: 90000 }, async () => {
  const app = await server(), browser = await launch();
  try {
    const page = await trainedPage(browser);
    let fail = true;
    await page.route('**/engine/asset-loader.js', route => fail ? route.abort('failed') : route.continue());
    await page.goto(app.base + '/games/squid/red-light/', { waitUntil: 'domcontentloaded' });
    await page.locator('#bootRetry').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => boot.state), 'failed');
    assert.equal(await page.locator('#bootHome').getAttribute('href'), '/');
    assert.equal(await page.locator('#overlay').evaluate(node => node.inert), true);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'bootRetry');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'bootHome', 'keyboard navigation must reach the recovery actions');
    fail = false;
    await page.locator('#bootRetry').click();
    await page.waitForFunction(() => window.boot?.state === 'ready', {}, { timeout: 60000 });
    await page.locator('#gameBoot').waitFor({ state: 'hidden' });
  } finally { await browser.close(); await app.close(); }
});

test('graphics loss during the ready transition preserves an accessible recovery screen', { timeout: 90000 }, async () => {
  const app = await server(), browser = await launch();
  try {
    const page = await trainedPage(browser);
    await page.addInitScript(() => {
      let instance;
      Object.defineProperty(window, 'boot', { configurable: true, get: () => instance, set: value => {
        instance = value;
        const done = value.done;
        value.done = function () {
          const result = done.call(this);
          document.querySelector('canvas').dispatchEvent(new Event('webglcontextlost', { bubbles: true, cancelable: true }));
          return result;
        };
      } });
    });
    await page.goto(app.base + '/games/squid/red-light/', { waitUntil: 'domcontentloaded' });
    await page.locator('#bootRetry').waitFor({ state: 'visible' });
    // Wait beyond the normal dismissal so an old fade timer cannot hide Retry.
    await page.waitForTimeout(350);
    assert.equal(await page.evaluate(() => boot.state), 'failed');
    assert.equal(await page.locator('#gameBoot').evaluate(node => node.inert), false);
    assert.equal(await page.locator('#gameBoot').getAttribute('aria-hidden'), null);
    assert.equal(await page.locator('#bootRetry').isVisible(), true);
    assert.match(await page.locator('#bootDetail').textContent(), /graphics/);
    await page.locator('#bootRetry').click({ trial: true });
  } finally { await browser.close(); await app.close(); }
});
