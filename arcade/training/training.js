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
import { RoomEnvironment } from '../engine/three/RoomEnvironment.js';
import { createAssetLoader, prepareScene } from '../engine/asset-loader.js';
import { Hands } from '../engine/body/hands.js';
import { Coach } from './coach.js';
import { PocketSource, mergeCfg } from '../engine/motion-controller.js';
import { GENERIC } from '../engine/lib/motion-detector.js';
import { qrcode } from '../engine/lib/qrcode.js';
import { createMicrophoneRecovery } from '../engine/lib/microphone-recovery.js';
import * as Profile from '../engine/profile.js';

const $ = id => document.getElementById(id);
const ui = {
  card: $('card'), kicker: $('kicker'), title: $('title'), say: $('say'),
  visual: $('visual'), ringFill: $('ringFill'), figure: $('figure'), pocketRow: $('pocketRow'), qr: $('qr'), count: $('count'),
  reps: $('reps'), live: $('live'), liveValue: $('liveValue'), liveUnit: $('liveUnit'), flash: $('flash'),
  tiles: $('tiles'), note: $('note'), actions: $('actions'), url: $('url'), track: $('track'),
  connectionHelp: $('connectionHelp'), microphoneRetry: $('microphoneRetry'), microphoneStatus: $('microphoneStatus'),
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

const GAME_NAMES = { '/games/subway/': 'Subway', '/games/squid/red-light/': 'Red Light, Green Light', '/games/squid/jump-rope/': 'Jump Rope', '/games/squid/track/': 'Track & Field' };
/** Return to a playable game on this origin after saving training. */
const NEXT = (() => {
  const path = new URLSearchParams(location.search).get('next');
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return null;
  try {
    const next = new URL(path, location.origin);
    const pathname = next.pathname.replace(/index\.html$/, '').replace(/\/?$/, '/');
    return next.origin === location.origin && GAME_NAMES[pathname] ? pathname + next.search : null;
  } catch { return null; }
})();

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
  const loader = createAssetLoader({ boot: window.boot });
  const guideImages = [...document.querySelectorAll('#guide img')];
  await loader.preload([
    { url: './gym/training-studio.gltf', label: 'Training studio' },
    { url: '../engine/body/controller-arms.glb', label: 'Your movement' },
    { url: '../engine/body/training-coach.glb', label: 'Training coach' },
    ...guideImages.map(img => ({ url: img.dataset.src, label: 'Pocket guide' })),
  ]);
  window.boot.step('Preparing your training');
  buildLights();
  const gltf = await loader.loadAsync('./gym/training-studio.gltf');
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true;
    const m = o.material;
    if (m && m.emissiveMap) m.emissiveIntensity = m.name === 'walls' ? 3.2 : 1.4;
  });
  scene.add(gltf.scene);
  await hands.load('../engine/body/controller-arms.glb', loader);
  await coach.load('../engine/body/training-coach.glb', loader);
  await Promise.all(guideImages.map(img => loader.loadImage(img.dataset.src, img)));
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
  ui.connectionHelp.hidden = !o.connection;
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
  if (e.key !== 'Enter' || state === 'boot' || state === 'failed') return;
  const b = ui.actions.hidden ? null : ui.actions.querySelector('button.primary');
  if (b) { e.preventDefault(); b.click(); }
});

// ================================================================= the flow

const pocket = new PocketSource();
pocket.start();
let state = 'boot', profiling = null, out = null, result = null;
let connectionReady = false, connectionPrompt = '';
let paused = 0, pausedAt = 0;                        // the phone dropped out: the routine's clock stops with it
let flow = 0;                                        // bumped whenever the flow is taken over (a lost phone): a stale await gives up
let resume = false;                                  // the phone came back mid-routine: carry on from the same step
const clock = () => performance.now() / 1000 - paused;
const microphone = createMicrophoneRecovery({ onChange: renderConnectionHelp, onRetry: () => {
  const connection = hostBridge.connection;
  if (connection.active && connection.paired && !connection.direct) hostBridge.setLocalAddress('');
} });
ui.microphoneRetry.onclick = () => microphone.request();
function renderConnectionHelp() {
  const connection = hostBridge.connection;
  const audio = microphone.snapshot;
  if (audio.pending && (connection.direct || !connection.active || !connection.paired)) microphone.cancel();
  ui.microphoneRetry.disabled = connection.direct || !connection.active || !connection.paired || audio.pending || !audio.available || audio.granted;
  ui.microphoneRetry.textContent = connection.direct ? 'Phone connected' : audio.granted ? 'Microphone access stopped' : audio.state === 'idle' ? 'Allow microphone & retry' : audio.buttonLabel;
  ui.microphoneStatus.textContent = connection.direct ? 'Connected locally. No microphone is needed for training or gameplay.'
    : !connection.paired ? 'Scan the QR code first. If connecting stalls, try this option.'
    : audio.state === 'idle' ? 'Optional. Your browser will ask you to allow microphone access.' : audio.message;
  if (state === 'connect' && connectionReady) {
    ui.say.textContent = connection.direct ? 'Your phone is connected. Enable motion on its screen to start training.' : connectionPrompt;
    const retry = ui.actions.querySelector('button.primary');
    if (retry) retry.disabled = connection.direct;
  }
}
addEventListener('screen-connection', renderConnectionHelp);
renderConnectionHelp();
// ---- each screen's card

/** The opening: what this is, how long, what is coming — and, when a game sent you, which one waits. */
function welcomeCard() {
  const game = NEXT && GAME_NAMES[NEXT.split('?')[0]];
  const again = !!Profile.load();
  setCard({ kicker: game ? `Before you play ${game}` : again ? 'Train again' : 'Your controller',
            title: 'Quick training', say: 'Your phone learns how you move. About a minute — once for every game.',
            visual: 'figure', move: 'jog', live: '6', unit: 'moves · about 1 minute' });
  track(-1, true);                                  // the six moves, all still to come
}
let phoneUrl = null, phoneCode = null, connectionRequest = 0;
function stopTraining() {
  if (state === 'failed') return;
  state = 'failed'; flow++; connectionRequest++;
  profiling = null; out = null; resume = false;
  pocket.onEvent = null; pocket.onSample = null;
  microphone.cancel();
  document.body.classList.remove('in-steps');
  document.body.classList.add('training-loading');
  const stage = document.querySelector('.stage');
  stage.inert = true; stage.setAttribute('aria-busy', 'true');
  ui.actions.hidden = true;
}
document.addEventListener('webglcontextlost', stopTraining, true);
async function connectCard(lost) {
  const request = ++connectionRequest;
  connectionReady = false;
  const actions = [
    { label: 'Retry connection', primary: true, onClick: () => { hostBridge.retryLocal(); connectCard(lost); } },
    { label: 'Back to games', onClick: () => location.assign('/') },
  ];
  setCard({ kicker: 'Connection', title: 'Your phone', say: 'Preparing your connection…', visual: 'none', connection: true, actions });
  {
    let where = { phoneError: 'Could not reach the connection service. Check your network and try again.' };
    try { where = await hostBridge.connectionInfo(true); } catch {}
    if (request !== connectionRequest || state !== 'connect') return;
    if(where.phoneError || !where.phoneUrl || !/^\d{6}$/.test(where.pairCode)) {
      setCard({ kicker:'Connection', title:'Phone unavailable', say:where.phoneError || 'Could not prepare your connection. Try again.', visual:'none', connection:true, actions }); return;
    }
    phoneCode=where.pairCode;
    phoneUrl = where.phoneUrl;
    try { const qr = qrcode(0, 'M'); qr.addData(phoneUrl); qr.make(); ui.qr.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); }
    catch { setCard({ kicker:'Connection', title:'Phone unavailable', say:'Could not prepare the QR code. Try again.', visual:'none', connection:true, actions }); return; }
  }
  track(-1);
  const pairing = phoneCode ? ` Or enter code ${phoneCode}.` : '';
  connectionPrompt = lost ? 'Open the phone page and enable motion. Your progress is kept.' + pairing : 'Scan to connect it — the profile needs your moves.' + pairing;
  setCard(lost
    ? { kicker: 'Phone lost', title: 'Reconnect', say: connectionPrompt, visual: 'qr', connection:true, actions, url: phoneUrl.replace(/^https?:\/\//, '') }
    : { kicker: 'Connect', title: 'Your phone', say: connectionPrompt, visual: 'qr', connection:true, actions, url: phoneUrl.replace(/^https?:\/\//, '') });
  connectionReady = true;
  renderConnectionHelp();
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
  if (window.boot.state === 'failed') return stopTraining();
  state = 'welcome';
  const my = flow, t0 = performance.now();
  welcomeCard();
  // the phone is usually already streaming (the carousel or a game kept the link); the opening stays up long enough to read
  for (let i = 0; i < 10 && pocket.link !== 'live'; i++) await sleep(200);
  await sleep(Math.max(0, 2600 - (performance.now() - t0)));
  if (my !== flow) return;
  pocket.link === 'live' ? toPocket() : toConnect();
}

/**
 * The phone: nothing is measured without it. First time, or whenever it drops
 * out (the page closed, the phone locked, Wi-Fi gone), this card waits until
 * motion is really arriving again.
 */
async function toConnect(lost = false) {
  if (window.boot.state === 'failed') return stopTraining();
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
  if (window.boot.state === 'failed') return stopTraining();
  state = 'pocket';
  let left = 12;
  const draw = () => pocketCard(left, go);
  const timer = setInterval(() => { if (state !== 'pocket') return clearInterval(timer); if (--left <= 0) go(); else draw(); }, 1000);
  function go() { clearInterval(timer); if (state === 'pocket') toStill(); }
  ui.actions.dataset.key = '';
  draw();
}

async function toStill() {
  if (window.boot.state === 'failed') return stopTraining();
  state = 'still';
  const my = ++flow;
  stillCard();
  const t0 = performance.now();
  const spin = setInterval(() => {
    if (my !== flow) return clearInterval(spin);
    ring(((performance.now() - t0) / 2200) % 1, true);
  }, 50);
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

/** A step's card from the routine's state. */
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
    () => saveResult(p));
}
function saveResult(profile) {
  if (window.boot.state === 'failed') return stopTraining();
  Profile.save(profile);
  try {
    const saved = JSON.stringify(profile), player = localStorage.getItem('inmotion.player.v1');
    if (localStorage.getItem(Profile.KEY) !== saved || (player && localStorage.getItem(`arcade.calibration.${player}`) !== saved)) throw Error('Training storage unavailable');
    location.assign(NEXT || '/');
  } catch {
    ui.note.textContent = 'This browser could not save your training. Allow site storage or free some browser storage, then try saving again. Your training is still here.';
    ui.note.hidden = false;
    const save = ui.actions.querySelector('button.primary');
    if (save) save.textContent = 'Try saving again';
  }
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
  if (window.boot.state === 'failed') return stopTraining();
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (nowMs - last) / 1000); last = nowMs;
  const t = nowMs / 1000;
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

// Keep the transport active during loading; begin the routine only after every
// required model and guide is ready and both scenes have rendered successfully.
async function start() {
  try {
    await buildGym();
    welcomeCard();
    coach.setMove('jog');
    stepBody(clock(), 0, null, null);
    coach.update(0);
    await prepareScene(renderer, scene, camera);
    await prepareScene(coach.renderer, coach.scene, coach.camera);
    if (window.boot.done() === false) return stopTraining();
    document.body.classList.remove('training-loading');
    const stage = document.querySelector('.stage');
    last = performance.now();
    requestAnimationFrame(frame);
    stage.inert = false;
    stage.setAttribute('aria-busy', 'false');
    begin();
  } catch (error) {
    stopTraining();
    window.boot.fail(error);
  }
}

start();

hostBridge.setSnapshot(()=>({phase:state,motion:pocket.link}));
