import { damageAt, MELEE, type WeaponDef } from "../weapons/weapons";

export type Vec = { x: number; y: number; z: number };

export type HitClaimCheck = {
  /** Seconds (any monotonic clock). */
  now: number;
  shooterId: string | number;
  /** Shooter eye position as last reported by their state message. */
  shooterEye: Vec;
  /** False when the shooter is dead / disconnected. Downed players may still fire a sidearm. */
  shooterCanFire: boolean;
  targetAlive: boolean;
  /** Candidate points on the target (chest, head, hips…), host-side positions. */
  targetPoints: Vec[];
  /** Claimed weapon; null = knife. */
  weapon: WeaponDef | null;
  part: "head" | "body" | "legs";
  /** Raw (pre-armor) damage claimed. */
  damage: number;
  /** Line-of-sight test against level geometry. */
  los: (a: Vec, b: Vec) => boolean;
};

export type HitVerdict = { ok: true; damage: number } | { ok: false; reason: string };

/**
 * Tolerances. The host checks against *its* current target position while
 * the client aimed at an interpolated one ~100 ms + latency in the past, so
 * range and line-of-sight get slack and damage is clamped, not rejected.
 */
export const HIT_RULES = {
  /** Extra metres allowed beyond the weapon's range. */
  rangeSlack: 4,
  /** Falloff is evaluated this much closer than measured (target moved). */
  falloffSlack: 4,
  meleeRange: MELEE.range + 1.8,
  /** Upper bounds on stacked modifiers (operator + perk). */
  headModCap: 1.5,
  bodyModCap: 1.1,
  /** Claims/second headroom over the weapon's real rate of fire. */
  rateSlack: 1.35,
  /** Burst allowance in seconds of fire. */
  burstSeconds: 1,
  meleePerSecond: 3,
} as const;

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * Host-side validation of client hit claims: target alive, in range, in line
 * of sight, damage within what the weapon can do, and a per-shooter token
 * bucket so a modified client can't claim faster than its gun fires.
 */
export class HitValidator {
  private readonly buckets = new Map<string | number, { tokens: number; at: number }>();
  rejected = 0;
  accepted = 0;

  validate(c: HitClaimCheck): HitVerdict {
    const v = this.check(c);
    if (v.ok) this.accepted++;
    else this.rejected++;
    return v;
  }

  private check(c: HitClaimCheck): HitVerdict {
    if (!c.shooterCanFire) return { ok: false, reason: "shooter" };
    if (!c.targetAlive) return { ok: false, reason: "dead" };
    if (!(c.damage > 0) || !Number.isFinite(c.damage)) return { ok: false, reason: "damage" };
    if (!c.targetPoints.length) return { ok: false, reason: "target" };

    let d = Infinity;
    for (const p of c.targetPoints) d = Math.min(d, dist(c.shooterEye, p));
    const w = c.weapon;
    const maxRange = w ? w.range + HIT_RULES.rangeSlack : HIT_RULES.meleeRange;
    if (d > maxRange) return { ok: false, reason: "range" };

    if (!c.targetPoints.some((p) => c.los(c.shooterEye, p))) return { ok: false, reason: "los" };

    if (!this.take(c)) return { ok: false, reason: "rate" };

    const mod = c.part === "head" ? HIT_RULES.headModCap : HIT_RULES.bodyModCap;
    let cap: number;
    if (w) {
      const base = damageAt(w, Math.max(0, d - HIT_RULES.falloffSlack));
      const part = c.part === "head" ? w.headMultiplier : c.part === "legs" ? w.limbMultiplier : 1;
      cap = base * part * mod;
    } else cap = MELEE.damage * HIT_RULES.bodyModCap;
    return { ok: true, damage: Math.min(c.damage, cap) };
  }

  /** Token bucket per shooter; refill rate follows the claimed weapon. */
  private take(c: HitClaimCheck) {
    const w = c.weapon;
    const rate = w ? (w.rpm / 60) * w.pellets * HIT_RULES.rateSlack + 1 : HIT_RULES.meleePerSecond;
    const capacity = Math.max(rate * HIT_RULES.burstSeconds, w ? w.pellets * 2 : 2);
    let b = this.buckets.get(c.shooterId);
    if (!b) this.buckets.set(c.shooterId, (b = { tokens: capacity, at: c.now }));
    b.tokens = Math.min(capacity, b.tokens + Math.max(0, c.now - b.at) * rate);
    b.at = c.now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  forget(shooterId: string | number) {
    this.buckets.delete(shooterId);
  }
}
