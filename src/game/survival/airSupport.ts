import type { HeliPlan } from "../vehicles/AttackHelicopter";

/** One scheduled helicopter for a survival wave. */
export type AirSortie = {
  /** Seconds after the wave opens. */
  delay: number;
  /** Fast-rope troopers it brings (taken from the wave's queue, so totals stay honest). */
  troops: number;
  /** Seconds of gun runs over the compound after the insert. */
  orbit: number;
};

export const AIR = {
  fromWave: 5,
  orbitRadius: 26,
  altitude: 22,
  entryRadius: 170,
  /** Bounty for shooting one down (before difficulty reward scaling). */
  reward: 1000,
  /** Splash when the wreck hits the ground. */
  crashRadius: 9,
  crashDamage: 180,
  /** Extra health per wave past the first heli wave. */
  healthPerWave: 0.05,
};

/**
 * Air escalation for survival: transports from wave 5 (insert only, short
 * gun pass), real gun runs from wave 7, and on elite / boss waves two
 * gunships, the second arriving mid-wave.
 */
export function composeAir(wave: number): AirSortie[] {
  if (wave < AIR.fromWave) return [];
  const boss = wave >= 10 && wave % 5 === 0;
  const troops = wave >= 10 ? 5 : 4;
  const orbit = wave < 7 ? 12 : wave < 10 ? 35 : 55;
  const out: AirSortie[] = [{ delay: 14, troops, orbit }];
  if (boss || wave >= 13) out.push({ delay: 42, troops: boss ? troops : 3, orbit: orbit + 10 });
  return out;
}

/** Builds a flight plan: in from a random bearing, rope at `lz`, orbit `center`, out the far side. */
export function sortiePlan(s: AirSortie, lz: { x: number; z: number }, center: { x: number; z: number }, healthMul: number, damageMul: number, bearing = Math.random() * Math.PI * 2): HeliPlan {
  const R = AIR.entryRadius;
  return {
    entry: { x: center.x + Math.cos(bearing) * R, z: center.z + Math.sin(bearing) * R },
    exit: { x: center.x - Math.cos(bearing + 0.6) * R, z: center.z - Math.sin(bearing + 0.6) * R },
    insert: s.troops > 0 ? { x: lz.x, z: lz.z, troops: s.troops } : undefined,
    orbit: { x: center.x, z: center.z, radius: AIR.orbitRadius, altitude: AIR.altitude, seconds: s.orbit },
    health: Math.round(1900 * healthMul),
    damageMul,
  };
}
