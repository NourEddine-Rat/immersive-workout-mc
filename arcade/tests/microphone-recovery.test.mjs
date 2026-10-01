import test from 'node:test';
import assert from 'node:assert/strict';
import {createMicrophoneRecovery} from '../engine/lib/microphone-recovery.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

function setup(overrides = {}) {
  const prompt = deferred(), events = [], changes = [], order = [], calls = [];
  const eventTarget = new EventTarget();
  const controller = createMicrophoneRecovery({
    secure: true, eventTarget,
    navigator: {mediaDevices: {getUserMedia: options => { calls.push(options); return prompt.promise; }}},
    onChange: snapshot => changes.push(snapshot),
    onRetry: () => order.push('retry'),
    diagnostics: {record: (event, data) => events.push({event, data})},
    ...overrides,
  });
  const stream = {getTracks: () => [
    {label: 'Private microphone name', stop: () => order.push('audio-stop')},
    {stop: () => order.push('other-stop')},
  ]};
  return {controller, prompt, events, changes, order, calls, eventTarget, stream};
}

test('microphone recovery prompts only on explicit request, requests audio only and stops all tracks before retry', async () => {
  const t = setup();
  assert.equal(t.controller.snapshot.state, 'idle');
  assert.equal(t.calls.length, 0);
  const request = t.controller.request();
  assert.deepEqual(t.calls, [{audio: true, video: false}]);
  assert.equal(t.controller.snapshot.state, 'requesting');
  assert.equal(t.controller.snapshot.pending, true);
  assert.equal(t.controller.request(), request, 'duplicate clicks reuse the pending request');
  assert.equal(t.calls.length, 1);
  t.prompt.resolve(t.stream);
  const result = await request;
  assert.equal(result.state, 'granted');
  assert.equal(result.pending, false);
  assert.equal(result.granted, true);
  assert.deepEqual(t.order, ['audio-stop', 'other-stop', 'retry']);
  assert.deepEqual(t.events.map(e => e.event), ['microphone-request', 'microphone-granted']);
  assert.ok(!JSON.stringify(t.events).includes('Private'));
  assert.ok(Object.isFrozen(result));
  t.controller.destroy();
});

test('pagehide releases a late stream without retry, then a new user action may request again', async () => {
  const t = setup();
  const request = t.controller.request();
  t.eventTarget.dispatchEvent(new Event('pagehide'));
  assert.equal(t.controller.snapshot.pending, true, 'the native prompt cannot be cancelled through JavaScript');
  assert.equal(t.controller.request(), request, 'do not open a second native prompt');
  t.prompt.resolve(t.stream);
  await request;
  assert.deepEqual(t.order, ['audio-stop', 'other-stop']);
  assert.equal(t.controller.snapshot.state, 'idle');
  assert.equal(t.controller.snapshot.pending, false);
  assert.ok(t.events.some(e => e.event === 'microphone-cancelled'));
  await t.controller.request();
  assert.equal(t.calls.length, 2);
  assert.equal(t.order.at(-1), 'retry');
  t.controller.destroy();
});

test('destroy releases a late stream and cannot reopen microphone or publish late state', async () => {
  const t = setup();
  const request = t.controller.request();
  t.controller.destroy();
  const changeCount = t.changes.length;
  t.prompt.resolve(t.stream);
  await request;
  assert.deepEqual(t.order, ['audio-stop', 'other-stop']);
  assert.equal(t.changes.length, changeCount);
  await t.controller.request();
  assert.equal(t.calls.length, 1);
});

test('destroying the controller while publishing success prevents connection restart', async () => {
  let t;
  t = setup({onChange: snapshot => {
    if (snapshot.state === 'granted') t.controller.destroy();
  }});
  const request = t.controller.request();
  t.prompt.resolve(t.stream);
  await request;
  assert.deepEqual(t.order, ['audio-stop', 'other-stop']);
});

test('cancelled denial has no retry or misleading denial state', async () => {
  const t = setup();
  const request = t.controller.request();
  t.controller.cancel();
  t.prompt.reject(Object.assign(new Error('sensitive message'), {name: 'NotAllowedError'}));
  await request;
  assert.equal(t.controller.snapshot.state, 'idle');
  assert.equal(t.order.length, 0);
  assert.ok(!t.events.some(e => e.event === 'microphone-failed'));
  t.controller.destroy();
});

test('permission, absent hardware and device errors are actionable and never leak error messages', async () => {
  const cases = [
    ['NotAllowedError', 'denied', /permission/],
    ['NotFoundError', 'unavailable', /No microphone/],
    ['NotReadableError', 'error', /system microphone/],
    ['AbortError', 'error', /interrupted/],
    ['SecurityError', 'unavailable', /blocked/],
    ['Private device identifier', 'error', /could not start/],
  ];
  for (const [name, state, message] of cases) {
    const t = setup();
    const request = t.controller.request();
    t.prompt.reject(Object.assign(new Error('Private device identifier'), {name}));
    await request;
    assert.equal(t.controller.snapshot.state, state);
    assert.match(t.controller.snapshot.message, message);
    assert.equal(t.controller.snapshot.pending, false);
    assert.equal(t.controller.snapshot.available, true, 'a future user action can retry after settings/hardware change');
    assert.equal(t.order.length, 0);
    assert.ok(!JSON.stringify(t.events).includes('Private'));
    t.controller.destroy();
  }
});

test('insecure and unsupported contexts never request microphone', async () => {
  for (const overrides of [{secure: false}, {navigator: {}}]) {
    const t = setup(overrides);
    assert.equal(t.controller.snapshot.state, 'unavailable');
    assert.equal(t.controller.snapshot.available, false);
    await t.controller.request();
    assert.equal(t.calls.length, 0);
    assert.equal(t.order.length, 0);
    t.controller.destroy();
  }
});

test('a synchronous getUserMedia failure settles cleanly and allows a later explicit retry', async () => {
  let calls = 0;
  const t = setup({navigator: {mediaDevices: {getUserMedia: () => {
    calls++;
    if (calls === 1) throw Object.assign(new Error('device in use'), {name: 'NotReadableError'});
    return Promise.resolve({getTracks: () => []});
  }}}});
  await t.controller.request();
  assert.equal(t.controller.snapshot.state, 'error');
  await t.controller.request();
  assert.equal(t.controller.snapshot.state, 'granted');
  assert.equal(calls, 2);
  t.controller.destroy();
});

test('a track stop failure still releases other tracks and does not start recovery', async () => {
  const t = setup();
  const request = t.controller.request();
  t.prompt.resolve({getTracks: () => [
    {stop() { throw new Error('broken track'); }},
    {stop: () => t.order.push('other-stop')},
  ]});
  await request;
  assert.deepEqual(t.order, ['other-stop']);
  assert.equal(t.controller.snapshot.state, 'error');
  assert.ok(t.events.some(e => e.data.reason === 'stop-failed'));
  t.controller.destroy();
});
