// The field: "Squid Game - Red Light Green Light - Game Room" (JohnWick007,
// CC-BY-NC-SA — see the credit line), baked by tools/bake.mjs into
// models/arena.glb (the 675k-triangle steel window frames dropped: from the
// sand they are a hairline).
//
// What the model holds, measured (metres, y up, the doors at −z, the doll at +z):
//   sand           x ±20.15, z −38 … +38
//   walls          x ±20.3, z −36.2 … +36.9, 19 m high, a painted sky and meadow
//   doors          three little houses on the back wall, z ≈ −36.6 (x −14, 0, +14)
//   the red line   z 27.38 … 27.80, the whole width
//   the doll       x 0, z ≈ 29.5, 4.9 m tall; head a separate mesh (3.75 … 4.9)
//   the tree       behind her, z 29.4 … 37.2
//   the clock      a screen on the far wall, y 8.5 … 9.8 (material "screen")
//   snipers        14 windows at y ≈ 16: ten on the far wall, two on each side wall
// The room has no ceiling in the model; one is painted here, in the walls' sky.
//
// The doll is turned here to face the tree (as in the show), and her head
// gets its own pivot at the neck, so it — and only it — swings round.

import * as THREE from 'three';

export const FIELD = {
  startZ: -32.5,       // where the players line up (the doors are at −35.6)
  lineZ0: 27.38,       // the red line's near edge
  lineZ: 27.8,         // ...and its far edge: across it, you are safe
  halfW: 20.1,
  dollZ: 29.47,
  eyeY: 4.357,         // her eyes, measured on the eye mesh: centres x ±0.1605, surface at z 29.167, 18 cm wide
  eyeX: 0.1605,
  eyeZ: 29.167,
};

export const SNIPERS = [17.94, 13.94, 9.98, 6.0, 2.06, -1.91, -5.88, -9.85, -13.81, -17.78].map(x => new THREE.Vector3(x, 15.95, 36.45))
  .concat([[-20.2, 34.39], [-20.2, 30.44], [20.2, 34.37], [20.2, 30.43]].map(([x, z]) => new THREE.Vector3(x * 0.98, 15.95, z)));

export class Arena {
  constructor(scene) { this.scene = scene; this.clockShown = null; }

  async load(loader, url = './models/arena.glb') {
    const g = await loader.loadAsync(url);
    const root = this.root = g.scene;
    this.scene.add(root);
    root.updateMatrixWorld(true);
    const byName = n => root.getObjectByName(n);
    root.traverse(o => {
      if (!o.isMesh) return;
      o.receiveShadow = /sand|Plane|red_line/i.test(o.name + (o.material && o.material.name));
      o.castShadow = false;
      const m = o.material;
      if (m && m.name === 'walls') { m.side = THREE.FrontSide; m.roughness = 1; }
      if (m && m.name === 'Sand') { m.roughness = 1; m.metalness = 0; }
    });

    // --- the doll: body turned to the tree, head on its own neck pivot
    const doll = byName('doll');
    const box = new THREE.Box3().setFromObject(doll);
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    this.dollBody = new THREE.Group(); this.dollBody.position.set(cx, 0, cz); root.add(this.dollBody);
    this.dollHead = new THREE.Group(); this.dollHead.position.set(cx, 3.86, cz); root.add(this.dollHead);
    this.dollHead.updateMatrixWorld(true); this.dollBody.updateMatrixWorld(true);
    const headParts = [];
    doll.traverse(o => { if (o.isMesh && /HEAD/.test(o.name) || (o.isMesh && o.parent && /HEAD/.test(o.parent.name))) headParts.push(o); });
    for (const o of headParts) this.dollHead.attach(o);
    this.dollBody.attach(doll);
    doll.traverse(o => { if (o.isMesh) o.castShadow = true; });
    for (const o of headParts) o.castShadow = true;
    // her eyes: two red lights that open when she looks
    const eyeTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,60,60,1)'); gr.addColorStop(0.55, 'rgba(255,0,20,0.35)'); gr.addColorStop(1, 'rgba(255,0,0,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
    // flush on each eye: a red disc lying on the eye's own surface (it cannot drift off it from any
    // angle), and a soft halo sprite just in front of it for the glow
    this.eyes = []; this.irises = [];
    for (const dx of [-FIELD.eyeX, FIELD.eyeX]) {
      const iris = new THREE.Mesh(new THREE.CircleGeometry(0.066, 32), new THREE.MeshBasicMaterial({ color: 0xff1a28, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      iris.position.set(cx + dx, FIELD.eyeY, FIELD.eyeZ - 0.004); iris.rotation.y = Math.PI;   // faces the players (−z)
      this.dollHead.attach(iris); this.irises.push(iris);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: eyeTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0, toneMapped: false }));
      s.position.set(cx + dx, FIELD.eyeY, FIELD.eyeZ - 0.012); s.scale.setScalar(0.3);
      this.dollHead.attach(s); this.eyes.push(s);
    }
    this.eyeLight = new THREE.PointLight(0xff2030, 0, 12, 2); this.eyeLight.position.set(cx, FIELD.eyeY, FIELD.eyeZ - 1.4); this.dollHead.attach(this.eyeLight);
    // the sweep: a thin red fan from her eyes to the sand
    const fan = new THREE.BufferGeometry();
    fan.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -1.2, -FIELD.eyeY, -30, 1.2, -FIELD.eyeY, -30], 3));
    fan.setAttribute('uv', new THREE.Float32BufferAttribute([0.5, 0, 0, 1, 1, 1], 2));
    const fanTex = (() => { const c = document.createElement('canvas'); c.width = 64; c.height = 128; const x = c.getContext('2d'); const gr = x.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, 'rgba(255,40,50,0.9)'); gr.addColorStop(1, 'rgba(255,20,40,0.05)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 128); const h = x.createLinearGradient(0, 0, 64, 0); h.addColorStop(0, 'rgba(0,0,0,1)'); h.addColorStop(0.5, 'rgba(0,0,0,0)'); h.addColorStop(1, 'rgba(0,0,0,1)'); x.globalCompositeOperation = 'destination-out'; x.fillStyle = h; x.fillRect(0, 0, 64, 128); const t = new THREE.CanvasTexture(c); return t; })();
    this.scanFan = new THREE.Mesh(fan, new THREE.MeshBasicMaterial({ map: fanTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.scanFan.position.set(cx, FIELD.eyeY, FIELD.eyeZ - 0.02);
    root.add(this.scanFan);
    this.eyeWorld = new THREE.Vector3(cx, FIELD.eyeY, FIELD.eyeZ - 0.02);
    this.dollBody.rotation.y = Math.PI;            // her back to the players, facing the tree
    this.setHead(0);

    // --- the clock on the far wall
    const screenMesh = (() => { let s = null; root.traverse(o => { if (o.isMesh && o.material && o.material.name === 'screen') s = o; }); return s; })();
    if (screenMesh) {
      const c = this.clockCanvas = document.createElement('canvas'); c.width = 1024; c.height = 512;
      const t = this.clockTex = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.flipY = false;
      screenMesh.material = new THREE.MeshBasicMaterial({ map: t, toneMapped: false });
      this.setClock(180);
    }

    // --- the ceiling: the painted sky carried over the top
    const sky = (() => { const c = document.createElement('canvas'); c.width = 256; c.height = 512; const x = c.getContext('2d'); const gr = x.createLinearGradient(0, 0, 0, 512); gr.addColorStop(0, '#7fa6bf'); gr.addColorStop(0.5, '#9dbccf'); gr.addColorStop(1, '#7fa6bf'); x.fillStyle = gr; x.fillRect(0, 0, 256, 512);
      for (let i = 0; i < 40; i++) { const px = Math.random() * 256, py = Math.random() * 512, r = 20 + Math.random() * 50; const cg = x.createRadialGradient(px, py, 0, px, py, r); cg.addColorStop(0, 'rgba(235,242,246,0.35)'); cg.addColorStop(1, 'rgba(235,242,246,0)'); x.fillStyle = cg; x.fillRect(px - r, py - r, r * 2, r * 2); }
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(40.8, 73.6), new THREE.MeshBasicMaterial({ map: sky, side: THREE.DoubleSide }));
    ceil.rotation.x = Math.PI / 2; ceil.position.set(0, 18.9, 0.35); root.add(ceil);

    // --- light: a bright hall, the sun high over the doll's shoulder
    const hemi = new THREE.HemisphereLight(0xe8f0f6, 0xb7a383, 1.35); this.scene.add(hemi);
    const sun = this.sun = new THREE.DirectionalLight(0xfff3e0, 2.3);
    sun.position.set(-8, 30, 20); sun.target.position.set(0, 0, -2);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 44, bottom: -44, near: 1, far: 90 });
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
    this.scene.add(sun, sun.target);
    this.scene.fog = new THREE.Fog(0xb9ccd8, 60, 160);
    return this;
  }

  /** 0 = her face to the tree, 1 = to the players. */
  setHead(k) {
    this.headK = k;
    this.dollHead.rotation.y = Math.PI * (1 + k);      // body faces the tree (π); the head swings a further π round to the players
    // the head is not a child of the body group: keep it where the neck is
    const eyesOn = Math.max(0, (k - 0.85) / 0.15);
    for (const e of this.eyes) e.material.opacity = eyesOn;
    for (const e of this.irises) e.material.opacity = eyesOn * 0.95;
    this.eyeLight.intensity = 1.2 * eyesOn;
  }

  /** The sweep of her eyes while she watches: `on` 0–1, `t` seconds. */
  setScan(on, t) {
    this.scanFan.material.opacity = 0.16 * on;
    this.scanFan.rotation.y = Math.sin(t * 1.3) * 0.55;
    for (const e of this.eyes) e.scale.setScalar(0.3 + 0.04 * Math.sin(t * 18) * on);
  }

  setClock(sec) {
    if (!this.clockCanvas) return;
    const s = Math.max(0, Math.ceil(sec));
    if (s === this.clockShown) return;
    this.clockShown = s;
    const x = this.clockCanvas.getContext('2d'), W = 1024, H = 512;
    x.fillStyle = '#060606'; x.fillRect(0, 0, W, H);
    const txt = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    x.setTransform(1, 0, 0, -1, 0, H);   // the screen's UVs run bottom to top: draw flipped so it reads the right way
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = '700 300px "DSEG7 Classic", "Courier New", ui-monospace, monospace';
    x.shadowColor = 'rgba(255,40,30,0.9)'; x.shadowBlur = 30; x.fillStyle = s <= 30 && s % 2 ? '#ff7a70' : '#ff2a20';
    x.fillText(txt, W / 2, H / 2 + 10); x.shadowBlur = 0; x.setTransform(1, 0, 0, 1, 0, 0);
    this.clockTex.needsUpdate = true;
  }

  /** The nearest sniper window to a point (the one that fires). */
  sniperFor(p) { let best = SNIPERS[0], d = Infinity; for (const s of SNIPERS) { const dd = Math.abs(s.x - p.x) + Math.random() * 6; if (dd < d) { d = dd; best = s; } } return best; }
}
