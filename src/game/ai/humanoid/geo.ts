import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { SURF } from "./materials";

/**
 * Build-time geometry toolkit: sculpted primitives (lofts with superellipse
 * cross-sections, domes, rounded boxes), painted per vertex with colour +
 * surface params, merged into one BufferGeometry per bone.
 * Runs once per (kit, palette, variant) and is cached by the caller.
 */

/**
 * Build quality, set by the caller around a build: 0 = full detail, 1 = mid
 * range (tiny parts dropped), 2 = far (coarse tessellation, only the big
 * shapes). Read by the primitive helpers and GeoBuilder.add.
 */
export const QUALITY = { lod: 0 };
const segs = (n: number, min = 3) => (QUALITY.lod === 0 ? n : Math.max(min, Math.round(n * (QUALITY.lod === 1 ? 0.75 : 0.5))));
/** Smallest part (bounding-box diagonal, metres) kept at each LOD. */
const MIN_PART = [0, 0.012, 0.045];

export type Paint = { color: THREE.Color; surf: number; rough: number; metal: number; emit: number };

export function paint(hex: number, surf: number = SURF.hard, rough = 0.8, metal = 0, emit = 0): Paint {
  return { color: new THREE.Color(hex), surf, rough, metal, emit };
}
export function shade(p: Paint, k: number): Paint {
  return { ...p, color: p.color.clone().multiplyScalar(k) };
}

export type Ring = { y: number; rx: number; rz: number; cx?: number; cz?: number; p?: number };

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

/** Transform helper: position, Euler rotation (XYZ), scale. */
export function T(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
}
export const MIRROR_X = new THREE.Matrix4().makeScale(-1, 1, 1);

/** Lofted tube along +Y through superellipse rings. Optional end caps. */
export function loft(rings: Ring[], seg: number, capBottom = true, capTop = true) {
  seg = segs(seg, 4);
  const cols = seg + 1;
  const pos: number[] = [];
  const idx: number[] = [];
  for (const r of rings) {
    const e = 2 / (r.p ?? 2);
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      // a = 0 points at +Z (front) so seams sit at the back.
      const x = Math.sign(s) * Math.pow(Math.abs(s), e) * r.rx + (r.cx ?? 0);
      const z = Math.sign(c) * Math.pow(Math.abs(c), e) * r.rz + (r.cz ?? 0);
      pos.push(x, r.y, z);
    }
  }
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  const addCap = (ri: number, up: boolean) => {
    const r = rings[ri];
    const base = pos.length / 3;
    pos.push(r.cx ?? 0, r.y, r.cz ?? 0);
    for (let j = 0; j <= seg; j++) pos.push(pos[(ri * cols + j) * 3], pos[(ri * cols + j) * 3 + 1], pos[(ri * cols + j) * 3 + 2]);
    for (let j = 0; j < seg; j++) {
      if (up) idx.push(base, base + 1 + j, base + 2 + j);
      else idx.push(base, base + 2 + j, base + 1 + j);
    }
  };
  const caps: [number, boolean][] = [];
  if (capBottom) caps.push([0, false]);
  if (capTop) caps.push([rings.length - 1, true]);
  const capStart = pos.length / 3;
  for (const [ri, up] of caps) addCap(ri, up);
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Weld the seam normals and flatten cap normals.
  const n = g.getAttribute("normal") as THREE.BufferAttribute;
  for (let i = 0; i < rings.length; i++) {
    const a = i * cols, b = a + seg;
    const nx = n.getX(a) + n.getX(b), ny = n.getY(a) + n.getY(b), nz = n.getZ(a) + n.getZ(b);
    const l = Math.hypot(nx, ny, nz) || 1;
    n.setXYZ(a, nx / l, ny / l, nz / l);
    n.setXYZ(b, nx / l, ny / l, nz / l);
  }
  let ci = 0;
  for (const [, up] of caps) {
    for (let k = 0; k <= seg + 1; k++) n.setXYZ(capStart + ci + k, 0, up ? 1 : -1, 0);
    ci += seg + 2;
  }
  return g;
}

/** Rounded box: superellipse plan with bevelled top and bottom edges. */
export function rbox(w: number, h: number, d: number, seg = 8, p = 4, bevel = 0.25) {
  // Small details don't need the bevel rings (nobody sees them at range).
  const size = Math.max(w, h, d);
  if (size < 0.06) {
    seg = Math.min(seg, 6);
    bevel = 0;
  } else if (size < 0.1) seg = Math.min(seg, 8);
  const b = Math.min(w, d, h) * bevel;
  const hw = w / 2, hd = d / 2, hh = h / 2;
  if (b <= 0.0005) return loft([{ y: -hh, rx: hw, rz: hd, p }, { y: hh, rx: hw, rz: hd, p }], seg);
  return loft(
    [
      { y: -hh, rx: hw - b, rz: hd - b, p },
      { y: -hh + b * 0.7, rx: hw, rz: hd, p },
      { y: hh - b * 0.7, rx: hw, rz: hd, p },
      { y: hh, rx: hw - b, rz: hd - b, p },
    ],
    seg,
  );
}

/** Simple ellipsoid. */
export function ellipsoid(rx: number, ry: number, rz: number, ws = 10, hs = 7) {
  return new THREE.SphereGeometry(1, segs(ws, 4), segs(hs, 3)).scale(rx, ry, rz);
}

export function cyl(rTop: number, rBot: number, h: number, seg = 8, open = false) {
  return new THREE.CylinderGeometry(rTop, rBot, h, segs(seg, 4), 1, open);
}

/**
 * Dome (helmet shell): polar angle runs from the crown to `edge(az)` so the
 * rim can have a brow line, ear cut-outs and a lower nape. az = 0 faces +Z.
 * Adds a rolled rim (thickness) facing inward.
 */
export function dome(rx: number, ry: number, rz: number, edge: (az: number) => number, seg = 16, rows = 6, rim = 0.012) {
  seg = segs(seg, 8);
  rows = segs(rows, 3);
  const cols = seg + 1;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= rows; i++) {
    for (let j = 0; j <= seg; j++) {
      const az = (j / seg) * Math.PI * 2 - Math.PI;
      const pol = (i / rows) * edge(az);
      const sp = Math.sin(pol);
      pos.push(rx * sp * Math.sin(az), ry * Math.cos(pol), rz * sp * Math.cos(az));
    }
  }
  // Rim ring tucked inward.
  for (let j = 0; j <= seg; j++) {
    const az = (j / seg) * Math.PI * 2 - Math.PI;
    const pol = edge(az);
    const sp = Math.sin(pol);
    pos.push((rx - rim) * sp * Math.sin(az), ry * Math.cos(pol) - rim * 0.3, (rz - rim) * sp * Math.cos(az));
  }
  for (let i = 0; i < rows + 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const n = g.getAttribute("normal") as THREE.BufferAttribute;
  for (let i = 0; i <= rows + 1; i++) {
    const a = i * cols, b = a + seg;
    const nx = n.getX(a) + n.getX(b), ny = n.getY(a) + n.getY(b), nz = n.getZ(a) + n.getZ(b);
    const l = Math.hypot(nx, ny, nz) || 1;
    n.setXYZ(a, nx / l, ny / l, nz / l);
    n.setXYZ(b, nx / l, ny / l, nz / l);
  }
  return g;
}

/** Extruded side profile (in the YZ plane, extruded along X, centred). */
export function profile(points: [number, number][], width: number, bevel = 0.004) {
  const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 3 });
  // Shape lives in XY (x = our Z, y = our Y), extruded along +Z: swap to our frame.
  g.applyMatrix4(new THREE.Matrix4().makeRotationY(-Math.PI / 2));
  g.translate((width - bevel * 2) / 2, 0, 0);
  return g;
}

/** Per-vertex colour tweak; may return a surface kind override. */
export type ColorFn = (p: THREE.Vector3, n: THREE.Vector3, out: THREE.Color) => number | void;

/** Accumulates painted, transformed parts; merge() bakes them into one geometry. */
export class GeoBuilder {
  private readonly parts: THREE.BufferGeometry[] = [];
  /** UV offset so mirrored / repeated parts don't show identical camo. */
  uvOffset = new THREE.Vector2();

  add(src: THREE.BufferGeometry, pt: Paint, m?: THREE.Matrix4, colorFn?: ColorFn, keepUv = false) {
    const minPart = MIN_PART[QUALITY.lod];
    if (minPart > 0) {
      if (!src.boundingBox) src.computeBoundingBox();
      const bb = src.boundingBox!;
      const sx = m ? Math.hypot(m.elements[0], m.elements[1], m.elements[2]) : 1;
      if (Math.hypot(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z) * sx < minPart) {
        if (!src.userData.keep) src.dispose();
        return this;
      }
    }
    const srcUv = keepUv ? (src.getAttribute("uv") as THREE.BufferAttribute | undefined)?.clone() : undefined;
    const g = src.clone();
    if (!g.index) {
      const n = g.getAttribute("position").count;
      const ix: number[] = [];
      for (let i = 0; i < n; i++) ix.push(i);
      g.setIndex(ix);
    } else if (!(g.index.array instanceof Uint32Array)) g.setIndex(new THREE.BufferAttribute(new Uint32Array(g.index.array), 1));
    for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal") g.deleteAttribute(name);
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    if (m) {
      g.applyMatrix4(m);
      if (m.determinant() < 0) {
        const ix = g.index!.array as Uint16Array | Uint32Array;
        for (let i = 0; i < ix.length; i += 3) {
          const t = ix[i + 1];
          ix[i + 1] = ix[i + 2];
          ix[i + 2] = t;
        }
      }
    }
    const P = g.getAttribute("position") as THREE.BufferAttribute;
    const N = g.getAttribute("normal") as THREE.BufferAttribute;
    const count = P.count;
    const col = new Float32Array(count * 3);
    const mat = new Float32Array(count * 4);
    const uv = new Float32Array(count * 2);
    const p = new THREE.Vector3(), n = new THREE.Vector3(), c = new THREE.Color();
    const ox = this.uvOffset.x, oy = this.uvOffset.y;
    for (let i = 0; i < count; i++) {
      p.fromBufferAttribute(P, i);
      n.fromBufferAttribute(N, i);
      c.copy(pt.color);
      const so = colorFn ? colorFn(p, n, c) : undefined;
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
      mat[i * 4] = typeof so === "number" ? so : pt.surf;
      mat[i * 4 + 1] = pt.rough;
      mat[i * 4 + 2] = pt.metal;
      mat[i * 4 + 3] = pt.emit;
      // Box projection in metres: consistent texel density on every part.
      const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
      let u: number, v: number;
      if (ay >= ax && ay >= az) {
        u = p.x;
        v = p.z;
      } else if (ax >= az) {
        u = p.z;
        v = p.y;
      } else {
        u = p.x;
        v = p.y;
      }
      uv[i * 2] = u + ox;
      uv[i * 2 + 1] = v + oy;
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setAttribute("aMat", new THREE.BufferAttribute(mat, 4));
    g.setAttribute("uv", srcUv && srcUv.count === count ? srcUv : new THREE.BufferAttribute(uv, 2));
    this.parts.push(g);
    if (!src.userData.keep) src.dispose();
    return this;
  }

  get empty() {
    return this.parts.length === 0;
  }

  merge(): THREE.BufferGeometry | null {
    if (!this.parts.length) return null;
    const out = mergeGeometries(this.parts, false);
    for (const g of this.parts) g.dispose();
    this.parts.length = 0;
    if (!out) return null;
    out.computeBoundingSphere();
    out.computeBoundingBox();
    return out;
  }
}

/** Mulberry32: deterministic per-build randomness (ghillie cards, variation). */
export function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

