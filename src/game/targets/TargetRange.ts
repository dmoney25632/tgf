import * as THREE from "three";
import { Spring } from "../core/Spring";
import type { HitPart, HitResult, Hittable } from "../core/types";
import type { MapSteelPlate, MapTarget } from "../world/MapLoader";

const MAX_HEALTH = 100;
const RESPAWN_TIME = 2.5;

type Mats = {
  body: THREE.MeshStandardMaterial;
  head: THREE.MeshStandardMaterial;
  hit: THREE.MeshStandardMaterial;
  stand: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  steelHit: THREE.MeshStandardMaterial;
};

/**
 * Pop-up humanoid practice target. Implements Hittable exactly like bots
 * will, so the weapon system doesn't care what it's shooting.
 */
class Target implements Hittable {
  readonly root = new THREE.Group();
  readonly hitboxes: THREE.Mesh[] = [];
  private readonly pivot = new THREE.Group();
  private health = MAX_HEALTH;
  private deadTimer = 0;
  private flash = 0;
  private t = Math.random() * 10;
  private readonly base: THREE.Vector3;
  private readonly flinch = new Spring(160, 9);
  private readonly move?: MapTarget["move"];

  constructor(
    readonly name: string,
    def: MapTarget,
    geo: THREE.BoxGeometry,
    private readonly mats: Mats,
  ) {
    this.base = new THREE.Vector3(def.x, def.y ?? 0, def.z);
    this.move = def.move;
    this.root.position.copy(this.base);
    this.root.add(this.pivot);

    // Static stand (not a hitbox).
    const stand = new THREE.Mesh(geo, mats.stand);
    stand.scale.set(0.6, 0.06, 0.4);
    stand.position.y = 0.03;
    this.root.add(stand);

    const part = (w: number, h: number, d: number, y: number, mat: THREE.Material, kind: HitPart) => {
      const m = new THREE.Mesh(geo, mat);
      m.scale.set(w, h, d);
      m.position.y = y;
      m.castShadow = true;
      m.userData = { hittable: this, part: kind, surface: "target" };
      this.pivot.add(m);
      this.hitboxes.push(m);
    };
    part(0.4, 0.82, 0.22, 0.47, mats.body, "legs");
    part(0.52, 0.62, 0.28, 1.19, mats.body, "body");
    part(0.24, 0.27, 0.24, 1.66, mats.head, "head");
  }

  get alive() {
    return this.health > 0;
  }

  applyDamage(amount: number, part: HitPart): HitResult {
    if (!this.alive) return { damage: 0, killed: false, counts: false };
    const dealt = Math.min(this.health, amount);
    this.health -= dealt;
    this.flash = 0.07;
    this.flinch.impulse(part === "head" ? -3.2 : -2);
    if (this.health <= 0) this.deadTimer = RESPAWN_TIME;
    return { damage: Math.round(amount), killed: this.health <= 0, counts: true };
  }

  update(dt: number) {
    if (this.move && this.alive) {
      this.t += dt;
      const offset = Math.sin((this.t * this.move.speed) / this.move.range) * this.move.range;
      this.root.position[this.move.axis] = this.base[this.move.axis] + offset;
    }

    if (this.flash > 0) this.flash -= dt;
    const f = this.flash > 0;
    const [legs, body, head] = this.hitboxes;
    legs.material = f ? this.mats.hit : this.mats.body;
    body.material = f ? this.mats.hit : this.mats.body;
    head.material = f ? this.mats.hit : this.mats.head;

    const flinch = this.flinch.update(dt) * 0.08;
    if (!this.alive) {
      this.deadTimer -= dt;
      // Topple backward fast, like a knocked-down range target.
      this.pivot.rotation.x = Math.max(-Math.PI / 2, this.pivot.rotation.x - dt * 10);
      if (this.deadTimer <= 0) this.health = MAX_HEALTH;
    } else if (this.pivot.rotation.x < flinch - 0.001) {
      this.pivot.rotation.x = Math.min(flinch, this.pivot.rotation.x + dt * 7);
    } else {
      this.pivot.rotation.x = flinch;
    }
  }
}

/** Hanging steel plate: never dies, swings and rings when hit. */
class SteelPlate implements Hittable {
  readonly root = new THREE.Group();
  readonly hitbox: THREE.Mesh;
  private readonly swing = new Spring(28, 1.6);
  private flash = 0;

  constructor(readonly name: string, def: MapSteelPlate, geo: THREE.BoxGeometry, private readonly mats: Mats) {
    this.root.position.set(def.x, def.y, def.z);
    // Chains
    const chain = new THREE.Mesh(geo, mats.stand);
    chain.scale.set(0.02, 0.5, 0.02);
    chain.position.y = -0.25;
    this.root.add(chain);
    this.hitbox = new THREE.Mesh(geo, mats.steel);
    this.hitbox.scale.set(def.size, def.size, 0.03);
    this.hitbox.position.y = -0.5 - def.size / 2;
    this.hitbox.castShadow = true;
    this.hitbox.userData = { hittable: this, part: "body", surface: "steel" };
    this.root.add(this.hitbox);
  }

  applyDamage(amount: number): HitResult {
    this.swing.impulse(-1.8 - Math.random() * 0.6);
    this.flash = 0.06;
    return { damage: Math.round(amount), killed: false, counts: true };
  }

  update(dt: number) {
    this.root.rotation.x = this.swing.update(dt) * 0.35;
    if (this.flash > 0) this.flash -= dt;
    this.hitbox.material = this.flash > 0 ? this.mats.steelHit : this.mats.steel;
  }
}

export class TargetRange {
  private readonly targets: Target[] = [];
  private readonly plates: SteelPlate[] = [];
  private readonly live: THREE.Object3D[] = [];
  private readonly geo = new THREE.BoxGeometry(1, 1, 1);
  private readonly mats: Mats = {
    body: new THREE.MeshStandardMaterial({ color: 0x5d6b4c, roughness: 0.85 }),
    head: new THREE.MeshStandardMaterial({ color: 0xc8752a, roughness: 0.7 }),
    hit: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff4030, emissiveIntensity: 1.2 }),
    stand: new THREE.MeshStandardMaterial({ color: 0x2a2b2c, metalness: 0.6, roughness: 0.5 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xd9d4c4, metalness: 0.7, roughness: 0.35 }),
    steelHit: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffd080, emissiveIntensity: 1.5 }),
  };

  constructor(scene: THREE.Scene, defs: MapTarget[], plates: MapSteelPlate[]) {
    defs.forEach((d, i) => {
      const t = new Target(`Target ${String(i + 1).padStart(2, "0")}`, d, this.geo, this.mats);
      scene.add(t.root);
      this.targets.push(t);
    });
    plates.forEach((d) => {
      const p = new SteelPlate(d.name, d, this.geo, this.mats);
      scene.add(p.root);
      this.plates.push(p);
    });
  }

  update(dt: number) {
    for (const t of this.targets) t.update(dt);
    for (const p of this.plates) p.update(dt);
  }

  /** Hitboxes that can currently be shot. */
  hitboxes() {
    this.live.length = 0;
    for (const t of this.targets) {
      if (!t.alive) continue;
      for (const h of t.hitboxes) this.live.push(h);
    }
    for (const p of this.plates) this.live.push(p.hitbox);
    return this.live;
  }

  dispose() {
    this.geo.dispose();
    Object.values(this.mats).forEach((m) => m.dispose());
  }
}
