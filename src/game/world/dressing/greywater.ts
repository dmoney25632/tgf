import * as THREE from "three";
import { rng, type BushPlacement, type TreePlacement } from "../Foliage";
import type { Splat } from "../Terrain";
import { MeshBuilder } from "../MeshBuilder";
import { qualityName, worldDetail } from "../quality";
import { building } from "../architecture/Building";
import { debrisScatter, litter } from "../architecture/debris";
import { patrolTruck } from "../architecture/vehicles";
import { groundStrip, railing } from "../architecture/kit";
import { beam, ladder } from "./saltpanGantryKit";
import { clearOf, concertina, fbm2, smoothstep, type Dressing, type DressingKit, type WorldExtra } from "./common";
import type { MapBox } from "../MapLoader";
import {
  BARRACKS, BOATHOUSE, BOUNDS, BUSHES, CHECKPOINT, DITCH, FARMHOUSE, FENCE, GATE, GENERATOR, GREYWATER_LIVE, HQ, LIGHTS,
  MAST, PARKED, RIVER, SEARCHLIGHTS, SHED, TOWER, TOWERS, TREES, roadDistance, searchlightSpot, tallGrassAt,
} from "../maps/greywater";

const PLASTER = 0xb8b0a0;
const STONE = 0x8e8a80;
const ROOF = 0x4a4c48;
const WIN = 0xffc982;
const RIVER_Y = -0.9;

/**
 * Greywater Depot set dressing (night): the valley terrain and the river,
 * dirt roads, the wire with razor coil, watchtowers with animated
 * searchlights, the checkpoint, the motor pool, barracks, the command house
 * with lit windows, the patrol truck (animated from GREYWATER_LIVE), fields
 * of tall grass and reeds that match the stealth concealment map, woods and
 * the jetty. Visual only: colliders live in maps/greywater.ts.
 */
export const greywater: Dressing = (kit) => {
  const { def, builder: B, props, quality } = kit;
  const r = rng(7121);
  const boxes = def.boxes;
  const name = qualityName(quality);
  const detail = worldDetail(name);
  const extras: WorldExtra[] = [];
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const flat = () => 0;

  // ---- Terrain ---------------------------------------------------------------------------------------
  const inPlay = (x: number, z: number) => x > BOUNDS.x0 - 2 && x < BOUNDS.x1 + 2 && z > BOUNDS.z0 - 2 && z < BOUNDS.z1 + 2;
  const height = (x: number, z: number) => {
    // River channel north of the bank (the bank collider keeps players out).
    const river = smoothstep(RIVER.bank - 0.4, RIVER.bank - 3.5, z) * (z > -150 ? 1 : 1);
    let h = -river * 1.6;
    if (z < -128) h += smoothstep(-128, -170, z) * (fbm2(x * 0.01, z * 0.01, 3) * 40 + 10);
    if (inPlay(x, z)) return h;
    const out = Math.max(Math.abs(x) - BOUNDS.x1, z - BOUNDS.z1, 0);
    const hills = smoothstep(6, 90, out) * (fbm2(x * 0.008 + 2, z * 0.008 - 5, 4) * 42 + 8) + smoothstep(140, 320, out) * 30;
    return h + hills + (z < RIVER.bank ? 0 : (fbm2(x * 0.05, z * 0.05, 2) - 0.5) * 0.8 * smoothstep(0, 10, out));
  };
  const ditch = (x: number, z: number) => {
    let best = Infinity;
    for (let i = 1; i < DITCH.length; i++) {
      const [ax, az] = DITCH[i - 1], [bx, bz] = DITCH[i];
      const vx = bx - ax, vz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)));
      best = Math.min(best, Math.hypot(x - (ax + vx * t), z - (az + vz * t)));
    }
    return best;
  };
  const inWire = (x: number, z: number) => x > FENCE.x0 && x < FENCE.x1 && z > FENCE.z0 && z < FENCE.z1;
  const splat = (x: number, z: number, o: Splat) => {
    const n = fbm2(x * 0.07, z * 0.07, 3);
    const road = 1 - smoothstep(3, 4.6, roadDistance(x, z));
    const yard = inWire(x, z) ? 0.9 : 0;
    o.gravel = road * 1.4 + yard + smoothstep(0.62, 0.74, n) * 0.3 + 0.04;
    o.ground = (1 - road) * (1 - yard * 0.7) * 1.3;
    o.mud = (1 - smoothstep(1.5, 3.5, ditch(x, z))) * 1.4 + smoothstep(RIVER.bank + 3, RIVER.bank - 1, z) * 1.5 + road * 0.35 + smoothstep(0.64, 0.8, n) * 0.4;
  };
  const grass = (x: number, z: number) => {
    if (!inPlay(x, z) || z < RIVER.bank + 0.5) return 0;
    if (roadDistance(x, z) < 4 || !clearOf(boxes, x, z, 0.35)) return 0;
    if (inWire(x, z)) return x < FENCE.x0 + 4 || x > FENCE.x1 - 4 || z < FENCE.z0 + 4 ? 0.55 : 0.08;
    return 0.95 - smoothstep(0.6, 0.75, fbm2(x * 0.09, z * 0.09, 3)) * 0.4;
  };
  const tallGrass = (x: number, z: number) => (clearOf(boxes, x, z, 0.2) ? tallGrassAt(x, z) : 0);

  // ---- Roads -------------------------------------------------------------------------------------------
  groundStrip(B, "gravel", 0, BOUNDS.z1 + 30, 0, FENCE.z1 - 6, 6.5, flat, 0x8a8474, 11, "decor", 0.03);
  for (let i = 0; i < 5; i++) {
    const a = [[0, 43], [-58, 43], [-58, -63], [58, -63], [58, 43]][i], b = [[-58, 43], [-58, -63], [58, -63], [58, 43], [0, 43]][i];
    groundStrip(B, "gravel", a[0], a[1], b[0], b[1], 5.5, flat, 0x7e786a, 20 + i, "decor", 0.025 + i * 0.001);
  }
  // Yard hardstanding inside the wire (packed gravel) and the HQ forecourt.
  B.box("concrete_dirty", 0, 0.012, -10, 96, 0.02, 86, 0x6e6a60, { group: "decor", noAo: true });
  B.box("concrete", 0, 0.02, -15, 18, 0.02, 4, 0x8e8a80, { group: "decor", noAo: true });

  // ---- The river and the jetty -------------------------------------------------------------------------
  extras.push(water(quality.anisotropy));
  {
    const { jetty } = RIVER;
    B.boxFeet("wood", (jetty.x0 + jetty.x1) / 2, -0.12, (jetty.z0 + jetty.z1) / 2 - 0.3, jetty.x1 - jetty.x0, 0.12, jetty.z1 - jetty.z0 + 1.4, 0x6a5a48, { group: "decor" });
    for (let z = jetty.z0; z < jetty.z1; z += 2.2) for (const x of [jetty.x0, jetty.x1]) B.boxFeet("wood", x, RIVER_Y - 1.4, z, 0.22, 1.4 - RIVER_Y, 0.22, 0x4a3e32, { group: "decor" });
    for (const x of [jetty.x0 - 0.1, jetty.x1 + 0.1]) railing(B, v(x, 0, jetty.z0), v(x, 0, RIVER.bank - 0.6), 1.0, 0x4a3e32, 1.1, "decor", "wood");
    // The skiff, low in the water at the end of the jetty.
    const sx = (jetty.x0 + jetty.x1) / 2 + 3.2, sz = jetty.z0 + 2.2;
    const hull = new THREE.CylinderGeometry(0.9, 0.7, 5.2, 10, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI);
    B.add(hull, new THREE.Matrix4().makeTranslation(sx, RIVER_Y + 0.35, sz), "metal_painted", 0x3a4a44, { group: "decor" });
    hull.dispose();
    B.box("metal_dark", sx, RIVER_Y + 0.6, sz + 2.2, 0.5, 0.6, 0.5, 0x222222, { group: "decor" });
    // Bank revetment.
    B.box("rock", -20, -0.4, RIVER.bank - 0.5, 160, 1.0, 1.4, 0x5a564e, { group: "decor" });
  }
  boathouse(B);

  // ---- The wire -------------------------------------------------------------------------------------------
  const { x0, x1, z0, z1, h } = FENCE;
  const runs: [number, number, number, number][] = [
    [x0, z1, FENCE.southGate[0], z1], [FENCE.southGate[1], z1, x1, z1],
    [x0, z0, FENCE.backGate[0], z0], [FENCE.backGate[1], z0, x1, z0],
    [x0, z0, x0, FENCE.westCut[0]], [x0, FENCE.westCut[1], x0, z1],
    [x1, z0, x1, FENCE.eastCollapse[0]], [x1, FENCE.eastCollapse[1], x1, z1],
  ];
  for (const [ax, az, bx, bz] of runs) {
    wire(B, ax, az, bx, bz, h);
    if (detail.debris > 0) concertina(B, ax, az, bx, bz, h + 0.28, 0.24);
  }
  // The west cut: a peeled-back flap; the east collapse: a panel flat on the ground.
  {
    const zc = (FENCE.westCut[0] + FENCE.westCut[1]) / 2;
    wirePanel(B, x0 - 1.0, 0, zc - 0.2, 0.06, h * 0.7, 2.0, 0.9, 0);
    wirePanel(B, x1 + 1.6, 0.06, (FENCE.eastCollapse[0] + FENCE.eastCollapse[1]) / 2, 2.6, 0.04, FENCE.eastCollapse[1] - FENCE.eastCollapse[0], 0, 0.05);
    for (const [gx0, gx1] of [FENCE.southGate, FENCE.backGate]) {
      // Gate posts and a swung-open gate leaf.
      const zz = gx0 === FENCE.southGate[0] ? z1 : z0;
      for (const gx of [gx0, gx1]) B.boxFeet("metal_painted", gx, 0, zz, 0.16, h + 0.4, 0.16, 0x5a5e58, { group: "decor" });
      if (zz === z0) wirePanel(B, gx1 + 0.2, 0, zz - 1.6, 0.06, h - 0.2, 3.0, 0.25, 0);
    }
  }
  // Warning signs on the wire.
  for (let x = x0 + 8; x < x1; x += 22) if (Math.abs(x) > 6) B.box("metal_painted", x, 1.5, z1 + 0.1, 0.5, 0.36, 0.02, 0xb8a040, { group: "decor", noAo: true });

  // ---- South gate booth, boom, sandbags -------------------------------------------------------------------
  booth(B, GATE.booth.x, GATE.booth.z, GATE.booth.w, GATE.booth.d, GATE.booth.h, 0x7a7e70);
  boom(B, -4.5, z1 + 0.6, 9, true);
  // ---- The vehicle checkpoint on the south road -------------------------------------------------------------
  booth(B, CHECKPOINT.booth.x, CHECKPOINT.booth.z, CHECKPOINT.booth.w, CHECKPOINT.booth.d, CHECKPOINT.booth.h, 0x7a7e70);
  boom(B, -3.4, CHECKPOINT.z, 6.8, false);
  apc(B, CHECKPOINT.apc.x, CHECKPOINT.apc.z, 0, 0x545a44);
  floodMast(B, CHECKPOINT.lamp.x, CHECKPOINT.lamp.z, 5, Math.PI);
  for (const [x, z] of [[-2.8, CHECKPOINT.z - 1.2], [2.8, CHECKPOINT.z - 1.2]] as const) B.boxFeet("concrete", x, 0, z, 0.6, 0.9, 1.4, 0xb0a890, { group: "decor" });

  // ---- Watchtowers ------------------------------------------------------------------------------------------
  for (const t of TOWERS) tower(B, t.x, t.z);

  // ---- Motor pool ---------------------------------------------------------------------------------------------
  {
    const s = SHED;
    const cz = (s.z0 + s.z1) / 2;
    B.boxFeet("metal_corrugated", s.x0 + 0.15, 0, cz, 0.3, s.h, s.z1 - s.z0, 0x6a6a60, { group: "decor" });
    for (const z of [s.z0 + 0.2, s.z1 - 0.2]) B.boxFeet("metal_corrugated", (s.x0 + s.x1) / 2, 0, z, s.x1 - s.x0 - 0.4, s.h, 0.12, 0x6a6a60, { group: "decor" });
    for (const z of [s.z0 + 0.2, s.z1 - 0.2]) B.boxFeet("metal_painted", s.x1 - 0.2, 0, z, 0.3, s.h, 0.3, 0x50524c, { group: "decor" });
    B.box("metal_corrugated", (s.x0 + s.x1) / 2, s.h + 0.1, cz, s.x1 - s.x0 + 0.8, 0.12, s.z1 - s.z0 + 0.8, ROOF, { group: "decor", rotZ: -0.04 });
    // Work bench, drums, a tyre stack inside the shed.
    B.boxFeet("wood", s.x0 + 1.0, 0, cz + 3, 1.0, 0.9, 3.0, 0x6a5a48, { group: "decor" });
    for (let i = 0; i < 5; i++) drum(B, s.x0 + 0.9 + (i % 2) * 0.7, s.z0 + 1.0 + Math.floor(i / 2) * 0.7, i % 3 === 0 ? 0x2f4a3a : 0x7a2a22);
  }
  for (const p of PARKED) {
    if (p.kind === "truck") patrolTruck(B, p.x, p.z, p.yaw === 0 ? Math.PI / 2 : 0, "decor", 0x5e6450);
    else if (p.kind === "apc") apc(B, p.x, p.z, p.yaw, 0x4e5440);
    else bowser(B, p.x, p.z);
  }

  // ---- Barracks, generator, mast, flagpole ---------------------------------------------------------------------
  {
    const b = BARRACKS;
    building(B, props, { x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, w: b.x1 - b.x0, d: b.z1 - b.z0, floors: 1, floorH: b.h, seed: 303, tint: 0x9a9a8a, damage: 0.05, front: 3, detail: true });
    // Lit windows along the west and south sides.
    for (let z = b.z0 + 2.5; z < b.z1 - 1; z += 4) if (Math.abs(z) > 1.5) glowPane(B, b.x0 - 0.03, 2.0, z, 0.02, 0.9, 1.2, r() < 0.7 ? WIN : 0x3a3428);
    for (let x = b.x0 + 3; x < b.x1 - 1; x += 4) glowPane(B, x, 2.0, b.z1 + 0.03, 1.2, 0.9, 0.02, r() < 0.6 ? WIN : 0x3a3428);
    lamp(B, b.x0 - 0.6, 3.2, 0);
  }
  {
    const g = GENERATOR;
    B.boxFeet("metal_painted", g.x, 0, g.z, g.w, g.h, g.d, 0x5a6050, { group: "decor" });
    B.box("metal_dark", g.x, g.h + 0.6, g.z - 0.8, 0.25, 1.2, 0.25, 0x2a2a28, { group: "decor" });
    for (let i = 0; i < 6; i++) B.box("metal_dark", g.x + g.w / 2 + 0.02, 0.6 + i * 0.25, g.z, 0.03, 0.08, g.d - 0.6, 0x1e1e1c, { group: "decor", noAo: true });
    lamp(B, g.x - g.w / 2 - 0.3, 2.6, g.z);
  }
  floodMast(B, MAST.x, MAST.z, 9, 0);
  B.boxFeet("metal_painted", 0, 0, 6, 0.12, 8, 0.12, 0x8a8a84, { group: "decor" });
  B.box("cloth", 0.8, 7.3, 6, 1.6, 0.9, 0.02, 0x7a2024, { group: "decor", noAo: true });
  // Gate lamps.
  for (const sx of [-1, 1]) {
    B.boxFeet("metal_painted", sx * 5.8, 0, z1 + 1.4, 0.12, 3.6, 0.12, 0x4a4c48, { group: "decor" });
    lamp(B, sx * 5.8, 3.6, z1 + 1.4);
  }
  // Motor pool work light.
  B.boxFeet("metal_painted", -32, 0, 3, 0.1, 3.8, 0.1, 0x4a4c48, { group: "decor" });
  lamp(B, -32, 3.8, 3);

  // ---- The command house ---------------------------------------------------------------------------------------
  commandHouse(B, boxes, r);

  // ---- Ruined farmhouse --------------------------------------------------------------------------------------------
  {
    const f = FARMHOUSE;
    building(B, props, { x: f.x, z: f.z, w: f.w, d: f.d, floors: 1, floorH: f.h, seed: 88, tint: 0xa89c88, damage: 0.8, ruin: true, front: 2, detail: false });
  }
  // Drystone walls (the colliders are "hidden"): rough stone courses.
  for (const b of boxes) {
    if (b.tag !== "drystone") continue;
    const along = b.w > b.d;
    const len = along ? b.w : b.d;
    const n = Math.max(1, Math.round(len / 1.1));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n - 0.5;
      const cx = b.x + (along ? t * len : 0), cz = b.z + (along ? 0 : t * len);
      const hh = b.h * (0.85 + r() * 0.25);
      B.box("rock", cx, hh / 2, cz, along ? len / n + 0.15 : b.w * (0.9 + r() * 0.2), hh, along ? b.d * (0.9 + r() * 0.2) : len / n + 0.15, STONE, { group: "decor", rotY: (r() - 0.5) * 0.1, uvOffset: [r() * 4, r() * 4] });
    }
  }

  // ---- Interior lamps and outdoor lights ---------------------------------------------------------------------------
  for (const l of LIGHTS) if (l.real) kit.addLamp?.(v(l.x, l.y - 0.3, l.z), l.color, l.i * 6, l.r * 1.25);

  // ---- Clutter -----------------------------------------------------------------------------------------------------
  const keep = (x: number, z: number) => clearOf(boxes, x, z, 0.4) && roadDistance(x, z) > 3;
  debrisScatter(B, -36, 12, 10, Math.round(30 * detail.debris), 5, "decor", flat, keep);
  debrisScatter(B, 20, -30, 12, Math.round(24 * detail.debris), 6, "decor", flat, keep);
  litter(B, 20, 0, 10, Math.round(24 * detail.debris), 7, "decor", keep);
  litter(B, 0, 70, 8, Math.round(14 * detail.debris), 8, "decor", keep);
  for (const [x, z] of [[-20, 30], [-18.8, 30.4], [26, -18], [26, -16.8], [-4, -48], [12, -50]] as const) drum(B, x, z, 0x3a4a34);

  // ---- Foliage -----------------------------------------------------------------------------------------------------
  const trees: TreePlacement[] = TREES.map(([x, z]) => ({ x, z, scale: 0.95 + r() * 0.4, variant: r() < 0.65 ? 1 : 0, rot: r() * 6 }));
  const treeCount = name === "low" ? 150 : name === "medium" ? 230 : 320;
  let guard = 0;
  while (trees.length < treeCount && guard++ < 12000) {
    const x = (r() * 2 - 1) * 230, z = -200 + r() * 420;
    if (z < RIVER.bank && z > -128) continue; // river
    if (inPlay(x, z)) {
      // Inside the play area: only the insertion woods, the north treeline and the far east / west margins.
      const woods = z > 104 && x < 6 && x > -80;
      const treeline = z < -70 && z > -100 && x < 30 && x > -90;
      const margin = Math.abs(x) > 82 && !(z < 50 && z > -66);
      if (!(woods || treeline || margin)) continue;
      if (!clearOf(boxes, x, z, 1.2) || roadDistance(x, z) < 5) continue;
    } else if (Math.abs(x) < 10 && z > BOUNDS.z1) continue;
    if (fbm2(x * 0.03 + 5, z * 0.03 - 3, 3) < 0.4) continue;
    trees.push({ x, z, scale: 0.95 + r() * 0.6, variant: r() < 0.7 ? 1 : r() < 0.9 ? 0 : 2, rot: r() * 6 });
  }
  const bushes: BushPlacement[] = BUSHES.map((b) => ({ x: b.x, z: b.z, scale: b.r * 0.85, dry: false }));
  for (let i = 0; i < 90; i++) {
    const x = (r() * 2 - 1) * 96, z = -100 + r() * 222;
    if (inWire(x, z) || !clearOf(boxes, x, z, 0.8) || roadDistance(x, z) < 4) continue;
    if (Math.abs(x) < 62 && z > -62 && z < 44) continue; // keep the perimeter road's verge clear-ish
    bushes.push({ x, z, scale: 0.5 + r() * 0.6, dry: r() < 0.25 });
  }

  // ---- Animated extras: searchlights, the patrol truck ----------------------------------------------------------------
  extras.push(searchlights());
  extras.push(convoy(kit));

  return {
    terrain: { height, splat, inner: 130, outer: 480 },
    foliage: {
      grass, grassBounds: 130, trees, bushes, tallGrass, tallGrassBounds: 125,
      grassPalette: { dry: 0x6a6448, lush: 0x3e4a2c, brown: 0x564a34, rust: 0x5a4632 },
    },
    extras,
  };
};

// ---------------------------------------------------------------------------------------------------------------

/** Chain-link run without random gaps (the colliders are continuous, so is the picture). */
function wire(B: MeshBuilder, ax: number, az: number, bx: number, bz: number, h: number) {
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 0.2) return;
  const n = Math.max(1, Math.round(len / 3));
  const dx = (bx - ax) / len, dz = (bz - az) / len;
  const yaw = Math.atan2(-dz, dx);
  for (let i = 0; i <= n; i++) {
    const x = ax + dx * (len * i) / n, z = az + dz * (len * i) / n;
    B.boxFeet("metal_painted", x, 0, z, 0.07, h + 0.15, 0.07, 0x6e706a, { group: "decor" });
    // Outrigger for the razor wire.
    B.box("metal_painted", x, h + 0.25, z, 0.04, 0.5, 0.04, 0x6e706a, { group: "decor", rotX: 0.5 * Math.cos(yaw), rotZ: 0.5 * Math.sin(yaw) });
    if (i === n) continue;
    const segL = len / n;
    const geo = new THREE.PlaneGeometry(segL, h, 1, 1);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * segL * 4, uv.getY(k) * h * 4);
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(x + dx * segL / 2, h / 2 + 0.04, z + dz * segL / 2);
    B.add(geo, m, "chainlink", 0x9a9c96, { group: "decor", uv: "keep" });
    geo.dispose();
  }
  B.box("metal_painted", (ax + bx) / 2, h + 0.02, (az + bz) / 2, Math.abs(bx - ax) + 0.05, 0.04, Math.abs(bz - az) + 0.05, 0x6e706a, { group: "decor", noAo: true });
}

/** A loose chain-link panel (cut flap / fallen section). */
function wirePanel(B: MeshBuilder, x: number, y: number, z: number, w: number, h: number, d: number, yaw: number, tilt: number) {
  const geo = new THREE.PlaneGeometry(Math.max(w, d), Math.max(h, 0.05), 1, 1);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * Math.max(w, d) * 4, uv.getY(k) * Math.max(h, 1) * 4);
  const flatOnGround = h < 0.1;
  const m = new THREE.Matrix4().makeRotationY(yaw + (d > w ? Math.PI / 2 : 0));
  if (flatOnGround) m.multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2 + tilt));
  m.setPosition(x, flatOnGround ? y : y + h / 2, z);
  B.add(geo, m, "chainlink", 0x8a8c86, { group: "decor", uv: "keep" });
  geo.dispose();
}

function lamp(B: MeshBuilder, x: number, y: number, z: number) {
  B.box("metal_dark", x, y + 0.08, z, 0.4, 0.12, 0.3, 0x2a2a28, { group: "decor" });
  B.box("glow", x, y - 0.01, z, 0.26, 0.05, 0.18, 0xffe0a8, { group: "decor", noAo: true });
}

function glowPane(B: MeshBuilder, x: number, y: number, z: number, w: number, h: number, d: number, tint: number) {
  B.box("glow", x, y, z, w, h, d, tint, { group: "decor", noAo: true });
}

function drum(B: MeshBuilder, x: number, z: number, tint: number) {
  const g = new THREE.CylinderGeometry(0.29, 0.29, 0.88, 12);
  B.add(g, new THREE.Matrix4().makeTranslation(x, 0.44, z), "metal_painted", tint, { group: "decor", uv: "keep", uvScale: [1.8, 0.9] });
  g.dispose();
}

function booth(B: MeshBuilder, x: number, z: number, w: number, d: number, h: number, tint: number) {
  B.boxFeet("concrete", x, 0, z, w, 1.0, d, 0x9a968a, { group: "decor" });
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.boxFeet("metal_painted", x + sx * (w / 2 - 0.08), 1.0, z + sz * (d / 2 - 0.08), 0.16, h - 1.2, 0.16, tint, { group: "decor" });
  B.box("glow", x, 1.6, z, w - 0.3, 0.9, d - 0.3, 0x6a5c40, { group: "decor", noAo: true });
  B.boxFeet("metal_painted", x, h - 0.2, z, w + 0.4, 0.2, d + 0.4, tint, { group: "decor" });
  lamp(B, x, h - 0.25, z + d / 2 + 0.25);
}

function boom(B: MeshBuilder, x: number, z: number, len: number, raised: boolean) {
  B.boxFeet("metal_painted", x, 0, z, 0.4, 1.1, 0.4, 0x8a8a80, { group: "decor" });
  const pitch = raised ? 1.25 : 0;
  const c = Math.cos(pitch), s = Math.sin(pitch);
  for (let i = 0; i < 8; i++) {
    const t = (i + 0.5) / 8;
    B.box("metal_painted", x + c * len * t, 1.0 + s * len * t, z, (len / 8) * 1.02, 0.12, 0.12, i % 2 ? 0xd8d0c0 : 0xa82a22, { group: "decor", rotZ: pitch, noAo: true });
  }
}

/** Original eight-wheeled APC (boxy hull, sloped glacis, small turret). Length along z when yaw 0. */
function apc(B: MeshBuilder, x: number, z: number, yaw: number, tint: number) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const put = (mat: "metal_painted" | "metal_dark" | "plain", lx: number, ly: number, lz: number, w: number, h: number, d: number, t: number, pitch = 0) => {
    B.box(mat, x + lx * c + lz * s, ly, z - lx * s + lz * c, w, h, d, t, { group: "decor", rotY: yaw, rotX: pitch });
  };
  const L = 7.2, W = 2.8;
  for (const lz of [-2.6, -1.0, 1.0, 2.6]) for (const sd of [-1, 1]) {
    const g = new THREE.CylinderGeometry(0.55, 0.55, 0.42, 14).rotateZ(Math.PI / 2);
    B.add(g, new THREE.Matrix4().makeRotationY(yaw).setPosition(x + sd * (W / 2 - 0.1) * c + lz * s, 0.55, z - sd * (W / 2 - 0.1) * s + lz * c), "plain", 0x1c1c1a, { group: "decor", uv: "keep" });
    g.dispose();
  }
  put("metal_painted", 0, 1.45, 0, W, 1.2, L - 1.2, tint);
  put("metal_painted", 0, 1.3, L / 2 - 0.4, W - 0.1, 0.9, 1.2, tint, 0.5);
  put("metal_painted", 0, 1.3, -L / 2 + 0.4, W - 0.1, 0.9, 1.0, tint, -0.3);
  put("metal_painted", 0, 2.25, -0.6, 1.5, 0.45, 1.6, tint);
  put("metal_dark", 0, 2.35, 1.4, 0.1, 0.1, 1.8, 0x222222);
  for (const sd of [-1, 1]) put("metal_dark", sd * 0.7, 1.9, L / 2 - 0.9, 0.35, 0.12, 0.04, 0x262c30);
}

function bowser(B: MeshBuilder, x: number, z: number) {
  patrolTruck(B, x, z + 0.2, Math.PI / 2, "decor", 0x4e5440);
  const g = new THREE.CylinderGeometry(1.0, 1.0, 3.2, 14).rotateX(Math.PI / 2);
  B.add(g, new THREE.Matrix4().makeTranslation(x, 2.9, z - 0.9), "metal_painted", 0x8a8a7a, { group: "decor", uv: "keep", uvScale: [6, 3] });
  g.dispose();
}

function floodMast(B: MeshBuilder, x: number, z: number, h: number, yaw: number) {
  B.boxFeet("metal_painted", x, 0, z, 0.24, h, 0.24, 0x5a5c58, { group: "decor" });
  for (const sd of [-1, 1]) {
    const lx = Math.cos(yaw) * sd * 0.5, lz = -Math.sin(yaw) * sd * 0.5;
    B.box("metal_dark", x + lx, h - 0.1, z + lz, 0.55, 0.45, 0.25, 0x2a2a28, { group: "decor", rotY: yaw });
    B.box("glow", x + lx + Math.sin(yaw) * 0.13, h - 0.1, z + lz + Math.cos(yaw) * 0.13, 0.44, 0.34, 0.02, 0xfff2d0, { group: "decor", rotY: yaw, noAo: true });
  }
}

/** Timber-and-steel watchtower: legs, cabin deck, sandbag lip, tin roof, ladder. */
function tower(B: MeshBuilder, x: number, z: number) {
  const p = TOWER.perch, s = TOWER.size / 2;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) beam(B, [x + sx * (s + 0.3), 0, z + sz * (s + 0.3)], [x + sx * (s - 0.1), p, z + sz * (s - 0.1)], 0.22, 0.22, "wood", 0x5a4a3a, "decor");
  for (let y = 1.4; y < p - 0.5; y += 2) {
    beam(B, [x - s, y, z - s], [x + s, y + 1.4, z - s], 0.08, 0.08, "wood", 0x5a4a3a, "decor");
    beam(B, [x + s, y, z + s], [x - s, y + 1.4, z + s], 0.08, 0.08, "wood", 0x5a4a3a, "decor");
    beam(B, [x - s, y, z + s], [x - s, y + 1.4, z - s], 0.08, 0.08, "wood", 0x5a4a3a, "decor");
    beam(B, [x + s, y, z - s], [x + s, y + 1.4, z + s], 0.08, 0.08, "wood", 0x5a4a3a, "decor");
  }
  B.boxFeet("wood", x, p - 0.2, z, TOWER.size + 0.6, 0.2, TOWER.size + 0.6, 0x5e5040, { group: "decor" });
  for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    B.boxFeet("sandbag", x + nx * (s + 0.15), p, z + nz * (s + 0.15), nz ? TOWER.size + 0.6 : 0.4, 0.9, nx ? TOWER.size + 0.6 : 0.4, 0x8a7e62, { group: "decor" });
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.boxFeet("wood", x + sx * s, p, z + sz * s, 0.12, 2.2, 0.12, 0x5a4a3a, { group: "decor" });
  B.box("metal_corrugated", x, p + 2.3, z, TOWER.size + 1.0, 0.1, TOWER.size + 1.0, ROOF, { group: "decor" });
  ladder(B, x, z + s + 0.45, 0, p, 0, 1, 0x3a3a36);
  // Searchlight housing on the rail (the beam itself is animated).
  B.box("metal_dark", x, p + 1.1, z, 0.5, 0.45, 0.5, 0x2a2a28, { group: "decor" });
}

/** The command house: two wings, plinth, stairs, rooms with furniture and lit windows. */
function commandHouse(B: MeshBuilder, boxes: MapBox[], r: () => number) {
  const draw = (b: MapBox, mat: "plaster" | "concrete" | "concrete_dirty" | "metal_corrugated" | "wood" | "rock", tint: number) => B.boxFeet(mat, b.x, b.y ?? 0, b.z, b.w, b.h, b.d, tint, { group: "decor" });
  for (const b of boxes) {
    switch (b.tag) {
      case "hq": draw(b, "plaster", PLASTER); break;
      case "header": draw(b, "plaster", 0xa8a090); break;
      case "roof": draw(b, "concrete_dirty", 0x6a6860); break;
      case "plinth": case "plinth-top": draw(b, "rock", STONE); break;
      case "stair": draw(b, "concrete", 0x9a968c); break;
      case "radio-desk": case "mess-table": case "map-table": case "desk": draw(b, "wood", 0x6a5038); break;
      case "radio-rack": case "map-cabinet": case "office-cabinet": case "mess-shelf": draw(b, "wood", 0x4e4436); break;
      default: break;
    }
  }
  const F = HQ.front, R = HQ.rear;
  // Floors.
  B.box("wood", 0, 0.015, (F.z0 + F.z1) / 2, HQ.x1 - HQ.x0 - 0.6, 0.02, F.z1 - F.z0 - 0.6, 0x5a4a3a, { group: "decor", noAo: true });
  B.box("wood", 0, HQ.plinth + 0.015, (R.z0 + R.z1) / 2, HQ.x1 - HQ.x0 - 0.6, 0.02, R.z1 - R.z0 - 0.6, 0x5e4c3a, { group: "decor", noAo: true });
  // Window panes (lit rooms glow warm, dark rooms dim).
  const pane = (x: number, y: number, z: number, along: "x" | "z", lit: boolean) =>
    glowPane(B, x, y, z, along === "x" ? 1.1 : 0.04, 1.0, along === "z" ? 1.1 : 0.04, lit ? WIN : 0x2a2620);
  for (const x of [-10, -7, 7, 10]) pane(x, 1.8, F.z1 + 0.03, "x", x > 0 || r() < 0.5);
  for (const z of [-28, -21]) pane(HQ.x1 + 0.03, 1.8, z, "z", true);
  for (const z of [-28]) pane(HQ.x0 - 0.03, 1.8, z, "z", true);
  for (const x of [-10, -6, 6, 10]) pane(x, HQ.plinth + 1.8, R.z0 - 0.03, "x", true);
  for (const z of [-41, -33]) {
    pane(HQ.x1 + 0.03, HQ.plinth + 1.8, z, "z", true);
    pane(HQ.x0 - 0.03, HQ.plinth + 1.8, z, "z", z < -35);
  }
  // Lamps over the doors, an awning at the front, radio aerials on the roof.
  lamp(B, 0, 3.2, F.z1 + 0.35);
  lamp(B, HQ.x0 - 0.35, 2.8, (HQ.sideDoor[0] + HQ.sideDoor[1]) / 2);
  lamp(B, 0, HQ.plinth + 2.8, R.z0 - 0.35);
  B.box("canvas", 0, 2.75, F.z1 + 0.9, 3.4, 0.06, 1.6, 0x5a5a48, { group: "decor", rotX: 0.18 });
  for (const [x, z] of [[-11, -40], [-12.4, -40.6]] as const) B.boxFeet("metal_dark", x, HQ.plinth + R.h + 0.3, z, 0.04, 4.5, 0.04, 0x2a2a28, { group: "decor" });
  B.boxFeet("metal_painted", 10, F.h + 0.3, -21, 1.2, 0.8, 1.2, 0x6a6a64, { group: "decor" });
  // Radios, a map on the table, papers and a lamp on the colonel's desk.
  B.box("metal_dark", -10, 0.92, -28.4, 1.4, 0.24, 0.5, 0x3a3e36, { group: "decor" });
  B.box("glow", -10.4, 0.98, -28.14, 0.3, 0.06, 0.02, 0x80ff9a, { group: "decor", noAo: true });
  B.box("cloth", -8.4, HQ.plinth + 0.88, -37, 2.6, 0.01, 1.4, 0xc8b88a, { group: "decor", noAo: true });
  B.box("cloth", 9.2, HQ.plinth + 0.81, -40.6, 1.4, 0.01, 0.6, 0xe0d8c8, { group: "decor", noAo: true });
  B.box("glow", 10.1, HQ.plinth + 1.05, -40.8, 0.18, 0.12, 0.18, 0xffd890, { group: "decor", noAo: true });
  B.boxFeet("wood", 9.2, HQ.plinth, -41.6, 0.6, 0.95, 0.6, 0x3a2e24, { group: "decor" });
  // Bunks in the mess and a stove.
  B.boxFeet("metal_dark", 12.6, 0, -19.5, 0.8, 0.9, 0.8, 0x2a2a28, { group: "decor" });
}

function boathouse(B: MeshBuilder) {
  const b = BOATHOUSE;
  B.boxFeet("wood", b.x, 0, b.z, b.w, b.h, b.d, 0x5a4c3e, { group: "decor" });
  const roof = new THREE.CylinderGeometry(0.01, b.d * 0.62, b.w + 0.6, 3, 1).rotateZ(Math.PI / 2).rotateX(Math.PI / 6);
  B.add(roof, new THREE.Matrix4().makeScale(1, 0.5, 1).setPosition(b.x, b.h + b.d * 0.14, b.z), "metal_corrugated", ROOF, { group: "decor" });
  roof.dispose();
}

// ---------------------------------------------------------------------------------------------------------------
// Animated extras
// ---------------------------------------------------------------------------------------------------------------

/** A soft light-shaft cone from (0,0,0) down −y to length 1 (scaled per frame). */
function beamMaterial(color: number, opacity: number) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true,
  });
}
function coneGeometry() {
  // Unit cone, apex at origin, opening along +z (length 1, radius 1).
  const g = new THREE.ConeGeometry(1, 1, 18, 1, true);
  g.translate(0, -0.5, 0);
  g.rotateX(-Math.PI / 2);
  // Fade the far end: vertex alpha via colour (additive → darker = fainter).
  const p = g.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const t = Math.min(1, p.getZ(i));
    const k = 1 - t * 0.75;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}
function poolTexture() {
  const size = 64;
  const c = typeof document !== "undefined" ? document.createElement("canvas") : null;
  if (!c) return null;
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.55, "rgba(255,255,255,0.55)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

function searchlights(): WorldExtra {
  const group = new THREE.Group();
  group.name = "greywater:searchlights";
  const cone = coneGeometry();
  const beamMat = beamMaterial(0xcfe0ff, 0.16);
  beamMat.vertexColors = true;
  const tex = poolTexture();
  const poolMat = new THREE.MeshBasicMaterial({ color: 0xdde8ff, map: tex, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
  const disk = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const units = SEARCHLIGHTS.map((s) => {
    const shaft = new THREE.Mesh(cone, beamMat);
    shaft.position.set(s.x, s.y, s.z);
    shaft.frustumCulled = false;
    const pool = new THREE.Mesh(disk, poolMat);
    pool.position.y = 0.08;
    pool.renderOrder = 2;
    group.add(shaft, pool);
    return { s, shaft, pool };
  });
  const spot = { x: 0, z: 0 };
  const target = new THREE.Vector3();
  return {
    object: group,
    triangles: 18 * 2 * units.length,
    update() {
      const t = GREYWATER_LIVE.t;
      units.forEach((u, i) => {
        const dead = GREYWATER_LIVE.dead[i];
        u.shaft.visible = u.pool.visible = !dead;
        if (dead) return;
        searchlightSpot(u.s, t, spot);
        target.set(spot.x, 0, spot.z);
        const len = target.distanceTo(u.shaft.position);
        u.shaft.lookAt(target);
        u.shaft.scale.set(u.s.radius * 0.9, u.s.radius * 0.9, len);
        u.pool.position.x = spot.x;
        u.pool.position.z = spot.z;
        u.pool.scale.set(u.s.radius * 2.4, 1, u.s.radius * 2.4);
      });
    },
    dispose() {
      cone.dispose();
      disk.dispose();
      beamMat.dispose();
      poolMat.dispose();
      tex?.dispose();
    },
  };
}

/** The patrol truck that circles the perimeter road, with headlight beams; pose from GREYWATER_LIVE.truck. */
function convoy(kit: DressingKit): WorldExtra {
  const root = new THREE.Group();
  root.name = "greywater:convoy";
  const mb = new MeshBuilder();
  patrolTruck(mb, 0, 0, 0, "truck", 0x5a6048);
  const built = mb.build((m) => kit.materials.get(m));
  let tris = 0;
  for (const list of built.values()) for (const mesh of list) {
    mesh.matrixAutoUpdate = true;
    root.add(mesh);
    tris += (mesh.geometry.attributes.position?.count ?? 0) / 3;
  }
  const cone = coneGeometry();
  const mat = beamMaterial(0xfff0c8, 0.12);
  mat.vertexColors = true;
  const beams: THREE.Mesh[] = [];
  for (const sd of [-1, 1]) {
    const b = new THREE.Mesh(cone, mat);
    // Truck local frame: +x forward; the cone opens along +z, so turn it to +x and tip it down a little.
    b.position.set(3.2, 1.62, sd * 0.95);
    b.rotation.set(0, Math.PI / 2, 0);
    b.rotateX(0.09);
    b.scale.set(3.2, 2.0, 22);
    b.frustumCulled = false;
    beams.push(b);
    root.add(b);
  }
  const glow = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.14, 0.22), new THREE.MeshBasicMaterial({ color: 0xfff4d8 }));
  const glow2 = glow.clone();
  glow.position.set(3.17, 1.62, 0.95);
  glow2.position.set(3.17, 1.62, -0.95);
  root.add(glow, glow2);
  return {
    object: root,
    triangles: tris,
    update() {
      const t = GREYWATER_LIVE.truck;
      root.visible = t.visible;
      root.position.set(t.x, 0, t.z);
      root.rotation.y = t.yaw;
      for (const b of beams) b.visible = t.lights;
      glow.visible = glow2.visible = t.lights;
    },
    dispose() {
      for (const list of built.values()) for (const mesh of list) mesh.geometry.dispose();
      cone.dispose();
      mat.dispose();
      glow.geometry.dispose();
      (glow.material as THREE.Material).dispose();
    },
  };
}

/** Dark river plane with a slow ripple (procedural normal map). */
function water(anisotropy: number): WorldExtra {
  const size = 128;
  const c = typeof document !== "undefined" ? document.createElement("canvas") : null;
  let normal: THREE.CanvasTexture | null = null;
  if (c) {
    c.width = c.height = size;
    const g = c.getContext("2d")!;
    const img = g.createImageData(size, size);
    const hgt = (x: number, y: number) => Math.sin((x / size) * Math.PI * 8 + Math.sin((y / size) * Math.PI * 4) * 1.5) + Math.sin((y / size) * Math.PI * 6 + (x / size) * Math.PI * 2) * 0.6;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const dx = hgt(x + 1, y) - hgt(x - 1, y), dy = hgt(x, y + 1) - hgt(x, y - 1);
      const i = (y * size + x) * 4;
      img.data[i] = 128 + dx * 40;
      img.data[i + 1] = 128 + dy * 40;
      img.data[i + 2] = 255;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    normal = new THREE.CanvasTexture(c);
    normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
    normal.repeat.set(50, 6);
    normal.anisotropy = anisotropy;
  }
  const mat = new THREE.MeshStandardMaterial({ color: 0x0e1a1e, roughness: 0.1, metalness: 0.3, normalMap: normal, normalScale: new THREE.Vector2(0.4, 0.4) });
  const geo = new THREE.PlaneGeometry(700, 40, 1, 1).rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, RIVER_Y, RIVER.bank - 18);
  mesh.receiveShadow = true;
  mesh.name = "greywater:river";
  const clock = new THREE.Clock();
  return {
    object: mesh,
    triangles: 2,
    update() {
      if (normal) normal.offset.x = (clock.getElapsedTime() * 0.015) % 1;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      normal?.dispose();
    },
  };
}
