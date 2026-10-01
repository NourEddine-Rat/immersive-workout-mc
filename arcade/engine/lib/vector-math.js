// Three-vectors, in the phone's own frame.
//
// Everything in this folder lives in the phone's axes: +x across the screen,
// +y up the screen, +z out of the glass. We never try to express anything in
// room coordinates, because the room is exactly what an accelerometer cannot
// see. All the geometry here is about finding a few useful directions *within*
// the phone's own frame and keeping them.

export const add   = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub   = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot   = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len   = a => Math.hypot(a[0], a[1], a[2]);

export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export function unit(a) {
  const n = len(a);
  return n < 1e-9 ? [0, 0, 0] : [a[0] / n, a[1] / n, a[2] / n];
}

/** The part of `v` that is perpendicular to the unit vector `u`. */
export const reject = (v, u) => sub(v, scale(u, dot(v, u)));

/** Angle between two vectors, in degrees. */
export function angle(a, b) {
  const n = len(a) * len(b);
  if (n < 1e-9) return 0;
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b) / n))) * 180 / Math.PI;
}

/**
 * Two perpendicular unit vectors spanning the plane at right angles to `down`.
 *
 * Which two does not matter — they are only a coordinate system to do flat
 * maths in. What matters is that the choice is *stable*, so we seed it from
 * whichever phone axis is least aligned with gravity rather than a fixed one.
 */
export function horizontalBasis(down) {
  const d = unit(down);
  const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  let seed = axes[0], best = 1;
  for (const a of axes) {
    const c = Math.abs(dot(a, d));
    if (c < best) { best = c; seed = a; }
  }
  const e1 = unit(reject(seed, d));
  const e2 = unit(cross(d, e1));
  return [e1, e2];
}

/**
 * Principal direction of a cloud of 2-D points, and how elongated it is.
 *
 * Used on horizontal acceleration during a jog: the body accelerates far more
 * along the direction it faces than sideways, so the long axis of that cloud
 * is the fore-aft line. `ratio` says how much to believe it — a circular
 * cloud (ratio near 1) means the jog had no clear direction and the answer
 * should be thrown away.
 */
export function pca2(points) {
  const n = points.length;
  if (n < 8) return { axis: [1, 0], ratio: 1, n };
  let mu = 0, mv = 0;
  for (const p of points) { mu += p[0]; mv += p[1]; }
  mu /= n; mv /= n;
  let suu = 0, svv = 0, suv = 0;
  for (const p of points) {
    const u = p[0] - mu, v = p[1] - mv;
    suu += u * u; svv += v * v; suv += u * v;
  }
  suu /= n; svv /= n; suv /= n;
  // closed-form eigenvector of a symmetric 2x2
  const tr = suu + svv, det = suu * svv - suv * suv;
  const disc = Math.max(0, tr * tr / 4 - det);
  const l1 = tr / 2 + Math.sqrt(disc);
  const l2 = tr / 2 - Math.sqrt(disc);
  const axis = Math.abs(suv) > 1e-12
    ? unit2([l1 - svv, suv])
    : (suu >= svv ? [1, 0] : [0, 1]);
  return { axis, ratio: l2 > 1e-12 ? l1 / l2 : Infinity, n };
}

function unit2(a) {
  const n = Math.hypot(a[0], a[1]);
  return n < 1e-9 ? [1, 0] : [a[0] / n, a[1] / n];
}
