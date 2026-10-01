import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MeshoptDecoder } from '../engine/three/libs/meshopt_decoder.module.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const requiredModels = [
  'games/subway/models/environment/subway-environment.gltf',
  'games/squid/red-light/models/arena.glb',
  'games/squid/jump-rope/models/arena.glb',
  'games/squid/track/models/stadium.glb',
  'training/gym/training-studio.gltf',
  'engine/body/athlete-avatar.glb',
  'engine/body/controller-arms.glb',
  'engine/body/training-coach.glb',
  'carousel/controller-hands.glb'
];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : file;
  }));
  return nested.flat();
}

async function packagedFile(file) {
  const relative = path.relative(root, file);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `Asset escapes the app: ${file}`);
  // macOS normally accepts the wrong filename case; Heroku's filesystem does not.
  let current = root;
  for (const part of relative.split(path.sep)) {
    assert.ok((await readdir(current)).includes(part), `Missing or incorrectly cased asset: ${relative}`);
    current = path.join(current, part);
  }
  const bytes = await readFile(file);
  assert.ok(bytes.length > 0, `Empty asset: ${relative}`);
  assert.ok(!bytes.subarray(0, 80).toString().startsWith('version https://git-lfs.github.com/spec'), `Unresolved Git LFS pointer: ${relative}`);
  return bytes;
}

async function referencedBytes(uri, model) {
  if (uri.startsWith('data:')) {
    const separator = uri.indexOf(',');
    assert.ok(separator >= 0, `Malformed data URI in ${model}`);
    return uri.slice(0, separator).endsWith(';base64')
      ? Buffer.from(uri.slice(separator + 1), 'base64')
      : Buffer.from(decodeURIComponent(uri.slice(separator + 1)));
  }
  assert.ok(!/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(uri), `Model depends on an external server: ${model}: ${uri}`);
  const resource = decodeURIComponent(uri.split(/[?#]/, 1)[0]);
  return packagedFile(path.resolve(path.dirname(model), resource));
}

function parseModel(bytes, file) {
  if (file.endsWith('.gltf')) return { document: JSON.parse(bytes.toString()), binary: null };
  assert.equal(bytes.subarray(0, 4).toString(), 'glTF', `Invalid GLB header: ${file}`);
  assert.equal(bytes.readUInt32LE(4), 2, `Unsupported GLB version: ${file}`);
  assert.equal(bytes.readUInt32LE(8), bytes.length, `Truncated GLB: ${file}`);
  let document, binary;
  for (let offset = 12; offset < bytes.length;) {
    assert.ok(offset + 8 <= bytes.length, `Truncated GLB chunk header: ${file}`);
    const length = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4);
    assert.ok(offset + 8 + length <= bytes.length, `Truncated GLB chunk: ${file}`);
    const contents = bytes.subarray(offset + 8, offset + 8 + length);
    if (offset === 12) {
      assert.equal(type, 0x4e4f534a, `GLB does not begin with JSON: ${file}`);
      document = JSON.parse(contents.toString());
    } else if (type === 0x004e4942) binary = contents;
    offset += 8 + length;
  }
  assert.ok(document, `GLB has no JSON document: ${file}`);
  return { document, binary };
}

function imageSignature(bytes, label) {
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp = bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  assert.ok(png || jpeg || webp, `Missing or unsupported texture data: ${label}`);
}

const files = (await Promise.all(['games', 'training', 'engine/body', 'carousel'].map(folder => walk(path.join(root, folder))))).flat();
const models = files.filter(file => /\.(?:gltf|glb)$/.test(file));

test('each playable map, training room and shared body is included in the deployment', async () => {
  for (const relative of requiredModels) assert.ok(models.includes(path.join(root, relative)), `Missing required model: ${relative}`);
  imageSignature(await packagedFile(path.join(root, 'games/squid/track/models/trees.webp')), 'track trees');
  JSON.parse((await packagedFile(path.join(root, 'games/squid/track/models/trees.json'))).toString());
});

for (const model of models) {
  test(`packaged model is complete: ${path.relative(root, model)}`, async () => {
    const { document, binary } = parseModel(await packagedFile(model), model);
    assert.equal(document.asset?.version, '2.0');
    const buffers = await Promise.all((document.buffers || []).map(async (buffer, i) => {
      assert.ok(Number.isSafeInteger(buffer.byteLength) && buffer.byteLength > 0, `Invalid buffer length in ${model}`);
      // Meshopt's required-extension format intentionally has a virtual fallback
      // buffer; its views must be reconstructed from the compressed source.
      if (buffer.extensions?.EXT_meshopt_compression?.fallback) return null;
      const bytes = buffer.uri ? await referencedBytes(buffer.uri, model) : binary;
      assert.ok(bytes, `Missing buffer ${i} in ${model}`);
      assert.ok(bytes.length >= buffer.byteLength, `Truncated buffer ${i} in ${model}`);
      return bytes;
    }));
    const views = await Promise.all((document.bufferViews || []).map(async (view, i) => {
      const buffer = buffers[view.buffer], start = view.byteOffset || 0;
      assert.ok(Number.isSafeInteger(start) && start >= 0 && Number.isSafeInteger(view.byteLength) && view.byteLength >= 0);
      assert.ok(start + view.byteLength <= document.buffers[view.buffer].byteLength, `Buffer view ${i} exceeds buffer in ${model}`);
      const compressed = view.extensions?.EXT_meshopt_compression;
      if (compressed) {
        const source = buffers[compressed.buffer], offset = compressed.byteOffset || 0;
        assert.ok(source && offset >= 0 && offset + compressed.byteLength <= source.length, `Truncated compressed view ${i} in ${model}`);
        assert.equal(compressed.count * compressed.byteStride, view.byteLength, `Invalid decoded view length in ${model}`);
        return Buffer.from(await MeshoptDecoder.decodeGltfBufferAsync(compressed.count, compressed.byteStride,
          source.subarray(offset, offset + compressed.byteLength), compressed.mode, compressed.filter));
      }
      assert.ok(buffer, `Missing buffer for view ${i} in ${model}`);
      return buffer.subarray(start, start + view.byteLength);
    }));
    for (const [i, image] of (document.images || []).entries()) {
      const bytes = image.uri ? await referencedBytes(image.uri, model) : views[image.bufferView];
      assert.ok(bytes, `Missing image ${i} in ${model}`);
      imageSignature(bytes, `${model}, image ${i}`);
    }
  });
}
