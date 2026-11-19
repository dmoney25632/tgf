import type { StaggerDef } from "../../survival/config";

/** The bits of Agent the heavy rules read and write (keeps this file pure and testable). */
export type StaggerState = {
  staggerTimer: number;
  staggerCooldown: number;
  /** Raw damage taken in the current window. */
  staggerAccum: number;
  staggerAge: number;
};

/**
 * Juggernaut stagger: one big hit (sniper, shotgun blast, grenade) or a
 * burst of sustained fire inside a short window knocks the heavy off
 * balance for a moment: it stops, can't fire, and its armour stops
 * shrugging hits off quite as well. A cooldown prevents stun-locking.
 * Returns true when this hit starts a stagger.
 */
export function registerHeavyHit(s: StaggerState, def: StaggerDef, raw: number): boolean {
  if (s.staggerAge > def.window) {
    s.staggerAccum = 0;
    s.staggerAge = 0;
  }
  s.staggerAccum += raw;
  if (s.staggerTimer > 0 || s.staggerCooldown > 0) return false;
  if (raw >= def.threshold || s.staggerAccum >= def.burst) {
    s.staggerTimer = def.duration;
    s.staggerCooldown = def.duration + def.cooldown;
    s.staggerAccum = 0;
    s.staggerAge = 0;
    return true;
  }
  return false;
}

export function tickStagger(s: StaggerState, dt: number) {
  s.staggerAge += dt;
  if (s.staggerTimer > 0) s.staggerTimer = Math.max(0, s.staggerTimer - dt);
  if (s.staggerCooldown > 0) s.staggerCooldown = Math.max(0, s.staggerCooldown - dt);
}

export function resetStagger(s: StaggerState) {
  s.staggerTimer = s.staggerCooldown = s.staggerAccum = s.staggerAge = 0;
}
