// Headless tests for game content: the Cinder Flats map, Juggernaut stagger
// rules, air escalation, and the mission campaign data/director.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { composeWave, ENEMIES } from "../src/game/survival/config";
import { composeAir } from "../src/game/survival/airSupport";
import { registerHeavyHit, tickStagger, type StaggerState } from "../src/game/ai/heavy/Juggernaut";
import { CollisionWorld } from "../src/game/world/Collision";
import { NavGrid } from "../src/game/ai/NavGrid";
import type { MapDef } from "../src/game/world/MapLoader";
import { CINDER_FLATS } from "../src/game/world/maps/cinderFlats";
import { MAPS, SURVIVAL_MAPS } from "../src/game/world/maps/registry";

export function navFor(map: MapDef) {
  const world = new CollisionWorld();
  world.add(new THREE.Box3(new THREE.Vector3(-100, -1, -100), new THREE.Vector3(100, 0, 100)));
  for (const b of map.boxes) {
    if (b.decor) continue;
    const y = b.y ?? 0;
    world.add(new THREE.Box3(new THREE.Vector3(b.x - b.w / 2, y, b.z - b.d / 2), new THREE.Vector3(b.x + b.w / 2, y + b.h, b.z + b.d / 2)));
  }
  return new NavGrid(world, -50, -50, 100, 100);
}

test("map registry lists both survival maps with layouts", () => {
  assert.deepEqual(SURVIVAL_MAPS.map((m) => m.id), ["dustfall-outpost", "cinder-flats"]);
  for (const m of SURVIVAL_MAPS) assert.ok(m.def.survival, `${m.id} has a survival layout`);
  assert.equal(new Set(MAPS.map((m) => m.id)).size, MAPS.length, "ids are unique");
});

test("every Cinder Flats enemy spawn can path to the control shack", () => {
  const nav = navFor(CINDER_FLATS);
  const layout = CINDER_FLATS.survival!;
  const out = new Float32Array(4096);
  const center = CINDER_FLATS.spawns[0];
  assert.ok(nav.isWalkable(center.x, center.z), "player spawn is walkable");
  for (const s of layout.enemySpawns) {
    assert.ok(nav.nearestWalkable(s.x, s.z) >= 0, `spawn (${s.x}, ${s.z}) near walkable ground`);
    const n = nav.findPath(s.x, s.z, center.x, center.z, out);
    assert.ok(n > 0, `no path from spawn (${s.x}, ${s.z})`);
    const ex = out[(n - 1) * 2];
    const ez = out[(n - 1) * 2 + 1];
    assert.ok(Math.hypot(ex - center.x, ez - center.z) < 2, "path ends at the goal");
  }
  // Inside the shack (through the doors) and every armory / ammo crate.
  assert.ok(nav.findPath(center.x, center.z, 0, -1, out) > 0, "shack interior reachable");
  for (const st of layout.buyStations) assert.ok(nav.findPath(center.x, center.z, st.x + 1.2, st.z, out) > 0, `${st.name} reachable`);
  for (const c of layout.ammoCrates) assert.ok(nav.findPath(center.x, center.z, c.x, c.z + 1.2, out) > 0, `crate (${c.x}, ${c.z}) reachable`);
});

test("Cinder Flats boxes don't overlap each other (except stacked / tank collider sets)", () => {
  const solid = CINDER_FLATS.boxes.filter((b) => !b.decor && b.style !== "berm" && b.tag !== "storage" && b.tag !== "shack" && b.tag !== "roof");
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i], b = solid[j];
      const ay = a.y ?? 0, by = b.y ?? 0;
      const ox = Math.abs(a.x - b.x) < (a.w + b.w) / 2 - 0.02;
      const oz = Math.abs(a.z - b.z) < (a.d + b.d) / 2 - 0.02;
      const oy = ay < by + b.h - 0.02 && by < ay + a.h - 0.02;
      assert.ok(!(ox && oz && oy), `boxes overlap: ${a.tag ?? a.style} @(${a.x},${a.z}) and ${b.tag ?? b.style} @(${b.x},${b.z})`);
    }
  }
});

test("juggernauts escalate on elite and boss waves; helicopters from wave 5", () => {
  assert.ok(ENEMIES.armored.bodyArmor < 0.5, "juggernaut plates soak body hits");
  assert.ok(ENEMIES.armored.suppress && ENEMIES.armored.stagger, "juggernaut suppresses and staggers");
  assert.ok(composeWave(10, 1, 2).armored >= composeWave(9, 1, 2).armored + 2, "boss wave brings escorts");
  assert.ok(composeWave(15, 1, 2).armored > composeWave(14, 1, 2).armored);
  assert.equal(composeAir(4).length, 0);
  assert.equal(composeAir(5).length, 1);
  assert.equal(composeAir(10).length, 2, "boss wave: two gunships");
  assert.ok(composeAir(12)[0].orbit > composeAir(6)[0].orbit, "longer gun runs later");
});

test("juggernaut stagger: big hits or sustained bursts, with a cooldown", () => {
  const def = ENEMIES.armored.stagger!;
  const s: StaggerState = { staggerTimer: 0, staggerCooldown: 0, staggerAccum: 0, staggerAge: 0 };
  assert.equal(registerHeavyHit(s, def, 30), false, "rifle round doesn't stagger");
  assert.equal(registerHeavyHit(s, def, def.threshold), true, "a sniper round does");
  assert.ok(s.staggerTimer > 0);
  assert.equal(registerHeavyHit(s, def, 500), false, "no re-stagger while staggered / cooling down");
  for (let t = 0; t < def.duration + def.cooldown + 0.1; t += 0.05) tickStagger(s, 0.05);
  assert.equal(s.staggerTimer, 0);
  // Sustained fire inside the window adds up.
  let hit = false;
  for (let i = 0; i < 12 && !hit; i++) {
    hit = registerHeavyHit(s, def, 20);
    tickStagger(s, 0.05);
  }
  assert.equal(hit, true, "a sustained burst staggers");
});
