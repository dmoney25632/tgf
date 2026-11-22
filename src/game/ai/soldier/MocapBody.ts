import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { ghillieMaterial, lensMaterial, uberMaterial } from "../humanoid/materials";
import { CULL, partsGeometry, soldierMaterial, type ClipName, type FaceLook, type SoldierAvatar, type SoldierLibrary } from "./assets";
import { soldierGear, type GearPalette } from "./gear";
import { hash32, partSources, type AvatarId, type Part, type SoldierIdentity } from "./identity";
import { gripAnchor, gripSolve, gripTemplate, rotateWorld, setWorldQuat, solveTwoBone, wpos, wquat } from "./ik";
import type { TpGun } from "../humanoid/rifle";
import type { ArmsTemplate } from "../../weapons/viewmodel/arms/rig";
import type { HandAnchorData } from "../../weapons/viewmodel/arms/anchor";
import { advancePhase, blendStride, hipYaw, LOCO_CLIPS, locoWeights, MOVING, type LocoClip, type LocoWeights } from "./locomotion";

/**
 * Visual-only, motion-captured soldier body that rides on a procedural
 * Humanoid. The procedural rig keeps running underneath (it owns the
 * hitboxes, the rifle and the muzzle, so gameplay is untouched); this body:
 *
 *  - is assembled from Rocketbox parts (uniform, face, helmet, plate
 *    carrier, possibly from different avatars over the shared skeleton) plus
 *    procedural kit (see gear.ts), with per-soldier build (torso and limb
 *    bulk, height) applied at skinning time;
 *  - alive: plays phase-synced locomotion clips (idle / walk / jog / sprint,
 *    crouch idle / walk) by ground speed, turns the hips toward strafes,
 *    pitches torso and head with the aim, breathes, shifts its weight at
 *    rest with the feet planted (and steps when turning on the spot), adds
 *    hit-react clips, and solves both arms onto the procedural rifle's grips
 *    (elbows flare with the aim), fingers in a mocap grip;
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
  /** Recoil spring (0 at rest, ~1 right after a shot). */
  kick: number;
  /** One-off action and its progress (0..1): magazine / shell reload, grenade throw. */
  action: "none" | "reload" | "throw";
  actionT: number;
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

/**
 * Where each procedural bone's origin sits on the visual body (visual bone
 * it rides on + offset from that bone's bind position), for attachments
 * authored against the procedural rig (the Juggernaut's bolt-on plates).
 */
const SOCKETS: Partial<Record<keyof ProcRig, [string, string, [number, number, number]]>> = {
  head: ["Bip01_Head", "Bip01_Head", [0, -0.04, 0.004]],
  spine: ["Bip01_Spine2", "Bip01_Neck", [0, -0.44, 0.012]],
  pelvis: ["Bip01_Pelvis", "Bip01_Pelvis", [0, 0.08, 0]],
  uArmR: ["Bip01_R_UpperArm", "Bip01_R_UpperArm", [0, 0, 0]],
  uArmL: ["Bip01_L_UpperArm", "Bip01_L_UpperArm", [0, 0, 0]],
  thighR: ["Bip01_R_Thigh", "Bip01_R_Thigh", [0, 0, 0]],
  thighL: ["Bip01_L_Thigh", "Bip01_L_Thigh", [0, 0, 0]],
  shinR: ["Bip01_R_Calf", "Bip01_R_Calf", [0, 0, 0]],
  shinL: ["Bip01_L_Calf", "Bip01_L_Calf", [0, 0, 0]],
};

/** Elbow pole hints in the chest frame (x = soldier's left, y up, z forward): low ready / shouldered. */
const POLE_R_LOW = new THREE.Vector3(-0.75, -1, -0.3);
const POLE_R_AIM = new THREE.Vector3(-1, -0.42, -0.12);
const POLE_L_LOW = new THREE.Vector3(0.55, -1, -0.12);
const POLE_L_AIM = new THREE.Vector3(0.45, -1, 0.05);
const UP = new THREE.Vector3(0, 1, 0);
const FWD = new THREE.Vector3(0, 0, 1);

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

const _off = new THREE.Matrix4();
const _sc = new THREE.Matrix4();

/**
 * Skeleton with a per-joint bulk scale applied in the joint's own frame at
 * skinning time (so children never inherit it: no shear, no drift), for
 * thicker / slimmer torsos and limbs without touching the animation.
 */
class BuildSkeleton extends THREE.Skeleton {
  constructor(bones: THREE.Bone[], inverses: THREE.Matrix4[], readonly bulk: (THREE.Vector3 | null)[]) {
    super(bones, inverses);
  }
  override update() {
    const bones = this.bones, inv = this.boneInverses, out = this.boneMatrices!;
    for (let i = 0; i < bones.length; i++) {
      const s = this.bulk[i];
      _off.multiplyMatrices(bones[i].matrixWorld, s ? _sc.makeScale(s.x, s.y, s.z) : _sc.identity());
      _off.multiply(inv[i]);
      _off.toArray(out, i * 16);
    }
    if (this.boneTexture) this.boneTexture.needsUpdate = true;
  }
}

/** A hand anchor (gun frame) and its finger solve. */
type GripSet = { m: THREE.Matrix4; d: HandAnchorData };
/** Real third-person gun in the hands (see setWeapon). */
type WeaponState = {
  gun: THREE.Object3D;
  tp: TpGun;
  R: GripSet;
  L: GripSet;
  /** Support hand on the magazine (gun frame, magazine seated); null: no detachable magazine. */
  grab: GripSet | null;
  /** Support hand round a grenade (hand frame anchor, used off the gun). */
  nade: GripSet;
  /** Skinned magazine meshes on the gun (hidden while the magazine is out). */
  gunMags: THREE.Object3D[];
  /** The magazine in the support hand, and the spent one falling away. */
  handMag: THREE.Mesh | null;
  dropMag: THREE.Mesh | null;
  drop: { t: number; p: THREE.Vector3; q: THREE.Quaternion; spin: THREE.Vector3; floor: number };
  grenade: THREE.Mesh;
};

/** Grenade in the throwing hand (shared). */
let nadeGeo: THREE.BufferGeometry | null = null;
let nadeMat: THREE.Material | null = null;
/** World floor height under (x, z) at or below maxY (set by the game from its collision world); null: the soldier's feet. */
let floorProbe: ((x: number, z: number, maxY: number) => number) | null = null;
export function setSoldierFloor(fn: typeof floorProbe) {
  floorProbe = fn;
}

function grenadeMesh() {
  if (!nadeGeo) {
    const body = new THREE.SphereGeometry(0.031, 10, 8).scale(1, 1.12, 1);
    const fuze = new THREE.CylinderGeometry(0.01, 0.012, 0.028, 8).translate(0, 0.042, 0);
    const lever = new THREE.BoxGeometry(0.008, 0.05, 0.012).translate(0.018, 0.02, 0);
    nadeGeo = mergeGeometries([body.toNonIndexed(), fuze.toNonIndexed(), lever.toNonIndexed()])!;
    nadeMat = new THREE.MeshStandardMaterial({ color: 0x3c4430, roughness: 0.7, metalness: 0.2 });
  }
  const m = new THREE.Mesh(nadeGeo, nadeMat!);
  m.name = "grenade";
  m.matrixAutoUpdate = false;
  m.visible = false;
  return m;
}

/** Grenade throw keys (u, chest point, fingers dir, palm dir), chest frame: x left, y up, z forward. */
const THROW_KEYS: [number, [number, number, number], [number, number, number], [number, number, number]][] = [
  [0.14, [0.08, -0.28, 0.17], [0, -1, 0], [0, 0, -1]],
  [0.2, [0.1, -0.24, 0.17], [0, -1, 0.2], [0, 0.2, -1]],
  [0.5, [0.32, 0.3, -0.16], [0, 0.7, -0.7], [0, 0.7, 0.7]],
  [0.6, [0.14, 0.34, 0.52], [0, 0.4, 1], [0, 0.6, -0.4]],
  [0.76, [-0.04, -0.04, 0.4], [0, -0.6, 0.8], [0, -1, -0.6]],
];

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

type FootLock = { pos: THREE.Vector3; q: THREE.Quaternion; held: boolean; step: number; from: THREE.Vector3 };

const knitFor = (id: SoldierIdentity, pal: GearPalette) => new THREE.Color(0x232422).lerp(new THREE.Color(pal.uniform), hash32(id.tone) % 3 === 0 ? 0.35 : 0.12).getHex();

export class MocapBody {
  /** Container under the Humanoid root (identity, except while playing the death clip). */
  readonly root = new THREE.Group();
  /** Near / mid LOD meshes (the Humanoid's LOD levels hold them; bones stay under root). */
  readonly near = new THREE.Group();
  readonly mid = new THREE.Group();

  private readonly rigRoot = new THREE.Group();
  private readonly skins: { mesh: THREE.SkinnedMesh; avatar: SoldierAvatar; face: FaceLook }[] = [];
  private readonly palette: GearPalette;
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
  private readonly height: number;
  private readonly sockets = new Map<keyof ProcRig, THREE.Object3D>();
  private readonly bindWorld = new Map<string, THREE.Matrix4>();

  private phase = 0;
  private hipYawS = 0;
  private gaitDir = 1;
  private mode: "alive" | "clip" | "puppet" = "alive";
  // Life: breathing, exertion, idle weight shift, planted feet.
  private time = 0;
  private breath = 0;
  private exertion = 0;
  private settle = 0;
  private readonly style: { flare: number; sway: number; breathRate: number; stance: number };
  private readonly locks: [FootLock, FootLock];

  // Scratch.
  private readonly q1 = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly q3 = new THREE.Quaternion();
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();
  private readonly v4 = new THREE.Vector3();
  private readonly v5 = new THREE.Vector3();
  private readonly footR = new THREE.Vector3();
  private readonly footL = new THREE.Vector3();
  private readonly footQR = new THREE.Quaternion();
  private readonly footQL = new THREE.Quaternion();
  private readonly m1 = new THREE.Matrix4();
  private readonly rs = new Map<string, THREE.Quaternion>();
  private readonly procRs = {} as Record<keyof ProcRig, THREE.Quaternion>;

  // Real third-person gun: gripping hands (fp finger solver on this rig), magazine and grenade handling.
  private readonly grip: ArmsTemplate | null;
  private readonly fingers: Record<"R" | "L", THREE.Bone[]> = { R: [], L: [] };
  private weapon: WeaponState | null = null;
  /**
   * Gun-frame offset that seats the real gun's butt at this body's shoulder
   * (the rifle pose comes from the procedural rig, whose shoulders sit
   * elsewhere). Humanoid adds it to the rifle bone every frame.
   */
  readonly gunFix = new THREE.Vector3();
  /** The part of gunFix already on the rifle bone this frame (Humanoid applies gunFix before the update). */
  readonly gunApplied = new THREE.Vector3();
  private readonly fq = new Float32Array(60);
  private readonly mA = new THREE.Matrix4();
  private readonly mB = new THREE.Matrix4();
  private readonly mC = new THREE.Matrix4();
  private readonly pA = new THREE.Vector3();
  private readonly pB = new THREE.Vector3();
  private readonly qA = new THREE.Quaternion();
  private readonly qB = new THREE.Quaternion();
  private readonly sA = new THREE.Vector3();

  constructor(
    lib: SoldierLibrary,
    avatars: Map<AvatarId, SoldierAvatar>,
    readonly identity: SoldierIdentity,
    palette: GearPalette,
    private readonly rig: ProcRig,
    /** Procedural pelvis-origin -> neck-base distance (rig units). */
    procTorso: number,
    seed: number,
  ) {
    this.palette = { ...palette };
    this.info = lib.info;
    const base = avatars.get(identity.body);
    if (!base) throw new Error(`avatar ${identity.body} not loaded`);
    const female = base.meta.sex === "f";
    this.root.name = "mocapSoldier";
    this.root.add(this.rigRoot);
    this.height = identity.height;
    this.rigRoot.scale.setScalar(this.height);

    // ---- Skeleton: the body avatar's rig, cloned ---------------------------------
    const bip = base.rootBone.clone(true);
    this.rigRoot.add(bip);
    bip.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.bone.set(o.name, o as THREE.Bone);
    });
    const bones = base.joints.map((n) => {
      const b = this.bone.get(n);
      if (!b) throw new Error(`soldier rig missing ${n}`);
      return b;
    });
    const bulk = base.joints.map((n) => {
      const torso = /Spine/.test(n) ? identity.width : /(Clavicle|UpperArm|Forearm|Thigh|Calf)$/.test(n) ? identity.limbs : 1;
      // Biped joints run along local X: scale the thickness only.
      return torso === 1 ? null : new THREE.Vector3(1, torso, torso);
    });
    const skeleton = new BuildSkeleton(bones, base.boneInverses.slice(), bulk);
    base.joints.forEach((n, i) => this.bindWorld.set(n, base.boneInverses[i].clone().invert()));
    // Finger solver template from this rig's bind pose (before any animation touches the bones).
    this.grip = gripTemplate((n) => this.bindWorld.get(n), (n) => this.bone.get(n));
    for (const S of ["R", "L"] as const) {
      for (let f = 0; f < 5; f++) for (const k of ["", "1", "2"]) {
        const b = this.bone.get(`Bip01_${S}_Finger${f}${k}`);
        if (b) this.fingers[S].push(b);
      }
    }
    const bindPos = (n: string) => new THREE.Vector3().setFromMatrixPosition(this.bindWorld.get(n) ?? new THREE.Matrix4());

    // ---- Meshes: one per source avatar (its parts merged), per LOD ------------------
    const sources = partSources(identity);
    const groups = new Map<AvatarId, Part[]>();
    for (const [part, aid] of Object.entries(sources) as [Part, AvatarId | null][]) {
      if (!aid) continue;
      const list = groups.get(aid) ?? [];
      list.push(part);
      groups.set(aid, list);
    }
    const knit = knitFor(identity, palette);
    const skinned = (g: THREE.BufferGeometry, mat: THREE.Material, shadow: boolean) => {
      const m = new THREE.SkinnedMesh(g, mat);
      m.bind(skeleton, new THREE.Matrix4());
      m.boundingSphere = CULL; // any pose, fall or death-clip slide stays inside; never recomputed from bones
      m.frustumCulled = true;
      m.castShadow = shadow;
      m.receiveShadow = true;
      return m;
    };
    for (const [aid, parts] of groups) {
      const av = avatars.get(aid);
      if (!av) throw new Error(`avatar ${aid} not loaded`);
      const hasHead = parts.includes("head");
      const face: FaceLook = { tone: identity.tone, beard: hasHead ? identity.beard : 0, balaclava: hasHead && identity.balaclava, knit: hasHead && identity.balaclava ? knit : 0 };
      const mat = soldierMaterial(av, palette, face, false);
      for (const lod of [0, 1] as const) {
        const m = skinned(partsGeometry(av, parts, lod), mat, true);
        (lod === 0 ? this.near : this.mid).add(m);
        this.skins.push({ mesh: m, avatar: av, face });
      }
    }
    const gear = soldierGear(identity, palette, female, base.joints, bindPos);
    const uber = uberMaterial(0xb08a6a);
    if (gear.kit[0]) this.near.add(skinned(gear.kit[0], uber, true));
    if (gear.kit[1]) this.mid.add(skinned(gear.kit[1], uber, true));
    if (gear.lens) this.near.add(skinned(gear.lens.geo, lensMaterial(gear.lens.kind), false));
    if (gear.ghillie) {
      const gm = ghillieMaterial();
      this.near.add(skinned(gear.ghillie, gm, false));
      this.mid.add(skinned(gear.ghillie, gm, false));
    }

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
    const r = (k: number) => hash32(seed * 7919 + k) / 4294967296;
    for (const n of LOCO_CLIPS) {
      const a = act(n);
      a.play();
      a.setEffectiveWeight(0);
      if ((MOVING as readonly string[]).includes(n)) a.timeScale = 0; // phase-driven
      else {
        a.time = r(n.length) * a.getClip().duration;
        a.timeScale = 0.9 + r(n.length + 9) * 0.2;
      }
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
    this.phase = r(1);
    this.time = r(2) * 100;
    this.style = { flare: (r(3) - 0.5) * 0.5, sway: 0.6 + r(4) * 0.8, breathRate: 0.85 + r(5) * 0.3, stance: (r(6) - 0.5) * 0.04 };
    const lock = (): FootLock => ({ pos: new THREE.Vector3(), q: new THREE.Quaternion(), held: false, step: 1, from: new THREE.Vector3() });
    this.locks = [lock(), lock()];
  }

  /** Visual bone a procedural bone's attachments should ride on (created on demand). */
  socket(proc: keyof ProcRig): THREE.Object3D | null {
    let s = this.sockets.get(proc);
    if (s) return s;
    const def = SOCKETS[proc];
    const bone = def && this.bone.get(def[0]);
    const anchor = def && this.bindWorld.get(def[1]);
    const boneBind = def && this.bindWorld.get(def[0]);
    const align = def && this.align.get(def[0]);
    if (!def || !bone || !anchor || !boneBind || !align) return null;
    s = new THREE.Object3D();
    s.name = `socket_${proc}`;
    // Position: the anchor in the bone's bind frame; rotation: the procedural bone's frame.
    const p = new THREE.Vector3().setFromMatrixPosition(anchor).add(new THREE.Vector3(...def[2]));
    const inv = boneBind.clone().invert();
    s.position.copy(p.applyMatrix4(inv));
    // Puppeting maps procQ * align = visQ, so the procedural frame is visQ * align^-1.
    s.quaternion.copy(align).invert();
    bone.add(s);
    this.sockets.set(proc, s);
    return s;
  }

  setElite(on: boolean) {
    for (const s of this.skins) s.mesh.material = soldierMaterial(s.avatar, this.palette, s.face, on);
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
    // The rifle falls on its own (Humanoid.die): put back what an action had taken off it.
    const W = this.weapon;
    if (W) {
      for (const m of W.gunMags) m.visible = true;
      if (W.handMag) W.handMag.visible = false;
      W.grenade.visible = false;
    }
    for (const l of this.locks) l.held = false;
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
    for (const l of this.locks) l.held = false;
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
    // Breathing: faster and deeper after running, easing back over ~10 s.
    this.time += dt;
    const exTarget = w.sprint + w.jog * 0.55 + w.walk * 0.15;
    this.exertion += (exTarget - this.exertion) * (1 - Math.exp(-(exTarget > this.exertion ? 0.6 : 0.12) * dt));
    this.breath += dt * Math.PI * 2 * this.style.breathRate * (0.26 + 0.34 * this.exertion);
    // Standing still: settle into the idle weight shift / planted feet.
    const still = w.idle + w.crouchIdle * 0.5;
    this.settle += (still - this.settle) * (1 - Math.exp(-5 * dt));
    this.mixer.update(dt);
    owner.updateMatrixWorld(true);
    this.layers(dt, s, owner);
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
  // Procedural layers on top of the clips: hips, life, aim, head, legs, arms.
  // ---------------------------------------------------------------------------
  private layers(dt: number, s: DriveState, owner: THREE.Object3D) {
    const B = this.bone;
    const pelvis = B.get("Bip01_Pelvis")!, spine1 = B.get("Bip01_Spine1")!, spine2 = B.get("Bip01_Spine2")!, head = B.get("Bip01_Head")!;
    const bip = B.get("Bip01")!;
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
    // Feet as the clips put them (legs are re-solved below when the hips move).
    const fR = B.get("Bip01_R_Foot")!, fL = B.get("Bip01_L_Foot")!;
    const pR = wpos(fR, this.footR), pL = wpos(fL, this.footL);
    const qR = wquat(fR, this.footQR), qL = wquat(fL, this.footQL);
    const scale = Math.max(0.01, owner.scale.y * this.height);
    let legsIK = false;

    // Crouched: the mocap crouch is a deep, hunched sneak, while the rifle
    // (procedural) sits at a kneeling-firer's height. Straighten the back,
    // lift the hips until the necks line up, and keep the feet planted.
    const c = s.crouch;
    if (c > 0.01) {
      rotateWorld(spine1, this.q1.setFromAxisAngle(right, -0.32 * c));
      rotateWorld(spine2, this.q1.setFromAxisAngle(right, -0.22 * c));
      const procNeck = wpos(this.rig.head, this.v3).y;
      const visNeck = wpos(B.get("Bip01_Neck")!, this.v4).y;
      const lift = THREE.MathUtils.clamp(procNeck - visNeck, -0.05, 0.4) * c;
      bip.position.y += lift / scale;
      legsIK = true;
    }
    // At rest: a slow weight shift from foot to foot (hips sway and roll a
    // little, feet stay put) and a per-soldier stance.
    const st = this.settle * (1 - c);
    if (st > 0.01) {
      const t = this.time * 0.42 * this.style.sway;
      const shift = (Math.sin(t) * 0.75 + Math.sin(t * 2.3 + 1.1) * 0.25) * 0.016 * st + this.style.stance * st;
      bip.position.x += shift / scale; // Bip01 lives in the (unrotated) body frame: +X is the soldier's left
      bip.position.y -= Math.abs(shift) * 0.25 / scale;
      rotateWorld(pelvis, this.q1.setFromAxisAngle(this.v4.set(0, 0, 1).applyQuaternion(rootQ), -shift * 2.2));
      rotateWorld(spine1, this.q1.setFromAxisAngle(this.v4.set(0, 0, 1).applyQuaternion(rootQ), shift * 1.6));
      legsIK = true;
    }
    bip.updateMatrixWorld(true);

    // Breathing: chest rises, shoulders lift.
    const br = Math.sin(this.breath) * (0.6 + 0.9 * this.exertion);
    rotateWorld(spine1, this.q1.setFromAxisAngle(right, -0.008 * br));
    rotateWorld(spine2, this.q1.setFromAxisAngle(right, -0.012 * br));
    const fwd = this.v4.copy(FWD).applyQuaternion(rootQ);
    rotateWorld(B.get("Bip01_L_Clavicle")!, this.q1.setFromAxisAngle(fwd, 0.018 * br));
    rotateWorld(B.get("Bip01_R_Clavicle")!, this.q1.setFromAxisAngle(fwd, -0.018 * br));

    // Torso follows the aim pitch; shouldered, it squares up and leans in a little.
    rotateWorld(spine1, this.q1.setFromAxisAngle(right, -ap * 0.18 * (0.4 + a) + 0.03 * a));
    rotateWorld(spine2, this.q1.setFromAxisAngle(right, -ap * 0.18 * (0.4 + a) + 0.02 * a));
    // Head looks along the aim (cheek weld when shouldered).
    const want = this.q2.setFromAxisAngle(this.v3.set(1, 0, 0), -ap + 0.1 * a).premultiply(rootQ).multiply(this.headRest);
    const cur = wquat(head, this.q1);
    setWorldQuat(head, cur.slerp(want, 0.35 + 0.55 * a));

    // Actions and recoil on the torso: the shot rocks the shoulder back, a
    // throw winds the trunk up and uncoils it, a reload dips the head to the magazine.
    if (this.weapon) {
      const rt = this.v5.set(1, 0, 0).applyQuaternion(rootQ);
      const upw = this.v4.set(0, 1, 0).applyQuaternion(rootQ);
      const kk = Math.min(1.5, Math.max(0, s.kick));
      if (kk > 0.001) {
        rotateWorld(spine2, this.q1.setFromAxisAngle(upw, -0.05 * kk));
        rotateWorld(spine2, this.q1.setFromAxisAngle(rt, -0.03 * kk));
      }
      const u = s.actionT;
      if (s.action === "throw") {
        const wind = smoothstep(0.15, 0.5, u) * (1 - smoothstep(0.5, 0.62, u));
        const through = smoothstep(0.52, 0.64, u) * (1 - smoothstep(0.72, 1, u));
        const twist = 0.5 * wind - 0.35 * through;
        rotateWorld(spine1, this.q1.setFromAxisAngle(upw, twist * 0.45));
        rotateWorld(spine2, this.q1.setFromAxisAngle(upw, twist * 0.55));
        rotateWorld(spine2, this.q1.setFromAxisAngle(rt, -0.12 * wind + 0.15 * through));
      } else if (s.action === "reload") {
        const look = smoothstep(0.05, 0.2, u) * (1 - smoothstep(0.8, 1, u));
        rotateWorld(head, this.q1.setFromAxisAngle(rt, 0.38 * look));
        rotateWorld(head, this.q1.setFromAxisAngle(upw, 0.15 * look));
      }
    }

    // Legs: planted feet at rest (with a step when the body turns over them), clip feet otherwise.
    this.plantFeet(dt, st, pR, pL, qR, qL, owner);
    if (legsIK || this.locks[0].held || this.locks[1].held) {
      const knee = this.v4.set(Math.sin(h), 0, Math.cos(h)).applyQuaternion(rootQ);
      solveTwoBone(B.get("Bip01_R_Thigh")!, B.get("Bip01_R_Calf")!, fR, pR, knee, qR);
      solveTwoBone(B.get("Bip01_L_Thigh")!, B.get("Bip01_L_Calf")!, fL, pL, knee, qL);
    }

    // Arms onto the procedural rifle grips. Elbows tuck at the low ready and
    // come up / out when the rifle is shouldered, more so aiming low.
    const chest = wquat(spine2, this.q3).multiply(this.chestRestInv);
    if (this.weapon && this.grip) {
      this.gripArms(dt, s, chest, owner);
      return;
    }
    const R = this.rig;
    R.handR.updateWorldMatrix(true, false);
    R.handL.updateWorldMatrix(true, false);
    const handQ = (proc: THREE.Object3D, vis: string) => wquat(proc, this.q1).multiply(this.align.get(vis)!);
    const flare = THREE.MathUtils.clamp(a * (0.8 + this.style.flare) - ap * 0.3, 0, 1.2);
    const poleR = this.v2.copy(POLE_R_LOW).lerp(POLE_R_AIM, flare).applyQuaternion(chest);
    solveTwoBone(B.get("Bip01_R_UpperArm")!, B.get("Bip01_R_Forearm")!, B.get("Bip01_R_Hand")!, wpos(R.handR, this.v1), poleR, handQ(R.handR, "Bip01_R_Hand"), B.get("Bip01_R_Clavicle")!);
    const poleL = this.v2.copy(POLE_L_LOW).lerp(POLE_L_AIM, Math.min(1, a)).applyQuaternion(chest);
    solveTwoBone(B.get("Bip01_L_UpperArm")!, B.get("Bip01_L_Forearm")!, B.get("Bip01_L_Hand")!, wpos(R.handL, this.v1), poleL, handQ(R.handL, "Bip01_L_Hand"), B.get("Bip01_L_Clavicle")!);
  }

  /**
   * Hands onto a real third-person gun: `gun` is the rifle bone, `tp` the
   * model (anchors in its frame), `gunMags` the skinned magazine meshes on the
   * gun. null: back to the procedural rifle's grips (mocap grip clip fingers).
   */
  setWeapon(gun: THREE.Object3D | null, tp: TpGun | null, gunMags: THREE.Object3D[] = []) {
    const old = this.weapon;
    if (old) {
      old.handMag?.removeFromParent();
      old.dropMag?.removeFromParent();
      old.grenade.removeFromParent();
      for (const m of old.gunMags) m.visible = true;
    }
    this.weapon = null;
    if (!gun || !tp || !this.grip) return;
    const set = (m: THREE.Matrix4, a: { side: "L" | "R"; pose: TpGun["info"]["gripR"]["pose"] }): GripSet => ({ m, d: gripAnchor(a.side, a.pose) });
    const loose = () => {
      if (!tp.mag) return null;
      const m = new THREE.Mesh(tp.mag, tp.material);
      m.matrixAutoUpdate = false;
      m.visible = false;
      m.castShadow = true;
      this.near.add(m);
      return m;
    };
    const grenade = grenadeMesh();
    this.near.add(grenade);
    this.weapon = {
      gun,
      tp,
      R: set(tp.gripR, tp.info.gripR),
      L: set(tp.gripL, tp.info.gripL),
      grab: tp.magGrab && tp.info.mag?.grab ? set(tp.magGrab, tp.info.mag.grab) : null,
      nade: { m: new THREE.Matrix4(), d: gripAnchor("L", { r: 0.032, thumb: "wrap", fingers: ["wrap", "wrap", "wrap", "wrap"], tight: 0.9, phi0: -40 }) },
      gunMags,
      handMag: loose(),
      dropMag: loose(),
      drop: { t: -1, p: new THREE.Vector3(), q: new THREE.Quaternion(), spin: new THREE.Vector3(), floor: 0 },
      grenade,
    };
  }

  /** World hand-bone transform for a hand on `anchorW` with solve `sol` (into pA / qA when out is A). */
  private handOn(anchorW: THREE.Matrix4, sol: { hand: THREE.Matrix4 }, p: THREE.Vector3, q: THREE.Quaternion) {
    this.mC.multiplyMatrices(anchorW, sol.hand).decompose(p, q, this.sA);
  }

  /** IK one arm so its hand bone lands on (p, q); fingers from `fa` (blended toward `fb` by k). */
  private reachArm(side: "R" | "L", p: THREE.Vector3, q: THREE.Quaternion, pole: THREE.Vector3, fa: Float32Array, fb: Float32Array | null, k: number) {
    const B = this.bone;
    const n = `Bip01_${side}_`;
    solveTwoBone(B.get(n + "UpperArm")!, B.get(n + "Forearm")!, B.get(n + "Hand")!, p, pole, q, B.get(n + "Clavicle")!, side === "L" ? 0.13 : 0.08); // the support shoulder rolls forward to reach the handguard
    const bones = this.fingers[side];
    for (let i = 0; i < bones.length; i++) {
      bones[i].quaternion.fromArray(fa, i * 4);
      if (fb && k > 0) bones[i].quaternion.slerp(this.q2.fromArray(fb, i * 4), k);
    }
    B.get(n + "Hand")!.updateMatrixWorld(true);
  }

  /**
   * Both hands on the real gun's anchors (strong hand on the pistol grip,
   * trigger finger in; support hand wrapped on the handguard / pump / fore
   * grip), with the support hand taken off for the actions: magazine out,
   * spent one dropped, fresh one from the vest, seated and slapped (or shells
   * thumbed in one by one), and a grenade from the vest thrown off-hand.
   */
  private gripArms(dt: number, s: DriveState, chest: THREE.Quaternion, owner: THREE.Object3D) {
    const W = this.weapon!;
    const T = this.grip!;
    const a = s.aim, ap = THREE.MathUtils.clamp(s.aimPitch, -0.9, 0.9);
    this.shoulderGun(dt, s, W.gun);
    const G = W.gun.matrixWorld;
    const flare = THREE.MathUtils.clamp(a * (0.8 + this.style.flare) - ap * 0.3, 0, 1.2);
    const poleR = this.v2.copy(POLE_R_LOW).lerp(POLE_R_AIM, flare).applyQuaternion(chest);
    const solR = gripSolve(T, W.R.d);
    this.handOn(this.mA.multiplyMatrices(G, W.R.m), solR, this.pA, this.qA);
    this.reachArm("R", this.pA, this.qA, poleR, solR.fingers, null, 0);

    // Support hand: the grip, unless an action takes it.
    const poleL = this.v3.copy(POLE_L_LOW).lerp(POLE_L_AIM, Math.min(1, a)).applyQuaternion(chest);
    const solL = gripSolve(T, W.L.d);
    const gripW = this.mB.multiplyMatrices(G, W.L.m);
    this.handOn(gripW, solL, this.pA, this.qA);
    let fingers: Float32Array = solL.fingers;
    let fb: Float32Array | null = null;
    let fk = 0;
    const u = s.actionT;
    let magOut = false;
    if (s.action === "reload") {
      const r = this.reloadHand(u, G, chest, solL.fingers, poleL);
      if (r) {
        fingers = r.fa;
        fb = r.fb;
        fk = r.k;
        magOut = r.magOut;
      }
    } else if (s.action === "throw") {
      const r = this.throwHand(u, chest, solL.fingers, poleL);
      fingers = r.fa;
      fb = r.fb;
      fk = r.k;
    } else W.grenade.visible = false;
    for (const m of W.gunMags) m.visible = !magOut;
    if (W.handMag && !magOut) W.handMag.visible = false;
    this.reachArm("L", this.pA, this.qA, poleL, fingers, fb, fk);
    this.dropUpdate(dt, owner);
  }

  /**
   * Seats the butt in the right shoulder pocket: the strong-side shoulder
   * joint a little behind, outboard of and below the butt, in the gun frame.
   * Smoothed, held through actions (the gun is off the shoulder then).
   */
  private shoulderGun(dt: number, s: DriveState, gun: THREE.Object3D) {
    gun.updateWorldMatrix(true, false);
    const sh = wpos(this.bone.get("Bip01_R_UpperArm")!, this.v1).applyMatrix4(this.mA.copy(gun.matrixWorld).invert());
    // Where the shoulder would be on the uncorrected rifle.
    sh.add(this.gunFix);
    if (s.action === "none" && s.down < 0.05) {
      const a = THREE.MathUtils.clamp(s.aim, 0, 1);
      const want = this.v2.set(sh.x + 0.04 + 0.02 * a, (sh.y + 0.07) * (0.4 + 0.3 * a), sh.z + 0.05 - 0.02 * a);
      want.clampScalar(-0.3, 0.12);
      this.gunFix.lerp(want, 1 - Math.exp(-dt * 10));
    } else if (s.down > 0.05) this.gunFix.multiplyScalar(Math.exp(-dt * 6));
    const d = this.v2.copy(this.gunFix).sub(this.v3.copy(this.gunApplied));
    if (d.lengthSq() > 0) {
      gun.position.add(d.applyQuaternion(gun.quaternion));
      gun.updateMatrix();
      gun.updateMatrixWorld(true);
      this.gunApplied.copy(this.gunFix);
    }
  }

  /** A chest-frame point (x left, y up, z forward; m from the upper spine) in world space. */
  private chestPoint(chest: THREE.Quaternion, x: number, y: number, z: number, out: THREE.Vector3) {
    return wpos(this.bone.get("Bip01_Spine2")!, out).add(this.v5.set(x, y, z).applyQuaternion(chest));
  }

  /** A left-hand anchor frame in the chest frame: X pinky -> index, Y palm normal (toward the held object), Z wrist -> fingers. */
  private chestAnchor(chest: THREE.Quaternion, p: THREE.Vector3, z: [number, number, number], y: [number, number, number], out: THREE.Matrix4) {
    const Z = this.v4.set(...z).normalize();
    const Y = this.v5.set(...y);
    Y.addScaledVector(Z, -Y.dot(Z)).normalize();
    const X = this.pB.crossVectors(Y, Z);
    out.makeBasis(X, Y, Z);
    this.q1.setFromRotationMatrix(out).premultiply(chest);
    return out.compose(p, this.q1, this.sA.set(1, 1, 1));
  }

  /** Blends the support hand target (pA, qA) toward (p, q) by k. */
  private blendHand(p: THREE.Vector3, q: THREE.Quaternion, k: number) {
    this.pA.lerp(p, k);
    this.qA.slerp(q, k);
  }

  /** Places a loose mesh (gun-frame geometry) at a world matrix, under the near LOD group. */
  private placeLoose(m: THREE.Object3D, world: THREE.Matrix4) {
    this.near.updateWorldMatrix(true, false);
    m.matrix.copy(this.near.matrixWorld).invert().multiply(world);
    m.matrixWorldNeedsUpdate = true;
  }

  /**
   * Reload choreography for the support hand (u: 0..1). Magazine guns: hand
   * to the magazine, pull it, let it drop, a fresh one from the vest, seat
   * it, back to the grip. Tube / belt / bolt guns: rounds thumbed in from the
   * vest (four trips; belt guns one, onto the feed tray). Writes the hand
   * target (pA, qA).
   */
  private reloadHand(u: number, G: THREE.Matrix4, chest: THREE.Quaternion, grip: Float32Array, pole: THREE.Vector3) {
    const W = this.weapon!;
    const T = this.grip!;
    const pouch = this.chestPoint(chest, 0.07, -0.3, 0.2, this.v1);
    pole.lerp(this.v4.set(0.6, -1, -0.4).applyQuaternion(chest), smoothstep(0, 0.15, u) * (1 - smoothstep(0.85, 1, u)));
    if (W.grab && W.tp.well && W.tp.info.reload !== "shell") {
      const sol = gripSolve(T, W.grab.d);
      const take = smoothstep(0, 0.14, u) * (1 - smoothstep(0.84, 1, u));
      const travel = smoothstep(0.15, 0.27, u) * (1 - smoothstep(0.6, 0.71, u));
      const atVest = smoothstep(0.3, 0.44, u) * (1 - smoothstep(0.49, 0.6, u));
      // Magazine (and the hand on it) out along the well: down and a little forward.
      const magW = this.mC.multiplyMatrices(G, this.m1.makeTranslation(0, -0.17 * travel, 0.035 * travel));
      const anchor = this.mA.multiplyMatrices(magW, W.grab.m);
      if (atVest > 0) {
        anchor.decompose(this.v2, this.q2, this.sA);
        this.v2.lerp(pouch, atVest);
        anchor.compose(this.v2, this.q2, this.sA.set(1, 1, 1));
      }
      this.mC.multiplyMatrices(anchor, sol.hand).decompose(this.pB, this.qB, this.sA);
      this.blendHand(this.pB, this.qB, take);
      const out = u > 0.145 && u < 0.71;
      const inHand = out && (u < 0.29 || u > 0.47);
      if (W.handMag) {
        W.handMag.visible = inHand;
        if (inHand) this.placeLoose(W.handMag, this.m1.copy(W.grab.m).invert().premultiply(anchor));
        // The spent magazine is let go of where it is, and falls.
        if (u >= 0.29 && u < 0.34 && W.drop.t < 0 && W.dropMag) {
          this.m1.copy(W.grab.m).invert().premultiply(anchor).decompose(W.drop.p, W.drop.q, this.sA);
          W.drop.t = 0;
          W.drop.spin.set(Math.random() * 6 - 3, Math.random() * 4 - 2, Math.random() * 6 - 3);
        }
      }
      if (u < 0.2) W.drop.t = -1;
      return { fa: grip, fb: sol.fingers, k: take, magOut: out };
    }
    // Rounds one at a time into the loading port (under the receiver; belt guns: the feed tray on top).
    const box = W.tp.info.reload === "box";
    const gr = this.v2.setFromMatrixPosition(W.R.m);
    const port = this.mA.copy(W.L.m).setPosition(gr.x + (box ? 0.05 : 0), gr.y + (box ? 0.04 : -0.005), gr.z + (box ? 0.12 : 0.075));
    const anchor = port.premultiply(G);
    const take = smoothstep(0, 0.08, u) * (1 - smoothstep(0.9, 1, u));
    const trips = box ? 1 : 4;
    const c = THREE.MathUtils.clamp((u - 0.08) / 0.82, 0, 0.9999) * trips;
    const f = c - Math.floor(c);
    const toPort = smoothstep(0.3, 0.55, f) * (1 - smoothstep(0.8, 1, f));
    anchor.decompose(this.v2, this.q2, this.sA);
    this.v3.copy(pouch).lerp(this.v2, toPort);
    anchor.compose(this.v3, this.q2, this.sA.set(1, 1, 1));
    this.mC.multiplyMatrices(anchor, gripSolve(T, W.L.d).hand).decompose(this.pB, this.qB, this.sA);
    this.blendHand(this.pB, this.qB, take);
    return { fa: grip, fb: null, k: 0, magOut: false };
  }

  /** Off-hand grenade throw (u: 0..1): from the vest, wound up behind the shoulder, thrown overarm, back to the gun. */
  private throwHand(u: number, chest: THREE.Quaternion, grip: Float32Array, pole: THREE.Vector3) {
    const W = this.weapon!;
    const sol = gripSolve(this.grip!, W.nade.d);
    const i = THROW_KEYS.findIndex((k, j) => j === THROW_KEYS.length - 1 || u < THROW_KEYS[j + 1][0]);
    const A = THROW_KEYS[i], B = THROW_KEYS[Math.min(i + 1, THROW_KEYS.length - 1)];
    const t = B === A ? 1 : THREE.MathUtils.clamp((u - A[0]) / (B[0] - A[0]), 0, 1);
    const e = i === 2 ? t * t : t * t * (3 - 2 * t); // the throw itself accelerates
    const L = (k: 1 | 2 | 3, c: number) => A[k][c] + (B[k][c] - A[k][c]) * e;
    const p = this.chestPoint(chest, L(1, 0), L(1, 1), L(1, 2), this.v1);
    const anchor = this.chestAnchor(chest, p, [L(2, 0), L(2, 1), L(2, 2)], [L(3, 0), L(3, 1), L(3, 2)], this.mA);
    this.mC.multiplyMatrices(anchor, sol.hand).decompose(this.pB, this.qB, this.sA);
    const take = smoothstep(0, 0.14, u) * (1 - smoothstep(0.76, 1, u));
    this.blendHand(this.pB, this.qB, take);
    // The elbow leads the throw: up and out during the wind-up.
    pole.lerp(this.v4.set(1, 0.2, -0.6).applyQuaternion(chest), smoothstep(0.2, 0.45, u) * (1 - smoothstep(0.6, 0.8, u)));
    const held = u > 0.17 && u < 0.6;
    W.grenade.visible = held;
    // The grenade sits on the held axis, across the palm (left anchor X: pinky -> index).
    if (held) this.placeLoose(W.grenade, this.m1.makeTranslation(-0.038, 0, 0).premultiply(anchor));
    return { fa: grip, fb: sol.fingers, k: take };
  }

  /** The dropped magazine: falls, tumbles, lands, disappears after a while. */
  private dropUpdate(dt: number, owner: THREE.Object3D) {
    const W = this.weapon!;
    const d = W.drop;
    if (!W.dropMag) return;
    if (d.t < 0 || d.t > 2.5) {
      W.dropMag.visible = false;
      return;
    }
    if (d.t === 0) {
      // Where it will land: the floor under the release point (a step or ledge
      // below the feet included), never far under the soldier's own floor.
      const feet = owner.matrixWorld.elements[13];
      const f = floorProbe ? floorProbe(d.p.x, d.p.z, d.p.y) : feet;
      d.floor = (f < feet - 0.6 || f > d.p.y ? feet : f) + 0.02;
    }
    d.t += dt;
    const floor = d.floor;
    if (d.p.y > floor) {
      d.p.y = Math.max(floor, d.p.y - 9.8 * d.t * dt);
      d.q.premultiply(this.q1.setFromAxisAngle(this.v4.copy(d.spin).normalize(), d.spin.length() * dt));
    }
    W.dropMag.visible = true;
    this.placeLoose(W.dropMag, this.m1.compose(d.p, d.q, this.sA.set(1, 1, 1)));
  }

  /**
   * Idle foot planting: while standing still each foot stays where it was
   * put; if the body turns or drifts too far over it, it takes a quick step
   * (one foot at a time) to its new clip position. Writes the IK targets.
   */
  private plantFeet(dt: number, st: number, pR: THREE.Vector3, pL: THREE.Vector3, qR: THREE.Quaternion, qL: THREE.Quaternion, owner: THREE.Object3D) {
    if (st < 0.6) {
      for (const l of this.locks) l.held = false;
      return;
    }
    // Locks live in the owner's parent space: the world for soldiers, the
    // turntable for a menu preview (spinning the display never makes him step).
    const par = owner.parent;
    const toPar = par ? this.m1.copy(par.matrixWorld).invert() : null;
    const parQ = par ? wquat(par, this.q2) : this.q2.identity();
    const feet: [THREE.Vector3, THREE.Quaternion][] = [[pR, qR], [pL, qL]];
    const sc = Math.max(0.01, owner.scale.y);
    const stepping = this.locks[0].step < 1 || this.locks[1].step < 1;
    const k = THREE.MathUtils.clamp((st - 0.6) / 0.3, 0, 1);
    for (let i = 0; i < 2; i++) {
      const l = this.locks[i];
      const [pw, qw] = feet[i];
      const p = this.v5.copy(pw);
      if (toPar) p.applyMatrix4(toPar);
      const q = this.q1.copy(parQ).invert().multiply(qw);
      if (!l.held) {
        l.pos.copy(p);
        l.q.copy(q);
        l.held = true;
        l.step = 1;
        continue;
      }
      const err = l.pos.distanceTo(p) / sc;
      const turn = 2 * Math.acos(Math.min(1, Math.abs(l.q.dot(q))));
      if (l.step >= 1 && !stepping && (err > 0.11 || turn > 0.55)) {
        l.step = 0;
        l.from.copy(l.pos);
      }
      if (l.step < 1) {
        l.step = Math.min(1, l.step + dt / 0.26);
        const e = l.step * l.step * (3 - 2 * l.step);
        l.pos.lerpVectors(l.from, p, e);
        l.pos.y += Math.sin(Math.PI * l.step) * 0.06 * sc;
        l.q.slerp(q, Math.min(1, e + 0.2));
        if (l.step >= 1) l.pos.copy(p);
      } else {
        // Keep the planted heel's height following the clip (ground follows the root).
        l.pos.y = p.y;
      }
      p.lerp(l.pos, k);
      q.slerp(l.q, k);
      if (par) p.applyMatrix4(par.matrixWorld);
      pw.copy(p);
      qw.copy(parQ).multiply(q);
    }
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
    const hp = this.v5.copy(this.hipOffset).applyQuaternion(P.pelvis).add(R.pelvis.position).divideScalar(this.height);
    bip.position.lerp(hp, k);
    for (const p of PUPPET) {
      const b = B.get(p.vis)!;
      const parent = b.parent as THREE.Object3D;
      const prs = parent === this.rigRoot ? this.q2.identity() : this.rs.get(parent.name) ?? this.q2.identity();
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
