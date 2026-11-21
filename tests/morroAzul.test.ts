// Headless checks for the Morro Azul favela: bounds, paths from every enemy
// spawn, reachable stations / crates / interiors, climbable stairs on every
// floor, no overlapping colliders.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { MORRO_AZUL, LOTS, HALF, stairOf, doorsOf, facadePoint, WALL_T } from "../src/game/world/maps/morroAzul";
import { CollisionWorld } from "../src/game/world/Collision";
import { NavGrid } from "../src/game/ai/NavGrid";

const map = MORRO_AZUL;
const solid = map.boxes.filter((b) => !b.decor);
const out = new Float32Array(16384);

function nav() {
  const world = new CollisionWorld();
  world.add(new THREE.Box3(new THREE.Vector3(-200, -1, -200), new THREE.Vector3(200, 0, 200)));
  for (const b of solid) {
    const y = b.y ?? 0;
    world.add(new THREE.Box3(new THREE.Vector3(b.x - b.w / 2, y, b.z - b.d / 2), new THREE.Vector3(b.x + b.w / 2, y + b.h, b.z + b.d / 2)));
  }
  const h = map.size / 2;
  return new NavGrid(world, -h, -h, map.size, map.size);
}
const NAV = nav();

test("Morro Azul: much bigger than the other maps, bounded and flat", () => {
  assert.ok(map.size >= 170);
  for (const b of solid) {
    if (b.tag === "bound") continue;
    assert.ok(Math.abs(b.x) + b.w / 2 <= HALF + 0.01 && Math.abs(b.z) + b.d / 2 <= HALF + 0.01, `${b.tag} @(${b.x},${b.z}) inside ±${HALF}`);
    assert.ok((b.y ?? 0) >= 0);
  }
  const bounds = solid.filter((b) => b.tag === "bound");
  assert.equal(bounds.length, 4);
  for (const b of bounds) assert.ok(b.h >= 6);
  assert.ok(LOTS.length >= 120, `dense housing (${LOTS.length} lots)`);
  assert.ok(LOTS.filter((l) => l.enter).length >= 8, "enterable houses");
  assert.ok(LOTS.some((l) => l.floors >= 4), "tall stacks");
});

test("Morro Azul: every enemy spawn paths to the plaza", () => {
  const g = map.spawns[0];
  assert.ok(NAV.isWalkable(g.x, g.z), "player spawn walkable");
  for (const s of map.survival!.enemySpawns) {
    assert.ok(NAV.isWalkable(s.x, s.z), `spawn (${s.x}, ${s.z}) walkable`);
    const n = NAV.findPath(s.x, s.z, g.x, g.z, out);
    assert.ok(n > 0, `no path from (${s.x}, ${s.z})`);
  }
});

test("Morro Azul: stations, crates and house interiors are reachable", () => {
  const g = map.spawns[0];
  const layout = map.survival!;
  const near = (x: number, z: number) => [[1.3, 0], [-1.3, 0], [0, 1.1], [0, -1.1]].some(([dx, dz]) => NAV.findPath(g.x, g.z, x + dx, z + dz, out) > 0);
  for (const st of layout.buyStations) {
    assert.ok(solid.some((b) => b.tag === "station" && b.x === st.x && b.z === st.z));
    assert.ok(near(st.x, st.z), `${st.name} reachable`);
  }
  for (const c of layout.ammoCrates) {
    assert.ok(solid.some((b) => b.tag === "ammo" && b.x === c.x && b.z === c.z));
    assert.ok(near(c.x, c.z), `crate (${c.x}, ${c.z}) reachable`);
  }
  for (const l of LOTS.filter((k) => k.enter)) {
    // Just inside the front door.
    const d = doorsOf(l)[0];
    const [dx, dz] = facadePoint(l, d.side, d.u);
    const nx = d.side === 1 ? -1 : d.side === 3 ? 1 : 0, nz = d.side === 0 ? 1 : d.side === 2 ? -1 : 0;
    const ix = dx + nx * (WALL_T + 0.9), iz = dz + nz * (WALL_T + 0.9);
    assert.ok(NAV.isWalkable(ix, iz), `${l.id} interior walkable at (${ix.toFixed(1)}, ${iz.toFixed(1)})`);
    assert.ok(NAV.findPath(g.x, g.z, ix, iz, out) > 0, `${l.id} interior reachable`);
  }
});

test("Morro Azul: stairs climb every floor in steps the player can take", () => {
  const world = new CollisionWorld();
  for (const b of solid) {
    const y = b.y ?? 0;
    world.add(new THREE.Box3(new THREE.Vector3(b.x - b.w / 2, y, b.z - b.d / 2), new THREE.Vector3(b.x + b.w / 2, y + b.h, b.z + b.d / 2)));
  }
  for (const l of LOTS.filter((k) => k.enter)) {
    const st = stairOf(l);
    assert.ok(st.rise <= 0.4, "rise");
    for (let f = 0; f < l.floors; f++) {
      const lane = f % 2;
      const c = st.lanes[lane];
      const base = f * l.fh;
      // Walk the lane in climb order: each step at most one rise above the last, with headroom above.
      let prev = base;
      for (let i = 0; i < st.steps; i++) {
        const p = lane === 0 ? st.a + (i + 0.5) * 0.38 : st.b - (i + 0.5) * 0.38;
        const [x, z] = st.axis === "x" ? [p, c] : [c, p];
        const y = world.floorAt(x, z, prev + 0.45);
        assert.ok(y - prev <= 0.41 && y >= prev - 1e-6, `${l.id} floor ${f} step ${i}: ${prev} → ${y}`);
        assert.equal(world.raycast(x, y + 0.05, z, 0, 1, 0, 1.85), Infinity, `${l.id} floor ${f} step ${i}: headroom`);
        prev = y;
      }
      assert.ok(Math.abs(prev - (f + 1) * l.fh) < 1e-6, `${l.id} flight ${f} reaches the next level`);
      // Step off the top onto the slab.
      const off = lane === 0 ? st.b + 0.4 : st.a - 0.4;
      const [x, z] = st.axis === "x" ? [off, c] : [c, off];
      assert.ok(Math.abs(world.floorAt(x, z, prev + 0.1) - prev) < 1e-6, `${l.id} landing at level ${f + 1}`);
    }
  }
});

test("Morro Azul: solid boxes don't overlap", () => {
  // Sweep on x to keep this fast with a thousand-plus boxes.
  const list = solid.map((b) => ({ b, x0: b.x - b.w / 2, x1: b.x + b.w / 2 })).sort((p, q) => p.x0 - q.x0);
  for (let i = 0; i < list.length; i++) {
    const a = list[i].b;
    for (let j = i + 1; j < list.length && list[j].x0 < list[i].x1 - 0.02; j++) {
      const b = list[j].b;
      const ay = a.y ?? 0, by = b.y ?? 0;
      const oz = Math.abs(a.z - b.z) < (a.d + b.d) / 2 - 0.02;
      const oy = ay < by + b.h - 0.02 && by < ay + a.h - 0.02;
      assert.ok(!(oz && oy), `overlap: ${a.tag ?? a.style} @(${a.x.toFixed(2)},${ay.toFixed(2)},${a.z.toFixed(2)}) / ${b.tag ?? b.style} @(${b.x.toFixed(2)},${by.toFixed(2)},${b.z.toFixed(2)})`);
    }
  }
});

test("Morro Azul: perches stand on a roof", () => {
  const perches = map.survival!.perches;
  assert.ok(perches.length >= 4);
  for (const p of perches) {
    assert.ok(solid.some((b) => Math.abs(b.x - p.x) < b.w / 2 && Math.abs(b.z - p.z) < b.d / 2 && Math.abs((b.y ?? 0) + b.h - p.y) < 0.05), `perch (${p.x}, ${p.y}, ${p.z})`);
  }
});
