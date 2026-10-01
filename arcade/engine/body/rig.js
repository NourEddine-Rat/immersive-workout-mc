// Moving a skeleton by hand.
//
// Neither model comes with animations worth playing — the players have a
// T-pose, the arms five still poses — so every movement in the game is made
// here, in code. Two tools:
//
//   Rig.rot(name, q)   turn a bone by a rotation written in the CHARACTER's
//                      space (x = its left, y = up, z = forward for a player),
//                      whatever odd local axes the rig was exported with.
//                      "Swing the thigh forward 30°" is one line, not a hunt
//                      through Mixamo's axis conventions.
//   Rig.reach(...)     two-bone IK: put a hand at a point, the elbow bends
//                      toward a pole. The first-person arms are driven this way.
//
// Rotations are relative to the rest pose the Rig was made in.

import * as THREE from 'three';

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

export const DEG = Math.PI / 180;
/** A rotation of `deg` degrees about an axis given as [x, y, z]. */
export const qa = (axis, deg, out = new THREE.Quaternion()) => out.setFromAxisAngle(_v.set(axis[0], axis[1], axis[2]).normalize(), deg * DEG);
/** Euler degrees in character space, applied Y (turn), X (pitch), Z (roll). */
export const qe = (x, y, z, out = new THREE.Quaternion()) => out.setFromEuler(new THREE.Euler(x * DEG, y * DEG, z * DEG, 'YXZ'));

export class Rig {
  /**
   * @param root  the object whose space is "character space" (its own transform excluded)
   * @param find  bone name → short key, e.g. n => n.replace(/^mixamorig/, '').replace(/_\d+$/, '')
   */
  constructor(root, find = n => n) {
    this.root = root;
    this.b = {};
    root.updateMatrixWorld(true);
    const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    root.traverse(o => {
      if (!o.isBone) return;
      const key = find(o.name);
      const W = new THREE.Matrix4().multiplyMatrices(rootInv, o.matrixWorld);
      const wq = new THREE.Quaternion(); W.decompose(_v, wq, _v2);
      o.userData.rest = { q: o.quaternion.clone(), p: o.position.clone(), wq, wqInv: wq.clone().invert() };
      this.b[key] = o;
    });
  }
  has(k) { return !!this.b[k]; }
  /** Back to the rest pose (call once a frame before building a pose). */
  reset() { for (const k in this.b) { const o = this.b[k]; o.quaternion.copy(o.userData.rest.q); } }
  /** Turn bone `k` by the character-space rotation `q` (about its own joint). */
  rot(k, q) {
    const o = this.b[k]; if (!o) return;
    const r = o.userData.rest;
    _q.copy(r.wqInv).multiply(q).multiply(r.wq);          // the same turn, seen from the bone
    o.quaternion.copy(r.q).multiply(_q);
  }
  /** Add a further character-space turn on top of what the bone has now. */
  add(k, q) {
    const o = this.b[k]; if (!o) return;
    const r = o.userData.rest;
    _q.copy(r.wqInv).multiply(q).multiply(r.wq);
    o.quaternion.multiply(_q);
  }
  /** Blend the local rotation toward another pose's (slerp by t). */
  blendTo(k, localQ, t) { const o = this.b[k]; if (o) o.quaternion.slerp(localQ, t); }
}

/**
 * Two-bone IK in world space.
 *
 * upper → mid → end are three bones (shoulder, elbow, wrist). The end is
 * put at `target` (clamped to what the arm can reach), and the elbow bends
 * toward `pole`. Each bone is turned by the smallest rotation that takes its
 * CURRENT direction to the new one — so whatever twist the pose had (the
 * way the forearm and hand face) is kept.
 */
export function reach(upper, mid, end, target, pole) {
  upper.updateWorldMatrix(true, true);
  const S = upper.getWorldPosition(new THREE.Vector3());
  const E0 = mid.getWorldPosition(new THREE.Vector3());
  const H0 = end.getWorldPosition(new THREE.Vector3());
  const L1 = S.distanceTo(E0), L2 = E0.distanceTo(H0);
  const toT = _v3.copy(target).sub(S);
  let d = toT.length();
  d = Math.min(L1 + L2 - 1e-4, Math.max(Math.abs(L1 - L2) + 1e-4, d));
  const dir = toT.normalize().clone();
  // elbow: along the reach by a, out toward the pole by h
  const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  const pv = new THREE.Vector3().copy(pole).sub(S); pv.addScaledVector(dir, -pv.dot(dir));
  if (pv.lengthSq() < 1e-8) pv.set(0, -1, 0).addScaledVector(dir, -dir.y);
  pv.normalize();
  const E = S.clone().addScaledVector(dir, a).addScaledVector(pv, h);
  const T = S.clone().addScaledVector(dir, d);
  aim(upper, E0.clone().sub(S).normalize(), E.clone().sub(S).normalize());
  mid.updateWorldMatrix(true, true);
  const E1 = mid.getWorldPosition(new THREE.Vector3()), H1 = end.getWorldPosition(new THREE.Vector3());
  aim(mid, H1.sub(E1).normalize(), T.sub(E1).normalize());
  end.updateWorldMatrix(true, false);
}

/** Turn `bone` (in world space) so that its current direction `from` becomes `to`. */
function aim(bone, from, to) {
  const turn = _q2.setFromUnitVectors(from, to);
  const wq = bone.getWorldQuaternion(new THREE.Quaternion());
  const pq = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(pq.invert().multiply(turn).multiply(wq));
  bone.updateWorldMatrix(false, true);
}
