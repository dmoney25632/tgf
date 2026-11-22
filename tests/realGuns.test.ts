// Real (photo-textured) first-person guns: every REAL_GUNS entry loads, is
// oriented barrel-forward and upright, fits the built gun, and its moving
// pieces come off where the config says.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GeoBuilder } from "../src/game/weapons/viewmodel/geo";
import { createViewmodelMaterials, type Surf } from "../src/game/weapons/viewmodel/materials";
import { GUN_BUILDERS } from "../src/game/weapons/viewmodel/guns";
import { REAL_GUNS } from "../src/game/weapons/viewmodel/realGuns";
import { piecesOf, prepareRealGun, type RealGun } from "../src/game/weapons/viewmodel/realFit";
import { mountRealGun } from "../src/game/weapons/viewmodel/realMount";
import type { ViewModelKind } from "../src/game/weapons/weapons";
import { loadGltfGeometry, overlap, silhouette, vertices } from "./realGunsHelpers";

const mats = createViewmodelMaterials();
const arms = new Set<Surf>([mats.glove, mats.gloveAccent, mats.gloveSeam, mats.sleeve, mats.sleeveDark, mats.watchCase, mats.watchFace]);
const scenes = new Map<string, Promise<THREE.Group>>();
const load = (path: string) => {
  let p = scenes.get(path);
  if (!p) scenes.set(path, (p = loadGltfGeometry(process.cwd(), path)));
  return p;
};

/** The built gun (support arms hidden), gun space. */
function builtGun(kind: ViewModelKind) {
  const b = new GeoBuilder(mats.render);
  b.isArm = (s) => arms.has(s);
  const spec = GUN_BUILDERS[kind]({ b, m: mats });
  b.finish([]);
  for (const a of [spec.leftArm, spec.leftGrab, spec.rightArm]) if (a) a.visible = false;
  return vertices(spec.root);
}

async function mount(kind: ViewModelKind, cfg: RealGun) {
  const b = new GeoBuilder(mats.render);
  b.isArm = (s) => arms.has(s);
  b.armsOnly = true;
  const spec = GUN_BUILDERS[kind]({ b, m: mats });
  b.finish([]);
  const t = prepareRealGun(await load(cfg.path), cfg);
  const fit = mountRealGun(spec, b, t, cfg, mats, []);
  const pts = vertices(fit.object);
  for (const g of fit.parts.values()) vertices(g, pts, spec.root);
  return { spec, t, fit, pts };
}

const fscore = (a: Set<string>, b: Set<string>) => 2 / (1 / overlap(a, b) + 1 / overlap(b, a));

for (const [kind, cfg] of Object.entries(REAL_GUNS) as [ViewModelKind, RealGun][]) {
  test(`real ${kind}: loads, faces forward, upright, fits the built gun`, async () => {
    const { spec, fit, pts } = await mount(kind, cfg);
    assert.ok(pts.length > 300, "has geometry");
    const box = new THREE.Box3().setFromPoints(pts);
    const size = box.getSize(new THREE.Vector3());
    // Length along the bore, narrow across it.
    assert.ok(size.z > size.y && size.y > size.x, `axes: ${size.toArray().map((v) => v.toFixed(3))}`);
    assert.ok(size.x < 0.13, `width ${size.x.toFixed(3)}`);
    // Its muzzle is the front: the real model's nose sits at the (bare) muzzle anchor.
    const muzzle = spec.boreMuzzle ?? spec.muzzle.position;
    assert.ok(Math.abs(box.min.z - muzzle.z) < 0.03, `nose ${box.min.z.toFixed(3)} vs muzzle ${muzzle.z.toFixed(3)}`);
    // Upright: grip, stock and magazine hang below the bore in the rear half.
    const midZ = (box.min.z + box.max.z) / 2;
    const rear = pts.filter((p) => p.z > midZ);
    const below = muzzle.y - Math.min(...rear.map((p) => p.y));
    const above = Math.max(...rear.map((p) => p.y)) - muzzle.y;
    assert.ok(below > above, `rear half: ${(below * 1000).toFixed(0)} mm below the bore vs ${(above * 1000).toFixed(0)} mm above`);
    // Side silhouette matches the built gun better than the reversed model.
    const S = silhouette(builtGun(kind));
    const c = box.getCenter(new THREE.Vector3());
    const asIs = fscore(silhouette(pts), S);
    const reversed = fscore(silhouette(pts.map((p) => new THREE.Vector3(p.x, p.y, 2 * c.z - p.z))), S);
    assert.ok(asIs > reversed, `silhouette ${asIs.toFixed(3)} vs reversed ${reversed.toFixed(3)}`);
    // Configured moving parts came off, small next to the gun.
    for (const key of Object.keys(cfg.parts ?? {}) as ("mag" | "pump" | "bolt")[]) {
      const part = fit.parts.get(key);
      assert.ok(part, `${key} split off`);
      const n = vertices(part).length;
      assert.ok(n > 20 && n < pts.length * 0.4, `${key}: ${n} of ${pts.length}`);
    }
    // A support hand closed onto the real handguard grips a sane radius.
    if (fit.hand) assert.ok(fit.hand[1].r >= 0.011 && fit.hand[1].r <= 0.04, `hand r ${fit.hand[1].r}`);
  });
}

test("piecesOf welds seams and reports pieces inside a box", () => {
  // Two separate boxes; the left one is split along a UV seam (unwelded duplicates).
  const a = new THREE.BoxGeometry(1, 1, 1).translate(-2, 0, 0);
  const b = new THREE.BoxGeometry(1, 1, 1).translate(2, 0, 0);
  const geo = mergeGeometries([a, b])!;
  const mesh = new THREE.Mesh(geo);
  mesh.updateMatrixWorld(true);
  const pieces = piecesOf(mesh, new THREE.Box3(new THREE.Vector3(1, -1, -1), new THREE.Vector3(3, 1, 1)));
  assert.equal(pieces.length, 2, "BoxGeometry faces weld into one piece per box");
  const inside = pieces.filter((p) => p.inside === p.count);
  assert.equal(inside.length, 1);
  assert.ok(inside[0].box.min.x > 1);
});
