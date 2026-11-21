import type * as THREE from "three";

export type HitPart = "head" | "body" | "legs";

export type HitResult = {
  damage: number;
  killed: boolean;
  /** False for hits that shouldn't count (already-dead target). */
  counts: boolean;
};

/** Anything bullets can damage (targets, enemies, bots). */
export interface Hittable {
  readonly name: string;
  /** Facing (radians, 0 = +Z) and position: lets knives detect backstabs. */
  heading?(): number;
  readonly position?: THREE.Vector3;
  applyDamage(amount: number, part: HitPart, from?: THREE.Vector3, source?: string): HitResult;
}

/** Stored on mesh.userData so the weapon raycast can find the owner. */
export type HitboxUserData = { hittable: Hittable; part: HitPart };
