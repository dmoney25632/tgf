import * as THREE from "three";
import type { MeshBuilder } from "../MeshBuilder";
import type { WorldMat } from "../WorldMaterials";
import { decal, pipeRail } from "../architecture/kit";
import type { DecalKind } from "../WorldMaterials";

/**
 * Small steel-structure kit for Saltpan Gantry: oriented beams, tubes,
 * lattice bays, ladders, corrugated cladding and rust streaks. Everything
 * merges into the MeshBuilder (triangles, never draw calls).
 */
export type V3 = readonly [number, number, number];
export type Rnd = () => number;

/** Faded paints and rust used across the works. */
export const PAINT = {
  rust: 0x8e5a3c,
  rustLight: 0xa8704c,
  primer: 0x9c6444,
  steel: 0x8c8880,
  dark: 0x4c4844,
  yellow: 0xb89a52,
  rail: 0xb8964a,
  concrete: 0xc4bcac,
  grating: 0x6e6a62,
};
/** Cladding panel tints: rust in several stages plus a few sun-faded painted sheets. */
export const CLAD_TINTS = [0xa8704c, 0x9a6a4e, 0xb88a64, 0xb07a58, 0x8f7c6a, 0xc0a07a, 0x9c8c7a];

const UNIT = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Box beam from a to b; `w` across (horizontal), `h` the other way (as vertical as possible). */
export function beam(B: MeshBuilder, a: V3, b: V3, w: number, h: number, mat: WorldMat, tint: THREE.ColorRepresentation, group = "decor") {
  _x.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = _x.length();
  if (len < 1e-4) return;
  _x.divideScalar(len);
  const ref = Math.abs(_x.y) > 0.97 ? _p.set(1, 0, 0) : UP;
  _z.crossVectors(_x, ref).normalize();
  _y.crossVectors(_z, _x).normalize();
  _m.makeBasis(_x, _y, _z);
  _m.scale(_s.set(len, h, w));
  _m.setPosition((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  B.add(UNIT, _m, mat, tint, { group });
}

/** Cylinder from a to b. */
export function tube(B: MeshBuilder, a: V3, b: V3, r: number, mat: WorldMat, tint: THREE.ColorRepresentation, seg = 8, group = "decor", open = true) {
  _x.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = _x.length();
  if (len < 1e-4) return;
  const geo = new THREE.CylinderGeometry(r, r, len, seg, 1, open);
  _q.setFromUnitVectors(UP, _x.divideScalar(len));
  _m.compose(_p.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, _s.set(1, 1, 1));
  B.add(geo, _m, mat, tint, { group, uv: "keep", uvScale: [r * 6.28, len] });
  geo.dispose();
}

/** Adds a geometry at a position/rotation (geometry disposed). */
export function put(B: MeshBuilder, geo: THREE.BufferGeometry, x: number, y: number, z: number, rx: number, ry: number, rz: number, mat: WorldMat, tint: THREE.ColorRepresentation, group = "decor", uvScale: [number, number] = [1, 1]) {
  _q.setFromEuler(new THREE.Euler(rx, ry, rz, "YXZ"));
  _m.compose(_p.set(x, y, z), _q, _s.set(1, 1, 1));
  B.add(geo, _m, mat, tint, { group, uv: "keep", uvScale });
  geo.dispose();
}

/** Vertical wide-flange (H) column, flanges facing ±z (or ±x when `turn`). */
export function hColumn(B: MeshBuilder, x: number, z: number, y0: number, y1: number, size: number, tint: THREE.ColorRepresentation, turn = false, group = "decor", mat: WorldMat = "metal_painted") {
  const h = y1 - y0, cy = (y0 + y1) / 2, f = 0.05;
  if (turn) {
    B.box(mat, x, cy, z, size * 0.14, h, size - f * 2, tint, { group });
    for (const s of [-1, 1]) B.box(mat, x + s * (size / 2 - f / 2), cy, z, f, h, size, tint, { group });
  } else {
    B.box(mat, x, cy, z, size - f * 2, h, size * 0.14, tint, { group });
    for (const s of [-1, 1]) B.box(mat, x, cy, z + s * (size / 2 - f / 2), size, h, f, tint, { group });
  }
}

/** X-braced bay between four points (bottom a→b, top d→c), plus optional horizontal ties. */
export function xBay(B: MeshBuilder, a: V3, b: V3, c: V3, d: V3, w: number, tint: THREE.ColorRepresentation, group = "decor", ties = false) {
  beam(B, a, c, w, w, "metal_painted", tint, group);
  beam(B, b, d, w, w, "metal_painted", tint, group);
  if (ties) {
    beam(B, a, b, w, w * 1.4, "metal_painted", tint, group);
    beam(B, d, c, w, w * 1.4, "metal_painted", tint, group);
  }
}

/** Vertical ladder: two stiles + rungs, optional safety cage hoops. `nx,nz` = facing (out from the wall). */
export function ladder(B: MeshBuilder, x: number, z: number, y0: number, y1: number, nx: number, nz: number, tint: THREE.ColorRepresentation, cage = false, group = "decor") {
  const tx = -nz, tz = nx;
  for (const s of [-0.22, 0.22]) B.box("metal_dark", x + tx * s, (y0 + y1) / 2, z + tz * s, 0.05, y1 - y0, 0.05, tint, { group });
  for (let y = y0 + 0.3; y < y1; y += 0.3) beam(B, [x - tx * 0.22, y, z - tz * 0.22], [x + tx * 0.22, y, z + tz * 0.22], 0.025, 0.025, "metal_dark", tint, group);
  if (!cage) return;
  for (let y = y0 + 2.4; y < y1; y += 0.9) {
    const pts: V3[] = [];
    for (let k = 0; k <= 6; k++) {
      const a = (k / 6) * Math.PI;
      pts.push([x + tx * Math.cos(a) * 0.36 + nx * Math.sin(a) * 0.7, y, z + tz * Math.cos(a) * 0.36 + nz * Math.sin(a) * 0.7]);
    }
    for (let k = 0; k < 6; k++) beam(B, pts[k], pts[k + 1], 0.03, 0.04, "metal_dark", tint, group);
  }
  for (const k of [0, 2, 4, 6]) {
    const a = (k / 6) * Math.PI;
    const ox = tx * Math.cos(a) * 0.36 + nx * Math.sin(a) * 0.7, oz = tz * Math.cos(a) * 0.36 + nz * Math.sin(a) * 0.7;
    beam(B, [x + ox, y0 + 2.4, z + oz], [x + ox, y1, z + oz], 0.03, 0.03, "metal_dark", tint, group);
  }
}

/** Safety-yellow pipe handrail between two points (follows slope). */
export function handrail(B: MeshBuilder, a: V3, b: V3, h = 1.05, tint: THREE.ColorRepresentation = PAINT.rail, group = "decor") {
  pipeRail(B, new THREE.Vector3(...a), new THREE.Vector3(...b), h, tint, group);
}

/** Decal on a face: centre, outward normal (horizontal), width/height. */
export function faceDecal(B: MeshBuilder, kind: DecalKind, cx: number, cy: number, cz: number, nx: number, nz: number, w: number, h: number, tint: THREE.ColorRepresentation, group = "decor") {
  const n = new THREE.Vector3(nx, 0, nz).normalize();
  const right = new THREE.Vector3().crossVectors(UP, n);
  decal(B, kind, new THREE.Vector3(cx, cy, cz).addScaledVector(n, 0.015), right, UP, w, h, tint, group);
}

/**
 * Corrugated wall along a line, built from ~0.9 m sheets of mixed rust and
 * faded paint, each a few mm proud or sunk; some sheets are missing (the
 * dark interior shows) and a window band can be cut through. `n` is outward.
 */
export function cladWall(
  B: MeshBuilder, r: Rnd,
  ax: number, az: number, bx: number, bz: number, nx: number, nz: number,
  y0: number, y1: number,
  opts: { gaps?: number; window?: [number, number]; streaks?: number; group?: string } = {},
) {
  const group = opts.group ?? "decor";
  const len = Math.hypot(bx - ax, bz - az);
  const tx = (bx - ax) / len, tz = (bz - az) / len;
  const yaw = Math.atan2(-tz, tx);
  const n = Math.max(1, Math.round(len / 0.9));
  const sw = len / n;
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) * sw;
    const cx = ax + tx * u, cz = az + tz * u;
    const tint = CLAD_TINTS[Math.floor(r() * CLAD_TINTS.length)];
    const mat: WorldMat = r() < 0.72 ? "corrugated_rust" : "metal_corrugated";
    const off = 0.02 + r() * 0.025;
    const seg = (s0: number, s1: number) => {
      if (s1 - s0 < 0.05) return;
      if (opts.gaps && r() < opts.gaps) return;
      B.box(mat, cx + nx * off, (s0 + s1) / 2, cz + nz * off, sw + 0.03, s1 - s0, 0.03, tint, { group, rotY: yaw, uvOffset: [r() * 4, r() * 2] });
    };
    if (opts.window) {
      seg(y0, opts.window[0]);
      seg(opts.window[1], y1);
      // Window: dark glass (some panes broken out), frame bars.
      if (r() > 0.25) B.box("plain", cx + nx * 0.01, (opts.window[0] + opts.window[1]) / 2, cz + nz * 0.01, sw - 0.06, opts.window[1] - opts.window[0], 0.02, r() < 0.5 ? 0x2a2e30 : 0x3a3a36, { group, rotY: yaw });
      B.box("metal_dark", cx + nx * 0.04, opts.window[0], cz + nz * 0.04, sw, 0.06, 0.08, PAINT.dark, { group, rotY: yaw });
      B.box("metal_dark", cx + nx * 0.04, (opts.window[0] + opts.window[1]) / 2, cz + nz * 0.04 + 0, 0.05, opts.window[1] - opts.window[0], 0.06, PAINT.dark, { group, rotY: yaw });
    } else seg(y0, y1);
  }
  // Girts showing at the sheet laps, flashing on top.
  B.box("metal_dark", (ax + bx) / 2 + nx * 0.06, y1 - 0.05, (az + bz) / 2 + nz * 0.06, len + 0.1, 0.1, 0.06, PAINT.dark, { group, rotY: yaw });
  for (let k = 0; k < (opts.streaks ?? 0); k++) {
    const u = 0.4 + r() * (len - 0.8);
    const h = 1.2 + r() * 2.2;
    faceDecal(B, "leak", ax + tx * u + nx * 0.05, y1 - h / 2 - 0.1, az + tz * u + nz * 0.05, nx, nz, 0.5 + r() * 0.7, h, r() < 0.6 ? 0xb06a3a : 0xffffff, group);
  }
}

/** Frustum (square hopper) between two squares at y0 (half-size s0) and y1 (half-size s1). */
export function hopper(B: MeshBuilder, x: number, z: number, y0: number, s0: number, y1: number, s1: number, mat: WorldMat, tint: THREE.ColorRepresentation, group = "decor") {
  const h = Math.abs(y1 - y0);
  const top = y1 > y0 ? s1 : s0, bot = y1 > y0 ? s0 : s1;
  const geo = new THREE.CylinderGeometry(top * Math.SQRT2, bot * Math.SQRT2, h, 4, 1, false);
  put(B, geo, x, (y0 + y1) / 2, z, 0, Math.PI / 4, 0, mat, tint, group, [top * 4, h]);
}
