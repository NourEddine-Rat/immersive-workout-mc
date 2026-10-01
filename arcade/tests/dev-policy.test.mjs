import test from 'node:test';
import assert from 'node:assert/strict';
import { isDevAllowed } from '../engine/lib/dev-policy.js';
import { devPanel } from '../engine/developer-panel.js';

test('developer previews require explicit opt-in on loopback', () => {
  for (const host of ['localhost', '127.0.0.1', '127.0.0.2', '[::1]']) {
    assert.equal(isDevAllowed(new URL(`http://${host}:8000/?dev=1`)), true, host);
    for (const query of ['', '?dev', '?dev=0', '?dev=true', '?preview=1']) {
      assert.equal(isDevAllowed(new URL(`http://${host}:8000/${query}`)), false, `${host}${query}`);
    }
  }
});

test('a developer query cannot enable previews on Heroku or the local network', () => {
  for (const host of [
    'in-motion-2e119ccbfdf3.herokuapp.com', '192.168.1.112', '10.0.0.2',
    'localhost.example.com', '127.0.0.1.example.com', 'example.localhost',
    '0.0.0.0', '[::]', '[::ffff:127.0.0.1]'
  ]) {
    assert.equal(isDevAllowed(new URL(`http://${host}/?dev=1`)), false, host);
  }
  assert.equal(isDevAllowed(), false);
  assert.equal(isDevAllowed({ hostname: '127.1.1.999', search: '?dev=1' }), false);
});

test('disabled developer panels do not touch the DOM, install listeners or run preview callbacks', async () => {
  const previous = Object.fromEntries(['document', 'addEventListener', 'requestAnimationFrame'].map(key => [key, globalThis[key]]));
  globalThis.document = new Proxy({}, { get() { throw new Error('Production preview touched the DOM'); } });
  globalThis.addEventListener = () => assert.fail('Production preview installed a listener');
  globalThis.requestAnimationFrame = () => assert.fail('Production preview started fake motion');
  try {
    const unexpected = () => assert.fail('Production preview changed game state');
    const panel = devPanel({ screens: [{ name: 'Skip training', show: unexpected }], pocket: {}, onOpen: unexpected, settle: unexpected });
    panel.open();
    await panel.show(0);
    assert.equal(Object.isFrozen(panel), true);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
