import * as THREE from "three";
import { damp, Spring } from "../core/Spring";
import type { HitPart, Hittable } from "../core/types";
import { buildBody, type BodyBuild, type LookDef } from "./humanoid/body";
import { disposeMaterials, eliteMaterial, ghillieMaterial, hitboxMaterial, uberMaterial } from "./humanoid/materials";
import { buildGun, type GunSpec } from "./humanoid/rifle";
import { BONES, HAND_SOCKET, RIG, solveArm, type BoneName } from "./humanoid/rig";

export type HumanoidLook = LookDef;

// ---------------------------------------------------------------------------
// Shared caches: one body build per (kit, palette, variant), one gun per kit
// palette, one box per hitbox size. Materials are global singletons.
// ---------------------------------------------------------------------------
const bodyCache = new Map<string, BodyBuild>();
const gunCache = new Map<string, GunSpec>();
const boxCache = new Map<string, THREE.BoxGeometry>();
let variantCounter = 0;

function hitBox(size: readonly number[]) {
  const k = size.join("|");
  let g = boxCache.get(k);
  if (!g) boxCache.set(k, (g = new THREE.BoxGeometry(size[0], size[1], size[2])));
  return g;
}

export function disposeHumanoidCache() {
  bodyCache.forEach((b) => {
    Object.values(b.bones).forEach((g) => g?.dispose());
    Object.values(b.ghillie).forEach((g) => g?.dispose());
    b.elite.armL.dispose();
    b.elite.armR.dispose();
    b.elite.head.dispose();
  });
  gunCache.forEach((g) => g.geo.dispose());
  boxCache.forEach((g) => g.dispose());
  bodyCache.clear();
  gunCache.clear();
  boxCache.clear();
  disposeMaterials();
}

const SHADOW: Partial<Record<BoneName, boolean>> = { pelvis: true, spine: true, head: true, uArmR: true, uArmL: true, thighR: true, thighL: true, shinR: true, shinL: true };
const PART: Record<BoneName, HitPart> = {
  pelvis: "body", spine: "body", head: "head", uArmR: "body", uArmL: "body", fArmR: "body", fArmL: "body", handR: "body", handL: "body",
  thighR: "legs", thighL: "legs", shinR: "legs", shinL: "legs", footR: "legs", footL: "legs",
};

/** Hand orientations relative to the gun (columns: images of the hand's X, Y, Z axes). */
function basisQ(x: [number, number, number], y: [number, number, number]) {
  const X = new THREE.Vector3(...x).normalize();
  const Y = new THREE.Vector3(...y);
  Y.addScaledVector(X, -Y.dot(X)).normalize();
  const Z = new THREE.Vector3().crossVectors(X, Y);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
}
const Q_GRIP_R = basisQ([1, 0, 0], [0, 0.6, -0.8]); // pistol grip, thumb over the top
const Q_GRIP_L_UNDER = basisQ([0, -1, 0], [1, 0, 0.25]); // palm up under the handguard
const Q_GRIP_L_VERT = basisQ([1, 0, 0], [0, 0.3, -0.95]); // vertical grip / pump
const Q_WOUND_L = basisQ([0, 0, 1], [0.3, 0.95, 0]); // palm pressed on the abdomen
const SOCKET_R = HAND_SOCKET.clone();
const SOCKET_L = HAND_SOCKET.clone().setX(-HAND_SOCKET.x);
const PALM_L = new THREE.Vector3(-0.022, -0.06, 0);
const POLE_R = new THREE.Vector3(-0.75, -1, -0.2);
const POLE_L = new THREE.Vector3(0.45, -1, -0.15);
const POLE_R_DOWN = new THREE.Vector3(-0.6, -0.4, -1);
const WOUND = new THREE.Vector3(0.045, 0.07, 0.125);

/** Death-settle contact points per bone (local), used to keep corpses on the ground. */
const CONTACTS: [BoneName, number, number, number][] = [
  ["head", 0, 0.27, 0], ["head", 0, 0.12, 0.12], ["head", 0, 0.12, -0.13], ["head", 0.11, 0.13, 0], ["head", -0.11, 0.13, 0],
  ["spine", 0, 0.3, 0.18], ["spine", 0, 0.3, -0.17], ["spine", 0, 0.05, 0.16], ["spine", 0, 0.05, -0.15], ["spine", 0.2, 0.36, 0], ["spine", -0.2, 0.36, 0],
  ["pelvis", 0, -0.08, 0.11], ["pelvis", 0, -0.08, -0.11], ["pelvis", 0.15, -0.05, 0], ["pelvis", -0.15, -0.05, 0],
  ["thighR", 0, -0.43, 0.06], ["thighL", 0, -0.43, 0.06], ["thighR", 0, -0.2, -0.08], ["thighL", 0, -0.2, -0.08],
  ["shinR", 0, -0.42, 0.06], ["shinL", 0, -0.42, 0.06], ["shinR", 0, -0.2, -0.06], ["shinL", 0, -0.2, -0.06],
  ["footR", 0, -0.08, 0.19], ["footL", 0, -0.08, 0.19], ["footR", 0, -0.08, -0.08], ["footL", 0, -0.08, -0.08],
  ["fArmR", 0, 0, 0], ["fArmL", 0, 0, 0], ["handR", 0, -0.1, 0], ["handL", 0, -0.1, 0], ["uArmR", -0.05, 0, 0], ["uArmL", 0.05, 0, 0],
];

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const lerp = THREE.MathUtils.lerp;
/** Vertical extent of a leg from hip joint to sole (thigh / knee / foot world angles). */
const legExtent = (T: number, Kn: number, F: number) => RIG.thigh * Math.cos(T) + RIG.shin * Math.cos(T + Kn) + RIG.ankle * Math.cos(F) + 0.04 * Math.abs(Math.sin(F));
/** Exponentially ease a bone's Euler rotation toward a target. */
function ease(o: THREE.Object3D, x: number, y: number, z: number, k: number) {
  o.rotation.x += (x - o.rotation.x) * k;
  o.rotation.y += (y - o.rotation.y) * k;
  o.rotation.z += (z - o.rotation.z) * k;
}
// Downed (sitting against nothing, leaning back) leg / pelvis pose.
const DN_Y = 0.16, DN_PP = -0.55, DN_TR = -1.55, DN_KR = 0.15, DN_TL = -2.0, DN_KL = 0.95;

type DeathKind = 0 | 1 | 2 | 3; // fall back, fall forward (kneel + topple), crumple sideways, spin

/**
 * Procedurally sculpted and animated soldier. Faces +Z, feet at y = 0.
 * Visible geometry is merged per bone (one draw call each, shared material);
 * hitboxes are invisible box proxies parented to the same bones so hit
 * zones follow the animation and stay tight to the body.
 */
export class Humanoid {
  readonly root = new THREE.Group();
  readonly hitboxes: THREE.Mesh[] = [];
  readonly muzzle = new THREE.Object3D();
  readonly gun = new THREE.Group();
  readonly scale: number;

  private readonly b = {} as Record<BoneName, THREE.Group>;
  private readonly spec: GunSpec;
  private readonly heavyKit: boolean;
  private readonly hipFire: boolean;
  private readonly w: number;
  private readonly shoulderR: THREE.Vector3;
  private readonly shoulderL: THREE.Vector3;
  private readonly eliteMarks: THREE.Mesh[] = [];
  /** Death-settle contact points: hand-placed ones plus each bone mesh's bbox face centres. */
  private readonly contacts: { bone: THREE.Object3D; p: THREE.Vector3 }[] = [];

  // Reactions.
  private readonly flinchX = new Spring(140, 11);
  private readonly flinchZ = new Spring(140, 11);
  private readonly flinchY = new Spring(120, 10);
  private readonly headSnap = new Spring(220, 12);
  private readonly headRoll = new Spring(200, 12);
  private readonly kick = new Spring(320, 22);

  // Locomotion state.
  private phase = Math.random() * 10;
  private time = Math.random() * 100;
  private readonly seed = Math.random() * 10;
  private crouch = 0;
  private aim = 0;
  private speedS = 0;
  private moveF = 1;
  private moveS = 0;
  private prevX = 0;
  private prevZ = 0;
  private hasPrev = false;
  private down = 0;

  // Death state.
  private death = -1;
  private kind: DeathKind = 0;
  private pitchSign = 1;
  private rollSign = 1;
  private theta = 0;
  private omega = 0;
  private thetaMax = 1.5;
  private yaw0 = 0;
  private spin = 0;
  private groundY = 0;
  private readonly gunP0 = new THREE.Vector3();
  private readonly gunQ0 = new THREE.Quaternion();
  private readonly gunQ1 = new THREE.Quaternion();
  private gunDrop = 0;

  // Scratch (no per-frame allocation).
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();
  private readonly q1 = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly m1 = new THREE.Matrix4();
  private readonly m2 = new THREE.Matrix4();
  private readonly e1 = new THREE.Euler();
  private readonly s1 = new THREE.Vector3(1, 1, 1);

  constructor(owner: Hittable, look: HumanoidLook) {
    this.scale = look.scale;
    const kit = look.kit;
    this.heavyKit = kit === "heavy" || kit === "warden";
    this.hipFire = kit === "warden";
    const variant = kit === "standard" ? (look.variant ?? variantCounter++) % 3 : 0;
    const key = `${kit}|${look.uniform}|${look.vest}|${look.helmet}|${look.skin}|${look.accent}|${look.camo ?? ""}|${variant}`;
    let body = bodyCache.get(key);
    if (!body) bodyCache.set(key, (body = buildBody(look, variant)));
    const gkey = `${kit}|${look.accent}|${look.vest}`;
    let spec = gunCache.get(gkey);
    if (!spec) gunCache.set(gkey, (spec = buildGun(kit, look.accent, look.vest)));
    this.spec = spec;
    this.w = body.w;

    // ---- Skeleton -----------------------------------------------------------
    for (const n of BONES) this.b[n] = new THREE.Group();
    const b = this.b;
    this.root.rotation.order = "YXZ"; // yaw (manager) first, then fall pitch / roll in the body frame
    this.root.add(b.pelvis);
    b.pelvis.add(b.spine, b.thighR, b.thighL);
    const hx = RIG.hipX * (this.heavyKit ? this.w * 0.95 : 1);
    b.thighR.position.set(-hx, RIG.hipY, 0);
    b.thighL.position.set(hx, RIG.hipY, 0);
    b.thighR.add(b.shinR);
    b.thighL.add(b.shinL);
    b.shinR.position.y = b.shinL.position.y = -RIG.thigh;
    b.shinR.add(b.footR);
    b.shinL.add(b.footL);
    b.footR.position.y = b.footL.position.y = -RIG.shin;
    b.spine.position.y = RIG.spineY;
    b.spine.add(b.head, b.uArmR, b.uArmL, this.gun);
    b.head.position.y = RIG.neckY;
    const sx = RIG.shoulderX * (this.heavyKit ? this.w : 1);
    this.shoulderR = new THREE.Vector3(-sx, RIG.shoulderY, 0);
    this.shoulderL = new THREE.Vector3(sx, RIG.shoulderY, 0);
    b.uArmR.position.copy(this.shoulderR);
    b.uArmL.position.copy(this.shoulderL);
    b.uArmR.add(b.fArmR);
    b.uArmL.add(b.fArmL);
    b.fArmR.position.y = b.fArmL.position.y = -RIG.upperArm;
    b.fArmR.add(b.handR);
    b.fArmL.add(b.handL);
    b.handR.position.y = b.handL.position.y = -RIG.foreArm;

    // ---- Visible meshes (one per bone) -----------------------------------------
    const uber = uberMaterial();
    for (const n of BONES) {
      const g = body.bones[n];
      if (!g) continue;
      const m = new THREE.Mesh(g, uber);
      m.castShadow = !!SHADOW[n];
      m.receiveShadow = true;
      b[n].add(m);
      const bb = g.boundingBox!;
      const c = bb.getCenter(new THREE.Vector3());
      for (const [ax, v] of [["x", bb.min.x], ["x", bb.max.x], ["y", bb.min.y], ["y", bb.max.y], ["z", bb.min.z], ["z", bb.max.z]] as const) {
        this.contacts.push({ bone: b[n], p: c.clone().setComponent(ax === "x" ? 0 : ax === "y" ? 1 : 2, v) });
      }
    }
    for (const [bone, x, y, z] of CONTACTS) this.contacts.push({ bone: b[bone], p: new THREE.Vector3(x, y, z) });
    const gh = ghillieMaterial();
    for (const n of BONES) {
      const g = body.ghillie[n];
      if (g) b[n].add(new THREE.Mesh(g, gh));
    }
    const gunMesh = new THREE.Mesh(spec.geo, uber);
    gunMesh.castShadow = true;
    this.gun.add(gunMesh);
    this.muzzle.position.copy(spec.muzzle);
    this.gun.add(this.muzzle);

    // ---- Hit proxies (invisible, raycast only) ------------------------------
    const hm = hitboxMaterial();
    const armor = this.heavyKit;
    const proxy = (bone: BoneName, dims: { size: [number, number, number]; at: [number, number, number] }, mirror = false) => {
      const m = new THREE.Mesh(hitBox(dims.size), hm);
      m.position.set(mirror ? -dims.at[0] : dims.at[0], dims.at[1], dims.at[2]);
      m.visible = false;
      const part = PART[bone];
      m.userData = { hittable: owner, part, surface: armor && (part === "head" || bone === "spine" || bone === "pelvis") ? "armor" : "flesh" };
      b[bone].add(m);
      this.hitboxes.push(m);
    };
    const H = body.hit;
    proxy("head", H.head);
    proxy("spine", H.spine);
    proxy("pelvis", H.pelvis);
    proxy("uArmR", H.uArm);
    proxy("uArmL", H.uArm, true);
    proxy("fArmR", H.fArm);
    proxy("fArmL", H.fArm, true);
    proxy("handR", H.hand);
    proxy("handL", H.hand, true);
    proxy("thighR", H.thigh);
    proxy("thighL", H.thigh, true);
    proxy("shinR", H.shin);
    proxy("shinL", H.shin, true);
    proxy("footR", H.foot);
    proxy("footL", H.foot, true);

    // ---- Elite markings (hidden unless this soldier spawns as an elite) -------
    const em = eliteMaterial();
    for (const [bone, g] of [["uArmR", body.elite.armR], ["uArmL", body.elite.armL], ["head", body.elite.head]] as const) {
      const m = new THREE.Mesh(g, em);
      b[bone].add(m);
      this.eliteMarks.push(m);
    }
    this.setElite(false);

    this.root.scale.setScalar(look.scale);
    this.update(0, 0, false, 0, false);
  }

  /** Toggle the red elite markings (pooled models are reused for both). */
  setElite(on: boolean) {
    for (const m of this.eliteMarks) m.visible = on;
  }

  /** Visual hit reaction: torso jolt away from the shot, head snap on headshots. */
  flinch(head: boolean, strength: number, fromBehind: boolean) {
    const s = Math.min(1, strength);
    const dir = fromBehind ? 1 : -1;
    this.flinchX.impulse(dir * 5 * s);
    this.flinchZ.impulse((Math.random() - 0.5) * 6 * s);
    this.flinchY.impulse((Math.random() - 0.5) * 5 * s);
    if (head) {
      this.headSnap.impulse(dir * 11 * s);
      this.headRoll.impulse((Math.random() - 0.5) * 8 * s);
    }
  }

  fire() {
    this.kick.impulse(16);
  }

  die(fromBehind: boolean) {
    if (this.death >= 0) return;
    this.death = 0;
    this.pitchSign = fromBehind ? 1 : -1;
    this.rollSign = Math.random() < 0.5 ? 1 : -1;
    const r = Math.random();
    this.kind = r < 0.4 ? (fromBehind ? 1 : 0) : r < 0.72 ? 2 : r < 0.88 ? 3 : fromBehind ? 0 : 1;
    if (this.kind === 0) this.pitchSign = -1;
    if (this.kind === 1) this.pitchSign = 1;
    this.theta = 0.02;
    this.omega = this.kind === 0 ? 1.6 : this.kind === 3 ? 0.9 : 0.4;
    this.thetaMax = this.kind === 2 ? 1.4 : 1.52;
    this.yaw0 = this.root.rotation.y;
    this.spin = this.kind === 3 ? this.rollSign * (1.7 + Math.random() * 0.9) : 0;
    this.groundY = this.root.position.y;
    // Drop the weapon: it falls on its own, in root space.
    this.root.updateMatrixWorld(true);
    this.gun.getWorldPosition(this.gunP0);
    this.gun.getWorldQuaternion(this.gunQ0);
    this.e1.setFromQuaternion(this.gunQ0, "YXZ");
    this.e1.set(0, this.e1.y + (Math.random() - 0.5) * 1.2, (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2, "YXZ");
    this.gunQ1.setFromEuler(this.e1);
    this.gunDrop = 0;
    this.root.attach(this.gun);
  }

  revive() {
    const wasDead = this.death >= 0;
    this.death = -1;
    this.root.rotation.x = 0;
    this.root.rotation.z = 0;
    this.root.position.y = 0;
    if (this.gun.parent !== this.b.spine) this.b.spine.add(this.gun);
    this.gun.scale.set(1, 1, 1);
    this.hasPrev = false;
    // A downed squadmate gets up (keeps its pose and blends out); a pooled /
    // respawned model snaps to standing.
    if (wasDead || !this.root.visible) {
      this.down = 0;
      this.crouch = 0;
      this.speedS = 0;
      this.flinchX.reset();
      this.flinchZ.reset();
      this.flinchY.reset();
      this.headSnap.reset();
      this.headRoll.reset();
      this.kick.reset();
    }
  }

  get dying() {
    return this.death >= 0;
  }

  /**
   * speed: m/s along the ground. crouched: target stance. aimPitch: radians
   * (positive = up). aiming: weapon shouldered. downed: sitting wounded.
   */
  update(dt: number, speed: number, crouched: boolean, aimPitch: number, aiming: boolean, downed = false) {
    const fx = this.flinchX.update(dt);
    const fz = this.flinchZ.update(dt);
    const fy = this.flinchY.update(dt);
    const hs = this.headSnap.update(dt);
    const hr = this.headRoll.update(dt);
    const kv = this.kick.update(dt) * this.spec.kick;

    if (this.death >= 0) {
      this.updateDeath(dt);
      return;
    }
    const b = this.b;
    this.time += dt;
    const t = this.time;
    this.root.rotation.x = 0;
    this.root.rotation.z = 0;

    // ---- Movement direction from root motion (local frame) --------------------
    const rx = this.root.position.x, rz = this.root.position.z;
    if (this.hasPrev && dt > 0) {
      const dx = rx - this.prevX, dz = rz - this.prevZ;
      const d2 = dx * dx + dz * dz;
      if (d2 > 1e-8 && d2 < 4) {
        const yaw = this.root.rotation.y, c = Math.cos(yaw), s = Math.sin(yaw);
        const f = dx * s + dz * c, l = dx * c - dz * s;
        const len = Math.sqrt(f * f + l * l);
        const k = damp(6, dt);
        this.moveF += (f / len - this.moveF) * k;
        this.moveS += (l / len - this.moveS) * k;
      }
    }
    if (speed < 0.2) {
      const k = damp(3, dt);
      this.moveF += (1 - this.moveF) * k;
      this.moveS += (0 - this.moveS) * k;
    }
    this.prevX = rx;
    this.prevZ = rz;
    this.hasPrev = true;

    this.speedS += (speed - this.speedS) * damp(7, dt);
    this.crouch += ((crouched ? 1 : 0) - this.crouch) * damp(7, dt);
    this.aim += ((aiming ? 1 : 0) - this.aim) * damp(7, dt);
    const tgtDown = downed ? 1 : 0;
    this.down += Math.sign(tgtDown - this.down) * Math.min(Math.abs(tgtDown - this.down), dt * (downed ? 1.8 : 1.1));
    const db = smooth(0, 1, this.down);

    const sp = this.speedS * (1 - db);
    const moving = smooth(0.15, 1.1, sp);
    const run = smooth(3.0, 5.2, sp) * (1 - this.crouch * 0.7);
    // Rising from downed passes through a crouch.
    const c = Math.max(this.crouch, Math.sin(Math.PI * Math.min(1, this.down)) * (downed ? 0 : 0.9));
    const a = this.aim * (1 - db);

    // ---- Gait ------------------------------------------------------------------
    const stride = lerp(1.3, 2.25, run) * (1 - 0.35 * c);
    this.phase += (dt * sp) / stride * Math.PI * 2;
    const ph = this.phase;
    const alpha = Math.atan2(this.moveS, this.moveF);
    const alphaH = Math.abs(alpha) <= Math.PI / 2 ? alpha : alpha - Math.sign(alpha) * Math.PI;
    const hipYawDir = THREE.MathUtils.clamp(alphaH * 0.55, -0.6, 0.6) * moving;
    const beta = alpha - hipYawDir;
    const cb = Math.cos(beta), sb = Math.sin(beta);
    const A = lerp(0.42, 0.72, run) * moving * (1 - 0.45 * c);
    const K = lerp(0.6, 1.3, run) * moving;
    const sinP = Math.sin(ph), cosP = Math.cos(ph);

    const pp = 0.03 + c * 0.32 + run * 0.12; // pelvis pitch (world)
    // Legs: world-space thigh angle T, knee K, foot F.
    const tR = -A * sinP * cb - c * 1.05 - run * 0.06;
    const tL = A * sinP * cb - c * 1.35 - run * 0.06;
    const idleBend = (1 - moving) * (0.07 + 0.05 * Math.sin(t * 0.45 + this.seed));
    const kR = K * Math.max(0, cosP) + run * 0.25 * Math.max(0, -cosP) + c * 1.85 + idleBend + 0.05;
    const kL = K * Math.max(0, -cosP) + run * 0.25 * Math.max(0, cosP) + c * 1.95 + (1 - moving) * (0.07 - 0.05 * Math.sin(t * 0.45 + this.seed)) + 0.05;
    const fR = -0.2 * Math.max(0, cosP) * moving, fL = -0.2 * Math.max(0, -cosP) * moving;
    const standY = Math.max(legExtent(tR, kR, fR), legExtent(tL, kL, fL)) - RIG.hipY + run * 0.025 * Math.abs(Math.sin(ph * 2));
    const stanceSign = Math.sin(ph);
    const sway = (0.022 * moving * (1 - run * 0.5) + (1 - moving) * 0.015 * Math.sin(t * 0.45 + this.seed)) * (moving > 0.01 ? stanceSign : 1);
    const pelvisYaw = hipYawDir + 0.12 * moving * sinP * cb + fy * 0.05;
    const pelvisRoll = 0.055 * moving * sinP * (1 - run * 0.4) + (1 - moving) * 0.03 * Math.sin(t * 0.45 + this.seed);

    // Downed (sitting, leaning back) values.
    const dnSpine = 0.22 + Math.sin(t * 3.4) * 0.03; // fast, shallow breathing
    const dnHead = 0.45 + 0.15 * Math.sin(t * 0.6);
    const dnHeadY = 0.25 * Math.sin(t * 0.23);

    const P = b.pelvis;
    const pitch = lerp(pp, DN_PP, db);
    P.rotation.set(pitch, lerp(pelvisYaw, 0, db), lerp(pelvisRoll, 0, db));
    const thR = lerp(tR, DN_TR, db), thL = lerp(tL, DN_TL, db);
    const knR = lerp(kR, DN_KR, db), knL = lerp(kL, DN_KL, db);
    const ftR = lerp(fR, -0.25, db), ftL = lerp(fL, 0, db);
    // Blending to / from the downed pose: keep whichever foot is lowest on the floor.
    const blendY = db > 0 ? Math.max(legExtent(thR, knR, ftR), legExtent(thL, knL, ftL)) - RIG.hipY : 0;
    P.position.set(lerp(sway, 0, db), Math.max(lerp(standY, DN_Y, db), blendY), 0);
    const lat = A * sb * 0.8;
    b.thighR.rotation.set(thR - pitch, (1 - db) * 0.08, (1 - db) * THREE.MathUtils.clamp(lat * sinP, -0.4, 0.12) - db * 0.12 - c * 0.08);
    b.thighL.rotation.set(thL - pitch, -(1 - db) * 0.08, (1 - db) * THREE.MathUtils.clamp(-lat * sinP, -0.12, 0.4) + db * 0.2 + c * 0.08);
    b.shinR.rotation.set(knR, 0, 0);
    b.shinL.rotation.set(knL, 0, 0);
    b.footR.rotation.set(ftR - thR - knR, 0, 0);
    b.footL.rotation.set(ftL - thL - knL, 0, 0);

    // ---- Upper body --------------------------------------------------------------
    const ap = THREE.MathUtils.clamp(aimPitch, -0.9, 0.9) * (1 - db);
    const breath = Math.sin(t * (1.5 + moving * 1.5 + run * 1.2)) * 0.012;
    const leanW = 0.05 + run * 0.22 + c * 0.26 + moving * 0.04;
    const spineX = lerp(leanW - pp - ap * 0.35 * a - ap * 0.15 + breath + fx * 0.12 - kv * 0.025, dnSpine, db);
    const spineY = lerp(-pelvisYaw * 0.85 + (this.hipFire ? 0 : -0.1 * a), 0, db);
    const spineZ = lerp(-pelvisRoll * 0.8 + fz * 0.1, 0.05, db);
    b.spine.rotation.set(spineX, spineY, spineZ);
    const torsoPitch = pitch + spineX;
    const torsoYaw = (1 - db) * pelvisYaw + spineY;

    const weld = this.hipFire ? 0 : 0.28 * a;
    const look = (1 - a) * (1 - db) * 0.22 * Math.sin(t * 0.37 + this.seed);
    const headStand = -ap * 0.85 + weld - torsoPitch * 0.85;
    b.head.rotation.set(lerp(headStand, dnHead, db) + hs * 0.1 - kv * 0.02, lerp(look - torsoYaw * 0.9 - fy * 0.05, dnHeadY, db), (this.hipFire ? 0 : 0.2 * a) + hr * 0.08);

    // ---- Weapon pose (spine space) --------------------------------------------
    const pv = this.spec.pivot;
    const carry = run * (1 - a);
    const low = 1 - a - carry;
    const bob = moving * 0.012 * Math.sin(ph * 2);
    const gpx = pv.x * a + (pv.x + 0.05) * low + -0.05 * carry;
    const gpy = pv.y * a + (pv.y - 0.09) * low + (pv.y - 0.12) * carry + bob;
    const gpz = pv.z * a + pv.z * low + (pv.z + 0.03) * carry;
    // Aim pitch is tracked exactly: gun world pitch = -aimPitch.
    const aimRX = -ap - torsoPitch + fx * 0.08 - kv * 0.06;
    const lowRX = 0.5 - torsoPitch * 0.5 - ap * 0.4;
    const carryRX = 0.8 - torsoPitch * 0.4;
    const gx = aimRX * a + lowRX * low + carryRX * carry;
    const gy = -torsoYaw * (a + low * 0.6) + 0.28 * low + 0.75 * carry + moving * 0.03 * sinP;
    const gz = -0.18 * low - 0.45 * carry + moving * 0.04 * sinP;
    // Downed: rifle across the lap.
    this.gun.position.set(lerp(gpx, -0.14, db), lerp(gpy, -0.02, db), lerp(gpz, 0.12, db) - kv * 0.035);
    this.gun.rotation.set(lerp(gx, 0.1 - (DN_PP + dnSpine), db), lerp(gy, 0.55, db), lerp(gz, -0.35, db));
    this.gun.updateMatrix();

    // ---- Arms: IK onto the weapon (left hand to the wound when downed) ----------
    const L1 = RIG.upperArm, L2 = RIG.foreArm;
    const grip = this.v1.copy(this.spec.gripR).applyMatrix4(this.gun.matrix);
    const qh = this.q1.copy(this.gun.quaternion).multiply(Q_GRIP_R);
    const wrist = this.v2.copy(SOCKET_R).applyQuaternion(qh);
    wrist.subVectors(grip, wrist);
    solveArm(b.uArmR, b.fArmR, b.handR, this.shoulderR, wrist, qh, this.hipFire ? POLE_R_DOWN : POLE_R, L1, L2);

    const gl = this.v1.copy(this.spec.gripL).applyMatrix4(this.gun.matrix);
    const ql = this.q1.copy(this.gun.quaternion).multiply(this.spec.leftUnder ? Q_GRIP_L_UNDER : Q_GRIP_L_VERT);
    const wl = this.v2.copy(SOCKET_L).applyQuaternion(ql);
    wl.subVectors(gl, wl);
    if (db > 0) {
      const ww = this.v3.copy(PALM_L).applyQuaternion(Q_WOUND_L);
      ww.subVectors(WOUND, ww);
      wl.lerp(ww, db);
      ql.slerp(Q_WOUND_L, db);
    }
    solveArm(b.uArmL, b.fArmL, b.handL, this.shoulderL, wl, ql, POLE_L, L1, L2);
  }

  // ---------------------------------------------------------------------------
  // Death: pendulum topple + limp pose easing + ground contact settling.
  // ---------------------------------------------------------------------------
  private updateDeath(dt: number) {
    const b = this.b;
    this.death += dt;
    const t = this.death;
    const kind = this.kind;
    const delay = kind === 0 ? 0.04 : kind === 3 ? 0.3 : 0.24;
    // Pendulum about the feet / knees.
    if (t > delay && dt > 0) {
      this.omega += 10.5 * Math.sin(Math.max(0.05, this.theta)) * dt;
      this.theta += this.omega * dt;
      if (this.theta >= this.thetaMax) {
        this.theta = this.thetaMax;
        this.omega = this.omega > 0.7 ? -this.omega * 0.22 : 0;
      }
    }
    const landed = this.theta >= this.thetaMax - 0.06 && Math.abs(this.omega) < 0.8;
    const th = this.theta;
    const r = this.root;
    if (kind === 2) {
      r.rotation.x = 0.35 * th;
      r.rotation.z = this.rollSign * th;
    } else if (kind === 3) {
      r.rotation.x = -0.45 * th;
      r.rotation.z = this.rollSign * th * 0.85;
    } else {
      r.rotation.x = this.pitchSign * th;
      r.rotation.z = this.rollSign * th * 0.12;
    }
    if (kind === 3) r.rotation.y = this.yaw0 + this.spin * (1 - Math.pow(1 - Math.min(1, t / 0.6), 3));

    // Limp pose targets.
    const buckle = smooth(0, kind === 0 ? 0.3 : 0.32, t);
    const k = damp(landed ? 5 : 9, dt);
    const P = b.pelvis;
    P.position.x += (0 - P.position.x) * k;
    P.position.y += (RIG.thigh + RIG.shin + RIG.ankle - RIG.hipY - P.position.y) * k;
    const s = this.rollSign;
    switch (kind) {
      case 0: // fall back: arms fly up, then splay
        ease(P, -0.1, 0, 0, k);
        ease(b.thighR, -0.25 * buckle, 0, -0.1, k);
        ease(b.thighL, landed ? -0.6 : -0.15, 0, 0.12, k);
        ease(b.shinR, 0.45 * buckle, 0, 0, k);
        ease(b.shinL, landed ? 1.0 : 0.3, 0, 0, k);
        ease(b.spine, landed ? 0.05 : -0.3, 0, 0, k);
        ease(b.head, landed ? -0.2 : 0.45, landed ? 0.7 * s : 0, 0, damp(4, dt));
        ease(b.uArmR, landed ? -2.4 : -1.7, 0, landed ? -0.5 : -0.3, k);
        ease(b.uArmL, landed ? -1.4 : -1.5, 0, landed ? 1.0 : 0.4, k);
        break;
      case 1: // kneel, then topple face-first
        ease(P, 0.1, 0, 0, k);
        ease(b.thighR, landed ? -0.3 : -0.15 * buckle, 0, -0.08, k);
        ease(b.thighL, landed ? -0.05 : -0.35 * buckle, 0, 0.1, k);
        ease(b.shinR, landed ? 0.25 : 1.6 * buckle, 0, 0, k);
        ease(b.shinL, landed ? 0.45 : 1.4 * buckle, 0, 0, k);
        ease(b.spine, landed ? 0.1 : 0.35, 0.1 * s, 0, k);
        ease(b.head, landed ? -0.5 : 0.3, landed ? 1.1 * s : 0, 0, damp(4, dt));
        // Arms brace forward while toppling, then lie flat: one along the side, one out.
        ease(b.uArmR, landed ? 0.15 : -0.9, 0, landed ? -0.25 : -0.35, k);
        ease(b.uArmL, landed ? -0.2 : -1.0, 0, landed ? 1.45 : 0.5, k);
        break;
      case 2: // knees give out, slump onto the side
        ease(P, 0.25, 0, 0, k);
        ease(b.thighR, -1.3 * buckle, 0, -0.1, k);
        ease(b.thighL, -1.0 * buckle, 0, 0.15, k);
        ease(b.shinR, 2.0 * buckle, 0, 0, k);
        ease(b.shinL, 1.5 * buckle, 0, 0, k);
        ease(b.spine, 0.55, 0.15 * s, 0.1 * s, k);
        ease(b.head, 0.55, 0.4 * s, 0.3 * s, damp(4, dt));
        ease(b.uArmR, s > 0 ? -1.3 : -0.5, 0, s > 0 ? 0.15 : 0.05, k);
        ease(b.uArmL, s > 0 ? -0.5 : -1.3, 0, s > 0 ? -0.05 : -0.15, k);
        break;
      default: // spun by the hit, then drops back and sideways
        ease(P, -0.05, 0, 0, k);
        ease(b.thighR, -0.5 * buckle, 0, -0.2, k);
        ease(b.thighL, -0.2 * buckle, 0, 0.25, k);
        ease(b.shinR, 0.9 * buckle, 0, 0, k);
        ease(b.shinL, 0.3 * buckle, 0, 0, k);
        ease(b.spine, -0.15, -0.4 * s, 0.2 * s, k);
        ease(b.head, 0.2, -0.6 * s, 0.2 * s, damp(4, dt));
        ease(b.uArmR, s > 0 ? -1.4 : -0.4, 0.2, s > 0 ? 0.2 : 0.1, k);
        ease(b.uArmL, s > 0 ? -0.4 : -1.4, -0.2, s > 0 ? -0.1 : -0.2, k);
    }
    const prone = kind === 1 && landed;
    ease(b.fArmR, prone ? -0.1 : -0.5, 0, 0, k);
    ease(b.fArmL, prone ? -0.15 : -0.7, 0, 0, k);
    ease(b.handR, 0.2, 0, 0, k);
    ease(b.handL, 0.2, 0, 0, k);
    ease(b.footR, 0.4, 0, 0, k);
    ease(b.footL, 0.4, 0, 0, k);
    // Shoulders back to rest (IK may have protracted them).
    b.uArmR.position.lerp(this.shoulderR, k);
    b.uArmL.position.lerp(this.shoulderL, k);

    // Ground contact: lowest sample point sits on the floor (no penetration, no float).
    r.updateMatrixWorld(true);
    let minY = Infinity;
    for (let i = 0; i < this.contacts.length; i++) {
      const c = this.contacts[i];
      const p = this.v1.copy(c.p).applyMatrix4(c.bone.matrixWorld);
      if (p.y < minY) minY = p.y;
    }
    r.position.y += this.groundY - minY;
    // Sink out of sight just before the manager recycles the body.
    if (t > 3.3) r.position.y -= Math.min(1, (t - 3.3) / 1.2) * 0.5;
    r.updateMatrixWorld(true);

    // Dropped weapon: falls, tumbles flat, rests on the floor (in world, mapped to root space).
    this.gunDrop += dt;
    const g = this.gunDrop;
    const sc = this.scale;
    const pos = this.v2.copy(this.gunP0);
    pos.y = Math.max(this.groundY + 0.05 * sc, this.gunP0.y - 4.9 * g * g);
    if (t > 3.3) pos.y -= Math.min(1, (t - 3.3) / 1.2) * 0.5;
    const q = this.q2.copy(this.gunQ0).slerp(this.gunQ1, smooth(0, 0.55, g));
    this.m1.compose(pos, q, this.s1.set(sc, sc, sc));
    this.m2.copy(r.matrixWorld).invert().multiply(this.m1);
    this.m2.decompose(this.gun.position, this.gun.quaternion, this.v3);
    this.gun.scale.copy(this.v3);
  }
}
