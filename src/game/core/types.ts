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
  applyDamage(amount: number, part: HitPart, from?: THREE.Vector3, source?: string): HitResult;
}

/** Stored on mesh.userData so the weapon raycast can find the owner. */
export type HitboxUserData = { hittable: Hittable; part: HitPart };
