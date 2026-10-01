// A download boundary around THREE's loaders. Network failures must never turn
// into a partially textured map, and the loading screen follows real bytes.
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const describe = error => error?.message || String(error);

export class AssetLoadError extends Error {
  constructor(message, { retryable = false, cause } = {}) {
    super(message, { cause }); this.name = 'AssetLoadError'; this.retryable = retryable;
  }
}

/** Fetch one complete resource, retrying interrupted transfers but not a 404. */
export async function downloadAsset(url, {
  fetchImpl = globalThis.fetch, signal, onProgress = () => {}, onRetry = () => {},
  idleTimeoutMs = 30000, totalTimeoutMs = 300000, retries = 2, retryDelayMs = 700,
} = {}) {
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw signal.reason || new Error('Loading was cancelled.');
    const controller = new AbortController();
    let idle, total, timedOut = false, reader;
    const abort = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = () => { timedOut = true; controller.abort(); };
    const touch = () => { clearTimeout(idle); idle = setTimeout(timeout, idleTimeoutMs); };
    try {
      touch(); total = setTimeout(timeout, totalTimeoutMs);
      onProgress({ loaded: 0, total: 0, complete: false, attempt });
      const response = await fetchImpl(url, { signal: controller.signal, cache: attempt ? 'reload' : 'default' });
      if (!response.ok) throw new AssetLoadError(`The download returned HTTP ${response.status}.`, { retryable: response.status === 408 || response.status === 429 || response.status >= 500 });
      // With content encoding, Content-Length describes compressed bytes while
      // fetch streams decoded bytes; using it would show impossible percentages.
      const encoded = response.headers.get('content-encoding');
      const expected = (!encoded || encoded === 'identity') ? Number(response.headers.get('content-length')) || 0 : 0;
      let loaded = 0;
      const chunks = [];
      onProgress({ loaded, total: expected, complete: false, attempt });
      if (response.body?.getReader) {
        reader = response.body.getReader();
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          chunks.push(next.value); loaded += next.value.byteLength; touch();
          onProgress({ loaded, total: expected, complete: false, attempt });
        }
      } else {
        const bytes = await response.arrayBuffer(); chunks.push(bytes); loaded = bytes.byteLength;
      }
      if (expected && loaded !== expected) throw new AssetLoadError('The download was incomplete.', { retryable: true });
      if (!loaded) throw new AssetLoadError('The downloaded file was empty.', { retryable: true });
      const blob = new Blob(chunks, { type: response.headers.get('content-type') || 'application/octet-stream' });
      onProgress({ loaded, total: loaded, complete: true, attempt });
      return blob;
    } catch (error) {
      if (signal?.aborted) throw signal.reason || error;
      const failure = timedOut
        ? new AssetLoadError('The download stopped responding. Check your connection and try again.', { retryable: true, cause: error })
        : error instanceof AssetLoadError ? error : new AssetLoadError('The download was interrupted. Check your connection and try again.', { retryable: true, cause: error });
      if (!failure.retryable || attempt >= retries) throw failure;
      onRetry({ attempt: attempt + 1, error: failure });
    } finally {
      clearTimeout(idle); clearTimeout(total);
      signal?.removeEventListener('abort', abort);
      reader?.releaseLock();
    }
    await wait(retryDelayMs * (attempt + 1));
  }
}

/** Read the JSON manifest without asking THREE to download its dependencies. */
export function gltfDocument(bytes) {
  const view = new DataView(bytes);
  if (bytes.byteLength >= 4 && view.getUint32(0, true) === 0x46546c67) {
    if (bytes.byteLength < 20 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength) throw new AssetLoadError('The model file is incomplete or unsupported.');
    const length = view.getUint32(12, true);
    if (view.getUint32(16, true) !== 0x4e4f534a || length > bytes.byteLength - 20) throw new AssetLoadError('The model manifest is invalid.');
    return JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, length)));
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function gltfDependencies(document, url) {
  return [...new Set([...(document.buffers || []), ...(document.images || [])]
    .map(item => item.uri).filter(uri => uri && !/^(data:|blob:)/i.test(uri))
    .map(uri => new URL(uri, url).href))];
}

function patchMaterials(json) {
  for (const material of json.materials || []) {
    const sg = material.extensions?.KHR_materials_pbrSpecularGlossiness;
    if (sg) material.pbrMetallicRoughness = { baseColorTexture: sg.diffuseTexture, baseColorFactor: sg.diffuseFactor || [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 };
  }
  // Preserve other required extensions: silently dropping one corrupts a map.
  for (const key of ['extensionsUsed', 'extensionsRequired']) if (json[key]) json[key] = json[key].filter(value => value !== 'KHR_materials_pbrSpecularGlossiness');
  return json;
}

async function bounded(promise, timeoutMs, message) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new AssetLoadError(message)), timeoutMs); })]); }
  finally { clearTimeout(timer); }
}

/** Compatible with loader.loadAsync, so existing arena/body loaders can share it. */
export function createAssetLoader({ boot = globalThis.boot || globalThis.__boot, baseURL = globalThis.document?.baseURI, fetchImpl = globalThis.fetch, ...networkOptions } = {}) {
  const resources = new Map(), controller = new AbortController();
  let discovering = 0, active = 0;
  const waiting = [];
  const absolute = url => new URL(url, baseURL).href;
  const labelFor = url => decodeURIComponent(new URL(url).pathname.split('/').pop() || 'Game asset');
  function register(url, label) {
    const key = absolute(url);
    if (!resources.has(key)) resources.set(key, { url: key, label: label || labelFor(key), loaded: 0, total: 0, complete: false });
    else if (label) resources.get(key).label = label;
    return resources.get(key);
  }
  function report(label) {
    const records = [...resources.values()];
    const loaded = records.reduce((sum, item) => sum + item.loaded, 0);
    const known = !discovering && records.every(item => item.total > 0);
    const total = known ? records.reduce((sum, item) => sum + item.total, 0) : 0;
    boot?.progress?.(label, loaded, total, { phase: 'download', completed: records.filter(item => item.complete).length, resources: records.length, indeterminate: !known });
  }
  async function slot(run) {
    if (active >= 4) await new Promise(resolve => waiting.push(resolve));
    active++;
    try { return await run(); }
    finally { active--; waiting.shift()?.(); }
  }
  function download(url, label) {
    const item = register(url, label);
    if (!item.promise) item.promise = slot(async () => {
      try {
        item.blob = await downloadAsset(item.url, {
          ...networkOptions, fetchImpl, signal: controller.signal,
          onProgress: progress => { Object.assign(item, progress); report(item.label); },
          onRetry: ({ attempt }) => boot?.step?.(`Retrying ${item.label.toLowerCase()} (${attempt}/2)…`),
        });
        return item.blob;
      } catch (error) { throw new AssetLoadError(`${item.label}: ${describe(error)}`, { cause: error }); }
    });
    return item.promise;
  }
  async function preload(entries) {
    const list = entries.map(entry => typeof entry === 'string' ? { url: entry } : entry);
    for (const entry of list) register(entry.url, entry.label);
    discovering += list.filter(entry => /\.(gltf|glb)$/i.test(new URL(absolute(entry.url)).pathname)).length;
    try {
      await Promise.all(list.map(async entry => {
        const url = absolute(entry.url), model = /\.(gltf|glb)$/i.test(new URL(url).pathname);
        const blob = await download(url, entry.label);
        if (model) {
          const json = gltfDocument(await blob.arrayBuffer());
          const dependencies = gltfDependencies(json, url);
          for (const dependency of dependencies) register(dependency, entry.label ? `${entry.label} detail` : undefined);
          discovering--; report(entry.label || labelFor(url));
          await Promise.all(dependencies.map(dependency => download(dependency)));
        }
      }));
      boot?.step?.('Preparing your game…');
    } catch (error) { controller.abort(error); throw error; }
  }
  async function loadAsync(url, onProgress) {
    const resolved = absolute(url);
    // Also works without a separate preload call (Coach/Hands use this API).
    if (!resources.get(resolved)?.complete) await preload([url]);
    const bytes = await (await download(resolved)).arrayBuffer();
    const json = gltfDocument(bytes), dependencies = gltfDependencies(json, resolved);
    await Promise.all(dependencies.map(dependency => download(dependency)));
    const [{ LoadingManager }, { GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
      import('three'), import('./three/GLTFLoader.js'), import('./three/libs/meshopt_decoder.module.js'),
    ]);
    const manager = new LoadingManager(), blobs = new Map(), errors = [];
    for (const dependency of dependencies) blobs.set(dependency, URL.createObjectURL(resources.get(dependency).blob));
    manager.setURLModifier(value => blobs.get(absolute(value)) || value);
    manager.onError = value => errors.push(value);
    const loader = new GLTFLoader(manager); loader.setMeshoptDecoder(MeshoptDecoder);
    // GLTFLoader permits a failed image to become a null texture. For these
    // authored maps every referenced texture is required, so retain that error.
    loader.register(parser => {
      const loadImage = parser.loadImageSource.bind(parser);
      parser.loadImageSource = (...args) => loadImage(...args).catch(error => { errors.push(error); throw error; });
      return { name: 'INMOTION_required_textures' };
    });
    try {
      const isBinary = new DataView(bytes).getUint32(0, true) === 0x46546c67;
      const result = await bounded(loader.parseAsync(isBinary ? bytes : patchMaterials(json), new URL('.', resolved).href), 90000, 'Preparing the model took too long. Please try again.');
      if (errors.length) throw new AssetLoadError('A required image could not be decoded. Please try loading the map again.');
      if (!result.scene) throw new AssetLoadError('The model contains no scene.');
      onProgress?.({ loaded: bytes.byteLength, total: bytes.byteLength, lengthComputable: true });
      return result;
    } catch (error) { throw new AssetLoadError(`${resources.get(resolved).label}: ${describe(error)}`, { cause: error }); }
    finally { for (const value of blobs.values()) URL.revokeObjectURL(value); }
  }
  async function loadJSON(url) { return (await download(url)).text().then(JSON.parse); }
  async function loadImage(url, image = new Image()) {
    const objectURL = URL.createObjectURL(await download(url));
    try {
      image.src = objectURL;
      await bounded(image.decode(), 30000, 'An image could not be prepared. Please try again.');
      return image;
    } finally { URL.revokeObjectURL(objectURL); }
  }
  async function loadTexture(url) {
    const { Texture } = await import('three');
    const texture = new Texture(await loadImage(url)); texture.needsUpdate = true;
    return texture;
  }
  return { preload, loadAsync, loadJSON, loadImage, loadTexture, abort: () => controller.abort() };
}

/** Keep the cover up through GPU preparation and the first actual scene frame. */
export async function prepareScene(renderer, scene, camera, draw = () => renderer.render(scene, camera)) {
  if (renderer.compileAsync) await bounded(renderer.compileAsync(scene, camera), 60000, 'Graphics preparation took too long. Please try again.');
  else renderer.compile(scene, camera);
  draw();
  await new Promise(resolve => requestAnimationFrame(resolve));
  if (renderer.getContext().isContextLost()) throw new AssetLoadError('The graphics connection was lost. Please reload the game.');
}
