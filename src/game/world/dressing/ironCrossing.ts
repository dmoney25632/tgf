import * as THREE from "three";
import { attachGrime, finishGrime } from "../architecture/grime";
import { skyline } from "../architecture/skyline";
import { rng, type BushPlacement, type TreePlacement } from "../Foliage";
import type { Splat } from "../Terrain";
import type { MeshBuilder } from "../MeshBuilder";
import { qualityName, worldDetail } from "../quality";
import { smokeColumns } from "../Smoke";
import { building } from "../architecture/Building";
import { burntCar, debrisScatter, litter, rubblePile } from "../architecture/debris";
import { patrolTruck } from "../architecture/vehicles";
import { chainlink, groundStrip, paintLine, railing } from "../architecture/kit";
import { beam, ladder, tube } from "./saltpanGantryKit";
import { clearOf, fbm2, smoothstep, type Dressing, type WorldExtra } from "./common";
import {
  BLOCKS, BOOTH, BOUNDS, BRIDGE, BUNKER, CAP_LAYER, CHURCH, CRATER, CUSTOMS, FOUNTAIN, LAYER, LZ, MAST,
  PARAPET_GAPS, STEP, TOWER, TOWN_TREES, TRAIN, WRECKS, YARD,
} from "../maps/ironCrossing";

/** River surface and gorge floor (m, below the rim at y = 0). */
const RIVER_Y = -34;
const FLOOR_Y = -37;
/** Half-width of the river channel at the bridge. */
const RIVER_HALF = 15;
const STEEL = 0x5f6a6e;
const STEEL_RUST = 0x7a5a48;
const CONC = 0xc4beb2;
const ASPHALT = 0x8a8882;

/** The gorge's centre-line wanders a little east and west of the bridge. */
const gorgeShift = (x: number) => Math.sin(x * 0.011 + 0.6) * 10 * smoothstep(40, 140, Math.abs(x));

/** Depth of the gorge at (x, z): 0 on the rims, FLOOR_Y at the bottom. */
function gorgeDepth(x: number, z: number) {
  const dz = Math.abs(z - gorgeShift(x));
  const rim = BRIDGE.south;
  if (dz >= rim + 1) return 0;
  const n = fbm2(x * 0.06, z * 0.06, 3);
  // Cliff: steep from the rim down to a talus slope, then the river flats.
  const cliff = 1 - smoothstep(rim - 9 - n * 3, rim + 0.6, dz);
  const talus = 1 - smoothstep(RIVER_HALF + 2, rim - 6, dz);
  const ledge = (fbm2(x * 0.15 + 3, z * 0.15, 2) - 0.5) * 3 * cliff * (1 - talus);
  return (FLOOR_Y + 8) * cliff + (-8 - 0.5) * talus * cliff * 0 + -8 * talus + ledge;
}

/**
 * Iron Crossing set dressing: the Vellen gorge and river, the three-span
 * through-truss bridge with its stepped ramps, catwalks, pier caps and
 * parapets, the stalled train and wrecks, the checkpoint booth and the MG
 * bunker, the town of Brask on the south rim (facades on the solid blocks,
 * church, fountain square, promenade), the customs yard, water tower and
 * signal mast on the north rim, the LZ field, forest and hills.
 * Visual only: colliders live in maps/ironCrossing.ts.
 */
export const ironCrossing: Dressing = (kit) => {
  const { def, builder: B, props, quality } = kit;
  const r = rng(4417);
  const boxes = def.boxes;
  const name = qualityName(quality);
  const detail = worldDetail(name);
  const extras: WorldExtra[] = [];
  attachGrime(B, qualityName(quality), "wet");
  const { south, north, deck, core, deckHalf, catOut, pad, piers } = BRIDGE;
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  // ---- Terrain ----------------------------------------------------------------------------------
  const inPlay = (x: number, z: number) => x > BOUNDS.x0 - 2 && x < BOUNDS.x1 + 2 && z > BOUNDS.z0 - 2 && z < BOUNDS.z1 + 2;
  const height = (x: number, z: number) => {
    const g = gorgeDepth(x, z);
    if (inPlay(x, z) && Math.abs(z) > south + 0.5) return 0;
    // Hills beyond the bounds, rising away from the gorge.
    const out = Math.max(Math.abs(x) - BOUNDS.x1, z - BOUNDS.z1, BOUNDS.z0 - z, 0);
    const hills = smoothstep(4, 90, out) * (fbm2(x * 0.008 + 2, z * 0.008 - 5, 4) * 38 + 6) + smoothstep(140, 320, out) * 30;
    const bank = Math.abs(z - gorgeShift(x)) > south ? hills : 0;
    return g + bank;
  };
  const roadAt = (x: number, z: number) => {
    // Main road (|x| < 5.5) through town and the north bank; side streets; the yard apron.
    let k = 1 - smoothstep(5, 6.5, Math.abs(x));
    if (z < 0 && z > BOUNDS.z0 + 20) k = Math.max(k, 1 - smoothstep(16, 22, Math.hypot((x - YARD.x) * 0.8, z - YARD.z)));
    for (const sz of [80, 128]) k = Math.max(k, (1 - smoothstep(3.5, 5, Math.abs(z - sz))) * (Math.abs(x) < 46 ? 1 : 0));
    return Math.abs(z) < south ? 0 : k;
  };
  const inSquare = (x: number, z: number) => x > -8 && x < 26 && z > 95 && z < 112;
  const splat = (x: number, z: number, o: Splat) => {
    const n = fbm2(x * 0.07, z * 0.07, 3);
    const g = gorgeDepth(x, z);
    if (g < -0.5) {
      // Cliffs and talus: rock-grey gravel with wet mud by the water.
      o.gravel = 1.2;
      o.ground = smoothstep(-20, -4, g) * 0.6 + smoothstep(0.5, 0.7, n) * 0.4;
      o.mud = smoothstep(RIVER_Y + 4, RIVER_Y, g) * 1.4;
      return;
    }
    const road = roadAt(x, z);
    o.gravel = road * 1.4 + (inSquare(x, z) ? 1.3 : 0) + smoothstep(0.6, 0.72, n) * 0.4 + 0.05;
    o.ground = (1 - road) * 1.3;
    o.mud = smoothstep(0.62, 0.78, n) * 0.6 + road * 0.2;
  };
  const grass = (x: number, z: number) => {
    if (!inPlay(x, z) || Math.abs(z) < south + 1.5 || inSquare(x, z)) return 0;
    if (roadAt(x, z) > 0.1 || !clearOf(boxes, x, z, 0.4)) return 0;
    const n = fbm2(x * 0.09, z * 0.09, 3);
    const town = z > 70 ? 0.5 : 1;
    return Math.max(0, Math.min(1, (0.95 - smoothstep(0.62, 0.74, n) * 0.5) * town));
  };
  const tallGrass = (x: number, z: number) => {
    if (!inPlay(x, z) || roadAt(x, z) > 0.2 || Math.abs(z) < south + 2) return 0;
    if (Math.hypot(x - LZ.x, z - LZ.z) < 12) return 0;
    const n = fbm2(x * 0.08 + 4, z * 0.08 - 7, 3);
    if (z < -115) return smoothstep(0.4, 0.55, n) * 0.7;
    if (Math.abs(x) > 44) return 0.6;
    return z > 70 ? 0 : smoothstep(0.6, 0.72, n) * 0.4;
  };

  // ---- Roads, paving, markings --------------------------------------------------------------------
  const flat = () => 0;
  groundStrip(B, "asphalt", 0, BOUNDS.z1, 0, south + pad + 11 * STEP, 10.5, flat, ASPHALT, 11, "decor", 0.03);
  groundStrip(B, "asphalt", 0, north - pad - 11 * STEP, 0, BOUNDS.z0 + 12, 10.5, flat, ASPHALT, 12, "decor", 0.03);
  for (const sz of [80, 128]) groundStrip(B, "asphalt", -46, sz, 46, sz, 7, flat, ASPHALT, 13 + sz, "decor", 0.025);
  paintLine(B, 0, BOUNDS.z1 - 4, 0, south + pad + 12, 0, 0.12, 3, 3, flat, 21);
  paintLine(B, 0, north - pad - 12, 0, BOUNDS.z0 + 16, 0, 0.12, 3, 3, flat, 22);
  // The square: pale paving.
  B.box("concrete", 9, 0.015, 103.5, 34, 0.03, 17, 0xd4cdbd, { group: "decor", noAo: true });
  // Yard apron.
  B.box("concrete_dirty", YARD.x + 2, 0.015, YARD.z, 40, 0.03, 30, 0xb8b2a6, { group: "decor", noAo: true });
  // Promenade along the south rim.
  B.box("concrete", 0, 0.015, 64.6, 100, 0.03, 4.2, 0xcfc8b8, { group: "decor", noAo: true });

  // ---- The river ---------------------------------------------------------------------------------
  extras.push(river(quality.anisotropy));

  // ---- The bridge ---------------------------------------------------------------------------------
  const len = south - north;
  const zc = (south + north) / 2;
  const top = deck;
  // Deck slab: road lane asphalt, rail lane ballast, slab edges.
  B.box("concrete", 0, top - LAYER / 2, zc, deckHalf * 2, LAYER, len + pad * 2, CONC, { group: "decor" });
  B.box("asphalt", (BRIDGE.road[0] + BRIDGE.road[1]) / 2 + 0.3, top + 0.02, zc, BRIDGE.road[1] - BRIDGE.road[0] - 0.6, 0.04, len + pad * 2, ASPHALT, { group: "decor", noAo: true });
  B.box("gravel", (BRIDGE.rail[0] + BRIDGE.rail[1]) / 2 - 0.3, top + 0.06, zc, BRIDGE.rail[1] - BRIDGE.rail[0] - 0.6, 0.12, len + pad * 2, 0x9a948a, { group: "decor", noAo: true });
  paintLine(B, -3.5, south + pad, -3.5, north - pad, 0, 0.12, 3, 3, () => top, 31, 0xd6d2c4, "decor", 0.045);
  // Rails and sleepers along the whole deck and both ramps.
  const railEnd = south + pad + 11 * STEP, railStart = north - pad - 11 * STEP;
  for (const off of [-0.72, 0.72]) B.box("metal_dark", BRIDGE.track + off, top + 0.2, zc, 0.08, 0.14, len + pad * 2, 0x6a625a, { group: "decor" });
  for (let z = north - pad + 0.3; z < south + pad; z += 0.65) B.box("wood", BRIDGE.track, top + 0.13, z, 2.5, 0.12, 0.22, 0x7a6a58, { group: "decor", rot90: true });
  void railEnd;
  void railStart;
  // Substructure: box girder below the slab, down below the catwalk level.
  B.box("concrete_dirty", 0, (top - LAYER) / 2 - 1.2, zc, core * 2, top - LAYER + 2.4, len, 0xb8b2a6, { group: "decor" });
  // Catwalk gratings (steel, at y = 0) and their outer rails.
  for (const s of [-1, 1]) {
    const cx = s * (core + catOut) / 2;
    B.box("metal_dark", cx, -0.05, zc, catOut - core, 0.1, len + 1, 0x5a5e5c, { group: "decor", noAo: true });
    for (let z = north; z < south; z += 1.2) B.box("metal_dark", cx, -0.14, z, catOut - core, 0.08, 0.06, 0x3c403e, { group: "decor" });
    railing(B, v(s * (catOut + 0.05), 0, north), v(s * (catOut + 0.05), 0, south), 1.1, 0x4c5250, 1.2);
    // Deck parapets (concrete) with their gaps.
    const gaps = PARAPET_GAPS.map(([z, l]) => [z - l / 2, z + l / 2]).sort((a, b) => a[0] - b[0]);
    let from = north - pad;
    for (const [g0, g1] of [...gaps, [south + pad, south + pad]]) {
      if (g0 - from > 0.5) {
        B.box("concrete", s * (deckHalf - 0.15), top + 0.52, (from + g0) / 2, 0.3, 1.05, g0 - from, 0xd2ccc0, { group: "decor" });
        B.box("concrete_dirty", s * (deckHalf - 0.15), top + 1.07, (from + g0) / 2, 0.36, 0.06, g0 - from, 0xb8b2a6, { group: "decor" });
      }
      from = g1;
    }
  }
  // Pier caps: concrete stairs on the catwalks.
  const capN = Math.round(deck / CAP_LAYER);
  for (const pz of piers) {
    for (const s of [-1, 1]) {
      for (let k = 1; k <= capN; k++) {
        const half = 1.5 + (capN - k) * STEP;
        const x0 = k === capN ? deckHalf : core;
        B.box("concrete", s * (x0 + catOut) / 2, (k - 0.5) * CAP_LAYER, pz, catOut - x0, CAP_LAYER, half * 2, k % 2 ? 0xcac4b8 : 0xc2bcb0, { group: "decor" });
      }
      // Handrail up the outer edge.
      railing(B, v(s * (catOut - 0.1), 0, pz + 1.5 + (capN - 1) * STEP), v(s * (catOut - 0.1), deck, pz + 1.5), 0.95, 0xb08a3a, 0.9, "decor", "metal_painted");
    }
  }
  // Approach ramps: the stacked steps drawn as a stepped concrete ramp with an asphalt skin.
  for (const sgn of [1, -1]) {
    for (let k = 1; k < BRIDGE.layers; k++) {
      const ext = pad + (BRIDGE.layers - k) * STEP;
      const z0 = sgn * (sgn > 0 ? south : -north);
      const zEnd = z0 + sgn * ext;
      const zStep = zEnd - sgn * STEP;
      // Only the outermost STEP of each layer shows (the rest is under the next layer).
      B.box("asphalt", -1.5, (k - 0.5) * LAYER, (zEnd + zStep) / 2, 12, LAYER, STEP, ASPHALT, { group: "decor" });
      B.box("gravel", 5, (k - 0.5) * LAYER, (zEnd + zStep) / 2, 4, LAYER, STEP, 0x9a948a, { group: "decor" });
    }
    // Ramp side walls.
    const zr0 = sgn > 0 ? south : north;
    const zr1 = zr0 + sgn * (pad + 11 * STEP);
    for (const s of [-1, 1]) {
      const mid = (zr0 + zr1) / 2;
      B.box("concrete", s * (core + 0.15), 0.7, mid, 0.3, 1.4, Math.abs(zr1 - zr0), 0xc8c2b6, { group: "decor" });
    }
  }

  // ---- Piers, abutments, trusses ---------------------------------------------------------------------
  for (const pz of piers) {
    // Wall pier with rounded cutwaters, from the riverbed to the girder.
    const h = -FLOOR_Y - 1.2;
    B.box("concrete_dirty", 0, FLOOR_Y + h / 2 - 1, pz, catOut * 2 + 1.6, h, 3.2, 0xb4ae9e, { group: "decor" });
    const cut = new THREE.CylinderGeometry(1.6, 1.8, h, 12, 1);
    for (const s of [-1, 1]) {
      const m = new THREE.Matrix4().makeTranslation(s * (catOut + 0.8), FLOOR_Y + h / 2 - 1, pz);
      B.add(cut, m, "concrete_dirty", 0xb0aa9a, { group: "decor" });
    }
    cut.dispose();
    // Bearing cap.
    B.box("concrete", 0, -1.7, pz, catOut * 2 + 2.4, 1.2, 4.2, 0xc8c2b4, { group: "decor" });
  }
  for (const zr of [south, north]) {
    const s = Math.sign(zr);
    B.box("concrete_dirty", 0, -9, zr - s * 0.5, catOut * 2 + 4, 18, 3, 0xb4ae9e, { group: "decor" });
  }
  // Through-trusses: Pratt panels, 5 m long, 10 m tall, over each catwalk's outer edge.
  const tx = catOut + 0.35;
  const H = 10.5;
  const panel = 5;
  const spans: [number, number][] = [[south, piers[0]], [piers[0], piers[1]], [piers[1], north]];
  for (const s of [-1, 1]) {
    const x = s * tx;
    for (const [za, zb] of spans) {
      beam(B, [x, -0.6, za], [x, -0.6, zb], 0.5, 0.9, "metal_painted", STEEL, "decor");
      // Top chord with end posts sloping down to the bearings.
      beam(B, [x, H, za - Math.sign(za - zb) * panel], [x, H, zb + Math.sign(za - zb) * panel], 0.55, 0.7, "metal_painted", STEEL, "decor");
      beam(B, [x, -0.6, za], [x, H, za - Math.sign(za - zb) * panel], 0.55, 0.7, "metal_painted", STEEL, "decor");
      beam(B, [x, -0.6, zb], [x, H, zb + Math.sign(za - zb) * panel], 0.55, 0.7, "metal_painted", STEEL, "decor");
      const n = Math.round(Math.abs(zb - za) / panel);
      const dir = Math.sign(zb - za);
      for (let i = 1; i < n; i++) {
        const z = za + dir * i * panel;
        beam(B, [x, -0.6, z], [x, H, z], 0.32, 0.4, "metal_painted", STEEL, "decor");
        // Diagonals lean towards mid-span.
        const toward = i < n / 2 ? -dir : dir;
        if (i !== n / 2) beam(B, [x, -0.6, z], [x, H, z + toward * panel], 0.26, 0.3, "metal_painted", STEEL, "decor");
      }
      // Overhead lateral bracing between the trusses (only on one side to avoid doubling).
      if (s === 1) {
        for (let i = 1; i < n; i++) {
          const z = za + dir * i * panel;
          beam(B, [-tx, H, z], [tx, H, z], 0.3, 0.45, "metal_painted", STEEL, "decor");
          if (i % 2) beam(B, [-tx, H, z], [tx, H, z + dir * panel], 0.18, 0.2, "metal_painted", STEEL, "decor");
        }
        // Portal frames at each end.
        for (const z of [za - Math.sign(za - zb) * panel, zb + Math.sign(za - zb) * panel]) {
          beam(B, [-tx, H - 1.6, z], [tx, H - 1.6, z], 0.4, 1.2, "metal_painted", STEEL_RUST, "decor");
        }
      }
    }
  }
  // Rust streaks and a burnt section of girder over the shell hit.
  for (let i = 0; i < 26; i++) {
    const z = north + r() * len;
    const s = r() < 0.5 ? -1 : 1;
    B.box("metal_rust", s * (tx + 0.27), 1 + r() * 8, z, 0.02, 1.5 + r() * 3, 0.4 + r() * 0.6, 0x8a5a40, { group: "decor", noAo: true });
  }

  // ---- The shell hit (blocked road lane) ------------------------------------------------------------
  {
    const c = CRATER;
    for (let i = 0; i < 6; i++) {
      const x = c.x - c.w / 2 + 1 + r() * (c.w - 2), z = c.z - c.d / 2 + 0.8 + r() * (c.d - 1.6);
      B.box("concrete_broken", x, top + 0.5 + r() * 0.5, z, 2.4 + r() * 1.5, 0.35, 1.8 + r(), 0xbcb6aa, { group: "decor", rotX: (r() - 0.5) * 0.9, rotZ: (r() - 0.5) * 0.9, rotY: r() * 3 });
    }
    beam(B, [c.x - c.w / 2, top + 0.2, c.z + 1.8], [c.x + 2.5, top + 1.7, c.z - 1.4], 0.5, 0.8, "metal_rust", STEEL_RUST, "decor");
    beam(B, [c.x + 1, top + 0.4, c.z + 2.2], [c.x - 3, top + 1.4, c.z - 2], 0.4, 0.6, "metal_rust", STEEL_RUST, "decor");
    rubblePile(B, c.x, c.z, c.w / 2, c.d / 2, 1.6, 77, "decor", () => top, 2);
    for (let i = 0; i < 8; i++) tube(B, [c.x - 3 + r() * 6, top + 0.3, c.z - 2 + r() * 4], [c.x - 3 + r() * 6, top + 1.6 + r(), c.z - 2 + r() * 4], 0.02, "metal_dark", 0x6a5a4a, 5);
  }

  // ---- Wrecks, the stalled train, nests ---------------------------------------------------------------
  WRECKS.forEach((w, i) => {
    if (w.kind === "truck") patrolTruck(B, w.x, w.z, w.yaw + Math.PI / 2, "decor", 0x3a3631, deck);
    else burntCar(B, w.x, w.z, w.yaw + Math.PI / 2, w.kind, 300 + i, "decor", deck);
  });
  for (const w of TRAIN.wagons) wagon(B, TRAIN.x + (w.derailed ? -0.6 : 0), deck, w.z, w.len, !!w.derailed, r);

  // ---- South bridgehead: booth, boom gates, lamp posts -------------------------------------------------
  {
    const b = BOOTH;
    const t = 0.2;
    const tint = 0xe6e0d2;
    B.boxFeet("plaster", b.x, 0, b.z - b.d / 2 + t / 2, b.w, b.h, t, tint, { group: "decor" });
    B.boxFeet("plaster", b.x, 0, b.z + b.d / 2 - t / 2, b.w, b.h, t, tint, { group: "decor" });
    B.boxFeet("plaster", b.x - b.w / 2 + t / 2, 0, b.z, t, b.h, b.d - t * 2, tint, { group: "decor" });
    const seg = (b.d - t * 2 - b.door) / 2;
    for (const sg of [-1, 1]) B.boxFeet("plaster", b.x + b.w / 2 - t / 2, 0, b.z + sg * (b.door / 2 + seg / 2), t, b.h, seg, tint, { group: "decor" });
    B.boxFeet("metal_painted", b.x, b.h, b.z, b.w + 0.6, 0.2, b.d + 0.6, 0xa8322a, { group: "decor" });
    // Windows: dark glass bands on three sides.
    B.box("metal_dark", b.x, 1.6, b.z - b.d / 2 - 0.01, b.w - 0.8, 0.8, 0.04, 0x1c2226, { group: "decor", noAo: true });
    B.box("metal_dark", b.x, 1.6, b.z + b.d / 2 + 0.01, b.w - 0.8, 0.8, 0.04, 0x1c2226, { group: "decor", noAo: true });
    B.box("metal_dark", b.x - b.w / 2 - 0.01, 1.6, b.z, 0.04, 0.8, b.d - 0.8, 0x1c2226, { group: "decor", noAo: true });
    // Desk inside.
    B.boxFeet("wood", b.x - 0.9, 0, b.z, 0.6, 0.85, 2, 0x8a7458, { group: "decor" });
    // Boom gates across both lanes (raised one, lowered one).
    for (const [x, raised] of [[-2.5, false], [2.5, true]] as const) {
      B.boxFeet("metal_painted", x - Math.sign(x) * 3.2, 0, 68.4, 0.35, 1.1, 0.35, 0x3a3a38, { group: "decor" });
      const ax = x - Math.sign(x) * 3.2;
      const end = raised ? v(ax + Math.sign(x) * 0.6, 4.8, 68.4) : v(ax + Math.sign(x) * 5.6, 1.0, 68.4);
      for (let i = 0; i < 6; i++) {
        const a = v(ax, 1.0, 68.4).lerp(end, i / 6), bb = v(ax, 1.0, 68.4).lerp(end, (i + 1) / 6);
        beam(B, [a.x, a.y, a.z], [bb.x, bb.y, bb.z], 0.09, 0.09, "metal_painted", i % 2 ? 0xd8d4c8 : 0xb8302a, "decor");
      }
    }
  }

  // ---- North bridgehead: bunker, dragon's teeth, mast -----------------------------------------------------
  {
    const k = BUNKER;
    const wall = 0xb2ac9e;
    B.boxFeet("concrete_dirty", k.x, 0, k.z + k.d / 2 - k.t / 2, k.w, k.slit.y, k.t, wall, { group: "decor" });
    B.boxFeet("concrete_dirty", k.x, k.slit.y + k.slit.h, k.z + k.d / 2 - k.t / 2, k.w, k.h - k.slit.y - k.slit.h, k.t, wall, { group: "decor" });
    for (const sg of [-1, 1]) B.boxFeet("concrete_dirty", k.x + sg * (k.w / 2 - k.t / 2), 0, k.z, k.t, k.h, k.d - k.t * 2, wall, { group: "decor" });
    const seg = (k.w - k.door) / 2;
    for (const sg of [-1, 1]) B.boxFeet("concrete_dirty", k.x + sg * (k.door / 2 + seg / 2), 0, k.z - k.d / 2 + k.t / 2, seg, k.h, k.t, wall, { group: "decor" });
    B.boxFeet("concrete_dirty", k.x, k.h, k.z, k.w + 0.4, 0.6, k.d + 0.4, 0xa8a294, { group: "decor" });
    // Earth banked against the sides and sandbags on the roof.
    for (const sg of [-1, 1]) B.box("ground", k.x + sg * (k.w / 2 + 1.1), 0.7, k.z, 2.6, 1.4, k.d + 1.2, 0x6a6048, { group: "decor", rotZ: sg * 0.5 });
    for (let i = 0; i < 5; i++) B.boxFeet("sandbag", k.x - 3.6 + i * 1.8, k.h + 0.6, k.z + k.d / 2 - 0.5, 1.5, 0.35, 0.7, 0xc4b48e, { group: "decor" });
    // Interior: dark floor, ammo boxes, the gun.
    B.box("concrete", k.x, 0.02, k.z, k.w - 1.2, 0.03, k.d - 1.2, 0x5e5a52, { group: "decor", noAo: true });
    tube(B, [k.x - 1, 1.35, k.z + 1.6], [k.x - 1, 1.35, k.z + 3.3], 0.06, "metal_dark", 0x2a2c2a, 8);
    B.boxFeet("metal_painted", k.x - 1, 0, k.z + 1.4, 0.5, 1.25, 0.5, 0x3e4436, { group: "decor" });
    for (let i = 0; i < 3; i++) B.boxFeet("metal_painted", k.x + 2 + i * 0.6, 0, k.z - 1.6, 0.5, 0.3, 0.3, 0x4f5638, { group: "decor" });
    // Dragon's teeth.
    for (const x of [-4.4, -1.4, 1.6, 4.6]) {
      const geo = new THREE.CylinderGeometry(0.2, 0.62, 1.0, 4);
      B.add(geo, new THREE.Matrix4().makeRotationY(Math.PI / 4).setPosition(x, 0.5, -82), "concrete_dirty", 0xb4ae9e, { group: "decor" });
      geo.dispose();
    }
    // Signal mast: lattice with a platform.
    const m = MAST;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) beam(B, [m.x + sx * 1.3, 0, m.z + sz * 1.3], [m.x + sx * 0.6, 14, m.z + sz * 0.6], 0.14, 0.14, "metal_painted", 0x8a7a68, "decor");
    for (let y = 2; y < 14; y += 2.5) {
      const k2 = 1.3 - (y / 14) * 0.7;
      beam(B, [m.x - k2, y, m.z - k2], [m.x + k2, y, m.z + k2], 0.06, 0.06, "metal_painted", 0x8a7a68, "decor");
      beam(B, [m.x + k2, y, m.z - k2], [m.x - k2, y, m.z + k2], 0.06, 0.06, "metal_painted", 0x8a7a68, "decor");
    }
    B.boxFeet("metal_dark", m.x, m.perch - 0.15, m.z, m.size, 0.15, m.size, 0x4a4e4c, { group: "decor" });
    railing(B, v(m.x - 1.5, m.perch, m.z - 1.5), v(m.x + 1.5, m.perch, m.z - 1.5), 1, 0x4a4e4c, 0.5);
    railing(B, v(m.x - 1.5, m.perch, m.z + 1.5), v(m.x + 1.5, m.perch, m.z + 1.5), 1, 0x4a4e4c, 0.5);
    ladder(B, m.x - 1.55, m.z, 0, m.perch, -1, 0, 0x4a4e4c);
    B.box("metal_painted", m.x, 15, m.z, 0.9, 0.5, 0.9, 0xa8322a, { group: "decor" });
  }

  // ---- Customs yard, water tower ---------------------------------------------------------------------------
  building(B, props, { x: (CUSTOMS.x0 + CUSTOMS.x1) / 2, z: (CUSTOMS.z0 + CUSTOMS.z1) / 2, w: CUSTOMS.x1 - CUSTOMS.x0, d: CUSTOMS.z1 - CUSTOMS.z0, floors: 2, floorH: 3.2, seed: 91, tint: 0xd8d2c0, damage: 0.3, front: 1, detail: true, glazed: true });
  {
    const t = TOWER;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) beam(B, [t.x + sx * 1.7, 0, t.z + sz * 1.7], [t.x + sx * 1.3, t.perch, t.z + sz * 1.3], 0.2, 0.2, "metal_painted", 0x7a6a5a, "decor");
    for (let y = 1.8; y < t.perch; y += 2.2) {
      beam(B, [t.x - 1.6, y, t.z - 1.6], [t.x + 1.6, y + 1.6, t.z + 1.6], 0.07, 0.07, "metal_painted", 0x7a6a5a, "decor");
      beam(B, [t.x + 1.6, y, t.z - 1.6], [t.x - 1.6, y + 1.6, t.z + 1.6], 0.07, 0.07, "metal_painted", 0x7a6a5a, "decor");
    }
    B.boxFeet("metal_dark", t.x, t.perch - 0.2, t.z, t.size + 0.8, 0.2, t.size + 0.8, 0x4a4e4c, { group: "decor" });
    const tank = new THREE.CylinderGeometry(2.1, 2.1, 3.6, 16);
    B.add(tank, new THREE.Matrix4().makeTranslation(t.x + 0.4, t.perch + 2.6, t.z + 0.3), "metal_painted", 0x8c9aa0, { group: "decor", uv: "keep", uvScale: [13, 3.6] });
    tank.dispose();
    const cap = new THREE.ConeGeometry(2.3, 1.1, 16);
    B.add(cap, new THREE.Matrix4().makeTranslation(t.x + 0.4, t.perch + 4.95, t.z + 0.3), "metal_painted", 0x6e7a80, { group: "decor", uv: "keep", uvScale: [13, 1.2] });
    cap.dispose();
    ladder(B, t.x - 1.95, t.z - 1, 0, t.perch, -1, 0, 0x4a4e4c);
  }
  patrolTruck(B, 4.5, -91.5, Math.PI / 2, "decor", 0x6a6e58);
  patrolTruck(B, -28, 68, 0, "decor", 0x8a8a7a);
  patrolTruck(B, 30, 69, Math.PI / 2, "decor", 0x6a6e58);
  chainlink(B, -30, -88, -30, -116, 2.2, flat, 41);
  chainlink(B, -30, -116, 20, -116, 2.2, flat, 42);
  // LZ marker: a painted H in the field.
  B.box("concrete", LZ.x, 0.02, LZ.z, 14, 0.03, 14, 0x9a9688, { group: "decor", noAo: true });
  for (const [x, z, w, d] of [[-2.2, 0, 0.6, 5], [2.2, 0, 0.6, 5], [0, 0, 4.4, 0.6]] as const) B.box("concrete", LZ.x + x, 0.04, LZ.z + z, w, 0.02, d, 0xe8e2d4, { group: "decor", noAo: true });

  // ---- Brask -----------------------------------------------------------------------------------------------
  for (const b of BLOCKS) {
    building(B, props, { x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, w: b.x1 - b.x0, d: b.z1 - b.z0, floors: b.floors, floorH: 3.3, seed: b.seed, tint: b.tint, damage: b.damage ?? 0.1, front: b.front, detail: true, glazed: true });
  }
  church(B, r);
  // Fountain.
  {
    const f = FOUNTAIN;
    const basin = new THREE.CylinderGeometry(f.r, f.r + 0.15, 0.85, 20, 1, true);
    B.add(basin, new THREE.Matrix4().makeTranslation(f.x, 0.42, f.z), "concrete", 0xd8d0c0, { group: "decor", uv: "keep", uvScale: [15, 0.85] });
    basin.dispose();
    B.box("concrete", f.x, 0.88, f.z, f.r * 1.8, 0.06, f.r * 1.8, 0xd0c8b8, { group: "decor" });
    const col = new THREE.CylinderGeometry(0.35, 0.5, 2.6, 10);
    B.add(col, new THREE.Matrix4().makeTranslation(f.x, 1.3, f.z), "concrete", 0xd8d0c0, { group: "decor", uv: "keep", uvScale: [3, 2.6] });
    col.dispose();
  }
  // Burnt bus in the street.
  {
    const x = -2.6, z = 120;
    B.boxFeet("metal_rust", x, 0.35, z, 2.5, 2.4, 8.8, 0x4a3a30, { group: "decor" });
    B.box("metal_dark", x - 1.26, 1.9, z, 0.04, 0.9, 8, 0x141414, { group: "decor", noAo: true });
    B.box("metal_dark", x + 1.26, 1.9, z, 0.04, 0.9, 8, 0x141414, { group: "decor", noAo: true });
    for (const dz of [-3, 3]) for (const sx of [-1, 1]) {
      const w = new THREE.CylinderGeometry(0.45, 0.45, 0.3, 10).rotateZ(Math.PI / 2);
      B.add(w, new THREE.Matrix4().makeTranslation(x + sx * 1.05, 0.38, z + dz), "metal_dark", 0x1e1e1e, { group: "decor" });
      w.dispose();
    }
  }
  // Promenade balustrade, lamps and benches.
  for (const [x0, x1] of [[-44, -16], [16, 44]] as const) {
    B.boxFeet("concrete", (x0 + x1) / 2, 0, 63.2, x1 - x0, 0.9, 0.5, 0xddd6c6, { group: "decor" });
    B.boxFeet("concrete", (x0 + x1) / 2, 0.9, 63.2, x1 - x0, 0.08, 0.62, 0xc8c0b0, { group: "decor" });
    for (let x = x0 + 3; x < x1; x += 7) {
      tube(B, [x, 0, 65.8], [x, 3.6, 65.8], 0.06, "metal_dark", 0x2a2e2c, 6);
      B.box("metal_dark", x, 3.65, 65.6, 0.25, 0.18, 0.5, 0x2a2e2c, { group: "decor" });
    }
  }
  // Riverside railing in front of the bridge gap.
  railing(B, v(-16, 0, 61), v(-catOut - 0.5, 0, 61), 1.0, 0x3a3e3c, 0.16);
  railing(B, v(catOut + 0.5, 0, 61), v(16, 0, 61), 1.0, 0x3a3e3c, 0.16);
  railing(B, v(-50, 0, -61), v(-catOut - 0.5, 0, -61), 1.0, 0x3a3e3c, 0.5);
  railing(B, v(catOut + 0.5, 0, -61), v(50, 0, -61), 1.0, 0x3a3e3c, 0.5);

  // ---- Debris and litter ------------------------------------------------------------------------------------
  const keep = (x: number, z: number) => clearOf(boxes, x, z, 0.3) && Math.abs(z) > south + 1;
  debrisScatter(B, 0, 100, 40, Math.round(70 * detail.debris), 5, "decor", flat, keep);
  debrisScatter(B, 0, -90, 30, Math.round(50 * detail.debris), 6, "decor", flat, keep);
  litter(B, 6, 104, 14, Math.round(30 * detail.debris), 7, "decor", keep);
  debrisScatter(B, -2, 30, 6, Math.round(28 * detail.debris), 8, "decor", () => deck, (x, z) => clearOf(boxes, x, z, 0.3) && Math.abs(x) < deckHalf - 0.6);
  debrisScatter(B, -2, -40, 6, Math.round(28 * detail.debris), 9, "decor", () => deck, (x, z) => clearOf(boxes, x, z, 0.3) && Math.abs(x) < deckHalf - 0.6);
  for (const [x, z] of [[-26, 90], [32, 120], [-36, 120]] as const) rubblePile(B, x, z, 1.6, 1.2, 0.8, Math.round(x * 3 + z), "decor", flat, detail.debris);

  // ---- Foliage ----------------------------------------------------------------------------------------------
  const trees: TreePlacement[] = [];
  for (const [x, z] of TOWN_TREES) trees.push({ x, z, scale: 0.8 + r() * 0.3, variant: r() < 0.6 ? 0 : 3, rot: r() * 6 });
  const treeCount = name === "low" ? 110 : 190;
  let guard = 0;
  while (trees.length < treeCount && guard++ < 9000) {
    const x = (r() * 2 - 1) * 200, z = BOUNDS.z0 - 60 + r() * (BOUNDS.z1 - BOUNDS.z0 + 120);
    const gd = gorgeDepth(x, z);
    if (gd < -1) continue; // nothing grows on the cliffs
    const inside = inPlay(x, z);
    if (inside) {
      // Inside the map only in the north field's forest edge and the margins.
      if (!(z < -140 || Math.abs(x) > 44) || !clearOf(boxes, x, z, 1.2)) continue;
      if (Math.hypot(x - LZ.x, z - LZ.z) < 18) continue;
    } else if (Math.abs(x) < 12 && z > BOUNDS.z1) continue;
    if (fbm2(x * 0.03 + 5, z * 0.03 - 3, 3) < 0.44) continue;
    trees.push({ x, z, scale: 0.95 + r() * 0.6, variant: r() < 0.55 ? 1 : r() < 0.85 ? 0 : 2, rot: r() * 6 });
  }
  const bushes: BushPlacement[] = [];
  for (let i = 0; i < 120; i++) {
    const x = (r() * 2 - 1) * 48, z = BOUNDS.z0 + r() * (BOUNDS.z1 - BOUNDS.z0);
    if (Math.abs(z) < south + 2 || !clearOf(boxes, x, z, 0.8) || roadAt(x, z) > 0.2 || inSquare(x, z)) continue;
    bushes.push({ x, z, scale: 0.6 + r() * 0.7, dry: r() < 0.15 });
  }
  // Scrub clinging to the gorge ledges (visual, below the rims).
  for (let i = 0; i < 70; i++) {
    const x = (r() * 2 - 1) * 120, z = (r() * 2 - 1) * 56;
    const y = gorgeDepth(x, z);
    if (y > -3 || y < RIVER_Y + 1.5 || Math.abs(x) < catOut + 3) continue;
    bushes.push({ x, z, scale: 0.8 + r() * 0.8, dry: r() < 0.3 });
  }

  // ---- Distant scenery: a far village and a hilltop chapel --------------------------------------------------
  for (const [x, z, w, d, f] of [[-120, 190, 10, 8, 2], [-104, 204, 8, 9, 2], [118, 186, 12, 8, 3], [140, -210, 9, 9, 2], [-150, -196, 10, 7, 2]] as const) {
    building(B, null, { x, z, w, d, floors: f, floorH: 3.2, seed: Math.round(x * 7 + z), groundY: height(x, z), group: "far", detail: false, hollow: true });
  }

  // Skyline beyond the hills: pylons striding across, masts on the crests, farms and copses.
  skyline(B, {
    height,
    seed: 3301,
    quality: name,
    rMin: 230,
    rMax: 330,
    // Not in the gorge (it runs east-west through z = 0) nor over the play strip.
    keepOut: (x, z) => Math.abs(z - gorgeShift(x)) < 40 || (Math.abs(x) < BOUNDS.x1 + 60 && z > BOUNDS.z0 - 60 && z < BOUNDS.z1 + 60),
    masts: 3,
    farms: 4,
    blocks: 5,
    trees: 70,
    treeTint: 0x3e4a2e,
    pylons: { angle: 1.25, offset: 260 },
  });

  // ---- Smoke ----------------------------------------------------------------------------------------------
  extras.push(
    smokeColumns(
      [
        { x: -2.2, y: deck + 2.5, z: 8, scale: 0.55, dark: true },
        { x: 28, y: 10, z: 118, scale: 0.7, dark: true },
        { x: -160, y: height(-160, -150) + 4, z: -150, scale: 1.1 },
        { x: 180, y: height(180, 120) + 2, z: 120, scale: 1.0 },
      ],
      name,
    ),
  );

  extras.push(...finishGrime(B));
  return {
    terrain: { height, splat, inner: 110, outer: 480 },
    foliage: { grass, grassBounds: 175, trees, bushes, tallGrass, tallGrassBounds: 175 },
    extras,
  };
};

// -------------------------------------------------------------------------------------------------------------

/** Freight boxcar on the rail lane (derailed ones lean and slew). */
function wagon(B: MeshBuilder, x: number, y: number, z: number, len: number, derailed: boolean, r: () => number) {
  const roll = derailed ? -0.11 : 0;
  const yaw = derailed ? 0.05 : 0;
  const m = new THREE.Matrix4();
  const put = (mat: "metal_corrugated" | "metal_dark" | "metal_rust" | "metal_painted", lx: number, ly: number, lz: number, w: number, h: number, d: number, tint: number) => {
    m.makeRotationY(yaw).multiply(new THREE.Matrix4().makeRotationZ(roll)).setPosition(x, y, z);
    m.multiply(new THREE.Matrix4().makeTranslation(lx, ly, lz)).multiply(new THREE.Matrix4().makeScale(w, h, d));
    B.add(new THREE.BoxGeometry(1, 1, 1), m, mat, tint, { group: "decor" });
  };
  const body = [0x8a4a38, 0x6a5a48, 0x5a6a70][Math.floor(r() * 3)];
  put("metal_corrugated", 0, 2.25, 0, 2.9, 2.8, len - 0.6, body);
  put("metal_painted", 0, 3.72, 0, 3.0, 0.14, len - 0.4, 0x4a4440);
  put("metal_dark", 0, 0.75, 0, 2.6, 0.35, len, 0x2a2826);
  for (const s of [-1, 1]) {
    put("metal_dark", 0, 0.45, s * (len / 2 - 2), 2.2, 0.5, 2.6, 0x1e1d1c);
    put("metal_rust", s * 1.46, 2.1, 0, 0.05, 2.2, 1.8, 0x5a3a2c); // sliding door
  }
}

/** The church on the square: nave, pitched roof, tower with a spire. */
function church(B: MeshBuilder, r: () => number) {
  const c = CHURCH;
  const w = c.x1 - c.x0, d = c.z1 - c.z0;
  const cx = (c.x0 + c.x1) / 2, cz = (c.z0 + c.z1) / 2;
  B.boxFeet("plaster", cx, 0, cz, w, 9, d, 0xe8e0cc, { group: "decor" });
  // Pitched roof along x.
  const roof = new THREE.CylinderGeometry(0.01, d * 0.62, w + 0.6, 3, 1).rotateZ(Math.PI / 2).rotateX(Math.PI / 6);
  const ex = new THREE.Matrix4().makeScale(1, 0.55, 1).setPosition(cx, 9 + d * 0.16, cz);
  B.add(roof, ex, "metal_corrugated", 0x7a4a38, { group: "decor" });
  roof.dispose();
  // Tall windows.
  for (let i = 0; i < 4; i++) {
    const x = c.x0 + 2 + i * ((w - 4) / 3);
    for (const z of [c.z0 - 0.02, c.z1 + 0.02]) B.box("metal_dark", x, 5, z, 1.1, 3.4, 0.05, 0x1e2426, { group: "decor", noAo: true });
  }
  const t = c.tower;
  // Shaft up to the perch, an open belfry the sniper fires from, then the lantern and spire.
  const bel = t.perch + 3;
  B.boxFeet("plaster", t.x, 0, t.z, t.size, t.perch, t.size, 0xe2d8c2, { group: "decor" });
  B.boxFeet("concrete", t.x, t.perch - 0.2, t.z, t.size + 0.4, 0.2, t.size + 0.4, 0xc8c0b0, { group: "decor" });
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.boxFeet("plaster", t.x + sx * (t.size / 2 - 0.3), t.perch, t.z + sz * (t.size / 2 - 0.3), 0.6, 3, 0.6, 0xe2d8c2, { group: "decor" });
  for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) B.boxFeet("plaster", t.x + nx * (t.size / 2 - 0.1), t.perch, t.z + nz * (t.size / 2 - 0.1), nz ? t.size - 1.2 : 0.2, 0.9, nx ? t.size - 1.2 : 0.2, 0xd8cebc, { group: "decor" });
  B.boxFeet("concrete", t.x, bel, t.z, t.size + 0.5, 0.4, t.size + 0.5, 0xc8c0b0, { group: "decor" });
  B.boxFeet("plaster", t.x, bel + 0.4, t.z, t.size - 0.4, 2.6, t.size - 0.4, 0xe2d8c2, { group: "decor" });
  const spire = new THREE.ConeGeometry(t.size * 0.66, 7, 4);
  B.add(spire, new THREE.Matrix4().makeRotationY(Math.PI / 4).setPosition(t.x, bel + 3 + 3.5, t.z), "metal_corrugated", 0x5a6a62, { group: "decor", uv: "keep", uvScale: [6, 7] });
  spire.dispose();
  void r;
}

/**
 * The Vellen: one long water plane down the gorge with a scrolling,
 * procedurally drawn ripple normal map (no new render-pipeline code).
 */
function river(anisotropy: number): WorldExtra {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const img = g.createImageData(size, size);
  const hgt = (x: number, y: number) => Math.sin((x / size) * Math.PI * 8 + Math.sin((y / size) * Math.PI * 4) * 1.5) + Math.sin((y / size) * Math.PI * 6 + (x / size) * Math.PI * 2) * 0.6;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = hgt(x + 1, y) - hgt(x - 1, y), dy = hgt(x, y + 1) - hgt(x, y - 1);
      const i = (y * size + x) * 4;
      img.data[i] = 128 + dx * 40;
      img.data[i + 1] = 128 + dy * 40;
      img.data[i + 2] = 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const normal = new THREE.CanvasTexture(c);
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  normal.repeat.set(60, 4);
  normal.anisotropy = anisotropy;
  const mat = new THREE.MeshStandardMaterial({ color: 0x2c4440, roughness: 0.12, metalness: 0.25, normalMap: normal, normalScale: new THREE.Vector2(0.5, 0.5) });
  const geo = new THREE.PlaneGeometry(900, RIVER_HALF * 2 + 6, 90, 4).rotateX(-Math.PI / 2);
  // Follow the gorge's wander.
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + gorgeShift(p.getX(i)));
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = RIVER_Y;
  mesh.receiveShadow = true;
  mesh.name = "river";
  const clock = new THREE.Clock();
  return {
    object: mesh,
    triangles: 90 * 4 * 2,
    update() {
      normal.offset.x = (clock.getElapsedTime() * 0.02) % 1;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      normal.dispose();
    },
  };
}
