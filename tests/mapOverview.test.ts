// Map overview images rasterised from map data (lobby picker, minimap, full map).
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAPS } from "../src/game/world/maps/registry";
import { classifyBox, overviewBounds, renderOverview, worldToImage } from "../src/game/world/overview/rasterize";
import { overviewFeatures } from "../src/game/world/overview/features";
import type { MapDef } from "../src/game/world/MapLoader";

const px = (img: ReturnType<typeof renderOverview>, x: number, z: number) => {
  const [i, j] = worldToImage(img, x, z).map(Math.floor);
  const o = (j * img.width + i) * 4;
  return [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]];
};
const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

const tiny: MapDef = {
  id: "test-yard", name: "Test Yard", size: 60, groundColor: 0x606050, skyTop: 0, skyHorizon: 0, fogNear: 10, fogFar: 100,
  sunDirection: [0.5, 1, 0.3], spawns: [{ x: 0, z: 0, yaw: 0 }], targets: [], plates: [], signs: [],
  boxes: [
    { x: 10, z: 10, w: 8, h: 6, d: 8, color: 0xcccccc },
    { x: -10, z: -10, w: 2, h: 1, d: 1, color: 0xaa9966 },
    { x: 0, z: -20, w: 1, h: 4, d: 1, color: 0x999999, decor: true },
  ],
};

test("every map renders a fully opaque, sensibly sized overview", () => {
  for (const m of MAPS) {
    const img = renderOverview(m.def, { scale: 2, maxSize: 600 });
    assert.ok(img.width > 50 && img.height > 50 && img.width <= 600 && img.height <= 600, `${m.id} ${img.width}x${img.height}`);
    assert.equal(img.data.length, img.width * img.height * 4);
    for (let o = 3; o < img.data.length; o += 4 * 97) assert.equal(img.data[o], 255, `${m.id} alpha`);
  }
});

test("rendering is deterministic (cacheable)", () => {
  const a = renderOverview(MAPS[0].def, { scale: 2 });
  const b = renderOverview(MAPS[0].def, { scale: 2 });
  assert.deepEqual(a.data, b.data);
});

test("buildings read brighter than the ground; small decor is left out", () => {
  const img = renderOverview(tiny, { scale: 4 });
  const ground = px(img, -20, 20);
  assert.ok(lum(px(img, 10, 10)) > lum(ground) + 40, "the 6 m block stands out");
  assert.ok(lum(px(img, -10, -10)) > lum(ground) + 15, "low cover is visible");
  assert.deepEqual(px(img, 0, -20).slice(0, 3).map((v) => Math.abs(v - ground[2]) < 60), [true, true, true], "decor pole skipped");
  assert.equal(classifyBox(tiny.boxes[2]), "skip");
  assert.equal(classifyBox(tiny.boxes[0]), "building");
  assert.equal(classifyBox(tiny.boxes[1]), "cover");
});

test("buildings cast a shadow away from the sun", () => {
  const img = renderOverview(tiny, { scale: 4 });
  // Sun from +x / +z: the shadow falls to −x / −z of the block.
  const shadow = lum(px(img, 5.2, 5.2));
  const lit = lum(px(img, 14.8, 14.8 + 2));
  assert.ok(shadow < lum(px(img, -20, 20)), `shadow ${shadow.toFixed(0)}`);
  assert.ok(lit >= shadow, "far side unshadowed");
});

test("bounds frame the survival play area and every enemy spawn", () => {
  for (const m of MAPS) {
    const b = overviewBounds(m.def);
    assert.ok(b.maxX > b.minX && b.maxZ > b.minZ);
    const s = m.def.survival;
    if (!s) continue;
    for (const p of s.enemySpawns) assert.ok(p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ, `${m.id} spawn ${p.x},${p.z}`);
    for (const st of s.buyStations) assert.ok(st.x > b.minX && st.x < b.maxX);
  }
});

test("roads are painted from map data", () => {
  const bh = MAPS.find((m) => m.id === "brennhollow")!.def;
  assert.ok(overviewFeatures(bh).roads.length > 5);
  const img = renderOverview(bh, { scale: 3 });
  // A lane east of the square vs. open ground beside it.
  const road = px(img, 30, -0.8), field = px(img, 30, 30);
  assert.ok(Math.abs(lum(road) - lum(field)) > 15, `road ${lum(road).toFixed(0)} vs ${lum(field).toFixed(0)}`);
});

test("scale is clamped so huge maps stay within maxSize", () => {
  const ic = MAPS.find((m) => m.id === "iron-crossing")!.def;
  const img = renderOverview(ic, { scale: 20, maxSize: 512 });
  assert.ok(Math.max(img.width, img.height) <= 512);
});
