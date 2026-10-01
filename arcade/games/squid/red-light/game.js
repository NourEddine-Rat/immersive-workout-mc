import { hostBridge } from '../../../engine/host-bridge.js';
// Red Light, Green Light — the first Squid Game, played with the phone in
// your pocket.
//
// You see through the eyes of player 456, your own hands in front of you.
// Run in place and you cross the field; the direction is the game's (the
// rules allow no other: straight at the doll). When she turns, freeze —
// the phone is watching you as closely as she is (common/motion.js). Jump
// the bodies that fall in your way, squat to pick up the gifts on the sand,
// and cross the red line before the clock runs out.
//
// The flow is subway's: connect the phone → your profile (first time) →
// stand still → jump to start. Then the briefing, and the game.

import * as THREE from 'three';
import { GLTFLoader } from '../../../engine/three/GLTFLoader.js';
import { MeshoptDecoder } from '../../../engine/three/libs/meshopt_decoder.module.js';
import { PocketSource, mergeCfg } from '../../../engine/pocket.js';
import { GENERIC } from '../../../engine/lib/detect.js';
import * as Profile from '../../../engine/profile.js';
import { Stillness, STILL, PACE, paceFor, metresRun } from '../common/motion.js';
import { Calories, KCAL } from '../../../engine/calories.js';
import { Crowd } from '../../../engine/body/bots.js';
import { Hands } from '../../../engine/body/hands.js';
import { FX, Gift, PERKS } from '../common/fx.js';
// The chant is visual only; its timing still comes from the doll's rules.
const SYLLABLES = ['무', '궁', '화', '꽃', '이', '피', '었', '습', '니', '다'];
const ROMAN = ['mu', 'gung', 'hwa', 'kko', 'chi', 'pi', 'eot', 'seum', 'ni', 'da'];
import { qrcode } from '../../../engine/lib/qrcode.js';
import { devPanel } from '../../../engine/devpanel.js';
import { Arena, FIELD } from './arena.js';
import { Doll, RULES } from './rules.js';
import { Director, LANE } from './director.js';

const $ = id => document.getElementById(id);
const Q = new URLSearchParams(location.search);
let DEV = Q.get('dev') === '1';                     // keyboard play and the test keys (?dev=1, or the button on the connect card)
const dev = { god: false, hold: false, hud: true, giftK: 0, live: null, assist: Q.get('assist') === '1' };
// The game does not hold your hand. The first two red lights of a session
// teach (callouts, the lit song, the meter, the warnings), the jump and the
// squat are shown once each, the first time — after that it is you, the
// song and the doll. ?assist=1 (or I in dev mode) keeps every hint on.
const coach = { reds: 0, told: new Set(), giftShown: null };
const teaching = () => dev.assist || coach.reds <= 2;
const AUTO = Q.get('auto') || '';                     // a scripted player, for testing: 1 = plays well · late = stops too late (caught) · idle = never moves (time up)
const BOTS = Math.max(4, Math.min(120, Number(Q.get('bots')) || 56));
const STEP = Number(Q.get('step')) || 0;               // tests: a fixed time step per frame, whatever the wall clock does
const SHADOWS = Q.get('shadows') !== '0';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

const ui = {
  overlay: $('overlay'), overlayTitle: $('overlayTitle'), overlayText: $('overlayText'), overlayBtns: $('overlayBtns'),
  clock: $('clock'), toGo: $('toGo'), win: $('win'), winSub: $('winSub'), winBurst: $('winBurst'), light: $('light'), lightWord: $('lightWord'), song: $('song'), trackFill: $('trackFill'), trackMe: $('trackMe'),
  leftN: $('leftN'), pot: $('pot'), potN: $('potN'), feed: $('feed'),
  dist: $('dist'), kcalN: $('kcalN'), kgIn: $('kgIn'), who: $('whoText'), pose: $('pose'),
  callout: $('callout'), tip: $('tip'), hint: $('hint'), hintArrow: $('hintArrow'), hintText: $('hintText'),
  meter: $('meter'), meterBar: $('meterBar'), meterLbl: $('meterLbl'), perk: $('perk'), perkShape: $('perkShape'), perkTitle: $('perkTitle'), perkSay: $('perkSay'), inv: $('inv'),
  vignette: $('vignette'), flash: $('flash'), splat: $('splat'), fade: $('fade'),
};

// ------------------------------------------------------------------ three
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = SHADOWS; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.id = 'gl';
document.body.insertBefore(renderer.domElement, document.body.firstChild);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x9dbccf);
const camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.03, 300); camera.rotation.order = 'YXZ';
scene.add(camera);
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  ui.splat.width = innerWidth; ui.splat.height = innerHeight;
}
addEventListener('resize', resize); resize();

const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
const arena = new Arena(scene);
const crowd = new Crowd(scene);
const hands = new Hands(camera);
const fx = new FX(scene);
const pocket = new PocketSource();
const still = new Stillness();
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

// every raw sample goes to the doll's eyes (they only count while she looks)
pocket.onSample = s => still.push(s);

let state = 'loading';      // loading | connect | welcome | pocketing | warm | profiling | summary | ready | intro | play | caught | dead | won | over
let doll = new Doll();
let director = null;
let gifts = [];
let me = null;
let intro = null;
let paused = false;
let lastFrame = 0;
let redIndex = 0, pot = 0, playT = 0;
let keyEvents = [];
const keys = { run: false, fast: false };
window.__sq = { get state() { return state; }, get intro() { return intro; }, get profiling() { return profiling; }, get me() { return me; }, get doll() { return doll; }, get director() { return director; }, still, pocket, arena, crowd, hands, fx, camera, renderer, get gifts() { return gifts; } };

function newMe() {
  return {
    x: LANE, z: FIELD.startZ, speed: 0, alive: true, safe: false, crouch: 0, crouchT: 0, hop: null, hopY: 0, jumpT: 9,
    shield: false, sprintUntil: 0, deathT: null, why: null, wonT: null, metres: 0, still0: 0, idleT: 0, look: 0, immuneUntil: 0,
    lastGrab: -9, blockedBy: null, shotDone: false, poolDone: false, cardDone: false, shake: 0,
  };
}
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
function phoneLostCard() { card('PHONE LOST', '<p>Waiting for the phone… check its screen says <b>Sensing</b>, and that both devices are connected to the network.</p><p class="why">The game is paused — the doll waits too.</p>', [{label:'Reconnect phone',onClick:()=>location.assign('/')}]); }
const menu = on => document.body.classList.toggle('menu', on);

// ---------------------------------------------------------------- the flow

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
  const d = new Date(profile.created);
  card('WELCOME BACK, 456', `
    <p>Phone connected. Your profile from <b>${d.toLocaleDateString()}</b> is ready — the doll knows how you move.</p>
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
    <p class="why">Snug pants are best — in a loose pocket the phone swings, and the doll sees a swinging phone as a moving player.</p>`, [
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

function showWho() {
  if (!profile) { ui.who.textContent = 'no profile'; return; }
  ui.who.textContent = new Date(profile.created).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
function applyProfile() {
  if (!profile) { pocket.applyCfg(GENERIC); pace = { ...PACE }; still.cfg = { ...STILL }; return; }
  pocket.applyCfg(mergeCfg(GENERIC, profile.cfg));
  pace = { ...PACE, ...profile.pace };
  still.cfg = { ...STILL, ...(profile.still || {}) };
  showWho();
}

function toReady() {
  applyProfile();
  resetRound(false);
  state = 'ready'; menu(true);
  card('RED LIGHT, GREEN LIGHT', `
    <ul class="rules">
      <li><b class="s">○</b><span><b>Run in place</b> to cross the field — only during green light. Faster legs, faster across.</span></li>
      <li><b class="s">△</b><span>When she turns: <b>freeze</b>. Not a step, not a twitch. Anyone she sees moving is shot.</span></li>
      <li><b class="s">□</b><span>Cross the <b style="color:#ff2a3a">red line</b> before the clock hits zero. <b>Jump</b> over the fallen, <b>squat</b> to grab the gifts.</span></li>
    </ul>
    <p><span class="key">JUMP</span> to start${DEV ? ' · <span class="key">SPACE</span> on the keyboard' : ''}</p>`, [{label:'Start game',primary:true,onClick:startFromReady}]);
}

/** Put everyone back on the start line. */
function resetRound(full = true) {
  fx.clear();
  for (const g of gifts) g.dispose(); gifts = [];
  crowd.clear();
  director = new Director(crowd);
  director.setup(BOTS);
  doll = new Doll();
  me = newMe();
  hands.reset();
  cal.reset(); hostBridge.begin(); still.arm(false); still.meter = 0;
  redIndex = 0; pot = 0; playT = 0;
  ui.feed.innerHTML = ''; ui.potN.textContent = '0'; ui.inv.innerHTML = '';
  ui.vignette.style.opacity = 0; ui.fade.style.opacity = 0; ui.splat.style.opacity = 0; document.body.classList.remove('dying');
  arena.setHead(0); arena.setScan(0, 0); arena.setClock(RULES.limitS);
  // the gifts on your line: four, one of each, spread across the field
  const kinds = Object.keys(PERKS).sort(() => Math.random() - 0.5);
  [-21, -6, 7.5, 18].forEach((z, i) => gifts.push(new Gift(scene, kinds[i], LANE, z + (Math.random() - 0.5) * 3)));
  hideWin(); songCells(); ui.song.style.visibility = teaching() ? '' : 'hidden'; setLight('wait'); showMeter(false); setTip(''); ui.hint.hidden = true;
}

let introRuns = 0;
function startIntro() {
  hideCard(); menu(false);
  state = 'intro';
  introRuns++;
  intro = { t: 0, full: introRuns === 1 };   // the whole briefing once a session; after that just READY, GO
}

function stepIntro(t, dt) {
  intro.t += dt;
  const T = intro.t;
  const lines = intro.full ? [
    [0.0, 1.0, 'RED LIGHT<br>GREEN LIGHT', '', 'pink'],
    [1.0, 1.95, 'RUN IN PLACE', 'only during green light', 'green'],
    [1.95, 2.9, 'FREEZE!', 'when she turns round', 'red'],
    [2.9, 3.85, 'CROSS THE LINE', `before ${fmt(RULES.limitS)} runs out`, 'white'],
  ] : [];
  const go = intro.full ? 3.85 : 0;
  const L = lines.find(l => T >= l[0] && T < l[1]);
  if (L) callout(L[2], L[3], L[4], 0.3);
  if (T >= go && T < go + 0.65) callout(T < go + 0.35 ? 'READY' : 'GO!', '', T < go + 0.35 ? 'white' : 'green', 0.3);
  if (T >= go + 0.65) { state = 'play'; doll.start(); }
}
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ------------------------------------------------------------------ the hud

let calloutUntil = 0;
function callout(big, small = '', tone = 'white', hold = 0.9) {
  const html = big + (small ? `<small>${small}</small>` : '');
  const fresh = html !== ui.callout.innerHTML || ui.callout.style.opacity !== '1';
  ui.callout.innerHTML = html;
  ui.callout.className = 'hud ' + tone; ui.callout.style.opacity = 1;
  if (fresh) { void ui.callout.offsetWidth; ui.callout.classList.add('pop'); }
  calloutUntil = clockNow() + hold;
}
let tipUntil = 0, tipText = '';
function setTip(html, hold = 1.2) {
  if (!html) { if (clockNow() > tipUntil) ui.tip.style.opacity = 0; return; }
  if (html !== tipText) { tipText = html; ui.tip.innerHTML = html; }
  ui.tip.style.opacity = 1; tipUntil = clockNow() + hold;
}
function setHint(h) {
  if (!h) { ui.hint.hidden = true; return; }
  ui.hint.hidden = false; ui.hintArrow.textContent = h.arrow; ui.hintText.textContent = h.text;
}
function showMeter(on, v = 0, label = 'HOLD STILL') {
  ui.meter.style.opacity = on ? 1 : 0;
  if (!on) return;
  ui.meterBar.style.width = (clamp(v, 0, 1) * 100).toFixed(0) + '%';
  ui.meter.classList.toggle('hot', v > 0.55);
  ui.meterLbl.textContent = v > 0.55 ? 'SHE SEES YOU — STOP!' : label;
}
function setLight(kind) {
  ui.light.className = kind === 'green' ? 'green' : kind === 'red' ? 'red' : '';
  ui.lightWord.className = ui.light.className;
  ui.lightWord.textContent = kind === 'green' ? 'GREEN LIGHT' : kind === 'red' ? 'RED LIGHT' : 'WAIT';
}
function songCells() {
  ui.song.className = '';
  ui.song.innerHTML = SYLLABLES.map((s, i) => `<span class="${i === 9 ? 'last' : ''}">${s}<small>${ROMAN[i]}</small></span>`).join('');
}
function feed(text) {
  const d = document.createElement('div'); d.textContent = text;
  ui.feed.insertBefore(d, ui.feed.firstChild);
  while (ui.feed.children.length > 5) ui.feed.removeChild(ui.feed.lastChild);
  setTimeout(() => d.classList.add('old'), 4200); setTimeout(() => d.remove(), 5000);
}
function bumpPot(n) {
  pot += n;
  ui.potN.textContent = pot.toLocaleString('en-US');
  ui.pot.classList.remove('bump'); void ui.pot.offsetWidth; ui.pot.classList.add('bump');
}
let perkTimer = null;
function perkBanner(kind) {
  const P = PERKS[kind];
  ui.perkShape.textContent = { circle: '○', triangle: '△', square: '□', star: '☆' }[P.shape];
  ui.perkTitle.textContent = P.title; ui.perkSay.textContent = P.say;
  clearTimeout(perkTimer); ui.perk.hidden = false; ui.perk.className = 'hud in';
  perkTimer = setTimeout(() => { ui.perk.className = 'hud out'; perkTimer = setTimeout(() => { ui.perk.hidden = true; }, 450); }, 1900);
}
function drawInv(t) {
  const items = [];
  if (me.shield) items.push('<div class="it"><b>△</b>A FRIEND\'S HAND</div>');
  if (t < me.sprintUntil) items.push(`<div class="it"><b>□</b>SECOND WIND ${Math.ceil(me.sprintUntil - t)}s</div>`);
  if (doll.nextKind === 'slow') items.push('<div class="it"><b>☆</b>SLOW SONG NEXT</div>');
  const html = items.join('');
  if (html !== ui.inv._h) { ui.inv._h = html; ui.inv.innerHTML = html; }
}
/** Blood on the lens: one impact from an edge, its spray and a few runs — the middle of the view stays clear. */
function splat() {
  const c = ui.splat, x = c.getContext('2d'), W = c.width, H = c.height, M = Math.min(W, H);
  x.clearRect(0, 0, W, H);
  const blob = (px, py, r, a) => {
    // an irregular drop: a ring of overlapping circles round a core
    x.fillStyle = `rgba(${95 + Math.random() * 40 | 0},0,${4 + Math.random() * 6 | 0},${a})`;
    x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
    for (let k = 0; k < 7; k++) { const an = Math.random() * Math.PI * 2, d = r * (0.5 + Math.random() * 0.6); x.beginPath(); x.arc(px + Math.cos(an) * d, py + Math.sin(an) * d, r * (0.25 + Math.random() * 0.45), 0, Math.PI * 2); x.fill(); }
  };
  // where it came from: one of the lower corners or a side, never the middle
  const side = Math.random() < 0.5 ? -1 : 1;
  const ox = W / 2 + side * W * (0.36 + Math.random() * 0.12), oy = H * (0.35 + Math.random() * 0.45);
  blob(ox, oy, M * 0.07, 0.9);
  // the spray: streaks and droplets thrown inward from the impact
  for (let i = 0; i < 70; i++) {
    const an = Math.atan2(H / 2 - oy, W / 2 - ox) + (Math.random() - 0.5) * 2.2;
    const d = M * (0.05 + Math.pow(Math.random(), 1.6) * 0.42), r = M * (0.003 + Math.random() * 0.012) * (1 - d / (M * 0.5));
    const px = ox + Math.cos(an) * d, py = oy + Math.sin(an) * d;
    if (Math.random() < 0.25) { x.strokeStyle = 'rgba(110,0,6,0.85)'; x.lineWidth = Math.max(1, r * 0.8); x.beginPath(); x.moveTo(px, py); x.lineTo(px - Math.cos(an) * r * 6, py - Math.sin(an) * r * 6); x.stroke(); }
    blob(px, py, Math.max(1.2, r), 0.88);
  }
  // runs: a few drops sliding down the glass
  for (let i = 0; i < 6; i++) {
    const px = ox + (Math.random() - 0.5) * M * 0.14, py = oy + (Math.random() - 0.3) * M * 0.06, w = M * (0.004 + Math.random() * 0.006), len = M * (0.06 + Math.random() * 0.22);
    const g = x.createLinearGradient(0, py, 0, py + len); g.addColorStop(0, 'rgba(105,0,6,0.85)'); g.addColorStop(1, 'rgba(90,0,5,0.6)');
    x.fillStyle = g; x.fillRect(px - w / 2, py, w, len); x.beginPath(); x.arc(px, py + len, w * 0.9, 0, Math.PI * 2); x.fill();
  }
  c.style.transition = 'none'; c.style.opacity = 1; void c.offsetWidth; c.style.transition = 'opacity 6s'; c.style.opacity = 0.8;
}

// ---------------------------------------------------------------- the round

function onDoll(ev, t) {
  if (ev.type === 'song') {
    songCells(); setLight('green'); tipUntil = 0; setTip('');
    if (teaching() && state === 'play') callout('GREEN LIGHT', coach.reds === 0 ? 'run in place' : '', 'green', 0.8);
    ui.song.style.visibility = teaching() ? '' : 'hidden';
  }
  if (ev.type === 'syllable') { const s = ui.song.children[ev.i]; if (s) s.classList.add('on'); }
  if (ev.type === 'turn') {
    ui.song.classList.add('done'); setLight('red');
    coach.reds++;
    if (teaching() && state === 'play') callout('RED LIGHT', 'FREEZE!', 'red', 1.1);
    redIndex++;
  }
  if (ev.type === 'away') { showMeter(false); }
  if (ev.type === 'timeup') {
    setLight('red'); callout('TIME\'S UP', '', 'red', 2.5);
    if (me.alive && !me.safe) die(t, 'time');
  }
  director.onDoll(ev, playerFor(), doll);
}
const playerFor = () => ({ z: me.z, alive: me.alive && !me.safe });

function stepPlay(t, dt, read) {
  if (state === 'play' && me.alive && !me.safe) playT += dt;
  const evs = doll.update(dt);
  for (const e of evs) onDoll(e, t);
  arena.setHead(doll.head);
  arena.setScan(doll.watching ? 1 : 0, t);
  arena.setClock(doll.clock);

  const active = state === 'play' && me.alive && !me.safe;
  // ---- the doll's eyes on you
  // she counts from a moment into her turn (only a real move then), and everything once her eyes are on you
  const turning = doll.state === 'turn' && doll.t >= still.cfg.turnFreeS;
  const counting = active && (doll.watching || turning) && t > me.immuneUntil;
  still.arm(counting, turning ? 'turn' : 'scan');
  if (!pocket.streaming) still.pushFake(dt, keys.run);
  if (counting) {
    for (const e of read.events) if (e.action === 'UP' || e.action === 'DOWN') still.meter += 1.2;   // a jump or a squat is never still — in the turn too
    if (still.caught) { if (DEV && dev.god) { still.meter = 0; callout('GOD MODE', 'she saw you — dev mode let you live', 'pink', 0.8); } else if (me.shield) saved(t); else caught(t); }
  }
  if (active && (doll.state === 'turn' || doll.watching) && teaching()) showMeter(true, still.meter);
  else if (state !== 'caught' || me.why !== 'moved') showMeter(false);
  // ---- your legs → across the field
  let target = 0;
  const canMove = active && !doll.watching;
  if (canMove) {
    if (pocket.streaming && read.ready) target = paceFor(read.cadenceHz, pace) || (still.footRecent(650) ? pace.walkMs * 0.9 : 0);
    if (!pocket.streaming && keys.run) target = keys.fast ? pace.fastMs : pace.jogMs;
    if (t < me.sprintUntil) target *= 1.5;
  }
  me.speed += (target - me.speed) * (1 - Math.exp(-dt / (target > me.speed ? pace.tauUp : pace.tauDown)));
  if (!canMove && doll.watching) me.speed = 0;
  // the legs' own distance and burn, whatever the field is doing
  const cad = pocket.streaming && read.ready ? read.cadenceHz : (keys.run ? (keys.fast ? 3.2 : 2.6) : 0);
  if (state === 'play' && me.alive) { me.metres += metresRun(cad, dt, pace); cal.step(dt, cad); }

  // ---- moves: jump (bodies), squat (gifts)
  for (const e of read.events) {
    if (e.action === 'UP') {
      if (state === 'play' && me.alive) cal.jump();
      hands.jump(t); me.jumpT = 0;
      const body = bodyInFront();
      if (canMove && body && body.z0 - me.z < 2.6 && !me.hop) { me.hop = { from: me.z, to: body.z1 + 0.45, t: 0, dur: 0.72 }; coach.told.add('body'); }
    }
    if (e.action === 'DOWN') {
      if (state === 'play' && me.alive) cal.squat();
      me.crouchT = 1.15;
      const g = giftInFront(2.1);
      if (canMove && g && !g.taken) { hands.reachFor = new THREE.Vector3(g.x + 0.05, 0.28, g.z); me.grab = { g, at: t }; }
    }
  }
  if (me.grab && t - me.grab.at > 0.32) { const g = me.grab.g; me.grab = null; if (!g.taken) takeGift(g, t); }
  if (me.grab == null && hands.reachFor && t - me.lastGrab > 0.9) hands.reachFor = null;

  // ---- walking (and what stops you)
  const z0 = me.z;
  if (me.hop) {
    me.hop.t += dt; const k = clamp(me.hop.t / me.hop.dur, 0, 1);
    me.z = lerp(me.hop.from, me.hop.to, k * k * (3 - 2 * k)); me.hopY = Math.sin(k * Math.PI) * 0.5;
    if (k >= 1) { me.hop = null; me.hopY = 0; }
  } else if (active || state === 'won') {
    me.z += me.speed * dt;
    const body = bodyInFront();
    me.blockedBy = null;
    if (body && me.z > body.z0 - 0.45) { me.z = Math.max(z0, body.z0 - 0.45); me.blockedBy = 'body'; }
    const bot = director.blocking(me.z);
    if (bot && me.z > bot.z - 0.9) { me.z = Math.max(z0, bot.z - 0.9); me.blockedBy = 'bot'; me.blockBot = bot; }
  }
  if (active && me.z >= FIELD.lineZ) won(t);

  // ---- prompts and tips
  if (active && !doll.watching && doll.state !== 'turn') {
    const body = bodyInFront(), g = giftInFront(3.2);
    // shown once each, the first time (then the player knows)
    if (body && body.z0 - me.z < 3.4 && (dev.assist || !coach.told.has('body'))) { setHint({ arrow: '▲', text: 'JUMP OVER!' }); setTip('Someone fell in your way — <b>jump</b> over them', 0.3); }
    else if (g && !g.taken && (dev.assist || !coach.told.has('gift'))) { coach.giftShown = g; setHint({ arrow: '▼', text: 'SQUAT TO GRAB' }); setTip('A gift on the sand — <b>squat</b> as you reach it', 0.3); }
    else setHint(null);
    if (coach.giftShown && (coach.giftShown.taken || coach.giftShown.z < me.z - 0.6)) { coach.told.add('gift'); coach.giftShown = null; }
    if (me.speed < 0.25 && doll.state === 'song' && teaching()) { me.idleT += dt; if (me.idleT > 1.4) setTip('<b>Run in place</b> to move forward', 0.3); } else me.idleT = 0;
    if (doll.untilTurn < 0.9 && doll.state === 'song' && teaching()) setTip('Get ready to <b>FREEZE</b>…', 0.3);
  } else setHint(null);
  if (active && doll.watching && teaching()) setTip('Don\'t move. Not a muscle.', 0.3);

  // ---- the others
  director.update(dt, t, doll, playerFor());
  for (const e of director.drain(me.z)) onDirector(e, t);
  for (const g of gifts) g.update(t, dt);
}

function bodyInFront() {
  let best = null;
  for (const d of director.bodies) if (Math.abs(d.x - LANE) < 0.6 && d.z0 > me.z + 0.2 && d.z0 - me.z < 6 && (!best || d.z0 < best.z0)) best = d;
  return best;
}
function giftInFront(within) {
  let best = null;
  for (const g of gifts) if (!g.taken && g.z - me.z > -0.5 && g.z - me.z < within && (!best || g.z < best.z)) best = g;
  return best;
}
function takeGift(g, t) {
  g.take(() => (hands.bones && hands.bones.HandR ? hands.bones.HandR.getWorldPosition(new THREE.Vector3()) : camera.position.clone())); me.lastGrab = t;
  const k = g.kind;
  if (k === 'time') doll.addTime(10);
  if (k === 'shield') me.shield = true;
  if (k === 'sprint') me.sprintUntil = t + 10;
  if (k === 'slow') doll.nextKind = 'slow';
  perkBanner(k);
}

function onDirector(e, t) {
  if (e.kind === 'shoot') {
    const b = e.bot;
    const chest = (b.rig.b.Spine2 || b.root).getWorldPosition(new THREE.Vector3());
    const gun = arena.sniperFor(chest);
    fx.laser(arena.eyeWorld, () => chest, 0.22);
    fx.muzzle(gun); fx.tracer(gun, chest);
    fx.blood(chest, chest.clone().sub(gun).normalize(), 55);
    const d = camera.position.distanceTo(chest);
    feed(`${String(b.num).padStart(3, '0')} ELIMINATED`);
    bumpPot(100000000);
    if (d < 9 && me.alive && !(doll.watching || doll.state === 'turn')) hands.flinch(t);
    me.fearKick = 1;
  }
  if (e.kind === 'down') {
    fx.pool(e.p, 1.1 + Math.random() * 0.6); fx.dust(e.p);
  }
}

/** A friend's hand: the one gift that saves you once. */
function saved(t) {
  me.shield = false; still.meter = 0; me.immuneUntil = t + 2.2;
  callout('HELD!', 'a friend grabbed you — she did not see', 'pink', 1.6);
}

function caught(t) {
  if (!me.alive) return;
  me.alive = false; me.why = 'moved'; me.deathT = 0; state = 'caught';
  still.arm(false); showMeter(true, 1);
  hands.caught(t);
  fx.laser(arena.eyeWorld, () => camera.position.clone().add(new THREE.Vector3(0, -0.25, 0)), 1.0);
  callout('YOU MOVED', '', 'red', 1.0);
  ui.vignette.style.opacity = 1;
  setHint(null);
}
function die(t, why) {
  if (!me.alive) return;
  me.alive = false; me.why = why; me.deathT = 0.35; state = 'caught';
  hands.caught(t); ui.vignette.style.opacity = 1; setHint(null); showMeter(false); still.arm(false);
}

/** The shot, the fall, the stain, the card — driven by time since caught. */
function stepDeath(t, dt) {
  me.deathT += dt;
  const T = me.deathT;
  if (!me.shotDone && T >= 0.9) {
    me.shotDone = true;
    const gun = arena.sniperFor(camera.position);
    fx.muzzle(gun); fx.tracer(gun, camera.position.clone().add(new THREE.Vector3(0.1, -0.3, 0.3)));
    hands.shot(t); splat(); me.shake = 1.4;
    ui.flash.style.transition = 'none'; ui.flash.style.opacity = 0.85; void ui.flash.offsetWidth; ui.flash.style.transition = 'opacity .5s'; ui.flash.style.opacity = 0;
    feed('456 ELIMINATED'); bumpPot(100000000);
  }
  if (T >= 1.7 && !document.body.classList.contains('dying')) document.body.classList.add('dying');
  if (!me.poolDone && T >= 2.1) { me.poolDone = true; const p = new THREE.Vector3(me.x + 0.45, 0, me.z + 0.2); fx.pool(p, 1.6); fx.dust(p); }
  if (T >= 3.2) ui.fade.style.opacity = 0.55;
  if (!me.cardDone && T >= 3.8) { me.cardDone = true; state = 'dead'; results(false); }
}

function won(t) {
  me.safe = true; me.wonT = 0; state = 'won'; me.fieldT = playT;
  still.arm(false); showMeter(false); setHint(null);
  hands.win(t);
  showWin(`crossed with ${fmt(doll.clock)} left`);
}

/** The moment you cross: the three shapes draw, the stamp lands, shapes burst out — then the results. */
let winTimer = null;
function showWin(sub) {
  ui.winSub.textContent = sub;
  const glyphs = ['○', '△', '□'];
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

function stepWon(t, dt) {
  me.wonT += dt;
  // walk on a few steps past the line, then turn and watch
  const stop = FIELD.lineZ + 0.35;            // just over the line — well short of the doll's skirt
  me.speed = me.z < stop ? 1.1 : Math.max(0, me.speed - dt * 2);
  if (me.z > stop) me.z = stop;
  if (!me.cardDone && me.wonT > 5.2) { me.cardDone = true; results(true); }   // the stamp goes at 3.1 s, then the heart has the screen
}

function results(win) {
  recordStats(win); me.cardAt = clockNow();
  const eliminated = director.bots.length - director.remaining;
  const secs = win ? me.fieldT : playT;
  const stats = `<div class="statrow">
      <div><b>${Math.round(me.metres)}</b><span>metres run</span></div>
      <div><b>${Math.round(cal.kcal)}</b><span>kcal</span></div>
      <div><b>${cal.jumps}/${cal.squats}</b><span>jumps / squats</span></div>
      <div><b>${fmt(secs)}</b><span>on the field</span></div></div>`;
  const text = win
    ? `<p>You crossed the line with <b>${fmt(doll.clock)}</b> on the clock. <b>${eliminated}</b> ${eliminated === 1 ? 'player is' : 'players are'} already eliminated behind you.</p>${stats}<p class="why">Prize pot so far: ₩ ${pot.toLocaleString('en-US')}</p>`
    : `<p>${me.why === 'time' ? 'The clock ran out before you reached the line.' : 'The doll saw you move.'} ${Math.round(Math.max(0, FIELD.lineZ - me.z))} m from the line.</p>${stats}<p class="why">${me.why === 'time' ? 'Run faster in the green — your legs set your speed.' : 'Stop the moment her song ends, and stand like a statue until she turns back.'}</p>`;
  card(win ? 'YOU MADE IT' : 'ELIMINATED', text, [
    { label: 'Play again', primary: true, onClick: () => { resetRound(); startIntro(); } },
    ...(win ? [{ label: 'Watch', onClick: () => hideCard() }] : []),
    { label: 'Lobby', onClick: () => { location.href = '../../../'; } },
  ], 0, win ? 'teal' : 'red');
  menu(true);
}

function recordStats(win) {
  if (window.__devPreview) return;   // a dev-panel preview is not a game played
  hostBridge.update({...{metres:(me?.metres || 0),kcal:cal.kcal,active:cal.active,jumps:cal.jumps,squats:cal.squats,seconds:cal.seconds},outcome:win ? 'Winner' : 'Eliminated'},true);
  try {
    const K = 'squid.stats.v1', s = JSON.parse(localStorage.getItem(K) || 'null') || { v: 1, games: 0, wins: 0, metres: 0, kcal: 0, jumps: 0, squats: 0 };
    s.games++; if (win) s.wins++; s.metres += me.metres; s.kcal += cal.kcal; s.jumps += cal.jumps; s.squats += cal.squats;
    localStorage.setItem(K, JSON.stringify(s));
  } catch {}
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
// ---------------------------------------------------------------- dev mode
// Keyboard play plus keys that put the game straight into the moment you want
// to test. The phone still drives when one is connected; the keys work either way.
const DEV_KEYS = [
  ['W', 'run (hold) · Shift faster'], ['Space', 'jump'], ['S', 'squat'],
  ['N', 'next phase'], ['1–5', 'next song: normal/fast/slow/trick/stutter'], ['G', 'god mode'],
  ['B', 'body ahead'], ['F', 'gift ahead'], ['K', 'kill someone'], ['L', 'near the line'],
  ['C', 'get caught'], ['X', 'time up'], ['[ ]', 'clock −/+30 s'], ['T', 'twitch'],
  ['I', 'all hints on/off'], ['P', 'pause'], ['H', 'hide HUD'], ['R', 'restart'],
];
function enterDev() {
  DEV = true;
  const el = $('dev');
  el.innerHTML = '<div class="devTop"><span>DEV</span><span id="devLive">—</span></div><div class="devKeys">' + DEV_KEYS.map(([k, v]) => `<b>${k}</b> ${v}`).join(' · ') + '</div>';
  el.hidden = false; dev.live = $('devLive'); document.body.classList.add('dev');
  if (state === 'connect' || state === 'loading') toReady();
}
function devKey(e) {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const inGame = state === 'play';
  const t = clockNow();
  switch (k) {
    case 'r': resetRound(); startIntro(); return true;
    case 'g': dev.god = !dev.god; callout(dev.god ? 'GOD MODE ON' : 'GOD MODE OFF', '', 'pink', 0.8); return true;
    case 'p': dev.hold = !dev.hold; callout(dev.hold ? 'PAUSED' : 'GO', '', 'white', 0.6); return true;
    case 'h': dev.hud = !dev.hud; for (const id of ['topLeft', 'topCenter', 'topRight', 'tip', 'hint', 'meter', 'inv', 'credit']) { const n = $(id); if (n) n.style.visibility = dev.hud ? '' : 'hidden'; } return true;
    case 't': still.meter += still.armed ? 0.5 : 0; return true;
    case 'i': dev.assist = !dev.assist; callout(dev.assist ? 'HINTS ON' : 'HINTS OFF', dev.assist ? 'every hint, every time' : 'first two red lights only', 'white', 0.9); return true;
  }
  if (!inGame) return false;
  switch (k) {
    case 'n': {   // push the doll on to her next phase
      const d = doll;
      if (d.state === 'song') d.t = d.song.dur; else if (d.state === 'turn') d.t = d.R.turnS + d.R.graceS; else if (d.state === 'scan') { d.t = d.scanFor; d.hold = 0; } else if (d.state === 'away') d.t = d.R.awayS;
      return true;
    }
    case '1': case '2': case '3': case '4': case '5': {
      doll.nextKind = ['normal', 'fast', 'slow', 'trick', 'stutter'][Number(k) - 1];
      callout('NEXT SONG', doll.nextKind, 'white', 0.8); return true;
    }
    case 'b': {   // someone falls in your line, 3 m ahead
      const b = director.bots.filter(o => o.alive && o.state !== 'safe').sort((a, c) => Math.abs(a.z - me.z - 3) - Math.abs(c.z - me.z - 3))[0];
      if (b) { b.place(LANE, me.z + 3.4); b.freeze(); if (b.shoot(null, -1)) director.out.push({ kind: 'shoot', bot: b }); }
      return true;
    }
    case 'f': {
      const kinds = Object.keys(PERKS), kind = kinds[dev.giftK++ % kinds.length];
      gifts.push(new Gift(scene, kind, LANE, me.z + 2.4)); callout('GIFT', PERKS[kind].title, 'pink', 0.7); return true;
    }
    case 'k': {   // shoot someone you can see
      const pool = director.bots.filter(o => o.alive && o.state !== 'safe' && o.z > me.z + 2 && o.z < me.z + 25 && Math.abs(o.x - LANE) < 9);
      const b = pool[Math.floor(Math.random() * pool.length)];
      if (b && b.shoot(null, 0)) director.out.push({ kind: 'shoot', bot: b });
      return true;
    }
    case 'l': me.z = Math.max(me.z, FIELD.lineZ - 6); return true;
    case 'c': if (me.alive && !me.safe) caught(t); return true;
    case 'x': doll.clock = Math.min(doll.clock, 0.4); return true;
    case '[': doll.clock = Math.max(1, doll.clock - 30); return true;
    case ']': doll.clock += 30; return true;
  }
  return false;
}
function devLive() {
  if (!dev.live) return;
  const d = doll;
  const phase = d.state === 'song' ? `song ${d.song.kind} · turns in ${d.untilTurn.toFixed(1)}s` : d.state === 'scan' ? `scan ${Math.max(0, d.scanFor - d.t).toFixed(1)}s left` : d.state;
  const txt = `${state} · ${phase} · ${fmt(Math.ceil(d.clock))} · ${Math.max(0, FIELD.lineZ - me.z).toFixed(1)} m to go · ${me.speed.toFixed(2)} m/s · meter ${still.meter.toFixed(2)} (e ${still.eSmooth.toFixed(2)})${pocket.streaming ? ' · PHONE' : ' · keys'}${dev.god ? ' · GOD' : ''}${dev.assist ? ' · HINTS' : ''}${dev.hold ? ' · PAUSED' : ''}`;
  if (txt !== dev.live._t) { dev.live._t = txt; dev.live.textContent = txt; }
}
function startFromReady() { if (state === 'ready') { resetRound(false); startIntro(); } }

// the scripted player (?auto=1): what a good player does, for testing the whole round headless
function autoplay(t) {
  if (!AUTO) return;
  const active = state === 'play' && me.alive && !me.safe;
  keys.run = active && doll.green && (doll.state !== 'song' || doll.untilTurn > 0.35) && doll.state !== 'turn';
  if (AUTO === 'idle') keys.run = false;
  if (AUTO === 'late') keys.run = active && (doll.state !== 'scan' || doll.t < 0.7) && doll.round >= 2;
  keys.fast = keys.run;
  if (!active) return;
  const body = bodyInFront();
  if (body && body.z0 - me.z < 1.4 && !me.hop && doll.state === 'song' && doll.untilTurn > 0.9) keyEvents.push({ action: 'UP' });
  const g = giftInFront(1.2);
  if (g && !me.grab && t - me.lastGrab > 1.2 && doll.state === 'song' && doll.untilTurn > 0.6) { keyEvents.push({ action: 'DOWN' }); me.lastGrab = t; }
}

// ------------------------------------------------------------------ loop
function readInput() {
  const read = pocket.poll();
  if (keyEvents.length) { read.events = [...read.events, ...keyEvents]; keyEvents = []; }
  return read;
}

let simT = 0, lastT = 0;
/** The game's clock in seconds (the simulated one under ?step=). */
function clockNow() { return lastT; }
let fpsAcc = 0, fpsN = 0, fpsAt = 0, scale = Math.min(devicePixelRatio, 1.75);
function watchFps(now, dt) {
  fpsAcc += dt; fpsN++;   // dt here is the real frame time, unclamped
  if (now - fpsAt < 2000) return;
  const fps = fpsN / Math.max(0.001, fpsAcc); fpsAcc = 0; fpsN = 0; fpsAt = now;
  window.__fps = fps;
  const want = fps < 24 ? Math.max(0.6, scale - 0.15) : fps < 40 ? Math.max(0.6, scale - 0.05) : fps > 56 ? Math.min(Math.min(devicePixelRatio, 1.75), scale + 0.05) : scale;
  if (Math.abs(want - scale) > 0.01) { scale = want; renderer.setPixelRatio(scale); resize(); }
}

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

  // the ready card waits for a jump
  if (state === 'ready' && read.events.some(e => e.action === 'UP')) startFromReady();
  if ((state === 'dead' || (state === 'won' && me.cardDone)) && t - (me.cardAt || 0) > 1.5 && read.events.some(e => e.action === 'UP')) { resetRound(); startIntro(); }

  // the phone dropped out mid-game: everything holds still (a Wi-Fi hiccup must never get you shot)
  const inGame = state === 'intro' || state === 'play';
  if (inGame && pocket.lastSampleAt > 0 && pocket.link === 'lost') {
    if (!paused) { paused = true; phoneLostCard(); }
  } else if (paused && inGame && pocket.link !== 'lost') { paused = false; hideCard(); pocket.queue = []; still.meter = 0; }

  if (!paused && !(DEV && dev.hold)) {
    if (state === 'intro') { stepIntro(t, dt); crowd.update(dt, t); }
    else if (state === 'play' || state === 'caught' || state === 'won' || state === 'dead') {
      stepPlay(t, dt, read);
      if (state === 'caught') stepDeath(t, dt);
      if (state === 'won') stepWon(t, dt);
    } else crowd.update(dt, t);
  }
  fx.update(dt);
  if (clockNow() > calloutUntil) ui.callout.style.opacity = 0;
  setTip('');                              // a tip only stays while something keeps asking for it
  drawInv(t);

  // ---- HUD numbers
  ui.clock.textContent = fmt(Math.ceil(doll.clock)).padStart(5, '0');
  ui.clock.classList.toggle('low', doll.clock < 30 && doll.running);
  const prog = clamp((me.z - FIELD.startZ) / (FIELD.lineZ - FIELD.startZ), 0, 1);
  ui.trackFill.style.width = (prog * 100).toFixed(1) + '%'; ui.trackMe.style.left = (prog * 100).toFixed(1) + '%';
  const togo = String(Math.ceil(Math.max(0, FIELD.lineZ - me.z))); if (ui.toGo.textContent !== togo) ui.toGo.textContent = togo;
  ui.leftN.textContent = String(director ? director.remaining + (me.alive ? 1 : 0) : BOTS + 1);
  ui.dist.textContent = Math.round(me.metres) + ' m';
  ui.kcalN.textContent = String(Math.round(cal.kcal));

  // ---- the body: crouch, hop, fear, and the camera on top of it
  me.crouchT = Math.max(0, me.crouchT - dt);
  me.crouch += ((me.crouchT > 0 ? 1 : 0) - me.crouch) * (1 - Math.exp(-dt / 0.12));
  me.jumpT += dt;
  const smallHop = me.hop ? 0 : Math.max(0, Math.sin(clamp(me.jumpT / 0.6, 0, 1) * Math.PI)) * 0.28;
  me.fearKick = Math.max(0, (me.fearKick || 0) - dt * 0.6);
  const fear = clamp((doll.watching || doll.state === 'turn' ? 0.45 + 0.6 * still.meter : 0) + (me.fearKick || 0) * 0.5 + (state === 'caught' ? 1 : 0), 0, 1);
  const bob = hands.update(dt, t, {
    moving: me.speed > 0.15, pace: me.speed, cadence: pocket.streaming ? (read.cadenceHz || 2.4) : (keys.fast ? 3.2 : 2.6),
    frozen: (doll.watching || doll.state === 'turn') && me.alive && !me.safe && state === 'play', fear, crouch: me.crouch,
  });
  me.shake = Math.max(0, me.shake - dt * 1.8);
  const sh = me.shake * me.shake * 0.05;
  let camY = 1.62 - me.crouch * 0.62 + me.hopY + smallHop + bob.y + Math.sin(t * 1.3) * 0.004;
  let yaw = Math.PI, pitch = -0.03 - me.crouch * 0.38, roll = bob.roll;
  let camX = me.x;
  if (state === 'won' || (state === 'over' && me.safe)) {
    const k = clamp((me.wonT - 1.3) / 1.6, 0, 1), e = k * k * (3 - 2 * k);
    yaw = Math.PI + Math.PI * e; pitch = -0.05 - 0.06 * e;
  }
  if (me.deathT != null) {
    // hit, knees go, the ground comes up sideways
    const k = clamp((me.deathT - 0.95) / 0.95, 0, 1), f = k * k;
    const bounce = k >= 1 ? Math.exp(-(me.deathT - 1.9) * 8) * Math.sin((me.deathT - 1.9) * 25) * 0.03 : 0;
    camY = lerp(1.62, 0.22, f) + bounce; roll = lerp(0, 1.32, f); pitch = lerp(-0.03, 0.12, f) + (me.deathT < 1.1 && me.deathT > 0.9 ? 0.18 : 0);
    camX = me.x + 0.25 * f; yaw = Math.PI + 0.25 * f;
  }
  camera.position.set(camX + (Math.random() - 0.5) * sh, camY + (Math.random() - 0.5) * sh, me.z);
  camera.rotation.set(pitch + (Math.random() - 0.5) * sh * 0.5, yaw, roll);
  // a little wider when running, like the subway
  camera.fov = 72 + clamp(me.speed - 1, 0, 2) * 2.2; camera.updateProjectionMatrix();
  hands.visible = !(me.deathT != null && me.deathT > 2.2);
  // debugging: window.__camOverride = { pos: [x, y, z], look: [x, y, z] } puts the eye anywhere (hands hidden)
  if (window.__camOverride) { const o = window.__camOverride; camera.position.set(...o.pos); camera.lookAt(...o.look); hands.visible = false; }

  renderer.render(scene, camera);
  try { pocket.drawPanel(ui.pose); } catch {}
  if (DEV) devLive();
}

// ------------------------------------------------------------------ boot
(async () => {
  const boot = window.__boot;
  try {
    boot && boot.step('loading the field…');
    await arena.load(loader);
    boot && boot.step('loading the players…');
    await crowd.load('../../../engine/body/player.glb', loader);
    boot && boot.step('loading your hands…');
    await hands.load('../../../engine/body/arms.glb', loader);
  } catch (e) { boot && boot.fail('The game could not load its models: ' + (e.message || e)); throw e; }
  window.__gameUp = true;
  resetRound(false);
  requestAnimationFrame(frame);
  pocket.start();
  pocket.onPhoneSays = m => { if (m.t === 'hello' || m.t === 'ready') pocket.send({ t: 'scene', where: 'squid' }); };
  setInterval(() => { if (pocket.link !== 'lost') pocket.send({ t: 'scene', where: 'squid' }); }, 3000);
  showWho();
  $('newProfile').onclick = () => { if (state === 'play' || state === 'intro') return; train(); };
  if (DEV) {
    enterDev();
    toReady();
    if (AUTO) setTimeout(() => startFromReady(), 400);
    return;
  }
  askForPhone();
})();

// ---------------------------------------------------------------- dev panel
// Every screen of this map, one click each, without a phone (engine/devpanel.js):
// the game's own functions put it in each moment, so the preview is the real UI.
const devWait = ms => new Promise(r => setTimeout(r, ms));
const devProfile = () => profile || { v: 1, created: new Date().toISOString(), measures: {}, cfg: {}, run: {}, pace: {}, still: {}, notes: [] };
function devCard() { hideCard(); paused = false; resetRound(false); menu(true); }
/** A round worth reading on the end cards (a fresh round would show zeros). */
function devNumbers() { me.metres = 41; cal.kcal = 14; cal.jumps = 9; cal.squats = 2; playT = 78; pot = 23000000; }
async function devPlaying(full = false) {
  devCard(); if (full) introRuns = 0;
  startIntro(); if (!full) intro.t = 99;
  for (let i = 0; i < 60 && state !== 'play'; i++) await devWait(50);
}
/** Push the doll on (the N key) until she is in one of these phases. */
async function devDoll(phases) { for (let i = 0; i < 8 && !phases.includes(doll.state); i++) { devKey({ key: 'n' }); await devWait(90); } }
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
    { group: 'In game', name: 'Green light', show: async () => { await devPlaying(); await devDoll(['song']); } },
    { group: 'In game', name: 'Red light', show: async () => { await devPlaying(); await devDoll(['turn', 'scan']); } },
    { group: 'In game', name: 'Gift ahead', show: async () => { await devPlaying(); devKey({ key: 'f' }); } },
    { group: 'In game', name: 'Jump the fallen', show: async () => { await devPlaying(); devKey({ key: 'b' }); } },
    { group: 'In game', name: 'Near the line', show: async () => { await devPlaying(); devKey({ key: 'l' }); } },
    { group: 'End', name: 'Caught', show: async () => { await devPlaying(); devKey({ key: 'c' }); } },
    { group: 'End', name: 'Time up', show: async () => { await devPlaying(); devKey({ key: 'x' }); } },
    { group: 'End', name: 'Eliminated card', show: () => { devCard(); me.why = 'moved'; me.z = 4; devNumbers(); state = 'dead'; results(false); } },
    { group: 'End', name: 'Crossed (stamp)', show: async () => { await devPlaying(); me.z = FIELD.lineZ + 0.05; won(clockNow()); } },
    { group: 'End', name: 'You made it card', show: () => { devCard(); me.safe = true; me.fieldT = 96; devNumbers(); state = 'won'; me.cardDone = true; results(true); } },
  ],
});

// Phone snapshots and dated results share the game's existing counters.
hostBridge.setSnapshot(() => ({phase:state, motion:pocket.link, ...{metres:(me?.metres || 0),kcal:cal.kcal,active:cal.active,jumps:cal.jumps,squats:cal.squats,seconds:cal.seconds}}));
setInterval(() => { if (state === 'play' && !paused) hostBridge.update({metres:(me?.metres || 0),kcal:cal.kcal,active:cal.active,jumps:cal.jumps,squats:cal.squats,seconds:cal.seconds}); }, 2000);
