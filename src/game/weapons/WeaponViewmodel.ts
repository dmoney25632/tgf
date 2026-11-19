import * as THREE from "three";
import { CAMERA } from "../config";
import { Spring, damp } from "../core/Spring";
import type { WeaponDef } from "./weapons";

type ModelKind = WeaponDef["model"];

type Model = {
  root: THREE.Group;
  /** Moves during reload. */
  mag: THREE.Object3D;
  magRest: THREE.Vector3;
  /** Slide / bolt that kicks back on fire. */
  bolt: THREE.Object3D;
  boltRest: number;
  muzzle: THREE.Object3D;
  flash: THREE.Group;
  hip: THREE.Vector3;
  ads: THREE.Vector3;
  /** Pump forend (shotgun) — slides back after each shot. */
  pump?: THREE.Object3D;
  pumpRest?: number;
  /** Revolver cylinder spins on fire. */
  cylinder?: THREE.Object3D;
  /** Pistol-style poses (sprint points up). */
  handgun: boolean;
  /** Hide near full ADS (scope overlay takes over). */
  scope: boolean;
  /** Pump / bolt cycle duration after a shot. */
  cycle: number;
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
};

const tmpV = new THREE.Vector3();

/**
 * First-person weapon + arms, rendered in its own scene/camera so it never
 * clips into walls. All motion is procedural: springs for recoil, damped
 * lerps for sway/bob/poses.
 */
export class WeaponViewmodel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(CAMERA.viewmodelFov, 1, 0.01, 10);
  readonly pivot = new THREE.Group();

  private readonly models = new Map<ModelKind, Model>();
  private active!: Model;
  private readonly knife = new THREE.Group();
  private readonly grenade = new THREE.Group();
  private cylinderSpin = 0;
  private readonly disposables: { dispose(): void }[] = [];

  // Recoil springs.
  private readonly kickBack = new Spring(260, 20);
  private readonly kickUp = new Spring(200, 16);
  private readonly kickSide = new Spring(180, 14);
  private readonly kickRoll = new Spring(160, 12);
  private readonly bolt = new Spring(900, 40);
  private readonly land = new Spring(120, 10);

  private readonly sway = new THREE.Vector2();
  private readonly swayTarget = new THREE.Vector2();
  private time = 0;
  private flashTimer = 0;

  constructor(envMap: THREE.Texture | null) {
    this.scene.environment = envMap;
    this.scene.environmentIntensity = 0.45;
    this.scene.add(new THREE.HemisphereLight(0xe6ecf5, 0x4a3f30, 1.0));
    const key = new THREE.DirectionalLight(0xfff2de, 2.2);
    key.position.set(0.6, 1.4, 0.8);
    const rim = new THREE.DirectionalLight(0x9ab4ff, 0.8);
    rim.position.set(-1, 0.4, -1);
    this.scene.add(key, rim, this.pivot);

    for (const kind of ["rifle", "smg", "shotgun", "dmr", "lmg", "pistol", "revolver"] as ModelKind[]) {
      const m = this.build(kind);
      m.root.visible = false;
      this.pivot.add(m.root);
      this.models.set(kind, m);
    }
    this.active = this.models.get("rifle")!;
    this.active.root.visible = true;
    this.buildKnife();
    this.buildGrenade();
  }

  /** Operator-specific glove / sleeve colors. */
  setOperatorColors(glove: number, sleeve: number) {
    const m = this.materials();
    m.glove.color.setHex(glove);
    m.sleeve.color.setHex(sleeve);
  }

  setAspect(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  setWeapon(def: WeaponDef) {
    const next = this.models.get(def.model) ?? this.models.get("rifle")!;
    if (next === this.active) return;
    this.active.root.visible = false;
    this.active = next;
    next.root.visible = true;
    this.kickBack.reset();
    this.kickUp.reset();
    this.kickSide.reset();
    this.kickRoll.reset();
  }

  /** Called on every shot. */
  kick(def: WeaponDef, ads: number) {
    const k = def.viewKick;
    const s = 1 - ads * 0.45;
    this.kickBack.impulse(k.back * 30 * s);
    this.kickUp.impulse(k.up * 30 * s);
    this.kickSide.impulse((Math.random() - 0.5) * k.side * 60 * s);
    this.kickRoll.impulse((Math.random() - 0.5) * k.roll * 60 * s);
    this.bolt.impulse(4);
    this.cylinderSpin += Math.PI / 3;
    this.flashTimer = 0.035;
    const f = this.active.flash;
    f.rotation.z = Math.random() * Math.PI;
    const sc = 0.8 + Math.random() * 0.5;
    f.scale.set(sc, sc, sc);
  }

  landImpact(fallSpeed: number) {
    this.land.impulse(-Math.min(fallSpeed, 14) * 0.035);
  }

  /** Muzzle position in world space (approximate: shares the main camera's frame). */
  muzzleWorld(worldCamera: THREE.Camera, out: THREE.Vector3) {
    this.active.muzzle.getWorldPosition(out); // view space (camera at origin)
    return worldCamera.localToWorld(out);
  }

  update(dt: number, s: ViewmodelState) {
    this.time += dt;
    const m = this.active;
    const g = m.root;

    // ---- Springs -----------------------------------------------------------
    const back = this.kickBack.update(dt);
    const up = this.kickUp.update(dt);
    const side = this.kickSide.update(dt);
    const roll = this.kickRoll.update(dt);
    const landY = this.land.update(dt);
    const boltOff = Math.max(0, this.bolt.update(dt));

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
    const sprintBob = 1 + s.sprint * 1.2;
    const bobX = Math.cos(phase) * 0.011 * bobAmt * sprintBob;
    const bobY = -Math.abs(Math.sin(phase)) * 0.009 * bobAmt * sprintBob;
    const bobRot = Math.cos(phase) * 0.02 * bobAmt * sprintBob;

    // ---- Idle breathing ----------------------------------------------------
    const breath = Math.sin(this.time * 1.5) * 0.0018 * (1 - s.ads * 0.8);
    const breathX = Math.sin(this.time * 0.75) * 0.0012 * (1 - s.ads * 0.8);

    // ---- Base position: hip ↔ ADS -----------------------------------------
    const ease = s.ads * s.ads * (3 - 2 * s.ads);
    g.position.lerpVectors(m.hip, m.ads, ease);
    g.rotation.set(0, 0, 0);

    // Sprint pose: rifle/SMG tilt across the chest, pistol points up.
    if (s.sprint > 0.001) {
      const t = s.sprint;
      if (m.handgun) {
        g.position.y -= 0.03 * t;
        g.rotation.x += 0.5 * t;
        g.rotation.y += 0.25 * t;
      } else {
        g.position.x -= 0.05 * t;
        g.position.y -= 0.045 * t;
        g.rotation.y += 0.75 * t;
        g.rotation.x -= 0.2 * t;
        g.rotation.z += 0.2 * t;
      }
    }
    // Slide pose: cant the weapon.
    g.rotation.z += 0.22 * s.slide;
    g.position.y -= 0.015 * s.slide;

    // Reload choreography.
    let magDrop = 0;
    if (s.reload >= 0 && s.shellReload) {
      // Tilted, left hand thumbing shells into the loading port.
      g.rotation.z += 0.45;
      g.rotation.x += 0.15;
      g.position.y -= 0.03;
      g.position.x -= 0.015;
      const thumb = Math.sin(this.time * 13) * 0.5 + 0.5;
      g.position.y += thumb * 0.006;
    } else if (s.reload >= 0) {
      const r = s.reload;
      const tilt = smooth(r, 0, 0.15) * (1 - smooth(r, 0.85, 1));
      g.rotation.z += 0.55 * tilt;
      g.rotation.x += 0.12 * tilt;
      g.position.y -= 0.035 * tilt;
      g.position.x -= 0.02 * tilt;
      // Mag out (0.18-0.38), new mag in (0.45-0.65), seat jolt at 0.66.
      magDrop = smooth(r, 0.18, 0.38) * (1 - smooth(r, 0.45, 0.65));
      if (r > 0.64 && r < 0.72) g.position.y += Math.sin(((r - 0.64) / 0.08) * Math.PI) * 0.008;
      if (s.reloadEmpty && r > 0.78 && r < 0.9) {
        const b = Math.sin(((r - 0.78) / 0.12) * Math.PI);
        g.rotation.z += 0.12 * b;
        m.bolt.position.z = m.boltRest + 0.04 * b;
      }
    }
    // Pump / bolt cycle after a shot.
    if (m.pump && m.pumpRest !== undefined) {
      const c = s.sinceShot / m.cycle;
      const pull = c > 0.15 && c < 1 ? Math.sin(((c - 0.15) / 0.85) * Math.PI) : 0;
      m.pump.position.z = m.pumpRest + pull * 0.09;
      g.rotation.z += pull * 0.05;
    }
    if (m.cylinder) {
      m.cylinder.rotation.z += (this.cylinderSpin - m.cylinder.rotation.z) * damp(30, dt);
    }

    m.mag.position.copy(m.magRest);
    m.mag.position.y -= magDrop * 0.28;
    m.mag.position.z += magDrop * 0.05;
    m.mag.visible = magDrop < 0.95;

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
      this.knife.position.set(0.22 - swing * 0.36 + ret * 0.14, -0.06 - swing * 0.08 + ret * 0.12 - ret * 0.12, -0.36 + swing * 0.06);
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
      this.grenade.rotation.x = cock * -0.8 + fling * 2;
    }
    // Optic: hide the gun once the scope fills the view.
    g.visible = !(m.scope && s.ads > 0.92);

    // ---- Apply layered offsets --------------------------------------------
    g.position.x += this.sway.x * swayScale + bobX + breathX;
    g.position.y += this.sway.y * swayScale + bobY + breath + landY;
    g.position.z += back;
    g.rotation.x += up + this.sway.y * 2 * swayScale;
    g.rotation.y += side + this.sway.x * 2.5 * swayScale;
    g.rotation.z += roll + bobRot + this.sway.x * 1.5 * swayScale;

    if (s.reload < 0 || !s.reloadEmpty) m.bolt.position.z = m.boltRest + boltOff * 0.012;

    // ---- Muzzle flash ------------------------------------------------------
    this.flashTimer -= dt;
    m.flash.visible = this.flashTimer > 0;
  }

  // ---------------------------------------------------------------------------
  // Procedural models. Origin = sight line, so ADS position is (0, 0, -z).
  // ---------------------------------------------------------------------------

  private build(kind: ModelKind): Model {
    const mats = this.materials();
    const root = new THREE.Group();
    const part = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
      this.disposables.push(geo);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, ry, rz);
      parent.add(mesh);
      return mesh;
    };
    const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
    const cyl = (r: number, len: number, seg = 10) => new THREE.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2);

    const mag = new THREE.Group();
    const bolt = new THREE.Group();
    const muzzle = new THREE.Object3D();
    let hip: THREE.Vector3;
    let ads: THREE.Vector3;

    if (kind === "rifle") {
      part(root, box(0.05, 0.06, 0.34), mats.metal, 0, -0.045, -0.02); // upper receiver
      part(root, box(0.046, 0.05, 0.22), mats.polymer, 0, -0.095, 0.0); // lower
      part(root, box(0.058, 0.062, 0.24), mats.polymer, 0, -0.05, -0.29); // handguard
      for (let i = 0; i < 4; i++) part(root, box(0.062, 0.008, 0.03), mats.metal, 0, -0.02, -0.2 - i * 0.055); // rail slots
      part(root, cyl(0.011, 0.2), mats.metal, 0, -0.045, -0.5); // barrel
      part(root, cyl(0.017, 0.06, 6), mats.dark, 0, -0.045, -0.6); // muzzle brake
      part(root, box(0.04, 0.12, 0.05), mats.polymer, 0, -0.14, 0.09, -0.3); // grip
      part(root, box(0.045, 0.07, 0.2), mats.polymer, 0, -0.07, 0.25); // stock
      part(root, box(0.05, 0.1, 0.03), mats.dark, 0, -0.085, 0.36); // butt pad
      // Iron sights: rear aperture + front post on the sight line (y = 0).
      part(root, box(0.03, 0.03, 0.015), mats.metal, 0, -0.01, 0.08);
      part(root, box(0.004, 0.022, 0.008), mats.metal, 0, -0.008, -0.38);
      part(root, box(0.024, 0.006, 0.008), mats.metal, 0, -0.024, -0.38);
      part(mag, box(0.035, 0.13, 0.06), mats.dark, 0, -0.06, 0, 0.18);
      mag.position.set(0, -0.1, -0.08);
      part(bolt, box(0.012, 0.016, 0.05), mats.metal, 0.028, 0, 0);
      bolt.position.set(0, -0.04, 0.04);
      muzzle.position.set(0, -0.045, -0.64);
      hip = new THREE.Vector3(0.14, -0.15, -0.3);
      ads = new THREE.Vector3(0, 0, -0.2);
      this.arms(root, mats, { gripZ: 0.09, gripY: -0.17, foreZ: -0.27, foreY: -0.09 });
    } else if (kind === "smg") {
      part(root, box(0.052, 0.07, 0.26), mats.polymer, 0, -0.05, -0.02); // body
      part(root, box(0.054, 0.03, 0.2), mats.metal, 0, -0.008, -0.02); // top cover
      part(root, cyl(0.012, 0.12), mats.metal, 0, -0.05, -0.2); // barrel
      part(root, cyl(0.02, 0.1, 8), mats.dark, 0, -0.05, -0.29); // suppressor-ish shroud
      part(root, box(0.04, 0.11, 0.045), mats.polymer, 0, -0.13, 0.06, -0.25); // grip
      part(root, box(0.02, 0.02, 0.18), mats.metal, 0, -0.05, 0.2); // wire stock
      part(root, box(0.05, 0.07, 0.015), mats.metal, 0, -0.06, 0.29);
      part(root, box(0.035, 0.05, 0.08), mats.polymer, 0, -0.1, -0.14); // vertical foregrip
      part(root, box(0.026, 0.012, 0.012), mats.metal, 0, -0.006, 0.07); // rear sight
      part(root, box(0.004, 0.016, 0.008), mats.metal, 0, -0.004, -0.12); // front post
      part(mag, box(0.03, 0.17, 0.035), mats.dark, 0, -0.08, 0, 0.08);
      mag.position.set(0, -0.08, -0.04);
      part(bolt, box(0.01, 0.014, 0.04), mats.metal, -0.028, 0, 0);
      bolt.position.set(0, -0.03, 0.0);
      muzzle.position.set(0, -0.05, -0.35);
      hip = new THREE.Vector3(0.13, -0.14, -0.28);
      ads = new THREE.Vector3(0, 0, -0.2);
      this.arms(root, mats, { gripZ: 0.06, gripY: -0.16, foreZ: -0.14, foreY: -0.14 });
    } else if (kind === "shotgun") {
      part(root, box(0.05, 0.065, 0.3), mats.metal, 0, -0.05, -0.02); // receiver
      part(root, cyl(0.014, 0.42), mats.metal, 0, -0.035, -0.38); // barrel
      part(root, cyl(0.012, 0.34), mats.dark, 0, -0.064, -0.34); // mag tube
      part(root, box(0.04, 0.11, 0.05), mats.wood, 0, -0.13, 0.09, -0.35); // grip
      part(root, box(0.05, 0.08, 0.24), mats.wood, 0, -0.075, 0.26, 0.08); // stock
      part(root, box(0.054, 0.11, 0.03), mats.dark, 0, -0.095, 0.385);
      part(root, box(0.006, 0.012, 0.006), mats.brass, 0, -0.015, -0.58); // bead sight
      part(root, box(0.018, 0.01, 0.12), mats.metal, 0, -0.016, -0.03); // rib
      // Shells on the side saddle (mag stand-in).
      for (let i = 0; i < 4; i++) part(mag, cyl(0.009, 0.05, 8).rotateY(Math.PI / 2), mats.shell, 0.03, -0.035 - (i % 2) * 0.018, -0.02 - Math.floor(i / 2) * 0.022);
      mag.position.set(0, -0.02, -0.02);
      const pump = new THREE.Group();
      part(pump, box(0.06, 0.055, 0.15), mats.polymer, 0, 0, 0);
      for (let i = 0; i < 5; i++) part(pump, box(0.064, 0.006, 0.01), mats.dark, 0, 0.01 - (i % 2) * 0.02, -0.06 + i * 0.03);
      pump.position.set(0, -0.06, -0.3);
      root.add(pump);
      part(bolt, box(0.01, 0.02, 0.05), mats.metal, 0.028, 0, 0);
      bolt.position.set(0, -0.04, 0.02);
      muzzle.position.set(0, -0.035, -0.6);
      hip = new THREE.Vector3(0.14, -0.16, -0.3);
      ads = new THREE.Vector3(0, 0, -0.2);
      this.arms(root, mats, { gripZ: 0.09, gripY: -0.16, foreZ: -0.3, foreY: -0.1 }, pump);
      return this.finish(kind, root, mag, bolt, muzzle, hip, ads, { pump, pumpRest: pump.position.z, cycle: 0.6 });
    } else if (kind === "dmr") {
      part(root, box(0.052, 0.065, 0.36), mats.tan, 0, -0.06, -0.02); // receiver
      part(root, box(0.06, 0.06, 0.26), mats.tan, 0, -0.065, -0.32); // handguard
      part(root, cyl(0.012, 0.26), mats.metal, 0, -0.062, -0.56);
      part(root, cyl(0.018, 0.07, 6), mats.dark, 0, -0.062, -0.7);
      part(root, box(0.04, 0.12, 0.05), mats.polymer, 0, -0.15, 0.09, -0.3);
      part(root, box(0.05, 0.09, 0.22), mats.tan, 0, -0.085, 0.27);
      part(root, box(0.054, 0.035, 0.08), mats.tan, 0, -0.03, 0.27); // cheek riser
      // Scope: tube, bells, turrets. Sight line runs through its center.
      part(root, cyl(0.02, 0.24, 14), mats.dark, 0, 0, -0.05);
      part(root, cyl(0.028, 0.06, 14), mats.dark, 0, 0, -0.19);
      part(root, cyl(0.025, 0.04, 14), mats.dark, 0, 0, 0.08);
      part(root, cyl(0.011, 0.025, 8).rotateX(Math.PI / 2), mats.metal, 0, 0.028, -0.05);
      part(root, cyl(0.011, 0.025, 8).rotateZ(Math.PI / 2), mats.metal, 0.028, 0, -0.05);
      part(root, new THREE.CircleGeometry(0.024, 16), mats.lens, 0, 0, -0.221);
      part(root, box(0.018, 0.03, 0.03), mats.metal, 0, -0.026, -0.12); // mounts
      part(root, box(0.018, 0.03, 0.03), mats.metal, 0, -0.026, 0.02);
      part(mag, box(0.035, 0.09, 0.07), mats.dark, 0, -0.04, 0, 0.1);
      mag.position.set(0, -0.11, -0.08);
      part(bolt, box(0.012, 0.016, 0.05), mats.metal, 0.03, 0, 0);
      bolt.position.set(0, -0.05, 0.04);
      muzzle.position.set(0, -0.062, -0.74);
      hip = new THREE.Vector3(0.14, -0.15, -0.3);
      ads = new THREE.Vector3(0, 0, -0.16);
      this.arms(root, mats, { gripZ: 0.09, gripY: -0.18, foreZ: -0.3, foreY: -0.1 });
      return this.finish(kind, root, mag, bolt, muzzle, hip, ads, { scope: true, cycle: 0.25 });
    } else if (kind === "lmg") {
      part(root, box(0.07, 0.08, 0.38), mats.metal, 0, -0.06, -0.02); // receiver
      part(root, box(0.075, 0.03, 0.26), mats.dark, 0, -0.008, -0.04); // feed cover
      part(root, box(0.07, 0.07, 0.24), mats.polymer, 0, -0.065, -0.34); // handguard
      part(root, cyl(0.016, 0.3), mats.metal, 0, -0.06, -0.58); // heavy barrel
      part(root, cyl(0.022, 0.07, 6), mats.dark, 0, -0.06, -0.74);
      part(root, box(0.03, 0.03, 0.06), mats.metal, 0, -0.02, -0.42); // carry handle base
      part(root, box(0.016, 0.05, 0.12), mats.metal, 0, 0.02, -0.18, 0, 0, 0); // carry handle
      part(root, box(0.04, 0.12, 0.05), mats.polymer, 0, -0.15, 0.09, -0.3);
      part(root, box(0.055, 0.085, 0.22), mats.polymer, 0, -0.08, 0.27);
      part(root, box(0.004, 0.024, 0.008), mats.metal, 0, -0.006, -0.46); // front post
      part(root, box(0.028, 0.026, 0.012), mats.metal, 0, -0.008, 0.12); // rear aperture
      // Box mag + belt.
      part(mag, box(0.09, 0.12, 0.12), mats.olive, -0.01, -0.06, 0);
      part(mag, box(0.02, 0.04, 0.06), mats.brass, 0.045, 0.01, 0);
      mag.position.set(-0.03, -0.11, -0.08);
      part(bolt, box(0.014, 0.02, 0.06), mats.metal, 0.04, 0, 0);
      bolt.position.set(0, -0.05, 0.04);
      muzzle.position.set(0, -0.06, -0.78);
      hip = new THREE.Vector3(0.15, -0.17, -0.32);
      ads = new THREE.Vector3(0, 0, -0.18);
      this.arms(root, mats, { gripZ: 0.09, gripY: -0.18, foreZ: -0.33, foreY: -0.11 });
    } else if (kind === "revolver") {
      part(root, box(0.03, 0.04, 0.12), mats.metal, 0, -0.05, -0.02); // frame
      part(root, cyl(0.016, 0.16, 12), mats.metal, 0, -0.04, -0.15); // barrel
      part(root, box(0.016, 0.014, 0.16), mats.metal, 0, -0.02, -0.15); // rib
      part(root, box(0.034, 0.12, 0.05), mats.wood, 0, -0.12, 0.05, -0.35); // grip
      part(root, box(0.006, 0.014, 0.008), mats.brass, 0, -0.006, -0.225); // front sight
      part(root, box(0.02, 0.008, 0.008), mats.metal, 0, -0.012, 0.035);
      part(root, box(0.008, 0.02, 0.02), mats.metal, 0, -0.028, 0.045, 0.6); // hammer
      const cylinder = new THREE.Group();
      part(cylinder, new THREE.CylinderGeometry(0.026, 0.026, 0.05, 6).rotateX(Math.PI / 2), mats.metal, 0, 0, 0);
      cylinder.position.set(0, -0.045, -0.035);
      root.add(cylinder);
      part(mag, cyl(0.02, 0.03, 6), mats.brass, 0, 0, 0); // speedloader
      mag.position.set(-0.04, -0.12, 0.0);
      part(bolt, box(0.004, 0.004, 0.004), mats.metal, 0, 0, 0);
      muzzle.position.set(0, -0.04, -0.24);
      hip = new THREE.Vector3(0.11, -0.13, -0.32);
      ads = new THREE.Vector3(0, 0, -0.29);
      this.arms(root, mats, { gripZ: 0.05, gripY: -0.15, foreZ: 0.04, foreY: -0.17, twoHandedPistol: true });
      return this.finish(kind, root, mag, bolt, muzzle, hip, ads, { cylinder, handgun: true });
    } else {
      part(root, box(0.034, 0.045, 0.19), mats.dark, 0, -0.06, -0.05); // frame
      part(root, box(0.03, 0.11, 0.045), mats.polymer, 0, -0.12, 0.02, -0.25); // grip
      part(root, box(0.028, 0.012, 0.02), mats.polymer, 0, -0.085, -0.01); // trigger guard
      part(root, box(0.008, 0.012, 0.008), mats.metal, 0, -0.012, -0.135); // front sight
      part(root, box(0.022, 0.01, 0.008), mats.metal, 0, -0.015, 0.035); // rear sight
      part(bolt, box(0.036, 0.03, 0.19), mats.metal, 0, 0, 0); // slide
      bolt.position.set(0, -0.032, -0.05);
      part(mag, box(0.024, 0.09, 0.035), mats.dark, 0, -0.04, 0, -0.25);
      mag.position.set(0, -0.12, 0.02);
      muzzle.position.set(0, -0.035, -0.16);
      hip = new THREE.Vector3(0.11, -0.13, -0.32);
      ads = new THREE.Vector3(0, 0, -0.27);
      this.arms(root, mats, { gripZ: 0.03, gripY: -0.15, foreZ: 0.02, foreY: -0.17, twoHandedPistol: true });
      return this.finish(kind, root, mag, bolt, muzzle, hip, ads, { handgun: true });
    }

    return this.finish(kind, root, mag, bolt, muzzle, hip, ads, {});
  }

  private finish(
    _kind: ModelKind,
    root: THREE.Group,
    mag: THREE.Group,
    bolt: THREE.Group,
    muzzle: THREE.Object3D,
    hip: THREE.Vector3,
    ads: THREE.Vector3,
    extra: Partial<Pick<Model, "pump" | "pumpRest" | "cylinder" | "handgun" | "scope" | "cycle">>,
  ): Model {
    const mats = this.materials();
    root.add(mag, bolt, muzzle);

    // Muzzle flash: three crossed additive cards.
    const flash = new THREE.Group();
    const card = new THREE.PlaneGeometry(0.16, 0.16);
    const side = new THREE.PlaneGeometry(0.22, 0.09).translate(0, 0, 0);
    this.disposables.push(card, side);
    flash.add(new THREE.Mesh(card, mats.flash));
    const s1 = new THREE.Mesh(side, mats.flashSide);
    s1.rotation.set(0, Math.PI / 2, 0);
    s1.position.z = -0.08;
    const s2 = s1.clone();
    s2.rotation.set(Math.PI / 2, Math.PI / 2, 0);
    flash.add(s1, s2);
    flash.visible = false;
    muzzle.add(flash);

    return {
      root, mag, magRest: mag.position.clone(), bolt, boltRest: bolt.position.z, muzzle, flash, hip, ads,
      handgun: false, scope: false, cycle: 0.2, ...extra,
    };
  }

  private buildKnife() {
    const mats = this.materials();
    const blade = new THREE.BufferGeometry();
    // Simple tanto-ish blade profile, extruded thin.
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(0.17, 0.004);
    shape.lineTo(0.2, 0.022);
    shape.lineTo(0.0, 0.03);
    shape.lineTo(0, 0);
    const bladeGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.004, bevelEnabled: false }).translate(0, -0.015, -0.002);
    blade.dispose();
    const handle = new THREE.BoxGeometry(0.1, 0.03, 0.024).translate(-0.05, 0, 0);
    const guard = new THREE.BoxGeometry(0.01, 0.05, 0.03);
    this.disposables.push(bladeGeo, handle, guard);
    const b = new THREE.Mesh(bladeGeo, mats.blade);
    const h = new THREE.Mesh(handle, mats.polymer);
    const gd = new THREE.Mesh(guard, mats.dark);
    const knife = new THREE.Group();
    knife.add(b, h, gd);
    knife.rotation.y = Math.PI / 2;
    this.knife.add(knife);
    const fist = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.08), mats.glove);
    fist.position.set(0, 0, 0.05);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.036, 0.4, 8).rotateX(Math.PI / 2).translate(0, 0, 0.28), mats.sleeve);
    this.disposables.push(fist.geometry, arm.geometry);
    this.knife.add(fist, arm);
    this.knife.visible = false;
    this.pivot.add(this.knife);
  }

  private buildGrenade() {
    const mats = this.materials();
    const body = new THREE.SphereGeometry(0.03, 12, 10);
    const top = new THREE.CylinderGeometry(0.012, 0.012, 0.025, 8);
    const hand = new THREE.BoxGeometry(0.05, 0.05, 0.07);
    const arm = new THREE.CylinderGeometry(0.03, 0.036, 0.4, 8).rotateX(Math.PI / 2).translate(0, 0, 0.26);
    this.disposables.push(body, top, hand, arm);
    const g = new THREE.Mesh(body, mats.olive);
    const t = new THREE.Mesh(top, mats.metal);
    t.position.y = 0.035;
    const h = new THREE.Mesh(hand, mats.glove);
    h.position.set(0, -0.025, 0.03);
    this.grenade.add(g, t, h, new THREE.Mesh(arm, mats.sleeve));
    this.grenade.visible = false;
    this.pivot.add(this.grenade);
  }

  /** Gloved hands + sleeves reaching off-screen. */
  private arms(
    root: THREE.Group,
    mats: ReturnType<WeaponViewmodel["materials"]>,
    o: { gripZ: number; gripY: number; foreZ: number; foreY: number; twoHandedPistol?: boolean },
    leftParent?: THREE.Object3D,
  ) {
    let parent: THREE.Object3D = root;
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, p: THREE.Vector3, look: THREE.Vector3) => {
      this.disposables.push(geo);
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(p);
      m.lookAt(look);
      if (parent !== root) {
        // Left hand rides the pump: convert to the pump's local frame.
        m.position.sub(parent.position);
      }
      parent.add(m);
    };
    const forearm = (len: number) => new THREE.CylinderGeometry(0.03, 0.036, len, 8).rotateX(Math.PI / 2).translate(0, 0, len / 2);
    const glove = new THREE.BoxGeometry(0.05, 0.045, 0.075);

    // Right hand on the grip, forearm running back and down-right.
    const rHand = new THREE.Vector3(0.012, o.gripY, o.gripZ);
    add(glove, mats.glove, rHand, tmpV.set(0.03, o.gripY - 0.05, o.gripZ + 0.2));
    add(forearm(0.36), mats.sleeve, rHand.clone().add(new THREE.Vector3(0.01, -0.02, 0.03)), new THREE.Vector3(0.18, -0.3, 0.4));

    // Left hand on the handguard (or cupping the pistol grip).
    if (leftParent) parent = leftParent;
    const lHand = o.twoHandedPistol ? new THREE.Vector3(-0.02, o.foreY, o.foreZ) : new THREE.Vector3(-0.012, o.foreY - 0.02, o.foreZ);
    add(glove.clone(), mats.glove, lHand, tmpV.set(-0.05, o.foreY - 0.05, o.foreZ + 0.2));
    add(forearm(0.42), mats.sleeve, lHand.clone().add(new THREE.Vector3(-0.01, -0.02, 0.03)), new THREE.Vector3(-0.22, -0.32, 0.35));
  }

  private matCache: ReturnType<WeaponViewmodel["createMaterials"]> | null = null;
  private materials() {
    return (this.matCache ??= this.createMaterials());
  }
  private createMaterials() {
    const metal = new THREE.MeshStandardMaterial({ color: 0x2c2e31, metalness: 0.75, roughness: 0.38 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1c1e, metalness: 0.5, roughness: 0.5 });
    const polymer = new THREE.MeshStandardMaterial({ color: 0x3b3a33, metalness: 0.05, roughness: 0.75 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x2b2a26, metalness: 0, roughness: 0.9 });
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x4d5240, metalness: 0, roughness: 0.95 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3b22, metalness: 0, roughness: 0.6 });
    const tan = new THREE.MeshStandardMaterial({ color: 0x8a7a5c, metalness: 0.1, roughness: 0.7 });
    const olive = new THREE.MeshStandardMaterial({ color: 0x4a5236, metalness: 0.2, roughness: 0.7 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.9, roughness: 0.3 });
    const shell = new THREE.MeshStandardMaterial({ color: 0x9b2a20, metalness: 0.2, roughness: 0.5 });
    const blade = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.95, roughness: 0.18 });
    const lens = new THREE.MeshStandardMaterial({ color: 0x1a3550, metalness: 0.9, roughness: 0.05, emissive: 0x0a1a28 });
    const flashTex = makeFlashTexture(false);
    const sideTex = makeFlashTexture(true);
    const flashBase = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false };
    const flash = new THREE.MeshBasicMaterial({ ...flashBase, map: flashTex, color: new THREE.Color(3, 2.2, 1.4) });
    const flashSide = new THREE.MeshBasicMaterial({ ...flashBase, map: sideTex, color: new THREE.Color(2.5, 1.7, 0.9) });
    this.disposables.push(metal, dark, polymer, glove, sleeve, wood, tan, olive, brass, shell, blade, lens, flash, flashSide, flashTex, sideTex);
    return { metal, dark, polymer, glove, sleeve, wood, tan, olive, brass, shell, blade, lens, flash, flashSide };
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
  }
}

function smooth(x: number, a: number, b: number) {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function makeFlashTexture(sideways: boolean) {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  if (sideways) {
    const g = ctx.createLinearGradient(0, 32, 64, 32);
    g.addColorStop(0, "rgba(255,200,120,0)");
    g.addColorStop(0.35, "rgba(255,220,160,0.9)");
    g.addColorStop(1, "rgba(255,140,40,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(32, 32, 32, 10, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,250,230,1)");
    g.addColorStop(0.25, "rgba(255,190,90,0.85)");
    g.addColorStop(1, "rgba(255,110,20,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    for (let i = 0; i < 12; i++) {
      const r = i % 2 ? 9 : 32;
      const a = (i / 12) * Math.PI * 2;
      ctx.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
    }
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
