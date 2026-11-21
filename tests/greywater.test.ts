// Headless checks for the Greywater Depot map (Nightjar): bounds and the
// position quantisation window, colliders that don't overlap, the bottom-up
// order the nav grid needs, the two-level command house, and nav paths
// from the insertion through the wire, up to Kerr's office and out to the
// jetty, plus every guard's patrol route.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { CollisionWorld } from "../src/game/world/Collision";
import { NavGrid } from "../src/game/ai/NavGrid";
import { getMap } from "../src/game/world/maps/registry";
import {
  BOUNDS, COMPOUND, EXFIL, FENCE, GREYWATER, HQ, HQ_ZONE, NAV, OFFICE, SEARCHLIGHTS, TOWER, TOWERS, TRUCK_LOOP,
  concealmentAt, roadDistance, searchlightSpot, staticLight, tallGrassAt,
} from "../src/game/world/maps/greywater";
import { GARRISON, NIGHTJAR_MISSION, NIGHTJAR_POINTS, REINFORCEMENTS, SEARCH_POINTS } from "../src/game/missions/stealth/nightjar";

let cached: { nav: NavGrid; world: CollisionWorld } | null = null;
function build() {
  if (cached) return cached;
  const world = new CollisionWorld();
  world.add(new THREE.Box3(new THREE.Vector3(-400, -1, -400), new THREE.Vector3(400, 0, 400)));
  for (const b of GREYWATER.boxes) {
    if (b.decor) continue;
    const y = b.y ?? 0;
    world.add(new THREE.Box3(new THREE.Vector3(b.x - b.w / 2, y, b.z - b.d / 2), new THREE.Vector3(b.x + b.w / 2, y + b.h, b.z + b.d / 2)));
  }
  cached = { nav: new NavGrid(world, NAV.minX, NAV.minZ, NAV.width, NAV.depth), world };
  return cached;
}
const nav = () => build().nav;
const solid = GREYWATER.boxes.filter((b) => !b.decor);
const out = new Float32Array(8192);

const path = (a: { x: number; z: number }, b: { x: number; z: number }) => {
  const n = nav().findPath(a.x, a.z, b.x, b.z, out, 80000);
  return n > 0 && Math.hypot(out[(n - 1) * 2] - b.x, out[(n - 1) * 2 + 1] - b.z) < 1.2 ? n : 0;
};
/** Floor height the nav grid assigns at a point. */
const floor = (x: number, z: number) => {
  const c = nav().index(x, z);
  return nav().walkable[c] ? nav().floor[c] : NaN;
};

test("Greywater: registered, bounded, inside the ±300 m wire window", () => {
  assert.equal(getMap("greywater"), GREYWATER);
  assert.equal(GREYWATER.dressing, "greywater");
  for (const b of solid) {
    if (b.tag === "bound") continue;
    assert.ok(b.x - b.w / 2 >= BOUNDS.x0 - 0.01 && b.x + b.w / 2 <= BOUNDS.x1 + 0.01, `${b.tag} @(${b.x},${b.z}) x`);
    assert.ok(b.z - b.d / 2 >= BOUNDS.z0 - 0.01 && b.z + b.d / 2 <= BOUNDS.z1 + 0.01, `${b.tag} @(${b.x},${b.z}) z`);
    assert.ok((b.y ?? 0) >= 0);
  }
  assert.equal(solid.filter((b) => b.tag === "bound").length, 4);
  assert.ok(NAV.minX <= BOUNDS.x0 && NAV.minX + NAV.width >= BOUNDS.x1);
  assert.ok(NAV.minZ <= BOUNDS.z0 && NAV.minZ + NAV.depth >= BOUNDS.z1);
  // Positions travel as int16 centimetres.
  for (const v of [BOUNDS.x0, BOUNDS.x1, BOUNDS.z0, BOUNDS.z1]) assert.ok(Math.abs(v) + 2 < 327);
});

test("Greywater: solid boxes don't overlap", () => {
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

test("Greywater: boxes are sorted bottom-up", () => {
  let prev = -1;
  for (const b of solid) {
    assert.ok((b.y ?? 0) >= prev);
    prev = b.y ?? 0;
  }
});

test("Greywater: the wire is closed except at its four gaps", () => {
  const n = nav();
  // Walk the fence line just inside/outside: crossing points are only at the gaps.
  const blocked = (x: number, z: number) => !n.walkable[n.index(x, z)];
  for (let x = FENCE.x0 + 1; x < FENCE.x1 - 1; x += 0.5) {
    const inGate = x > FENCE.southGate[0] - 1 && x < FENCE.southGate[1] + 1;
    const inBack = x > FENCE.backGate[0] - 1 && x < FENCE.backGate[1] + 1;
    if (!inGate) assert.ok(blocked(x, FENCE.z1), `south fence closed at x ${x}`);
    if (!inBack) assert.ok(blocked(x, FENCE.z0), `north fence closed at x ${x}`);
  }
  for (let z = FENCE.z0 + 1; z < FENCE.z1 - 1; z += 0.5) {
    const inCut = z > FENCE.westCut[0] - 1 && z < FENCE.westCut[1] + 1;
    const inCollapse = z > FENCE.eastCollapse[0] - 1 && z < FENCE.eastCollapse[1] + 1;
    if (!inCut) assert.ok(blocked(FENCE.x0, z), `west fence closed at z ${z}`);
    if (!inCollapse) assert.ok(blocked(FENCE.x1, z), `east fence closed at z ${z}`);
  }
  // …and each gap is passable.
  assert.ok(path({ x: FENCE.x0 - 3, z: 7.3 }, { x: FENCE.x0 + 3, z: 7.3 }), "west cut");
  assert.ok(path({ x: FENCE.x1 + 3, z: -22 }, { x: FENCE.x1 - 3, z: -22 }), "east collapse");
  assert.ok(path({ x: 0, z: FENCE.z1 + 3 }, { x: 0, z: FENCE.z1 - 3 }), "south gate");
  assert.ok(path({ x: 17, z: FENCE.z0 + 3 }, { x: 17, z: FENCE.z0 - 3 }), "back gate");
});

test("Greywater: the command house has a ground floor and a walkable upper floor", () => {
  const up = HQ.plinth;
  assert.ok(Math.abs(floor(OFFICE.desk.x, OFFICE.desk.z) - up) < 0.01, "office at plinth height");
  assert.ok(Math.abs(floor(-8, -33) - up) < 0.01, "map room upstairs");
  assert.ok(Math.abs(floor(0, -20) - 0) < 0.01, "hall on the ground");
  assert.ok(Math.abs(floor(-9, -24.5)) < 0.01, "radio room on the ground");
  // The hall stair and the back stair both climb to the landing.
  assert.ok(path({ x: 0, z: -19 }, { x: 0, z: -33 }), "hall → landing by the inner stair");
  assert.ok(path({ x: 0, z: -48 }, { x: 0, z: -40 }), "north yard → landing by the back stair");
  assert.ok(path({ x: 0, z: -33 }, OFFICE.desk), "landing → office");
  // The zone that completes objective 2 covers both wings.
  assert.ok(HQ_ZONE.z0 < HQ.rear.z0 + 1 && HQ_ZONE.z1 > HQ.front.z1 - 1);
});

test("Greywater: insertion → wire → command house → office → jetty", () => {
  const P = NIGHTJAR_POINTS;
  const legs: [string, { x: number; z: number }, { x: number; z: number }][] = [
    ["insert → west cut", P.insert, P.westCut],
    ["west cut → inside", P.westCut, P.westCutInside],
    ["inside → side door", P.westCutInside, P.sideDoor],
    ["side door → office", P.sideDoor, P.office],
    ["office → back gate", P.office, P.backGate],
    ["back gate → jetty", P.backGate, P.exfil],
  ];
  for (const [name, a, b] of legs) assert.ok(path(a, b), name);
  // Exfil is on the jetty planks, past the river bank.
  assert.ok(floor(EXFIL.x, EXFIL.z) === 0);
  // Every objective point and checkpoint is reachable from the insertion.
  for (const o of NIGHTJAR_MISSION.objectives) {
    if (o.checkpoint) assert.ok(path(P.insert, o.checkpoint), `${o.title} checkpoint`);
    if ("at" in o) assert.ok(path(P.insert, o.at), `${o.title} point`);
  }
});

test("Greywater: every guard post and patrol leg is walkable; towers stand on their decks", () => {
  for (const g of GARRISON) {
    if (g.anchored) {
      const top = solid.find((b) => b.tag === "tower" && Math.abs(b.x - g.route[0].x) < 0.01 && Math.abs(b.z - g.route[0].z) < 0.01);
      assert.ok(top && Math.abs((top.y ?? 0) + top.h - (g.y ?? -1)) < 0.01, `${g.id} on its tower deck`);
      continue;
    }
    const r = g.route;
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      assert.ok(nav().walkable[nav().index(a.x, a.z)], `${g.id} waypoint ${i} walkable`);
      if (r.length > 1) assert.ok(path(a, b), `${g.id} leg ${i}`);
    }
  }
  for (const p of [...SEARCH_POINTS, ...REINFORCEMENTS.map((r) => r.from)]) assert.ok(nav().walkable[nav().index(p.x, p.z)], `(${p.x}, ${p.z}) walkable`);
  assert.equal(TOWERS.length, SEARCHLIGHTS.length);
  assert.equal(GARRISON.filter((g) => g.target).length, 1);
  assert.ok(TOWER.perch > 4);
});

test("Greywater: the truck loop runs on the perimeter road, outside the wire", () => {
  for (let i = 0; i < TRUCK_LOOP.length; i++) {
    const a = TRUCK_LOOP[i], b = TRUCK_LOOP[(i + 1) % TRUCK_LOOP.length];
    for (let t = 0; t <= 1; t += 0.05) {
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const inside = x > COMPOUND.x0 && x < COMPOUND.x1 && z > COMPOUND.z0 && z < COMPOUND.z1;
      assert.ok(!inside, `truck at (${x}, ${z}) outside the wire`);
      assert.ok(roadDistance(x, z) < 0.01);
      // Nothing solid on the road (the truck itself has no collider).
      assert.ok(nav().walkable[nav().index(x, z)] || Math.abs(x - TRUCK_LOOP[0].x) < 1, `road clear at (${x.toFixed(1)}, ${z.toFixed(1)})`);
    }
  }
});

test("Greywater: light and cover fields", () => {
  // The courtyard floodlight is bright; the reed ditch is dark and dense.
  assert.ok(staticLight(0, 0, 13) > 0.9);
  assert.ok(staticLight(-62, 0, 60) < 0.15);
  assert.ok(tallGrassAt(-62, 64) > 0.7, "reeds in the ditch");
  assert.ok(concealmentAt(-62, 64) > 0.7);
  assert.equal(tallGrassAt(0, 100), 0, "no grass on the road");
  assert.equal(tallGrassAt(0, 10), 0, "no grass in the yard");
  // Upstairs lamps don't light the ground floor and vice versa.
  assert.ok(staticLight(9, HQ.plinth, -38) > staticLight(9, 0, -38) - 0.5);
  // Searchlight pools stay on the map and sweep.
  const s = { x: 0, z: 0 };
  for (const sl of SEARCHLIGHTS) {
    const seen = new Set<string>();
    for (let t = 0; t < sl.period; t += 0.5) {
      searchlightSpot(sl, t, s);
      assert.ok(s.x > BOUNDS.x0 && s.x < BOUNDS.x1 && s.z > BOUNDS.z0 && s.z < BOUNDS.z1, `${sl.tower} spot on the map`);
      seen.add(`${Math.round(s.x / 4)},${Math.round(s.z / 4)}`);
    }
    assert.ok(seen.size > 4, `${sl.tower} sweeps`);
  }
});
