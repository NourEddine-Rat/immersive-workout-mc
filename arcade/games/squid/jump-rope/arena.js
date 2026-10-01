// The rope bridge: "Jump Rope" (DodoBabypop, CC-BY-SA — see the credit line),
// baked by tools/bake.mjs into models/arena.glb.
//
// Measured on the model (metres, y up, you cross toward +z):
//   start platform  z −29.7 … −16.94, floor y 0.42, on a rock pillar 41 m high
//   the bridge      z −16.67 … +16.67, a rail track ~1 m wide, deck top y 0.276
//   the gap         z −0.79 … +0.72 — the middle of the bridge is missing
//   far platform    z +16.94 … +29.7
//   Young-hee       at the start, z ≈ −22, straddling the way in (her feet x −1.4 / +1.2)
//   Cheol-su        at the far end, z ≈ +22
//   the rope        from handle tips at z −17.8 / +17.6, on the line x 0.027, y 9.273
//   the pit floor   y −40.9 (flowers), red and yellow rings on the walls
//   the timer       a screen on the wall at x +32 (material TimerScreen)
//   a traffic light on the pole at the start (Green_Light / RedLight)
//
// The model's own rope (FlatRope) is a fixed arch with a short animation;
// it is hidden and the rope here is drawn from rules.js, so what you see is
// exactly what can hit you.

import * as THREE from 'three';
import { ROPE, ropePoint } from './rules.js';

export class Arena {
  constructor(scene) { this.scene = scene; this.clockShown = null; }

  async load(loader, url = './models/arena.glb') {
    const g = await loader.loadAsync(url);
    const root = this.root = g.scene;
    this.scene.add(root);
    root.updateMatrixWorld(true);
    let green = null, red = null; const girl = [], boy = [];
    root.traverse(o => {
      if (!o.isMesh) return;
      const mn = (o.material && o.material.name) || '';
      if (/FlatRope/.test(o.name) || mn === 'Rope') o.visible = false;
      if (mn === 'Green_Light') green = o;
      if (mn === 'RedLight') red = o;
      if (/Body21|Head1|Other1/.test(mn)) girl.push(o);
      if (/Body11|Handle1|Leftlowerleg1|Rshoecherubpunk2/.test(mn)) boy.push(o);
      o.receiveShadow = /Stone|Wood|Rail|MetalPlate|RockFloor|Edge/.test(mn);
      o.castShadow = /Body|Head|Other1|Handle1|shoe|lowerleg/i.test(mn);
    });
    // the dolls on pivots at their feet, so they can rock with the turning of the rope
    const pivot = (parts, z) => { const p = new THREE.Group(); p.position.set(0, ROPE.floorY, z); root.add(p); p.updateMatrixWorld(true); for (const o of parts) p.attach(o); return p; };
    this.girl = pivot(girl, -22.1); this.boy = pivot(boy, 21.6);

    // the traffic light at the start
    this.lights = { green, red };
    for (const m of [green, red]) if (m) { m.material = m.material.clone(); m.material.toneMapped = false; }
    this.setGo(false);

    // the rope: a thick braid, and two faint copies trailing it (it moves 30 m/s at the bottom — without them it strobes)
    const N = 90, pts = [];
    for (let i = 0; i <= N; i++) { const z = ROPE.zA + (ROPE.zB - ROPE.zA) * i / N; const [x, y] = ropePoint(z, 0); pts.push(new THREE.Vector3(x - ROPE.axisX, y - ROPE.axisY, z)); }
    const curve = new THREE.CatmullRomCurve3(pts);
    const ropeTex = (() => { const c = document.createElement('canvas'); c.width = 64; c.height = 16; const x = c.getContext('2d'); x.fillStyle = '#e8dcc2'; x.fillRect(0, 0, 64, 16); x.strokeStyle = '#b89f76'; x.lineWidth = 4; for (let i = -16; i < 80; i += 12) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 10, 16); x.stroke(); } const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(160, 1); t.colorSpace = THREE.SRGBColorSpace; return t; })();
    this.rope = new THREE.Group(); this.rope.position.set(ROPE.axisX, ROPE.axisY, 0); root.add(this.rope);
    const main = new THREE.Mesh(new THREE.TubeGeometry(curve, 240, 0.075, 8, false), new THREE.MeshStandardMaterial({ map: ropeTex, roughness: 0.85 }));
    main.castShadow = true; this.rope.add(main);
    this.ghosts = [0.06, 0.12, 0.18].map((lag, i) => {
      const gm = new THREE.Mesh(main.geometry, new THREE.MeshBasicMaterial({ color: 0xe8dcc2, transparent: true, opacity: 0.28 - i * 0.08, depthWrite: false }));
      const holder = new THREE.Group(); holder.position.copy(this.rope.position); holder.add(gm); root.add(holder);
      return { holder, lag };
    });
    this.setRope(Math.PI, 0);

    // the timer on the wall: the model's screen has no texture coordinates, so a panel of our own sits
    // flush on it (measured: x 32.05, y 11.79 … 14.73, z −5.07 … 5.07, facing the bridge)
    {
      const c = this.clockCanvas = document.createElement('canvas'); c.width = 1024; c.height = 294;
      const t = this.clockTex = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(10.1, 2.9), new THREE.MeshBasicMaterial({ map: t, toneMapped: false }));
      panel.position.set(32.035, 13.26, 0); panel.rotation.y = -Math.PI / 2;
      root.add(panel);
      this.setClock(150);
    }

    // light: a warm hall, the sun high over the bridge so the rope's shadow crosses it
    this.scene.add(new THREE.HemisphereLight(0xf2f0ff, 0x6b5a4a, 1.25));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.0);
    sun.position.set(6, 34, -6); sun.target.position.set(0, 0, 0);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 32, bottom: -32, near: 1, far: 80 });
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03;
    this.scene.add(sun, sun.target);
    return this;
  }

  /** The rope at angle θ (0 = under the bridge); `omega` for the trail. */
  setRope(theta, omega) {
    this.rope.rotation.z = theta;
    for (const g of this.ghosts) { g.holder.rotation.z = theta - g.lag * Math.min(1, omega / 3.5) * 2; g.holder.visible = omega > 1.2; }
    // the dolls lean into each turn a little (their arms are part of the body mesh)
    const s = Math.sin(theta) * 0.018;
    this.girl.rotation.z = s; this.boy.rotation.z = -s;
  }

  setGo(go) {
    const { green, red } = this.lights;
    if (green) { green.material.emissive = new THREE.Color(0x14ff5a); green.material.emissiveIntensity = go ? 3 : 0.05; }
    if (red) { red.material.emissive = new THREE.Color(0xff1a1a); red.material.emissiveIntensity = go ? 0.05 : 3; }
  }

  setClock(sec) {
    if (!this.clockCanvas) return;
    const s = Math.max(0, Math.ceil(sec));
    if (s === this.clockShown) return;
    this.clockShown = s;
    const x = this.clockCanvas.getContext('2d'), W = this.clockCanvas.width, H = this.clockCanvas.height;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.fillStyle = '#060606'; x.fillRect(0, 0, W, H);
    x.setTransform(this.clockFlip ? -1 : 1, 0, 0, this.clockFlipV ? -1 : 1, this.clockFlip ? W : 0, this.clockFlipV ? H : 0);
    const txt = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = '700 230px "Courier New", ui-monospace, monospace';
    x.shadowColor = 'rgba(255,40,30,0.9)'; x.shadowBlur = 26; x.fillStyle = s <= 30 && s % 2 ? '#ff7a70' : '#ff2a20';
    x.fillText(txt, W / 2, H / 2 + 8); x.shadowBlur = 0;
    x.setTransform(1, 0, 0, 1, 0, 0);
    this.clockTex.needsUpdate = true;
  }
}
