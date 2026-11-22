// Light bake maths: the box tracer against brute force, and the per-vertex
// bake (sky visibility, one sun bounce, sun occlusion) on simple scenes: a
// roofed room, an open yard, a wall casting a shadow.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BoxTracer, GROUND, type OccluderBox, type TraceHit } from "../src/game/world/lighting/BoxTracer";
import { LightBaker, hemisphereSet, type BakeEnvironment, type BakeSettings } from "../src/game/world/lighting/LightBaker";

const box = (x: number, y: number, z: number, w: number, h: number, d: number, albedo = 0.5, axes?: number[]): OccluderBox => ({
  cx: x, cy: y + h / 2, cz: z, hx: w / 2, hy: h / 2, hz: d / 2, r: albedo, g: albedo, b: albedo, axes,
});
const hit = (): TraceHit => ({ t: 0, nx: 0, ny: 0, nz: 0, r: 0, g: 0, b: 0, box: -1 });

/** Deterministic PRNG. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

test("tracer: axis-aligned hit distance, normal and albedo", () => {
  const t = new BoxTracer([box(10, 0, 0, 2, 4, 2, 0.4)], null);
  const h = hit();
  assert.ok(t.trace(0, 1, 0, 1, 0, 0, 100, h));
  assert.ok(Math.abs(h.t - 9) < 1e-5);
  assert.deepEqual([h.nx + 0, h.ny + 0, h.nz + 0], [-1, 0, 0]);
  assert.ok(Math.abs(h.r - 0.4) < 1e-6);
  assert.equal(t.trace(0, 5, 0, 1, 0, 0, 100, h), false, "passes over the top");
  assert.equal(t.trace(0, 1, 0, 1, 0, 0, 8.5, h), false, "beyond tMax");
  assert.ok(t.occluded(0, 1, 0, 1, 0, 0, 100));
  assert.equal(t.occluded(0, 1, 0, -1, 0, 0, 100), false);
});

test("tracer: rotated box (OBB) uses its own faces", () => {
  // 45° about Y: local x axis = (c, 0, -s), z = (s, 0, c).
  const c = Math.SQRT1_2;
  const axes = [c, 0, -c, 0, 1, 0, c, 0, c];
  const t = new BoxTracer([box(0, 0, 0, 2, 2, 2, 0.5, axes)], null);
  const h = hit();
  assert.ok(t.trace(-5, 1, 0, 1, 0, 0, 100, h));
  // Corner points at -x: hits at distance 5 - sqrt(2).
  assert.ok(Math.abs(h.t - (5 - Math.SQRT2)) < 1e-4, `t=${h.t}`);
  assert.ok(h.nx < -0.6 && Math.abs(h.ny) < 1e-6);
});

test("tracer: ground height field and grid traversal match brute force", () => {
  const r = rng(7);
  const boxes: OccluderBox[] = [];
  for (let i = 0; i < 300; i++) boxes.push(box(r() * 120 - 60, r() * 3, r() * 120 - 60, 0.3 + r() * 6, 0.3 + r() * 8, 0.3 + r() * 6));
  boxes.push(box(0, -0.2, 0, 400, 0.2, 400)); // big slab: always-tested list
  const tracer = new BoxTracer(boxes, (x, z) => 0.05 * Math.sin(x * 0.1) + 0.01 * z * 0);
  const solo = boxes.map((b) => new BoxTracer([b], null));
  const h = hit(), h2 = hit();
  for (let k = 0; k < 400; k++) {
    const ox = r() * 100 - 50, oy = 0.5 + r() * 6, oz = r() * 100 - 50;
    let dx = r() * 2 - 1, dy = r() * 2 - 1, dz = r() * 2 - 1;
    const l = Math.hypot(dx, dy, dz);
    dx /= l; dy /= l; dz /= l;
    let best = Infinity;
    for (const s of solo) if (s.trace(ox, oy, oz, dx, dy, dz, 60, h2, false) && h2.t < best) best = h2.t;
    const got = tracer.trace(ox, oy, oz, dx, dy, dz, 60, h, false) ? h.t : Infinity;
    assert.ok(Math.abs(got - best) < 1e-4 || got === best, `ray ${k}: ${got} vs ${best}`);
    assert.equal(tracer.occluded(ox, oy, oz, dx, dy, dz, 60), best < 60);
  }
  // Ground: straight down from 3 m.
  const g = new BoxTracer([], (x) => 0.5 + x * 0);
  assert.ok(g.trace(0, 3, 0, 0, -1, 0, 10, h));
  assert.equal(h.box, GROUND);
  assert.ok(Math.abs(h.t - 2.5) < 0.02);
});

test("hemisphere set is cosine weighted", () => {
  const d = hemisphereSet(256);
  let z = 0;
  for (let i = 0; i < 256; i++) {
    const l = Math.hypot(d[i * 3], d[i * 3 + 1], d[i * 3 + 2]);
    assert.ok(Math.abs(l - 1) < 1e-5);
    z += d[i * 3 + 2];
  }
  // E[cos] under a cosine-weighted pdf = 2/3.
  assert.ok(Math.abs(z / 256 - 2 / 3) < 0.01, `${z / 256}`);
});

const SETTINGS: BakeSettings = { skyRays: 32, sunRays: 3, bounce: true, rayLength: 16, budget: 1e9, minRays: 4 };
const sunDir = (() => {
  const v = [0.5, 0.75, 0.3];
  const l = Math.hypot(...v);
  return v.map((x) => x / l) as [number, number, number];
})();
const ENV: BakeEnvironment = { sun: sunDir, groundWeight: 0.35, groundBounce: 0.5, sunSpread: 0.03 };

/** A 6×6 m room: four 3 m walls (a 1.2 m doorway in the south wall) under a roof. */
function room(): OccluderBox[] {
  return [
    box(0, 0, -3, 6.3, 3, 0.3), // north
    box(-3, 0, 0, 0.3, 3, 6.3), // west
    box(3, 0, 0, 0.3, 3, 6.3), // east
    box(-1.95, 0, 3, 2.4, 3, 0.3), // south, left of the door
    box(1.95, 0, 3, 2.4, 3, 0.3), // south, right of the door
    box(0, 2.2, 3, 1.5, 0.8, 0.3), // lintel
    box(0, 3, 0, 6.6, 0.25, 6.6), // roof
  ];
}

function bakePoints(boxes: OccluderBox[], pts: number[][], settings = SETTINGS) {
  const tracer = new BoxTracer(boxes, () => 0, [0.3, 0.26, 0.2]);
  const positions = pts.flatMap((p) => p.slice(0, 3));
  const normals = pts.flatMap((p) => p.slice(3, 6));
  const baker = new LightBaker(tracer, [{ positions, normals, dedupe: false }], settings, ENV);
  const [res] = baker.bakeSync();
  return pts.map((_, i) => ({
    sky: res.gi[i * 4 + 3] / 255,
    bounce: [0, 1, 2].map((k) => (res.gi[i * 4 + k] / 255) ** 2),
    sunOcc: res.sun[i] / 255,
    rays: baker.rays,
  }));
}

test("bake: an open yard sees the sky and sun; a roofed room is dark", () => {
  const [open, inside, nearDoor] = bakePoints(room(), [
    [20, 0, 20, 0, 1, 0],
    [0, 0, -1.5, 0, 1, 0],
    [0, 0, 2.6, 0, 1, 0],
  ]);
  assert.ok(open.sky > 0.99, `open sky ${open.sky}`);
  assert.equal(open.sunOcc, 0);
  assert.ok(inside.sky < 0.15, `room floor sky ${inside.sky}`);
  assert.equal(inside.sunOcc, 1, "roof blocks the sun");
  assert.ok(nearDoor.sky > inside.sky, "the doorway lets some sky in");
});

test("bake: a wall shadows the ground behind it; a shaded wall gets bounce", () => {
  // Long wall along x at z = 0 (sun is toward +z, up): north side shaded.
  const wall = [box(0, 0, 0, 30, 4, 0.4, 0.5)];
  const [shadowed, lit, northFace, southFace] = bakePoints(wall, [
    [0, 0, -1.5, 0, 1, 0],
    [0, 0, 6, 0, 1, 0],
    [0, 1, -0.21, 0, 0, -1],
    [0, 1, 0.21, 0, 0, 1],
  ]);
  assert.equal(shadowed.sunOcc, 1);
  assert.equal(lit.sunOcc, 0);
  assert.ok(shadowed.sky < lit.sky, "half the sky is behind the wall");
  // Facing away from the sun: no direct light, but the sunlit ground (beyond
  // the wall's shadow) bounces into it. The sunlit face sees bright ground too.
  assert.ok(northFace.bounce[0] > 0.01, `north face bounce ${northFace.bounce}`);
  assert.ok(southFace.bounce[0] > northFace.bounce[0], "the sunlit side has more lit ground in front of it");
  // Inside a closed box: no sky, no bounce.
  const closed = [box(0, 0, 0, 4, 0.2, 4), box(0, 3, 0, 4, 0.2, 4), box(-2, 0, 0, 0.2, 3.2, 4), box(2, 0, 0, 0.2, 3.2, 4), box(0, 0, -2, 4, 3.2, 0.2), box(0, 0, 2, 4, 3.2, 0.2)];
  const [sealed] = bakePoints(closed, [[0, 0.2, 0, 0, 1, 0]]);
  assert.ok(sealed.sky < 0.01 && sealed.bounce[0] < 0.005, JSON.stringify(sealed));
});

test("bake: buried vertices are pushed out, budget caps rays", () => {
  // A terrain vertex under a wall's foot gets the value just beside the wall, not black.
  const [buried] = bakePoints([box(0, 0, 0, 10, 3, 0.4)], [[0, 0, 0.05, 0, 1, 0]]);
  assert.ok(buried.sky > 0.3, `${buried.sky}`);
  const pts = Array.from({ length: 100 }, (_, i) => [i * 0.5, 0, 0.5, 0, 0, 1]);
  const capped = bakePoints(room(), pts, { ...SETTINGS, budget: 100 * 8, skyRays: 64 });
  assert.ok(capped[0].rays <= 100 * (8 + 3) * 1.2, `rays ${capped[0].rays}`);
});

test("bake throughput (informational)", () => {
  const r = rng(3);
  const boxes: OccluderBox[] = [];
  for (let i = 0; i < 2500; i++) boxes.push(box(r() * 200 - 100, r() < 0.2 ? 3 : 0, r() * 200 - 100, 0.4 + r() * 8, 0.4 + r() * 6, 0.4 + r() * 8));
  const tracer = new BoxTracer(boxes, () => 0);
  const n = 20000;
  const positions: number[] = [], normals: number[] = [];
  for (let i = 0; i < n; i++) {
    positions.push(r() * 200 - 100, r() * 3, r() * 200 - 100);
    const k = Math.floor(r() * 5);
    normals.push(...[[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]][k]);
  }
  const baker = new LightBaker(tracer, [{ positions, normals, dedupe: false }], { ...SETTINGS, skyRays: 12, sunRays: 2 }, ENV);
  const t0 = performance.now();
  baker.bakeSync();
  const ms = performance.now() - t0;
  console.log(`# bake: ${n} vertices, ${baker.rays} rays in ${ms.toFixed(0)} ms (${((baker.rays / ms) * 1000 / 1e6).toFixed(2)} M rays/s)`);
  assert.ok(baker.rays > 0);
});
