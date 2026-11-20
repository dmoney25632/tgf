import * as THREE from "three";
import { rng, type BushPlacement } from "../Foliage";
import type { Splat } from "../Terrain";
import { clutterGroup, type MeshBuilder } from "../MeshBuilder";
import { qualityName, worldDetail } from "../quality";
import { smokeColumns } from "../Smoke";
import { groundDecal, groundPatch } from "../architecture/kit";
import { gasBottles } from "../architecture/vehicles";
import { debrisScatter, rubblePile } from "../architecture/debris";
import { BUNKER, CONVEYOR, CRANE, LIGHTS, PANS, PUMPHOUSE, SILOS, TAIL, TOWER, WALL } from "../maps/saltpanGantry";
import { buildTower } from "./saltpanGantryTower";
import { buildYard } from "./saltpanGantryYard";
import { beam, put, tube, type Rnd } from "./saltpanGantryKit";
import { band, clearOf, fbm2, pallets, poleLine, smoothstep, type Dressing, type PoleSpot, type WorldExtra } from "./common";

/** Level of the desert plain around the works (the yard is cut 4.6 m into it). */
const PLAIN = 4.6;
/** Distant salt flats (white crust, flattened terrain). */
const FLATS = [
  { x: -150, z: 70, rx: 55, rz: 30, yaw: 0.3 },
  { x: 120, z: -140, rx: 48, rz: 34, yaw: -0.4 },
  { x: 70, z: 170, rx: 40, rz: 22, yaw: 0.9 },
];
/** Mesas and buttes on the horizon: centre, radii, height. */
const MESAS = [
  { x: -320, z: -240, rx: 70, rz: 40, h: 62, yaw: 0.4 },
  { x: -80, z: -390, rx: 90, rz: 34, h: 48, yaw: 0.1 },
  { x: 230, z: -330, rx: 55, rz: 48, h: 70, yaw: -0.6 },
  { x: 420, z: 60, rx: 80, rz: 45, h: 58, yaw: 1.2 },
  { x: 300, z: 300, rx: 60, rz: 30, h: 40, yaw: 0.7 },
  { x: -360, z: 200, rx: 75, rz: 50, h: 66, yaw: -0.3 },
  { x: -240, z: 380, rx: 50, rz: 26, h: 36, yaw: 0.2 },
  { x: 30, z: 420, rx: 90, rz: 30, h: 46, yaw: -0.1 },
];

/** Eroded mesa: talus skirt, banded cliffs with gullies, slightly domed cap. */
function mesa(B: MeshBuilder, m: (typeof MESAS)[number], gy: number, seed: number) {
  const seg = 44;
  // [radius factor, height factor]
  const prof: [number, number][] = [[1.45, -0.05], [1.26, 0.1], [1.1, 0.26], [1.02, 0.42], [1.0, 0.7], [0.98, 0.9], [0.93, 0.985], [0.86, 1.0], [0.0, 1.03]];
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const c = Math.cos(m.yaw), s = Math.sin(m.yaw);
  const bandTint = (y: number) => {
    const t = y / m.h;
    const strata = 0.9 + 0.12 * Math.sin(t * 38 + seed) + 0.06 * Math.sin(t * 91 + seed * 2);
    return t < 0.3 ? strata * 0.94 : strata;
  };
  for (let k = 0; k < prof.length; k++) {
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const n = fbm2(Math.cos(a) * 2 + seed, Math.sin(a) * 2 - seed, 3);
      const gully = k >= 3 && k <= 6 ? 1 - 0.12 * Math.pow(Math.max(0, Math.sin(a * 9 + seed * 3)), 6) : 1;
      const rf = prof[k][0] * (0.82 + 0.36 * n) * gully * (k === 0 ? 1 + (fbm2(a * 3, seed, 2) - 0.5) * 0.3 : 1);
      const lx = Math.cos(a) * m.rx * rf, lz = Math.sin(a) * m.rz * rf;
      const y = gy + prof[k][1] * m.h + (k === prof.length - 1 ? 0 : (fbm2(a * 4 + k, seed, 2) - 0.5) * m.h * 0.04);
      pos.push(m.x + lx * c + lz * s, y, m.z - lx * s + lz * c);
      const t = bandTint(y - gy);
      col.push(t, t * 0.97, t * 0.94);
    }
  }
  for (let k = 0; k < prof.length - 1; k++) {
    for (let i = 0; i < seg; i++) {
      const a = k * seg + i, b = k * seg + ((i + 1) % seg), cc = (k + 1) * seg + i, d = (k + 1) * seg + ((i + 1) % seg);
      idx.push(a, cc, b, b, cc, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // Winding: make the skirt face outward.
  const ny = geo.attributes.normal.getY(seg * (prof.length - 1));
  if (ny < 0) {
    const ix = geo.index!.array as unknown as number[];
    for (let i = 0; i < ix.length; i += 3) [ix[i + 1], ix[i + 2]] = [ix[i + 2], ix[i + 1]];
    geo.computeVertexNormals();
  }
  B.add(geo, null, "rock", 0xc4926a, { group: "far" });
  geo.dispose();
}

/** A far-off second works: headframe, bins and a conveyor, all backdrop. */
function farWorks(B: MeshBuilder, x: number, z: number, gy: number, yaw: number, r: Rnd) {
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const P = (u: number, y: number, v: number): [number, number, number] => [x + u * cs + v * sn, gy + y, z - u * sn + v * cs];
  for (const su of [-2.5, 2.5]) for (const sv of [-2.5, 2.5]) beam(B, P(su, 0, sv), P(su * 0.4, 22, sv * 0.4), 0.4, 0.4, "metal_dark", 0x6a5a4c, "far");
  for (let y = 4; y < 22; y += 4.5) {
    const k = 1 - (y / 22) * 0.6;
    for (const [a, b] of [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]] as const) beam(B, P(a[0] * 2.5 * k, y, a[1] * 2.5 * k), P(b[0] * 2.5 * k, y, b[1] * 2.5 * k), 0.25, 0.25, "metal_dark", 0x6a5a4c, "far");
  }
  B.box("metal_painted", ...P(0, 9, 0), 4.2, 6, 4.2, 0x8a6248, { group: "far", rotY: yaw });
  beam(B, P(2, 10, 0), P(34, 1, 0), 2, 2, "metal_painted", 0x8a6248, "far");
  for (let k = 0; k < 3; k++) {
    const geo = new THREE.CylinderGeometry(3, 3, 10, 14);
    const p = P(-10 - k * 7, 5, 6 + r() * 2);
    B.add(geo, new THREE.Matrix4().makeTranslation(p[0], p[1], p[2]), "metal_painted", 0xb8aa98, { group: "far", uv: "keep", uvScale: [19, 10] });
    geo.dispose();
  }
}

/**
 * Saltpan Gantry set dressing: the yard floor (packed gravel, haul roads,
 * salt spills, damp brine), the plain beyond the block wall with distant
 * salt flats, eroded mesas on the horizon, a power line and a far works,
 * plus the tower/galleries (saltpanGantryTower) and yard pieces
 * (saltpanGantryYard), scattered debris and dry desert scrub. Visual only.
 */
export const saltpanGantry: Dressing = (kit) => {
  const { def, builder: B, props, quality } = kit;
  const r = rng(7311);
  const boxes = def.boxes;
  const name = qualityName(quality);
  const detail = worldDetail(name);
  const spawns = def.survival?.enemySpawns ?? [];
  const nearSpawn = (x: number, z: number, m: number) => spawns.some((s) => Math.hypot(s.x - x, s.z - z) < m) || Math.hypot(x - def.spawns[0].x, z - def.spawns[0].z) < m;
  const free = (x: number, z: number, m = 0.3) => clearOf(boxes, x, z, m);
  const extras: WorldExtra[] = [];

  // ---- Terrain ---------------------------------------------------------------------
  const flatMask = (x: number, z: number) => {
    let m = 0;
    for (const f of FLATS) {
      const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
      const u = ((x - f.x) * c - (z - f.z) * s) / (f.rx * 1.5), v = ((x - f.x) * s + (z - f.z) * c) / (f.rz * 1.5);
      m = Math.max(m, 1 - smoothstep(0.55, 1, Math.hypot(u, v)));
    }
    return m;
  };
  const height = (x: number, z: number) => {
    const d = Math.max(Math.abs(x), Math.abs(z));
    if (d <= 50) return 0;
    const cut = smoothstep(50, 53.5, d) * PLAIN;
    const roll = smoothstep(56, 130, d) * (fbm2(x * 0.011 + 3, z * 0.011 - 1, 4) - 0.42) * 9;
    const dunes = smoothstep(120, 260, d) * Math.abs(Math.sin(x * 0.016 - z * 0.009 + fbm2(x * 0.006, z * 0.006, 3) * 4)) * 7 * fbm2(x * 0.004 + 9, z * 0.004, 2);
    const ripple = smoothstep(52, 64, d) * (fbm2(x * 0.09, z * 0.09, 2) - 0.5) * 0.7;
    const h = cut + Math.max(-1.5, roll) + dunes + ripple;
    return h + (cut - 0.6 - h) * flatMask(x, z);
  };
  const T = TOWER;
  const roads = (x: number, z: number) => {
    const wob = (fbm2(x * 0.05, z * 0.05, 2) - 0.5) * 2.2;
    const south = band(x - 1 + wob, 3.6) * (z > T.z ? 1 : 0); // haul road in from the south
    const east = band(z - CONVEYOR.a[2] - 3.5 + wob, 3) * (x > 4 && x < 46 ? 1 : 0);
    const lane = band(z - (CRANE.z0 + CRANE.z1) / 2 + wob, 4.5) * (x > 6 && x < 46 ? 1 : 0);
    const west = band(z - 2 + wob, 3) * (x < -4 && x > -46 ? 1 : 0);
    const bays = band(z + 24 + wob, 3.2) * (x > 6 && x < 40 ? 1 : 0);
    return Math.max(south, east, lane, west, bays);
  };
  const splat = (x: number, z: number, o: Splat) => {
    const d = Math.max(Math.abs(x), Math.abs(z));
    const n = fbm2(x * 0.05, z * 0.05, 3);
    const n2 = fbm2(x * 0.16 + 9, z * 0.16, 2);
    if (d < WALL.inner + 0.5) {
      const rd = roads(x, z);
      const brine = 1 - smoothstep(1.5, 5.5, Math.hypot(x - 0.5, z - T.z));
      const pans = x < PANS.x1 + 2 && x > PANS.x0 - 2 && z > PANS.z0 - 2 && z < PANS.z1 + 2 ? 0.5 : 0;
      o.gravel = 0.5 + rd * 1.6 + smoothstep(0.5, 0.62, n2) * 1.2;
      o.ground = 0.35 - rd * 0.3 + smoothstep(0.42, 0.58, n) * 1.4 + smoothstep(WALL.inner - 3, WALL.inner, d) * 0.6;
      o.mud = brine * 1.1 + pans + smoothstep(0.7, 0.8, n) * 0.15;
    } else {
      const f = flatMask(x, z);
      o.gravel = 0.45 + f * 1.5 + smoothstep(0.55, 0.7, n2) * 0.4;
      o.ground = 0.9 - f * 0.7;
      o.mud = 0;
    }
  };

  // ---- Structures -------------------------------------------------------------------
  buildTower(kit, r, extras, detail.debris);
  buildYard(kit, r, detail.debris);

  // ---- Ground: concrete pads, roads' tyre tracks, stains, salt, drifts ------------------
  groundPatch(B, "concrete_dirty", (CRANE.x0 + CRANE.x1) / 2, (CRANE.z0 + CRANE.z1) / 2, (CRANE.x1 - CRANE.x0) / 2 + 3, (CRANE.z1 - CRANE.z0) / 2 + 1.5, 0, 0xb8b0a0, 11);
  groundPatch(B, "concrete_dirty", BUNKER.x, BUNKER.z, BUNKER.w / 2 + 2, BUNKER.d / 2 + 2, 0.05, 0xb0a898, 12);
  groundPatch(B, "concrete_dirty", PUMPHOUSE.x, PUMPHOUSE.z, PUMPHOUSE.w / 2 + 1.5, PUMPHOUSE.d / 2 + 1.5, -0.04, 0xb0a898, 13);
  groundPatch(B, "concrete_dirty", TAIL.x, TAIL.z + 1.5, TAIL.w / 2 + 2, TAIL.d / 2 + 2.5, 0, 0xb4ac9c, 14);
  for (const s of SILOS) groundPatch(B, "concrete_dirty", s.x, s.z + 1.5, s.r + 2.6, s.r + 3.2, 0, 0xb4ac9c, 15 + Math.round(s.x));
  for (let z = 44; z > T.z + 8; z -= 5.5) groundDecal(B, "tracks", 1 + (r() - 0.5) * 1.2, z, 2.8, 5.8, (r() - 0.5) * 0.15, 0xffffff);
  for (let x = 8; x < 44; x += 5.5) groundDecal(B, "tracks", x, (CRANE.z0 + CRANE.z1) / 2 + (r() - 0.5) * 2, 2.8, 5.8, Math.PI / 2 + (r() - 0.5) * 0.2, 0xffffff);
  for (let x = -44; x < -6; x += 6) groundDecal(B, "tracks", x, 2 + (r() - 0.5) * 1.5, 2.6, 5.8, Math.PI / 2 + (r() - 0.5) * 0.2, 0xffffff);
  const stains: [number, number, number][] = [[20, 24, 3], [28, 22, 2.4], [-2, 30, 2.5], [38, -2.5, 2], [-6, -2, 2.2], [-34, 22, 2], [8, -22, 2]];
  for (const [x, z, s] of stains) groundDecal(B, "oil", x, z, s * 1.2, s, r() * 3, 0xffffff);
  for (let i = 0; i < 18; i++) {
    const x = (r() * 2 - 1) * 44, z = (r() * 2 - 1) * 44;
    if (!free(x, z, 0.5)) continue;
    groundDecal(B, r() < 0.5 ? "specks" : "sand", x, z, 3 + r() * 5, 3 + r() * 5, r() * 6, r() < 0.5 ? 0xf0ece4 : 0xd8c8a4);
  }
  // Sand drifted against the lee side of solid things.
  for (const b of boxes) {
    if (b.decor || (b.y ?? 0) > 0.1 || b.h < 0.8 || b.tag === "perimeter" || b.tag === "heap" || b.w * b.d < 0.5) continue;
    if (r() < 0.4) continue;
    groundDecal(B, "sand", b.x + 0.4, b.z + b.d / 2 + 0.6, b.w + 1.2, 1.6, 0, 0xd8c8a4);
  }

  // ---- Debris, litter, rubble (clutter cells: culled with distance, none on low) ----------
  const keep = (x: number, z: number) => free(x, z, 0.15) && !nearSpawn(x, z, 1.5);
  const nDebris = Math.round(24 * detail.debris);
  for (let i = 0; i < nDebris; i++) {
    const x = (r() * 2 - 1) * 44, z = (r() * 2 - 1) * 44;
    debrisScatter(B, x, z, 1.5 + r() * 2.5, Math.round(6 + r() * 8), 400 + i, clutterGroup(x, z), undefined, keep);
  }
  for (const [x, z, rx, rz] of [[BUNKER.x + 4.4, BUNKER.z + 2.6, 1.2, 0.8], [-24, -12, 1.4, 1.0], [26, 34, 1.3, 0.9]] as const) {
    if (free(x, z, 0.4)) rubblePile(B, x, z, rx, rz, 0.5, 900 + Math.round(x), "decor", undefined, detail.debris);
  }
  // Loose sheets and offcuts blown off the cladding round the tower.
  for (let i = 0; i < Math.round(14 * detail.debris); i++) {
    const a = r() * Math.PI * 2, d = 6 + r() * 8;
    const x = T.x + Math.cos(a) * d, z = T.z + Math.sin(a) * d;
    if (!keep(x, z)) continue;
    B.box("corrugated_rust", x, 0.04, z, 0.8 + r() * 0.8, 0.03, 0.5 + r() * 0.6, 0x9a6a4e, { rotY: r() * 6, rotX: (r() - 0.5) * 0.15 });
  }

  // ---- Yard clutter: flood lights, cable reels, pallets, gas bottles ----------------------
  for (const l of LIGHTS) {
    tube(B, [l.x, 0, l.z], [l.x, 9.2, l.z], 0.14, "metal_painted", 0x9a968c, 10);
    B.box("concrete_dirty", l.x, 0.2, l.z, 0.8, 0.4, 0.8, 0xb9b2a4);
    const a = Math.atan2(T.z - l.z, T.x - l.x);
    const ca = Math.cos(a), sa = Math.sin(a);
    beam(B, [l.x - sa * 0.9, 9.0, l.z + ca * 0.9], [l.x + sa * 0.9, 9.0, l.z - ca * 0.9], 0.1, 0.1, "metal_dark", 0x5a5650);
    for (const s of [-0.6, 0.6]) {
      const x = l.x - sa * s + ca * 0.2, z = l.z + ca * s + sa * 0.2;
      B.box("metal_dark", x, 9.25, z, 0.55, 0.4, 0.55, 0x3a3836, { rotY: -a });
      B.box("glow", x + ca * 0.28, 9.2, z + sa * 0.28, 0.45, 0.3, 0.02, 0xfff1c8, { rotY: -a + Math.PI / 2 });
    }
    tube(B, [l.x + 0.16, 0.3, l.z], [l.x + 0.16, 8.8, l.z], 0.025, "metal_dark", 0x2a2826, 4);
    B.box("metal_painted", l.x + 0.25, 1.4, l.z, 0.2, 0.5, 0.35, 0x8a9088);
  }
  const reel = (x: number, z: number, rad: number, upright: boolean, yaw: number) => {
    const w = rad * 1.2;
    const disc = () => new THREE.CylinderGeometry(rad, rad, 0.07, 16);
    if (upright) {
      for (const s of [-1, 1]) put(B, disc(), x + Math.cos(yaw) * (w / 2) * s, rad, z - Math.sin(yaw) * (w / 2) * s, 0, yaw, Math.PI / 2, "wood", 0xb8a07a, "decor", [rad * 2, rad * 2]);
      put(B, new THREE.CylinderGeometry(rad * 0.62, rad * 0.62, w, 14), x, rad, z, 0, yaw, Math.PI / 2, "plain", 0x2a2826);
    } else {
      for (const y of [0.035, w]) put(B, disc(), x, y, z, 0, yaw, 0, "wood", 0xb8a07a, "decor", [rad * 2, rad * 2]);
      put(B, new THREE.CylinderGeometry(rad * 0.62, rad * 0.62, w, 14), x, w / 2, z, 0, yaw, 0, "plain", 0x2a2826);
    }
  };
  for (const [x, z, rad, up, yaw] of [[-22.5, 8.5, 0.7, true, 0.3], [12.6, 19.4, 0.55, false, 0], [-2.5, -20.5, 0.6, true, 1.4], [35.6, 12.5, 0.75, true, 0.1]] as const) {
    if (free(x, z, rad)) reel(x, z, rad, up, yaw);
  }
  for (const [x, z, yaw, n] of [[-20, 20.5, 0.4, 3], [11.6, 15.6, -0.2, 2], [-33.5, 33, 1.0, 4], [25, -26.6, 0.1, 2], [-11.5, -24.5, 0.6, 3]] as const) {
    if (free(x, z, 0.8)) pallets(B, x, z, yaw, n, r);
  }
  gasBottles(B, PUMPHOUSE.x - 2.4, PUMPHOUSE.z - PUMPHOUSE.d / 2 - 0.5, 0, 4, 31);

  // ---- Beyond the wall: salt flats, haul road, power line, far works ------------------
  FLATS.forEach((f, i) => {
    const gy = height(f.x, f.z);
    groundPatch(B, "plaster", f.x, f.z, f.rx, f.rz, f.yaw, 0xf4f0ea, 70 + i, gy + 0.25, "far");
    groundPatch(B, "plaster", f.x + f.rx * 0.2, f.z - f.rz * 0.1, f.rx * 0.55, f.rz * 0.5, f.yaw + 0.4, 0xe4ddd4, 80 + i, gy + 0.3, "far");
  });
  MESAS.forEach((m, i) => mesa(B, m, height(m.x, m.z) - 4, i * 2.3 + 1));
  {
    const poles: PoleSpot[] = [];
    for (let x = -200; x <= 200; x += 36) poles.push({ x, y: height(x, -82), z: -82, rotY: Math.PI / 2 });
    poleLine(B, poles, r, 1.2);
    // Spur in to the works over the north wall.
    const spur: PoleSpot[] = [{ x: 4, y: height(4, -82), z: -82, rotY: 0 }, { x: 4, y: height(4, -64), z: -64, rotY: 0 }, { x: 4, y: PLAIN, z: -53.5, rotY: 0 }];
    poleLine(B, spur, r, 0.8);
  }
  farWorks(B, -190, -150, height(-190, -150), 0.6, r);
  farWorks(B, 210, 110, height(210, 110), 2.4, r);
  // A pipeline on stands running off across the plain to the west.
  for (let x = -54; x > -260; x -= 6) {
    const gy = height(x, 8);
    tube(B, [x, gy + 0.9, 8], [x - 6, height(x - 6, 8) + 0.9, 8], 0.25, "metal_painted", 0x9a9a8a, 8, "far");
    B.box("metal_dark", x, gy + 0.4, 8, 0.15, 0.8, 0.9, 0x5a5650, { group: "far" });
  }
  // Dust kicked up by distant haul trucks.
  extras.push(...(typeof document === "undefined" ? [] : [smokeColumns([
    { x: 170, y: height(170, -60), z: -60, scale: 1.1 },
    { x: -140, y: height(-140, 160), z: 160, scale: 0.9 },
  ], name)]));

  // ---- Scrub: dry grass tufts, bushes, weeds -------------------------------------------
  const tallGrass = (x: number, z: number) => {
    const d = Math.max(Math.abs(x), Math.abs(z));
    if (roads(x, z) > 0.2 || nearSpawn(x, z, 3)) return 0;
    const n = fbm2(x * 0.07 - 4, z * 0.07 + 6, 3);
    if (d < WALL.inner - 0.3) {
      if (d > WALL.inner - 2.2) return n > 0.45 ? 0.55 : 0;
      return free(x, z, 0.6) && fbm2(x * 0.21, z * 0.21, 2) > 0.66 ? 0.35 : 0;
    }
    if (d < 54) return 0;
    return smoothstep(0.45, 0.62, n) * 0.6;
  };
  const bushes: BushPlacement[] = [];
  for (let i = 0; i < 90; i++) {
    const a = r() * Math.PI * 2, d = 55 + r() * 90;
    bushes.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, scale: 0.4 + r() * 0.6, dry: true });
  }
  for (let i = 0; i < 26; i++) {
    const a = (r() * 2 - 1) * 45, side = Math.floor(r() * 4), off = WALL.inner - 0.9 - r() * 1.2;
    const [x, z] = side === 0 ? [a, -off] : side === 1 ? [a, off] : side === 2 ? [-off, a] : [off, a];
    if (free(x, z, 1) && !nearSpawn(x, z, 3)) bushes.push({ x, z, scale: 0.4 + r() * 0.35, dry: true });
  }
  let placed = 0;
  for (let guard = 0; placed < 22 && guard < 400; guard++) {
    const a = (r() * 2 - 1) * 46, side = Math.floor(r() * 4), off = WALL.inner - 0.6 - r() * 2;
    const [x, z] = side === 0 ? [a, -off] : side === 1 ? [a, off] : side === 2 ? [-off, a] : [off, a];
    if (!free(x, z, 0.4) || nearSpawn(x, z, 3) || roads(x, z) > 0.3) continue;
    const k = placed % 10;
    props.place(placed % 3 ? "weed_plant_02" : "shrub_03", { x, y: 0, z, scale: placed % 3 ? 3 + r() * 2 : 1.6 + r(), rotY: r() * 6.28, variant: Math.floor(r() * 2), tier: k < 3 ? 0 : k < 6 ? 1 : 2 });
    placed++;
  }

  return {
    terrain: { height, splat, inner: 64, outer: 700 },
    foliage: { grass: () => 0, grassBounds: 0, trees: [], bushes, tallGrass, tallGrassBounds: 70 },
    extras,
  };
};
