// Running makes the game move, and a dog keeps you honest.
//
// In run mode the game's speed is your legs: jog at a normal pace and you
// run at the level's pace; run faster and you gain; slow down and a dog that
// runs at the level's pace closes the gap. "Help a bit" is built in: a normal
// jog already keeps up, the dog is capped at a fair closing speed, and a
// short pause is forgiven before the speed really drops. Auto mode is the old
// game: speed by level, and the dog just runs behind for company.

export const RUN = {
  base: 11, perLevel: 0.6, max: 16,   // the level's pace (the dog's pace too): the level nudges, your legs decide
  // cadence bands from the running literature: walking 100–125 steps/min,
  // easy running 155–170, fast running 180–200
  jogHz: 2.7,        // this cadence keeps you at the level's pace (162 steps/min)
  slowHz: 2.0,       // at or below this you are walking: 60 % of pace
  fastHz: 3.3,       // at this you are at the bonus (198 steps/min)
  bonus: 1.2,        // the most your legs can add over the level's pace (a slide is heard ~0.25 s late; faster than this and signals cannot be answered)
  stopFrac: 0.3,     // not running at all: 30 % of pace (you never freeze)
  graceS: 0.5,       // seconds of no steps before that kicks in (the detector already waits a stride and a half)
  tauUp: 0.9,        // how fast speed follows your legs (up: gently, so nothing lurches)
  tauDown: 1.1,
  dogStartGap: 18,   // metres behind you at the start
  dogMaxGap: 32,     // it never falls further behind than this
  dogHold: 0.75,     // the dog keeps its distance while your legs give at least this much of the pace
  dogCloseMax: 2.6,  // closing speed when you have stopped outright, m/s: ~8 s from the start gap
  dogOpenMax: 4.0,   // how fast a sprint leaves it behind
  caughtGap: 0.7,
  warnGap: 6,        // it barks from here
};

export const paceFor = (level, c = RUN) => Math.min(c.max, c.base + (level - 1) * c.perLevel);

// The distance on the screen is the runner's, not the game's: the game does
// 11–19 m/s, no legs do. Each footfall the phone hears is worth a step's
// length — a stride grows with cadence (a walk is short steps, a sprint long
// ones), so a walk at 2 Hz covers ~1.3 m/s and a fast run at 3.3 Hz ~4.3 m/s,
// which is about what those cadences mean on a real road.
export const STEP = { slowM: 0.65, fastM: 1.3 };
/** Metres one step covers at this cadence. */
export function stepLength(cadenceHz, c = RUN, s = STEP) {
  const k = Math.min(1, Math.max(0, (cadenceHz - c.slowHz) / (c.fastHz - c.slowHz)));
  return s.slowM + (s.fastM - s.slowM) * k;
}
/** Metres run in `dt` seconds at this cadence (nothing when the legs are still). */
export function metresRun(cadenceHz, dt) { return cadenceHz > 0 ? cadenceHz * stepLength(cadenceHz) * dt : 0; }

/** What your legs are asking for, as a fraction of the level's pace. */
export function legsFactor(cadenceHz, c = RUN) {
  if (!(cadenceHz > 0)) return c.stopFrac;
  if (cadenceHz <= c.slowHz) return 0.6;
  if (cadenceHz <= c.jogHz) return 0.6 + 0.4 * (cadenceHz - c.slowHz) / (c.jogHz - c.slowHz);
  return 1 + (c.bonus - 1) * Math.min(1, (cadenceHz - c.jogHz) / (c.fastHz - c.jogHz));
}

export class RunState {
  constructor(c = RUN) { this.c = c; this.reset(); }
  reset() { this.speed = 0; this.gap = this.c.dogStartGap; this.sinceStep = 0; this.caught = false; this.factor = 1; }

  /**
   * @param dt        seconds
   * @param level
   * @param mode      'run' | 'auto'
   * @param cadenceHz the body's cadence right now (0 = not running)
   * @param steady    several strides agree (false: a run just starting, or broken by a jump)
   * @param holding   the player is mid-jump or has just landed: no cadence is expected right now
   */
  step(dt, level, mode, cadenceHz, steady = true, holding = false) {
    const c = this.c, pace = paceFor(level, c);
    let target = pace;
    if (mode === 'run') {
      // a jump is not a stop: while the game knows you are in the air or just landed, the legs' silence is forgiven
      this.sinceStep = cadenceHz > 0 || holding ? 0 : this.sinceStep + dt;
      // a run that has only just started (three quick footfalls) keeps the pace; the bonus needs a steady rhythm
      const f = cadenceHz > 0 ? Math.min(legsFactor(cadenceHz, c), steady ? c.bonus : 1) : (this.sinceStep < c.graceS ? this.factor : c.stopFrac);
      this.factor = f;
      target = pace * f;
    }
    const tau = target > this.speed ? c.tauUp : c.tauDown;
    this.speed += (target - this.speed) * (1 - Math.exp(-dt / tau));
    // The dog is pressure, not a stopwatch: a real stop gets you caught in
    // seconds, a lazy jog is a slow squeeze you can feel coming, and anything
    // above `dogHold` keeps it exactly where it is. Squared so the bite is at
    // the stop, not at the first slow stride.
    if (mode === 'run') {
      const f = this.factor;
      const rel = f >= c.dogHold
        ? c.dogOpenMax * Math.min(1, (f - c.dogHold) / (c.bonus - c.dogHold))
        : -c.dogCloseMax * Math.pow((c.dogHold - f) / (c.dogHold - c.stopFrac), 2);
      this.gap = Math.min(c.dogMaxGap, this.gap + rel * dt);
      if (this.gap <= c.caughtGap) this.caught = true;
    } else this.gap = Math.min(c.dogMaxGap, this.gap + 0.5 * dt);
    return { speed: this.speed, gap: this.gap, pace, factor: this.factor, caught: this.caught, warn: mode === 'run' && this.gap < c.warnGap };
  }
}
