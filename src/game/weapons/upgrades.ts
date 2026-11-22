import type { WeaponDef } from "./weapons";

/**
 * Armory gun upgrades (survival). Each track has a few tiers with rising
 * prices; `upgradeWeapon` folds the bought tiers into a copy of the base
 * WeaponDef, so the WeaponSystem, HUD and co-op hit validation all see the
 * upgraded stats without special cases.
 *
 * Upgrades belong to the gun, not the slot: they stay with that gun for the
 * rest of the run, so swapping to another gun starts it at its own tiers and
 * buying the old one back later restores what you paid for.
 */
export type UpgradeTrackId = "damage" | "recoil" | "mag" | "reload" | "ads" | "reserve";
export type UpgradeLevels = Partial<Record<UpgradeTrackId, number>>;

export type UpgradeTrackDef = {
  id: UpgradeTrackId;
  name: string;
  /** What one tier does, for the armory card. */
  blurb: string;
  /** Price of tier 1, 2, 3… for a primary. Secondaries pay `SECONDARY_PRICE`× this. */
  prices: readonly number[];
  /** Slots the track is offered for (survival sidearms have endless reserves). */
  slots: readonly ("primary" | "secondary")[];
};

export const SECONDARY_PRICE = 0.6;

export const UPGRADE_TRACKS: Record<UpgradeTrackId, UpgradeTrackDef> = {
  damage: { id: "damage", name: "Hot Loads", blurb: "+8% damage per tier", prices: [400, 750, 1200, 1800], slots: ["primary", "secondary"] },
  recoil: { id: "recoil", name: "Muzzle Brake", blurb: "-10% recoil per tier", prices: [300, 600, 1000, 1500], slots: ["primary", "secondary"] },
  mag: { id: "mag", name: "Extended Mag", blurb: "+15% magazine capacity per tier", prices: [350, 700, 1200], slots: ["primary", "secondary"] },
  reload: { id: "reload", name: "Speed Loader", blurb: "-10% reload time per tier", prices: [250, 500, 900], slots: ["primary", "secondary"] },
  ads: { id: "ads", name: "Lightweight Stock", blurb: "-12% aim-down-sights time per tier", prices: [200, 450, 800], slots: ["primary", "secondary"] },
  reserve: { id: "reserve", name: "Ammo Pouches", blurb: "+25% reserve ammo per tier", prices: [200, 400, 700], slots: ["primary"] },
};

export const UPGRADE_ORDER: UpgradeTrackId[] = ["damage", "recoil", "mag", "reload", "ads", "reserve"];

const PER_TIER = { damage: 0.08, recoil: 0.1, mag: 0.15, reload: 0.1, ads: 0.12, reserve: 0.25 } as const;

export const maxTier = (track: UpgradeTrackId) => UPGRADE_TRACKS[track].prices.length;

export function trackAvailable(def: WeaponDef, track: UpgradeTrackId) {
  if (def.slot === "melee") return false;
  // A single-shot launcher etc. has no magazine to extend.
  if (track === "mag" && def.magSize <= 1) return false;
  return UPGRADE_TRACKS[track].slots.includes(def.slot);
}

const tierOf = (levels: UpgradeLevels | undefined, track: UpgradeTrackId) =>
  Math.max(0, Math.min(maxTier(track), Math.floor(levels?.[track] ?? 0)));

/** Price of the next tier, or null when maxed / not offered. */
export function nextUpgradePrice(def: WeaponDef, levels: UpgradeLevels | undefined, track: UpgradeTrackId): number | null {
  if (!trackAvailable(def, track)) return null;
  const tier = tierOf(levels, track);
  const p = UPGRADE_TRACKS[track].prices[tier];
  if (p === undefined) return null;
  return def.slot === "secondary" ? Math.round((p * SECONDARY_PRICE) / 10) * 10 : p;
}

/** Magazine size after `tier` extended-mag tiers: +15% each, at least one round per tier. */
export function upgradedMag(base: number, tier: number) {
  if (tier <= 0) return base;
  return Math.max(base + tier, Math.round(base * (1 + PER_TIER.mag * tier)));
}

/** A copy of `base` with the upgrade tiers applied. Returns `base` itself when nothing is bought. */
export function upgradeWeapon(base: WeaponDef, levels: UpgradeLevels | undefined): WeaponDef {
  if (!levels || base.slot === "melee") return base;
  const t = (k: UpgradeTrackId) => (trackAvailable(base, k) ? tierOf(levels, k) : 0);
  const dmg = t("damage"), rec = t("recoil"), mag = t("mag"), rel = t("reload"), ads = t("ads"), res = t("reserve");
  if (!(dmg || rec || mag || rel || ads || res)) return base;
  const dmgK = 1 + PER_TIER.damage * dmg;
  const recK = 1 - PER_TIER.recoil * rec;
  const relK = 1 - PER_TIER.reload * rel;
  return {
    ...base,
    damage: base.damage * dmgK,
    minDamage: base.minDamage * dmgK,
    magSize: upgradedMag(base.magSize, mag),
    reserveAmmo: Math.round(base.reserveAmmo * (1 + PER_TIER.reserve * res)),
    reloadTime: base.reloadTime * relK,
    reloadEmptyTime: base.reloadEmptyTime * relK,
    adsTime: base.adsTime * (1 - PER_TIER.ads * ads),
    recoil: {
      ...base.recoil,
      kickScale: base.recoil.kickScale * recK,
      jitterPitch: base.recoil.jitterPitch * recK,
      jitterYaw: base.recoil.jitterYaw * recK,
    },
  };
}

/** Total tiers bought across every track. */
export const totalTiers = (levels: UpgradeLevels | undefined) => (levels ? UPGRADE_ORDER.reduce((n, k) => n + tierOf(levels, k), 0) : 0);

/** Short "current → next" stat line for a track on the armory card. */
export function upgradeEffect(base: WeaponDef, levels: UpgradeLevels | undefined, track: UpgradeTrackId): string {
  const cur = upgradeWeapon(base, levels);
  const tier = tierOf(levels, track);
  const next = tier < maxTier(track) ? upgradeWeapon(base, { ...levels, [track]: tier + 1 }) : null;
  const pct = (v: number) => `${v >= 0 ? "+" : ""}${Math.round(v * 100)}%`;
  const fmt = (d: WeaponDef): string => {
    switch (track) {
      case "damage":
        return `${Math.round(d.damage * 10) / 10}${d.pellets > 1 ? `×${d.pellets}` : ""} dmg`;
      case "recoil": {
        const k = d.recoil.kickScale / base.recoil.kickScale - 1;
        return Math.abs(k) < 1e-6 ? "stock recoil" : `${pct(k)} recoil`;
      }
      case "mag":
        return `${d.magSize} rds`;
      case "reload":
        return `${d.reloadTime.toFixed(2)}s reload`;
      case "ads":
        return `${Math.round(d.adsTime * 1000)}ms ADS`;
      case "reserve":
        return `${d.reserveAmmo} reserve`;
    }
  };
  return next ? `${fmt(cur)} → ${fmt(next)}` : fmt(cur);
}
