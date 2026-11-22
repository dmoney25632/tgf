#!/usr/bin/env node
// LOD1 simplifier for build_tp.py (simplified_copy): meshoptimizer on one
// welded gun body, for the meshes Blender's COLLAPSE decimate stalls on.
//
//   node art/blender/tpguns/simplify.mjs <io.json>
//
// io.json in: { pos: [x,y,z...], idx: [triangle vertex indices...], target }.
// Out, in place: { idx, error } -- a subset of the same vertices (meshopt
// never moves one), so build_tp.py can give every corner a low-poly UV.
//
// Positions only (no attribute seams to pin vertices: build_tp.py textures
// each kept triangle from one atlas island afterwards). Prune drops small
// components under the error bound. The bound (relative to the mesh extent)
// starts at 1% and is relaxed only while the result is still more than 25%
// over the target (detail first: a few extra triangles beat a lost muzzle or
// sight); the last attempt is kept whatever it reaches.
import { readFileSync, writeFileSync } from "node:fs";
import { MeshoptSimplifier } from "meshoptimizer";

const file = process.argv[2];
const m = JSON.parse(readFileSync(file, "utf8"));
await MeshoptSimplifier.ready;
const idx = new Uint32Array(m.idx);
const pos = new Float32Array(m.pos);
let out, error;
for (const bound of [0.01, 0.02, 0.04]) {
  [out, error] = MeshoptSimplifier.simplify(idx, pos, 3, m.target * 3, bound, ["Prune"]);
  if (out.length / 3 <= m.target * 1.25) break;
}
writeFileSync(file, JSON.stringify({ idx: Array.from(out), error }));
