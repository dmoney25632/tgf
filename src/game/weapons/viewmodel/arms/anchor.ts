import * as THREE from "three";
import type { ArmPlacement, HandPose } from "../hands";

/**
 * Hand anchors: where a first-person hand goes, recorded by `buildArm` as an
 * empty Object3D inside the group that holds (and animates) that hand — gun
 * root, support-arm group, magazine, knife, grenade. The skinned arms
 * (FpArms) find the visible anchors every frame and pose a real arm onto
 * them, so every existing animation (reload tracks, bolt / pump hands, knife,
 * grenade) drives the skinned hands without knowing about them.
 *
 * Anchor frame = the hand frame of hands.ts (right hand):
 *   X  index → pinky along the held object's axis (the object is a cylinder
 *      of radius pose.r on X)
 *   Y  out of the palm, toward the object (the palm sits on the -Y side)
 *   Z  X × Y: from the wrist toward the fingers / over the top of the object
 * Left hands use the mirror image of that frame (a proper rotation; local
 * points are the right hand's with x negated).
 */
export type HandAnchorData = {
  side: "L" | "R";
  pose: HandPose;
  placement: ArmPlacement;
  /** Where the forearm heads, in the anchor parent's space. */
  elbow: THREE.Vector3;
  /** Solved once per rig template (see rig.ts): hand bone in anchor space + finger rotations. */
  solved?: { key: object; hand: THREE.Matrix4; fingers: Float32Array };
};

export const ANCHOR_TAG = "fpHand";

const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _mirror = new THREE.Matrix4().makeScale(-1, 1, 1);
const _s = new THREE.Vector3();

/** The anchor frame (parent space) for a placement. */
export function anchorMatrix(p: ArmPlacement, out = new THREE.Matrix4()) {
  const k = p.left ? -1 : 1;
  _x.set(p.axis[0] * k, p.axis[1], p.axis[2]).normalize();
  _y.set(p.palm[0] * k, p.palm[1], p.palm[2]);
  _y.addScaledVector(_x, -_y.dot(_x)).normalize().negate();
  _z.crossVectors(_x, _y).normalize();
  out.makeBasis(_x, _y, _z).setPosition(p.at[0] * k, p.at[1], p.at[2]);
  if (p.left) {
    // S · B · S with S = diag(-1, 1, 1): the mirrored frame as a proper rotation.
    out.premultiply(_mirror).multiply(_mirror);
  }
  return out;
}

/** Adds a hand anchor for `p` / `pose` to `target`. */
export function addHandAnchor(target: THREE.Object3D, p: ArmPlacement, pose: HandPose) {
  const o = new THREE.Object3D();
  o.name = p.left ? "hand-anchor-L" : "hand-anchor-R";
  anchorMatrix(p, _m).decompose(o.position, o.quaternion, _s);
  const data: HandAnchorData = { side: p.left ? "L" : "R", pose, placement: p, elbow: new THREE.Vector3(...p.elbow) };
  o.userData[ANCHOR_TAG] = data;
  target.add(o);
  return o;
}

export function anchorData(o: THREE.Object3D): HandAnchorData | undefined {
  return o.userData[ANCHOR_TAG] as HandAnchorData | undefined;
}

/** Removes the hand anchors directly under `target` (arm rebuilt elsewhere). */
export function removeHandAnchors(target: THREE.Object3D) {
  for (const c of [...target.children]) if (anchorData(c)) c.removeFromParent();
}
