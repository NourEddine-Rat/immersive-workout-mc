// The track: a repeating corridor tile from the Sketchfab model, trains and
// barriers cloned from the same model, coins from a second, tiny model.
//
// Model space (as exported): the track runs along -x, lanes sit across z at
// 10.5 / 12.7 / 14.9, ground is at y ≈ 1.3. The whole model lives inside
// `track`, a group rotated so that -x becomes -z (ahead of the camera) and
// shifted so the centre lane is x = 0 and the ground is y = 0.
//
// Model: "Sub Way Surf Assets" by Giovanni Messina, CC-BY-4.0
// https://sketchfab.com/3d-models/sub-way-surf-assets-e435b57e2d7f459182b4af0fc3e38540

import * as THREE from 'three';
import { GLTFLoader } from '../../engine/three/GLTFLoader.js';
import { LANE_X, LANE_Z, GROUND_Y, TILE_PITCH, HIT } from './lanes.js';
import { rowGapUnits } from './pacing.js';
import { LAMP, restyle, onHour } from './theme.js';

export { LANE_X, LANE_Z, GROUND_Y, TILE_PITCH, HIT };
const MODEL = './models/environment/';

// Obstacle kinds, and what answers them:
//   train  a closed car: dodge (the game's job), or die
//   ramp   an open cargo car with a ramp at the front: dodge, or run up it and ride the roof
//   block  the low striped block: jump
//   bar    the striped bar on legs: jump over it, or slide under it
//   high   the tall signal on legs: slide
const PIECES = {
  tile: 'StaticMeshActor_236_Material_6_0',
  trains: ['StaticMeshActor_265_Material_7_0', 'StaticMeshActor_253_Material_5_0',
    'StaticMeshActor_274_Material_7_0', 'bp_MovingTrain_Child_Child_Child_C_5_Material_7_0', 'bp_Obstacles_Child2_C_4_Material_5_0'],
  ramp: 'StaticMeshActor_270_Material_7_0',      // the ramp is at the +x end: the end that faces the runner
  rampCars: ['StaticMeshActor_265_Material_7_0'], // closed cars that may follow a ramp car (same roof height)
  block: ['StaticMeshActor_239_Material_6_0'],
  bar: ['StaticMeshActor_245_Material_6_0'],
  high: ['StaticMeshActor_242_Material_6_0'],
};
const COIN_SLOTS = 400;
// The flame token is a metre wide and stands where a coin would: inside this
// much of it, in the same lane, the two draw through each other and both
// look broken. So a coin is never laid there, and a spot with coins in it is
// never chosen for the flame.
const FIRE_CLEAR = 2.6;
export const RAMP_LEN = 1.8;                        // metres of ramp before the roof is level
// The moving train, one more Sketchfab model: it faces +z in its file; in
// track space the runner looks down -x, so an oncoming train faces +x. 1.3 k
// triangles: cheap enough for a TV.
//   "LowPoly 3D Train" by Ajaya Tamang Moktan, CC-BY-4.0 — the long orange one
const MOVERS = {
  long: { url: './models/train/passenger-train.gltf', height: 3.0 },
};
// The coin, baked light by models/subway_surfers_coin/bake_lite.py: 80
// triangles, already in game space, and a 128² cut of its atlas (15 KB).
//   "Subway Surfers Coin" by nirvaraj, CC-BY-4.0
const COIN = { url: './models/coin/coin.gltf' };
// The flame token — a calorie milestone, put on the track for the runner to
// take (see game.js). Baked light the same way: models/subway_surfers-fire/bake_lite.py.
const FIRE = { url: './models/fire/energy-token.gltf' };
/** What each kind asks of the player. */
export const ANSWERS = { block: ['jump'], bar: ['jump', 'roll'], high: ['roll'], train: [], ramp: ['ride'] };

/**
 * Move the diffuse textures of the KHR_materials_pbrSpecularGlossiness
 * extension (dropped from modern loaders) into the core material.
 */
export async function loadGltfPatched(url, onProgress = null) {
  const json = await (await fetch(url)).json();
  for (const m of json.materials || []) {
    const sg = m.extensions?.KHR_materials_pbrSpecularGlossiness;
    if (sg) m.pbrMetallicRoughness = { baseColorTexture: sg.diffuseTexture, baseColorFactor: sg.diffuseFactor || [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 };
  }
  json.extensionsUsed = (json.extensionsUsed || []).filter(e => e !== 'KHR_materials_pbrSpecularGlossiness');
  json.extensionsRequired = [];
  const path = url.slice(0, url.lastIndexOf('/') + 1);
  // The buffers and textures are fetched here, by hand, so their download can
  // be shown — on a slow TV that is the difference between "loading" and
  // "broken". The loader is then pointed at the bytes already in memory.
  const manager = new THREE.LoadingManager();
  const files = [...(json.buffers || []), ...(json.images || [])].map(x => x.uri).filter(u => u && !/^(data:|blob:|https?:)/.test(u));
  const blobs = await fetchAll(files.map(u => path + u), onProgress);
  manager.setURLModifier(u => blobs[u] || u);
  const loader = new GLTFLoader(manager);
  return new Promise((res, rej) => loader.parse(JSON.stringify(json), path, res, rej));
}

/** Download files with progress; returns { url: blobUrl }. Falls back to plain fetch where streams are missing. */
async function fetchAll(urls, onProgress) {
  const out = {};
  let done = 0, total = 0;
  const sizes = new Map();
  const report = () => { if (onProgress) onProgress(done, total || done, urls.length); };
  await Promise.all(urls.map(async u => {
    const res = await fetch(u, { cache: 'default' });
    if (!res.ok) throw new Error(`${u}: ${res.status}`);
    const len = Number(res.headers.get('content-length')) || 0;
    if (len) { sizes.set(u, len); total = [...sizes.values()].reduce((a, b) => a + b, 0); }
    let blob;
    if (res.body && res.body.getReader) {
      const reader = res.body.getReader(); const chunks = [];
      for (;;) { const { done: end, value } = await reader.read(); if (end) break; chunks.push(value); done += value.length; report(); }
      blob = new Blob(chunks, { type: res.headers.get('content-type') || '' });
    } else { blob = await res.blob(); done += blob.size; report(); }
    const U = (window.URL && window.URL.createObjectURL) ? window.URL : window.webkitURL;   // a polyfilled URL has no createObjectURL; the old native one is webkitURL
    out[u] = U.createObjectURL(blob);
  }));
  report();
  return out;
}

/**
 * Bake an external model into one geometry in track space: scaled to a
 * height or width, centred on x and z, floor at the rail bed, front turned
 * from the file's +z to the track's +x.
 */
async function bakeExternal(spec, onProgress = null) {
  const gltf = await loadGltfPatched(spec.url, onProgress);
  const geoms = [];
  let map = null;
  gltf.scene.updateWorldMatrix(true, true);
  gltf.scene.traverse(o => { if (o.isMesh) { geoms.push(o.geometry.clone().applyMatrix4(o.matrixWorld)); if (o.material.map) map = o.material.map; } });
  const geom = index16(geoms.length === 1 ? geoms[0] : mergeGeometries(geoms));
  geom.computeBoundingBox();
  const size = geom.boundingBox.getSize(new THREE.Vector3());
  const k = spec.height ? spec.height / size.y : spec.width / size.x;
  geom.scale(k, k, k);
  geom.rotateY(Math.PI / 2);                        // file +z (the front) -> track +x
  geom.computeBoundingBox();
  const b = geom.boundingBox;
  geom.translate(-(b.min.x + b.max.x) / 2, GROUND_Y - b.min.y, -(b.min.z + b.max.z) / 2);
  geom.computeBoundingBox();
  if (map) map.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshLambertMaterial({ map: restyle(map, SHRINK_TO, 'train'), color: 0xffffff });   // bakeExternal is the moving train's road
  return { geom, mat, size: geom.boundingBox.getSize(new THREE.Vector3()), box: geom.boundingBox.clone() };
}

/** Merge geometries that share an attribute layout (positions, normals, uvs). */
function mergeGeometries(list) {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'color']) {
    const parts = list.map(g => g.attributes[name]).filter(Boolean);
    if (parts.length !== list.length) continue;
    const item = parts[0].itemSize, n = parts.reduce((a, p) => a + p.count, 0);
    const arr = new Float32Array(n * item); let off = 0;
    for (const p of parts) { arr.set(p.array.subarray(0, p.count * item), off); off += p.count * item; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, item));
  }
  const idx = []; let base = 0;
  for (const g of list) { const ix = g.index; const cnt = g.attributes.position.count; if (ix) for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + base); else for (let i = 0; i < cnt; i++) idx.push(i + base); base += cnt; }
  out.setIndex(idx);
  return out;
}

/**
 * 16-bit indices where they fit. The models are exported with 32-bit
 * indices whatever their size; WebGL 1 without OES_element_index_uint (an
 * old TV) then draws nothing at all. Every mesh here has under 65k vertices.
 */
export function index16(geom) {
  const ix = geom.index;
  if (ix && ix.array instanceof Uint32Array && geom.attributes.position.count <= 65535) geom.setIndex(new THREE.Uint16BufferAttribute(Uint16Array.from(ix.array), 1));
  return geom;
}

/**
 * Bake a mesh into model-world space and centre it on x (and on z unless
 * `keepZ`: the corridor tile keeps its lanes where the model put them).
 * Model y is kept — the ground offset lives on the track group.
 */
let SHRINK_TO = 0;   // set by a lite World: textures are resampled down to this many pixels

function bake(mesh, keepZ = false, mode = 'place') {
  mesh.updateWorldMatrix(true, false);
  const geom = index16(mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
  geom.computeBoundingBox();
  const b = geom.boundingBox;
  const cx = (b.min.x + b.max.x) / 2, cz = keepZ ? 0 : (b.min.z + b.max.z) / 2;
  geom.translate(-cx, 0, -cz);
  geom.computeBoundingBox();
  const mat = mesh.material.clone();
  // The textures are painted with their lighting; keep shading soft so it reads like the game.
  if (mat.map) { mat.map.colorSpace = THREE.SRGBColorSpace; }
  const m = new THREE.MeshLambertMaterial({ map: restyle(mat.map, SHRINK_TO, mode), color: 0xffffff });
  return { geom, mat: m, size: geom.boundingBox.getSize(new THREE.Vector3()), box: geom.boundingBox.clone() };
}

export class World {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.lite = !!opts.lite;   // a weak screen: fewer tiles, small textures, near things only
    this.track = new THREE.Group();
    this.track.rotation.y = -Math.PI / 2;
    this.track.position.set(LANE_Z[1], -GROUND_Y, 0);
    scene.add(this.track);
    this.tiles = [];
    this.obstacles = [];   // { kind, lane, z0, z1, mesh(es) }
    this.coins = [];
    this.pools = { coin: [] };
    this.spawnedTo = 0;    // distance (world units ahead) generated so far
    // Coins go where the runner will be. Lanes are the game's own (see
    // autopilot.js), so a coin in another lane is never taken: it is clutter,
    // and it reads as things the game keeps missing. So every row is laid
    // with a guess at the lane the runner will be in when they reach it —
    // the autopilot's own rule, applied to the row — and its coins go there.
    // Not every row has coins, and how many varies: a run of them is a treat.
    this.rows = [];        // rows laid, oldest first: { d, len, gap, kinds[3], lane, tie, roll, n, coins[] }
    this.pilotLane = 1;    // the lane the runner is expected in after the last row laid
    this.pilotStart = 1;   // ...and before the first row still in `rows`
    this.flavour = 'body'; // 'pocket': lanes are automatic, rows ask for jumps and slides
    this.movers = [];      // trains on the move: obstacles with a velocity
    this.reservations = []; // { lane, from, to } distances kept empty for a train that is on its way
    this.smashing = [];     // barriers a moving train has just hit: { mesh, t, spin }
    this.rng = mulberry32(Date.now() & 0xffff);
    // Behind the corridor walls: the arches in them open onto the sky, which
    // reads as holes when you look back. Two long, cheap planes of hillside
    // outside the walls close them; game code keeps them under the camera.
    this.backdrop = new THREE.Group();
    // the wall's own far side, repainted whenever the hour turns: lit at the
    // top of the arch, falling to near-black below
    const geo = new THREE.PlaneGeometry(700, 14);
    const pos = geo.attributes.position;
    geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(pos.count * 3), 3));
    const col = geo.attributes.color, c = new THREE.Color();
    onHour(p => {
      for (let i = 0; i < pos.count; i++) { const k = (pos.getY(i) + 7) / 14; c.copy(p.backdrop.bottom).lerp(p.backdrop.top, k * k); col.setXYZ(i, c.r, c.g, c.b); }
      col.needsUpdate = true;
    });
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(geo, mat);   // from below the bank to the top of the arches: the sky above the walls stays sky
      p.position.set(side * 14, 0.5, 0);
      p.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      this.backdrop.add(p);
    }
    scene.add(this.backdrop);
  }

  async load(onProgress = null) {
    SHRINK_TO = this.lite ? 512 : 0;
    const gltf = await loadGltfPatched(MODEL + 'subway-environment.gltf', onProgress ? (d, t) => onProgress('the track', d, t) : null);
    const get = n => gltf.scene.getObjectByName(n);
    this.tpl = {
      tile: bake(get(PIECES.tile), true),
      trains: PIECES.trains.map(n => bake(get(n), false, 'train')),
      ramp: bake(get(PIECES.ramp), false, 'train'),
      rampCars: PIECES.rampCars.map(n => bake(get(n), false, 'train')),
      block: PIECES.block.map(n => bake(get(n))),
      bar: PIECES.bar.map(n => bake(get(n))),
      high: PIECES.high.map(n => bake(get(n))),
    };
    // 'low' stays as an alias for callers that only know jump-over barriers
    this.tpl.low = [...this.tpl.block, ...this.tpl.bar];
    this.tpl.movers = { long: await bakeExternal(MOVERS.long, onProgress ? (d, t) => onProgress('the trains', d, t) : null) };
    // Tile: origin at the rail start so tiles butt together along -x.
    const t = this.tpl.tile;
    t.geom.translate(-t.box.max.x + 1.9, 0, 0);
    t.geom.computeBoundingBox();
    // coin: the model, or — a file missing, a fetch refused — a plain gold disc
    let cg = null, cmap = null;
    try {
      const coin = await loadGltfPatched(COIN.url, onProgress ? (d, t) => onProgress('the coins', d, t) : null);
      coin.scene.traverse(o => { if (o.isMesh && !cg) { cg = index16(o.geometry); cmap = o.material.map || null; } });
    } catch (e) { console.warn('coin model: ' + (e && e.message || e)); }
    if (!cg) { cg = new THREE.CylinderGeometry(0.42, 0.42, 0.1, this.lite ? 10 : 24); cg.rotateX(Math.PI / 2); }
    if (cmap) { cmap.colorSpace = THREE.SRGBColorSpace; cmap.anisotropy = 1; }
    // The texture is painted lit; it also glows a little of itself, so the
    // side turned from the light is still a gold coin and not a dark disc.
    const look = cmap ? { map: cmap, color: 0xffffff, emissive: 0x6a4a14, emissiveMap: cmap } : { color: 0xffc41f, emissive: this.lite ? 0x8a5a00 : 0xa86d00 };
    this.tpl.coin = { geom: cg, mat: this.lite ? new THREE.MeshLambertMaterial(look) : new THREE.MeshStandardMaterial({ ...look, emissiveIntensity: cmap ? 1 : 0.55, metalness: cmap ? 0.15 : 0.5, roughness: cmap ? 0.6 : 0.35 }) };
    // All coins are ONE draw call: an instanced mesh with a slot per coin.
    // A coin that is taken, recycled or out of range is scaled to nothing.
    this.coinMesh = new THREE.InstancedMesh(cg, this.tpl.coin.mat, COIN_SLOTS);
    this.coinMesh.frustumCulled = false;
    this.coinMesh.count = 0;
    this.track.add(this.coinMesh);
    this.coinFree = []; for (let i = COIN_SLOTS - 1; i >= 0; i--) this.coinFree.push(i);
    this._m4 = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._s1 = new THREE.Vector3(1, 1, 1); this._s0 = new THREE.Vector3(0, 0, 0);
    // The flame token: the model, or a plain flame-coloured drop. It is LIT,
    // not unlit — the token is 2.7 cm of solid, and only shading tells you
    // so: unlit, its side wall came up as one flat slab of colour the moment
    // it turned, and the whole thing read as cardboard. The emissive keeps it
    // a pickup: bright in any light, but with a shaded edge.
    let fg = null, fmap = null;
    try {
      const fire = await loadGltfPatched(FIRE.url, onProgress ? (d, t) => onProgress('the fire', d, t) : null);
      fire.scene.traverse(o => { if (o.isMesh && !fg) { fg = index16(o.geometry); fmap = o.material.map || null; } });
    } catch (e) { console.warn('fire model: ' + (e && e.message || e)); }
    if (!fg) { fg = new THREE.ConeGeometry(0.5, 1.6, 8); }
    if (fmap) { fmap.colorSpace = THREE.SRGBColorSpace; fmap.anisotropy = 1; }
    this.tpl.fire = { geom: fg, mat: new THREE.MeshLambertMaterial({ map: fmap, color: fmap ? 0xffffff : 0xff7a1a, emissive: 0xffffff, emissiveMap: fmap || null, emissiveIntensity: fmap ? 0.62 : 0.5, transparent: true, fog: false }) };
    // ...and its glow: one soft disc behind it, added to whatever is there
    this.tpl.glow = { geom: new THREE.PlaneGeometry(3.2, 3.2), mat: new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: 0xff9a2a, fog: false }) };
    this.fire = null;
    this.tpl.lamps = this._lamps();
    onHour(p => { this.tpl.lamps.mat.color.copy(p.lamp.color); this.tpl.lamps.mat.opacity = p.lamp.strength; });   // they dim to nothing in daylight
    for (let i = 0; i < (this.lite ? 6 : 9); i++) this._addTile(i);
  }

  _addTile(i) {
    const m = new THREE.Mesh(this.tpl.tile.geom, this.tpl.tile.mat);
    m.position.x = -i * TILE_PITCH;
    m.userData.index = i;
    if (this.tpl.lamps) m.add(new THREE.Mesh(this.tpl.lamps.geom, this.tpl.lamps.mat));   // rides with the tile, so it recycles with it
    this.track.add(m);
    this.tiles.push(m);
  }

  /**
   * The lamps: a row of warm glows down each wall. Every lamp on a tile is
   * one geometry and one material, so a tile still costs the draw call it
   * always did plus exactly one — a TV does not notice, and the corridor
   * stops being a flat blue trench.
   */
  _lamps() {
    const L = LAMP, quads = [];
    const bb = this.tpl.tile.geom.boundingBox;      // the tile's box AFTER it was shifted to butt against its neighbour
    const from = bb.min.x, to = bb.max.x;
    // one material for the lot, so how bright a quad is has to be carried in
    // the mesh: the glow on the wall is full strength, the pool it throws on
    // the ballast is a quarter of it
    const tint = (g, v) => {
      const n = g.attributes.position.count, a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { a[i * 3] = v; a[i * 3 + 1] = v; a[i * 3 + 2] = v; }
      g.setAttribute('color', new THREE.Float32BufferAttribute(a, 3));
      return g;
    };
    for (const side of [-1, 1]) {
      const z = LANE_Z[1] + side * L.out;
      for (let x = to - L.pitch * 0.5; x > from; x -= L.pitch) {
        const lamp = new THREE.PlaneGeometry(L.size, L.size);
        lamp.rotateY(Math.PI / 2);                    // the runner looks down -x: a lamp faces them
        lamp.translate(x, GROUND_Y + L.height, z);
        quads.push(tint(lamp, 1));
        const pool = new THREE.PlaneGeometry(L.size * 2.1, L.size * 1.5);
        pool.rotateX(-Math.PI / 2);                   // ...and lies its light on the ballast below
        pool.translate(x, GROUND_Y + 0.04, z - side * L.size * 0.5);
        quads.push(tint(pool, 0.26));
      }
    }
    return {
      geom: mergeGeometries(quads),
      mat: new THREE.MeshBasicMaterial({ map: glowTexture(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
    };
  }

  /** Put the corridor back at the start (a new run begins at distance 0). */
  resetTiles() {
    this.tiles.forEach((t, i) => { t.userData.index = i; t.position.x = -i * TILE_PITCH; });
  }

  /** Keep tiles ahead of the camera and recycle the ones behind. */
  updateTiles(distance) {
    const need = Math.floor(distance / TILE_PITCH);
    for (const t of this.tiles) {
      if (t.userData.index < need - 2) {   // two tiles stay behind you: the look back must not see the world end
        t.userData.index += this.tiles.length;
        t.position.x = -t.userData.index * TILE_PITCH;
      }
    }
  }

  // ------------------------------------------------------------ obstacles

  /**
   * Generate rows until `ahead` world units in front of `distance`.
   * The gap after each row is a number of SECONDS at the speed the player is
   * doing — see pacing.js. A gap in metres shrinks into nothing as the game
   * speeds up, which is what made the fast levels unanswerable.
   */
  spawn(distance, ahead, difficulty, speed, lane = null) {
    if (lane != null) this._resync(distance, speed || 12, lane);
    if (this.spawnedTo < distance + 60) this.spawnedTo = distance + 60;   // first rows start well ahead
    while (this.spawnedTo < distance + ahead) {
      const before = this.lastFree;
      const row = this._spawnRow(this.spawnedTo, difficulty);
      const kinds = this.lastKinds || [];
      // If this row's free lanes share nothing with the previous row's, the
      // player has to cross the whole track: give them the room to do it.
      const crossed = !!(before && ![...this.lastFree].some(l => before.has(l)));
      row.gap = rowGapUnits(speed || 12, difficulty, kinds, crossed, this.rng());
      this._layCoins(row);   // after the gap is known: a line of coins must end before the next row
      this.spawnedTo += row.len + row.gap;
    }
    while (this.rows.length && this.rows[0].d + this.rows[0].len < distance - 20) this.pilotStart = this.rows.shift().lane;   // passed: its lane is where the next guess starts
  }

  // ------------------------------------------------------------- the fire

  /**
   * A spot for the flame token in `lane` at or after `d`: not inside
   * anything standing there. Null if the next 30 m of the lane are full.
   */
  fireSpot(lane, d) {
    for (let i = 0; i < 6; i++, d += 6) {
      const z = -d;
      if (this.obstacles.some(o => o.lane === lane && z < o.z1 + 2.5 && z > o.z0 - 2.5)) continue;
      if (this.coins.some(c => !c.taken && c.lane === lane && Math.abs(c.z - z) < FIRE_CLEAR)) continue;   // a coin inside the flame: both read as a mess
      return d;
    }
    return null;
  }

  /** Put the flame token in `lane`, `d` ahead, `y` above the ground; `tag` is whatever the caller wants back when it is taken. */
  spawnFire(lane, d, y = 1.4, tag = null) {
    this.dropFire();
    for (const c of this.coins) if (!c.taken && c.lane === lane && Math.abs(c.z + d) < FIRE_CLEAR) { c.taken = true; this._place(c, 0); }   // one put here by hand (a test page): the coins in the way step aside
    const g = new THREE.Group();
    const glow = new THREE.Mesh(this.tpl.glow.geom, this.tpl.glow.mat);
    glow.rotation.y = Math.PI / 2;           // a plane faces +z; the runner looks along track -x, so turn it to face +x
    glow.position.x = 0.3;                   // just behind the token
    const m = new THREE.Mesh(this.tpl.fire.geom, this.tpl.fire.mat);
    m.material.opacity = 1;
    g.add(glow); g.add(m);
    g.position.set(-d, GROUND_Y + y, LANE_Z[lane]);
    this.track.add(g);
    this.fire = { lane, z: -d, y, group: g, mesh: m, glow, burst: -1, tag };
  }
  dropFire() { if (this.fire) { this.track.remove(this.fire.group); this.fire = null; } }

  /**
   * Bob and turn the token; a taken one bursts — grows and fades in half a
   * second. Returns 'taken' the frame the runner passes through it, 'missed'
   * the frame it goes by untouched, else null.
   */
  updateFire(t, dt, distance, lane) {
    const f = this.fire;
    if (!f) return null;
    const zNow = -distance;
    if (f.burst >= 0) {
      f.burst += dt;
      // Taken, it is drawn IN, not blown up: at the moment it is claimed the
      // token is on top of the camera, and a token that grows from there is
      // a screenful of flat orange. So it shrinks and lifts away while the
      // glow opens out behind it — the flame going where the counter is.
      const p = Math.min(1, f.burst / 0.45), k = 1 - 0.85 * p * p;
      f.mesh.scale.set(k, k, k); f.mesh.material.opacity = 1 - p * p;
      f.mesh.rotation.y = spin((t + p * 1.2) * 2.0);             // the flip carries on, quicker
      f.mesh.rotation.z = 0.05 * Math.sin(t * 1.15) + p * 0.5;
      f.glow.scale.set(1 + 3 * p, 1 + 3 * p, 1); f.glow.material.opacity = 0.85 * (1 - p);
      f.group.position.y += dt * 2.2;
      if (p >= 1) this.dropFire();
      return null;
    }
    // It turns right round, but not evenly: the angle is eased so it dwells
    // on its face and whips through end-on, where a flat token is a line.
    // Same full flip, half as long spent on the edge.
    f.mesh.rotation.y = spin(t * 2.0);
    f.mesh.rotation.z = 0.05 * Math.sin(t * 1.15);
    f.group.position.y = GROUND_Y + f.y + 0.12 * Math.sin(t * 3);
    const pulse = 1 + 0.08 * Math.sin(t * 5);
    f.glow.scale.set(pulse, pulse, 1); f.glow.material.opacity = 0.5 + 0.2 * Math.sin(t * 5);
    if (f.lane === lane && Math.abs(f.z - zNow) < 1.0) { f.burst = 0; return 'taken'; }
    if (f.z > zNow + 3) { this.dropFire(); return 'missed'; }
    return null;
  }

  /** Take every obstacle and coin off the track: a new run, or a test cleared. */
  clear() {
    this.dropFire();
    this.obstacles.forEach(o => this.track.remove(o.mesh)); this.obstacles = []; this.movers = []; this.reservations = [];
    this.smashing.forEach(s => this.track.remove(s.mesh)); this.smashing = [];
    this.coins.forEach(c => this._dropCoin(c)); this.coins = []; this.coinMesh.instanceMatrix.needsUpdate = true;
    this.rows = []; this.pilotLane = this.pilotStart = 1; this.lastFree = null; this.lastKinds = null;
    this.spawnedTo = 0;
  }

  /**
   * The lane the autopilot will take through a row of `kinds` (per lane:
   * null, or the obstacle kind) from `lane` — chooseLane's rule, applied to
   * the row as a whole: a train is dodged to the nearest lane without one,
   * an empty lane beats one with a barrier, a lane next door beats one two
   * over. Two lanes as good as each other: the row's `tie` says which, and
   * the coins laid there tip the real thing the same way — but with no coins
   * to follow the autopilot goes left, so `tie` only counts when the lane
   * gets some (`coinsIn(kind)`).
   */
  _pilotLane(lane, kinds, tie, coinsIn) {
    const isTrain = k => k === 'train' || k === 'ramp';
    if (!isTrain(kinds[lane])) return lane;
    const options = [];
    for (const dir of [-1, 1]) {
      const l1 = lane + dir, l2 = lane + 2 * dir;
      if (l1 >= 0 && l1 <= 2 && !isTrain(kinds[l1])) options.push({ to: l1, s: (kinds[l1] ? -1 : 0) + 1 });
      else if (l2 >= 0 && l2 <= 2 && !isTrain(kinds[l2])) options.push({ to: l2, s: kinds[l2] ? -1 : 0 });
    }
    if (!options.length) return lane;   // boxed in: a ramp is ridden, a train is the end — the lane stays
    if (options.length === 2 && options[0].s === options[1].s) return options[coinsIn(kinds[options[0].to]) && tie > 0 ? 1 : 0].to;
    return options[0].s >= (options[1] ? options[1].s : -Infinity) ? options[0].to : options[1].to;
  }

  /**
   * How many coins a row gets in a lane of `kind`, from the row's own dice
   * (thrown once, so laying it again gives the same answer). A row with
   * nothing in it is a breather: nearly always a run of coins, and a long
   * one. Beside a hazard: about half the time, a few. Over a low barrier:
   * an arc, half the time. Under a signal: a few low ones, now and then.
   */
  _coinCount(row, kind) {
    const empty = row.kinds.every(k => !k);
    if (!kind) return empty ? (row.roll < 0.9 ? 6 + Math.floor(row.n * 5) : 0) : (row.roll < 0.5 ? 3 + Math.floor(row.n * 4) : 0);
    if (kind === 'block' || kind === 'bar') return row.roll < 0.5 ? 5 : 0;
    if (kind === 'high') return row.roll < 0.35 ? 3 : 0;
    return 0;                                         // a train lane: the runner is not in it (roof coins are the ramp's own)
  }

  /** Lay a row's coins in its lane — again, if it had some already (the lane changed). */
  _layCoins(row) {
    for (const c of row.coins) c.taken = true;        // recycle gives the slots back
    row.coins = [];
    const kind = row.kinds[row.lane], n = this._coinCount(row, kind), d = row.d;
    const put = (at, y) => { const c = this._coin(row.lane, at, y); if (c) row.coins.push(c); };
    if (!n) return;
    if (!kind) {
      // a line, from just past the row's start to before the next row
      const from = row.kinds.every(k => !k) ? 1 : 4;
      const fit = Math.max(0, Math.floor((row.len + row.gap - from - 3) / 2.2) + 1);
      for (let i = 0; i < Math.min(n, fit); i++) put(d + from + i * 2.2, 1.0);
    } else if (kind === 'high') {
      for (let i = -1; i <= 1; i++) put(d + i * 2.0, 0.75);
    } else {
      for (let i = -2; i <= 2; i++) put(d + i * 2.0, 1.0 + 1.4 * Math.cos(i * 0.55));
    }
  }

  /**
   * The runner is in `lane`: is that where the rows expected them? A ramp
   * ridden instead of dodged, a hop to the roof next door, a moving train
   * dodged between rows — the guess goes wrong now and then. When it does,
   * the rows still ahead (the ones the autopilot has not committed to: a
   * dodge is made 1.5 s out, so a row 1.2 s out has had its dodge) are
   * re-guessed from where the runner really is, and their coins moved to
   * the lane they will actually run in.
   */
  _resync(distance, speed, lane) {
    const committed = distance + speed * 1.2;
    let i = 0, expected = this.pilotStart;
    for (; i < this.rows.length && this.rows[i].d < committed; i++) expected = this.rows[i].lane;
    if (expected === lane) return;
    if (i > 0) this.rows[i - 1].lane = lane; else this.pilotStart = lane;   // where they are is now the fact
    let cur = lane;
    for (; i < this.rows.length; i++) {
      const r = this.rows[i], was = r.lane;
      r.lane = this._pilotLane(cur, r.kinds, r.tie, k => this._coinCount(r, k) > 0);
      if (r.lane !== was) this._layCoins(r);
      cur = r.lane;
    }
    this.pilotLane = cur;
  }

  /** Coins ahead per lane, within `window` metres: the autopilot's tie-breaker, so a dodge goes the way the coins were laid. */
  coinsAhead(distance, window) {
    const zNow = -distance, out = [0, 0, 0];
    for (const c of this.coins) if (!c.taken && c.z <= zNow && c.z >= zNow - window) out[c.lane]++;
    return out;
  }

  _spawnRow(d, difficulty) {
    const r = this.rng();
    const lanes = [0, 1, 2];
    let maxLen = 0;
    const used = new Set();
    const kinds = [];
    const laneKind = [null, null, null];   // what stands in each lane of this row
    this.lastKinds = kinds;

    const placeTrain = (lane, ramp = false, cars = 1 + Math.floor(this.rng() * (2 + difficulty * 2)), roofCoins = ramp) => {
      const total = this.spawnTrain(lane, d, ramp, cars, roofCoins);
      kinds.push(ramp ? 'ramp' : 'train');
      laneKind[lane] = ramp ? 'ramp' : 'train';
      used.add(lane);
      maxLen = Math.max(maxLen, total);
      return cars;
    };
    const rampChance = 0.35;   // this many trains carry a ramp
    // Two trains: side by side like a real yard, one lane left. When the
    // first has a ramp, its neighbour is longer, so the roof you rode up to
    // carries on next door — the game hops you across when yours ends.
    const placePair = () => {
      const a = lanes[0];
      const adjacent = lanes.filter(l => Math.abs(l - a) === 1);
      const b = this.rng() < 0.7 && adjacent.length ? adjacent[Math.floor(this.rng() * adjacent.length)] : lanes.find(l => l !== a);
      const ramp = this.rng() < rampChance;
      const cars = placeTrain(a, ramp);
      if (ramp) placeTrain(b, false, cars + 1 + Math.floor(this.rng() * 2), true);
      else placeTrain(b, this.rng() < rampChance);
    };
    const placeBarrier = (lane, kind) => {
      if (kind === 'low') kind = this.rng() < 0.5 ? 'block' : 'bar';
      const list = this.tpl[kind];
      const tpl = list[Math.floor(this.rng() * list.length)];
      const m = new THREE.Mesh(tpl.geom, tpl.mat);
      m.position.set(-d - tpl.size.x / 2, 0, LANE_Z[lane]);
      this.track.add(m);
      this.obstacles.push({ kind, lane, z0: -d - tpl.size.x - 0.1, z1: -d + 0.1, mesh: m });
      kinds.push(kind);
      laneKind[lane] = kind;
      used.add(lane);
      maxLen = Math.max(maxLen, tpl.size.x);
    };

    // a lane a moving train will pass through is a train lane already: nothing is placed in it, and it is not free
    const busy = this.busyLanes(d);
    for (const l of busy) { used.add(l); kinds.push('train'); laneKind[l] = 'train'; }
    const open = lanes.filter(l => !busy.includes(l));
    shuffle(open, this.rng);
    lanes.length = 0; lanes.push(...open);
    if (this.flavour === 'pocket') {
      // Lanes are the game's own here, so a row is only fun if it asks for a
      // jump or a slide: trains block, barriers fill what is left.
      const pick = () => { const q = this.rng(); return q < 0.4 ? 'block' : q < 0.7 ? 'bar' : 'high'; };
      if (r < 0.3 && lanes.length >= 2) {
        if (lanes.length >= 3 && this.rng() < 0.3 + difficulty * 0.4) placePair();
        else placeTrain(lanes[0], this.rng() < rampChance);
        const kind = pick();
        for (const l of lanes) if (!used.has(l) && this.rng() < 0.75) placeBarrier(l, kind);
      } else if (r < 0.82) {
        const mixed = this.rng() < 0.4;                     // one kind per row reads better; sometimes mixed
        const kind = pick();
        for (const l of lanes) placeBarrier(l, mixed ? pick() : kind);
      } else {
        // coin run, breathe
      }
    } else if (r < 0.35 && lanes.length >= 2) {
      // trains in one or two lanes
      placeTrain(lanes[0]);
      if (lanes.length >= 3 && this.rng() < 0.35 + difficulty * 0.4) placeTrain(lanes[1]);
    } else if (r < 0.7) {
      // barriers, sometimes with a train beside them
      placeBarrier(lanes[0], this.rng() < 0.55 ? 'low' : 'high');
      if (this.rng() < 0.4 + difficulty * 0.4) placeBarrier(lanes[1], this.rng() < 0.5 ? 'low' : 'high');
      if (this.rng() < difficulty * 0.5) placeTrain(lanes[2]);
    } else if (r < 0.85) {
      // full row of barriers: every lane needs an action
      for (const l of lanes) placeBarrier(l, this.rng() < 0.55 ? 'low' : 'high');
    } else {
      // coin run, no hazards
    }

    // lanes without a train are the ones you can survive in
    this.lastFree = new Set([0, 1, 2].filter(l => !busy.includes(l) && !this.obstacles.slice(-3).some(o => (o.kind === 'train' || o.kind === 'ramp') && o.lane === l && o.z1 >= -d - 0.1)));

    // the row, and the lane the runner will take through it: its coins go there once the gap after it is known
    const row = { d, len: maxLen, gap: 0, kinds: laneKind, lane: this.pilotLane, tie: this.rng() < 0.5 ? -1 : 1, roll: this.rng(), n: this.rng(), coins: [] };
    row.lane = this._pilotLane(this.pilotLane, laneKind, row.tie, k => this._coinCount(row, k) > 0);
    this.pilotLane = row.lane;
    this.rows.push(row);
    return row;
  }

  _coin(lane, d, y) {
    const f = this.fire;
    if (f && f.burst < 0 && f.lane === lane && Math.abs(f.z + d) < FIRE_CLEAR) return null;   // the flame is standing here (rows are re-laid as the runner moves)
    const slot = this.coinFree.pop();
    if (slot == null) return null;                  // more coins on screen than slots: skip one
    const c = { lane, z: -d, y, slot, taken: false, hidden: false };
    this.coins.push(c);
    this._place(c, 0);
    this.coinMesh.count = Math.max(this.coinMesh.count, slot + 1);
    return c;
  }
  /** Write a coin's slot: its spot and spin, or nothing if it is gone. */
  _place(c, t) {
    const show = !c.taken && !c.hidden;
    if (show) { this._q.setFromAxisAngle(this._v.set(0, 1, 0), t * 3); this._m4.compose(this._v.set(c.z, GROUND_Y + c.y, LANE_Z[c.lane]), this._q, this._s1); }   // one spin for all: every coin turns together
    else this._m4.compose(this._v.set(0, -100, 0), this._q.identity(), this._s0);
    this.coinMesh.setMatrixAt(c.slot, this._m4);
  }
  /** Give a coin's slot back. */
  _dropCoin(c) { c.taken = true; this._place(c, 0); this.coinFree.push(c.slot); }

  /**
   * A train of `cars` cars at distance `d` in `lane`. A ramp train has the
   * open car with the ramp first, closed cars of the same height behind it,
   * and a line of coins along the roof — riding it is worth something.
   * Returns its length.
   */
  spawnTrain(lane, d, ramp = false, cars = 1, roofCoins = ramp) {
    const group = new THREE.Group();
    let x = 0, top = 0;
    for (let c = 0; c < cars; c++) {
      // a ramp train, or a roof meant to be run on, is made of the flat-roofed cars of one height
      const flat = ramp || roofCoins;
      const tpl = flat ? (ramp && c === 0 ? this.tpl.ramp : this.tpl.rampCars[Math.floor(this.rng() * this.tpl.rampCars.length)])
                       : this.tpl.trains[Math.floor(this.rng() * this.tpl.trains.length)];
      const m = new THREE.Mesh(tpl.geom, tpl.mat);
      m.position.x = -(x + tpl.size.x / 2);
      group.add(m);
      x += tpl.size.x + 0.25;
      top = Math.max(top, tpl.box.max.y - GROUND_Y);
    }
    group.position.set(-d, 0, LANE_Z[lane]);
    this.track.add(group);
    this.obstacles.push({ kind: ramp ? 'ramp' : 'train', lane, z0: -d - x, z1: -d, mesh: group, top });
    // coins from the top of the ramp to a little before the end of the roof, so the last one is taken on the train, not in the air
    if (roofCoins) for (let i = 0; i * 2.2 + RAMP_LEN + 1 < x - 2.6; i++) this._coin(lane, d + RAMP_LEN + 1 + i * 2.2, top + 1.0);
    return x;
  }

  // ------------------------------------------------------------- movers

  /**
   * A train on the move in `lane`, starting `d` ahead, coming AT the runner
   * at `vel` world units per second (along +z).
   */
  spawnMover(lane, d, vel) {
    const tpl = this.tpl.movers.long;
    const m = new THREE.Mesh(tpl.geom, tpl.mat);
    m.position.set(-d - tpl.size.x / 2, 0, LANE_Z[lane]);
    this.track.add(m);
    const o = { kind: 'train', lane, z0: -d - tpl.size.x, z1: -d, mesh: m, vel, moving: true, len: tpl.size.x };
    this.obstacles.push(o); this.movers.push(o);
    return o;
  }

  /**
   * Move the movers. A barrier in a moving train's way is smashed the moment
   * the train reaches it — so a lane can carry a train without anything
   * being quietly deleted ahead of you: what goes, goes with a bang.
   */
  updateMovers(dt, distance = 0) {
    for (const o of this.movers) {
      o.z0 += o.vel * dt; o.z1 += o.vel * dt; o.mesh.position.x += o.vel * dt;   // track x IS world z
      for (const p of this.obstacles) {
        if (p === o || p.moving || p.lane !== o.lane || p.kind === 'train' || p.kind === 'ramp') continue;
        if (o.z1 >= p.z0 - 0.3 && o.z0 <= p.z1) this._smash(p);
      }
      for (const c of this.coins) if (!c.taken && c.lane === o.lane && c.z >= o.z0 && c.z <= o.z1) c.taken = true;
    }
    this.movers = this.movers.filter(o => this.obstacles.includes(o));
    this.reservations = this.reservations.filter(r => r.to > distance - 20);
  }

  _smash(p) {
    this.obstacles = this.obstacles.filter(o => o !== p);
    this.smashing.push({ mesh: p.mesh, t: 0, spin: (this.rng() - 0.5) * 6 });
  }

  /** Where a moving train could go: `true` if no standing train sits in `lane` between `from` and `to` (distances). */
  laneClearOfTrains(lane, from, to) {
    return !this.obstacles.some(o => o.lane === lane && !o.moving && (o.kind === 'train' || o.kind === 'ramp') && -o.z1 < to && -o.z0 > from);
  }

  /**
   * Keep `lane` empty from distance `from` to `to`: nothing will be placed
   * there, and rows there count it as a train lane. This is how a moving
   * train gets a clean path without anything visible ever being removed —
   * the range starts beyond where rows have been laid.
   */
  reserve(lane, from, to) { this.reservations.push({ lane, from, to }); }

  /** Lanes a moving train will sweep through at distance `d`, or that are reserved there (so nothing else is put there). */
  busyLanes(d) {
    const z = -d;
    const fromMovers = this.movers.filter(o => o.z1 < z + 2).map(o => o.lane);
    const fromReservations = this.reservations.filter(r => d >= r.from && d <= r.to).map(r => r.lane);
    return [...new Set([...fromMovers, ...fromReservations])];
  }

  /** One obstacle, placed by hand — the profiling cues use it. */
  spawnSingle(kind, lane, d) {
    if (kind === 'low') kind = 'block';
    const list = this.tpl[kind];
    const tpl = list[Math.floor(this.rng() * list.length)];
    const m = new THREE.Mesh(tpl.geom, tpl.mat);
    m.position.set(-d - tpl.size.x / 2, 0, LANE_Z[lane]);
    this.track.add(m);
    this.obstacles.push({ kind, lane, z0: -d - tpl.size.x - 0.1, z1: -d + 0.1, mesh: m });
  }

  /** Remove everything behind the camera. */
  recycle(distance) {
    const behind = -(distance - 8);
    this.obstacles = this.obstacles.filter(o => {
      // gone only when its FAR end is behind you — a train is long, and you may be standing on it
      if (o.z0 > behind) { this.track.remove(o.mesh); return false; }
      return true;
    });
    this.coins = this.coins.filter(c => {
      if (c.z > behind || c.taken) { this._dropCoin(c); return false; }
      return true;
    });
  }

  animate(t, dt = 1 / 60, distance = null) {
    // a weak screen draws only what is inside the fog
    const far = this.lite && distance != null ? -(distance + 120) : -Infinity;
    if (this.lite && distance != null) for (const o of this.obstacles) o.mesh.visible = o.z0 < -(distance - 10) && o.z1 > far;
    for (const c of this.coins) { c.hidden = c.z < far; this._place(c, t); }
    this.coinMesh.instanceMatrix.needsUpdate = true;
    // a smashed barrier tumbles up and away for a third of a second, then is gone
    for (const s of this.smashing) {
      s.t += dt; const p = s.t / 0.35;
      s.mesh.position.y = 4 * p * (1 - p) * 3;
      s.mesh.rotation.z = s.spin * p; s.mesh.rotation.x = p * 2;
      const k = Math.max(0.01, 1 - p);
      s.mesh.scale.set(k, k, k);
      if (p >= 1) this.track.remove(s.mesh);
    }
    this.smashing = this.smashing.filter(s => s.t < 0.35);
  }

  /**
   * What is ahead of the player, per lane, within `window` world units.
   * Each entry: { kind, dist } for the nearest hazard in that lane.
   */
  /**
   * What is ahead of the player, per lane, within `window` world units — or,
   * with `speed` given, within the TIME that window means at that speed, so
   * that a train coming the other way is seen as early as it deserves.
   * Each entry: { kind, dist, timeTo, o } for the nearest hazard in the lane.
   */
  lookAhead(distance, window, speed = null) {
    const zNow = -distance;
    const out = [null, null, null];
    const windowS = speed != null ? window / Math.max(1, speed) : null;
    for (const o of this.obstacles) {
      const ahead = zNow - o.z1;             // >= 0 when the obstacle starts ahead of us
      const end = zNow - o.z0;
      if (end < 0) continue;
      const dist = Math.max(0, ahead);
      const closing = speed != null ? Math.max(0.5, speed + (o.vel || 0)) : null;
      const timeTo = closing != null ? dist / closing : null;
      if (windowS != null ? timeTo > windowS : ahead > window) continue;
      const key = timeTo != null ? timeTo : dist;
      if (!out[o.lane] || key < (out[o.lane].timeTo != null ? out[o.lane].timeTo : out[o.lane].dist)) out[o.lane] = { kind: o.kind, dist, timeTo, len: o.z1 - o.z0, o };
    }
    return out;
  }

  /** Collision test for the player's box this frame. Returns the obstacle hit or null. */
  /**
   * Collision test for the player's box this frame. Returns the obstacle hit or null.
   * @param riding the obstacle whose roof the player is on, if any: it cannot hit them
   */
  hitTest(distance, lane, feetY, headY, riding = null) {
    const zNow = -distance;
    for (const o of this.obstacles) {
      if (o.lane !== lane || o === riding) continue;
      if (zNow > o.z1 + 0.4 || zNow < o.z0 - 0.4) continue;
      if (o.kind === 'train') return o;
      if (o.kind === 'ramp') return o;                       // the caller boards instead of dying — see game.js
      const over = feetY >= HIT.low.top, under = headY <= HIT.high.bottom;
      if (o.kind === 'block' && !over) return o;
      if (o.kind === 'bar' && !over && !under) return o;
      if (o.kind === 'high' && !under) return o;
    }
    return null;
  }

  collectCoins(distance, lane, feetY, headY) {
    const zNow = -distance;
    let n = 0;
    for (const c of this.coins) {
      if (c.taken || c.lane !== lane) continue;
      if (Math.abs(c.z - zNow) < 0.9 && c.y > feetY - 0.6 && c.y < headY + 0.6) { c.taken = true; n++; }
    }
    return n;
  }
}

// --------------------------------------------------------------- helpers
/**
 * A turn that lingers face-on and hurries through end-on. The angle is
 * `a - k sin 2a`: at the face it moves at (1 - 2k) of the rate, at the edge
 * at (1 + 2k), so a flat token spends its time being a flame and not a line.
 */
function spin(a, k = 0.28) { return a - k * Math.sin(2 * a); }

/** A soft round glow, drawn once: white in the middle, gone at the edge. */
function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,0.55)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function lerp(a, b, t) { return a + (b - a) * Math.min(1, Math.max(0, t)); }
function shuffle(a, rng) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
