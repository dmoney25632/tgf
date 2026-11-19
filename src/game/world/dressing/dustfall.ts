import * as THREE from "three";
import { rng, type BushPlacement, type TreePlacement } from "../Foliage";
import type { Splat } from "../Terrain";
import { poleWirePoints } from "../BoxStyles";
import { clutterGroup } from "../MeshBuilder";
import { qualityName, worldDetail } from "../quality";
import { palms, type PalmPlacement } from "../Palms";
import { smokeColumns } from "../Smoke";
import { SHED } from "../maps/dustfallOutpost";
import { facades, silhouette, spall } from "../architecture/Building";
import {
  acUnit, awning, cable, chainlink, dish, downpipe, groundDecal, groundPatch, groundStrip, paintLine, pendantLamp, pipeRail, rod, wall, wallDecal, waterTank,
} from "../architecture/kit";
import { burntCar, debrisScatter, litter, rubblePile } from "../architecture/debris";
import { gasBottles, patrolTruck } from "../architecture/vehicles";
import { postSign, roadArrow, signGantry } from "../architecture/signs";
import { camoNets, type NetSpec } from "../CamoNet";
import { helicopter } from "../Helicopter";
import { town } from "./town";
import {
  band, clearOf, concertina, decorBox, fbm2, fence, pallets, poleLine, scatterTrees, smoothstep, tyre, wireSpan,
  type Dressing, type PoleSpot, type WorldExtra,
} from "./common";

const ROAD_Z = -74;
const R = 32; // compound wall line
const BERM = 48; // berm inner face

/**
 * Dustfall Outpost set dressing: a fortified compound on the edge of a
 * shelled town. Terrain (flat play area, hills beyond the berm, broken
 * asphalt through the gates), plastered walls with broken crowns and
 * spalled plaster, the ops building, a steel warehouse shed over the
 * container yard, ground decals, rubble and litter, burnt-out cars, palms,
 * tall dry grass, the town rows and skyline beyond the berm, power lines
 * and distant smoke. Everything here is visual-only; colliders come from
 * the map's boxes.
 */
export const dustfall: Dressing = (kit) => {
  const { def, builder: B, props, quality } = kit;
  const r = rng(2024);
  const boxes = def.boxes;
  const detail = worldDetail(qualityName(quality));
  const tagged = (t: string) => boxes.filter((b) => b.tag === t);
  const spawns = def.survival?.enemySpawns ?? [];
  const nearSpawn = (x: number, z: number, m: number) => spawns.some((s) => Math.hypot(s.x - x, s.z - z) < m);
  const free = (x: number, z: number, m = 0.3) => clearOf(boxes, x, z, m);
  const extras: WorldExtra[] = [];

  // ---- Terrain ---------------------------------------------------------------------
  const height = (x: number, z: number) => {
    const d = Math.max(Math.abs(x), Math.abs(z));
    if (d <= 50) return 0;
    let h = smoothstep(50, 130, d) * (2 + 16 * fbm2(x * 0.009 + 3, z * 0.009 - 2, 4));
    h += smoothstep(52, 70, d) * (fbm2(x * 0.07, z * 0.07, 2) - 0.5) * 0.9;
    // Town ground is graded flatter close in.
    h *= 0.35 + 0.65 * smoothstep(90, 150, d);
    h *= 1 - 0.8 * Math.exp(-(((z - ROAD_Z) / 8) ** 2)) * smoothstep(55, 70, d);
    return h;
  };
  const track = (x: number, z: number) => {
    const ax = Math.abs(x), az = Math.abs(z);
    const wob = (fbm2(x * 0.05, z * 0.05, 2) - 0.5) * 2;
    return Math.max(band(ax + wob, 3) * (az < 47 ? 1 : 0), band(az + wob, 3) * (ax < 47 ? 1 : 0));
  };
  const splat = (x: number, z: number, o: Splat) => {
    const d = Math.max(Math.abs(x), Math.abs(z));
    const n = fbm2(x * 0.06, z * 0.06, 3);
    const n2 = fbm2(x * 0.17 + 9, z * 0.17, 2);
    const t = track(x, z);
    if (d < R) {
      // Dusty packed yard: gravel where vehicles run, loose dirt blotches,
      // dried mud pans; three noise scales so it never reads as one plane.
      const n3 = fbm2(x * 0.11 - 5, z * 0.11 + 3, 3);
      o.gravel = 0.3 + t * 1.2 + smoothstep(0.47, 0.6, n2) * 0.9;
      o.ground = 0.2 + smoothstep(29, 31.5, d) * 1.0 + smoothstep(0.45, 0.6, n) * 1.0;
      o.mud = smoothstep(0.55, 0.68, n3) * 1.2 + t * 0.35;
    } else if (d < BERM) {
      o.gravel = t * 0.6 + 0.25;
      o.ground = 1 - t * 0.75;
      o.mud = smoothstep(0.6, 0.72, n) * 0.6 + t * 0.5 + smoothstep(BERM - 2, BERM, d) * 0.4;
    } else {
      const road = band(z - ROAD_Z + (fbm2(x * 0.02, 1, 2) - 0.5) * 4, 3.5);
      const street = d > 64 && d < 72 ? 0.7 : 0;
      o.gravel = Math.max(road, street) + 0.15;
      o.ground = 1 - road * 0.9;
      o.mud = road * 0.25 + smoothstep(0.62, 0.75, n) * 0.4;
    }
  };

  // ---- Grass: short tufts + waist-high dry grass ------------------------------------
  const grass = (x: number, z: number) => {
    const d = Math.max(Math.abs(x), Math.abs(z));
    if (d < R - 0.4) {
      if (d > R - 2.6) return 0.6;
      const tuft = fbm2(x * 0.3, z * 0.3, 2);
      return track(x, z) > 0.3 ? 0 : tuft > 0.62 ? 0.45 : 0;
    }
    if (d < R + 0.5 || d > BERM - 0.2) return 0;
    const n = fbm2(x * 0.06, z * 0.06, 3);
    return Math.max(0, Math.min(1, 0.8 - track(x, z) * 1.3 - smoothstep(0.58, 0.7, n) * 0.6));
  };
  const tallGrass = (x: number, z: number) => {
    const d = Math.max(Math.abs(x), Math.abs(z));
    if (track(x, z) > 0.25 || nearSpawn(x, z, 2.5)) return 0;
    const n = fbm2(x * 0.08 + 4, z * 0.08 - 7, 3);
    if (d < R - 0.4) return d > R - 1.6 && n > 0.45 ? 0.5 : 0; // along the inside wall base
    if (d < R + 3.2) return 0.85; // hard against the outer wall face
    if (d < BERM - 0.3) return smoothstep(0.42, 0.6, n) * 0.75 + (d > BERM - 2.5 ? 0.6 : 0);
    if (d > 50 && d < 66) return smoothstep(0.35, 0.55, n) * 0.5; // berm slope and fields
    return 0;
  };

  // ---- Compound walls: plastered masonry, broken crown, spalls, grime -------------
  const wallTint = (i: number) => new THREE.Color(0xd8ccb4).multiplyScalar(0.9 + ((i * 37) % 10) / 60);
  tagged("wall").forEach((w, i) => {
    const alongX = w.w > w.d;
    const len = alongX ? w.w : w.d;
    const side = alongX ? (w.z < 0 ? 0 : 2) : w.x > 0 ? 1 : 3;
    const fs = facades(w.x, w.z, w.w, w.d, 0);
    const outer = fs[side], inner = fs[(side + 2) % 4];
    const thick = alongX ? w.d : w.w;
    wall(B, outer, { length: len, height: w.h, thickness: thick, ruin: 0.16, seed: 300 + i }, "plaster", wallTint(i));
    // Plinth band, pilasters (render-and-brick piers), razor wire on brackets.
    B.box("concrete_dirty", w.x, 0.3, w.z, alongX ? w.w : w.w + 0.1, 0.6, alongX ? w.d + 0.1 : w.d, 0xa8a294);
    for (let a = -len / 2 + 2.6; a < len / 2 - 1.5; a += 4.6) {
      if (alongX) B.box("plaster", w.x + a, (w.h - 0.1) / 2, w.z, 0.5, w.h - 0.1, w.d + 0.12, wallTint(i + 3));
      else B.box("plaster", w.x, (w.h - 0.1) / 2, w.z + a, w.w + 0.12, w.h - 0.1, 0.5, wallTint(i + 3));
    }
    const outward = alongX ? Math.sign(w.z) : Math.sign(w.x);
    if (alongX) concertina(B, w.x - len / 2 + 0.3, w.z + outward * 0.05, w.x + len / 2 - 0.3, w.z + outward * 0.05, w.h + 0.38);
    else concertina(B, w.x + outward * 0.05, w.z - len / 2 + 0.3, w.x + outward * 0.05, w.z + len / 2 - 0.3, w.h + 0.38);
    for (let a = -len / 2 + 1; a < len / 2; a += 3.2) {
      if (alongX) B.box("metal_dark", w.x + a, w.h + 0.4, w.z, 0.04, 0.6, 0.04, 0x6a6a66);
      else B.box("metal_dark", w.x, w.h + 0.4, w.z + a, 0.04, 0.6, 0.04, 0x6a6a66);
    }
    // Spalled render showing brickwork, pocks from firefights, streaks and base dirt — both faces.
    for (const f of [outer, inner]) {
      const n = 2 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) spall(B, f, { u: 0.8 + r() * (len - 1.6), y: 0.7 + r() * 1.9, r: 0.35 + r() * 0.55, seed: Math.floor(r() * 1e6) }, "decor", false);
      for (let k = 0; k < 2; k++) if (r() < 0.6) wallDecal(B, f, "pocks", 1 + r() * (len - 2), 1 + r() * 1.6, 1.3, 1.3);
      for (let u = 1.5 + r() * 2; u < len - 1; u += 3 + r() * 4) wallDecal(B, f, "leak", u, w.h - 0.75, 0.8 + r() * 0.6, 1.5, 0xffffff, 0.012);
      wallDecal(B, f, "baseDirt", len / 2, 0.75, len, 1.5, 0xffffff, 0.02);
      if (r() < 0.25) wallDecal(B, f, "soot", 1 + r() * (len - 2), 1.6, 2.2, 2.6, 0xffffff, 0.014);
    }
  });
  for (const w of tagged("lowwall")) {
    B.box("concrete", w.x, w.h + 0.06, w.z, w.w + 0.1, 0.12, w.d + 0.1, 0xd2cec4);
    groundDecal(B, "specks", w.x, w.z + 0.6, w.w + 1, 1.6, 0, 0xffffff);
  }
  for (const p of tagged("pillar")) {
    B.box("concrete", p.x, p.h + 0.1, p.z, p.w + 0.16, 0.2, p.d + 0.16, 0xd6d2c8);
    B.box("concrete_dirty", p.x, 0.25, p.z, p.w + 0.08, 0.5, p.d + 0.08, 0xb4b0a6);
  }

  // ---- Gate leaves, swung open against the outer wall face --------------------------
  const leaf = (x: number, z: number, alongX: boolean) => {
    const L = 3.3, H = 2.3;
    const tint = 0x8f9670;
    const mat = r() < 0.5 ? "corrugated_rust" : "metal_corrugated";
    if (alongX) {
      B.box(mat, x, 0.15 + H / 2, z, L, H, 0.04, tint);
      for (const yy of [0.18, 0.15 + H]) B.box("metal_dark", x, yy, z, L, 0.08, 0.08, 0x5c5f58);
      for (const o of [-L / 2, L / 2]) B.box("metal_dark", x + o, 0.15 + H / 2, z, 0.08, H, 0.08, 0x5c5f58);
    } else {
      B.box(mat, x, 0.15 + H / 2, z, 0.04, H, L, tint);
      for (const yy of [0.18, 0.15 + H]) B.box("metal_dark", x, yy, z, 0.08, 0.08, L, 0x5c5f58);
      for (const o of [-L / 2, L / 2]) B.box("metal_dark", x, 0.15 + H / 2, z + o, 0.08, H, 0.08, 0x5c5f58);
    }
  };
  for (const side of [-1, 1]) {
    for (const g of [-1, 1]) {
      const off = g * (4.1 + 1.75);
      const face = side * (R + 0.35 + 0.08);
      leaf(off, face, true);
      leaf(face, off, false);
    }
  }

  // ---- Corner guard posts: sandbag parapet + tin roof on posts ----------------------
  for (const c of tagged("corner")) {
    const top = c.h;
    for (const [dx, dz, w, d] of [[0, -0.85, 2, 0.35], [0, 0.85, 2, 0.35], [-0.85, 0, 0.35, 1.3], [0.85, 0, 0.35, 1.3]] as const) {
      decorBox(kit, { x: c.x + dx, z: c.z + dz, y: top, w, h: 0.5, d, color: 0xc4b48e, surface: "sand", style: "sandbags" });
    }
    for (const sx of [-0.9, 0.9]) for (const sz of [-0.9, 0.9]) B.box("wood", c.x + sx, top + 1.0, c.z + sz, 0.1, 2.0, 0.1, 0xa89a84);
    B.box("corrugated_rust", c.x, top + 2.03, c.z, 2.5, 0.05, 2.5, 0xb0a090, { rotX: 0.08 });
    for (const f of facades(c.x, c.z, c.w, c.d, 0)) wallDecal(B, f, "baseDirt", c.w / 2, 0.7, c.w, 1.4, 0xffffff, 0.02);
  }

  // ---- Ops building: plaster, frames, shutters, parapet roof, awnings ---------------
  B.box("concrete_broken", 0, 0.012, 0, 11.3, 0.024, 9.3, 0xb8b4aa);
  groundPatch(B, "concrete_broken", 0, 0, 9.5, 8.5, 0.02, 0xb0aca2, 11, 0.008);
  const opsFrames = facades(0, 0, 12.35, 10.35, 0);
  for (const w of tagged("ops")) {
    const y0 = w.y ?? 0;
    const thinX = w.w < w.d;
    const grow = (a: number, isThin: boolean) => (isThin ? a + 0.08 : a);
    if (y0 === 0) B.box("concrete_dirty", w.x, 0.3, w.z, grow(w.w, thinX), 0.6, grow(w.d, !thinX), 0xa8a59c);
    if (y0 + w.h >= 3.19) B.box("plaster", w.x, 3.0, w.z, grow(w.w, thinX) + 0.04, 0.26, grow(w.d, !thinX) + 0.04, 0xece2cc);
  }
  const frameTint = 0x5f6e66;
  for (const x of [-6, 6]) {
    for (const z of [-2.2, 2.2]) {
      for (const f of [-1, 1]) {
        const fx = x + f * 0.2;
        for (const o of [-1.0, 1.0]) B.box("wood", fx, 1.55, z + o, 0.06, 1.1, 0.07, frameTint);
        B.box("wood", fx, 2.07, z, 0.06, 0.07, 2.0, frameTint, { rot90: true });
      }
      B.box("concrete", x + Math.sign(x) * 0.14, 0.96, z, 0.32, 0.08, 2.3, 0xe0d8c6);
      B.box("plaster", x + Math.sign(x) * 0.2, 2.22, z, 0.06, 0.16, 2.4, 0xece2cc);
      // Shutters folded open against the facade (one hanging off its hinge).
      const sx = x + Math.sign(x) * 0.2;
      const hang = x > 0 && z > 0;
      B.box("wood", sx, 1.55, z - 1.55, 0.03, 1.1, 0.95, 0x6a7f74);
      B.box("wood", sx + (hang ? Math.sign(x) * 0.1 : 0), hang ? 1.35 : 1.55, z + 1.55, 0.03, 1.1, 0.95, 0x6a7f74, { rotX: hang ? 0.4 : 0 });
    }
  }
  for (const z of [-5, 5]) {
    for (const f of [-1, 1]) {
      const fz = z + f * 0.2;
      for (const o of [-1.24, 1.24]) B.box("metal_dark", o, 1.15, fz, 0.1, 2.3, 0.06, 0x3c4440);
      B.box("metal_dark", 0, 2.32, fz, 2.58, 0.1, 0.06, 0x3c4440);
    }
    B.box("concrete", 0, 0.07, z + Math.sign(z) * 0.55, 3.2, 0.14, 0.7, 0xc8c2b4);
  }
  // Facade dressing: awnings over the doors, AC units, downpipes, grime, pocks, soot.
  awning(B, opsFrames[0], 6.175, 2.75, 3.4, 1.5, 0.45, 0, 91);
  awning(B, opsFrames[2], 6.175, 2.75, 3.4, 1.5, 0.45, 1, 92, true);
  acUnit(B, opsFrames[1], 7.6, 1.9, 7);
  acUnit(B, opsFrames[3], 2.2, 2.0, 8);
  for (const [i, f] of opsFrames.entries()) {
    const L = i % 2 === 0 ? 12.35 : 10.35;
    downpipe(B, f, 0.3, 3.4);
    wallDecal(B, f, "baseDirt", L / 2, 0.75, L, 1.5, 0xffffff, 0.04);
    wallDecal(B, f, "pocks", 2 + r() * (L - 4), 1.2 + r(), 1.4, 1.4, 0xffffff, 0.04);
    if (r() < 0.6) spall(B, f, { u: 1.5 + r() * (L - 3), y: 0.8 + r() * 1.4, r: 0.35 + r() * 0.3, seed: 500 + i }, "decor", false);
  }
  wallDecal(B, opsFrames[1], "soot", 2.95, 2.7, 2.4, 2.0, 0xffffff, 0.04);
  // Roof: flat slab with a parapet, water tanks, dish, mast with guys, sandbag nest.
  B.box("concrete", 0, 3.52, 0, 12.5, 0.06, 10.5, 0xb8b2a4);
  for (const [px, pz, pw, pd] of [[0, -5.1, 12.5, 0.2], [0, 5.1, 12.5, 0.2], [-6.15, 0, 0.2, 10.4], [6.15, 0, 0.2, 10.4]] as const) {
    B.box("plaster", px, 3.85, pz, pw, 0.6, pd, 0xe2d4b8);
    B.box("concrete", px, 4.18, pz, pw + 0.06, 0.06, pd + 0.08, 0xe8e0d0);
  }
  waterTank(B, 3.8, 3.55, -3.0, true);
  waterTank(B, 2.4, 3.55, -3.4, false);
  dish(B, -2.5, 3.55, -3.8, -0.8, 0.55);
  B.box("metal_painted", 3.6, 3.85, 2.8, 1.2, 0.6, 0.9, 0xb8b8b0);
  const mast = new THREE.CylinderGeometry(0.035, 0.05, 6, 6);
  B.add(mast, new THREE.Matrix4().makeTranslation(-4.8, 3.55 + 3, 3.8), "metal_dark", 0x8a8a86, { uv: "keep", uvScale: [0.3, 6] });
  mast.dispose();
  for (const [gx, gz] of [[-6, 2.2], [-3.4, 4.9], [-5.9, 5.0]]) wireSpan(B, [new THREE.Vector3(-4.8, 8.9, 3.8)], [new THREE.Vector3(gx, 3.56, gz)], 0.05);
  for (let i = 0; i < 5; i++) decorBox(kit, { x: -5.2 + i * 0.7, z: -4.65, y: 3.55, w: 0.65, h: 0.34, d: 0.4, color: 0xc4b48e, surface: "sand", style: "sandbags" });
  // Interior: hanging lamp, chairs round the map table, papers and debris on the floor.
  pendantLamp(B, 0, 3.2, 0, 0.8, 1.05);
  kit.addLamp?.(new THREE.Vector3(0, 2.0, 0), 0xffd6a0, 4, 9);
  for (const [cx, cz, ry] of [[-1.7, 0.4, 1.4], [1.75, -0.3, -1.7], [0.3, 1.25, 3.0], [-4.2, -1.4, 2.6]] as const) {
    props.place("plastic_monobloc_chair_01", { x: cx, y: 0, z: cz, rotY: ry, scale: 1 });
  }
  litter(B, 0, 0, 4.5, Math.round(30 * detail.debris), 61, "decor", (x, z) => free(x, z, 0.1) && Math.abs(x) < 5.6 && Math.abs(z) < 4.6);
  debrisScatter(B, 4.5, -3.5, 1.2, 12, 62, "decor", () => 0.024, (x, z) => free(x, z, 0.05));

  // ---- Watchtower: X-braces, sandbagged deck edge, yellow stair rails ---------------
  {
    const TX = -20, TZ = -20;
    const L = Math.hypot(3.6, 3.0), ang = Math.atan2(3.0, 3.6);
    const t = 0x9e8f78;
    for (const sz of [-1, 1]) for (const s of [-1, 1]) B.box("wood", TX, 1.8, TZ + sz * 1.8, L, 0.12, 0.08, t, { rotZ: s * ang, rot90: true });
    for (const sx of [-1, 1]) for (const s of [-1, 1]) B.box("wood", TX + sx * 1.8, 1.8, TZ, 0.08, 0.12, L, t, { rotX: s * ang, rot90: true });
    for (const sx of [-1, 1]) B.box("wood", TX + sx * 1.8, 0.8, TZ, 0.1, 0.14, 3.6, t, { rot90: true });
    const zA = TZ + 1.2 + 0.66, zB = TZ + 1.2 - 0.66;
    for (const z of [zA, zB]) pipeRail(B, new THREE.Vector3(-10.1, 0.3, z), new THREE.Vector3(-17.6, 3.9, z), 0.95, 0xd8b028);
  }

  // ---- Warehouse shed: steel I-columns, trusses, purlins, rusty roof, lamps --------
  {
    const { x0, x1, z0, z1, h } = SHED;
    const steel = 0x5e6462;
    const ibeam = (x: number, z: number) => {
      B.box("metal_dark", x, h / 2, z, 0.3, h, 0.02, steel);
      for (const s of [-1, 1]) B.box("metal_dark", x, h / 2, z + s * 0.14, 0.3, h, 0.02, steel);
      B.box("metal_dark", x, h / 2, z, 0.02, h, 0.3, steel);
      B.box("concrete", x, 0.12, z, 0.6, 0.24, 0.6, 0xa8a49a);
    };
    for (const x of [9, 15, 21, 27]) for (const z of [z0, z1]) ibeam(x, z);
    const yTop = h + 0.25;
    // Eave beams + ridge trusses across z every bay.
    for (const z of [z0, z1]) B.box("metal_dark", (x0 + x1) / 2, h + 0.1, z, x1 - x0 + 0.4, 0.3, 0.2, steel);
    for (const x of [9, 15, 21, 27]) {
      B.box("metal_dark", x, h + 0.08, (z0 + z1) / 2, 0.12, 0.12, z1 - z0, steel);
      const n = 6;
      for (let i = 0; i < n; i++) {
        const za = z0 + ((z1 - z0) * i) / n, zb = z0 + ((z1 - z0) * (i + 1)) / n;
        rod(B, new THREE.Vector3(x, h + 0.1, za), new THREE.Vector3(x, yTop + 0.15, zb), 0.03, steel);
      }
    }
    for (let z = z0; z <= z1 + 0.01; z += 2) B.box("metal_dark", (x0 + x1) / 2, yTop + 0.12, z, x1 - x0 + 0.6, 0.08, 0.08, steel);
    // Roof sheets (1 m strips), a few missing or slipped.
    for (let x = x0 - 0.5; x < x1 + 0.5; x += 1.05) {
      if (r() < 0.08) continue;
      const slip = r() < 0.06 ? 0.4 : 0;
      B.box("corrugated_rust", x + 0.5, yTop + 0.2 - slip * 0.3, (z0 + z1) / 2 + slip, 1.08, 0.04, z1 - z0 + 1.2, 0xc0a890, { rotX: slip * 0.2, rot90: true });
    }
    for (const [lx, lz] of [[12, 18], [18, 21], [24, 15]] as const) {
      pendantLamp(B, lx, yTop + 0.1, lz, yTop + 0.1 - (h - 1.1), 1.1);
      kit.addLamp?.(new THREE.Vector3(lx, h - 1.6, lz), 0xffd29a, 6, 14);
    }
    // Floor: oily concrete slab with stains, pallets, shelving, gas bottles, jerrycans.
    groundPatch(B, "concrete_broken", (x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2 + 1, (z1 - z0) / 2 + 1, 0, 0xa8a49c, 23, 0.01);
    for (let i = 0; i < 5; i++) groundDecal(B, i < 3 ? "oil" : "tracks", x0 + 2 + r() * (x1 - x0 - 4), z0 + 2 + r() * (z1 - z0 - 4), 1.5 + r() * 1.5, 1.5 + r() * 1.5, r() * 6, 0xffffff);
    props.place("steel_frame_shelves_01", { x: 25.6, y: 0, z: 23.1, rotY: Math.PI, fit: [2, 2.1, 0.6] });
    props.place("steel_frame_shelves_01", { x: 10.6, y: 0, z: 23.1, rotY: Math.PI, fit: [2, 2.1, 0.6] });
    // Photoscans at 5-7k tris each: one of each everywhere, the rest on high.
    [[23.4, 23.0], [23.9, 22.7], [24.3, 23.2]].forEach(([px, pz], i) => props.place("propane_tank", { x: px, y: 0, z: pz, rotY: r() * 6, scale: 1, tier: i ? 2 : 0 }));
    [[13.2, 22.9], [13.6, 23.0], [16.5, 13.0]].forEach(([px, pz], i) => props.place("plastic_jerrycan", { x: px, y: 0, z: pz, rotY: r() * 6, scale: 1, tier: i ? 2 : 0 }));
    if (free(26, 20.5, 1)) pallets(B, 26, 20.5, 0.1, 3, r);
    if (free(10.4, 14.4, 1)) pallets(B, 10.4, 14.4, -0.2, 2, r);
  }

  // ---- Props on the gameplay boxes -------------------------------------------------
  for (const g of tagged("generator")) {
    B.box("metal_dark", g.x, 0.06, g.z, g.w + 0.3, 0.12, g.d + 0.2, 0x4a4a46);
    const ex = new THREE.CylinderGeometry(0.06, 0.06, 1.1, 8);
    B.add(ex, new THREE.Matrix4().makeTranslation(g.x + g.w / 2 - 0.3, g.h + 0.5, g.z - g.d / 2 + 0.3), "metal_rust", 0x8a6a50, { uv: "keep", uvScale: [0.4, 1.1] });
    ex.dispose();
    for (let i = 0; i < 6; i++) B.box("metal_dark", g.x - g.w / 2 + 0.4 + i * 0.1, g.h * 0.55, g.z + g.d / 2 + 0.01, 0.04, g.h * 0.5, 0.02, 0x3a3a38);
    B.box("plain", g.x - 0.6, g.h * 0.7, g.z - g.d / 2 - 0.01, 0.5, 0.35, 0.02, 0x2a2c2a);
    groundDecal(B, "oil", g.x + 0.4, g.z - 1.4, 2.2, 1.8, 0.4, 0xffffff);
    cable(B, new THREE.Vector3(g.x - 1, 0.9, g.z), new THREE.Vector3(18, 7.2, 24), 1.5);
  }
  for (const a of tagged("ammo")) {
    props.place("ammo_box", { x: a.x - 0.35, y: a.h, z: a.z + 0.3, scale: 2, rotY: Math.PI / 2 }, (bb, g) => bb.box("metal_painted", a.x - 0.35, a.h + 0.16, a.z + 0.3, 0.52, 0.32, 0.16, 0x7d8456, { group: g }));
    props.place("ammo_box", { x: a.x + 0.3, y: a.h, z: a.z - 0.32, scale: 2, rotY: Math.PI / 2 + 0.2, tier: 2 }, (bb, g) => bb.box("metal_painted", a.x + 0.3, a.h + 0.16, a.z - 0.32, 0.52, 0.32, 0.16, 0x7d8456, { group: g }));
  }
  tagged("supply").forEach((c, i) => {
    if (i % 2) return;
    // Small slatted crate on top (procedural: the scan was 6.6k tris).
    const cx = c.x + (r() - 0.5) * 0.2, cz = c.z + (r() - 0.5) * 0.2, yaw = r() * 6, tint = 0xb8a882;
    B.box("wood", cx, c.h + 0.2, cz, 0.86, 0.38, 0.5, tint, { rotY: yaw });
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    for (const s of [-1, 1]) {
      const ox = s * 0.26 * sn, oz = s * 0.26 * cs;
      for (const yy of [0.06, 0.34]) B.box("wood", cx + ox, c.h + yy, cz + oz, 0.9, 0.06, 0.03, 0x9a8a68, { rotY: yaw });
    }
  });
  // Burnt-out vehicles on their colliders.
  for (const w of tagged("wreck")) burntCar(B, w.x, w.z, w.w > w.d ? 0 : Math.PI / 2, "pickup", Math.round(w.x * 13 + w.z), "decor");
  for (const c of tagged("burntcar")) burntCar(B, c.x, c.z, c.w > c.d ? Math.PI : Math.PI / 2, "sedan", 77, "decor");
  for (const c of tagged("car")) groundDecal(B, "oil", c.x, c.z + 0.8, 1.6, 1.6, 0.3, 0xffffff);

  // ---- Ground: broken asphalt through the gates, slabs, decals ----------------------
  const strip = (ax: number, az: number, bx: number, bz: number, seed: number) => groundStrip(B, "asphalt", ax, az, bx, bz, 4.6, () => 0, 0xc8c4bc, seed, "decor", 0.015);
  strip(0, -47, 0, -7.2, 1);
  strip(0, 7.2, 0, 47, 2);
  strip(-47, 0, -9.5, 0, 3);
  strip(9.5, 0, 47, 0, 4);
  for (const [ax, az, bx, bz] of [[0, -46, 0, -8], [0, 8, 0, 46], [-46, 0, -10, 0], [10, 0, 46, 0]] as const) {
    const len = Math.hypot(bx - ax, bz - az), vertical = ax === bx;
    for (let t = 0; t < len; t += 3 + r() * 3) {
      const k = t / len;
      const x = ax + (bx - ax) * k, z = az + (bz - az) * k;
      for (const s of [-1, 1]) {
        if (r() < 0.3) continue;
        const reach = 0.8 + r() * 1.6;
        const off = s * (2.3 + 0.3 - reach / 2);
        groundDecal(B, "sand", vertical ? x + off : x, vertical ? z : z + off, reach + 0.8, 3 + r() * 4, (vertical ? 0 : Math.PI / 2) + (r() - 0.5) * 0.3, 0xcdbfa4);
      }
      if (r() < 0.15) groundStrip(B, "asphalt", x, z, vertical ? x : x + 1.5 + r() * 2, vertical ? z + 1.5 + r() * 2 : z, 1 + r() * 1.5, () => 0, 0x989490, Math.floor(r() * 1e6), "decor", 0.018);
    }
  }
  // Potholes / exposed base: concrete chunks and rubble patches over the asphalt.
  for (let i = 0; i < 14; i++) {
    const along = (r() * 2 - 1) * 40;
    const vertical = r() < 0.5;
    const x = vertical ? (r() - 0.5) * 3 : along, z = vertical ? along : (r() - 0.5) * 3;
    if (Math.abs(along) < 8) continue;
    groundPatch(B, r() < 0.5 ? "rubble" : "concrete_broken", x, z, 0.6 + r() * 1.0, 0.5 + r() * 0.8, r() * 6, 0xb0aaa0, Math.floor(r() * 1e6), 0.022);
  }
  // Tyre tracks along the roads, cracks, oil, puddles, burn marks, sand drifts.
  for (const [ax, az, bx, bz] of [[0, -46, 0, -8], [0, 8, 0, 46], [-46, 0, -10, 0], [10, 0, 46, 0]] as const) {
    const len = Math.hypot(bx - ax, bz - az);
    const yaw = ax === bx ? 0 : Math.PI / 2;
    for (let t = 0; t < len; t += 5.5) {
      const k = t / len;
      const x = ax + (bx - ax) * k + (ax === bx ? (r() - 0.5) * 0.6 : 0), z = az + (bz - az) * k + (az === bz ? (r() - 0.5) * 0.6 : 0);
      groundDecal(B, "tracks", x, z, 2.6, 5.6, yaw + (r() - 0.5) * 0.1, 0xffffff);
      if (r() < 0.35) groundDecal(B, "cracks", x + (r() - 0.5) * 3, z + (r() - 0.5) * 3, 2.5, 2.5, r() * 6, 0xffffff);
    }
  }
  const decalCount = Math.round(40 * detail.debris);
  for (let i = 0; i < decalCount; i++) {
    const x = (r() * 2 - 1) * 46, z = (r() * 2 - 1) * 46;
    if (!free(x, z, 0.2)) continue;
    const k = r();
    const kind = k < 0.18 ? "oil" : k < 0.36 ? "puddle" : k < 0.5 ? "burn" : k < 0.7 ? "sand" : k < 0.85 ? "cracks" : "specks";
    const s = kind === "burn" ? 3 + r() * 3 : kind === "puddle" ? 1.5 + r() * 2.5 : 1.5 + r() * 2;
    groundDecal(B, kind, x, z, s, s * (0.7 + r() * 0.5), r() * 6, 0xffffff);
  }
  // ---- Yard ground: curving tyre ruts, gravel and stone patches, scuffs, stains ----
  {
    const yard = (x: number, z: number) => Math.max(Math.abs(x), Math.abs(z)) < R - 1;
    // Ruts where trucks turned off the gate tracks into the shed, the motor
    // pool and round the ops block (Catmull-Rom through hand-placed points).
    const ruts: [number, number][][] = [
      [[30, 1.2], [24, 2.5], [19, 6], [16.5, 10.5]],
      [[1.2, 30], [2.4, 25], [6.5, 21], [9.5, 19.5]],
      [[-30, -1.2], [-22, -2.4], [-15, -6.5], [-12, -12], [-12.5, -20]],
      [[-1.2, -30], [-3, -22], [-8.5, -15.5], [-15, -14], [-22, -16]],
      [[30, -1.2], [22, -4], [17, -9], [17.5, -16], [22, -21]],
      [[-1.2, 30], [-4, 22], [-11, 17], [-18, 18.5]],
    ];
    ruts.forEach((pts, i) => {
      const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)));
      const L = curve.getLength();
      const off = (r() - 0.5) * 0.5;
      for (let s = 0; s < L; s += 2.3) {
        const p = curve.getPointAt(s / L), tg = curve.getTangentAt(s / L);
        const x = p.x - tg.z * off, z = p.z + tg.x * off;
        if (!yard(x, z) || r() < 0.12) continue;
        groundDecal(B, "tracks", x, z, 2.4, 2.9, Math.atan2(tg.x, tg.z), i % 2 ? 0xf0ece4 : 0xffffff);
      }
    });
    // Gravel / stone patches and dark damp ground.
    for (let i = 0; i < 26; i++) {
      const x = (r() * 2 - 1) * (R - 3), z = (r() * 2 - 1) * (R - 3);
      if (!free(x, z, 1) || nearSpawn(x, z, 2)) continue;
      if (r() < 0.6) groundPatch(B, "rubble", x, z, 0.8 + r() * 1.8, 0.6 + r() * 1.4, r() * 6, 0xc8c0b0, Math.floor(r() * 1e6), 0.014);
      else groundDecal(B, r() < 0.5 ? "baseDirt" : "puddle", x, z, 2 + r() * 3, 1.5 + r() * 2.5, r() * 6, 0xb0a898);
    }
    // Scuffed, trampled ground round doors, crates, terminals and the tower.
    const busy = boxes.filter((b) => ["ammo", "supply", "station", "generator", "tower", "stair", "car"].includes(b.tag ?? "") || b.style === "crate");
    for (const b of busy) {
      for (let k = 0; k < 3; k++) {
        const a = r() * 6.28, d = Math.max(b.w, b.d) * 0.5 + 0.4 + r() * 1.4;
        const x = b.x + Math.cos(a) * d, z = b.z + Math.sin(a) * d;
        if (!yard(x, z)) continue;
        groundDecal(B, r() < 0.55 ? "specks" : "baseDirt", x, z, 1.2 + r() * 1.6, 1.2 + r() * 1.6, r() * 6, 0xc8beac);
      }
    }
    // Stones: small loose chunks across the whole yard (merged per clutter cell).
    for (let i = 0; i < Math.round(30 * detail.debris); i++) {
      const x = (r() * 2 - 1) * (R - 2), z = (r() * 2 - 1) * (R - 2);
      debrisScatter(B, x, z, 2 + r() * 3, Math.round(5 + r() * 7), 1300 + i, clutterGroup(x, z), undefined, (px, pz) => free(px, pz, 0.15) && !nearSpawn(px, pz, 1.5));
    }
  }

  // Sand drifts against the inside wall faces.
  for (let i = 0; i < 16; i++) {
    const a = (r() * 2 - 1) * 28;
    const s = Math.floor(r() * 4);
    const off = R - 0.9;
    const [x, z] = s === 0 ? [a, -off] : s === 1 ? [a, off] : s === 2 ? [-off, a] : [off, a];
    if (Math.abs(a) < 5) continue;
    groundDecal(B, "sand", x, z, 3 + r() * 3, 1.6 + r(), s < 2 ? 0 : Math.PI / 2, 0xffffff);
  }

  // ---- Rubble, debris and litter ------------------------------------------------
  const keep = (x: number, z: number) => free(x, z, 0.15) && track(x, z) < 0.5;
  // Heaps against wall bases (inside and out), by the gates and the burnt cars.
  const heaps: [number, number, number, number, number][] = [
    [-26, -30.9, 1.6, 0.9, 0.55], [18, 30.9, 1.4, 0.8, 0.45], [30.9, -18, 0.8, 1.6, 0.5], [-30.9, 22, 0.8, 1.3, 0.45],
    [-12, -33.2, 1.8, 0.9, 0.6], [24, 33.2, 1.6, 0.8, 0.5], [33.2, 12, 0.9, 1.7, 0.55], [-33.2, -16, 0.9, 1.5, 0.5],
    [-35.5, 13, 1.6, 1.2, 0.5], [36, -24, 1.5, 1.4, 0.6], [5.5, 36.5, 1.4, 1.0, 0.4],
  ];
  heaps.forEach(([x, z, rx, rz, h], i) => {
    if (!free(x, z, 0.4) || nearSpawn(x, z, 3)) return;
    rubblePile(B, x, z, rx, rz, h, 700 + i, clutterGroup(x, z), undefined, detail.debris);
  });
  const scatterSpots = Math.round(26 * detail.debris);
  for (let i = 0; i < scatterSpots; i++) {
    const x = (r() * 2 - 1) * 46, z = (r() * 2 - 1) * 46;
    debrisScatter(B, x, z, 1.5 + r() * 2, Math.round(8 + r() * 10), 900 + i, clutterGroup(x, z), undefined, keep);
  }
  const litterSpots = Math.round(18 * detail.debris);
  for (let i = 0; i < litterSpots; i++) {
    const x = (r() * 2 - 1) * 44, z = (r() * 2 - 1) * 44;
    litter(B, x, z, 2 + r() * 2, Math.round(6 + r() * 8), 1100 + i, "decor", keep);
  }
  // Trash bags, tyres and jerrycans (instanced glTF) along walls and in corners.
  const along = (n: number, inside: boolean, fn: (x: number, z: number, rot: number) => void) => {
    for (let i = 0; i < n; i++) {
      const a = (r() * 2 - 1) * (inside ? 28 : 44);
      const s = Math.floor(r() * 4);
      const off = inside ? R - 0.75 : R + 0.85;
      const [x, z] = s === 0 ? [a, -off] : s === 1 ? [a, off] : s === 2 ? [-off, a] : [off, a];
      if (Math.abs(a) < 5 || !free(x, z, 0.3) || nearSpawn(x, z, 3)) continue;
      fn(x, z, r() * 6.28);
    }
  };
  // Photoscans are 3-7k tris each: a few go a long way.
  let bags = 0;
  const bag = (x: number, z: number, rot: number) => props.place("trashbag", { x, y: 0, z, rotY: rot, scale: 0.9 + r() * 0.4, tier: bags++ % 3 === 2 ? 2 : 0 });
  along(6, true, bag);
  along(4, false, bag);
  along(6, true, (x, z, rot) => props.place("old_tyre", { x, y: 0, z, rotY: rot, scale: 1 }));
  for (const [x, z] of [[16.2, -11.4], [22.6, -2.2], [-21.3, 14.6], [-26.1, 0.9], [9.4, -26.6]]) if (free(x, z, 0.5)) tyre(B, x, z, r() < 0.3, r);
  const clutterSpots: [number, number][] = [[-29.6, -28.4], [29.4, -28.8], [-12.6, 29.8], [21.6, -29.5], [-29.4, 16.5], [13.2, -29.8]];
  for (const [x, z] of clutterSpots) if (free(x, z, 0.9)) pallets(B, x, z, r() * 0.4, 1 + Math.floor(r() * 3), r);
  for (let i = 0; i < 6; i++) {
    const layer = i < 4 ? 0 : 1;
    props.place("cement_bag", { x: 12.2 + (i % 2) * 0.5 + layer * 0.25, y: layer * 0.17, z: 16.2 + (Math.floor(i / 2) % 2) * 0.75, scale: 0.95, rotY: (r() - 0.5) * 0.3 }, (bb, g) =>
      bb.add(kit.style.sandbag, new THREE.Matrix4().compose(new THREE.Vector3(12.2 + (i % 2) * 0.5 + layer * 0.25, layer * 0.17 + 0.09, 16.2 + (Math.floor(i / 2) % 2) * 0.75), new THREE.Quaternion(), new THREE.Vector3(0.45, 0.18, 0.7)), "sandbag", 0xd8d2c4, { group: g, uv: "keep", uvScale: [1.4, 0.5] }),
    );
  }
  props.place("utility_box_01", { x: -30.9, y: 0, z: -9.6, rotY: Math.PI / 2, scale: 1 });
  props.place("utility_box_01", { x: 30.9, y: 0, z: 9.8, rotY: -Math.PI / 2, scale: 1 });

  // ---- Telephone lines ------------------------------------------------------------
  const compoundPoles = tagged("pole").map((p) => ({ x: p.x, y: 0, z: p.z, rotY: p.rotY ?? 0 }));
  const roadPoles: PoleSpot[] = [];
  for (let x = -64 - 34 * 5; x <= 200; x += 34) roadPoles.push({ x, y: height(x, ROAD_Z - 5.5), z: ROAD_Z - 5.5, rotY: Math.PI / 2 });
  poleLine(B, roadPoles, r, 1.1);
  if (compoundPoles.length >= 2) {
    const [a, b] = compoundPoles;
    const pa = poleWirePoints(a.x, a.y, a.z, a.rotY), pb = poleWirePoints(b.x, b.y, b.z, b.rotY);
    wireSpan(B, pa, pb, 0.7);
    wireSpan(B, [pa[1]], [new THREE.Vector3(-6.2, 3.5, -5.2)], 0.5);
    wireSpan(B, [pb[2]], [new THREE.Vector3(-6.2, 3.5, 5.2)], 0.5);
    const spur: PoleSpot[] = [
      { x: -56, y: height(-56, -36), z: -36, rotY: Math.atan2(-11.5 + 36, -30.4 + 56) + Math.PI / 2 },
      { x: -64, y: height(-64, -58), z: -58, rotY: Math.PI / 2.2 },
    ];
    const sp = poleLine(B, spur, r, 0.9);
    wireSpan(B, pa, sp[0], 1.2);
    const road = roadPoles.find((p) => p.x === -64);
    if (road) wireSpan(B, sp[1], poleWirePoints(road.x, road.y, road.z, road.rotY), 0.8);
  }
  // Street poles along the town's inner street on the other three sides, cables to the facades.
  for (let side = 1; side < 4; side++) {
    const pts: PoleSpot[] = [];
    for (let a = -96; a <= 96; a += 32) {
      const d = 67.5;
      const [x, z] = side === 1 ? [d, a] : side === 2 ? [-a, d] : [-d, -a];
      pts.push({ x, y: height(x, z), z, rotY: side % 2 ? 0 : Math.PI / 2 });
    }
    poleLine(B, pts, r, 1.0);
  }

  // ---- Fences: post-and-rail by the fields, chain-link along the road --------------
  chainlink(B, -150, ROAD_Z + 5, -78, ROAD_Z + 5, 2.1, height, 31, "far");
  chainlink(B, -70, ROAD_Z + 5, -20, ROAD_Z + 4.5, 2.1, height, 32, "far");
  chainlink(B, 18, ROAD_Z + 5, 120, ROAD_Z + 5.5, 2.1, height, 33, "far");
  fence(B, 60, ROAD_Z + 5.5, 62, -58, height, r);
  fence(B, -120, ROAD_Z - 6, -40, ROAD_Z - 6.5, height, r);
  // Chain-link around the motor pool between the wall and the berm (east).
  chainlink(B, 34.5, 26, 34.5, 34.5, 2.0, () => 0, 34);
  chainlink(B, 34.5, 34.5, 26, 34.5, 2.0, () => 0, 35);
  // Road surface: broken asphalt along the old highway, a burnt car or two on it.
  groundStrip(B, "asphalt", -220, ROAD_Z, 220, ROAD_Z, 7.5, height, 0xc8c4bc, 41, "far", 0.06);
  {
    // Patched, cracked, rutted tarmac with sand blown over both edges and
    // faded paint (dashed centre line, broken edge lines).
    const W = 7.5, g = "far";
    for (let x = -205; x < 205; x += 5 + r() * 6) {
      const z = ROAD_Z + (r() - 0.5) * 4;
      const k = r();
      if (k < 0.3) groundStrip(B, "asphalt", x, z, x + 1.5 + r() * 5, z, 1.2 + r() * 2.2, height, 0x9a968e, Math.floor(r() * 1e6), g, 0.07);
      else if (k < 0.65) groundDecal(B, "cracks", x, z, 2.5 + r() * 2.5, 2.5 + r() * 2.5, r() * 6, 0xffffff, height, g, 0.08);
      else if (k < 0.78) groundDecal(B, "oil", x, z, 1.4 + r() * 1.5, 1.4 + r() * 1.5, r() * 6, 0xffffff, height, g, 0.08);
      else if (k < 0.86) groundDecal(B, "pocks", x, z, 1.5, 1.5, r() * 6, 0xffffff, height, g, 0.08);
    }
    for (let x = -205; x < 205; x += 5.5) {
      for (const s of [-1, 1]) if (r() < 0.55) groundDecal(B, "tracks", x, ROAD_Z + s * (1.7 + r() * 0.3), 2.4, 5.8, Math.PI / 2 + (r() - 0.5) * 0.04, 0xffffff, height, g, 0.085);
    }
    for (let x = -212; x < 212; x += 3.5 + r() * 4.5) {
      for (const s of [-1, 1]) {
        if (r() < 0.2) continue;
        const reach = 1 + r() * 2.2;
        groundDecal(B, "sand", x, ROAD_Z + s * (W / 2 + 0.4 - reach / 2), reach + 1, 4 + r() * 6, Math.PI / 2 + (r() - 0.5) * 0.25, 0xb9ad94, height, g, 0.09);
      }
    }
    paintLine(B, -212, ROAD_Z, 212, ROAD_Z, 0, 0.14, 3, 5, height, 61, 0xd8d4c6, g);
    for (const s of [-1, 1]) paintLine(B, -212, ROAD_Z, 212, ROAD_Z, s * (W / 2 - 0.5), 0.12, 7, 0, height, 62 + s, 0xcfcab8, g);
  }
  burntCar(B, -32, ROAD_Z + 1.2, 0.2, "sedan", 51, "far", height(-32, ROAD_Z + 1.2));
  burntCar(B, 46, ROAD_Z - 1.5, Math.PI + 0.3, "pickup", 52, "far", height(46, ROAD_Z - 1.5));
  // Overhead destination gantry, a traffic island with keep-right sign,
  // roundabout and warning signs, a chevron board and painted lane arrows.
  // (Invented place names only.)
  signGantry(B, -62, ROAD_Z, 9.6, height, 1, "far");
  postSign(B, "warning", -36, ROAD_Z + 5.4, Math.PI / 2, height(-36, ROAD_Z + 5.4), 1.0, 0, "far");
  postSign(B, "roundabout", -104, ROAD_Z + 5.4, Math.PI / 2, height(-104, ROAD_Z + 5.4), 0.85, 0.04, "far");
  B.box("concrete", -92, height(-92, ROAD_Z) + 0.12, ROAD_Z, 7, 0.26, 1.3, 0xb8b4aa, { group: "far" });
  for (const dx of [-3.3, 3.3]) B.box("concrete", -92 + dx, height(-92 + dx, ROAD_Z) + 0.12, ROAD_Z, 0.5, 0.26, 1.0, 0xc8c4ba, { group: "far" });
  postSign(B, "arrow", -88.9, ROAD_Z, Math.PI / 2, height(-88.9, ROAD_Z) + 0.25, 0.7, 0, "far");
  postSign(B, "chevron", 118, ROAD_Z - 5.4, -Math.PI / 2, height(118, ROAD_Z - 5.4), 0.8, 0, "far");
  roadArrow(B, -76, ROAD_Z + 1.9, -Math.PI / 2, height);
  roadArrow(B, -48, ROAD_Z + 1.9, -Math.PI / 2, height);
  roadArrow(B, -106, ROAD_Z - 1.9, Math.PI / 2, height, -1);
  roadArrow(B, -20, ROAD_Z - 1.9, Math.PI / 2, height);

  // ---- The town beyond the berm -------------------------------------------------------
  const roadKeep = { x0: -400, x1: 400, z0: ROAD_Z - 6, z1: ROAD_Z + 6 };
  const t = town(B, props, {
    rows: [
      { dist: 70, depth: [8, 12], floors: [2, 4], detail: true },
      { dist: 92, depth: [9, 14], floors: [3, 5], detail: false },
      { dist: 116, depth: [10, 16], floors: [4, 7], detail: false },
    ],
    span: 110,
    height,
    keepOut: [roadKeep],
    seed: 4040,
    detail,
  });
  // Skyline: far blocks on the hills.
  for (let i = 0; i < 70; i++) {
    const a = r() * Math.PI * 2, d = 150 + r() * 120;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (Math.abs(z - ROAD_Z) < 10) continue;
    const w = 10 + r() * 14, dd = 10 + r() * 14;
    let gy = Infinity;
    for (const [sx, sz] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) gy = Math.min(gy, height(x + sx * w, z + sz * dd));
    silhouette(B, x, z, w, dd, 6 + r() * 16, gy, 5000 + i);
  }
  // Two water towers and a tall chimney as landmarks.
  for (const [x, z, h] of [[-128, 96, 24], [150, -64, 21]] as const) {
    const gy = height(x, z);
    for (const sx of [-1.6, 1.6]) for (const sz of [-1.6, 1.6]) rod(B, new THREE.Vector3(x + sx, gy, z + sz), new THREE.Vector3(x + sx * 0.6, gy + h - 4, z + sz * 0.6), 0.18, 0x6a6a64, "far", "metal_painted");
    const tank = new THREE.CylinderGeometry(3.2, 3.2, 4.5, 16);
    B.add(tank, new THREE.Matrix4().makeTranslation(x, gy + h - 1.8, z), "metal_painted", 0xbab4a4, { group: "far", uv: "keep", uvScale: [20, 4.5] });
    tank.dispose();
  }
  {
    const x = 120, z = 130, gy = height(x, z);
    const ch = new THREE.CylinderGeometry(1.1, 1.8, 34, 12);
    B.add(ch, new THREE.Matrix4().makeTranslation(x, gy + 17, z), "brick", 0xb89a88, { group: "far", uv: "keep", uvScale: [9, 34] });
    ch.dispose();
  }

  // ---- Foliage plan ---------------------------------------------------------------
  const trees: TreePlacement[] = scatterTrees(40, 140, 220, r, (x, z) => Math.abs(z - ROAD_Z) < 8);
  for (let x = -180; x < 180; x += 10 + r() * 8) {
    if (r() < 0.45 || Math.abs(x) < 130) continue;
    trees.push({ x, z: ROAD_Z - 12 - r() * 3, scale: 0.8 + r() * 0.5, variant: Math.floor(r() * 4), rot: r() * 6 });
  }

  const bushes: BushPlacement[] = [];
  const tryBush = (x: number, z: number, s: number, margin = 0.9) => {
    if (!clearOf(boxes, x, z, margin) || nearSpawn(x, z, 4) || track(x, z) > 0.3) return;
    bushes.push({ x, z, scale: s, dry: r() < 0.6 });
  };
  for (let i = 0; i < 40; i++) {
    const a = (r() * 2 - 1) * 46;
    const side = Math.floor(r() * 4);
    const off = r() < 0.5 ? R + 1.2 + r() * 1.2 : BERM - 0.9 - r() * 0.8;
    const [x, z] = side === 0 ? [a, -off] : side === 1 ? [a, off] : side === 2 ? [-off, a] : [off, a];
    if (Math.abs(a) < 6) continue;
    tryBush(x, z, 0.7 + r() * 0.5);
  }
  for (const b of boxes) if (b.style === "rock") for (let k = 0; k < 2; k++) tryBush(b.x + (r() - 0.5) * (b.w + 3), b.z + (r() - 0.5) * (b.d + 3), 0.6 + r() * 0.5, 0.3);

  // glTF plants (instanced) as extra ground clutter, density-scaled.
  // Placed for high; tiers thin them out on medium (about 60%) and low (30%).
  const place = (id: "shrub_03" | "fern_02" | "weed_plant_02", n: number, ring: () => [number, number], scale: () => number) => {
    let placed = 0, guard = 0;
    while (placed < n && guard++ < n * 20) {
      const [x, z] = ring();
      if (!clearOf(boxes, x, z, 0.4) || nearSpawn(x, z, 3) || track(x, z) > 0.4) continue;
      const k = placed % 10;
      props.place(id, { x, y: 0, z, scale: scale(), rotY: r() * 6.28, variant: Math.floor(r() * 2), tier: k < 3 ? 0 : k < 5 ? 1 : 2 });
      placed++;
    }
  };
  const edgeRing = (inside: boolean) => (): [number, number] => {
    const a = (r() * 2 - 1) * (inside ? 29 : 46);
    const off = inside ? R - 0.9 - r() * 0.8 : R + 0.8 + r() * 1.5;
    const side = Math.floor(r() * 4);
    return side === 0 ? [a, -off] : side === 1 ? [a, off] : side === 2 ? [-off, a] : [off, a];
  };
  place("shrub_03", 16, edgeRing(false), () => 2.2 + r() * 1.2);
  place("weed_plant_02", 16, edgeRing(true), () => 4 + r() * 2.5);

  // ---- Palms (the tree colliders between wall and berm, plus the town) ----------
  const palmList: PalmPlacement[] = [...t.palms];
  for (const p of tagged("tree")) palmList.push({ x: p.x, y: 0, z: p.z, height: 8 + r() * 3, rot: r() * 6, lean: (r() - 0.5) * 0.2 });
  extras.push(palms(palmList, kit.materials, kit.windTime));

  // ---- Patrol truck, fuel, gas, fighting positions, camo nets -------------------------
  for (const m of tagged("mrap")) patrolTruck(B, m.x, m.z, m.d > m.w ? -Math.PI / 2 : 0);
  for (const f of tagged("fuel")) {
    groundDecal(B, "oil", f.x - 0.9, f.z + 0.4, 1.6, 2.4, 0.2, 0xffffff);
    cable(B, new THREE.Vector3(f.x - 0.5, 0.35, f.z + 1.5), new THREE.Vector3(26.4, 0.4, 25.2), 0.25);
    gasBottles(B, f.x - 0.2, f.z - 2.6, Math.PI / 2, 4, 23);
  }
  gasBottles(B, -7.3, -6.75, 0, 5, 17);
  for (const t of tagged("trench")) {
    // Dug, trampled earth round the bags and a spoil line behind.
    groundDecal(B, "baseDirt", t.x, t.z, t.w + 1.8, t.d + 1.8, 0, 0xb8a888);
    groundDecal(B, "specks", t.x, t.z - Math.sign(t.z) * 1.1, t.w + 0.6, 1.2, 0, 0xc0b49a);
  }
  const nets: NetSpec[] = [
    { corners: [[-28.6, -28.6], [-22.8, -28.6], [-22.8, -23.6], [-28.6, -23.6]], height: 2.9, drape: 0.7 },
    { corners: [[4.0, -42.6], [8.4, -42.6], [8.4, -35.4], [4.0, -35.4]], height: 3.9, drape: 0.9 },
  ];
  for (const n of nets) for (const [x, z] of n.corners) rod(B, new THREE.Vector3(x, -0.1, z), new THREE.Vector3(x + (r() - 0.5) * 0.1, n.height + 0.05, z + (r() - 0.5) * 0.1), 0.05, 0x6e5a40, "decor", "wood");
  pallets(B, -26.6, -26.4, 0.3, 2, r);
  pallets(B, -24.6, -25.2, -0.2, 1, r);
  extras.push(camoNets(nets, kit.windTime, height));
  // A distant helicopter on a slow loop round the town.
  extras.push(helicopter(kit.windTime, new THREE.Vector2(0, 0), 190, 70));

  // ---- Distant smoke columns --------------------------------------------------------
  const smoke = [
    { x: -135, z: -110, scale: 1.3, dark: true },
    { x: 105, z: 150, scale: 1.0 },
    { x: 175, z: -35, scale: 1.15, dark: true },
    { x: -60, z: 165, scale: 0.9 },
  ].map((s) => ({ ...s, y: height(s.x, s.z) }));
  extras.push(smokeColumns(smoke, qualityName(quality)));

  return {
    terrain: { height, splat, inner: 70, outer: 700 },
    foliage: { grass, grassBounds: 50, trees, bushes, tallGrass, tallGrassBounds: 66 },
    extras,
  };
};
