// The game changes lanes itself.
//
// The body reads jump, slide and running perfectly and left/right poorly, so
// the game keeps the three and takes lanes over. The rule is the one a good
// player follows: a train in your lane is dodged to the nearest clear lane
// about a second before it arrives; barriers are never dodged, they are the
// player's to jump or slide. It must look decided, not lucky — so a dodge is
// made once, early enough to read as a dodge, and to a lane that stays
// survivable for as long as this train lasts.

const DODGE_AT_S = 1.5;       // seconds before the train when the dodge happens: early enough to still jump a barrier in the new lane
const TOO_LATE_S = 0.35;      // closer than this, a two-lane dodge is not attempted
const NEAR_S = 1.1;           // a barrier closer than this in the lane we move into cannot be answered in time (a slide is heard ~0.25 s late)
const MARGIN = 6;
/** A train is anything you cannot jump or slide: a closed car, or a ramp car you have not chosen to ride. */
const isTrain = o => o.kind === 'train' || o.kind === 'ramp';             // a lane counts as clear if nothing blocks it this far past the train's front

/**
 * @param ahead  per lane: null, or the nearest obstacle { kind, dist } (metres ahead)
 * @param lane   the lane we are in
 * @param speed  metres per second
 * @param coins  optional: per lane, coins ahead (a tie-breaker, never a reason to leave a clear lane)
 * @returns { to, why } or null
 */
export function chooseLane(ahead, lane, speed, coins = [0, 0, 0]) {
  const h = ahead[lane];
  if (!h || !isTrain(h)) return null;
  // time, not distance: a train coming the other way arrives sooner than its distance says
  const tt = o => o.timeTo != null ? o.timeTo : o.dist / Math.max(1, speed);
  const timeTo = tt(h);
  if (timeTo > DODGE_AT_S) return null;
  const clear = l => { const o = ahead[l]; return !o || !isTrain(o) || tt(o) > timeTo + MARGIN / Math.max(1, speed); };
  // A barrier in the lane we would move into needs answering: closer than
  // NEAR_S it cannot be, by a body whose slide is heard late. If it will have
  // gone by while there is still time to dodge, we wait for that; if not,
  // that lane is a bad choice, though better than the train.
  const judge = l => {
    const o = ahead[l];
    let s = (o ? (isTrain(o) ? -10 : -1) : 0) + Math.min(5, coins[l] || 0) * 0.1;   // empty beats a barrier beats a train; coins only ever settle a tie
    let wait = false;
    if (o && !isTrain(o)) {
      const tb = tt(o), gone = tb + (o.len || 2) / Math.max(1, speed) + 0.1;
      if (tb < NEAR_S) { if (timeTo - gone > TOO_LATE_S) wait = true; else s -= 6; }
    }
    return { s, wait };
  };
  const options = [];
  for (const d of [-1, 1]) {
    const l1 = lane + d, l2 = lane + 2 * d;
    if (l1 >= 0 && l1 <= 2 && clear(l1)) { const j = judge(l1); options.push({ to: l1, s: j.s + 1, wait: j.wait }); }   // adjacent: cheaper
    else if (l2 >= 0 && l2 <= 2 && clear(l2) && timeTo > TOO_LATE_S) { const j = judge(l2); options.push({ to: l2, s: j.s, wait: j.wait }); }
  }
  if (!options.length) return null;
  const now = options.filter(o => !o.wait);
  if (!now.length) return null;                       // every way in has a barrier right there that will have passed: wait a moment
  now.sort((a, b) => b.s - a.s);
  return { to: now[0].to, why: 'train', timeTo };
}
