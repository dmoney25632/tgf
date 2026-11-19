// Headless smoke tests for Survival's core rules: wave composition, spawn
// ordering, player vitals, the economy, and navigation on Dustfall Outpost.
// Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { composeWave, ECONOMY, PLAYER, type EnemyType } from "../src/game/survival/config";
import { WaveManager } from "../src/game/survival/WaveManager";
import { PlayerState } from "../src/game/survival/PlayerState";
import { Wallet } from "../src/game/survival/ShopSystem";
import { CollisionWorld } from "../src/game/world/Collision";
import { NavGrid } from "../src/game/ai/NavGrid";
import { DUSTFALL_OUTPOST } from "../src/game/world/maps/dustfallOutpost";

const types = (c: Record<EnemyType, number>) => (Object.keys(c) as EnemyType[]).filter((t) => c[t] > 0).sort();

test("wave composition follows the escalation table", () => {
  for (const w of [1, 2, 3]) assert.deepEqual(types(composeWave(w, 1, 2)), ["rifleman"], `wave ${w}`);
  for (const w of [4, 5, 6]) assert.deepEqual(types(composeWave(w, 1, 2)), ["armored", "rifleman", "rusher"], `wave ${w}`);
  for (const w of [7, 8, 9]) assert.deepEqual(types(composeWave(w, 1, 2)), ["armored", "rifleman", "rusher", "sniper"], `wave ${w}`);
  assert.equal(composeWave(10, 1, 2).warden, 1);
  assert.equal(composeWave(11, 1, 2).warden, 0);
  assert.equal(composeWave(15, 1, 2).warden, 1);
  // Bigger waves later, and more enemies for a larger squad.
  const total = (c: Record<EnemyType, number>) => Object.values(c).reduce((a, b) => a + b, 0);
  assert.ok(total(composeWave(10, 1, 2)) > total(composeWave(1, 1, 2)));
  assert.ok(total(composeWave(5, 1, 2)) > total(composeWave(5, 1, 0)));
});

test("wave manager queues the whole wave and sends the Warden in early", () => {
  for (let i = 0; i < 20; i++) {
    const w = new WaveManager(10, 1, 2, 10);
    w.startNextWave();
    assert.equal(w.wave, 10);
    assert.equal(w.phase, "combat");
    assert.equal(w.queue.length, w.total);
    // The queue spawns from the end: the Warden must be the 5th to pop.
    assert.equal(w.queue.lastIndexOf("warden"), w.queue.length - 5);
  }
  const last = new WaveManager(10, 1, 2, 10);
  last.startNextWave();
  assert.equal(last.final, true);
  const endless = new WaveManager(0, 1, 2, 30);
  endless.startNextWave();
  assert.equal(endless.final, false);
});

test("armor soaks damage and lethal hits down the player", () => {
  const s = new PlayerState();
  s.reset(100, 50);
  const r = s.damage(40);
  assert.equal(r.downed, false);
  assert.ok(s.armor < 50 && s.health > 60, "armor absorbs most of the hit");
  s.damage(500);
  assert.equal(s.downed, true);
  assert.equal(s.alive, false);
  assert.equal(s.bleed, PLAYER.bleedOut);
  assert.equal(s.timesDowned, 1);
  assert.deepEqual(s.damage(10), { lost: 0, downed: false }, "no damage while downed");
});

test("wallet tracks earnings and refuses overspending", () => {
  const w = new Wallet();
  assert.equal(w.money, ECONOMY.startMoney);
  w.add(100.4);
  assert.equal(w.money, ECONOMY.startMoney + 100);
  assert.equal(w.spend(w.money + 1), false);
  assert.equal(w.spend(100), true);
  assert.equal(w.spent, 100);
  assert.equal(w.earned, 100);
});

test("every Dustfall enemy spawn can path into the compound", () => {
  const world = new CollisionWorld();
  world.add(new THREE.Box3(new THREE.Vector3(-100, -1, -100), new THREE.Vector3(100, 0, 100)));
  for (const b of DUSTFALL_OUTPOST.boxes) {
    if (b.decor) continue;
    const y = b.y ?? 0;
    world.add(new THREE.Box3(new THREE.Vector3(b.x - b.w / 2, y, b.z - b.d / 2), new THREE.Vector3(b.x + b.w / 2, y + b.h, b.z + b.d / 2)));
  }
  const nav = new NavGrid(world, -50, -50, 100, 100);
  const layout = DUSTFALL_OUTPOST.survival!;
  const out = new Float32Array(4096);
  const center = DUSTFALL_OUTPOST.spawns[0];
  for (const s of layout.enemySpawns) {
    const n = nav.findPath(s.x, s.z, center.x, center.z, out);
    assert.ok(n > 0, `no path from spawn (${s.x}, ${s.z})`);
    const ex = out[(n - 1) * 2];
    const ez = out[(n - 1) * 2 + 1];
    assert.ok(Math.hypot(ex - center.x, ez - center.z) < 2, "path ends at the goal");
  }
  for (const st of layout.buyStations) assert.ok(nav.nearestWalkable(st.x, st.z) >= 0, "buy station reachable");
});
