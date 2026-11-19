import * as THREE from "three";
import type { MeshBuilder } from "../MeshBuilder";
import type { WorldMat } from "../WorldMaterials";
import { groundDecal, type Tint } from "./kit";

/**
 * Vehicles built from merged primitives (no draw calls of their own). Local
 * frame: +x forward (length), +y up, +z to the vehicle's left; `yaw` turns
 * the whole thing about its centre at (x, z).
 */

const UNIT = new THREE.BoxGeometry(1, 1, 1);

type Put =(mat: WorldMat, lx: number, ly: number, lz: number, w: number, h: number, d: number, tint: Tint, pitch?: number, roll?: number) => void;

function frame(B: MeshBuilder, x: number, y: number, z: number, yaw: number, group: string) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const world = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c];
  // Local pitch (about the side axis) and roll (about the length) are applied
  // before the yaw, so parts stay put whichever way the vehicle faces.
  const m = new THREE.Matrix4(), r = new THREE.Matrix4();
  const put: Put = (mat, lx, ly, lz, w, h, d, tint, pitch = 0, roll = 0) => {
    const [wx, wz] = world(lx, lz);
    m.makeRotationY(yaw).setPosition(wx, y + ly, wz);
    if (pitch) m.multiply(r.makeRotationZ(pitch));
    if (roll) m.multiply(r.makeRotationX(roll));
    m.multiply(r.makeScale(w, h, d));
    B.add(UNIT, m, mat, tint, { group });
  };
  const add = (geo: THREE.BufferGeometry, lx: number, ly: number, lz: number, mat: WorldMat, tint: Tint, local = new THREE.Matrix4()) => {
    const [wx, wz] = world(lx, lz);
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(wx, y + ly, wz).multiply(local);
    B.add(geo, m, mat, tint, { group, uv: "keep" });
  };
  return { put, add, world };
}

/**
 * Original tan mine-resistant patrol truck: V-hull, four big off-road
 * tyres, armoured cab with small slab windows, bar grille and push bumper,
 * troop box with a rear door and spare wheel, roof hatch with a gunner
 * shield. About 1.6k tris. Footprint ≈ 6.2 × 2.5 m, roof ≈ 2.7 m.
 */
export function patrolTruck(B: MeshBuilder, x: number, z: number, yaw: number, group = "decor", tint: Tint = 0xb6a47c, y = 0) {
  const { put, add, world } = frame(B, x, y, z, yaw, group);
  const body = new THREE.Color(tint);
  const dark = body.clone().multiplyScalar(0.72);
  const L = 6.2, W = 2.5;
  // Wheels: chunky tyres with hubs, two axles.
  const tyre = new THREE.CylinderGeometry(0.62, 0.62, 0.48, 16);
  tyre.rotateX(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(0.3, 0.3, 0.5, 8);
  hub.rotateX(Math.PI / 2);
  for (const ax of [-1.95, 1.75]) {
    for (const sd of [-1, 1]) {
      add(tyre, ax, 0.62, sd * (W / 2 - 0.2), "plain", 0x1f1e1c);
      add(hub, ax, 0.62, sd * (W / 2 - 0.18), "metal_painted", dark);
    }
  }
  tyre.dispose();
  hub.dispose();
  // V-hull under the body, chassis rails, wheel arches.
  for (const sd of [-1, 1]) put("metal_painted", 0, 0.78, sd * 0.42, L - 0.6, 0.7, 0.9, dark, 0, sd * 0.55);
  for (const ax of [-1.95, 1.75]) for (const sd of [-1, 1]) put("metal_painted", ax, 1.36, sd * (W / 2 - 0.12), 1.55, 0.14, 0.62, body);
  // Engine bay (front) and bonnet sloping down to the grille.
  put("metal_painted", 2.35, 1.5, 0, 1.5, 0.75, W - 0.25, body);
  put("metal_painted", 2.4, 1.92, 0, 1.45, 0.12, W - 0.3, body, -0.12);
  // Bar grille + push bumper + headlight cages.
  put("metal_dark", 3.12, 1.45, 0, 0.06, 0.62, W - 0.5, 0x2c2c2a);
  for (let i = -5; i <= 5; i++) put("metal_dark", 3.17, 1.45, i * 0.18, 0.05, 0.62, 0.04, 0x3a3936);
  put("metal_dark", 3.3, 0.95, 0, 0.18, 0.3, W + 0.05, 0x2a2a28);
  for (const sd of [-1, 1]) {
    put("plain", 3.14, 1.62, sd * 0.95, 0.03, 0.14, 0.2, 0xb8b4a8);
    put("metal_dark", 3.2, 1.62, sd * 0.95, 0.04, 0.22, 0.28, 0x2a2a28);
  }
  // Armoured cab with a sloped, thick-framed windscreen and small side slabs.
  put("metal_painted", 0.9, 2.1, 0, 1.6, 1.4, W, body);
  put("metal_painted", 1.78, 2.35, 0, 0.12, 0.95, W - 0.1, body, 0.32);
  for (const sd of [-1, 1]) {
    put("plain", 1.84, 2.42, sd * 0.55, 0.02, 0.62, 0.9, 0x262c30, 0.32);
    put("plain", 0.95, 2.4, sd * (W / 2 + 0.005), 0.75, 0.5, 0.02, 0x262c30);
    // Door handles, mirrors on arms.
    put("metal_dark", 0.55, 1.95, sd * (W / 2 + 0.03), 0.18, 0.04, 0.04, 0x222222);
    put("metal_dark", 1.85, 2.45, sd * (W / 2 + 0.35), 0.05, 0.05, 0.6, 0x222222);
    put("metal_dark", 1.85, 2.45, sd * (W / 2 + 0.65), 0.08, 0.32, 0.18, 0x222222);
  }
  // Troop box (rear), taller than the cab, with door, steps and spare wheel.
  put("metal_painted", -1.35, 2.15, 0, 2.9, 1.5, W, body);
  put("metal_painted", -1.35, 2.92, 0, 2.95, 0.06, W + 0.04, dark);
  for (const sd of [-1, 1]) put("plain", -1.1, 2.4, sd * (W / 2 + 0.005), 0.45, 0.35, 0.02, 0x262c30);
  put("metal_painted", -2.82, 2.05, 0.3, 0.05, 1.3, 0.9, dark);
  put("metal_dark", -2.95, 0.95, 0.3, 0.3, 0.06, 0.8, 0x2a2a28);
  const spare = new THREE.CylinderGeometry(0.55, 0.55, 0.36, 14);
  spare.rotateZ(Math.PI / 2);
  add(spare, -2.98, 2.05, -0.62, "plain", 0x1f1e1c);
  spare.dispose();
  // Roof: hatch ring, gunner shield, antenna whips, stowage.
  const ring = new THREE.CylinderGeometry(0.48, 0.5, 0.18, 12, 1, true);
  add(ring, -0.9, 3.04, 0, "metal_dark", 0x403e3a);
  ring.dispose();
  put("metal_painted", -0.48, 3.38, 0, 0.06, 0.55, 1.0, body, -0.15);
  for (const sd of [-1, 1]) put("metal_painted", -0.78, 3.36, sd * 0.5, 0.55, 0.5, 0.06, body);
  for (const sd of [-1, 1]) {
    const [ax, az] = world(-2.6, sd * 1.05);
    B.box("metal_dark", ax, y + 3.9, az, 0.02, 2.0, 0.02, 0x1c1c1c, { group });
  }
  put("canvas", -1.9, 3.08, -0.6, 0.9, 0.22, 0.7, 0x8a7d5c);
  // Dust and oil on the ground under it.
  groundDecal(B, "oil", x, z, 2.2, 3.4, yaw, 0xffffff, undefined, group === "far" ? "far" : "decor");
}

/** Gas bottles in a chained rack (welding / cooking gas), visual only. */
export function gasBottles(B: MeshBuilder, x: number, z: number, yaw: number, n: number, seed: number, group = "decor") {
  const { put, add } = frame(B, x, 0, z, yaw, group);
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const prof: [number, number][] = [[0, 0], [0.11, 0], [0.12, 0.03], [0.12, 1.12], [0.1, 1.24], [0.05, 1.3], [0.035, 1.3], [0.035, 1.38], [0, 1.38]];
  const geo = new THREE.LatheGeometry(prof.map(([a, b]) => new THREE.Vector2(a, b)), 10);
  const cap = new THREE.CylinderGeometry(0.05, 0.05, 0.08, 6);
  const tints = [0xa83a2a, 0x6c7a70, 0x2f4a6a, 0xc4b89a, 0xa83a2a];
  for (let i = 0; i < n; i++) {
    const lz = (i - (n - 1) / 2) * 0.27;
    const lean = r() < 0.15 ? 0.12 : 0;
    const local = new THREE.Matrix4().makeRotationX(lean);
    add(geo, (r() - 0.5) * 0.05, 0, lz, "metal_painted", tints[Math.floor(r() * tints.length)], local);
    add(cap, 0, 1.42, lz, "metal_dark", 0x8a7a40);
  }
  geo.dispose();
  cap.dispose();
  // Rack: two uprights, a top rail and a chain bar across the bottles.
  const half = (n * 0.27) / 2 + 0.08;
  for (const sd of [-1, 1]) put("metal_dark", -0.18, 0.6, sd * half, 0.05, 1.2, 0.05, 0x3a3936);
  put("metal_dark", -0.18, 1.18, 0, 0.05, 0.05, half * 2, 0x3a3936);
  put("metal_dark", 0.13, 0.95, 0, 0.02, 0.03, half * 2, 0x55524a);
}
