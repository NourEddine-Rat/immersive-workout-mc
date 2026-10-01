// The gym: one short training that tunes every game to how THIS person moves.
//
//   connect   the phone (skipped when it is already streaming — it usually is,
//             from the carousel or the game that sent you here)
//   pocket    right front pocket, screen against the leg
//   still     two seconds of standing still: which way is down
//   the steps walk · run · run fast · stop · jump ×3 · squat ×3 (engine/profile.js)
//   result    your numbers → Save → back to the game that sent you (?next=)
//
// You are inside the gym (training/gym): the camera is your eyes and the arms
// are yours, on one spot of the open floor. Walk and run in place and your arms
// pump and the view bounces at the pace of your legs; Stop and you are a statue;
// a jump lifts you, a squat takes you down with a hand to the floor. At the end,
// a heart.

import { hostBridge } from '../engine/host-bridge.js';
import * as THREE from 'three';
import { GLTFLoader } from '../engine/three/GLTFLoader.js';
import { RoomEnvironment } from '../engine/three/RoomEnvironment.js';
import { MeshoptDecoder } from '../engine/three/libs/meshopt_decoder.module.js';
import { Hands } from '../engine/body/hands.js';
import { Coach } from './coach.js';
import { PocketSource, mergeCfg } from '../engine/motion-controller.js';
import { GENERIC } from '../engine/lib/motion-detector.js';
import { qrcode } from '../engine/lib/qrcode.js';
import * as Profile from '../engine/profile.js';

const $ = id => document.getElementById(id);
const ui = {
  card: $('card'), kicker: $('kicker'), title: $('title'), say: $('say'),
  visual: $('visual'), ringFill: $('ringFill'), figure: $('figure'), pocketRow: $('pocketRow'), qr: $('qr'), count: $('count'),
  reps: $('reps'), live: $('live'), liveValue: $('liveValue'), liveUnit: $('liveUnit'), flash: $('flash'),
  tiles: $('tiles'), note: $('note'), actions: $('actions'), url: $('url'), track: $('track'),
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

/** Only a path on this site: never send anyone elsewhere from a query string. */
const NEXT = (() => { const n = new URLSearchParams(location.search).get('next'); return n && n.startsWith('/') && !n.startsWith('//') ? n : null; })();

// =================================================================== the gym

const canvas = $('gym');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101316);
const camera = new THREE.PerspectiveCamera(66, 1, 0.03, 60);
scene.add(camera);                                   // the arms hang off the camera

// A soft studio room reflected in every surface: the black tiles, the metal and
// the rubber read as materials instead of holes, and the room feels lit.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5;

// The room (training/gym, levelled and un-mirrored from new-Gym): 11.1 × 11.2 m,
// 3.8 m to the ceiling, floor at y 0. Equipment lines the walls; the middle is
// open floor — that is where you train.
const SPOT = { x: 0.3, z: 1.4, yaw: 0 };   // where you train: the middle of the open floor, facing the far wall (−z)

function buildLights() {
  scene.add(new THREE.HemisphereLight(0xfff5e8, 0x3a332c, 1.15));
  // under the ceiling panels: a warm grid of lights, one of them casting the shadows
  const spots = [[-2.4, -3.2], [2.6, -3.2], [-2.4, 0.4], [2.6, 0.4], [-2.4, 3.8], [2.6, 3.8]];
  spots.forEach(([x, z], i) => {
    const p = new THREE.PointLight(0xfff1dd, 9, 9, 1.6);
    p.position.set(x, 3.35, z); scene.add(p);
  });
  const key = new THREE.SpotLight(0xfff4e4, 70, 16, 0.95, 0.5, 1.4);
  key.position.set(0.4, 3.6, 0.6); key.target.position.set(0.3, 0, -0.6);
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0003; key.shadow.normalBias = 0.03;
  scene.add(key, key.target);
}

async function buildGym() {
  buildLights();
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  try {
    const gltf = await loader.loadAsync('./gym/training-studio.gltf');
    gltf.scene.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = true;
      const m = o.material;
      if (m && m.emissiveMap) m.emissiveIntensity = m.name === 'walls' ? 3.2 : 1.4;   // the ceiling panels and windows glow
    });
    scene.add(gltf.scene);
  } catch (e) { console.warn('gym model:', e); }
  try { await hands.load('../engine/body/controller-arms.glb', loader); } catch (e) { console.warn('arms:', e); }
  try { await coach.load('../engine/body/training-coach.glb'); } catch (e) { console.warn('coach:', e); }
}

// ---- you: eyes 1.62 m up, your own arms, on one spot of the open floor (everything is in place: the room is small)

const hands = new Hands(camera, { sleeve: null });
const coach = new Coach($('figure'));   // the person in the card's ring, showing the move
const EYE_H = 1.62;
const body = {
  pace: 0,              // how hard the legs are going (a walk ~0.7, a run ~2.6, flat out ~3.3): drives the arms and the bounce, not a position
  yaw: 0, jumpT: 9, dip: 0, crouch: 0, frozen: false, lastStep: -9, falls: [], walkHz: 0, stepping: false,
};
/** Legs → pace: a walk ~0.7, a run ~2.6, flat out ~3.3 (the arms' swing and the bounce follow it). */
const speedFor = hz => hz > 0 ? clamp(0.6 + (hz - 1.4) * 1.3, 0.5, 3.6) : 0;

function stepBody(t, dt, read, stepId) {
  const live = read && read.live;
  const hz = live && read.running ? read.cadenceHz : 0;
  const walking = stepId === 'walk' || stepId === 'jog' || stepId === 'sprint';
  // a slow walk is soft: the run detector may not call it running, but each footfall still lands a little over 1 g
  if (live && read.aG > 1.12) {
    if (t - body.lastStep > 0.25) { body.falls.push(t); while (body.falls.length && body.falls[0] < t - 3) body.falls.shift(); }   // one footfall per landing
    body.lastStep = t;
  }
  body.stepping = live && t - body.lastStep < 0.7;
  // your own steps per second over the last 3 s (a walk the run detector does not call running still has a pace)
  body.walkHz = body.stepping && body.falls.length >= 3 ? (body.falls.length - 1) / Math.max(0.5, body.falls[body.falls.length - 1] - body.falls[0]) : 0;
  // walking and running are in place: your legs set the pace of the arms and the bounce, you do not travel
  const want = walking ? (hz > 0 ? speedFor(hz) : body.stepping ? 0.55 : 0) : 0;
  body.pace = damp(body.pace, want, want > body.pace ? 2.2 : 4.5, dt);
  // Stop: the moment you are still, you are a statue — the arms hold where they were
  body.frozen = stepId === 'freeze' && live && !read.running && read.wDps < 45;
  // squat: the eyes sink with the thigh; a hop lifts you
  const sink = live && !walking ? clamp((read.tilt - 14) / 50, 0, 1) : 0;
  body.crouch = damp(body.crouch, sink, 8, dt);
  if (read) for (const e of read.events) if (e.action === 'UP') { body.jumpT = 0; hands.jump(t); }
  if (live && read.v > 0.9 && body.jumpT > 0.8) { body.jumpT = 0; hands.jump(t); }
  body.jumpT += dt;
  const jump = body.jumpT < 0.6 ? Math.sin(Math.PI * body.jumpT / 0.6) * 0.34 : 0;

  const p = SPOT; body.yaw = SPOT.yaw;

  // the right hand goes to the floor in front of you when you squat
  hands.reachFor = body.crouch > 0.25 ? new THREE.Vector3(p.x - Math.sin(body.yaw) * 0.55, 0.05 + (1 - body.crouch) * 0.6, p.z - Math.cos(body.yaw) * 0.55) : null;
  const bob = hands.update(dt, t, { moving: body.pace > 0.15, pace: body.pace, cadence: hz || body.walkHz || 2, frozen: body.frozen, fear: 0, crouch: body.crouch });
  const idle = Math.sin(t * 0.9) * 0.006;
  // running in place bounces you a little more than running along would (each footfall lifts and lands you)
  camera.position.set(p.x, EYE_H + bob.y * 1.6 + jump - body.crouch * 0.72 + idle, p.z);
  camera.rotation.set(-0.04 - body.crouch * 0.22, body.yaw, bob.roll, 'YXZ');
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

// ================================================================= the card

let lastTitle = '';
/**
 * Everything the card can show, in one call; anything not given is hidden.
 * visual: 'figure' | 'pocket' (the photo guide and its three rules) | 'qr' | 'none'
 */
function setCard(o) {
  if (o.title !== lastTitle) {                      // a new stage: a short lift-and-settle
    lastTitle = o.title;
    ui.card.classList.add('swap'); requestAnimationFrame(() => requestAnimationFrame(() => ui.card.classList.remove('swap')));
  }
  ui.kicker.textContent = o.kicker || '';
  ui.title.textContent = o.title || '';
  ui.say.textContent = o.say || '';
  const vis = o.visual || 'none';
  ui.visual.hidden = vis === 'none' || vis === 'pocket';
  ui.figure.hidden = vis !== 'figure'; ui.qr.hidden = vis !== 'qr';
  ui.pocketRow.hidden = vis !== 'pocket';
  ui.card.classList.toggle('wide', vis === 'pocket');   // the photos need the room
  ui.visual.querySelector('.ring').style.display = vis === 'qr' ? 'none' : '';
  if (o.move) coach.setMove(o.move);
  ring(o.ring || 0, !!o.lead);
  ui.reps.hidden = !o.repsOf;
  if (o.repsOf) {
    if (ui.reps.children.length !== o.repsOf) ui.reps.innerHTML = '<i></i>'.repeat(o.repsOf);
    [...ui.reps.children].forEach((d, i) => d.classList.toggle('on', i < o.reps));
  }
  ui.live.hidden = o.live == null;
  if (o.live != null) { ui.liveValue.textContent = o.live; ui.liveUnit.textContent = o.unit || ''; }
  ui.flash.hidden = !o.flash;
  if (o.flash) { ui.flash.textContent = o.flash.text; ui.flash.className = 'flash' + (o.flash.warn ? ' warn' : ''); }
  ui.tiles.hidden = !o.tiles;
  if (o.tiles) ui.tiles.innerHTML = o.tiles.map(([v, k]) => `<div class="tile"><b>${v}</b><span>${k}</span></div>`).join('');
  ui.note.hidden = !o.note; if (o.note) ui.note.textContent = o.note;
  ui.url.hidden = !o.url; if (o.url) ui.url.textContent = o.url;
  ui.actions.hidden = !o.actions;
  if (o.actions && ui.actions.dataset.key !== o.actions.map(a => a.label).join('|')) {
    ui.actions.dataset.key = o.actions.map(a => a.label).join('|');
    ui.actions.innerHTML = '';
    for (const a of o.actions) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = a.label; b.className = a.primary ? 'primary' : '';
      b.onclick = a.onClick; ui.actions.appendChild(b);
    }
  }
}
function ring(v, lead) {
  ui.ringFill.style.strokeDasharray = `${(clamp(v, 0, 1) * 100).toFixed(1)} 100`;
  ui.visual.classList.toggle('lead', lead);
}
function track(index, preview = false) {
  ui.track.hidden = index < 0 && !preview;
  if (!ui.track.children.length) {
    ui.track.classList.add('glass-pill');
    ui.track.innerHTML = Profile.STEPS.map(s => `<span><i></i>${s.title}</span>`).join('');
  }
  [...ui.track.children].forEach((c, i) => { c.className = i < index ? 'done' : i === index ? 'now' : ''; });
}
addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const b = ui.actions.hidden ? null : ui.actions.querySelector('button.primary');
  if (b) { e.preventDefault(); b.click(); }
});

// ================================================================= the flow

const pocket = new PocketSource();
pocket.start();
let state = 'boot', profiling = null, out = null, result = null;
let paused = 0, pausedAt = 0;                        // the phone dropped out: the routine's clock stops with it
let flow = 0;                                        // bumped whenever the flow is taken over (a lost phone): a stale await gives up
let resume = false;                                  // the phone came back mid-routine: carry on from the same step
const clock = () => performance.now() / 1000 - paused;
window.__tr = { body, get state() { return state; }, get out() { return out; }, get profile() { return result; }, get profiling() { return profiling; }, pocket };

// ---- each screen's card, on its own: the flow and the dev preview draw the very same thing

const GAME_NAMES = { '/games/subway/': 'Subway', '/games/squid/red-light/': 'Red Light, Green Light', '/games/squid/jump-rope/': 'Jump Rope', '/games/squid/track/': 'Track & Field' };
/** The opening: what this is, how long, what is coming — and, when a game sent you, which one waits. */
function welcomeCard() {
  const game = NEXT && GAME_NAMES[NEXT.split('?')[0]];
  const again = !!Profile.load();
  setCard({ kicker: game ? `Before you play ${game}` : again ? 'Train again' : 'Your controller',
            title: 'Quick training', say: 'Your phone learns how you move. About a minute — once for every game.',
            visual: 'figure', move: 'jog', live: '6', unit: 'moves · about 1 minute' });
  track(-1, true);                                  // the six moves, all still to come
}
let phoneUrl = null, phoneCode = null;
async function connectCard(lost) {
  {
    let where = { phoneError: 'Could not reach the connection service. Check your network and try again.' };
    try { where = await hostBridge.connectionInfo(true); } catch {}
    if(where.phoneError){setCard({kicker:'Connection',title:'Phone unavailable',say:where.phoneError,visual:'none',actions:[{label:'Try again',primary:true,onClick:()=>connectCard(lost)}]});return;}
    phoneCode=where.pairCode;
    phoneUrl = where.phoneUrl;
    try { const qr = qrcode(0, 'M'); qr.addData(phoneUrl); qr.make(); ui.qr.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); } catch {}
  }
  track(-1);
  const pairing = phoneCode ? ` Or enter code ${phoneCode}.` : '';
  setCard(lost
    ? { kicker: 'Phone lost', title: 'Reconnect', say: 'Open the phone page and enable motion. Your progress is kept.' + pairing, visual: 'qr', url: phoneUrl.replace('https://', '') }
    : { kicker: 'Connect', title: 'Your phone', say: 'Scan to connect it — the profile needs your moves.' + pairing, visual: 'qr', url: phoneUrl.replace('https://', '') });
}
function pocketCard(left, onReady) {
  track(-1);
  setCard({ kicker: 'Get set', title: 'Phone in pocket', say: 'Like the big picture, not the small ones.', visual: 'pocket',
    actions: [{ label: `Ready${left > 0 ? ` · ${left}` : ''}`, primary: true, onClick: onReady }] });
}
function stillCard() {
  track(-1);
  setCard({ kicker: 'Get set', title: 'Stand still', say: 'Feet together, arms down.', visual: 'figure', move: 'still', ring: 0 });
}

async function begin() {
  const my = flow, t0 = performance.now();
  welcomeCard();
  // the phone is usually already streaming (the carousel or a game kept the link); the opening stays up long enough to read
  for (let i = 0; i < 10 && pocket.link !== 'live'; i++) await sleep(200);
  await sleep(Math.max(0, 2600 - (performance.now() - t0)));
  if (my !== flow) return;                          // dev mode took the screen
  pocket.link === 'live' ? toPocket() : toConnect();
}

/**
 * The phone: nothing is measured without it. First time, or whenever it drops
 * out (the page closed, the phone locked, Wi-Fi gone), this card waits until
 * motion is really arriving again.
 */
async function toConnect(lost = false) {
  state = 'connect';
  const my = ++flow;
  await connectCard(lost);
  if (my !== flow) return;
  while (pocket.link !== 'live') { await sleep(250); if (my !== flow) return; }
  toPocket();
}

/** Motion stopped arriving while it was needed: stop everything and ask for the phone. */
function phoneLost() {
  if (state === 'steps') { resume = true; out = null; }
  pausedAt = 0;          // a stall that turned into a loss is not a pause: the step starts over when the phone is back
  document.body.classList.remove('in-steps');
  toConnect(true);
}

function toPocket() {
  state = 'pocket';
  let left = 12;
  const draw = () => pocketCard(left, go);
  const timer = setInterval(() => { if (state !== 'pocket') return clearInterval(timer); if (--left <= 0) go(); else draw(); }, 1000);
  function go() { clearInterval(timer); if (state === 'pocket') toStill(); }
  ui.actions.dataset.key = '';
  draw();
}

async function toStill() {
  state = 'still';
  const my = ++flow;
  stillCard();
  const t0 = performance.now();
  const spin = setInterval(() => ring(((performance.now() - t0) / 2200) % 1, true), 50);
  const ok = await pocket.warmUp(tries => { if (tries === 8 && my === flow) ui.say.textContent = 'Still moving — two seconds without moving.'; });
  clearInterval(spin);
  if (my !== flow) return;                          // the phone was lost meanwhile: the reconnect card has the screen
  if (!ok) return phoneLost();
  // permissive while measuring, so a light runner still registers
  pocket.applyCfg(mergeCfg(GENERIC, { step: { startG: 1.25 } }));
  if (resume && profiling && !profiling.done) profiling.restartStep(clock());   // back where you were, that step again
  else { profiling = new Profile.Profiling(pocket); profiling.start(clock()); }
  resume = false;
  state = 'steps';
  document.body.classList.add('in-steps');
}

const GAIT_UNIT = 'steps / s';
function stepRoutine(read) {
  out = profiling.update(clock(), read);
  if (out.done) return toResult(out.profile);
  stepCard(out, read);
}

/** A step's card from the routine's state (or the dev preview's made-up one). */
function stepCard(out, read) {
  const s = out.step;
  track(out.index);
  const o = { kicker: `${out.index + 1} of ${out.of}`, title: s.title, say: s.say, visual: 'figure', move: s.id, lead: out.lead,
              ring: out.lead ? out.lead01 : out.hold, repsOf: out.repsOf, reps: out.reps };
  if (out.lead) {
    o.live = String(Math.max(1, Math.ceil((1 - out.lead01) * 2.4))); o.unit = 'get ready';
  } else if (s.id === 'walk' || s.id === 'jog' || s.id === 'sprint') {
    // the detector's cadence when it calls it running; otherwise your own footfalls; nothing made up
    const hz = read.running && read.cadenceHz > 0 ? read.cadenceHz : body.walkHz;
    o.live = hz > 0 ? hz.toFixed(1) : '—'; o.unit = hz > 0 ? GAIT_UNIT : 'start moving';
  } else if (s.id === 'freeze') {
    const moving = read.wDps > 45 || read.running;
    o.live = moving ? 'Moving' : 'Still'; o.unit = '';
  } else if (s.id === 'hop') {
    o.live = out.last && out.last.ok ? out.last.value.toFixed(2) : out.inRep ? 'Jump!' : '—'; o.unit = out.last && out.last.ok ? 'm / s' : '';
  } else if (s.id === 'squat') {
    o.live = out.inRep ? `${Math.round(Math.max(0, read.tilt))}°` : '—'; o.unit = out.inRep ? 'depth' : '';
  }
  if (out.last) o.flash = out.last.ok ? { text: 'Got it' } : { text: 'Missed — once more', warn: true };
  setCard(o);
}

function toResult(p) {
  state = 'result'; result = p; hands.win(clock());
  document.body.classList.remove('in-steps');
  resultCard(p,
    () => { ui.actions.dataset.key = ''; hands.reset(); toStill(); },
    () => { Profile.save(p); location.href = NEXT || '../'; });
}
function resultCard(p, onRedo, onSave) {
  track(Profile.STEPS.length);
  const M = p.measures, f = (v, d = 1) => v > 0 ? v.toFixed(d) : '—';
  const steady = M.stillW > 0 ? (M.stillW * 1.5 <= 110 && M.stillA * 1.5 <= 0.28 ? 'Steady' : 'Shaky') : '—';
  setCard({
    kicker: 'Done', title: "You're set", say: 'Every game now fits how you move.', visual: 'none',
    tiles: [[f(M.hz.walk), 'Walk'], [f(M.hz.jog), 'Run'], [f(M.hz.sprint), 'Run fast'], [f(M.hop, 2), 'Jump'], [M.squat > 0 ? `${Math.round(M.squat)}°` : '—', 'Squat'], [steady, 'Stop']],
    note: p.notes[0] || '',
    actions: [
      { label: 'Redo', onClick: onRedo },
      { label: NEXT ? 'Save & play' : 'Save', primary: true, onClick: onSave },
    ],
  });
}

// ================================================================= the loop

const motionCanvas = $('motion');
let last = performance.now();
function frame(nowMs) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (nowMs - last) / 1000); last = nowMs;
  const t = nowMs / 1000;
  if (state === 'dev') {                              // the preview: made-up motion, no phone, no flow
    const d = devFrame(clock(), dt);
    stepBody(clock(), dt, d.read, d.stepId);
    coach.update(dt);
    pocket.drawPanel(motionCanvas, { glass: true, label: false });
    renderer.render(scene, camera);
    return;
  }
  const read = pocket.poll();
  // the phone is needed from the pocket card on: the moment motion stops arriving (1.5 s), ask for it
  if ((state === 'pocket' || state === 'still' || state === 'steps') && pocket.link === 'lost') phoneLost();
  if (state === 'steps') {
    if (pocket.link === 'stalled') { if (!pausedAt) pausedAt = t; }     // a Wi-Fi hiccup: the routine's clock waits
    else {
      if (pausedAt) { paused += t - pausedAt; pausedAt = 0; }
      stepRoutine(read);
    }
  }
  stepBody(clock(), dt, read, state === 'steps' && out && out.step && !out.lead ? out.step.id : null);
  coach.update(dt);
  pocket.drawPanel(motionCanvas, { glass: true, label: false });
  renderer.render(scene, camera);
}

// ================================================================== dev
//
// Every screen of the training, without a phone, for working on the look.
// The Dev pill (bottom right, or ?dev=1) stops the real flow and shows any
// screen live: the body moves as it would (walking round the loop, frozen,
// jumping, squatting, the heart at the end), the card animates, the motion
// card draws a made-up chart. ← / → step through the screens. "Leave dev"
// reloads into the real thing.

const DEV = [
  { name: 'Welcome', show: () => welcomeCard() },
  { name: 'Connect', show: () => connectCard(false) },
  { name: 'Reconnect', show: () => connectCard(true) },
  { name: 'Pocket', show: () => { ui.actions.dataset.key = ''; pocketCard(9, () => {}); } },
  { name: 'Stand still', show: () => stillCard(), still: true },
  ...Profile.STEPS.map((s, i) => ({ name: s.title, step: i })),
  { name: 'Result', show: () => { ui.actions.dataset.key = ''; resultCard(devProfile(), () => {}, () => {}); hands.win(clock()); } },
];
const dev = { i: 0, lead: false, phone: 'live', t0: 0 };
/** A believable profile to fill the result card: what a fit makes of an ordinary player. */
function devProfile() {
  const g = (hz, v, tilt) => ({ hz: [hz], peaks: [1.8, 1.9, 2.0, 2.1, 1.7, 1.85], maxV: v, maxTilt: tilt });
  return Profile.fit({ walk: g(1.6, 0.3, 20), jog: g(2.8, 0.9, 40), sprint: g(3.4, 0.95, 44), still: { a: [0.08], w: [30] }, stopS: 0.3,
    hop: [1.7, 1.8, 1.75], squat: [66, 70, 68], squatMaxA: 1.8, squatMaxW: 150 });
}
function devShow(i) {
  dev.i = (i + DEV.length) % DEV.length; dev.t0 = clock();
  const d = DEV[dev.i];
  hands.reset(); body.frozen = false; lastTitle = '';
  document.body.classList.toggle('in-steps', d.step != null);
  if (d.show) d.show();
  devPanel.querySelectorAll('[data-screen]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.screen === dev.i)));
}
/** One frame of the preview: the made-up phone read for this screen, and the card if it is a step. */
function devFrame(t, dt) {
  const d = DEV[dev.i], el = t - dev.t0;
  const s = d.step != null ? Profile.STEPS[d.step] : null;
  const id = s ? s.id : null;
  const hz = { walk: 1.7, jog: 2.8, sprint: 3.4 }[id] || 0;
  const hopPhase = (el % 1.8) / 1.8, squatK = Math.max(0, Math.sin(el * Math.PI / 1.75));
  const read = {
    live: true, events: [], running: hz > 0, cadenceHz: hz, wDps: id === 'freeze' || d.still ? 4 : 40,
    v: id === 'hop' && hopPhase < 0.12 ? 1.8 : 0.05,
    tilt: id === 'squat' ? 8 + 64 * squatK : 6,
    aG: hz > 0 ? 1 + 0.9 * Math.pow(Math.max(0, Math.sin(el * Math.PI * hz)), 8) : 1,
  };
  // the motion card: a chart shaped like this move
  const pnow = performance.timeOrigin + performance.now();
  const g = 9.80665;
  const mag = hz > 0 ? 1 + (hz / 3.4) * 1.3 * Math.pow(Math.max(0, Math.sin(el * Math.PI * hz)), 6) - 0.25 * Math.max(0, Math.sin(el * Math.PI * hz + 1.4))
    : id === 'hop' ? (hopPhase < 0.1 ? 1.8 : hopPhase < 0.3 ? 0.1 : hopPhase < 0.36 ? 2.4 : 1)
    : id === 'squat' ? 1 + 0.18 * Math.sin(el * Math.PI / 0.875)
    : 1 + (Math.random() - 0.5) * 0.01;
  pocket.samples.push({ t: pnow, a: [0, 0, g * mag], g: [0, 0, g], w: [0, 0, 0] });
  if (pocket.samples.length > 600) pocket.samples.shift();
  pocket.lastSampleAt = dev.phone === 'offline' ? 0 : dev.phone === 'weak' ? pnow - 800 : pnow;
  if (s) {
    const cyc = s.kind === 'hold' ? (el % s.s) / s.s : (el % 3.5) / 3.5;
    const counted = s.kind === 'reps' ? Math.min(s.n, Math.floor(el / 3.5) % (s.n + 1)) : null;
    stepCard({
      step: s, index: d.step, of: Profile.STEPS.length, lead: dev.lead, lead01: dev.lead ? (el % 2.4) / 2.4 : 1,
      hold: Math.min(1, cyc / (s.kind === 'reps' ? 0.74 : 1)), inRep: s.kind === 'reps' && cyc < 0.74, reps: counted, repsOf: s.kind === 'reps' ? s.n : null,
      last: s.kind === 'reps' && cyc > 0.74 ? { ok: true, value: s.feature === 'v' ? 1.72 : 68 } : null,
    }, read);
  } else if (d.still) ring((el / 2.2) % 1, true);
  return { read, stepId: s && !dev.lead ? id : null };
}

const devPanel = $('devPanel'), devToggle = $('devToggle');
function enterDev() {
  if (state !== 'dev') {
    flow++;                                          // any waiting step of the real flow gives up
    state = 'dev'; out = null;
    window.__phonePreview = dev.phone;
    devPanel.querySelector('#devScreens').innerHTML = DEV.map((d, i) => `<button type="button" data-screen="${i}">${d.name}</button>`).join('');
    devPanel.querySelectorAll('[data-screen]').forEach(b => b.onclick = () => devShow(+b.dataset.screen));
    devShow(0);
  }
  devPanel.hidden = false; devToggle.setAttribute('aria-expanded', 'true');
}
devToggle.onclick = () => {
  if (devPanel.hidden) enterDev();
  else { devPanel.hidden = true; devToggle.setAttribute('aria-expanded', 'false'); }   // hide the panel, keep the preview
};
$('devLead').onchange = e => { dev.lead = e.target.checked; lastTitle = ''; };
devPanel.querySelectorAll('[data-phone]').forEach(b => b.onclick = () => {
  dev.phone = b.dataset.phone;
  window.__phonePreview = dev.phone;                 // the phone card (carousel/phone-status.js) shows this state
  devPanel.querySelectorAll('[data-phone]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
});
$('devExit').onclick = () => { location.href = location.pathname + location.search.replace(/[?&]dev=1/, '').replace(/^&/, '?'); };
addEventListener('keydown', e => {
  if (state !== 'dev' || e.target.closest('input, button')) return;
  if (e.key === 'ArrowRight') devShow(dev.i + 1);
  if (e.key === 'ArrowLeft') devShow(dev.i - 1);
});

buildGym().then(() => {
  requestAnimationFrame(frame);
  begin();
  if (new URLSearchParams(location.search).get('dev') === '1') enterDev();
});

hostBridge.setSnapshot(()=>({phase:state,motion:pocket.link}));
