import { PLAYER } from "./config";

/**
 * Player vitals for survival: health with delayed regen, armor plates that
 * soak most of a hit, and the downed → bleed-out → revive cycle.
 */
export class PlayerState {
  maxHealth = 100;
  health = 100;
  armor = 0;
  downed = false;
  dead = false;
  /** Seconds left before bleeding out while downed. */
  bleed = 0;
  /** 0..1 revive progress (by a squadmate or Second Wind). */
  revive = 0;
  selfRevives = 0;
  private sinceDamage = 99;
  private invuln = 0;
  /** Running totals for the summary. */
  damageTaken = 0;
  timesDowned = 0;

  reset(maxHealth: number, armor: number) {
    this.maxHealth = maxHealth;
    this.health = maxHealth;
    this.armor = armor;
    this.downed = this.dead = false;
    this.bleed = this.revive = 0;
    this.sinceDamage = 99;
    this.invuln = 0;
  }

  get alive() {
    return !this.downed && !this.dead;
  }

  /** Returns the health actually lost, and whether this hit downed us. */
  damage(amount: number): { lost: number; downed: boolean } {
    if (!this.alive || this.invuln > 0 || amount <= 0) return { lost: 0, downed: false };
    this.sinceDamage = 0;
    let rest = amount;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, rest * PLAYER.armorAbsorb);
      this.armor -= absorbed;
      rest -= absorbed;
    }
    const lost = Math.min(this.health, rest);
    this.health -= rest;
    this.damageTaken += lost;
    if (this.health <= 0) {
      this.health = 0;
      this.downed = true;
      this.bleed = PLAYER.bleedOut;
      this.revive = 0;
      this.timesDowned++;
      return { lost, downed: true };
    }
    return { lost, downed: false };
  }

  /** Called every frame; `reviving` = someone is channeling a revive. Returns "revived" when it completes. */
  update(dt: number, reviving: boolean, reviveTime: number): "revived" | "bledout" | null {
    this.invuln = Math.max(0, this.invuln - dt);
    if (this.dead) return null;
    if (this.downed) {
      if (reviving) {
        this.revive += dt / reviveTime;
        if (this.revive >= 1) {
          this.downed = false;
          this.revive = 0;
          this.health = PLAYER.reviveHealth;
          this.invuln = PLAYER.reviveInvuln;
          this.sinceDamage = 0;
          return "revived";
        }
      } else {
        this.revive = Math.max(0, this.revive - dt * 0.5);
        this.bleed -= dt;
        if (this.bleed <= 0) {
          this.dead = true;
          return "bledout";
        }
      }
      return null;
    }
    this.sinceDamage += dt;
    if (this.sinceDamage > PLAYER.regenDelay && this.health < this.maxHealth) {
      this.health = Math.min(this.maxHealth, this.health + PLAYER.regenRate * dt);
    }
    return null;
  }

  addArmor(n: number) {
    this.armor = Math.min(PLAYER.maxArmor, this.armor + n);
  }

  /** Full heal between waves. */
  heal() {
    if (this.alive) this.health = this.maxHealth;
  }
}
