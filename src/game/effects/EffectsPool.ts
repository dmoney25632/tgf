import * as THREE from "three";
import { QUALITY, type QualityName } from "../config";
import { ParticleSystem, SHAPE } from "./Particles";
import { StreakSystem } from "./Streaks";
import { ShellPool, type ShellKind } from "./Shells";
import { DECAL, DecalPool } from "./Decals";
import { fxLightingFor, type FxLighting } from "./FxLighting";
import { fireballAtlas } from "./ProceduralFx";

export type Surface = "concrete" | "metal" | "wood" | "sand" | "target" | "steel" | "flesh" | "armor" | "dirt" | "glass";
export type { ShellKind };

/**
 * Finer impact class than Surface: the world material (mesh userData.material)
 * splits concrete into brick / plaster and sand into loose dirt / gravel.
 */
export type ImpactKind = Surface | "brick" | "plaster" | "gravel";

/** Surface + optional world-material name → impact class. */
export function impactKind(surface: Surface, material?: string | null): ImpactKind {
  if (!material) return surface;
  if (surface === "concrete") {
    if (material === "brick") return "brick";
    if (material.startsWith("plaster") || material === "worn_plaster_wall") return "plaster";
    return "concrete";
  }
  if (surface === "sand") {
    if (material === "ground") return "dirt";
    if (material === "gravel" || material === "rubble") return "gravel";
    return "sand";
  }
  return surface;
}

type RGB = readonly [number, number, number];

/**
 * Per-surface bullet-impact recipe. Counts are at high quality (scaled by
 * FX_QUALITY.impactScale). Colours are linear RGB.
 */
export type ImpactProfile = {
  /** Decal tiles to pick from (empty = no hole). */
  decals: readonly number[];
  decalSize: number;
  decalStretch: number;
  /** Ballistic chips / splinters / clumps. */
  chips: number;
  chipShape: number;
  chipSize: number;
  chipSpeed: number;
  /** Extra upward bias for the chips (dirt sprays up). */
  chipUp: number;
  chip: RGB;
  /** Soft dust puffs that drift and settle. */
  dust: number;
  dustSize: number;
  dustAlpha: number;
  dustCol: RGB;
  /** A fast puff jetting straight out of the hole. */
  jet: boolean;
  /** Dirt spray: a tall, fast plume. */
  plume: boolean;
  /** Hot spark streaks. */
  sparks: number;
  /** Bright metal flash (glow point + impact light hook). */
  flash: number;
  /** Tiny glints (glass). */
  glints: number;
};

const P = (p: Partial<ImpactProfile>): ImpactProfile => ({
  decals: [], decalSize: 0.1, decalStretch: 1,
  chips: 6, chipShape: SHAPE.chip, chipSize: 0.022, chipSpeed: 4, chipUp: 0.5, chip: [0.5, 0.49, 0.46],
  dust: 2, dustSize: 0.5, dustAlpha: 0.5, dustCol: [0.62, 0.6, 0.57],
  jet: false, plume: false, sparks: 0, flash: 0, glints: 0,
  ...p,
});

export const IMPACT: Record<ImpactKind, ImpactProfile> = {
  concrete: P({ decals: [DECAL.concreteA, DECAL.concreteB], chips: 8, chipShape: SHAPE.flake, chip: [0.5, 0.49, 0.46], dust: 3, dustCol: [0.62, 0.6, 0.57], jet: true, sparks: 2 }),
  brick: P({ decals: [DECAL.brick], chips: 8, chipShape: SHAPE.flake, chip: [0.45, 0.22, 0.15], dust: 3, dustCol: [0.6, 0.42, 0.34], jet: true }),
  plaster: P({ decals: [DECAL.plaster], decalSize: 0.13, chips: 6, chipShape: SHAPE.flake, chipSize: 0.026, chip: [0.78, 0.76, 0.72], dust: 4, dustSize: 0.62, dustAlpha: 0.55, dustCol: [0.8, 0.78, 0.74], jet: true }),
  metal: P({ decals: [DECAL.metal, DECAL.metalPaint], decalSize: 0.065, chips: 2, chipSize: 0.012, chip: [0.32, 0.3, 0.28], dust: 1, dustSize: 0.3, dustAlpha: 0.25, dustCol: [0.45, 0.44, 0.43], sparks: 10, flash: 1 }),
  steel: P({ decals: [DECAL.metal], decalSize: 0.055, chips: 1, chipSize: 0.012, chip: [0.45, 0.45, 0.47], dust: 1, dustSize: 0.25, dustAlpha: 0.2, dustCol: [0.5, 0.5, 0.5], sparks: 14, flash: 1.4 }),
  armor: P({ chips: 2, chipSize: 0.012, chip: [0.35, 0.35, 0.35], dust: 1, dustSize: 0.25, dustAlpha: 0.2, dustCol: [0.5, 0.5, 0.5], sparks: 7, flash: 0.8 }),
  wood: P({ decals: [DECAL.wood, DECAL.woodB], decalSize: 0.09, decalStretch: 1.3, chips: 9, chipShape: SHAPE.splinter, chipSize: 0.045, chipSpeed: 4.5, chip: [0.55, 0.4, 0.24], dust: 2, dustSize: 0.38, dustAlpha: 0.4, dustCol: [0.5, 0.42, 0.32] }),
  sand: P({ decals: [DECAL.sand], decalSize: 0.14, chips: 10, chipSize: 0.016, chipSpeed: 3.5, chipUp: 1.1, chip: [0.56, 0.47, 0.33], dust: 4, dustSize: 0.75, dustCol: [0.66, 0.57, 0.42], plume: true }),
  dirt: P({ decals: [DECAL.dirt, DECAL.dirtB], decalSize: 0.15, chips: 10, chipSize: 0.024, chipSpeed: 3.8, chipUp: 1.2, chip: [0.26, 0.2, 0.14], dust: 4, dustSize: 0.7, dustCol: [0.42, 0.35, 0.26], plume: true }),
  gravel: P({ decals: [DECAL.dirt], decalSize: 0.12, chips: 10, chipShape: SHAPE.flake, chipSize: 0.026, chipSpeed: 4.5, chipUp: 1, chip: [0.42, 0.4, 0.37], dust: 3, dustSize: 0.6, dustCol: [0.55, 0.52, 0.47], plume: true, sparks: 1 }),
  glass: P({ decals: [DECAL.glass], decalSize: 0.12, chips: 8, chipShape: SHAPE.flake, chipSize: 0.018, chipSpeed: 3, chip: [0.7, 0.8, 0.84], dust: 1, dustSize: 0.25, dustAlpha: 0.2, dustCol: [0.75, 0.78, 0.8], glints: 5 }),
  target: P({ chips: 8, chip: [0.68, 0.36, 0.14], dust: 2, dustCol: [0.6, 0.5, 0.4] }),
  // Flesh is handled by blood(): short, tasteful mist + a few droplets, no decal.
  flesh: P({ chips: 6, chip: [0.28, 0.015, 0.012], dust: 2, dustCol: [0.32, 0.02, 0.02] }),
};

/** Quality knobs for this module. */
export type FxQuality = {
  /** Multiplier on impact chip / dust / spark counts. */
  impactScale: number;
  /** Seconds before a bullet hole fades out. */
  decalLife: number;
  /** Live ejected casings. */
  shells: number;
  /** Smoking debris chunks per explosion. */
  debrisTrails: number;
  /** Flipbook fireball puffs per explosion. */
  fireballs: number;
  /** Lingering barrel smoke after sustained fire. */
  barrelSmoke: boolean;
  /** Bullet-whizz air streaks past the camera. */
  whizz: boolean;
};

export const FX_QUALITY: Record<QualityName, FxQuality> = {
  low: { impactScale: 0.55, decalLife: 25, shells: 16, debrisTrails: 0, fireballs: 5, barrelSmoke: false, whizz: true },
  medium: { impactScale: 0.8, decalLife: 45, shells: 28, debrisTrails: 4, fireballs: 7, barrelSmoke: true, whizz: true },
  high: { impactScale: 1, decalLife: 75, shells: 40, debrisTrails: 7, fireballs: 9, barrelSmoke: true, whizz: true },
};

/** Which preset a (maxDecals, maxParticles) pair belongs to. */
export function qualityFromLimits(maxDecals: number, maxParticles: number): QualityName {
  for (const k of Object.keys(QUALITY) as QualityName[]) {
    if (QUALITY[k].maxDecals === maxDecals && QUALITY[k].maxParticles === maxParticles) return k;
  }
  return maxParticles <= 300 ? "low" : maxParticles <= 600 ? "medium" : "high";
}

/**
 * Tracer cadence: every Nth round shows a tracer, and the first round after
 * a pause always does (single shots from bolt guns / pistols stay visible).
 */
export class TracerCadence {
  private n = 0;
  private last = -1e9;
  constructor(readonly every: number, readonly pause = 0.35) {}
  /** Should the round fired at time `t` (s) be a tracer? */
  next(t: number) {
    const fresh = t - this.last > this.pause;
    this.last = t;
    if (fresh) {
      this.n = 1;
      return true;
    }
    this.n++;
    if (this.n >= this.every) {
      this.n = 0;
      return true;
    }
    return false;
  }
}

/** Optional dynamic light request (wire to the renderer's flash light pool if it has one). */
export type ImpactLightFn = (at: THREE.Vector3, color: RGB, intensity: number, duration: number, radius: number) => void;
/** A round passed the camera within `distance` metres at `at`. */
export type WhizzFn = (at: THREE.Vector3, distance: number, hostile: boolean) => void;

const MAX_TRACERS = 48;
const TRACER_SPEED = 620; // m/s, visual only
const TRACER_LENGTH = 8;
const PLAYER_TRACER_EVERY = 3;
const HOSTILE_TRACER_EVERY = 2;
const WHIZZ_RADIUS = 2.6;
const MAX_FLASHES = 3;
const MAX_TRAILS = 8;
const BLAST_LIGHT: RGB = [1, 0.6, 0.25];
const SPARK_LIGHT: RGB = [1, 0.72, 0.4];

type Tracer = {
  from: THREE.Vector3; dir: THREE.Vector3; dist: number; travelled: number;
  active: boolean; visible: boolean; hostile: boolean; width: number;
  /** Distance along the path where it passes the camera (-1 = never close). */
  whizzAt: number; whizzDist: number;
};
type Blast = { sprite: THREE.Sprite; ring: THREE.Mesh; t: number; active: boolean };
type Trail = { pos: THREE.Vector3; vel: THREE.Vector3; life: number; emit: number; floor: number };

const rnd = (a = 1) => (Math.random() - 0.5) * 2 * a;
const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length) % a.length];

/**
 * All transient combat visuals, pooled: tracers (+ glow and near-miss
 * whizz streaks), spark streaks, glow sparks, lit debris / splinters, lit
 * dust and smoke, fire, flipbook fireballs, smoking debris trails, brass,
 * normal-mapped decals, explosion flashes / shockwaves, barrel smoke and
 * the world-space muzzle / blast lights. Nothing allocates per shot.
 */
export class EffectsPool {
  readonly sparks: ParticleSystem;
  readonly debris: ParticleSystem;
  readonly smoke: ParticleSystem;
  readonly fire: ParticleSystem;
  readonly fireball: ParticleSystem;
  private readonly streaks: StreakSystem;
  private readonly tracerFx: StreakSystem;
  private readonly tracers: Tracer[] = [];
  private nextTracer = 0;
  private readonly playerCadence = new TracerCadence(PLAYER_TRACER_EVERY);
  private readonly hostileCadence = new TracerCadence(HOSTILE_TRACER_EVERY, 0.2);
  readonly shells: ShellPool;
  private readonly decals: DecalPool;
  private readonly blasts: Blast[] = [];
  private nextBlast = 0;
  private readonly trails: Trail[] = [];
  private nextTrail = 0;
  private readonly flashTex: THREE.DataTexture;
  private readonly ringTex: THREE.DataTexture;
  private readonly fireballTex: THREE.DataTexture;
  private readonly ringGeo = new THREE.PlaneGeometry(1, 1);
  private readonly light: FxLighting;
  private q: FxQuality = FX_QUALITY.high;
  private quality: QualityName = "high";
  private clock = 0;

  readonly muzzleLight = new THREE.PointLight(0xffa850, 0, 8, 2);
  private muzzleTimer = 0;
  /** Big light for explosions. */
  readonly blastLight = new THREE.PointLight(0xff9a40, 0, 28, 2);
  private blastTimer = 0;

  // Barrel smoke: heat builds with sustained fire, wisps rise once it stops.
  private barrelHeat = 0;
  private sinceShot = 1e9;
  private barrelEmit = 0;
  private readonly muzzleLocal = new THREE.Vector3();
  private readonly muzzleFwd = new THREE.Vector3();
  private viewCam: THREE.Camera | null = null;
  /** World orientation of the rendering camera (it may be parented to a rig). */
  private readonly viewQuat = new THREE.Quaternion();
  /** Where the rendering camera is (captured each frame; see setViewer). */
  readonly viewer = new THREE.Vector3(0, -1e6, 0);
  /** Floor height under the player (from shell ejection), for chips off nearby walls. */
  private floorHint = -Infinity;

  private impactLight: ImpactLightFn | null = null;
  private whizzHook: WhizzFn | null = null;

  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly t1 = new THREE.Vector3();
  private readonly t2 = new THREE.Vector3();
  private readonly tq = new THREE.Quaternion();

  /** Shell hit the floor (hook up a tinkle sound). */
  set onShellLand(fn: ((at: THREE.Vector3, kind: ShellKind, speed: number) => void) | null) {
    this.shells.onLand = fn;
  }

  /** Optional: a short dynamic light at metal sparks and explosions (the integrator wires it). */
  setImpactLightHook(fn: ImpactLightFn | null) {
    this.impactLight = fn;
  }

  /** Optional: a round passing within ~2.6 m of the camera (for a crack / whizz sound). */
  setWhizzHook(fn: WhizzFn | null) {
    this.whizzHook = fn;
  }

  constructor(scene: THREE.Scene, maxDecals: number, maxParticles: number) {
    this.light = fxLightingFor(scene);
    const lu = this.light.uniforms;
    const cap = Math.max(768, maxParticles);
    this.sparks = new ParticleSystem(cap, true, "glow", lu);
    this.debris = new ParticleSystem(cap, false, "chunk", lu);
    this.smoke = new ParticleSystem(cap, false, "smoke", lu);
    this.fire = new ParticleSystem(Math.max(256, cap / 2), true, "fire", lu);
    this.fireballTex = fireballAtlas();
    this.fireball = new ParticleSystem(96, false, "fireball", lu, this.fireballTex);
    this.smoke.points.renderOrder = 2;
    this.fireball.points.renderOrder = 3;
    this.fire.points.renderOrder = 3;
    this.streaks = new StreakSystem(Math.max(384, cap / 2), { tailFade: 1, core: 0.8 });
    this.tracerFx = new StreakSystem(MAX_TRACERS * 2, { tailFade: 1, core: 1.2 });
    this.shells = new ShellPool(scene, 40);
    this.decals = new DecalPool(scene, 192, maxDecals, lu);
    scene.add(this.sparks.points, this.debris.points, this.smoke.points, this.fire.points, this.fireball.points, this.streaks.mesh, this.tracerFx.mesh, this.muzzleLight, this.blastLight);
    // The tracer mesh is always drawn: use it to learn where the rendering camera is.
    this.tracerFx.mesh.onBeforeRender = (_r, _s, camera) => {
      if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
        this.viewCam = camera;
        this.viewer.setFromMatrixPosition(camera.matrixWorld);
        this.viewQuat.setFromRotationMatrix(camera.matrixWorld);
      }
    };

    for (let i = 0; i < MAX_TRACERS; i++) {
      this.tracers.push({ from: new THREE.Vector3(), dir: new THREE.Vector3(), dist: 0, travelled: 0, active: false, visible: false, hostile: false, width: 0.02, whizzAt: -1, whizzDist: 0 });
      this.tracerFx.hide(i * 2);
      this.tracerFx.hide(i * 2 + 1);
    }
    this.tracerFx.flush();
    for (let i = 0; i < MAX_TRAILS; i++) this.trails.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, emit: 0, floor: -Infinity });

    this.flashTex = radialTexture(64, (r) => Math.pow(Math.max(0, 1 - r), 2.2));
    this.ringTex = radialTexture(128, (r) => Math.exp(-Math.pow((r - 0.82) / 0.07, 2)) * (r < 1 ? 1 : 0) + Math.exp(-Math.pow((r - 0.7) / 0.18, 2)) * 0.25 * (r < 0.82 ? 1 : 0));
    for (let i = 0; i < MAX_FLASHES; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flashTex, color: new THREE.Color(6, 4.2, 2.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, fog: false }));
      sprite.visible = false;
      const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ map: this.ringTex, color: new THREE.Color(1.4, 1.25, 1.05), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide, toneMapped: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      ring.frustumCulled = false;
      sprite.frustumCulled = false;
      scene.add(sprite, ring);
      this.blasts.push({ sprite, ring, t: 0, active: false });
    }
    this.setLimits(maxDecals, maxParticles);
  }

  setLimits(maxDecals: number, maxParticles: number) {
    this.decals.setCap(maxDecals);
    this.sparks.cap = Math.min(maxParticles, this.sparks.capacity);
    this.debris.cap = Math.min(maxParticles, this.debris.capacity);
    this.smoke.cap = Math.min(maxParticles, this.smoke.capacity);
    this.fire.cap = Math.min(Math.max(64, maxParticles / 2), this.fire.capacity);
    this.streaks.cap = Math.min(Math.max(96, maxParticles / 2), this.streaks.capacity);
    this.setQuality(qualityFromLimits(maxDecals, maxParticles));
  }

  /** Apply this module's quality knobs (setLimits infers the preset automatically). */
  setQuality(q: QualityName) {
    this.quality = q;
    this.q = FX_QUALITY[q];
    this.decals.setLife(this.q.decalLife);
    this.shells.setCap(this.q.shells);
  }

  get qualityName() {
    return this.quality;
  }

  /** Override the camera position used for whizz / barrel smoke (normally captured at render). */
  setViewer(pos: THREE.Vector3) {
    this.viewer.copy(pos);
  }

  setViewportHeight(h: number) {
    this.sparks.setViewportHeight(h);
    this.debris.setViewportHeight(h);
    this.smoke.setViewportHeight(h);
    this.fire.setViewportHeight(h);
    this.fireball.setViewportHeight(h);
    this.streaks.setViewportHeight(h);
    this.tracerFx.setViewportHeight(h);
  }

  /**
   * Player muzzle: short light flash, plus (when a direction is given) a
   * hot puff and smoke wisps. Sustained fire heats the barrel, which then
   * smokes for a while after the trigger is released. `strength` ~ weapon
   * size (1 = rifle).
   */
  muzzleFlash(at: THREE.Vector3, dir?: THREE.Vector3, strength = 1) {
    this.muzzleLight.position.copy(at);
    this.muzzleLight.intensity = (7 + Math.random() * 4) * Math.min(2, strength);
    this.muzzleTimer = 0.045;
    if (!dir) return;
    const s = Math.min(2, strength);
    // Brief incandescent puff just ahead of the muzzle.
    this.fire.spawn(at.x + dir.x * 0.08, at.y + dir.y * 0.08, at.z + dir.z * 0.08, dir.x * 2, dir.y * 2, dir.z * 2, 1.6, 1.2, 1, 0.06, 0.05 * s, 0.14 * s, 0.7, 0, 8);
    // Smoke wisps: drift forward, slow down, rise and linger.
    const n = s > 1.3 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const f = 0.1 + Math.random() * 0.25;
      const sp = 0.6 + Math.random() * 1.2;
      const g = 0.55 + Math.random() * 0.12;
      this.smoke.spawn(
        at.x + dir.x * f, at.y + dir.y * f, at.z + dir.z * f,
        dir.x * sp + rnd(0.15), dir.y * sp + 0.12 + Math.random() * 0.15, dir.z * sp + rnd(0.15),
        g, g, g * 1.02, 1.3 + Math.random() * 1.1, 0.05 * s, (0.32 + Math.random() * 0.25) * s, 0.13 + 0.05 * s, -0.12, 2.2,
      );
    }
    // Barrel heat + where the muzzle sits relative to the view (for the after-smoke).
    this.barrelHeat = Math.min(1.5, this.barrelHeat + 0.07 * s);
    this.sinceShot = 0;
    if (this.viewCam) {
      this.tq.copy(this.viewQuat).invert();
      this.muzzleLocal.copy(at).sub(this.viewer).applyQuaternion(this.tq);
      this.muzzleFwd.copy(dir).applyQuaternion(this.tq);
    }
  }

  /** Brass leaving the ejection port (world space). */
  ejectShell(pos: THREE.Vector3, vel: THREE.Vector3, orient: THREE.Quaternion, kind: ShellKind, groundY: number) {
    this.floorHint = groundY;
    this.shells.spawn(pos, vel, orient, kind, groundY);
  }

  /**
   * A fired round from `from` to `to`. Player rounds show a tracer every
   * 3rd shot (and on the first shot after a pause); hostile rounds every
   * 2nd. Any round that passes close to the camera gets a whizz streak.
   */
  tracer(from: THREE.Vector3, to: THREE.Vector3, hostile = false) {
    const visible = (hostile ? this.hostileCadence : this.playerCadence).next(this.clock);
    this.tmp.subVectors(to, from);
    const dist = this.tmp.length();
    if (dist < 2) return;
    this.tmp.divideScalar(dist);
    // Closest approach to the viewer (player rounds start at the camera: skip them).
    let whizzAt = -1;
    let whizzDist = 0;
    if (hostile && this.q.whizz) {
      const along = this.t1.subVectors(this.viewer, from).dot(this.tmp);
      if (along > 3 && along < dist + 1) {
        this.t2.copy(from).addScaledVector(this.tmp, along);
        const d = this.t2.distanceTo(this.viewer);
        if (d < WHIZZ_RADIUS) {
          whizzAt = along;
          whizzDist = d;
        }
      }
    }
    if (!visible && whizzAt < 0) return;
    const i = this.nextTracer;
    const t = this.tracers[i];
    this.nextTracer = (this.nextTracer + 1) % MAX_TRACERS;
    t.from.copy(from);
    t.dir.copy(this.tmp);
    t.dist = dist;
    t.travelled = hostile ? 0.5 : 1.2; // start slightly ahead of the muzzle
    t.active = true;
    t.visible = visible;
    t.hostile = hostile;
    t.width = hostile ? 0.026 : 0.018;
    t.whizzAt = whizzAt;
    t.whizzDist = whizzDist;
    if (!visible) {
      this.tracerFx.hide(i * 2);
      this.tracerFx.hide(i * 2 + 1);
    }
  }

  /** Enemy muzzle: hot puff + sparks forward + a little smoke (no light, it's cheap). */
  muzzlePuff(at: THREE.Vector3, dir: THREE.Vector3) {
    this.fire.spawn(at.x + dir.x * 0.1, at.y + dir.y * 0.1, at.z + dir.z * 0.1, dir.x * 3, dir.y * 3, dir.z * 3, 1.8, 1.3, 1, 0.07, 0.12, 0.3, 0.9, 0, 6);
    for (let i = 0; i < 3; i++) {
      const s = 4 + Math.random() * 6;
      this.streaks.spawn(at.x, at.y, at.z, (dir.x + rnd(0.3)) * s, (dir.y + rnd(0.3)) * s, (dir.z + rnd(0.3)) * s, 4, 2.6, 1.2, 0.06 + Math.random() * 0.05, 0.012, 0.012, 2, 4);
    }
    if (Math.random() < 0.5) this.smoke.spawn(at.x, at.y, at.z, dir.x * 0.8, 0.2, dir.z * 0.8, 0.55, 0.55, 0.56, 1.2, 0.1, 0.5, 0.14, -0.1, 2);
  }

  /**
   * Frag explosion: flash, flipbook fireball, shockwave ring, smoke column,
   * debris (some trailing smoke), embers, scorch and a lingering dust cloud.
   */
  explosion(at: THREE.Vector3, normal?: THREE.Vector3) {
    const n = normal ?? this.tmp2.set(0, 1, 0);
    this.blastLight.position.copy(at).addScaledVector(n, 0.8);
    this.blastLight.intensity = 90;
    this.blastTimer = 0.32;
    this.impactLight?.(this.blastLight.position, BLAST_LIGHT, 90, 0.32, 28);

    const b = this.blasts[this.nextBlast];
    this.nextBlast = (this.nextBlast + 1) % MAX_FLASHES;
    b.active = true;
    b.t = 0;
    b.sprite.position.copy(at).addScaledVector(n, 0.4);
    b.ring.position.copy(at).addScaledVector(n, 0.05);
    b.sprite.visible = b.ring.visible = true;

    // Flipbook fireball: a few big billowing puffs, white-hot → rolling black smoke.
    const fb = this.q.fireballs;
    for (let i = 0; i < fb; i++) {
      this.t1.set(rnd(), Math.random() * 0.8 + 0.2, rnd()).normalize();
      const s = 1.5 + Math.random() * 3;
      const k = 0.9 + Math.random() * 0.25;
      this.fireball.spawn(
        at.x + this.t1.x * 0.3, at.y + 0.35 + this.t1.y * 0.3, at.z + this.t1.z * 0.3,
        this.t1.x * s, this.t1.y * s * 0.7 + 1.4, this.t1.z * s,
        k, k, k, 1.1 + Math.random() * 0.6, 0.9 + Math.random() * 0.5, 3.4 + Math.random() * 1.6, 1, -0.6, 2.4,
      );
    }
    // Initial incandescent burst (short additive puffs under the flipbook).
    for (let i = 0; i < 12; i++) {
      this.t1.set(rnd(), Math.random() * 0.9 + 0.1, rnd()).normalize();
      const s = 3 + Math.random() * 5;
      this.fire.spawn(
        at.x + this.t1.x * 0.2, at.y + 0.25 + this.t1.y * 0.2, at.z + this.t1.z * 0.2,
        this.t1.x * s, this.t1.y * s * 0.8 + 1, this.t1.z * s,
        2.4, 1.7, 1.2, 0.22 + Math.random() * 0.2, 0.5 + Math.random() * 0.3, 1.8 + Math.random() * 1, 1, -1.5, 5,
      );
    }
    // Spark streaks + glowing embers.
    for (let i = 0; i < 44; i++) {
      this.t1.set(rnd(), Math.random() * 1.1, rnd()).normalize();
      const s = 10 + Math.random() * 22;
      this.streaks.spawn(at.x, at.y + 0.2, at.z, this.t1.x * s, this.t1.y * s, this.t1.z * s, 4, 2.4, 1, 0.25 + Math.random() * 0.4, 0.02, 0.018, 9, 1.5);
    }
    for (let i = 0; i < 18; i++) {
      this.t1.set(rnd(), Math.random() + 0.3, rnd()).normalize();
      const s = 3 + Math.random() * 7;
      this.sparks.spawn(at.x, at.y + 0.3, at.z, this.t1.x * s, this.t1.y * s, this.t1.z * s, 3.5, 1.6, 0.5, 1 + Math.random() * 1.2, 0.05, 0.02, 1, 6, 0.8);
    }
    // Debris chunks thrown out ballistically; they land and lie on the ground.
    this.debris.spawnFloor = at.y + 0.02;
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 3 + Math.random() * 9;
      const g = 0.12 + Math.random() * 0.12;
      this.debris.spawn(at.x, at.y + 0.1, at.z, Math.cos(a) * s * 0.6, 3 + Math.random() * 9, Math.sin(a) * s * 0.6, g, g * 0.92, g * 0.8, 1.6 + Math.random() * 1.2, 0.05 + Math.random() * 0.05, 0.035, 1, 16, 0.6, i % 3 === 0 ? SHAPE.flake : SHAPE.chip);
    }
    this.debris.spawnFloor = -Infinity;
    // A few bigger chunks trail smoke as they fly.
    for (let i = 0; i < this.q.debrisTrails; i++) {
      const tr = this.trails[this.nextTrail];
      this.nextTrail = (this.nextTrail + 1) % MAX_TRAILS;
      const a = Math.random() * Math.PI * 2;
      const s = 4 + Math.random() * 6;
      tr.pos.set(at.x, at.y + 0.3, at.z);
      tr.vel.set(Math.cos(a) * s, 6 + Math.random() * 7, Math.sin(a) * s);
      tr.life = 0.9 + Math.random() * 0.7;
      tr.emit = 0;
      tr.floor = at.y;
    }
    // Ground-hugging dust skirt (the visible shockwave).
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + rnd(0.15);
      const s = 7 + Math.random() * 5;
      this.smoke.spawn(at.x + Math.cos(a) * 0.4, at.y + 0.15, at.z + Math.sin(a) * 0.4, Math.cos(a) * s, 0.4 + Math.random() * 0.6, Math.sin(a) * s, 0.48, 0.44, 0.38, 1.6 + Math.random() * 1, 0.4, 2.2 + Math.random(), 0.42, -0.05, 2.6);
    }
    // Smoke column: dark, rising, slowly expanding.
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.8;
      const g = 0.1 + Math.random() * 0.1;
      this.smoke.spawn(
        at.x + Math.cos(a) * r, at.y + 0.6 + Math.random() * 1.4, at.z + Math.sin(a) * r,
        Math.cos(a) * 0.8, 1.2 + Math.random() * 2.2, Math.sin(a) * 0.8,
        g, g * 0.95, g * 0.9, 3 + Math.random() * 3, 0.9, 3.2 + Math.random() * 2, 0.75, -0.25, 0.7,
      );
    }
    // Lingering dust cloud that settles around the blast.
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 1 + Math.random() * 2.5;
      this.smoke.spawn(
        at.x + Math.cos(a) * r, at.y + 0.5 + Math.random() * 0.6, at.z + Math.sin(a) * r,
        Math.cos(a) * 0.6, 0.15, Math.sin(a) * 0.6,
        0.5, 0.45, 0.38, 5 + Math.random() * 2.5, 1.2, 4.5 + Math.random() * 2, 0.32, 0.02, 0.5,
      );
    }
    // Scorch mark (+ a smaller offset one so repeated blasts don't stamp the same shape).
    this.decals.add(this.t2.copy(at).addScaledVector(n, -0.05), n, DECAL.scorch, 2.6 + Math.random() * 0.8);
    this.t2.set(rnd(0.6), 0, rnd(0.6)).add(at).addScaledVector(n, -0.05);
    this.decals.add(this.t2, n, DECAL.scorchSmall, 1.4 + Math.random() * 0.6);
  }

  /**
   * Bullet impact on a surface: decal + surface-specific chips, dust, sparks
   * and flashes. `material` (the hit mesh's userData.material) refines
   * concrete into brick / plaster and sand into dirt / gravel.
   */
  impact(point: THREE.Vector3, normal: THREE.Vector3, surface: Surface, decal = true, material?: string | null) {
    if (surface === "flesh") return this.blood(point, normal);
    const kind = impactKind(surface, material);
    const p = IMPACT[kind];
    const n = normal;
    const k = this.q.impactScale;

    if (decal && p.decals.length) {
      const tile = pick(p.decals);
      this.decals.add(point, n, tile, p.decalSize * (0.8 + Math.random() * 0.45), p.decalStretch);
    }

    // Spark streaks: bright, fast, bounce off along the normal.
    const streakCount = this.scaled(p.sparks);
    for (let i = 0; i < streakCount; i++) {
      const s = 5 + Math.random() * 10;
      this.streaks.spawn(
        point.x, point.y, point.z,
        (n.x + rnd(0.75)) * s, (n.y + rnd(0.75) + 0.25) * s, (n.z + rnd(0.75)) * s,
        4, 2.5, 1.1, 0.12 + Math.random() * 0.22, 0.008 + Math.random() * 0.006, 0.014, 9, 2,
      );
    }
    if (p.flash > 0) {
      // White-hot flash at the hole, plus a tiny lingering ember.
      const f = p.flash;
      this.sparks.spawn(point.x + n.x * 0.02, point.y + n.y * 0.02, point.z + n.z * 0.02, 0, 0, 0, 6 * f, 4.6 * f, 2.8 * f, 0.045, 0.2 * f, 0.08, 1, 0, 0);
      this.sparks.spawn(point.x + n.x * 0.01, point.y + n.y * 0.01, point.z + n.z * 0.01, 0, 0, 0, 3, 1.4, 0.4, 0.35, 0.03, 0.012, 0.9, 0, 0);
      if (this.impactLight) this.impactLight(this.t1.copy(point).addScaledVector(n, 0.15), SPARK_LIGHT, 4 * f, 0.06, 3.5);
    }
    for (let i = 0; i < p.glints; i++) {
      const s = 1.5 + Math.random() * 2.5;
      this.sparks.spawn(point.x, point.y, point.z, (n.x + rnd(0.8)) * s, (n.y + rnd(0.6)) * s + 1, (n.z + rnd(0.8)) * s, 1.6, 1.7, 1.8, 0.3 + Math.random() * 0.3, 0.018, 0.01, 1, 9, 1.5);
    }

    // Chips / splinters / clumps: heavier, fall with gravity; floor hits make them land.
    if (n.y > 0.6) this.debris.spawnFloor = point.y + 0.004;
    else if (point.y - this.floorHint > 0 && point.y - this.floorHint < 2.5 && point.distanceToSquared(this.viewer) < 400) this.debris.spawnFloor = this.floorHint + 0.004;
    const chipCount = this.scaled(p.chips);
    const [r, g, b] = p.chip;
    for (let i = 0; i < chipCount; i++) {
      const s = p.chipSpeed * (0.5 + Math.random());
      const c = 0.7 + Math.random() * 0.4;
      this.debris.spawn(
        point.x, point.y, point.z,
        (n.x + rnd(0.6)) * s, (n.y + Math.random() * p.chipUp) * s + 1, (n.z + rnd(0.6)) * s,
        r * c, g * c, b * c,
        0.5 + Math.random() * 0.5, p.chipSize * (0.7 + Math.random() * 0.6), p.chipSize * 0.7, 1, 13, 1.3, p.chipShape,
      );
    }
    this.debris.spawnFloor = -Infinity;

    // Dust puffs: soft, slow, expanding, settling.
    const [dr, dg, db] = p.dustCol;
    const puffs = this.scaled(p.dust);
    for (let i = 0; i < puffs; i++) {
      const sp = 0.6 + Math.random() * 1.4;
      this.smoke.spawn(
        point.x + n.x * 0.04, point.y + n.y * 0.04, point.z + n.z * 0.04,
        n.x * sp + rnd(0.35), n.y * sp + 0.25 + Math.random() * 0.4, n.z * sp + rnd(0.35),
        dr, dg, db,
        0.9 + Math.random() * 0.9, 0.05, p.dustSize * (0.75 + Math.random() * 0.5), p.dustAlpha, 0.25, 2.6,
      );
    }
    // A fast, dense jet straight out of the hole (masonry).
    if (p.jet) {
      this.smoke.spawn(point.x + n.x * 0.03, point.y + n.y * 0.03, point.z + n.z * 0.03, n.x * 4.5 + rnd(0.3), n.y * 4.5 + rnd(0.3), n.z * 4.5 + rnd(0.3), dr * 1.05, dg * 1.05, db * 1.05, 0.55, 0.04, 0.34, 0.6, 0, 6.5);
    }
    // Dirt / sand: a fast upward plume plus a lower curtain.
    if (p.plume) {
      this.smoke.spawn(point.x, point.y, point.z, n.x * 2 + rnd(0.3), 2.8 + Math.random(), n.z * 2 + rnd(0.3), dr * 0.9, dg * 0.9, db * 0.9, 1.1, 0.06, 0.5, 0.6, 2.4, 2.8);
      if (k > 0.7) this.smoke.spawn(point.x, point.y + 0.05, point.z, rnd(0.6), 1.2, rnd(0.6), dr, dg, db, 1.6, 0.1, 0.8, 0.35, 0.8, 2.2);
    }
  }

  /** Count × quality scale, dithered so fractional counts average out. */
  private scaled(c: number) {
    const v = c * this.q.impactScale;
    const f = Math.floor(v);
    return f + (Math.random() < v - f ? 1 : 0);
  }

  /** Flesh hit: a quick, small mist and a few droplets (short-lived, tasteful). */
  private blood(point: THREE.Vector3, n: THREE.Vector3) {
    const drops = Math.max(3, Math.round(6 * this.q.impactScale));
    for (let i = 0; i < drops; i++) {
      const s = 1.2 + Math.random() * 2.6;
      const k = 0.7 + Math.random() * 0.5;
      this.debris.spawn(
        point.x, point.y, point.z,
        (n.x + rnd(0.7)) * s, (n.y + Math.random() * 0.6) * s + 0.5, (n.z + rnd(0.7)) * s,
        0.26 * k, 0.014, 0.012, 0.3 + Math.random() * 0.15, 0.016 + Math.random() * 0.012, 0.01, 1, 11, 1.2,
      );
    }
    // Spray cone that blooms and is gone in a third of a second.
    for (let i = 0; i < 2; i++) {
      const s = 1 + Math.random() * 1.6;
      this.smoke.spawn(point.x, point.y, point.z, (n.x + rnd(0.4)) * s, (n.y + rnd(0.3)) * s + 0.2, (n.z + rnd(0.4)) * s, 0.3, 0.02, 0.02, 0.28 + Math.random() * 0.12, 0.05, 0.3, 0.55, 0.6, 4);
    }
    this.smoke.spawn(point.x, point.y, point.z, n.x * 0.4, 0.1, n.z * 0.4, 0.22, 0.02, 0.018, 0.6, 0.08, 0.42, 0.28, 0.1, 2.5);
  }

  update(dt: number) {
    this.clock += dt;
    this.light.update(dt);
    if (this.blastTimer > 0) {
      this.blastTimer -= dt;
      const k = Math.max(0, this.blastTimer / 0.32);
      this.blastLight.intensity = k * k * 90 * (0.85 + Math.random() * 0.3);
    } else this.blastLight.intensity = 0;
    if (this.muzzleTimer > 0) {
      this.muzzleTimer -= dt;
      if (this.muzzleTimer <= 0) this.muzzleLight.intensity = 0;
    }

    for (const b of this.blasts) {
      if (!b.active) continue;
      b.t += dt;
      const f = b.t / 0.12;
      const sm = b.sprite.material as THREE.SpriteMaterial;
      if (f < 1) {
        const s = 2.5 + f * 4.5;
        b.sprite.scale.set(s, s, s);
        sm.opacity = 1 - f * f;
      } else b.sprite.visible = false;
      const rt = b.t / 0.45;
      const rm = b.ring.material as THREE.MeshBasicMaterial;
      if (rt < 1) {
        const s = 1 + Math.sqrt(rt) * 14;
        b.ring.scale.set(s, s, 1);
        rm.opacity = (1 - rt) * (1 - rt) * 0.7;
      } else b.ring.visible = false;
      if (f >= 1 && rt >= 1) b.active = false;
    }

    this.updateTrails(dt);
    this.updateBarrel(dt);

    for (let i = 0; i < MAX_TRACERS; i++) {
      const t = this.tracers[i];
      if (!t.active) continue;
      const before = t.travelled;
      t.travelled += TRACER_SPEED * dt;
      if (t.whizzAt >= 0 && before < t.whizzAt && t.travelled >= t.whizzAt) this.whizz(t);
      const head = Math.min(t.travelled, t.dist);
      const tail = Math.max(0, t.travelled - TRACER_LENGTH);
      if (tail >= t.dist) {
        t.active = false;
        this.tracerFx.hide(i * 2);
        this.tracerFx.hide(i * 2 + 1);
        continue;
      }
      if (!t.visible) continue;
      this.t1.copy(t.from).addScaledVector(t.dir, head);
      this.t2.copy(t.from).addScaledVector(t.dir, tail);
      // Core: thin, white-hot; glow: wide, faint, coloured halo.
      if (t.hostile) {
        this.tracerFx.set(i * 2, this.t1.x, this.t1.y, this.t1.z, this.t2.x, this.t2.y, this.t2.z, 4.5, 1.4, 0.6, 0.95, t.width);
        this.tracerFx.set(i * 2 + 1, this.t1.x, this.t1.y, this.t1.z, this.t2.x, this.t2.y, this.t2.z, 1.6, 0.3, 0.1, 0.22, t.width * 6);
      } else {
        this.tracerFx.set(i * 2, this.t1.x, this.t1.y, this.t1.z, this.t2.x, this.t2.y, this.t2.z, 4.6, 3.2, 1.6, 0.95, t.width);
        this.tracerFx.set(i * 2 + 1, this.t1.x, this.t1.y, this.t1.z, this.t2.x, this.t2.y, this.t2.z, 1.5, 0.75, 0.25, 0.2, t.width * 6);
      }
    }
    this.tracerFx.flush();

    this.streaks.simulate(dt);
    this.sparks.update(dt);
    this.debris.update(dt);
    this.smoke.update(dt);
    this.fire.update(dt);
    this.fireball.update(dt);
    this.shells.update(dt);
  }

  /** The round is passing the camera: a faint, fast air streak right by the eye + hook. */
  private whizz(t: Tracer) {
    this.t1.copy(t.from).addScaledVector(t.dir, t.whizzAt);
    const v = 340;
    this.streaks.spawn(this.t1.x, this.t1.y, this.t1.z, t.dir.x * v, t.dir.y * v, t.dir.z * v, 0.9, 0.88, 0.85, 0.06, 0.006, 0.009, 0, 0);
    this.whizzHook?.(this.t1, t.whizzDist, t.hostile);
  }

  private updateTrails(dt: number) {
    for (const tr of this.trails) {
      if (tr.life <= 0) continue;
      tr.life -= dt;
      tr.vel.y -= 9.8 * dt;
      tr.pos.addScaledVector(tr.vel, dt);
      if (tr.pos.y < tr.floor) tr.life = 0;
      tr.emit -= dt;
      if (tr.emit <= 0 && tr.life > 0) {
        tr.emit = 0.03;
        const fade = Math.min(1, tr.life * 2);
        this.smoke.spawn(tr.pos.x, tr.pos.y, tr.pos.z, rnd(0.2), 0.3, rnd(0.2), 0.16, 0.15, 0.14, 1.2 + Math.random() * 0.6, 0.12, 0.6 + Math.random() * 0.3, 0.5 * fade, -0.1, 1.5);
        this.sparks.spawn(tr.pos.x, tr.pos.y, tr.pos.z, 0, 0, 0, 3.5, 1.5, 0.4, 0.12, 0.08, 0.03, 0.9 * fade, 0, 0);
      }
    }
  }

  /** After sustained fire the barrel smokes: thin wisps curling up from the muzzle. */
  private updateBarrel(dt: number) {
    this.sinceShot += dt;
    this.barrelHeat = Math.max(0, this.barrelHeat - dt * (this.sinceShot < 0.2 ? 0.05 : 0.22));
    if (!this.q.barrelSmoke || !this.viewCam || this.barrelHeat < 0.35 || this.sinceShot < 0.18) return;
    this.barrelEmit -= dt;
    if (this.barrelEmit > 0) return;
    const h = Math.min(1, this.barrelHeat);
    this.barrelEmit = 0.09 / h;
    // Muzzle in world space from where it sat relative to the view at the last shot.
    this.tmp.copy(this.muzzleLocal).applyQuaternion(this.viewQuat).add(this.viewer);
    this.tmp2.copy(this.muzzleFwd).applyQuaternion(this.viewQuat);
    const g = 0.7 + Math.random() * 0.1;
    this.smoke.spawn(
      this.tmp.x - this.tmp2.x * 0.05, this.tmp.y - this.tmp2.y * 0.05, this.tmp.z - this.tmp2.z * 0.05,
      rnd(0.04), 0.22 + Math.random() * 0.12, rnd(0.04),
      g, g, g * 1.02, 1.4 + Math.random() * 0.8, 0.015, 0.12 + Math.random() * 0.08, 0.1 * h, -0.08, 1.2,
    );
  }

  dispose() {
    this.sparks.dispose();
    this.debris.dispose();
    this.smoke.dispose();
    this.fire.dispose();
    this.fireball.dispose();
    this.fireballTex.dispose();
    this.streaks.dispose();
    this.tracerFx.dispose();
    this.shells.dispose();
    this.decals.dispose();
    this.flashTex.dispose();
    this.ringTex.dispose();
    this.ringGeo.dispose();
    for (const b of this.blasts) {
      (b.sprite.material as THREE.Material).dispose();
      (b.ring.material as THREE.Material).dispose();
    }
  }
}

/** Grayscale radial falloff texture (alpha = f(r), r ∈ 0..1 from the centre). */
function radialTexture(size: number, f: (r: number) => number) {
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot((x + 0.5) / size - 0.5, (y + 0.5) / size - 0.5) * 2;
      const a = Math.max(0, Math.min(1, f(r)));
      const i = (y * size + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = a * 255;
    }
  }
  const t = new THREE.DataTexture(d, size, size, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
