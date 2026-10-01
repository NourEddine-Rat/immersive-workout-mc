// What the doll sees, and how far your legs carry you.
//
// Two readings of the phone's raw samples, next to the detectors pocket.js
// already runs (jump, slide, footfalls, cadence):
//
// 1. STILLNESS — the suspicion meter. While the doll is looking, every
//    sample is scored by how far it is from lying still: e = max(|a| off 1 g
//    over A0, gyro over W0). Anything above 1 fills the meter, anything below
//    lets it drain; a footfall (a soft local peak of |a|, far below what the
//    running detector needs) adds a lump on its own, because a slow walk in
//    place barely turns the thigh. Full meter = caught.
//
//    Measured on the four real pocket recordings (18–19 Sep):
//      standing still        never fills (peak 0.00 on all four)
//      slow walk in place    caught in 0.3–1.5 s
//      jogging               caught in 0.2–0.4 s
//      a step, a squat       caught in 0.5–1.5 s
//      fidgeting ("noise")   peaks 0.0–1.3 — a real fidget can get you shot, as in the show
//    A player's own profile can only make it MORE forgiving (their measured
//    stillness × 1.5, never under these floors).
//
// 2. PACE — metres per second across the field, from cadence. A running
//    rhythm takes the detector a second to recognise, and a green light can
//    be two seconds long, so the very first footfall already moves you at a
//    walk; the cadence takes over once it is known.

export const G = 9.80665;

export const STILL = {
  A0: 0.15,         // g off 1 g that counts as "moving"   (still: p99 ≤ 0.15; slowest walk p90 ≥ 0.26)
  W0: 60,           // °/s that counts as "moving"          (still: p99 ≤ 53;   slowest walk p90 ≥ 103)
  K: 2.5,           // meter per second per unit of excess
  decay: 0.3,       // meter per second drained while still
  foot: 0.55,       // a footfall adds this much
  footG: 1.22,      // ...a local peak of |a| at least this high (still never passes 1.16 g)
  footProm: 0.18,   // ...standing this far above the dip before it
  footMs: 250,      // ...and never two inside this
  // While her head is still turning, a real move already counts — a settle does not. Measured on the
  // real stops in the recordings: stopped within 0.5 s of the turn starting = always safe; still going
  // at 0.6 s = sometimes caught, 0.7 s = usually, 1.0 s = always (before this: safe up to ~0.8 s).
  // Standing still: never. Fake-phone rounds on real motion: on time and 0.3 s late win, 0.75 s late dies.
  turnFreeS: 0.45,  // reaction time: the first part of the turn is free
  turnBar: 2.2,     // then only movement above 2.2 (not 1) counts — a stop's own wobble passes under it
  turnFoot: 0.3,    // and a footfall is worth this much (not 0.55)
};

export class Stillness {
  constructor(cfg = STILL) { this.cfg = { ...cfg }; this.ring = []; this.lastFoot = -1e9; this.lastT = null; this.e = 0; this.eSmooth = 0; this.meter = 0; this.armed = false; this.feet = 0; this.footAt = -1e9; this.mode = 'scan'; }

  /**
   * Start (or stop) counting against you. Arming clears the meter; going from the turn to the scan keeps it.
   * @param mode 'turn' (her head still swinging round: only real moves count) or 'scan'
   */
  arm(on, mode = 'scan') { if (on && !this.armed) this.meter = 0; this.armed = on; this.mode = mode; }

  /** One raw sample {t ms, a:[3] m/s² with gravity, w:[3] °/s}. Returns true on a footfall. */
  push(s) {
    const c = this.cfg;
    const dt = this.lastT == null ? 1 / 60 : Math.min(0.1, Math.max(0, (s.t - this.lastT) / 1000));
    this.lastT = s.t;
    const ag = Math.hypot(s.a[0], s.a[1], s.a[2]) / G, w = Math.hypot(s.w[0], s.w[1], s.w[2]);
    const e = Math.max(Math.abs(ag - 1) / c.A0, w / c.W0);
    this.e = e;
    this.eSmooth += (e - this.eSmooth) * Math.min(1, dt / 0.15);
    let foot = false;
    const r = this.ring; r.push({ t: s.t, g: ag }); if (r.length > 12) r.shift();
    const n = r.length;
    if (n >= 5) {
      const p = r[n - 3];
      if (p.g >= c.footG && p.g >= r[n - 4].g && p.g >= r[n - 5].g && p.g > r[n - 2].g && p.g > r[n - 1].g) {
        let dip = p.g;
        for (let i = n - 4; i >= 0 && p.t - r[i].t <= 150; i--) dip = Math.min(dip, r[i].g);
        if (p.g - dip >= c.footProm && p.t - this.lastFoot > c.footMs) { this.lastFoot = p.t; foot = true; this.feet++; this.footAt = performance.now(); }
      }
    }
    if (this.armed) {
      const turn = this.mode === 'turn';
      this.meter = Math.max(0, this.meter + Math.max(0, e - (turn ? c.turnBar : 1)) * dt * c.K - c.decay * dt);
      if (foot) this.meter += turn ? c.turnFoot : c.foot;
    }
    return foot;
  }

  /** The keyboard's stand-in for a body (dev play): moving or not, this frame. */
  pushFake(dt, moving) {
    const e = moving ? 3 : 0.2;
    this.e = e; this.eSmooth += (e - this.eSmooth) * Math.min(1, dt / 0.15);
    if (this.armed) this.meter = Math.max(0, this.meter + Math.max(0, e - (this.mode === 'turn' ? this.cfg.turnBar : 1)) * dt * this.cfg.K - this.cfg.decay * dt);
  }

  get caught() { return this.meter >= 1; }
  /** A footfall in the last `ms` (performance.now clock) — the legs are going, even before a rhythm is recognised. */
  footRecent(ms = 700) { return performance.now() - this.footAt < ms; }
}

// ------------------------------------------------------------------ pace

export const PACE = {
  slowHz: 2.0, jogHz: 2.7, fastHz: 3.3,    // the cadence bands (a profile replaces them with the player's own)
  walkMs: 0.75,      // m/s across the field at a walk (and on the first footfall): 60 m of field in ~2.6 min of songs — the clock is tight
  jogMs: 1.3,        // ...at a jog: across in about a minute and a half
  fastMs: 1.9,       // ...running hard: about a minute
  tauUp: 0.35, tauDown: 0.22,               // how quickly the view follows the legs (down is quicker: a stop must look like a stop)
};

/** Metres per second across the field for this cadence (0 = not running). */
export function paceFor(cadenceHz, c = PACE) {
  if (!(cadenceHz > 0)) return 0;
  if (cadenceHz <= c.slowHz) return c.walkMs;
  if (cadenceHz <= c.jogHz) return c.walkMs + (c.jogMs - c.walkMs) * (cadenceHz - c.slowHz) / (c.jogHz - c.slowHz);
  return c.jogMs + (c.fastMs - c.jogMs) * Math.min(1, (cadenceHz - c.jogHz) / (c.fastHz - c.jogHz));
}

// The distance a runner's legs really cover (subway's runspeed.js, the same
// rule): each footfall is a step, and a step grows with cadence.
export const STEP = { slowM: 0.65, fastM: 1.3 };
export function stepLength(cadenceHz, c = PACE, s = STEP) {
  const k = Math.min(1, Math.max(0, (cadenceHz - c.slowHz) / (c.fastHz - c.slowHz)));
  return s.slowM + (s.fastM - s.slowM) * k;
}
export function metresRun(cadenceHz, dt, c = PACE) { return cadenceHz > 0 ? cadenceHz * stepLength(cadenceHz, c) * dt : 0; }
