import { hostBridge } from '../../../engine/host-bridge.js';
// Track & Field — a hurdles race over 3 laps (1–4) in a real stadium, played with the
// phone in your pocket. A workout, not an elimination: run in place and you
// run round the track (lane 4, the bends are the game's), jump every hurdle,
// race five others to the line. Hit a hurdle and it goes down and you
// stumble — you lose time, never the race. Silent on purpose.
//
// The flow around the race is the other maps' (the phone, the profile, the
// warm-up, JUMP to start, dev mode), so it all feels like one game.

import * as THREE from 'three';
import { GLTFLoader } from '../../../engine/three/GLTFLoader.js';
import { MeshoptDecoder } from '../../../engine/three/libs/meshopt_decoder.module.js';
import { PocketSource, mergeCfg } from '../../../engine/motion-controller.js';
import { GENERIC } from '../../../engine/lib/motion-detector.js';
import * as Profile from '../../../engine/profile.js';
import { Stillness, STILL, PACE, metresRun } from '../common/motion.js';
import { Calories, KCAL } from '../../../engine/calories.js';
import { Crowd } from '../../../engine/body/bots.js';
import { Hands } from '../../../engine/body/hands.js';
import { qrcode } from '../../../engine/lib/qrcode.js';
import { devPanel } from '../../../engine/developer-panel.js';
import { Arena } from './arena.js';
import { RACE, SPEED, lanePoint, raceS, raceMetres, hurdleSpots } from './rules.js';

const $ = id => document.getElementById(id);
const Q = new URLSearchParams(location.search);
let DEV = Q.get('dev') === '1';
const dev = { god: false, hold: false, hud: true, live: null, assist: Q.get('assist') === '1' };
// the first two hurdles are called (JUMP!), then nothing: you see them coming
const coach = { calls: 0 };
const teaching = () => dev.assist || coach.calls < 2;
const AUTO = Q.get('auto') || '';                 // test player: 1 = flat out · jog = jogs · late = never jumps · idle = walks (&laps=N for short tests)
const STEP = Number(Q.get('step')) || 0;
const SHADOWS = Q.get('shadows') !== '0';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const LANE = RACE.lane;
const LAPS_KEY = 'track.laps';
RACE.laps = Number(Q.get('laps')) ? Math.min(4, Math.max(1, Number(Q.get('laps')))) : (() => { try { return Math.min(4, Math.max(1, Number(localStorage.getItem(LAPS_KEY)) || RACE.laps)); } catch { return RACE.laps; } })();
let M = raceMetres(RACE.laps);                     // the race, in metres of your lane
const hurdleTotal = () => { let n = 0; for (const d0 of hurdleSpots(LANE)) for (let d = d0; d <= M - RACE.clearEnd; d += raceMetres(1)) n++; return n; };
const AIR = 0.6;                                  // a plain jump keeps you up this long
const COMMIT_S = 1.8;                             // a jump this close (in time) to a hurdle is a jump for it
const COMMIT_M = 8;                               // …or this close in metres (a slow runner)
const LAUNCH_S = 0.3;                             // …and the leap itself goes up this long before it
const LATE_S = 0.18;                              // a jump heard this late after reaching it still clears it

const ui = {
  overlay: $('overlay'), overlayTitle: $('overlayTitle'), overlayText: $('overlayText'), overlayBtns: $('overlayBtns'),
  clock: $('clock'), toGo: $('toGo'), win: $('win'), winSub: $('winSub'), winBurst: $('winBurst'), winKicker: $('winKicker'), winTitle: $('winTitle'),
  lightWord: $('lightWord'), trackFill: $('trackFill'), trackMe: $('trackMe'), rivals: $('rivals'),
  place: $('placeN'), hurdlesN: $('hurdlesN'), feed: $('feed'),
  dist: $('dist'), kcalN: $('kcalN'), kgIn: $('kgIn'), who: $('whoText'), pose: $('pose'),
  callout: $('callout'), tip: $('tip'), hint: $('hint'), hintArrow: $('hintArrow'), hintText: $('hintText'),
  meter: $('meter'), meterBar: $('meterBar'), meterLbl: $('meterLbl'), flash: $('flash'),
};

// ------------------------------------------------------------------ three
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = SHADOWS; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.id = 'gl';
document.body.insertBefore(renderer.domElement, document.body.firstChild);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0xcfe0ee);
const camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.05, 1200); camera.rotation.order = 'YXZ';
scene.add(camera);
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
const arena = new Arena(scene);
const crowd = new Crowd(scene, { style: 'athlete' });
const hands = new Hands(camera, { sleeve: null });   // a singlet: bare arms
const pocket = new PocketSource();
const still = new Stillness();          // its footfalls move you before a rhythm is known; the profile's freeze practice
let pace = { ...PACE };
let profile = Profile.load();
addEventListener('player-profile',()=>{profile=Profile.load();});
// No profile yet: straight to the training — before loading anything — and back here when it is saved.
// (Not in dev: the Dev panel and ?dev=1 work without one.)
if (!profile && new URLSearchParams(location.search).get('dev') !== '1') location.replace(Profile.trainingUrl());
let profiling = null;
const KG_KEY = 'squid.kg';
const cal = new Calories((() => { try { return Number(localStorage.getItem(KG_KEY)) || KCAL.defaultKg; } catch { return KCAL.defaultKg; } })());
ui.kgIn.value = String(cal.kg);
ui.kgIn.onchange = () => { const v = clamp(Number(ui.kgIn.value) || KCAL.defaultKg, 30, 200); ui.kgIn.value = String(v); cal.kg = v; try { localStorage.setItem(KG_KEY, String(v)); } catch {} };
pocket.onSample = s => still.push(s);

let state = 'loading';      // loading | connect | welcome | pocketing | warm | profiling | summary | ready | intro | play | done
let lastLap = 1;
let me = null, rivals = [], intro = null, paused = false, lastFrame = 0, raceT = 0, finishers = 0;
let keyEvents = [];
const jlog = [];   // jumps heard and hurdles met, for tests (window.__sq.jlog)
const keys = { run: false, fast: false };
window.__sq = { get state() { return state; }, get me() { return me; }, get rivals() { return rivals; }, get profiling() { return profiling; }, pocket, arena, crowd, hands, camera, renderer, still, get raceT() { return raceT; }, jlog };

function newMe() { return { armed: null, pendingHit: null, d: 0, speed: 0, jumpAt: -9, air: AIR, hopY: 0, stumble: 0, cleared: 0, hit: 0, metres: 0, lastD: 0, done: false, doneT: null, place: 0, time: 0, cardDone: false, cardAt: 0, idleT: 0 }; }
me = newMe();

// --------------------------------------------------------------- the card
let cardTimer = null;
function card(title, html, buttons = [], auto = 0, tone = '') {
  clearInterval(cardTimer); cardTimer = null;
  ui.overlayTitle.textContent = title; ui.overlayTitle.className = tone;
  ui.overlayText.innerHTML = html + (auto ? '<p class="auto" id="cardAuto"></p>' : '');
  ui.overlayBtns.innerHTML = ''; ui.overlayBtns.hidden = !buttons.length;
  for (const b of buttons) { const el = document.createElement('button'); el.className = 'btn' + (b.primary ? ' primary' : ''); el.textContent = b.label; el.onclick = b.onClick; ui.overlayBtns.appendChild(el); }
  ui.overlay.hidden = false;
  if (auto) {
    const primary = buttons.find(b => b.primary) || buttons[0]; let left = auto;
    const tick = () => { const el = $('cardAuto'); if (el) el.textContent = `${primary.label} in ${left}… (Enter now)`; if (left-- <= 0) { clearInterval(cardTimer); cardTimer = null; primary.onClick(); } };
    tick(); cardTimer = setInterval(tick, 1000);
  }
}
function hideCard() { clearInterval(cardTimer); cardTimer = null; ui.overlay.hidden = true; }
function pressPrimary() { const btns = [...ui.overlayBtns.querySelectorAll('button')]; const b = btns.find(x => x.className.includes('primary')) || btns[0]; if (b && !ui.overlay.hidden) { b.click(); return true; } return false; }

// the cards the flow shows in more than one place (and the dev panel shows on demand)
function stillCard(again = false) { card('STAND STILL', again ? '<p>Still moving… two seconds without moving.</p>' : '<p>Feet together, arms down. Two seconds.</p>'); }
function noSignalCard(then = 'play') { card('NO SIGNAL', '<p>The phone stopped sending. Check its screen — it should say <b>Playing</b>.</p>', [{ label: 'Try again', primary: true, onClick: () => warm(then) }], 6); }
function phoneLostCard() { card('PHONE LOST', '<p>Waiting for the phone… check its screen says <b>Sensing</b>, and that both devices are connected to the network.</p><p class="why">The race is paused.</p>', [{label:'Reconnect phone',onClick:()=>location.assign('/')}]); }
const menu = on => document.body.classList.toggle('menu', on);

// ---------------------------------------------------------------- the flow (the other maps')
async function askForPhone() {
  state = 'connect'; menu(true);
  let where = { phoneError: 'Could not reach the connection service. Check your network and try again.' };
  try { where = await hostBridge.connectionInfo(true); } catch {}
  if(where.phoneError){card('PHONE CONNECTION UNAVAILABLE',`<p>${where.phoneError}</p>`,[{label:'Try again',primary:true,onClick:askForPhone}]);return;}
  const url = where.phoneUrl;
  let qrSvg = '';
  try { const qr = qrcode(0, 'M'); qr.addData(url); qr.make(); qrSvg = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); } catch {}
  card('CONNECT YOUR PHONE', `
    <p>Scan with your phone camera, or open this address in Safari or Chrome:</p>
    ${qrSvg ? `<div class="qr-wrap"><div class="qr-card">${qrSvg}</div></div>` : ''}
    <div class="url">${url}</div>
    ${where.pairCode ? `<p class="why">Or enter this code on your phone</p><div style="font-size:32px;font-weight:800;letter-spacing:.2em;font-variant-numeric:tabular-nums">${where.pairCode}</div>` : ""}
    <p class="why">${where.hosted ? "Keep this page open on both devices." : "Same Wi-Fi as this computer."} Nothing to install.</p>
    <p class="wait">waiting for the phone…</p>`, [{ label: 'No phone — play with keyboard', onClick: () => enterDev() }]);
  const tick = setInterval(() => {
    if (state !== 'connect') return clearInterval(tick);
    if (pocket.streaming) { clearInterval(tick); profile ? welcome() : train(); }
  }, 250);
}
function welcome() {
  state = 'welcome';
  card('WELCOME BACK', `
    <p>Phone connected. Your profile from <b>${new Date(profile.created).toLocaleDateString()}</b> is ready.</p>
    <p class="why">Different pants than last time? Make a new profile — the phone sits differently in every pocket.</p>`, [
    { label: 'Play', primary: true, onClick: () => pocketing('play') },
    { label: 'New profile', onClick: () => train() },
  ], 6);
}

/** No profile yet, or a new one: the gym — one training for every game — then straight back here. */
function train() { location.href = Profile.trainingUrl(); }
function pocketing(then = 'play') {
  state = 'pocketing';
  card('PHONE IN YOUR POCKET', `
    <p>Put the phone in your <b>right front pocket</b>, screen against your leg, top of the phone pointing down.</p>
    <p class="why">Snug pants are best — a phone swinging in a loose pocket hears your jumps late.</p>`, [
    { label: 'It is in my pocket', primary: true, onClick: () => warm(then) },
  ], 8);
}
async function warm(then) {
  state = 'warm';
  stillCard();
  const ok = await pocket.warmUp((tries) => { if (tries === 8) stillCard(true); });
  if (!ok) { noSignalCard(then); return; }
  toReady();
}
function showWho() { ui.who.textContent = profile ? new Date(profile.created).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : 'no profile'; }
function applyProfile() {
  if (!profile) { pocket.applyCfg(GENERIC); pace = { ...PACE }; still.cfg = { ...STILL }; return; }
  pocket.applyCfg(mergeCfg(GENERIC, profile.cfg)); pace = { ...PACE, ...profile.pace }; still.cfg = { ...STILL, ...(profile.still || {}) }; showWho();
}
function toReady() {
  applyProfile(); resetRace();
  state = 'ready'; menu(true);
  const best = bestTime();
  card('TRACK & FIELD', `
    <ul class="rules">
      <li><b class="s">1</b><span><b>Run in place</b> to run — the faster your legs, the faster you go. The bends are ours.</span></li>
      <li><b class="s">2</b><span><b>Jump</b> every hurdle — one every 35 m, every lap. Clip one and it goes down and you stumble.</span></li>
      <li><b class="s">3</b><span><b>${RACE.laps} ${RACE.laps === 1 ? 'lap' : 'laps'}</b>, ${Math.round(M)} m, five rivals. Beat them to the line.${best ? ` Your best: <b>${fmtT(best)}</b>.` : ''}</span></li>
    </ul>
    <p><span class="key">JUMP</span> to start${DEV ? ' · <span class="key">SPACE</span> on the keyboard' : ''}</p>`,
    [{label:'Start game',primary:true,onClick:startFromReady}, ...[1, 2, 3, 4].map(n => ({ label: `${n} ${n === 1 ? 'LAP' : 'LAPS'}`, primary: n === RACE.laps, onClick: () => setLaps(n) }))]);
}
function setLaps(n) {
  RACE.laps = n; M = raceMetres(n); try { localStorage.setItem(LAPS_KEY, String(n)); } catch {}
  arena.layout(M); toReady();
}

// ---------------------------------------------------------------- the race
// base pace (m/s), where each one likes to sit relative to you (m, + = ahead), and how hard they push against
// a very fast runner: their pace never drops below `f` × your own average — normal runs are unchanged, a
// great run still meets someone at the front
const RIVAL = [
  { lane: 2, pace: 5.9, off: 3, f: 0.93, kit: { shirt: '#1f5fd0', shorts: '#f2f2f2', shoe: '#ffffff' } },
  { lane: 3, pace: 6.3, off: 6, f: 0.95, kit: { shirt: '#f2c417', shorts: '#1f5f2a', shoe: '#1f5f2a' } },
  { lane: 5, pace: 5.3, off: -2, f: 0.9, kit: { shirt: '#ffffff', shorts: '#1a2a6a', shoe: '#2aa8ff' } },
  { lane: 6, pace: 6.7, off: 9, f: 0.97, kit: { shirt: '#c8202a', shorts: '#1a1a22', shoe: '#ff7a1a' } },
  { lane: 7, pace: 4.9, off: -6, f: 0.86, kit: { shirt: '#0f8a4a', shorts: '#0f8a4a', shoe: '#ffe000' } },
];
function resetRace() {
  crowd.clear();
  me = newMe(); raceT = 0; finishers = 0; hands.reset(); cal.reset(); hostBridge.begin();
  const used = new Set();
  rivals = RIVAL.map((r, i) => {
    let num; do { num = 1 + Math.floor(Math.random() * 455); } while (used.has(num)); used.add(num);
    const p = lanePoint(r.lane, raceS(r.lane, 0, M));
    const b = crowd.add(num, p.x, p.z, { kit: r.kit });
    b.facing = Math.atan2(p.dx, p.dz);
    return { ...r, bot: b, d: 0, speed: 0, done: false, time: 0, stumble: 0, met: 0, clip: Math.random() < 0.6 ? 2 + Math.floor(Math.random() * 8 * RACE.laps) : -1, lastAt: -1 };
  });
  for (const r of rivals) placeRival(r, 0);
  hideWin(); setTip(''); ui.hint.hidden = true; showMeter(false);
  ui.feed.innerHTML = '';
  ui.lightWord.textContent = `LAP 1/${RACE.laps}`; lastLap = 1;
  arena.layout(M);
}
function placeRival(r, dt) {
  const p = lanePoint(r.lane, raceS(r.lane, r.d, M)), b = r.bot;
  b.facing = Math.atan2(p.dx, p.dz); b.x = p.x; b.z = p.z; b.root.position.set(p.x, 0, p.z); b.root.rotation.y = b.facing;
}

let introRuns = 0;
function startIntro() { hideCard(); menu(false); state = 'intro'; introRuns++; intro = { t: 0, full: introRuns === 1 }; }
function stepIntro(t, dt) {
  intro.t += dt;
  const T = intro.t;
  const lines = intro.full ? [
    [0.0, 1.0, 'TRACK & FIELD', `${RACE.laps} ${RACE.laps === 1 ? 'lap' : 'laps'} · ${Math.round(M)} m hurdles`, 'pink'],
    [1.0, 1.95, 'RUN IN PLACE', 'your legs are your speed', 'green'],
    [1.95, 2.9, 'JUMP THE HURDLES', 'one every 35 m, every lap', 'white'],
  ] : [];
  const go = intro.full ? 2.9 : 0;
  const L = lines.find(l => T >= l[0] && T < l[1]);
  if (L) callout(L[0] === 0 ? L[2] : L[2], L[3], L[4], 0.3);
  if (T >= go && T < go + 1.5) { const k = T - go; callout(k < 0.6 ? 'ON YOUR MARKS' : k < 1.2 ? 'SET' : 'GO!', '', k < 1.2 ? 'white' : 'green', 0.3); }
  if (T >= go + 1.2) { state = 'play'; }
}
const fmtT = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const ordinal = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || 'th');

function stepRace(t, dt, read) {
  const racing = state === 'play' && !me.done;
  if (state === 'play' || state === 'done') raceT += dt;

  // ---- your legs → your speed round the track
  let target = 0;
  if (racing) {
    if (pocket.streaming && read.ready) {
      const hz = read.cadenceHz;
      target = hz > 0 ? (hz <= pace.slowHz ? SPEED.walk : hz <= pace.jogHz ? lerp(SPEED.walk, SPEED.jog, (hz - pace.slowHz) / (pace.jogHz - pace.slowHz)) : (hz <= pace.fastHz ? lerp(SPEED.jog, SPEED.fast, (hz - pace.jogHz) / (pace.fastHz - pace.jogHz)) : lerp(SPEED.fast, SPEED.flat, clamp((hz - pace.fastHz) / 0.7, 0, 1)))) : (still.footRecent(650) ? SPEED.walk : 0);
    }
    if (!pocket.streaming && keys.run) target = keys.fast ? SPEED.flat : SPEED.jog;   // keyboard: Shift is flat out
    if (AUTO === 'idle') target = SPEED.walk;
  }
  if (me.stumble > 0) { me.stumble -= dt; target *= 0.3; }
  if (me.done) me.speed = Math.max(0, me.speed - 2.6 * dt);   // over the line: run it out over ~15 m and stop
  else me.speed += (target - me.speed) * (1 - Math.exp(-dt / (target > me.speed ? SPEED.tauUp : SPEED.tauDown)));
  const cad = pocket.streaming && read.ready ? read.cadenceHz : (keys.run ? (keys.fast ? 3.2 : 2.6) : 0);
  if (racing) { me.metres += metresRun(cad, dt, pace); cal.step(dt, cad); }

  // ---- jumps: a jump near a hurdle is stretched so it carries you over (take-off anywhere in the last ~2.5 s of running to it is fine)
  for (const e of read.events) {
    if (e.action !== 'UP' || (!racing && state !== 'play')) continue;
    if (racing) cal.jump();
    hands.jump(t);
    // a jump heard just after reaching a hurdle still clears it (the phone hears the take-off, not the decision)
    if (me.pendingHit) { me.pendingHit = null; me.cleared++; flashFeed('HURDLE ' + me.cleared); me.jumpAt = t; me.air = 0.45; me.hurdleJump = true; continue; }
    const h = arena.nextHurdle(LANE, me.d + 0.05);
    const until = h ? (h.at - me.d) / Math.max(1.2, me.speed) : Infinity;
    jlog.push({ t: +raceT.toFixed(2), jump: h ? h.at : null, until: +until.toFixed(2), v: +me.speed.toFixed(1) });
    // up to 1.4 s before a hurdle, a jump commits you to it: the leap itself goes up right before it
    if (h && (until < COMMIT_S || h.at - me.d < COMMIT_M)) { me.armed = { h, at: h.at }; }
    else { me.jumpAt = t - (e.lead || 0); me.air = AIR; me.hurdleJump = false; }
  }
  if (me.armed && !me.armed.h.down && me.armed.at > me.d - 0.5) {
    const until = (me.armed.at - me.d) / Math.max(1.2, me.speed);
    if (until <= LAUNCH_S) { me.jumpAt = t; me.air = clamp(until + 0.38, 0.5, 0.85); me.hurdleJump = true; me.armed = null; }
  } else me.armed = null;
  const airT = t - me.jumpAt, airborne = airT >= -0.001 && airT < me.air;
  me.hopY = airborne ? Math.sin(clamp(airT / me.air, 0, 1) * Math.PI) * (me.hurdleJump ? 0.75 : 0.45) : 0;

  // ---- moving along the lane, and the hurdles you meet
  const d0 = me.d;
  me.d += me.speed * dt;
  if (racing) {
    const h = arena.nextHurdle(LANE, d0);
    if (h && h.at <= me.d && !h.down && !h.falling) {
      jlog.push({ t: +raceT.toFixed(2), hurdle: h.at, airborne, armed: !!me.armed });
      if (airborne || (DEV && dev.god)) { me.cleared++; flashFeed('HURDLE ' + me.cleared); }
      else if (!me.pendingHit) me.pendingHit = { h, at: t };
    }
    if (me.pendingHit && t - me.pendingHit.at > LATE_S) {
      const h = me.pendingHit.h; me.pendingHit = null;
      arena.kick(h); me.stumble = 0.9; me.hit++; me.shake = 0.5; flashFeed('CLIPPED IT');
    }
    const lap = Math.min(RACE.laps, 1 + Math.floor(me.d / raceMetres(1)));
    if (lap !== lastLap) { lastLap = lap; ui.lightWord.textContent = `LAP ${lap}/${RACE.laps}`; callout(lap === RACE.laps ? 'FINAL LAP' : `LAP ${lap}`, lap === RACE.laps ? 'give it everything' : `${Math.round(M - me.d)} m to go`, lap === RACE.laps ? 'pink' : 'white', 1.4); }
    if (me.d >= M) finish(t);
  }

  // ---- the others
  const mePos = me.d;
  if (racing && raceT > 3) me.avg = me.avg == null ? me.speed : me.avg + (me.speed - me.avg) * (1 - Math.exp(-dt / 15));   // your pace over the last ~15 s
  for (const r of rivals) {
    if (r.done) { r.speed = Math.max(0, r.speed - 2.6 * dt); }
    else if (state === 'play' || state === 'done') {
      // a gentle pull toward where they like to be relative to you, for most of the race; the last 80 m are their own
      const base = Math.max(r.pace, (me.avg || 0) * r.f);                        // a great runner raises the field
      let want = base;
      const off = r.off * clamp((M - 80 - r.d) / 400, 0, 1);                      // where they like to sit fades out over the last lap: it is a race at the end
      if (r.d < M - 80 && !me.done) want = clamp(base + 0.25 * (mePos + off - r.d), base * 0.72, base * 1.28);
      else if (!me.done) want = base * 1.03;                                       // their finishing kick
      if (r.stumble > 0) { r.stumble -= dt; want *= 0.35; }
      r.speed += (want - r.speed) * (1 - Math.exp(-dt / 0.6));
    } else r.speed = 0;
    const rd0 = r.d; r.d += r.speed * dt;
    // their hurdles: a hurdler's stride just before each one; one of them may clip one
    const h = arena.nextHurdle(r.lane, rd0);
    if (h && !h.down && !h.falling) {
      const until = (h.at - r.d) / Math.max(0.5, r.speed);
      const clips = r.clip === r.met;
      if (!clips && until < 0.28 && r.bot.hop <= 0) r.bot.jumpOver(0.56, true);
      if (h.at <= r.d && r.lastAt !== h.at) { r.lastAt = h.at; r.met++; if (clips) { arena.kick(h); r.stumble = 0.8; r.clip = -1; } }
    }
    if (!r.done && r.d >= M) { r.done = true; r.time = raceT; finishers++; }
    r.bot.go(r.speed); r.bot.speed = r.speed;      // their stride follows their speed (athlete gait in bots.js)
  }
  crowd.update(dt, t);
  for (const r of rivals) placeRival(r, dt);
  arena.update(dt);

  // ---- teaching: the first two hurdles are called
  if (racing) {
    const h = arena.nextHurdle(LANE, me.d);
    const gap = h ? h.at - me.d : Infinity;
    if (teaching() && gap < Math.max(5, me.speed * 1.2)) { setHint({ arrow: '▲', text: 'JUMP!' }); if (me.called !== h.at) { me.called = h.at; coach.calls++; } }
    else setHint(null);
    if (me.speed < 0.5 && raceT > 2.5 && me.d < 20) { me.idleT += dt; if (me.idleT > 1.2) setTip('<b>Run in place</b> to run', 0.3); } else me.idleT = 0;
  } else setHint(null);
}

function place() { return 1 + rivals.filter(r => r.d > me.d || (r.done && (!me.done || r.time < me.time))).length; }

function finish(t) {
  me.done = true; me.time = raceT; me.place = place(); finishers++;
  state = 'done'; me.doneT = 0;
  hands.win(t); setHint(null);
  const best = bestTime(), pb = !me.cheated && !window.__devPreview && (!best || me.time < best);   // a dev teleport never sets a best
  if (pb) saveBest(me.time);
  showWin(me.place === 1 ? 'WINNER' : 'FINISHED', `${ordinal(me.place)} · ${fmtT(me.time)}${pb ? ' · BEST' : ''}`);
}
function stepDone(t, dt) {
  me.doneT += dt;
  if (!me.cardDone && me.doneT > 5.2) { me.cardDone = true; results(); }
}

let winTimer = null;
function showWin(title, sub) {
  ui.winTitle.textContent = title; ui.winSub.textContent = sub;
  const glyphs = ['★', '•', '★'];
  ui.winBurst.innerHTML = Array.from({ length: 22 }, (_, i) => {
    const a = (i / 22) * Math.PI * 2 + Math.random() * 0.3, r = 180 + Math.random() * 260;
    return `<i style="--x:${(Math.cos(a) * r).toFixed(0)}px;--y:${(Math.sin(a) * r * 0.7).toFixed(0)}px;--r:${(Math.random() * 360 - 180).toFixed(0)}deg;--d:${(0.6 + Math.random() * 0.25).toFixed(2)}s">${glyphs[i % 3]}</i>`;
  }).join('');
  ui.win.hidden = false; ui.win.className = ''; void ui.win.offsetWidth; ui.win.className = 'in';
  ui.flash.style.background = '#ff2d78'; ui.flash.style.transition = 'none'; ui.flash.style.opacity = 0.35; void ui.flash.offsetWidth; ui.flash.style.transition = 'opacity .8s'; ui.flash.style.opacity = 0;
  setTimeout(() => { ui.flash.style.background = '#fff'; }, 900);
  clearTimeout(winTimer);
  winTimer = setTimeout(() => { ui.win.className = 'out'; winTimer = setTimeout(() => { ui.win.hidden = true; }, 520); }, 3100);
}
function hideWin() { clearTimeout(winTimer); ui.win.hidden = true; ui.win.className = ''; }

function results() {
  recordStats(); me.cardAt = clockNow();
  const best = bestTime();
  const stats = `<div class="statrow">
      <div><b>${fmtT(me.time)}</b><span>your time</span></div>
      <div><b>${Math.round(cal.kcal)}</b><span>kcal</span></div>
      <div><b>${me.cleared}/${hurdleTotal()}</b><span>hurdles clean</span></div>
      <div><b>${Math.round(me.metres)}</b><span>metres run</span></div></div>`;
  const note = me.hit ? `You clipped ${me.hit} ${me.hit === 1 ? 'hurdle' : 'hurdles'} — jump a stride earlier, the jump carries you over.` : 'Every hurdle clean.';
  card(me.place === 1 ? 'WINNER' : `${ordinal(me.place).toUpperCase()} PLACE`, `<p>${RACE.laps} ${RACE.laps === 1 ? 'lap' : 'laps'} · ${Math.round(M)} m hurdles in <b>${fmtT(me.time)}</b>${best ? ` · best <b>${fmtT(best)}</b>` : ''}.</p>${stats}<p class="why">${note}</p>`, [
    { label: 'Race again', primary: true, onClick: () => { resetRace(); startIntro(); } },
    { label: 'Watch', onClick: () => hideCard() },
    { label: 'Lobby', onClick: () => { location.href = '../../../'; } },
  ], 0, me.place === 1 ? 'teal' : '');
  menu(true);
}
const BEST_KEY = 'squid.track.best';
function bestTime() { try { return Number(localStorage.getItem(BEST_KEY + '.' + RACE.laps)) || 0; } catch { return 0; } }   // one best per race length
function saveBest(s) { try { localStorage.setItem(BEST_KEY + '.' + RACE.laps, String(s)); } catch {} }
function recordStats() {
  if (window.__devPreview) return;   // a dev-panel preview is not a game played
  hostBridge.update({...{metres:(me?.metres || 0),kcal:cal.kcal,active:cal.active,jumps:cal.jumps,squats:cal.squats,seconds:cal.seconds},outcome:me.place === 1 ? 'Winner' : 'Finished'},true);
  try {
    const K = 'squid.stats.v1', s = JSON.parse(localStorage.getItem(K) || 'null') || { v: 1, games: 0, wins: 0, metres: 0, kcal: 0, jumps: 0, squats: 0 };
    s.games++; if (me.place === 1) s.wins++; s.metres += me.metres; s.kcal += cal.kcal; s.jumps += cal.jumps; s.squats += cal.squats;
    localStorage.setItem(K, JSON.stringify(s));
  } catch {}
}

// ------------------------------------------------------------------ the hud
let calloutUntil = 0;
function callout(big, small = '', tone = 'white', hold = 0.9) {
  const html = big + (small ? `<small>${small}</small>` : '');
  const fresh = html !== ui.callout.innerHTML || ui.callout.style.opacity !== '1';
  ui.callout.innerHTML = html; ui.callout.className = 'hud ' + tone; ui.callout.style.opacity = 1;
  if (fresh) { void ui.callout.offsetWidth; ui.callout.classList.add('pop'); }
  calloutUntil = clockNow() + hold;
}
let tipUntil = 0, tipText = '';
function setTip(html, hold = 1.2) {
  if (!html) { if (clockNow() > tipUntil) ui.tip.style.opacity = 0; return; }
  if (html !== tipText) { tipText = html; ui.tip.innerHTML = html; }
  ui.tip.style.opacity = 1; tipUntil = clockNow() + hold;
}
function setHint(h) { if (!h) { ui.hint.hidden = true; return; } ui.hint.hidden = false; ui.hintArrow.textContent = h.arrow; ui.hintText.textContent = h.text; }
function showMeter(on, v = 0, label = 'HOLD STILL') { ui.meter.style.opacity = on ? 1 : 0; if (!on) return; ui.meterBar.style.width = (clamp(v, 0, 1) * 100).toFixed(0) + '%'; ui.meterLbl.textContent = label; }
function flashFeed(text) {
  const d = document.createElement('div'); d.textContent = text; d.className = text.startsWith('CLIPPED') ? 'bad' : 'good';
  ui.feed.insertBefore(d, ui.feed.firstChild);
  while (ui.feed.children.length > 3) ui.feed.removeChild(ui.feed.lastChild);
  setTimeout(() => d.classList.add('old'), 1600); setTimeout(() => d.remove(), 2300);
}
function drawRivals() {
  // the others on the bar: small dots, so you see who is ahead
  if (!ui.rivals._n) { ui.rivals.innerHTML = rivals.map(() => '<i></i>').join(''); ui.rivals._n = rivals.length; }
  [...ui.rivals.children].forEach((el, i) => { const r = rivals[i]; if (r) el.style.left = (clamp(r.d / M, 0, 1) * 100).toFixed(1) + '%'; });
}

// ------------------------------------------------------------------ input
addEventListener('keydown', e => {
  if (e.key === 'Enter') { if (pressPrimary()) e.preventDefault(); return; }
  if (e.repeat) return;
  if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') { keys.run = true; keys.fast = e.shiftKey; e.preventDefault(); return; }
  if (e.key === 'Shift') { keys.fast = true; return; }
  if (e.key === ' ') { e.preventDefault(); if (state === 'ready') { startFromReady(); return; } keyEvents.push({ action: 'UP' }); return; }
  if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') { keyEvents.push({ action: 'DOWN' }); return; }
  if (DEV && devKey(e)) e.preventDefault();
});
addEventListener('keyup', e => {
  if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') keys.run = false;
  if (e.key === 'Shift') keys.fast = false;
});
function startFromReady() { if (state === 'ready') { resetRace(); startIntro(); } }

// ---------------------------------------------------------------- dev mode
const DEV_KEYS = [['W', 'run (hold) · Shift faster'], ['Space', 'jump'], ['G', 'god (clear every hurdle)'], ['N', 'to the next hurdle'], ['E', 'near the finish'], ['I', 'hints on/off'], ['P', 'pause'], ['H', 'hide HUD'], ['R', 'restart']];
function enterDev() {
  DEV = true;
  const el = $('dev');
  el.innerHTML = '<div class="devTop"><span>DEV</span><span id="devLive">—</span></div><div class="devKeys">' + DEV_KEYS.map(([k, v]) => `<b>${k}</b> ${v}`).join(' · ') + '</div>';
  el.hidden = false; dev.live = $('devLive'); document.body.classList.add('dev');
  if (state === 'connect' || state === 'loading') toReady();
}
function devKey(e) {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  switch (k) {
    case 'r': resetRace(); startIntro(); return true;
    case 'g': dev.god = !dev.god; callout(dev.god ? 'GOD MODE ON' : 'GOD MODE OFF', '', 'pink', 0.8); return true;
    case 'p': dev.hold = !dev.hold; callout(dev.hold ? 'PAUSED' : 'GO', '', 'white', 0.6); return true;
    case 'h': dev.hud = !dev.hud; for (const id of ['topLeft', 'topCenter', 'topRight', 'tip', 'hint', 'meter', 'credit']) { const n = $(id); if (n) n.style.visibility = dev.hud ? '' : 'hidden'; } return true;
    case 'i': dev.assist = !dev.assist; callout(dev.assist ? 'HINTS ON' : 'HINTS OFF', '', 'white', 0.9); return true;
  }
  if (state !== 'play') return false;
  switch (k) {
    case 'n': { const h = arena.nextHurdle(LANE, me.d + 0.1); if (h) me.d = h.at - 9; me.cheated = true; return true; }
    case 'e': me.cheated = true; me.d = Math.max(me.d, M - 30); for (const r of rivals) r.d = Math.max(r.d, M - 36 + r.off * 0.5); return true;
  }
  return false;
}
function devLive() {
  if (!dev.live) return;
  const h = arena.nextHurdle(LANE, me.d);
  const txt = `${state} · ${me.d.toFixed(1)} m · ${me.speed.toFixed(2)} m/s · next hurdle ${h ? (h.at - me.d).toFixed(1) + ' m' : '—'} · lap ${lastLap}/${RACE.laps} · place ${place()} · ${fmtT(raceT)}${pocket.streaming ? ' · PHONE' : ' · keys'}${dev.god ? ' · GOD' : ''}${dev.hold ? ' · PAUSED' : ''}`;
  if (txt !== dev.live._t) { dev.live._t = txt; dev.live.textContent = txt; }
}

// the scripted player (?auto=1): runs hard and jumps each hurdle 0.35 s out; late = never jumps
let autoHurdle = null;
function autoplay(t) {
  if (!AUTO) return;
  keys.run = state === 'play' && !me.done && AUTO !== 'idle'; keys.fast = keys.run && AUTO === '1';
  if (state !== 'play' || me.done || (AUTO !== '1' && AUTO !== 'jog')) return;
  const h = arena.nextHurdle(LANE, me.d);
  if (h && h.at !== autoHurdle && (h.at - me.d) / Math.max(0.5, me.speed) < 0.35) { autoHurdle = h.at; keyEvents.push({ action: 'UP' }); }
}

// ------------------------------------------------------------------ loop
function readInput() { const read = pocket.poll(); if (keyEvents.length) { read.events = [...read.events, ...keyEvents]; keyEvents = []; } return read; }
let simT = 0, lastT = 0;
function clockNow() { return lastT; }
let fpsAcc = 0, fpsN = 0, fpsAt = 0, scale = Math.min(devicePixelRatio, 1.75);
function watchFps(now, dt) {
  fpsAcc += dt; fpsN++;
  if (now - fpsAt < 2000) return;
  const fps = fpsN / Math.max(0.001, fpsAcc); fpsAcc = 0; fpsN = 0; fpsAt = now; window.__fps = fps;
  const want = fps < 24 ? Math.max(0.6, scale - 0.15) : fps < 40 ? Math.max(0.6, scale - 0.05) : fps > 56 ? Math.min(Math.min(devicePixelRatio, 1.75), scale + 0.05) : scale;
  if (Math.abs(want - scale) > 0.01) { scale = want; renderer.setPixelRatio(scale); resize(); }
}
let camYaw = null, lean = 0, shake = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const real = (now - (lastFrame || now)) / 1000; lastFrame = now;
  const dt = STEP || Math.min(0.05, real);
  simT += dt;
  const t = STEP ? simT : now / 1000;
  lastT = t;
  watchFps(now, real);
  autoplay(t);
  const read = readInput();

  if (state === 'ready' && read.events.some(e => e.action === 'UP')) startFromReady();
  if (state === 'done' && me.cardDone && t - me.cardAt > 1.5 && read.events.some(e => e.action === 'UP')) { resetRace(); startIntro(); }

  const inGame = state === 'intro' || state === 'play';
  if (inGame && pocket.lastSampleAt > 0 && pocket.link === 'lost') {
    if (!paused) { paused = true; phoneLostCard(); }
  } else if (paused && inGame && pocket.link !== 'lost') { paused = false; hideCard(); pocket.queue = []; }

  if (!paused && !(DEV && dev.hold)) {
    if (state === 'intro') { stepIntro(t, dt); crowd.update(dt, t); for (const r of rivals) placeRival(r, 0); }
    else if (state === 'play' || state === 'done') { stepRace(t, dt, read); if (state === 'done') stepDone(t, dt); }
    else crowd.update(dt, t);
  }
  if (clockNow() > calloutUntil) ui.callout.style.opacity = 0;
  setTip('');

  // ---- HUD
  ui.clock.textContent = fmtT(raceT);
  ui.place.textContent = `${me.done ? me.place : place()}/${rivals.length + 1}`;
  ui.hurdlesN.textContent = `${me.cleared}/${hurdleTotal()}`;
  const prog = clamp(me.d / M, 0, 1);
  ui.trackFill.style.width = (prog * 100).toFixed(1) + '%'; ui.trackMe.style.left = (prog * 100).toFixed(1) + '%';
  const togo = String(Math.ceil(Math.max(0, M - me.d))); if (ui.toGo.textContent !== togo) ui.toGo.textContent = togo;
  drawRivals();
  ui.dist.textContent = Math.round(me.metres) + ' m';
  ui.kcalN.textContent = String(Math.round(cal.kcal));

  // ---- the camera: your eyes on lane 4, turning with the bends, leaning into them
  const p = lanePoint(LANE, raceS(LANE, me.d, M)), ahead = lanePoint(LANE, raceS(LANE, me.d + 4, M));
  const yawWant = Math.atan2(-(ahead.x - p.x), -(ahead.z - p.z));
  if (camYaw == null) camYaw = yawWant;
  let dy = yawWant - camYaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
  camYaw += dy * (1 - Math.exp(-dt / 0.12));
  const curving = Math.abs(p.dx * ahead.dz - p.dz * ahead.dx) > 0.01;
  lean += ((curving ? -0.045 * clamp(me.speed / SPEED.fast, 0, 1) : 0) - lean) * (1 - Math.exp(-dt / 0.4));
  const bob = hands.update(dt, t, { moving: me.speed > 0.4, pace: clamp(me.speed / 3.1, 0, 2.4), cadence: pocket.streaming ? (read.cadenceHz || 2.6) : (keys.fast ? 3.2 : 2.6), frozen: false, fear: 0, crouch: 0 });
  shake = Math.max(0, (me.shake || 0)); me.shake = Math.max(0, (me.shake || 0) - dt * 2);
  const stumbleDip = me.stumble > 0 ? Math.sin(clamp(me.stumble / 0.9, 0, 1) * Math.PI) * 0.22 : 0;
  let yaw = camYaw, pitch = -0.04 - stumbleDip * 0.6;
  if (state === 'done') { const k = clamp((me.doneT - 1.3) / 1.6, 0, 1), e2 = k * k * (3 - 2 * k); yaw += Math.PI * e2; pitch -= 0.05 * e2; }
  camera.position.set(p.x, 1.66 + me.hopY + bob.y - stumbleDip, p.z);
  camera.rotation.set(pitch + (Math.random() - 0.5) * shake * 0.02, yaw, lean + bob.roll);
  camera.fov = 72 + clamp(me.speed - 3, 0, 5) * 1.6; camera.updateProjectionMatrix();
  if (window.__camOverride) { const o = window.__camOverride; camera.position.set(...o.pos); camera.lookAt(...o.look); hands.visible = false; } else hands.visible = true;
  arena.follow(p.x, p.z);
  if (arena.dome) arena.dome.position.copy(camera.position);
  renderer.render(scene, camera);
  try { pocket.drawPanel(ui.pose); } catch {}
  if (DEV) devLive();
}

// ------------------------------------------------------------------ boot
(async () => {
  const boot = window.__boot;
  try {
    boot && boot.step('loading the stadium…');
    await arena.load(loader);
    boot && boot.step('loading the runners…');
    await crowd.load('../../../engine/body/athlete-avatar.glb', loader);
    boot && boot.step('loading your hands…');
    await hands.load('../../../engine/body/controller-arms.glb', loader);
  } catch (e) { boot && boot.fail('The game could not load its models: ' + (e.message || e)); throw e; }
  window.__gameUp = true;
  resetRace();
  requestAnimationFrame(frame);
  pocket.start();
  pocket.onPhoneSays = m => { if (m.t === 'hello' || m.t === 'ready') pocket.send({ t: 'scene', where: 'squid' }); };
  setInterval(() => { if (pocket.link !== 'lost') pocket.send({ t: 'scene', where: 'squid' }); }, 3000);
  showWho();
  $('newProfile').onclick = () => { if (state === 'play' || state === 'intro') return; train(); };
  if (DEV) { enterDev(); toReady(); if (AUTO) setTimeout(() => startFromReady(), 400); return; }
  askForPhone();
})();

// ---------------------------------------------------------------- dev panel
// Every screen of this map, one click each, without a phone (engine/developer-panel.js):
// the game's own functions put it in each moment, so the preview is the real UI.
const devWait = ms => new Promise(r => setTimeout(r, ms));
const devProfile = () => profile || { v: 1, created: new Date().toISOString(), measures: {}, cfg: {}, run: {}, pace: {}, still: {}, notes: [] };
function devCard() { hideCard(); paused = false; resetRace(); menu(true); }
async function devPlaying(full = false) {
  devCard(); if (full) introRuns = 0;
  startIntro(); if (!full) intro.t = 99;
  for (let i = 0; i < 60 && state !== 'play'; i++) await devWait(50);
}
devPanel({
  pocket,
  onOpen: () => { if (!DEV) enterDev(); },
  settle: () => { clearInterval(cardTimer); cardTimer = null; },
  screens: [
    { group: 'Cards', name: 'Connect', show: () => { devCard(); askForPhone(); } },
    { group: 'Cards', name: 'Welcome back', show: () => { devCard(); profile = devProfile(); welcome(); } },
    { group: 'Cards', name: 'Pocket', show: () => { devCard(); pocketing('play'); } },
    { group: 'Cards', name: 'Stand still', show: () => { devCard(); state = 'warm'; stillCard(); } },
    { group: 'Cards', name: 'Still moving', show: () => { devCard(); state = 'warm'; stillCard(true); } },
    { group: 'Cards', name: 'No signal', show: () => { devCard(); state = 'warm'; noSignalCard(); } },
    { group: 'Cards', name: 'Ready', show: () => { devCard(); toReady(); } },
    { group: 'Cards', name: 'Phone lost', show: async () => { await devPlaying(); paused = true; phoneLostCard(); } },
    { group: 'In game', name: 'Intro briefing', show: () => devPlaying(true) },
    { group: 'In game', name: 'Racing', show: () => devPlaying() },
    { group: 'In game', name: 'Hurdle ahead', show: async () => { await devPlaying(); devKey({ key: 'n' }); } },
    { group: 'In game', name: 'Near the finish', show: async () => { await devPlaying(); devKey({ key: 'e' }); } },
    { group: 'End', name: 'Finish (stamp)', show: async () => { await devPlaying(); me.cheated = true; finish(clockNow()); } },
    { group: 'End', name: 'Results card', show: () => {
      devCard(); me.time = 212.4; me.place = 2; me.cleared = 28; me.hit = 2; me.metres = 1240; me.done = true; me.cardDone = true;
      cal.kcal = 41; state = 'done'; results();
    } },
  ],
});

// Phone snapshots and dated results share the game's existing counters.
hostBridge.setSnapshot(() => ({phase:state, motion:pocket.link, ...{metres:(me?.metres || 0),kcal:cal.kcal,active:cal.active,jumps:cal.jumps,squats:cal.squats,seconds:cal.seconds}}));
setInterval(() => { if (state === 'play' && !paused) hostBridge.update({metres:(me?.metres || 0),kcal:cal.kcal,active:cal.active,jumps:cal.jumps,squats:cal.squats,seconds:cal.seconds}); }, 2000);
