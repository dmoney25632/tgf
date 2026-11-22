import * as THREE from "three";
import { solveHand, type ArmsTemplate, type Side, type SideRest } from "../../weapons/viewmodel/arms/rig";
import type { HandAnchorData } from "../../weapons/viewmodel/arms/anchor";
import type { HandPose } from "../../weapons/viewmodel/hands";

/**
 * World-space pose helpers for an arbitrary bone hierarchy (the Rocketbox
 * Biped rig, whose local axes are not the procedural rig's). Everything
 * works on world quaternions / positions and writes local quaternions, so
 * the bone axis conventions never matter. Allocation-free (module scratch).
 */

const _q = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _e = new THREE.Vector3();
const _p = new THREE.Vector3();
const _f = new THREE.Vector3();
const _t = new THREE.Vector3();

/** World position from an up-to-date matrixWorld (no ancestor update). */
export const wpos = (o: THREE.Object3D, out: THREE.Vector3) => out.setFromMatrixPosition(o.matrixWorld);

/** World rotation from an up-to-date matrixWorld (no ancestor update; assumes uniform scale). */
export function wquat(o: THREE.Object3D, out: THREE.Quaternion) {
  const e = o.matrixWorld.elements;
  const sx = Math.hypot(e[0], e[1], e[2]) || 1;
  _m.copy(o.matrixWorld);
  const m = _m.elements;
  for (let i = 0; i < 3; i++) {
    m[i] /= sx;
    m[4 + i] /= sx;
    m[8 + i] /= sx;
  }
  return out.setFromRotationMatrix(_m);
}
const _m = new THREE.Matrix4();

/** Sets a bone's world rotation (parent matrixWorld must be current) and refreshes its subtree. */
export function setWorldQuat(bone: THREE.Object3D, q: THREE.Quaternion) {
  if (bone.parent) {
    wquat(bone.parent, _qp).invert();
    bone.quaternion.copy(_qp).multiply(q);
  } else bone.quaternion.copy(q);
  bone.updateMatrixWorld(true);
}

/** Rotates a bone in world space by `delta` (pre-multiplied) and refreshes its subtree. */
export function rotateWorld(bone: THREE.Object3D, delta: THREE.Quaternion) {
  wquat(bone, _q);
  _q.premultiply(delta);
  setWorldQuat(bone, _q);
}

/** Swings a bone so its world direction `from` (unit) turns to `to` (unit). */
export function swingWorld(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, k = 1) {
  const d = _qd.setFromUnitVectors(from, to);
  if (k < 1) d.slerp(IDQ, 1 - k);
  rotateWorld(bone, d);
}
const _qd = new THREE.Quaternion();
const IDQ = new THREE.Quaternion();

/**
 * Two-bone IK: places `end`'s origin at `target` (world), bending in the
 * plane of `pole` (world direction the middle joint should point toward),
 * then sets `end`'s world rotation to `endQ` (if given). Matrices of the
 * chain must be current. If the target is out of reach and `clavicle` is
 * given, the clavicle rotates (up to `maxShrug` m of shoulder travel) to help.
 */
export function solveTwoBone(
  upper: THREE.Object3D,
  lower: THREE.Object3D,
  end: THREE.Object3D,
  target: THREE.Vector3,
  pole: THREE.Vector3,
  endQ: THREE.Quaternion | null,
  clavicle: THREE.Object3D | null = null,
  maxShrug = 0.06,
) {
  wpos(upper, _a);
  wpos(lower, _b);
  wpos(end, _c);
  const l1 = _a.distanceTo(_b), l2 = _b.distanceTo(_c);
  const reach = (l1 + l2) * 0.995;
  _t.copy(target);
  let dist = _a.distanceTo(_t);
  if (clavicle && dist > reach) {
    // Shrug: rotate the clavicle so the shoulder moves toward the target.
    wpos(clavicle, _p);
    const shift = Math.min(maxShrug, dist - reach);
    _d.subVectors(_t, _a).normalize();
    _e.copy(_a).addScaledVector(_d, shift).sub(_p).normalize();
    _f.subVectors(_a, _p).normalize();
    swingWorld(clavicle, _f, _e);
    wpos(upper, _a);
    wpos(lower, _b);
    wpos(end, _c);
    dist = _a.distanceTo(_t);
  }
  const d = Math.min(Math.max(dist, Math.abs(l1 - l2) + 1e-3), reach);
  _d.subVectors(_t, _a);
  if (_d.lengthSq() < 1e-10) _d.set(0, -1, 0);
  _d.normalize();
  // Bend direction: pole projected off the shoulder-target axis.
  _p.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_p.lengthSq() < 1e-8) _p.set(0, -1, 0).addScaledVector(_d, -_d.y);
  _p.normalize();
  const cosA = THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  // Desired elbow.
  _e.copy(_a).addScaledVector(_d, l1 * cosA).addScaledVector(_p, l1 * sinA);
  _f.subVectors(_b, _a).normalize();
  _b.subVectors(_e, _a).normalize();
  swingWorld(upper, _f, _b);
  // Forearm: current elbow->wrist onto elbow->target.
  wpos(lower, _b);
  wpos(end, _c);
  _f.subVectors(_c, _b).normalize();
  _e.copy(_a).addScaledVector(_d, d); // clamped target
  _c.subVectors(_e, _b).normalize();
  swingWorld(lower, _f, _c);
  if (endQ) setWorldQuat(end, endQ);
}

// ---------------------------------------------------------------------------
// Gripping hands: the first-person arms' finger solver (viewmodel/arms/rig.ts
// solveHand: the hand on a hand anchor, fingers wrapped joint by joint around
// the held object) run on a soldier's own Rocketbox hand. Both rigs are
// Biped skeletons, so only the rest pose differs.
// ---------------------------------------------------------------------------

const FINGERS = 5;

/**
 * The slice of an fp ArmsTemplate solveHand reads (hand frame, finger chains,
 * tips), built from a soldier skeleton's bind pose. `bind(name)`: the bone's
 * bind matrix in skeleton space; `local(name)`: its rest local position /
 * rotation. Null when the skeleton lacks finger bones.
 */
export function gripTemplate(bind: (n: string) => THREE.Matrix4 | undefined, local: (n: string) => THREE.Object3D | undefined): ArmsTemplate | null {
  const sides = {} as Record<Side, SideRest>;
  for (const S of ["R", "L"] as const) {
    const p = `Bip01_${S}_`;
    const handW = bind(p + "Hand");
    if (!handW) return null;
    const fingers: SideRest["fingers"] = [];
    const tips: THREE.Vector3[] = [];
    for (let f = 0; f < FINGERS; f++) {
      const names = [`${p}Finger${f}`, `${p}Finger${f}1`, `${p}Finger${f}2`];
      const chain = names.map((n) => local(n));
      const W = names.map((n) => bind(n));
      if (chain.some((c) => !c) || W.some((w) => !w)) return null;
      fingers.push(chain.map((c) => ({ index: -1, pos: c!.position.clone(), quat: c!.quaternion.clone() })));
      // Tip: one distal length on along the middle -> distal direction, in the distal bone's frame.
      const o1 = new THREE.Vector3().setFromMatrixPosition(W[1]!);
      const o2 = new THREE.Vector3().setFromMatrixPosition(W[2]!);
      const dir = o2.clone().sub(o1);
      const len = dir.length() * 0.95;
      const inv = new THREE.Matrix4().copy(W[2]!).invert();
      tips.push(o2.clone().addScaledVector(dir.normalize(), len).applyMatrix4(inv));
    }
    // Anatomical hand frame, exactly as rig.ts makeTemplate builds it.
    const wrist = new THREE.Vector3().setFromMatrixPosition(handW);
    const k1 = new THREE.Vector3().setFromMatrixPosition(bind(`${p}Finger1`)!);
    const k4 = new THREE.Vector3().setFromMatrixPosition(bind(`${p}Finger4`)!);
    const mid = k1.clone().add(k4).multiplyScalar(0.5);
    const Z = mid.clone().sub(wrist).normalize();
    const across = k4.clone().sub(k1).normalize();
    const Y = S === "R" ? new THREE.Vector3().crossVectors(Z, across) : new THREE.Vector3().crossVectors(across, Z);
    Y.addScaledVector(Z, -Y.dot(Z)).normalize();
    const X = new THREE.Vector3().crossVectors(Y, Z);
    const anat = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(mid);
    const handFromAnat = anat.invert().multiply(handW);
    sides[S] = { side: S, fingers, tips, handFromAnat } as SideRest;
  }
  return { sides } as ArmsTemplate;
}

/** Hand anchor data for solveHand from a gun-frame anchor: the placement is the identity (the frame is the anchor itself). */
export function gripAnchor(side: Side, pose: HandPose): HandAnchorData {
  return { side, pose, placement: { at: [0, 0, 0], axis: [side === "R" ? 1 : -1, 0, 0], palm: [0, -1, 0], elbow: [0, 0, 0], left: side === "L" }, elbow: new THREE.Vector3() };
}

/** Hand bone transform in anchor space + the 15 finger rotations (cached on the anchor per template). */
export function gripSolve(t: ArmsTemplate, d: HandAnchorData) {
  return solveHand(t, d);
}
