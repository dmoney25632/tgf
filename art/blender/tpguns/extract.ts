// Step 1 of the third-person gun build (see build.mjs): takes every real
// first-person long gun in REAL_GUNS, mounts it exactly as the viewmodel does
// (orientation, loose-prop clean-up, magazine split, support hand closed onto
// the real handguard), then moves it into the third-person rifle frame of
// src/game/ai/humanoid/rifle.ts:
//
//   origin at the butt plate centre, +Z toward the muzzle, +Y up, metres
//   (the viewmodel guns are real-world size; fp space is barrel -Z, so this
//   is a 180 degree turn about Y plus a shift: no mirroring).
//
// Writes, per gun, OBJ meshes (body, mag) with the source materials and a
// JSON of texture paths for Blender, plus the anchors the soldiers use: the
// strong-hand grip, the support-hand grip, the magazine grab and well, the
// muzzle (frames are the fp hand-anchor frames, see viewmodel/arms/anchor.ts,
// with the hand pose that wraps the fingers).
//
//   node --experimental-transform-types --no-warnings --import ./tests/register.mjs \
//     art/blender/tpguns/extract.ts <outDir> [kind ...]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GeoBuilder } from "../../../src/game/weapons/viewmodel/geo";
import { createViewmodelMaterials } from "../../../src/game/weapons/viewmodel/materials";
import { GUN_BUILDERS } from "../../../src/game/weapons/viewmodel/guns";
import { REAL_GUNS } from "../../../src/game/weapons/viewmodel/realGuns";
import { prepareRealGun, type RealGun } from "../../../src/game/weapons/viewmodel/realFit";
import { mountRealGun } from "../../../src/game/weapons/viewmodel/realMount";
import { anchorMatrix } from "../../../src/game/weapons/viewmodel/arms/anchor";
import { supportOnHandguard } from "../../../src/game/weapons/viewmodel/common";
import type { ArmPlacement, HandPose } from "../../../src/game/weapons/viewmodel/hands";
import { WEAPONS, type ViewModelKind } from "../../../src/game/weapons/weapons";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../../..");
(globalThis as { ProgressEvent?: unknown }).ProgressEvent ??= class extends Event {
  constructor(type: string, init: object = {}) {
    super(type);
    Object.assign(this, init);
  }
};

type UvX = { offset: number[]; scale: number[]; rotation: number };
type MatInfo = { name: string; baseColor: string | null; mr: string | null; normal: string | null; color: number[]; metallic: number; roughness: number };

/** Loads public/<path> geometry-only; each material keeps its index (userData.tpIndex) and its texture files are returned. */
async function load(path: string) {
  const file = join(ROOT, "public", path);
  const json = JSON.parse(readFileSync(file, "utf8"));
  const dir = dirname(file);
  const img = (info: { index: number } | undefined) => {
    if (!info) return null;
    const src = json.textures?.[info.index]?.source;
    const uri = src === undefined ? null : json.images?.[src]?.uri;
    return uri ? join(dir, decodeURIComponent(uri)) : null;
  };
  const uvx: (UvX | null)[] = [];
  type TexRef = { index: number; extensions?: { KHR_texture_transform?: { offset?: number[]; scale?: number[]; rotation?: number } } };
  type GltfMat = { name?: string; normalTexture?: TexRef; pbrMetallicRoughness?: { baseColorTexture?: TexRef; metallicRoughnessTexture?: TexRef; baseColorFactor?: number[]; metallicFactor?: number; roughnessFactor?: number } & Record<string, unknown> } & Record<string, unknown>;
  const mats: MatInfo[] = (json.materials ?? []).map((m: GltfMat, i: number) => {
    const pbr = m.pbrMetallicRoughness ?? {};
    const tt = pbr.baseColorTexture?.extensions?.KHR_texture_transform;
    uvx[i] = tt ? { offset: tt.offset ?? [0, 0], scale: tt.scale ?? [1, 1], rotation: tt.rotation ?? 0 } : null;
    return {
      name: m.name ?? `m${i}`,
      baseColor: img(pbr.baseColorTexture),
      mr: img(pbr.metallicRoughnessTexture),
      normal: img(m.normalTexture),
      color: pbr.baseColorFactor ?? [1, 1, 1, 1],
      metallic: pbr.metallicFactor ?? 1,
      roughness: pbr.roughnessFactor ?? 1,
    };
  });
  for (const b of json.buffers ?? []) {
    if (b.uri && !b.uri.startsWith("data:")) b.uri = "data:application/octet-stream;base64," + readFileSync(join(dir, decodeURIComponent(b.uri))).toString("base64");
  }
  delete json.images;
  delete json.textures;
  delete json.samplers;
  (json.materials ?? []).forEach((m: GltfMat, i: number) => {
    for (const k of Object.keys(m)) if (k.endsWith("Texture")) delete m[k];
    if (m.pbrMetallicRoughness) for (const k of Object.keys(m.pbrMetallicRoughness)) if (k.endsWith("Texture")) delete m.pbrMetallicRoughness[k];
    delete m.extensions;
    m.extras = { ...(m.extras ?? {}), tpIndex: i };
  });
  await MeshoptDecoder.ready;
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(JSON.stringify(json), "");
  gltf.scene.updateMatrixWorld(true);
  return { scene: gltf.scene, mats, uvx };
}

/** fp gun space -> third-person frame: half turn about Y, then the butt to the origin. */
const HALF = new THREE.Matrix4().makeRotationY(Math.PI);

function writeObj(path: string, meshes: { mesh: THREE.Mesh; m: THREE.Matrix4 }[], uvx: (UvX | null)[]) {
  const out: string[] = ["# tgf third-person gun source (extract.ts)"];
  let base = 1;
  const p = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
  let tris = 0;
  for (const { mesh, m } of meshes) {
    const g = mesh.geometry;
    const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
    const idx = mat(mesh).userData.tpIndex as number | undefined;
    nm.getNormalMatrix(m);
    const tt = idx !== undefined ? uvx[idx] : null;
    out.push(`o part${base}`, `usemtl m${idx ?? 0}`);
    // Only the vertices the faces use (split pieces keep their source's whole vertex buffer).
    const ix = g.index;
    const count = ix ? ix.count : pos.count;
    const remap = new Map<number, number>();
    const at = (k: number) => {
      let r = remap.get(k);
      if (r !== undefined) return r;
      r = remap.size;
      remap.set(k, r);
      p.fromBufferAttribute(pos, k).applyMatrix4(m);
      out.push(`v ${p.x.toFixed(5)} ${p.y.toFixed(5)} ${p.z.toFixed(5)}`);
      if (nor) {
        n.fromBufferAttribute(nor, k).applyMatrix3(nm).normalize();
        out.push(`vn ${n.x.toFixed(4)} ${n.y.toFixed(4)} ${n.z.toFixed(4)}`);
      }
      let u = uv ? uv.getX(k) : 0, v = uv ? uv.getY(k) : 0;
      if (tt) {
        const c = Math.cos(tt.rotation), s = Math.sin(tt.rotation);
        const su = u * tt.scale[0], sv = v * tt.scale[1];
        u = c * su + s * sv + tt.offset[0];
        v = -s * su + c * sv + tt.offset[1];
      }
      out.push(`vt ${u.toFixed(5)} ${(1 - v).toFixed(5)}`);
      return r;
    };
    const flip = m.determinant() < 0;
    for (let t = 0; t < count; t += 3) {
      let a = at(ix ? ix.getX(t) : t), b = at(ix ? ix.getX(t + 1) : t + 1);
      const c = at(ix ? ix.getX(t + 2) : t + 2);
      if (flip) [a, b] = [b, a];
      const f = (k: number) => (nor ? `${k + base}/${k + base}/${k + base}` : `${k + base}/${k + base}`);
      out.push(`f ${f(a)} ${f(b)} ${f(c)}`);
      tris++;
    }
    base += remap.size;
  }
  writeFileSync(path, out.join("\n") + "\n");
  return tris;
}
/** Calls fn for every vertex a mesh's faces use. */
function eachUsed(mesh: THREE.Mesh, m: THREE.Matrix4, fn: (p: THREE.Vector3) => void) {
  const pos = mesh.geometry.attributes.position, ix = mesh.geometry.index;
  const seen = new Set<number>();
  const p = new THREE.Vector3();
  const n = ix ? ix.count : pos.count;
  for (let i = 0; i < n; i++) {
    const k = ix ? ix.getX(i) : i;
    if (seen.has(k)) continue;
    seen.add(k);
    fn(p.fromBufferAttribute(pos, k).applyMatrix4(m));
  }
}
const mat = (m: THREE.Mesh) => (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material;

/** Third-person support-hand override (tp z from the butt, m): where a standing soldier holds it rather than the fp hold. */
const SUPPORT_AT: Partial<Record<ViewModelKind, number>> = {
  // fp: the sniper's squeeze under the stock; standing, the hand goes under the shroud ahead of the magazine.
  m82: 0.66,
};

type Anchor = { m: number[]; pose: HandPose; side: "L" | "R" };

async function extract(kind: ViewModelKind, cfg: RealGun, outDir: string) {
  const mats = createViewmodelMaterials();
  const b = new GeoBuilder(mats.render);
  b.armsOnly = true;
  const spec = GUN_BUILDERS[kind]({ b, m: mats });
  b.finish([]);
  const src = await load(cfg.path);
  const t = prepareRealGun(src.scene, cfg);
  const fit = mountRealGun(spec, b, t, cfg, mats, []);
  const root = spec.root;
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const toRoot = (o: THREE.Object3D) => new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);

  // Collect meshes in fp gun space.
  const collect = (g: THREE.Object3D) => {
    const list: { mesh: THREE.Mesh; m: THREE.Matrix4 }[] = [];
    g.updateMatrixWorld(true);
    g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.visible) list.push({ mesh, m: toRoot(mesh) });
    });
    return list;
  };
  const body = collect(fit.object);
  for (const [k, g] of fit.parts) if (k !== "mag") body.push(...collect(g));
  const magMeshes = fit.parts.get("mag") ? collect(fit.parts.get("mag")!) : [];

  // Butt: rear-most vertices (fp +Z), centred on the bore line in X.
  const pts: THREE.Vector3[] = [];
  for (const { mesh, m } of body) eachUsed(mesh, m, (p) => pts.push(p.clone()));
  const box = new THREE.Box3().setFromPoints(pts);
  const rear = pts.filter((p) => p.z > box.max.z - 0.02);
  const ry = rear.reduce((s, p) => s + p.y, 0) / Math.max(1, rear.length);
  const rLo = Math.min(...rear.map((p) => p.y)), rHi = Math.max(...rear.map((p) => p.y));
  const buttY = (ry + (rLo + rHi) / 2) / 2;
  // tp = HALF * (fp - butt)
  const T = HALF.clone().multiply(new THREE.Matrix4().makeTranslation(0, -buttY, -box.max.z));
  const tp = (list: { mesh: THREE.Mesh; m: THREE.Matrix4 }[]) => list.map((x) => ({ mesh: x.mesh, m: T.clone().multiply(x.m) }));

  mkdirSync(outDir, { recursive: true });
  const bodyTris = writeObj(join(outDir, "body.obj"), tp(body), src.uvx);
  const magTris = magMeshes.length ? writeObj(join(outDir, "mag.obj"), tp(magMeshes), src.uvx) : 0;
  writeFileSync(join(outDir, "materials.json"), JSON.stringify(src.mats, null, 1));

  // Hand anchors (fp anchor frames, moved to the tp frame).
  const P = (m: THREE.Matrix4) => new THREE.Vector3().setFromMatrixPosition(m).toArray().map((x) => +x.toFixed(5));
  const anchor = (target: THREE.Object3D, p: ArmPlacement, pose: HandPose, extra = new THREE.Matrix4()): Anchor => {
    const m = T.clone().multiply(toRoot(target)).multiply(extra).multiply(anchorMatrix(p));
    const out: HandPose = { ...pose };
    if (pose.thumbDir) {
      // Gun-space thumb direction -> anchor-local (rig.ts solveHand takes it against an identity placement).
      const local = new THREE.Vector3(...pose.thumbDir).transformDirection(toRoot(target).multiply(anchorMatrix(p)).invert());
      out.thumbDir = local.toArray().map((x) => +x.toFixed(4)) as [number, number, number];
    }
    return { m: m.elements.map((x) => +x.toFixed(5)), pose: out, side: p.left ? "L" : "R" };
  };
  const strong = b.arms.find((a) => !a.p.left && (a.target === root || a.target === spec.rightArm));
  let support = fit.hand ? { target: spec.leftArm, p: fit.hand[0], pose: fit.hand[1] } : b.arms.find((a) => a.p.left && a.target === spec.leftArm);
  const moveTo = SUPPORT_AT[kind];
  if (moveTo !== undefined) {
    // Standing hold: palm up under the handguard at tp z = moveTo (fp z = rear - moveTo), around the bore line.
    const z = box.max.z - moveTo;
    const bore = spec.muzzle.position.y;
    let lo = bore;
    for (const p of pts) if (Math.abs(p.z - z) < 0.02 && Math.abs(p.x) < 0.06 && p.y < lo) lo = p.y;
    const r = Math.max(0.015, (bore - lo) / 2);
    const [pl, pose] = supportOnHandguard([0, lo + r, z], r, [0.1, -0.3, 0.25]);
    support = { target: root, p: { ...pl, left: true }, pose };
  }
  const grab = b.arms.find((a) => a.p.left && a.target === spec.leftGrab);
  if (!strong || !support) throw new Error(`${kind}: no hand anchors`);
  const muzzle = T.clone().multiply(new THREE.Matrix4().makeTranslation(spec.muzzle.position.x, spec.muzzle.position.y, spec.muzzle.position.z));
  // Magazine: well point = top centre of its bounds (tp frame); the grab is stored relative to it.
  let mag: { well: number[]; grab: Anchor | null; tris: number } | null = null;
  if (magMeshes.length) {
    const mb = new THREE.Box3();
    for (const { mesh, m } of tp(magMeshes)) eachUsed(mesh, m, (p) => mb.expandByPoint(p));
    const well = new THREE.Vector3((mb.min.x + mb.max.x) / 2, mb.max.y, (mb.min.z + mb.max.z) / 2);
    mag = { well: well.toArray().map((x) => +x.toFixed(5)), grab: grab ? anchor(grab.target, grab.p, grab.pose) : null, tris: magTris };
  }
  const tb = new THREE.Box3().setFromPoints(pts.map((p) => p.clone().applyMatrix4(T)));
  return {
    kind,
    reload: spec.reload,
    length: +(tb.max.z - tb.min.z).toFixed(4),
    bounds: [tb.min.toArray(), tb.max.toArray()].map((a) => a.map((x) => +x.toFixed(4))),
    srcTris: bodyTris + magTris,
    muzzle: P(muzzle),
    gripR: anchor(strong.target, strong.p, strong.pose),
    gripL: anchor(support.target, support.p, support.pose),
    mag,
  };
}

const [outDir, ...only] = process.argv.slice(2);
if (!outDir) {
  console.error("usage: extract.ts <outDir> [kind ...]");
  process.exit(1);
}
// One third-person model per real file: long guns only (pistols have no third-person hold yet).
// Prefer the kind a weapon actually uses as its model (mp5 over mp5sd).
const used = new Set(Object.values(WEAPONS).map((w) => w.model));
const seen = new Map<string, ViewModelKind>();
for (const [kind, cfg] of Object.entries(REAL_GUNS) as [ViewModelKind, RealGun][]) {
  if (only.length && !only.includes(kind)) continue;
  if (!existsSync(join(ROOT, "public", cfg.path))) continue;
  const prev = seen.get(cfg.path);
  if (prev && (!used.has(kind) || used.has(prev))) continue;
  seen.set(cfg.path, kind);
}
const index: Record<string, unknown> = {};
// Kinds that share a model file (mp5sd -> mp5, mk23 -> m1911) use the same third-person gun.
const alias: Record<string, string> = {};
for (const [kind, cfg] of Object.entries(REAL_GUNS) as [ViewModelKind, RealGun][]) {
  const main = seen.get(cfg.path);
  if (main && main !== kind) alias[kind] = main;
}
for (const kind of seen.values()) {
  const mats = createViewmodelMaterials();
  const probe = GUN_BUILDERS[kind]({ b: Object.assign(new GeoBuilder(mats.render), { armsOnly: true }), m: mats });
  if (probe.handgun) continue;
  try {
    const info = await extract(kind, REAL_GUNS[kind]!, join(outDir, kind));
    index[kind] = info;
    console.log(`${kind}: ${info.srcTris} tris, ${info.length} m, mag ${info.mag ? "yes" : "no"}, reload ${info.reload}`);
  } catch (e) {
    console.error(`${kind}: FAILED ${(e as Error).message}`);
  }
}
// Kinds that share a model (mp5sd -> mp5, mk23 -> m1911) resolve at runtime through REAL_GUNS paths.
for (const [k, v] of Object.entries(alias)) if (!index[v]) delete alias[k];
writeFileSync(join(outDir, "index.json"), JSON.stringify({ guns: index, alias }, null, 1));
