// Headless tests for the Saltpan Gantry survival map: layout bounds, enemy
// paths, reachable stations/crates, climbable stairs, no overlapping
// colliders, and a dressing build on every quality preset (triangle budget).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { CollisionWorld } from "../src/game/world/Collision";
import { NavGrid } from "../src/game/ai/NavGrid";
import type { MapBox, MapDef } from "../src/game/world/MapLoader";
import { MeshBuilder } from "../src/game/world/MeshBuilder";
import { createStyleKit } from "../src/game/world/BoxStyles";
import { QUALITY } from "../src/game/config";
import { SALTPAN_GANTRY, TOWER, FLIGHT1, FLIGHT2, CATWALK } from "../src/game/world/maps/saltpanGantry";
import { saltpanGantry } from "../src/game/world/dressing/saltpanGantry";
import type { DressingKit } from "../src/game/world/dressing/common";

const map = SALTPAN_GANTRY;
const solid = map.boxes.filter((b) => !b.decor);

function navFor(def: MapDef) {
  const world = new CollisionWorld();
  world.add(new THREE.Box3(new THREE.Vector3(-100, -1, -100), new THREE.Vector3(100, 0, 100)));
  for (const b of def.boxes) {
    if (b.decor) continue;
    const y = b.y ?? 0;
    world.add(new THREE.Box3(new THREE.Vector3(b.x - b.w / 2, y, b.z - b.d / 2), new THREE.Vector3(b.x + b.w / 2, y + b.h, b.z + b.d / 2)));
  }
  return new NavGrid(world, -50, -50, 100, 100);
}

test("Saltpan Gantry is registered with a survival layout", () => {
  assert.equal(map.id, "saltpan-gantry");
  assert.equal(map.dressing, "saltpanGantry");
  const s = map.survival!;
  assert.ok(s.enemySpawns.length >= 12, "a dozen enemy spawns");
  assert.equal(s.perches.length, 4);
  assert.equal(s.buyStations.length, 2);
  assert.equal(s.ammoCrates.length, 4);
  assert.equal(map.boxes.filter((b) => b.tag === "station").length, 2, "station boxes");
  assert.equal(map.boxes.filter((b) => b.tag === "ammo").length, 4, "ammo boxes");
});

test("playable area is bounded inside ±48 and every spawn is inside it", () => {
  const s = map.survival!;
  for (const p of [...map.spawns, ...s.enemySpawns, ...s.buyStations, ...s.ammoCrates, ...s.perches]) {
    assert.ok(Math.abs(p.x) <= 48 && Math.abs(p.z) <= 48, `(${p.x}, ${p.z}) inside the wall`);
  }
  // The perimeter wall closes all four sides from x/z = ±48 outward.
  const wall = map.boxes.filter((b) => b.tag === "perimeter");
  assert.equal(wall.length, 4);
  for (const w of wall) {
    const inner = w.w > w.d ? Math.abs(w.z) - w.d / 2 : Math.abs(w.x) - w.w / 2;
    assert.ok(inner >= 47.99 && inner <= 48.01, "wall inner face at 48");
    assert.ok(w.h >= 4, "wall is too high to climb");
  }
  // Nothing solid pokes out past the wall's outer face.
  for (const b of solid) assert.ok(Math.abs(b.x) + b.w / 2 <= 50.01 && Math.abs(b.z) + b.d / 2 <= 50.01, `${b.tag ?? b.style} inside ±50`);
});

test("every enemy spawn paths to the player spawn; stations, crates and the tower base are reachable", () => {
  const nav = navFor(map);
  const out = new Float32Array(4096);
  const c = map.spawns[0];
  assert.ok(nav.isWalkable(c.x, c.z), "player spawn walkable");
  for (const s of map.survival!.enemySpawns) {
    assert.ok(nav.isWalkable(s.x, s.z), `spawn (${s.x}, ${s.z}) walkable`);
    const n = nav.findPath(s.x, s.z, c.x, c.z, out);
    assert.ok(n > 0, `path from (${s.x}, ${s.z})`);
    assert.ok(Math.hypot(out[(n - 1) * 2] - c.x, out[(n - 1) * 2 + 1] - c.z) < 2, "path ends at the goal");
  }
  for (const st of map.survival!.buyStations) assert.ok(nav.findPath(c.x, c.z, st.x, st.z + 1.2, out) > 0, `${st.name} reachable`);
  for (const k of map.survival!.ammoCrates) assert.ok(nav.findPath(c.x, c.z, k.x, k.z + 1.2, out) > 0, `crate (${k.x}, ${k.z}) reachable`);
  assert.ok(nav.findPath(c.x, c.z, TOWER.x + 2, TOWER.z + 2, out) > 0, "ground floor under the tower reachable");
  assert.ok(nav.findPath(c.x, c.z, FLIGHT1.x0 + FLIGHT1.run * FLIGHT1.n + 0.6, FLIGHT1.z, out) > 0, "foot of the tower stair reachable");
  assert.ok(nav.findPath(c.x, c.z, CATWALK.xTop + CATWALK.run * CATWALK.n + 0.6, CATWALK.z, out) > 0, "foot of the conveyor stair reachable");
});

test("stairs climb in steps the player can take, up to decks no higher than 8 m", () => {
  const flight = (tag: string, pick: (b: MapBox) => boolean) => solid.filter((b) => b.tag === tag && pick(b)).sort((a, b) => (a.y ?? 0) - (b.y ?? 0));
  const check = (steps: MapBox[], top: number, name: string, start = 0) => {
    let h = start;
    for (const s of steps) {
      const t = (s.y ?? 0) + s.h;
      assert.ok(t - h <= 0.45 + 1e-6, `${name}: rise ${(t - h).toFixed(2)} at y=${t}`);
      h = t;
    }
    assert.ok(Math.abs(h - top) < 1e-6, `${name} reaches ${top}`);
  };
  check(flight("stair", (b) => Math.abs(b.z - FLIGHT1.z) < 0.01 && b.x > TOWER.x), TOWER.deck1, "flight 1");
  check(flight("stair", (b) => Math.abs(b.x - FLIGHT2.x) < 0.01), TOWER.deck2, "flight 2", TOWER.deck1);
  check(flight("catwalk", () => true), TOWER.deck2, "conveyor stair");
  assert.ok(TOWER.deck2 <= 8);
  for (const p of map.survival!.perches) assert.ok(p.y <= 8);
});

test("Saltpan Gantry colliders don't overlap (except the silo collider sets)", () => {
  const list = solid.filter((b) => b.tag !== "silo");
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const ay = a.y ?? 0, by = b.y ?? 0;
      const ox = Math.abs(a.x - b.x) < (a.w + b.w) / 2 - 0.02;
      const oz = Math.abs(a.z - b.z) < (a.d + b.d) / 2 - 0.02;
      const oy = ay < by + b.h - 0.02 && by < ay + a.h - 0.02;
      assert.ok(!(ox && oz && oy), `boxes overlap: ${a.tag ?? a.style} @(${a.x},${a.z}) and ${b.tag ?? b.style} @(${b.x},${b.z})`);
    }
  }
});

test("dressing builds on every preset, flat inside the yard, with a sane triangle budget", () => {
  const tris: Record<string, number> = {};
  for (const name of ["low", "medium", "high"] as const) {
    const builder = new MeshBuilder();
    const placed: string[] = [];
    const props = { place: (id: string) => placed.push(id) } as unknown as DressingKit["props"];
    const kit: DressingKit = {
      def: map,
      builder,
      props,
      style: createStyleKit(builder, props),
      quality: QUALITY[name],
      materials: {} as DressingKit["materials"],
      windTime: { value: 0 },
    };
    const plan = saltpanGantry(kit);
    for (let x = -50; x <= 50; x += 2.5) for (let z = -50; z <= 50; z += 2.5) assert.equal(plan.terrain.height(x, z), 0, `flat at (${x}, ${z})`);
    assert.ok(plan.terrain.height(0, 300) > 0 || plan.terrain.height(300, 0) > 0, "hills beyond the wall");
    tris[name] = builder.triangles();
    for (const x of plan.extras ?? []) x.dispose();
  }
  assert.ok(tris.low <= tris.medium && tris.medium <= tris.high, `detail scales with quality ${JSON.stringify(tris)}`);
  assert.ok(tris.high < 900_000, `static triangles ${tris.high}`);
});
