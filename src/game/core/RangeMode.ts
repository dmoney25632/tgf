import type * as THREE from "three";
import type { EngineContext, GameMode, Vitals } from "./GameMode";
import type { HitPart } from "./types";
import { TargetRange } from "../targets/TargetRange";

/** Firing range: pop-up targets and steel, no enemies, infinite retries. */
export class RangeMode implements GameMode {
  readonly label = "FIRING RANGE";
  private readonly targets: TargetRange;

  constructor(private readonly ctx: EngineContext) {
    this.targets = new TargetRange(ctx.scene, ctx.map.def.targets, ctx.map.def.plates);
    ctx.hud.modeLabel = "FIRING RANGE";
    ctx.grenades.count = 99;
    ctx.grenades.maxCarry = 99;
  }

  collectTargets(out: THREE.Object3D[]) {
    const live = this.targets.hitboxes();
    for (let i = 0; i < live.length; i++) out.push(live[i]);
  }

  update(dt: number) {
    this.targets.update(dt);
    this.ctx.player.speedMultiplier = this.ctx.weapons.active.def.mobility;
    if (this.ctx.grenades.count < 9) this.ctx.grenades.count = 9;
  }

  onWeaponHit(part: HitPart, _d: number, killed: boolean, name: string, source: string) {
    if (killed) this.ctx.hud.killfeed(this.ctx.callsign, source, name, part === "head");
    return undefined;
  }

  onExplosion() {}

  vitals(): Vitals {
    return { health: 100, maxHealth: 100, armor: 0 };
  }

  reset() {}

  debug() {}

  dispose() {
    this.targets.dispose();
  }
}
