// The coach: a real person in the card's ring, doing the move you are asked for.
//
// A clean anatomical body (engine/body/training-coach.glb: C.J. Goldman's "Male base
// mesh with muscle detail", CC-BY 4.0, given the games' Mixamo skeleton — arms
// refitted to its own shoulders and elbows) driven by the games' own motion
// code (engine/body/bots.js), on the spot, three-quarter on. Just the body, a
// light studio grey with the muscle detail in its normal map. Each move uses
// the gait that reads best:
//
//   walk          the everyday walking gait
//   jog / sprint  the runner's stride (a jog, then flat out)
//   freeze, still standing, a statue
//   hop           a small jump on the spot: dip, both knees up, arms up, soft landing
//   squat         down and up, on a slow beat
//
// Its own little renderer and canvas, transparent, so it sits in the glass.

import * as THREE from 'three';
import { GLTFLoader } from '../engine/three/GLTFLoader.js';
import { MeshoptDecoder } from '../engine/three/libs/meshopt_decoder.module.js';
import { Crowd } from '../engine/body/bots.js';
import { qa } from '../engine/body/rig.js';

const X = [1, 0, 0], Z = [0, 0, 1];
const _q = new THREE.Quaternion();

const MOVES = {
  walk:   { gait: 'walk', speed: 1.05 },
  jog:    { gait: 'run',  speed: 3.6 },
  sprint: { gait: 'run',  speed: 7.2 },
  freeze: { gait: 'stand' },
  still:  { gait: 'stand' },
  hop:    { gait: 'hop' },
  squat:  { gait: 'squat' },
};

export class Coach {
  constructor(canvas) {
    this.canvas = canvas;
    this.move = 'still'; this.t = 0; this.nextHop = 0.4; this.ready = false;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(24, 1, 0.1, 30);
    this.camera.position.set(4.05, 1.26, 5.46);    // all of the body inside the round window, with room: feet in a stride, the squat, the top of the jump
    this.camera.lookAt(0, 1.1, 0);
    // soft studio light: a warm key, a cool rim to cut the body out of the glass
    // a side key rakes across the muscles (the normal map's detail), a cool rim cuts the outline out of the dark
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4048, 0.85));
    const key = new THREE.DirectionalLight(0xfff0e0, 3.0); key.position.set(4, 3.2, 1.2); this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.6); fill.position.set(-2, 1.5, 3); this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xbfe0ff, 2.6); rim.position.set(-3, 2.8, -3.5); this.scene.add(rim);
    // a soft shadow under the feet so the body stands on something
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(7,24,31,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.position.y = 0.002; this.scene.add(this.shadow);
    this.crowd = new Crowd(this.scene, { style: 'athlete' });
  }

  async load(url) {
    const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
    await this.crowd.load(url, loader);
    this.bot = this.crowd.add(7, 0, 0, { scale: 1 });
    for (const m of this.bot.patches || []) m.visible = false;      // just the body: no bib, no number
    this.bot.model.scale.set(1, 1, 1);                              // the crowd's random build is for crowds
    const mat = this.bot.mesh.material; mat.color.set(0xe8ebee); mat.roughness = 0.46; mat.metalness = 0; mat.needsUpdate = true;
    this.bot.facing = -0.55;                                          // three-quarter on, moving to your left
    this.ready = true;
    this.resize();
  }

  setMove(id) {
    if (id === this.move || !MOVES[id]) return;
    this.move = id; this.t = 0; this.nextHop = 0.35;
    if (this.bot) { this.bot.hop = 0; this.bot.crouch = 0; this.bot.state = 'walk'; }
  }

  resize() {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  update(dt) {
    if (!this.ready || !this.canvas.offsetParent) return;      // not on screen: nothing to draw
    if (this.canvas.width !== Math.round(this.canvas.clientWidth * this.renderer.getPixelRatio())) this.resize();
    const m = MOVES[this.move], b = this.bot;
    this.t += dt;
    b.athlete = m.gait === 'run';                                    // the runner's stride only for running
    if (m.gait === 'walk' || m.gait === 'run') { b.go(m.speed); b.crouch = 0; }
    else b.go(0);
    // the jump, in phases of one 1.4 s cycle: dip · air · landing dip · stand
    const k = (this.t % 1.4) / 1.4;
    const air = m.gait === 'hop' && k > 0.14 && k < 0.5 ? Math.sin((k - 0.14) / 0.36 * Math.PI) : 0;
    if (m.gait === 'hop') b.crouch = k < 0.14 ? 0.55 * Math.sin(k / 0.14 * Math.PI) : k > 0.5 && k < 0.64 ? 0.5 * Math.sin((k - 0.5) / 0.14 * Math.PI) : 0;
    else b.crouch = m.gait === 'squat' ? 1.3 * (0.5 - 0.5 * Math.cos(this.t * Math.PI / 1.1)) : 0;   // down and up every 2.2 s
    b.update(dt, this.t);
    b.x = b.z = 0; b.root.position.set(0, 0, 0);                    // on the spot: the gait moves, the body stays
    // the crouch drops the body more than the bent legs do: lift it back so the feet stay on the floor
    b.model.position.y += 0.16 * (b.crouch || 0);
    if (air > 0) {                                                   // in the air: both knees up together, arms swung up
      const R = b.rig;
      for (const [side, sg] of [['Left', 1], ['Right', -1]]) {
        R.rot(side + 'UpLeg', qa(X, -32 * air)); R.rot(side + 'Leg', qa(X, 58 * air)); R.rot(side + 'Foot', qa(X, 22 * air));
        R.rot(side + 'Arm', _q.copy(qa(X, -70 * air)).multiply(qa(Z, -sg * (74 - 30 * air))));
      }
      b.model.position.y += 0.3 * air;
    }
    this.renderer.render(this.scene, this.camera);
  }
}
