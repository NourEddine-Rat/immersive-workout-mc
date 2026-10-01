// Calories, as honestly as a phone in a pocket allows.
//
// No heart rate, no oxygen: what the phone knows is the cadence of your
// footfalls and every jump and squat it hears. So the burn is the standard
// one — METs (the Compendium of Physical Activities, the same table every
// tracker and gym machine uses) for what the legs are doing, times body
// weight — plus the extra each jump and squat costs. Weight matters, so the
// player can set theirs; without it, 70 kg.
//
//   kcal per minute = MET × 3.5 × kg / 200
//
// METs for the cadence bands the detector reads (running in place burns
// about what running at that cadence burns: the legs do the same work,
// the ground just does not move):
//   still, standing between rows           1.3   (Compendium 07021 standing quietly = 1.3)
//   slow steps, ≤ 2.0 Hz                   4.0   (07030 walking in place… ~3.5–4.5)
//   jogging, 2.7 Hz                        8.0   (12025 jogging in place = 8.0)
//   running hard, 3.3 Hz                  11.5   (12070 running 8 mph = 11.8)
// A jump: lifting the body ~0.35 m and landing it, at the ~25 % the muscles
// manage, is m·g·h / 0.25 ≈ 0.0033 kcal per kg — 0.23 kcal for 70 kg. A
// squat: the gym figure of ~32 kcal per 100 for 70 kg, 0.0045 kcal per kg.

export const KCAL = {
  defaultKg: 70,
  stillMet: 1.3, slowMet: 4.0, jogMet: 8.0, fastMet: 11.5,
  slowHz: 2.0, jogHz: 2.7, fastHz: 3.3,      // the same bands as runspeed.js
  jumpPerKg: 0.0033, squatPerKg: 0.0045,
  // the fire: milestones the run marks, in kcal — close together at first
  // (the first flame comes quickly, that is the point of it), then wider
  milestones: [5, 10, 20, 35, 50, 75, 100, 150, 200, 300, 400, 500],
  milestoneStep: 100,                        // ...and every this much after the last one
};

const lerp = (a, b, t) => a + (b - a) * Math.min(1, Math.max(0, t));

/** METs for a cadence (0 = still). */
export function metFor(cadenceHz, c = KCAL) {
  if (!(cadenceHz > 0)) return c.stillMet;
  if (cadenceHz <= c.slowHz) return c.slowMet;
  if (cadenceHz <= c.jogHz) return lerp(c.slowMet, c.jogMet, (cadenceHz - c.slowHz) / (c.jogHz - c.slowHz));
  return lerp(c.jogMet, c.fastMet, (cadenceHz - c.jogHz) / (c.fastHz - c.jogHz));
}

/** kcal burned in `dt` seconds at this cadence, for this body. */
export function kcalFor(cadenceHz, dt, kg, c = KCAL) { return metFor(cadenceHz, c) * 3.5 * kg / 200 * dt / 60; }

/** The next milestone after `kcal`. */
export function nextMilestone(kcal, c = KCAL) {
  for (const m of c.milestones) if (m > kcal) return m;
  const last = c.milestones[c.milestones.length - 1];
  return last + c.milestoneStep * (Math.floor((kcal - last) / c.milestoneStep) + 1);
}

export class Calories {
  constructor(kg = KCAL.defaultKg, c = KCAL) { this.c = c; this.kg = kg; this.reset(); }
  reset() { this.kcal = 0; this.active = 0; this.jumps = 0; this.squats = 0; this.seconds = 0; this.claimed = 0; }
  /** A frame of the run: what the legs are doing. */
  step(dt, cadenceHz) {
    const all = kcalFor(cadenceHz, dt, this.kg, this.c);
    this.kcal += all;
    this.active += all - kcalFor(0, dt, this.kg, this.c);   // over and above standing there
    this.seconds += dt;
  }
  jump() { this.jumps++; const k = this.c.jumpPerKg * this.kg; this.kcal += k; this.active += k; }
  squat() { this.squats++; const k = this.c.squatPerKg * this.kg; this.kcal += k; this.active += k; }
  /** The milestone that has been reached but not yet marked with a flame, or 0. */
  get due() { const m = nextMilestone(this.claimed, this.c); return this.kcal >= m ? m : 0; }
  /** The flame for `m` kcal has been taken. */
  claim(m) { this.claimed = m; }
}

/**
 * What to say when a flame is taken: the number made real (what it is in
 * food, roughly — the Compendium's cousins, the nutrition labels) and a
 * word of encouragement. `pick` is 0..1, for variety.
 */
export function praise(kcal, pick = 0) {
  const food = kcal >= 500 ? 'a whole meal' : kcal >= 400 ? 'a burger' : kcal >= 300 ? 'a plate of rice' : kcal >= 200 ? 'a chocolate bar'
    : kcal >= 150 ? 'a can of soda' : kcal >= 100 ? 'a slice of bread' : kcal >= 75 ? 'a banana' : kcal >= 50 ? 'half a banana'
    : kcal >= 35 ? 'a biscuit' : kcal >= 20 ? 'a bite of bread' : kcal >= 10 ? 'a sugar cube' : 'the first spark';
  const cheer = [
    'Keep it burning!', 'Your legs are on fire!', 'Nothing stops you!', 'That is real work!', 'Unstoppable!',
    'Every step counts!', 'Feel that? That is progress!', 'Stronger every metre!', 'The dog cannot keep up with you!', 'Beast mode!',
  ];
  const ar = [
    'استمر!', 'رجولك نار!', 'ما شي يوقفك!', 'هذا شغل حقيقي!', 'ما تنهزم!',
    'كل خطوة تفرق!', 'حاسس؟ هذا تقدم!', 'أقوى مع كل متر!', 'الكلب ما يلحقك!', 'وحش!',
  ];
  const i = Math.min(cheer.length - 1, Math.floor(pick * cheer.length));
  return { title: `${kcal} KCAL`, text: kcal < 10 ? 'The first spark — the engine is warm.' : `That is ${food} burned off.`, cheer: cheer[i], ar: ar[i] };
}
