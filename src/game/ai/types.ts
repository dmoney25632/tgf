import type * as THREE from "three";

export type Team = "player" | "enemy";

/** Anything AI can see and shoot at (the player, squad bots, enemies). */
export interface Combatant {
  readonly team: Team;
  readonly name: string;
  /** Standing and targetable (not downed / dead / inactive). */
  readonly targetable: boolean;
  /** Feet position. */
  readonly position: THREE.Vector3;
  /** Where to aim (chest). */
  aimPoint(out: THREE.Vector3): THREE.Vector3;
  /** Horizontal speed (accuracy penalty for shooters). */
  readonly moveSpeed: number;
  readonly crouched: boolean;
  /** Damage from AI fire. */
  takeFire(amount: number, from: THREE.Vector3, attacker: Combatant): void;
  readonly isPlayer: boolean;
}
