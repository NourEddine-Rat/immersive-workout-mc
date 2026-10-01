// Guessing what the body did, from a phone in a pocket.
//
// These are deliberately GENERIC. Nothing here is fitted to a person; the only
// inputs are physical constants and the frame (down, and the sideways line
// from a squat). If a detector needs to be tuned to you before it works, it
// has not really understood the movement.
//
// The first real recording rewrote this file. What it taught, in one line
// each, is written above the detector it changed.

import { len } from './vector-math.js';
import { tilt, rates, upAccel, settle } from './frame.js';

export const G = 9.80665;

export const GENERIC = {
  jump: {
    tauS: 0.4,          // memory of the velocity integrator
    barMs: 1.45,        // m/s of take-off: real jumps 1.74+, any running under 1.21
    rearm: 0.5,         // must fall back under this fraction of the bar
    refractoryMs: 900,  // a landing 0.5-0.7 s after take-off is a spike too, and the game
                        // cannot jump again inside this anyway
  },
  slide: {
    onDeg: 46,          // total thigh tilt: small ducks 50-56, full 58-105, no gait over 41
    offDeg: 36,         // ...and it is not over until you are well back up (second recording:
                        // a held slide wobbling at the bar fired twice)
    fullDeg: 75,
    holdMs: 80,         // a stride passes through the same angle and leaves
    lazyDeg: 40,        // a lazy squat that never reaches the bar still counts...
    lazyHoldMs: 200,    // ...if it stays this long: no stride, twist or lean held 40° past 150 ms
    refractoryMs: 900,
    rearmDeg: 22,       // after a slide the leg must come back this far up before another can be called: a
                        // long squat wobbling at the off bar is one slide, not three
    calmG: 2.6,         // a squat is calm: |a| never passed 1.9 g nor the gyro 175°/s in any of 35 squats' hold
    calmDps: 600,       // windows, while a phone thrown about a loose pocket by a stride sees 3–9 g and 300–1100°/s.
                        // A violent sample restarts the hold: the bar must be held for 80 ms of calm.
  },
  step: {
    peakG: 1.15,        // once running, a footfall is a local peak of |a| at least this high (the other leg lands softer)...
    startG: 1.6,        // ...but a run is only STARTED by footfalls this hard: jogging strikes 1.75–3 g, fidgets and steps 1.2 (p90 1.6)
    promG: 0.25,        // ...standing this far above the dip before it (a footfall follows the unloading of the leg)
    promMs: 150,        // how far back that dip is looked for
    refractoryMs: 200,  // two peaks closer than this are one footfall (5 Hz is the ceiling)
    runNeeds: 4,        // footfalls in rhythm before it is running...
    quickNeeds: 3,      // ...or this many when they are quick and even (a real run, not a step out and back)
    quickMs: 480,       // quick = every interval under this (2.1 Hz)
    quickRhythm: 1.3,   // even = longest/shortest interval at most this
    maxGapMs: 900,      // slower than this between footfalls is not running (1.1 Hz)
    minStrideMs: 200,   // faster than this is not a footfall rhythm (an in-place sprint has strides down to ~215 ms)
    rhythm: 2.0,        // the longest recent interval may be at most this many times the shortest
    missed: [1.7, 2.3], // an interval this many times the shortest is one missed footfall, and counts as two strides
    stopAfter: 2.5,     // running ends this many median intervals after the last footfall (a missed one is forgiven)...
    stopMinMs: 900,     // ...but never sooner than this
    jumpHoldMs: 1300,   // a run that jumps is still a run: after the landing, this long to find the rhythm again
    windowMs: 2000,     // cadence is footfalls over this window, and the rhythm's regularity is measured over it
    acStrong: 0.5,      // autocorrelation of |a| at the stride lag this high = a real, regular run (nothing standing reaches 0.45)
    acMinMs: 220,       // stride lags searched, 4.5 Hz…
    acMaxMs: 1000,      // …to 1 Hz
  },
  lateral: {
    yawDeg: 16,         // turn about vertical inside the window
    windowMs: 550,
    quietDeg: 6,
    refractoryMs: 600,
    maxTiltDeg: 30,     // a leg this far from upright is squatting, not stepping
    maxLaunchV: 0.7,    // ...and this much vertical velocity, either way, is a jump or its crouch
    afterJumpMs: 1000,  // landings twist the leg too
    holdMs: 120,        // wait this long before calling, in case a squat is starting
    afterDeepMs: 500,   // and this long after the leg was folded, because standing up twists it too
  },
  lean: { onDeg: 14, offDeg: 8, holdMs: 140, refractoryMs: 500 },
};

// --------------------------------------------------------------------- jump

/**
 * A jump, from how fast you left the floor.
 *
 * The first design used free fall — while airborne the phone should read
 * zero. On a thigh it does not: the leg tucks 30-70 degrees and turns at
 * 300-500 deg/s during a jump, and a phone on a rotating limb feels that as
 * acceleration. In the recording, weightless windows during jumps were no
 * longer than during sprinting. Free fall is invisible from a pocket.
 *
 * What is not invisible is the push. To leave the ground you have to launch
 * yourself upward, and integrating upward acceleration over the push-off gives
 * a take-off velocity: 1.74-2.14 m/s on every real jump in the recording,
 * never above 1.21 m/s in any second of running. Running in place moves the
 * legs; it does not launch the body.
 *
 * The integral is leaky, so it forgets on its own and needs no gait context.
 * The call comes out as the velocity crosses the bar, which is about the
 * moment the feet leave the floor.
 */
export class JumpDetector {
  constructor(cfg = GENERIC.jump) { this.cfg = cfg; this.reset(); }
  reset() { this.v = 0; this.armed = true; this.lastFire = -1e9; this.last = null; this.peak = 0; this.onset = 0; }

  /** @param up upward acceleration, m/s^2, gravity removed */
  push(t, up) {
    const c = this.cfg;
    // never backwards: a sample out of order (a clock re-sync) would blow the decay up and poison v for good
    const dt = this.last == null ? 1 / 60 : Math.max(0, Math.min(0.1, (t - this.last) / 1000));
    this.last = t;
    const prev = this.v;
    this.v = this.v * Math.exp(-dt / c.tauS) + up * dt;
    // the push starts where the velocity last stopped falling
    if (this.v <= prev) this.onset = t;
    if (this.armed && this.v >= c.barMs && t - this.lastFire > c.refractoryMs) {
      this.armed = false; this.lastFire = t; this.peak = this.v;
      return { kind: 'jump', at: this.onset, calledAt: t, latencyMs: t - this.onset, takeoffV: this.v, provisional: true };
    }
    if (!this.armed) {
      this.peak = Math.max(this.peak, this.v);
      if (this.v < c.barMs * c.rearm) { this.armed = true; return { kind: 'jump-done', at: this.lastFire, takeoffV: this.peak }; }
    }
    return null;
  }
}

// -------------------------------------------------------------------- slide

/**
 * A duck or a slide, from the thigh going towards horizontal.
 *
 * Uses TOTAL tilt from the resting `down`, no axes involved: the recording put
 * every squat at 65-105 degrees and every second of gait under 39. That margin
 * does not need the sideways line to be right, so a slide is found even when
 * the frame is not.
 */
export class SlideDetector {
  constructor(cfg = GENERIC.slide) { this.cfg = cfg; this.reset(); }
  reset() { this.since = null; this.peak = 0; this.fired = false; this.lastFire = -1e9; this.lazySince = null; this.armed = true; }

  /**
   * @param totalDeg total thigh tilt from frame.tilt()
   * @param violent  this sample is too fast or too hard to be a squat (see calmG / calmDps)
   */
  push(t, totalDeg, violent = false) {
    const c = this.cfg, a = Math.abs(totalDeg);
    if (!this.armed && a < (c.rearmDeg ?? 0)) this.armed = true;
    if (!this.armed && this.since == null) { this.lazySince = null; return null; }   // still down from the last one
    // a phone flung about a loose pocket crosses the bar too, but never calmly: the hold restarts
    if (violent && !this.fired) { this.since = null; this.lazySince = null; this.peak = 0; }
    // the lazy path counts time strictly above its bar, no hysteresis: a
    // stride that grazes 40° and hovers at 38° must not add up
    if (a >= c.lazyDeg) { if (this.lazySince == null) this.lazySince = t; } else this.lazySince = null;
    const on = this.since == null ? a >= c.onDeg : a >= c.offDeg;
    if (on) {
      if (this.since == null) { this.since = t; this.peak = 0; }
      this.peak = Math.max(this.peak, a);
      if (!this.fired && t - this.since >= c.holdMs && t - this.lastFire > c.refractoryMs) return this._fire(t);
      return null;
    }
    if (this.since != null) {
      const out = this.fired ? { kind: 'slide-done', at: this.since, heldMs: t - this.since, depthDeg: this.peak, size: this.peak >= c.fullDeg ? 'full' : 'small' } : null;
      this.since = null; this.fired = false; this.peak = 0;
      return out;
    }
    // not deep enough for the bar, but held: a lazy squat is a slide too
    if (this.lazySince != null && t - this.lazySince >= c.lazyHoldMs && t - this.lastFire > c.refractoryMs) {
      this.since = this.lazySince; this.peak = a;
      return this._fire(t);
    }
    return null;
  }
  _fire(t) {
    const c = this.cfg;
    this.fired = true; this.lastFire = t; this.armed = false;
    return { kind: 'slide', at: this.since, depthDeg: this.peak, size: this.peak >= c.fullDeg ? 'full' : 'small', provisional: true };
  }
}

// ------------------------------------------------------------- steps and gait

/**
 * Footfalls, and from them cadence.
 *
 * A footfall is a peak of |a|. Running is a RHYTHM of them: three or more
 * with intervals that could be a gait and agree with each other, and the last
 * one recent. That last part is what makes it stop when you stop — the old
 * two-second window kept "running" alive for two seconds after the last
 * step, which reads as "the game thinks I am running when I am not". Now it
 * ends about one and a half strides after the last footfall.
 *
 * Time here is ACTIVE time: while `ignore` is set (a jump's shadow, a slide)
 * the clock does not advance, so a jump in the middle of a run neither
 * counts its landing as strides nor ends the run.
 */
export class StepDetector {
  constructor(cfg = GENERIC.step) { this.cfg = cfg; this.reset(); }
  reset() { this.peaks = []; this.ring = []; this.lastFire = -1e9; this.skip = 0; this.lastT = null; this.now = 0; this.lastGood = null; this.lastGoodAt = -1e9; this.holdUntil = -1e9;
    this.win = []; this.ac = { r: 0, lags: [] }; this.acCount = 0; }

  /**
   * @param t      ms
   * @param aMag   |a| with gravity, m/s²
   * @param ignore true while this sample must not count (and the run clock pauses)
   */
  push(t, aMag, ignore = false) {
    const c = this.cfg, g = aMag / G;
    const dt = this.lastT == null ? 0 : Math.max(0, t - this.lastT);
    this.lastT = t;
    if (ignore) { this.skip += dt; this.ring = []; this.now = t - this.skip; return null; }   // the window keeps its active-time samples
    const ta = t - this.skip;   // active time
    this.now = ta;
    // A footfall is a LOCAL peak of |a| that stands out from the dip before
    // it. A threshold crossing was not enough: a running stride crosses any
    // fixed bar two or three times (strike, push-off, ringing), and those
    // extra crossings wreck the rhythm. The peak is confirmed two samples
    // late, which is 33 ms at 60 Hz.
    const r = this.ring; r.push({ t: ta, g }); if (r.length > 24) r.shift();
    // the window of |a| the regularity is measured on (active time: a jump's shadow is cut out)
    const w = this.win; w.push({ t: ta, g }); while (w.length && ta - w[0].t > c.windowMs) w.shift();
    if (++this.acCount >= 6) { this.acCount = 0; this._autocorrelate(); }
    let out = null;
    const n = r.length;
    if (n >= 5) {
      const p = r[n - 3];
      if (p.g >= c.peakG && p.g >= r[n - 4].g && p.g >= r[n - 5].g && p.g > r[n - 2].g && p.g > r[n - 1].g) {
        let dip = p.g;
        for (let i = n - 4; i >= 0 && p.t - r[i].t <= c.promMs; i--) dip = Math.min(dip, r[i].g);
        const hardEnough = p.g >= c.startG || this._current() != null;
        if (hardEnough && p.g - dip >= c.promG && p.t - this.lastFire > c.refractoryMs) {
          this.lastFire = p.t; this.peaks.push(p.t);
          out = { kind: 'step', at: p.t + this.skip, peakG: p.g };
        }
      }
    }
    // a gap too long to be a stride breaks the rhythm: only what came after it counts
    if (out) {
      const p = this.peaks; let from = 0;
      for (let i = 1; i < p.length; i++) if (p[i] - p[i - 1] > c.maxGapMs) from = i;
      if (from || p.length > 14) this.peaks = p.slice(Math.max(from, p.length - 14));
    }
    return out;
  }

  /**
   * Drop footfalls from the last `ms` of active time (a jump's crouch and
   * push-off), and let the crouch take no time at all: a run that jumps is
   * still a run, and the next footfall after the landing gets a full stride.
   */
  forget(ms) {
    while (this.peaks.length && this.now - this.peaks[this.peaks.length - 1] < ms) this.peaks.pop();
    // the crouch itself makes a footfall or two at odd intervals, so ask whether it was a run just before the crouch
    const wasRunning = this._rhythm() || (this.lastGood && this.now - this.lastGoodAt < 1000);
    if (this.peaks.length) { const last = this.peaks[this.peaks.length - 1]; if (this.now > last) { this.skip += this.now - last; this.now = last; } }
    if (wasRunning) this.holdUntil = this.now + this.cfg.jumpHoldMs;
    this.ring = [];
  }

  /** The last few intervals, if they make a rhythm; else null. */
  _rhythm() {
    const c = this.cfg, p = this.peaks;
    if (p.length < c.quickNeeds) return null;
    let iv = [];
    for (let i = Math.max(1, p.length - 6); i < p.length; i++) iv.push(p[i] - p[i - 1]);
    // the softer leg's footfall is missed now and then: an interval of about
    // two strides is two strides (pedometers forgive a missed step the same way)
    const lo0 = Math.min(...iv);
    iv = iv.map(v => (v >= lo0 * c.missed[0] && v <= lo0 * c.missed[1]) ? v / 2 : v);
    const even = (list, ratio, maxMs) => { const lo = Math.min(...list), hi = Math.max(...list); return lo >= c.minStrideMs && hi <= maxMs && hi <= lo * ratio; };
    // the last few strides agree — or, failing that (a stumble, a jump's gap
    // still in the window), the last two are quick and even, a run restarting
    let steady = iv.length >= c.runNeeds - 1 && even(iv, c.rhythm, c.maxGapMs);
    let ok = steady;
    if (!ok) { const tail = iv.slice(-(c.quickNeeds - 1)); ok = tail.length >= c.quickNeeds - 1 && even(tail, c.quickRhythm, c.quickMs); if (ok) iv = tail; }
    if (!ok) return null;
    const sorted = [...iv].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (this.now - p[p.length - 1] > Math.max(c.stopMinMs, median * c.stopAfter)) return null;   // the last footfall is stale
    return { median, n: iv.length, steady };
  }

  /**
   * How regular the last window of |a| is, and at which stride lags.
   *
   * A real run repeats: the signal two or three strides ago looks like the
   * signal now, and the normalised autocorrelation at the stride lag is
   * 0.6–0.9. Standing about, hopping, squatting and side-stepping never pass
   * 0.45, however many peaks they make — which is what makes this the gate
   * for the speed bonus: a burst of quick footfalls cannot fake it.
   */
  _autocorrelate() {
    const c = this.cfg, w = this.win, n = w.length;
    if (n < 40 || w[n - 1].t - w[0].t < c.windowMs * 0.8) { this.ac = { r: 0, lags: [] }; return; }
    const dtMs = (w[n - 1].t - w[0].t) / (n - 1);
    let mean = 0; for (const s of w) mean += s.g; mean /= n;
    const y = new Float64Array(n); let e0 = 0;
    for (let i = 0; i < n; i++) { y[i] = w[i].g - mean; e0 += y[i] * y[i]; }
    if (e0 < 1e-6) { this.ac = { r: 0, lags: [] }; return; }
    const L0 = Math.max(2, Math.round(c.acMinMs / dtMs)), L1 = Math.min(n - 10, Math.round(c.acMaxMs / dtMs));
    const rs = [];
    for (let L = L0; L <= L1; L++) { let sum = 0; for (let i = L; i < n; i++) sum += y[i] * y[i - L]; rs.push({ L, r: sum / e0 * n / (n - L) }); }
    const peaks = [];
    for (let i = 1; i < rs.length - 1; i++) if (rs[i].r >= rs[i - 1].r && rs[i].r >= rs[i + 1].r) peaks.push({ hz: 1000 / (rs[i].L * dtMs), r: rs[i].r });
    const best = peaks.reduce((a, b) => (b.r > a.r ? b : a), { r: 0, hz: 0 });
    this.ac = { r: best.r, lags: peaks.filter(p => p.r >= 0.45 * best.r) };
  }

  /** Footfalls per second over the window — a burst of three quick peaks is not a cadence. */
  _windowHz() {
    const c = this.cfg, from = this.now - c.windowMs;
    let n = 0; for (const p of this.peaks) if (p >= from) n++;
    return n / (c.windowMs / 1000);
  }

  /** The rhythm, or the one held through a jump. */
  _current() {
    const r = this._rhythm();
    if (r) { this.lastGood = r; this.lastGoodAt = this.now; return r; }
    return this.now < this.holdUntil ? this.lastGood : null;
  }
  /**
   * Cadence, steps per second. The count over the window is the honest
   * figure — three quick peaks in half a second are 1.25/s, not 4 — and when
   * the signal is regular the autocorrelation gives the exact stride period;
   * of its candidate lags (one step, two steps), the one nearest the count
   * is taken, so a double bump per stride cannot double the cadence either.
   */
  get cadenceHz() {
    if (!this._current()) return 0;
    const cnt = this._windowHz();
    if (this._regular() && this.ac.lags.length) {
      const pick = this.ac.lags.reduce((a, b) => Math.abs(Math.log(b.hz / cnt)) < Math.abs(Math.log(a.hz / cnt)) ? b : a);
      return Math.min(4.5, pick.hz);
    }
    return Math.min(4.5, cnt);
  }
  get running() { return this._current() != null; }
  /** Regular = the autocorrelation says so AND the window actually holds a run's worth of footfalls (a perfectly even burst of three is not one). */
  _regular() { return this.ac.r >= this.cfg.acStrong && this._windowHz() * this.cfg.windowMs / 1000 >= 4; }
  /** A regular run over the whole window — the only thing trusted with the speed bonus. */
  get steady() { const r = this._current(); return !!(r && r.steady && this._regular()); }
  /** How regular the run is right now, 0–1. */
  get regularity() { return this.ac.r; }
}

// --------------------------------------------------------------- left / right

/**
 * A sideways step, from the thigh TURNING about vertical.
 *
 * The first bet — abduction versus adduction, read as roll — did not survive
 * contact with data: roll change, sideways acceleration and the first
 * roll-rate sign all came out with the same distribution for both directions.
 *
 * What the recording did show was a twist. Stepping left with the phone on
 * the right leg drags that leg across the body, and the thigh rotates inward
 * 10-28 degrees about vertical, six times out of six (five of five while
 * jogging). Stepping right barely turns it. That asymmetry is weak and needs a
 * second, better recording — but it has one property nothing else here has:
 * rotation about gravity has a sign that means the same thing in every pocket,
 * on every phone, with no learned bit. Counter-clockwise seen from above is
 * counter-clockwise, full stop.
 *
 * So this is explicitly EXPERIMENTAL: it integrates yaw about the current
 * gravity over a short window and calls a side when the sweep passes the bar.
 * The play screen will show how often it is right.
 */
export class LateralDetector {
  constructor(cfg = GENERIC.lateral) { this.cfg = cfg; this.reset(); }
  reset() { this.win = []; this.armed = true; this.lastFire = -1e9; this.last = null; }

  /** @param yawDps rotation about vertical, deg/s, right-hand rule about down (clockwise from above = positive) */
  push(t, yawDps) {
    const c = this.cfg;
    const dt = this.last == null ? 1 / 60 : Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    this.win.push([t, yawDps * dt]);
    while (this.win.length && t - this.win[0][0] > c.windowMs) this.win.shift();
    let sweep = 0; for (const [, d] of this.win) sweep += d;
    if (this.armed && Math.abs(sweep) >= c.yawDeg && t - this.lastFire > c.refractoryMs) {
      this.armed = false; this.lastFire = t;
      // clockwise from above (positive about down) is turning right; the
      // trailing leg twists the other way, so a LEFT step reads negative
      return { kind: sweep < 0 ? 'left' : 'right', at: this.win[0][0], sweepDeg: sweep, experimental: true };
    }
    if (!this.armed && Math.abs(sweep) < c.quietDeg) this.armed = true;
    return null;
  }
}

/** Leaning: sustained roll away from the (settling) resting position. */
export class LeanDetector {
  constructor(cfg = GENERIC.lean) { this.cfg = cfg; this.reset(); }
  reset() { this.side = 0; this.since = null; this.fired = false; this.lastFire = -1e9; }

  push(t, rollDeg) {
    const c = this.cfg, a = Math.abs(rollDeg), s = Math.sign(rollDeg);
    if (a >= c.onDeg) {
      if (this.side !== s) { this.side = s; this.since = t; this.fired = false; }
      if (!this.fired && t - this.since >= c.holdMs && t - this.lastFire > c.refractoryMs) {
        this.fired = true; this.lastFire = t;
        return { kind: s > 0 ? 'lean-right' : 'lean-left', at: this.since, deg: rollDeg };
      }
    } else if (a < c.offDeg) {
      if (this.side !== 0 && this.fired) { const was = this.side; this.side = 0; this.fired = false; return { kind: 'lean-centre', at: t, from: was > 0 ? 'right' : 'left' }; }
      this.side = 0; this.fired = false;
    }
    return null;
  }
}

// ------------------------------------------------------------------- the set

/**
 * All five together. Two rules of arbitration: a jump wins (its landing
 * would otherwise read as a step and a duck), and the frame's `down` keeps
 * settling toward the phone's actual resting angle whenever the leg is quiet.
 */
export class Detectors {
  constructor(frame, cfg = GENERIC) {
    this.frame = frame; this.cfg = cfg;
    this.jump = new JumpDetector(cfg.jump);
    this.slide = new SlideDetector(cfg.slide);
    this.step = new StepDetector(cfg.step);
    this.lateral = new LateralDetector(cfg.lateral);
    this.lean = new LeanDetector(cfg.lean);
    this.lastJump = -1e9; this.lastDeep = -1e9; this.last = null; this.lastT = null; this.heldLateral = null; this.restingSince = null;
  }

  /** @param s {t, a:[x,y,z] with gravity, g:[x,y,z] gravity, w:[x,y,z] deg/s} */
  push(s) {
    const f = this.frame;
    const dt = this.lastT == null ? 1 / 60 : Math.min(0.1, (s.t - this.lastT) / 1000);
    this.lastT = s.t;
    const aMag = len(s.a);
    const up = upAccel(f, s.a, s.g);
    const tl = tilt(f, s.g);
    const rt = rates(f, s.w, s.g);
    // a slide holds the leg far from rest; do not let that become the new rest —
    // unless the phone has been resting there, quietly, for seconds: then it has
    // shifted in the pocket and that IS the new rest (a loose pocket lets it)
    if (tl.total < 20) { settle(f, s.g, s.w, dt); this.restingSince = null; }
    else {
      const quiet = len(s.w) < 35 && Math.abs(aMag / G - 1) < 0.12;
      if (!quiet) this.restingSince = null; else if (this.restingSince == null) this.restingSince = s.t;
      if (quiet && s.t - this.restingSince > 2500) settle(f, s.g, s.w, dt, { tau: 0.8 });
    }
    this.last = { t: s.t, aG: aMag / G, wDps: len(s.w), up, total: tl.total, pitch: tl.pitch, roll: tl.roll,
                  yawDps: rt.yaw, rollDps: rt.roll, v: this.jump.v };

    const out = [];
    const j = this.jump.push(s.t, up);
    if (j) { out.push(j); if (j.kind === 'jump') this.lastJump = s.t; }
    const shadow = s.t - this.lastJump < 600;
    // a landing is not a stride and a slide is not a run: those moments do not count, and do not end a run either
    if (j && j.kind === 'jump') this.step.forget(450);   // the crouch and the push-off were not strides either
    const st = this.step.push(s.t, aMag, shadow || this.slide.since != null);

    const violent = aMag / G > this.cfg.slide.calmG || len(s.w) > this.cfg.slide.calmDps;
    const sl = this.slide.push(s.t, tl.total, violent);
    if (sl && !shadow) out.push(sl);
    if (st && !shadow) out.push(st);
    // A squat swings the leg 60-100 degrees and a jump crouches first; both
    // twist the thigh in ways that have nothing to do with going sideways. So
    // the side detectors only listen while the leg is roughly upright and
    // nobody is launching.
    if (tl.total >= this.cfg.lateral.maxTiltDeg) this.lastDeep = s.t;
    // standing up out of a squat twists the leg as it straightens, so the leg
    // has to have been upright for a moment, not merely be upright now
    const upright = s.t - this.lastDeep > this.cfg.lateral.afterDeepMs && Math.abs(this.jump.v) < this.cfg.lateral.maxLaunchV
      && s.t - this.lastJump > this.cfg.lateral.afterJumpMs;
    const lt = this.lateral.push(s.t, upright ? rt.yaw : 0);
    // A squat twists the thigh on the way down, before the tilt gate can see
    // it coming. So a side-step call is held for a moment and thrown away if
    // the leg turns out to be folding — a small price on every real step, but
    // a phantom lane change in the middle of a slide is the worst thing this
    // detector can do.
    if (lt && !shadow && upright) this.heldLateral = { ev: lt, until: s.t + this.cfg.lateral.holdMs };
    if (this.heldLateral) {
      if (tl.total >= this.cfg.lateral.maxTiltDeg || (sl && sl.kind === 'slide')) this.heldLateral = null;
      else if (s.t >= this.heldLateral.until) { out.push(this.heldLateral.ev); this.heldLateral = null; }
    }
    const ln = this.lean.push(s.t, upright ? tl.roll : 0);
    if (ln && !shadow) out.push(ln);
    return out;
  }

  get cadenceHz() { return this.step.cadenceHz; }
  get running() { return this.step.running; }
  get steady() { return this.step.steady; }
  get regularity() { return this.step.regularity; }
}
