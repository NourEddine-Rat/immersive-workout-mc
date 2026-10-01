// Track & Field: the track, the lanes, the race. Pure — no three.js, no DOM.
//
// Measured on the model's own painted lines (the texture, mapped back to
// metres through the sheet's UVs):
//   bends          centres X −42.73 and +42.27, Z −4.65; inner kerb radius 36.49 m (standard: 36.5)
//   straights      85.0 m (standard 84.39)
//   lanes          8, 1.385 m wide
//   home straight  the +Z side, running toward +X; finish line painted at X = 39.45
// Runners go anticlockwise, left hand to the infield, as in every stadium.

export const TRACK = {
  xL: -42.73, xR: 42.27, zc: -4.65,
  r0: 36.49, laneW: 1.385, lanes: 8,
  finishX: 39.45,
};

export const RACE = {
  laps: 3,                       // the default race (1–4 on the start card)
  lane: 4,                       // yours
  rivals: [2, 3, 5, 6, 7],
  first: 45, spacing: 35,        // hurdles as in the 400 m hurdles: the first 45 m from each lane's start, then every 35 m, all the way round, every lap
  clearEnd: 40,                  // none in the last 40 m
  height: 0.914,
};

// The runner's speed round the track from the legs (running in place is not running — this is the game's scale):
// a walk carries you 2.4 m/s, a jog 5, running hard 7.5 → one lap in about 55–85 s.
export const SPEED = { walk: 2.4, jog: 5.0, fast: 7.5, flat: 8.6, tauUp: 0.45, tauDown: 0.35 };   // flat: legs faster than your own 'fast' carry you on to 8.6

/** The race: `laps` laps of your lane, run by everyone in their own lane (the stagger falls out of the geometry). */
export const raceMetres = (laps, k = RACE.lane) => laps * lapLen(k);
/** Where the hurdles stand in lane k: race distances within the first lap (they are met again every lap). */
export function hurdleSpots(k) { const L = lapLen(k), out = []; for (let d = RACE.first; d < L - 5; d += RACE.spacing) out.push(d); return out; }

/** Radius of the line run in lane `k` (1…8): the middle of the lane. */
export const laneR = (k, T = TRACK) => T.r0 + (k - 0.5) * T.laneW;
/** One lap of lane k. */
export const lapLen = (k, T = TRACK) => 2 * (T.xR - T.xL) + 2 * Math.PI * laneR(k, T);

/**
 * A point on lane k, `s` metres along it from the start of the home straight
 * (s = 0 at X = xL on the +Z side). Returns { x, z, dx, dz } — position and
 * the unit direction of running.
 */
export function lanePoint(k, s, T = TRACK) { return ovalPoint(laneR(k, T), s, T); }
/** The same, for any radius (the painted lines between lanes). */
export function ovalPoint(R, s, T = TRACK) {
  const S = T.xR - T.xL, C = Math.PI * R, L = 2 * S + 2 * C;
  s = ((s % L) + L) % L;
  if (s < S) return { x: T.xL + s, z: T.zc + R, dx: 1, dz: 0 };                       // home straight → +X
  s -= S;
  if (s < C) { const a = s / R; return { x: T.xR + R * Math.sin(a), z: T.zc + R * Math.cos(a), dx: Math.cos(a), dz: -Math.sin(a) }; }   // far bend
  s -= C;
  if (s < S) return { x: T.xR - s, z: T.zc - R, dx: -1, dz: 0 };                       // back straight → −X
  s -= S;
  const a = s / R; return { x: T.xL - R * Math.sin(a), z: T.zc - R * Math.cos(a), dx: -Math.cos(a), dz: Math.sin(a) };                // near bend
}

/** Where the finish line is, as s along lane k. */
export const finishS = (k, T = TRACK) => T.finishX - T.xL;
/** Where a race of `m` metres starts in lane k: m metres back along its own lane — the stagger falls out of the geometry. */
export const startS = (k, m = raceMetres(RACE.laps), T = TRACK) => finishS(k, T) - m;
/** s along lane k after running `d` metres of the race. */
export const raceS = (k, d, m = raceMetres(RACE.laps), T = TRACK) => startS(k, m, T) + d;
