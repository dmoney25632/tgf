// Not a test (no .test.ts suffix): dumps a crop of Brennhollow (merged box geometry, layers and kit
// placements) for the Blender sample-building render (art/blender/archkit/render_sample.py).
//   node --experimental-transform-types --import ./tests/register.mjs tests/archkitDump.ts <out.json> x0 x1 z0 z1
import { writeFileSync } from "node:fs";
import * as THREE from "three";
import { QUALITY } from "../src/game/config";
import { MeshBuilder } from "../src/game/world/MeshBuilder";
import { createStyleKit } from "../src/game/world/BoxStyles";
import { DRESSINGS } from "../src/game/world/dressing/index";
import type { DressingKit } from "../src/game/world/dressing/common";
import { MAPS } from "../src/game/world/maps/registry";
import type { ArchKitLayer } from "../src/game/world/architecture/archkit";

const [out, ...b] = process.argv.slice(2);
const [x0, x1, z0, z1] = b.map(Number);
const g = globalThis as unknown as { document?: unknown };
const ctx: unknown = new Proxy({}, { get: (_t, k) => (k === "getImageData" || k === "createImageData" ? (_x: number, _y: number, w = 1, h = 1) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }) : k === "createLinearGradient" || k === "createRadialGradient" || k === "createPattern" ? () => ({ addColorStop() {} }) : () => ({ width: 10 })), set: () => true });
g.document ??= { createElement: () => ({ width: 1, height: 1, style: {}, getContext: () => ctx }) };
const entry = MAPS.find((m) => m.id === "brennhollow")!;
const builder = new MeshBuilder();
const props = { place: () => {} } as unknown as DressingKit["props"];
const mat = () => new THREE.MeshStandardMaterial();
const kit: DressingKit = { def: entry.def, builder, props, style: createStyleKit(builder, props), quality: QUALITY.high, materials: { get: mat, lib: { get: mat } } as unknown as DressingKit["materials"], windTime: { value: 0 } };
const plan = DRESSINGS[entry.def.dressing!](kit);
const meshes: { name: string; pos: number[]; col: number[] }[] = [];
const inside = (x: number, z: number) => x > x0 && x < x1 && z > z0 && z < z1;
const take = (name: string, m: THREE.Mesh) => {
  const p = m.geometry.attributes.position, c = m.geometry.attributes.color;
  const pos: number[] = [], col: number[] = [];
  for (let i = 0; i < p.count; i += 3) {
    const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
    if (!inside(cx, cz)) continue;
    for (let k = 0; k < 3; k++) {
      pos.push(p.getX(i + k), p.getY(i + k), p.getZ(i + k));
      col.push(c ? c.getX(i + k) : 1, c ? c.getY(i + k) : 1, c ? c.getZ(i + k) : 1);
    }
  }
  if (pos.length) meshes.push({ name, pos, col });
};
for (const [, list] of builder.build(mat)) for (const m of list) if (!m.name.startsWith("proxy:") && !m.name.startsWith("far")) take(m.name, m);
for (const x of plan.extras ?? []) if (x.object.name.startsWith("bh-layer:")) x.object.traverse((o) => (o as THREE.Mesh).isMesh && take(`${x.object.name}|${o.name}`, o as THREE.Mesh));
const K = (plan.extras ?? []).find((x) => x.object.name === "archkit")?.object.userData.archkit as ArchKitLayer;
const placements = K.placements.filter((p) => inside(p.c.x, p.c.z)).map((p) => ({ piece: p.piece, m: p.m.elements, tint: [p.tint.r, p.tint.g, p.tint.b] }));
writeFileSync(out, JSON.stringify({ meshes, placements }));
console.log(`${meshes.length} meshes, ${placements.length} placements`);
for (const x of plan.extras ?? []) x.dispose();
