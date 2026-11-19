import * as THREE from "three";
import { CAMERA } from "../config";
import { Spring, damp } from "../core/Spring";
import type { WeaponDef } from "./weapons";
import type { ShellKind } from "../effects/Shells";
import { GeoBuilder } from "./viewmodel/geo";
import { createViewmodelMaterials, edgeWearFor, type ViewmodelMaterials } from "./viewmodel/materials";
import { GUN_BUILDERS, buildGrenade, buildKnife, type GunSpec } from "./viewmodel/guns";
import { buildFlash, createFlashKit, type FlashKit } from "./viewmodel/flash";

type ModelKind = WeaponDef["model"];

type Model = {
  spec: GunSpec;
  flash: { group: THREE.Group; core: THREE.Mesh; petals: THREE.Mesh };
  magRest: THREE.Vector3;
  magRot: THREE.Euler;
  boltRest: THREE.Vector3;
  chargeRest: THREE.Vector3;
  pumpRest: number;
  /** Reload choreography tracks (gun-space offsets). */
  tracks: Tracks;
  tris: number;
  meshes: number;
};

type Tracks = {
  hand: Track;
  handEmpty: Track;
  mag: Track;
  magRot: Track;
  /** [t0, t1] while the support hand carries the mag (grab arm visible). */
  grab: [number, number];
  /** Mag hidden in this window (dropped / swapped off-screen). */
  hide: [number, number];
};

export type ViewmodelState = {
  ads: number;
  sprint: number;
  slide: number;
  bobDistance: number;
  bobAmount: number;
  /** Change in look angles this frame (radians). */
  yawDelta: number;
  pitchDelta: number;
  /** 0..1 progress, or -1 when not reloading. */
  reload: number;
  reloadEmpty: boolean;
  /** 0..1 lowered amount during a weapon swap. */
  lowered: number;
  grounded: boolean;
  /** Knife swing progress 0..1, or -1. */
  melee: number;
  /** Grenade throw progress 0..1, or -1. */
  throwing: number;
  /** Seconds since the last shot (pump / bolt cycle). */
  sinceShot: number;
  /** Shell-by-shell reload active (shotgun). */
  shellReload: boolean;
  /** Magazine empty: bolt / slide locks back (optional). */
  empty?: boolean;
};

/** Receives brass from the viewmodel (implemented by EffectsPool). */
export type ShellSink = {
  ejectShell(pos: THREE.Vector3, vel: THREE.Vector3, orient: THREE.Quaternion, kind: ShellKind, groundY: number): void;
};

/** Keyframed vector track: [t, x, y, z][] with smoothstep easing between keys. */
class Track {
  constructor(private readonly keys: number[][]) {}
  sample(t: number, out: THREE.Vector3) {
    const k = this.keys;
    if (t <= k[0][0]) return out.set(k[0][1], k[0][2], k[0][3]);
    for (let i = 1; i < k.length; i++) {
      if (t <= k[i][0]) {
        const a = k[i - 1];
        const b = k[i];
        let u = (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
        u = u * u * (3 - 2 * u);
        return out.set(a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u);
      }
    }
    const l = k[k.length - 1];
    return out.set(l[1], l[2], l[3]);
  }
}

type Ejection = { pos: THREE.Vector3; dir: THREE.Vector3; kind: ShellKind; pending: boolean; ready: boolean; quat: THREE.Quaternion };
const MAX_EJECT = 10;

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const LOCKS_BACK: ModelKind[] = ["rifle", "dmr", "pistol"];

/**
 * First-person weapon + arms, rendered in its own scene/camera so it never
 * clips into walls. Detailed procedural guns (merged per material; moving
 * parts separate), gloved hands posed around each grip, and procedural
 * animation: springs for recoil, damped lerps for sway/bob/poses, keyframed
 * reload choreography per weapon class.
 */
export class WeaponViewmodel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(CAMERA.viewmodelFov, 1, 0.01, 10);
  readonly pivot = new THREE.Group();

  private readonly models = new Map<ModelKind, Model>();
  private active!: Model;
  private def: WeaponDef | null = null;
  private readonly knife = new THREE.Group();
  private readonly grenade = new THREE.Group();
  private cylinderSpin = 0;
  private readonly disposables: { dispose(): void }[] = [];
  private readonly mats: ViewmodelMaterials;
  private readonly flashKit: FlashKit;
  private readonly flashLight = new THREE.PointLight(0xffb060, 0, 3, 2);

  // Recoil springs.
  private readonly kickBack = new Spring(280, 21);
  private readonly kickUp = new Spring(210, 17);
  private readonly kickRise = new Spring(240, 20);
  private readonly kickSide = new Spring(180, 14);
  private readonly kickRoll = new Spring(160, 12);
  private readonly land = new Spring(120, 10);

  private readonly sway = new THREE.Vector2();
  private readonly swayTarget = new THREE.Vector2();
  private time = 0;
  private flashTimer = 0;
  private flashDur = 0.04;
  private rollBias = 1;

  // Shell-reload / pump bookkeeping.
  private shellT = 0;
  private lastShellAmmo = -1;
  private wasShellReload = false;
  private rackT = 9;
  private pumpEjected = true;
  private lastReload = -1;
  private revolverDumped = false;

  private readonly ejections: Ejection[] = [];

  constructor(envMap: THREE.Texture | null) {
    this.scene.environment = envMap;
    this.scene.environmentIntensity = 0.55;
    this.scene.add(new THREE.HemisphereLight(0xe6ecf5, 0x4a3f30, 0.85));
    const key = new THREE.DirectionalLight(0xfff0da, 2.4);
    key.position.set(0.6, 1.4, 0.7);
    const fill = new THREE.DirectionalLight(0xc8d6ff, 0.45);
    fill.position.set(-0.8, 0.3, 0.6);
    const rim = new THREE.DirectionalLight(0x9ab4ff, 0.9);
    rim.position.set(-1, 0.5, -1);
    this.scene.add(key, fill, rim, this.flashLight, this.pivot);

    this.mats = createViewmodelMaterials();
    this.flashKit = createFlashKit();
    const wear = (mat: THREE.Material) => edgeWearFor(this.mats, mat);

    for (const kind of ["rifle", "smg", "shotgun", "dmr", "lmg", "pistol", "revolver"] as ModelKind[]) {
      const b = new GeoBuilder(wear);
      const spec = GUN_BUILDERS[kind]({ b, m: this.mats });
      b.finish(this.disposables);
      const flash = buildFlash(this.flashKit, spec.flash, spec.flashScale, this.disposables);
      spec.muzzle.add(flash.group);
      spec.root.visible = false;
      this.pivot.add(spec.root);
      this.models.set(kind, {
        spec,
        flash,
        magRest: spec.mag.position.clone(),
        magRot: spec.mag.rotation.clone(),
        boltRest: spec.bolt.position.clone(),
        chargeRest: spec.charge ? spec.charge.position.clone() : new THREE.Vector3(),
        pumpRest: spec.pump ? spec.pump.position.z : 0,
        tracks: makeTracks(spec),
        tris: b.triangles,
        meshes: b.meshes + 2,
      });
    }
    this.active = this.models.get("rifle")!;
    this.active.spec.root.visible = true;

    const kb = new GeoBuilder(wear);
    buildKnife({ b: kb, m: this.mats }, this.knife);
    buildGrenade({ b: kb, m: this.mats }, this.grenade);
    kb.finish(this.disposables);
    this.knife.visible = false;
    this.grenade.visible = false;
    this.pivot.add(this.knife, this.grenade);

    for (let i = 0; i < MAX_EJECT; i++) {
      this.ejections.push({ pos: new THREE.Vector3(), dir: new THREE.Vector3(), kind: "rifle", pending: false, ready: false, quat: new THREE.Quaternion() });
    }
  }

  /** Operator-specific glove / sleeve colors. */
  setOperatorColors(glove: number, sleeve: number) {
    this.mats.glove.color.setHex(glove);
    this.mats.gloveAccent.color.setHex(glove).multiplyScalar(0.55);
    this.mats.sleeve.color.setHex(sleeve);
  }

  setAspect(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  setWeapon(def: WeaponDef) {
    this.def = def;
    const next = this.models.get(def.model) ?? this.models.get("rifle")!;
    if (next === this.active) return;
    this.active.spec.root.visible = false;
    this.active = next;
    next.spec.root.visible = true;
    this.kickBack.reset();
    this.kickUp.reset();
    this.kickRise.reset();
    this.kickSide.reset();
    this.kickRoll.reset();
    this.flashTimer = 0;
  }

  /** Called on every shot. */
  kick(def: WeaponDef, ads: number) {
    const k = def.viewKick;
    const s = 1 - ads * 0.45;
    const rs = 1 - ads * 0.6;
    this.kickBack.impulse(k.back * 32 * s);
    this.kickUp.impulse(k.up * 30 * rs);
    this.kickRise.impulse(k.up * 0.55 * s);
    this.kickSide.impulse((Math.random() - 0.5) * k.side * 60 * rs);
    if (Math.random() < 0.3) this.rollBias = -this.rollBias;
    this.kickRoll.impulse(((Math.random() - 0.5) * 0.8 + this.rollBias * 0.25) * k.roll * 60 * rs);
    this.cylinderSpin += Math.PI / 3;

    const m = this.active;
    const f = m.flash;
    this.flashDur = m.spec.handgun ? 0.03 : 0.038;
    this.flashTimer = this.flashDur;
    f.core.rotation.z = Math.random() * Math.PI * 2;
    const sc = 0.82 + Math.random() * 0.45;
    f.group.scale.set(sc, sc, 0.8 + Math.random() * 0.5);
    if (m.spec.flash !== "brake" && m.spec.flash !== "revolver") f.petals.rotation.z = Math.random() * Math.PI;
    const map = this.flashKit.core.map!;
    const v = Math.floor(Math.random() * 4);
    map.offset.set((v % 2) * 0.5, Math.floor(v / 2) * 0.5);

    if (m.spec.shell && m.spec.reload !== "shell") this.queueEjection(m.spec.shell);
    this.pumpEjected = false;
  }

  landImpact(fallSpeed: number) {
    this.land.impulse(-Math.min(fallSpeed, 14) * 0.035);
  }

  /**
   * Muzzle position in world space. The viewmodel renders with its own FOV,
   * so the view-space point is rescaled to land on the same screen pixel
   * for the world camera (tracers / smoke start exactly at the drawn muzzle).
   */
  muzzleWorld(worldCamera: THREE.Camera, out: THREE.Vector3) {
    this.active.spec.muzzle.getWorldPosition(out); // view space (camera at origin)
    return this.viewToWorld(worldCamera, out);
  }

  private viewToWorld(worldCamera: THREE.Camera, p: THREE.Vector3) {
    const cam = worldCamera as THREE.PerspectiveCamera;
    if (cam.isPerspectiveCamera) {
      const k = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
      p.x *= k;
      p.y *= k;
    }
    return worldCamera.localToWorld(p);
  }

  private queueEjection(kind: ShellKind) {
    for (const e of this.ejections) {
      if (e.pending || e.ready) continue;
      e.pending = true;
      e.kind = kind;
      return e;
    }
    return null;
  }

  /**
   * Hand pending brass (from shots / pumps / revolver dumps) to the effects
   * system in world space. Call once per frame after update().
   */
  drainShells(worldCamera: THREE.Camera, sink: ShellSink, groundY: number, inherit?: THREE.Vector3) {
    for (const e of this.ejections) {
      if (!e.ready) continue;
      e.ready = false;
      this.viewToWorld(worldCamera, tmpV.copy(e.pos));
      const speed = e.kind === "shotgun" ? 2.1 : e.kind === "pistol" ? 2.6 : e.kind === "magnum" ? 0.9 : 3.1;
      tmpV2.copy(e.dir).multiplyScalar(speed * (0.85 + Math.random() * 0.3));
      tmpV2.x += (Math.random() - 0.5) * 0.4;
      tmpV2.y += (Math.random() - 0.5) * 0.4;
      tmpV2.applyQuaternion(worldCamera.quaternion);
      if (inherit) tmpV2.add(inherit);
      tmpQ.copy(worldCamera.quaternion).multiply(e.quat);
      sink.ejectShell(tmpV, tmpV2, tmpQ, e.kind, groundY);
    }
  }

  update(dt: number, s: ViewmodelState) {
    this.time += dt;
    const m = this.active;
    const sp = m.spec;
    const g = sp.root;

    // ---- Springs -----------------------------------------------------------
    const back = this.kickBack.update(dt);
    const up = this.kickUp.update(dt);
    const rise = this.kickRise.update(dt);
    const side = this.kickSide.update(dt);
    const roll = this.kickRoll.update(dt);
    const landY = this.land.update(dt);

    // ---- Sway (lags behind the mouse) --------------------------------------
    const swayScale = 1 - s.ads * 0.85;
    this.swayTarget.set(
      THREE.MathUtils.clamp(-s.yawDelta * 1.6, -0.05, 0.05),
      THREE.MathUtils.clamp(s.pitchDelta * 1.6, -0.05, 0.05),
    );
    this.sway.lerp(this.swayTarget, damp(9, dt));

    // ---- Bob (synced to the camera's footfalls) ----------------------------
    const phase = s.bobDistance * 0.32 * Math.PI * 2;
    const bobAmt = s.bobAmount * (1 - s.ads * 0.9);
    const sprintBob = 1 + s.sprint * 1.3;
    const bobX = Math.cos(phase) * 0.011 * bobAmt * sprintBob;
    const bobY = -Math.abs(Math.sin(phase)) * 0.009 * bobAmt * sprintBob;
    const bobRot = Math.cos(phase) * 0.02 * bobAmt * sprintBob;

    // ---- Idle breathing ----------------------------------------------------
    const idle = 1 - s.ads * 0.8;
    const breath = Math.sin(this.time * 1.5) * 0.0018 * idle;
    const breathX = Math.sin(this.time * 0.75) * 0.0012 * idle;

    // ---- Base position: hip ↔ ADS (sights land exactly on screen centre) ---
    const ease = s.ads * s.ads * (3 - 2 * s.ads);
    const hipW = 1 - ease;
    g.position.lerpVectors(sp.hip, sp.ads, ease);
    // ADS path arcs slightly low so the optic rises into the eye.
    g.position.y -= Math.sin(ease * Math.PI) * 0.012;
    g.rotation.set(0.012 * hipW, 0.035 * hipW, 0.03 * hipW);

    // ---- Reset moving parts to rest ----------------------------------------
    sp.mag.position.copy(m.magRest);
    sp.mag.rotation.copy(m.magRot);
    sp.mag.visible = !sp.magHidden;
    sp.leftArm.position.set(0, 0, 0);
    sp.leftArm.visible = true;
    sp.leftGrab.visible = false;
    sp.bolt.position.copy(m.boltRest);
    if (sp.charge) sp.charge.position.copy(m.chargeRest);
    if (sp.cover) sp.cover.rotation.x = 0;
    if (sp.crane) sp.crane.rotation.z = 0;
    if (sp.rounds) sp.rounds.visible = true;

    // ---- Sprint pose -------------------------------------------------------
    if (s.sprint > 0.001) {
      const t = s.sprint * s.sprint * (3 - 2 * s.sprint);
      if (sp.handgun) {
        g.position.y -= 0.035 * t;
        g.position.z += 0.02 * t;
        g.rotation.x += 0.55 * t;
        g.rotation.y += 0.22 * t;
      } else {
        g.position.x -= 0.03 * t;
        g.position.y -= 0.022 * t;
        g.position.z += 0.03 * t;
        g.rotation.y += 0.62 * t;
        g.rotation.x -= 0.16 * t;
        g.rotation.z += 0.32 * t;
      }
    }
    // Slide pose: cant the weapon.
    g.rotation.z += 0.22 * s.slide;
    g.position.y -= 0.015 * s.slide;

    // ---- Bolt / slide cycling ----------------------------------------------
    const rpm = this.def?.rpm ?? 600;
    const cycDur = Math.min(0.075, (60 / rpm) * 0.8);
    const ct = s.sinceShot / cycDur;
    let boltOff = ct < 1 ? (ct < 0.3 ? smooth(ct, 0, 0.3) : 1 - smooth(ct, 0.3, 1)) : 0;
    const reloading = s.reload >= 0;
    const lockable = LOCKS_BACK.includes(sp.kind);
    if (s.empty && lockable && s.sinceShot > cycDur * 0.3) boltOff = 1;

    // ---- Reload choreography -------------------------------------------------
    if (reloading && !s.shellReload) {
      const r = s.reload;
      boltOff = this.reloadPose(m, r, s.reloadEmpty, lockable, boltOff);
    } else {
      this.revolverDumped = false;
    }
    this.lastReload = s.reload;
    this.shellPose(m, dt, s);

    sp.bolt.position.z = m.boltRest.z + boltOff * sp.boltTravel;

    // Pump cycle after a shot (and the rack after an empty shell reload).
    if (sp.pump) {
      const c = s.sinceShot / sp.cycle;
      let pull = c > 0.15 && c < 1 ? Math.sin(((c - 0.15) / 0.85) * Math.PI) : 0;
      this.rackT += dt;
      const rc = this.rackT / 0.5;
      if (rc < 1) pull = Math.max(pull, Math.sin(rc * Math.PI));
      sp.pump.position.z = m.pumpRest + pull * (sp.pumpTravel ?? 0.08);
      sp.bolt.position.z = m.boltRest.z + pull * 0.06;
      g.rotation.z += pull * 0.06;
      g.rotation.x += pull * 0.02;
      if (!this.pumpEjected && c > 0.4 && c < 1) {
        this.pumpEjected = true;
        if (sp.shell) this.queueEjection(sp.shell);
      }
    }
    if (sp.cylinder) {
      sp.cylinder.rotation.z += (this.cylinderSpin - sp.cylinder.rotation.z) * damp(30, dt);
    }

    // Swap: drop out of view.
    if (s.lowered > 0) {
      const l = s.lowered * s.lowered;
      g.position.y -= 0.28 * l;
      g.rotation.x -= 0.9 * l;
    }

    // Knife: gun dips away, knife slashes across.
    this.knife.visible = s.melee >= 0;
    if (s.melee >= 0) {
      const t = s.melee;
      const away = Math.sin(Math.min(t * 1.3, 1) * Math.PI);
      g.position.y -= 0.12 * away;
      g.position.x += 0.06 * away;
      g.rotation.z -= 0.6 * away;
      const swing = smooth(t, 0.05, 0.3);
      const ret = smooth(t, 0.45, 1);
      this.knife.position.set(0.22 - swing * 0.36 + ret * 0.14, -0.06 - swing * 0.08, -0.36 + swing * 0.06);
      this.knife.rotation.set(-0.3 + swing * 0.2, 0.9 - swing * 1.6, 0.9 - swing * 1.3);
      this.knife.position.y -= ret * 0.25;
    }
    // Grenade: gun lowers, hand cocks back then throws forward.
    this.grenade.visible = s.throwing >= 0 && s.throwing < 0.55;
    if (s.throwing >= 0) {
      const t = s.throwing;
      const away = Math.sin(Math.min(t * 1.2, 1) * Math.PI);
      g.position.y -= 0.2 * away;
      g.rotation.x -= 0.6 * away;
      const cock = smooth(t, 0, 0.35);
      const fling = smooth(t, 0.35, 0.55);
      this.grenade.position.set(-0.16 + fling * 0.12, -0.12 + cock * 0.14 - fling * 0.02, -0.3 + cock * 0.12 - fling * 0.5);
      this.grenade.rotation.set(cock * -0.8 + fling * 2, 0.3 - cock * 0.2, 0);
    }
    // Optic: hide the gun once the scope fills the view.
    g.visible = !(sp.scope && s.ads > 0.92);

    // ---- Apply layered offsets --------------------------------------------
    g.position.x += this.sway.x * swayScale + bobX + breathX;
    g.position.y += this.sway.y * swayScale + bobY + breath + landY + rise;
    g.position.z += back;
    g.rotation.x += up + this.sway.y * 2 * swayScale;
    g.rotation.y += side + this.sway.x * 2.5 * swayScale;
    g.rotation.z += roll + bobRot + this.sway.x * 1.5 * swayScale;

    // ---- Muzzle flash ------------------------------------------------------
    this.flashTimer -= dt;
    const fl = this.flashTimer > 0;
    m.flash.group.visible = fl && g.visible;
    this.pivot.updateMatrixWorld(true);
    if (fl) {
      sp.muzzle.getWorldPosition(this.flashLight.position);
      this.flashLight.intensity = (this.flashTimer / this.flashDur) * 2.2 * (sp.flashScale + 0.3);
    } else this.flashLight.intensity = 0;

    // Resolve queued brass now that the pose is final.
    for (const e of this.ejections) {
      if (!e.pending) continue;
      e.pending = false;
      e.ready = true;
      sp.eject.getWorldPosition(e.pos);
      g.getWorldQuaternion(e.quat);
      e.dir.copy(sp.ejectDir).applyQuaternion(e.quat);
    }
  }

  /** Mag / box / pistol / revolver reloads. Returns the bolt offset (0..1). */
  private reloadPose(m: Model, r: number, empty: boolean, lockable: boolean, boltOff: number) {
    const sp = m.spec;
    const g = sp.root;
    const tr = m.tracks;

    // Weapon tilt toward the support hand.
    const tilt = smooth(r, 0, 0.14) * (1 - smooth(r, 0.84, 0.98));
    if (sp.reload === "revolver") {
      const open = smooth(r, 0.05, 0.2) * (1 - smooth(r, 0.74, 0.86));
      const eject = smooth(r, 0.2, 0.28) * (1 - smooth(r, 0.32, 0.4));
      const load = smooth(r, 0.36, 0.48) * (1 - smooth(r, 0.66, 0.76));
      g.rotation.z -= 0.55 * open;
      g.rotation.x += 0.75 * eject - 0.3 * load;
      g.rotation.y += 0.2 * open;
      g.position.x -= 0.03 * open;
      g.position.y += 0.02 * eject - 0.01 * load;
      g.position.z += 0.03 * open;
      if (sp.crane) sp.crane.rotation.z = 1.2 * open;
      if (sp.rounds) sp.rounds.visible = r < 0.26 || r > 0.6;
      if (!this.revolverDumped && r > 0.26 && this.lastReload <= 0.26 + 1e-3 && sp.cylinder) {
        this.revolverDumped = true;
        this.dumpCylinder(sp);
      }
      // Speedloader follows the cylinder's chamber pattern.
      if (sp.cylinder) sp.mag.rotation.z = 1.2 + (sp.cylinder.rotation.z % (Math.PI / 3));
    } else if (sp.reload === "pistol") {
      g.rotation.z -= 0.25 * tilt;
      g.rotation.x += 0.22 * tilt;
      g.position.y += 0.012 * tilt;
      g.position.z += 0.02 * tilt;
    } else if (sp.reload === "box") {
      g.rotation.z += 0.32 * tilt;
      g.rotation.x += 0.16 * tilt;
      g.position.y -= 0.02 * tilt;
      g.position.z += 0.03 * tilt;
      g.position.x -= 0.02 * tilt;
      if (sp.cover) sp.cover.rotation.x = 1.05 * smooth(r, 0.13, 0.24) * (1 - smooth(r, 0.72, 0.8));
    } else {
      g.rotation.z += 0.45 * tilt;
      g.rotation.x += 0.1 * tilt;
      g.rotation.y -= 0.08 * tilt;
      g.position.y -= 0.03 * tilt;
      g.position.x -= 0.025 * tilt;
      g.position.z += 0.02 * tilt;
    }

    // Magazine path + visibility.
    tr.mag.sample(r, tmpV);
    sp.mag.position.add(tmpV);
    tr.magRot.sample(r, tmpV);
    sp.mag.rotation.x += tmpV.x;
    sp.mag.rotation.z += tmpV.z;
    sp.mag.visible = !(r > tr.hide[0] && r < tr.hide[1]);
    if (sp.magHidden) sp.mag.visible = r > tr.grab[0] && r < tr.grab[1];
    // Seat jolt when the mag clicks home.
    const seatT = tr.grab[1] - 0.04;
    if (r > seatT && r < seatT + 0.05) {
      const k = Math.sin(((r - seatT) / 0.05) * Math.PI);
      g.position.y += 0.007 * k;
      g.rotation.x -= 0.025 * k;
    }

    // Support hand: carries the mag inside the grab window, otherwise tracks.
    const grabbing = r > tr.grab[0] && r < tr.grab[1];
    sp.leftGrab.visible = grabbing;
    sp.leftArm.visible = !grabbing;
    if (!grabbing) (empty ? tr.handEmpty : tr.hand).sample(r, sp.leftArm.position);

    // Empty reloads: bolt stays locked until the release / rack, then slams home.
    if (empty) {
      if (sp.reload === "pistol") {
        boltOff = r < 0.84 ? 1 + smooth(r, 0.78, 0.82) * 0.15 : 1 - smooth(r, 0.84, 0.87);
      } else if (lockable) {
        boltOff = r < 0.81 ? 1 : 1 - smooth(r, 0.81, 0.835);
        if (r > 0.81 && r < 0.86) g.rotation.z += Math.sin(((r - 0.81) / 0.05) * Math.PI) * 0.04;
      } else if (sp.charge) {
        const pull = smooth(r, 0.76, 0.81) * (1 - smooth(r, 0.82, 0.835));
        sp.charge.position.z = m.chargeRest.z + pull * (sp.chargeTravel ?? 0.05);
        boltOff = pull;
        if (r > 0.76 && r < 0.82) sp.leftArm.position.z += pull * (sp.chargeTravel ?? 0.05);
      }
    }
    return boltOff;
  }

  /** Shotgun: thumb shells into the loading port one at a time. */
  private shellPose(m: Model, dt: number, s: ViewmodelState) {
    const sp = m.spec;
    if (sp.reload !== "shell") return;
    if (s.shellReload) {
      if (!this.wasShellReload) {
        this.shellT = -0.3;
        this.lastShellAmmo = s.reload;
      }
      this.shellT += dt;
      if (s.reload > this.lastShellAmmo + 1e-4) {
        this.shellT = 0;
        this.lastShellAmmo = s.reload;
      }
      const interval = this.def?.reloadTime ?? 0.48;
      const p = THREE.MathUtils.clamp(this.shellT / interval, 0, 1);
      const g = sp.root;
      const settle = THREE.MathUtils.clamp((this.shellT + 0.3) / 0.25, 0, 1);
      const e = settle * settle * (3 - 2 * settle);
      g.rotation.z += 0.5 * e;
      g.rotation.x += 0.16 * e;
      g.position.y -= 0.035 * e;
      g.position.x -= 0.02 * e;
      // Hand: down to the shell carrier, up under the port, push the shell in.
      m.tracks.mag.sample(p, tmpV);
      sp.mag.position.add(tmpV);
      sp.mag.visible = p > 0.3 && p < 0.97;
      sp.leftGrab.visible = true;
      sp.leftArm.visible = false;
      if (p > 0.8) g.position.y += Math.sin(((p - 0.8) / 0.2) * Math.PI) * 0.004;
    }
    if (this.wasShellReload && !s.shellReload && s.reloadEmpty) this.rackT = 0;
    this.wasShellReload = s.shellReload;
  }

  /** Revolver: spent cases fall out of the swung-out cylinder. */
  private dumpCylinder(sp: GunSpec) {
    this.pivot.updateMatrixWorld(true);
    for (let i = 0; i < 6; i++) {
      const e = this.queueEjection("magnum");
      if (!e) return;
      e.pending = false;
      e.ready = true;
      const a = Math.PI / 2 + (i * Math.PI) / 3;
      e.pos.set(Math.cos(a) * 0.0165, Math.sin(a) * 0.0165, 0.03);
      sp.cylinder!.localToWorld(e.pos);
      sp.root.getWorldQuaternion(e.quat);
      e.dir.set(-0.2 + (Math.random() - 0.5) * 0.3, -0.4, 0.6).normalize().applyQuaternion(e.quat);
    }
  }

  /** Triangle / mesh counts per weapon (for tooling and the debug overlay). */
  stats() {
    const out: Record<string, { tris: number; meshes: number; muzzle: THREE.Vector3; ads: THREE.Vector3 }> = {};
    for (const [k, m] of this.models) out[k] = { tris: m.tris, meshes: m.meshes, muzzle: m.spec.muzzle.position.clone(), ads: m.spec.ads.clone() };
    return out;
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.mats.dispose();
    this.flashKit.dispose();
  }
}

function smooth(x: number, a: number, b: number) {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Per-class reload choreography as keyframes (gun-space offsets). */
function makeTracks(sp: GunSpec): Tracks {
  const R = sp.leftReach;
  const B = tmpV.copy(sp.boltHand).sub(sp.leftRest).clone();
  const z = [0, 0, 0];
  const k = (t: number, v: number[] | THREE.Vector3) => (v instanceof THREE.Vector3 ? [t, v.x, v.y, v.z] : [t, v[0], v[1], v[2]]);
  switch (sp.reload) {
    case "pistol": {
      const off = [-0.05, -0.3, 0.12];
      return {
        hand: new Track([k(0, z), k(0.06, z), k(0.22, off), k(0.6, off), k(0.62, R), k(0.78, z)]),
        handEmpty: new Track([k(0, z), k(0.06, z), k(0.22, off), k(0.6, off), k(0.62, R), k(0.72, B), k(0.79, B), k(0.83, [B.x, B.y, B.z + 0.025]), k(0.86, B), k(0.97, z)]),
        mag: new Track([k(0.1, z), k(0.22, [0, -0.13, 0.04]), k(0.3, [-0.05, -0.32, 0.12]), k(0.48, [0, -0.06, 0.018]), k(0.58, z)]),
        magRot: new Track([k(0.1, z), k(0.22, [0.3, 0, 0]), k(0.3, [-0.5, 0, 0]), k(0.48, z)]),
        grab: [0.3, 0.62],
        hide: [0.22, 0.3],
      };
    }
    case "revolver": {
      const C = [-0.025, 0.03, -0.045];
      const off = [-0.06, -0.3, 0.12];
      return {
        hand: new Track([k(0, z), k(0.06, C), k(0.22, [C[0] - 0.03, C[1] + 0.01, C[2]]), k(0.3, [C[0] - 0.03, C[1] + 0.01, C[2]]), k(0.36, off), k(0.66, R), k(0.76, [C[0] - 0.03, C[1] + 0.01, C[2]]), k(0.86, C), k(0.96, z)]),
        handEmpty: new Track([k(0, z), k(0.06, C), k(0.22, [C[0] - 0.03, C[1] + 0.01, C[2]]), k(0.3, [C[0] - 0.03, C[1] + 0.01, C[2]]), k(0.36, off), k(0.66, R), k(0.76, [C[0] - 0.03, C[1] + 0.01, C[2]]), k(0.86, C), k(0.96, z)]),
        mag: new Track([k(0.36, [-0.06, -0.3, 0.15]), k(0.52, [0, 0, 0.05]), k(0.6, z), k(0.68, z), k(0.8, [-0.06, -0.3, 0.15])]),
        magRot: new Track([k(0, z)]),
        grab: [0.36, 0.66],
        hide: [-1, 0.36],
      };
    }
    case "box": {
      const latch = [-0.004, -0.028 - sp.leftRest.y, -0.118 - sp.leftRest.z];
      const latchUp = [-0.004, 0.13 - sp.leftRest.y, -0.01 - sp.leftRest.z];
      const tray = [-0.035, -0.05 - sp.leftRest.y, -0.05 - sp.leftRest.z];
      const B2 = [B.x, B.y, B.z];
      return {
        hand: new Track([k(0, z), k(0.04, z), k(0.13, latch), k(0.24, latchUp), k(0.31, R), k(0.6, R), k(0.66, tray), k(0.72, latchUp), k(0.8, latch), k(0.9, z)]),
        handEmpty: new Track([k(0, z), k(0.04, z), k(0.13, latch), k(0.24, latchUp), k(0.31, R), k(0.6, R), k(0.66, tray), k(0.72, latchUp), k(0.8, latch), k(0.84, B2), k(0.88, [B.x, B.y, B.z + 0.06]), k(0.9, B2), k(0.98, z)]),
        mag: new Track([k(0.31, z), k(0.38, [-0.04, -0.08, 0.02]), k(0.45, [-0.1, -0.36, 0.08]), k(0.5, [-0.1, -0.36, 0.08]), k(0.55, [-0.04, -0.08, 0.02]), k(0.6, z)]),
        magRot: new Track([k(0.31, z), k(0.45, [-0.4, 0, 0.3]), k(0.5, [-0.4, 0, 0.3]), k(0.58, z)]),
        grab: [0.31, 0.6],
        hide: [0.445, 0.505],
      };
    }
    case "shell": {
      // Sampled with the per-shell phase p (0..1): mag = the shell in hand.
      const far = [-0.05, -0.22, 0.08];
      return {
        hand: new Track([k(0, z)]),
        handEmpty: new Track([k(0, z)]),
        mag: new Track([k(0, [0, 0.012, -0.03]), k(0.28, far), k(0.72, [0, -0.012, 0.02]), k(0.9, [0, 0.006, -0.01]), k(1, [0, 0.012, -0.03])]),
        magRot: new Track([k(0, z)]),
        grab: [-1, -1],
        hide: [-1, -1],
      };
    }
    default: {
      const pull = [0, -0.075, 0.012];
      const away = [-0.07, -0.34, 0.06];
      const charge = sp.charge !== undefined && sp.kind === "smg";
      return {
        hand: new Track([k(0, z), k(0.06, z), k(0.2, R), k(0.64, R), k(0.8, z)]),
        handEmpty: charge
          ? new Track([k(0, z), k(0.06, z), k(0.2, R), k(0.64, R), k(0.75, B), k(0.86, B), k(0.97, z)])
          : new Track([k(0, z), k(0.06, z), k(0.2, R), k(0.64, R), k(0.76, B), k(0.79, B), k(0.81, [B.x + 0.006, B.y, B.z]), k(0.84, B), k(0.97, z)]),
        mag: new Track([k(0.2, z), k(0.3, pull), k(0.42, away), k(0.5, away), k(0.56, pull), k(0.62, z)]),
        magRot: new Track([k(0.2, z), k(0.42, [-0.5, 0, 0.4]), k(0.5, [-0.5, 0, 0.4]), k(0.58, z)]),
        grab: [0.2, 0.64],
        hide: [0.43, 0.49],
      };
    }
  }
}
