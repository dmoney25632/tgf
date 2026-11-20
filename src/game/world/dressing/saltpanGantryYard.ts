import * as THREE from "three";
import type { MeshBuilder } from "../MeshBuilder";
import type { MapBox } from "../MapLoader";
import { decal, groundDecal, groundPatch, pendantLamp, wallDecal } from "../architecture/kit";
import { facades } from "../architecture/Building";
import { BAYS, BUNKER, CRANE, HEAPS, HUNG, PANS, PUMPHOUSE, SCRAP, SILOS, TRUCK, WALL, GALLERY2 } from "../maps/saltpanGantry";
import { beam, cladWall, faceDecal, handrail, hColumn, ladder, PAINT, put, tube, xBay, type Rnd, type V3 } from "./saltpanGantryKit";
import { tyre, type DressingKit } from "./common";

const CRANE_PAINT = 0xa88a4a;
const CRANE_RUST = 0x8a5e3c;

/** Precast interlocking concrete blocks along a line (1.6 × 0.8 × 0.8), staggered courses. */
function blockWall(B: MeshBuilder, r: Rnd, ax: number, az: number, bx: number, bz: number, nx: number, nz: number, courses: number, group = "decor") {
  const len = Math.hypot(bx - ax, bz - az);
  const tx = (bx - ax) / len, tz = (bz - az) / len;
  const yaw = Math.atan2(-tz, tx);
  for (let c = 0; c < courses; c++) {
    const off = c % 2 ? 0.8 : 0;
    for (let u = -off; u < len - 0.01; u += 1.6) {
      const u0 = Math.max(0, u), u1 = Math.min(len, u + 1.6);
      if (u1 - u0 < 0.05) continue;
      const m = (u0 + u1) / 2;
      const inset = r() * 0.03;
      const tint = new THREE.Color(PAINT.concrete).multiplyScalar(0.84 + r() * 0.22);
      B.box("concrete_dirty", ax + tx * m - nx * (0.4 + inset), c * 0.8 + 0.4, az + tz * m - nz * (0.4 + inset), u1 - u0 - 0.03, 0.78, 0.8, tint, { group, rotY: yaw, uvOffset: [r() * 5, r() * 5] });
    }
  }
}

/** Conical stockpile of loose material (salt, aggregate): crest, repose slopes, a dirty toe. */
function heap(B: MeshBuilder, x: number, z: number, rx: number, rz: number, h: number, tint: number, seed: number, mat: "plaster" | "gravel" = "plaster", y0 = 0) {
  const seg = 28, rings = 7;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const nz = (a: number, k: number) => Math.sin(a * 3 + seed) * 0.07 + Math.sin(a * 7 - seed * 1.3 + k) * 0.04 + Math.sin(a * 13 + seed * 2.1) * 0.025;
  pos.push(x, y0 + h, z);
  col.push(1, 1, 1);
  for (let k = 1; k <= rings; k++) {
    const f = k / rings;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const rr = f * (1 + nz(a, k));
      // Rounded crest, straight repose slope, flared toe.
      const y = h * Math.max(0, 1 - Math.pow(f, 1.15)) * (1 + nz(a + 1, k) * 0.6) - (k === rings ? 0.05 : 0);
      pos.push(x + Math.cos(a) * rx * rr, y0 + y, z + Math.sin(a) * rz * rr);
      const dirt = k >= rings - 1 ? 0.78 : 0.94 + 0.06 * Math.sin(a * 5 + k);
      col.push(dirt, dirt * 0.98, dirt * 0.95);
    }
  }
  for (let i = 0; i < seg; i++) idx.push(0, 1 + ((i + 1) % seg), 1 + i);
  for (let k = 1; k < rings; k++) {
    for (let i = 0; i < seg; i++) {
      const a = 1 + (k - 1) * seg + i, b = 1 + (k - 1) * seg + ((i + 1) % seg);
      const c = a + seg, d = b + seg;
      idx.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  if (geo.attributes.normal.getY(0) < 0) {
    const ix = geo.index!.array as unknown as number[];
    for (let i = 0; i < ix.length; i += 3) [ix[i + 1], ix[i + 2]] = [ix[i + 2], ix[i + 1]];
    geo.computeVertexNormals();
  }
  B.add(geo, null, mat, tint);
  geo.dispose();
}

/**
 * Yard set pieces: the perimeter block wall, silo battery, stockpile bays,
 * gantry crane, bunker and pump house trim, the haul truck, scrap heaps,
 * evaporation pans, brine pipes and the scaffold sniper perches.
 */
export function buildYard(kit: DressingKit, r: Rnd, detail: number) {
  const B = kit.builder;
  const boxes = kit.def.boxes;
  const tagged = (t: string) => boxes.filter((b) => b.tag === t);
  const W = WALL.inner;

  // ---- Perimeter: six courses of blocks, earth fill on top, grime ----------------------
  blockWall(B, r, -W, -W, W, -W, 0, 1, 6);
  blockWall(B, r, W, -W, W, W, -1, 0, 6);
  blockWall(B, r, W, W, -W, W, 0, -1, 6);
  blockWall(B, r, -W, W, -W, -W, 1, 0, 6);
  for (const s of [-1, 1]) {
    B.box("gravel", 0, WALL.h - 0.1, s * (W + 2.4), 2 * W + 9.6, 0.4, 3.2, 0xb8a888);
    B.box("gravel", s * (W + 2.4), WALL.h - 0.1, 0, 3.2, 0.4, 2 * W + 3.2, 0xb8a888);
  }
  for (let i = 0; i < 26; i++) {
    const side = i % 4, a = (r() * 2 - 1) * (W - 2);
    const [x, z, nx, nz] = side === 0 ? [a, -W, 0, 1] : side === 1 ? [W, a, -1, 0] : side === 2 ? [a, W, 0, -1] : [-W, a, 1, 0];
    faceDecal(B, "leak", x, WALL.h - 1.3, z, nx, nz, 0.8 + r() * 1.2, 2.4, r() < 0.5 ? 0xffffff : 0xa08a6a);
    faceDecal(B, "baseDirt", x + nz * 3, 0.55, z + nx * 3, nx, nz, 6 + r() * 4, 1.1, 0xffffff);
    groundDecal(B, "sand", x + nx * 1.1, z + nz * 1.1, nz ? 7 : 2.4, nz ? 2.4 : 7, 0, 0xd8c8a4);
  }

  // ---- Silos --------------------------------------------------------------------------
  const roofY = (s: (typeof SILOS)[number]) => s.h + 1.5;
  SILOS.forEach((s, i) => {
    put(B, new THREE.CylinderGeometry(s.r + 0.5, s.r + 0.6, 0.4, 32), s.x, 0.2, s.z, 0, 0, 0, "concrete_dirty", 0xb9b2a4, "decor", [s.r * 6, 1]);
    const tint = i === 1 ? 0xc8c2b4 : i === 0 ? 0xa87a5a : 0xb89272;
    const mat = i === 1 ? "metal_corrugated" : "corrugated_rust";
    put(B, new THREE.CylinderGeometry(s.r, s.r, s.h, 36, 1, true), s.x, s.h / 2 + 0.4, s.z, 0, r() * 6, 0, mat, tint, "decor", [s.r * 6.28, s.h]);
    put(B, new THREE.CylinderGeometry(s.r + 0.02, s.r + 0.02, 1.6, 36, 1, true), s.x, 1.2, s.z, 0, 0, 0, "metal_rust", 0x6e4a34, "decor", [s.r * 6.28, 1.6]);
    for (let y = 1.2; y < s.h; y += 2.2) put(B, new THREE.CylinderGeometry(s.r + 0.05, s.r + 0.05, 0.1, 36, 1, true), s.x, y + 0.4, s.z, 0, 0, 0, "metal_dark", 0x6a5a4c);
    put(B, new THREE.CylinderGeometry(0.45, s.r + 0.15, 1.5, 36), s.x, s.h + 0.4 + 0.75, s.z, 0, 0, 0, "metal_rust", 0x8a6248, "decor", [s.r * 6, 2]);
    put(B, new THREE.CylinderGeometry(0.5, 0.5, 0.5, 12), s.x, roofY(s) + 0.6, s.z, 0, 0, 0, "metal_dark", PAINT.dark);
    // Rust runs down the shells from the roof seam.
    for (let k = 0; k < 7; k++) {
      const a = r() * Math.PI * 2;
      const n = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const h = 3 + r() * 6;
      decal(B, "leak", new THREE.Vector3(s.x, s.h + 0.3 - h / 2, s.z).addScaledVector(n, s.r + 0.04), new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), n), new THREE.Vector3(0, 1, 0), 1 + r() * 1.2, h, 0xa86a3a);
    }
    // Discharge spout and slide gate at the base, facing the yard (+z).
    B.box("metal_rust", s.x, 0.9, s.z + s.r + 0.3, 0.7, 1.0, 0.6, 0x7e5236);
    faceDecal(B, "baseDirt", s.x, 0.6, s.z + s.r + 0.02, 0, 1, s.r * 2, 1.2, 0xffffff);
  });
  // Walkway across the silo tops, rails, caged ladder on the west silo.
  {
    const s0 = SILOS[0], s2 = SILOS[SILOS.length - 1];
    const y = roofY(s0) + 0.9, z = s0.z;
    B.box("metal_dark", (s0.x + s2.x) / 2, y, z, s2.x - s0.x + 4, 0.08, 1.2, PAINT.grating);
    for (const sz of [-0.6, 0.6]) {
      B.box("metal_painted", (s0.x + s2.x) / 2, y - 0.15, z + sz, s2.x - s0.x + 4, 0.22, 0.1, 0x7e5a44);
      handrail(B, [s0.x - 2, y, z + sz], [s2.x + 2, y, z + sz]);
    }
    for (const s of SILOS) for (const sz of [-0.5, 0.5]) beam(B, [s.x, roofY(s) + 0.4, z + sz], [s.x, y, z + sz], 0.1, 0.1, "metal_painted", 0x7e5a44);
    ladder(B, s0.x - s0.r - 0.25, s0.z, 0.4, y, -1, 0, PAINT.dark, true);
    // Head house where the gallery lands.
    const [gx, , gz] = GALLERY2.b;
    B.box("metal_dark", gx, y + 1.3, gz - 0.2, 2.4, 2.6, 2.6, 0x1e1c1a);
    cladWall(B, r, gx - 1.25, gz + 1.15, gx + 1.25, gz + 1.15, 0, 1, y, y + 2.7, { gaps: 0.05, streaks: 1 });
    cladWall(B, r, gx - 1.25, gz - 1.55, gx - 1.25, gz + 1.15, -1, 0, y, y + 2.7, { gaps: 0.05 });
    cladWall(B, r, gx + 1.25, gz + 1.15, gx + 1.25, gz - 1.55, 1, 0, y, y + 2.7, { gaps: 0.05 });
    B.box("corrugated_rust", gx, y + 2.75, gz - 0.2, 3.0, 0.1, 3.2, 0x9a6a4e);
    // Screw conveyor along the bases into a loading point.
    tube(B, [s0.x - 1, 2.6, s0.z + s0.r + 1.0], [s2.x + 3.5, 2.6, s0.z + s0.r + 1.0], 0.32, "metal_rust", 0x8a6248, 12);
    for (const s of SILOS) tube(B, [s.x, 1.4, s.z + s.r + 0.3], [s.x, 2.4, s.z + s.r + 1.0], 0.2, "metal_rust", 0x7e5236, 8);
    for (let x = s0.x; x <= s2.x + 3; x += 3.5) for (const sz of [-0.3, 0.3]) tube(B, [x, 0, s0.z + s0.r + 1.0 + sz], [x, 2.3, s0.z + s0.r + 1.0 + sz], 0.04, "metal_dark", PAINT.dark, 5);
  }

  // ---- Stockpile bays: block walls and heaps -------------------------------------------
  for (const b of tagged("bay")) {
    const alongX = b.w > b.d;
    const len = alongX ? b.w : b.d;
    const courses = Math.round(b.h / 0.8);
    if (alongX) blockWall(B, r, b.x - len / 2, b.z + 0.4, b.x + len / 2, b.z + 0.4, 0, 1, courses);
    else blockWall(B, r, b.x + 0.4, b.z - len / 2, b.x + 0.4, b.z + len / 2, 1, 0, courses);
  }
  HEAPS.forEach((h, i) => {
    const gravel = i === 2;
    heap(B, h.x, h.z - 0.4, h.w / 2 + 1.0, h.d / 2 + 1.2, h.h + 1.0, gravel ? 0xb4aa98 : 0xf4f2ee, i * 1.7 + 0.4, gravel ? "gravel" : "plaster");
    groundDecal(B, "specks", h.x, h.z + 3.6, 6.5, 3.5, 0, gravel ? 0xb8ae9c : 0xf4f0e8);
    groundDecal(B, "tracks", h.x + 0.5, h.z + 6.5, 2.6, 6, 0.1, 0xffffff);
  });
  void BAYS;

  // ---- Gantry crane ----------------------------------------------------------------------
  {
    const { x0, x1, z0, z1, h } = CRANE;
    const zm = (z0 + z1) / 2;
    // Rails on sleepers, the full run of the lane.
    for (const z of [z0, z1]) {
      B.box("metal_dark", (x0 + x1) / 2, 0.06, z, x1 - x0 + 10, 0.12, 0.14, 0x5a5650);
      for (let x = x0 - 5; x <= x1 + 5; x += 1.2) B.box("concrete_dirty", x, 0.03, z, 0.3, 0.06, 0.9, 0xa8a090);
    }
    for (const x of [x0, x1]) {
      for (const z of [z0, z1]) {
        B.box("metal_painted", x, h / 2 + 0.4, z, 0.8, h - 0.8, 0.8, CRANE_PAINT);
        for (const y of [3, 6.5, 10]) B.box("metal_dark", x, y, z, 0.86, 0.08, 0.86, CRANE_RUST);
        for (const nx of [-1, 1]) faceDecal(B, "leak", x + nx * 0.41, h - 3, z, nx, 0, 0.6, 5, 0xa86a3a);
      }
      // Sill beam with wheel bogies; end tie and knee braces at the top.
      B.box("metal_painted", x, 0.25, zm, 0.7, 0.4, z1 - z0 - 0.8, CRANE_PAINT);
      for (const z of [z0, z1]) B.box("metal_dark", x, 0.3, z, 1.2, 0.6, 1.6, 0x4a4642);
      B.box("metal_painted", x, h - 0.6, zm, 0.9, 1.2, z1 - z0 + 0.8, CRANE_PAINT);
      for (const z of [z0, z1]) beam(B, [x, h - 4.8, z], [x, h - 1.2, z + (z < zm ? 3.2 : -3.2)], 0.3, 0.3, "metal_painted", CRANE_PAINT);
    }
    // Twin box girders with rails, walkway and a rusty trolley.
    for (const z of [zm - 2.2, zm + 2.2]) {
      B.box("metal_painted", (x0 + x1) / 2, h + 0.7, z, x1 - x0 + 2.4, 1.4, 0.7, CRANE_PAINT);
      for (let k = 0; k < 7; k++) {
        const x = x0 + r() * (x1 - x0);
        faceDecal(B, "leak", x, h + 0.4, z + (z < zm ? -0.36 : 0.36), 0, z < zm ? -1 : 1, 1 + r(), 1.4, 0xa86a3a);
      }
    }
    B.box("metal_dark", (x0 + x1) / 2, h + 1.42, zm - 2.95, x1 - x0 + 2.4, 0.05, 0.8, PAINT.grating);
    handrail(B, [x0 - 1.2, h + 1.45, zm - 3.3], [x1 + 1.2, h + 1.45, zm - 3.3]);
    const tx = HUNG.x;
    B.box("metal_rust", tx, h + 2.0, zm, 3.2, 1.2, 5.2, CRANE_RUST);
    B.box("corrugated_rust", tx + 0.3, h + 2.7, zm, 3.6, 0.1, 5.5, 0x9a6a4e);
    // Cables down to the spreader holding the container.
    const sy = HUNG.y + 2.6 + 0.35;
    B.box("metal_painted", HUNG.x, sy, HUNG.z, 6.2, 0.3, 2.5, 0xb89a3a);
    for (const dx of [-2.2, 2.2]) for (const dz of [-0.8, 0.8]) tube(B, [tx + dx * 0.4, h + 1.4, zm + dz], [HUNG.x + dx, sy + 0.15, HUNG.z + dz], 0.025, "metal_dark", 0x2a2826, 4);
    for (const dx of [-2.9, 2.9]) for (const dz of [-1.1, 1.1]) B.box("metal_dark", HUNG.x + dx, sy - 0.25, HUNG.z + dz, 0.12, 0.22, 0.12, 0x2a2826);
    // Operator cab on the NW leg.
    B.box("metal_painted", x0 + 1.25, 8.6, z0 + 0.2, 1.6, 2.0, 1.6, 0xb8a888);
    B.box("plain", x0 + 1.25, 9.0, z0 - 0.62, 1.4, 0.8, 0.02, 0x2a2e30);
    B.box("plain", x0 + 2.06, 9.0, z0 + 0.2, 0.02, 0.8, 1.4, 0x343a3c);
    ladder(B, x0 - 0.65, z1, 0.1, h + 1.4, -1, 0, PAINT.dark, true);
  }

  // ---- Bunker, pump house trim ------------------------------------------------------------
  {
    const b = BUNKER;
    const fs = facades(b.x, b.z, b.w, b.d, 0);
    fs.forEach((f, k) => {
      const len = k % 2 ? b.d : b.w;
      wallDecal(B, f, "baseDirt", len / 2, 0.6, len, 1.2);
      wallDecal(B, f, "pocks", len / 2 + (r() - 0.5) * 2, 1.3, 2, 1.2);
      wallDecal(B, f, "leak", len / 2 + (r() - 0.5) * 2, 1.6, 1.2, 1.6);
    });
    // Sandbags on the roof edge, a vent, and a blast door frame.
    for (let k = 0; k < 9; k++) {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(b.x - 3 + k * 0.72, b.h + 0.45, b.z + b.d / 2 - 0.1), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (r() - 0.5) * 0.3), new THREE.Vector3(0.66, 0.2, 0.4));
      B.add(kit.style.sandbag, m, "sandbag", 0xc8b48c, { uv: "keep" });
    }
    tube(B, [b.x - 2.5, b.h + 0.35, b.z - 1], [b.x - 2.5, b.h + 1.3, b.z - 1], 0.12, "metal_dark", PAINT.dark, 8);
    for (const s of [-1, 1]) B.box("metal_dark", b.x + s * 0.85, 1.1, b.z - b.d / 2 - 0.02, 0.12, 2.2, 0.12, 0x3a3836);
    pendantLamp(B, b.x, b.h, b.z, 0.5, 0.8);
    kit.addLamp?.(new THREE.Vector3(b.x, 1.9, b.z), 0xffd9a0, 1.6, 6);
  }
  {
    const p = PUMPHOUSE;
    const fs = facades(p.x, p.z, p.w, p.d, 0);
    B.box("concrete_dirty", p.x, p.h + 0.1, p.z, p.w + 0.5, 0.2, p.d + 0.5, 0xb4ac9c);
    fs.forEach((f, k) => {
      const len = k % 2 ? p.d : p.w;
      wallDecal(B, f, "baseDirt", len / 2, 0.6, len, 1.2);
      wallDecal(B, f, "leak", len / 2 + (r() - 0.5) * 2, p.h - 0.9, 1.6, 1.8);
    });
    // Steel door (north), louvres (east), pipes out to the brine run.
    B.box("metal_painted", p.x + 1, 1.05, p.z - p.d / 2 - 0.04, 1.2, 2.1, 0.06, 0x5f6a5c);
    for (let k = 0; k < 5; k++) B.box("metal_dark", p.x + p.w / 2 + 0.04, 1.6 + k * 0.14, p.z + 0.8, 0.04, 0.06, 1.0, PAINT.dark);
    tube(B, [p.x + p.w / 2, 0.55, p.z - 1.2], [p.x + p.w / 2 + 3, 0.55, p.z - 1.2], 0.15, "metal_painted", 0x8a8e80, 10);
    B.box("metal_painted", p.x - 2, p.h + 0.6, p.z, 1.0, 0.8, 0.8, 0xc8c4b8);
  }

  // ---- Haul truck (old rigid dump truck, faded yellow) ---------------------------------
  {
    const t = TRUCK, x0 = t.x - t.w / 2;
    const Y = 0xb8923a, D = 0x3a3632;
    B.box("metal_dark", t.x, 0.95, t.z, t.w - 0.4, 0.35, 1.2, D);
    // Cab + bonnet at the west end.
    B.box("metal_painted", x0 + 1.0, 1.55, t.z, 1.6, 1.0, 2.2, Y);
    B.box("metal_painted", x0 + 2.35, 2.05, t.z, 1.4, 2.0, 2.4, Y);
    B.box("plain", x0 + 1.66, 2.55, t.z, 0.02, 0.8, 2.0, 0x2a2e30, { rotZ: 0.18 });
    for (const s of [-1, 1]) B.box("plain", x0 + 2.35, 2.55, t.z + s * 1.21, 1.0, 0.7, 0.02, 0x343a3c);
    B.box("metal_dark", x0 + 0.2, 1.4, t.z, 0.08, 0.7, 1.9, D);
    // Dump body: floor, sides, headboard with cab guard; tipped a little.
    const bx = x0 + 5.6, by = 1.55;
    B.box("metal_rust", bx, by + 0.1, t.z, 5.4, 0.2, 2.8, 0x9a6a44, { rotZ: 0.05 });
    for (const s of [-1, 1]) B.box("metal_painted", bx, by + 0.85, t.z + s * 1.38, 5.4, 1.4, 0.08, Y, { rotZ: 0.05 });
    B.box("metal_painted", bx - 2.7, by + 1.0, t.z, 0.1, 1.7, 2.8, Y);
    B.box("metal_painted", bx - 2.95, by + 1.75, t.z, 0.6, 0.08, 2.8, Y);
    heap(B, bx + 0.3, t.z, 2.4, 1.2, 0.8, 0xf0eee8, 3, "plaster", by + 0.2);
    // Wheels: steer axle + tandem.
    for (const wx of [x0 + 1.4, x0 + 5.2, x0 + 6.7]) {
      for (const s of [-1, 1]) {
        const tyreG = new THREE.CylinderGeometry(0.62, 0.62, 0.5, 16);
        put(B, tyreG, wx, 0.62, t.z + s * 1.15, Math.PI / 2, 0, 0, "plain", 0x2a2826);
        put(B, new THREE.CylinderGeometry(0.32, 0.32, 0.52, 10), wx, 0.62, t.z + s * 1.16, Math.PI / 2, 0, 0, "metal_painted", Y);
      }
    }
    for (const s of [-1, 1]) faceDecal(B, "leak", bx, by + 1.0, t.z + s * 1.43, 0, s, 3, 1.2, 0xa86a3a);
    groundDecal(B, "oil", t.x + 1, t.z + 0.4, 3, 2.2, 0.3, 0xffffff);
  }

  // ---- Scrap heaps: crushed sheet, pipe, girders, drums, tyres ---------------------------
  SCRAP.forEach((s, i) => {
    const sr = (() => {
      let a = 911 + i * 77;
      return () => ((a = (a * 16807) % 2147483647) / 2147483647);
    })();
    heap(B, s.x, s.z, s.w / 2 + 0.3, s.d / 2 + 0.3, s.h * 0.7, 0x8a7a68, i + 5, "gravel");
    const n = Math.round(26 * (0.5 + detail * 0.5));
    for (let k = 0; k < n; k++) {
      const x = s.x + (sr() - 0.5) * s.w, z = s.z + (sr() - 0.5) * s.d;
      const e = 1 - Math.max(Math.abs(x - s.x) / (s.w / 2), Math.abs(z - s.z) / (s.d / 2));
      const y = 0.15 + e * s.h * 0.8 + sr() * 0.2;
      const kind = sr();
      if (kind < 0.45) B.box(sr() < 0.6 ? "corrugated_rust" : "metal_rust", x, y, z, 0.8 + sr() * 1.6, 0.03, 0.5 + sr(), [0x9a6a4e, 0x8a5a3c, 0x8f7c6a][k % 3], { rotY: sr() * 6, rotX: (sr() - 0.5) * 1.2, rotZ: (sr() - 0.5) * 1.2 });
      else if (kind < 0.65) {
        const a = sr() * 6, l = 1 + sr() * 2.5;
        tube(B, [x - Math.cos(a) * l / 2, y, z - Math.sin(a) * l / 2], [x + Math.cos(a) * l / 2, y + (sr() - 0.5) * 0.6, z + Math.sin(a) * l / 2], 0.06 + sr() * 0.12, "metal_rust", 0x7e5236, 8);
      } else if (kind < 0.8) {
        const a = sr() * 6, l = 1.5 + sr() * 2;
        beam(B, [x - Math.cos(a) * l / 2, y, z - Math.sin(a) * l / 2], [x + Math.cos(a) * l / 2, y + (sr() - 0.5) * 0.8, z + Math.sin(a) * l / 2], 0.2, 0.3, "metal_rust", 0x7a5038);
      } else if (kind < 0.9) tyre(B, x, z, sr() < 0.5, sr);
      else put(B, new THREE.CylinderGeometry(0.3, 0.3, 0.88, 12), x, y, z, Math.PI / 2 * (sr() < 0.6 ? 1 : 0), sr() * 6, 0, "metal_painted", [0x8a5a40, 0x6a7a5a, 0x5a6a7a][k % 3]);
    }
    groundDecal(B, "oil", s.x + 1.5, s.z + 1, 3, 2.5, sr() * 3, 0xffffff);
  });

  // ---- Evaporation pans: low curbs, salt crust, a last shallow brine -------------------
  {
    const { x0, x1, z0, z1 } = PANS;
    const cols = 2, rows = 3;
    const cw = (x1 - x0) / cols, rd = (z1 - z0) / rows;
    for (let i = 0; i <= cols; i++) B.box("concrete_dirty", x0 + i * cw, 0.06, (z0 + z1) / 2, 0.3, 0.12, z1 - z0 + 0.3, 0xb8b0a0);
    for (let j = 0; j <= rows; j++) B.box("concrete_dirty", (x0 + x1) / 2, 0.06, z0 + j * rd, x1 - x0 + 0.3, 0.12, 0.3, 0xb8b0a0);
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const cx = x0 + (i + 0.5) * cw, cz = z0 + (j + 0.5) * rd;
      if (i === 1 && j === 1) {
        groundDecal(B, "puddle", cx, cz, cw - 0.6, rd - 0.6, 0, 0xc8d4d0);
        continue;
      }
      groundPatch(B, "plaster", cx, cz, cw / 2 - 0.25, rd / 2 - 0.25, 0, i + j === 2 ? 0xe8ded6 : 0xf2eee6, 50 + i * 7 + j, 0.015);
      groundDecal(B, "cracks", cx, cz, cw - 1, rd - 1, r() * 3, 0xd8d0c4, undefined, "decor", 0.03);
    }
    // Brine feed header along the east edge of the pans with valve stands.
    tube(B, [x1 + 0.6, 0.35, z0], [x1 + 0.6, 0.35, z1], 0.12, "metal_painted", 0x8a9a8a, 10);
    for (let j = 0; j < rows; j++) {
      const z = z0 + (j + 0.5) * rd;
      tube(B, [x1 + 0.6, 0.35, z], [x1 - 0.4, 0.15, z], 0.08, "metal_painted", 0x8a9a8a, 8);
      put(B, new THREE.TorusGeometry(0.18, 0.025, 4, 12), x1 + 0.6, 0.75, z, Math.PI / 2, 0, 0, "metal_painted", 0xb83a2a);
      tube(B, [x1 + 0.6, 0.45, z], [x1 + 0.6, 0.75, z], 0.03, "metal_dark", PAINT.dark, 5);
    }
  }

  // ---- Knee-high brine pipes ---------------------------------------------------------------
  for (const b of boxes) if (b.tag === "pipeX" || b.tag === "pipeZ") pipeRun(B, b, r);

  // ---- Scaffold sniper perches -----------------------------------------------------------
  for (const p of tagged("perch")) {
    const h = p.h, hw = p.w / 2 - 0.1;
    const corners: V3[] = [[p.x - hw, 0, p.z - hw], [p.x + hw, 0, p.z - hw], [p.x + hw, 0, p.z + hw], [p.x - hw, 0, p.z + hw]];
    for (const [x, , z] of corners) {
      tube(B, [x, 0, z], [x, h + 1.1, z], 0.03, "metal_dark", 0x9a9c9a, 6);
      B.box("wood", x, 0.03, z, 0.3, 0.05, 0.3, 0xb8a888);
    }
    for (let y = 1.0; y <= h; y += 2) {
      for (let k = 0; k < 4; k++) {
        const a = corners[k], b = corners[(k + 1) % 4];
        tube(B, [a[0], y, a[2]], [b[0], y, b[2]], 0.025, "metal_dark", 0x9a9c9a, 5);
        if (y + 2 <= h + 0.01) tube(B, [a[0], y, a[2]], [b[0], y + 2, b[2]], 0.022, "metal_dark", 0x8a8c8a, 5);
      }
    }
    for (let k = 0; k < 4; k++) {
      const a = corners[k], b = corners[(k + 1) % 4];
      tube(B, [a[0], h + 1.05, a[2]], [b[0], h + 1.05, b[2]], 0.025, "metal_dark", 0x9a9c9a, 5);
    }
    // Plank deck, toe boards, a ladder on the yard side, tarp windbreak.
    for (let k = 0; k < 8; k++) B.box("wood", p.x, h - 0.03, p.z - hw + (k + 0.5) * (hw * 2 / 8), hw * 2 + 0.2, 0.06, hw * 2 / 8 - 0.02, new THREE.Color(0xc8b494).multiplyScalar(0.8 + r() * 0.3));
    const sx = -Math.sign(p.x), sz = -Math.sign(p.z);
    ladder(B, p.x + sx * (hw + 0.2), p.z + sz * 0.8, 0, h + 1, sx, 0, 0x9a9c9a);
    B.box("sandbag", p.x - sx * hw, h + 0.55, p.z, 0.02, 1.0, hw * 2, 0x8a8a62);
    B.box("concrete_dirty", p.x, 0.12, p.z, p.w + 0.8, 0.04, p.d + 0.8, 0xb4ac9c);
  }
  void tagged;
}

/** Knee-high pipe run (collider box) on concrete sleepers, flanges and a valve wheel. */
function pipeRun(B: MeshBuilder, b: MapBox, r: Rnd) {
  const alongX = b.w > b.d;
  const len = alongX ? b.w : b.d;
  const ax = alongX ? b.x - len / 2 : b.x, az = alongX ? b.z : b.z - len / 2;
  const bx = alongX ? b.x + len / 2 : b.x, bz = alongX ? b.z : b.z + len / 2;
  for (let s = 0; s < 2; s++) {
    const off = (s - 0.5) * 0.36;
    const rad = 0.15 + r() * 0.05;
    const y = 0.42 + rad;
    const ox = alongX ? 0 : off, oz = alongX ? off : 0;
    tube(B, [ax + ox, y, az + oz], [bx + ox, y, bz + oz], rad, "metal_painted", s ? 0x8a9a8a : 0xb4a688, 12);
    for (let k = 2; k < len - 1; k += 5) {
      const fx = alongX ? ax + k : b.x + ox, fz = alongX ? b.z + oz : az + k;
      put(B, new THREE.CylinderGeometry(rad + 0.06, rad + 0.06, 0.08, 12), fx, y, fz, 0, alongX ? 0 : Math.PI / 2, alongX ? Math.PI / 2 : 0, "metal_dark", 0x55585a);
    }
  }
  for (let k = 1; k < len; k += 3) {
    const sx = alongX ? ax + k : b.x, sz = alongX ? b.z : az + k;
    B.box("concrete_dirty", sx, 0.2, sz, alongX ? 0.35 : 0.95, 0.4, alongX ? 0.95 : 0.35, 0xb9b2a4);
  }
  const mx = alongX ? b.x + len * 0.2 : b.x, mz = alongX ? b.z : b.z + len * 0.2;
  put(B, new THREE.TorusGeometry(0.25, 0.03, 4, 14), mx, 1.0, mz, Math.PI / 2, 0, 0, "metal_painted", 0xb83a2a);
  tube(B, [mx, 0.6, mz], [mx, 1.0, mz], 0.035, "metal_dark", 0x55585a, 6);
  groundDecal(B, "baseDirt", b.x, b.z, b.w + 0.8, b.d + 0.8, 0, 0xc8b898);
  void hColumn;
  void xBay;
}
