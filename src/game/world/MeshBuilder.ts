import * as THREE from "three";
import type { WorldMat } from "./WorldMaterials";

export type UvMode =
  /** Planar world projection per triangle (dominant axis) — no stretching, continuous across pieces. */
  | "world"
  /** Geometry's own UVs multiplied by `uvScale` (metres per 0..1). */
  | "keep";

export type AddOptions = {
  /** Bucket group: "solid" | "decor" | "proxy:<surface>" | "model:<id>" ... */
  group?: string;
  uv?: UvMode;
  uvScale?: [number, number];
  /** Swap u/v (e.g. horizontal planks from a vertical-plank texture). */
  rot90?: boolean;
  /** Extra UV offset in metres (de-syncs neighbouring pieces). */
  uvOffset?: [number, number];
  /** Skip the baked ground-contact AO (default: on for opaque materials). */
  noAo?: boolean;
};

/** Materials that never get baked AO (overlays / alpha cards). */
const NO_AO = new Set<WorldMat>(["decal", "chainlink", "frond", "cloth", "glow", "signs"]);

/**
 * Group naming: "solid" (raycast), "decor", "proxy:<surface>" (invisible
 * raycast faces), "model:<id>" (fallbacks), "far" (backdrop, no shadows),
 * "clutter@i,j" (small detail, distance-culled per cell, hidden on low).
 */
export const CLUTTER_CELL = 34;

/**
 * Backdrop ("far") geometry is never seen up close, so similar materials
 * share one: fewer draw calls for the whole skyline.
 */
const FAR_REMAP: Partial<Record<WorldMat, WorldMat>> = {
  concrete_dirty: "concrete",
  concrete_broken: "concrete",
  metal_rust: "metal_dark",
  brick: "plaster_damaged",
  wood: "metal_painted",
  rubble: "concrete",
  canvas: "cloth",
};
export const clutterGroup = (x: number, z: number) => `clutter@${Math.floor(x / CLUTTER_CELL)},${Math.floor(z / CLUTTER_CELL)}`;

type Bucket = { group: string; mat: WorldMat; pos: number[]; nor: number[]; uv: number[]; col: number[]; ao: number[] };

const _m3 = new THREE.Matrix3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();
const _col = new THREE.Color();
const _mat = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _t = new THREE.Vector3();

/**
 * Accumulates static geometry into one merged mesh per (group, material).
 * Every vertex carries a tint colour, so one material serves many colours
 * and the whole map draws in a few dozen calls. UVs are in metres; the
 * material's texture repeat sets the real-world tile size.
 */
export class MeshBuilder {
  private readonly buckets = new Map<string, Bucket>();
  private readonly unit = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();

  private bucket(group: string, mat: WorldMat) {
    if (group.startsWith("far")) mat = FAR_REMAP[mat] ?? mat;
    const key = `${group}|${mat}`;
    let b = this.buckets.get(key);
    if (!b) {
      b = { group, mat, pos: [], nor: [], uv: [], col: [], ao: [] };
      this.buckets.set(key, b);
    }
    return b;
  }

  /** Adds a geometry (indexed or not) transformed by `matrix`. */
  add(geo: THREE.BufferGeometry, matrix: THREE.Matrix4 | null, mat: WorldMat, tint: THREE.ColorRepresentation, opts: AddOptions = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const P = g.attributes.position as THREE.BufferAttribute;
    const N = g.attributes.normal as THREE.BufferAttribute | undefined;
    const U = g.attributes.uv as THREE.BufferAttribute | undefined;
    const C = g.attributes.color as THREE.BufferAttribute | undefined;
    const b = this.bucket(opts.group ?? "decor", mat);
    if (matrix) _m3.getNormalMatrix(matrix);
    _col.set(tint);
    const mode = opts.uv ?? "world";
    const [su, sv] = opts.uvScale ?? [1, 1];
    const [ou, ov] = opts.uvOffset ?? [0, 0];
    const rot = !!opts.rot90;
    const ao = opts.noAo || NO_AO.has(mat) || b.group.startsWith("proxy") ? 0 : 1;
    for (let i = 0; i + 2 < P.count; i += 3) {
      b.ao.push(ao, ao, ao);
      const base = b.pos.length;
      for (let k = 0; k < 3; k++) {
        const v = k === 0 ? _a : k === 1 ? _b : _c;
        v.fromBufferAttribute(P, i + k);
        if (matrix) v.applyMatrix4(matrix);
        b.pos.push(v.x, v.y, v.z);
      }
      _n.subVectors(_c, _b).cross(_t.subVectors(_a, _b)).normalize();
      for (let k = 0; k < 3; k++) {
        if (N) {
          const nv = _s.fromBufferAttribute(N, i + k);
          if (matrix) nv.applyMatrix3(_m3).normalize();
          b.nor.push(nv.x, nv.y, nv.z);
        } else b.nor.push(_n.x, _n.y, _n.z);
        if (C) b.col.push(C.getX(i + k) * _col.r, C.getY(i + k) * _col.g, C.getZ(i + k) * _col.b);
        else b.col.push(_col.r, _col.g, _col.b);
      }
      if (mode === "keep" && U) {
        for (let k = 0; k < 3; k++) {
          let u = U.getX(i + k) * su + ou, w = U.getY(i + k) * sv + ov;
          if (rot) [u, w] = [w, u];
          b.uv.push(u, w);
        }
      } else {
        const ax = Math.abs(_n.x), ay = Math.abs(_n.y), az = Math.abs(_n.z);
        for (let k = 0; k < 3; k++) {
          const x = b.pos[base + k * 3], y = b.pos[base + k * 3 + 1], z = b.pos[base + k * 3 + 2];
          let u: number, w: number;
          if (ax >= ay && ax >= az) {
            u = _n.x > 0 ? -z : z;
            w = y;
          } else if (az >= ay) {
            u = _n.z > 0 ? x : -x;
            w = y;
          } else {
            u = x;
            w = -z;
          }
          if (rot) [u, w] = [w, u];
          b.uv.push(u + ou, w + ov);
        }
      }
    }
    if (g !== geo) g.dispose();
  }

  /** Axis-aligned box by centre + size (optionally rotated about Y). */
  box(mat: WorldMat, x: number, y: number, z: number, w: number, h: number, d: number, tint: THREE.ColorRepresentation, opts: AddOptions & { rotY?: number; rotX?: number; rotZ?: number } = {}) {
    _e.set(opts.rotX ?? 0, opts.rotY ?? 0, opts.rotZ ?? 0);
    _q.setFromEuler(_e);
    _mat.compose(_p.set(x, y, z), _q, _s.set(w, h, d));
    this.add(this.unit, _mat, mat, tint, opts);
  }

  /** Box given by min corner (feet) + size, like MapBox. */
  boxFeet(mat: WorldMat, x: number, y: number, z: number, w: number, h: number, d: number, tint: THREE.ColorRepresentation, opts: AddOptions & { rotY?: number } = {}) {
    this.box(mat, x, y + h / 2, z, w, h, d, tint, opts);
  }

  /** Ground height under a point, for the baked contact AO (flat by default). */
  ground: (x: number, z: number) => number = () => 0;

  /** Triangle count so far in groups matching a prefix (budgeting). */
  triangles(prefix = "") {
    let n = 0;
    for (const b of this.buckets.values()) if (b.group.startsWith(prefix)) n += b.pos.length / 9;
    return n;
  }

  /**
   * Bakes ground-contact AO into vertex colours: wall bases, undersides of
   * low props and the feet of everything darken toward the ground (upward
   * faces are left alone so floors/slabs don't go muddy).
   */
  private bakeAo(b: Bucket) {
    for (let v = 0; v < b.pos.length / 3; v++) {
      if (!b.ao[v]) continue;
      const ny = b.nor[v * 3 + 1];
      if (ny > 0.7) continue;
      const x = b.pos[v * 3], y = b.pos[v * 3 + 1], z = b.pos[v * 3 + 2];
      const h = y - this.ground(x, z);
      if (h > 1.6) continue;
      const t = Math.min(1, Math.max(0, h / 1.6));
      const k = 1 - (ny < -0.5 ? 0.5 : 0.4) * (1 - t * t * (3 - 2 * t));
      b.col[v * 3] *= k;
      b.col[v * 3 + 1] *= k;
      b.col[v * 3 + 2] *= k;
    }
  }

  /** Builds one mesh per bucket. Returns them keyed by group. */
  build(resolve: (name: WorldMat) => THREE.Material): Map<string, THREE.Mesh[]> {
    const out = new Map<string, THREE.Mesh[]>();
    for (const b of this.buckets.values()) {
      if (!b.pos.length) continue;
      this.bakeAo(b);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(b.nor, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(b.uv, 2));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(b.col, 3));
      geo.computeBoundingSphere();
      geo.computeBoundingBox();
      const mesh = new THREE.Mesh(geo, resolve(b.mat));
      mesh.name = `${b.group}:${b.mat}`;
      mesh.castShadow = !b.group.startsWith("far") && b.mat !== "decal";
      if (b.mat === "decal") mesh.renderOrder = 1;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.userData.material = b.mat;
      const list = out.get(b.group) ?? [];
      list.push(mesh);
      out.set(b.group, list);
    }
    this.buckets.clear();
    this.unit.dispose();
    return out;
  }
}

/** A soft pillow-shaped sandbag (48 tris), unit-sized: 1 × 1 × 1 bounds. */
export function makeSandbagGeometry() {
  const g = new THREE.SphereGeometry(0.5, 8, 4);
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).multiplyScalar(2);
    // Superellipse: push the sphere toward a rounded box.
    const f = (x: number, e: number) => Math.sign(x) * Math.pow(Math.abs(x), e);
    v.set(f(v.x, 0.45), f(v.y, 0.8), f(v.z, 0.55)).multiplyScalar(0.5);
    // Tied ends pinch slightly; belly sags.
    v.y *= 1 - 0.25 * Math.pow(Math.abs(v.x * 2), 6);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Catenary "sagging wire" between two points as a thin tube. */
export function makeWireGeometry(a: THREE.Vector3, b: THREE.Vector3, sag: number, radius = 0.012, segments = 14) {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = new THREE.Vector3().lerpVectors(a, b, t);
    p.y -= sag * 4 * t * (1 - t);
    pts.push(p);
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  return new THREE.TubeGeometry(curve, segments, radius, 4, false);
}
