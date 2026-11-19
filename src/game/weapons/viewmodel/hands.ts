import * as THREE from "three";
import { type GeoBuilder, type P2, type V3, rrect, extrude, shape, latheZ, rodGeo } from "./geo";
import type { ViewmodelMaterials } from "./materials";

/**
 * Gloved hands + forearms, posed procedurally around the object they hold.
 *
 * Hand-local frame (right hand):
 *   X — along the held object's axis, index finger → pinky
 *   the object is a cylinder of radius `r` on the X axis
 *   palm sits on the -Y side, fingers wrap -Y → +Z → +Y, thumb wraps the other way
 *   wrist toward -Z
 * Left hands are built as mirrored right hands.
 */

/** Per-finger curl: "wrap" hugs the object, or explicit joint angles (rad). */
export type FingerPose = "wrap" | [number, number, number];

export type HandPose = {
  /** Radius of the held object. */
  r: number;
  fingers?: [FingerPose, FingerPose, FingerPose, FingerPose];
  /** Thumb: wrap around the far side, point forward along the object, or explicit. */
  thumb?: "wrap" | "forward" | "up" | [number, number];
  /** With thumb "forward": explicit pointing direction in gun space (handguns). */
  thumbDir?: V3;
  /** Knuckle angle on the wrap circle (deg); -90 = straight under. */
  phi0?: number;
  /** Extra wrap tightness (scales chord angles). */
  tight?: number;
  /** Finger spread (rad) applied to index / pinky. */
  spread?: number;
};

export type ArmPlacement = {
  /** A point on the held axis where the index finger sits. */
  at: V3;
  /** Direction index → pinky. */
  axis: V3;
  /** Direction from the held axis toward the palm. */
  palm: V3;
  /** Where the forearm heads (elbow, usually off-screen). */
  elbow: V3;
  left?: boolean;
  watch?: boolean;
  /** Forearm length cap (m). */
  forearm?: number;
};

const FINGER_X = [0.006, 0.026, 0.045, 0.062];
const FINGER_R = [0.0092, 0.0097, 0.0091, 0.0081];
const FINGER_L: [number, number, number][] = [
  [0.041, 0.025, 0.022],
  [0.046, 0.029, 0.023],
  [0.043, 0.027, 0.022],
  [0.034, 0.021, 0.019],
];
const PALM_T = 0.027;

const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** Build a gloved hand + sleeve into the builder's current target. */
export function buildArm(b: GeoBuilder, mats: ViewmodelMaterials, p: ArmPlacement, pose: HandPose) {
  const mirror = p.left ? -1 : 1;
  const mx = (a: V3) => v(a[0] * mirror, a[1], a[2]);

  // Hand-local → gun space (built for the mirrored world, then mirrored back).
  const X = mx(p.axis).normalize();
  const palm = mx(p.palm);
  palm.addScaledVector(X, -palm.dot(X)).normalize();
  const Y = palm.clone().negate();
  const Z = v().crossVectors(X, Y).normalize();
  const basis = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(mx(p.at));
  const M = new THREE.Matrix4().makeScale(mirror, 1, 1).multiply(basis);
  const inv = basis.clone().invert();
  const elbowL = mx(p.elbow).applyMatrix4(inv);

  const r = pose.r;
  const phi0 = THREE.MathUtils.degToRad(pose.phi0 ?? -58);
  const tight = pose.tight ?? 1;
  const add = (mat: THREE.Material, g: THREE.BufferGeometry, local?: THREE.Matrix4) => {
    const m = local ? M.clone().multiply(local) : M;
    b.add(mat, g, m);
  };
  const circ = (rad: number, phi: number, x: number) => v(x, rad * Math.sin(phi), rad * Math.cos(phi));

  // ---- Palm + back of hand --------------------------------------------------
  const kz = (r + PALM_T * 0.5) * Math.cos(phi0);
  const zWrist = -0.074;
  const palmLen = kz + 0.012 - zWrist;
  const palmMid = (kz + 0.012 + zWrist) / 2;
  {
    // Rounded slab, slightly wider at the knuckles.
    const pts: P2[] = rrect(0.078, PALM_T, 0.011, 0.034, -r - PALM_T / 2, 3);
    const g = extrude(shape(pts), palmLen, { bev: 0.007, bevSeg: 2, seg: 3 });
    add(mats.glove, g, new THREE.Matrix4().makeTranslation(0, 0, palmMid));
    // Suede palm pad (contact side).
    const pad = extrude(shape(rrect(0.07, 0.006, 0.003, 0.034, -r + 0.0015, 2)), palmLen * 0.85, { bev: 0.002 });
    add(mats.gloveAccent, pad, new THREE.Matrix4().makeTranslation(0, 0, palmMid - 0.004));
    // Moulded knuckle guard on the back of the hand.
    const guard = extrude(shape(rrect(0.07, 0.007, 0.0035, 0.034, -r - PALM_T - 0.002, 2)), 0.026, { bev: 0.0025, bevSeg: 2 });
    add(mats.gloveAccent, guard, new THREE.Matrix4().makeTranslation(0, 0, kz - 0.01));
    // Back-of-hand vent panel.
    const vent = extrude(shape(rrect(0.05, 0.004, 0.002, 0.034, -r - PALM_T - 0.0005, 2)), 0.03, { bev: 0.0015 });
    add(mats.gloveAccent, vent, new THREE.Matrix4().makeTranslation(0, 0, zWrist + 0.03));
  }

  // ---- Fingers --------------------------------------------------------------
  const fingers = pose.fingers ?? ["wrap", "wrap", "wrap", "wrap"];
  for (let f = 0; f < 4; f++) {
    const fr = FINGER_R[f];
    const L = FINGER_L[f];
    const x = FINGER_X[f];
    const R = r + fr * 1.02;
    const mode = fingers[f];
    const joints: THREE.Vector3[] = [];
    const start = circ(r + PALM_T * 0.5, phi0 + (f === 3 ? 0.08 : 0), x);
    joints.push(start);
    const spread = (pose.spread ?? 0.06) * (f === 0 ? -1 : f === 3 ? 1 : f === 1 ? -0.3 : 0.4);
    if (mode === "wrap") {
      let phi = Math.atan2(start.y, start.z);
      for (let k = 0; k < 3; k++) {
        const chord = 2 * Math.asin(Math.min(0.999, L[k] / (2 * R))) * tight;
        phi += chord;
        const xk = x + spread * (k + 1) * 0.012;
        joints.push(circ(R, phi, xk));
      }
    } else {
      // Explicit curls from the tangent direction at the knuckle.
      let ang = phi0 + Math.PI / 2;
      const pnt = start.clone();
      for (let k = 0; k < 3; k++) {
        ang += mode[k];
        const d = v(spread * 0.6, Math.sin(ang), Math.cos(ang)).normalize();
        pnt.addScaledVector(d, L[k]);
        joints.push(pnt.clone());
      }
    }
    for (let k = 0; k < 3; k++) {
      const rad = fr * (k === 2 ? 0.92 : 1);
      add(mats.glove, rodGeo(joints[k], joints[k + 1], rad, 7, true));
    }
    // Knuckle pad over the proximal phalanx.
    const a = joints[0];
    const c = joints[1];
    const mid = v().addVectors(a, c).multiplyScalar(0.5);
    const out = v(0, mid.y, mid.z).normalize().multiplyScalar(fr * 0.85);
    add(mats.gloveAccent, rodGeo(mid.clone().add(out).addScaledVector(v().subVectors(c, a), -0.18), mid.clone().add(out).addScaledVector(v().subVectors(c, a), 0.18), fr * 0.55, 6, true));
  }

  // ---- Thumb ----------------------------------------------------------------
  {
    const tr = 0.0108;
    const base = v(-0.002, -r - PALM_T * 0.45, -0.036);
    const thumb = pose.thumb ?? "wrap";
    const Rt = r + tr;
    const phiT = THREE.MathUtils.degToRad(-128);
    const j1 = circ(Rt + 0.003, phiT, -0.01);
    const joints = [base, j1];
    if (thumb === "wrap") {
      let phi = phiT;
      for (const len of [0.033, 0.028]) {
        phi -= 2 * Math.asin(Math.min(0.999, len / (2 * Rt))) * (pose.tight ?? 1);
        joints.push(circ(Rt, phi, -0.012));
      }
    } else if (thumb === "forward" || thumb === "up") {
      const tang = v(0, -Math.cos(phiT), Math.sin(phiT)).negate(); // toward decreasing phi
      const dir = pose.thumbDir ? mx(pose.thumbDir).transformDirection(inv) : thumb === "forward" ?v(-1, 0, 0).addScaledVector(tang, 0.45).normalize() : v(-0.35, 0, 0).addScaledVector(tang, 1).normalize();
      const p1 = j1.clone().addScaledVector(dir, 0.033);
      const p2 = p1.clone().addScaledVector(dir, 0.027);
      joints.push(p1, p2);
    } else {
      let ang = phiT - Math.PI / 2;
      const pnt = j1.clone();
      for (let k = 0; k < 2; k++) {
        ang -= thumb[k];
        const d = v(-0.25, Math.sin(ang), Math.cos(ang)).normalize();
        pnt.addScaledVector(d, k === 0 ? 0.033 : 0.028);
        joints.push(pnt.clone());
      }
    }
    // Thenar muscle: a fat capsule from the wrist to the thumb base.
    add(mats.glove, rodGeo(v(0.006, -r - PALM_T * 0.5, zWrist + 0.012), j1, 0.0145, 8, true));
    for (let k = 1; k < 3; k++) add(mats.glove, rodGeo(joints[k], joints[k + 1], tr * (k === 2 ? 0.92 : 1), 7, true));
  }

  // ---- Wrist, cuff, forearm ---------------------------------------------------
  const wrist = v(0.034, -r - PALM_T * 0.5, zWrist + 0.004);
  const dir = v().subVectors(elbowL, wrist);
  const len = Math.min(p.forearm ?? 0.34, dir.length());
  dir.normalize();
  const ax = v(1, 0, 0).addScaledVector(dir, -dir.x).normalize();
  const ay = v().crossVectors(dir, ax).normalize();
  const armM = new THREE.Matrix4().makeBasis(ax, ay, dir).setPosition(wrist);
  const oval = new THREE.Matrix4().makeScale(1.14, 0.92, 1);
  const armOval = armM.clone().multiply(oval);

  // Glove gauntlet cuff + strap.
  add(mats.glove, latheZ([[0.024, -0.03], [0.029, -0.012], [0.031, 0.02], [0.031, 0.036], [0.026, 0.04]], 12), armOval);
  add(mats.gloveAccent, latheZ([[0.0315, 0.004], [0.0322, 0.006], [0.0322, 0.026], [0.0315, 0.028]], 12), armOval);
  // Sleeve: cuff fold, then a tapering forearm with soft wrinkles.
  const sl: P2[] = [[0.029, 0.03], [0.0345, 0.034], [0.036, 0.042], [0.0352, 0.056], [0.034, 0.064]];
  for (let i = 1; i <= 8; i++) {
    const t = i / 8;
    const z = 0.064 + t * (len - 0.064);
    const wob = Math.sin(t * 19 + 1.3) * 0.0012 * (1 - t * 0.5);
    sl.push([0.034 + t * 0.006 + wob, z]);
  }
  sl.push([0.04, len + 0.01]);
  add(mats.sleeve, latheZ(sl, 14), armOval);

  if (p.watch) {
    // Field watch: strap ring over the sleeve cuff, case + glass on top.
    add(mats.polymer, latheZ([[0.0352, 0.07], [0.0362, 0.072], [0.0362, 0.088], [0.0352, 0.09]], 14), armOval);
    const caseM = armM.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.0365, 0.08));
    add(mats.polymerGray, extrude(shape(rrect(0.036, 0.036, 0.008, 0, 0, 3)), 0.011, { bev: 0.002, bevSeg: 2 }), caseM.clone().multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
    add(mats.watchFace, extrude(shape(rrect(0.028, 0.028, 0.006, 0, 0, 3)), 0.002, { bev: 0.0005 }), caseM.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.0055, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))));
  }
}
