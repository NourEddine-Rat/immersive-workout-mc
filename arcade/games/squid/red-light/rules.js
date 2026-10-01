// Red light, green light: the rules, and nothing else.
//
// The game as the show plays it: the doll faces the tree and sings 무궁화 꽃이
// 피었습니다 ("the hibiscus has bloomed"); while she sings you may move. On
// the last syllable her head swings round and her eyes sweep the field —
// anyone who moves is shot. Then she turns back and sings again. Cross the
// line before the clock runs out; anyone still on the field at zero is shot.
//
// She changes the song every time: slow, quick, slow-then-snapping-shut,
// pausing halfway. That is the whole difficulty, and the player can always
// see it coming — every syllable is on the screen as it is sung.
//
// Pure: no three.js, no DOM. The game reads the state and the events.

export const RULES = {
  limitS: 180,          // the clock (the show gave five minutes to a field twice this long)
  firstSongDelayS: 1.2, // after GO, before the first note
  turnS: 0.55,          // the head swinging round to face the players
  graceS: 0.3,          // eyes open, but not counting yet (the phone's own delay, and fairness)
  scanS: [2.6, 4.4],    // how long she looks (grows a little over the game)
  scanLateS: [3.2, 5.2],
  awayS: 0.6,           // the head swinging back to the tree (you may already move)
};

// seconds per syllable, and the shape of the song
export const TEMPO = {
  normal:  { label: 'normal', per: 0.42 },
  fast:    { label: 'fast', per: 0.22 },
  slow:    { label: 'slow', per: 0.62 },
  trick:   { label: 'trick', per: 0.62, fastFrom: 6, fastPer: 0.16 },   // slow… then the last four snap shut
  stutter: { label: 'stutter', per: 0.4, pauseAfter: 3, pauseS: 1.3 },  // stops dead after 화 — then carries on
};

/** Onset of each of the ten syllables, seconds from the start of the song. The last entry is "다". */
export function schedule(kind) {
  const T = TEMPO[kind] || TEMPO.normal, out = [];
  let t = 0;
  for (let i = 0; i < 10; i++) {
    out.push(t);
    let per = T.per;
    if (T.fastFrom != null && i + 1 >= T.fastFrom) per = T.fastPer;
    t += per;
    if (T.pauseAfter != null && i + 1 === T.pauseAfter) t += T.pauseS;
    // "피었습니다" bunches up a little, as it does when it is sung
    if (kind === 'normal' && i >= 5) t -= 0.05;
  }
  return out;
}

/** A small seeded random, so a round can be replayed in tests. */
export function rng(seed = Date.now()) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

export class Doll {
  constructor(opts = {}) {
    this.R = { ...RULES, ...opts };
    this.rand = opts.rand || Math.random;
    this.reset();
  }
  reset() {
    this.state = 'wait';        // wait → song → turn → scan → away → song …; 'over' when the clock ends
    this.t = 0;                 // time in this state
    this.clock = this.R.limitS; // seconds left
    this.running = false;
    this.round = 0;
    this.song = null;           // { kind, times, dur }
    this.sung = 0;              // syllables sung so far in this song
    this.scanFor = 0;
    this.hold = 0;              // extra scan time requested (shots still being fired)
    this.nextKind = null;       // forced tempo for the next song (the SLOW SONG perk)
    this.events = [];
  }

  start() { this.running = true; this.state = 'away'; this.t = this.R.awayS - this.R.firstSongDelayS; this.events.push({ type: 'start' }); }
  /** Time on the clock (the +10 s gift). */
  addTime(s) { this.clock += s; }
  /** Keep looking a little longer (someone is being shot). */
  extend(s) { this.hold = Math.max(this.hold, s); }

  _pickKind() {
    if (this.nextKind) { const k = this.nextKind; this.nextKind = null; return k; }
    if (this.round <= 2) return 'normal';
    const late = this.R.limitS - this.clock > 70;
    const w = late ? { normal: 0.28, fast: 0.26, slow: 0.12, trick: 0.2, stutter: 0.14 } : { normal: 0.38, fast: 0.22, slow: 0.16, trick: 0.14, stutter: 0.1 };
    let r = this.rand(); for (const k in w) { if ((r -= w[k]) <= 0) return k; } return 'normal';
  }

  /** Advance; returns the events of this step ({type:'song'|'syllable'|'turn'|'scan'|'away'|'timeup'}). */
  update(dt) {
    const ev = this.events; this.events = [];
    if (!this.running) return ev;
    if (this.state === 'over') return ev;
    this.clock = Math.max(0, this.clock - dt);
    if (this.clock <= 0) { this.state = 'over'; this.running = false; ev.push({ type: 'timeup' }); return ev; }
    this.t += dt;
    const R = this.R;
    switch (this.state) {
      case 'away':
        if (this.t >= R.awayS) {
          this.round++;
          const kind = this._pickKind(), times = schedule(kind);
          this.song = { kind, times, dur: times[times.length - 1] + 0.18 };
          this.sung = 0; this.state = 'song'; this.t = 0;
          ev.push({ type: 'song', kind, times, round: this.round });
        }
        break;
      case 'song':
        while (this.sung < 10 && this.t >= this.song.times[this.sung]) { ev.push({ type: 'syllable', i: this.sung }); this.sung++; }
        if (this.t >= this.song.dur) { this.state = 'turn'; this.t = 0; ev.push({ type: 'turn' }); }
        break;
      case 'turn':
        if (this.t >= R.turnS + R.graceS) {
          const late = (R.limitS - this.clock) / R.limitS;
          const [a, b] = late > 0.45 ? R.scanLateS : R.scanS;
          this.scanFor = a + (b - a) * this.rand(); this.hold = 0;
          this.state = 'scan'; this.t = 0; ev.push({ type: 'scan', dur: this.scanFor });
        }
        break;
      case 'scan':
        this.hold = Math.max(0, this.hold - dt);
        if (this.t >= this.scanFor && this.hold <= 0) { this.state = 'away'; this.t = 0; ev.push({ type: 'away' }); }
        break;
    }
    return ev;
  }

  /** 0 = facing the tree, 1 = facing the players — eased, for the head. */
  get head() {
    const e = p => p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    if (this.state === 'turn') return e(Math.min(1, this.t / this.R.turnS));
    if (this.state === 'scan') return 1;
    if (this.state === 'away') return this.round === 0 && !this.song ? 0 : 1 - e(Math.min(1, this.t / this.R.awayS));
    if (this.state === 'over') return 1;
    return 0;
  }
  /** Is she counting movement now? */
  get watching() { return this.state === 'scan' || this.state === 'over'; }
  /** May the players move? (green light, or she is still turning either way) */
  get green() { return this.state === 'song' || this.state === 'away' || (this.state === 'turn' && this.t < this.R.turnS); }
  /** Seconds until her head starts turning (∞ when she is not singing). */
  get untilTurn() { return this.state === 'song' ? Math.max(0, this.song.dur - this.t) : Infinity; }
}
