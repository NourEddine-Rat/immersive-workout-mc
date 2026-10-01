// Messages between the phone and the Mac.
//
// JSON, not a packed binary format, on purpose: this is a measuring
// instrument, and being able to read the wire in a browser console is worth
// more here than the bytes it costs. Sixty samples a second of ten numbers is
// about 25 kB/s, which a home network does not notice.

export const RATE_HZ = 60;         // what iOS actually delivers
export const BATCH = 1;            // Send each fresh sample immediately; no application batching delay.

/** One sample, packed positionally to keep the JSON small and diffable. */
export const FIELDS = ['t', 'ax', 'ay', 'az', 'gx', 'gy', 'gz', 'wx', 'wy', 'wz'];

export const packSample = s => [
  Math.round(s.t * 10) / 10,
  ...s.a.map(r3), ...s.g.map(r3), ...s.w.map(r2),
];

export const unpackSample = r => ({
  t: r[0], a: [r[1], r[2], r[3]], g: [r[4], r[5], r[6]], w: [r[7], r[8], r[9]],
});

const r3 = v => Math.round(v * 1000) / 1000;
const r2 = v => Math.round(v * 100) / 100;

/**
 * Offset between the two clocks, from the fastest round trip we have seen.
 *
 * Averaging is the wrong tool on Wi-Fi: one packet held up for 40 ms drags the
 * mean with it. A round trip can never be shorter than the true path, so the
 * quickest sample is always the cleanest one.
 */
export class ClockSync {
  constructor(window = 24) { this.window = window; this.samples = []; this.offset = 0; this.rtt = 0; }

  add(t0, t3, phoneT) {
    if(![t0,t3,phoneT].every(Number.isFinite))return;
    const rtt = t3 - t0;
    if (!(rtt >= 0) || rtt > 2000) return;
    this.samples.push({ rtt, offset: phoneT - (t0 + rtt / 2) });
    if (this.samples.length > this.window) this.samples.shift();
    let best = this.samples[0];
    for (const s of this.samples) if (s.rtt < best.rtt) best = s;
    this.offset = best.offset; this.rtt = best.rtt;
  }

  get ready() { return this.samples.length >= 3; }
  toConsole(phoneT) { return phoneT - this.offset; }
  toPhone(consoleT) { return consoleT + this.offset; }
}

/**
 * Was the stream continuous?
 *
 * A phone in a pocket can have Safari swapped out, the screen locked, or the
 * page throttled, and the data simply stops. A recording with a hole in it is
 * not a bad recording — it is a recording of something else — so holes get
 * counted and shown rather than quietly interpolated over.
 */
export function findGaps(samples, expectedHz = RATE_HZ, factor = 4) {
  const maxDt = (1000 / expectedHz) * factor;
  const gaps = [];
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i].t - samples[i - 1].t;
    if (dt > maxDt) gaps.push({ from: samples[i - 1].t, to: samples[i].t, ms: Math.round(dt) });
  }
  return gaps;
}

/** Actual delivered rate, which is never quite what the phone promises. */
export function measuredHz(samples) {
  if (samples.length < 2) return 0;
  const span = (samples[samples.length - 1].t - samples[0].t) / 1000;
  return span > 0 ? (samples.length - 1) / span : 0;
}
