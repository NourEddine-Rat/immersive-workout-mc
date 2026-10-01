import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadAsset, createAssetLoader, gltfDependencies, gltfDocument } from '../engine/asset-loader.js';

const bytes = value => new TextEncoder().encode(value);
const response = (value, status = 200) => new Response(value, { status, headers: { 'content-length': String(bytes(value).length) } });

test('an interrupted map download retries complete bytes without accepting the partial file', async () => {
  let attempts = 0;
  const progress = [], retries = [];
  const blob = await downloadAsset('https://game.test/map.glb', {
    retryDelayMs: 0, onProgress: value => progress.push(value), onRetry: value => retries.push(value),
    fetchImpl: async () => {
      if (++attempts === 1) return new Response(new ReadableStream({
        start(controller) { controller.enqueue(bytes('part')); },
        pull(controller) { controller.error(new Error('connection closed')); },
      }), { headers: { 'content-length': '100' } });
      return response('complete map');
    },
  });
  assert.equal(await blob.text(), 'complete map');
  assert.equal(attempts, 2); assert.equal(retries.length, 1);
  assert.equal(progress.filter(value => value.complete).length, 1);
  assert.equal(progress.at(-1).loaded, 12);
});

test('missing assets fail immediately and server failures retry a bounded number of times', async () => {
  let missing = 0, unavailable = 0;
  await assert.rejects(downloadAsset('https://game.test/missing', { retryDelayMs: 0, fetchImpl: async () => { missing++; return response('not found', 404); } }), /HTTP 404/);
  assert.equal(missing, 1);
  await assert.rejects(downloadAsset('https://game.test/unavailable', { retryDelayMs: 0, fetchImpl: async () => { unavailable++; return response('busy', 503); } }), /HTTP 503/);
  assert.equal(unavailable, 3);
});

test('a stalled download is aborted and reported instead of hanging the loader forever', async () => {
  let aborted = 0;
  await assert.rejects(downloadAsset('https://game.test/stalled', {
    retries: 0, idleTimeoutMs: 15, totalTimeoutMs: 100,
    fetchImpl: async (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => { aborted++; reject(new DOMException('aborted', 'AbortError')); }, { once: true })),
  }), /stopped responding/);
  assert.equal(aborted, 1);
});

test('a prematurely ended response cannot pass even when the stream closes cleanly', async () => {
  await assert.rejects(downloadAsset('https://game.test/short', {
    retries: 0, fetchImpl: async () => new Response('short', { headers: { 'content-length': '90' } }),
  }), /incomplete/);
});

test('encoded Content-Length is not mistaken for the decoded download size', async () => {
  const reports = [];
  const blob = await downloadAsset('https://game.test/compressed', {
    onProgress: event => reports.push(event),
    fetchImpl: async () => new Response('decoded resource', { headers: { 'content-length': '3', 'content-encoding': 'gzip' } }),
  });
  assert.equal(blob.size, 16);
  assert.equal(reports.filter(value => !value.complete).every(value => !value.total), true);
  assert.equal(reports.at(-1).total, 16);
});

test('GLTF dependencies resolve from the model URL including absolute paths and spaces', () => {
  const document = { buffers: [{ uri: '../mesh.bin' }, { uri: 'data:application/octet-stream;base64,AA==' }], images: [{ uri: 'textures/green wall.png' }, { uri: '/shared/skin.png' }, { uri: '../mesh.bin' }] };
  assert.deepEqual(gltfDependencies(document, 'https://game.test/maps/gym/model.gltf?version=3'), [
    'https://game.test/maps/mesh.bin', 'https://game.test/maps/gym/textures/green%20wall.png', 'https://game.test/shared/skin.png',
  ]);
});

test('aggregate preloading waits for all external assets and never invents an unknown total', async () => {
  const map = JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'mesh.bin' }], images: [{ uri: 'wall.png' }] });
  const files = new Map([['https://game.test/map.gltf', map], ['https://game.test/mesh.bin', 'mesh'], ['https://game.test/wall.png', 'image'], ['https://game.test/guide.jpg', 'guide']]);
  const reports = [], steps = [], requested = [];
  const loader = createAssetLoader({ baseURL: 'https://game.test/', boot: { progress: (...event) => reports.push(event), step: label => steps.push(label) }, fetchImpl: async url => { requested.push(url); return response(files.get(url)); } });
  await loader.preload([{ url: 'map.gltf', label: 'Map' }, { url: 'guide.jpg', label: 'Guide' }]);
  assert.deepEqual(new Set(requested), new Set(files.keys()));
  assert.equal(reports[0][2], 0, 'manifest dependencies are not known yet');
  const last = reports.at(-1), total = [...files.values()].reduce((sum, value) => sum + bytes(value).length, 0);
  assert.equal(last[1], total); assert.equal(last[2], total);
  assert.equal(last[3].completed, 4); assert.equal(last[3].resources, 4);
  assert.equal(steps.at(-1), 'Preparing your game…');
});

test('an external texture HTTP failure prevents map readiness', async () => {
  const steps = [];
  const loader = createAssetLoader({ baseURL: 'https://game.test/', boot: { step: value => steps.push(value) }, fetchImpl: async url => url.endsWith('.gltf') ? response(JSON.stringify({ asset: { version: '2.0' }, images: [{ uri: 'missing.png' }] })) : response('missing', 404) });
  await assert.rejects(loader.preload([{ url: 'map.gltf', label: 'Red Light arena' }]), /Red Light arena detail:.*HTTP 404/);
  assert.equal(steps.includes('Preparing your game…'), false);
});

test('a truncated GLB header fails before parsing or allocating its buffers', () => {
  const binary = new ArrayBuffer(20), view = new DataView(binary);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, 100000, true);
  assert.throws(() => gltfDocument(binary), /incomplete/);
});
