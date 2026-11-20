// Headless checks for the Brennhollow survival map: bounds, paths from every
// enemy spawn, reachable stations / crates / interiors, no overlapping boxes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BRENNHOLLOW, HOUSES } from "../src/game/world/maps/brennhollow";
import * as THREE from "three";
import { CollisionWorld } from "../src/game/world/Collision";
import { NavGrid } from "../src/game/ai/NavGrid";
import type { MapDef } from "../src/game/world/MapLoader";

function navFor(map: MapDef) {
  const world = new CollisionWorld();
  world.add(new THREE.Box3(new THREE.Vector3(-100, -1, -100), new THREE.Vector3(100, 0, 100)));
  for (const b of map.boxes) {
    if (b.decor) continue;
    const y = b.y ?? 0;
    world.add(new THREE.Box3(new THREE.Vector3(b.x - b.w / 2, y, b.z - b.d / 2), new THREE.Vector3(b.x + b.w / 2, y + b.h, b.z + b.d / 2)));
  }
  return new NavGrid(world, -50, -50, 100, 100);
}

const solid = BRENNHOLLOW.boxes.filter((b) => !b.decor);
const out = new Float32Array(8192);

test("Brennhollow: playable area is flat and bounded inside ±48", () => {
  for (const b of solid) {
    if (b.tag === "bound") continue;
    assert.ok(Math.abs(b.x) + b.w / 2 <= 48.01 && Math.abs(b.z) + b.d / 2 <= 48.01, `${b.tag} @(${b.x},${b.z}) inside ±48`);
    assert.ok((b.y ?? 0) >= 0, "nothing below the ground plane");
  }
  const bounds = solid.filter((b) => b.tag === "bound");
  assert.equal(bounds.length, 4, "a collider ring bounds the village");
  for (const b of bounds) assert.ok(b.h >= 5, "bound is too tall to jump");
  for (const s of BRENNHOLLOW.survival!.enemySpawns) assert.ok(Math.abs(s.x) < 48 && Math.abs(s.z) < 48);
});

test("Brennhollow: every enemy spawn paths to the square", () => {
  const nav = navFor(BRENNHOLLOW);
  const goal = BRENNHOLLOW.spawns[0];
  assert.ok(nav.isWalkable(goal.x, goal.z), "player spawn is walkable");
  const layout = BRENNHOLLOW.survival!;
  assert.equal(layout.enemySpawns.length, 12);
  for (const s of layout.enemySpawns) {
    assert.ok(nav.isWalkable(s.x, s.z), `spawn (${s.x}, ${s.z}) walkable`);
    const n = nav.findPath(s.x, s.z, goal.x, goal.z, out);
    assert.ok(n > 0, `no path from spawn (${s.x}, ${s.z})`);
    assert.ok(Math.hypot(out[(n - 1) * 2] - goal.x, out[(n - 1) * 2 + 1] - goal.z) < 2, "path ends at the goal");
  }
});

test("Brennhollow: stations, crates and the enterable interiors are reachable", () => {
  const nav = navFor(BRENNHOLLOW);
  const g = BRENNHOLLOW.spawns[0];
  const layout = BRENNHOLLOW.survival!;
  assert.equal(layout.buyStations.length, 2);
  assert.equal(layout.ammoCrates.length, 4);
  assert.equal(layout.perches.length, 4);
  for (const st of layout.buyStations) {
    const box = solid.find((b) => b.tag === "station" && b.x === st.x && b.z === st.z);
    assert.ok(box, `${st.name} has a station box`);
    const ok = [[1.3, 0], [-1.3, 0], [0, 1.1], [0, -1.1]].some(([dx, dz]) => nav.findPath(g.x, g.z, st.x + dx, st.z + dz, out) > 0);
    assert.ok(ok, `${st.name} reachable`);
  }
  for (const c of layout.ammoCrates) {
    assert.ok(solid.some((b) => b.tag === "ammo" && b.x === c.x && b.z === c.z), "crate has an ammo box");
    const ok = [[1.3, 0], [-1.3, 0], [0, 1.1], [0, -1.1]].some(([dx, dz]) => nav.findPath(g.x, g.z, c.x + dx, c.z + dz, out) > 0);
    assert.ok(ok, `crate (${c.x}, ${c.z}) reachable`);
  }
  // Inside the hall, church nave, manor front hall, barn and the walk-through ruin.
  for (const [x, z, name] of [[-18, -7, "hall"], [0, -25, "church"], [0, -16, "tower porch"], [27, -27, "manor hall"], [36, 12, "barn"], [-31.5, -19.5, "ruin"], [24.7, -21, "manor garden"]] as const) {
    assert.ok(nav.isWalkable(x, z), `${name} floor walkable`);
    assert.ok(nav.findPath(g.x, g.z, x, z, out) > 0, `${name} reachable`);
  }
});

test("Brennhollow: hall stairs climb in steps the player can take", () => {
  const steps = solid.filter((b) => b.tag === "stair").sort((a, b) => a.h - b.h);
  assert.ok(steps.length >= 8);
  let prev = 0;
  for (const s of steps) {
    assert.ok(s.h - prev <= 0.4 + 1e-6, `rise ${s.h - prev}`);
    prev = s.h;
  }
  const hall = HOUSES.find((h) => h.id === "hall")!;
  assert.ok(Math.abs(prev - hall.fh) < 1e-6, "stairs reach the upper floor");
  assert.ok(solid.filter((b) => b.tag === "floor").length >= 2, "upper floor slab");
});

test("Brennhollow: solid boxes don't overlap", () => {
  const list = solid;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const ay = a.y ?? 0, by = b.y ?? 0;
      const ox = Math.abs(a.x - b.x) < (a.w + b.w) / 2 - 0.02;
      const oz = Math.abs(a.z - b.z) < (a.d + b.d) / 2 - 0.02;
      const oy = ay < by + b.h - 0.02 && by < ay + a.h - 0.02;
      assert.ok(!(ox && oz && oy), `boxes overlap: ${a.tag ?? a.style} @(${a.x.toFixed(2)},${a.z.toFixed(2)},${ay}) and ${b.tag ?? b.style} @(${b.x.toFixed(2)},${b.z.toFixed(2)},${by})`);
    }
  }
});

test("Brennhollow: perches stand on a collider", () => {
  for (const p of BRENNHOLLOW.survival!.perches) {
    const under = solid.some((b) => Math.abs(b.x - p.x) < b.w / 2 && Math.abs(b.z - p.z) < b.d / 2 && Math.abs((b.y ?? 0) + b.h - p.y) < 0.05);
    assert.ok(under, `perch (${p.x}, ${p.y}, ${p.z}) has a floor`);
  }
});
