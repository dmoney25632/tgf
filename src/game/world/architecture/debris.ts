import * as THREE from "three";
import type { MeshBuilder } from "../MeshBuilder";
import type { WorldMat } from "../WorldMaterials";
import { decal, groundDecal, rod } from "./kit";

function rnd(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A few low-poly broken-concrete chunk shapes (shared, ~20 tris each). */
const chunkCache: THREE.BufferGeometry[] = [];
function chunk(i: number) {
  if (!chunkCache.length) {
    for (let k = 0; k < 4; k++) {
      const r = rnd(100 + k);
      const g = new THREE.DodecahedronGeometry(0.5, 0);
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let v = 0; v < p.count; v++) {
        // Squash and facet: slabby, angular lumps.
        const x = p.getX(v), y = p.getY(v), z = p.getZ(v);
        const key = Math.round((x + 2) * 97 + (y + 2) * 31 + (z + 2) * 7);
        const j = 0.75 + ((Math.sin(key * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1 * 0.5;
        p.setXYZ(v, x * j * (1 + r() * 0.0), y * j * 0.6, z * j);
      }
      g.computeVertexNormals();
      chunkCache.push(g);
    }
  }
  return chunkCache[i % chunkCache.length];
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Scattered broken chunks, bricks and grit within a radius. */
export function debrisScatter(B: MeshBuilder, x: number, z: number, radius: number, count: number, seed: number, group: string, ground: (x: number, z: number) => number = () => 0, keep?: (x: number, z: number) => boolean) {
  const r = rnd(seed);
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * radius;
    const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    if (keep && !keep(px, pz)) continue;
    const gy = ground(px, pz);
    const k = r();
    if (k < 0.3) {
      // Brick (some still with mortar/plaster on).
      B.box("rubble", px, gy + 0.03, pz, 0.22, 0.065, 0.1, r() < 0.5 ? 0xd8a080 : 0xb88a70, { group, rotY: r() * 6, rotX: (r() - 0.5) * 0.5, rotZ: (r() - 0.5) * 0.5, uvOffset: [r() * 3, r() * 3] });
    } else {
      const s = 0.08 + r() * r() * 0.45;
      _e.set((r() - 0.5) * 0.8, r() * 6, (r() - 0.5) * 0.8);
      _m.compose(_p.set(px, gy + s * 0.18, pz), _q.setFromEuler(_e), _s.set(s * (1 + r()), s, s * (0.8 + r() * 0.6)));
      // One material for all loose debris keeps each clutter cell to a single draw call.
      const tint = r() < 0.3 ? new THREE.Color(0xe6dccb) : new THREE.Color(0xc8c2b6);
      B.add(chunk(i), _m, "rubble", tint.multiplyScalar(0.75 + r() * 0.3), { group, uvOffset: [r() * 4, r() * 4] });
    }
  }
}

/**
 * Rubble heap: a lumpy mound textured as rubble, studded with chunks and
 * bricks, a few rebar spikes, grit decal skirt. Footprint ~ (rx, rz), height h.
 */
export function rubblePile(B: MeshBuilder, x: number, z: number, rx: number, rz: number, h: number, seed: number, group = "decor", ground: (x: number, z: number) => number = () => 0, chunks = 1) {
  const r = rnd(seed);
  const geo = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = geo.attributes.position as THREE.BufferAttribute;
  const ph = r() * 10;
  for (let i = 0; i < p.count; i++) {
    const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
    const n = 1 + 0.22 * Math.sin(vx * 5 + ph) * Math.cos(vz * 4 - ph) + 0.12 * Math.sin(vy * 9 + vx * 3);
    // Flatter, slumped profile (scree slope), lowest ring sunk into the ground.
    const yy = Math.pow(Math.max(0, vy), 1.4) * n;
    p.setXYZ(i, vx * n, vy < 0.05 ? -0.15 : yy, vz * n);
  }
  geo.computeVertexNormals();
  const gy = ground(x, z);
  _m.compose(_p.set(x, gy, z), _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6), _s.set(rx, h, rz));
  B.add(geo, _m, "rubble", 0xc4bcae, { group, uv: "world", uvOffset: [r() * 4, r() * 4] });
  geo.dispose();
  debrisScatter(B, x, z, Math.max(rx, rz) * 1.15, Math.round(18 * chunks * (rx * rz) / 2), seed + 1, group, (px, pz) => {
    // Sit chunks on the mound surface (approximate the dome).
    const dx = (px - x) / rx, dz = (pz - z) / rz;
    const d2 = dx * dx + dz * dz;
    return ground(px, pz) + (d2 < 1 ? h * Math.pow(1 - d2, 0.7) * 0.9 : 0);
  });
  const fixed = group.startsWith("clutter") ? "decor" : group;
  for (let i = 0; i < 3; i++) {
    const a = r() * 6.28, d = r() * 0.5;
    const b = new THREE.Vector3(x + Math.cos(a) * rx * d, gy + h * 0.7, z + Math.sin(a) * rz * d);
    rod(B, b, b.clone().add(new THREE.Vector3((r() - 0.5) * 0.8, 0.4 + r() * 0.6, (r() - 0.5) * 0.8)), 0.008, 0x5a3a28, fixed, "metal_rust");
  }
  groundDecal(B, "specks", x, z, rx * 3.2, rz * 3.2, r() * 6, 0xffffff, ground, fixed);
}

/** Scattered paper sheets, cans and plastic litter. */
export function litter(B: MeshBuilder, x: number, z: number, radius: number, count: number, seed: number, group: string, keep?: (x: number, z: number) => boolean) {
  const r = rnd(seed);
  const can = new THREE.CylinderGeometry(0.033, 0.033, 0.12, 7);
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * radius;
    const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    if (keep && !keep(px, pz)) continue;
    const k = r();
    if (k < 0.55) {
      const yaw = r() * 6.28;
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const tilt = (r() - 0.5) * 0.3;
      decal(B, "paper", new THREE.Vector3(px, 0.018 + r() * 0.01, pz), right, fwd.clone().negate().add(new THREE.Vector3(0, tilt, 0)).normalize(), 0.24, 0.3, new THREE.Color(1, 1, 1).multiplyScalar(0.7 + r() * 0.3), group);
    } else {
      _e.set(Math.PI / 2, r() * 6, 0);
      _m.compose(_p.set(px, 0.033, pz), _q.setFromEuler(_e), _s.set(1, r() < 0.3 ? 0.6 : 1, 1));
      const cols = [0x9a3a2a, 0x3a6a8a, 0xb8b8b0, 0x5a7a3a, 0xc8a040];
      B.add(can, _m, "metal_painted", cols[Math.floor(r() * cols.length)], { group, uv: "keep", noAo: true });
    }
  }
  can.dispose();
}

/**
 * Burnt-out car or pickup shell: a side profile extruded across the width
 * with the windows cut through (gutted cabin), charred and rusted, sitting
 * low on bare rims, with a scorch mark under it.
 */
export function burntCar(B: MeshBuilder, x: number, z: number, yaw: number, kind: "sedan" | "pickup", seed: number, group = "decor", gy = 0) {
  const r = rnd(seed);
  const L = kind === "sedan" ? 4.4 : 5.0, W = 1.78;
  const hl = L / 2;
  const s = new THREE.Shape();
  if (kind === "sedan") {
    s.moveTo(-hl, 0.28);
    s.lineTo(hl, 0.28);
    s.lineTo(hl + 0.05, 0.62);
    s.lineTo(hl - 0.15, 0.82);
    s.lineTo(1.0, 0.9);
    s.lineTo(0.45, 1.36);
    s.lineTo(-0.85, 1.38);
    s.lineTo(-1.55, 0.98);
    s.lineTo(-hl + 0.05, 0.92);
    s.lineTo(-hl - 0.03, 0.55);
    s.closePath();
    const win = new THREE.Path();
    win.moveTo(0.35, 0.98);
    win.lineTo(0.38, 1.27);
    win.lineTo(-0.15, 1.29);
    win.lineTo(-0.15, 0.98);
    win.closePath();
    const win2 = new THREE.Path();
    win2.moveTo(-0.27, 0.98);
    win2.lineTo(-0.27, 1.29);
    win2.lineTo(-0.82, 1.29);
    win2.lineTo(-1.32, 0.98);
    win2.closePath();
    s.holes.push(win, win2);
  } else {
    s.moveTo(-hl, 0.35);
    s.lineTo(hl, 0.35);
    s.lineTo(hl + 0.05, 0.75);
    s.lineTo(hl - 0.1, 0.98);
    s.lineTo(1.25, 1.02);
    s.lineTo(0.75, 1.62);
    s.lineTo(-0.35, 1.64);
    s.lineTo(-0.45, 1.02);
    s.lineTo(-hl, 1.0);
    s.closePath();
    const win = new THREE.Path();
    win.moveTo(0.65, 1.1);
    win.lineTo(0.68, 1.52);
    win.lineTo(-0.3, 1.54);
    win.lineTo(-0.33, 1.1);
    win.closePath();
    s.holes.push(win);
  }
  const geo = new THREE.ExtrudeGeometry(s, { depth: W, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 1 });
  geo.translate(0, 0, -W / 2);
  const sink = 0.12 + r() * 0.1;
  const tilt = (r() - 0.5) * 0.06;
  const base = new THREE.Matrix4().compose(new THREE.Vector3(x, gy - sink, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, yaw, (r() - 0.5) * 0.05)), new THREE.Vector3(1, 1, 1));
  const charred = new THREE.Color(0x5a4a40).lerp(new THREE.Color(0x8a5a3a), r() * 0.6);
  B.add(geo, base, "metal_rust", charred, { group, uvOffset: [r() * 3, r() * 3] });
  geo.dispose();
  // Pickup bed walls (open box) and a dark gutted interior floor.
  const local = (px: number, py: number, pz: number, w: number, h: number, d: number, mat: WorldMat, tint: THREE.ColorRepresentation) => {
    const m = base.clone().multiply(new THREE.Matrix4().makeTranslation(px, py, pz)).multiply(new THREE.Matrix4().makeScale(w, h, d));
    const unit = new THREE.BoxGeometry(1, 1, 1);
    B.add(unit, m, mat, tint, { group });
    unit.dispose();
  };
  local(0, 0.5, 0, L - 0.2, 0.05, W - 0.1, "metal_dark", 0x1c1a18);
  if (kind === "pickup") {
    local(-hl + 1.6, 0.72, 0, 3.0, 0.04, W - 0.06, "metal_rust", charred);
  }
  // Bare rims.
  const rim = new THREE.CylinderGeometry(0.24, 0.24, 0.16, 10).rotateX(Math.PI / 2);
  for (const ax of [-hl + 0.85, hl - 0.8]) for (const sz of [-1, 1]) {
    const m = base.clone().multiply(new THREE.Matrix4().makeTranslation(ax, 0.26, sz * (W / 2 - 0.05)));
    B.add(rim, m, "metal_rust", 0x4a3a30, { group, uv: "keep" });
  }
  rim.dispose();
  groundDecal(B, "burn", x, z, L * 1.4, L * 1.1, yaw, 0xffffff, undefined, group);
  // Glass crumbs / debris around.
  debrisScatter(B, x, z, L * 0.7, 10, seed + 9, group, () => gy);
}
