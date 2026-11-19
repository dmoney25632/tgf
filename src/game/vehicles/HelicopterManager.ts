import type * as THREE from "three";
import type { Combatant } from "../ai/types";
import type { EffectsPool } from "../effects/EffectsPool";
import type { Sfx } from "../audio/Sfx";
import type { CollisionWorld } from "../world/Collision";
import { AttackHelicopter, type HeliHooks, type HeliPlan } from "./AttackHelicopter";
import { disposeHeliAssets } from "./heliModel";

/**
 * Pools a few helicopters (hostile gunships and one friendly transport),
 * runs their plans, gathers their hitboxes for the player's weapon and
 * routes explosions to them. Modes call `launch(plan)` from scripts.
 */
export class HelicopterManager {
  readonly helis: AttackHelicopter[] = [];
  readonly transport: AttackHelicopter;
  /** Hostile helicopters currently in the air (shared with AgentManager.extraHostiles). */
  readonly airborne: Combatant[] = [];
  private nextId = 1;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: CollisionWorld,
    private readonly effects: EffectsPool,
    private readonly sfx: Sfx,
    private readonly listener: THREE.Vector3,
    private readonly hooks: HeliHooks,
    hostileCount = 2,
  ) {
    for (let i = 0; i < hostileCount; i++) this.helis.push(this.make("hostile"));
    this.transport = this.make("friendly");
  }

  private make(livery: "hostile" | "friendly") {
    const h = new AttackHelicopter(this.nextId++, this.world, this.effects, this.sfx, this.listener, this.hooks, livery);
    this.scene.add(h.root);
    return h;
  }

  /** Starts a hostile helicopter on `plan`; null when all are busy. */
  launch(plan: HeliPlan) {
    const h = this.helis.find((x) => !x.active);
    if (!h) return null;
    h.launch(plan);
    return h;
  }

  /** Friendly extraction bird: flies in and lands at `plan.land`. */
  launchTransport(plan: HeliPlan) {
    this.transport.launch({ ...plan, friendly: true });
    return this.transport;
  }

  get hostileAlive() {
    let n = 0;
    for (const h of this.helis) if (h.alive) n++;
    return n;
  }

  update(dt: number, targets: readonly Combatant[]) {
    const air = this.airborne;
    air.length = 0;
    for (const h of this.helis) {
      h.update(dt, targets);
      if (h.targetable) air.push(h);
    }
    this.transport.update(dt, targets);
  }

  hitboxes(out: THREE.Object3D[]) {
    for (const h of this.helis) {
      if (!h.targetable) continue;
      for (let i = 0; i < h.hitboxes.length; i++) out.push(h.hitboxes[i]);
    }
  }

  explode(at: THREE.Vector3, radius: number, maxDamage: number) {
    let kills = 0;
    for (const h of this.helis) if (h.explode(at, radius, maxDamage)) kills++;
    return kills;
  }

  /** Everyone flies home (wave cleared / phase over). */
  recallAll() {
    for (const h of this.helis) h.recall();
  }

  clear() {
    for (const h of this.helis) h.hide();
    this.transport.hide();
    this.airborne.length = 0;
  }

  dispose() {
    for (const h of this.helis) h.dispose();
    this.transport.dispose();
    disposeHeliAssets();
  }
}
