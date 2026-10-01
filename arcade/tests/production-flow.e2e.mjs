import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { returningPhone } from './phone-fixtures.mjs';

async function server() {
  const child = spawn('python3', ['-u', '-c', "import serve; s=serve.Dual(('127.0.0.1',0),serve.Handler); print(s.server_port,flush=True); s.serve_forever()"], {
    cwd: new URL('../', import.meta.url), stdio: ['ignore', 'pipe', 'ignore'],
  });
  const port = await new Promise((resolve, reject) => {
    child.stdout.once('data', value => resolve(Number(value.toString().trim())));
    child.once('error', reject);
  });
  return { base: `http://localhost:${port}`, close: () => new Promise(resolve => { child.once('exit', resolve); child.kill(); }) };
}
const launch = () => chromium.launch({ channel: process.env.ARCADE_BROWSER || 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
const gamePaths = ['/games/squid/red-light/', '/games/squid/jump-rope/', '/games/squid/track/', '/games/subway/'];

async function noDeveloperUI(page) {
  assert.equal(await page.evaluate(async () => (await import('/engine/lib/dev-policy.js')).devAllowed), false);
  assert.equal(await page.locator('.xdev, #devToggle, #devPanel').count(), 0);
  assert.deepEqual(await page.getByRole('button', { name: /^(dev|no phone.*keyboard|skip training)$/i }).allTextContents(), [], 'developer actions must not appear in production');
  assert.equal(await page.locator('#dev').isVisible(), false);
  assert.equal(await page.evaluate(() => window.__devPreview === true || '__tr' in window), false);
}

test('production origins ignore developer queries on every map', { timeout: 180000 }, async () => {
  const app = await server(), browser = await launch();
  // This HTTPS origin is wholly intercepted. Application resources come from
  // our local server, outside resources are blocked, and sockets are closed.
  const origin = 'https://inmotion-production.test';
  try {
    const context = await browser.newContext({ viewport: { width: 960, height: 640 }, reducedMotion: 'reduce' });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      await route.fulfill({ response: await route.fetch({ url: app.base + url.pathname + url.search }) });
    });
    await context.routeWebSocket(`${origin.replace('https:', 'wss:')}/**`, socket => socket.close());
    await context.addInitScript(() => {
      // A completed calibration permits asset loading; this never enables dev.
      localStorage.setItem('arcade.profile.v1', JSON.stringify({ v: 1, created: Date.now(), cfg: {}, run: {}, pace: {}, still: {} }));
    });
    for (const path of gamePaths) {
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin + path + '?dev=1&auto=1&step=0.25', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.boot?.state === 'ready' || window.boot?.state === 'failed', {}, { timeout: 60000 });
      assert.equal(await page.evaluate(() => boot.state), 'ready', `${path}: ${errors.join('; ')}`);
      await noDeveloperUI(page);
      await page.keyboard.press('g');
      await page.keyboard.press('Space');
      assert.equal(await page.evaluate(() => window.__devPreview === true), false);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); await app.close(); }
});

async function observePhone(page) {
  await returningPhone(page);
  await page.addInitScript(() => {
    window.flowHostStates = [];
    addEventListener('phone-host', event => {
      if (event.detail.t === 'host-state') flowHostStates.push(event.detail);
    });
  });
}

async function enableMotion(phone) {
  await phone.locator('#motionEnable').click();
  // Synthetic device events still traverse the real phone sensors, WebRTC
  // channels, receiver, and two-second PocketSource warm-up.
  await phone.evaluate(() => {
    window.flowMotionTimer = setInterval(() => dispatchEvent(new DeviceMotionEvent('devicemotion', {
      accelerationIncludingGravity: { x: 0, y: 9.80665, z: 0 }, acceleration: { x: 0, y: 0, z: 0 },
      rotationRate: { alpha: 0, beta: 0, gamma: 0 }, interval: 16,
    })), 16);
  });
}

async function deterministicRoutine(page) {
  const source = await readFile(new URL('../engine/profile.js', import.meta.url), 'utf8');
  // Isolate navigation/save UI from physical repetition timing. Only the
  // Profiling class boundary is replaced; fit(), save(), user association,
  // sensors, warm-up and the entire local transport remain real.
  const measuredRoutine = `
const OriginalFlowProfiling = Profiling;
Profiling = class extends OriginalFlowProfiling {
  start(now) { super.start(now); this.flowStart = now; }
  update(now, read) {
    if (!read.live) return super.update(now, read);
    const elapsed = now - this.flowStart;
    const index = Math.min(STEPS.length - 1, Math.floor(elapsed / .4));
    if (elapsed < STEPS.length * .4) return {step:STEPS[index],index,of:STEPS.length,lead:false,lead01:1,hold:.5,reps:1,repsOf:STEPS[index].n,inRep:true,last:null,done:false};
    const gait = hz => ({hz:[hz,hz],peaks:[1.8,1.9],maxV:.8,maxTilt:20});
    const profile = fit({walk:gait(1.6),jog:gait(2.8),sprint:gait(3.4),still:{a:[.08],w:[30]},stopS:.3,hop:[1.7,1.8,1.75],squat:[66,70,68],squatMaxA:1.8,squatMaxW:150});
    this.done = true; this.profile = profile;
    this.pocket.onEvent = null; this.pocket.onSample = this._prevOnSample;
    return {done:true,profile};
  }
};`;
  await page.route('**/engine/profile.js', route => route.fulfill({ contentType: 'text/javascript', body: source + measuredRoutine }));
  await page.addInitScript(() => {
    window.flowTitles = [];
    addEventListener('DOMContentLoaded', () => {
      const title = document.querySelector('#title');
      if (title) new MutationObserver(() => flowTitles.push(title.textContent)).observe(title, { childList: true });
    });
  });
}

test('one local pairing follows game selection through training, recoverable saving and back to the intended game', { timeout: 180000 }, async () => {
  const app = await server(), browser = await launch();
  let releaseStudio;
  try {
    const pc = await browser.newPage({ viewport: { width: 1120, height: 760 }, reducedMotion: 'reduce' });
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    const errors = []; pc.on('pageerror', error => errors.push(error.message));
    await observePhone(phone);
    await deterministicRoutine(pc);
    const heldStudio = new Promise(resolve => { releaseStudio = resolve; });
    let requestedStudio;
    const studioRequested = new Promise(resolve => { requestedStudio = resolve; });
    await pc.route('**/training/gym/training-studio.bin', async route => { requestedStudio(); await heldStudio; await route.continue(); });
    await pc.goto(app.base, { waitUntil: 'domcontentloaded' });
    await pc.waitForFunction(() => /^\d{6}$/.test(document.querySelector('.pair-code')?.textContent));
    const code = await pc.locator('.pair-code').textContent();
    await phone.goto(app.base + '/phone.html?connect=' + code, { waitUntil: 'domcontentloaded' });
    await phone.waitForFunction(() => window.PhoneConnection?.status.direct, {}, { timeout: 25000 });
    await enableMotion(phone);
    await pc.waitForFunction(() => window.phoneGate?.ready, {}, { timeout: 25000 });
    const identity = await phone.evaluate(() => PhoneApp.id);
    const pairing = await phone.evaluate(() => localStorage.getItem('inmotion.pair.v1'));
    assert.equal(await pc.evaluate(() => localStorage.getItem('arcade.profile.v1')), null);
    await phone.locator('.remote-gallery[data-state=ready]').waitFor({ timeout: 30000 });
    const phoneGallery = phone.frameLocator('#remoteCarousel').locator('#stage');
    await phoneGallery.press('Home');
    await pc.locator('.game-logo[data-game=subway].is-active').waitFor();
    await phoneGallery.press('ArrowRight');
    // The phone renders its own selection immediately; wait for the PC's
    // rendered acknowledgement before pressing the shared Play action.
    await pc.locator('.game-logo[data-game=redlight].is-active').waitFor();
    await phone.waitForFunction(() => document.querySelector('#remoteGame')?.textContent === 'Red Light Green Light');
    await phone.locator('#remotePlay').click();
    await pc.waitForURL('**/training/?next=*', { timeout: 20000 });
    assert.equal(new URL(pc.url()).searchParams.get('next'), '/games/squid/red-light/');
    await studioRequested;
    assert.equal(await pc.locator('.stage').evaluate(element => element.inert), true);
    assert.equal(await pc.locator('#actions button').count(), 0);
    await phone.waitForFunction(() => flowHostStates.at(-1)?.game === 'training' && PhoneConnection.status.direct, {}, { timeout: 25000 });
    assert.deepEqual(await phone.evaluate(() => flowHostStates.at(-1).actions), [], 'loading must not publish premature remote actions');
    releaseStudio();
    await pc.waitForFunction(() => window.boot?.state === 'ready' && !document.body.classList.contains('training-loading'), {}, { timeout: 60000 });
    await noDeveloperUI(pc);
    await pc.getByRole('button', { name: /^Ready/ }).click({ timeout: 25000 });
    await pc.getByRole('button', { name: 'Save & play', exact: true }).waitFor({ timeout: 25000 });
    const titles = await pc.evaluate(() => flowTitles);
    for (const cue of ['Walk', 'Run', 'Run fast', 'Stop', 'Jump', 'Squat']) assert.ok(titles.includes(cue), `Training cue shown: ${cue}`);

    await pc.evaluate(() => {
      window.flowBlockStorage = true;
      const write = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (flowBlockStorage && key === 'arcade.profile.v1') throw new DOMException('Test quota reached', 'QuotaExceededError');
        return write.call(this, key, value);
      };
    });
    await pc.getByRole('button', { name: 'Save & play', exact: true }).click();
    await pc.getByRole('button', { name: 'Try saving again', exact: true }).waitFor();
    assert.equal(new URL(pc.url()).pathname, '/training/');
    assert.equal(await pc.evaluate(() => localStorage.getItem('arcade.profile.v1')), null);
    await pc.evaluate(() => { window.flowBlockStorage = false; });
    await pc.getByRole('button', { name: 'Try saving again', exact: true }).click();
    await pc.waitForURL('**/games/squid/red-light/');
    await pc.waitForFunction(() => window.boot?.state === 'ready', {}, { timeout: 60000 });
    await phone.waitForFunction(() => PhoneConnection.status.direct && flowHostStates.at(-1)?.game === 'redlight', {}, { timeout: 25000 });
    await pc.waitForFunction(async () => (await import('/engine/host-bridge.js')).hostBridge.connection.ready, {}, { timeout: 25000 });
    await noDeveloperUI(pc);
    assert.equal(await phone.evaluate(() => PhoneApp.id), identity);
    assert.equal(await phone.evaluate(() => localStorage.getItem('inmotion.pair.v1')), pairing, 'navigation must not require scanning another code');
    const calibration = await pc.evaluate(id => ({ user: localStorage.getItem('inmotion.player.v1'), profile: JSON.parse(localStorage.getItem('arcade.profile.v1')), player: JSON.parse(localStorage.getItem('arcade.calibration.' + id)) }), identity);
    assert.equal(calibration.user, identity);
    assert.deepEqual(calibration.profile, calibration.player);
    assert.equal(calibration.profile.v, 1);
    await phone.waitForFunction(created => PhoneApp.profile.calibration?.created === created, calibration.profile.created);
    assert.deepEqual(await phone.evaluate(() => PhoneApp.profile.calibration), calibration.profile);
    assert.equal(await phone.evaluate(() => PhoneConnection.status.route.allowed), true);
    assert.deepEqual(errors, []);
  } finally { releaseStudio?.(); await browser.close(); await app.close(); }
});
