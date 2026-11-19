import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** Detail textures tile every 1/UV_SCALE metres (box-projected UVs). */
const UV_SCALE = 9;

export type V3 = [number, number, number];
export type P2 = [number, number];

export type Place = {
  rx?: number;
  ry?: number;
  rz?: number;
  /** Uniform or per-axis scale. */
  s?: number | V3;
};

export type ExtrudeOpts = Place & {
  /** Chamfer size (m). */
  bev?: number;
  /** Curve segments for rounded corners. */
  seg?: number;
  /** Bevel segments (1 = flat chamfer, 2+ = rounded). */
  bevSeg?: number;
  holes?: P2[][];
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();

/** Compose a placement matrix (position + XYZ euler + scale). */
export function place(x: number, y: number, z: number, o: Place = {}, out = new THREE.Matrix4()) {
  _e.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0);
  _q.setFromEuler(_e);
  const s = o.s ?? 1;
  if (typeof s === "number") _s.set(s, s, s);
  else _s.set(s[0], s[1], s[2]);
  return out.compose(_p.set(x, y, z), _q, _s);
}

/** Polygon from points. */
export function shape(pts: P2[], holes: P2[][] = []) {
  const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) sh.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  return sh;
}

/** Rounded rectangle centred on (cx, cy). */
export function rrect(w: number, h: number, r: number, cx = 0, cy = 0, seg = 3): P2[] {
  const out: P2[] = [];
  const rr = Math.min(r, w / 2 - 1e-5, h / 2 - 1e-5);
  if (rr <= 1e-6) {
    return [[cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2], [cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2]];
  }
  const corners: [number, number, number][] = [
    [cx + w / 2 - rr, cy + h / 2 - rr, 0],
    [cx - w / 2 + rr, cy + h / 2 - rr, Math.PI / 2],
    [cx - w / 2 + rr, cy - h / 2 + rr, Math.PI],
    [cx + w / 2 - rr, cy - h / 2 + rr, Math.PI * 1.5],
  ];
  for (const [x, y, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      out.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
    }
  }
  return out;
}

/** Stadium (rounded slot) centred on (cx, cy), long axis along the first coordinate. */
export function slot(len: number, h: number, cx: number, cy: number, seg = 3): P2[] {
  return rrect(len, h, h / 2, cx, cy, seg);
}

/** Circle / regular polygon. */
export function circle(r: number, cx = 0, cy = 0, n = 12, phase = 0): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

/** Flip a polygon's winding (holes must wind opposite to the outline). */
export const rev = (p: P2[]) => p.slice().reverse();

/**
 * Extrude a shape along +Z, centred on z = 0, with the outline exact (the
 * chamfer cuts inward). Writes a colour attribute flagging chamfer faces.
 */
export function extrude(sh: THREE.Shape, depth: number, o: ExtrudeOpts = {}) {
  const bev = Math.min(o.bev ?? 0, depth * 0.45);
  const geo = new THREE.ExtrudeGeometry(sh, {
    depth: Math.max(1e-5, depth - 2 * bev),
    bevelEnabled: bev > 0,
    bevelThickness: bev,
    bevelSize: bev,
    bevelOffset: -bev,
    bevelSegments: o.bevSeg ?? 1,
    curveSegments: o.seg ?? 3,
    steps: 1,
  });
  geo.translate(0, 0, -(depth / 2 - bev));
  markEdges(geo, 2);
  return geo;
}

/** Edge flag in the colour attribute's red channel: 1 on chamfers, 0 elsewhere. */
function markEdges(geo: THREE.BufferGeometry, axis: 0 | 1 | 2) {
  const n = geo.attributes.normal;
  const c = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i++) {
    const v = Math.abs(axis === 2 ? n.getZ(i) : axis === 1 ? n.getY(i) : n.getX(i));
    c[i * 3] = v > 0.2 && v < 0.96 ? 1 : 0;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(c, 3));
}

function noEdges(geo: THREE.BufferGeometry) {
  geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
}

/**
 * Lathe around the Z axis. pts are [radius, z]; faces point outward
 * (orientation fixed automatically).
 */
export function latheZ(pts: P2[], seg = 16, phiStart = 0, phiLength = Math.PI * 2) {
  const build = (p: P2[]) => {
    const g = new THREE.LatheGeometry(p.map(([r, z]) => new THREE.Vector2(Math.max(r, 1e-5), -z)), seg, phiStart, phiLength);
    g.rotateX(-Math.PI / 2);
    return g;
  };
  let g = build(pts);
  // Check orientation on the widest ring: normal should point away from the axis.
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  let dot = 0;
  for (let i = 0; i < pos.count; i++) dot += pos.getX(i) * nor.getX(i) + pos.getY(i) * nor.getY(i);
  if (dot < 0) {
    g.dispose();
    g = build(rev(pts));
  }
  noEdges(g);
  return g;
}

/** A capsule / rod between two points. */
export function rodGeo(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 8, capsule = false, r2 = r) {
  const len = a.distanceTo(b);
  const g = capsule ? new THREE.CapsuleGeometry(r, Math.max(1e-4, len), 2, seg) : new THREE.CylinderGeometry(r2, r, len, seg, 1, false);
  // CylinderGeometry is along Y with radiusTop at +Y; place so +Y points a→b.
  const dir = _p.subVectors(b, a).normalize();
  _q.setFromUnitVectors(_n.set(0, 1, 0), dir);
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  g.applyMatrix4(_m.compose(mid, _q, _s.set(1, 1, 1)));
  noEdges(g);
  return g;
}

type Bucket = { obj: THREE.Object3D; parts: Map<THREE.Material, THREE.BufferGeometry[]> };

/**
 * Accumulates part geometry per (target object, material) and merges each
 * bucket into a single mesh. Static gun parts become one mesh per material;
 * moving parts (mag, bolt, slide, pump, cylinder…) get their own target.
 */
export class GeoBuilder {
  private readonly buckets: Bucket[] = [];
  private cur!: Bucket;
  triangles = 0;
  meshes = 0;

  constructor(private readonly wear: (mat: THREE.Material) => number) {}

  /** Subsequent parts go into `obj` (in obj's local space). */
  into(obj: THREE.Object3D) {
    let b = this.buckets.find((x) => x.obj === obj);
    if (!b) {
      b = { obj, parts: new Map() };
      this.buckets.push(b);
    }
    this.cur = b;
    return this;
  }

  /** Add raw geometry (consumed) with an optional placement. */
  add(mat: THREE.Material, geo: THREE.BufferGeometry, m?: THREE.Matrix4) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    g.clearGroups();
    for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal" && k !== "color") g.deleteAttribute(k);
    if (!g.attributes.color) noEdges(g);
    if (m) {
      g.applyMatrix4(m);
      if (m.determinant() < 0) flipWinding(g);
    }
    // Edge flag → wear multiplier.
    const w = this.wear(mat);
    const c = g.attributes.color as THREE.BufferAttribute;
    for (let i = 0; i < c.count; i++) {
      const e = c.getX(i);
      const v = 1 + (w - 1) * e;
      c.setXYZ(i, v, v, v);
    }
    let list = this.cur.parts.get(mat);
    if (!list) this.cur.parts.set(mat, (list = []));
    list.push(g);
    return this;
  }

  // ---- Primitives -----------------------------------------------------------

  /** Chamfered box centred on (x, y, z). */
  box(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, o: ExtrudeOpts = {}) {
    const bev = o.bev ?? Math.min(w, h, d) * 0.12;
    const g = extrude(shape(rrect(w, h, o.seg ? bev * 2 : 0, 0, 0, o.seg ?? 1)), d, { ...o, bev });
    return this.add(mat, g, place(x, y, z, o));
  }

  /**
   * Side profile drawn in the gun's (z, y) plane, extruded `thick` along X and
   * centred on x. Great for receivers, grips, stocks, triggers, magazines.
   */
  profile(mat: THREE.Material, pts: P2[], thick: number, x = 0, o: ExtrudeOpts & { y?: number; z?: number } = {}) {
    const flip = (p: P2[]) => p.map(([z, y]) => [-z, y] as P2);
    const sh = shape(flip(pts), (o.holes ?? []).map(flip));
    const g = extrude(sh, thick, o);
    g.rotateY(Math.PI / 2);
    return this.add(mat, g, place(x, o.y ?? 0, o.z ?? 0, o));
  }

  /** Cross-section in the (x, y) plane extruded along Z from z0 to z1. */
  section(mat: THREE.Material, pts: P2[], z0: number, z1: number, o: ExtrudeOpts & { x?: number; y?: number } = {}) {
    const sh = shape(pts, o.holes ?? []);
    const g = extrude(sh, Math.abs(z1 - z0), o);
    return this.add(mat, g, place(o.x ?? 0, o.y ?? 0, (z0 + z1) / 2, o));
  }

  /** Lathe around an axis parallel to Z through (x, y). pts are [radius, z]. */
  lathe(mat: THREE.Material, pts: P2[], x: number, y: number, o: Place & { seg?: number; z?: number } = {}) {
    return this.add(mat, latheZ(pts, o.seg ?? 16), place(x, y, o.z ?? 0, o));
  }

  /** Plain cylinder along Z. */
  cyl(mat: THREE.Material, r: number, z0: number, z1: number, x: number, y: number, seg = 12, o: Place & { z?: number } = {}) {
    return this.lathe(mat, [[0, z0], [r, z0], [r, z1], [0, z1]], x, y, { ...o, seg });
  }

  /** Rod between two points. */
  rod(mat: THREE.Material, a: V3, b: V3, r: number, seg = 8, capsule = false) {
    return this.add(mat, rodGeo(new THREE.Vector3(...a), new THREE.Vector3(...b), r, seg, capsule));
  }

  /** Merge every bucket into meshes. Returns created geometries for disposal. */
  finish(disposables: { dispose(): void }[]) {
    for (const b of this.buckets) {
      for (const [mat, list] of b.parts) {
        const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
        if (!merged) throw new Error("viewmodel: merge failed");
        if (list.length > 1) for (const g of list) g.dispose();
        boxUV(merged);
        merged.computeBoundingSphere();
        const mesh = new THREE.Mesh(merged, mat);
        b.obj.add(mesh);
        disposables.push(merged);
        this.triangles += merged.attributes.position.count / 3;
        this.meshes++;
      }
    }
    this.buckets.length = 0;
  }
}

function flipWinding(g: THREE.BufferGeometry) {
  for (const name of ["position", "normal", "color"]) {
    const a = g.attributes[name] as THREE.BufferAttribute | undefined;
    if (!a) continue;
    const arr = a.array as Float32Array;
    const s = a.itemSize;
    for (let t = 0; t < a.count; t += 3) {
      for (let k = 0; k < s; k++) {
        const i1 = (t + 1) * s + k;
        const i2 = (t + 2) * s + k;
        const tmp = arr[i1];
        arr[i1] = arr[i2];
        arr[i2] = tmp;
      }
    }
  }
}

/** Box-projected UVs in metres (consistent texel density on every part). */
function boxUV(g: THREE.BufferGeometry) {
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    let u: number, v: number;
    if (ax >= ay && ax >= az) {
      u = p.getZ(i);
      v = p.getY(i);
    } else if (ay >= az) {
      u = p.getX(i);
      v = p.getZ(i);
    } else {
      u = p.getX(i);
      v = p.getY(i);
    }
    uv[i * 2] = u * UV_SCALE;
    uv[i * 2 + 1] = v * UV_SCALE;
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

/** Normal matrix helper for callers transforming direction vectors. */
export function normalMatrixOf(m: THREE.Matrix4) {
  return _nm.getNormalMatrix(m);
}
