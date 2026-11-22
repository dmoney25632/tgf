import * as THREE from "three";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { soldierMaterial, type ClipName, type SoldierLibrary, type SoldierTemplate } from "./assets";
import { rotateWorld, setWorldQuat, solveTwoBone, wpos, wquat } from "./ik";
import { advancePhase, blendStride, hipYaw, LOCO_CLIPS, locoWeights, MOVING, type LocoClip, type LocoWeights } from "./locomotion";

/**
 * Visual-only, motion-captured soldier body that rides on a procedural
 * Humanoid. The procedural rig keeps running underneath (it owns the
 * hitboxes, the rifle and the muzzle, so gameplay is untouched); this body:
 *
 *  - alive: plays phase-synced locomotion clips (idle / walk / jog / sprint,
 *    crouch idle / walk) by ground speed, turns the hips toward strafes,
 *    pitches torso and head with the aim, adds hit-react clips, and solves
 *    both arms onto the procedural rifle's grips (wrist targets and hand
 *    orientations come straight from the procedural hands), fingers in a
 *    mocap grip;
 *  - downed / most deaths: "puppets" the procedural pose (retargeted per
 *    bone by world rotation), so falls, ground settling and the wounded sit
 *    match the procedural corpse and its dropped rifle;
 *  - falls backwards with the mocap death clip.
 */

export type ProcRig = Record<"pelvis" | "spine" | "head" | "uArmR" | "uArmL" | "fArmR" | "fArmL" | "handR" | "handL" | "thighR" | "thighL" | "shinR" | "shinL" | "footR" | "footL", THREE.Object3D>;

/** Per-frame drive values from the procedural Humanoid (already smoothed). */
export type DriveState = {
  speed: number;
  crouch: number;
  aim: number;
  aimPitch: number;
  /** Travel direction in the body frame (forward / left components). */
  moveF: number;
  moveS: number;
  /** Downed blend (0 standing .. 1 sitting wounded). */
  down: number;
};

export type DeathState = { t: number; groundY: number; yaw0: number; sink: number };

type Pair = { vis: string; proc: keyof ProcRig | null; dir?: "up" | "down" | "rest" };

/** Visual bones in parent-first order, with the procedural bone each one follows when puppeted. */
const PUPPET: Pair[] = [
  { vis: "Bip01", proc: null },
  { vis: "Bip01_Pelvis", proc: "pelvis" },
  { vis: "Bip01_Spine", proc: "pelvis" },
  { vis: "Bip01_R_Thigh", proc: "thighR", dir: "down" },
  { vis: "Bip01_R_Calf", proc: "shinR", dir: "down" },
  { vis: "Bip01_R_Foot", proc: "footR", dir: "rest" },
  { vis: "Bip01_L_Thigh", proc: "thighL", dir: "down" },
  { vis: "Bip01_L_Calf", proc: "shinL", dir: "down" },
  { vis: "Bip01_L_Foot", proc: "footL", dir: "rest" },
  { vis: "Bip01_Spine1", proc: "spine" },
  { vis: "Bip01_Spine2", proc: "spine" },
  { vis: "Bip01_Neck", proc: "spine" },
  { vis: "Bip01_Head", proc: "head" },
  { vis: "Bip01_R_Clavicle", proc: null },
  { vis: "Bip01_R_UpperArm", proc: "uArmR", dir: "down" },
  { vis: "Bip01_R_Forearm", proc: "fArmR", dir: "down" },
  { vis: "Bip01_R_Hand", proc: "handR", dir: "down" },
  { vis: "Bip01_L_Clavicle", proc: null },
  { vis: "Bip01_L_UpperArm", proc: "uArmL", dir: "down" },
  { vis: "Bip01_L_Forearm", proc: "fArmL", dir: "down" },
  { vis: "Bip01_L_Hand", proc: "handL", dir: "down" },
];
/** Child used to measure each bone's direction. */
const CHILD: Record<string, string> = {
  Bip01_R_Thigh: "Bip01_R_Calf", Bip01_R_Calf: "Bip01_R_Foot", Bip01_R_Foot: "Bip01_R_Toe0",
  Bip01_L_Thigh: "Bip01_L_Calf", Bip01_L_Calf: "Bip01_L_Foot", Bip01_L_Foot: "Bip01_L_Toe0",
  Bip01_R_UpperArm: "Bip01_R_Forearm", Bip01_R_Forearm: "Bip01_R_Hand", Bip01_R_Hand: "Bip01_R_Finger2",
  Bip01_L_UpperArm: "Bip01_L_Forearm", Bip01_L_Forearm: "Bip01_L_Hand", Bip01_L_Hand: "Bip01_L_Finger2",
};
const HIT_BONES = /^Bip01_(Spine\d?|Neck|Head|[LR]_Clavicle)\./;

/** Elbow pole hints in the chest frame (x = soldier's left, y up, z forward). */
const POLE_R = new THREE.Vector3(-0.8, -1, -0.25);
const POLE_L = new THREE.Vector3(0.6, -1, -0.15);
const UP = new THREE.Vector3(0, 1, 0);
/** Cull sphere in the Humanoid root's space (the meshes sit in its LOD levels). */
const CULL = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 2.6);

/** Additive hit-react clips (upper body only), built once per library. */
const additive = new WeakMap<SoldierLibrary, Map<ClipName, THREE.AnimationClip>>();
function hitClip(lib: SoldierLibrary, name: "hitChest" | "hitHead") {
  let m = additive.get(lib);
  if (!m) additive.set(lib, (m = new Map()));
  let c = m.get(name);
  const src = lib.clips.get(name);
  if (!c && src) {
    c = new THREE.AnimationClip(`${name}_add`, src.duration, src.tracks.filter((t) => HIT_BONES.test(t.name)).map((t) => t.clone()));
    THREE.AnimationUtils.makeClipAdditive(c);
    m.set(name, c);
  }
  return c ?? null;
}

let avatarCounter = 0;

export class MocapBody {
  /** Container under the Humanoid root (identity, except while playing the death clip). */
  readonly root = new THREE.Group();
  readonly lod0: THREE.SkinnedMesh;
  readonly lod1: THREE.SkinnedMesh;

  private readonly template: SoldierTemplate;
  private readonly palette: { uniform: number; vest: number; helmet: number };
  private readonly mixer: THREE.AnimationMixer;
  private readonly loco = {} as Record<LocoClip, THREE.AnimationAction>;
  private readonly info: SoldierLibrary["info"];
  private readonly death: THREE.AnimationAction;
  private readonly hits: THREE.AnimationAction[] = [];
  private readonly bone = new Map<string, THREE.Bone>();
  /** Per puppet bone: visual container-space rotation when the procedural bone has identity rotation. */
  private readonly align = new Map<string, THREE.Quaternion>();
  /** Visual pelvis offset in the procedural pelvis frame. */
  private readonly hipOffset = new THREE.Vector3();
  private readonly headRest = new THREE.Quaternion();
  private readonly chestRestInv = new THREE.Quaternion();
  private readonly w = {} as LocoWeights;

  private phase = 0;
  private hipYawS = 0;
  private gaitDir = 1;
  private mode: "alive" | "clip" | "puppet" = "alive";

  // Scratch.
  private readonly q1 = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly q3 = new THREE.Quaternion();
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();
  private readonly v4 = new THREE.Vector3();
  private readonly footR = new THREE.Vector3();
  private readonly footL = new THREE.Vector3();
  private readonly footQR = new THREE.Quaternion();
  private readonly footQL = new THREE.Quaternion();
  private readonly m1 = new THREE.Matrix4();
  private readonly rs = new Map<string, THREE.Quaternion>();
  private readonly procRs = {} as Record<keyof ProcRig, THREE.Quaternion>;

  constructor(
    lib: SoldierLibrary,
    look: { uniform: number; vest: number; helmet: number },
    private readonly rig: ProcRig,
    /** Procedural pelvis-origin -> neck-base distance (rig units). */
    procTorso: number,
  ) {
    this.template = lib.templates[avatarCounter++ % lib.templates.length];
    this.palette = { uniform: look.uniform, vest: look.vest, helmet: look.helmet };
    this.info = lib.info;
    const scene = cloneSkinned(this.template.scene) as THREE.Group;
    this.root.name = "mocapSoldier";
    let l0: THREE.SkinnedMesh | null = null, l1: THREE.SkinnedMesh | null = null;
    scene.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.bone.set(o.name, o as THREE.Bone);
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) {
        if (o.name === "lod1") l1 = o as THREE.SkinnedMesh;
        else l0 = o as THREE.SkinnedMesh;
      }
    });
    if (!l0 || !l1) throw new Error("soldier template without lod meshes");
    this.lod0 = l0;
    this.lod1 = l1;
    const mat = soldierMaterial(this.template, look.uniform, look.vest, look.helmet, false);
    for (const m of [this.lod0, this.lod1]) {
      m.material = mat;
      m.castShadow = true;
      m.receiveShadow = true;
      m.boundingSphere = CULL; // any pose, fall or death-clip slide stays inside; never recomputed from bones
      m.removeFromParent(); // the Humanoid's LOD levels hold the meshes; bones stay here
    }
    this.root.add(...scene.children);

    // ---- Rest-pose calibration ------------------------------------------------
    this.root.updateMatrixWorld(true);
    const B = (n: string) => {
      const b = this.bone.get(n);
      if (!b) throw new Error(`soldier rig missing ${n}`);
      return b;
    };
    const bind = new Map<THREE.Bone, THREE.Quaternion>();
    this.bone.forEach((b) => bind.set(b, b.quaternion.clone()));
    // Original (bind) directions for "rest"-aligned bones (feet stay flat).
    const restDir = new Map<string, THREE.Vector3>();
    for (const p of PUPPET) {
      if (p.dir !== "rest") continue;
      restDir.set(p.vis, wpos(B(CHILD[p.vis]), new THREE.Vector3()).sub(wpos(B(p.vis), this.v1)).normalize());
    }
    for (const p of PUPPET) {
      if (!p.proc) continue;
      const b = B(p.vis);
      if (p.dir) {
        const from = wpos(B(CHILD[p.vis]), this.v2).sub(wpos(b, this.v1)).normalize();
        const to = p.dir === "down" ? this.v3.set(0, -1, 0) : this.v3.copy(restDir.get(p.vis)!);
        rotateWorld(b, this.q1.setFromUnitVectors(from, to));
      }
      this.align.set(p.vis, wquat(b, new THREE.Quaternion()));
    }
    bind.forEach((q, b) => b.quaternion.copy(q));
    this.root.updateMatrixWorld(true);
    wquat(B("Bip01_Head"), this.headRest);
    wquat(B("Bip01_Spine2"), this.chestRestInv).invert();
    // Hips sit so that the neck bases coincide (the visual torso is longer, its legs shorter).
    const visTorso = wpos(B("Bip01_Neck"), this.v1).y - wpos(B("Bip01"), this.v2).y;
    this.hipOffset.set(0, procTorso - visTorso, 0);
    for (const p of PUPPET) this.rs.set(p.vis, new THREE.Quaternion());
    for (const k of Object.keys(rig) as (keyof ProcRig)[]) this.procRs[k] = new THREE.Quaternion();

    // ---- Animation ---------------------------------------------------------------
    this.mixer = new THREE.AnimationMixer(this.root);
    const act = (n: ClipName) => {
      const c = lib.clips.get(n);
      if (!c) throw new Error(`missing clip ${n}`);
      return this.mixer.clipAction(c);
    };
    for (const n of LOCO_CLIPS) {
      const a = act(n);
      a.play();
      a.setEffectiveWeight(0);
      if ((MOVING as readonly string[]).includes(n)) a.timeScale = 0; // phase-driven
      else a.time = Math.random() * a.getClip().duration;
      this.loco[n] = a;
    }
    this.death = act("death");
    this.death.setLoop(THREE.LoopOnce, 1);
    this.death.clampWhenFinished = true;
    act("grip").play();
    for (const n of ["hitChest", "hitHead"] as const) {
      const c = hitClip(lib, n);
      if (!c) continue;
      const a = this.mixer.clipAction(c);
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = false;
      this.hits.push(a);
    }
    this.phase = Math.random();
  }

  get templateId() {
    return this.template.id;
  }

  setElite(on: boolean) {
    const m = soldierMaterial(this.template, this.palette.uniform, this.palette.vest, this.palette.helmet, on);
    this.lod0.material = m;
    this.lod1.material = m;
  }

  flinch(head: boolean, strength: number) {
    if (this.mode !== "alive") return;
    const a = this.hits[head ? 1 : 0] ?? this.hits[0];
    if (!a) return;
    a.reset();
    a.setEffectiveWeight(Math.min(1, 0.35 + strength * 0.65));
    a.play();
  }

  /** Starts a death: the mocap clip for backward falls, otherwise the procedural fall is puppeted. */
  die(useClip: boolean) {
    for (const a of this.hits) a.stop();
    if (useClip) {
      this.mode = "clip";
      for (const n of LOCO_CLIPS) this.loco[n].setEffectiveWeight(0);
      this.death.reset();
      this.death.setEffectiveWeight(1);
      this.death.play();
    } else this.mode = "puppet";
  }

  revive() {
    this.mode = "alive";
    this.death.stop();
    this.root.matrixAutoUpdate = true;
    this.root.position.set(0, 0, 0);
    this.root.quaternion.identity();
    this.root.scale.set(1, 1, 1);
    this.root.updateMatrix();
    this.hipYawS = 0;
  }

  /**
   * Alive / downed update. Call after the procedural rig has posed for this
   * frame; `owner` is the Humanoid root (its matrices are refreshed here).
   */
  update(dt: number, s: DriveState, owner: THREE.Object3D) {
    if (this.mode !== "alive") return;
    const w = locoWeights(s.speed, s.crouch, this.w);
    // Travel direction -> hip yaw / gait direction (damped, so 180 turns blend).
    const moving = w.walk + w.jog + w.sprint + w.crouchWalk;
    const hy = hipYaw(Math.atan2(s.moveS, s.moveF));
    const k = 1 - Math.exp(-8 * dt);
    this.hipYawS += (hy.yaw * moving - this.hipYawS) * k;
    if (moving < 0.05) this.gaitDir = 1;
    else this.gaitDir = hy.dir;
    const stride = blendStride(w, this.info);
    this.phase = advancePhase(this.phase, dt, s.speed * this.gaitDir, stride);
    for (const n of LOCO_CLIPS) {
      const a = this.loco[n];
      a.setEffectiveWeight(w[n]);
      if (a.timeScale === 0) a.time = this.phase * a.getClip().duration;
    }
    this.mixer.update(dt);
    owner.updateMatrixWorld(true);
    this.layers(s, owner);
    if (s.down > 0.001) this.puppet(Math.min(1, s.down * 1.15));
  }

  /** Death update (procedural rig already posed by its death solver). */
  updateDeath(dt: number, d: DeathState, owner: THREE.Object3D) {
    if (this.mode === "clip") {
      this.mixer.update(dt);
      // Lie flat on the floor where he stood, whatever the procedural root's topple.
      owner.updateMatrix();
      this.m1.compose(this.v1.set(owner.position.x, d.groundY - d.sink, owner.position.z), this.q1.setFromAxisAngle(UP, d.yaw0), owner.scale);
      this.root.matrixAutoUpdate = false;
      this.root.matrix.copy(owner.matrix).invert().multiply(this.m1);
      this.root.matrixWorldNeedsUpdate = true;
      return;
    }
    if (this.mode === "alive") this.mode = "puppet";
    owner.updateMatrixWorld(true);
    this.puppet(1 - Math.exp(-14 * dt));
  }

  // ---------------------------------------------------------------------------
  // Procedural layers on top of the clips: hips, aim, head, arms onto the rifle.
  // ---------------------------------------------------------------------------
  private layers(s: DriveState, owner: THREE.Object3D) {
    const B = this.bone;
    const pelvis = B.get("Bip01_Pelvis")!, spine1 = B.get("Bip01_Spine1")!, spine2 = B.get("Bip01_Spine2")!, head = B.get("Bip01_Head")!;
    const rootQ = wquat(owner, this.q3);
    const up = this.v1.copy(UP).applyQuaternion(rootQ);
    const right = this.v2.set(1, 0, 0).applyQuaternion(rootQ);
    const a = s.aim, ap = THREE.MathUtils.clamp(s.aimPitch, -0.9, 0.9);
    // Lower body toward the travel direction, torso back to the front.
    const h = this.hipYawS;
    if (Math.abs(h) > 1e-3) {
      rotateWorld(pelvis, this.q1.setFromAxisAngle(up, h));
      rotateWorld(spine1, this.q1.setFromAxisAngle(up, -h * 0.55));
      rotateWorld(spine2, this.q1.setFromAxisAngle(up, -h * 0.45));
    }
    // Crouched: the mocap crouch is a deep, hunched sneak, while the rifle
    // (procedural) sits at a kneeling-firer's height. Straighten the back,
    // lift the hips until the necks line up, and keep the feet planted with
    // leg IK.
    const c = s.crouch;
    if (c > 0.01) {
      const fR = B.get("Bip01_R_Foot")!, fL = B.get("Bip01_L_Foot")!;
      const pR = wpos(fR, this.footR), pL = wpos(fL, this.footL);
      const qR = wquat(fR, this.footQR), qL = wquat(fL, this.footQL);
      rotateWorld(spine1, this.q1.setFromAxisAngle(right, -0.32 * c));
      rotateWorld(spine2, this.q1.setFromAxisAngle(right, -0.22 * c));
      const procNeck = wpos(this.rig.head, this.v3).y;
      const visNeck = wpos(B.get("Bip01_Neck")!, this.v4).y;
      const lift = THREE.MathUtils.clamp(procNeck - visNeck, -0.05, 0.4) * c;
      const bip = B.get("Bip01")!;
      bip.position.y += lift / Math.max(0.01, owner.scale.y);
      bip.updateMatrixWorld(true);
      const knee = this.v4.set(Math.sin(h), 0, Math.cos(h)).applyQuaternion(rootQ);
      solveTwoBone(B.get("Bip01_R_Thigh")!, B.get("Bip01_R_Calf")!, fR, pR, knee, qR);
      solveTwoBone(B.get("Bip01_L_Thigh")!, B.get("Bip01_L_Calf")!, fL, pL, knee, qL);
    }
    // Torso follows the aim pitch; shouldered, it squares up a little.
    rotateWorld(spine1, this.q1.setFromAxisAngle(right, -ap * 0.18 * (0.4 + a)));
    rotateWorld(spine2, this.q1.setFromAxisAngle(right, -ap * 0.18 * (0.4 + a)));
    // Head looks along the aim.
    const want = this.q2.setFromAxisAngle(this.v3.set(1, 0, 0), -ap).premultiply(rootQ).multiply(this.headRest);
    const cur = wquat(head, this.q1);
    setWorldQuat(head, cur.slerp(want, 0.35 + 0.55 * a));

    // Arms onto the procedural rifle grips.
    const chest = wquat(spine2, this.q3).multiply(this.chestRestInv);
    const R = this.rig;
    R.handR.updateWorldMatrix(true, false);
    R.handL.updateWorldMatrix(true, false);
    const handQ = (proc: THREE.Object3D, vis: string) => wquat(proc, this.q1).multiply(this.align.get(vis)!);
    solveTwoBone(B.get("Bip01_R_UpperArm")!, B.get("Bip01_R_Forearm")!, B.get("Bip01_R_Hand")!, wpos(R.handR, this.v1), this.v2.copy(POLE_R).applyQuaternion(chest), handQ(R.handR, "Bip01_R_Hand"), B.get("Bip01_R_Clavicle")!);
    solveTwoBone(B.get("Bip01_L_UpperArm")!, B.get("Bip01_L_Forearm")!, B.get("Bip01_L_Hand")!, wpos(R.handL, this.v1), this.v2.copy(POLE_L).applyQuaternion(chest), handQ(R.handL, "Bip01_L_Hand"), B.get("Bip01_L_Clavicle")!);
  }

  // ---------------------------------------------------------------------------
  // Puppet: visual bones take the procedural bones' rotations (container space).
  // k: blend from the current pose (0) to the puppet pose (1).
  // ---------------------------------------------------------------------------
  private puppet(k: number) {
    const R = this.rig, P = this.procRs;
    // Procedural rotations relative to the Humanoid root (bones are its children).
    P.pelvis.copy(R.pelvis.quaternion);
    P.spine.multiplyQuaternions(P.pelvis, R.spine.quaternion);
    P.head.multiplyQuaternions(P.spine, R.head.quaternion);
    P.thighR.multiplyQuaternions(P.pelvis, R.thighR.quaternion);
    P.shinR.multiplyQuaternions(P.thighR, R.shinR.quaternion);
    P.footR.multiplyQuaternions(P.shinR, R.footR.quaternion);
    P.thighL.multiplyQuaternions(P.pelvis, R.thighL.quaternion);
    P.shinL.multiplyQuaternions(P.thighL, R.shinL.quaternion);
    P.footL.multiplyQuaternions(P.shinL, R.footL.quaternion);
    P.uArmR.multiplyQuaternions(P.spine, R.uArmR.quaternion);
    P.fArmR.multiplyQuaternions(P.uArmR, R.fArmR.quaternion);
    P.handR.multiplyQuaternions(P.fArmR, R.handR.quaternion);
    P.uArmL.multiplyQuaternions(P.spine, R.uArmL.quaternion);
    P.fArmL.multiplyQuaternions(P.uArmL, R.fArmL.quaternion);
    P.handL.multiplyQuaternions(P.fArmL, R.handL.quaternion);

    const B = this.bone;
    const bip = B.get("Bip01")!;
    // Hips: procedural pelvis position + offset in its frame (container == root space while puppeting).
    const hp = this.v1.copy(this.hipOffset).applyQuaternion(P.pelvis).add(R.pelvis.position);
    bip.position.lerp(hp, k);
    for (const p of PUPPET) {
      const b = B.get(p.vis)!;
      const parent = b.parent as THREE.Object3D;
      const prs = parent === this.root ? this.q2.identity() : this.rs.get(parent.name) ?? this.q2.identity();
      if (p.proc) {
        const target = this.q1.multiplyQuaternions(P[p.proc], this.align.get(p.vis)!);
        // local = parent^-1 * target
        this.q3.copy(prs).invert().multiply(target);
        b.quaternion.slerp(this.q3, k);
      }
      this.rs.get(p.vis)!.multiplyQuaternions(prs, b.quaternion);
    }
    this.root.updateMatrixWorld(true);
  }
}
