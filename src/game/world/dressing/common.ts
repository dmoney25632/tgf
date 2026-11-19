import * as THREE from "three";
import type { QualityName, QualityPreset } from "../../config";
import type { WorldMaterials } from "../WorldMaterials";
import type { MapBox, MapDef } from "../MapLoader";
import type { MeshBuilder } from "../MeshBuilder";
import { makeWireGeometry } from "../MeshBuilder";
import type { ModelPlacer } from "../Props";
import type { StyleKit } from "../BoxStyles";
import { drawBox, drawPole, poleWirePoints } from "../BoxStyles";
import type { TerrainSpec } from "../Terrain";
import type { FoliageSpec } from "../Foliage";

export type DressingKit = {
  def: MapDef;
  builder: MeshBuilder;
  props: ModelPlacer;
  style: StyleKit;
  quality: QualityPreset;
  materials: WorldMaterials;
  windTime: { value: number };
  /** Real (pooled) light sources; register only the few that matter most. */
  addLamp?: (position: THREE.Vector3, color?: THREE.ColorRepresentation, intensity?: number, distance?: number) => void;
};

/** A self-contained animated/instanced extra (smoke columns, palms...). */
export type WorldExtra = {
  object: THREE.Object3D;
  update?(camera: THREE.Camera): void;
  setQuality?(q: QualityName): void;
  triangles?: number;
  dispose(): void;
};

export type DressingPlan = { terrain: TerrainSpec; foliage: FoliageSpec; extras?: WorldExtra[] };
export type Dressing = (kit: DressingKit) => DressingPlan;

export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 1 inside |v| < w·0.6, fading to 0 at w. */
export const band = (v: number, w: number) => 1 - smoothstep(w * 0.6, w, Math.abs(v));

function hash(ix: number, iz: number) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1]. */
export function noise2(x: number, z: number) {
  const x0 = Math.floor(x), z0 = Math.floor(z);
  const fx = x - x0, fz = z - z0;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash(x0, z0), b = hash(x0 + 1, z0), c = hash(x0, z0 + 1), d = hash(x0 + 1, z0 + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

export function fbm2(x: number, z: number, octaves = 4) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < octaves; i++) {
    s += noise2(x, z) * a;
    n += a;
    x = x * 2.03 + 17.1;
    z = z * 2.03 - 9.7;
    a *= 0.5;
  }
  return s / n;
}

/** Is (x, z) at least `margin` away from every solid map box footprint? */
export function clearOf(boxes: MapBox[], x: number, z: number, margin: number) {
  for (const b of boxes) {
    if (b.decor) continue;
    if (Math.abs(x - b.x) < b.w / 2 + margin && Math.abs(z - b.z) < b.d / 2 + margin) return false;
  }
  return true;
}

/** Sagging wires between two poles' cross-arms (matched across the span). */
export function wireSpan(B: MeshBuilder, a: THREE.Vector3[], b: THREE.Vector3[], sag: number) {
  const dir = new THREE.Vector3().subVectors(b[1] ?? b[0], a[1] ?? a[0]);
  const perp = new THREE.Vector3(dir.z, 0, -dir.x).normalize();
  const sa = [...a].sort((p, q) => p.dot(perp) - q.dot(perp));
  const sb = [...b].sort((p, q) => p.dot(perp) - q.dot(perp));
  const n = Math.min(sa.length, sb.length);
  for (let i = 0; i < n; i++) {
    const geo = makeWireGeometry(sa[i], sb[i], sag * (0.9 + i * 0.08));
    B.add(geo, null, "plain", 0x1e1f1f, { uv: "keep" });
    geo.dispose();
  }
}

export type PoleSpot = { x: number; y: number; z: number; rotY: number };

/** Draws a run of poles (decor) and wires; returns their attachment points. */
export function poleLine(B: MeshBuilder, poles: PoleSpot[], r: () => number, sag = 0.9, draw = true) {
  const pts = poles.map((p) => poleWirePoints(p.x, p.y, p.z, p.rotY));
  poles.forEach((p) => draw && drawPole(B, p.x, p.y, p.z, p.rotY, r));
  for (let i = 1; i < poles.length; i++) wireSpan(B, pts[i - 1], pts[i], sag);
  return pts;
}

/** Post-and-rail fence from a to b, following the ground, with a few broken rails. */
export function fence(B: MeshBuilder, ax: number, az: number, bx: number, bz: number, height: (x: number, z: number) => number, r: () => number) {
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.round(len / 2.6));
  const yaw = Math.atan2(-(bz - az), bx - ax);
  const tint = new THREE.Color(0xb7a993);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    if (r() < 0.06) continue; // missing post
    const y = height(x, z);
    B.box("wood", x, y + 0.6, z, 0.12, 1.35, 0.12, tint.clone().multiplyScalar(0.8 + r() * 0.3), { rotX: (r() - 0.5) * 0.12, rotZ: (r() - 0.5) * 0.12 });
    if (i === n) continue;
    const t2 = (i + 1) / n;
    const x2 = ax + (bx - ax) * t2, z2 = az + (bz - az) * t2;
    const y2 = height(x2, z2);
    const segL = len / n;
    const pitch = Math.atan2(y2 - y, segL);
    for (const ry of [0.55, 1.05]) {
      if (r() < 0.12) continue; // broken rail
      const droop = r() < 0.08 ? 0.35 : 0;
      B.box("wood", (x + x2) / 2, (y + y2) / 2 + ry - droop * 0.5, (z + z2) / 2, segL + 0.1, 0.09, 0.05, tint.clone().multiplyScalar(0.75 + r() * 0.3), { rotY: yaw, rotZ: pitch + (droop ? 0.25 : 0), rot90: true });
    }
  }
}

/** Small concrete/brick chunks scattered around a point. */
export function rubble(B: MeshBuilder, cx: number, cz: number, radius: number, count: number, r: () => number, boxes: MapBox[]) {
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * radius;
    const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    if (!clearOf(boxes, x, z, 0.05)) continue;
    const s = 0.08 + r() * r() * 0.3;
    const brick = r() < 0.4;
    B.box(brick ? "brick" : "concrete_dirty", x, s * 0.3, z, s * (1 + r()), s * (0.5 + r() * 0.5), s * (0.8 + r() * 0.6), brick ? 0xd0c4b8 : 0xbdb8ac, {
      rotY: r() * 6.28, rotX: (r() - 0.5) * 0.6, rotZ: (r() - 0.5) * 0.6, uvOffset: [r() * 4, r() * 4],
    });
  }
}

/** A stack of wooden pallets. */
export function pallets(B: MeshBuilder, x: number, z: number, rotY: number, stack: number, r: () => number) {
  const m = new THREE.Matrix4();
  const unit = new THREE.BoxGeometry(1, 1, 1);
  for (let k = 0; k < stack; k++) {
    const tint = new THREE.Color(0xc9b896).multiplyScalar(0.8 + r() * 0.3);
    const place = new THREE.Matrix4().compose(
      new THREE.Vector3(x + (r() - 0.5) * 0.08, k * 0.145, z + (r() - 0.5) * 0.08),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY + (r() - 0.5) * 0.1),
      new THREE.Vector3(1, 1, 1),
    );
    const piece = (px: number, py: number, pz: number, w: number, h: number, d: number) => {
      m.compose(new THREE.Vector3(px, py, pz), new THREE.Quaternion(), new THREE.Vector3(w, h, d));
      B.add(unit, place.clone().multiply(m), "wood", tint, { uvOffset: [r() * 3, r() * 3] });
    };
    for (const sx of [-0.5, 0, 0.5]) piece(sx, 0.05, 0, 0.1, 0.09, 1.0);
    for (let i = 0; i < 5; i++) if (r() > 0.08) piece(0, 0.115, -0.45 + i * 0.225, 1.2, 0.025, 0.12);
  }
  unit.dispose();
}

/** Old tyre lying flat or on its side. */
export function tyre(B: MeshBuilder, x: number, z: number, onSide: boolean, r: () => number) {
  const geo = new THREE.TorusGeometry(0.32, 0.13, 6, 14);
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, onSide ? 0.45 : 0.12, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(onSide ? 0 : Math.PI / 2, r() * 6, 0)),
    new THREE.Vector3(1, 1, 1),
  );
  B.add(geo, m, "plain", 0x2a2a28, { uv: "keep", uvScale: [2, 0.8] });
  geo.dispose();
}

/** Concertina (razor) wire coil along a line at height y. */
export function concertina(B: MeshBuilder, ax: number, az: number, bx: number, bz: number, y: number, radius = 0.3) {
  const len = Math.hypot(bx - ax, bz - az);
  const dx = (bx - ax) / len, dz = (bz - az) / len;
  const pitch = 0.45;
  const loops = Math.max(1, Math.round(len / pitch));
  class Coil extends THREE.Curve<THREE.Vector3> {
    constructor() {
      super();
    }
    getPoint(t: number, target = new THREE.Vector3()) {
      const a = t * loops * Math.PI * 2;
      const along = t * len;
      return target.set(ax + dx * along + -dz * Math.cos(a) * radius, y + Math.sin(a) * radius * 0.9, az + dz * along + dx * Math.cos(a) * radius);
    }
  }
  const geo = new THREE.TubeGeometry(new Coil(), loops * 6, 0.009, 3, false);
  B.add(geo, null, "metal_dark", 0x8a8a86, { uv: "keep" });
  geo.dispose();
}

/** Draws a box through its style (handy for decor sandbags, crates, etc.). */
export function decorBox(kit: DressingKit, b: Omit<MapBox, "decor">) {
  drawBox(kit.style, { ...b, decor: true });
}

/** Scatter trees in a ring, avoiding a keep-out test. */
export function scatterTrees(
  count: number,
  rMin: number,
  rMax: number,
  r: () => number,
  keepOut: (x: number, z: number) => boolean,
  variants = [0, 1, 2, 3],
) {
  const out: { x: number; z: number; scale: number; variant: number; rot: number }[] = [];
  let guard = 0;
  while (out.length < count && guard++ < count * 40) {
    const x = (r() * 2 - 1) * rMax, z = (r() * 2 - 1) * rMax;
    const d = Math.max(Math.abs(x), Math.abs(z));
    if (d < rMin || keepOut(x, z)) continue;
    // Clumped: keep mostly where low-frequency noise is high (copses, hedgerows).
    if (fbm2(x * 0.025 + 5, z * 0.025 - 3, 3) < 0.45 + r() * 0.12) continue;
    out.push({ x, z, scale: 0.85 + r() * 0.5, variant: variants[Math.floor(r() * variants.length)], rot: r() * Math.PI * 2 });
  }
  return out;
}
