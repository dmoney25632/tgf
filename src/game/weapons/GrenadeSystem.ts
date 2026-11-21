import * as THREE from "three";
import { FLASHBANG, GRENADE, SMOKE, type GrenadeType } from "./weapons";
import type { CollisionWorld } from "../world/Collision";

const POOL = 8;
const GRAVITY = 9.81;
/** Contact radius per type (M67 sphere, M84 / M18 cans lying on their side). */
const RADIUS: Record<GrenadeType, number> = { frag: 0.032, flash: 0.024, smoke: 0.031 };
/** Normal restitution on hard ground / walls. */
const RESTITUTION = 0.32;
/** Horizontal speed kept through a bounce. */
const BOUNCE_FRICTION = 0.72;
/** Rolling resistance (m/s²): the sphere rolls on, cans stop sooner. */
const ROLL_DRAG: Record<GrenadeType, number> = { frag: 1.6, flash: 3.2, smoke: 3.6 };
/** Below this vertical speed a ground contact settles into rolling. */
const SETTLE_VY = 1.1;
/** Sequence timing: 0 → PULLED (pin out) → HOLD (cocked, cooking) → 1 (follow-through). */
const PULLED = 0.15;
const HOLD = 0.3;
const RELEASE = 0.45;
const WINDUP_TIME = 0.34;
const THROW_TIME = 0.42;
const ARC_POINTS = 72;
const ARC_STEP = 1 / 45;
const SMOKE_PUFFS = 30;

type Live = {
  mesh: THREE.Group;
  type: GrenadeType;
  vel: THREE.Vector3;
  fuse: number;
  active: boolean;
  lastBounce: number;
  rolling: boolean;
  /** Smoke: seconds of emission left once it has popped (-1 = not popped). */
  emitting: number;
};

type Smoke = {
  pos: THREE.Vector3;
  age: number;
  life: number;
  radius: number;
  puffs: THREE.Sprite[];
  offsets: THREE.Vector3[];
  active: boolean;
};

export type GrenadeHooks = {
  /** Frag detonation (game mode resolves damage, incl. a cook-off in hand). */
  onExplode(at: THREE.Vector3): void;
  onFlash?(at: THREE.Vector3): void;
  onSmoke?(at: THREE.Vector3, radius: number, duration: number): void;
  onBounce(at: THREE.Vector3, type: GrenadeType): void;
  onThrow(type?: GrenadeType): void;
  /** Pin pulled (ping + spoon click). */
  onPin?(type: GrenadeType): void;
};

/** One step of grenade physics against the collision world; shared by live grenades and the arc preview. */
function stepBody(world: CollisionWorld, pos: THREE.Vector3, vel: THREE.Vector3, r: number, drag: number, h: number, scratch: THREE.Vector3, onBounce?: (speed: number) => void) {
  let rolling = false;
  vel.y -= GRAVITY * h;
  const feet = scratch.copy(pos);
  feet.y -= r;
  const vy = vel.y;
  if (world.moveAxis(feet, "x", vel.x * h, r, r * 2)) {
    onBounce?.(Math.abs(vel.x));
    vel.x = -vel.x * RESTITUTION * 1.25;
    vel.z *= BOUNCE_FRICTION;
  }
  if (world.moveAxis(feet, "z", vel.z * h, r, r * 2)) {
    onBounce?.(Math.abs(vel.z));
    vel.z = -vel.z * RESTITUTION * 1.25;
    vel.x *= BOUNCE_FRICTION;
  }
  const hitY = world.moveAxis(feet, "y", vel.y * h, r, r * 2);
  let ground = hitY && vy < 0;
  if (hitY && vy > 0) vel.y = -vy * RESTITUTION;
  if (!ground && feet.y < 0) {
    feet.y = 0;
    ground = vy < 0;
  }
  if (ground) {
    if (-vy > SETTLE_VY) {
      onBounce?.(-vy);
      vel.y = -vy * RESTITUTION;
      vel.x *= BOUNCE_FRICTION;
      vel.z *= BOUNCE_FRICTION;
    } else {
      vel.y = 0;
      rolling = true;
      const sp = Math.hypot(vel.x, vel.z);
      if (sp > 1e-4) {
        const k = Math.max(0, sp - drag * h) / sp;
        vel.x *= k;
        vel.z *= k;
      }
    }
  }
  feet.y += r;
  pos.copy(feet);
  return rolling;
}

/**
 * Hand grenades: hold the key to pull the pin and cook (frag fuse runs from
 * the pin; flash / smoke from the throw), aim with the arc preview, release
 * to throw. Pooled projectiles bounce, roll and settle on the collision
 * world. Frag damage is resolved by the game mode via onExplode (radial,
 * occluded by cover); flashbangs and smoke report through their own hooks,
 * and smoke clouds block sight lines (`blocksSight`).
 */
export class GrenadeSystem {
  /** Frag count (kept as `count` for existing callers). */
  count: number = GRENADE.startCount;
  maxCarry: number = GRENADE.maxCarry;
  flashCount: number = FLASHBANG.startCount;
  maxFlash: number = FLASHBANG.maxCarry;
  smokeCount: number = SMOKE.startCount;
  maxSmoke: number = SMOKE.maxCarry;
  /** Throw sequence 0..1 (pin → cocked hold → throw), or -1. */
  throwProgress = -1;
  /** Type in hand (or last thrown). */
  held: GrenadeType = "frag";
  /** Seconds the frag has been cooking (pin out), or -1. */
  cookTime = -1;
  disabled = false;

  private holding = false;
  private released = false;
  private pinned = true;
  private cooldown = 0;
  private time = 0;
  private readonly pool: Live[] = [];
  private readonly smokes: Smoke[] = [];
  private readonly meshes: Record<GrenadeType, { geos: THREE.BufferGeometry[]; mats: THREE.Material[] }>;
  private readonly dir = new THREE.Vector3();
  private readonly euler = new THREE.Euler(0, 0, 0, "YXZ");
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Vector3();
  private readonly axis = new THREE.Vector3();
  private readonly arc: THREE.Line;
  private readonly arcPos: Float32Array;
  private readonly marker: THREE.Mesh;
  private readonly smokeTex: THREE.Texture | null;
  private readonly smokeMat: THREE.SpriteMaterial;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: CollisionWorld,
    private readonly hooks: GrenadeHooks,
  ) {
    const olive = new THREE.MeshStandardMaterial({ color: 0x4a5236, roughness: 0.62, metalness: 0.25 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x8a8d8f, roughness: 0.4, metalness: 0.85 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.55, metalness: 0.5 });
    const red = new THREE.MeshStandardMaterial({ color: 0x9a2a22, roughness: 0.6, metalness: 0.1 });
    const fuze = new THREE.CylinderGeometry(0.011, 0.013, 0.02, 10);
    const spoon = new THREE.BoxGeometry(0.012, 0.004, 0.07);
    this.meshes = {
      frag: { geos: [new THREE.SphereGeometry(0.032, 14, 10), fuze, spoon], mats: [olive, steel, steel] },
      flash: { geos: [new THREE.CylinderGeometry(0.022, 0.022, 0.11, 14), fuze, spoon], mats: [dark, steel, steel] },
      smoke: { geos: [new THREE.CylinderGeometry(0.031, 0.031, 0.13, 16), new THREE.CylinderGeometry(0.0315, 0.0315, 0.014, 16), fuze], mats: [olive, red, steel] },
    };
    for (let i = 0; i < POOL; i++) {
      const mesh = new THREE.Group();
      mesh.visible = false;
      scene.add(mesh);
      this.pool.push({ mesh, type: "frag", vel: new THREE.Vector3(), fuse: 0, active: false, lastBounce: 0, rolling: false, emitting: -1 });
    }

    // Arc preview: a fading dotted line and a ring where it comes to rest.
    this.arcPos = new Float32Array(ARC_POINTS * 3);
    const ag = new THREE.BufferGeometry();
    ag.setAttribute("position", new THREE.BufferAttribute(this.arcPos, 3));
    this.arc = new THREE.Line(ag, new THREE.LineDashedMaterial({ color: 0xf2f0e6, transparent: true, opacity: 0.65, dashSize: 0.18, gapSize: 0.12, depthWrite: false }));
    this.arc.frustumCulled = false;
    this.arc.visible = false;
    this.arc.renderOrder = 5;
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.3, 28).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xf2f0e6, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.marker.visible = false;
    this.marker.renderOrder = 5;
    scene.add(this.arc, this.marker);

    this.smokeTex = makeSmokeTexture();
    this.smokeMat = new THREE.SpriteMaterial({ map: this.smokeTex, color: 0xc9ccc8, transparent: true, depthWrite: false, opacity: 0.9 });
  }

  /** Carried count for a type. */
  countOf(type: GrenadeType) {
    return type === "frag" ? this.count : type === "flash" ? this.flashCount : this.smokeCount;
  }

  private take(type: GrenadeType) {
    if (type === "frag") this.count--;
    else if (type === "flash") this.flashCount--;
    else this.smokeCount--;
  }

  /** Is the throw key still holding a cooked grenade back? */
  get isHolding() {
    return this.holding && this.throwProgress >= 0;
  }

  /** Key down: pull the pin and wind up. Returns true when a throw starts. */
  begin(type: GrenadeType = "frag") {
    if (this.disabled || this.countOf(type) <= 0 || this.cooldown > 0 || this.throwProgress >= 0) return false;
    this.take(type);
    this.held = type;
    this.throwProgress = 0;
    this.holding = true;
    this.released = false;
    this.pinned = true;
    this.cookTime = -1;
    return true;
  }

  /** Key up: throw (the wind-up finishes first if the key was only tapped). */
  release() {
    this.holding = false;
  }

  /** Back-compat: a full tap-throw. */
  tryThrow(type: GrenadeType = "frag") {
    const ok = this.begin(type);
    if (ok) this.release();
    return ok;
  }

  private fuseOf(type: GrenadeType) {
    return type === "frag" ? GRENADE.fuse : type === "flash" ? FLASHBANG.fuse : SMOKE.fuse;
  }

  private speedOf(type: GrenadeType) {
    return type === "frag" ? GRENADE.throwSpeed : type === "flash" ? FLASHBANG.throwSpeed : SMOKE.throwSpeed;
  }

  update(dt: number, eye: THREE.Vector3, yaw: number, pitch: number, playerVel: THREE.Vector3) {
    this.time += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.throwProgress >= 0) this.advanceThrow(dt, eye, yaw, pitch, playerVel);
    this.updateArc(eye, yaw, pitch, playerVel);

    const scratch = this.q;
    for (const g of this.pool) {
      if (!g.active) continue;
      if (g.emitting < 0) {
        g.fuse -= dt;
        if (g.fuse <= 0) this.detonate(g);
      } else {
        g.emitting -= dt;
        if (g.emitting <= 0) {
          g.active = false;
          g.mesh.visible = false;
          continue;
        }
      }
      if (!g.active) continue;
      // Sub-step for stable bounces at throw speed.
      const steps = 4;
      const h = dt / steps;
      const r = RADIUS[g.type];
      for (let s = 0; s < steps; s++) {
        g.rolling = stepBody(this.world, g.mesh.position, g.vel, r, ROLL_DRAG[g.type], h, scratch, (speed) => {
          if (speed > 2.2 && this.time - g.lastBounce > 0.08) {
            g.lastBounce = this.time;
            this.hooks.onBounce(g.mesh.position, g.type);
          }
        });
      }
      // Spin: tumble in the air, roll without slipping on the ground.
      const sp = Math.hypot(g.vel.x, g.vel.z);
      if (g.rolling) {
        if (sp > 0.02) {
          this.axis.set(g.vel.z, 0, -g.vel.x).normalize();
          if (g.type === "frag") g.mesh.rotateOnWorldAxis(this.axis, (sp * dt) / r);
          else g.mesh.rotation.y = Math.atan2(g.vel.x, g.vel.z);
        }
        // Cans lie on their side.
        if (g.type !== "frag") g.mesh.rotation.z += (Math.PI / 2 - g.mesh.rotation.z) * Math.min(1, dt * 12);
      } else {
        g.mesh.rotation.x += (6 + sp) * dt;
        g.mesh.rotation.z += g.vel.x * dt * 2;
      }
    }
    this.updateSmokes(dt);
  }

  private advanceThrow(dt: number, eye: THREE.Vector3, yaw: number, pitch: number, playerVel: THREE.Vector3) {
    const t = this.throwProgress;
    if (t < HOLD) this.throwProgress = Math.min(HOLD, t + (dt / WINDUP_TIME) * HOLD);
    else if (!this.holding) this.throwProgress = t + (dt / THROW_TIME) * (1 - HOLD);
    if (this.pinned && this.throwProgress >= PULLED) {
      this.pinned = false;
      this.hooks.onPin?.(this.held);
      if (this.held === "frag") this.cookTime = 0;
    }
    if (this.cookTime >= 0 && !this.released) {
      this.cookTime += dt;
      // Held too long: it goes off in your hand.
      if (this.cookTime >= GRENADE.fuse) {
        this.cookTime = -1;
        this.throwProgress = -1;
        this.holding = false;
        this.cooldown = GRENADE.cooldown;
        this.hooks.onExplode(this.p.copy(eye));
        return;
      }
    }
    if (!this.released && this.throwProgress >= RELEASE) {
      this.released = true;
      this.launch(eye, yaw, pitch, playerVel);
      this.cookTime = -1;
      this.cooldown = GRENADE.cooldown;
      this.hooks.onThrow(this.held);
    }
    if (this.throwProgress >= 1) this.throwProgress = -1;
  }

  /** Release point + velocity for the current aim. */
  private launchState(eye: THREE.Vector3, yaw: number, pitch: number, playerVel: THREE.Vector3, pos: THREE.Vector3, vel: THREE.Vector3) {
    this.euler.set(pitch + 0.14, yaw, 0);
    this.dir.set(0, 0, -1).applyEuler(this.euler);
    pos.copy(eye).addScaledVector(this.dir, 0.45);
    pos.y -= 0.08;
    vel.copy(this.dir).multiplyScalar(this.speedOf(this.held)).add(playerVel);
    vel.y += 1.5;
  }

  private launch(eye: THREE.Vector3, yaw: number, pitch: number, playerVel: THREE.Vector3) {
    const g = this.pool.find((x) => !x.active);
    if (!g) return;
    this.dress(g, this.held);
    this.launchState(eye, yaw, pitch, playerVel, g.mesh.position, g.vel);
    const fuse = this.fuseOf(this.held);
    g.fuse = this.held === "frag" ? Math.max(0.05, fuse - Math.max(0, this.cookTime)) : fuse;
    g.active = true;
    g.rolling = false;
    g.emitting = -1;
    g.mesh.rotation.set(0, yaw, 0);
    g.mesh.visible = true;
  }

  /** Swap a pooled body's meshes to the thrown type. */
  private dress(g: Live, type: GrenadeType) {
    if (g.type === type && g.mesh.children.length) return;
    g.type = type;
    g.mesh.clear();
    const def = this.meshes[type];
    def.geos.forEach((geo, i) => {
      const m = new THREE.Mesh(geo, def.mats[i]);
      m.castShadow = i === 0;
      if (i === 1) m.position.y = type === "frag" ? 0.036 : type === "smoke" ? 0.058 : 0.062;
      if (type === "smoke" && i === 2) m.position.y = 0.072;
      if (i === 2 && type !== "smoke") m.position.set(0, 0.03, 0.022);
      g.mesh.add(m);
    });
  }

  private detonate(g: Live) {
    const at = g.mesh.position;
    if (g.type === "frag") {
      g.active = false;
      g.mesh.visible = false;
      this.hooks.onExplode(at);
    } else if (g.type === "flash") {
      g.active = false;
      g.mesh.visible = false;
      this.hooks.onFlash?.(at);
    } else {
      // Smoke: the canister stays put and hisses out a cloud.
      g.emitting = SMOKE.duration;
      this.spawnSmoke(at);
      this.hooks.onSmoke?.(at, SMOKE.radius, SMOKE.duration);
    }
  }

  // ---- Arc preview ----------------------------------------------------------

  private updateArc(eye: THREE.Vector3, yaw: number, pitch: number, playerVel: THREE.Vector3) {
    const show = this.holding && this.throwProgress >= PULLED && !this.released;
    this.arc.visible = show;
    this.marker.visible = show;
    if (!show) return;
    const pos = this.p;
    const vel = this.dir.clone();
    this.launchState(eye, yaw, pitch, playerVel, pos, vel);
    const r = RADIUS[this.held];
    let n = 0;
    let still = 0;
    for (let i = 0; i < ARC_POINTS; i++) {
      this.arcPos[i * 3] = pos.x;
      this.arcPos[i * 3 + 1] = pos.y;
      this.arcPos[i * 3 + 2] = pos.z;
      n = i + 1;
      for (let s = 0; s < 3; s++) stepBody(this.world, pos, vel, r, ROLL_DRAG[this.held], ARC_STEP / 3, this.q);
      if (vel.lengthSq() < 0.04) still++;
      if (still > 2) break;
    }
    const geo = this.arc.geometry;
    geo.setDrawRange(0, n);
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    geo.computeBoundingSphere();
    this.arc.computeLineDistances();
    this.marker.position.set(pos.x, pos.y - r + 0.02, pos.z);
  }

  // ---- Smoke ----------------------------------------------------------------

  private spawnSmoke(at: THREE.Vector3) {
    let s = this.smokes.find((x) => !x.active);
    if (!s) {
      if (this.smokes.length >= 4) s = this.smokes.reduce((a, b) => (a.age > b.age ? a : b));
      else {
        s = { pos: new THREE.Vector3(), age: 0, life: 0, radius: SMOKE.radius, puffs: [], offsets: [], active: false };
        for (let i = 0; i < SMOKE_PUFFS; i++) {
          const sp = new THREE.Sprite(this.smokeMat.clone());
          sp.visible = false;
          sp.renderOrder = 4;
          this.scene.add(sp);
          s.puffs.push(sp);
          s.offsets.push(new THREE.Vector3());
        }
        this.smokes.push(s);
      }
    }
    s.pos.copy(at);
    s.age = 0;
    s.life = SMOKE.duration;
    s.radius = SMOKE.radius;
    s.active = true;
    for (let i = 0; i < s.puffs.length; i++) {
      // Dome-shaped spread: denser low, a little drift up.
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * s.radius * 0.85;
      s.offsets[i].set(Math.cos(a) * rr, 0.4 + Math.random() * s.radius * 0.75, Math.sin(a) * rr);
      const p = s.puffs[i];
      p.visible = true;
      (p.material as THREE.SpriteMaterial).rotation = Math.random() * Math.PI * 2;
    }
  }

  private updateSmokes(dt: number) {
    for (const s of this.smokes) {
      if (!s.active) continue;
      s.age += dt;
      if (s.age >= s.life) {
        s.active = false;
        for (const p of s.puffs) p.visible = false;
        continue;
      }
      const grow = 1 - Math.pow(1 - Math.min(1, s.age / 4), 2);
      const fade = Math.min(1, (s.life - s.age) / 5);
      for (let i = 0; i < s.puffs.length; i++) {
        const p = s.puffs[i];
        const o = s.offsets[i];
        p.position.set(s.pos.x + o.x * grow, s.pos.y + o.y * grow + s.age * 0.03, s.pos.z + o.z * grow);
        const size = (1.6 + (i % 5) * 0.35) * (0.3 + 0.7 * grow) * (1 + s.age * 0.015);
        p.scale.set(size, size, 1);
        const m = p.material as THREE.SpriteMaterial;
        m.opacity = 0.82 * fade * Math.min(1, s.age * 3);
        m.rotation += dt * 0.05 * (i % 2 ? 1 : -1);
      }
    }
  }

  /** Does an active smoke cloud block the segment a → b? */
  blocksSight(a: THREE.Vector3, b: THREE.Vector3) {
    for (const s of this.smokes) {
      if (!s.active || s.age < 1.2 || s.life - s.age < 2) continue;
      const r = s.radius * Math.min(1, s.age / 4) * 0.9;
      this.q.set(s.pos.x, s.pos.y + 1.2, s.pos.z);
      if (segmentDistance(a, b, this.q) < r) return true;
    }
    return false;
  }

  /** Active smoke clouds (centre, radius) — for AI that wants to avoid / use them. */
  activeSmokes() {
    return this.smokes.filter((s) => s.active).map((s) => ({ pos: s.pos, radius: s.radius }));
  }

  reset() {
    for (const g of this.pool) {
      g.active = false;
      g.mesh.visible = false;
    }
    for (const s of this.smokes) {
      s.active = false;
      for (const p of s.puffs) p.visible = false;
    }
    this.throwProgress = -1;
    this.holding = false;
    this.cookTime = -1;
    this.arc.visible = false;
    this.marker.visible = false;
  }

  dispose() {
    const seen = new Set<object>();
    for (const t of Object.values(this.meshes)) {
      for (const g of t.geos) if (!seen.has(g)) {
        seen.add(g);
        g.dispose();
      }
      for (const m of t.mats) if (!seen.has(m)) {
        seen.add(m);
        m.dispose();
      }
    }
    this.arc.geometry.dispose();
    (this.arc.material as THREE.Material).dispose();
    this.marker.geometry.dispose();
    (this.marker.material as THREE.Material).dispose();
    for (const s of this.smokes) for (const p of s.puffs) (p.material as THREE.Material).dispose();
    this.smokeMat.dispose();
    this.smokeTex?.dispose();
  }
}

function segmentDistance(a: THREE.Vector3, b: THREE.Vector3, p: THREE.Vector3) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len2));
  const dx = a.x + abx * t - p.x, dy = a.y + aby * t - p.y, dz = a.z + abz * t - p.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Soft, lumpy smoke puff (canvas radial gradients); null outside the browser. */
function makeSmokeTexture(): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d");
  if (!x) return null;
  for (let i = 0; i < 9; i++) {
    const cx = 64 + (Math.random() - 0.5) * 40;
    const cy = 64 + (Math.random() - 0.5) * 40;
    const r = 26 + Math.random() * 30;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, "rgba(255,255,255,0.5)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
