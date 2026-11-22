// Rocketbox avatar -> clean, metre-scaled, atlased skinned soldier (in memory).
import { THREE, loadFBX, loadTGA } from "./lib.mjs";
const { mergeVertices } = await import("/Users/dayton/dev/tgf/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js");

export const SCALE = 0.0096; // cm -> m, and 1.84 m (helmet top) -> 1.77 m like the procedural rig
const MAT = { body: 0, head: 1, helmet: 2, equipment: 3 };
// Atlas quadrants (image space, top-left origin): [qx, qy]
export const QUAD = { body: [0, 0], head: [1, 0], helmet: [0, 1], equipment: [1, 1] };

const keepBone = (n) => /^Bip01(_Pelvis|_Spine\d?|_Neck|_Head|_[LR]_(Clavicle|UpperArm|Forearm|Hand|Finger\d+|Thigh|Calf|Foot|Toe0))?$/.test(n);

export function loadAvatar(dir, fbxName, prefix) {
  const root = loadFBX(`${dir}/${fbxName}`);
  root.updateMatrixWorld(true);
  let mesh = null;
  root.traverse((o) => { if (o.isSkinnedMesh) mesh = o; });
  const mats = [].concat(mesh.material).map((m) => m.name.replace(prefix + "_", ""));
  const src = mesh.skeleton.bones;

  // Bind pose == current pose?
  const g = mesh.geometry;
  const v = new THREE.Vector3(), raw = new THREE.Vector3();
  let maxErr = 0;
  for (let i = 0; i < g.attributes.position.count; i += 37) {
    mesh.getVertexPosition(i, v);
    raw.fromBufferAttribute(g.attributes.position, i);
    maxErr = Math.max(maxErr, v.distanceTo(raw));
  }
  if (maxErr > 0.05) console.warn("bind pose differs from current pose by", maxErr);
  if (!mesh.matrixWorld.equals(new THREE.Matrix4()) || !mesh.bindMatrix.equals(new THREE.Matrix4())) console.warn("non-identity mesh/bind matrix");

  // New bone tree (kept bones only).
  const bones = [];
  const map = new Map(); // src bone -> new index
  const mk = (s, parent) => {
    let b = parent;
    if (s.isBone && keepBone(s.name)) {
      b = new THREE.Bone();
      b.name = s.name;
      b.position.copy(s.position).multiplyScalar(SCALE);
      b.quaternion.copy(s.quaternion);
      if (parent) parent.add(b);
      map.set(s, bones.length);
      bones.push(b);
    }
    for (const c of s.children) if (c.isBone) mk(c, b);
  };
  let rootBone = null;
  root.traverse((o) => { if (o.isBone && o.name === "Bip01" && !rootBone) rootBone = o; });
  console.log("mw", mesh.matrixWorld.elements.map((x) => +x.toFixed(3)).join(","), "bind", mesh.bindMatrix.elements.map((x) => +x.toFixed(3)).join(","));
  mk(rootBone, null);
  // Bip01's parent in the FBX is the identity group; its local transform is its world transform.
  rootBone.updateWorldMatrix(true, false);
  rootBone.matrixWorld.decompose(bones[0].position, bones[0].quaternion, v);
  bones[0].position.multiplyScalar(SCALE);
  // Unkept bones (face, eyes, footsteps) inherit their nearest kept ancestor.
  const remap = src.map((b) => {
    let p = b;
    while (p && !map.has(p)) p = p.parent;
    return p ? map.get(p) : 0;
  });

  // Geometry: drop the knife, atlas the UVs, remap skin indices.
  const keepTri = [], idx = g.index ? g.index.array : null;
  const uvQuad = new Int8Array(g.attributes.position.count).fill(-1);
  for (const grp of g.groups) {
    const name = mats[grp.materialIndex];
    if (!(name in MAT)) continue;
    for (let i = grp.start; i < grp.start + grp.count; i++) {
      const vi = idx ? idx[i] : i;
      keepTri.push(vi);
      uvQuad[vi] = MAT[name];
    }
  }
  const used = new Map();
  const order = [];
  for (const vi of keepTri) if (!used.has(vi)) { used.set(vi, order.length); order.push(vi); }
  const n = order.length;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), UV = new Float32Array(n * 2), SI = new Uint16Array(n * 4), SW = new Float32Array(n * 4);
  const names = Object.keys(MAT);
  const nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  order.forEach((vi, i) => {
    raw.fromBufferAttribute(g.attributes.position, vi).applyMatrix4(mesh.matrixWorld).multiplyScalar(SCALE);
    P[i * 3] = raw.x; P[i * 3 + 1] = raw.y; P[i * 3 + 2] = raw.z;
    raw.fromBufferAttribute(g.attributes.normal, vi).applyNormalMatrix(nm).normalize();
    N[i * 3] = raw.x; N[i * 3 + 1] = raw.y; N[i * 3 + 2] = raw.z;
    const [qx, qy] = QUAD[names[uvQuad[vi]]];
    const u = THREE.MathUtils.clamp(g.attributes.uv.getX(vi), 0.001, 0.999), w = THREE.MathUtils.clamp(g.attributes.uv.getY(vi), 0.001, 0.999);
    UV[i * 2] = (u + qx) / 2;
    UV[i * 2 + 1] = (w + (1 - qy)) / 2;
    // Merge weights that now land on the same bone, keep the top 4.
    const acc = new Map();
    for (let k = 0; k < 4; k++) {
      const wt = g.attributes.skinWeight.getComponent(vi, k);
      if (wt <= 0) continue;
      const b = remap[g.attributes.skinIndex.getComponent(vi, k)];
      acc.set(b, (acc.get(b) ?? 0) + wt);
    }
    const list = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const tot = list.reduce((s, e) => s + e[1], 0) || 1;
    list.forEach(([b, wt], k) => { SI[i * 4 + k] = b; SW[i * 4 + k] = wt / tot; });
    if (!list.length) SW[i * 4] = 1;
  });
  const index = new Uint32Array(keepTri.map((vi) => used.get(vi)));
  let geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(P, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(N, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(UV, 2));
  geo.setAttribute("skinIndex", new THREE.BufferAttribute(SI, 4));
  geo.setAttribute("skinWeight", new THREE.BufferAttribute(SW, 4));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  // The FBX is triangle soup: weld identical vertices.
  geo = mergeVertices(geo, 1e-5);
  const ia = geo.index.array;
  if (geo.attributes.position.count < 65536) geo.setIndex(new THREE.BufferAttribute(new Uint16Array(ia), 1));
  console.log("verts", n, "->", geo.attributes.position.count);

  const group = new THREE.Group();
  group.name = "soldier";
  group.add(bones[0]);
  group.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  skeleton.calculateInverses();
  const sm = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial({ name: "soldier" }));
  sm.name = "lod0";
  group.add(sm);
  sm.bind(skeleton, new THREE.Matrix4());
  return { group, mesh: sm, skeleton, bones, tris: index.length / 3 };
}

/** RGBA atlas (2 x 2 quadrants of `size` px) from per-material images. */
export function buildAtlas(dir, prefix, kind, size, fallback = [128, 128, 255, 255]) {
  const S = size * 2, out = new Uint8Array(S * S * 4);
  for (const [name, [qx, qy]] of Object.entries(QUAD)) {
    let img = null;
    for (const f of [`${prefix}_${name}_${kind}_acu.tga`, `${prefix}_${name}_${kind}.tga`]) {
      try { img = loadTGA(`${dir}/${f}`); break; } catch { /* next */ }
    }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const o = ((qy * size + y) * S + qx * size + x) * 4;
      if (!img) { out.set(fallback, o); continue; }
      // Box filter from the source (any aspect) into the square quadrant.
      const x0 = Math.floor((x * img.width) / size), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * img.width) / size));
      const y0 = Math.floor((y * img.height) / size), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * img.height) / size));
      const acc = [0, 0, 0, 0];
      for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) for (let c = 0; c < 4; c++) acc[c] += img.data[(j * img.width + i) * 4 + c];
      const k = (x1 - x0) * (y1 - y0);
      for (let c = 0; c < 4; c++) out[o + c] = Math.round(acc[c] / k);
    }
  }
  return { data: out, width: S, height: S };
}
