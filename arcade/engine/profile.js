// The player's profile: how THIS person moves, measured once, for every game.
//
// The detectors were tuned on one adult. A child's biggest jump can be a
// grown-up's small hop; a heavier player's squat is someone else's duck; a
// slow jogger's "fast" is another's warm-up. So one short training (the gym,
// /training/) asks for the moves, measures what they produce on this phone in
// this pocket, and sets each bar between "what this person does on purpose"
// and "what their body does by accident". Every game reads the same profile:
//
//   walk       the Squid Games' slow pace (a walk across the field)
//   jog        Subway's slow pace (a light run keeps the level's speed)
//   sprint     everyone's top speed
//   freeze     how still they really stand — the doll's bar (never stricter
//              than the default), and how quickly a stop is seen
//   hop ×3     the jump bar
//   squat ×3   the slide / squat bar, and the calm gate for a loose pocket
//
// Everything measured is kept, so a bad fit can be explained.

import { GENERIC } from './lib/motion-detector.js';

export const KEY = 'arcade.profile.v1';
let memoryProfile;

// The games' own defaults, for the bands a profile replaces (the same numbers
// as subway/running-speed.js RUN and squid/common/motion.js PACE and STILL).
const DEFAULT = { slowHz: 2.0, jogHz: 2.7, fastHz: 3.3, stillA0: 0.15, stillW0: 60 };
const G = 9.80665;

export function load() { if(memoryProfile!==undefined)return memoryProfile;try { const p = JSON.parse(localStorage.getItem(KEY) || 'null'); return p && p.v === 1 ? p : null; } catch { return null; } }
export function save(p) { memoryProfile=p;try { localStorage.setItem(KEY, JSON.stringify(p));const user=localStorage.getItem('inmotion.player.v1');if(user)localStorage.setItem(`arcade.calibration.${user}`,JSON.stringify(p)); } catch {} window.dispatchEvent(new CustomEvent('calibration-saved',{detail:p}));return p; }
export function clear() { memoryProfile=null;try { localStorage.removeItem(KEY); } catch {} }

// Keep movement training with its player, including when sharing a PC.
export function selectUser(id, phoneProfile) {
  try {
    const previous=localStorage.getItem('inmotion.player.v1');
    let p=JSON.parse(localStorage.getItem(`arcade.calibration.${id}`)||'null');
    if(!previous&&!p)p=load(); // Preserve existing training on first pairing.
    // Training emits ISO dates; earlier calibration versions used epoch ms.
    // Compare both forms so a trained phone can restore its profile on a PC.
    const created=value=>typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN;
    const phoneCreated=created(phoneProfile?.created),savedCreated=created(p?.created);
    if(phoneProfile?.v===1&&Number.isFinite(phoneCreated)&&(!p||!Number.isFinite(savedCreated)||phoneCreated>savedCreated))p=phoneProfile;
    localStorage.setItem('inmotion.player.v1',id);
    if(p?.v===1){localStorage.setItem(KEY,JSON.stringify(p));localStorage.setItem(`arcade.calibration.${id}`,JSON.stringify(p));}
    else localStorage.removeItem(KEY);
    memoryProfile=p?.v===1?p:null;
  }catch{memoryProfile=phoneProfile?.v===1?phoneProfile:null;}
  window.dispatchEvent(new CustomEvent('player-profile'));
  return memoryProfile;
}

/** Where a game sends a player who has no profile (or wants a new one); back to `next` when it is saved. */
export function trainingUrl(next = location.pathname + location.search) {
  return new URL(`/training/?next=${encodeURIComponent(next)}`, location.href).href;
}

// ------------------------------------------------------------- the routine

/**
 * Each step: what to show, how long, what it measures.
 *   kind 'hold'  — a timed stretch sampled continuously
 *   kind 'reps'  — cued repetitions, each a window whose peak is taken
 */
export const STEPS = [
  // the words a player sees: short and plain (the ids stay what the fit calls them)
  { id: 'walk',   kind: 'hold', s: 6, title: 'Walk',     say: 'Walk in place' },
  { id: 'jog',    kind: 'hold', s: 6, title: 'Run',      say: 'Run in place' },
  { id: 'sprint', kind: 'hold', s: 6, title: 'Run fast', say: 'As fast as you can' },
  { id: 'freeze', kind: 'hold', s: 5, title: 'Stop',     say: "Don't move at all" },
  { id: 'hop',    kind: 'reps', n: 3, title: 'Jump',     say: 'A small jump', feature: 'v', floor: 0.45 },
  { id: 'squat',  kind: 'reps', n: 3, title: 'Squat',    say: 'Go down, then stand up', feature: 'tilt', floor: 20 },
];
const GAIT = new Set(['walk', 'jog', 'sprint']);

export const REP_S = 2.6;         // one cued repetition: the cue, the move, the recovery
export const REP_GAP_S = 0.9;     // breath between repetitions
export const LEAD_S = 2.4;        // reading time before a step starts
const FREEZE_SETTLE_S = 1.2;      // the body settles before its stillness is measured

const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const quantile = (a, q) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Drives the routine. The page calls update() every frame with the pocket's
 * live read (pocket.poll()) and renders what comes back; this only measures.
 */
export class Profiling {
  constructor(pocket) {
    this.pocket = pocket;
    this.i = -1; this.phase = 'lead'; this.t0 = 0; this.rep = 0; this.retries = 0;
    const gait = () => ({ hz: [], peaks: [], maxV: 0, maxTilt: 0 });
    this.m = { walk: gait(), jog: gait(), sprint: gait(), still: { a: [], w: [] }, stopS: null, hop: [], squat: [], squatMaxA: 0, squatMaxW: 0 };
    this.repPeak = 0; this.last = null; this.lastAt = -9; this.done = false; this.stopAt = null; this.profile = null;
    pocket.onEvent = e => { if (e.kind === 'step' && this.step && GAIT.has(this.step.id) && this.phase === 'go') this.m[this.step.id].peaks.push(e.peakG); };
    this._prevOnSample = pocket.onSample;
    pocket.onSample = (s, last) => {
      if (this._prevOnSample) this._prevOnSample(s, last);
      if (this.step && this.step.id === 'freeze' && this.phase === 'go' && this._now - this.t0 > FREEZE_SETTLE_S) {
        this.m.still.a.push(Math.abs(Math.hypot(...s.a) / G - 1)); this.m.still.w.push(Math.hypot(...s.w));
      }
    };
  }

  get step() { return STEPS[this.i] || null; }
  start(now) { this.i = 0; this.phase = 'lead'; this.t0 = now; this._now = now; }
  /** The phone dropped out mid-step: do this step again from its lead. What it already measured is kept. */
  restartStep(now) { if (this.done || !this.step) return; this.phase = 'lead'; this.t0 = now; this._now = now; this.rep = 0; this.repPeak = 0; this.retries = 0; this.last = null; }

  /**
   * @param now  seconds
   * @param read pocket.poll()
   * @returns { step, index, of, lead, lead01, hold, reps, repsOf, inRep, last, done, profile }
   *   hold    0..1 through a timed step (or through the current repetition)
   *   last    the latest repetition's outcome, for 1.2 s: { ok, value }
   */
  update(now, read) {
    this._now = now;
    const s = this.step; if (!s || this.done) return { done: this.done, profile: this.profile };
    const el = now - this.t0;
    let hold = 0, inRep = false;
    if (this.phase === 'lead') {
      if (el >= LEAD_S) { this.phase = 'go'; this.t0 = now; this.rep = 0; this.repPeak = 0; if (s.id === 'freeze') this.stopAt = null; }
    } else if (s.kind === 'hold') {
      hold = Math.min(1, el / s.s);
      if (GAIT.has(s.id)) {
        const m = this.m[s.id];
        if (read.running && read.cadenceHz > 0 && el > 1.5) m.hz.push(read.cadenceHz);
        m.maxV = Math.max(m.maxV, read.v);
        if (el > 1.0) m.maxTilt = Math.max(m.maxTilt, read.tilt);
      }
      if (s.id === 'freeze' && this.stopAt == null && !read.running) this.stopAt = el;
      if (el >= s.s) { this._next(now); return this.update(now, read); }
    } else {
      // reps: a window per repetition, the peak of the feature inside it
      const t = el % (REP_S + REP_GAP_S), rel = Math.floor(el / (REP_S + REP_GAP_S));
      if (rel > this.rep) {                                   // a window just closed
        const ok = this.repPeak >= s.floor;
        if (ok) this.m[s.id].push(this.repPeak);
        this.last = { ok, value: this.repPeak }; this.lastAt = now;
        this.repPeak = 0; this.rep = rel;
        if (this.m[s.id].length >= s.n) { this._next(now); return this.update(now, read); }
        if (!ok && ++this.retries > 4) { this._next(now); return this.update(now, read); }   // never trap anyone here
      }
      inRep = t < REP_S;
      if (inRep) {
        this.repPeak = Math.max(this.repPeak, s.feature === 'v' ? read.v : read.tilt);
        // how hard and how fast THIS person squats, so the calm gate is theirs
        if (s.feature === 'tilt' && read.tilt >= 25) { this.m.squatMaxA = Math.max(this.m.squatMaxA, read.aG); this.m.squatMaxW = Math.max(this.m.squatMaxW, read.wDps); }
      }
      hold = Math.min(1, t / REP_S);
    }
    return {
      step: s, index: this.i, of: STEPS.length, lead: this.phase === 'lead', lead01: this.phase === 'lead' ? Math.min(1, el / LEAD_S) : 1,
      hold, inRep, reps: s.kind === 'reps' ? this.m[s.id].length : null, repsOf: s.kind === 'reps' ? s.n : null,
      last: now - this.lastAt < 1.2 ? this.last : null, done: false,
    };
  }

  _next(now) {
    if (this.step.id === 'freeze') this.m.stopS = this.stopAt;
    this.i++; this.phase = 'lead'; this.t0 = now; this.retries = 0; this.last = null;
    if (this.i >= STEPS.length) {
      this.done = true; this.profile = fit(this.m);
      this.pocket.onEvent = null; this.pocket.onSample = this._prevOnSample;
    }
  }
}

// ------------------------------------------------------------------ fit

/**
 * From the measurements to thresholds. Each bar sits between the move this
 * person makes on purpose and what their own running does by accident, and is
 * clamped to what the physics can support at all.
 */
export function fit(m) {
  const notes = [];
  const hz = { walk: median(m.walk.hz), jog: median(m.jog.hz), sprint: median(m.sprint.hz) };
  const gaitV = Math.max(m.walk.maxV, m.jog.maxV, m.sprint.maxV);
  const gaitTilt = Math.max(m.walk.maxTilt, m.jog.maxTilt, m.sprint.maxTilt);
  const peaks = [...m.walk.peaks, ...m.jog.peaks, ...m.sprint.peaks];

  // jump: below their hop, above anything their running did
  const hop = median(m.hop);
  const runFloor = gaitV > 0 ? gaitV * 1.15 + 0.1 : 1.2;
  let barMs = hop > 0 ? hop * 0.8 : GENERIC.jump.barMs;
  if (barMs < runFloor) barMs = runFloor;
  barMs = clamp(barMs, 0.8, 1.6);
  // warn only when the bar that won ends up close to the hop itself (not when a cap kept it well clear)
  if (hop > 0 && barMs > hop * 0.9) notes.push('Jump a little higher in the games.');

  // slide / squat: below their squat, above their stride
  const sq = median(m.squat);
  const gaitCeil = gaitTilt > 0 ? gaitTilt + 8 : GENERIC.slide.onDeg;
  let onDeg = sq > 0 ? sq * 0.8 : GENERIC.slide.onDeg;
  if (onDeg < gaitCeil) onDeg = gaitCeil;
  onDeg = clamp(onDeg, 34, 50);
  if (sq > 0 && onDeg > sq * 0.9) notes.push('Squat a little lower in the games.');
  const lazyDeg = clamp(Math.max(gaitTilt + 5, onDeg - 6), 30, onDeg);
  // the calm gate (a squat vs a phone flung about a loose pocket) sits 1.6× above this person's own squats
  const calmG = clamp(Math.max(GENERIC.slide.calmG, m.squatMaxA * 1.6), GENERIC.slide.calmG, 4.5);
  const calmDps = clamp(Math.max(GENERIC.slide.calmDps, m.squatMaxW * 1.6), GENERIC.slide.calmDps, 1000);

  // running: a run starts on their own strikes (a light child's are softer; standing about never passes 1.1 g)
  const startG = peaks.length >= 6 ? clamp(quantile(peaks, 0.25) * 0.8, 1.2, 1.6) : GENERIC.step.startG;
  const fastHz = hz.sprint > 0 ? clamp(hz.sprint * 0.97, 2.0, 4.0) : DEFAULT.fastHz;
  const band = slow => {
    const lo = slow > 0 ? clamp(slow, 1.4, 2.6) : DEFAULT.slowHz;
    const hi = Math.max(fastHz, lo + 0.5);
    return { slowHz: lo, jogHz: clamp((lo + hi) / 2, lo + 0.2, hi - 0.2), fastHz: hi };
  };
  if (hz.sprint > 0 && hz.jog > 0 && hz.sprint - hz.jog < 0.4) notes.push('Run faster when it says Run fast.');

  // the freeze: the doll's bar sits 1.5× above how still they really stand — never stricter than the default
  const sa = quantile(m.still.a, 0.99), sw = quantile(m.still.w, 0.99);
  const A0 = clamp(Math.max(DEFAULT.stillA0, sa * 1.5), DEFAULT.stillA0, 0.28);
  const W0 = clamp(Math.max(DEFAULT.stillW0, sw * 1.5), DEFAULT.stillW0, 110);
  if (sw * 1.5 > 110 || sa * 1.5 > 0.28) notes.push('When it says Stop, stand very still.');

  return {
    v: 1, created: new Date().toISOString(),
    measures: { hz, gaitV, gaitTilt, hop, squat: sq, stillA: sa, stillW: sw, stopS: m.stopS, squatMaxA: m.squatMaxA, squatMaxW: m.squatMaxW, peakP25: quantile(peaks, 0.25) },
    cfg: { jump: { barMs }, slide: { onDeg, offDeg: onDeg - 10, lazyDeg, fullDeg: clamp(onDeg + 18, onDeg + 10, 80), calmG, calmDps }, step: { startG } },
    run: band(hz.jog),      // Subway: a light jog holds the level's pace
    pace: band(hz.walk),    // Squid Games: a walk crosses the field slowly
    still: { A0, W0 },
    notes,
  };
}
