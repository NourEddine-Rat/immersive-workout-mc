// The dog, chasing. It runs BEHIND you in your lane, at the gap the run
// state says, so it is out of sight while you run — and right there, nose
// first, the moment you look back.
//
// The model is one mesh, no skeleton, so the run is procedural: a gallop
// bounce with the body stretching on the way up and bunching on the way
// down, a pitch with each bound, a little roll, and a shadow on the rails so
// it reads as on the ground and not floating. When it is very close it bobs
// its head up (a snap) instead of the even gallop.
//
// "Subway Surfers Dog" by Rajio123 (sketchfab.com/Rajio123), CC-BY-4.0.

import * as THREE from 'three';
import { loadGltfPatched, index16 } from './world.js';
import { LANE_X } from './lanes.js';

const HEIGHT = 1.3;           // metres tall, standing (the eye is 1.55 m up): a big dog reads at 6 m
const SHOW_GAP = 40;          // further back than this it is not drawn at all

export class DogChase {
  constructor(scene) {
    this.scene = scene; this.node = null; this.body = null; this.shadow = null;
    this.phase = 0; this.x = 0; this.gap = 20; this.t = 0;
  }

  async load() {
    try {
      const gltf = await loadGltfPatched('./models/dog/chase-dog.gltf');
      const root = gltf.scene;
      root.traverse(o => { if (o.isMesh) { index16(o.geometry); const m = o.material; o.material = new THREE.MeshLambertMaterial({ map: m.map, color: 0xffffff }); if (m.map) m.map.colorSpace = THREE.SRGBColorSpace; } });
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const s = HEIGHT / size.y;
      root.scale.setScalar(s);
      const b2 = new THREE.Box3().setFromObject(root);
      root.position.y = -b2.min.y;
      root.position.z = -(b2.min.z + b2.max.z) / 2;      // pivot at the body's centre, so pitch rocks about the middle
      this.length = size.z * s;
      const body = new THREE.Group(); body.add(root);
      const holder = new THREE.Group(); holder.add(body);
      // a soft shadow: the one cue that puts it on the rails instead of in the air
      const sh = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }));
      sh.rotation.x = -Math.PI / 2; sh.scale.set(1, 1.6, 1); sh.position.y = 0.02;
      holder.add(sh);
      this.node = holder; this.body = body; this.shadow = sh;
      this.node.visible = false;
      this.scene.add(this.node);
      return true;
    } catch (e) { console.warn('[dog] could not load', e); return false; }
  }

  /**
   * @param dt      seconds
   * @param gap     metres behind the player (from RunState)
   * @param player  { lane, distance, speed }
   * @param drawGap where to DRAW it, if not at the true gap (the look back pulls it in so it fills the view)
   */
  update(dt, gap, player, drawGap = gap) {
    if (!this.node) return;
    this.t += dt; this.gap = gap; gap = drawGap;
    const near = gap < SHOW_GAP;
    this.node.visible = near;
    if (!near) return;
    // it follows your lane, a beat late — a dog cuts the corner, it does not teleport
    this.x += (LANE_X[player.lane] - this.x) * Math.min(1, dt * 4);
    const z = -(player.distance - gap);
    // gallop: stride rate with speed; when it is right on you it is a lunge, slower and bigger
    const close = gap < 3;
    const hz = close ? 1.6 : 2.0 + player.speed * 0.07;
    this.phase += dt * hz * 2 * Math.PI;
    const c = Math.cos(this.phase), sn = Math.sin(this.phase);
    const bounce = Math.max(0, sn) * (close ? 0.34 : 0.2) + 0.02;
    this.node.position.set(this.x, 0, z);
    this.node.rotation.y = Math.PI;                       // nose down the track, at you when you look back
    // the body: pitch nose-up on the way up, nose-down on the way down; stretch when airborne, bunch on landing
    this.body.position.y = bounce;
    this.body.rotation.x = -c * (close ? 0.22 : 0.14);
    this.body.rotation.z = Math.sin(this.phase * 0.5) * 0.06;
    const stretch = 1 + Math.max(0, sn) * 0.10;
    this.body.scale.set(1, 1 - (stretch - 1) * 0.6, stretch);
    // the shadow shrinks and fades as it leaves the ground
    const air = Math.min(1, bounce / 0.3);
    this.shadow.scale.set(1 - air * 0.25, 1.6 - air * 0.4, 1);
    this.shadow.material.opacity = 0.32 - air * 0.14;
  }

  hide() { if (this.node) this.node.visible = false; }
}
