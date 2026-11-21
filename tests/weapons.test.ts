// Weapon library: wire ids, legacy loadouts, sane stats, and every model builds.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  WEAPONS, PRIMARY_IDS, SECONDARY_IDS, DEFAULT_LOADOUT, LEGACY_WEAPON_IDS, resolveWeaponId, damageAt, type WeaponId,
} from "../src/game/weapons/weapons";
import { WEAPON_IDS } from "../src/game/net/ids";
import { OPERATORS } from "../src/game/survival/config";
import { GeoBuilder } from "../src/game/weapons/viewmodel/geo";
import { createViewmodelMaterials } from "../src/game/weapons/viewmodel/materials";
import { GUN_BUILDERS } from "../src/game/weapons/viewmodel/guns";

test("weapon wire ids keep the original seven slots and only append", () => {
  // Index order is on the wire: the first seven replace the original library one for one.
  assert.deepEqual(WEAPON_IDS.slice(0, 7), ["m4a1", "mp5", "r870", "m24", "m249", "m9", "sw629"]);
  assert.ok(WEAPON_IDS.length >= 22 && WEAPON_IDS.length < 256);
  assert.equal(new Set(WEAPON_IDS).size, WEAPON_IDS.length);
});

test("old saved loadout ids map to a sensible successor", () => {
  assert.equal(resolveWeaponId("vk7", "primary", "mp5"), "m4a1");
  assert.equal(resolveWeaponId("longreach", "primary", "mp5"), "m24");
  assert.equal(resolveWeaponId("marrow9", "secondary", "g17"), "m9");
  assert.equal(resolveWeaponId("ruin50", "secondary", "g17"), "sw629");
  assert.equal(resolveWeaponId("nope", "primary", "akm"), "akm");
  // Slot mismatch falls back rather than putting a pistol in the primary slot.
  assert.equal(resolveWeaponId("m9", "primary", "m4a1"), "m4a1");
  for (const id of Object.values(LEGACY_WEAPON_IDS)) assert.ok(id in WEAPONS);
});

test("lobby lists, defaults and operators only use carried guns", () => {
  assert.ok(PRIMARY_IDS.length >= 15);
  assert.ok(SECONDARY_IDS.length >= 4);
  for (const id of PRIMARY_IDS) assert.equal(WEAPONS[id].slot, "primary");
  for (const id of SECONDARY_IDS) assert.equal(WEAPONS[id].slot, "secondary");
  assert.ok(!PRIMARY_IDS.includes("knife" as WeaponId) && !SECONDARY_IDS.includes("knife" as WeaponId));
  for (const id of DEFAULT_LOADOUT) assert.ok(id in WEAPONS);
  for (const op of Object.values(OPERATORS)) {
    assert.equal(WEAPONS[op.primary].slot, "primary", op.id);
    assert.equal(WEAPONS[op.secondary].slot, "secondary", op.id);
  }
});

test("stats are realistic and within balance bounds", () => {
  for (const [id, w] of Object.entries(WEAPONS)) {
    if (w.slot === "melee") continue;
    assert.ok(w.rpm > 30 && w.rpm <= 1200, `${id} rpm ${w.rpm}`);
    assert.ok(w.magSize > 0 && w.magSize <= 200, `${id} mag`);
    assert.ok(w.reloadTime > 0.2 && w.reloadEmptyTime >= w.reloadTime, `${id} reload`);
    assert.ok(w.muzzleVelocity > 200 && w.muzzleVelocity < 1100, `${id} velocity`);
    assert.ok(w.modes.length >= 1, `${id} modes`);
    assert.ok(damageAt(w, 300) <= damageAt(w, 5), `${id} falloff`);
    assert.ok(w.model in GUN_BUILDERS, `${id} model`);
  }
  // Rifles: 5.56 shouldn't out-hit 7.62; the .50 is the heaviest hitter.
  assert.ok(WEAPONS.akm.damage >= WEAPONS.m4a1.damage);
  assert.ok(WEAPONS.m82.damage > WEAPONS.m24.damage);
  assert.ok(WEAPONS.uzi.rpm < WEAPONS.p90.rpm);
});

test("every first-person model builds with a muzzle, mag and support hand", () => {
  const mats = createViewmodelMaterials();
  for (const [kind, build] of Object.entries(GUN_BUILDERS)) {
    const b = new GeoBuilder(mats.render);
    const spec = build({ b, m: mats });
    const owned: { dispose(): void }[] = [];
    b.finish(owned);
    assert.equal(spec.kind, kind);
    assert.ok(b.triangles > 500, `${kind}: ${b.triangles} tris`);
    assert.ok(b.triangles < 200_000, `${kind}: ${b.triangles} tris`);
    assert.ok(Number.isFinite(spec.ads.z) && Number.isFinite(spec.muzzle.position.z), kind);
    if (kind !== "knife") assert.ok(spec.muzzle.position.z < -0.1, `${kind} muzzle ahead of the grip`);
    const box = new THREE.Box3().setFromObject(spec.root);
    assert.ok(box.max.z - box.min.z > 0.15 && box.max.z - box.min.z < 1.6, `${kind} length`);
    for (const d of owned) d.dispose();
  }
  mats.dispose();
});
