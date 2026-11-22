// End-to-end CPU side of the light bake: a roofed hut built with MeshBuilder
// under a bake capture (occluders recorded, faces subdivided), then
// MapLighting bakes it in time slices and writes the vertex attributes.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { MeshBuilder, beginBakeCapture, endBakeCapture } from "../src/game/world/MeshBuilder";
import { MapLighting } from "../src/game/world/lighting/MapLighting";
import { BAKED_UNIFORMS } from "../src/game/render/BakedLighting";
import { bakeDetail } from "../src/game/world/quality";
import { QUALITY } from "../src/game/config";
import { FlashLightPool } from "../src/game/render/FlashLights";

function hut() {
  const capture = beginBakeCapture(2);
  const b = new MeshBuilder();
  // Floor slab, three walls, a wall with a door gap, roof.
  b.boxFeet("concrete", 0, 0, 0, 8, 0.1, 8, 0xffffff, { group: "solid" });
  b.boxFeet("concrete", 0, 0.1, -4, 8, 3, 0.3, 0xffffff, { group: "solid" });
  b.boxFeet("concrete", -4, 0.1, 0, 0.3, 3, 8, 0xffffff, { group: "solid" });
  b.boxFeet("concrete", 4, 0.1, 0, 0.3, 3, 8, 0xffffff, { group: "solid" });
  b.boxFeet("concrete", -2.5, 0.1, 4, 3, 3, 0.3, 0xffffff, { group: "solid" });
  b.boxFeet("concrete", 2.5, 0.1, 4, 3, 3, 0.3, 0xffffff, { group: "solid" });
  b.boxFeet("concrete", 0, 3.1, 0, 8.6, 0.3, 8.6, 0xffffff, { group: "solid" });
  // Yard slab outside.
  b.boxFeet("asphalt", 0, 0, 14, 20, 0.05, 10, 0x808080, { group: "solid" });
  // A thin batten: not an occluder.
  b.box("wood", 0, 1, 9, 2, 0.05, 0.05, 0xffffff, { group: "decor" });
  const groups = b.build(() => new THREE.MeshStandardMaterial({ vertexColors: true }));
  endBakeCapture();
  const root = new THREE.Group();
  for (const list of groups.values()) for (const m of list) root.add(m);
  root.updateMatrixWorld(true);
  return { capture, root, groups };
}

test("bake capture records box occluders and subdivides big faces", () => {
  const { capture, groups } = hut();
  assert.equal(capture.boxes.length, 8, "the thin batten is skipped");
  const floor = capture.boxes[0];
  assert.ok(Math.abs(floor.hx - 4) < 1e-6 && Math.abs(floor.cy - 0.05) < 1e-6);
  const solid = groups.get("solid")!.reduce((n, m) => n + m.geometry.attributes.position.count / 3, 0);
  assert.ok(solid > 8 * 12 * 3, `subdivided: ${solid} triangles`);
  // No capture: plain 12-triangle boxes.
  const b = new MeshBuilder();
  b.boxFeet("concrete", 0, 0, 0, 8, 3, 8, 0xffffff, { group: "solid" });
  assert.equal(b.triangles(), 12);
});

async function waitFor(cond: () => boolean, ms = 5000) {
  const t0 = performance.now();
  while (!cond()) {
    if (performance.now() - t0 > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
}

test("MapLighting bakes the hut in slices: dark inside, bright outside", async () => {
  const { capture, root } = hut();
  const sun = new THREE.Vector3(0.3, 0.8, 0.5).normalize();
  const detail = { ...bakeDetail(QUALITY.medium)!, sliceMs: 2 };
  const gi = new MapLighting({
    id: "test-hut",
    root,
    boxes: capture.boxes,
    ground: () => 0,
    groundColor: 0x8a7a60,
    hemiSky: new THREE.Color(0xcfdcec),
    hemiGround: new THREE.Color(0x6e604a),
    sun,
    detail,
  });
  assert.ok(gi.vertexCount > 0);
  gi.setQuality(QUALITY.low, 0);
  assert.ok(BAKED_UNIFORMS.ihSunFade.value.y < 0, "no shadow maps: baked sun everywhere");
  gi.setQuality(QUALITY.high, 130);
  assert.ok(Math.abs(BAKED_UNIFORMS.ihSunFade.value.y - 130) < 1e-6);
  gi.start();
  await waitFor(() => gi.lastBakeRays > 0);
  // Fade-in runs on update().
  for (let i = 0; i < 40; i++) {
    gi.update();
    await new Promise((r) => setTimeout(r, 30));
  }
  assert.ok(BAKED_UNIFORMS.ihGiParams.value.x > 0.99, `strength ${BAKED_UNIFORMS.ihGiParams.value.x}`);

  // Sample the floor's top (y = 0.1) inside vs the yard's top outside.
  const skyAt = (pred: (x: number, y: number, z: number, ny: number) => boolean) => {
    let sum = 0, n = 0;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const P = m.geometry.attributes.position, N = m.geometry.attributes.normal, G = m.geometry.attributes.ihGi as THREE.BufferAttribute;
      for (let i = 0; i < P.count; i++) {
        if (!pred(P.getX(i), P.getY(i), P.getZ(i), N.getY(i))) continue;
        sum += G.getW(i);
        n++;
      }
    });
    assert.ok(n > 0);
    return sum / n;
  };
  const inside = skyAt((x, y, z, ny) => ny > 0.9 && Math.abs(y - 0.1) < 1e-3 && Math.abs(x) < 2.5 && z < 0 && z > -3);
  const outside = skyAt((x, y, z, ny) => ny > 0.9 && Math.abs(y - 0.05) < 1e-3 && z > 12);
  assert.ok(inside < 0.25, `inside sky ${inside}`);
  assert.ok(outside > 0.85, `outside sky ${outside}`);

  // Same map, same sun: a second instance hits the cache synchronously.
  const again = hut();
  const gi2 = new MapLighting({ id: "test-hut", root: again.root, boxes: again.capture.boxes, ground: () => 0, groundColor: 0x8a7a60, hemiSky: new THREE.Color(0xcfdcec), hemiGround: new THREE.Color(0x6e604a), sun, detail });
  gi2.start();
  let changed = false;
  again.root.traverse((o) => {
    const g = (o as THREE.Mesh).geometry?.attributes?.ihGi as THREE.BufferAttribute | undefined;
    if (g && g.version > 0) changed = true;
  });
  assert.ok(changed, "cached bake applied at once");
  gi.dispose();
  gi2.dispose();
  assert.equal(BAKED_UNIFORMS.ihGiParams.value.x, 0);
});

test("flash-light pool keeps a fixed light count and decays", () => {
  const scene = new THREE.Scene();
  const pool = new FlashLightPool(scene, 2);
  assert.equal(pool.lights.length, 2);
  assert.ok(pool.flash(0, 1, 0, 0xffa850, 10, 50));
  assert.ok(pool.flash(1, 1, 0, 0xffa850, 90, 300));
  // A weak flash may not steal the fresh explosion's light, but takes the muzzle one.
  assert.ok(pool.flash(2, 1, 0, 0xffa850, 10, 50));
  assert.ok(pool.lights.some((l) => l.intensity === 90));
  pool.update(performance.now() + 1000);
  assert.ok(pool.lights.every((l) => l.intensity === 0));
  let n = 0;
  scene.traverse((o) => {
    if ((o as THREE.PointLight).isPointLight) n++;
  });
  assert.equal(n, 2);
  pool.dispose();
});
