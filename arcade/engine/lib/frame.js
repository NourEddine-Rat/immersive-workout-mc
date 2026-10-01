// Turning "a phone somewhere in a pocket" into three named directions.
//
// A phone in a pocket knows exactly one thing about the world for free:
// which way is DOWN, because gravity never stops pulling and never drifts.
// Everything else has to be earned. This module earns two more directions:
//
//   down   from standing still for a moment          (exact, always available)
//   lat    from a deep squat — the axis the thigh    (the sideways line)
//          swings about is the hip's own hinge
//   fore   = lat x down                              (facing, by construction)
//
// The first recording taught two things this file now encodes. Jogging in
// place has no direction, so the long axis of its acceleration is a circle
// and useless; but a squat is a clean 90-degree hinge and its axis came out
// consistent to 13 degrees across twelve reps. And a phone does not stay put:
// after a few jumps the resting angle sat 17 degrees off the original still
// baseline, so `down` has to keep re-settling whenever the leg is quiet.

import { unit, cross, dot, len, reject, angle, horizontalBasis, pca2 } from './vec.js';

const DEG = 180 / Math.PI;

/** What standing still tells us: `down`, and how still "still" really was. */
export function baselineFrom(gravitySamples) {
  let s = [0, 0, 0];
  for (const g of gravitySamples) s = [s[0] + g[0], s[1] + g[1], s[2] + g[2]];
  const n = Math.max(1, gravitySamples.length);
  const mean = [s[0] / n, s[1] / n, s[2] / n];
  let wob = 0;
  for (const g of gravitySamples) wob = Math.max(wob, angle(g, mean));
  return { down: unit(mean), g: len(mean), samples: n, wobbleDeg: wob };
}

/**
 * The sideways axis, from squats.
 *
 * Each squat swings gravity (in the phone's frame) from `down` to somewhere
 * far from it; the axis of that swing is the hip hinge, which is the body's
 * left-right line. Given several squats, take each one's axis at its deepest
 * point and average. `spreadDeg` says how well they agreed.
 */
export function latFromSquats(down, squats, { minTiltDeg = 40, prior = [] } = {}) {
  const axes = [...prior];
  for (const w of squats) {
    let best = null, bt = 0;
    for (const g of w) { const t = angle(down, g); if (t > bt) { bt = t; best = g; } }
    if (best && bt >= minTiltDeg) axes.push(unit(cross(down, unit(best))));
  }
  if (!axes.length) return { lat: null, ok: false, n: 0, spreadDeg: null };
  // axes can come out pointing either way; fold them onto the first
  const ref = axes[0];
  let m = [0, 0, 0];
  for (const a of axes) { const s = dot(a, ref) < 0 ? -1 : 1; m = [m[0] + a[0] * s, m[1] + a[1] * s, m[2] + a[2] * s]; }
  const lat = unit(reject(unit(m), down));
  const spread = Math.max(...axes.map(a => Math.min(angle(a, lat), angle(a, lat.map(v => -v)))));
  // the folded axes, so a caller can keep refining with the next swing
  const folded = axes.map(a => dot(a, ref) < 0 ? a.map(v => -v) : a);
  return { lat, ok: spread < 25 && axes.length >= 1, n: axes.length, spreadDeg: spread, axes: folded };
}

/**
 * The fore-aft direction from a jog's horizontal acceleration. Kept as a
 * fallback only: on the real recording it came out 1.27:1, which is not a
 * direction, it is a circle.
 */
export function foreFrom(down, accelSamples, { minRatio = 1.6 } = {}) {
  const [e1, e2] = horizontalBasis(down);
  const pts = accelSamples.map(a => { const h = reject(a, down); return [dot(h, e1), dot(h, e2)]; });
  const { axis, ratio, n } = pca2(pts);
  const fore = unit([e1[0] * axis[0] + e2[0] * axis[1], e1[1] * axis[0] + e2[1] * axis[1], e1[2] * axis[0] + e2[2] * axis[1]]);
  return { fore, ratio, n, ok: ratio >= minRatio && n >= 60 };
}

/**
 * The full frame. `lat` may be null, in which case any horizontal line is
 * used and pitch/roll lose their meaning — total tilt and vertical velocity,
 * which carry the jump and the slide, do not depend on it at all.
 *
 */
export function makeFrame(baseline, lat = null) {
  const down = baseline.down;
  const l = lat ? unit(reject(lat, down)) : unit(reject(Math.abs(down[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], down));
  const fore = unit(cross(l, down));
  return { down, down0: down, lat: l, fore, g: baseline.g, hasLat: !!lat };
}

/**
 * Let `down` follow the phone as it shifts in the pocket.
 *
 * Only while the leg is quiet — no rotation to speak of, gravity about 1 g —
 * and slowly, a couple of seconds' time constant, so a held squat or lean is
 * never mistaken for a new resting position. `down0` keeps the original for
 * reference.
 */
export function settle(frame, g, w, dt, { tau = 2.5, quietDps = 35, quietG = 0.08 } = {}) {
  const quiet = len(w) < quietDps && Math.abs(len(g) / 9.80665 - 1) < quietG * 3;
  if (!quiet) return false;
  const k = 1 - Math.exp(-dt / tau);
  const gu = unit(g);
  frame.down = unit([frame.down[0] + (gu[0] - frame.down[0]) * k, frame.down[1] + (gu[1] - frame.down[1]) * k, frame.down[2] + (gu[2] - frame.down[2]) * k]);
  frame.lat = unit(reject(frame.lat, frame.down));
  frame.fore = unit(cross(frame.lat, frame.down));
  return true;
}

/**
 * How the leg is tilted right now, split into the two ways a leg can tilt.
 *
 * Gravity in the phone's frame has moved from `down` to `downNow`; the cross
 * product of those two is the axis the leg turned about. Resolving that axis
 * onto the two horizontal directions separates the motions with no
 * integration and so no drift:
 *
 *   about `lat`  = the thigh swinging forward or back  — a squat, or a stride
 *   about `fore` = the thigh swinging out or in        — a lean, or a side-step
 *
 * `total` needs no axes at all, and is what the slide detector uses.
 */
export function tilt(frame, downNow) {
  const d = unit(downNow);
  const axis = cross(frame.down, d);
  const s = Math.max(-1, Math.min(1, len(axis)));
  const total = Math.atan2(s, dot(frame.down, d)) * DEG;
  const a = unit(axis);
  return { total, pitch: dot(a, frame.lat) * total, roll: dot(a, frame.fore) * total };
}

/** Turn rate resolved the same way, degrees per second. `yaw` is about the
 *  CURRENT gravity, so a tilted leg still measures turning about vertical. */
export function rates(frame, w, gNow = null) {
  return {
    pitch: dot(w, frame.lat),
    roll: dot(w, frame.fore),
    yaw: dot(w, gNow ? unit(gNow) : frame.down),
    total: len(w),
  };
}

/**
 * Acceleration straight up, m/s^2, gravity removed.
 *
 * The wire carries the WebKit convention throughout (the phone mirrors
 * anything else to match): `a` is gravity minus the body's own acceleration,
 * `g` is gravity, both pointing down at rest. So the body's acceleration is
 * g - a, and "up" is the opposite of g.
 */
export function upAccel(frame, a, g) {
  const up = unit(g).map(v => -v);
  return dot([g[0] - a[0], g[1] - a[1], g[2] - a[2]], up);
}
