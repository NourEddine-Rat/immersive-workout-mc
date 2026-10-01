// The other players.
//
// One model (squid_game_player_rig_version, a Mixamo skeleton in a T-pose),
// cloned per player, every movement made here in code (rig.js): the walk, the
// run, the freeze wherever the stride happened to be, the wobble of someone
// caught on one leg, the flinch, the fall, the body on the sand.
//
// Each player gets his own number, printed on a small patch on his back (and
// the badge on his chest) — the shirt's own "456" is painted out, because 456
// is you.

import * as THREE from 'three';
import { clone as cloneSkinned } from '../three/SkeletonUtils.js';
import { Rig, qa, qe } from './rig.js';

const KEY = n => n.replace(/^mixamorig:?/, '').replace(/_\d+$/, '');
const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3();

// where the numbers sit on the shirt texture (1024², painted upside down)
const BACK_PATCH = [444, 232, 150, 64], CHEST_PATCH = [212, 257, 67, 32];
const SHIRT_GREEN = '#0a4a3b';

export class Crowd {
  /** @param opts.style 'squid' (the tracksuit, numbers on patches) or 'athlete' (a singlet and shorts in a kit colour, bare arms and legs, race bibs) */
  constructor(scene, opts = {}) { this.scene = scene; this.bots = []; this.src = null; this.style = opts.style || 'squid'; }

  async load(url, loader) {
    const g = await loader.loadAsync(url);
    this.src = g.scene;
    let mesh = null; this.src.traverse(o => { if (o.isSkinnedMesh) mesh = o; });
    const mat = mesh.material, img = mat.map && mat.map.image;
    // the shirt, with 456 painted out: one texture for everyone
    if (img) {
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      const k = img.width / 1024;
      x.fillStyle = SHIRT_GREEN; x.fillRect(BACK_PATCH[0] * k, BACK_PATCH[1] * k, BACK_PATCH[2] * k, BACK_PATCH[3] * k);
      x.fillStyle = '#2b2b2b'; x.fillRect(CHEST_PATCH[0] * k, CHEST_PATCH[1] * k, CHEST_PATCH[2] * k, CHEST_PATCH[3] * k);
      const t = new THREE.CanvasTexture(c); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
      mat.map = t; mat.needsUpdate = true;
    }
    mat.roughness = 0.75; mat.side = THREE.FrontSide;
    this.material = mat;
    mesh.castShadow = true; mesh.frustumCulled = false;
    // where the patches go, measured on the rest pose: a point on the jacket and which way it faces
    this.src.updateMatrixWorld(true);
    const probe = (from, dir) => {
      const hit = new THREE.Raycaster(new THREE.Vector3(...from), new THREE.Vector3(...dir)).intersectObject(mesh, true)[0];
      if (!hit) return null;
      const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(...dir).negate();
      if (n.dot(new THREE.Vector3(...dir)) > 0) n.negate();
      return { p: hit.point.clone(), n };
    };
    this.backSpot = probe([0, 1.37, -2], [0, 0, 1]) || { p: new THREE.Vector3(0, 1.37, -0.13), n: new THREE.Vector3(0, 0, -1) };
    this.chestSpot = probe([0.118, 1.452, 2], [0, 0, -1]) || { p: new THREE.Vector3(0.118, 1.452, 0.14), n: new THREE.Vector3(0, 0, 1) };
    this.bibFront = probe([0, 1.26, 2], [0, 0, -1]) || { p: new THREE.Vector3(0, 1.26, 0.14), n: new THREE.Vector3(0, 0, 1) };
    this.bibBack = probe([0, 1.3, -2], [0, 0, 1]) || { p: new THREE.Vector3(0, 1.3, -0.13), n: new THREE.Vector3(0, 0, -1) };
    if (this.style === 'athlete') this.prepareKit(mesh);
    return this;
  }

  /**
   * The athlete's kit, painted by body part rather than by guessing the
   * texture's islands: every triangle is coloured by the bone that moves it
   * and where it sits on the body in the rest pose — arms bare, the torso a
   * sleeveless singlet, the top of the thighs shorts, the rest of the legs
   * bare, spikes on the feet. The face, hair and hands keep their texture.
   */
  prepareKit(mesh) {
    const img = this.material.map && this.material.map.image; if (!img) return;
    const geo = mesh.geometry, uv = geo.attributes.uv, si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight, idx = geo.index;
    const names = mesh.skeleton.bones.map(b => KEY(b.name));
    const group = nm => /Hand/.test(nm) ? 'hand' : /Head|HeadTop/.test(nm) ? 'head' : /Neck/.test(nm) ? 'neck' : /Arm/.test(nm) ? 'arm' : /Foot|Toe/.test(nm) ? 'foot' : /UpLeg|Leg/.test(nm) ? 'leg' : 'torso';
    const G = ['hand', 'head', 'neck', 'arm', 'foot', 'leg', 'torso'];
    // per vertex: how much each body part moves it, and its height in the rest pose
    const nv = geo.attributes.position.count, W7 = new Float32Array(nv * 7), Y = new Float32Array(nv), v = new THREE.Vector3();
    for (let i = 0; i < nv; i++) {
      for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > 0) W7[i * 7 + G.indexOf(group(names[si.getComponent(i, k)] || ''))] += w; }
      v.fromBufferAttribute(geo.attributes.position, i); mesh.applyBoneTransform(i, v); v.applyMatrix4(mesh.matrixWorld); Y[i] = v.y;
    }
    // rasterise every triangle into a part map, pixel by pixel, from the blended weights: clean hems and armholes
    const S = 1024, part = new Uint8Array(S * S);   // 0 keep · 1 skin · 2 singlet · 3 shorts · 4 shoe
    const nt = idx ? idx.count / 3 : nv / 3;
    const w = new Float32Array(7);
    for (let f = 0; f < nt; f++) {
      const ids = [0, 1, 2].map(k => idx ? idx.getX(f * 3 + k) : f * 3 + k);
      if (ids.every(i => W7[i * 7] + W7[i * 7 + 1] > 0.5)) continue;          // hands and head keep their texture
      const P = ids.map(i => [uv.getX(i) * S, uv.getY(i) * S]);
      const x0 = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0]))), x1 = Math.min(S - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0])));
      const y0 = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1]))), y1 = Math.min(S - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])));
      const d = (P[1][1] - P[2][1]) * (P[0][0] - P[2][0]) + (P[2][0] - P[1][0]) * (P[0][1] - P[2][1]); if (Math.abs(d) < 1e-9) continue;
      for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
        const X = px + 0.5, Yp = py + 0.5;
        const a = ((P[1][1] - P[2][1]) * (X - P[2][0]) + (P[2][0] - P[1][0]) * (Yp - P[2][1])) / d;
        const b = ((P[2][1] - P[0][1]) * (X - P[2][0]) + (P[0][0] - P[2][0]) * (Yp - P[2][1])) / d;
        const c = 1 - a - b; if (a < -0.02 || b < -0.02 || c < -0.02) continue;
        for (let k = 0; k < 7; k++) w[k] = a * W7[ids[0] * 7 + k] + b * W7[ids[1] * 7 + k] + c * W7[ids[2] * 7 + k];
        const y = a * Y[ids[0]] + b * Y[ids[1]] + c * Y[ids[2]];
        let q;
        if (w[0] + w[1] > 0.5) q = 0;
        else if (w[4] > 0.5) q = 4;
        else if (w[3] > 0.45 || w[2] > 0.5) q = 1;                                // bare arms, bare neck
        else if (w[5] > 0.5) q = y > 0.72 ? 3 : 1;                                 // shorts to mid-thigh, bare legs below
        else q = y > 0.9 ? 2 : 3;                                                  // singlet above the waist, shorts below
        part[py * S + px] = q;
      }
    }
    // grow the painted areas into the seams by a few pixels, so no tracksuit green shows at island edges
    for (let pass = 0; pass < 3; pass++) {
      const src = part.slice();
      for (let py = 1; py < S - 1; py++) for (let px = 1; px < S - 1; px++) {
        const i = py * S + px; if (src[i]) continue;
        const n = src[i - 1] || src[i + 1] || src[i - S] || src[i + S]; if (n) part[i] = n;
      }
    }
    // the skin tone, from the hands' own texels
    const c0 = document.createElement('canvas'); c0.width = S; c0.height = S;
    const x0c = c0.getContext('2d'); x0c.drawImage(img, 0, 0, S, S);
    const base = x0c.getImageData(0, 0, S, S);
    let r = 0, g = 0, bb = 0, m = 0;
    for (let i = 0; i < nv; i += 3) { if (W7[i * 7] < 0.8) continue; const px = Math.min(S - 1, Math.floor(uv.getX(i) * S)), py = Math.min(S - 1, Math.floor(uv.getY(i) * S)), o = (py * S + px) * 4; if (base.data[o] + base.data[o + 1] + base.data[o + 2] > 200) { r += base.data[o]; g += base.data[o + 1]; bb += base.data[o + 2]; m++; } }
    this.skinRGB = m ? [r / m, g / m, bb / m] : [226, 179, 145];
    this.kitPart = part; this.kitBase = base; this.kitTris = true; this.kits = new Map();
  }

  /** A texture in this kit colour (cached). */
  kitTexture(kit) {
    const key = kit.shirt + kit.shorts + kit.shoe;
    if (this.kits.has(key)) return this.kits.get(key);
    const S = 1024, c = document.createElement('canvas'); c.width = S; c.height = S;
    const x = c.getContext('2d'), out = x.createImageData(S, S), src = this.kitBase.data, part = this.kitPart;
    const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const col = [null, this.skinRGB, hex(kit.shirt), hex(kit.shorts), hex(kit.shoe)];
    for (let i = 0; i < S * S; i++) {
      const q = part[i], o = i * 4;
      if (!q) { out.data[o] = src[o]; out.data[o + 1] = src[o + 1]; out.data[o + 2] = src[o + 2]; out.data[o + 3] = 255; continue; }
      // a little of the cloth's own grain (the original's brightness) so it is not flat plastic
      const lum = (src[o] * 0.3 + src[o + 1] * 0.59 + src[o + 2] * 0.11) / 255, k = q === 1 ? 1 : 0.9 + 0.2 * Math.min(1, lum * 2.2);
      out.data[o] = Math.min(255, col[q][0] * k); out.data[o + 1] = Math.min(255, col[q][1] * k); out.data[o + 2] = Math.min(255, col[q][2] * k); out.data[o + 3] = 255;
    }
    x.putImageData(out, 0, 0);
    const tex = new THREE.CanvasTexture(c); tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    this.kits.set(key, tex); return tex;
  }

  /** A player with this number, standing at (x, z), facing the doll (+z). */
  add(num, x, z, opts = {}) {
    const b = new Bot(this, num, opts);
    b.place(x, z);
    this.scene.add(b.root);
    this.bots.push(b);
    return b;
  }

  update(dt, t) { for (const b of this.bots) b.update(dt, t); }
  clear() { for (const b of this.bots) b.dispose(); this.bots = []; }
}

/** A patch that wraps a little around a back of this radius (bends away from its face). */
function curved(w, h, radius) {
  const g = new THREE.PlaneGeometry(w, h, 8, 1), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setZ(i, -x * x / (2 * radius)); }
  g.computeVertexNormals(); return g;
}

/** A race bib: white card, safety-pin dots, a big black number. */
function bibTex(num) {
  const c = document.createElement('canvas'); c.width = 192; c.height = 144;
  const x = c.getContext('2d');
  x.fillStyle = '#f7f7f4'; x.fillRect(0, 0, 192, 144);
  x.fillStyle = '#d02030'; x.fillRect(0, 0, 192, 18);
  x.fillStyle = '#bbb'; for (const [px, py] of [[10, 28], [182, 28], [10, 134], [182, 134]]) { x.beginPath(); x.arc(px, py, 4, 0, Math.PI * 2); x.fill(); }
  x.fillStyle = '#111'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = '800 78px "Helvetica Neue", Arial, sans-serif';
  x.fillText(String(num), 96, 84);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

/** The number on a patch, as the show prints it: white, rounded, bold. */
function patch(num, w, h, bg, fg, size) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  if (bg) { x.fillStyle = bg; x.fillRect(0, 0, w, h); }
  x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = `700 ${size}px "Arial Rounded MT Bold", "Nunito", "Helvetica Neue", Arial, sans-serif`;
  x.fillText(String(num).padStart(3, '0'), w / 2, h / 2 + size * 0.04);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export class Bot {
  constructor(crowd, num, opts) {
    this.crowd = crowd; this.num = num;
    this.root = new THREE.Group(); this.root.name = 'bot' + num;
    this.tilt = new THREE.Group(); this.root.add(this.tilt);
    this.model = cloneSkinned(crowd.src); this.tilt.add(this.model);
    this.model.traverse(o => { if (o.isSkinnedMesh) { this.mesh = o; o.castShadow = true; o.frustumCulled = false; } });
    const s = opts.scale || (0.94 + Math.random() * 0.12);
    this.model.scale.set(s * (0.96 + Math.random() * 0.1), s, s * (0.96 + Math.random() * 0.1));
    this.rig = new Rig(this.model, KEY);
    this.athlete = crowd.style === 'athlete';
    if (this.athlete && crowd.kitTris) {
      const kit = opts.kit || { shirt: '#c8202a', shorts: '#1a1a22', shoe: '#ff6a1a' };
      this.mesh.material = crowd.material.clone(); this.mesh.material.map = crowd.kitTexture(kit); this.mesh.material.roughness = 0.7;
    }
    // the number, on the back and on the chest badge, riding the chest bone
    const spine = this.rig.b.Spine2;
    if (spine && this.athlete) {
      // race bibs: white, black number, front and back
      this.root.updateMatrixWorld(true);
      const bib = () => new THREE.MeshStandardMaterial({ map: bibTex(num), roughness: 0.85, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 });
      const front = new THREE.Mesh(curved(0.19, 0.14, 0.22), bib()), back = new THREE.Mesh(curved(0.19, 0.14, 0.22), bib());
      for (const [m, spot] of [[front, crowd.bibFront], [back, crowd.bibBack]]) {
        const p = spot.p.clone().multiply(this.model.scale).addScaledVector(spot.n, 0.012);
        m.position.copy(p); m.lookAt(p.clone().add(spot.n));
      }
      for (const m of [front, back]) { this.root.add(m); m.updateMatrixWorld(true); spine.attach(m); }
      this.patches = [front, back];
    } else if (spine) {
      // placed in the rest pose (the root is still at the origin), then handed to the bone keeping where they are
      this.root.updateMatrixWorld(true);
      const back = new THREE.Mesh(curved(0.21, 0.09, 0.2), new THREE.MeshStandardMaterial({ map: patch(num, 256, 108, null, '#f4f4ee', 92), transparent: true, roughness: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
      const chest = new THREE.Mesh(new THREE.PlaneGeometry(0.066, 0.03), new THREE.MeshStandardMaterial({ map: patch(num, 128, 58, '#262626', '#f4f4ee', 40), roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -4 }));
      for (const [m, spot, out] of [[back, crowd.backSpot, 0.012], [chest, crowd.chestSpot, 0.006]]) {
        const p = spot.p.clone().multiply(this.model.scale).addScaledVector(spot.n, out);
        m.position.copy(p); m.lookAt(p.clone().add(spot.n));
      }
      for (const m of [back, chest]) { this.root.add(m); m.updateMatrixWorld(true); spine.attach(m); }
      this.patches = [back, chest];
    }
    // character
    this.speed = 0; this.want = 0; this.phase = Math.random() * Math.PI * 2; this.amp = 0; this.run = 0;
    this.state = 'idle'; this.t = 0; this.stateT = 0;
    this.fear = 0; this.armOut = 0; this.wobble = 0; this.look = 0; this.lookWant = 0; this.lean = 0;
    this.seed = Math.random() * 100;
    this.facing = 0;            // 0 = toward the doll (+z), π = back to the doors
    this.yaw = 0;
    this.fall = null;           // { dir, at, twist, roll }
    this.onDown = null;         // called once when the body hits the sand, with the torso's world position
    this.hop = 0;               // a hop over a body: seconds left
  }

  place(x, z) { this.x = x; this.z = z; this.root.position.set(x, 0, z); }
  get alive() { return this.state !== 'dying' && this.state !== 'dead' && this.state !== 'plunge'; }
  get moving() { return this.speed > 0.08; }

  /** Walk (or run) toward the doll at this many m/s. */
  go(speed) { if (!this.alive) return; this.want = speed; if (this.state !== 'flee' && this.state !== 'safe') this.state = speed > 0 ? 'walk' : 'stand'; }
  /** Stop dead where you are — mid-stride if that is where the light caught you. */
  freeze() { if (!this.alive || this.state === 'flee') return; this.want = 0; this.speed = 0; this.state = 'frozen'; this.look = this.lookWant = this.look; }
  /** Turn and run for the doors. */
  flee(speed = 3.2) { if (!this.alive) return; this.state = 'flee'; this.want = speed; this.fear = 1; }
  /** Made it: walk on past the line and turn to watch. */
  safe(stopZ) { if (!this.alive) return; this.state = 'safe'; this.stopZ = stopZ; this.want = 1.1; }
  /** A hop (over a body), or with `hurdle` a hurdler's stride: higher, lead leg thrown out straight, trail leg folded to the side. */
  jumpOver(dur = 0.55, hurdle = false) { if (this.hop <= 0 && this.alive) { this.hop = dur; this.hopDur = dur; this.hurdling = hurdle; } }
  /** A leap forward to `toZ` (the gap in the bridge), `dur` seconds in the air. `short` = it falls short. */
  leap(toZ, dur = 0.7) { if (!this.alive) return; this.leapP = { from: this.z, to: toZ, t: 0, dur }; this.hop = dur; this.hopDur = dur; }
  get airborne() { return this.hop > 0.06 && this.hop < (this.hopDur || 0.55) - 0.04; }
  /**
   * Off the edge: thrown sideways (dirX ±1, the way the rope was going), tumbling, limbs going,
   * down to `floorY`, where the body stays. For heights — the rope bridge.
   */
  plunge(dirX = 1, floorY = -40, push = 1.6) {
    if (!this.alive) return false;
    this.leapP = null; this.hop = 0; this.want = 0; this.speed = 0;
    this.pl = { vx: dirX * push, vy: 1.6, vz: 0.3 * (Math.random() - 0.5), y: this.baseY || 0, spinX: (Math.random() - 0.5) * 5, spinZ: dirX * (3 + Math.random() * 3), floorY, dir: dirX };
    this.state = 'plunge';
    return true;
  }

  /**
   * Shot. The body jerks, the knees go, it falls — forward or back — and
   * settles. `from` is where the shot came from (world), so the jerk is away from it.
   */
  shoot(from, dirHint = 0) {
    if (!this.alive) return false;
    const toward = from ? Math.sign((from.z - this.z) * Math.cos(this.facing)) : 1;
    // a shot from the front knocks you back; panicking runners pitch forward
    const dir = dirHint || (this.state === 'flee' ? 1 : (Math.random() < 0.7 ? -toward : toward)) || -1;
    this.fall = { dir, at: this.t, twist: (Math.random() - 0.5) * 0.9, roll: (Math.random() - 0.5) * 0.35, arms: Math.random(), knees: 0.6 + Math.random() * 0.4, down: false };
    this.state = 'dying'; this.want = 0; this.speed = 0;
    return true;
  }

  /** Where the body ends up lying (world z range), for knowing what blocks a lane. */
  bodySpan() {
    const len = 1.75 * this.model.scale.y;
    const d = this.fall ? this.fall.dir * Math.cos(this.facing) : 1;
    return d > 0 ? [this.z, this.z + len] : [this.z - len, this.z];
  }

  update(dt, t) {
    this.t = t;
    const st = this.state;
    // speed follows what is wanted (a freeze is instant; everything else eases)
    if (st !== 'frozen' && st !== 'dying' && st !== 'dead') this.speed += (this.want - this.speed) * (1 - Math.exp(-dt / (this.want > this.speed ? 0.35 : 0.2)));
    if (st === 'flee') this.facing += (Math.PI - this.facing) * (1 - Math.exp(-dt / 0.18));
    if (st === 'safe') {
      if (this.z >= this.stopZ) { this.want = 0; if (this.speed < 0.1) this.facing += (Math.PI - this.facing) * (1 - Math.exp(-dt / 0.8)); }
    }
    // gait
    const moving = this.speed > 0.05 && st !== 'frozen';
    if (moving) {
      const cadence = this.athlete ? 1.3 + 0.4 * this.speed : 1.6 + 0.62 * this.speed;   // steps per second (a runner: 3.3 at 5 m/s, 4.3 at 7.5)
      this.phase += Math.PI * cadence * dt;
      this.z += Math.cos(this.facing) * this.speed * dt;
      this.x += Math.sin(this.facing) * this.speed * dt;
    }
    if (st !== 'frozen') {
      const ampWant = clamp(this.speed / (this.athlete ? 2.2 : 0.9), 0, 1);
      this.amp += (ampWant - this.amp) * (1 - Math.exp(-dt / 0.2));
      this.run += (clamp(this.athlete ? (this.speed - 2.5) / 4.5 : (this.speed - 1.5) / 1.3, 0, 1) - this.run) * (1 - Math.exp(-dt / 0.3));
    }
    if (this.leapP) { const L = this.leapP; L.t += dt; const k = Math.min(1, L.t / L.dur); this.z = L.from + (L.to - L.from) * k; if (k >= 1) this.leapP = null; }
    if (this.hop > 0) this.hop = Math.max(0, this.hop - dt);
    if (st === 'plunge') { this.stepPlunge(dt, t); return; }
    this.root.position.set(this.x, this.baseY || 0, this.z);
    this.root.rotation.y = this.facing;
    if (this.state !== 'frozen') this.fear = Math.max(this.state === 'flee' ? 1 : 0, this.fear - dt * 0.15);   // a frozen body holds whatever it had
    this.look += (this.lookWant - this.look) * (1 - Math.exp(-dt / 0.4));
    this.pose(dt, t);
  }

  pose(dt, t) {
    const R = this.rig; R.reset();
    const ph = this.phase, amp = this.amp, run = this.run;
    const s1 = Math.sin(ph);
    const trem = 0;   // nobody trembles: a frozen player is a statue
    const shake = k => Math.sin(t * (21 + k * 3) + this.seed * k) * trem;
    let bob = 0;

    if (this.state === 'dying' || this.state === 'dead') { this.poseFall(t); return; }
    if (this.athlete) { this.poseRunner(t); return; }

    // ---- legs: thigh swing, knee bend in the swing phase, foot kept near level
    const legSw = (17 + 20 * run) * amp;
    for (const [side, off] of [['Left', 0], ['Right', Math.PI]]) {
      const p = ph + off;
      const th = legSw * Math.sin(p);
      const knee = amp * (6 + 8 * run + (30 + 55 * run) * Math.pow(Math.max(0, Math.cos(p)), 1.4)) + (this.crouch || 0) * 60;
      R.rot(side + 'UpLeg', qa(X, -th - (this.crouch || 0) * 45));
      R.rot(side + 'Leg', qa(X, knee));
      R.rot(side + 'Foot', qa(X, (th - knee) * 0.55 + (this.crouch || 0) * 15));
    }
    bob = amp * (0.025 + 0.05 * run) * (Math.abs(Math.cos(ph)) - 0.5) - (this.crouch || 0) * 0.35;
    if (this.hop > 0) {
      const k = 1 - this.hop / (this.hopDur || 0.55), a = Math.sin(k * Math.PI);
      if (this.hurdling) {
        bob += a * 0.62;
        R.rot('LeftUpLeg', qa(X, -88 * a)); R.rot('LeftLeg', qa(X, 12 * a)); R.rot('LeftFoot', qa(X, 30 * a));
        R.rot('RightUpLeg', _q.copy(qa(Z, 55 * a)).multiply(qa(X, -25 * a))); R.rot('RightLeg', qa(X, 95 * a));
        R.add('Spine', qa(X, 22 * a));
      } else { bob += a * 0.42; R.add('LeftUpLeg', qa(X, -35 * a)); R.add('RightUpLeg', qa(X, -20 * a)); }
    }

    // ---- balance: someone frozen on one leg sways, and the sway grows when they are about to lose it
    const sway = 0;
    this.tilt.rotation.set(0, 0, sway * Math.PI / 180);

    // ---- torso
    R.rot('Hips', qa(Y, -7 * s1 * amp));
    R.rot('Spine', qa(X, 3 + 9 * run + this.lean + (this.crouch || 0) * 25 + shake(2) * 0.4));
    R.rot('Spine2', qe(0, 6 * s1 * amp, shake(3) * 0.5));
    // breathing, faster when afraid
    const br = this.state === 'frozen' ? 0 : Math.sin(t * 1.4 + this.seed) * 0.5;   // slow, small, and none at all while frozen
    R.add('Spine1', qa(X, -br));
    R.rot('Neck', qa(X, -4 - 5 * run));
    R.rot('Head', qe(-2 + shake(4) * 0.5, this.look + shake(5) * 0.4, 0));

    // ---- arms: down from the T, swinging against the legs; out for balance; up in panic
    const armSw = (14 + 32 * run) * amp;
    const lower = 74 - 45 * this.armOut - 40 * (this.state === 'flee' ? 1 : 0) * Math.abs(Math.sin(t * 7 + this.seed));
    const elbow = 12 + 75 * run + 20 * this.fear;
    for (const [side, sg] of [['Left', 1], ['Right', -1]]) {
      const fwd = (side === 'Left' ? -s1 : s1) * armSw + this.fear * 12;
      R.rot(side + 'Arm', _q.copy(qa(X, -fwd + shake(6 + sg) * 1.5)).multiply(qa(Z, -sg * lower)));
      R.rot(side + 'ForeArm', qa(Y, -sg * elbow));
      for (const f of ['Index', 'Middle', 'Ring', 'Pinky']) for (const n of [1, 2, 3]) R.rot(`${side}Hand${f}${n}`, qa(Z, -sg * (18 + 35 * run + 25 * this.fear)));
    }
    this.model.position.y = bob;
  }

  /**
   * A runner's stride, drawn from how sprinting looks rather than a pendulum:
   * the thigh drives high in front and extends behind, the knee folds tight
   * as the foot comes through and opens just before it lands, the foot
   * points after toe-off; arms pump from the shoulder with the elbow held
   * near a right angle, opposite to the legs; the body leans in, hips and
   * shoulders counter-rotate, and the body rises in each flight phase.
   * `run` 0 → a jog, 1 → flat out. Standing, it relaxes to a stand.
   */
  poseRunner(t) {
    const R = this.rig, ph = this.phase, amp = this.amp, r = this.run;
    let bob = 0;
    for (const [side, off, sg] of [['Left', 0, 1], ['Right', Math.PI, -1]]) {
      const p = ph + off, s = Math.sin(p), c = Math.cos(p);
      const thigh = amp * ((10 + 10 * r) + (26 + 24 * r) * s);                         // −16…+36 jogging, −20…+68 sprinting
      const swing = Math.pow(Math.max(0, Math.cos(p + 0.55)), 1.3);                      // the foot coming through, knee folding
      const knee = amp * (14 + (48 + 72 * r) * swing + 10 * Math.max(0, -c));
      R.rot(side + 'UpLeg', qa(X, -thigh));
      R.rot(side + 'Leg', qa(X, knee));
      R.rot(side + 'Foot', qa(X, amp * (18 * r * Math.max(0, -s) - 6)));
      // arms opposite the legs, from the shoulder; elbow about a right angle, a little more closed in front
      const arm = amp * (22 + 34 * r) * -s;
      R.rot(side + 'Arm', _q.copy(qa(X, -arm)).multiply(qa(Z, -sg * (80 - 6 * amp))));
      R.rot(side + 'ForeArm', qa(Y, -sg * (20 + amp * (62 + 14 * Math.max(0, -s)))));
      for (const f of ['Index', 'Middle', 'Ring', 'Pinky']) for (const k of [1, 2, 3]) R.rot(`${side}Hand${f}${k}`, qa(Z, -sg * (35 + 20 * r)));
      R.rot(side + 'HandThumb1', qa(Y, -sg * 20));
    }
    bob = amp * (0.018 + 0.03 * r) * Math.cos(2 * ph);
    R.rot('Hips', qa(Y, -8 * amp * Math.sin(ph)));
    R.rot('Spine', qa(X, amp * (5 + 9 * r)));
    R.rot('Spine2', qe(0, 10 * amp * Math.sin(ph), 0));
    R.rot('Neck', qa(X, -amp * (4 + 6 * r)));
    R.rot('Head', qe(-amp * 3, -4 * amp * Math.sin(ph), 0));
    // a hurdle: lead leg out straight, trail leg folded to the side, chest down over the lead knee
    if (this.hop > 0) {
      const k = 1 - this.hop / (this.hopDur || 0.55), a = Math.sin(k * Math.PI);
      bob += a * (this.hurdling ? 0.55 : 0.4);
      if (this.hurdling) {
        R.rot('LeftUpLeg', qa(X, -85 * a - (1 - a) * 10)); R.rot('LeftLeg', qa(X, 10 * a + 20 * (1 - a))); R.rot('LeftFoot', qa(X, 25 * a));
        R.rot('RightUpLeg', _q.copy(qa(Z, 50 * a)).multiply(qa(X, -20 * a))); R.rot('RightLeg', qa(X, 100 * a));
        R.add('Spine', qa(X, 20 * a));
        R.rot('RightArm', _q.copy(qa(X, -60 * a)).multiply(qa(Z, 74))); R.rot('LeftArm', _q2.copy(qa(X, 25 * a)).multiply(qa(Z, -70)));
      }
    }
    this.tilt.rotation.set(0, 0, 0);
    this.model.position.y = bob;
  }

  /** Falling: gravity, a tumble, arms and legs going — until the floor, where it lies still. */
  stepPlunge(dt, t) {
    const P = this.pl;
    P.vy -= 9.8 * dt; P.y += P.vy * dt; this.x += P.vx * dt; this.z += P.vz * dt;
    P.vx *= Math.exp(-dt * 0.3);
    if (P.y <= P.floorY) {
      // down: lie on the floor of the pit
      this.pl = null; this.state = 'dead'; this.tilt.position.set(0, 0, 0);
      this.fall = { dir: Math.random() < 0.5 ? 1 : -1, at: t - 5, twist: (Math.random() - 0.5) * 2, roll: (Math.random() - 0.5) * 0.5, arms: Math.random(), knees: 0.6, down: true };
      this.baseY = P.floorY; this.root.position.set(this.x, P.floorY, this.z);
      if (this.onLand) this.onLand(this);
      this.poseFall(t); return;
    }
    this.root.position.set(this.x, P.y, this.z);
    const age = Math.max(0, 0.9 - P.vy / 9.8);
    this.tilt.rotation.set(P.spinX * age * 0.35, 0, P.spinZ * age * 0.35, 'XYZ');
    this.tilt.position.y = 0.9;   // tumble about the waist, not the feet
    this.model.position.y = -0.9;
    // flailing: arms windmilling up, legs kicking
    const R = this.rig; R.reset();
    const f = t * 9 + this.seed;
    for (const [side, sg, o] of [['Left', 1, 0], ['Right', -1, 1.7]]) {
      R.rot(side + 'Arm', _q.copy(qa(X, -60 - 50 * Math.sin(f + o))).multiply(qa(Z, -sg * (20 + 25 * Math.sin(f * 0.8 + o)))));
      R.rot(side + 'ForeArm', qa(Y, -sg * (30 + 30 * Math.sin(f * 1.3 + o))));
      R.rot(side + 'UpLeg', qa(X, -30 - 35 * Math.sin(f * 0.9 + o)));
      R.rot(side + 'Leg', qa(X, 40 + 35 * Math.sin(f * 1.1 + o)));
    }
    R.rot('Spine', qa(X, -15)); R.rot('Head', qe(-25, 0, 0));
  }

  /** The shot and the fall. Time since the hit drives everything; the end state is a still body. */
  poseFall(t) {
    const F = this.fall, R = this.rig, el = t - F.at;
    const HIT = 0.1, FALL = 0.62;
    // the jerk: the chest thrown away from the shot, arms flung
    const jerk = Math.exp(-Math.max(0, el) * 7) * Math.min(1, el / 0.04);
    const k = clamp((el - HIT) / FALL, 0, 1);
    let ang = F.dir * 90 * k * k;                                       // gravity: slow, then all at once
    if (k >= 1) { const b = el - HIT - FALL; ang = F.dir * (90 - 7 * Math.exp(-b * 9) * Math.abs(Math.sin(b * 16))); }   // the bounce
    if (k >= 1 && !F.down) {
      F.down = true; this.state = 'dead';
      if (this.onDown) { const sp = this.rig.b.Spine1; const p = sp ? sp.getWorldPosition(new THREE.Vector3()) : this.root.position.clone(); this.onDown(this, p); }
    }
    this.tilt.rotation.set(ang * Math.PI / 180, F.twist * k, F.roll * k, 'YXZ');
    this.root.position.y = this.baseY || 0;
    this.tilt.position.y = 0.12 * Math.sin(Math.abs(ang) * Math.PI / 180);
    // knees buckle first, then the legs straighten out on the ground
    const buckle = Math.sin(clamp(el / 0.5, 0, 1) * Math.PI) * 55 * F.knees + 10;
    R.rot('LeftUpLeg', qa(X, -buckle * 0.5 - 6)); R.rot('RightUpLeg', qa(X, -buckle * 0.35 + 4));
    R.rot('LeftLeg', qa(X, buckle)); R.rot('RightLeg', qa(X, buckle * 0.8 + 6));
    R.rot('Spine', qa(X, -F.dir * 14 * jerk + (F.dir > 0 ? 6 : -4) * k));
    R.rot('Spine2', qe(-F.dir * 10 * jerk, 12 * jerk * (F.arms - 0.5), 0));
    R.rot('Head', qe(-F.dir * 30 * jerk + (F.dir > 0 ? -15 : 20) * k, 30 * (F.arms - 0.5) * k, 0));
    // arms: flung out on the hit, then wherever they land
    const fling = 60 * jerk;
    const landL = F.dir > 0 ? 20 : 55 + 40 * F.arms, landR = F.dir > 0 ? 45 + 30 * F.arms : 30;
    R.rot('LeftArm', _q.copy(qa(X, -(F.dir > 0 ? 70 : -20) * k - fling * 0.3)).multiply(qa(Z, -(74 - fling - (74 - landL) * k))));
    R.rot('RightArm', _q2.copy(qa(X, -(F.dir > 0 ? 50 : -10) * k - fling * 0.2)).multiply(qa(Z, 74 - fling - (74 - landR) * k)));
    R.rot('LeftForeArm', qa(Y, -(20 + 40 * F.arms * k))); R.rot('RightForeArm', qa(Y, 15 + 30 * (1 - F.arms) * k));
    this.model.position.y = 0;
  }

  dispose() {
    this.root.parent && this.root.parent.remove(this.root);
    for (const m of this.patches || []) { m.material.map.dispose(); m.material.dispose(); m.geometry.dispose(); }
  }
}
