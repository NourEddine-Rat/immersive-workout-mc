// The look back.
//
// When the dog is gaining and the track ahead is clear, the player turns to
// see it — a real turn, the camera swinging round for a moment — with RUN!
// across the screen. It is a warning you can feel, not a number in the HUD.
//
// It must never cost a run: it only happens when nothing is coming for the
// whole turn (the caller checks the track), collisions are off while the
// head is turned, and it is rationed — never twice within the cooldown, and
// each time only if the dog is closer than it was the last time it made you
// look, so a game that gets harder shows it less, not more.

export const LOOK = {
  gapMax: 10,         // the dog has to be this close (metres) before the first look
  gapStep: 2.5,       // ...and each later look needs it this much closer than the last
  gapMin: 1.8,        // closer than this you do not turn: you sprint
  cooldownS: 16,      // never twice within this
  turnS: 0.38,        // how long the head takes to turn (each way)
  holdS: 1.1,         // how long you look
};

export class LookBack {
  constructor(c = LOOK) { this.c = c; this.reset(); }
  reset() { this.active = false; this.t = 0; this.lastAt = -1e9; this.lastGap = Infinity; this.count = 0; }

  get duration() { return this.c.turnS * 2 + this.c.holdS; }

  /**
   * Ask every frame. Starts a look when it is warranted and safe.
   * @param now        seconds
   * @param gap        metres to the dog
   * @param closing    the dog is gaining right now
   * @param clearAhead nothing in any lane for clearS seconds of track
   */
  maybe(now, gap, closing, clearAhead) {
    if (this.active || !clearAhead || !closing) return false;
    const c = this.c;
    if (gap > c.gapMax || gap < c.gapMin) return false;
    if (now - this.lastAt < c.cooldownS) return false;
    if (gap > this.lastGap - c.gapStep) return false;
    this.active = true; this.t = 0; this.lastAt = now; this.lastGap = gap; this.count++;
    return true;
  }

  /**
   * @returns { active, yaw (0..π), text, alpha (0..1 for the text), phase }
   */
  update(dt) {
    if (!this.active) return { active: false, yaw: 0, alpha: 0, phase: 'none' };
    const c = this.c;
    this.t += dt;
    const T = this.duration;
    let yaw, phase;
    const ease = p => p * p * (3 - 2 * p);
    if (this.t < c.turnS) { yaw = Math.PI * ease(this.t / c.turnS); phase = 'turning'; }
    else if (this.t < c.turnS + c.holdS) { yaw = Math.PI; phase = 'looking'; }
    else if (this.t < T) { yaw = Math.PI * (1 - ease((this.t - c.turnS - c.holdS) / c.turnS)); phase = 'back'; }
    else { this.active = false; return { active: false, yaw: 0, alpha: 0, phase: 'none' }; }
    // the words come as the head arrives and go as it leaves
    const alpha = Math.min(1, Math.max(0, (this.t - c.turnS * 0.6) / 0.25)) * Math.min(1, Math.max(0, (T - this.t) / 0.3));
    return { active: true, yaw, alpha, phase, text: 'RUN!' };
  }
}
