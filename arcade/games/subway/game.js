import { hostBridge } from '../../engine/host-bridge.js';
// Subway — a first-person runner driven by the phone in your pocket.
//
// Three things from the phone: jump, slide, and how your legs are going. The
// game changes lanes itself, a dog keeps you running, and the first time a
// player arrives the game measures how THEY move and fits itself to them.

import * as THREE from 'three';
import { World, TILE_PITCH, RAMP_LEN } from './world.js';
import { Player } from './player.js';
import { Assist } from './assist.js';
import { DogChase } from './dog-chase.js';
import { LookBack } from './look-back.js';
import { chooseLane } from './autopilot.js';
import { RunState, RUN, metresRun } from './running-speed.js';
import { Calories, KCAL, praise, nextMilestone } from '../../engine/calories.js';
import { light, setHour, updateHour, pinnedHour, currentName, DEFAULT_HOUR } from './theme.js';
import { ar, langInit } from '../../engine/localization.js';
import { record as recordRun } from './stats.js';
import { PocketSource, mergeCfg } from '../../engine/motion-controller.js';
import { GENERIC } from '../../engine/lib/motion-detector.js';
import * as Profile from '../../engine/profile.js';
import { qrcode } from '../../engine/lib/qrcode.js';
import { devPanel } from '../../engine/developer-panel.js';

const $ = id => document.getElementById(id);
const ui = {
  coins: $('coins'), level: $('level'), bar: $('bar'), dist: $('dist'), hint: $('hint'), hintArrow: $('hintArrow'), hintText: $('hintText'),
  overlay: $('overlay'), overlayTitle: $('overlayTitle'), overlayText: $('overlayText'), overlayBtns: $('overlayBtns'),
  pose: $('pose'), lines: $('lines'), who: $('whoText'),
  lookText: $('lookText'), lookAr: $('lookAr'), vignette: $('vignette'),
  dev: $('dev'), devLevel: $('devLevel'), devGo: $('devGo'),
  kcal: $('kcal'), kcalN: $('kcalN'), kgIn: $('kgIn'), perk: $('perk'), perkTitle: $('perkTitle'), perkCheer: $('perkCheer'), perkAr: $('perkAr'),
};
langInit();   // the game is English-only: the Arabic-only panels stay hidden (localization.js)

const LEVEL_M = 1000;
const START_D = 2 * TILE_PITCH;   // a run starts two tiles in, so there is track behind you to look back at
const ran = () => Math.max(0, player.distance - START_D);
const PROFILE_SPEED = 7;

// ------------------------------------------------------------------ three
// LITE: the budget for a weak screen (an old TV). On by itself for the
// compatibility build, or with ?lite=1 / off with ?lite=0. Fewer pixels, no
// antialiasing, textures shrunk to 512, six tiles, near things only, one
// light, no speed lines. The game is the same; only the drawing is thinner.
const LITE = (() => { const q = new URLSearchParams(location.search).get('lite'); return q === '1' ? true : q === '0' ? false : window.__modern === false; })();
const renderer = new THREE.WebGLRenderer({ antialias: !LITE, powerPreference: 'high-performance' });
renderer.setPixelRatio(LITE ? 0.5 : Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.insertBefore(renderer.domElement, document.body.firstChild);   // not prepend(): old TV engines lack it
renderer.domElement.id = 'gl';

const scene = new THREE.Scene();
// The game is a daylight game. Every fourth level the sun goes down for one
// level and the corridor's lamps come up — the same track, an hour later,
// and then it is morning again. ?hour=day or ?hour=dusk pins one of them.
const PINNED = pinnedHour();
const hourFor = lvl => PINNED || (lvl % 4 === 0 ? 'dusk' : DEFAULT_HOUR);
light(scene, LITE, hourFor(1));           // the hour, the haze and the sky: theme.js
const camera = new THREE.PerspectiveCamera(74, 16 / 9, 0.1, 400);
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  ui.lines.width = w; ui.lines.height = h;
}
addEventListener('resize', resize); resize();

// ------------------------------------------------------------------ pieces
const world = new World(scene, { lite: LITE }); world.flavour = 'pocket';
const player = new Player();
const assist = new Assist(); assist.strength = 0.6;
const dog = new DogChase(scene);
const look = new LookBack();
let lookYaw = 0, lastGap = Infinity;
const pocket = new PocketSource();
let run = new RunState();
let profile = Profile.load();
addEventListener('player-profile',()=>{profile=Profile.load();});
// No profile yet: straight to the training — before loading anything — and back here when it is saved.
// (Not in dev: the Dev panel and ?dev=1 work without one.)
if (!profile && new URLSearchParams(location.search).get('dev') !== '1') location.replace(Profile.trainingUrl());
let profiling = null;
let runMode = (() => { try { return localStorage.getItem('subway.runmode') || 'run'; } catch { return 'run'; } })();
// Which one is on is not on the screen any more — the HUD is the level, the
// numbers and the phone. M switches it, and the game tells you which it is
// by how it behaves: your legs drive it, or the level does.
function setRunMode(m) { runMode = m; try { localStorage.setItem('subway.runmode', m); } catch {} }
setRunMode(runMode);

let state = 'loading';   // loading | connect | welcome | pocketing | warm | profiling | summary | ready | running | dead
let coins = 0, level = 1, speed = 0, shake = 0, lastFrame = 0, hintKey = '', hintUntil = 0, deadAt = 0, autoLean = 0, lastBark = 0;
let cardBroke = false;   // the link card threw once; it is not going to be told off every frame
let metres = 0;   // what the runner's legs have covered this run — the distance the screen shows (the track's own is ran(), for levels)
// The burn, from the legs and the body's weight (calories.js). Each
// milestone puts a flame on the track, in your lane, a few seconds ahead:
// run through it and it is yours — a perk, with a word on what you just did.
const KG_KEY = 'subway.kg';
const cal = new Calories((() => { try { return Number(localStorage.getItem(KG_KEY)) || KCAL.defaultKg; } catch { return KCAL.defaultKg; } })());
let fireRetry = 0, perkTimer = null;
ui.kgIn.value = String(cal.kg);
ui.kgIn.onchange = () => { const v = Math.min(200, Math.max(30, Number(ui.kgIn.value) || KCAL.defaultKg)); ui.kgIn.value = String(v); cal.kg = v; try { localStorage.setItem(KG_KEY, String(v)); } catch {} };
/** The flame for `m` kcal was run through: the banner, the counter's bump. */
function claimFire(m) {
  cal.claim(m);
  // The flame, the number, one word. praise() also carries the line about
  // what that is in food, if it is ever wanted back — but the screen is the
  // track, and this stands in front of it.
  const p = praise(m, Math.random());
  ui.perkTitle.textContent = p.title; ui.perkCheer.textContent = p.cheer; ui.perkAr.textContent = p.ar;
  clearTimeout(perkTimer);
  ui.perk.hidden = false; ui.perk.className = 'hud in';
  ui.kcal.classList.remove('bump'); void ui.kcal.offsetWidth; ui.kcal.classList.add('bump');
  // A flame is a moment, not an interruption: up, read, gone in about two
  // seconds. The run does not pause for it — it must not stand on the track
  // long enough to hide the next row.
  perkTimer = setTimeout(() => { ui.perk.className = 'hud out'; perkTimer = setTimeout(hidePerk, 460); }, 1200);
}
/** Off the screen at once — a card is going up over it, or a new run is starting. */
function hidePerk() { clearTimeout(perkTimer); perkTimer = null; ui.perk.hidden = true; ui.perk.className = 'hud'; }
let keyEvents = [];
let profileDistance = 0, lastCue = null;
let pendingHit = null;
let paused = false;   // the phone dropped out mid-run
let intro = null;     // the start: you look back at the dog, then turn and run
let ride = null;      // a ramp train the player has chosen to ride (jumped for), not yet reached
let nextMover = 0;    // seconds: when the next moving train may be sent
let runs = 0;
const LATE_SLIDE_MS = 280;   // how late a slide may be heard and still count
window.__sw = { player, world, dog, look, get run() { return run; }, pocket, get state() { return state; }, get speed() { return speed; }, get profile() { return profile; }, setRunMode, Profile };

// --------------------------------------------------------------- the card
let cardTimer = null;
let afterRender = null;   // a one-shot to run right after the next render (screenshots need the fresh frame)
/**
 * @param auto seconds after which the primary button presses itself — a TV
 *             has no mouse; the count shows on the card. Enter/OK also presses it.
 */
function card(title, html, buttons = [], auto = 0) {
  clearInterval(cardTimer); cardTimer = null;
  ui.overlayTitle.textContent = title;
  ui.overlayText.innerHTML = html + (auto ? `<p class="auto" id="cardAuto"></p>` : '');
  ui.overlayBtns.innerHTML = '';
  ui.overlayBtns.hidden = !buttons.length;
  for (const b of buttons) {
    const el = document.createElement('button');
    el.className = 'btn' + (b.primary ? ' primary' : '');
    el.textContent = b.label; el.onclick = b.onClick;
    ui.overlayBtns.appendChild(el);
  }
  ui.overlay.hidden = false;
  if (auto) {
    const primary = buttons.find(b => b.primary) || buttons[0];
    let left = auto;
    const tick = () => { const el = $('cardAuto'); if (el) el.textContent = `${primary.label} in ${left}… (OK / Enter now)`; if (left-- <= 0) { clearInterval(cardTimer); cardTimer = null; primary.onClick(); } };
    tick(); cardTimer = setInterval(tick, 1000);
  }
}
/** The primary button of the card that is up, if any. */
function pressPrimary() {
  const btns = [...ui.overlayBtns.querySelectorAll('button')];
  const b = btns.find(x => x.className.includes('primary')) || btns[0];
  if (b && !ui.overlay.hidden) { b.click(); return true; }
  return false;
}

// the cards the flow shows in more than one place (and the dev panel shows on demand)
function stillCard(again = false) { card('STAND STILL', again ? `<p>Still moving… two seconds without moving.</p>${ar('لسا فيه حركة… ثانيتين بدون حركة')}` : `<p>Feet together, arms down. Two seconds.</p>${ar('قف ثابت ثانيتين')}`); }
function noSignalCard(then = 'play') { card('NO SIGNAL', `<p>The phone stopped sending. Check its screen — it should say <b>Playing</b>.</p>`, [{ label: 'Try again', primary: true, onClick: () => warm(then) }], 6); }
function phoneLostCard() { card('PHONE LOST', `<p>Waiting for the phone… check its screen says <b>Sensing</b>, and that both devices are connected to the network.</p>${ar('انقطع الجوال… تأكد إنه شغال وعلى نفس الواي فاي')}`, [{label:'Reconnect phone',onClick:()=>location.assign('/')}]); }


// ---------------------------------------------------------------- the flow

/** 1. The phone. Nothing happens until it streams. */
async function askForPhone() {
  state = 'connect';
  let where = { phoneError: 'Could not reach the connection service. Check your network and try again.' };
  try { where = await hostBridge.connectionInfo(true); } catch {}
  if(where.phoneError){card('PHONE CONNECTION UNAVAILABLE',`<p>${where.phoneError}</p>`,[{label:'Try again',primary:true,onClick:askForPhone}]);return;}
  const url = where.phoneUrl;
  let qrSvg = '';
  try {
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    qrSvg = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  } catch (e) {
    console.warn('QR generation failed:', e);
  }
  card('CONNECT YOUR PHONE', `
    <p>Scan with your phone camera,<br>or open this address in Safari or Chrome:</p>
    ${qrSvg ? `<div class="qr-wrap"><div class="qr-card">${qrSvg}</div></div>` : ''}
    <div class="url-wrap"><span class="url">${url}</span></div>
    ${where.pairCode ? `<p class="why">Or enter this code on your phone</p><div style="font-size:32px;font-weight:800;letter-spacing:.2em;font-variant-numeric:tabular-nums">${where.pairCode}</div>` : ""}
    <p class="why">${where.hosted ? "Keep this page open on both devices." : "Same Wi-Fi as this computer."} Nothing to install.</p>
    ${ar('امسح الرمز بكاميرا الجوال،<br>أو افتح الرابط واضغط ابدأ — نفس الواي فاي')}
    <p class="wait">waiting for the phone…</p>`);
  const tick = setInterval(() => {
    if (state !== 'connect') return clearInterval(tick);
    if (pocket.streaming) { clearInterval(tick); profile ? welcome() : train(); }
  }, 250);
}

/** 2a. A profile exists: play, or start over. */
function welcome() {
  state = 'welcome';
  const d = new Date(profile.created);
  card('WELCOME BACK', `
    <p>Phone connected. A profile from <b>${d.toLocaleDateString()}</b> is ready — the game is tuned to how you move.</p>
    <p class="why">Different pants than last time? Make a new profile — the phone sits differently in every pocket.</p>
    ${ar('الجوال متصل. عندك بروفايل جاهز. غيّرت البنطلون؟ سوّ بروفايل جديد')}`, [
    { label: 'Play', primary: true, onClick: () => pocketing('play') },
    { label: 'New profile', onClick: () => train() },
  ], 6);
}

/** No profile yet, or a new one: the gym — one training for every game — then straight back here. */
function train() { location.href = Profile.trainingUrl(); }

/** 2b. The pocket. */
function pocketing(then = 'play') {
  state = 'pocketing';
  card('PHONE IN YOUR POCKET', `
    <p>Put the phone in your <b>right front pocket</b>, screen against your leg, top of the phone pointing down.</p>
    <p class="why">Pants with a snug pocket are best — jeans, joggers. In a loose pocket the phone swings and reads late.</p>
    ${ar('حط الجوال في جيبك الأمامي اليمين والشاشة على رجلك')}`, [
    { label: 'It is in my pocket', primary: true, onClick: () => warm(then) },
  ], 8);   // no mouse on a TV: it goes on by itself (the warm-up then waits for you to be still anyway)
}

/** 3. Stand still, so the phone knows which way is down. */
async function warm(then) {
  state = 'warm';
  stillCard();
  const ok = await pocket.warmUp((tries, n) => { if (tries === 8) stillCard(true); });
  if (!ok) { noSignalCard(then); return; }
  toReady();
}

/** The profile strip: short enough for the corner, with the whole of it on hover. */
function showWho() {
  if (!profile) { ui.who.textContent = 'no profile'; ui.who.title = 'no profile yet — the game is using generic bars'; return; }
  const d = new Date(profile.created);
  ui.who.textContent = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  ui.who.title = 'profile made ' + d.toLocaleDateString();
}

function applyProfile() {
  if (!profile) { pocket.applyCfg(GENERIC); run = new RunState(); return; }
  pocket.applyCfg(mergeCfg(GENERIC, profile.cfg));
  run = new RunState({ ...RUN, ...profile.run });
  showWho();
}

/** 5. Ready: jump to start. */
function toReady() {
  applyProfile();
  state = 'ready';
  card('SUBWAY', `<p><b>Jump</b> to start. Then run, jump the barriers, slide under the signals — lanes are on us. Stop running and the dog catches up.</p>
    <p class="why"><span class="key">M</span> or the top-left button: your legs set the speed, or the level does.</p>
    ${ar('اقفز عشان تبدأ. اركض مكانك، اقفز فوق الحواجز، انزل تحت الإشارات. المسارات علينا')}`, [{label:'Start game',primary:true,onClick:()=>{if(state==='ready')startRun();}}]);
}

function resetWorld() {
  world.clear();
  world.resetTiles();
}

function startRun() {
  player.reset(); player.distance = START_D + (startLevel - 1) * LEVEL_M; resetWorld();
  coins = 0; metres = 0; level = startLevel; speed = RUN.base; assist.count = 0; assist.log = [];
  cal.reset(); hostBridge.begin(); fireRetry = 0; ui.kcalN.textContent = '0'; hidePerk();
  setHour(hourFor(level), true);          // a new run opens in its level's hour, with no fade
  run.reset(); dog.hide(); look.reset(); lastGap = Infinity; autoLean = 0; pendingHit = null; paused = false; ride = null; nextMover = 0; world.reservations = [];
  pocket.queue = [];
  // The start: you are already looking back — the dog is right there, coming
  // — then you turn and go. Longer the first time, a beat on every restart.
  runs++;
  intro = { t: 0, look: runs === 1 ? 1.3 : 0.7, turn: 0.5 };
  lookYaw = Math.PI; speed = 0;
  state = 'running';
  ui.overlay.hidden = true;
}

const MOVERS_FROM = 2;   // the level moving trains start at

// ?dev=1: play from the keyboard with no phone (Space jump · S slide · M speed
// mode · 1–9 jump to that level · +/- next/previous level). ?level=N starts
// every run at level N. For seeing the whole game, not for players.
let DEV = new URLSearchParams(location.search).get('dev') === '1';
let startLevel = Math.max(1, Number(new URLSearchParams(location.search).get('level')) || 1);

/** Put the run at the start of level `n`: the track is rebuilt from there. */
/** Dev mode: keyboard play and the level bar, no phone needed (?dev=1, or the Dev panel). */
function enterDev() {
  DEV = true;
  ui.dev.hidden = false;
  ui.devLevel.value = String(startLevel);
  ui.devLevel.onchange = () => jumpToLevel(Number(ui.devLevel.value));
  ui.devGo.onclick = () => { jumpToLevel(Number(ui.devLevel.value)); if (state === 'ready' || state === 'dead') startRun(); };
  state = 'ready';
  devPlayCard();
}
function devPlayCard() {
  card('DEV PLAY', `<p>No phone needed. <span class="key">Space</span> jump · <span class="key">S</span> slide · <span class="key">M</span> speed mode · <span class="key">1</span>–<span class="key">9</span> jump to a level · <span class="key">+</span>/<span class="key">−</span> next/previous.</p><p class="why">Without a phone the level sets the speed. Connect the phone anyway and it drives as usual.</p><p><span class="key">Space</span> to start</p>`);
}

function jumpToLevel(n) {
  n = Math.max(1, Math.min(99, Math.round(n)));
  startLevel = n;
  if (state !== 'running') return;
  resetWorld();
  player.distance = START_D + (n - 1) * LEVEL_M;
  player.roof = null; player.fall = null; ride = null; pendingHit = null;
  level = n; nextMover = 0;
  ui.devLevel.value = String(n);
}

/**
 * Can these lanes carry moving trains without ever boxing you in? Along the
 * whole stretch that rows have been laid on, the mover lanes must hold no
 * standing train, and at every standing train elsewhere there must remain a
 * lane that is not a train — a place to be. Barriers do not count: the
 * train smashes them, and you can jump or slide them anyway.
 */
function pathSafe(moverLanes) {
  const from = player.distance - 5, to = world.spawnedTo + 5;
  const trainLike = o => !o.moving && (o.kind === 'train' || o.kind === 'ramp');
  for (const o of world.obstacles) {
    if (!trainLike(o) || -o.z1 > to || -o.z0 < from) continue;
    if (moverLanes.has(o.lane)) return false;
    // "at the same place" = within the stretch a dodge needs: two seconds and a half of running
    const m = Math.max(8, 2.5 * speed);
    const blocked = new Set(moverLanes);
    for (const p of world.obstacles) if (trainLike(p) && p.z0 < o.z1 + m && p.z1 > o.z0 - m) blocked.add(p.lane);
    if (blocked.size >= 3) return false;
  }
  return true;
}

/**
 * A lane for a train that is on its way: never the roof you are riding,
 * never a lane a mover is already in, and only if the path stays passable
 * (pathSafe) with it. Rows laid after this keep the lane empty (busyLanes);
 * barriers already in its way are smashed as it comes. Null if none.
 * @param exclude lanes not to use (the other half of a pair, already chosen)
 */
function laneForMover(exclude = []) {
  const active = new Set([...world.movers.filter(o => -o.z1 > player.distance - 5).map(o => o.lane), ...exclude]);
  const lanes = [0, 1, 2].filter(l => !active.has(l) && !(player.riding && player.lane === l) && pathSafe(new Set([...active, l])));
  if (!lanes.length) return null;
  return { lane: lanes[Math.floor(Math.random() * lanes.length)], start: Math.max(world.spawnedTo + 45, player.distance + 200) };
}

/** Send one oncoming train down `lane` from `start`. */
function sendMover(lane, start, v) { world.spawnMover(lane, start, v); }

/**
 * Drive the start. Returns what the frame should use: the head's yaw, where
 * to draw the dog, and whether the run proper has begun.
 */
function stepIntro(dt) {
  if (!intro) return null;
  intro.t += dt;
  const ease = p => p * p * (3 - 2 * p);
  if (intro.t < intro.look) return { yaw: Math.PI, drawGap: 2.8, alpha: Math.min(1, intro.t / 0.25), text: 'RUN!' };
  const p = Math.min(1, (intro.t - intro.look) / intro.turn);
  if (p >= 1) { intro = null; run.speed = speed; return null; }   // the run picks up the speed you already have
  // the head swings forward and the dog falls back to where the run starts it
  return { yaw: Math.PI * (1 - ease(p)), drawGap: 2.8 + (RUN.dogStartGap - 2.8) * ease(p), alpha: 1 - p, text: 'RUN!' };
}

function die(o) {
  state = 'dead'; deadAt = performance.now(); shake = 1;
  hidePerk();                             // the card is about to cover this spot
  // the run is over: fold it into what the hub knows about you
  hostBridge.update({...{metres:ran(),kcal:cal.kcal,active:cal.active,jumps:cal.jumps,squats:cal.squats,seconds:cal.seconds},coins,outcome:'Run ended'},true);
  if (!window.__devPreview) recordRun('subway', { metres, kcal: cal.kcal, coins, jumps: cal.jumps, squats: cal.squats, seconds: cal.seconds });
  const what = { train: o.moving ? 'a moving train' : 'a train', ramp: 'a train', block: 'a barrier', bar: 'a barrier', low: 'a barrier', high: 'a signal' }[o.kind] || 'something';
  card(o.kind === 'dog' ? 'CAUGHT' : 'WIPEOUT',
    (o.kind === 'dog' ? `<p>The dog caught you after <b>${Math.round(metres)} m</b> — keep running!</p>${ar('الكلب لحقك، لا توقف')}`
                      : `<p>You ran into ${what} after <b>${Math.round(metres)} m</b> with <b>${coins}</b> coins.</p>`) +
    `<p class="why">${Math.round(cal.kcal)} kcal burned — ${cal.jumps} jumps, ${cal.squats} squats, ${Math.round(cal.seconds / 60)} min on your legs.</p>` +
    `<p><span class="key">Jump</span> to run again</p>${ar('اقفز عشان تلعب من جديد')}`,
    [{ label: 'Run again', primary: true, onClick: () => startRun() }, { label: 'Back to the arcade', onClick: () => { location.href = '../../'; } }]);
  ui.hint.hidden = true;
}

// ------------------------------------------------------------------ hud
function setHint(h) {
  const now = performance.now();
  if (!h) { if (now > hintUntil) ui.hint.hidden = true; return; }
  const arrows = { jump: '▲', roll: '▼', either: '▲▼', dodge: h.dir > 0 ? '▶' : '◀', hop: h.dir > 0 ? '▶' : '◀', dog: '🐕', ride: '▲', riding: '🚃' };
  const words = { jump: 'JUMP!', roll: 'SLIDE!', either: 'JUMP or SLIDE', dodge: 'DODGE', hop: 'HOP!', dog: 'RUN!', ride: 'JUMP TO RIDE', riding: 'RIDE!' };
  const key = (h.action === 'dodge' || h.action === 'hop') ? h.action + (h.dir > 0 ? 'R' : 'L') : h.action;
  if (!arrows[h.action]) return;
  if (h.action === 'dog') { hintKey = 'dog'; ui.hintArrow.textContent = arrows.dog; ui.hintText.textContent = words.dog; ui.hint.dataset.kind = 'dog'; ui.hint.hidden = false; hintUntil = now + 800; ui.hint.style.setProperty('--urg', '1'); return; }
  if (key !== hintKey && (h.action === 'dodge' || h.action === 'hop')) { hintKey = key; ui.hintArrow.textContent = arrows[h.action]; ui.hintText.textContent = words[h.action]; ui.hint.dataset.kind = h.action; ui.hint.hidden = false; hintUntil = now + 450; ui.hint.style.setProperty('--urg', '0.5'); return; }
  if (key !== hintKey) { hintKey = key; ui.hintArrow.textContent = arrows[key]; ui.hintText.textContent = words[key]; ui.hint.dataset.kind = key; }
  ui.hint.hidden = false; hintUntil = now + 200;
  ui.hint.style.setProperty('--urg', String(Math.max(0, Math.min(1, 1 - h.timeTo / 1.1))));
}

function drawSpeedLines() {
  const ctx = ui.lines.getContext('2d');
  const W = ui.lines.width, H = ui.lines.height;
  ctx.clearRect(0, 0, W, H);
  if (state !== 'running') return;
  const k = Math.max(0, (speed - 12) / (RUN.max - 12));
  if (k <= 0.02) return;
  const cx = W / 2, cy = H * 0.52;
  ctx.strokeStyle = `rgba(255,255,255,${0.10 + 0.35 * k})`; ctx.lineWidth = 1.5;
  const n = 14 + Math.floor(k * 22);
  const t = performance.now() / 1000;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.sin(i * 12.9898) * 0.3;
    const r0 = Math.min(W, H) * (0.42 + 0.25 * ((Math.sin(i * 78.233 + t * (6 + 8 * k)) + 1) / 2));
    const r1 = r0 + 60 + 180 * k;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.stroke();
  }
}

// keyboard, for a desk: the same three moves
addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.keyCode === 13) { if (pressPrimary()) e.preventDefault(); return; }
  if (e.key === 'm' || e.key === 'M') { setRunMode(runMode === 'run' ? 'auto' : 'run'); return; }
  if (DEV && /^[1-9]$/.test(e.key)) { jumpToLevel(Number(e.key)); return; }
  if (DEV && (e.key === '+' || e.key === '=')) { jumpToLevel(level + 1); return; }
  if (DEV && e.key === '-') { jumpToLevel(level - 1); return; }
  if (DEV && (e.key === 'f' || e.key === 'F')) { cal.kcal = Math.max(cal.kcal, nextMilestone(cal.claimed)); return; }   // the next flame, now
  if (DEV && (e.key === 't' || e.key === 'T')) { setHour(currentName() === 'dusk' ? 'day' : 'dusk'); return; }           // watch the hour turn
  const map = { ArrowUp: 'UP', w: 'UP', ' ': 'UP', ArrowDown: 'DOWN', s: 'DOWN' };
  const action = map[e.key];
  if (!action) return;
  e.preventDefault();
  if (e.repeat) return;
  if (state === 'ready' || state === 'dead') { if (action === 'UP') startRun(); return; }
  keyEvents.push({ action });
});

// ------------------------------------------------------------------ loop
// A slow screen (a TV) gets fewer pixels rather than a stutter: the frame
// rate is watched, and the render resolution steps down while it is low.
let fpsAcc = 0, fpsN = 0, fpsAt = 0, pixelScale = LITE ? 0.5 : Math.min(devicePixelRatio, 2), fpsLogAt = 0;
function watchFps(now, dt) {
  fpsAcc += dt; fpsN++;
  if (now - fpsAt < 2000) return;
  const fps = fpsN / Math.max(0.001, fpsAcc); fpsAcc = 0; fpsN = 0; fpsAt = now;
  if (now - fpsLogAt > 10000 && window.__log) { fpsLogAt = now; window.__log(`fps ${fps.toFixed(1)} · scale ${pixelScale.toFixed(2)} · ${renderer.info.render.calls} draw calls · ${(renderer.info.render.triangles / 1000).toFixed(0)}k tris · ${state}`); }
  // lite is capped at 30: "healthy" there is 28+, not 55+
  const lo = LITE ? 0.35 : 0.5, hi = LITE ? 0.75 : Math.min(devicePixelRatio, 2), good = LITE ? 28 : 55, bad = LITE ? 20 : 30;
  const want = fps < bad - 6 ? Math.max(lo, pixelScale - 0.15) : fps < bad ? Math.max(lo, pixelScale - 0.05) : fps > good ? Math.min(hi, pixelScale + 0.05) : pixelScale;
  if (Math.abs(want - pixelScale) > 0.01) { pixelScale = want; renderer.setPixelRatio(pixelScale); resize(); }
}

let frameSkip = false;
function frame(now) {
  requestAnimationFrame(frame);
  // a weak screen: every other vsync, so 30 fps even, instead of 40 uneven
  if (LITE && (frameSkip = !frameSkip) === false) return;
  const dt = Math.min(0.08, (now - (lastFrame || now)) / 1000); lastFrame = now;
  const t = now / 1000;
  watchFps(now, dt);
  updateHour(dt);

  const read = pocket.poll();
  if (keyEvents.length) { read.events = [...read.events, ...keyEvents]; keyEvents = []; }

  if ((state === 'ready' || state === 'dead') && read.events.some(e => e.action === 'UP') && (state === 'ready' || now - deadAt > 900)) startRun();

  // the phone dropped out mid-run: hold the world still rather than let a Wi-Fi hiccup kill you
  if (state === 'running' && pocket.link === 'lost' && !(DEV && !pocket.streaming)) {   // dev with no phone: nothing to lose
    if (!paused) { paused = true; phoneLostCard(); }
  } else if (paused && state === 'running') { paused = false; ui.overlay.hidden = true; pocket.queue = []; lastFrame = now; }

  const I = state === 'running' && !paused ? stepIntro(dt) : null;
  if (I) {
    // the start: the world waits, you look at the dog, then turn and go
    lookYaw = I.yaw;
    speed += ((I.yaw < 0.4 ? RUN.base * 0.6 : 0) - speed) * Math.min(1, dt * 3);
    dog.update(dt, run.gap, { lane: player.lane, distance: player.distance, speed: 8 }, I.drawGap);
    player.update(dt, speed);
    world.updateTiles(player.distance); world.animate(t);
    ui.lookText.style.opacity = I.alpha; ui.lookAr.style.opacity = I.alpha;
    ui.lookText.style.setProperty('--s', String(1 + 0.08 * Math.sin(t * 9)));
    ui.vignette.style.opacity = I.alpha * 0.8;
  }

  if (state === 'running' && !paused && !I) {
    const difficulty = Math.min(1, ran() / 6000);
    level = 1 + Math.floor(ran() / LEVEL_M);
    setHour(hourFor(level));              // a level turns: the light eases into that level's hour
    // your legs set the speed (or the level does), and the dog keeps pace
    const modeNow = DEV && !read.ready ? 'auto' : runMode;   // no phone: the level sets the speed
    const st = run.step(dt, level, modeNow, read.ready ? read.cadenceHz : 0, read.ready ? read.steady : true, player.airborne || player.rolling || player.sinceLanding() < 1.2);
    if (read.ready) { metres += metresRun(read.cadenceHz, dt); cal.step(dt, read.cadenceHz); }   // the legs' own distance and burn, in either mode
    for (const e of read.events) { if (e.action === 'UP') cal.jump(); else if (e.action === 'DOWN') cal.squat(); }   // every real jump and squat counts, hit or miss
    // The fire: a milestone reached puts the flame on the track, in your
    // lane, 2.6 s ahead, where nothing stands. Dodged past it? It comes
    // again a moment later — it is yours, it waits for you.
    const due = cal.due;
    if (due && !world.fire && t >= fireRetry && !player.riding) {
      const spot = world.fireSpot(player.lane, player.distance + speed * 2.6);
      if (spot != null) world.spawnFire(player.lane, spot, 1.4, due); else fireRetry = t + 1;
    }
    const fire = world.fire, took = world.updateFire(t, dt, player.distance, player.lane);
    if (took === 'taken') claimFire(fire.tag); else if (took === 'missed') fireRetry = t + 1.5;
    speed = st.speed;
    // The look back: the dog is gaining, nothing is coming, you are on your
    // feet — turn and see it. Rationed inside LookBack; safe by construction
    // here: the track must be clear for longer than the turn lasts, and
    // collisions are off while the head is turned.
    if (modeNow === 'run' && !look.active && !player.airborne && !player.rolling && !player.riding) {
      // clear = nothing in YOUR lane for the whole turn (the other lanes are the autopilot's business, and it keeps working)
      const horizon = speed * (look.duration + 0.4) + 3;
      const clear = !world.lookAhead(player.distance, horizon, speed)[player.lane] && !world.hitTest(player.distance, player.lane, player.feetY, player.headY);
      look.maybe(t, st.gap, st.gap < lastGap - 0.01, clear);
    }
    lastGap = st.gap;
    const L = look.update(dt);
    lookYaw += (L.yaw - lookYaw) * Math.min(1, dt * 30);
    ui.lookText.style.opacity = L.alpha; ui.lookAr.style.opacity = L.alpha;
    ui.lookText.style.setProperty('--s', String(1 + 0.08 * Math.sin(t * 9)));
    ui.vignette.style.opacity = modeNow === 'run' ? Math.max(L.active ? L.alpha * 0.9 : 0, Math.max(0, (6 - st.gap) / 6) * 0.7) : 0;
    // while you look, it is drawn a little nearer than it is: at 9 m a dog is a dot, at 5 it is a dog
    dog.update(dt, st.gap, { lane: player.lane, distance: player.distance, speed }, L.active ? Math.min(st.gap, 5) : st.gap);
    if (st.caught) { die({ kind: 'dog' }); return; }
    if (st.warn && !L.active && now - lastBark > 900) { lastBark = now; setHint({ action: 'dog' }); }
    // The ramp train: dodged like any train, unless you jump for it while it
    // is coming (2.8 s out, before the autopilot would dodge at 1.5) — then
    // you run up the ramp and ride the roof, coins and all. Boxed in with no
    // way round, you ride it anyway: a ramp is never a wall.
    // Trains on the move — from level 2, more and faster with the levels. One
    // is sent down a lane, coming at you: you see it grow, and
    // the game dodges it in time.
    world.updateMovers(dt, player.distance);
    if (level >= MOVERS_FROM && t >= nextMover) {
      const k = Math.min(1, (level - MOVERS_FROM) / 5);              // 0 at level 2 → 1 at level 7
      const v = 5 + 8 * k + Math.random() * 2;
      const one = laneForMover();
      if (one) {
        sendMover(one.lane, one.start, v);
        // from level 4, sometimes two side by side — a yard — with one lane left for you
        if (level >= 4 && Math.random() < 0.15 + 0.25 * k) {
          const two = laneForMover([one.lane]);
          if (two && Math.abs(two.lane - one.lane) === 1) sendMover(two.lane, one.start, v);
        }
        nextMover = t + (13 - 7 * k) * (0.8 + Math.random() * 0.4);
      } else nextMover = t + 1;   // every lane has a train standing in it: try again shortly
    }
    const ahead = world.lookAhead(player.distance, speed * 3.2, speed);
    const h = ahead[player.lane];
    let rideHint = null;
    if (!player.riding && h && h.kind === 'ramp') {
      const tt = h.dist / Math.max(1, speed);
      if (ride !== h.o && tt < 2.8 && tt > 0.2 && read.events.some(e => e.action === 'UP')) { ride = h.o; }
      if (ride === h.o) rideHint = { action: 'riding', timeTo: tt };
      else if (tt < 2.8 && tt > 1.5) rideHint = { action: 'ride', timeTo: tt };
    }
    if (ride && (!h || h.o !== ride)) ride = null;   // it went by or was dodged after all
    // On a roof that is about to end, with a roof next door that carries on: hop across, like the real thing.
    if (player.riding && player.distance > player.roof.end - 3.5 && !player.slide) {
      const zNow = -player.distance;
      for (const l of [player.lane - 1, player.lane + 1]) {
        if (l < 0 || l > 2) continue;
        const next = world.obstacles.find(o => o.lane === l && (o.kind === 'train' || o.kind === 'ramp') && o.z1 > zNow - 1 && o.z0 < zNow - 6 && Math.abs(o.top - player.roof.y) < 0.35);
        if (next) { autoLean = l > player.lane ? 1 : -1; player.hopTo(next, l); setHint({ action: 'hop', dir: autoLean }); break; }
      }
    }
    // lanes are the game's: a train ahead is dodged, decisively — except the ramp you chose, and never off a roof
    if (!player.riding) {
      const forPilot = ahead.slice(0, 3);
      if (ride && forPilot[player.lane] && forPilot[player.lane].o === ride) forPilot[player.lane] = null;
      const pick = chooseLane(forPilot, player.lane, speed, world.coinsAhead(player.distance, speed * 3.2));   // the coins were laid where the dodge is expected to go
      if (pick && !player.slide) { autoLean = pick.to > player.lane ? 1 : -1; player.setLane(pick.to); setHint({ action: 'dodge', dir: autoLean }); }
    }
    autoLean *= Math.exp(-dt / 0.35);

    const res = assist.step(t, player, world, { events: read.events, source: 'body' });
    if (res.hint && /left|right|trapped/.test(res.hint.action)) res.hint = null;
    if (rideHint) res.hint = rideHint;
    player.update(dt, speed);
    // rows are spaced for the fastest you could be going, not the speed right
    // now: a burst of speed must never compress a track that was laid slowly
    world.spawn(player.distance, 160, difficulty, Math.max(speed, st.pace * RUN.bonus), player.lane);
    world.updateTiles(player.distance);
    world.recycle(player.distance);
    world.animate(t, dt, player.distance);
    setHint(res.hint);

    coins += world.collectCoins(player.distance, player.lane, player.feetY, player.headY);
    // nothing can hit you while your head is turned (the track was clear when you turned; this makes it a promise)
    const hit = look.active ? null : world.hitTest(player.distance, player.lane, player.feetY, player.headY, player.shield);
    // A slide is heard about a quarter second after the body is already down
    // (the thigh has to reach the bar, then hold), while a jump is heard as
    // the feet leave the floor. So a signal — or the bar on legs — is not a
    // wipeout the instant the head crosses it: the game waits that quarter
    // second for the slide that is probably already happening.
    const forgivable = hit && (hit.kind === 'high' || hit.kind === 'bar');
    if (hit && hit.kind === 'ramp' && player.distance < -hit.z0 - 2.5) { /* its ramp end, not its tail (you just dropped off it) */ player.board(hit, RAMP_LEN); ride = null; }   // up the ramp, onto the roof
    else if (forgivable && (!pendingHit || pendingHit.o !== hit)) pendingHit = { o: hit, at: now, cleared: false };
    else if (hit && hit.kind === 'ramp') { /* stepping off its tail: nothing */ }
    else if (hit && !forgivable) die(hit);
    if (pendingHit) {
      // clearing it at all inside the window — a slide that arrived late, a jump that came late over the bar — is forgiven
      if (player.rolling || (pendingHit.o.kind === 'bar' && player.airborne)) pendingHit.cleared = true;
      if (now - pendingHit.at > LATE_SLIDE_MS) { const p = pendingHit; pendingHit = null; if (!p.cleared) { die(p.o); return; } }
    }

    ui.coins.textContent = String(coins);
    ui.level.textContent = 'LEVEL ' + level;
    ui.bar.style.width = ((ran() % LEVEL_M) / LEVEL_M * 100).toFixed(1) + '%';
    ui.dist.textContent = Math.round(metres) + 'm';
    ui.kcalN.textContent = String(Math.round(cal.kcal));
  }

  if (state !== 'running') { ui.lookText.style.opacity = 0; ui.lookAr.style.opacity = 0; ui.vignette.style.opacity = 0; lookYaw += (0 - lookYaw) * Math.min(1, dt * 10); }

  // camera
  const pose = player.cameraPose();
  shake = Math.max(0, shake - dt * 2.2);
  const sh = shake * shake * 0.25;
  camera.position.set(pose.x + (Math.random() - 0.5) * sh, pose.y + (Math.random() - 0.5) * sh, -player.distance);
  // the head turn: yaw about the vertical, with a little dip and lean so it is a body turning, not a tripod
  const turn = Math.sin(lookYaw);
  camera.rotation.set(pose.pitch - turn * 0.08, lookYaw, pose.roll + turn * 0.06 + (Math.random() - 0.5) * sh * 0.2 - autoLean * 0.09, 'YXZ');
  camera.fov = 72 + Math.max(0, speed - 11) * 0.45 + (pose.fovKick || 0) + 6 * Math.sin(lookYaw / 2); camera.updateProjectionMatrix();
  scene.getObjectByName('sky').position.copy(camera.position);
  world.backdrop.position.z = camera.position.z;
  renderer.render(scene, camera);
  if (afterRender) { const f = afterRender; afterRender = null; f(); }
  if (!LITE) drawSpeedLines();
  // The card's chart scrolls by the clock, so it wants every frame it can
  // get — it costs a fraction of a millisecond, and anything less than every
  // frame is what made it look like it was stuttering. It is still only
  // decoration: if it ever throws it says so once and then keeps quiet, since
  // a warning every frame is its own kind of lag.
  if (!LITE || (fpsN & 3) === 0) {
    try { pocket.drawPanel(ui.pose, { glass: true }); } catch (e) { if (!cardBroke) { cardBroke = true; console.warn('link card: ' + (e && e.message || e)); } }
  }
}

// ------------------------------------------------------------------ boot
(async () => {
  const boot = window.__boot;
  try {
    if (boot) boot.step('downloading…');
    await world.load(boot ? (what, d, t) => boot.progress(what, d, t) : null);
    if (boot) boot.step('building the track…');
  } catch (e) { if (boot) boot.fail('The game could not load its models: ' + (e.message || e)); throw e; }
  window.__gameUp = true;
  if (window.__log) window.__log('game up · ' + (renderer.capabilities.isWebGL2 ? 'webgl2' : 'webgl1'));
  dog.load();
  requestAnimationFrame(frame);
  pocket.start();
  // the phone follows the screen: inside a room it is a controller, not a menu
  pocket.onPhoneSays = m => { if (m.t === 'hello' || m.t === 'ready') pocket.send({ t: 'scene', where: 'subway' }); };
  setInterval(() => { if (pocket.link !== 'lost') pocket.send({ t: 'scene', where: 'subway' }); }, 3000);
  showWho();
  $('newProfile').onclick = () => { if (state === 'running') return; train(); };
  if (DEV) { enterDev(); return; }
  askForPhone();
})();

// ---------------------------------------------------------------- dev panel
// Every screen of Subway, one click each, without a phone (engine/developer-panel.js):
// the game's own functions put it in each moment, so the preview is the real UI.
const devCard = () => { hidePerk(); ui.hint.hidden = true; paused = false; };
const devProfile = () => profile || { v: 1, created: new Date().toISOString(), measures: {}, cfg: {}, run: {}, pace: {}, still: {}, notes: [] };
function devRun(lvl = 1) { devCard(); startLevel = lvl; startRun(); startLevel = 1; }
function devSkipIntro() { if (intro) intro.t = 99; }
function devEnd(o) {
  devRun(); devSkipIntro();
  metres = 812; coins = 37; cal.kcal = 46; cal.jumps = 23; cal.squats = 11; cal.seconds = 330;   // a run worth reading
  die(o);
}
devPanel({
  pocket,
  onOpen: () => { if (!DEV) enterDev(); },
  settle: () => { clearInterval(cardTimer); cardTimer = null; },     // cards stay up instead of pressing themselves
  screens: [
    { group: 'Cards', name: 'Connect', show: () => { devCard(); askForPhone(); } },
    { group: 'Cards', name: 'Welcome back', show: () => { devCard(); profile = devProfile(); welcome(); } },
    { group: 'Cards', name: 'Pocket', show: () => { devCard(); pocketing('play'); } },
    { group: 'Cards', name: 'Stand still', show: () => { devCard(); state = 'warm'; stillCard(); } },
    { group: 'Cards', name: 'Still moving', show: () => { devCard(); state = 'warm'; stillCard(true); } },
    { group: 'Cards', name: 'No signal', show: () => { devCard(); state = 'warm'; noSignalCard(); } },
    { group: 'Cards', name: 'Ready', show: () => { devCard(); toReady(); } },
    { group: 'Cards', name: 'Dev play', show: () => { devCard(); state = 'ready'; devPlayCard(); } },
    { group: 'Cards', name: 'Phone lost', show: () => { devRun(); devSkipIntro(); state = 'preview'; phoneLostCard(); } },
    { group: 'In game', name: 'Start (dog)', show: () => devRun() },
    { group: 'In game', name: 'Running', show: () => { devRun(); devSkipIntro(); } },
    { group: 'In game', name: 'Flame bonus', show: () => { devRun(); devSkipIntro(); setTimeout(() => { if (state === 'running') claimFire(nextMilestone(cal.claimed)); }, 900); } },
    { group: 'In game', name: 'Level 5', show: () => { devRun(5); devSkipIntro(); } },
    { group: 'In game', name: 'Level 8', show: () => { devRun(8); devSkipIntro(); } },
    { group: 'End', name: 'Wipeout', show: () => devEnd({ kind: 'block' }) },
    { group: 'End', name: 'Moving train', show: () => devEnd({ kind: 'train', moving: true }) },
    { group: 'End', name: 'Caught by dog', show: () => devEnd({ kind: 'dog' }) },
  ],
});

// Phone snapshots and dated results share the game's existing counters.
hostBridge.setSnapshot(() => ({phase:state, motion:pocket.link, ...{metres:ran(),kcal:cal.kcal,active:cal.active,jumps:cal.jumps,squats:cal.squats,seconds:cal.seconds}}));
setInterval(() => { if (state === 'running' && !paused) hostBridge.update({metres:ran(),kcal:cal.kcal,active:cal.active,jumps:cal.jumps,squats:cal.squats,seconds:cal.seconds}); }, 2000);
