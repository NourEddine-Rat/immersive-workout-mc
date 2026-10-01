// How much room the track gives you between obstacles.
//
// The rule that matters: spacing is measured in SECONDS, never in metres.
// A gap of 20 metres is a comfortable two seconds at walking pace and an
// impossible three quarters of a second at full speed — so a distance-based
// gap quietly turns into an unplayable game exactly when the game gets fast.
//
// The budget a human body needs to answer one obstacle:
//
//   see it and decide      ~0.25 s   (simple visual reaction)
//   camera -> game          ~0.07 s   (measured on this machine)
//   start the move early enough  0.30 s  (a jump has to leave the ground before the bar)
//   land again              0.45 s   (the second half of the jump arc)
//   ------------------------------------
//   about 1.1 s, before any margin at all.

import { JUMP_T } from './player.js';

export const PACE = {
  easy: 2.30,          // seconds between rows at the start
  hard: 1.45,          // ...and at full difficulty
  floor: 1.30,         // never less than this, whatever else is going on
  afterVertical: 0.55, // a jump or a roll has to finish before the next thing
  afterCross: 0.45,    // when the safe lane moves right across the track
  jitter: 0.35,        // a little variety so it doesn't feel metronomic
};

const lerp = (a, b, t) => a + (b - a) * Math.min(1, Math.max(0, t));

/**
 * Seconds of clear track after a row.
 * @param difficulty 0..1
 * @param kinds      what the row contained ('low' | 'high' | 'train')
 * @param crossed    true when the safe lanes share nothing with the row before
 * @param r          0..1 from the level's own random source
 */
export function rowGapSeconds(difficulty, kinds = [], crossed = false, r = 0) {
  let s = lerp(PACE.easy, PACE.hard, difficulty);
  if (kinds.some(k => k === 'low' || k === 'high')) s += PACE.afterVertical;
  if (crossed) s += PACE.afterCross;
  s += r * PACE.jitter;
  return Math.max(PACE.floor + (kinds.some(k => k === 'low' || k === 'high') ? JUMP_T * 0.5 : 0), s);
}

/** The same gap as a distance, for the speed the player is doing now. */
export function rowGapUnits(speed, difficulty, kinds, crossed, r) {
  return Math.max(6, speed) * rowGapSeconds(difficulty, kinds, crossed, r);
}

/**
 * How long the player has to answer an obstacle, given where it is.
 * Used by the recorder so "it came too fast" becomes a number.
 */
export function reactionWindow(distance, speed) { return distance / Math.max(1, speed); }
