import * as THREE from "three";
import type { QualityName } from "../../config";
import type { MeshBuilder } from "../MeshBuilder";
import { makeWireGeometry } from "../MeshBuilder";
import { beam } from "../dressing/saltpanGantryKit";
import { silhouette } from "./Building";

/**
 * Distant skyline: a low-cost backdrop ring beyond the playable map so the
 * world does not end at the terrain edge. Rolling or mesa ridges, industrial
 * stacks, tank farms, silos, water towers, lattice pylons with sagging lines,
 * radio masts, farmsteads, hedgerow tree clumps and town silhouettes.
 *
 * Everything merges into the "far" builder group (no shadows, shared
 * backdrop materials), so the whole ring adds triangles but no draw calls;
 * the height fog takes care of aerial perspective. Piece counts scale with
 * the preset via SKYLINE_DETAIL.
 */

/** Scale on piece counts per preset (ridges are always drawn). */
export const SKYLINE_DETAIL: Record<QualityName, number> = { low: 0.45, medium: 0.75, high: 1 };

export type SkylineSpec = {
  height: (x: number, z: number) => number;
  seed: number;
  quality: QualityName;
  /** Annulus (from the origin) where pieces stand. */
  rMin: number;
  rMax: number;
  /** Optional angular sector [from, to] (radians, atan2(z, x)) to fill; default all round. */
  sector?: [number, number];
  /** Positions to skip (roads, play space, existing landmarks). */
  keepOut?: (x: number, z: number) => boolean;
  /** Ridge ring behind everything. */
  ridge?: { r: number; depth?: number; h: [number, number]; tint: number; mesa?: boolean; far?: { r: number; h: [number, number]; tint: number } };
  stacks?: number;
  tanks?: number;
  silos?: number;
  waterTowers?: number;
  masts?: number;
  farms?: number;
  blocks?: number;
  /** Hedgerow / copse tree clumps. */
  trees?: number;
  treeTint?: number;
  /** Pylon line: a chord across the ring at this angle (radians) and offset from the centre. */
  pylons?: { angle: number; offset: number; spacing?: number };
};

function rnd(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth 1D periodic noise over an angle (sum of seeded sines). */
function angleNoise(a: number, seed: number) {
  let s = 0;
  for (let k = 1; k <= 5; k++) s += Math.sin(a * (k * 2 + 1) + seed * k * 1.7) / (k * 0.9);
  return 0.5 + s * 0.22;
}

const G = "far";

/**
 * Ridge band: rows of vertices from the base ring out and up to the crest,
 * faceted (per-triangle normals) so the sun picks out the slopes.
 */
function ridge(B: MeshBuilder, height: SkylineSpec["height"], r: number, depth: number, h: [number, number], tint: number, mesa: boolean, seed: number, sector?: [number, number]) {
  const [a0, a1] = sector ?? [-Math.PI, Math.PI];
  const span = a1 - a0;
  const seg = Math.max(24, Math.round((span / (Math.PI * 2)) * 150));
  // [radius offset factor, height factor]
  const prof: [number, number][] = mesa ? [[0, -0.1], [0.25, 0.22], [0.4, 0.86], [0.52, 1], [1, 1.04]] : [[0, -0.1], [0.3, 0.45], [0.6, 0.85], [1, 1]];
  const pts: THREE.Vector3[][] = [];
  for (let i = 0; i <= seg; i++) {
    const a = a0 + (span * i) / seg;
    let n = angleNoise(a, seed);
    if (mesa) n = n < 0.45 ? n * 0.35 : 0.6 + (n - 0.45) * 0.7; // flat caps, gaps between buttes
    const crest = h[0] + (h[1] - h[0]) * Math.min(1, Math.max(0, n));
    const ca = Math.cos(a), sa = Math.sin(a);
    const gy = height(ca * r, sa * r) - 6;
    pts.push(prof.map(([rf, hf]) => new THREE.Vector3(ca * (r + rf * depth), gy + hf * crest, sa * (r + rf * depth))));
  }
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color(tint);
  const r2 = rnd(seed * 13);
  for (let i = 0; i < seg; i++) {
    for (let k = 0; k < prof.length - 1; k++) {
      const p00 = pts[i][k], p10 = pts[i + 1][k], p01 = pts[i][k + 1], p11 = pts[i + 1][k + 1];
      // Facing the centre: the base ring is nearer, so wind (p00, p01, p10) etc. and fix by test below.
      pos.push(p00.x, p00.y, p00.z, p01.x, p01.y, p01.z, p10.x, p10.y, p10.z, p10.x, p10.y, p10.z, p01.x, p01.y, p01.z, p11.x, p11.y, p11.z);
      const v = 0.9 + r2() * 0.18 + (k === 0 ? -0.08 : 0);
      for (let q = 0; q < 6; q++) col.push(v, v, v);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  // Make sure the first triangle faces the centre (inward), else flip all.
  const A = new THREE.Vector3().fromArray(pos, 0), Bv = new THREE.Vector3().fromArray(pos, 3), C = new THREE.Vector3().fromArray(pos, 6);
  const n = new THREE.Vector3().subVectors(Bv, A).cross(new THREE.Vector3().subVectors(C, A));
  if (n.dot(A.clone().setY(0).negate()) < 0) {
    for (let i = 0; i < pos.length; i += 9) {
      for (let k = 0; k < 3; k++) [pos[i + 3 + k], pos[i + 6 + k]] = [pos[i + 6 + k], pos[i + 3 + k]];
    }
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  }
  B.add(geo, null, "plain", c, { group: G, noAo: true });
  geo.dispose();
}

function cyl(B: MeshBuilder, x: number, y: number, z: number, rTop: number, rBot: number, h: number, seg: number, mat: "metal_painted" | "concrete" | "plain" | "metal_dark", tint: THREE.ColorRepresentation) {
  const geo = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, false);
  B.add(geo, new THREE.Matrix4().makeTranslation(x, y + h / 2, z), mat, tint, { group: G, uv: "keep", uvScale: [Math.max(rTop, rBot) * 6.28, h] });
  geo.dispose();
}

function cone(B: MeshBuilder, x: number, y: number, z: number, r: number, h: number, seg: number, tint: THREE.ColorRepresentation) {
  const geo = new THREE.ConeGeometry(r, h, seg, 1, true);
  B.add(geo, new THREE.Matrix4().makeTranslation(x, y + h / 2, z), "metal_painted", tint, { group: G, uv: "keep", uvScale: [r * 6.28, h] });
  geo.dispose();
}

/** Industrial chimney: tapered shaft, painted bands near the top, a lip. */
function stack(B: MeshBuilder, x: number, gy: number, z: number, h: number, r: () => number) {
  const rb = 1.4 + r() * 1.2, rt = rb * (0.55 + r() * 0.2);
  const concrete = r() < 0.5;
  cyl(B, x, gy - 1, z, rt, rb, h + 1, 12, concrete ? "concrete" : "metal_painted", concrete ? 0xb4aea2 : 0x8a7a6a);
  const band = (y: number, tint: number) => {
    const k = 1 - y / h;
    cyl(B, x, gy + y, z, rt + (rb - rt) * (k - 1.8 / h) + 0.06, rt + (rb - rt) * k + 0.06, 1.8, 12, "plain", tint);
  };
  if (r() < 0.7) {
    band(h - 2, 0xb03a2a);
    band(h - 5.6, 0xd8d4c8);
    band(h - 9.2, 0xb03a2a);
  }
  cyl(B, x, gy + h, z, rt + 0.15, rt + 0.15, 0.5, 12, "metal_dark", 0x3a3836);
}

/** Storage tank (wide, short) with a shallow cone roof and a stair band. */
function tank(B: MeshBuilder, x: number, gy: number, z: number, rad: number, h: number, r: () => number) {
  const tint = [0xd8d4ca, 0xc8c4b8, 0xb8b4a8, 0x9a8a78][Math.floor(r() * 4)];
  cyl(B, x, gy - 0.5, z, rad, rad, h + 0.5, 18, "metal_painted", tint);
  cone(B, x, gy + h, z, rad + 0.1, rad * 0.18, 18, new THREE.Color(tint).multiplyScalar(0.85));
  cyl(B, x, gy + h * 0.5, z, rad + 0.05, rad + 0.05, 0.3, 18, "metal_dark", 0x5a5652);
}

/** Grain silos: a row of tall cylinders with cone caps and a head-house on top. */
function silos(B: MeshBuilder, x: number, gy: number, z: number, yaw: number, r: () => number) {
  const n = 2 + Math.floor(r() * 3), rad = 2.4 + r() * 1.2, h = 14 + r() * 10;
  const tint = r() < 0.5 ? 0xc8c4b8 : 0xb4aca0;
  const dx = Math.cos(yaw), dz = -Math.sin(yaw);
  for (let i = 0; i < n; i++) {
    const o = (i - (n - 1) / 2) * rad * 2.05;
    cyl(B, x + dx * o, gy - 0.5, z + dz * o, rad, rad, h + 0.5, 14, "concrete", tint);
    cone(B, x + dx * o, gy + h, z + dz * o, rad, rad * 0.5, 14, 0x8a8a84);
  }
  B.box("metal_corrugated", x, gy + h + 2, z, n * rad * 2.05, 3, rad * 1.2, 0x9a9690, { group: G, rotY: yaw });
}

/** Water tower: four splayed legs, ring braces, a drum tank and a cone cap. */
function waterTower(B: MeshBuilder, x: number, gy: number, z: number, r: () => number) {
  const h = 16 + r() * 8, rad = 3 + r();
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) beam(B, [x + sx * rad * 0.95, gy - 0.5, z + sz * rad * 0.95], [x + sx * rad * 0.55, gy + h, z + sz * rad * 0.55], 0.35, 0.35, "metal_dark", 0x5a5854, G);
  for (const y of [h * 0.35, h * 0.7]) {
    const k = 0.95 - (y / h) * 0.4;
    for (const [a, b] of [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]] as const) beam(B, [x + a[0] * rad * k, gy + y, z + a[1] * rad * k], [x + b[0] * rad * k, gy + y, z + b[1] * rad * k], 0.18, 0.18, "metal_dark", 0x5a5854, G);
  }
  cyl(B, x, gy + h, z, rad, rad, 5, 16, "metal_painted", 0xa8b0b0);
  cone(B, x, gy + h + 5, z, rad + 0.2, 1.8, 16, 0x7a8284);
}

/** Lattice pylon (high-voltage): tapered legs, braces and two cross-arms. Returns the wire points. */
function pylon(B: MeshBuilder, x: number, gy: number, z: number, yaw: number, h: number) {
  const tint = 0x7a7c78;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const P = (u: number, y: number, v: number): [number, number, number] => [x + u * c + v * s, gy + y, z - u * s + v * c];
  const base = 2.6, top = 0.7;
  const w = (y: number) => base + (top - base) * (y / h);
  for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) beam(B, P(su * base, -0.5, sv * base), P(su * top, h, sv * top), 0.16, 0.16, "metal_dark", tint, G);
  for (let y = 3; y < h - 1; y += 4.5) {
    const a = w(y), b = w(Math.min(h, y + 4.5));
    beam(B, P(-a, y, -a), P(b, y + 4.5, -b), 0.08, 0.08, "metal_dark", tint, G);
    beam(B, P(-a, y, a), P(b, y + 4.5, a), 0.08, 0.08, "metal_dark", tint, G);
    beam(B, P(-a, y, -a), P(-a, y, a), 0.08, 0.08, "metal_dark", tint, G);
    beam(B, P(a, y, -a), P(a, y, a), 0.08, 0.08, "metal_dark", tint, G);
  }
  const pts: THREE.Vector3[] = [];
  for (const [y, span] of [[h * 0.72, 6.5], [h * 0.9, 4.5]] as const) {
    beam(B, P(0, y, -span), P(0, y, span), 0.25, 0.3, "metal_dark", tint, G);
    for (const sv of [-1, 1]) pts.push(new THREE.Vector3(...P(0, y - 1.4, sv * span * 0.92)));
  }
  pts.push(new THREE.Vector3(...P(0, h + 0.3, 0)));
  return pts;
}

/** Lattice radio mast with guy-less taper and a beacon box on top. */
function mast(B: MeshBuilder, x: number, gy: number, z: number, h: number) {
  const tint = 0x8a8c88;
  const base = 1.2;
  const legs = [0, 1, 2].map((i) => (i / 3) * Math.PI * 2);
  for (const a of legs) beam(B, [x + Math.cos(a) * base, gy - 0.5, z + Math.sin(a) * base], [x + Math.cos(a) * 0.35, gy + h, z + Math.sin(a) * 0.35], 0.12, 0.12, "metal_dark", tint, G);
  for (let y = 4; y < h; y += 6) {
    const k = base + (0.35 - base) * (y / h);
    for (let i = 0; i < 3; i++) {
      const a = legs[i], b = legs[(i + 1) % 3];
      beam(B, [x + Math.cos(a) * k, gy + y, z + Math.sin(a) * k], [x + Math.cos(b) * k, gy + y, z + Math.sin(b) * k], 0.06, 0.06, "metal_dark", tint, G);
    }
  }
  // Red/white bands on the top third.
  for (let y = h * 0.66; y < h - 1; y += 3) B.box("plain", x, gy + y + 0.75, z, 0.9, 1.5, 0.9, (Math.round(y / 3) & 1) ? 0xb03a2a : 0xd8d4c8, { group: G, noAo: true });
  B.box("glow", x, gy + h + 0.3, z, 0.5, 0.5, 0.5, 0xffffff, { group: G });
}

/** Farmstead: a gabled barn, a house, sometimes a silo. */
function farm(B: MeshBuilder, x: number, gy: number, z: number, yaw: number, r: () => number) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const P = (u: number, v: number): [number, number] => [x + u * c + v * s, z - u * s + v * c];
  const barn = (u: number, v: number, w: number, d: number, h: number, wall: number, roof: number) => {
    const [bx, bz] = P(u, v);
    B.box("plain", bx, gy + h / 2 - 0.5, bz, w, h + 1, d, wall, { group: G, rotY: yaw });
    // Gable roof: a triangular prism.
    // Three-sided cylinder laid along x, turned so one edge is the ridge (apex up).
    const geo = new THREE.CylinderGeometry(d * 0.62, d * 0.62, w, 3, 1, false).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2);
    geo.scale(1, 0.55, 1);
    B.add(geo, new THREE.Matrix4().makeRotationY(yaw).setPosition(bx, gy + h + d * 0.16, bz), "metal_corrugated", roof, { group: G, uv: "keep", uvScale: [w, d] });
    geo.dispose();
  };
  barn(0, 0, 18 + r() * 8, 10 + r() * 3, 6 + r() * 2, r() < 0.5 ? 0x8a3a2a : 0x9a9488, 0x6a6a64);
  barn(-16, 6, 9, 7, 4.5, 0xd8d0bc, 0x7a4a38);
  if (r() < 0.6) {
    const [sx, sz] = P(12, 10);
    cyl(B, sx, gy - 0.5, sz, 2.4, 2.4, 13, 12, "metal_painted", 0xc8c8c0);
    cone(B, sx, gy + 12.5, sz, 2.5, 1.6, 12, 0x8a8a84);
  }
}

/** Copse / hedgerow clump: a few faceted blobs on a dark base. */
function clump(B: MeshBuilder, x: number, gy: number, z: number, size: number, tint: number, r: () => number) {
  const n = 2 + Math.floor(r() * 4);
  for (let i = 0; i < n; i++) {
    const rad = size * (0.55 + r() * 0.6);
    const geo = new THREE.IcosahedronGeometry(rad, 0);
    geo.scale(1, 0.8 + r() * 0.5, 1);
    const ox = (r() - 0.5) * size * 2.2, oz = (r() - 0.5) * size * 2.2;
    const t = new THREE.Color(tint).multiplyScalar(0.8 + r() * 0.35);
    B.add(geo, new THREE.Matrix4().makeRotationY(r() * 6).setPosition(x + ox, gy + rad * 0.9 + size * 0.6, z + oz), "plain", t, { group: G, noAo: true });
    geo.dispose();
  }
}

type Spot = { x: number; z: number; rad: number };

/** Builds the skyline into `B` ("far" group). Returns the number of pieces placed. */
export function skyline(B: MeshBuilder, spec: SkylineSpec) {
  const r = rnd(spec.seed);
  const k = SKYLINE_DETAIL[spec.quality];
  const H = spec.height;
  const placed: Spot[] = [];
  const [a0, a1] = spec.sector ?? [-Math.PI, Math.PI];
  let pieces = 0;
  const spot = (rad: number, rMin = spec.rMin, rMax = spec.rMax): { x: number; z: number; gy: number } | null => {
    for (let tries = 0; tries < 24; tries++) {
      const a = a0 + r() * (a1 - a0);
      const d = rMin + r() * (rMax - rMin);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (spec.keepOut?.(x, z)) continue;
      if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.rad + rad)) continue;
      placed.push({ x, z, rad });
      // Lowest ground under the footprint so nothing floats on slopes.
      let gy = Infinity;
      for (const [sx, sz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) gy = Math.min(gy, H(x + sx * rad * 0.7, z + sz * rad * 0.7));
      pieces++;
      return { x, z, gy };
    }
    return null;
  };
  const count = (n: number | undefined) => Math.round((n ?? 0) * k);

  if (spec.ridge) {
    const g = spec.ridge;
    if (g.far) ridge(B, H, g.far.r, (g.depth ?? 60) * 1.4, g.far.h, g.far.tint, !!g.mesa, spec.seed + 101, spec.sector);
    ridge(B, H, g.r, g.depth ?? 60, g.h, g.tint, !!g.mesa, spec.seed + 7, spec.sector);
  }
  for (let i = 0; i < count(spec.stacks); i++) {
    const p = spot(8);
    if (p) stack(B, p.x, p.gy, p.z, 26 + r() * 24, r);
  }
  for (let i = 0; i < count(spec.tanks); i++) {
    // Tank farms: a few tanks clustered round one spot.
    const p = spot(26);
    if (!p) continue;
    const n = 2 + Math.floor(r() * 3);
    for (let j = 0; j < n; j++) {
      const rad = 5 + r() * 6;
      const a = (j / n) * Math.PI * 2 + r();
      const x = p.x + Math.cos(a) * 14, z = p.z + Math.sin(a) * 14;
      tank(B, x, H(x, z), z, rad, 7 + r() * 7, r);
    }
  }
  for (let i = 0; i < count(spec.silos); i++) {
    const p = spot(12);
    if (p) silos(B, p.x, p.gy, p.z, r() * Math.PI, r);
  }
  for (let i = 0; i < count(spec.waterTowers); i++) {
    const p = spot(6);
    if (p) waterTower(B, p.x, p.gy, p.z, r);
  }
  for (let i = 0; i < count(spec.masts); i++) {
    const p = spot(4);
    if (p) mast(B, p.x, p.gy, p.z, 38 + r() * 26);
  }
  for (let i = 0; i < count(spec.farms); i++) {
    const p = spot(24);
    if (p) farm(B, p.x, p.gy, p.z, r() * Math.PI, r);
  }
  for (let i = 0; i < count(spec.blocks); i++) {
    const w = 9 + r() * 10, d = 8 + r() * 8;
    const p = spot(Math.max(w, d) * 0.75);
    if (p) silhouette(B, p.x, p.z, w, d, 6 + Math.floor(r() * 4) * 3.1, p.gy, Math.floor(r() * 1e6));
  }
  if (spec.trees) {
    // Hedgerows: lines of clumps along random chords.
    const rows = Math.max(1, Math.round(count(spec.trees) / 8));
    for (let i = 0; i < rows; i++) {
      const p = spot(4);
      if (!p) continue;
      const yaw = r() * Math.PI;
      const n = 5 + Math.floor(r() * 7);
      for (let j = 0; j < n; j++) {
        const x = p.x + Math.cos(yaw) * j * 9, z = p.z + Math.sin(yaw) * j * 9;
        const d = Math.hypot(x, z);
        if (d < spec.rMin - 10 || spec.keepOut?.(x, z) || r() < 0.15) continue;
        clump(B, x, H(x, z), z, 3 + r() * 2.5, spec.treeTint ?? 0x4a5236, r);
      }
    }
  }
  if (spec.pylons) {
    // A transmission line on a chord of the ring, pylon every `spacing` metres.
    const { angle, offset } = spec.pylons;
    const sp = spec.pylons.spacing ?? 70;
    const dx = Math.cos(angle), dz = Math.sin(angle);
    const nx = -dz, nz = dx;
    const half = Math.sqrt(Math.max(0, spec.rMax * spec.rMax - offset * offset));
    let prev: THREE.Vector3[] | null = null;
    for (let t = -half; t <= half; t += sp) {
      const x = nx * offset + dx * t, z = nz * offset + dz * t;
      if (Math.hypot(x, z) < spec.rMin * 0.8 || spec.keepOut?.(x, z)) {
        prev = null;
        continue;
      }
      const pts = pylon(B, x, H(x, z), z, -angle, 24 + (Math.round(t) & 3));
      pieces++;
      if (prev) {
        for (let w = 0; w < pts.length; w++) {
          const geo = makeWireGeometry(prev[w], pts[w], 3.2, 0.05, 10);
          B.add(geo, null, "plain", 0x2a2a2a, { group: G, uv: "keep", noAo: true });
          geo.dispose();
        }
      }
      prev = pts;
    }
  }
  return pieces;
}
