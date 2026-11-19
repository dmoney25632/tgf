import * as THREE from "three";
import { ParticleSystem } from "./Particles";
import { StreakSystem } from "./Streaks";
import { ShellPool, type ShellKind } from "./Shells";
import { DECAL, DecalPool } from "./Decals";

export type Surface = "concrete" | "metal" | "wood" | "sand" | "target" | "steel" | "flesh" | "armor" | "dirt" | "glass";
export type { ShellKind };

/** Debris color per surface (linear RGB). */
const DEBRIS: Record<Surface, [number, number, number]> = {
  concrete: [0.5, 0.49, 0.46],
  metal: [0.32, 0.3, 0.28],
  wood: [0.42, 0.28, 0.15],
  sand: [0.56, 0.47, 0.33],
  dirt: [0.3, 0.24, 0.17],
  target: [0.68, 0.36, 0.14],
  steel: [0.45, 0.45, 0.47],
  flesh: [0.3, 0.02, 0.015],
  armor: [0.35, 0.35, 0.35],
  glass: [0.6, 0.7, 0.72],
};
/** Dust/smoke tint per surface. */
const DUST: Record<Surface, [number, number, number]> = {
  concrete: [0.62, 0.6, 0.57],
  metal: [0.45, 0.44, 0.43],
  wood: [0.5, 0.42, 0.32],
  sand: [0.66, 0.57, 0.42],
  dirt: [0.42, 0.35, 0.26],
  target: [0.6, 0.5, 0.4],
  steel: [0.5, 0.5, 0.5],
  flesh: [0.35, 0.02, 0.02],
  armor: [0.5, 0.5, 0.5],
  glass: [0.75, 0.78, 0.8],
};

const MAX_TRACERS = 48;
const TRACER_SPEED = 600; // m/s, visual only
const TRACER_LENGTH = 7;
const MAX_FLASHES = 3;

type Tracer = { from: THREE.Vector3; dir: THREE.Vector3; dist: number; travelled: number; active: boolean; hostile: boolean; width: number };
type Blast = { sprite: THREE.Sprite; ring: THREE.Mesh; t: number; active: boolean };

const rnd = (a = 1) => (Math.random() - 0.5) * 2 * a;

/**
 * All transient combat visuals, pooled: tracers, spark streaks, glow sparks,
 * debris, dust/smoke, fire, brass, decals, explosion flashes/shockwaves and
 * the world-space muzzle / blast lights. Nothing allocates per shot.
 */
export class EffectsPool {
  readonly sparks: ParticleSystem;
  readonly debris: ParticleSystem;
  readonly smoke: ParticleSystem;
  readonly fire: ParticleSystem;
  private readonly streaks: StreakSystem;
  private readonly tracerFx: StreakSystem;
  private readonly tracers: Tracer[] = [];
  private nextTracer = 0;
  readonly shells: ShellPool;
  private readonly decals: DecalPool;
  private readonly blasts: Blast[] = [];
  private nextBlast = 0;
  private readonly flashTex: THREE.DataTexture;
  private readonly ringTex: THREE.DataTexture;
  private readonly ringGeo = new THREE.PlaneGeometry(1, 1);

  readonly muzzleLight = new THREE.PointLight(0xffa850, 0, 8, 2);
  private muzzleTimer = 0;
  /** Big light for explosions. */
  readonly blastLight = new THREE.PointLight(0xff9a40, 0, 28, 2);
  private blastTimer = 0;

  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly t1 = new THREE.Vector3();
  private readonly t2 = new THREE.Vector3();

  /** Shell hit the floor (hook up a tinkle sound). */
  set onShellLand(fn: ((at: THREE.Vector3, kind: ShellKind, speed: number) => void) | null) {
    this.shells.onLand = fn;
  }

  constructor(scene: THREE.Scene, maxDecals: number, maxParticles: number) {
    const cap = Math.max(768, maxParticles);
    this.sparks = new ParticleSystem(cap, true, "glow");
    this.debris = new ParticleSystem(cap, false, "chunk");
    this.smoke = new ParticleSystem(cap, false, "smoke");
    this.fire = new ParticleSystem(Math.max(256, cap / 2), true, "fire");
    this.smoke.points.renderOrder = 2;
    this.fire.points.renderOrder = 3;
    this.streaks = new StreakSystem(Math.max(384, cap / 2), { tailFade: 1, core: 0.8 });
    this.tracerFx = new StreakSystem(MAX_TRACERS, { tailFade: 1, core: 1.2 });
    this.shells = new ShellPool(scene, 40);
    this.decals = new DecalPool(scene, 192, maxDecals);
    scene.add(this.sparks.points, this.debris.points, this.smoke.points, this.fire.points, this.streaks.mesh, this.tracerFx.mesh, this.muzzleLight, this.blastLight);

    for (let i = 0; i < MAX_TRACERS; i++) {
      this.tracers.push({ from: new THREE.Vector3(), dir: new THREE.Vector3(), dist: 0, travelled: 0, active: false, hostile: false, width: 0.02 });
      this.tracerFx.hide(i);
    }
    this.tracerFx.flush();

    this.flashTex = radialTexture(64, (r) => Math.pow(Math.max(0, 1 - r), 2.2));
    this.ringTex = radialTexture(128, (r) => Math.exp(-Math.pow((r - 0.82) / 0.07, 2)) * (r < 1 ? 1 : 0));
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
  }

  setViewportHeight(h: number) {
    this.sparks.setViewportHeight(h);
    this.debris.setViewportHeight(h);
    this.smoke.setViewportHeight(h);
    this.fire.setViewportHeight(h);
    this.streaks.setViewportHeight(h);
    this.tracerFx.setViewportHeight(h);
  }

  /**
   * Player muzzle: short light flash, plus (when a direction is given) a
   * hot puff and lingering smoke wisps. `strength` ~ weapon size (1 = rifle).
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
  }

  /** Brass leaving the ejection port (world space). */
  ejectShell(pos: THREE.Vector3, vel: THREE.Vector3, orient: THREE.Quaternion, kind: ShellKind, groundY: number) {
    this.shells.spawn(pos, vel, orient, kind, groundY);
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, hostile = false) {
    const t = this.tracers[this.nextTracer];
    this.nextTracer = (this.nextTracer + 1) % MAX_TRACERS;
    t.from.copy(from);
    t.dir.subVectors(to, from);
    t.dist = t.dir.length();
    if (t.dist < 2) return;
    t.dir.divideScalar(t.dist);
    t.travelled = hostile ? 0.5 : 1.2; // start slightly ahead of the muzzle
    t.active = true;
    t.hostile = hostile;
    t.width = hostile ? 0.03 : 0.022;
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

  /** Frag explosion: flash, fireball, shockwave, smoke column, debris, embers, scorch. */
  explosion(at: THREE.Vector3, normal?: THREE.Vector3) {
    const n = normal ?? this.tmp2.set(0, 1, 0);
    this.blastLight.position.copy(at).addScaledVector(n, 0.8);
    this.blastLight.intensity = 90;
    this.blastTimer = 0.32;

    const b = this.blasts[this.nextBlast];
    this.nextBlast = (this.nextBlast + 1) % MAX_FLASHES;
    b.active = true;
    b.t = 0;
    b.sprite.position.copy(at).addScaledVector(n, 0.4);
    b.ring.position.copy(at).addScaledVector(n, 0.05);
    b.sprite.visible = b.ring.visible = true;

    // Fireball: overlapping hot puffs expanding and rising.
    for (let i = 0; i < 26; i++) {
      this.t1.set(rnd(), Math.random() * 0.9 + 0.1, rnd()).normalize();
      const s = 2 + Math.random() * 5;
      this.fire.spawn(
        at.x + this.t1.x * 0.2, at.y + 0.25 + this.t1.y * 0.2, at.z + this.t1.z * 0.2,
        this.t1.x * s, this.t1.y * s * 0.8 + 1, this.t1.z * s,
        2.2, 1.6, 1.2, 0.35 + Math.random() * 0.4, 0.4 + Math.random() * 0.3, 1.6 + Math.random() * 1.2, 1, -1.5, 5,
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
    // Debris chunks thrown out ballistically.
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 3 + Math.random() * 9;
      const g = 0.12 + Math.random() * 0.12;
      this.debris.spawn(at.x, at.y + 0.1, at.z, Math.cos(a) * s * 0.6, 3 + Math.random() * 9, Math.sin(a) * s * 0.6, g, g * 0.92, g * 0.8, 0.9 + Math.random() * 0.8, 0.05 + Math.random() * 0.04, 0.035, 1, 16, 0.6);
    }
    // Ground-hugging dust skirt (the visible shockwave).
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + rnd(0.15);
      const s = 7 + Math.random() * 5;
      this.smoke.spawn(at.x + Math.cos(a) * 0.4, at.y + 0.15, at.z + Math.sin(a) * 0.4, Math.cos(a) * s, 0.4 + Math.random() * 0.6, Math.sin(a) * s, 0.48, 0.44, 0.38, 1.6 + Math.random() * 1, 0.4, 2.2 + Math.random(), 0.42, -0.05, 2.6);
    }
    // Smoke column: dark, rising, slowly expanding.
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.8;
      const g = 0.1 + Math.random() * 0.1;
      this.smoke.spawn(
        at.x + Math.cos(a) * r, at.y + 0.4 + Math.random() * 1.2, at.z + Math.sin(a) * r,
        Math.cos(a) * 0.8, 1.2 + Math.random() * 2.2, Math.sin(a) * 0.8,
        g, g * 0.95, g * 0.9, 3 + Math.random() * 3, 0.9, 3.2 + Math.random() * 2, 0.75, -0.25, 0.7,
      );
    }
    // Scorch mark.
    this.decals.add(this.t2.copy(at).addScaledVector(n, -0.05), n, DECAL.scorch, 2.6 + Math.random() * 0.8);
  }

  /** Bullet impact on a surface: decal + surface-specific debris, dust and sparks. */
  impact(point: THREE.Vector3, normal: THREE.Vector3, surface: Surface, decal = true) {
    if (surface === "flesh") return this.blood(point, normal);
    const n = normal;
    const [r, g, b] = DEBRIS[surface];
    const [dr, dg, db] = DUST[surface];

    if (decal && surface !== "target" && surface !== "armor") {
      const tile = surface === "metal" || surface === "steel" ? DECAL.metal
        : surface === "wood" ? DECAL.wood
        : surface === "sand" || surface === "dirt" ? DECAL.dirt
        : Math.random() < 0.5 ? DECAL.concreteA : DECAL.concreteB;
      const size = tile === DECAL.dirt ? 0.14 : tile === DECAL.wood ? 0.09 : tile === DECAL.metal ? 0.06 : 0.1;
      this.decals.add(point, n, tile, size * (0.8 + Math.random() * 0.45), tile === DECAL.wood ? 1.3 : 1);
    }

    const metallic = surface === "metal" || surface === "steel" || surface === "armor";
    // Spark streaks: bright, fast, bounce off along the normal.
    const streakCount = surface === "steel" ? 14 : metallic ? 10 : surface === "concrete" ? 3 : 0;
    for (let i = 0; i < streakCount; i++) {
      const s = 5 + Math.random() * 10;
      this.streaks.spawn(
        point.x, point.y, point.z,
        (n.x + rnd(0.75)) * s, (n.y + rnd(0.75) + 0.25) * s, (n.z + rnd(0.75)) * s,
        4, 2.5, 1.1, 0.12 + Math.random() * 0.22, 0.008 + Math.random() * 0.006, 0.014, 9, 2,
      );
    }
    if (metallic) {
      this.sparks.spawn(point.x + n.x * 0.02, point.y + n.y * 0.02, point.z + n.z * 0.02, 0, 0, 0, 5, 3.6, 2, 0.05, 0.12, 0.04, 1, 0, 0);
    }

    // Chips: small, heavier, fall with gravity.
    const chipCount = surface === "target" ? 8 : surface === "wood" ? 9 : surface === "sand" || surface === "dirt" ? 10 : metallic ? 3 : 7;
    const up = surface === "sand" || surface === "dirt" ? 0.9 : 0.5;
    for (let i = 0; i < chipCount; i++) {
      const s = 2 + Math.random() * 4;
      const k = 0.7 + Math.random() * 0.4;
      this.debris.spawn(
        point.x, point.y, point.z,
        (n.x + rnd(0.6)) * s, (n.y + Math.random() * up) * s + 1, (n.z + rnd(0.6)) * s,
        r * k, g * k, b * k,
        0.45 + Math.random() * 0.45, surface === "wood" ? 0.028 : 0.02 + Math.random() * 0.015, 0.016, 1, 13, 1.3,
      );
    }

    // Dust puffs: soft, slow, expanding, settling.
    const puffs = surface === "sand" || surface === "dirt" ? 5 : metallic ? 1 : surface === "target" ? 2 : 3;
    const big = surface === "sand" || surface === "dirt" ? 1.6 : 1;
    for (let i = 0; i < puffs; i++) {
      const sp = 0.6 + Math.random() * 1.4;
      this.smoke.spawn(
        point.x + n.x * 0.04, point.y + n.y * 0.04, point.z + n.z * 0.04,
        n.x * sp + rnd(0.35), n.y * sp + 0.25 + Math.random() * 0.4, n.z * sp + rnd(0.35),
        dr, dg, db,
        (0.9 + Math.random() * 0.9) * big, 0.05, (0.35 + Math.random() * 0.3) * big, metallic ? 0.25 : 0.5, 0.25, 2.6,
      );
    }
    // Sand/dirt: a fast upward plume.
    if (surface === "sand" || surface === "dirt") {
      this.smoke.spawn(point.x, point.y, point.z, n.x * 2 + rnd(0.3), 2.5 + Math.random(), n.z * 2 + rnd(0.3), dr * 0.9, dg * 0.9, db * 0.9, 1.1, 0.06, 0.45, 0.55, 2.4, 2.8);
    }
  }

  private blood(point: THREE.Vector3, n: THREE.Vector3) {
    // Droplets.
    for (let i = 0; i < 10; i++) {
      const s = 1.2 + Math.random() * 3.2;
      const k = 0.7 + Math.random() * 0.5;
      this.debris.spawn(
        point.x, point.y, point.z,
        (n.x + rnd(0.7)) * s, (n.y + Math.random() * 0.6) * s + 0.5, (n.z + rnd(0.7)) * s,
        0.28 * k, 0.015, 0.012, 0.4 + Math.random() * 0.3, 0.02 + Math.random() * 0.018, 0.012, 1, 11, 1.2,
      );
    }
    // Spray cone + lingering mist.
    for (let i = 0; i < 3; i++) {
      const s = 1 + Math.random() * 2;
      this.smoke.spawn(point.x, point.y, point.z, (n.x + rnd(0.4)) * s, (n.y + rnd(0.3)) * s + 0.2, (n.z + rnd(0.4)) * s, 0.32, 0.02, 0.02, 0.35 + Math.random() * 0.3, 0.06, 0.32, 0.6, 0.6, 3.5);
    }
    this.smoke.spawn(point.x, point.y, point.z, n.x * 0.4, 0.1, n.z * 0.4, 0.24, 0.02, 0.018, 0.9, 0.1, 0.5, 0.35, 0.1, 2);
  }

  update(dt: number) {
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
      const rt = b.t / 0.4;
      const rm = b.ring.material as THREE.MeshBasicMaterial;
      if (rt < 1) {
        const s = 1 + Math.sqrt(rt) * 13;
        b.ring.scale.set(s, s, 1);
        rm.opacity = (1 - rt) * 0.55;
      } else b.ring.visible = false;
      if (f >= 1 && rt >= 1) b.active = false;
    }

    for (let i = 0; i < MAX_TRACERS; i++) {
      const t = this.tracers[i];
      if (!t.active) continue;
      t.travelled += TRACER_SPEED * dt;
      const head = Math.min(t.travelled, t.dist);
      const tail = Math.max(0, t.travelled - TRACER_LENGTH);
      if (tail >= t.dist) {
        t.active = false;
        this.tracerFx.hide(i);
        continue;
      }
      this.t1.copy(t.from).addScaledVector(t.dir, head);
      this.t2.copy(t.from).addScaledVector(t.dir, tail);
      if (t.hostile) this.tracerFx.set(i, this.t1.x, this.t1.y, this.t1.z, this.t2.x, this.t2.y, this.t2.z, 4, 1.1, 0.45, 0.9, t.width);
      else this.tracerFx.set(i, this.t1.x, this.t1.y, this.t1.z, this.t2.x, this.t2.y, this.t2.z, 4.2, 2.8, 1.3, 0.95, t.width);
    }
    this.tracerFx.flush();

    this.streaks.simulate(dt);
    this.sparks.update(dt);
    this.debris.update(dt);
    this.smoke.update(dt);
    this.fire.update(dt);
    this.shells.update(dt);
  }

  dispose() {
    this.sparks.dispose();
    this.debris.dispose();
    this.smoke.dispose();
    this.fire.dispose();
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
