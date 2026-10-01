// First-person runner: you are the camera. Lane, jump and roll are the only
// three things a body can do here, which is the whole point.
//
// Feel notes: a lane change is a fixed-time slide (no easing tail, no
// banking); a jump is a gravity parabola with a landing compression; a roll
// is a slide — drop fast, stay low, keep looking forward, rise smoothly.

import { LANE_X } from './lanes.js';

export const EYE = 1.55;          // standing eye height
export const JUMP_T = 0.75, JUMP_H = 1.9;
export const ROLL_T = 1.05, ROLL_EYE = 0.55;   // a long, forgiving low phase: an early slide still counts
const LANE_T = 0.20;              // seconds for a lane change
const LAND_T = 0.22, LAND_DIP = 0.11;
const FALL_G = 40, FALL_V0 = 3;   // dropping off a roof: a hop down, not a float — off the edge and on the rails in a third of a second

const smooth = p => p * p * (3 - 2 * p);
const easeOut = p => 1 - (1 - p) * (1 - p) * (1 - p);

export class Player {
  constructor() { this.reset(); }

  reset() {
    this.lane = 1;
    this.x = 0;
    this.slide = null;              // { from, to, t0 }
    this.distance = 0;
    this.speed = 0;
    this.jumpT = -1;                // time into the jump, -1 when grounded
    this.rollT = -1;
    this.bufferedVertical = null;   // 'roll' asked for mid-air, executed on landing
    this.scheduled = null;          // { kind, at } — a move held back by the timing assist
    this.landedAt = -Infinity;
    this.t = 0;
    /** Purely visual sub-lane offset: every centimetre you move shows, before any lane commits. */
    this.microX = 0;
    /** On a train roof: { o, y, front, end, rampLen } in distance units; null on the ground. */
    this.roof = null;
    /** Dropping off a roof: { y0, t } */
    this.fall = null;
  }

  get riding() { return this.roof != null; }
  /** The obstacle collisions must ignore: the roof under you, or the one you stepped off a moment ago. */
  get shield() { return this.roof ? this.roof.o : (this.left && this.t - this.left.t < 0.9 ? this.left.o : null); }

  /** Run up the ramp of `o` (an obstacle with .top, .z1 front, .z0 end) onto its roof. */
  board(o, rampLen) {
    this.roof = { o, y: o.top, front: -o.z1, end: -o.z0, rampLen };
    this.fall = null;
    if (this.airborne) { this.jumpT = -1; this.landedAt = this.t; }   // the jump that took you up the ramp is over
  }

  /** Already on a roof: step across to the roof of `o` in the next lane (its height must match). */
  hopTo(o, lane) {
    this.setLane(lane);
    this.roof = { o, y: o.top, front: this.distance - 10, end: -o.z0, rampLen: 1 };   // front behind us: level roof, no ramp
  }

  /** Where the ground is under the feet right now: the rails, the ramp, the roof, or mid-fall. */
  get baseY() {
    if (this.roof) {
      const p = (this.distance - this.roof.front) / this.roof.rampLen;
      return this.roof.y * Math.max(0, Math.min(1, p));
    }
    if (this.fall) return Math.max(0, this.fall.y0 - FALL_V0 * this.fall.t - 0.5 * FALL_G * this.fall.t * this.fall.t);
    return 0;
  }

  get airborne() { return this.jumpT >= 0; }
  get rolling() { return this.rollT >= 0; }

  /** Feet height above ground: a parabola, fast off the ground and slow at the top. */
  get feetY() {
    if (!this.airborne) return this.baseY;
    const p = Math.min(1, this.jumpT / JUMP_T);
    return this.baseY + 4 * JUMP_H * p * (1 - p);
  }
  /** Head height above ground. */
  get headY() { return this.rolling ? this._rollEye() + 0.15 : this.feetY + EYE + 0.1; }

  moveLane(dir) { return this.setLane(this.lane + dir); }

  /** Absolute lane, which is how the body drives it: your zone IS the lane. */
  setLane(n) {
    const next = Math.max(0, Math.min(2, n));
    if (next === this.lane) return false;
    this.lane = next;
    this.slide = { from: this.x, to: LANE_X[next], t0: this.t };
    return true;
  }

  /**
   * @param lead seconds the body is already into the move when the game
   *             hears of it (detection + link latency): the animation starts
   *             that far in, so the screen catches up with the legs
   */
  jump(lead = 0) {
    if (this.airborne) return false;
    if (this.rolling) this.rollT = -1;               // a hop cancels a roll
    this.jumpT = Math.max(0, Math.min(JUMP_T * 0.35, lead || 0));
    return true;
  }

  roll(lead = 0) {
    if (this.rolling) return false;
    if (this.airborne) { this.bufferedVertical = 'roll'; return true; }   // slam: roll on landing
    this.rollT = Math.max(0, Math.min(ROLL_T * 0.2, lead || 0));
    return true;
  }

  /** Hold a jump/roll and release it in `inS` seconds (timing assist). */
  schedule(kind, inS) { this.scheduled = { kind, at: this.t + Math.max(0, inS) }; }

  update(dt, speed) {
    this.t += dt;
    this.speed = speed;
    this.distance += speed * dt;
    if (this.scheduled && this.t >= this.scheduled.at) {
      const k = this.scheduled.kind; this.scheduled = null;
      if (k === 'jump') this.jump(); else this.roll();
    }

    // lane slide: ease-in-out over a fixed time, retargeted if interrupted
    if (this.slide) {
      const p = Math.min(1, (this.t - this.slide.t0) / LANE_T);
      this.x = this.slide.from + (this.slide.to - this.slide.from) * smooth(p);
      if (p >= 1) { this.x = this.slide.to; this.slide = null; }
    }

    if (this.airborne) {
      this.jumpT += dt;
      if (this.jumpT >= JUMP_T) {
        this.jumpT = -1; this.landedAt = this.t;
        if (this.bufferedVertical === 'roll') this.rollT = 0;
        this.bufferedVertical = null;
      }
    }
    if (this.rolling) {
      this.rollT += dt;
      if (this.rollT >= ROLL_T) this.rollT = -1;
    }
    // the roof ends: step off and drop (and the train you just left cannot hit you while you drop past its tail)
    if (this.roof && this.distance > this.roof.end - 0.6) { this.left = { o: this.roof.o, t: this.t }; this.fall = { y0: this.roof.y, t: 0 }; this.roof = null; }
    if (this.fall) {
      this.fall.t += dt;
      if (this.baseY <= 0) { this.fall = null; this.landedAt = this.t; }
    }
  }

  _rollEye() {
    const p = this.rollT / ROLL_T;
    if (p < 0.13) return EYE - (EYE - ROLL_EYE) * easeOut(p / 0.13);           // drop
    if (p < 0.76) return ROLL_EYE;                                              // slide
    return ROLL_EYE + (EYE - ROLL_EYE) * smooth((p - 0.76) / 0.24);            // get up
  }

  /** Camera pose for this frame. */
  cameraPose() {
    let y = EYE + this.feetY;
    let pitch = 0, roll = 0, fovKick = 0;
    if (this.rolling) {
      const p = this.rollT / ROLL_T;
      y = this._rollEye();
      const low = 1 - (y - ROLL_EYE) / (EYE - ROLL_EYE);
      pitch = 0.05 * low;                    // chin slightly up, eyes on the track
      roll = 0.035 * Math.sin(Math.PI * p);  // a hint of body tilt while sliding
      fovKick = 5 * low;
    } else if (this.airborne) {
      const p = this.jumpT / JUMP_T;
      fovKick = 4 * Math.sin(Math.PI * p);
    } else {
      // landing compression, then a light running bob
      const since = this.t - this.landedAt;
      if (since < LAND_T) y -= LAND_DIP * Math.sin(Math.PI * since / LAND_T);
      else y += Math.sin(this.t * 2 * Math.PI * (2.4 + this.speed * 0.04)) * 0.022 * Math.min(1, this.speed / 10);
    }
    if (this.roof) pitch -= 0.11;            // on a roof the eyes drop a little: you see the train you are running on
    return { x: this.x + this.microX, y, pitch, roll, fovKick };
  }

  /** Seconds since the last landing, for the post-landing assist window. */
  sinceLanding() { return this.t - this.landedAt; }
}
