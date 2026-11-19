import * as THREE from "three";

/**
 * Shadow-only merged casters. Static world pieces are drawn as dozens of
 * per-material meshes, and each also costs a draw call in every shadow
 * pass. Their positions are merged here into one mesh per face side that
 * only draws into shadow maps: its draw range is negative (three.js skips the
 * draw without counting it) except between onBeforeShadow/onAfterShadow.
 */

export type ShadowSource = { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 };

/** True for materials a plain depth pass reproduces (no alpha cut-outs). */
export function solidCaster(mat: THREE.Material | THREE.Material[]) {
  if (Array.isArray(mat)) return false;
  const m = mat as THREE.MeshStandardMaterial;
  return m.visible && !m.transparent && !(m.alphaTest > 0) && !m.alphaMap && m.shadowSide == null;
}

function merge(sources: ShadowSource[]) {
  let tris = 0;
  for (const s of sources) tris += (s.geometry.index ? s.geometry.index.count : s.geometry.attributes.position.count) / 3;
  const out = new Float32Array(tris * 9);
  const v = new THREE.Vector3();
  let o = 0;
  for (const s of sources) {
    const pos = s.geometry.attributes.position;
    const idx = s.geometry.index;
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(s.matrix);
      out[o++] = v.x;
      out[o++] = v.y;
      out[o++] = v.z;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(out, 3));
  g.computeBoundingSphere();
  return g;
}

/** One shadow-only mesh per material side; caller adds them to the scene and disposes them. */
export function shadowProxies(sources: { side: THREE.Side; src: ShadowSource }[], name: string): THREE.Mesh[] {
  const bySide = new Map<THREE.Side, ShadowSource[]>();
  for (const s of sources) {
    const list = bySide.get(s.side) ?? [];
    list.push(s.src);
    bySide.set(s.side, list);
  }
  const out: THREE.Mesh[] = [];
  for (const [side, list] of bySide) {
    const geo = merge(list);
    const mat = new THREE.MeshBasicMaterial({ side, colorWrite: false });
    mat.name = "shadow-proxy";
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `${name}:shadow`;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    // Negative count: renderBufferDirect returns before issuing (or counting) a draw.
    geo.drawRange.count = -1;
    mesh.onBeforeShadow = () => {
      geo.drawRange.count = Infinity;
    };
    mesh.onAfterShadow = () => {
      geo.drawRange.count = -1;
    };
    out.push(mesh);
  }
  return out;
}

export function disposeProxy(m: THREE.Mesh) {
  m.removeFromParent();
  m.geometry.dispose();
  (m.material as THREE.Material).dispose();
}
