// Jump Rope: the rules and the rope, and nothing else.
//
// The game as the show plays it (season 3): a narrow bridge high over a pit,
// the two giant dolls at either end turning a rope over it. Cross the bridge
// before the clock runs out. The rope sweeps under the bridge every turn —
// be in the air when it does, or it takes your legs and you go over the
// side. Halfway across the bridge is broken: jump the gap.
//
// The rope is a rigid curve turning about the line between the dolls'
// handles (measured on the model: x 0.027, y 9.273, from z −17.8 to +17.6).
// Its shape is a flattened arch (a superellipse), so at the bottom of each
// turn it skims 15 cm over the whole bridge except the last metre at each
// end, where it already rises over your head. Every point of the rope passes
// the bottom at the same moment — you see it hit the bridge ahead of you as
// it reaches your own feet.
//
// Pure: no three.js, no DOM.

export const ROPE = {
  axisX: 0.027, axisY: 9.273, zA: -17.8, zB: 17.6,
  R: 8.85,              // radius over the bridge: the bottom of the turn is 0.42 m, the deck 0.276
  p: 6,                 // superellipse power: flat over the bridge, curving up into the handles
  deckY: 0.276,         // the bridge's top (stone and sleepers)
  floorY: 0.42,         // the two platforms
  pitY: -40.9,          // the flowers at the bottom
  bridge: [-16.67, 16.67],
  gap: [-0.79, 0.72],   // the broken middle: 1.5 m of nothing
  dangerY: 1.25,        // the rope takes you if its bottom is under this at your spot
};

export const RULES = {
  limitS: 150,
  startZ: -26.4,        // your place in the line, on the start platform behind Young-hee
  finishZ: 17.4,        // on the far platform, past Cheol-su's legs: across
  periodStart: 2.8,     // seconds per turn at the start…
  periodEnd: 1.75,      // …and at the end (it speeds up over rampS)
  rampS: 110,
  spinUpS: 2.5,         // at GO it starts from rest at the top
  airS: 0.6,            // a jump keeps you over the rope this long
  lateS: 0.15,          // a jump heard this late after the pass still counts (the phone hears take-off, not the thought)
  slowTurns: 5,         // SLOW ROPE: this many slow turns
  slowK: 1.35,
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

/** How far the rope is from its axis at this z. */
export function radius(z, R = ROPE) {
  const zc = (R.zA + R.zB) / 2, L = (R.zB - R.zA) / 2;
  const u = Math.abs(z - zc) / L;
  if (u >= 1) return 0;
  return R.R * Math.pow(1 - Math.pow(u, R.p), 1 / R.p);
}
/** The rope's lowest point at z (the bottom of its turn). */
export const bottomY = (z, R = ROPE) => R.axisY - radius(z, R);
/** Standing here, does the rope take your legs at the bottom of a turn? */
export const inDanger = (z, R = ROPE) => z > R.bridge[0] && z < R.bridge[1] && bottomY(z, R) < R.dangerY;
/** Is there bridge (or platform) under z? */
export const solidAt = (z, R = ROPE) => !(z > R.gap[0] && z < R.gap[1]) && z > -29.6 && z < 29.6;
/** The height you stand at, at z. */
export const groundAt = (z, R = ROPE) => (z <= R.bridge[0] || z >= R.bridge[1]) ? R.floorY : R.deckY;
/** A point on the rope at angle θ (0 = the bottom), at z. */
export function ropePoint(z, theta, R = ROPE) {
  const r = radius(z, R);
  return [R.axisX + r * Math.sin(theta), R.axisY - r * Math.cos(theta), z];
}

export class Rope {
  constructor(opts = {}) { this.R = { ...RULES, ...opts }; this.reset(); }
  reset() {
    this.theta = Math.PI;     // at rest at the top
    this.running = false; this.elapsed = 0; this.turns = 0; this.clock = this.R.limitS;
    this.slow = 0;            // slow turns left
    this.lastPassAt = -1e9; this.speedMul = 1; this.forcedPeriod = null;
    this.over = false;
  }
  start() { this.running = true; this.elapsed = 0; }
  /** Seconds per turn right now. */
  get period() {
    if (this.forcedPeriod) return this.forcedPeriod;
    const R = this.R, k = smooth(this.elapsed / R.rampS);
    let p = R.periodStart + (R.periodEnd - R.periodStart) * k;
    if (this.slow > 0) p *= R.slowK;
    return p;
  }
  /** Angular speed now (rad/s), easing up from rest at the start. */
  get omega() { return (2 * Math.PI / this.period) * smooth(this.elapsed / this.R.spinUpS) * this.speedMul; }
  /** Seconds until the rope is next at the bottom. */
  get untilPass() {
    const w = this.omega; if (w < 1e-3) return Infinity;
    const TWO = Math.PI * 2, left = TWO - (((this.theta % TWO) + TWO) % TWO);
    return left / w;
  }
  /** Since it last passed the bottom. */
  sincePass(now) { return now - this.lastPassAt; }

  /** Advance; returns the events of this step: {type:'pass', at} when the rope sweeps under the bridge, {type:'timeup'}. */
  update(dt, now) {
    const ev = [];
    if (!this.running) return ev;
    this.elapsed += dt;
    if (!this.over) {
      this.clock = Math.max(0, this.clock - dt);
      if (this.clock <= 0) { this.over = true; ev.push({ type: 'timeup' }); }
    }
    const TWO = Math.PI * 2;
    const before = Math.floor(this.theta / TWO);
    this.theta += this.omega * dt;
    const after = Math.floor(this.theta / TWO);
    if (after > before) {
      // the moment of the pass inside this step, for fairness
      const over = (this.theta - after * TWO) / Math.max(1e-6, this.omega);
      const at = now - over;
      this.turns++; this.lastPassAt = at;
      if (this.slow > 0) this.slow--;
      ev.push({ type: 'pass', at, turn: this.turns });
    }
    return ev;
  }
  addTime(s) { this.clock += s; }
  slowDown() { this.slow = this.R.slowTurns; }
  /** Turns per minute, for the HUD. */
  get rpm() { return this.omega * 60 / (2 * Math.PI); }
}
