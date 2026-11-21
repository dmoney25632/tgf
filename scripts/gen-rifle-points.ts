// Bakes the landing page's particle rifle from the game's own M4A1
// viewmodel (no hands, no optics glow): samples points over its surface and
// writes them to public/assets/landing/rifle-points.bin.
//
//   node --experimental-transform-types --no-warnings --import ./tests/register.mjs scripts/gen-rifle-points.ts
//
// Format (little-endian), one 10-byte record per point:
//   int16 x, y, z   position, normalised to [-1, 1] on the rifle's longest axis
//   int8  nx, ny, nz  surface normal * 127
//   uint8 shade     surface albedo luminance (0..255)
import { mkdirSync, writeFileSync } from "node:fs";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { MeshSurfaceSampler } from "three/addons/math/MeshSurfaceSampler.js";
import { GeoBuilder } from "../src/game/weapons/viewmodel/geo";
import { GUN_BUILDERS } from "../src/game/weapons/viewmodel/guns";
import { createViewmodelMaterials, type Surf } from "../src/game/weapons/viewmodel/materials";

const COUNT = 32000;
const OUT = "public/assets/landing/rifle-points.bin";

const mats = createViewmodelMaterials();
const skip = new Set<Surf>([mats.glove, mats.gloveAccent, mats.gloveSeam, mats.sleeve, mats.sleeveDark, mats.watchCase, mats.watchFace]);

/** Same builder, but drops the arms/hands and the emissive reticles. */
class GunOnly extends GeoBuilder {
  override add(s: Surf, geo: THREE.BufferGeometry, m?: THREE.Matrix4) {
    if (skip.has(s) || s.tint >= 0 || s.render === "glow") {
      geo.dispose();
      return this;
    }
    return super.add(s, geo, m);
  }
}

const b = new GunOnly(mats.render);
const spec = GUN_BUILDERS.m4a1({ b, m: mats });
b.finish([]);
spec.root.updateMatrixWorld(true);

const parts: THREE.BufferGeometry[] = [];
spec.root.traverse((o) => {
  const mesh = o as THREE.Mesh;
  if (!mesh.isMesh || (mesh.material as THREE.Material) === mats.render.glow) return;
  const g = new THREE.BufferGeometry();
  const src = mesh.geometry;
  g.setAttribute("position", src.attributes.position.clone());
  g.setAttribute("normal", src.attributes.normal.clone());
  g.setAttribute("color", src.attributes.color.clone());
  g.applyMatrix4(mesh.matrixWorld);
  parts.push(g);
});
const merged = mergeGeometries(parts, false);
if (!merged) throw new Error("merge failed");
merged.computeBoundingBox();
const box = merged.boundingBox!;
const center = box.getCenter(new THREE.Vector3());
const size = box.getSize(new THREE.Vector3());
const scale = 2 / Math.max(size.x, size.y, size.z);

const sampler = new MeshSurfaceSampler(new THREE.Mesh(merged)).build();
const buf = Buffer.alloc(COUNT * 10);
const p = new THREE.Vector3();
const n = new THREE.Vector3();
const c = new THREE.Color();
for (let i = 0; i < COUNT; i++) {
  sampler.sample(p, n, c);
  p.sub(center).multiplyScalar(scale);
  const o = i * 10;
  buf.writeInt16LE(Math.round(p.x * 32767), o);
  buf.writeInt16LE(Math.round(p.y * 32767), o + 2);
  buf.writeInt16LE(Math.round(p.z * 32767), o + 4);
  buf.writeInt8(Math.round(n.x * 127), o + 6);
  buf.writeInt8(Math.round(n.y * 127), o + 7);
  buf.writeInt8(Math.round(n.z * 127), o + 8);
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  buf.writeUInt8(Math.min(255, Math.round(Math.sqrt(lum) * 255)), o + 9);
}
mkdirSync("public/assets/landing", { recursive: true });
writeFileSync(OUT, buf);
console.log(`wrote ${COUNT} points (${(buf.length / 1024).toFixed(0)} KB) to ${OUT}; size ${size.toArray().map((v) => v.toFixed(3)).join(" x ")} m`);
