// Headless checks for the Iron Crossing mission map: bounds, colliders that
// don't overlap, the stacked deck / catwalk levels the nav grid can climb,
// and paths from the insertion to every section of the mission.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { CollisionWorld } from "../src/game/world/Collision";
import { NavGrid } from "../src/game/ai/NavGrid";
import { BOOTH, BOUNDS, BRIDGE, BUNKER_CHARGE, IRON_CROSSING, LZ, NAV, YARD, AMMO } from "../src/game/world/maps/ironCrossing";

let cached: NavGrid | null = null;
function nav() {
  if (cached) return cached;
  const world = new CollisionWorld();
  world.add(new THREE.Box3(new THREE.Vector3(-400, -1, -400), new THREE.Vector3(400, 0, 400)));
  for (const b of IRON_CROSSING.boxes) {
    if (b.decor) continue;
    const y = b.y ?? 0;
    world.add(new THREE.Box3(new THREE.Vector3(b.x - b.w / 2, y, b.z - b.d / 2), new THREE.Vector3(b.x + b.w / 2, y + b.h, b.z + b.d / 2)));
  }
  cached = new NavGrid(world, NAV.minX, NAV.minZ, NAV.width, NAV.depth);
  return cached;
}

const solid = IRON_CROSSING.boxes.filter((b) => !b.decor);
const out = new Float32Array(8192);
const start = IRON_CROSSING.spawns[0];

const reach = (x: number, z: number) => {
  const n = nav().findPath(start.x, start.z, x, z, out, 60000);
  return n > 0 && Math.hypot(out[(n - 1) * 2] - x, out[(n - 1) * 2 + 1] - z) < 2;
};

test("Iron Crossing: map is bounded and the nav window covers it", () => {
  for (const b of solid) {
    if (b.tag === "bound") continue;
    assert.ok(b.x - b.w / 2 >= BOUNDS.x0 - 0.01 && b.x + b.w / 2 <= BOUNDS.x1 + 0.01, `${b.tag} @(${b.x},${b.z}) inside x bounds`);
    assert.ok(b.z - b.d / 2 >= BOUNDS.z0 - 0.01 && b.z + b.d / 2 <= BOUNDS.z1 + 0.01, `${b.tag} @(${b.x},${b.z}) inside z bounds`);
    assert.ok((b.y ?? 0) >= 0);
  }
  assert.equal(solid.filter((b) => b.tag === "bound").length, 4);
  assert.ok(NAV.minX <= BOUNDS.x0 && NAV.minX + NAV.width >= BOUNDS.x1);
  assert.ok(NAV.minZ <= BOUNDS.z0 && NAV.minZ + NAV.depth >= BOUNDS.z1);
  assert.deepEqual(IRON_CROSSING.nav, NAV);
});

test("Iron Crossing: solid boxes don't overlap", () => {
  const bad: string[] = [];
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i], b = solid[j];
      const ay = a.y ?? 0, by = b.y ?? 0;
      const ox = Math.abs(a.x - b.x) < (a.w + b.w) / 2 - 0.02;
      const oz = Math.abs(a.z - b.z) < (a.d + b.d) / 2 - 0.02;
      const oy = ay < by + b.h - 0.02 && by < ay + a.h - 0.02;
      if (ox && oz && oy) bad.push(`${a.tag ?? a.style} @(${a.x.toFixed(2)},${a.z.toFixed(2)},${ay}) × ${b.tag ?? b.style} @(${b.x.toFixed(2)},${b.z.toFixed(2)},${by})`);
    }
  }
  assert.deepEqual(bad, []);
});

test("Iron Crossing: boxes are sorted bottom-up (stacks climb in order)", () => {
  let prev = -1;
  for (const b of solid) {
    assert.ok((b.y ?? 0) >= prev);
    prev = b.y ?? 0;
  }
});

test("Iron Crossing: the deck is walkable at deck height, the catwalks at the girders' foot", () => {
  const n = nav();
  for (let z = BRIDGE.north + 1; z < BRIDGE.south; z += 3) {
    const deck = n.index(-7.8, z);
    if (z > -33 && z < -27) continue; // crater
    if (n.walkable[deck]) assert.ok(Math.abs(n.floor[deck] - BRIDGE.deck) < 0.01, `deck floor at z ${z}`);
    for (const x of [-9.3, 9.3]) {
      const c = n.index(x, z);
      assert.equal(n.walkable[c], 1, `catwalk (${x}, ${z}) walkable`);
      const onCap = BRIDGE.piers.some((p) => Math.abs(z - p) < 6.5);
      if (!onCap) assert.ok(n.floor[c] < 0.01, `catwalk (${x}, ${z}) at y 0`);
    }
  }
});

test("Iron Crossing: every section is reachable from the insertion", () => {
  const goals: [number, number, string][] = [
    [0, 104, "town square"],
    [-1.5, 72, "checkpoint booth road"],
    [BOOTH.x, BOOTH.z, "inside the booth"],
    [-3, 40, "deck, first span"],
    [2.6, 0, "rail lane beside the train"],
    [-3, -45, "deck, north span"],
    [0, -66, "north ramp"],
    [BUNKER_CHARGE.x, BUNKER_CHARGE.z, "bunker charge point"],
    [-12, -76, "inside the bunker"],
    [YARD.x, YARD.z, "customs yard"],
    [LZ.x, LZ.z, "LZ"],
    ...AMMO.map((a) => [a.x + 1.3, a.z, "ammo crate"] as [number, number, string]),
  ];
  const bad = goals.filter(([x, z]) => !reach(x, z)).map(([x, z, w]) => `${w} (${x}, ${z})`);
  assert.deepEqual(bad, []);
});

test("Iron Crossing: each catwalk is a continuous flanking route across the gorge", () => {
  const n = nav();
  for (const x of [-9.3, 9.3]) {
    const c = n.findPath(x, BRIDGE.south - 1, x, BRIDGE.north + 1, out, 60000);
    assert.ok(c > 0, `catwalk ${x} connects`);
    // The route stays on the catwalk side (never needs the deck).
    for (let i = 0; i < c; i++) assert.ok(Math.abs(out[i * 2]) > BRIDGE.core, `waypoint ${i} at x ${out[i * 2].toFixed(1)} stays on the catwalk`);
  }
});

test("Iron Crossing: pier caps connect catwalk and deck", () => {
  const n = nav();
  for (const pz of BRIDGE.piers) {
    for (const s of [-1, 1]) {
      const c = n.findPath(s * 9.3, pz + 8, -3 * s, pz, out, 20000);
      assert.ok(c > 0, `pier ${pz} side ${s}`);
      const top = n.index(s * 9.3, pz);
      assert.ok(Math.abs(n.floor[top] - BRIDGE.deck) < 0.01, "cap top is level with the deck");
    }
  }
});
