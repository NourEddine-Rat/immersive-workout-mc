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
async function observeBoot(page) {
  await page.addInitScript(() => {
    localStorage.setItem('arcade.profile.v1', JSON.stringify({ v: 1, created: Date.now(), cfg: {}, run: {} }));
    window.assetProgress = []; window.assetSteps = []; window.assetFailures = []; window.drawsBeforeReady = 0;
    let boot;
    const wrap = value => {
      if (!value || value.__observed) return value;
      value.__observed = true;
      for (const [method, collect] of [['progress', (...args) => assetProgress.push(args)], ['step', text => assetSteps.push(text)], ['fail', text => assetFailures.push(text)]]) {
        const original = value[method]; value[method] = function (...args) { collect(...args); return original?.apply(this, args); };
      }
      return value;
    };
    Object.defineProperty(window, 'boot', { configurable: true, get: () => boot, set: value => { boot = wrap(value); } });
    // This fallback also lets the real map lifecycle be tested independently
    // of the overlay markup. The production boot script replaces it normally.
    window.boot = { state: 'loading', step() {}, progress() {}, fail() { this.state = 'failed'; }, done() { this.state = 'ready'; } };
    for (const Type of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) if (Type) {
      for (const method of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
        const original = Type.prototype[method];
        if (original) Type.prototype[method] = function (...args) { if (window.boot?.state !== 'ready') window.drawsBeforeReady++; return original.apply(this, args); };
      }
    }
  });
}

test('all four actual maps load their assets and render before becoming ready; an interrupted arena retries', { timeout: 180000 }, async () => {
  const app = await server(), browser = await launch();
  try {
    for (const path of ['/games/squid/red-light/', '/games/squid/jump-rope/', '/games/squid/track/', '/games/subway/']) {
      const page = await browser.newPage({ viewport: { width: 960, height: 640 } }), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await observeBoot(page);
      let arenaRequests = 0;
      if (path.includes('red-light')) await page.route('**/red-light/models/arena.glb', route => ++arenaRequests === 1 ? route.fulfill({ status: 503, body: 'Please retry' }) : route.continue());
      await page.goto(app.base + path, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => boot.state === 'ready' || boot.state === 'failed', {}, { timeout: 90000 });
      const result = await page.evaluate(() => ({ ready: window.__gameUp === true, state: boot.state, draws: drawsBeforeReady, failures: assetFailures, progress: assetProgress.at(-1), steps: assetSteps }));
      assert.equal(result.ready, true, `${path}: ${JSON.stringify(result.failures)}`);
      assert.equal(result.state, 'ready'); assert.ok(result.draws > 0, 'the first scene must render under the cover');
      assert.deepEqual(result.failures, []); assert.deepEqual(errors, []);
      assert.equal(result.progress[1], result.progress[2]); assert.ok(result.progress[2] > 0);
      assert.equal(result.progress[3].completed, result.progress[3].resources);
      if (path.includes('red-light')) { assert.equal(arenaRequests, 2); assert.ok(result.steps.some(step => step.startsWith('Retrying'))); }
      await page.close();
    }
  } finally { await browser.close(); await app.close(); }
});

test('a missing required arena fails visibly and cannot announce game readiness', { timeout: 30000 }, async () => {
  const app = await server(), browser = await launch();
  try {
    const page = await browser.newPage(); await observeBoot(page);
    let attempts = 0;
    await page.route('**/red-light/models/arena.glb', route => { attempts++; return route.fulfill({ status: 404, body: 'Missing map' }); });
    await page.goto(app.base + '/games/squid/red-light/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => boot.state === 'failed');
    assert.equal(await page.evaluate(() => window.__gameUp === true), false);
    assert.match(await page.evaluate(() => assetFailures.join('\n')), /Red Light arena:.*HTTP 404/);
    assert.equal(attempts, 1);
  } finally { await browser.close(); await app.close(); }
});

test('a corrupt required texture is rejected even though THREE permits missing textures', { timeout: 30000 }, async () => {
  const app = await server(), browser = await launch();
  try {
    const page = await browser.newPage();
    const positions = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer).toString('base64');
    const model = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }], buffers: [{ uri: `data:application/octet-stream;base64,${positions}`, byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }], materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }], textures: [{ source: 0 }], images: [{ uri: './bad.png' }] };
    await page.route('**/fixture/model.gltf', route => route.fulfill({ contentType: 'model/gltf+json', body: JSON.stringify(model) }));
    await page.route('**/fixture/bad.png', route => route.fulfill({ contentType: 'image/png', body: 'not image data' }));
    await page.goto(app.base + '/health');
    await page.addScriptTag({ type: 'importmap', content: JSON.stringify({ imports: { three: app.base + '/engine/three/three.module.js' } }) });
    const result = await page.evaluate(async () => {
      const { createAssetLoader } = await import('/engine/asset-loader.js');
      try { await createAssetLoader({ boot: null }).loadAsync('/fixture/model.gltf'); return 'unexpected success'; }
      catch (error) { return error.message; }
    });
    assert.match(result, /required image could not be decoded/);
  } finally { await browser.close(); await app.close(); }
});

test('graphics failure stops game motion updates behind the recovery cover on every map', { timeout: 90000 }, async () => {
  const app = await server(), browser = await launch();
  try {
    for (const path of ['/games/squid/red-light/', '/games/squid/jump-rope/', '/games/squid/track/', '/games/subway/']) {
      // Explicit loopback development mode exposes the real PocketSource for
      // observation; its poll method drives each game's simulation frame.
      const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
      await page.goto(app.base + path + '?dev=1', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.boot?.state === 'ready');
      await page.evaluate(() => {
        const source = (window.__sq || window.__sw).pocket, original = source.poll;
        window.gameMotionPolls = 0;
        source.poll = function (...args) { window.gameMotionPolls++; return original.apply(this, args); };
      });
      await page.waitForFunction(() => gameMotionPolls >= 3);
      const stopped = await page.evaluate(() => {
        document.querySelector('#gl').dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
        return gameMotionPolls;
      });
      await page.waitForFunction(() => boot.state === 'failed');
      // Three itself suppresses drawing after this event. Watching input polls
      // detects the otherwise-hidden continued simulation, not only rendering.
      await page.waitForTimeout(350);
      assert.equal(await page.evaluate(() => gameMotionPolls), stopped, `${path} must stop simulation when graphics fail`);
      assert.equal(await page.locator('#bootRetry').isVisible(), true);
      assert.equal(await page.locator('#bootRetry').isEnabled(), true);
      await page.close();
    }
  } finally { await browser.close(); await app.close(); }
});
