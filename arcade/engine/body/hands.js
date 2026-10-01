// Your hands, in front of you.
//
// FREE GameReady FPS Female Arms (BAMEN, CC-BY) — a rig and five still poses.
// The poses give the fingers (a fist, an open hand, a heart); where the hands
// ARE comes from two-bone IK (rig.js reach), so any movement is just a path
// for two points: the pump of a run, a freeze holding whatever the stride was,
// the tremble of fear, the palms up of someone who knows they moved, a hand
// reaching down to the sand, the arms flung out as the shot lands.
//
// The model is bare skin; the sleeves of the tracksuit are painted on in the
// shader from the skin weights (anything the upper arm or forearm moves is
// sleeve, the hand is skin), so the cuff sits exactly at the wrist.

import * as THREE from 'three';
import { reach } from './rig.js';

const S = 0.38;                                  // model units → metres
const EYE = new THREE.Vector3(0, 3.87 + 0.66, -0.12);   // where the eyes sit in model units (the shoulders' centre is 0, 3.87, 0)
const SLEEVE = new THREE.Color('#0d5a47');
const HEART_AT = new THREE.Vector3(0, 0.12, -0.05);   // camera-space nudge of the whole arms while making the heart: raised into the middle of the view
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

export class Hands {
  /** @param opts.sleeve a colour for the painted sleeves, or null for bare arms (default: the tracksuit's green) */
  constructor(camera, opts = {}) {
    this.sleeveColor = opts.sleeve === undefined ? SLEEVE : (opts.sleeve === null ? null : new THREE.Color(opts.sleeve));
    this.camera = camera;
    this.group = new THREE.Group(); this.group.name = 'hands';
    camera.add(this.group);
    this.poses = {};
    this.state = 'idle'; this.t = 0; this.phase = 0; this.pace = 0; this.fear = 0; this.grip = 0.6; this.heart = 0;
    this.reachFor = null;           // a world point the right hand goes to (the gift on the sand)
    this.flinchAt = -9; this.jumpAt = -9; this.shotAt = -9; this.caughtAt = -9; this.winAt = -9;
    this.cur = { L: new THREE.Vector3(-0.2, -0.36, -0.36), R: new THREE.Vector3(0.2, -0.36, -0.36) };
    this.visible = true;
  }

  async load(url, loader) {
    const g = await loader.loadAsync(url);
    this.model = g.scene;
    this.model.scale.setScalar(S);
    this.model.position.copy(EYE).multiplyScalar(-S);
    this.group.add(this.model);
    const bones = {};
    this.model.traverse(o => {
      if (o.isBone) bones[o.name.replace(/_\d+$/, '').replace(/[._]/g, '')] = o;
      if (o.isSkinnedMesh) { o.frustumCulled = false; o.castShadow = false; o.renderOrder = 10; if (this.sleeveColor) this._sleeve(o); }
    });
    this.bones = bones;
    // the fingers of each still pose, captured once
    const mixer = new THREE.AnimationMixer(this.model);
    const grab = name => {
      const clip = g.animations.find(a => a.name.startsWith(name)); if (!clip) return null;
      mixer.stopAllAction(); const a = mixer.clipAction(clip); a.reset().play(); mixer.update(0);
      const p = {}; for (const k in bones) p[k] = bones[k].quaternion.clone(); a.stop(); return p;
    };
    this.poses.rest = {}; for (const k in bones) this.poses.rest[k] = bones[k].quaternion.clone();
    this.poses.fist = grab('Fists'); this.poses.open = grab('Throw'); this.poses.heart = grab('Heart');
    mixer.stopAllAction(); mixer.uncacheRoot(this.model);
    for (const k in bones) bones[k].quaternion.copy(this.poses.fist[k]);
    return this;
  }

  _sleeve(mesh) {
    const names = mesh.skeleton.bones.map(b => b.name.replace(/_\d+$/, '').replace(/[._]/g, ''));
    const idx = ['ShoulderL', 'Shoulder2L', 'ForearmL', 'ShoulderR', 'Shoulder2R', 'ForearmR'].map(n => names.indexOf(n));
    const m = mesh.material;
    m.onBeforeCompile = sh => {
      sh.uniforms.uSleeveA = { value: new THREE.Vector4(idx[0], idx[1], idx[2], idx[3]) };
      sh.uniforms.uSleeveB = { value: new THREE.Vector2(idx[4], idx[5]) };
      sh.uniforms.uSleeveColor = { value: this.sleeveColor };
      sh.vertexShader = 'uniform vec4 uSleeveA; uniform vec2 uSleeveB; varying float vSleeve;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vSleeve = 0.0;
        #ifdef USE_SKINNING
        for (int i = 0; i < 4; i++) { float j = skinIndex[i];
          if (abs(j - uSleeveA.x) < 0.5 || abs(j - uSleeveA.y) < 0.5 || abs(j - uSleeveA.z) < 0.5 || abs(j - uSleeveA.w) < 0.5 || abs(j - uSleeveB.x) < 0.5 || abs(j - uSleeveB.y) < 0.5) vSleeve += skinWeight[i]; }
        #endif`);
      sh.fragmentShader = 'uniform vec3 uSleeveColor; varying float vSleeve;\n' + sh.fragmentShader
        .replace('#include <map_fragment>', `#include <map_fragment>
          float sleeveK = smoothstep(0.45, 0.8, vSleeve);
          diffuseColor.rgb = mix(diffuseColor.rgb, uSleeveColor * (0.8 + 0.35 * diffuseColor.g), sleeveK);`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, 0.92, sleeveK);`);
    };
    m.needsUpdate = true;
  }

  // ------------------------------------------------------------ the moments
  flinch(t) { this.flinchAt = t; }
  jump(t) { this.jumpAt = t; }
  caught(t) { this.caughtAt = t; this.state = 'caught'; }
  shot(t) { this.shotAt = t; this.state = 'shot'; }
  win(t) { this.winAt = t; this.state = 'win'; }
  reset() { this.state = 'idle'; this.caughtAt = this.shotAt = this.winAt = this.flinchAt = this.jumpAt = -9; this.fear = 0; this.reachFor = null; this.heart = 0; }

  /**
   * @param dt, t    seconds
   * @param o        { moving, pace m/s, cadence Hz, frozen (red light, holding still), fear 0–1, crouch 0–1 }
   * @returns the camera bob to apply this frame {y, roll}
   */
  update(dt, t, o) {
    if (!this.model) return { y: 0, roll: 0 };
    this.t = t;
    const B = this.bones, P = this.poses;
    this.fear += ((o.fear || 0) - this.fear) * (1 - Math.exp(-dt / 0.25));
    this.pace += ((o.moving ? o.pace : 0) - this.pace) * (1 - Math.exp(-dt / 0.25));
    const run = clamp(this.pace / 2.4, 0, 1);
    if (o.moving && !o.frozen) this.phase += Math.PI * Math.max(1.4, o.cadence || 2.2) * dt;

    // ---- where each hand wants to be (camera space, metres)
    let L, R, gripWant = 0.72 + 0.28 * run, heartWant = 0, openWant = 0;
    const sw = Math.sin(this.phase), amp = clamp(this.pace / 1.2, 0, 1);
    const baseY = -0.3 + 0.06 * run, baseZ = -0.4 - 0.03 * run;
    L = _v.set(-0.19 - 0.02 * run, baseY + 0.06 * amp * sw, baseZ - 0.11 * amp * sw).clone();
    R = _w.set(0.19 + 0.02 * run, baseY - 0.06 * amp * sw, baseZ + 0.11 * amp * sw).clone();
    // breathing, faster with fear
    const br = Math.sin(t * 1.4) * 0.004;
    L.y += br; R.y += br;

    if (o.frozen) {
      // hold the pose the light caught; fear rises into a tremble and the fists close tight
      if (!this.hold) this.hold = { L: this.cur.L.clone(), R: this.cur.R.clone() };
      L.copy(this.hold.L); R.copy(this.hold.R);
      gripWant = this.grip;               // the fingers stay as they were, too
    } else this.hold = null;
    const tr = 0;   // no tremble: it read as shaking
    if (tr > 0) for (const [h, k] of [[L, 1], [R, 2.3]]) { h.x += Math.sin(t * 23 + k) * tr; h.y += Math.sin(t * 29 + k * 2) * tr; h.z += Math.sin(t * 17 + k * 3) * tr * 0.6; }

    // someone just fell near you: the hands jerk up toward the face, then back
    const fl = t - this.flinchAt;
    if (fl < 0.7 && !o.frozen) { const k = Math.sin(clamp(fl / 0.7, 0, 1) * Math.PI) * 0.8; L.lerp(_v.set(-0.12, -0.12, -0.3), k); R.lerp(_w.set(0.12, -0.14, -0.3), k); }

    // jump: both arms swing up and come back down
    const jp = t - this.jumpAt;
    if (jp < 0.75) { const k = Math.sin(clamp(jp / 0.75, 0, 1) * Math.PI); L.y += 0.16 * k; R.y += 0.16 * k; L.z -= 0.08 * k; R.z -= 0.08 * k; }
    // the gift: the right hand goes to it
    if (this.reachFor) {
      const local = this.camera.worldToLocal(this.reachFor.clone());
      R.lerp(local, clamp(o.crouch || 0, 0, 1) * 0.9); gripWant = 0.25;
    }
    // caught: palms up, "no — wait"
    const cg = t - this.caughtAt;
    if (this.state === 'caught' || (this.state === 'shot' && cg < 3)) {
      const k = clamp(cg / 0.35, 0, 1);
      L.lerp(_v.set(-0.17, -0.06 + Math.sin(t * 20) * 0.01, -0.33), k); R.lerp(_w.set(0.17, -0.05 + Math.sin(t * 23) * 0.01, -0.33), k);
      gripWant = lerp(gripWant, 0, k); openWant = k;
    }
    // shot: thrown out and up, then dropped — out of sight as you go down
    const sh = t - this.shotAt;
    if (this.state === 'shot') {
      const up = Math.exp(-sh * 5) * Math.min(1, sh / 0.05);
      L.x -= 0.12 * up; R.x += 0.15 * up; L.y += 0.12 * up; R.y += 0.08 * up;
      const drop = clamp((sh - 0.25) / 0.9, 0, 1);
      L.lerp(_v.set(-0.35, -0.85, -0.25), drop * drop); R.lerp(_w.set(0.3, -0.9, -0.2), drop * drop);
      gripWant = 0.2; openWant = 1;
    }
    // made it: fists up, then a heart for the camera
    const wn = t - this.winAt;
    if (this.state === 'win' && wn > 6.2) this.state = 'idle';        // then the arms come down and you watch
    if (this.state === 'win') {
      const up = clamp(wn / 0.3, 0, 1) * (wn < 1.8 ? 1 : 0);
      const pump = Math.abs(Math.sin(wn * 7)) * 0.04;
      L.lerp(_v.set(-0.22, 0.06 + pump, -0.4), up); R.lerp(_w.set(0.22, 0.06 + pump, -0.4), up); gripWant = 1;
      if (wn >= 1.8) { const k = clamp((wn - 1.8) / 0.5, 0, 1); L.lerp(_v.set(-0.04, -0.1, -0.36), k); R.lerp(_w.set(0.04, -0.1, -0.36), k); heartWant = k; }
    }

    // ease toward the targets (a freeze is instant; everything else has weight)
    const ease = o.frozen ? 1 : 1 - Math.exp(-dt / (this.state === 'shot' ? 0.05 : 0.07));
    this.cur.L.lerp(L, ease); this.cur.R.lerp(R, ease);
    this.grip += (gripWant - this.grip) * (1 - Math.exp(-dt / 0.12));
    this.heart += (heartWant - this.heart) * (1 - Math.exp(-dt / 0.15));
    this.open = (this.open || 0) + (openWant - (this.open || 0)) * (1 - Math.exp(-dt / 0.1));

    // ---- fingers: relaxed → fist by grip; spread palms when pleading; a heart when celebrating
    for (const k in B) {
      const q = B[k].quaternion;
      q.copy(P.rest[k]).slerp(P.fist[k] || q, this.grip);
      if (this.open > 0.01 && P.open[k]) q.slerp(P.open[k], this.open);
    }
    // ---- the arms, by IK: elbows down and a little out
    this.camera.updateMatrixWorld(true);
    for (const [side, h, sx] of [['L', this.cur.L, -1], ['R', this.cur.R, 1]]) {
      const target = this.camera.localToWorld(h.clone());
      const pole = this.camera.localToWorld(_v.set(sx * 0.55, -0.9, 0.1));
      reach(B['Shoulder2' + side], B['Forearm' + side], B['Hand' + side], target, pole);
    }
    // the heart: the model's own Heart Pose, whole arms and all (IK would crush the shape), raised into view
    if (this.heart > 0.001) {
      for (const k in B) if (P.heart[k]) B[k].quaternion.slerp(P.heart[k], this.heart);
      const o = this.heartOffset || HEART_AT;
      this.model.position.copy(EYE).multiplyScalar(-S).addScaledVector(o, this.heart);
    } else this.model.position.copy(EYE).multiplyScalar(-S);
    this.group.visible = this.visible;
    // the camera's bob follows the same stride
    return { y: 0.02 * amp * (Math.abs(Math.cos(this.phase)) - 0.5) * (1 + 0.6 * run), roll: 0.005 * amp * Math.sin(this.phase) };
  }
}
