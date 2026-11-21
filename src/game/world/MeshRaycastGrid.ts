import * as THREE from "three";

/**
 * Faster `Mesh.raycast` for the big merged world meshes.
 *
 * Map geometry is merged into a few meshes that each span the whole map, so
 * three's default raycast tests every triangle on every bullet (tens of
 * thousands per ray on the large maps). This puts each mesh's triangles in a
 * uniform XZ grid (local space) and walks only the cells the ray crosses.
 * Results are the same intersections three would report (distance, point,
 * face normal, faceIndex), so callers don't change.
 */

const CELL = 4;
/** Triangles covering more cells than this (ground quads) are tested on every ray. */
const MAX_CELLS_PER_TRI = 256;
/** Below this many triangles the default raycast is fast enough. */
const MIN_TRIS = 1500;

type Grid = {
  pos: THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
  index: THREE.BufferAttribute | null;
  tris: number;
  minX: number;
  minZ: number;
  nx: number;
  nz: number;
  start: Int32Array;
  items: Int32Array;
  big: Int32Array;
  stamp: Uint32Array;
  query: number;
  minY: number;
  maxY: number;
};

const _inv = new THREE.Matrix4();
const _ray = new THREE.Ray();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _p = new THREE.Vector3();
const _pw = new THREE.Vector3();
const _n = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();

function vert(g: Grid, tri: number, k: number, out: THREE.Vector3) {
  const i = g.index ? g.index.getX(tri * 3 + k) : tri * 3 + k;
  return out.fromBufferAttribute(g.pos, i);
}

function build(geo: THREE.BufferGeometry): Grid | null {
  const pos = geo.attributes.position;
  if (!pos) return null;
  const index = geo.index;
  const tris = Math.floor((index ? index.count : pos.count) / 3);
  if (tris < MIN_TRIS) return null;
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const minX = bb.min.x, minZ = bb.min.z;
  const nx = Math.max(1, Math.ceil((bb.max.x - minX) / CELL));
  const nz = Math.max(1, Math.ceil((bb.max.z - minZ) / CELL));
  const g: Grid = { pos, index, tris, minX, minZ, nx, nz, start: new Int32Array(0), items: new Int32Array(0), big: new Int32Array(0), stamp: new Uint32Array(tris), query: 0, minY: bb.min.y, maxY: bb.max.y };
  const cx = (x: number) => Math.min(nx - 1, Math.max(0, Math.floor((x - minX) / CELL)));
  const cz = (z: number) => Math.min(nz - 1, Math.max(0, Math.floor((z - minZ) / CELL)));
  // Triangle XZ cell ranges.
  const range = new Int32Array(tris * 4);
  const count = new Int32Array(nx * nz + 1);
  const big: number[] = [];
  for (let t = 0; t < tris; t++) {
    vert(g, t, 0, _a); vert(g, t, 1, _b); vert(g, t, 2, _c);
    const x0 = cx(Math.min(_a.x, _b.x, _c.x)), x1 = cx(Math.max(_a.x, _b.x, _c.x));
    const z0 = cz(Math.min(_a.z, _b.z, _c.z)), z1 = cz(Math.max(_a.z, _b.z, _c.z));
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > MAX_CELLS_PER_TRI) {
      big.push(t);
      range[t * 4] = -1;
      continue;
    }
    range[t * 4] = x0; range[t * 4 + 1] = x1; range[t * 4 + 2] = z0; range[t * 4 + 3] = z1;
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) count[z * nx + x + 1]++;
  }
  for (let c = 0; c < nx * nz; c++) count[c + 1] += count[c];
  const items = new Int32Array(count[nx * nz]);
  const fill = count.slice(0, nx * nz);
  for (let t = 0; t < tris; t++) {
    if (range[t * 4] < 0) continue;
    for (let z = range[t * 4 + 2]; z <= range[t * 4 + 3]; z++) for (let x = range[t * 4]; x <= range[t * 4 + 1]; x++) items[fill[z * nx + x]++] = t;
  }
  g.start = count;
  g.items = items;
  g.big = Int32Array.from(big);
  return g;
}

/** Swap in the grid raycast on a large static mesh (no-op for small ones or multi-material meshes). */
export function accelerateRaycast(mesh: THREE.Mesh) {
  if (Array.isArray(mesh.material)) return false;
  const grid = build(mesh.geometry);
  if (!grid) return false;
  mesh.raycast = function (raycaster: THREE.Raycaster, out: THREE.Intersection[]) {
    gridRaycast(this as THREE.Mesh, grid, raycaster, out);
  };
  return true;
}

function gridRaycast(mesh: THREE.Mesh, g: Grid, raycaster: THREE.Raycaster, out: THREE.Intersection[]) {
  const material = mesh.material as THREE.Material;
  if (!material) return;
  _inv.copy(mesh.matrixWorld).invert();
  _ray.copy(raycaster.ray).applyMatrix4(_inv);
  const o = _ray.origin, d = _ray.direction;
  const side = material.side;
  if (++g.query === 0xffffffff) {
    g.stamp.fill(0);
    g.query = 1;
  }
  const q = g.query;

  const test = (t: number) => {
    if (g.stamp[t] === q) return;
    g.stamp[t] = q;
    vert(g, t, 0, _a); vert(g, t, 1, _b); vert(g, t, 2, _c);
    const hit = side === THREE.BackSide ? _ray.intersectTriangle(_c, _b, _a, true, _p) : _ray.intersectTriangle(_a, _b, _c, side === THREE.FrontSide, _p);
    if (!hit) return;
    _pw.copy(_p).applyMatrix4(mesh.matrixWorld);
    const distance = raycaster.ray.origin.distanceTo(_pw);
    if (distance < raycaster.near || distance > raycaster.far) return;
    _n.crossVectors(_e1.subVectors(_c, _b), _e2.subVectors(_a, _b)).normalize();
    const ia = g.index ? g.index.getX(t * 3) : t * 3;
    const ib = g.index ? g.index.getX(t * 3 + 1) : t * 3 + 1;
    const ic = g.index ? g.index.getX(t * 3 + 2) : t * 3 + 2;
    out.push({
      distance,
      point: _pw.clone(),
      object: mesh,
      face: { a: ia, b: ib, c: ic, normal: _n.clone(), materialIndex: 0 },
      faceIndex: t,
    } as THREE.Intersection);
  };

  for (let k = 0; k < g.big.length; k++) test(g.big[k]);

  // Local-space distance limit (rays are unit length in world space; scale may differ locally).
  const scale = mesh.matrixWorld.getMaxScaleOnAxis() || 1;
  const far = Math.min(raycaster.far / scale, 1e6) * 1.01 + 1e-3;
  const dx = d.x === 0 ? 1e-12 : d.x, dz = d.z === 0 ? 1e-12 : d.z;
  const ix = 1 / dx, iz = 1 / dz;
  const gx1 = g.minX + g.nx * CELL, gz1 = g.minZ + g.nz * CELL;
  let a = (g.minX - o.x) * ix, b = (gx1 - o.x) * ix;
  let t0 = Math.min(a, b), t1 = Math.max(a, b);
  a = (g.minZ - o.z) * iz; b = (gz1 - o.z) * iz;
  t0 = Math.max(t0, Math.min(a, b), 0);
  t1 = Math.min(t1, Math.max(a, b), far);
  if (t0 > t1) return;
  const cl = (v: number, n: number) => Math.min(n - 1, Math.max(0, v));
  let x = cl(Math.floor((o.x + dx * t0 - g.minX) / CELL), g.nx);
  let z = cl(Math.floor((o.z + dz * t0 - g.minZ) / CELL), g.nz);
  const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
  const ddx = Math.abs(CELL * ix), ddz = Math.abs(CELL * iz);
  let nextX = (g.minX + (x + (sx > 0 ? 1 : 0)) * CELL - o.x) * ix;
  let nextZ = (g.minZ + (z + (sz > 0 ? 1 : 0)) * CELL - o.z) * iz;
  const { start, items } = g;
  for (;;) {
    const c = z * g.nx + x;
    for (let k = start[c], e = start[c + 1]; k < e; k++) test(items[k]);
    let tc: number;
    if (nextX < nextZ) {
      tc = nextX;
      nextX += ddx;
      x += sx;
      if (x < 0 || x >= g.nx) break;
    } else {
      tc = nextZ;
      nextZ += ddz;
      z += sz;
      if (z < 0 || z >= g.nz) break;
    }
    if (tc > t1) break;
  }
}
