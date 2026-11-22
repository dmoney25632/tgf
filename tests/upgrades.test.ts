// Armory gun upgrades: tier math, prices, the shop flow and co-op hit caps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { WEAPONS } from "../src/game/weapons/weapons";
import { WeaponSystem, type WeaponHooks } from "../src/game/weapons/WeaponSystem";
import type { PlayerController } from "../src/game/player/PlayerController";
import {
  maxTier,
  nextUpgradePrice,
  trackAvailable,
  upgradedMag,
  upgradeEffect,
  upgradeWeapon,
  UPGRADE_ORDER,
  UPGRADE_TRACKS,
} from "../src/game/weapons/upgrades";
import { PlayerLoadout } from "../src/game/survival/PlayerLoadout";
import { ShopSystem, Wallet } from "../src/game/survival/ShopSystem";
import { PlayerState } from "../src/game/survival/PlayerState";
import type { GrenadeSystem } from "../src/game/weapons/GrenadeSystem";
import { HitValidator } from "../src/game/net/hitValidation";

const weaponSystem = () => new WeaponSystem([WEAPONS.m4a1, WEAPONS.m9], {} as PlayerController, () => [], {} as WeaponHooks);

function rig(money = 100_000) {
  const weapons = weaponSystem();
  weapons.infiniteSecondary = true;
  const loadout = new PlayerLoadout("ridge", "m4a1", "m9");
  loadout.apply(weapons);
  const wallet = new Wallet();
  wallet.money = money;
  const grenades = { count: 0, maxCarry: 3, flashCount: 0, maxFlash: 2, smokeCount: 0, maxSmoke: 2 } as GrenadeSystem;
  let changed = 0;
  const shop = new ShopSystem({
    wallet, loadout, weapons, grenades, state: new PlayerState(),
    squadDown: () => 0, reviveSquad: () => {}, onLoadoutChanged: () => changed++,
  });
  return { weapons, loadout, wallet, shop, changed: () => changed };
}

const slotOf = (w: WeaponSystem, id: string) => w.slots.find((s) => s.def.id === id)!;

test("no upgrades returns the base def untouched", () => {
  assert.equal(upgradeWeapon(WEAPONS.m4a1, undefined), WEAPONS.m4a1);
  assert.equal(upgradeWeapon(WEAPONS.m4a1, {}), WEAPONS.m4a1);
  assert.equal(upgradeWeapon(WEAPONS.knife, { damage: 4 }), WEAPONS.knife);
});

test("each track changes the stat it names and leaves the base def alone", () => {
  const b = WEAPONS.m4a1;
  const snapshot = JSON.stringify(b);
  const u = upgradeWeapon(b, { damage: 2, recoil: 3, mag: 1, reload: 2, ads: 1, reserve: 2 });
  assert.ok(Math.abs(u.damage - b.damage * 1.16) < 1e-9);
  assert.ok(Math.abs(u.minDamage - b.minDamage * 1.16) < 1e-9);
  assert.ok(Math.abs(u.recoil.kickScale - b.recoil.kickScale * 0.7) < 1e-9);
  assert.ok(u.recoil.jitterPitch < b.recoil.jitterPitch);
  assert.equal(u.magSize, upgradedMag(b.magSize, 1));
  assert.ok(u.magSize > b.magSize);
  assert.ok(Math.abs(u.reloadTime - b.reloadTime * 0.8) < 1e-9);
  assert.ok(Math.abs(u.reloadEmptyTime - b.reloadEmptyTime * 0.8) < 1e-9);
  assert.ok(Math.abs(u.adsTime - b.adsTime * 0.88) < 1e-9);
  assert.equal(u.reserveAmmo, Math.round(b.reserveAmmo * 1.5));
  assert.equal(u.id, b.id);
  assert.equal(JSON.stringify(b), snapshot, "base def must not be mutated");
});

test("extended mags always add at least a round per tier", () => {
  assert.equal(upgradedMag(30, 1), 35);
  assert.equal(upgradedMag(5, 1), 6);
  assert.equal(upgradedMag(5, 3), 8);
  assert.equal(upgradedMag(8, 0), 8);
});

test("tier prices rise and stop at the max tier", () => {
  for (const k of UPGRADE_ORDER) {
    const p = UPGRADE_TRACKS[k].prices;
    assert.ok(p.length >= 3, `${k} has several tiers`);
    for (let i = 1; i < p.length; i++) assert.ok(p[i] > p[i - 1], `${k} tier ${i + 1} costs more`);
    assert.equal(nextUpgradePrice(WEAPONS.m4a1, {}, k), p[0]);
    assert.equal(nextUpgradePrice(WEAPONS.m4a1, { [k]: maxTier(k) }, k), null);
  }
  // Tiers past the max clamp instead of compounding.
  assert.deepEqual(upgradeWeapon(WEAPONS.m4a1, { damage: 99 }).damage, upgradeWeapon(WEAPONS.m4a1, { damage: maxTier("damage") }).damage);
});

test("sidearms pay less and skip reserve ammo (their reserve is endless in survival)", () => {
  assert.ok(nextUpgradePrice(WEAPONS.m9, {}, "damage")! < nextUpgradePrice(WEAPONS.m4a1, {}, "damage")!);
  assert.equal(trackAvailable(WEAPONS.m9, "reserve"), false);
  assert.equal(nextUpgradePrice(WEAPONS.m9, {}, "reserve"), null);
  assert.equal(trackAvailable(WEAPONS.knife, "damage"), false);
});

test("effect line shows current → next and the final value when maxed", () => {
  assert.match(upgradeEffect(WEAPONS.m4a1, {}, "mag"), new RegExp(`^${WEAPONS.m4a1.magSize} rds → ${upgradedMag(WEAPONS.m4a1.magSize, 1)} rds$`));
  assert.doesNotMatch(upgradeEffect(WEAPONS.m4a1, { mag: 3 }, "mag"), /→/);
  assert.equal(upgradeEffect(WEAPONS.m4a1, {}, "recoil"), "stock recoil → -10% recoil");
});

test("the armory lists upgrades for both equipped guns", () => {
  const { shop } = rig();
  const ups = shop.view().items.filter((i) => i.category === "upgrade");
  const primary = ups.filter((i) => i.upgrade!.slot === "primary");
  const secondary = ups.filter((i) => i.upgrade!.slot === "secondary");
  assert.equal(primary.length, 6);
  assert.equal(secondary.length, 5);
  assert.ok(primary.every((i) => i.id.startsWith("upgrade:m4a1:") && i.status === "available"));
  assert.ok(secondary.every((i) => i.id.startsWith("upgrade:m9:")));
});

test("buying an upgrade charges, applies to the live weapon and persists", () => {
  const { shop, weapons, wallet, changed } = rig();
  const before = { ...slotOf(weapons, "m4a1").def };
  const price = shop.view().items.find((i) => i.id === "upgrade:m4a1:mag")!.price;
  const money = wallet.money;
  const r = shop.buy("upgrade:m4a1:mag");
  assert.ok(r.ok, r.message);
  assert.equal(wallet.money, money - price);
  const s = slotOf(weapons, "m4a1");
  assert.equal(s.def.magSize, upgradedMag(before.magSize, 1));
  assert.equal(s.ammo, s.def.magSize, "the bigger mag comes loaded");
  assert.ok(changed() > 0);

  shop.buy("upgrade:m4a1:damage");
  shop.buy("upgrade:m4a1:recoil");
  shop.buy("upgrade:m4a1:reload");
  shop.buy("upgrade:m4a1:ads");
  const d = slotOf(weapons, "m4a1").def;
  assert.ok(d.damage > before.damage);
  assert.ok(d.recoil.kickScale < before.recoil.kickScale);
  assert.ok(d.reloadTime < before.reloadTime);
  assert.ok(d.adsTime < before.adsTime);
  // The next tier is now the pricier one.
  const next = shop.view().items.find((i) => i.id === "upgrade:m4a1:damage")!;
  assert.equal(next.price, UPGRADE_TRACKS.damage.prices[1]);
  assert.equal(next.upgrade!.tier, 1);
});

test("reserve pouches add their rounds straight away", () => {
  const { shop, weapons } = rig();
  const s = slotOf(weapons, "m4a1");
  const reserve = s.reserve;
  shop.buy("upgrade:m4a1:reserve");
  assert.equal(s.reserve, reserve + Math.round((s.def.reserveAmmo - WEAPONS.m4a1.reserveAmmo) * weapons.mods.reserve));
  assert.ok(s.reserve > reserve);
});

test("maxed tracks can't be bought again", () => {
  const { shop } = rig();
  for (let i = 0; i < maxTier("mag"); i++) assert.ok(shop.buy("upgrade:m4a1:mag").ok);
  const item = shop.view().items.find((i) => i.id === "upgrade:m4a1:mag")!;
  assert.equal(item.status, "maxed");
  assert.equal(shop.buy("upgrade:m4a1:mag").ok, false);
});

test("not enough money: no upgrade", () => {
  const { shop, weapons } = rig(50);
  assert.equal(shop.buy("upgrade:m4a1:damage").ok, false);
  assert.equal(slotOf(weapons, "m4a1").def, WEAPONS.m4a1);
});

test("upgrades stay with the gun: a new gun starts fresh, the old one gets them back", () => {
  const { shop, weapons, loadout } = rig();
  shop.buy("upgrade:m4a1:damage");
  shop.buy("upgrade:m4a1:mag");
  assert.ok(shop.buy("weapon:akm").ok);
  assert.equal(loadout.primary, "akm");
  assert.equal(slotOf(weapons, "akm").def, WEAPONS.akm, "a different gun has no upgrades");
  assert.ok(shop.view().items.some((i) => i.id === "upgrade:akm:damage" && i.upgrade!.tier === 0));
  // The M4's card remembers its upgrades.
  assert.equal(shop.view().items.find((i) => i.id === "weapon:m4a1")!.upgrades, 2);

  assert.ok(shop.buy("weapon:m4a1").ok);
  const d = slotOf(weapons, "m4a1").def;
  assert.ok(d.damage > WEAPONS.m4a1.damage);
  assert.equal(d.magSize, upgradedMag(WEAPONS.m4a1.magSize, 1));
  assert.equal(slotOf(weapons, "m4a1").ammo, d.magSize, "a bought gun comes with a full (upgraded) mag");
});

test("setLoadout swaps in an upgraded def but keeps ammo and fire mode", () => {
  const w = weaponSystem();
  const s = slotOf(w, "m4a1");
  s.ammo = 7;
  s.reserve = 50;
  const up = upgradeWeapon(WEAPONS.m4a1, { recoil: 1 });
  w.setLoadout([up, WEAPONS.m9]);
  const s2 = slotOf(w, "m4a1");
  assert.equal(s2.def, up);
  assert.equal(s2.ammo, 7);
  assert.equal(s2.reserve, 50);
});

test("co-op host allows upgraded damage that the base gun would clamp", () => {
  const up = upgradeWeapon(WEAPONS.m4a1, { damage: maxTier("damage") });
  const claim = (weapon: typeof up) =>
    new HitValidator().validate({
      now: 0, shooterId: 1, shooterEye: { x: 0, y: 1.6, z: 0 }, shooterCanFire: true, targetAlive: true,
      targetPoints: [{ x: 0, y: 1.4, z: 5 }], weapon, part: "body", damage: up.damage, los: () => true,
    });
  const base = claim(WEAPONS.m4a1);
  const upgraded = claim(up);
  assert.ok(base.ok && upgraded.ok);
  assert.ok(base.damage < up.damage, "the base cap clamps an upgraded hit");
  assert.equal(upgraded.damage, up.damage);
});
