import * as THREE from "three";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { anchorMatrix, type HandAnchorData } from "./anchor";

/**
 * Skinned first-person arms (public/assets/characters/fparms, built in
 * Blender by art/blender/fparms from a Rocketbox avatar; the sleeve's girth
 * is final in the mesh, nothing is scaled here): rest-pose data per arm
 * and the solvers that put a hand on an anchor.
 *
 * Per frame and arm: the hand bone goes exactly onto its anchor; two-bone IK
 * from a shoulder point below / behind the camera places the elbow, bending
 * toward the anchor's elbow hint (the direction the procedural sleeve took).
 * The elbow is a hinge (its axis from the plane of the two bones), and the
 * forearm's pronation / supination is spread over three twist bones so the
 * sleeve twists along its length.
 *
 * Fingers (5 x 3 bones) are solved once per anchor, in the anchor's frame:
 * "wrap" curls each finger joint by joint around the held cylinder (radius
 * pose.r), explicit curls bend the joints like hands.ts does, the thumb wraps
 * the other way, points along the slide, or bends explicitly.
 */

export type Side = "L" | "R";
const SIDES: Side[] = ["R", "L"];
const FINGERS = 5;

/** Finger joint radius (glove) used to wrap around the held object. */
const FINGER_R = 0.0095;
const THUMB_R = 0.0112;
/** Knuckle (MCP joint centre) distance from the held axis beyond its radius. */
const KNUCKLE_OUT = 0.014;
/** Max upper-arm stretch, and the shoulder->wrist / arm-length ratio it aims for (keeps a bent elbow). */
const UPPER_STRETCH = 1.6;
const BEND = 0.93;

type BoneRest = { index: number; pos: THREE.Vector3; quat: THREE.Quaternion };

export type SideRest = {
  side: Side;
  upper: BoneRest;
  fore: BoneRest;
  twist: BoneRest[];
  hand: BoneRest;
  /** [finger][segment 0..2]; finger 0 = thumb, 1 = index ... 4 = pinky. */
  fingers: BoneRest[][];
  /** Tip offset in the distal bone's space. */
  tips: THREE.Vector3[];
  upperLen: number;
  foreLen: number;
  /** Inverse of the (long axis, hinge axis) frame, in each bone's space. */
  upperFrameInv: THREE.Quaternion;
  foreFrameInv: THREE.Quaternion;
  /** Forearm long axis (forearm space): the twist axis. */
  foreAxis: THREE.Vector3;
  handRestInv: THREE.Quaternion;
  /** Hand bone relative to the anatomical frame (knuckle midpoint; X across, Y out of the palm, Z wrist → knuckles). */
  handFromAnat: THREE.Matrix4;
};

export type ArmsTemplate = {
  scene: THREE.Object3D;
  mesh: THREE.SkinnedMesh;
  sides: Record<Side, SideRest>;
  tris: number;
};

const v = () => new THREE.Vector3();

function frameInv(axis: THREE.Vector3, hinge: THREE.Vector3) {
  const x = axis.clone().normalize();
  const z = hinge.clone().addScaledVector(x, -hinge.dot(x)).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)).invert();
}

/** Reads the rest pose of a loaded fparms scene. Throws if bones are missing. */
export function makeTemplate(scene: THREE.Object3D): ArmsTemplate {
  scene.updateMatrixWorld(true);
  let mesh: THREE.SkinnedMesh | null = null;
  scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh && !mesh) mesh = o as THREE.SkinnedMesh;
  });
  if (!mesh) throw new Error("fparms: no skinned mesh");
  const sm = mesh as THREE.SkinnedMesh;
  const bones = sm.skeleton.bones;
  const find = (n: string) => {
    const i = bones.findIndex((b) => b.name === n);
    if (i < 0) throw new Error(`fparms: bone ${n} missing`);
    return i;
  };
  const rest = (n: string): BoneRest => {
    const index = find(n);
    return { index, pos: bones[index].position.clone(), quat: bones[index].quaternion.clone() };
  };
  const wpos = (b: BoneRest) => bones[b.index].getWorldPosition(v());
  const wquat = (b: BoneRest) => bones[b.index].getWorldQuaternion(new THREE.Quaternion());
  const sides = {} as Record<Side, SideRest>;
  for (const S of SIDES) {
    const p = `Bip01_${S}_`;
    const upper = rest(p + "UpperArm");
    const fore = rest(p + "Forearm");
    const hand = rest(p + "Hand");
    const twist = [1, 2, 3].map((k) => rest(`${p}ForeTwist${k}`));
    const fingers: BoneRest[][] = [];
    const tips: THREE.Vector3[] = [];
    for (let f = 0; f < FINGERS; f++) {
      fingers.push([rest(`${p}Finger${f}`), rest(`${p}Finger${f}1`), rest(`${p}Finger${f}2`)]);
      tips.push(bones[find(`${p}Finger${f}Tip`)].position.clone());
    }
    // Elbow hinge: in the rest (T-) pose the elbow folds the forearm forward (+Z).
    const dirU = wpos(fore).sub(wpos(upper)).normalize();
    const hingeW = v().crossVectors(dirU, new THREE.Vector3(0, 0, 1)).normalize();
    const hingeU = hingeW.clone().applyQuaternion(wquat(upper).invert());
    const hingeF = hingeW.clone().applyQuaternion(wquat(fore).invert());
    // Anatomical hand frame.
    const wrist = wpos(hand);
    const k1 = wpos(fingers[1][0]);
    const k4 = wpos(fingers[4][0]);
    const mid = k1.clone().add(k4).multiplyScalar(0.5);
    const Z = mid.clone().sub(wrist).normalize();
    const across = k4.clone().sub(k1).normalize();
    const Y = S === "R" ? v().crossVectors(Z, across) : v().crossVectors(across, Z);
    Y.addScaledVector(Z, -Y.dot(Z)).normalize();
    const X = v().crossVectors(Y, Z);
    const anat = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(mid);
    const handFromAnat = anat.invert().multiply(bones[hand.index].matrixWorld);
    sides[S] = {
      side: S,
      upper,
      fore,
      twist,
      hand,
      fingers,
      tips,
      upperLen: fore.pos.length(),
      foreLen: hand.pos.length(),
      upperFrameInv: frameInv(fore.pos, hingeU),
      foreFrameInv: frameInv(hand.pos, hingeF),
      foreAxis: hand.pos.clone().normalize(),
      handRestInv: hand.quat.clone().invert(),
      handFromAnat,
    };
  }
  const tris = (sm.geometry.index ? sm.geometry.index.count : sm.geometry.attributes.position.count) / 3;
  return { scene, mesh: sm, sides, tris };
}

// ---- Finger solve (once per anchor) -----------------------------------------------

const deg = THREE.MathUtils.degToRad;
const _anchorM = new THREE.Matrix4();

/**
 * Hand bone in anchor space + the 15 finger bone rotations (local, x y z w)
 * that wrap the fingers around the pose. Cached on the anchor data per template.
 */
export function solveHand(t: ArmsTemplate, d: HandAnchorData) {
  if (d.solved && d.solved.key === t) return d.solved;
  const rest = t.sides[d.side];
  const pose = d.pose;
  const k = d.side === "L" ? -1 : 1;
  const r = pose.r;
  const phi0 = deg(pose.phi0 ?? -58);
  const tight = pose.tight ?? 1;
  // Hand: knuckle midpoint on the wrap circle, palm toward the object.
  const kr = r + KNUCKLE_OUT;
  const hand = new THREE.Matrix4().makeTranslation(0.035 * k, kr * Math.sin(phi0), kr * Math.cos(phi0)).multiply(rest.handFromAnat);
  const out = new Float32Array(FINGERS * 3 * 4);
  const handQ = new THREE.Quaternion().setFromRotationMatrix(hand);
  const handP = v().setFromMatrixPosition(hand);
  // Anchor frame -> right-hand equivalent coordinates: negate x on the left.
  const re = (p: THREE.Vector3) => p.set(p.x * k, p.y, p.z);

  for (let f = 0; f < FINGERS; f++) {
    const chain = rest.fingers[f];
    const lens = [chain[1].pos.length(), chain[2].pos.length(), rest.tips[f].length()];
    const childOf = (i: number) => (i < 2 ? chain[i + 1].pos : rest.tips[f]);
    // World (anchor-space) transform of bone 0 at rest.
    let parentQ = handQ.clone();
    let pos = chain[0].pos.clone().applyQuaternion(handQ).add(handP);
    const start = re(pos.clone());
    const targets = f === 0 ? thumbTargets(start, lens, d, k) : fingerTargets(f, start, lens, pose, phi0, tight);
    for (const p of targets) re(p);
    for (let i = 0; i < 3; i++) {
      const worldQ = parentQ.clone().multiply(chain[i].quat);
      const cur = childOf(i).clone().applyQuaternion(worldQ).normalize();
      const want = targets[i].clone().sub(pos);
      if (want.lengthSq() > 1e-10) worldQ.premultiply(new THREE.Quaternion().setFromUnitVectors(cur, want.normalize()));
      const local = parentQ.clone().invert().multiply(worldQ);
      local.toArray(out, (f * 3 + i) * 4);
      pos = childOf(i).clone().applyQuaternion(worldQ).add(pos);
      parentQ = worldQ;
    }
  }
  d.solved = { key: t, hand, fingers: out };
  return d.solved;
}

/** Joint targets (right-hand equivalent anchor coordinates) for finger f (1 index .. 4 pinky). */
function fingerTargets(f: number, start: THREE.Vector3, lens: number[], pose: HandAnchorData["pose"], phi0: number, tight: number) {
  const mode = pose.fingers?.[f - 1] ?? "wrap";
  const spread = (pose.spread ?? 0.06) * [0, -1, -0.3, 0.4, 1][f];
  const out: THREE.Vector3[] = [];
  if (mode === "wrap") {
    const R = pose.r + FINGER_R;
    let rho = Math.hypot(start.y, start.z);
    let phi = Math.atan2(start.y, start.z);
    for (let i = 0; i < 3; i++) {
      const c = (R * R + rho * rho - lens[i] * lens[i]) / (2 * R * Math.max(1e-5, rho));
      phi += Math.acos(THREE.MathUtils.clamp(c, -1, 1)) * tight;
      rho = R;
      out.push(new THREE.Vector3(start.x + spread * (i + 1) * 0.012, R * Math.sin(phi), R * Math.cos(phi)));
    }
  } else {
    let ang = phi0 + Math.PI / 2;
    const p = start.clone();
    for (let i = 0; i < 3; i++) {
      ang += mode[i];
      p.addScaledVector(new THREE.Vector3(spread * 0.6, Math.sin(ang), Math.cos(ang)).normalize(), lens[i]);
      out.push(p.clone());
    }
  }
  return out;
}

/** Thumb joint targets: MCP (on the far side of the object), IP, tip. */
function thumbTargets(start: THREE.Vector3, lens: number[], d: HandAnchorData, k: number) {
  const pose = d.pose;
  const thumb = pose.thumb ?? "wrap";
  const Rt = pose.r + THUMB_R;
  const phiT = deg(-128);
  const circ = (rad: number, phi: number, x: number) => new THREE.Vector3(x, rad * Math.sin(phi), rad * Math.cos(phi));
  // MCP target: the metacarpal aims at it, at its own length from the CMC joint.
  const j1 = circ(Rt + 0.003, phiT, -0.01);
  const m = j1.clone().sub(start).setLength(lens[0]).add(start);
  const out = [m];
  if (thumb === "wrap") {
    let rho = Math.hypot(m.y, m.z);
    let phi = Math.atan2(m.y, m.z);
    for (let i = 1; i < 3; i++) {
      const c = (Rt * Rt + rho * rho - lens[i] * lens[i]) / (2 * Rt * Math.max(1e-5, rho));
      phi -= Math.acos(THREE.MathUtils.clamp(c, -1, 1)) * (pose.tight ?? 1);
      rho = Rt;
      out.push(circ(Rt, phi, -0.012));
    }
  } else if (thumb === "forward" || thumb === "up") {
    const tang = new THREE.Vector3(0, Math.cos(phiT), -Math.sin(phiT));
    let dir: THREE.Vector3;
    if (pose.thumbDir) {
      // Gun-space direction -> anchor frame -> right-hand equivalent.
      anchorMatrix(d.placement, _anchorM);
      dir = new THREE.Vector3(...pose.thumbDir).transformDirection(_anchorM.invert());
      dir.x *= k;
    } else dir = thumb === "forward" ? new THREE.Vector3(-1, 0, 0).addScaledVector(tang, 0.45).normalize() : new THREE.Vector3(-0.35, 0, 0).addScaledVector(tang, 1).normalize();
    const p1 = m.clone().addScaledVector(dir, lens[1]);
    out.push(p1, p1.clone().addScaledVector(dir, lens[2]));
  } else {
    let ang = phiT - Math.PI / 2;
    const p = m.clone();
    for (let i = 1; i < 3; i++) {
      ang -= thumb[i - 1];
      p.addScaledVector(new THREE.Vector3(-0.25, Math.sin(ang), Math.cos(ang)).normalize(), lens[i]);
      out.push(p.clone());
    }
  }
  return out;
}

// ---- Rig instance -----------------------------------------------------------------------

const _hw = new THREE.Matrix4();
const _wrist = new THREE.Vector3();
const _handQ = new THREE.Quaternion();
const _scl = new THREE.Vector3();
const _elbow = new THREE.Vector3();
const _sh = new THREE.Vector3();
const _dU = new THREE.Vector3();
const _dF = new THREE.Vector3();
const _n = new THREE.Vector3();
const _y = new THREE.Vector3();
const _basis = new THREE.Matrix4();
const _qU = new THREE.Quaternion();
const _qF = new THREE.Quaternion();
const _q = new THREE.Quaternion();
const _tw = new THREE.Quaternion();
const _ax = new THREE.Vector3();

/** One skinned two-arm mesh with its own skeleton (shared geometry / material). */
export class ArmsRig {
  readonly object: THREE.Object3D;
  readonly mesh: THREE.SkinnedMesh;
  private readonly bones: THREE.Bone[];
  /** Last good elbow hinge per side (straight arms have none). */
  private readonly hinge: Record<Side, THREE.Vector3> = { R: new THREE.Vector3(0, 1, 0), L: new THREE.Vector3(0, -1, 0) };

  constructor(
    private readonly t: ArmsTemplate,
    material: THREE.Material,
  ) {
    this.object = cloneSkinned(t.scene);
    this.object.name = "fp-arms";
    let mesh: THREE.SkinnedMesh | null = null;
    this.object.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh && !mesh) mesh = o as THREE.SkinnedMesh;
    });
    this.mesh = mesh!;
    this.mesh.material = material;
    this.mesh.frustumCulled = false;
    this.bones = this.mesh.skeleton.bones;
    // Posed by hand in pose() / hide(); their children update from them.
    for (const side of ["L", "R"] as const) {
      this.bones[t.sides[side].upper.index].matrixWorldAutoUpdate = false;
      this.bones[t.sides[side].fore.index].matrixWorldAutoUpdate = false;
    }
    this.object.position.set(0, 0, 0);
    this.object.quaternion.identity();
    this.object.scale.setScalar(1);
  }

  /** Hides one arm (collapses it into its shoulder). */
  hide(side: Side) {
    const r = this.t.sides[side];
    this.bones[r.upper.index].matrixWorld.makeScale(0, 0, 0);
    this.bones[r.fore.index].matrixWorld.makeScale(0, 0, 0);
  }

  /**
   * Poses one arm. `anchorWorld`: the anchor's world matrix; `elbowWorld`: its
   * elbow hint; `shoulder`: where the upper arm comes from (world).
   */
  pose(d: HandAnchorData, anchorWorld: THREE.Matrix4, elbowWorld: THREE.Vector3, shoulder: THREE.Vector3) {
    const rest = this.t.sides[d.side];
    const sol = solveHand(this.t, d);
    const B = this.bones;
    _hw.multiplyMatrices(anchorWorld, sol.hand).decompose(_wrist, _handQ, _scl);

    // Two-bone IK from the shoulder, bending toward the elbow hint. Long
    // guns hold the support hand further out than a human arm reaches: the
    // upper arm (mostly below / behind the view) stretches up to UPPER_STRETCH,
    // and only beyond that does the shoulder slide toward the hand.
    const b = rest.foreLen;
    _dU.subVectors(_wrist, shoulder);
    let dist = _dU.length();
    const a = Math.min(Math.max(rest.upperLen, dist / BEND - b), rest.upperLen * UPPER_STRETCH);
    const reach = (a + b) * 0.985;
    if (dist > reach) {
      _sh.copy(_wrist).addScaledVector(_dU, -reach / dist);
      dist = reach;
    } else _sh.copy(shoulder);
    dist = Math.max(dist, Math.abs(a - b) + 0.01);
    _dU.subVectors(_wrist, _sh).normalize();
    // Bend direction: the hint, perpendicular to shoulder -> wrist.
    _dF.subVectors(elbowWorld, _sh);
    _dF.addScaledVector(_dU, -_dF.dot(_dU));
    if (_dF.lengthSq() < 1e-8) _dF.set(0, -1, 0).addScaledVector(_dU, -_dU.y);
    _dF.normalize();
    const x = (a * a - b * b + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, a * a - x * x));
    _elbow.copy(_sh).addScaledVector(_dU, x).addScaledVector(_dF, h);
    _dU.subVectors(_elbow, _sh).normalize(); // shoulder -> elbow
    _dF.subVectors(_wrist, _elbow).normalize(); // elbow -> wrist
    // Hinge axis from the plane of the two bones.
    _n.crossVectors(_dU, _dF);
    const hinge = this.hinge[d.side];
    if (_n.lengthSq() > 1e-6) hinge.copy(_n.normalize());
    else _n.copy(hinge);
    boneFrame(_dU, _n, rest.upperFrameInv, _qU);
    boneFrame(_dF, _n, rest.foreFrameInv, _qF);

    // The upper arm / forearm world matrices are written directly (the rig
    // sits at the scene origin): the upper arm carries the stretch along its
    // length, the forearm none (a scaled parent would shear it).
    _scl.set(a / rest.upperLen, 1, 1);
    B[rest.upper.index].matrixWorld.compose(_sh, _qU, _scl);
    _scl.set(1, 1, 1);
    B[rest.fore.index].matrixWorld.compose(_elbow, _qF, _scl);
    const hand = B[rest.hand.index];
    hand.quaternion.copy(_qF).invert().multiply(_handQ);

    // Wrist twist about the forearm axis, spread over the twist bones.
    _q.copy(hand.quaternion).multiply(rest.handRestInv);
    _ax.copy(rest.foreAxis);
    const dot = _q.x * _ax.x + _q.y * _ax.y + _q.z * _ax.z;
    let ang = 2 * Math.atan2(dot, _q.w);
    if (ang > Math.PI) ang -= Math.PI * 2;
    if (ang < -Math.PI) ang += Math.PI * 2;
    for (let i = 0; i < 3; i++) {
      _tw.setFromAxisAngle(_ax, (ang * (i + 1)) / 3);
      B[rest.twist[i].index].quaternion.copy(_tw);
    }

    const fq = sol.fingers;
    for (let f = 0; f < FINGERS; f++) {
      for (let i = 0; i < 3; i++) B[rest.fingers[f][i].index].quaternion.fromArray(fq, (f * 3 + i) * 4);
    }
  }
}

/** World rotation whose (long axis, hinge axis) are (dir, n), given the bone's inverse rest frame. */
function boneFrame(dir: THREE.Vector3, n: THREE.Vector3, frameInvQ: THREE.Quaternion, out: THREE.Quaternion) {
  _ax.copy(n).addScaledVector(dir, -n.dot(dir)).normalize();
  _y.crossVectors(_ax, dir);
  _basis.makeBasis(dir, _y, _ax);
  return out.setFromRotationMatrix(_basis).multiply(frameInvQ);
}
