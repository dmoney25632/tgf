import * as THREE from "three";
import { type GeoBuilder, type P2, type V3, extrude, shape, latheZ, rodGeo } from "./geo";
import type { Surf, ViewmodelMaterials } from "./materials";
import { addHandAnchor } from "./arms/anchor";

/**
 * Gloved hands + forearms, posed procedurally around the object they hold.
 *
 * Every arm also leaves a hand anchor in its target group (arms/anchor.ts):
 * the skinned first-person arms (arms/FpArms.ts) pose onto those and replace
 * this geometry once loaded; the procedural arms are the fallback (loading,
 * failure, kill switch) and are skipped when `b.armGeometry` is false.
 *
 * Hand-local frame (right hand):
 *   X — along the held object's axis, index finger → pinky
 *   the object is a cylinder of radius `r` on the X axis
 *   palm sits on the -Y side, fingers wrap -Y → +Z → +Y, thumb wraps the other way
 *   wrist toward -Z
 * Left hands are built as mirrored right hands.
 *
 * Detail: tapered three-segment fingers with joint bulges, moulded knuckle
 * armour and fingertip reinforcement, a sculpted back of hand with seam
 * tape, a strapped gauntlet cuff, a sleeve with fabric folds and an elastic
 * cuff, and an optional field watch on the support wrist.
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

const FINGER_X = [0.007, 0.0265, 0.0455, 0.0625];
const FINGER_R = [0.0098, 0.0102, 0.0096, 0.0086];
const FINGER_L: [number, number, number][] = [
  [0.042, 0.026, 0.022],
  [0.047, 0.03, 0.024],
  [0.044, 0.028, 0.023],
  [0.035, 0.022, 0.02],
];
const PALM_T = 0.028;
const SEG = 8;

const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** Tapered segment between two joints (r0 at a, r1 at b), capped with half-spheres. */
function segment(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, seg = SEG) {
  const len = a.distanceTo(b);
  const pts: P2[] = [];
  // Rear cap (around a), body, front cap (around b). Lathe runs along Z.
  for (let i = 0; i <= 3; i++) {
    const t = (i / 3) * (Math.PI / 2);
    pts.push([r0 * Math.sin(t), -r0 * Math.cos(t)]);
  }
  for (let i = 0; i <= 3; i++) {
    const t = (i / 3) * (Math.PI / 2);
    pts.push([r1 * Math.cos(t), len + r1 * Math.sin(t)]);
  }
  const g = latheZ(pts, seg);
  const dir = v().subVectors(b, a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(v(0, 0, 1), dir);
  g.applyMatrix4(new THREE.Matrix4().compose(a, q, v(1, 1, 1)));
  return g;
}

/**
 * Tube along +Z with a cross-section radius r(z, θ): used for sleeves so the
 * fabric bunches into folds instead of reading as a pipe.
 */
function foldTube(len: number, radius: (z: number, a: number) => number, around = 18, along = 16) {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= along; j++) {
    const z = (j / along) * len;
    for (let i = 0; i <= around; i++) {
      const a = (i / around) * Math.PI * 2;
      const r = radius(z, a);
      pos.push(Math.cos(a) * r, Math.sin(a) * r, z);
    }
  }
  const row = around + 1;
  for (let j = 0; j < along; j++) {
    for (let i = 0; i < around; i++) {
      const a = j * row + i;
      const b = a + row;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Outward-facing check (flip the winding if the normals point inward).
  const n = g.attributes.normal;
  const k = row * Math.floor(along / 2);
  if (n.getX(k) * pos[k * 3] + n.getY(k) * pos[k * 3 + 1] < 0) {
    for (let t = 0; t < idx.length; t += 3) [idx[t + 1], idx[t + 2]] = [idx[t + 2], idx[t + 1]];
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  return g;
}

/** Build a gloved hand + sleeve into the builder's current target. */
export function buildArm(b: GeoBuilder, mats: ViewmodelMaterials, p: ArmPlacement, pose: HandPose) {
  b.arms.push({ target: b.target, p, pose });
  addHandAnchor(b.target, p, pose);
  if (!b.armGeometry) return;
  const was = b.armMode;
  b.armMode = true;
  try {
    buildArmParts(b, mats, p, pose);
  } finally {
    b.armMode = was;
  }
}

function buildArmParts(b: GeoBuilder, mats: ViewmodelMaterials, p: ArmPlacement, pose: HandPose) {
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
  const add = (mat: Surf, g: THREE.BufferGeometry, local?: THREE.Matrix4) => {
    const m = local ? M.clone().multiply(local) : M;
    b.add(mat, g, m);
  };
  const circ = (rad: number, phi: number, x: number) => v(x, rad * Math.sin(phi), rad * Math.cos(phi));
  const T = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
  /** (x, z) plan outline → slab of thickness t centred on y. */
  const slab = (pts: P2[], t: number, y: number, bev: number, bevSeg = 2) => {
    const g = extrude(shape(pts.map(([x, z]) => [x, -z] as P2)), t, { bev, bevSeg, seg: 2 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, y, 0);
    return g;
  };

  // ---- Back of hand + palm ------------------------------------------------
  // Plan outline (x across the hand, z wrist → knuckles), wider at the knuckles.
  const kz = (r + PALM_T * 0.5) * Math.cos(phi0);
  const zWrist = -0.078;
  const yMid = -r - PALM_T / 2;
  {
    const zK = kz + 0.008;
    const outline: P2[] = [
      [-0.006, zK - 0.004], [0.012, zK + 0.003], [0.034, zK + 0.005], [0.056, zK + 0.002], [0.073, zK - 0.006],
      [0.074, zK - 0.03], [0.066, zWrist + 0.012], [0.054, zWrist], [0.014, zWrist], [0.002, zWrist + 0.014], [-0.008, zK - 0.03],
    ];
    add(mats.glove, slab(outline, PALM_T, yMid, 0.009, 3));
    // Suede palm pad on the contact side.
    const pad: P2[] = [[0.0, zK - 0.012], [0.066, zK - 0.012], [0.062, zWrist + 0.012], [0.008, zWrist + 0.012]];
    add(mats.gloveAccent, slab(pad, 0.004, -r + 0.0012, 0.0015));
    // Back-of-hand panel with seam tape around it.
    const yBack = -r - PALM_T;
    const panel: P2[] = [[0.008, zK - 0.024], [0.064, zK - 0.024], [0.058, zWrist + 0.02], [0.016, zWrist + 0.02]];
    add(mats.gloveAccent, slab(panel, 0.004, yBack + 0.0008, 0.0014));
    for (let i = 0; i < 4; i++) {
      const a = panel[i];
      const c = panel[(i + 1) % 4];
      add(mats.gloveSeam, rodGeo(v(a[0], yBack - 0.0004, a[1]), v(c[0], yBack - 0.0004, c[1]), 0.0009, 4));
    }
    // Moulded knuckle armour: bridge plate + one rounded pad per knuckle.
    add(mats.gloveAccent, slab([[-0.002, kz - 0.002], [0.072, kz - 0.006], [0.07, kz - 0.016], [0.0, kz - 0.014]], 0.006, yBack - 0.0005, 0.0022));
    for (let f = 0; f < 4; f++) {
      const c = v(FINGER_X[f] + 0.002, yBack - 0.0025, kz - 0.004);
      add(mats.gloveAccent, rodGeo(c.clone().setX(c.x - 0.006), c.clone().setX(c.x + 0.006), 0.0055, 7, true));
    }
  }

  // ---- Fingers ----------------------------------------------------------------
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
    const radii = [fr * 1.05, fr * 0.97, fr * 0.9, fr * 0.8];
    for (let k = 0; k < 3; k++) add(mats.glove, segment(joints[k], joints[k + 1], radii[k], radii[k + 1]));
    // Armour pads on the proximal + middle segments (outer side, away from the object).
    for (let k = 0; k < 2; k++) {
      const a = joints[k];
      const c = joints[k + 1];
      const mid = v().addVectors(a, c).multiplyScalar(0.5);
      const out = v(0, mid.y, mid.z).normalize().multiplyScalar(radii[k] * 0.78);
      const d = v().subVectors(c, a);
      add(mats.gloveAccent, rodGeo(mid.clone().add(out).addScaledVector(d, -0.22), mid.clone().add(out).addScaledVector(d, 0.2), radii[k] * (k === 0 ? 0.58 : 0.48), 6, true));
    }
    // Fingertip reinforcement (wraps the end of the distal segment).
    add(mats.gloveAccent, segment(v().lerpVectors(joints[2], joints[3], 0.55), joints[3], radii[2] * 1.04, radii[3] * 1.06, 7));
  }

  // ---- Thumb ----------------------------------------------------------------
  {
    const tr = 0.0112;
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
      const dir = pose.thumbDir ? mx(pose.thumbDir).transformDirection(inv) : thumb === "forward" ? v(-1, 0, 0).addScaledVector(tang, 0.45).normalize() : v(-0.35, 0, 0).addScaledVector(tang, 1).normalize();
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
    // Thenar muscle: a fat tapered pad from the wrist to the thumb base.
    add(mats.glove, segment(v(0.008, -r - PALM_T * 0.5, zWrist + 0.014), j1, 0.0165, 0.0122));
    add(mats.glove, segment(joints[1], joints[2], tr * 1.02, tr * 0.94));
    add(mats.glove, segment(joints[2], joints[3], tr * 0.94, tr * 0.82));
    add(mats.gloveAccent, segment(v().lerpVectors(joints[2], joints[3], 0.5), joints[3], tr * 0.98, tr * 0.88, 7));
    const mid = v().addVectors(joints[1], joints[2]).multiplyScalar(0.5);
    const out = v().subVectors(mid, v(mid.x, 0, 0)).normalize().multiplyScalar(tr * 0.75);
    const d = v().subVectors(joints[2], joints[1]);
    add(mats.gloveAccent, rodGeo(mid.clone().add(out).addScaledVector(d, -0.2), mid.clone().add(out).addScaledVector(d, 0.2), tr * 0.55, 6, true));
  }

  // ---- Wrist, cuff, forearm ---------------------------------------------------
  const wrist = v(0.034, yMid, zWrist + 0.006);
  const dir = v().subVectors(elbowL, wrist);
  const len = Math.min(p.forearm ?? 0.34, dir.length());
  dir.normalize();
  // Arm frame: Y toward the back of the hand (so the watch faces out), Z along the forearm.
  const back = v(0, -1, 0).addScaledVector(dir, dir.y).normalize();
  const ax = v().crossVectors(back, dir).normalize();
  const armM = new THREE.Matrix4().makeBasis(ax, back, dir).setPosition(wrist);
  const armOval = armM.clone().multiply(new THREE.Matrix4().makeScale(1.08, 0.88, 1));

  // Glove gauntlet: short cuff with a hook-and-loop strap and pull tab.
  add(mats.glove, latheZ([[0.024, -0.03], [0.0285, -0.012], [0.0305, 0.012], [0.0305, 0.03], [0.027, 0.034]], 14), armOval);
  add(mats.gloveAccent, latheZ([[0.031, 0.0], [0.0318, 0.002], [0.0318, 0.02], [0.031, 0.022]], 14), armOval);
  add(mats.gloveAccent, slab([[-0.01, 0.0], [0.012, 0.0], [0.014, 0.022], [-0.008, 0.022]], 0.004, 0.0298, 0.0015), armM.clone().multiply(T(0.014, 0, 0)));

  // Sleeve: elastic cuff, then a forearm that bunches into folds near the wrist.
  const z0 = 0.026;
  const slen = len + 0.01 - z0;
  const tube = foldTube(slen, (z, a) => {
    const t = z / slen;
    let rr = 0.0318 + t * 0.0065;
    if (z < 0.012) rr = 0.0306 + (z / 0.012) * 0.003; // cuff hem
    else if (z < 0.016) rr = 0.0336;
    // Folds: diagonal wrinkles, strongest just above the cuff, fading up the arm.
    const env = Math.exp(-((t - 0.18) ** 2) / 0.02) * 0.9 + 0.25 * (1 - t);
    const fold = Math.sin(a * 3 + z * 55) * 0.6 + Math.sin(a * 5 - z * 80 + 1.3) * 0.4;
    rr += fold * 0.0023 * env;
    // Sag on the underside.
    rr += Math.max(0, -Math.sin(a)) * 0.002 * t;
    return rr;
  }, 22, 18);
  add(mats.sleeve, tube, armOval.clone().multiply(T(0, 0, z0)));
  // Elastic cuff band.
  add(mats.sleeveDark, latheZ([[0.0316, z0 - 0.002], [0.0342, z0], [0.0346, z0 + 0.012], [0.033, z0 + 0.015]], 18), armOval);

  if (p.watch) {
    // Field watch on the wrist, over the sleeve cuff: strap, case, bezel, face, lume.
    const zW = z0 + 0.03;
    add(mats.watchCase, latheZ([[0.0352, zW - 0.009], [0.0364, zW - 0.008], [0.0364, zW + 0.008], [0.0352, zW + 0.009]], 18), armOval);
    const caseM = armM.clone().multiply(T(0, 0.0352 * 0.9 + 0.004, zW)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    add(mats.watchCase, latheZ([[0.0, -0.0045], [0.0175, -0.0045], [0.0185, -0.0015], [0.0185, 0.004], [0.0165, 0.0058], [0.0, 0.0058]], 20), caseM);
    add(mats.steel, latheZ([[0.0138, 0.0062], [0.0172, 0.0062], [0.0172, 0.0072], [0.0138, 0.0072]], 20), caseM);
    add(mats.watchFace, new THREE.CircleGeometry(0.0138, 20), caseM.clone().multiply(T(0, 0, 0.0064)));
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const big = i % 3 === 0;
      add(mats.lume, new THREE.CircleGeometry(big ? 0.0013 : 0.0008, 6), caseM.clone().multiply(T(Math.cos(a) * 0.0112, Math.sin(a) * 0.0112, 0.0066)));
    }
    // Hands (hour / minute) and crown.
    add(mats.lume, new THREE.PlaneGeometry(0.0012, 0.008), caseM.clone().multiply(T(0.0025, 0.003, 0.0067)).multiply(new THREE.Matrix4().makeRotationZ(-0.7)));
    add(mats.lume, new THREE.PlaneGeometry(0.0009, 0.011), caseM.clone().multiply(T(-0.0035, 0.0035, 0.0068)).multiply(new THREE.Matrix4().makeRotationZ(0.75)));
    add(mats.steel, latheZ([[0, 0], [0.0028, 0], [0.0028, 0.004], [0, 0.004]], 8), caseM.clone().multiply(T(0.0185, 0, 0)).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)));
  }
}
