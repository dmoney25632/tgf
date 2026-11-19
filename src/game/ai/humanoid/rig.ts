import * as THREE from "three";

/**
 * Skeleton proportions (metres, before HumanoidLook.scale). Standing:
 * hip joints ~0.93, waist ~1.07, chest ~1.25, chin ~1.52, eyes ~1.63,
 * helmet top ~1.76 — so Agent.ts's 1.25 / 1.55 chest and eye heights land
 * on the chest plate and the face.
 */
export const RIG = {
  hipX: 0.092,
  hipY: -0.035,
  thigh: 0.43,
  shin: 0.42,
  ankle: 0.08,
  spineY: 0.1,
  shoulderX: 0.178,
  shoulderY: 0.378,
  neckY: 0.43,
  upperArm: 0.3,
  foreArm: 0.27,
};

export const BONES = [
  "pelvis",
  "spine",
  "head",
  "uArmR",
  "uArmL",
  "fArmR",
  "fArmL",
  "handR",
  "handL",
  "thighR",
  "thighL",
  "shinR",
  "shinL",
  "footR",
  "footL",
] as const;
export type BoneName = (typeof BONES)[number];

/** Where a gripped rod passes through the right fist (wrist-local). Mirror x for the left. */
export const HAND_SOCKET = new THREE.Vector3(0.033, -0.078, 0);

/**
 * Analytic two-bone IK in the shoulder's parent space. Bones hang along -Y;
 * the elbow hinges about local X. Writes local quaternions for the upper
 * arm, forearm and hand. Allocation-free (module scratch).
 */
const _d = new THREE.Vector3();
const _e = new THREE.Vector3();
const _pp = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _qu = new THREE.Quaternion();
const _qf = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _s = new THREE.Vector3();

export function solveArm(
  upper: THREE.Object3D,
  fore: THREE.Object3D,
  hand: THREE.Object3D,
  shoulderRest: THREE.Vector3,
  wrist: THREE.Vector3,
  handQ: THREE.Quaternion,
  pole: THREE.Vector3,
  l1: number,
  l2: number,
) {
  // Clavicle assist: when the target is out of reach, slide the shoulder
  // toward it (up to 7 cm) like a protracting shoulder blade.
  _s.copy(shoulderRest);
  _d.subVectors(wrist, _s);
  let dist = _d.length();
  const reach = (l1 + l2) * 0.985;
  if (dist > reach) {
    const shift = Math.min(0.07, dist - reach);
    _s.addScaledVector(_d, shift / dist);
    _d.subVectors(wrist, _s);
    dist = _d.length();
  }
  upper.position.copy(_s);
  dist = Math.min(Math.max(dist, Math.abs(l1 - l2) + 0.02), reach);
  _d.normalize();
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  _pp.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_pp.lengthSq() < 1e-6) _pp.set(0, -1, 0).addScaledVector(_d, -_d.y);
  _pp.normalize();
  _e.copy(_s).addScaledVector(_d, a).addScaledVector(_pp, h); // elbow
  const tx = _s.x + _d.x * dist, ty = _s.y + _d.y * dist, tz = _s.z + _d.z * dist; // (clamped) wrist

  // Hinge axis: x = -(elbowDir x forearmDir).
  _y.subVectors(_e, _s); // upper arm direction (down the limb)
  _z.set(tx - _e.x, ty - _e.y, tz - _e.z); // forearm direction
  _n.crossVectors(_y, _z);
  if (_n.lengthSq() < 1e-8) _n.set(1, 0, 0);
  else _n.normalize().negate();

  // Upper basis: +Y points back up the limb.
  _y.normalize().negate();
  _x.copy(_n).addScaledVector(_y, -_n.dot(_y)).normalize();
  _z.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, _z);
  _qu.setFromRotationMatrix(_m);

  _y.set(_e.x - tx, _e.y - ty, _e.z - tz).normalize();
  _x.copy(_n).addScaledVector(_y, -_n.dot(_y)).normalize();
  _z.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, _z);
  _qf.setFromRotationMatrix(_m);

  upper.quaternion.copy(_qu);
  fore.quaternion.copy(_qi.copy(_qu).invert().multiply(_qf));
  hand.quaternion.copy(_qi.copy(_qf).invert().multiply(handQ));
}
