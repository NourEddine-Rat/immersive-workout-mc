import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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

test('a quick phone choice survives stale PC echoes and Play opens that exact game; PC selection still syncs', { timeout: 60000 }, async () => {
  const app = await server();
  const browser = await chromium.launch({ channel: process.env.ARCADE_BROWSER || 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
  try {
    const pc = await browser.newPage({ viewport: { width: 1120, height: 760 }, reducedMotion: 'reduce' });
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    const errors = [];
    pc.on('pageerror', error => errors.push(error.message));
    phone.on('pageerror', error => errors.push(error.message));
    await returningPhone(phone);
    await phone.addInitScript(() => {
      window.selectionStates = []; window.selectionPicks = []; window.heldSelections = []; window.holdSelections = false;
      addEventListener('phone-carousel', event => selectionStates.push(event.detail));
      const send = RTCDataChannel.prototype.send;
      RTCDataChannel.prototype.send = function (data) {
        let message; try { message = JSON.parse(data); } catch {}
        // Hold the phone's visual selection updates while allowing real PC
        // state echoes through. This makes the bidirectional race deterministic.
        if (message?.t === 'carousel-move' && holdSelections) { heldSelections.push(message); return; }
        if (message?.t === 'carousel-pick') selectionPicks.push(message);
        return send.call(this, data);
      };
    });
    await pc.goto(app.base, { waitUntil: 'domcontentloaded' });
    await pc.waitForFunction(() => /^\d{6}$/.test(document.querySelector('.pair-code')?.textContent));
    await phone.goto(app.base + '/phone.html?connect=' + await pc.locator('.pair-code').textContent(), { waitUntil: 'domcontentloaded' });
    await phone.waitForFunction(() => window.PhoneConnection?.status.direct, {}, { timeout: 20000 });
    await phone.locator('#motionEnable').click();
    await phone.evaluate(() => {
      window.selectionMotion = setInterval(() => dispatchEvent(new DeviceMotionEvent('devicemotion', {
        accelerationIncludingGravity: { x: 0, y: 9.80665, z: 0 }, acceleration: { x: 0, y: 0, z: 0 },
        rotationRate: { alpha: 0, beta: 0, gamma: 0 }, interval: 16,
      })), 16);
    });
    await pc.waitForFunction(() => window.phoneGate?.ready && !document.querySelector('.frame').inert);
    await phone.locator('.remote-gallery[data-state=ready]').waitFor({ timeout: 20000 });

    // PC navigation and a real canvas click still choose and publish a game.
    await pc.locator('#stage').press('Home');
    await pc.locator('#stage').press('ArrowRight');
    await phone.waitForFunction(() => document.querySelector('#remoteGame')?.textContent === 'Red Light Green Light');
    await pc.locator('.game-logo[data-game=redlight].is-active').waitFor();
    await pc.locator('#stage').click();
    await pc.locator('#game-about[open]').waitFor();
    assert.equal(await pc.locator('#game-about').getAttribute('data-game'), 'redlight');
    await pc.locator('#about-close').click();
    await pc.locator('#stage').press('Home');
    await phone.waitForFunction(() => document.querySelector('#remoteGame')?.textContent === 'Subway');

    const beforeInvalid = await phone.evaluate(() => selectionStates.length);
    await phone.evaluate(() => {
      dispatchEvent(new CustomEvent('phone-command', { detail: { t: 'carousel-pick', game: 'unknown-game' } }));
      dispatchEvent(new CustomEvent('phone-command', { detail: { t: 'carousel-sync' } }));
    });
    await phone.waitForFunction(count => selectionStates.length > count, beforeInvalid);
    assert.equal(await pc.locator('#game-about').evaluate(dialog => dialog.open), false, 'unknown game identities are ignored');

    await phone.evaluate(() => { window.holdSelections = true; });
    await phone.frameLocator('#remoteCarousel').locator('#stage').press('ArrowRight');
    await phone.waitForFunction(() => document.querySelector('#remoteGame')?.textContent === 'Red Light Green Light' && heldSelections.length > 0);
    const beforeEcho = await phone.evaluate(() => selectionStates.length);
    await phone.evaluate(() => dispatchEvent(new CustomEvent('phone-command', { detail: { t: 'carousel-sync' } })));
    await phone.waitForFunction(count => selectionStates.length > count && selectionStates.at(-1)?.game === 'subway', beforeEcho);
    assert.equal(await phone.locator('#remoteGame').textContent(), 'Red Light Green Light', 'an older PC echo cannot change the pending phone choice');
    assert.equal(await pc.locator('.game-logo[data-game=subway].is-active').count(), 1, 'the PC has deliberately not received the move yet');
    await phone.locator('#remotePlay').click();
    await pc.locator('#game-about[open]').waitFor();
    assert.equal(await pc.locator('#game-about').getAttribute('data-game'), 'redlight', 'Play carries the exact choice instead of using either screen’s stale position');
    const pick = await phone.evaluate(() => selectionPicks.at(-1));
    assert.equal(pick.game, 'redlight');
    assert.ok(pick.selectionRevision > 0);
    assert.equal(typeof pick.selectionId, 'string');
    await pc.waitForURL('**/training/?next=*');
    assert.equal(new URL(pc.url()).searchParams.get('next'), '/games/squid/red-light/');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await app.close(); }
});
