import { hostBridge } from '../../../engine/host-bridge.js';
// Jump Rope — the second Squid Game, played with the phone in your pocket.
//
// A narrow bridge high over a pit; the two giant dolls turn a rope over it.
// Run in place to cross, jump every time the rope sweeps under the bridge,
// jump the gap halfway, reach the far platform before the clock runs out.
// The line of players ahead of you sets your pace — some of them go over.
//
// Everything around the round is red-light's (the phone, the profile, the
// warm-up, JUMP to start, the results, dev mode), so the two games feel like
// one. This map is silent on purpose: no sound at all. The rope's pass is
// what you watch — it hits the bridge ahead of you as it reaches your feet —
// and the ROPE light at the top pulses with it.

import * as THREE from 'three';
import { GLTFLoader } from '../../../engine/three/GLTFLoader.js';
import { MeshoptDecoder } from '../../../engine/three/libs/meshopt_decoder.module.js';
import { PocketSource, mergeCfg } from '../../../engine/motion-controller.js';
import { GENERIC } from '../../../engine/lib/motion-detector.js';
import * as Profile from '../../../engine/profile.js';
import { Stillness, STILL, PACE, paceFor, metresRun } from '../common/motion.js';
import { Calories, KCAL } from '../../../engine/calories.js';
import { Crowd } from '../../../engine/body/bots.js';
import { Hands } from '../../../engine/body/hands.js';
import { FX, Gift } from '../common/visual-effects.js';
import { qrcode } from '../../../engine/lib/qrcode.js';
import { devPanel } from '../../../engine/developer-panel.js';
import { Arena } from './arena.js';
import { Rope, ROPE, RULES, inDanger, groundAt } from './rules.js';
import { Director, LANE } from './director.js';

const $ = id => document.getElementById(id);
const Q = new URLSearchParams(location.search);
let DEV = Q.get('dev') === '1';
const dev = { god: false, hold: false, hud: true, giftK: 0, live: null, assist: Q.get('assist') === '1' };
// Like red light: the game teaches once and then leaves you alone. The first
// three turns of the rope you stand in are called (JUMP!), the gap is shown
// the first time you reach it — after that it is you and the rope.
const coach = { passes: 0, told: new Set(), giftShown: null };
const teaching = () => dev.assist || coach.passes < 3;
const AUTO = Q.get('auto') || '';                     // test player: 1 = good · late = jumps too late · idle = never moves
const BOTS = Math.max(6, Math.min(30, Number(Q.get('bots')) || 14));
const STEP = Number(Q.get('step')) || 0;
const SHADOWS = Q.get('shadows') !== '0';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const START = RULES.startZ, END = RULES.finishZ;
const GAP0 = ROPE.gap[0], GAP1 = ROPE.gap[1];
const LEAP_FROM = 1.6;        // a leap from closer to the edge than this clears the gap; from further back it falls short

// the gifts on this bridge (the box and its shape from visual-effects.js; what they do is this game's)
const PERKS = {
  time:   { shape: 'circle',   title: '+10 SECONDS',     say: 'Ten more seconds on the clock.' },
  shield: { shape: 'triangle', title: 'A FRIEND\'S HAND', say: 'The next time the rope catches you, someone pulls you back up.' },
  slow:   { shape: 'star',     title: 'SLOW ROPE',       say: 'The next five turns of the rope come slower.' },
};

const ui = {
  overlay: $('overlay'), overlayTitle: $('overlayTitle'), overlayText: $('overlayText'), overlayBtns: $('overlayBtns'),
  clock: $('clock'), toGo: $('toGo'), win: $('win'), winSub: $('winSub'), winBurst: $('winBurst'), light: $('light'), lightWord: $('lightWord'), lightRow: $('lightRow'),
  trackFill: $('trackFill'), trackMe: $('trackMe'), gapMark: $('gapMark'),
  leftN: $('leftN'), pot: $('pot'), potN: $('potN'), feed: $('feed'),
  dist: $('dist'), kcalN: $('kcalN'), kgIn: $('kgIn'), who: $('whoText'), pose: $('pose'),
  callout: $('callout'), tip: $('tip'), hint: $('hint'), hintArrow: $('hintArrow'), hintText: $('hintText'),
  meter: $('meter'), meterBar: $('meterBar'), meterLbl: $('meterLbl'), perk: $('perk'), perkShape: $('perkShape'), perkTitle: $('perkTitle'), perkSay: $('perkSay'), inv: $('inv'),
  vignette: $('vignette'), flash: $('flash'), fade: $('fade'),
};
ui.gapMark.style.left = ((GAP0 - START) / (END - START) * 100).toFixed(1) + '%';
ui.gapMark.style.width = ((GAP1 - GAP0) / (END - START) * 100).toFixed(1) + '%';

// ------------------------------------------------------------------ three
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = SHADOWS; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.id = 'gl';
document.body.insertBefore(renderer.domElement, document.body.firstChild);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x203040);
const camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.03, 400); camera.rotation.order = 'YXZ';
scene.add(camera);
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
const arena = new Arena(scene);
const crowd = new Crowd(scene);
const hands = new Hands(camera);
const fx = new FX(scene);
const pocket = new PocketSource();
const still = new Stillness();          // here only for its footfalls (the first step moves you) and the profile's freeze practice
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

let state = 'loading';      // loading | connect | welcome | pocketing | warm | profiling | summary | ready | intro | play | falling | dead | won
let rope = new Rope();
let director = null;
let gifts = [];
let me = null;
let intro = null;
let paused = false;
let lastFrame = 0, pot = 0, playT = 0;
let keyEvents = [];
const keys = { run: false, fast: false };
window.__sq = { get state() { return state; }, get me() { return me; }, get rope() { return rope; }, get director() { return director; }, get profiling() { return profiling; }, pocket, arena, crowd, hands, camera, renderer, still, get gifts() { return gifts; } };

function newMe() {
  return {
    x: LANE, z: START, speed: 0, alive: true, safe: false, crouch: 0, crouchT: 0,
    jumpStart: -9, hopY: 0, leap: null, pending: null, shield: false,
    fall: null, why: null, wonT: null, metres: 0, idleT: 0, lastGrab: -9, cardDone: false, cardAt: 0, blocked: false,
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
function phoneLostCard() { card('PHONE LOST', '<p>Waiting for the phone… check its screen says <b>Sensing</b>, and that both devices are connected to the network.</p><p class="why">The game is paused — the rope waits too.</p>', [{label:'Reconnect phone',onClick:()=>location.assign('/')}]); }
const menu = on => document.body.classList.toggle('menu', on);

// ---------------------------------------------------------------- the flow (red light's)

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
    <p>Phone connected. Your profile from <b>${d.toLocaleDateString()}</b> is ready — the game knows how you jump.</p>
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
    <p class="why">Snug pants are best — a phone swinging in a loose pocket hears your jumps late, and here late is a long way down.</p>`, [
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
  pocket.applyCfg(mergeCfg(GENERIC, profile.cfg));
  pace = { ...PACE, ...profile.pace };
  still.cfg = { ...STILL, ...(profile.still || {}) };
  showWho();
}

function toReady() {
  applyProfile();
  resetRound(false);
  state = 'ready'; menu(true);
  card('JUMP ROPE', `
    <ul class="rules">
      <li><b class="s">○</b><span><b>Run in place</b> to cross the bridge. You go at the pace of the line — never closer than a step to the one in front.</span></li>
      <li><b class="s">△</b><span><b>Jump</b> every time the rope sweeps under the bridge. Watch it hit the bridge ahead of you — that is when it reaches your feet.</span></li>
      <li><b class="s">□</b><span>The bridge is broken halfway: <b>jump the gap</b>. Reach the far side before the clock hits zero.</span></li>
    </ul>
    <p><span class="key">JUMP</span> to start${DEV ? ' · <span class="key">SPACE</span> on the keyboard' : ''}</p>`, [{label:'Start game',primary:true,onClick:startFromReady}]);
}

/** Everyone back in line on the start platform. */
function resetRound(full = true) {
  fx.clear();
  for (const g of gifts) g.dispose(); gifts = [];
  crowd.clear();
  director = new Director(crowd);
  director.setup(BOTS);
  rope = new Rope();
  me = newMe();
  hands.reset();
  cal.reset(); hostBridge.begin(); still.arm(false); still.meter = 0; pot = 0; playT = 0;
  ui.feed.innerHTML = ''; ui.potN.textContent = '0'; ui.inv.innerHTML = '';
  ui.vignette.style.opacity = 0; ui.fade.style.transition = 'none'; ui.fade.style.opacity = 0; void ui.fade.offsetWidth; ui.fade.style.transition = ''; document.body.classList.remove('dying');
  arena.setGo(false); arena.setRope(Math.PI, 0); arena.setClock(RULES.limitS);
  // three gifts on the deck, away from the gap
  const kinds = Object.keys(PERKS).sort(() => Math.random() - 0.5);
  [-10.5, 5.5, 11.5].forEach((z, i) => { const g = new Gift(scene, kinds[i], LANE, z + (Math.random() - 0.5) * 1.5); g.group.position.y = ROPE.deckY; g.group.scale.setScalar(0.8); gifts.push(g); });
  hideWin(); setRopeLight(false); showMeter(false); setTip(''); ui.hint.hidden = true;
}

let introRuns = 0;
function startIntro() { hideCard(); menu(false); state = 'intro'; introRuns++; intro = { t: 0, full: introRuns === 1 }; }   // the whole briefing once a session; after that just READY, GO

function stepIntro(t, dt) {
  intro.t += dt;
  const T = intro.t;
  const lines = intro.full ? [
    [0.0, 1.0, 'JUMP ROPE', '', 'pink'],
    [1.0, 1.95, 'RUN IN PLACE', 'to cross the bridge', 'green'],
    [1.95, 2.9, 'JUMP THE ROPE', 'every time it sweeps under you', 'red'],
    [2.9, 3.85, 'JUMP THE GAP', 'halfway across', 'white'],
  ] : [];
  const go = intro.full ? 3.85 : 0;
  const L = lines.find(l => T >= l[0] && T < l[1]);
  if (L) callout(L[2], L[3], L[4], 0.3);
  if (T >= go && T < go + 0.65) callout(T < go + 0.35 ? 'READY' : 'GO!', '', T < go + 0.35 ? 'white' : 'green', 0.3);
  if (T >= go + 0.65) { state = 'play'; rope.start(); arena.setGo(true); }
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
function setHint(h) { if (!h) { ui.hint.hidden = true; return; } ui.hint.hidden = false; ui.hintArrow.textContent = h.arrow; ui.hintText.textContent = h.text; }
function showMeter(on, v = 0, label = 'HOLD STILL') {
  ui.meter.style.opacity = on ? 1 : 0; if (!on) return;
  ui.meterBar.style.width = (clamp(v, 0, 1) * 100).toFixed(0) + '%'; ui.meterLbl.textContent = label;
}
function setRopeLight(on) {
  ui.light.className = on ? 'rope' : ''; ui.lightWord.className = on ? 'rope' : '';
}
let beatTimer = null;
function beat() { ui.lightRow.classList.add('beat'); clearTimeout(beatTimer); beatTimer = setTimeout(() => ui.lightRow.classList.remove('beat'), 140); }
function feed(text) {
  const d = document.createElement('div'); d.textContent = text;
  ui.feed.insertBefore(d, ui.feed.firstChild);
  while (ui.feed.children.length > 5) ui.feed.removeChild(ui.feed.lastChild);
  setTimeout(() => d.classList.add('old'), 4200); setTimeout(() => d.remove(), 5000);
}
function bumpPot(n) { pot += n; ui.potN.textContent = pot.toLocaleString('en-US'); ui.pot.classList.remove('bump'); void ui.pot.offsetWidth; ui.pot.classList.add('bump'); }
let perkTimer = null;
function perkBanner(kind) {
  const P = PERKS[kind];
  ui.perkShape.textContent = { circle: '○', triangle: '△', square: '□', star: '☆' }[P.shape];
  ui.perkTitle.textContent = P.title; ui.perkSay.textContent = P.say;
  clearTimeout(perkTimer); ui.perk.hidden = false; ui.perk.className = 'hud in';
  perkTimer = setTimeout(() => { ui.perk.className = 'hud out'; perkTimer = setTimeout(() => { ui.perk.hidden = true; }, 450); }, 1900);
}
function drawInv() {
  const items = [];
  if (me.shield) items.push('<div class="it"><b>△</b>A FRIEND\'S HAND</div>');
  if (rope.slow > 0) items.push(`<div class="it"><b>☆</b>SLOW ROPE ×${rope.slow}</div>`);
  const html = items.join('');
  if (html !== ui.inv._h) { ui.inv._h = html; ui.inv.innerHTML = html; }
}

// ---------------------------------------------------------------- the round

/** Are you in the air at time `at`? (a jump, or the leap over the gap) */
// any jump from airS before the pass to the moment of the pass counts (and up to lateS after it, see stepPlay)
const airborne = at => !!me.leap || (at - me.jumpStart >= -0.001 && at - me.jumpStart < RULES.airS);

function onRope(ev, t) {
  if (ev.type === 'pass') {
    beat();
    director.onPass(ev);
    const active = state === 'play' && me.alive && !me.safe;
    if (active && inDanger(me.z)) {
      coach.passes++;
      if (!airborne(ev.at)) me.pending = { at: ev.at };   // it may yet be a late-heard jump: decided in RULES.lateS
    }
  }
  if (ev.type === 'timeup') {
    callout('TIME\'S UP', '', 'red', 2.5);
    director.timeUp();
    if (me.alive && !me.safe) {
      const onBridge = me.z > ROPE.bridge[0] && me.z < ROPE.bridge[1];
      if (onBridge) fallOff(t, 'time', Math.random() < 0.5 ? -1 : 1); else fadeOut(t, 'time');
    }
  }
}

function stepPlay(t, dt, read) {
  const active = state === 'play' && me.alive && !me.safe;
  if (active) playT += dt;
  for (const e of rope.update(dt, t)) onRope(e, t);
  arena.setRope(rope.theta, rope.omega);
  arena.setClock(rope.clock);

  // ---- your legs → along the bridge
  let target = 0;
  if (active) {
    if (pocket.streaming && read.ready) target = paceFor(read.cadenceHz, pace) || (still.footRecent(650) ? pace.walkMs * 0.9 : 0);
    if (!pocket.streaming && keys.run) target = keys.fast ? pace.fastMs : pace.jogMs;
  }
  me.speed += (target - me.speed) * (1 - Math.exp(-dt / (target > me.speed ? pace.tauUp : pace.tauDown)));
  const cad = pocket.streaming && read.ready ? read.cadenceHz : (keys.run ? (keys.fast ? 3.2 : 2.6) : 0);
  if (state === 'play' && me.alive) { me.metres += metresRun(cad, dt, pace); cal.step(dt, cad); }

  // ---- moves
  for (const e of read.events) {
    if (e.action === 'UP') {
      const at = t - (e.lead || 0);          // the body left the floor this long ago (the phone's delay)
      if (state === 'play' && me.alive) cal.jump();
      hands.jump(t);
      // the gap: from close to the edge you clear it; from too far back you fall short
      if (active && !me.leap && me.z < GAP0 && me.z > GAP0 - 2.4 && gapClear()) {
        const near = me.z > GAP0 - LEAP_FROM;
        me.leap = near ? { from: me.z, to: GAP1 + 0.55, t: 0, dur: 0.72 } : { from: me.z, to: GAP0 + 0.55, t: 0, dur: 0.6, short: true };
        coach.told.add('gap');
      }
      else me.jumpStart = at;
      // a jump heard just after the pass still clears it
      if (me.pending && at - me.pending.at < RULES.lateS) me.pending = null;
    }
    if (e.action === 'DOWN') {
      if (state === 'play' && me.alive) cal.squat();
      me.crouchT = 1.15;
      const g = giftInFront(1.9);
      if (active && g && !g.taken) { hands.reachFor = new THREE.Vector3(g.x + 0.05, ROPE.deckY + 0.28, g.z); me.grab = { g, at: t }; }
    }
  }
  if (me.grab && t - me.grab.at > 0.32) { const g = me.grab.g; me.grab = null; if (!g.taken) takeGift(g, t); }
  if (!me.grab && hands.reachFor && t - me.lastGrab > 0.9) hands.reachFor = null;
  // the rope took your legs (and no late jump came)
  if (me.pending && t - me.pending.at > RULES.lateS) {
    me.pending = null;
    if (DEV && dev.god) callout('GOD MODE', 'the rope went through you', 'pink', 0.7);
    else if (me.shield) { me.shield = false; callout('HELD!', 'a hand pulled you back up', 'pink', 1.4); }
    else fallOff(t, 'rope', 1);
  }

  // ---- moving along (and what stops you)
  const z0 = me.z;
  if (me.leap) {
    me.leap.t += dt; const k = clamp(me.leap.t / me.leap.dur, 0, 1);
    me.z = lerp(me.leap.from, me.leap.to, k * (2 - k)); me.hopY = Math.sin(k * Math.PI) * 0.55;
    if (k >= 1) { const short = me.leap.short; me.leap = null; me.hopY = 0; me.jumpStart = t - RULES.airS + 0.12; if (short) fallOff(t, 'gap', 0.15); }
  } else if (active || state === 'won') {
    me.z += me.speed * dt;
    // the edge of the gap: the game will not walk you off it — you jump it
    if (z0 < GAP0 && me.z > GAP0 - 0.3) me.z = Math.max(z0, GAP0 - 0.3);
    const front = director.ahead(me.z, null);
    me.blocked = false;
    // you keep a longer gap than the others do: the one in front must not hide the rope hitting the bridge ahead
    if (front && me.z > front.z - 2.4) { me.z = Math.max(z0, front.z - 2.4); me.blocked = true; }
  }
  if (active && me.z >= END) won(t);

  // ---- teaching: the first three turns you stand in, and the gap once
  if (active) {
    const u = rope.untilPass;
    if (inDanger(me.z) && teaching() && u < 0.55) { setHint({ arrow: '▲', text: 'JUMP!' }); if (coach.passes === 0) setTip('Jump as the rope <b>hits the bridge</b> ahead of you', 0.6); }
    else if (me.z > GAP0 - LEAP_FROM && me.z < GAP0 && gapClear() && (dev.assist || !coach.told.has('gap'))) { setHint({ arrow: '▲', text: 'JUMP THE GAP' }); setTip('Jump <b>right after</b> the rope has passed', 0.3); }
    else if (!coach.told.has('gift') || dev.assist) {
      const g = giftInFront(3); if (g) { coach.giftShown = g; setHint({ arrow: '▼', text: 'SQUAT TO GRAB' }); } else setHint(null);
    } else setHint(null);
    if (coach.giftShown && (coach.giftShown.taken || coach.giftShown.z < me.z - 0.6)) { coach.told.add('gift'); coach.giftShown = null; }
    if (me.speed < 0.25 && !me.blocked && coach.passes < 1 && rope.elapsed > 2) { me.idleT += dt; if (me.idleT > 1.6) setTip('<b>Run in place</b> to move along the bridge', 0.3); } else me.idleT = 0;
  } else setHint(null);

  // ---- the others
  director.update(dt, t, rope, { z: me.z, alive: me.alive, safe: me.safe }, state === 'play' || state === 'won' || state === 'falling' || state === 'dead');
  for (const e of director.drain()) onDirector(e, t);
  for (const g of gifts) g.update(t, dt);
}

/** Is the far side of the gap free to land on (the one in front has walked on)? */
function gapClear() { const f = director.ahead(me.z, null); return !f || f.z > GAP1 + 2.2; }
function giftInFront(within) {
  let best = null;
  for (const g of gifts) if (!g.taken && g.z - me.z > -0.5 && g.z - me.z < within && (!best || g.z < best.z)) best = g;
  return best;
}
function takeGift(g, t) {
  g.take(() => (hands.bones && hands.bones.HandR ? hands.bones.HandR.getWorldPosition(new THREE.Vector3()) : camera.position.clone())); me.lastGrab = t;
  if (g.kind === 'time') rope.addTime(10);
  if (g.kind === 'shield') me.shield = true;
  if (g.kind === 'slow') rope.slowDown();
  perkBanner(g.kind);
}

function onDirector(e, t) {
  if (e.kind === 'fell') {
    feed(`${String(e.bot.num).padStart(3, '0')} ELIMINATED`);
    bumpPot(100000000);
    if (Math.abs(e.bot.z - me.z) < 6 && me.alive) hands.flinch(t);
  }
}

// ---------------------------------------------------------------- endings

/** Over the side (or down the gap): the rope throws you, the bridge goes up past you, the pit comes up. */
function fallOff(t, why, dir) {
  if (!me.alive) return;
  me.alive = false; me.why = why; state = 'falling';
  me.fall = { t: 0, vx: dir * (why === 'gap' ? 0.2 : 1.6), vy: why === 'gap' ? 0 : 1.2, x: me.x, y: groundAt(me.z), dir };
  hands.shot(t); setHint(null); ui.vignette.style.opacity = 0.6;
  ui.flash.style.background = '#fff'; ui.flash.style.transition = 'none'; ui.flash.style.opacity = 0.5; void ui.flash.offsetWidth; ui.flash.style.transition = 'opacity .4s'; ui.flash.style.opacity = 0;
  feed('456 ELIMINATED'); bumpPot(100000000);
}
/** Time ran out on the platform: no fall, just the end. */
function fadeOut(t, why) {
  if (!me.alive) return;
  me.alive = false; me.why = why; state = 'falling';
  me.fall = { t: 0, still: true, x: me.x, y: groundAt(me.z), vx: 0, vy: 0, dir: 1 };
  hands.caught(t); setHint(null); feed('456 ELIMINATED'); bumpPot(100000000);
}
function stepFall(t, dt) {
  const F = me.fall; F.t += dt;
  if (!F.still) { F.vy -= 9.8 * dt; F.y = Math.max(ROPE.pitY + 0.5, F.y + F.vy * dt); F.x += F.vx * dt; me.x = F.x; }
  if (F.t > 0.6 && !document.body.classList.contains('dying')) document.body.classList.add('dying');
  const fadeAt = F.still ? 1.2 : 2.3;
  if (F.t > fadeAt) ui.fade.style.opacity = F.still ? 0.6 : 1;
  if (!me.cardDone && F.t > fadeAt + 1.1) { me.cardDone = true; state = 'dead'; results(false); }
}

function won(t) {
  me.safe = true; me.wonT = 0; state = 'won'; me.fieldT = playT;
  setHint(null); hands.win(t);
  showWin(`crossed with ${fmt(rope.clock)} left`);
}
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
  const stop = END + 0.8;              // a step onto the platform, short of Cheol-su's feet
  me.speed = me.z < stop ? 1.0 : Math.max(0, me.speed - dt * 2);
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
      <div><b>${fmt(secs)}</b><span>on the bridge</span></div></div>`;
  const left = Math.round(Math.max(0, END - me.z));
  const why = { rope: 'The rope took your legs.', gap: 'You fell into the gap.', time: 'The clock ran out.' }[me.why] || '';
  const tip = { rope: 'Watch the rope hit the bridge ahead of you — jump as it does. It speeds up as the clock runs down.', gap: 'Walk right up to the edge first — the game stops you there — let the rope pass, then jump.', time: 'Run faster between the turns — your legs set your pace.' }[me.why] || '';
  const text = win
    ? `<p>You reached the far side with <b>${fmt(rope.clock)}</b> on the clock. <b>${eliminated}</b> ${eliminated === 1 ? 'player' : 'players'} did not.</p>${stats}<p class="why">Prize pot so far: ₩ ${pot.toLocaleString('en-US')}</p>`
    : `<p>${why} ${left} m from the far side.</p>${stats}<p class="why">${tip}</p>`;
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
const DEV_KEYS = [
  ['W', 'run (hold) · Shift faster'], ['Space', 'jump'], ['S', 'squat'],
  ['1–5', 'rope speed (slow → fast) · 0 back to normal'], ['G', 'god mode'],
  ['L', 'to the gap'], ['E', 'near the end'], ['B', 'knock the one in front off'], ['F', 'gift ahead'],
  ['C', 'fall now'], ['X', 'time up'], ['[ ]', 'clock −/+30 s'],
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
  const t = clockNow();
  switch (k) {
    case 'r': resetRound(); startIntro(); return true;
    case 'g': dev.god = !dev.god; callout(dev.god ? 'GOD MODE ON' : 'GOD MODE OFF', '', 'pink', 0.8); return true;
    case 'p': dev.hold = !dev.hold; callout(dev.hold ? 'PAUSED' : 'GO', '', 'white', 0.6); return true;
    case 'h': dev.hud = !dev.hud; for (const id of ['topLeft', 'topCenter', 'topRight', 'tip', 'hint', 'meter', 'inv', 'credit']) { const n = $(id); if (n) n.style.visibility = dev.hud ? '' : 'hidden'; } return true;
    case 'i': dev.assist = !dev.assist; callout(dev.assist ? 'HINTS ON' : 'HINTS OFF', '', 'white', 0.9); return true;
  }
  if (state !== 'play') return false;
  switch (k) {
    case '0': rope.forcedPeriod = null; callout('ROPE', 'normal speed', 'white', 0.7); return true;
    case '1': case '2': case '3': case '4': case '5': rope.forcedPeriod = [3.0, 2.4, 2.0, 1.7, 1.4][Number(k) - 1]; callout('ROPE', `${rope.forcedPeriod}s a turn`, 'white', 0.7); return true;
    case 'l': me.z = GAP0 - 2.2; return true;
    case 'e': me.z = Math.max(me.z, 12); return true;
    case 'b': director.knock(me.z); return true;
    case 'f': { const kinds = Object.keys(PERKS), kind = kinds[dev.giftK++ % kinds.length]; const g = new Gift(scene, kind, LANE, me.z + 2.2); g.group.position.y = groundAt(me.z + 2.2); g.group.scale.setScalar(0.8); gifts.push(g); return true; }
    case 'c': if (me.alive && !me.safe) { if (!(me.z > ROPE.bridge[0] && me.z < ROPE.bridge[1])) me.z = -14; fallOff(t, 'rope', 1); } return true;
    case 'x': rope.clock = Math.min(rope.clock, 0.4); return true;
    case '[': rope.clock = Math.max(1, rope.clock - 30); return true;
    case ']': rope.clock += 30; return true;
  }
  return false;
}
function devLive() {
  if (!dev.live) return;
  const txt = `${state} · rope ${rope.period.toFixed(2)}s/turn · next pass ${Math.min(9.9, rope.untilPass).toFixed(2)}s · ${fmt(Math.ceil(rope.clock))} · ${Math.max(0, END - me.z).toFixed(1)} m to go · ${me.speed.toFixed(2)} m/s · ${inDanger(me.z) ? 'ON THE ROPE' : 'safe spot'}${pocket.streaming ? ' · PHONE' : ' · keys'}${dev.god ? ' · GOD' : ''}${dev.assist ? ' · HINTS' : ''}${dev.hold ? ' · PAUSED' : ''}`;
  if (txt !== dev.live._t) { dev.live._t = txt; dev.live.textContent = txt; }
}
function startFromReady() { if (state === 'ready') { resetRound(false); startIntro(); } }

// the scripted player (?auto=1): what a good player does, for testing
let autoTurn = -1;
function autoplay(t) {
  if (!AUTO) return;
  const active = state === 'play' && me.alive && !me.safe;
  keys.run = active && AUTO !== 'idle'; keys.fast = false;
  if (!active || AUTO === 'idle') return;
  const u = rope.untilPass, since = rope.sincePass(t);
  // the rope: jump 0.25 s before it arrives (late: 0.3 s after it has gone)
  if (inDanger(me.z) && autoTurn !== rope.turns && !me.leap) {
    if (AUTO === 'late' ? (since > 0.28 && since < 0.4 && rope.turns > 2) : u < 0.25) { keyEvents.push({ action: 'UP' }); autoTurn = rope.turns; }
    if (AUTO === 'late' && rope.turns <= 2 && u < 0.25) { keyEvents.push({ action: 'UP' }); autoTurn = rope.turns; }
  }
  // the gap: from the edge, right after a pass
  if (me.z > GAP0 - 1.2 && me.z < GAP0 && !me.leap && since > 0.08 && since < 0.35 && u > 0.9) keyEvents.push({ action: 'UP' });
  // a gift: squat when it is at your feet and the rope is far off
  const g = giftInFront(1.0);
  if (g && !me.grab && t - me.lastGrab > 1.5 && u > 1.3) { keyEvents.push({ action: 'DOWN' }); me.lastGrab = t; }
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
  if ((state === 'dead' || (state === 'won' && me.cardDone)) && t - me.cardAt > 1.5 && read.events.some(e => e.action === 'UP')) { resetRound(); startIntro(); }

  // the phone dropped out mid-game: everything holds (a Wi-Fi hiccup must never throw you off the bridge)
  const inGame = state === 'intro' || state === 'play';
  if (inGame && pocket.lastSampleAt > 0 && pocket.link === 'lost') {
    if (!paused) { paused = true; phoneLostCard(); }
  } else if (paused && inGame && pocket.link !== 'lost') { paused = false; hideCard(); pocket.queue = []; }

  if (!paused && !(DEV && dev.hold)) {
    if (state === 'intro') { stepIntro(t, dt); crowd.update(dt, t); }
    else if (state === 'play' || state === 'falling' || state === 'won' || state === 'dead') {
      stepPlay(t, dt, read);
      if (state === 'falling') stepFall(t, dt);
      if (state === 'won') stepWon(t, dt);
    } else crowd.update(dt, t);
  }
  fx.update(dt);
  if (clockNow() > calloutUntil) ui.callout.style.opacity = 0;
  setTip('');                              // a tip only stays while something keeps asking for it
  drawInv();

  // ---- HUD numbers
  ui.clock.textContent = fmt(Math.ceil(rope.clock)).padStart(5, '0');
  ui.clock.classList.toggle('low', rope.clock < 30 && rope.running);
  setRopeLight(rope.running);
  ui.lightWord.textContent = rope.running ? `ROPE · ${Math.round(rope.rpm)}/MIN` : 'ROPE';
  const prog = clamp((me.z - START) / (END - START), 0, 1);
  ui.trackFill.style.width = (prog * 100).toFixed(1) + '%'; ui.trackMe.style.left = (prog * 100).toFixed(1) + '%';
  const togo = String(Math.ceil(Math.max(0, END - me.z))); if (ui.toGo.textContent !== togo) ui.toGo.textContent = togo;
  ui.leftN.textContent = String(director ? director.remaining + (me.alive ? 1 : 0) : BOTS + 1);
  ui.dist.textContent = Math.round(me.metres) + ' m';
  ui.kcalN.textContent = String(Math.round(cal.kcal));

  // ---- the body and the camera on top of it
  me.crouchT = Math.max(0, me.crouchT - dt);
  me.crouch += ((me.crouchT > 0 ? 1 : 0) - me.crouch) * (1 - Math.exp(-dt / 0.12));
  const js = t - me.jumpStart;
  const jumpY = !me.leap && js > 0 && js < RULES.airS ? Math.sin(js / RULES.airS * Math.PI) * 0.42 : 0;
  const onRopeNow = state === 'play' && inDanger(me.z) && rope.untilPass < 0.6;
  const bob = hands.update(dt, t, { moving: me.speed > 0.15, pace: me.speed, cadence: pocket.streaming ? (read.cadenceHz || 2.4) : (keys.fast ? 3.2 : 2.6), frozen: false, fear: onRopeNow ? 0.25 : 0, crouch: me.crouch });
  let camY = groundAt(me.z) + 1.62 - me.crouch * 0.62 + me.hopY + jumpY + bob.y;
  let yaw = Math.PI, pitch = -0.12 - me.crouch * 0.38, roll = bob.roll, camX = me.x;
  if (state === 'won' || (state === 'dead' && me.safe)) {
    const k = clamp((me.wonT - 1.3) / 1.6, 0, 1), e = k * k * (3 - 2 * k);
    yaw = Math.PI + Math.PI * e; pitch = -0.06 - 0.12 * e;
  }
  if (me.fall) {
    const F = me.fall, k = clamp(F.t / 1.2, 0, 1);
    if (F.still) { camY = groundAt(me.z) + lerp(1.62, 0.9, k); pitch = lerp(-0.06, -0.5, k); }
    else {
      // the rope takes the legs: the view tips over the side, the bridge goes up past you, the pit comes up
      camY = F.y + 1.4; camX = F.x;
      roll = F.dir * lerp(0, 1.9, clamp(F.t / 0.9, 0, 1)) + F.t * 0.4 * F.dir;
      pitch = lerp(-0.06, -1.25, clamp(F.t / 1.1, 0, 1)) + Math.sin(F.t * 3) * 0.08;
    }
  }
  camera.position.set(camX, camY, me.z);
  camera.rotation.set(pitch, yaw, roll);
  camera.fov = 72 + clamp(me.speed - 1, 0, 2) * 2; camera.updateProjectionMatrix();
  hands.visible = !(me.fall && me.fall.t > 1.6);
  if (window.__camOverride) { const o = window.__camOverride; camera.position.set(...o.pos); camera.lookAt(...o.look); hands.visible = false; }
  renderer.render(scene, camera);
  try { pocket.drawPanel(ui.pose); } catch {}
  if (DEV) devLive();
}

// ------------------------------------------------------------------ boot
(async () => {
  const boot = window.__boot;
  try {
    boot && boot.step('loading the bridge…');
    await arena.load(loader);
    boot && boot.step('loading the players…');
    await crowd.load('../../../engine/body/athlete-avatar.glb', loader);
    boot && boot.step('loading your hands…');
    await hands.load('../../../engine/body/controller-arms.glb', loader);
  } catch (e) { boot && boot.fail('The game could not load its models: ' + (e.message || e)); throw e; }
  window.__gameUp = true;
  resetRound(false);
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
function devCard() { hideCard(); paused = false; resetRound(false); menu(true); }
/** A round worth reading on the end cards (a fresh round would show zeros). */
function devNumbers() { me.metres = 41; cal.kcal = 14; cal.jumps = 9; cal.squats = 2; playT = 78; pot = 23000000; }
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
    { group: 'In game', name: 'Rope turning', show: () => devPlaying() },
    { group: 'In game', name: 'At the gap', show: async () => { await devPlaying(); devKey({ key: 'l' }); } },
    { group: 'In game', name: 'Gift ahead', show: async () => { await devPlaying(); devKey({ key: 'f' }); } },
    { group: 'In game', name: 'One falls', show: async () => { await devPlaying(); devKey({ key: 'b' }); } },
    { group: 'In game', name: 'Near the end', show: async () => { await devPlaying(); devKey({ key: 'e' }); } },
    { group: 'End', name: 'Fall', show: async () => { await devPlaying(); devKey({ key: 'c' }); } },
    { group: 'End', name: 'Time up', show: async () => { await devPlaying(); devKey({ key: 'x' }); } },
    { group: 'End', name: 'Out card', show: () => { devCard(); me.why = 'rope'; me.z = 2; devNumbers(); state = 'dead'; results(false); } },
    { group: 'End', name: 'Across (stamp)', show: async () => { await devPlaying(); me.z = END + 0.1; won(clockNow()); } },
    { group: 'End', name: 'Made it card', show: () => { devCard(); me.safe = true; me.fieldT = 88; devNumbers(); state = 'won'; me.cardDone = true; results(true); } },
  ],
});

// Phone snapshots and dated results share the game's existing counters.
hostBridge.setSnapshot(() => ({phase:state, motion:pocket.link, ...{metres:(me?.metres || 0),kcal:cal.kcal,active:cal.active,jumps:cal.jumps,squats:cal.squats,seconds:cal.seconds}}));
setInterval(() => { if (state === 'play' && !paused) hostBridge.update({metres:(me?.metres || 0),kcal:cal.kcal,active:cal.active,jumps:cal.jumps,squats:cal.squats,seconds:cal.seconds}); }, 2000);
