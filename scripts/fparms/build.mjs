// SUPERSEDED: the shipped arms are now built by art/blender/fparms/build.mjs
// (Blender pipeline), which starts from this script's output, frozen in
// art/blender/fparms/source/rocketbox_arms.glb. Running this script again
// would overwrite the Blender build; keep it to regenerate that source.
//
// Builds public/assets/characters/fparms/* (first-person arms) from the
// Microsoft Rocketbox avatar Military_Male_01 (MIT), reusing the soldier
// conversion (scripts/soldiers/avatar.mjs):
//
//   - both arms (upper arm -> fingertips) cut out of the full-resolution body,
//     skinned to a small skeleton: upper arm, forearm, three forearm twist
//     bones (spread wrist rotation along the forearm, no candy-wrapping),
//     hand, 5 fingers x 3 bones, plus a zero-weight tip joint per finger
//   - smoothed: two PN (curved-triangle) subdivision passes, then simplified
//     back to the triangle budget (detail stays where the curvature is:
//     knuckles, fingers, fabric folds)
//   - textures: the arm rows of the 2048 px body set. Albedo is normalised
//     per region (sleeve / glove) so the runtime tints it with the operator's
//     colours; ORM: R = glove mask, G = roughness (from the specular map).
//
// usage: node scripts/fparms/build.mjs <rocketbox download dir> <out dir> [preview dir]
//   download dir: Military_Male_01.fbx + sm002_body_{color_acu,normal,specular}.tga
//   (Assets/Avatars/Professions/Military_Male_01 in github.com/microsoft/Microsoft-Rocketbox)
// then: npm run assets:ktx2 -- --write   (meshopt + KTX2 copies of the JPEGs)
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { THREE, loadTGA, writePNG } from "../soldiers/lib.mjs";
import { loadAvatar } from "../soldiers/avatar.mjs";

const NM = "/Users/dayton/dev/tgf/node_modules";
const { GLTFExporter } = await import(NM + "/three/examples/jsm/exporters/GLTFExporter.js");
const { MeshoptSimplifier } = await import(NM + "/three/examples/jsm/libs/meshopt_simplifier.module.js");
globalThis.FileReader = class {
  readAsArrayBuffer(b) { b.arrayBuffer().then((r) => { this.result = r; this.onloadend?.({ target: this }); this.onload?.({ target: this }); }); }
};

const [DL, OUT, PREV] = process.argv.slice(2);
if (!DL || !OUT) throw new Error("usage: build.mjs <download dir> <out dir> [preview dir]");
fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "fparms-"));
const TARGET_TRIS = 16000;
const ATLAS_W = 2048, ATLAS_H = 1024;

await MeshoptSimplifier.ready;
const a = loadAvatar(DL, "Military_Male_01.fbx", "sm002");
a.group.updateMatrixWorld(true);
const names = a.bones.map((b) => b.name);
const src = a.mesh.geometry;

// ---- Arm triangles ----------------------------------------------------------
const isArmBone = (n) => /_[LR]_(UpperArm|Forearm|Hand|Finger)/.test(n);
const isHandBone = (n) => /_[LR]_(Hand|Finger)/.test(n);
const SI = src.attributes.skinIndex, SW = src.attributes.skinWeight, UV0 = src.attributes.uv;
const wsum = (v, pred) => { let s = 0; for (let k = 0; k < 4; k++) if (pred(names[SI.getComponent(v, k)])) s += SW.getComponent(v, k); return s; };
// Atlas UV (soldier build) -> body texture UV: the body is the top-left quadrant.
const bodyUV = (v) => [UV0.getX(v) * 2, UV0.getY(v) * 2 - 1];
const idx0 = src.index.array;
const tris = [];
for (let t = 0; t < idx0.length; t += 3) {
  const vs = [idx0[t], idx0[t + 1], idx0[t + 2]];
  if (!vs.every((v) => wsum(v, isArmBone) > 0.5)) continue;
  if (!vs.every((v) => { const [u, w] = bodyUV(v); return u >= 0 && u <= 1 && w >= 0 && w <= 1; })) continue;
  tris.push(vs);
}
console.log("arm triangles (source)", tris.length);

// Compact vertex arrays (old bone indices kept for now).
const remap = new Map();
const V = { p: [], n: [], uv: [], w: [] }; // w: Map(boneIndex -> weight)
for (const tri of tris) for (const v of tri) {
  if (remap.has(v)) continue;
  remap.set(v, V.p.length);
  V.p.push(new THREE.Vector3().fromBufferAttribute(src.attributes.position, v));
  V.n.push(new THREE.Vector3().fromBufferAttribute(src.attributes.normal, v).normalize());
  V.uv.push(bodyUV(v));
  const m = new Map();
  for (let k = 0; k < 4; k++) { const wt = SW.getComponent(v, k); if (wt > 0) m.set(SI.getComponent(v, k), (m.get(SI.getComponent(v, k)) ?? 0) + wt); }
  V.w.push(m);
}
let F = tris.map((t) => t.map((v) => remap.get(v)));

// ---- PN subdivision -----------------------------------------------------------
const key3 = (p) => `${Math.round(p.x * 1e5)},${Math.round(p.y * 1e5)},${Math.round(p.z * 1e5)}`;
function subdivide() {
  // Smooth normals across UV seams so both sides of a seam bulge identically.
  const acc = new Map();
  F.forEach((f) => f.forEach((v) => { const k = key3(V.p[v]); acc.set(k, (acc.get(k) ?? new THREE.Vector3()).add(V.n[v])); }));
  const sn = V.p.map((p) => acc.get(key3(p)).clone().normalize());
  const mid = new Map();
  const edge = (a, b) => {
    const k = a < b ? `${a}_${b}` : `${b}_${a}`;
    let m = mid.get(k);
    if (m !== undefined) return m;
    const P1 = V.p[a], P2 = V.p[b], N1 = sn[a], N2 = sn[b];
    const c = new THREE.Vector3().subVectors(P2, P1);
    const T1 = c.clone().addScaledVector(N1, -c.dot(N1));
    const T2 = c.clone().addScaledVector(N2, -c.dot(N2));
    const p = new THREE.Vector3().addVectors(P1, P2).multiplyScalar(0.5).addScaledVector(T1.sub(T2), 0.125);
    m = V.p.length;
    V.p.push(p);
    V.n.push(new THREE.Vector3().addVectors(V.n[a], V.n[b]).normalize());
    V.uv.push([(V.uv[a][0] + V.uv[b][0]) / 2, (V.uv[a][1] + V.uv[b][1]) / 2]);
    const w = new Map();
    for (const src of [V.w[a], V.w[b]]) for (const [bi, wt] of src) w.set(bi, (w.get(bi) ?? 0) + wt / 2);
    V.w.push(w);
    mid.set(k, m);
    return m;
  };
  const out = [];
  for (const [a0, b0, c0] of F) {
    const ab = edge(a0, b0), bc = edge(b0, c0), ca = edge(c0, a0);
    out.push([a0, ab, ca], [ab, b0, bc], [ca, bc, c0], [ab, bc, ca]);
  }
  F = out;
}
subdivide();
subdivide();
console.log("after subdivision", F.length, "tris", V.p.length, "verts");

// ---- Simplify back to the budget ---------------------------------------------
{
  const pos = new Float32Array(V.p.length * 3);
  V.p.forEach((p, i) => p.toArray(pos, i * 3));
  const attr = new Float32Array(V.p.length * 5);
  V.p.forEach((_, i) => { attr.set([V.n[i].x, V.n[i].y, V.n[i].z, V.uv[i][0], V.uv[i][1]], i * 5); });
  const index = new Uint32Array(F.flat());
  const [res, err] = MeshoptSimplifier.simplifyWithAttributes(index, pos, 3, attr, 5, [0.5, 0.5, 0.5, 2, 2], null, TARGET_TRIS * 3, 0.002, []);
  console.log("simplified", res.length / 3, "tris, error", err);
  F = [];
  for (let i = 0; i < res.length; i += 3) F.push([res[i], res[i + 1], res[i + 2]]);
}
// Drop unused vertices.
{
  const used = new Map();
  const nv = { p: [], n: [], uv: [], w: [] };
  F = F.map((f) => f.map((v) => {
    if (!used.has(v)) { used.set(v, nv.p.length); nv.p.push(V.p[v]); nv.n.push(V.n[v]); nv.uv.push(V.uv[v]); nv.w.push(V.w[v]); }
    return used.get(v);
  }));
  Object.assign(V, nv);
}
// Smooth vertex normals from the new surface (area weighted, welded across UV seams).
{
  const acc = new Map();
  for (const [x, y, z] of F) {
    const n = new THREE.Vector3().subVectors(V.p[y], V.p[x]).cross(new THREE.Vector3().subVectors(V.p[z], V.p[x]));
    for (const v of [x, y, z]) { const k = key3(V.p[v]); acc.set(k, (acc.get(k) ?? new THREE.Vector3()).add(n)); }
  }
  V.n = V.p.map((p) => acc.get(key3(p)).clone().normalize());
}

// ---- Skeleton -------------------------------------------------------------------
const world = (n) => a.bones[names.indexOf(n)].matrixWorld.clone();
const SIDES = ["R", "L"];
const FINGERS = [0, 1, 2, 3, 4];
const chain = (S) => [
  [`Bip01_${S}_UpperArm`, null],
  [`Bip01_${S}_Forearm`, `Bip01_${S}_UpperArm`],
  [`Bip01_${S}_ForeTwist1`, `Bip01_${S}_Forearm`],
  [`Bip01_${S}_ForeTwist2`, `Bip01_${S}_Forearm`],
  [`Bip01_${S}_ForeTwist3`, `Bip01_${S}_Forearm`],
  [`Bip01_${S}_Hand`, `Bip01_${S}_Forearm`],
  ...FINGERS.flatMap((f) => [
    [`Bip01_${S}_Finger${f}`, `Bip01_${S}_Hand`],
    [`Bip01_${S}_Finger${f}1`, `Bip01_${S}_Finger${f}`],
    [`Bip01_${S}_Finger${f}2`, `Bip01_${S}_Finger${f}1`],
    [`Bip01_${S}_Finger${f}Tip`, `Bip01_${S}_Finger${f}2`],
  ]),
];
const root = new THREE.Bone();
root.name = "FPArms_Root";
const bones = [root];
const boneWorld = new Map();
const byName = new Map([[root.name, root]]);
for (const S of SIDES) {
  for (const [n, parent] of chain(S)) {
    let W;
    if (/ForeTwist/.test(n)) W = world(`Bip01_${S}_Forearm`);
    else if (/Tip$/.test(n)) {
      // Fingertip: furthest skinned point along the distal bone's axis.
      const d = n.replace("Tip", "2");
      const di = names.indexOf(d);
      const Wd = world(d);
      const o = new THREE.Vector3().setFromMatrixPosition(Wd);
      const parentPos = new THREE.Vector3().setFromMatrixPosition(world(n.replace("Tip", "1")));
      const axis = o.clone().sub(parentPos).normalize();
      let best = 0;
      V.p.forEach((p, i) => { if ((V.w[i].get(di) ?? 0) > 0.5) best = Math.max(best, p.clone().sub(o).dot(axis)); });
      W = Wd.clone().setPosition(o.clone().addScaledVector(axis, best * 0.92));
    } else W = world(n);
    const b = new THREE.Bone();
    b.name = n;
    boneWorld.set(n, W);
    const parentBone = parent ? byName.get(parent) : root;
    const PW = parent ? boneWorld.get(parent) : new THREE.Matrix4();
    const L = new THREE.Matrix4().copy(PW).invert().multiply(W);
    const s = new THREE.Vector3();
    L.decompose(b.position, b.quaternion, s);
    parentBone.add(b);
    byName.set(n, b);
    bones.push(b);
  }
}
const newIndex = new Map(bones.map((b, i) => [b.name, i]));
const sideOf = (p) => (p.x < 0 ? "R" : "L");
{
  const r = new THREE.Vector3().setFromMatrixPosition(world("Bip01_R_Hand"));
  if (r.x >= 0) throw new Error("expected the right hand on -X");
}

// Weights: arm bones map 1:1, anything else (clavicle, spine) folds into the upper arm;
// forearm weight is split along the forearm over the twist bones.
const skinIndex = new Uint16Array(V.p.length * 4);
const skinWeight = new Float32Array(V.p.length * 4);
V.p.forEach((p, i) => {
  const S = sideOf(p);
  const E = new THREE.Vector3().setFromMatrixPosition(world(`Bip01_${S}_Forearm`));
  const Wr = new THREE.Vector3().setFromMatrixPosition(world(`Bip01_${S}_Hand`));
  const along = THREE.MathUtils.clamp(p.clone().sub(E).dot(Wr.clone().sub(E)) / Wr.distanceToSquared(E), 0, 1);
  const acc = new Map();
  const add = (n, w) => { const k = newIndex.get(n); acc.set(k, (acc.get(k) ?? 0) + w); };
  for (const [bi, wt] of V.w[i]) {
    const n = names[bi];
    if (/Forearm/.test(n)) {
      const levels = [`Bip01_${S}_Forearm`, `Bip01_${S}_ForeTwist1`, `Bip01_${S}_ForeTwist2`, `Bip01_${S}_ForeTwist3`];
      const f = along * 3;
      const k = Math.min(2, Math.floor(f));
      add(levels[k], wt * (1 - (f - k)));
      add(levels[k + 1], wt * (f - k));
    } else if (isArmBone(n)) add(n.replace(/_[LR]_/, `_${n.includes("_L_") ? "L" : "R"}_`), wt);
    else add(`Bip01_${S}_UpperArm`, wt);
  }
  const list = [...acc.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4);
  const tot = list.reduce((s, e) => s + e[1], 0) || 1;
  list.forEach(([b, w], k) => { skinIndex[i * 4 + k] = b; skinWeight[i * 4 + k] = w / tot; });
});

// ---- Texture atlas ------------------------------------------------------------------
// The arms live in the lower half of the body texture: keep those rows.
let v0 = 1, v1 = 0;
for (const uv of V.uv) { v0 = Math.min(v0, uv[1]); v1 = Math.max(v1, uv[1]); }
v0 = Math.max(0, v0 - 0.004); v1 = Math.min(1, v1 + 0.004);
console.log("atlas rows (body v)", v0.toFixed(4), v1.toFixed(4), "->", Math.round((v1 - v0) * 2048), "px tall");
const atlasUV = (uv) => [uv[0], (uv[1] - v0) / (v1 - v0)];

// Islands (UV-connected components) -> sleeve or glove.
const parent = V.p.map((_, i) => i);
const find = (x) => { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; };
for (const [x, y, z] of F) { parent[find(y)] = find(x); parent[find(z)] = find(x); }
const islandHand = new Map();
V.p.forEach((_, i) => {
  const r = find(i);
  const e = islandHand.get(r) ?? [0, 0];
  let h = 0;
  for (const [bi, wt] of V.w[i]) if (isHandBone(names[bi])) h += wt;
  islandHand.set(r, [e[0] + h, e[1] + 1]);
});
const islandV = new Map();
V.p.forEach((_, i) => { const r = find(i); const e = islandV.get(r) ?? [0, 0, 1, 0]; islandV.set(r, [e[0] + V.uv[i][1], e[1] + 1, Math.min(e[2], V.uv[i][1]), Math.max(e[3], V.uv[i][1])]); });
console.log("islands", [...islandHand.entries()].map(([r, [h, c]]) => { const [s, k, lo, hi] = islandV.get(r); return `${c}:h${(h / c).toFixed(2)}:v${(s / k).toFixed(3)}[${lo.toFixed(3)},${hi.toFixed(3)}]`; }).join(" "));
// Gloves are the islands at the bottom of the body texture (the cuffs above them are sleeve).
const glove = V.p.map((_, i) => islandV.get(find(i))[3] < 0.14);

// Rasterise the islands in atlas space: coverage + region.
const region = new Int8Array(ATLAS_W * ATLAS_H).fill(-1);
for (const [x, y, z] of F) {
  const P = [x, y, z].map((v) => { const [u, w] = atlasUV(V.uv[v]); return [u * ATLAS_W, (1 - w) * ATLAS_H]; });
  const g = glove[x] ? 1 : 0;
  const minX = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0])) - 1), maxX = Math.min(ATLAS_W - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0])) + 1);
  const minY = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1])) - 1), maxY = Math.min(ATLAS_H - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])) + 1);
  const area = (P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[1][1] - P[0][1]) * (P[2][0] - P[0][0]);
  if (Math.abs(area) < 1e-12) continue;
  for (let py = minY; py <= maxY; py++) for (let px = minX; px <= maxX; px++) {
    const cx = px + 0.5, cy = py + 0.5;
    const w0 = ((P[1][0] - cx) * (P[2][1] - cy) - (P[1][1] - cy) * (P[2][0] - cx)) / area;
    const w1 = ((P[2][0] - cx) * (P[0][1] - cy) - (P[2][1] - cy) * (P[0][0] - cx)) / area;
    const w2 = 1 - w0 - w1;
    const e = -0.02;
    if (w0 < e || w1 < e || w2 < e) continue;
    region[py * ATLAS_W + px] = g;
  }
}
// Dilate 8 px so mips and filtering never pull in the unused background.
for (let it = 0; it < 8; it++) {
  const prev = region.slice();
  for (let y = 0; y < ATLAS_H; y++) for (let x = 0; x < ATLAS_W; x++) {
    const i = y * ATLAS_W + x;
    if (prev[i] >= 0) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= ATLAS_W || yy >= ATLAS_H) continue;
      if (prev[yy * ATLAS_W + xx] >= 0) { region[i] = prev[yy * ATLAS_W + xx]; break; }
    }
  }
}

/** Bilinear sample of a top-down RGBA image at body UV (u, v). */
const sample = (img, u, v, out) => {
  const fx = u * img.width - 0.5, fy = (1 - v) * img.height - 0.5;
  const x0 = Math.max(0, Math.min(img.width - 1, Math.floor(fx))), y0 = Math.max(0, Math.min(img.height - 1, Math.floor(fy)));
  const x1 = Math.min(img.width - 1, x0 + 1), y1 = Math.min(img.height - 1, y0 + 1);
  const tx = Math.max(0, Math.min(1, fx - x0)), ty = Math.max(0, Math.min(1, fy - y0));
  for (let c = 0; c < 4; c++) {
    const a0 = img.data[(y0 * img.width + x0) * 4 + c], a1 = img.data[(y0 * img.width + x1) * 4 + c];
    const b0 = img.data[(y1 * img.width + x0) * 4 + c], b1 = img.data[(y1 * img.width + x1) * 4 + c];
    out[c] = (a0 * (1 - tx) + a1 * tx) * (1 - ty) + (b0 * (1 - tx) + b1 * tx) * ty;
  }
  return out;
};
const srgb2lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lin2srgb = (l) => { l = Math.max(0, Math.min(1, l)); return Math.round((l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055) * 255); };

const colSrc = loadTGA(`${DL}/sm002_body_color_acu.tga`);
const nrmSrc = loadTGA(`${DL}/sm002_body_normal.tga`);
const spcSrc = loadTGA(`${DL}/sm002_body_specular.tga`);
const bodyAt = (x, y, W, H) => [(x + 0.5) / W, v0 + (1 - (y + 0.5) / H) * (v1 - v0)];

// Mean linear colour per region (for the tint normalisation).
const mean = [[0, 0, 0, 0], [0, 0, 0, 0]];
const px = [0, 0, 0, 0];
for (let y = 0; y < ATLAS_H; y += 2) for (let x = 0; x < ATLAS_W; x += 2) {
  const r = region[y * ATLAS_W + x];
  if (r < 0) continue;
  const [u, v] = bodyAt(x, y, ATLAS_W, ATLAS_H);
  sample(colSrc, u, v, px);
  for (let c = 0; c < 3; c++) mean[r][c] += srgb2lin(px[c]);
  mean[r][3]++;
}
const MID = 0.25; // runtime multiplies by 1 / MID: mean albedo == operator colour
const gain = mean.map((m) => [0, 1, 2].map((c) => MID / (m[c] / m[3])));
console.log("region gains (sleeve, glove)", gain.map((g) => g.map((x) => x.toFixed(2)).join(",")).join(" | "));

const col = new Uint8Array(ATLAS_W * ATLAS_H * 4);
const nrm = new Uint8Array(ATLAS_W * ATLAS_H * 4);
for (let y = 0; y < ATLAS_H; y++) for (let x = 0; x < ATLAS_W; x++) {
  const i = y * ATLAS_W + x, o = i * 4;
  const r = region[i];
  if (r < 0) { col.set([lin2srgb(MID), lin2srgb(MID), lin2srgb(MID), 255], o); nrm.set([128, 128, 255, 255], o); continue; }
  const [u, v] = bodyAt(x, y, ATLAS_W, ATLAS_H);
  sample(colSrc, u, v, px);
  col.set([lin2srgb(srgb2lin(px[0]) * gain[r][0]), lin2srgb(srgb2lin(px[1]) * gain[r][1]), lin2srgb(srgb2lin(px[2]) * gain[r][2]), 255], o);
  sample(nrmSrc, u, v, px);
  nrm.set([Math.round(px[0]), Math.round(px[1]), Math.round(px[2]), 255], o);
}
const OW = ATLAS_W / 2, OH = ATLAS_H / 2;
const orm = new Uint8Array(OW * OH * 4);
for (let y = 0; y < OH; y++) for (let x = 0; x < OW; x++) {
  const o = (y * OW + x) * 4;
  const r = region[(y * 2) * ATLAS_W + x * 2];
  if (r < 0) { orm.set([0, 200, 0, 255], o); continue; }
  const [u, v] = bodyAt(x, y, OW, OH);
  sample(spcSrc, u, v, px);
  const sp = px[0] / 255;
  // Nomex / leather gloves a touch glossier than the cotton-nylon sleeve.
  const rough = THREE.MathUtils.clamp(0.95 - sp * 0.9 - (r === 1 ? 0.08 : 0), 0.35, 0.95);
  orm.set([r === 1 ? 255 : 0, Math.round(rough * 255), 0, 255], o);
}
const jpg = (data, w, h, name, q) => {
  const png = path.join(TMP, name.replace(/\.jpg$/, ".png"));
  writePNG(png, data, w, h);
  execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", String(q), png, "--out", path.join(OUT, name)], { stdio: "ignore" });
};
jpg(col, ATLAS_W, ATLAS_H, "fparms_color.jpg", 86);
jpg(nrm, ATLAS_W, ATLAS_H, "fparms_normal.jpg", 90);
jpg(orm, OW, OH, "fparms_orm.jpg", 90);

// ---- Geometry + export -----------------------------------------------------------------
const n = V.p.length;
const P = new Float32Array(n * 3), N = new Float32Array(n * 3), T = new Float32Array(n * 2);
V.p.forEach((p, i) => { p.toArray(P, i * 3); V.n[i].toArray(N, i * 3); const [u, w] = atlasUV(V.uv[i]); T[i * 2] = u; T[i * 2 + 1] = 1 - w; }); // glTF UVs: v = 0 is the top row
const geo = new THREE.BufferGeometry();
geo.setAttribute("position", new THREE.BufferAttribute(P, 3));
geo.setAttribute("normal", new THREE.BufferAttribute(N, 3));
geo.setAttribute("uv", new THREE.BufferAttribute(T, 2));
geo.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndex, 4));
geo.setAttribute("skinWeight", new THREE.BufferAttribute(skinWeight, 4));
geo.setIndex(new THREE.BufferAttribute(new Uint16Array(F.flat()), 1));
const group = new THREE.Group();
group.name = "fparms";
group.add(root);
group.updateMatrixWorld(true);
const skeleton = new THREE.Skeleton(bones);
skeleton.calculateInverses();
const mat = new THREE.MeshStandardMaterial({ name: "fparms", roughness: 1, metalness: 0 });
const mesh = new THREE.SkinnedMesh(geo, mat);
mesh.name = "arms";
group.add(mesh);
mesh.bind(skeleton, new THREE.Matrix4());
console.log("final", F.length, "tris", n, "verts", bones.length, "bones");

const glb = await new Promise((res, rej) => new GLTFExporter().parse(group, (r) => res(Buffer.from(r)), rej, { binary: true, onlyVisible: false }));
// GLB -> .gltf + .bin with external JPEG textures (what scripts/encode-ktx2.mjs packs).
const jsonLen = glb.readUInt32LE(12);
const json = JSON.parse(glb.subarray(20, 20 + jsonLen).toString("utf8"));
const binStart = 20 + jsonLen;
const binLen = glb.readUInt32LE(binStart);
fs.writeFileSync(path.join(OUT, "fparms.bin"), glb.subarray(binStart + 8, binStart + 8 + binLen));
json.buffers = [{ uri: "fparms.bin", byteLength: binLen }];
json.images = [{ uri: "fparms_color.jpg", mimeType: "image/jpeg" }, { uri: "fparms_normal.jpg", mimeType: "image/jpeg" }, { uri: "fparms_orm.jpg", mimeType: "image/jpeg" }];
json.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }];
json.textures = [0, 1, 2].map((i) => ({ sampler: 0, source: i }));
const m = json.materials[0];
m.pbrMetallicRoughness = { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1, metallicRoughnessTexture: { index: 2 } };
m.normalTexture = { index: 1 };
json.asset.extras = { source: "Microsoft Rocketbox Military_Male_01 (MIT)", tintMid: MID };
fs.writeFileSync(path.join(OUT, "fparms.gltf"), JSON.stringify(json));
fs.rmSync(TMP, { recursive: true, force: true });

if (PREV) {
  fs.mkdirSync(PREV, { recursive: true });
  const { render } = await import("../soldiers/render.mjs");
  // render.mjs samples bottom-up: hand it the atlas flipped.
  const flipped = new Uint8Array(col.length);
  for (let y = 0; y < ATLAS_H; y++) flipped.set(col.subarray(y * ATLAS_W * 4, (y + 1) * ATLAS_W * 4), (ATLAS_H - 1 - y) * ATLAS_W * 4);
  mesh.userData.tex = { data: flipped, width: ATLAS_W, height: ATLAS_H };
  render(path.join(PREV, "fparms_tpose.png"), [mesh], { W: 500, H: 400, center: new THREE.Vector3(-0.45, 1.2, 0), span: 0.7, views: [{ yaw: 0 }, { yaw: Math.PI / 2 }] });
}
