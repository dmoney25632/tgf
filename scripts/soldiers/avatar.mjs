// Rocketbox avatar -> clean, metre-scaled, atlased skinned soldier split
// into swappable parts (body, head, helmet, equipment), in memory.
import { THREE, loadFBX, loadTGA } from "./lib.mjs";
const { mergeVertices } = await import("/Users/dayton/dev/tgf/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js");

export const SCALE = 0.0096; // cm -> m, and 1.84 m (helmet top) -> 1.77 m like the procedural rig
export const PARTS = ["body", "head", "helmet", "equipment"];
// Atlas quadrants (image space, top-left origin): [qx, qy]
export const QUAD = { body: [0, 0], head: [1, 0], helmet: [0, 1], equipment: [1, 1] };

/**
 * Canonical bone order shared by every avatar (male and female rigs have the
 * same names): joint indices are identical across avatars, so any part can
 * be bound to any same-sex skeleton.
 */
const FINGERS = [0, 1, 2, 3, 4].flatMap((f) => [`Finger${f}`, `Finger${f}1`, `Finger${f}2`]);
export const CANON = [
  "Bip01", "Bip01_Pelvis", "Bip01_Spine", "Bip01_Spine1", "Bip01_Spine2", "Bip01_Neck", "Bip01_Head",
  ...["L", "R"].flatMap((s) => [`Bip01_${s}_Clavicle`, `Bip01_${s}_UpperArm`, `Bip01_${s}_Forearm`, `Bip01_${s}_Hand`, ...FINGERS.map((f) => `Bip01_${s}_${f}`)]),
  ...["L", "R"].flatMap((s) => [`Bip01_${s}_Thigh`, `Bip01_${s}_Calf`, `Bip01_${s}_Foot`, `Bip01_${s}_Toe0`]),
];
const KEEP = new Set(CANON);

/** Union-find connected components over an indexed geometry: component id per triangle. */
function triComponents(index, count) {
  const parent = new Int32Array(count).map((_, i) => i);
  const f = (x) => { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; };
  for (let i = 0; i < index.length; i += 3) { const a = f(index[i]); parent[f(index[i + 1])] = a; parent[f(index[i + 2])] = a; }
  const out = new Int32Array(index.length / 3);
  for (let t = 0; t < out.length; t++) out[t] = f(index[t * 3]);
  return out;
}

export function loadAvatar(dir, fbxName, prefix) {
  const root = loadFBX(`${dir}/${fbxName}`);
  root.updateMatrixWorld(true);
  let mesh = null;
  root.traverse((o) => { if (o.isSkinnedMesh) mesh = o; });
  const mats = [].concat(mesh.material).map((m) => m.name.replace(prefix + "_", ""));
  const src = mesh.skeleton.bones;
  const g = mesh.geometry;
  const v = new THREE.Vector3(), raw = new THREE.Vector3();

  // Face landmarks (metres, bind pose) before the facial bones are folded away.
  const srcByName = new Map();
  root.traverse((o) => { if (o.isBone && !srcByName.has(o.name)) srcByName.set(o.name, o); });
  const at = (n) => (srcByName.has(n) ? srcByName.get(n).getWorldPosition(new THREE.Vector3()).multiplyScalar(SCALE) : null);
  const face = { eyeL: at("Bip01_LEye"), eyeR: at("Bip01_REye"), jaw: at("Bip01_MJaw"), nose: at("Bip01_MNose"), lipT: at("Bip01_MUpperLip"), lipB: at("Bip01_MBottomLip"), head: at("Bip01_Head"), neck: at("Bip01_Neck") };

  // New bone tree (kept bones only), canonical order.
  const made = new Map();
  const mk = (s, parent) => {
    let b = parent;
    if (s.isBone && KEEP.has(s.name) && !made.has(s.name)) {
      b = new THREE.Bone();
      b.name = s.name;
      b.position.copy(s.position).multiplyScalar(SCALE);
      b.quaternion.copy(s.quaternion);
      if (parent) parent.add(b);
      made.set(s.name, b);
    }
    for (const c of s.children) if (c.isBone) mk(c, b);
  };
  const rootBone = srcByName.get("Bip01");
  mk(rootBone, null);
  const bones = CANON.map((n) => {
    const b = made.get(n);
    if (!b) throw new Error(`${fbxName}: missing ${n}`);
    return b;
  });
  rootBone.updateWorldMatrix(true, false);
  rootBone.matrixWorld.decompose(bones[0].position, bones[0].quaternion, v);
  bones[0].position.multiplyScalar(SCALE);
  const idxOf = new Map(CANON.map((n, i) => [n, i]));
  // Unkept bones (face, eyes, footsteps) inherit their nearest kept ancestor.
  const remap = src.map((b) => {
    let p = b;
    while (p && !idxOf.has(p.name)) p = p.parent;
    return p ? idxOf.get(p.name) : 0;
  });

  const nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  const idx = g.index ? g.index.array : null;
  const parts = {};
  for (const [pi, part] of PARTS.entries()) {
    const tris = [];
    for (const grp of g.groups) if (mats[grp.materialIndex] === part) for (let i = grp.start; i < grp.start + grp.count; i++) tris.push(idx ? idx[i] : i);
    if (!tris.length) continue;
    const used = new Map(), order = [];
    for (const vi of tris) if (!used.has(vi)) { used.set(vi, order.length); order.push(vi); }
    const n = order.length;
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), UV = new Float32Array(n * 2), SI = new Uint16Array(n * 4), SW = new Float32Array(n * 4);
    const [qx, qy] = QUAD[part];
    order.forEach((vi, i) => {
      raw.fromBufferAttribute(g.attributes.position, vi).applyMatrix4(mesh.matrixWorld).multiplyScalar(SCALE);
      P.set([raw.x, raw.y, raw.z], i * 3);
      raw.fromBufferAttribute(g.attributes.normal, vi).applyNormalMatrix(nm).normalize();
      N.set([raw.x, raw.y, raw.z], i * 3);
      const u = THREE.MathUtils.clamp(g.attributes.uv.getX(vi), 0.001, 0.999), w = THREE.MathUtils.clamp(g.attributes.uv.getY(vi), 0.001, 0.999);
      // glTF convention: v down (image row 0 at v = 0).
      UV[i * 2] = (u + qx) / 2;
      UV[i * 2 + 1] = (1 - w + qy) / 2;
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
    let geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(P, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(N, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(UV, 2));
    geo.setAttribute("skinIndex", new THREE.BufferAttribute(SI, 4));
    geo.setAttribute("skinWeight", new THREE.BufferAttribute(SW, 4));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(tris.map((vi) => used.get(vi))), 1));
    geo = mergeVertices(geo, 1e-5); // the FBX is triangle soup: weld identical vertices
    geo.setIndex(new THREE.BufferAttribute(new Uint16Array(geo.index.array), 1));
    geo.userData.part = part;
    geo.userData.partIndex = pi;
    parts[part] = geo;
  }

  const group = new THREE.Group();
  group.name = "soldier";
  group.add(bones[0]);
  group.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  skeleton.calculateInverses();
  return { group, skeleton, bones, parts, face };
}

/**
 * Per-vertex head masks in uv1: x = beard / stubble weight (jaw, chin,
 * upper lip, cheeks below the cheekbones), y = 1 on the eye band a
 * balaclava leaves open. From the face bones of the original rig.
 */
export function headMasks(geo, face) {
  const pos = geo.attributes.position, n = pos.count;
  const M = new Float32Array(n * 2);
  const eye = face.eyeL.clone().add(face.eyeR).multiplyScalar(0.5);
  const eyeW = face.eyeL.distanceTo(face.eyeR);
  const mouth = face.lipT.clone().add(face.lipB).multiplyScalar(0.5);
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const p = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(pos, i);
    const dx = p.x - eye.x, dz = p.z - eye.z;
    const front = sm(-0.06, -0.02, dz); // in front of the ears
    // Beard: below the cheekbones down to under the jaw, fading at the throat; not on the lips.
    const below = sm(eye.y - 0.035, eye.y - 0.06, p.y) * sm(mouth.y - 0.105, mouth.y - 0.075, p.y);
    const side = 1 - sm(eyeW * 1.15, eyeW * 1.45, Math.abs(dx));
    const lips = sm(0.012, 0.024, Math.hypot((p.x - mouth.x) * 0.75, p.y - mouth.y));
    const nose = sm(0.012, 0.02, Math.hypot(p.x - mouth.x, p.y - (face.nose?.y ?? mouth.y + 0.03) + 0.005));
    M[i * 2] = below * side * front * lips * Math.max(nose, sm(mouth.y + 0.004, mouth.y - 0.004, p.y));
    // Eye band: an ellipse round both eyes and brows, front only.
    const band = 1 - sm(0.85, 1.0, Math.hypot(dx / (eyeW * 1.05), (p.y - eye.y - 0.006) / 0.03));
    M[i * 2 + 1] = band * sm(-0.035, -0.015, dz);
  }
  geo.setAttribute("uv1", new THREE.BufferAttribute(M, 2));
}

/**
 * RGBA atlas (grid x grid cells of `size` px; default the 2 x 2 part
 * quadrants) from per-material images, box-filtered from the 2048 px sources.
 */
export function buildAtlas(dir, prefix, kind, size, fallback = [128, 128, 255, 255], layout = QUAD, grid = 2) {
  const S = size * grid, out = new Uint8Array(S * S * 4);
  for (const [name, [qx, qy]] of Object.entries(layout)) {
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

/**
 * Rasterises triangles of `geo` (selected by `pick(tri)`) into a W x W
 * single-channel mask in atlas UV space (glTF convention), value 255.
 */
export function rasterUV(mask, W, geo, pick, grow = 1) {
  const uv = geo.attributes.uv, idx = geo.index.array;
  for (let t = 0; t < idx.length / 3; t++) {
    if (!pick(t)) continue;
    const P = [0, 1, 2].map((k) => [uv.getX(idx[t * 3 + k]) * W, uv.getY(idx[t * 3 + k]) * W]);
    const minX = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0])) - grow), maxX = Math.min(W - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0])) + grow);
    const minY = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1])) - grow), maxY = Math.min(W - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])) + grow);
    const area = (P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[1][1] - P[0][1]) * (P[2][0] - P[0][0]);
    if (Math.abs(area) < 1e-9) continue;
    const e = grow / Math.sqrt(Math.abs(area)) + 1e-3;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((P[1][0] - px) * (P[2][1] - py) - (P[1][1] - py) * (P[2][0] - px)) / area;
      const w1 = ((P[2][0] - px) * (P[0][1] - py) - (P[2][1] - py) * (P[0][0] - px)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < -e || w1 < -e || w2 < -e) continue;
      mask[y * W + x] = 255;
    }
  }
}

export { triComponents };

/**
 * Head triangles on the eyeballs (their own small mesh islands centred on
 * the eye bones): per-triangle flags, for the wet-eye roughness and to keep
 * them out of the skin mask.
 */
export function eyeTris(geo, face) {
  const pos = geo.attributes.position, idx = geo.index.array;
  const comp = triComponents(idx, pos.count);
  const box = new Map();
  for (let t = 0; t < comp.length; t++) {
    let b = box.get(comp[t]);
    if (!b) box.set(comp[t], (b = new THREE.Box3()));
    for (let k = 0; k < 3; k++) b.expandByPoint(new THREE.Vector3().fromBufferAttribute(pos, idx[t * 3 + k]));
  }
  const eye = new Map();
  for (const [c, b] of box) {
    const ctr = b.getCenter(new THREE.Vector3()), sz = b.getSize(new THREE.Vector3());
    eye.set(c, Math.max(sz.x, sz.y, sz.z) < 0.05 && [face.eyeL, face.eyeR].some((e) => e && Math.hypot(ctr.x - e.x, ctr.y - e.y) < 0.012));
  }
  return Uint8Array.from(comp, (c) => (eye.get(c) ? 1 : 0));
}

/**
 * Tucks a head behind helmet chin straps / cups: every jaw / chin vertex
 * (below the eyes, in front of the ears) that a ray from inside the skull finds in front of (or within `margin` of)
 * any of the helmets' lower triangles moves inward along that ray, with a
 * smooth falloff onto its neighbours (shared per position, so UV seams stay
 * closed). For head donors, whose jaws were never fitted to a strap.
 * Returns the largest push (m).
 */
export function clearStraps(geo, helmets, face, margin = 0.003, rings = 4) {
  const pos = geo.attributes.position, n = pos.count;
  const ctr = new THREE.Vector3(0, (face.eyeL.y + face.eyeR.y) / 2 - 0.02, 0.01);
  const tris = [];
  for (const g of helmets) {
    const hp = g.attributes.position, idx = g.index.array;
    for (let t = 0; t < idx.length; t += 3) {
      const T = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(hp, idx[t + k]));
      if (Math.max(T[0].y, T[1].y, T[2].y) < ctr.y) tris.push(T);
    }
  }
  const ray = new THREE.Ray(), hit = new THREE.Vector3(), v = new THREE.Vector3();
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i);
    // Jaw and chin only: ears and the hair behind them sit under the side straps and
    // ear hardware on purpose, and pushing them in deforms the ear.
    if (v.y > ctr.y - 0.03 || v.z < face.eyeL.z - 0.045) continue;
    const len = v.distanceTo(ctr);
    ray.set(ctr, v.clone().sub(ctr).normalize());
    let tmin = Infinity;
    for (const [a, b, c] of tris) if (ray.intersectTriangle(a, b, c, false, hit)) tmin = Math.min(tmin, hit.distanceTo(ctr));
    need[i] = Math.max(0, len - (tmin - margin));
  }
  // Same displacement for coincident vertices (UV seams), then a soft falloff ring.
  const key = (i) => `${pos.getX(i).toFixed(5)},${pos.getY(i).toFixed(5)},${pos.getZ(i).toFixed(5)}`;
  const groups = new Map();
  for (let i = 0; i < n; i++) { const k = key(i); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); }
  const share = (d) => { for (const g of groups.values()) { let m = 0; for (const i of g) m = Math.max(m, d[i]); for (const i of g) d[i] = m; } };
  const nb = Array.from({ length: n }, () => new Set());
  const idx = geo.index.array;
  for (let t = 0; t < idx.length; t += 3) for (let k = 0; k < 3; k++) { nb[idx[t + k]].add(idx[t + (k + 1) % 3]); nb[idx[t + k]].add(idx[t + (k + 2) % 3]); }
  let d = need.slice();
  share(d);
  for (let r = 0; r < rings; r++) {
    const next = d.slice();
    for (let i = 0; i < n; i++) { let m = 0; for (const j of nb[i]) m = Math.max(m, d[j]); next[i] = Math.max(d[i], m * 0.55); }
    share(next);
    d = next;
  }
  let worst = 0;
  for (let i = 0; i < n; i++) {
    if (!d[i]) continue;
    v.fromBufferAttribute(pos, i);
    const dir = v.clone().sub(ctr).normalize();
    v.addScaledVector(dir, -Math.min(d[i], 0.03));
    pos.setXYZ(i, v.x, v.y, v.z);
    worst = Math.max(worst, d[i]);
  }
  pos.needsUpdate = true;
  return worst;
}
