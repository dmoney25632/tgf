import { WEAPONS, PRIMARY_IDS, SECONDARY_IDS, GRENADE, FLASHBANG, SMOKE, type WeaponId } from "../weapons/weapons";
import { ECONOMY, PERKS, PLAYER, type PerkId } from "./config";
import type { PlayerLoadout } from "./PlayerLoadout";
import type { PlayerState } from "./PlayerState";
import type { WeaponSystem } from "../weapons/WeaponSystem";
import type { WeaponDef } from "../weapons/weapons";
import type { GrenadeSystem } from "../weapons/GrenadeSystem";
import { maxTier, nextUpgradePrice, totalTiers, trackAvailable, upgradeEffect, UPGRADE_ORDER, UPGRADE_TRACKS, type UpgradeTrackId } from "../weapons/upgrades";

export class Wallet {
  money: number = ECONOMY.startMoney;
  earned = 0;
  spent = 0;
  add(n: number) {
    const v = Math.round(n);
    this.money += v;
    this.earned += v;
    return v;
  }
  spend(n: number) {
    if (this.money < n) return false;
    this.money -= n;
    this.spent += n;
    return true;
  }
}

export type ShopCategory = "primary" | "secondary" | "upgrade" | "equipment" | "perk" | "squad";
export type ShopItem = {
  id: string;
  category: ShopCategory;
  name: string;
  desc: string;
  price: number;
  /** Owned / equipped / maxed: can't buy. */
  status: "available" | "equipped" | "owned" | "maxed";
  /** Weapon stats 0..1 for the loadout screen. */
  stats?: { damage: number; rate: number; range: number; control: number; mobility: number };
  kind?: string;
  /** Upgrade tiers bought for this gun (weapon items). */
  upgrades?: number;
  /** Upgrade items: which gun, current tier of max, and the stat change. */
  upgrade?: { slot: "primary" | "secondary"; weapon: string; track: UpgradeTrackId; tier: number; max: number; effect: string };
};
export type ShopView = { money: number; items: ShopItem[] };

export type ShopDeps = {
  wallet: Wallet;
  loadout: PlayerLoadout;
  weapons: WeaponSystem;
  grenades: GrenadeSystem;
  state: PlayerState;
  /** Downed/dead squad count + revive action. */
  squadDown(): number;
  reviveSquad(): void;
  /** Re-apply loadout effects (health, speed, viewmodel). */
  onLoadoutChanged(): void;
};

function weaponStats(d: WeaponDef) {
  const dps = (d.damage * d.pellets * d.rpm) / 60;
  return {
    damage: Math.min(1, (d.damage * d.pellets) / 160),
    rate: Math.min(1, d.rpm / 950),
    range: Math.min(1, d.falloffEnd / 150),
    control: Math.max(0.05, Math.min(1, 1 - (d.recoil.pattern[0][0] * d.recoil.kickScale) / 4.5)),
    mobility: Math.min(1, (d.mobility - 0.8) / 0.3),
    dps,
  };
}

/** Between-wave shop: weapons, ammo, armor, grenades, perks and squad revives. */
export class ShopSystem {
  /** Radar upgrade bought (lasts the run): hostiles and incoming squads on the minimap. */
  radar = false;
  constructor(private readonly deps: ShopDeps) {}

  view(): ShopView {
    const { wallet, loadout, weapons, grenades, state } = this.deps;
    const items: ShopItem[] = [];
    const weaponItem = (id: WeaponId, category: "primary" | "secondary"): ShopItem => {
      const d = loadout.def(id);
      const equipped = (category === "primary" ? loadout.primary : loadout.secondary) === id;
      const dmg = Math.round(d.damage * 10) / 10;
      return {
        id: `weapon:${id}`, category, name: d.name, kind: d.kind,
        desc: `${d.calibre} · ${d.rpm} RPM · ${d.magSize} rds · ${d.pellets > 1 ? `${d.pellets}×${dmg}` : dmg} dmg`,
        price: d.price, status: equipped ? "equipped" : "available", stats: weaponStats(d),
        upgrades: totalTiers(loadout.upgrades.get(id)) || undefined,
      };
    };
    PRIMARY_IDS.forEach((id) => items.push(weaponItem(id, "primary")));
    SECONDARY_IDS.forEach((id) => items.push(weaponItem(id, "secondary")));

    // Upgrades for the two equipped guns.
    for (const slot of ["primary", "secondary"] as const) {
      const wid = slot === "primary" ? loadout.primary : loadout.secondary;
      const base = WEAPONS[wid];
      const levels = loadout.upgrades.get(wid);
      for (const track of UPGRADE_ORDER) {
        if (!trackAvailable(base, track)) continue;
        const t = UPGRADE_TRACKS[track];
        const price = nextUpgradePrice(base, levels, track);
        items.push({
          id: `upgrade:${wid}:${track}`, category: "upgrade", name: t.name, desc: t.blurb,
          price: price ?? 0, status: price === null ? "maxed" : "available",
          upgrade: { slot, weapon: base.name, track, tier: levels?.[track] ?? 0, max: maxTier(track), effect: upgradeEffect(base, levels, track) },
        });
      }
    }

    const ammoFull = weapons.slots.every((s) => s.def.slot === "melee" || s.reserve >= Math.round(s.def.reserveAmmo * weapons.mods.reserve) && s.ammo === s.def.magSize);
    items.push({ id: "ammo", category: "equipment", name: "Ammo Resupply", desc: "Refill magazines and reserves for both weapons", price: this.ammoPrice, status: ammoFull ? "maxed" : "available" });
    items.push({ id: "armor", category: "equipment", name: "Armor Plate", desc: `+${ECONOMY.armorPlate} armor (max ${PLAYER.maxArmor}). Absorbs 70% of damage.`, price: ECONOMY.prices.armor, status: state.armor >= PLAYER.maxArmor ? "maxed" : "available" });
    items.push({ id: "grenade", category: "equipment", name: GRENADE.name, desc: `+1 frag grenade (carry ${grenades.maxCarry})`, price: ECONOMY.prices.grenade, status: grenades.count >= grenades.maxCarry ? "maxed" : "available" });
    items.push({ id: "flashbang", category: "equipment", name: FLASHBANG.name, desc: `+1 stun grenade: blinds hostiles that see it (carry ${grenades.maxFlash})`, price: ECONOMY.prices.flashbang, status: grenades.flashCount >= grenades.maxFlash ? "maxed" : "available" });
    items.push({ id: "smoke", category: "equipment", name: SMOKE.name, desc: `+1 smoke: ${SMOKE.duration}s screen that blocks enemy sight (carry ${grenades.maxSmoke})`, price: ECONOMY.prices.smoke, status: grenades.smokeCount >= grenades.maxSmoke ? "maxed" : "available" });

    items.push({ id: "radar", category: "equipment", name: "Radar Uplink", desc: "Hostiles and incoming squads show on your minimap for the rest of the run", price: ECONOMY.prices.radar, status: this.radar ? "owned" : "available" });

    for (const p of Object.values(PERKS)) {
      const owned = p.id === "secondwind" ? state.selfRevives > 0 : loadout.perks.has(p.id);
      items.push({ id: `perk:${p.id}`, category: "perk", name: p.name, desc: p.desc, price: p.price, status: owned ? "owned" : "available" });
    }
    const down = this.deps.squadDown();
    items.push({ id: "squad", category: "squad", name: "Squad Medevac", desc: down ? `Revive ${down} downed squadmate${down > 1 ? "s" : ""} now` : "All squadmates are on their feet", price: ECONOMY.prices.botRevive, status: down ? "available" : "maxed" });
    return { money: wallet.money, items };
  }

  get ammoPrice() {
    return Math.round(ECONOMY.prices.ammo * this.deps.loadout.operator.ammoDiscount);
  }

  buy(id: string): { ok: boolean; message: string } {
    const { wallet, loadout, weapons, grenades, state } = this.deps;
    const item = this.view().items.find((i) => i.id === id);
    if (!item) return { ok: false, message: "Unknown item" };
    if (item.status !== "available") return { ok: false, message: item.status === "equipped" ? "Already equipped" : "Already maxed" };
    if (!wallet.spend(item.price)) return { ok: false, message: "Not enough funds" };

    if (id.startsWith("weapon:")) {
      const wid = id.slice(7) as WeaponId;
      if (WEAPONS[wid].slot === "primary") loadout.primary = wid;
      else loadout.secondary = wid;
      loadout.apply(weapons);
      // A fresh weapon comes fully loaded.
      const slot = weapons.slots.find((s) => s.def.id === wid);
      if (slot) {
        slot.ammo = slot.def.magSize;
        slot.reserve = Math.round(slot.def.reserveAmmo * weapons.mods.reserve);
      }
      this.deps.onLoadoutChanged();
    } else if (id.startsWith("upgrade:")) {
      const [, wid, track] = id.split(":") as [string, WeaponId, UpgradeTrackId];
      const slot = weapons.slots.find((s) => s.def.id === wid);
      const before = slot?.def;
      loadout.upgrade(wid, track);
      loadout.apply(weapons);
      if (slot && before) {
        // Bigger mags and pouches come filled.
        if (slot.def.magSize > before.magSize) slot.ammo = slot.def.magSize;
        const gain = Math.round((slot.def.reserveAmmo - before.reserveAmmo) * weapons.mods.reserve);
        if (gain > 0) slot.reserve += gain;
      }
      this.deps.onLoadoutChanged();
      return { ok: true, message: `${item.upgrade?.weapon} · ${item.name} tier ${(item.upgrade?.tier ?? 0) + 1} installed` };
    } else if (id === "ammo") weapons.refillAmmo(1);
    else if (id === "radar") this.radar = true;
    else if (id === "armor") state.addArmor(ECONOMY.armorPlate);
    else if (id === "grenade") grenades.count = Math.min(grenades.maxCarry, grenades.count + 1);
    else if (id === "flashbang") grenades.flashCount = Math.min(grenades.maxFlash, grenades.flashCount + 1);
    else if (id === "smoke") grenades.smokeCount = Math.min(grenades.maxSmoke, grenades.smokeCount + 1);
    else if (id.startsWith("perk:")) {
      const pid = id.slice(5) as PerkId;
      if (pid === "secondwind") state.selfRevives++;
      else {
        loadout.perks.add(pid);
        const hpBefore = state.maxHealth;
        Object.assign(weapons.mods, loadout.modifiers());
        state.maxHealth = loadout.maxHealth;
        state.health += state.maxHealth - hpBefore;
        this.deps.onLoadoutChanged();
      }
    } else if (id === "squad") this.deps.reviveSquad();
    return { ok: true, message: `${item.name} purchased` };
  }
}
