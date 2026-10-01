// What a shot leaves behind, and the gifts on the sand.
//
//   muzzle(pos)        a flash in a sniper's window
//   tracer(a, b)       the streak from the window to the player
//   blood(pos, dir)    the spray where the bullet lands
//   pool(pos)          the dark stain that spreads under a body
//   dust(pos)          sand kicked up when a body lands
//   Gift               a black box with a pink ribbon and the shape of what is inside
//
// Everything is a few quads and a points cloud, pooled and aged in update().

import * as THREE from 'three';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function radial(stops, size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d'), g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
/** A blood stain: irregular, darker at the edge where it dries. */
function stainTexture() {
  const s = 256, c = document.createElement('canvas'); c.width = c.height = s;
  const x = c.getContext('2d');
  x.translate(s / 2, s / 2);
  for (let i = 0; i < 9; i++) {
    const a = Math.random() * Math.PI * 2, r = 20 + Math.random() * 60, d = Math.random() * 40;
    const g = x.createRadialGradient(Math.cos(a) * d, Math.sin(a) * d, 0, Math.cos(a) * d, Math.sin(a) * d, r);
    g.addColorStop(0, 'rgba(92,6,8,0.95)'); g.addColorStop(0.75, 'rgba(70,4,6,0.9)'); g.addColorStop(1, 'rgba(60,2,4,0)');
    x.fillStyle = g; x.beginPath(); x.arc(Math.cos(a) * d, Math.sin(a) * d, r, 0, Math.PI * 2); x.fill();
  }
  for (let i = 0; i < 14; i++) { const a = Math.random() * Math.PI * 2, d = 70 + Math.random() * 45, r = 2 + Math.random() * 6; x.fillStyle = 'rgba(80,5,7,0.85)'; x.beginPath(); x.arc(Math.cos(a) * d, Math.sin(a) * d, r, 0, Math.PI * 2); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class FX {
  constructor(scene) {
    this.scene = scene; this.items = [];
    this.flashTex = radial([[0, 'rgba(255,250,220,1)'], [0.25, 'rgba(255,200,90,0.9)'], [0.6, 'rgba(255,120,30,0.3)'], [1, 'rgba(255,90,0,0)']]);
    this.dropTex = radial([[0, 'rgba(150,10,14,1)'], [0.6, 'rgba(120,6,10,0.9)'], [1, 'rgba(100,0,0,0)']], 32);
    this.dustTex = radial([[0, 'rgba(225,212,190,0.7)'], [1, 'rgba(225,212,190,0)']], 64);
    this.stains = [stainTexture(), stainTexture(), stainTexture()];
    // muzzle lights live in the scene for good, dark until used: adding a light
    // mid-game changes the light count and makes every material recompile (a stutter per shot)
    this.lights = [0, 1, 2, 3].map(() => { const l = new THREE.PointLight(0xffc070, 0, 14, 2); scene.add(l); return l; });
    this.lightI = 0;
  }

  _add(obj, life, tick) { this.scene.add(obj); this.items.push({ obj, age: 0, life, tick }); return obj; }

  muzzle(pos) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    m.position.copy(pos); m.scale.setScalar(1.6);
    const light = this.lights[this.lightI++ % this.lights.length]; light.position.copy(pos);
    this._add(m, 0.09, (it, k) => { m.material.opacity = 1 - k; m.scale.setScalar(1.6 + k * 1.2); light.intensity = 30 * (1 - k); });
  }

  tracer(a, b) {
    const g = new THREE.BufferGeometry().setFromPoints([a.clone(), b.clone()]);
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xfff1b8, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this._add(l, 0.07, (it, k) => { l.material.opacity = 1 - k; });
  }

  /** The doll's eyes lock on someone: a red line from the eyes to the target, for `life` seconds. */
  laser(a, getB, life = 0.6) {
    const g = new THREE.BufferGeometry().setFromPoints([a.clone(), getB()]);
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xff2030, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flashTex, color: 0xff2030, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    dot.scale.setScalar(0.18); this.scene.add(dot);
    this._add(l, life, (it, k) => {
      const b = getB(); const p = g.attributes.position; p.setXYZ(1, b.x, b.y, b.z); p.needsUpdate = true;
      dot.position.copy(b); const f = 0.6 + 0.4 * Math.sin(it.age * 60);
      l.material.opacity = f; dot.material.opacity = f; if (k >= 1) this.scene.remove(dot);
    });
  }

  /** Spray: a burst of droplets thrown along `dir`, falling, sticking to the sand as they land. */
  blood(pos, dir, n = 60) {
    const N = n, P = new Float32Array(N * 3), V = [];
    for (let i = 0; i < N; i++) {
      P[i * 3] = pos.x; P[i * 3 + 1] = pos.y; P[i * 3 + 2] = pos.z;
      const v = new THREE.Vector3((Math.random() - 0.5) * 2.2, Math.random() * 2.2 + 0.2, (Math.random() - 0.5) * 2.2).addScaledVector(dir, 2 + Math.random() * 2.5);
      V.push(v);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ map: this.dropTex, size: 0.07, transparent: true, depthWrite: false, sizeAttenuation: true }));
    this._add(pts, 1.6, (it, k, dt) => {
      const p = g.attributes.position;
      for (let i = 0; i < N; i++) {
        let y = p.getY(i); if (y <= 0.01) continue;
        V[i].y -= 9.8 * dt;
        p.setXYZ(i, p.getX(i) + V[i].x * dt, Math.max(0.01, y + V[i].y * dt), p.getZ(i) + V[i].z * dt);
      }
      p.needsUpdate = true; pts.material.opacity = k < 0.8 ? 1 : 1 - (k - 0.8) / 0.2;
    });
  }

  /** The stain under a body: grows for a few seconds, then stays. */
  pool(pos, size = 1.3) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ map: this.stains[Math.floor(Math.random() * 3)], transparent: true, depthWrite: false, roughness: 0.25, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = Math.random() * Math.PI * 2;
    m.position.set(pos.x, 0.012 + Math.random() * 0.004, pos.z); m.renderOrder = 1;
    this.scene.add(m);
    const it = { obj: m, age: 0, life: 1e9, tick: (it) => { const k = clamp(it.age / 4.5, 0, 1); m.scale.setScalar(size * (0.12 + 0.88 * (1 - Math.pow(1 - k, 2.2)))); } };
    this.items.push(it);
    return m;
  }

  dust(pos) {
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.dustTex, transparent: true, depthWrite: false }));
      s.position.set(pos.x + (Math.random() - 0.5) * 0.8, 0.15, pos.z + (Math.random() - 0.5) * 0.8);
      const v = new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.35 + Math.random() * 0.3, (Math.random() - 0.5) * 0.8);
      this._add(s, 1.3, (it, k, dt) => { s.position.addScaledVector(v, dt); s.scale.setScalar(0.4 + k * 1.2); s.material.opacity = 0.7 * (1 - k); });
    }
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]; it.age += dt;
      const k = clamp(it.age / it.life, 0, 1);
      it.tick(it, k, dt);
      if (it.age >= it.life) { this.scene.remove(it.obj); it.obj.geometry && it.obj.geometry.dispose(); it.obj.material && it.obj.material.dispose(); this.items.splice(i, 1); }
    }
  }
  clear() { for (const it of this.items) this.scene.remove(it.obj); this.items = []; for (const l of this.lights) l.intensity = 0; }
}

// ------------------------------------------------------------------ gifts

export const PERKS = {
  time:   { shape: 'circle',   title: '+10 SECONDS',  say: 'Ten more seconds on the clock.', color: '#ff2d78' },
  shield: { shape: 'triangle', title: 'A FRIEND\'S HAND', say: 'If the doll catches you once, someone holds you still.', color: '#ff2d78' },
  sprint: { shape: 'square',   title: 'SECOND WIND',  say: 'The next green light carries you half as far again.', color: '#ff2d78' },
  slow:   { shape: 'star',     title: 'LONGER GREEN', say: 'The next green light lasts longer.', color: '#ff2d78' },
};

function shapeGeometry(kind) {
  const s = new THREE.Shape();
  if (kind === 'circle') { const h = new THREE.Path(); s.absarc(0, 0, 0.13, 0, Math.PI * 2); h.absarc(0, 0, 0.085, 0, Math.PI * 2, true); s.holes.push(h); }
  else if (kind === 'triangle') { s.moveTo(0, 0.15); s.lineTo(0.14, -0.1); s.lineTo(-0.14, -0.1); s.closePath(); const h = new THREE.Path(); h.moveTo(0, 0.08); h.lineTo(-0.075, -0.06); h.lineTo(0.075, -0.06); h.closePath(); s.holes.push(h); }
  else if (kind === 'square') { s.moveTo(-0.12, -0.12); s.lineTo(0.12, -0.12); s.lineTo(0.12, 0.12); s.lineTo(-0.12, 0.12); s.closePath(); const h = new THREE.Path(); h.moveTo(-0.075, -0.075); h.lineTo(-0.075, 0.075); h.lineTo(0.075, 0.075); h.lineTo(0.075, -0.075); h.closePath(); s.holes.push(h); }
  else { for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.06 : 0.15; i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r); } s.closePath(); }
  return new THREE.ExtrudeGeometry(s, { depth: 0.025, bevelEnabled: false });
}

/** The black box with the pink ribbon — the show's gift box — and the shape of what is inside floating over it. */
export class Gift {
  constructor(scene, kind, x, z) {
    this.kind = kind; this.x = x; this.z = z; this.taken = false; this.scene = scene;
    const g = this.group = new THREE.Group(); g.position.set(x, 0, z);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.34), new THREE.MeshStandardMaterial({ color: 0x111114, roughness: 0.35, metalness: 0.2 }));
    box.position.y = 0.12; box.castShadow = true; g.add(box);
    const pink = new THREE.MeshStandardMaterial({ color: 0xff2d78, roughness: 0.4, emissive: 0xff2d78, emissiveIntensity: 0.25 });
    const r1 = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.25, 0.06), pink); r1.position.y = 0.12; g.add(r1);
    const r2 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.25, 0.36), pink); r2.position.y = 0.12; g.add(r2);
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.02, 8, 20), pink); bow.position.y = 0.26; bow.rotation.y = Math.PI / 4; g.add(bow);
    const icon = this.icon = new THREE.Mesh(shapeGeometry(PERKS[kind].shape), new THREE.MeshStandardMaterial({ color: 0xff2d78, emissive: 0xff2d78, emissiveIntensity: 1.3, roughness: 0.3 }));
    icon.position.y = 0.62; g.add(icon);
    const glow = this.glow = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.42, 40), new THREE.MeshBasicMaterial({ color: 0xff2d78, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
    glow.rotation.x = -Math.PI / 2; glow.position.y = 0.015; g.add(glow);
    scene.add(g);
  }
  update(t, dt) {
    if (this.taken) {
      // into your hand: it flies up to the palm, shrinks, and is gone
      this.takeT = (this.takeT || 0) + dt;
      const k = Math.min(1, this.takeT / 0.4), e = k * k * (3 - 2 * k);
      if (this.to) { const p = this.to(); this.group.position.lerpVectors(this.from, p, e); this.group.position.y -= 0.12 * (1 - e); }
      else this.group.position.y = k * 0.9;
      this.group.scale.setScalar(Math.max(0.01, 1 - 0.8 * e)); this.icon.rotation.y += dt * 20; this.glow.visible = false;
      if (k >= 1) this.group.visible = false;
      return;
    }
    this.icon.rotation.y = t * 1.8; this.icon.position.y = 0.62 + Math.sin(t * 2.4) * 0.05;
    this.glow.material.opacity = 0.25 + 0.15 * Math.sin(t * 4);
  }
  /** @param to () => world point to fly to (the hand), optional */
  take(to) { this.taken = true; this.to = to || null; this.from = this.group.position.clone(); }
  dispose() { this.scene.remove(this.group); }
}
