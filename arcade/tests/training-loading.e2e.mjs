import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

async function server() {
  const child = spawn('python3', ['-u', '-c', "import serve; s=serve.Dual(('127.0.0.1',0),serve.Handler); print(s.server_port,flush=True); s.serve_forever()"], {
    cwd: new URL('../', import.meta.url), stdio: ['ignore', 'pipe', 'ignore'],
  });
  const port = await new Promise((resolve, reject) => {
    child.stdout.once('data', data => resolve(Number(data.toString().trim())));
    child.once('error', reject);
  });
  return { base: `http://localhost:${port}`, close: () => new Promise(resolve => { child.once('exit', resolve); child.kill(); }) };
}
const launch = () => chromium.launch({ channel: process.env.ARCADE_BROWSER || 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });

test('training waits for the complete studio and decoded guides before revealing its first frame', { timeout: 90000 }, async () => {
  const s = await server(), browser = await launch();
  let releaseStudio;
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.addInitScript(() => {
      window.microphoneRequests = 0;
      navigator.mediaDevices.getUserMedia = () => { microphoneRequests++; return Promise.reject(new DOMException('Test denies unsolicited audio', 'NotAllowedError')); };
    });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const studioHeld = new Promise(resolve => { releaseStudio = resolve; });
    let requestedStudio;
    const studioRequested = new Promise(resolve => { requestedStudio = resolve; });
    await page.route('**/training/gym/training-studio.bin', async route => { requestedStudio(); await studioHeld; await route.continue(); });
    let guideAttempts = 0;
    await page.route('**/training/pocket/pocket-correct-position.jpg', route => ++guideAttempts === 1 ? route.abort('failed') : route.continue());
    await page.goto(s.base + '/training/?next=%2Fgames%2Fsquid%2Fred-light%2F', { waitUntil: 'domcontentloaded' });
    await studioRequested;
    assert.equal(await page.locator('body').evaluate(body => body.classList.contains('training-loading')), true);
    assert.equal(await page.locator('.stage').evaluate(stage => stage.inert), true);
    assert.equal(await page.locator('#gym').evaluate(canvas => getComputedStyle(canvas).visibility), 'hidden');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#actions button').count(), 0);
    await page.screenshot({ path: 'test-results/training-loading.png' });
    releaseStudio();
    await page.waitForFunction(() => !document.body.classList.contains('training-loading'), {}, { timeout: 60000 });
    assert.equal(await page.locator('.stage').evaluate(stage => stage.inert), false);
    assert.equal(await page.locator('.stage').getAttribute('aria-busy'), 'false');
    assert.equal(await page.locator('#kicker').textContent(), 'Before you play Red Light, Green Light');
    assert.ok(guideAttempts >= 2, 'the pocket illustration retries an interrupted download');
    assert.equal(await page.locator('#guide img').evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0)), true);
    assert.equal(await page.locator('#gym').evaluate(canvas => getComputedStyle(canvas).visibility), 'visible');
    await page.locator('#gameBoot').waitFor({ state: 'hidden' });
    await page.screenshot({ path: 'test-results/training-ready.png' });
    await page.locator('#connectionHelp summary').waitFor({ state: 'visible' });
    await page.locator('#connectionHelp summary').click();
    assert.equal(await page.locator('#microphoneRetry').isDisabled(), true, 'pair before offering a microphone recovery request');
    assert.equal(await page.evaluate(() => microphoneRequests), 0, 'training must never request microphone access automatically');
    await page.screenshot({ path: 'test-results/training-connection-help.png' });
    assert.deepEqual(errors, []);
  } finally { releaseStudio?.(); await browser.close(); await s.close(); }
});

test('a missing required training model offers recovery and never starts an incomplete training', { timeout: 90000 }, async () => {
  const s = await server(), browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    let missing = true;
    await page.route('**/engine/body/training-coach.glb', route => missing ? route.fulfill({ status: 404, body: 'missing' }) : route.continue());
    await page.goto(s.base + '/training/?dev=1&next=%2F%5Cexample.com', { waitUntil: 'domcontentloaded' });
    const retry = page.getByRole('button', { name: /^(try again|retry)$/i });
    await retry.waitFor({ state: 'visible' });
    assert.equal(await page.locator('body').evaluate(body => body.classList.contains('training-loading')), true);
    assert.equal(await page.locator('.stage').evaluate(stage => stage.inert), true);
    assert.equal(await page.locator('#actions button').count(), 0);
    assert.equal(await page.locator('.dev, #devToggle, #devPanel').count(), 0);
    assert.equal(await page.evaluate(() => '__tr' in window), false);
    await page.screenshot({ path: 'test-results/training-download-failed.png' });
    missing = false;
    await retry.click();
    await page.waitForFunction(() => !document.body.classList.contains('training-loading'), {}, { timeout: 60000 });
    assert.equal(await page.locator('#kicker').textContent(), 'Your controller', 'untrusted return destinations must not enter the game flow');
    assert.equal(new URL(page.url()).origin, s.base);
  } finally { await browser.close(); await s.close(); }
});

test('training stops after graphics failure and a pending startup cannot reveal it again', { timeout: 90000 }, async () => {
  const s = await server(), browser = await launch();
  let releaseStudio;
  try {
    const page = await browser.newPage();
    await page.goto(s.base + '/training/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.boot?.state === 'ready');
    await page.evaluate(async () => {
      const { PocketSource } = await import('/engine/motion-controller.js');
      const poll = PocketSource.prototype.poll;
      window.trainingPolls = 0;
      PocketSource.prototype.poll = function (...args) { trainingPolls++; return poll.apply(this, args); };
    });
    await page.waitForFunction(() => trainingPolls > 2);
    await page.evaluate(() => document.querySelector('#gym').dispatchEvent(new Event('webglcontextlost', { bubbles: true, cancelable: true })));
    const stopped = await page.evaluate(() => trainingPolls);
    await page.waitForTimeout(3100); // Pass the welcome delay and any pending transition.
    assert.equal(await page.evaluate(() => trainingPolls), stopped);
    assert.equal(await page.evaluate(() => boot.state), 'failed');
    assert.equal(await page.locator('.stage').evaluate(node => node.inert), true);
    assert.equal(await page.locator('#actions').isVisible(), false);
    assert.equal(await page.locator('#bootRetry').isVisible(), true);
    assert.equal(await page.evaluate(() => localStorage.getItem('arcade.profile.v1')), null);

    const loadingPage = await browser.newPage();
    const held = new Promise(resolve => { releaseStudio = resolve; });
    let requested;
    const request = new Promise(resolve => { requested = resolve; });
    await loadingPage.route('**/training/gym/training-studio.bin', async route => { requested(); await held; await route.continue(); });
    await loadingPage.goto(s.base + '/training/', { waitUntil: 'domcontentloaded' });
    await request;
    await loadingPage.evaluate(() => {
      window.trainingDoneAttempts = 0;
      const done = boot.done;
      boot.done = function () { trainingDoneAttempts++; return done.call(this); };
      document.querySelector('#gym').dispatchEvent(new Event('webglcontextlost', { bubbles: true, cancelable: true }));
    });
    releaseStudio();
    await loadingPage.waitForFunction(() => trainingDoneAttempts > 0, {}, { timeout: 60000 });
    assert.equal(await loadingPage.evaluate(() => boot.state), 'failed');
    assert.equal(await loadingPage.locator('.stage').evaluate(node => node.inert), true);
    assert.equal(await loadingPage.locator('#actions').isVisible(), false);
    assert.equal(await loadingPage.locator('#bootRetry').isVisible(), true);
  } finally { releaseStudio?.(); await browser.close(); await s.close(); }
});
