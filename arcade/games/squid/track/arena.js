// The stadium: the "Track & Field" model (baked by tools/bake-track.mjs —
// the track sheet, the floodlight masts, the rails on the bends, the boards),
// and what it did not come with, made here: the sky, the grass beyond the
// apron, a tree line, two grandstands full of people, the hurdles, the start
// marks in every lane and the finish gantry.

import * as THREE from 'three';
import { TRACK, RACE, laneR, lanePoint, ovalPoint, raceS, lapLen, hurdleSpots, raceMetres } from './rules.js';

const canvasTex = (w, h, draw, repeat) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
};
const rnd = (a, b) => a + Math.random() * (b - a);

export class Arena {
  constructor(scene) { this.scene = scene; this.hurdles = []; }

  async load(loader, url = './models/stadium.glb', lanes = [RACE.lane, ...RACE.rivals]) {
    const g = await loader.loadAsync(url);
    this.root = g.scene; this.scene.add(this.root);
    this.root.traverse(o => {
      if (!o.isMesh) return;
      const m = o.material;
      if (m.map) m.map.anisotropy = 12;
      if (o.name === 'track') { o.receiveShadow = true; m.normalScale && m.normalScale.set(0.6, 0.6); }
      else { o.castShadow = true; o.receiveShadow = true; }
    });
    this.lanes = lanes;
    this.sky(); this.ground(); await this.trees(loader); this.stands(); this.finish(); this.lines(); this.buildHurdles(lanes); this.layout(raceMetres(RACE.laps));
    // light: a clear late-afternoon sky, the sun low over the back straight so every runner throws a long shadow
    this.scene.add(new THREE.HemisphereLight(0xdfeeff, 0x6d7a4a, 1.25));
    const sun = this.sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 160 });
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    this.scene.add(sun, sun.target);
    this.follow(0, 0);
    this.scene.fog = new THREE.Fog(0xcfe0ee, 160, 420);
    return this;
  }

  /** Keep the sun's shadow box on the runner. */
  follow(x, z) { this.sun.position.set(x - 40, 60, z - 55); this.sun.target.position.set(x, 0, z); this.sun.target.updateMatrixWorld(); }

  sky() {
    const tex = canvasTex(8, 512, (x, w, h) => {
      const g = x.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#2f6fb8'); g.addColorStop(0.42, '#79aee0'); g.addColorStop(0.5, '#cfe0ee'); g.addColorStop(1, '#cfe0ee');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }));
    dome.name = 'sky'; this.scene.add(dome); this.dome = dome;
    // a few soft clouds
    const cloud = canvasTex(256, 128, (x, w, h) => { for (let i = 0; i < 14; i++) { const cx = rnd(40, w - 40), cy = rnd(40, h - 30), r = rnd(18, 42); const g = x.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, w, h); } });
    for (let i = 0; i < 12; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloud, transparent: true, opacity: rnd(0.55, 0.9), fog: false, depthWrite: false }));
      const a = rnd(0, Math.PI * 2), d = rnd(350, 600);
      s.position.set(Math.cos(a) * d, rnd(90, 190), Math.sin(a) * d); s.scale.set(rnd(160, 260), rnd(60, 100), 1);
      this.scene.add(s);
    }
  }

  ground() {
    // mown grass in stripes, beyond the model's own apron (the sheet ends at X ±93, Z ±52.8)
    const grass = canvasTex(512, 512, (x, w, h) => {
      for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? '#4f7a33' : '#5a8a3a'; x.fillRect(0, i * h / 8, w, h / 8); }
      const d = x.getImageData(0, 0, w, h); for (let i = 0; i < d.data.length; i += 4) { const n = (Math.random() - 0.5) * 22; d.data[i] += n; d.data[i + 1] += n; d.data[i + 2] += n * 0.6; } x.putImageData(d, 0, 0);
    }, [60, 60]);
    const g = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ map: grass, roughness: 1 }));
    g.rotation.x = -Math.PI / 2; g.position.y = -0.03; g.receiveShadow = true; this.scene.add(g);
  }

  /**
   * The trees all round: Poly Haven's scanned CC0 trees (tools/make-trees.py
   * packs their renders into one atlas), each stood up as two crossed cards,
   * in staggered rows beyond the stands and the bends — one draw call for
   * all of them.
   */
  async trees(loader) {
    const [tex, meta] = await Promise.all([new THREE.TextureLoader().loadAsync('./models/trees.webp'), fetch('./models/trees.json').then(r => r.json())]);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const pos = [], uv = [], nrm = [], col = [], idx = [];
    const card = (x, z, yaw, w, h, m, shade) => {
      for (const rot of [yaw, yaw + Math.PI / 2]) {
        const cx = Math.cos(rot) * w / 2, cz = Math.sin(rot) * w / 2, b = pos.length / 3;
        pos.push(x - cx, 0, z - cz, x + cx, 0, z + cz, x + cx, h, z + cz, x - cx, h, z - cz);
        uv.push(m.u0, m.v0, m.u1, m.v0, m.u1, m.v1, m.u0, m.v1);
        for (let k = 0; k < 4; k++) { nrm.push(0, 1, 0); col.push(shade[0], shade[1], shade[2]); }
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
    };
    // rows on a rounded rectangle round the stadium; nearer rows leafy, the far ones more firs
    let n = 0;
    for (let row = 0; row < 7; row++) {
      const ax = 118 + row * 13, az = 92 + row * 13, step = 7 + row;
      const per = 2 * Math.PI * Math.sqrt((ax * ax + az * az) / 2);
      for (let s = 0; s < per; s += step * (0.7 + Math.random() * 0.6)) {
        const t = s / per * Math.PI * 2, c = Math.cos(t), si = Math.sin(t);
        // a squircle: flatter sides along the straights
        const k = Math.pow(Math.pow(Math.abs(c), 4) + Math.pow(Math.abs(si), 4), -0.25);
        const x = ax * c * k + (Math.random() - 0.5) * 6, z = az * si * k + (Math.random() - 0.5) * 6;
        const pick = row > 3 && Math.random() < 0.55 ? 2 + (Math.random() < 0.5 ? 0 : 1) : [0, 1, 4, 5, 1, 0][Math.floor(Math.random() * 6)];
        const m = meta[pick], h = m.height * (0.85 + Math.random() * 0.5) * (1 + row * 0.05), w = h * m.aspect;
        const tone = 0.8 + Math.random() * 0.3, shade = [tone * (0.95 + Math.random() * 0.1), tone, tone * (0.9 + Math.random() * 0.1)];
        card(x, z, Math.random() * Math.PI, w, h, m, shade); n++;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, roughness: 1 }));
    mesh.name = 'trees'; this.scene.add(mesh); this.treeCount = n;
  }

  /**
   * Two grandstands, along the home and the back straight: real stepped
   * concrete tiers, a row of seats on every step, spectators in most of them
   * (instanced: a torso and a head each, shirts of every colour, a few on
   * their feet), an advertising wall in front, and a light roof on columns.
   */
  stands() {
    const TIERS = 14, DEPTH = 0.82, RISE = 0.42, LEN = 128, FRONT = 1.3, SEAT = 0.55;
    const concrete = new THREE.MeshStandardMaterial({ color: 0xc9c6bf, roughness: 0.95 });
    const shirts = [0xe8e8e8, 0xd23c3c, 0x2f6fd0, 0xf0c030, 0x2aa36b, 0xff7a2f, 0x7a4ad0, 0x222222, 0x1b9bd1, 0xffffff, 0xc8202a, 0x0b4f8a];
    const skins = [0xf1c9a5, 0xd9a47a, 0xa8744f, 0x6e4a33, 0xe8b894];
    const seatsPer = Math.floor(LEN / SEAT), total = seatsPer * TIERS;
    const make = (zEdge, flip) => {
      const grp = new THREE.Group();
      // the steps: one box per tier, each reaching down to the ground
      for (let i = 0; i < TIERS; i++) {
        const top = FRONT + (i + 1) * RISE, step = new THREE.Mesh(new THREE.BoxGeometry(LEN, top, DEPTH), concrete);
        step.position.set(0, top / 2, i * DEPTH + DEPTH / 2); step.receiveShadow = true; step.castShadow = true; grp.add(step);
      }
      const backH = FRONT + TIERS * RISE + 3.2;
      const back = new THREE.Mesh(new THREE.BoxGeometry(LEN + 1, backH, 0.5), concrete); back.position.set(0, backH / 2, TIERS * DEPTH + 0.25); grp.add(back);
      for (const sx of [-1, 1]) { const end = new THREE.Mesh(new THREE.BoxGeometry(0.5, backH, TIERS * DEPTH + 0.5), concrete); end.position.set(sx * (LEN / 2 + 0.25), backH / 2, TIERS * DEPTH / 2); grp.add(end); }
      // the advertising wall along the front
      const ads = canvasTex(2048, 64, (c, w, h) => { const cols = ['#0b4f8a', '#ff7a1a', '#1a1a22', '#2aa36b', '#f2c417', '#c8202a']; const words = ['TRACK & FIELD', 'RUN', 'SPEED', 'GRIP', 'ATHLETICS', 'GO FASTER']; for (let i = 0; i < 12; i++) { c.fillStyle = cols[i % cols.length]; c.fillRect(i * w / 12, 0, w / 12, h); c.fillStyle = i % cols.length === 4 ? '#111' : '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; const word = words[i % words.length]; let fs = 34; do { c.font = `700 ${fs}px Arial`; fs -= 2; } while (c.measureText(word).width > w / 12 - 20 && fs > 12); c.fillText(word, i * w / 12 + w / 24, h / 2 + 2); } });   // each word sized to fit its panel
      ads.wrapS = THREE.RepeatWrapping; ads.repeat.set(1, 1);
      const wall = new THREE.Mesh(new THREE.BoxGeometry(LEN, 1.0, 0.25), [concrete, concrete, concrete, concrete, new THREE.MeshStandardMaterial({ map: ads, roughness: 0.6 }), concrete]);
      wall.position.set(0, 0.5, -0.15); wall.rotation.y = Math.PI; grp.add(wall);
      // seats and people
      const seatG = new THREE.BoxGeometry(0.46, 0.1, 0.42), seats = new THREE.InstancedMesh(seatG, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }), total);
      const torsoG = new THREE.BoxGeometry(0.4, 0.55, 0.24), torsos = new THREE.InstancedMesh(torsoG, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), total);
      const headG = new THREE.SphereGeometry(0.115, 10, 8), heads = new THREE.InstancedMesh(headG, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }), total);
      const M4 = new THREE.Matrix4(), C = new THREE.Color();
      let p = 0;
      for (let i = 0; i < TIERS; i++) for (let j = 0; j < seatsPer; j++) {
        const x = -LEN / 2 + SEAT / 2 + j * SEAT, y = FRONT + (i + 1) * RISE, z = i * DEPTH + DEPTH * 0.55;
        seats.setMatrixAt(p, M4.makeTranslation(x, y + 0.42, z)); seats.setColorAt(p, C.set(i % 2 ? 0x1c5fb0 : 0x2370c8));
        const here = Math.random() < 0.82, standing = here && Math.random() < 0.08;
        const lean = (Math.random() - 0.5) * 0.25, ty = standing ? y + 1.05 : y + 0.75;
        if (here) {
          torsos.setMatrixAt(p, M4.compose(new THREE.Vector3(x + (Math.random() - 0.5) * 0.08, ty, z + 0.05), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.08, lean, 0)), new THREE.Vector3(0.9 + Math.random() * 0.25, 1, 1)));
          torsos.setColorAt(p, C.set(shirts[Math.floor(Math.random() * shirts.length)]));
          heads.setMatrixAt(p, M4.makeTranslation(x + (Math.random() - 0.5) * 0.06, ty + 0.4, z + 0.02));
          heads.setColorAt(p, C.set(skins[Math.floor(Math.random() * skins.length)]));
        } else { torsos.setMatrixAt(p, M4.makeScale(0, 0, 0)); heads.setMatrixAt(p, M4.makeScale(0, 0, 0)); torsos.setColorAt(p, C.set(0)); heads.setColorAt(p, C.set(0)); }
        p++;
      }
      for (const m of [seats, torsos, heads]) { m.castShadow = true; m.receiveShadow = true; grp.add(m); }
      // a light cantilever roof on slim columns
      const roofMat = new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.6, metalness: 0.1, emissive: 0x7d848c });   // its underside only sees the grass: lift it
      const roof = new THREE.Mesh(new THREE.BoxGeometry(LEN + 2, 0.25, TIERS * DEPTH + 3), roofMat);
      roof.position.set(0, backH + 1.2, TIERS * DEPTH / 2 - 1.2); roof.rotation.x = 0.07; roof.castShadow = true; grp.add(roof);
      const steel = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.6, roughness: 0.4 });
      for (let x = -LEN / 2; x <= LEN / 2 + 0.1; x += 16) { const col = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, backH + 1.2, 10), steel); col.position.set(x, (backH + 1.2) / 2, TIERS * DEPTH + 0.1); col.castShadow = true; grp.add(col); }
      grp.position.set(0, 0, zEdge); if (flip) grp.rotation.y = Math.PI;
      this.scene.add(grp);
    };
    make(55.6, false); make(-55.6, true);   // just beyond the apron on both straights (the sheet ends at Z ±52.8)
  }

  /** The finish gantry over the home straight, and the chequered line under it. */
  finish() {
    const x = TRACK.finishX, z0 = TRACK.zc + TRACK.r0 - 0.4, z1 = TRACK.zc + TRACK.r0 + TRACK.lanes * TRACK.laneW + 0.4;
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.5, z1 - z0), new THREE.MeshStandardMaterial({ map: canvasTex(16, 256, (c, w, h) => { for (let i = 0; i < 32; i++) for (let j = 0; j < 2; j++) { c.fillStyle = (i + j) % 2 ? '#111' : '#f4f4f4'; c.fillRect(j * 8, i * 8, 8, 8); } }), roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }));
    line.rotation.x = -Math.PI / 2; line.position.set(x, 0.012, (z0 + z1) / 2); line.receiveShadow = true; this.scene.add(line);
    const post = new THREE.MeshStandardMaterial({ color: 0x1b1d24, roughness: 0.5, metalness: 0.6 });
    for (const z of [z0 - 0.3, z1 + 0.3]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 5.2, 12), post); p.position.set(x, 2.6, z); p.castShadow = true; this.scene.add(p); }
    const banner = canvasTex(1024, 128, (c, w, h) => {
      c.fillStyle = '#0b0c10'; c.fillRect(0, 0, w, h); c.fillStyle = '#ff7a1a'; c.fillRect(0, h - 10, w, 10); c.fillRect(0, 0, w, 6);
      // chequered ends
      for (const x0 of [0, w - 96]) for (let i = 0; i < 6; i++) for (let j = 0; j < 7; j++) { c.fillStyle = (i + j) % 2 ? '#f4f4f4' : '#111'; c.fillRect(x0 + i * 16, 8 + j * 16, 16, 16); }
      c.font = '400 64px "Press Start 2P", monospace'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#ffffff'; c.fillText('FINISH', w / 2, h / 2 + 4);
    });
    this.banner = banner;
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.1, z1 - z0 + 0.8), [post, post, post, post, new THREE.MeshBasicMaterial({ map: banner }), new THREE.MeshBasicMaterial({ map: banner })]);
    b.position.set(x, 4.9, (z0 + z1) / 2); b.rotation.y = Math.PI / 2; b.rotation.y = 0;
    // faces ±X carry the text: turn the text to read from the runner's side (coming from −X)
    b.material[0] = new THREE.MeshBasicMaterial({ map: banner }); b.material[1] = new THREE.MeshBasicMaterial({ map: banner }); b.material[4] = post; b.material[5] = post;
    b.castShadow = true; this.scene.add(b);
  }

  /**
   * The painted lines, as geometry: the texture's own were cleaned off in the
   * bake (at 11 texels a metre they could only be blurred stripes). Nine lane
   * lines round the whole oval, 5 cm wide, and the home straight's run-out.
   */
  lines() {
    const W = 0.05, pos = [], idx = [];
    const ribbon = pts => {
      const base = pos.length / 3;
      pts.forEach((p, i) => { const nx = -p.dz * W / 2, nz = p.dx * W / 2; pos.push(p.x + nx, 0.009, p.z + nz, p.x - nx, 0.009, p.z - nz); if (i) { const a = base + (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); } });   // wound to face up
    };
    for (let i = 0; i <= TRACK.lanes; i++) {
      const R = TRACK.r0 + i * TRACK.laneW, L = 2 * (TRACK.xR - TRACK.xL) + 2 * Math.PI * R, pts = [];
      for (let s = 0; s <= L + 0.01; s += 0.5) pts.push(ovalPoint(R, s));
      ribbon(pts);
      // the run-out before the home straight (where the 100 m starts)
      const run = []; for (let x = -61; x <= TRACK.xL; x += 1) run.push({ x, z: TRACK.zc + R, dx: 1, dz: 0 }); ribbon(run);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => i % 3 === 1 ? 1 : 0), 3));   // straight up
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xf7f7f2, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.receiveShadow = true; m.name = 'laneLines'; this.scene.add(m); this.laneLines = m;
  }

  /** Put the start lines, lane blocks and hurdles where a race of `M` metres wants them (the start moves with the length). */
  layout(M) {
    this.M = M;
    if (this.startGroup) this.scene.remove(this.startGroup);
    const grp = this.startGroup = new THREE.Group(); this.scene.add(grp);
    const white = new THREE.MeshStandardMaterial({ color: 0xf6f6f6, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const k of this.lanes) {
      const p = lanePoint(k, raceS(k, 0, M));
      const l = new THREE.Mesh(new THREE.PlaneGeometry(TRACK.laneW - 0.06, 0.05), white);
      l.position.set(p.x, 0.011, p.z); l.rotation.set(-Math.PI / 2, 0, Math.atan2(-p.dz, p.dx) + Math.PI / 2);
      grp.add(l);
      const num = canvasTex(64, 64, (c) => { c.fillStyle = '#ffffff'; c.fillRect(0, 0, 64, 64); c.fillStyle = '#111'; c.font = '700 44px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(k), 32, 35); });
      const blk = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.35), new THREE.MeshStandardMaterial({ map: num }));
      const q = lanePoint(k, raceS(k, -1.4, M));
      blk.position.set(q.x, 0.17, q.z); blk.rotation.y = Math.atan2(p.dx, p.dz); blk.castShadow = true; grp.add(blk);
    }
    for (const h of this.hurdles) {
      const p = lanePoint(h.lane, raceS(h.lane, h.d, M));
      Object.assign(h, { x: p.x, z: p.z, yaw: Math.atan2(p.dx, p.dz), fall: 0, falling: false, down: false });
      this.placeHurdle(h);
    }
  }

  /**
   * The hurdles: in every racing lane at its own 35 m marks, all the way
   * round — met again every lap. One instanced mesh per part (board,
   * uprights, feet), so all of them cost three draw calls. Each can be
   * knocked over and stands back up once its lane has run on.
   */
  buildHurdles(lanes) {
    const spots = lanes.map(k => hurdleSpots(k)), n = spots.reduce((a, s) => a + s.length, 0), H = RACE.height, W = TRACK.laneW - 0.25;
    const board = canvasTex(256, 32, (c, w, h) => { for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#111111' : '#f7f7f7'; c.fillRect(i * w / 8, 0, w / 8, h); } });
    this.hBoard = new THREE.InstancedMesh(new THREE.BoxGeometry(W, 0.07, 0.025), new THREE.MeshStandardMaterial({ map: board, roughness: 0.6 }), n);
    this.hPost = new THREE.InstancedMesh(new THREE.BoxGeometry(0.035, H, 0.035), new THREE.MeshStandardMaterial({ color: 0xd8d8d8, metalness: 0.5, roughness: 0.4 }), n * 2);
    this.hFoot = new THREE.InstancedMesh(new THREE.BoxGeometry(0.04, 0.03, 0.7), new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6 }), n * 2);
    for (const m of [this.hBoard, this.hPost, this.hFoot]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; this.scene.add(m); }
    let i = 0;
    lanes.forEach((k, j) => { for (const d of spots[j]) this.hurdles.push({ i: i++, lane: k, d, lap: lapLen(k), x: 0, z: 0, yaw: 0, fall: 0, falling: false, down: false, downAt: 0 }); });
  }

  placeHurdle(h) {
    const H = RACE.height, W = TRACK.laneW - 0.25;
    const base = new THREE.Matrix4().makeRotationY(h.yaw).setPosition(h.x, 0, h.z);
    // knocked over: it pivots forward on the tips of its feet
    const tip = new THREE.Matrix4().makeTranslation(0, 0, 0.35).multiply(new THREE.Matrix4().makeRotationX(h.fall * 1.45)).multiply(new THREE.Matrix4().makeTranslation(0, 0, -0.35));
    const M = base.clone().multiply(tip), m = new THREE.Matrix4();
    this.hBoard.setMatrixAt(h.i, m.copy(M).multiply(new THREE.Matrix4().makeTranslation(0, H - 0.035, 0)));
    for (const [j, sx] of [[0, -1], [1, 1]]) {
      this.hPost.setMatrixAt(h.i * 2 + j, m.copy(M).multiply(new THREE.Matrix4().makeTranslation(sx * W / 2, H / 2, 0)));
      this.hFoot.setMatrixAt(h.i * 2 + j, m.copy(M).multiply(new THREE.Matrix4().makeTranslation(sx * W / 2, 0.015, -0.3)));
    }
    this.hBoard.instanceMatrix.needsUpdate = true; this.hPost.instanceMatrix.needsUpdate = true; this.hFoot.instanceMatrix.needsUpdate = true;
  }

  /** Knock hurdle h over (clipped by a trailing leg). */
  kick(h) { if (!h.down && !h.falling) { h.falling = true; h.downAt = this.clock || 0; } }
  resetHurdles(M = this.M) { this.layout(M); }

  update(dt) {
    this.clock = (this.clock || 0) + dt;
    for (const h of this.hurdles) {
      if (h.falling) {
        h.fall = Math.min(1, h.fall + dt * 3.2 * (0.4 + h.fall));
        if (h.fall >= 1) { h.falling = false; h.down = true; }
        this.placeHurdle(h);
      } else if (h.down && this.clock - h.downAt > 16) { h.down = false; h.fall = 0; this.placeHurdle(h); }   // stood back up for the next lap, long behind its runner
    }
  }
  /**
   * The next hurdle in lane k at or after race distance d (they come round
   * every lap), none in the last stretch. Returns the hurdle with `at` = the
   * race distance where it is met this time.
   */
  nextHurdle(k, d) {
    let best = null, bestAt = Infinity;
    for (const h of this.hurdles) {
      if (h.lane !== k) continue;
      const at = h.d + Math.max(0, Math.ceil((d - h.d - 1e-6) / h.lap)) * h.lap;
      if (at > this.M - RACE.clearEnd) continue;
      if (at < bestAt) { bestAt = at; best = h; }
    }
    if (best) best.at = bestAt;
    return best;
  }
}
