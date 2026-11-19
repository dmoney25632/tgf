import * as THREE from "three";
import { GRENADE } from "./weapons";
import type { CollisionWorld } from "../world/Collision";

const POOL = 8;
const RADIUS = 0.06;
const RESTITUTION = 0.38;
const FRICTION = 0.6;

type Live = { mesh: THREE.Mesh; vel: THREE.Vector3; fuse: number; active: boolean; lastBounce: number };

export type GrenadeHooks = {
  onExplode(at: THREE.Vector3): void;
  onBounce(at: THREE.Vector3): void;
  onThrow(): void;
};

/**
 * Frag grenades: G to throw (short wind-up), pooled projectiles that bounce
 * off the collision boxes, then explode after the fuse. Damage is resolved
 * by the game mode through onExplode so it can hit any team.
 */
export class GrenadeSystem {
  count: number = GRENADE.startCount;
  maxCarry: number = GRENADE.maxCarry;
  /** 0..1 throw animation, or -1. */
  throwProgress = -1;
  disabled = false;

  private readonly pool: Live[] = [];
  private cooldown = 0;
  private released = false;
  private readonly geo = new THREE.SphereGeometry(0.07, 10, 8);
  private readonly mat = new THREE.MeshStandardMaterial({ color: 0x4a5236, roughness: 0.6, metalness: 0.3 });
  private readonly dir = new THREE.Vector3();
  private readonly euler = new THREE.Euler(0, 0, 0, "YXZ");
  private readonly p = new THREE.Vector3();
  private time = 0;

  constructor(
    scene: THREE.Scene,
    private readonly world: CollisionWorld,
    private readonly hooks: GrenadeHooks,
  ) {
    for (let i = 0; i < POOL; i++) {
      const mesh = new THREE.Mesh(this.geo, this.mat);
      mesh.visible = false;
      mesh.castShadow = true;
      scene.add(mesh);
      this.pool.push({ mesh, vel: new THREE.Vector3(), fuse: 0, active: false, lastBounce: 0 });
    }
  }

  /** Returns true when a throw starts. */
  tryThrow() {
    if (this.disabled || this.count <= 0 || this.cooldown > 0 || this.throwProgress >= 0) return false;
    this.count--;
    this.throwProgress = 0;
    this.released = false;
    this.cooldown = GRENADE.cooldown;
    this.hooks.onThrow();
    return true;
  }

  update(dt: number, eye: THREE.Vector3, yaw: number, pitch: number, playerVel: THREE.Vector3) {
    this.time += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.throwProgress >= 0) {
      this.throwProgress += dt / 0.7;
      if (!this.released && this.throwProgress >= 0.45) {
        this.released = true;
        this.launch(eye, yaw, pitch, playerVel);
      }
      if (this.throwProgress >= 1) this.throwProgress = -1;
    }

    for (const g of this.pool) {
      if (!g.active) continue;
      g.fuse -= dt;
      if (g.fuse <= 0) {
        g.active = false;
        g.mesh.visible = false;
        this.hooks.onExplode(g.mesh.position);
        continue;
      }
      // Sub-step for stable bounces at throw speed.
      const steps = 3;
      const h = dt / steps;
      for (let s = 0; s < steps; s++) {
        g.vel.y -= 17 * h;
        const pos = this.p.copy(g.mesh.position);
        pos.y -= RADIUS;
        const vy = g.vel.y;
        if (this.world.moveAxis(pos, "x", g.vel.x * h, RADIUS, RADIUS * 2)) this.bounce(g, "x");
        if (this.world.moveAxis(pos, "z", g.vel.z * h, RADIUS, RADIUS * 2)) this.bounce(g, "z");
        if (this.world.moveAxis(pos, "y", g.vel.y * h, RADIUS, RADIUS * 2)) {
          this.bounce(g, "y");
          if (vy < 0) {
            g.vel.x *= FRICTION;
            g.vel.z *= FRICTION;
          }
        } else if (pos.y < 0) {
          pos.y = 0;
          this.bounce(g, "y");
          g.vel.x *= FRICTION;
          g.vel.z *= FRICTION;
        }
        pos.y += RADIUS;
        g.mesh.position.copy(pos);
      }
      g.mesh.rotation.x += g.vel.length() * dt * 3;
      g.mesh.rotation.z += g.vel.x * dt * 2;
    }
  }

  private launch(eye: THREE.Vector3, yaw: number, pitch: number, playerVel: THREE.Vector3) {
    const g = this.pool.find((x) => !x.active);
    if (!g) return;
    this.euler.set(pitch + 0.12, yaw, 0);
    this.dir.set(0, 0, -1).applyEuler(this.euler);
    g.mesh.position.copy(eye).addScaledVector(this.dir, 0.5);
    g.mesh.position.y -= 0.1;
    g.vel.copy(this.dir).multiplyScalar(GRENADE.throwSpeed).add(playerVel);
    g.vel.y += 2;
    g.fuse = GRENADE.fuse - 0.3;
    g.active = true;
    g.mesh.visible = true;
  }

  private bounce(g: Live, axis: "x" | "y" | "z") {
    const v = g.vel[axis];
    g.vel[axis] = -v * RESTITUTION;
    if (Math.abs(v) > 2.5 && this.time - g.lastBounce > 0.08) {
      g.lastBounce = this.time;
      this.hooks.onBounce(g.mesh.position);
    }
  }

  reset() {
    for (const g of this.pool) {
      g.active = false;
      g.mesh.visible = false;
    }
    this.throwProgress = -1;
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}
