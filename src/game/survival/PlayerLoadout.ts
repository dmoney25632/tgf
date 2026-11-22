import { WEAPONS, type WeaponDef, type WeaponId } from "../weapons/weapons";
import { maxTier, upgradeWeapon, type UpgradeLevels, type UpgradeTrackId } from "../weapons/upgrades";
import type { WeaponModifiers, WeaponSystem } from "../weapons/WeaponSystem";
import { OPERATORS, PERKS, type OperatorDef, type OperatorId, type PerkId } from "./config";

/**
 * The player's build for a survival run: operator, primary + secondary,
 * purchased perks and armory gun upgrades. Folds operator + perk modifiers into the weapon
 * system and exposes derived stats (max health, speed).
 */
export class PlayerLoadout {
  readonly operator: OperatorDef;
  primary: WeaponId;
  secondary: WeaponId;
  readonly perks = new Set<PerkId>();
  /**
   * Upgrade tiers bought per gun. Kept for the whole run even after you
   * switch guns, so buying a gun back restores its upgrades.
   */
  readonly upgrades = new Map<WeaponId, UpgradeLevels>();

  constructor(operator: OperatorId, primary?: WeaponId, secondary?: WeaponId) {
    this.operator = OPERATORS[operator];
    this.primary = primary ?? this.operator.primary;
    this.secondary = secondary ?? this.operator.secondary;
  }

  get maxHealth() {
    let hp = this.operator.maxHealth;
    for (const p of this.perks) hp += PERKS[p].maxHealth ?? 0;
    return hp;
  }

  get speed() {
    return this.operator.speed;
  }

  modifiers(): WeaponModifiers {
    const m: WeaponModifiers = { reloadSpeed: 1, adsSpeed: 1, recoil: 1, headshotDamage: 1, damage: 1, reserve: 1 };
    const apply = (src: Partial<WeaponModifiers>) => {
      for (const k of Object.keys(src) as (keyof WeaponModifiers)[]) m[k] *= src[k] ?? 1;
    };
    apply(this.operator.mods);
    for (const p of this.perks) if (PERKS[p].mods) apply(PERKS[p].mods!);
    return m;
  }

  tier(id: WeaponId, track: UpgradeTrackId) {
    return this.upgrades.get(id)?.[track] ?? 0;
  }

  /** Buy one tier. Returns false when already maxed. */
  upgrade(id: WeaponId, track: UpgradeTrackId) {
    const lv = this.upgrades.get(id) ?? {};
    const t = lv[track] ?? 0;
    if (t >= maxTier(track)) return false;
    this.upgrades.set(id, { ...lv, [track]: t + 1 });
    return true;
  }

  /** The gun's stats with its bought upgrades. */
  def(id: WeaponId): WeaponDef {
    return upgradeWeapon(WEAPONS[id], this.upgrades.get(id));
  }

  /** Push weapons + modifiers into the live weapon system. */
  apply(weapons: WeaponSystem) {
    Object.assign(weapons.mods, this.modifiers());
    weapons.setLoadout([this.def(this.primary), this.def(this.secondary)]);
  }
}
