import * as THREE from "three";
import { rng, type BushPlacement, type TreePlacement } from "../Foliage";
import type { Splat } from "../Terrain";
import { MeshBuilder, clutterGroup } from "../MeshBuilder";
import { poleWirePoints } from "../BoxStyles";
import { qualityName, worldDetail } from "../quality";
import { smokeColumns } from "../Smoke";
import { facades } from "../architecture/Building";
import { cable, chainlink, fbox, groundDecal, groundPatch, groundStrip, railing, rod, wallDecal } from "../architecture/kit";
import { burntCar, debrisScatter, litter, rubblePile } from "../architecture/debris";
import { HOUSES, LAMPS, MANOR_YARD, ORCHARD, PICKUP, POLES, SQUARE, STATUE, TANK, TOWER, houseById } from "../maps/brennhollow";
import { villageMaterial } from "./brennhollowTextures";
import { applyWeathering } from "../../render/Materials";
import { attachGrime, finishGrime } from "../architecture/grime";
import { churchInterior, churchTower, house, manorDetail, pickup, rnd, statue, tankHulk, type Village } from "./brennhollowHouses";
import { band, clearOf, fbm2, fence, pallets, smoothstep, tyre, wireSpan, type Dressing, type WorldExtra } from "./common";

/** Roads and lanes: centre-line polylines with a width (splat, grass, debris keep-outs). */
const ROADS: { pts: [number, number][]; w: number; paved?: boolean }[] = [
  { pts: [[-160, 6], [-90, 4], [-48, 2.5], [-12, 2.5]], w: 8.5, paved: true },
  { pts: [[12, -0.8], [48, -0.8], [90, -3], [170, -8]], w: 7.5, paved: true },
  { pts: [[0.5, 10], [0.5, 30], [0.6, 48], [-3, 70], [-14, 120]], w: 6.5 },
  { pts: [[-11, -12], [-11, -30], [-11, -48], [-16, -80]], w: 7 },
  { pts: [[12, -12], [12, -44]], w: 3.6 },
  { pts: [[8, -16.2], [36, -16.2], [44, -18]], w: 3.2 },
  { pts: [[-13, -14.5], [-30, -13], [-46, -12]], w: 3.6 },
  { pts: [[24, 2], [26.5, 18], [34, 27], [38, 46]], w: 3.4 },
  { pts: [[-14, 6], [-28, 19], [-29, 30], [-28, 48]], w: 3.2 },
  { pts: [[24.7, -18], [24.7, -25]], w: 2.6 },
];

function segDist(px: number, pz: number, a: [number, number], b: [number, number]) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - a[0] - dx * t, pz - a[1] - dz * t);
}
/** 0..1 how much (x, z) is on a road (1 at the centre). */
function roadAt(x: number, z: number) {
  let m = 0;
  for (const r of ROADS) {
    for (let i = 1; i < r.pts.length; i++) {
      const d = segDist(x, z, r.pts[i - 1], r.pts[i]);
      if (d < r.w) m = Math.max(m, band(d, r.w / 2 + 0.6));
    }
  }
  return m;
}
const inSquare = (x: number, z: number, m = 0) => x > SQUARE.x0 - m && x < SQUARE.x1 + m && z > SQUARE.z0 - m && z < SQUARE.z1 + m;

/** Rounded "distance from the village" (super-ellipse norm). */
const ring = (x: number, z: number) => Math.pow(Math.pow(Math.abs(x), 5) + Math.pow(Math.abs(z), 5), 0.2);

/** Visual terrain: flat village, grassy bank, rolling hills, forested ridges, mountains. */
export function bhHeight(x: number, z: number) {
  const d = ring(x, z);
  if (d <= 49.2) return 0;
  const n = fbm2(x * 0.011 + 7, z * 0.011 - 3, 4);
  let h = smoothstep(49.2, 57, d) * (2.6 + 2.2 * fbm2(x * 0.08, z * 0.08, 2));
  h += smoothstep(54, 190, d) * (6 + 34 * n);
  // Ridged mountains behind (higher to the north and east).
  const ridge = 1 - Math.abs(fbm2(x * 0.0045 + 1, z * 0.0045 + 4, 4) * 2 - 1);
  const dir = 0.65 + 0.35 * Math.max(0, (-z + x * 0.5) / Math.max(1, Math.hypot(x, z)));
  h += smoothstep(240, 560, d) * (40 + 210 * ridge * ridge) * dir;
  // The road valleys (east and west) stay low; the lanes cut through the bank.
  const vx = Math.exp(-(((z - 2) / (12 + Math.abs(x) * 0.12)) ** 2)) * smoothstep(48, 70, Math.abs(x)) * (1 - smoothstep(260, 420, Math.abs(x)));
  h *= 1 - 0.75 * vx;
  const lane = Math.max(roadAt(x, z) * (d < 140 ? 1 : 0), 0);
  h *= 1 - 0.55 * lane * (1 - smoothstep(60, 110, d));
  return h;
}

/** The far-hill mesh grid (fine near the village, coarser with distance). */
const GRID = (() => {
  const axis: number[] = [];
  for (let v = 0; v <= 60; v += 2) axis.push(v);
  let v = 60, st = 2;
  while (v < 1100) {
    st *= 1.08;
    v += st;
    axis.push(v);
  }
  const xs = [...axis.slice(1).map((q) => -q).reverse(), ...axis];
  const n = xs.length;
  const h = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = bhHeight(xs[i], xs[j]);
  return { xs, n, h };
})();

function cellOf(xs: number[], x: number) {
  let lo = 0, hi = xs.length - 1;
  if (x <= xs[0]) return 0;
  if (x >= xs[hi]) return hi - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (xs[m] <= x) lo = m;
    else hi = m;
  }
  return lo;
}

/** Height of the rendered hill surface (matches the mesh triangulation), 0 in the village. */
export function bhSurface(x: number, z: number) {
  if (ring(x, z) <= 49.2) return 0;
  const { xs, n, h } = GRID;
  const i = cellOf(xs, x), j = cellOf(xs, z);
  const fx = (x - xs[i]) / (xs[i + 1] - xs[i]), fz = (z - xs[j]) / (xs[j + 1] - xs[j]);
  const ha = h[j * n + i], hb = h[j * n + i + 1], hc = h[(j + 1) * n + i], hd = h[(j + 1) * n + i + 1];
  if (fx + fz <= 1) return ha + (hb - ha) * fx + (hc - ha) * fz;
  return hd + (hc - hd) * (1 - fx) + (hb - hd) * (1 - fz);
}

export const brennhollow: Dressing = (kit) => {
  const { def, builder: B, props, quality } = kit;
  const qn = qualityName(quality);
  const detail = worldDetail(qn);
  const high = qn === "high";
  const r = rng(5150);
  const boxes = def.boxes;
  const tagged = (t: string) => boxes.filter((b) => b.tag === t);
  const spawns = def.survival?.enemySpawns ?? [];
  const nearSpawn = (x: number, z: number, m: number) => spawns.some((s) => Math.hypot(s.x - x, s.z - z) < m);
  const free = (x: number, z: number, m = 0.3) => clearOf(boxes, x, z, m);
  const extras: WorldExtra[] = [];
  const height = bhSurface;
  attachGrime(B, qn, "wet");

  // ---- Custom texture layers (one merged mesh + material each) -----------------------
  const texSize = high ? 1024 : quality.proceduralTextureSize >= 512 ? 512 : 256;
  const layerBuilders = { slate: new MeshBuilder(), stone: new MeshBuilder(), timber: new MeshBuilder(), setts: new MeshBuilder() };
  for (const lb of Object.values(layerBuilders)) lb.ground = height;
  const V: Village = { B, slate: layerBuilders.slate, stone: layerBuilders.stone, timber: layerBuilders.timber, props, detail, high };

  // ---- Terrain splat ------------------------------------------------------------------
  const splat = (x: number, z: number, o: Splat) => {
    const d = ring(x, z);
    const n = fbm2(x * 0.07, z * 0.07, 3);
    const n2 = fbm2(x * 0.19 + 9, z * 0.19, 2);
    const road = roadAt(x, z);
    if (d < 49.5) {
      o.gravel = road * 1.3 + smoothstep(0.55, 0.68, n2) * 0.5 + (inSquare(x, z, 1.5) ? 1.2 : 0) + 0.1;
      o.ground = (1 - road) * 1.2 + smoothstep(0.4, 0.6, n) * 0.6;
      o.mud = smoothstep(0.58, 0.72, n) * 0.8 + road * 0.35 * n2;
    } else {
      o.gravel = road * 0.9 + 0.05;
      o.ground = 1.2 - road * 0.8;
      o.mud = road * 0.4 + smoothstep(0.62, 0.76, n) * 0.3;
    }
  };

  // ---- Grass: lush gardens and verges, none on the paving ------------------------------
  const grass = (x: number, z: number) => {
    if (inSquare(x, z, 0.2)) return 0;
    const d = ring(x, z);
    const road = roadAt(x, z);
    const n = fbm2(x * 0.09, z * 0.09, 3);
    if (d > 57) return 0;
    const g = 0.95 - road * 1.4 - smoothstep(0.6, 0.72, n) * 0.4;
    return Math.max(0, Math.min(1, g));
  };
  const tallGrass = (x: number, z: number) => {
    const d = ring(x, z);
    if (roadAt(x, z) > 0.2 || nearSpawn(x, z, 2.5) || inSquare(x, z, 2)) return 0;
    const n = fbm2(x * 0.08 + 4, z * 0.08 - 7, 3);
    if (d > 46 && d < 49) return 0.85; // hard against the bank
    if (d >= 49 && d < 66) return smoothstep(0.38, 0.55, n) * 0.6;
    if (d < 46) return smoothstep(0.58, 0.72, n) * 0.45;
    return 0;
  };

  // ---- Houses, church, manor -----------------------------------------------------------------
  for (const h of HOUSES) house(V, h);
  churchTower(V);
  churchInterior(V, tagged("pew").map((p) => ({ x: p.x, z: p.z, w: p.w, d: p.d, rotY: p.rotY })));
  manorDetail(V, houseById("manor"));
  {
    // Church: tall nave windows glow faintly (candles), a shell hole in the west roof slope.
    const fr = facades(0, -26.3, 12, 15.4, 0);
    wallDecal(B, fr[3], "soot", 5, 6.5, 3, 3, 0xffffff, 0.06);
    wallDecal(B, fr[1], "pocks", 7, 2.2, 2, 2, 0xffffff, 0.06);
  }

  // Interiors: stairs, upper floor boards, beams, banister, the barn loft, furniture.
  for (const s of tagged("stair")) {
    const y = (s.y ?? 0) + s.h;
    V.timber.box("plain", s.x, y - 0.03, s.z, s.w + 0.02, 0.06, s.d, 0x7a5e44);
    B.box("plaster", s.x, y / 2 - 0.03, s.z, s.w, y - 0.06, s.d, 0xe8e2d6);
  }
  for (const f of [...tagged("floor"), ...tagged("loft")]) {
    const y = (f.y ?? 0) + f.h;
    V.timber.box("plain", f.x, y - f.h / 2, f.z, f.w, f.h, f.d, 0x7c6448);
    const alongX = f.w > f.d;
    for (let a = -(alongX ? f.w : f.d) / 2 + 0.4; a < (alongX ? f.w : f.d) / 2; a += 1.1) {
      if (alongX) V.timber.box("plain", f.x + a, y - f.h - 0.1, f.z, 0.16, 0.2, f.d, 0x5a4432);
      else V.timber.box("plain", f.x, y - f.h - 0.1, f.z + a, f.w, 0.2, 0.16, 0x5a4432);
    }
  }
  for (const b of tagged("banister")) railing(B, new THREE.Vector3(b.x - b.w / 2, b.y ?? 0, b.z), new THREE.Vector3(b.x + b.w / 2, b.y ?? 0, b.z), 1.0, 0x4a3426, 0.14, "decor", "wood");
  for (const p of tagged("loftpost")) V.timber.box("plain", p.x, p.h / 2, p.z, p.w, p.h, p.d, 0x6a5038);
  for (const p of tagged("loftrail")) railing(B, new THREE.Vector3(p.x - p.w / 2, p.y ?? 0, p.z), new THREE.Vector3(p.x + p.w / 2, p.y ?? 0, p.z), 0.8, 0x5a4432, 0.9, "decor", "wood");
  {
    // Hayloft ladder, hay heaps, an old cart in the barn; timber gables above the stone walls.
    for (const o of [-0.25, 0.25]) V.timber.box("plain", 31.5 + o, 1.8, 14.6, 0.07, 3.8, 0.07, 0x6a5038, { rotX: -0.18 });
    for (let k = 0.3; k < 3.6; k += 0.32) V.timber.box("plain", 31.5, k, 14.6 - k * 0.18, 0.5, 0.05, 0.05, 0x6a5038);
    for (let i = 0; i < 6; i++) B.box("canvas", 33 + r() * 7, 3.75, 16.2 + r() * 2, 1.6, 0.5 + r() * 0.4, 1.4, 0xc8b47a, { rotY: r() * 3 });
    rubblePile(B, 38.5, 9.5, 1.4, 1.1, 0.4, 61, "decor");
  }
  {
    // The hall: counter, tables, chairs, a hanging lamp; upstairs a mattress and sandbags at a window.
    V.timber.box("plain", -15.2, 0.55, -9.2, 0.6, 1.1, 3.0, 0x5a3e2a);
    V.timber.box("plain", -15.2, 1.12, -9.2, 0.75, 0.05, 3.2, 0x6a4a32);
    for (const [tx, tz] of [[-21.5, -8], [-18.5, -5.2], [-22.6, -4.6]]) {
      V.timber.box("plain", tx, 0.74, tz, 1.2, 0.05, 0.8, 0x7a5a3a);
      for (const sx of [-0.5, 0.5]) for (const sz of [-0.32, 0.32]) V.timber.box("plain", tx + sx, 0.36, tz + sz, 0.05, 0.72, 0.05, 0x5a4030);
    }
    props.place("plastic_monobloc_chair_01", { x: -20.6, y: 0, z: -8.4, rotY: 2.1, scale: 1 });
    props.place("plastic_monobloc_chair_01", { x: -18.0, y: 0, z: -6.0, rotY: 0.4, scale: 1, tier: 1 });
    props.place("steel_frame_shelves_01", { x: -24.2, y: 0, z: -9.8, rotY: Math.PI / 2, fit: [1.8, 2.0, 0.5] });
    B.box("canvas", -22.5, 3.42, -4.4, 1.9, 0.18, 0.9, 0x7a7a6a);
    for (let i = 0; i < 4; i++) B.box("sandbag", -13.9, 3.45 + Math.floor(i / 2) * 0.24, -9.6 + (i % 2) * 0.62, 0.42, 0.24, 0.6, 0xc4b48e);
    kit.addLamp?.(new THREE.Vector3(-19, 2.6, -7.5), 0xffd6a0, 3, 8);
  }

  // ---- The square: setts, curbs, statue, tank, pickup, furniture ---------------------------------
  {
    const S = layerBuilders.setts;
    const { x0, x1, z0, z1 } = SQUARE;
    S.box("plain", (x0 + x1) / 2, 0.005, (z0 + z1) / 2, x1 - x0, 0.02, z1 - z0, 0xffffff, { noAo: true });
    // Paved forecourt to the church porch, cobbles running into the lanes.
    S.box("plain", 0, 0.005, -13.0, 5.6, 0.02, 1.2, 0xf0ece4, { noAo: true });
    groundStrip(S, "plain", 0.5, 10, 0.5, 18, 6, () => 0, 0xe8e4dc, 12, "decor", 0.004);
    groundStrip(S, "plain", -11, -12.4, -11, -20, 6.6, () => 0, 0xe8e4dc, 13, "decor", 0.004);
    // Granite curbs round the square (lanes break through).
    const curb = (ax: number, az: number, bx: number, bz: number) => {
      const len = Math.hypot(bx - ax, bz - az);
      V.stone.box("plain", (ax + bx) / 2, 0.06, (az + bz) / 2, ax === bx ? 0.22 : len, 0.12, ax === bx ? len : 0.22, 0xc8c2b8);
    };
    curb(x0, -11, x0, -3.6);
    curb(x0, 8, x0, z1);
    curb(x1, -12.5, x1, -4.8);
    curb(x1, 3.4, x1, z1);
    curb(x0, z1, -3.2, z1);
    curb(4.2, z1, x1, z1);
    // Puddles, oil, tracks across the setts, scorch from shells, rubble and bricks off the houses.
    for (let i = 0; i < 18; i++) {
      const x = x0 + 1 + r() * (x1 - x0 - 2), z = z0 + 1 + r() * (z1 - z0 - 2);
      if (!free(x, z, 0.4)) continue;
      const k = r();
      groundDecal(B, k < 0.35 ? "puddle" : k < 0.55 ? "oil" : k < 0.75 ? "cracks" : k < 0.88 ? "specks" : "burn", x, z, 1.4 + r() * 2.4, 1.2 + r() * 2, r() * 6, 0xffffff, undefined, "decor", 0.03);
    }
    groundDecal(B, "burn", -4.5, -4.5, 4.2, 4.2, 0.6, 0xffffff, undefined, "decor", 0.031);
    groundDecal(B, "burn", 6.5, 1.5, 3.4, 3.4, 1.3, 0xffffff, undefined, "decor", 0.031);
    groundDecal(B, "tracks", 3.2, 2.8, 3.0, 9, 1.35, 0xffffff, undefined, "decor", 0.032);
    groundDecal(B, "tracks", -3, 3, 3.0, 9, 1.4, 0xffffff, undefined, "decor", 0.032);
  }
  statue(V, STATUE.x, STATUE.z, STATUE.plinth);
  tankHulk(V, TANK.x, TANK.z, TANK.yaw, 404);
  groundDecal(B, "burn", TANK.x, TANK.z, 9, 6, TANK.yaw, 0xffffff, undefined, "decor", 0.033);
  debrisScatter(B, TANK.x, TANK.z, 5, 24, 405, "decor", undefined, (x, z) => free(x, z, 0.05));
  pickup(V, PICKUP.x, PICKUP.z, PICKUP.yaw);
  groundDecal(B, "oil", PICKUP.x + 1.4, PICKUP.z, 1.6, 1.4, 0, 0xffffff, undefined, "decor", 0.033);
  for (const p of tagged("planter")) {
    V.stone.box("plain", p.x, p.h / 2, p.z, p.w, p.h, p.d, 0xc8c0b2);
    B.box("ground", p.x, p.h - 0.04, p.z, p.w - 0.2, 0.06, p.d - 0.2, 0x6a5a40);
    for (let i = 0; i < 9; i++) B.box("plain", p.x + (r() - 0.5) * (p.w - 0.4), p.h + 0.05, p.z + (r() - 0.5) * (p.d - 0.4), 0.16, 0.18, 0.16, [0xb8382a, 0xd8c040, 0x4a6a30, 0x5a7a34][i % 4]);
  }
  for (const b of tagged("bench")) {
    V.timber.box("plain", b.x, 0.44, b.z, b.w, 0.05, b.d - 0.05, 0x7a5a3a);
    for (const s of [-1, 1]) B.box("metal_dark", b.x + s * (b.w / 2 - 0.15), 0.22, b.z, 0.06, 0.44, b.d, 0x2a2a28);
  }
  for (const s of tagged("stall")) {
    // Collapsed market stall: tilted counter, torn awning, crates of spilled produce.
    V.timber.box("plain", s.x, 0.5, s.z, s.w, 1.0, s.d * 0.5, 0x7a5a3a, { rotZ: 0.06 });
    B.box("cloth", s.x + 0.3, 1.25, s.z, s.w + 0.4, 0.03, s.d + 0.3, 0xffffff, { rotX: 0.4, rotZ: -0.2 });
    for (const sx of [-1, 1]) rod(B, new THREE.Vector3(s.x + sx * s.w / 2, 0, s.z - s.d / 2), new THREE.Vector3(s.x + sx * s.w / 2 + 0.2, 2.1, s.z - s.d / 2 - 0.3), 0.03, 0x3a3a38);
    for (let i = 0; i < 10; i++) B.box("plain", s.x + 1.6 + r() * 1.4, 0.05, s.z + (r() - 0.5) * 2, 0.09, 0.09, 0.09, i % 3 ? 0xb8402a : 0xd8a838);
  }
  for (const [x, z] of LAMPS) {
    // Cast-iron lamp post with a lantern head.
    const g = new THREE.CylinderGeometry(0.06, 0.1, 3.6, 8);
    B.add(g, new THREE.Matrix4().makeTranslation(x, 1.8, z), "metal_dark", 0x26282a, { uv: "keep" });
    g.dispose();
    B.box("metal_dark", x, 0.25, z, 0.3, 0.5, 0.3, 0x26282a);
    B.box("metal_dark", x, 3.75, z, 0.34, 0.06, 0.34, 0x26282a);
    B.box("plain", x, 3.98, z, 0.24, 0.4, 0.24, 0xd8d0b0);
    B.box("metal_dark", x, 4.24, z, 0.38, 0.1, 0.38, 0x26282a);
  }

  // ---- Walls: dry-stone garden walls, the manor yard, the arched gateway ------------------------
  const ivy = (x: number, z: number, w: number, d: number, h: number) => {
    // Ivy: clumps of dark leaf cards spilling over wall tops (bush instances).
    if (r() < 0.45) bushes.push({ x: x + (r() - 0.5) * w * 0.8, z: z + (r() - 0.5) * d * 0.8, scale: 0.5 + r() * 0.4 });
    void h;
  };
  const bushes: BushPlacement[] = [];
  for (const w of [...tagged("lowwall"), ...tagged("yardwall")]) {
    const y = w.h;
    V.stone.box("plain", w.x, y / 2, w.z, w.w, y, w.d, 0xd8d0c4);
    // Coping stones, slightly irregular.
    const alongX = w.w > w.d;
    const len = alongX ? w.w : w.d;
    for (let a = -len / 2; a < len / 2 - 0.05; a += 0.55 + r() * 0.3) {
      const l = Math.min(0.6 + r() * 0.3, len / 2 - a);
      const cx = alongX ? w.x + a + l / 2 : w.x, cz = alongX ? w.z : w.z + a + l / 2;
      V.stone.box("plain", cx, y + 0.07, cz, alongX ? l - 0.03 : w.w + 0.1, 0.14 + r() * 0.04, alongX ? w.d + 0.1 : l - 0.03, 0xc4bcae, { rotY: (r() - 0.5) * 0.05 });
    }
    for (const f of facades(w.x, w.z, w.w, w.d, 0)) wallDecal(B, f, "baseDirt", (alongX ? w.w : w.d) / 2, 0.45, len, 0.9, 0xffffff, 0.02);
    for (let k = 0; k < len / 3; k++) ivy(w.x, w.z, w.w, w.d, y);
    if (w.tag === "yardwall" && r() < 0.5) wallDecal(B, facades(w.x, w.z, w.w, w.d, 0)[alongX ? 2 : 3], "pocks", len * r(), 1.3, 1.4, 1.4, 0xffffff, 0.03);
  }
  {
    // Arched gateway into the manor garden: rusticated piers, a stone arch, iron gates swung open.
    const m = MANOR_YARD;
    const z = m.z1 - 0.3;
    const [g0, g1] = m.gate;
    const gc = (g0 + g1) / 2, gw = g1 - g0;
    for (const px of [g0 - 0.25, g1 + 0.25]) {
      V.stone.box("plain", px, 1.8, z, 0.5 + 0.12, 3.6, 1.12, 0xcfc6b6);
      for (let y = 0.4; y < 3.4; y += 0.45) V.stone.box("plain", px, y, z, 0.66, 0.36, 1.18, 0xd8d0c2);
      V.stone.box("plain", px, 3.7, z, 0.8, 0.2, 1.3, 0xc8c0b0);
      const ball = new THREE.SphereGeometry(0.22, 10, 8);
      V.stone.add(ball, new THREE.Matrix4().makeTranslation(px, 4.0, z), "plain", 0xc8c0b0, {});
      ball.dispose();
    }
    const arch = new THREE.TorusGeometry(gw / 2 + 0.2, 0.32, 5, 14, Math.PI);
    V.stone.add(arch, new THREE.Matrix4().makeScale(1, 0.55, 1.6).setPosition(gc, 3.3, z), "plain", 0xd0c8b8, { uv: "keep" });
    arch.dispose();
    V.stone.box("plain", gc, 3.85, z, gw + 1.0, 0.4, 1.0, 0xcac2b2);
    V.stone.box("plain", gc, 4.1, z, 0.5, 0.5, 1.05, 0xd8d0c0); // keystone
    // Iron gates (bars, rails, scrolls), one leaf off its upper hinge.
    const leaf = (hx: number, sgn: number, ang: number, droop: number) => {
      const len = gw / 2 - 0.05;
      const ex = hx + sgn * Math.cos(ang) * len, ez = z - Math.sin(ang) * len;
      railing(B, new THREE.Vector3(hx, 0.1 - droop, z), new THREE.Vector3(ex, 0.1, ez), 2.3 - droop, 0x1e2020, 0.13);
      rod(B, new THREE.Vector3(hx, 1.2, z), new THREE.Vector3(ex, 1.2 - droop * 0.5, ez), 0.025, 0x1e2020);
      for (let i = 0; i < 4; i++) {
        const t = (i + 0.5) / 4;
        const p = new THREE.Vector3(hx + (ex - hx) * t, 2.45 - droop * t, z + (ez - z) * t);
        rod(B, p, p.clone().add(new THREE.Vector3(0, 0.25, 0)), 0.02, 0x1e2020);
      }
    };
    leaf(g0 + 0.05, 1, 1.25, 0);
    leaf(g1 - 0.05, -1, 1.45, 0.35);
    groundDecal(B, "specks", gc, z - 1.5, gw + 2, 3, 0, 0xffffff);
    // Garden: gravel path to the door, an old stone fountain basin, rose beds gone wild.
    groundStrip(B, "rubble", gc, -18.4, gc, -25, 2.6, () => 0, 0xd8d0c0, 71, "decor", 0.012);
    const basin = new THREE.CylinderGeometry(1.0, 1.1, 0.6, 16, 1, true);
    V.stone.add(basin, new THREE.Matrix4().makeTranslation(29.5, 0.3, -21.5), "plain", 0xc8c0b0, { uv: "keep", uvScale: [6, 0.6] });
    basin.dispose();
    B.box("plain", 29.5, 0.42, -21.5, 1.6, 0.02, 1.6, 0x2a3830);
    for (const [bx, bz] of [[16.5, -20], [18.5, -21.5], [33.5, -20.5], [35, -23], [16, -38], [33, -40], [21, -40], [35, -36]]) bushes.push({ x: bx, z: bz, scale: 0.8 + r() * 0.6 });
  }

  // ---- Props on gameplay boxes -----------------------------------------------------------------
  for (const rb of tagged("rubble")) rubblePile(B, rb.x, rb.z, rb.w * 0.62, rb.d * 0.62, rb.h * 1.05, Math.round(rb.x * 13 + rb.z * 7), "decor", undefined, detail.debris);
  for (const c of tagged("burntcar")) burntCar(B, c.x, c.z, c.w > c.d ? 0.15 : Math.PI / 2, "sedan", Math.round(c.x * 7), "decor");
  for (const c of tagged("cart")) {
    // Overturned hay cart: plank bed on its side, two spoked wheels.
    V.timber.box("plain", c.x, c.h / 2, c.z, c.w, c.h, 0.12, 0x7a6248, { rotX: 0.15 });
    for (const s of [-1, 1]) {
      const w = new THREE.TorusGeometry(0.55, 0.05, 4, 14);
      V.timber.add(w, new THREE.Matrix4().makeRotationX(Math.PI / 2 - 0.1).setPosition(c.x + s * 0.9, 0.08 + (s > 0 ? 0.05 : 0), c.z + 0.6), "plain", 0x5a4632, { uv: "keep" });
      w.dispose();
    }
    for (let i = 0; i < 4; i++) B.box("canvas", c.x + (r() - 0.5) * 3, 0.12, c.z + 1.0 + r(), 0.9, 0.25, 0.6, 0xc8b47a, { rotY: r() * 3 });
  }
  for (const t of tagged("tractor")) {
    // Burnt-out farm tractor: big rear wheels, bonnet, open seat frame.
    const big = new THREE.CylinderGeometry(0.85, 0.85, 0.45, 14).rotateX(Math.PI / 2);
    const small = new THREE.CylinderGeometry(0.45, 0.45, 0.3, 12).rotateX(Math.PI / 2);
    for (const s of [-1, 1]) {
      B.add(big, new THREE.Matrix4().makeTranslation(t.x - 0.9, 0.82, t.z + s * 0.95), "metal_rust", 0x3a3430, { uv: "keep" });
      B.add(small, new THREE.Matrix4().makeTranslation(t.x + 1.2, 0.45, t.z + s * 0.8), "metal_rust", 0x3a3430, { uv: "keep" });
    }
    big.dispose();
    small.dispose();
    B.box("metal_rust", t.x + 0.6, 1.1, t.z, 2.0, 0.8, 0.9, 0x6a3a28);
    B.box("metal_rust", t.x - 0.9, 1.4, t.z, 0.9, 0.5, 1.4, 0x5a3a2a);
    rod(B, new THREE.Vector3(t.x + 1.2, 1.5, t.z + 0.2), new THREE.Vector3(t.x + 1.25, 2.3, t.z + 0.2), 0.05, 0x2a2420);
    groundDecal(B, "burn", t.x, t.z, 5, 4, 0.3, 0xffffff);
  }
  for (const w of tagged("woodpile")) {
    const log = new THREE.CylinderGeometry(0.11, 0.11, w.d + 0.02, 7).rotateX(Math.PI / 2);
    for (let row = 0; row < 5; row++) for (let i = 0; i < 12 - row; i++) {
      V.timber.add(log, new THREE.Matrix4().makeRotationY(Math.PI / 2 * 0 + (r() - 0.5) * 0.06).setPosition(w.x - w.w / 2 + 0.14 + i * 0.235 + row * 0.11, 0.11 + row * 0.2, w.z), "plain", 0x8a6a48, { uv: "keep" });
    }
    log.dispose();
    V.B.box("corrugated_rust", w.x, w.h + 0.4, w.z + 0.2, w.w + 0.6, 0.04, 1.4, 0xb0a090, { rotX: 0.25 });
  }
  for (const w of tagged("well")) {
    const ring = new THREE.CylinderGeometry(0.7, 0.72, w.h, 14, 1, true);
    V.stone.add(ring, new THREE.Matrix4().makeTranslation(w.x, w.h / 2, w.z), "plain", 0xc8c0b0, { uv: "keep", uvScale: [4.4, w.h] });
    ring.dispose();
    B.box("plain", w.x, w.h - 0.3, w.z, 1.2, 0.02, 1.2, 0x0a0a0a);
    for (const s of [-1, 1]) V.timber.box("plain", w.x + s * 0.65, w.h + 0.8, w.z, 0.1, 1.6, 0.1, 0x5a4432);
    V.timber.box("plain", w.x, w.h + 1.5, w.z, 1.5, 0.08, 0.08, 0x5a4432);
    V.slate.box("plain", w.x, w.h + 1.75, w.z - 0.3, 1.7, 0.04, 0.8, 0xffffff, { rotX: -0.6 });
    V.slate.box("plain", w.x, w.h + 1.75, w.z + 0.3, 1.7, 0.04, 0.8, 0xffffff, { rotX: 0.6 });
  }
  for (const a of tagged("ammo")) {
    props.place("ammo_box", { x: a.x - 0.35, y: a.h, z: a.z + 0.3, scale: 2, rotY: Math.PI / 2 }, (bb, g) => bb.box("metal_painted", a.x - 0.35, a.h + 0.16, a.z + 0.3, 0.52, 0.32, 0.16, 0x7d8456, { group: g }));
  }
  for (const f of tagged("fence")) fence(B, f.x - f.w / 2, f.z - f.d / 2, f.x + f.w / 2 * (f.w > f.d ? 1 : -1) * (f.w > f.d ? 1 : 0) + (f.w > f.d ? 0 : f.w / 2), f.z + (f.w > f.d ? -f.d / 2 : f.d / 2), () => 0, r);
  // Fuel / props scatter in yards.
  props.place("utility_box_01", { x: -12.75, y: 0, z: -1.6, rotY: -Math.PI / 2, scale: 1 });
  for (const [x, z] of [[-26.6, -10.5], [24.9, 4.4], [-4.6, 22], [13.8, 23], [-27.4, 7.5]] as const) if (free(x, z, 0.5)) props.place("trashbag", { x, y: 0, z, rotY: r() * 6, scale: 1 });
  for (const [x, z] of [[27.5, 16.8], [-36.5, -26], [44, -10]] as const) if (free(x, z, 0.9)) pallets(B, x, z, r() * 0.5, 1 + Math.floor(r() * 3), r);
  for (const [x, z] of [[28.6, 18.2], [-29.5, -7.5]] as const) if (free(x, z, 0.4)) tyre(B, x, z, false, r);
  for (const [x, z, m] of [[27.6, 9, 1], [-28, -9.4, 2], [14, 24, 3], [-14.2, 11.5, 4]] as const) if (free(x, z, 0.4)) props.place(m % 2 ? "Barrel_01" : "barrel_03", { x, y: 0, z, rotY: r() * 6, scale: 1, tier: 1 });

  // ---- Ground: worn asphalt on the through-road, tracks, decals, rubble and litter ------------------
  for (const rd of ROADS.filter((q) => q.paved)) {
    for (let i = 1; i < rd.pts.length; i++) {
      const [a, b] = [rd.pts[i - 1], rd.pts[i]];
      const far = Math.min(Math.abs(a[0]), Math.abs(b[0])) > 47;
      groundStrip(B, "asphalt", a[0], a[1], b[0], b[1], rd.w - 2.4, height, 0xb4b0a8, 80 + i, far ? "far" : "decor", far ? 0.08 : 0.012);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let t = 0; t < len && !far; t += 2.5 + r() * 3) {
        const k = t / len;
        const x = a[0] + (b[0] - a[0]) * k, z = a[1] + (b[1] - a[1]) * k + (r() - 0.5) * (rd.w - 3);
        const q = r();
        if (q < 0.25) groundPatch(B, r() < 0.5 ? "rubble" : "concrete_broken", x, z, 0.6 + r() * 0.9, 0.5 + r() * 0.7, r() * 6, 0xb8b0a4, Math.floor(r() * 1e6), 0.02);
        else if (q < 0.55) groundDecal(B, "cracks", x, z, 2 + r() * 2, 2 + r() * 2, r() * 6, 0xffffff);
        else if (q < 0.7) groundDecal(B, "puddle", x, z, 1.4 + r() * 2, 1 + r() * 1.5, r() * 6, 0xffffff);
        else groundDecal(B, "tracks", x, a[1] + (b[1] - a[1]) * k, 2.4, 5.4, Math.PI / 2, 0xffffff);
      }
    }
  }
  const keep = (x: number, z: number) => free(x, z, 0.15) && !nearSpawn(x, z, 1.5);
  const decalCount = Math.round(60 * detail.debris);
  for (let i = 0; i < decalCount; i++) {
    const x = (r() * 2 - 1) * 46, z = (r() * 2 - 1) * 46;
    if (!free(x, z, 0.3)) continue;
    const k = r();
    const kind = roadAt(x, z) > 0.3 ? (k < 0.4 ? "tracks" : k < 0.7 ? "puddle" : "specks") : k < 0.3 ? "puddle" : k < 0.45 ? "burn" : k < 0.75 ? "specks" : "baseDirt";
    groundDecal(B, kind, x, z, 1.6 + r() * 2.4, 1.4 + r() * 2, r() * 6, 0xffffff);
  }
  // Brick and plaster spilled into the street below damaged facades.
  for (const h of HOUSES) {
    if (h.damage < 0.4 || h.id === "church") continue;
    const fr = facades((h.x0 + h.x1) / 2, (h.z0 + h.z1) / 2, h.x1 - h.x0, h.z1 - h.z0, 0);
    for (let k = 0; k < Math.round(h.damage * 3); k++) {
      const s = Math.floor(r() * 4);
      const L = s % 2 ? h.z1 - h.z0 : h.x1 - h.x0;
      const p = fr[s].at(1 + r() * (L - 2), 0, 1.1 + r() * 0.8);
      if (!free(p.x, p.z, 0.5) || nearSpawn(p.x, p.z, 3)) continue;
      if (r() < 0.45 * detail.debris + 0.2) rubblePile(B, p.x, p.z, 0.9 + r() * 0.8, 0.7 + r() * 0.5, 0.3 + r() * 0.35, Math.floor(r() * 1e6), clutterGroup(p.x, p.z), undefined, detail.debris);
      else debrisScatter(B, p.x, p.z, 1.6, 14, Math.floor(r() * 1e6), clutterGroup(p.x, p.z), undefined, keep);
    }
  }
  for (let i = 0; i < Math.round(34 * detail.debris); i++) {
    const x = (r() * 2 - 1) * 46, z = (r() * 2 - 1) * 46;
    debrisScatter(B, x, z, 1.5 + r() * 2.5, Math.round(6 + r() * 10), 900 + i, clutterGroup(x, z), undefined, keep);
  }
  for (let i = 0; i < Math.round(16 * detail.debris); i++) {
    const x = (r() * 2 - 1) * 44, z = (r() * 2 - 1) * 44;
    litter(B, x, z, 2 + r() * 2, Math.round(6 + r() * 6), 1100 + i, "decor", keep);
  }

  // ---- Power lines on wooden poles; drop cables to the houses ---------------------------------------
  const pts = POLES.map(([x, z, rot]) => poleWirePoints(x, 0, z, rot));
  const link = (a: number, b: number, sag = 0.9) => wireSpan(B, pts[a], pts[b], sag);
  link(0, 1); link(1, 2); link(3, 4); link(4, 5); link(5, 6); link(7, 8, 0.8);
  // Across the square (sagging lines over the statue) and down the south lane.
  wireSpan(B, [pts[2][1]], [pts[3][1]], 1.4);
  wireSpan(B, [pts[2][2]], [pts[7][0]], 1.2);
  const drop = (p: THREE.Vector3, x: number, y: number, z: number) => cable(B, p, new THREE.Vector3(x, y, z), 0.5);
  drop(pts[1][0], -25.2, 5.4, -4.5);
  drop(pts[2][0], -13.2, 5.6, -4);
  drop(pts[3][2], 15.2, 5.3, -6.2);
  drop(pts[4][0], 26.8, 5.2, -7.2);
  drop(pts[7][2], -4.2, 5.3, 20.5);
  drop(pts[8][0], 5.2, 5.0, 22);
  // Lines leaving the village over the hills (poles beyond the bank).
  const outPoles: { x: number; z: number }[] = [{ x: -62, z: -2 }, { x: -96, z: -1 }, { x: -130, z: 2 }, { x: 64, z: -6 }, { x: 98, z: -9 }, { x: 132, z: -12 }];
  for (const [i, p] of outPoles.entries()) {
    const y = height(p.x, p.z);
    const g = new THREE.CylinderGeometry(0.11, 0.15, 9.2, 8);
    B.add(g, new THREE.Matrix4().makeTranslation(p.x, y + 4.1, p.z), "wood", 0x6a5a48, { group: "far", uv: "keep", uvScale: [0.8, 8.6] });
    g.dispose();
    B.box("wood", p.x, y + 8.0, p.z, 0.11, 0.11, 2.1, 0x5a4c3c, { group: "far" });
    const prev = i === 0 || i === 3 ? pts[i === 0 ? 0 : 6] : null;
    const me = [-0.85, 0, 0.85].map((o) => new THREE.Vector3(p.x, y + 8.2, p.z + o));
    if (prev) wireSpan(B, prev, me, 1.4);
    else {
      const q = outPoles[i - 1];
      const qy = height(q.x, q.z);
      wireSpan(B, [-0.85, 0, 0.85].map((o) => new THREE.Vector3(q.x, qy + 8.2, q.z + o)), me, 1.6);
    }
  }

  // ---- Hedgerow bank round the village; barricades at the lane exits ---------------------------------
  for (let a = -48; a <= 48; a += 2.2 + r() * 1.6) {
    for (const [x, z] of [[a, -49.4], [a, 49.4], [-49.4, a], [49.4, a]] as const) {
      if (roadAt(x, z) > 0.4) continue;
      bushes.push({ x: x + (r() - 0.5) * 0.8, z: z + (r() - 0.5) * 0.8, scale: 1.1 + r() * 0.9 });
    }
  }
  for (const [x, z, yaw] of [[-49.3, 2.5, Math.PI / 2], [49.3, -0.8, Math.PI / 2], [0.5, 49.3, 0], [-11, -49.3, 0]] as const) {
    // Lane exits: a farm gate / timber barrier and coils of wire across the cutting.
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (let k = -3; k <= 3; k++) V.timber.box("plain", x + c * k * 1.2, 0.6, z - s * k * 1.2, 0.14, 1.2, 0.14, 0x6a5240);
    for (const yy of [0.45, 0.95]) V.timber.box("plain", x, yy, z, yaw ? 0.1 : 8.6, 0.12, yaw ? 8.6 : 0.1, 0x7a6048);
    rubblePile(B, x + c * 2.5, z - s * 2.5, 1.4, 1.1, 0.6, Math.round(x * 5 + z), "decor", undefined, detail.debris);
  }
  chainlink(B, 44, -46, 44, -40, 1.8, () => 0, 77);

  // ---- Foliage ------------------------------------------------------------------------------------
  const trees: TreePlacement[] = [];
  // Orchard and garden trees on their trunk colliders.
  for (const [x, z] of ORCHARD) trees.push({ x, z, scale: 0.75 + r() * 0.3, variant: r() < 0.7 ? 3 : 0, rot: r() * 6 });
  // Forest edge and copses on the hillsides (real trees out to ~150 m).
  const treeCount = 150;
  let guard = 0;
  while (trees.length < treeCount && guard++ < 6000) {
    const x = (r() * 2 - 1) * 160, z = (r() * 2 - 1) * 160;
    const d = ring(x, z);
    if (d < 54 || d > 158 || roadAt(x, z) > 0.1) continue;
    if (fbm2(x * 0.03 + 5, z * 0.03 - 3, 3) < 0.47 - smoothstep(54, 70, d) * 0.04) continue;
    trees.push({ x, z, scale: 0.95 + r() * 0.6, variant: r() < 0.5 ? 1 : r() < 0.85 ? 0 : 2, rot: r() * 6 });
  }
  for (const [x, z, k] of [[-30, 46.5], [30, -47], [-47, -40], [47, 40], [-47, 22], [20, 47]].map((p) => [...p, 0] as const)) trees.push({ x: x + (r() - 0.5), z, scale: 0.9 + r() * 0.3 + k, variant: 0, rot: r() * 6 });
  // Bushes: hedges along garden walls, yards, the bank.
  for (let i = 0; i < 90; i++) {
    const x = (r() * 2 - 1) * 47, z = (r() * 2 - 1) * 47;
    if (!clearOf(boxes, x, z, 0.8) || nearSpawn(x, z, 4) || roadAt(x, z) > 0.2 || inSquare(x, z, 1)) continue;
    // Prefer spots hugging walls (shelter, ivy).
    if (clearOf(boxes, x, z, 2.2) && r() < 0.6) continue;
    bushes.push({ x, z, scale: 0.6 + r() * 0.7, dry: r() < 0.08 });
  }
  const plants = (id: "shrub_03" | "fern_02" | "weed_plant_02", n: number, scale: () => number) => {
    let placed = 0, g = 0;
    while (placed < n && g++ < n * 30) {
      const x = (r() * 2 - 1) * 47, z = (r() * 2 - 1) * 47;
      if (!clearOf(boxes, x, z, 0.4) || clearOf(boxes, x, z, 1.6) || nearSpawn(x, z, 3) || roadAt(x, z) > 0.3 || inSquare(x, z, 0.5)) continue;
      const k = placed % 10;
      props.place(id, { x, y: 0, z, scale: scale(), rotY: r() * 6.28, variant: Math.floor(r() * 2), tier: k < 3 ? 0 : k < 6 ? 1 : 2 });
      placed++;
    }
  };
  plants("fern_02", 24, () => 1.8 + r());
  plants("weed_plant_02", 30, () => 3 + r() * 2);
  plants("shrub_03", 12, () => 2 + r());

  // ---- Distant scenery: meadow hills, forest masses, far farms ---------------------------------------
  extras.push(hills(kit.quality.anisotropy, texSize >= 512 ? 512 : 256));
  extras.push(villageTurf(kit.quality.anisotropy, texSize >= 512 ? 512 : 256));
  extras.push(forest(height, qn));
  {
    // Farmsteads and a far church spire on the hillsides (backdrop, no shadows).
    const farms: [number, number, number][] = [[-150, -120, 0.3], [170, -60, 1.2], [-120, 110, 2.1], [90, 160, 0.7], [-210, 20, 1.6], [230, 90, 0.2], [40, -210, 2.6]];
    for (const [x, z, yaw] of farms) farm(V, x, z, yaw, height);
    const sx = 160, sz = -190, gy = height(sx, sz);
    B.box("plaster", sx, gy + 6, sz, 4, 12, 4, 0xe8e2d4, { group: "far" });
    const spire = new THREE.ConeGeometry(2.6, 9, 4);
    V.slate.add(spire, new THREE.Matrix4().makeRotationY(Math.PI / 4).setPosition(sx, gy + 16.5, sz), "plain", 0xffffff, { group: "far", uv: "keep", uvScale: [6, 9] });
    spire.dispose();
    B.box("plaster", sx + 7, gy + 3.5, sz, 10, 7, 6, 0xe8e2d4, { group: "far" });
  }

  // ---- Smoke: the burning manor first (always drawn), then distant fires --------------------------
  const smoke = [
    { x: 21.4, y: 8.5, z: -27.5, scale: 0.62, dark: true },
    { x: -150, y: height(-150, -140) + 2, z: -140, scale: 1.2, dark: true },
    { x: 180, y: height(180, 60), z: 60, scale: 1.0 },
    { x: -40, y: height(-40, 190), z: 190, scale: 0.9 },
  ];
  extras.push(smokeColumns(smoke, qn));
  extras.push(fire([[21.0, 3.9, -27.4], [22.6, 3.8, -26.4], [20.2, 4.0, -28.3], [22.8, 6.9, -28.5], [26.5, 0.4, -28.4]], qn));
  kit.addLamp?.(new THREE.Vector3(21.5, 4.6, -27), 0xff8a3a, 9, 16);

  // ---- Bake the custom layers -------------------------------------------------------------------
  const slate = villageMaterial("slate", texSize, quality.anisotropy);
  const stone = villageMaterial("stone", texSize, quality.anisotropy);
  const timber = villageMaterial("timber", texSize >= 512 ? 512 : 256, quality.anisotropy);
  const setts = villageMaterial("setts", texSize, quality.anisotropy);
  slate.mat.normalScale.set(1.1, 1.1);
  // Moss and lichen (the map's weather colour): roofs and wall feet, a little between the setts.
  applyWeathering(slate.mat, 1);
  applyWeathering(stone.mat, 1);
  applyWeathering(timber.mat, 0.6);
  applyWeathering(setts.mat, 0.3);
  extras.push(layer(layerBuilders.slate, slate, true));
  extras.push(layer(layerBuilders.stone, stone, true));
  extras.push(layer(layerBuilders.timber, timber, true));
  extras.push(layer(layerBuilders.setts, setts, false));
  extras.push(...finishGrime(B));

  return {
    terrain: { height, splat, inner: 52, outer: 53 },
    foliage: {
      grass,
      grassBounds: 58,
      trees,
      bushes,
      tallGrass,
      tallGrassBounds: 66,
      // Damp valley meadow: green tufts with straw-coloured patches, not desert scrub.
      grassPalette: { dry: 0x9a9a58, lush: 0x5e8236, brown: 0x6e7436, rust: 0x8c7c46 },
    },
    extras,
  };
};

/** Bakes a private MeshBuilder into meshes sharing one custom material. */
function layer(builder: MeshBuilder, m: { mat: THREE.Material; dispose(): void }, shadows: boolean): WorldExtra {
  const group = new THREE.Group();
  group.name = `bh-layer:${m.mat.name}`;
  let triangles = 0;
  const geos: THREE.BufferGeometry[] = [];
  for (const [g, list] of builder.build(() => m.mat)) {
    for (const mesh of list) {
      mesh.castShadow = shadows && !g.startsWith("far");
      mesh.receiveShadow = !g.startsWith("far");
      triangles += mesh.geometry.attributes.position.count / 3;
      geos.push(mesh.geometry);
      group.add(mesh);
    }
  }
  return { object: group, triangles, dispose: () => { geos.forEach((g) => g.dispose()); m.dispose(); } };
}

/** Distant farmhouse with a slate roof and a barn (merged into the backdrop). */
function farm(V: Village, x: number, z: number, yaw: number, height: (x: number, z: number) => number) {
  const gy = height(x, z) - 0.5;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const blk = (ox: number, oz: number, w: number, d: number, h: number, tint: number) => {
    const px = x + ox * c + oz * s, pz = z - ox * s + oz * c;
    V.B.box("plaster", px, gy + h / 2, pz, w, h, d, tint, { group: "far", rotY: yaw });
    for (const sd of [-1, 1]) V.slate.box("plain", px + sd * (d / 4 + 0.2) * s, gy + h + d * 0.27, pz + sd * (d / 4 + 0.2) * c, w + 0.6, 0.08, d * 0.62, 0xffffff, { group: "far", rotY: yaw, rotX: sd * 0.78 });
  };
  blk(0, 0, 10, 7, 5.6, 0xe4dcc8);
  blk(12, 3, 12, 8, 4.5, 0xc8bca4);
}

/** Turf over the village ground: gardens and verges green, fading out on lanes, paving and floors. */
function villageTurf(anisotropy: number, size: number): WorldExtra {
  const N = 100, S = 1;
  const pos: number[] = [], col: number[] = [], uv: number[] = [], idx: number[] = [];
  const inside = (x: number, z: number) => HOUSES.some((h) => x > h.x0 - 0.4 && x < h.x1 + 0.4 && z > h.z0 - 0.4 && z < h.z1 + 0.4);
  const yard = (x: number, z: number) => x > MANOR_YARD.x0 && x < MANOR_YARD.x1 && z > MANOR_YARD.z0 && z < MANOR_YARD.z1;
  const c = new THREE.Color(), lush = new THREE.Color(0xa6b27a), dry = new THREE.Color(0xc0b88c);
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const x = -50 + i * S, z = -50 + j * S;
      pos.push(x, 0.008, z);
      uv.push(x, -z);
      const n = fbm2(x * 0.09, z * 0.09, 3), n2 = fbm2(x * 0.21 + 3, z * 0.21 - 5, 2);
      let a = 0.95 - roadAt(x, z) * 1.9 - smoothstep(0.56, 0.7, n) * 0.55 - smoothstep(0.6, 0.75, n2) * 0.3;
      if (inSquare(x, z, 0.6) || inside(x, z)) a = 0;
      if (yard(x, z)) a = Math.min(1, a + 0.25);
      c.copy(lush).lerp(dry, smoothstep(0.45, 0.7, n2));
      col.push(c.r, c.g, c.b, Math.max(0, Math.min(1, a)));
    }
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * (N + 1) + i, b = a + 1, d = a + N + 1, e = d + 1;
    if (col[a * 4 + 3] + col[b * 4 + 3] + col[d * 4 + 3] + col[e * 4 + 3] <= 0) continue;
    idx.push(a, d, b, b, d, e);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const m = villageMaterial("meadow", size, anisotropy);
  m.mat.transparent = true;
  m.mat.depthWrite = false;
  const mesh = new THREE.Mesh(geo, m.mat);
  mesh.name = "bh-turf";
  mesh.renderOrder = -2;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  return { object: mesh, triangles: idx.length / 3, dispose: () => { geo.dispose(); m.dispose(); } };
}

/** Meadow-textured hills from the bank out to the mountains (one mesh, no shadows cast). */
function hills(anisotropy: number, size: number): WorldExtra {
  const xs = GRID.xs;
  const n = xs.length;
  const pos: number[] = [], col: number[] = [], uv: number[] = [];
  const idx: number[] = [];
  const map = new Int32Array(n * n).fill(-1);
  const meadow = new THREE.Color(0x8fa060), lush = new THREE.Color(0x6f8a4a), dryc = new THREE.Color(0xa8a070), forestC = new THREE.Color(0x3c4a30), rock = new THREE.Color(0x8a8a84), cc = new THREE.Color();
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = xs[i], z = xs[j];
      if (ring(x, z) < 48) continue;
      map[j * n + i] = pos.length / 3;
      const h = GRID.h[j * n + i];
      pos.push(x, h + (ring(x, z) < 53 ? -0.02 : 0.03), z);
      uv.push(x, -z);
      // Colour: meadows in patches, darker under forest, rock on the high ridges.
      const k = fbm2(x * 0.012 + 3, z * 0.012, 3);
      cc.copy(meadow).lerp(lush, smoothstep(0.35, 0.65, k)).lerp(dryc, smoothstep(0.62, 0.8, fbm2(x * 0.03, z * 0.03 + 9, 2)) * 0.5);
      const forestK = smoothstep(0.46, 0.56, fbm2(x * 0.006 + 11, z * 0.006 - 4, 3)) * smoothstep(120, 260, ring(x, z));
      cc.lerp(forestC, forestK * 0.85);
      cc.lerp(rock, smoothstep(120, 220, h) * 0.7);
      col.push(cc.r, cc.g, cc.b);
    }
  }
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = map[j * n + i], b = map[j * n + i + 1], c = map[(j + 1) * n + i], d = map[(j + 1) * n + i + 1];
      if (a < 0 || b < 0 || c < 0 || d < 0) continue;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const m = villageMaterial("meadow", size, anisotropy);
  const mesh = new THREE.Mesh(geo, m.mat);
  mesh.name = "bh-hills";
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return { object: mesh, triangles: idx.length / 3, dispose: () => { geo.dispose(); m.dispose(); } };
}

/** Forest masses on the far hills: instanced low-poly conifers and broadleaf crowns (2 draw calls). */
function forest(height: (x: number, z: number) => number, q: ReturnType<typeof qualityName>): WorldExtra {
  const r = rnd(8080);
  const group = new THREE.Group();
  group.name = "bh-forest";
  const shade = (geo: THREE.BufferGeometry, top: number) => {
    const p = geo.attributes.position as THREE.BufferAttribute;
    const c: number[] = [];
    for (let i = 0; i < p.count; i++) {
      const t = Math.max(0, Math.min(1, p.getY(i) / top));
      const k = 0.45 + t * 0.6;
      c.push(k, k, k);
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(c, 3));
    return geo;
  };
  // Conifer: trunk stub + two stacked cones (≈30 tris).
  const coneA = new THREE.ConeGeometry(1.7, 4.4, 7, 1, true).translate(0, 3.5, 0);
  const coneB = new THREE.ConeGeometry(1.15, 3.6, 7, 1, true).translate(0, 5.9, 0);
  const trunkA = new THREE.CylinderGeometry(0.16, 0.24, 1.6, 5, 1, true).translate(0, 0.8, 0);
  const conifer = shade(mergeSimple([coneA, coneB, trunkA]), 7.7);
  const crown = new THREE.IcosahedronGeometry(2.2, 0);
  const pp = crown.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pp.count; i++) pp.setXYZ(i, pp.getX(i) * (1 + (r() - 0.5) * 0.25), pp.getY(i) * 0.85 + 3.6, pp.getZ(i) * (1 + (r() - 0.5) * 0.25));
  crown.computeVertexNormals();
  const trunkB = new THREE.CylinderGeometry(0.2, 0.3, 2.2, 5, 1, true).translate(0, 1.1, 0);
  const broad = shade(mergeSimple([crown, trunkB]), 5.6);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  mat.name = "bh-forest";
  const spots: { x: number; z: number; s: number; conifer: boolean }[] = [];
  let guard = 0;
  while (spots.length < 3200 && guard++ < 80000) {
    const x = (r() * 2 - 1) * 820, z = (r() * 2 - 1) * 820;
    const d = ring(x, z);
    if (d < 150 || d > 800) continue;
    const k = fbm2(x * 0.006 + 11, z * 0.006 - 4, 3);
    const dense = smoothstep(0.44, 0.54, k) * smoothstep(120, 260, d) + smoothstep(0.5, 0.6, fbm2(x * 0.02, z * 0.02, 2)) * 0.4;
    if (r() > dense) continue;
    if (height(x, z) > 190) continue;
    spots.push({ x, z, s: (0.9 + r() * 0.8) * (1 + d / 600), conifer: r() < 0.55 + smoothstep(200, 500, d) * 0.3 });
  }
  // Baked into plain merged meshes (the patched atmosphere fog ignores instance matrices);
  // quality trims the draw range, trees are in random order so thinning is even.
  const meshes: { mesh: THREE.Mesh; total: number; per: number }[] = [];
  let tris = 0;
  for (const [src, isCon] of [[conifer, true], [broad, false]] as const) {
    const base = src.index ? src.toNonIndexed() : src;
    const bp = base.attributes.position as THREE.BufferAttribute, bn = base.attributes.normal as THREE.BufferAttribute, bc = base.attributes.color as THREE.BufferAttribute;
    const list = spots.filter((s) => s.conifer === isCon);
    const per = bp.count;
    const pos = new Float32Array(list.length * per * 3), nor = new Float32Array(list.length * per * 3), col = new Float32Array(list.length * per * 3);
    const m = new THREE.Matrix4(), nm = new THREE.Matrix3(), qq = new THREE.Quaternion(), c = new THREE.Color(), v = new THREE.Vector3();
    list.forEach((s, i) => {
      qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28);
      m.compose(new THREE.Vector3(s.x, height(s.x, s.z) - 0.4, s.z), qq, new THREE.Vector3(s.s, s.s * (0.9 + r() * 0.4), s.s));
      nm.getNormalMatrix(m);
      if (isCon) c.setRGB(0.045 + r() * 0.015, 0.07 + r() * 0.02, 0.045 + r() * 0.012);
      else c.setRGB(0.075 + r() * 0.025, 0.1 + r() * 0.03, 0.045 + r() * 0.015);
      for (let k = 0; k < per; k++) {
        const o = (i * per + k) * 3;
        v.fromBufferAttribute(bp, k).applyMatrix4(m);
        pos[o] = v.x; pos[o + 1] = v.y; pos[o + 2] = v.z;
        v.fromBufferAttribute(bn, k).applyMatrix3(nm).normalize();
        nor[o] = v.x; nor[o + 1] = v.y; nor[o + 2] = v.z;
        const sh = bc.getX(k);
        col[o] = c.r * sh; col[o + 1] = c.g * sh; col[o + 2] = c.b * sh;
      }
    });
    if (base !== src) base.dispose();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    meshes.push({ mesh, total: list.length, per });
    tris += list.length * per / 3;
  }
  const setQuality = (qq: ReturnType<typeof qualityName>) => {
    const k = qq === "low" ? 0.45 : qq === "medium" ? 0.75 : 1;
    for (const x of meshes) x.mesh.geometry.setDrawRange(0, Math.floor(x.total * k) * x.per);
  };
  setQuality(q);
  return {
    object: group,
    setQuality,
    triangles: tris,
    dispose: () => { for (const x of meshes) x.mesh.geometry.dispose(); conifer.dispose(); broad.dispose(); mat.dispose(); coneA.dispose(); coneB.dispose(); trunkA.dispose(); trunkB.dispose(); crown.dispose(); },
  };
}

function mergeSimple(list: THREE.BufferGeometry[]) {
  const pos: number[] = [], nor: number[] = [];
  for (const g of list) {
    const ng = g.index ? g.toNonIndexed() : g;
    pos.push(...(ng.attributes.position.array as Float32Array));
    nor.push(...(ng.attributes.normal.array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  return out;
}

/** Flickering flames (additive camera-facing cards animated in the shader; one draw call). */
function fire(spots: [number, number, number][], q: ReturnType<typeof qualityName>): WorldExtra {
  const S = 64;
  const data = new Uint8Array(S * S * 4);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const u = (i / S - 0.5) * 2, v = j / S;
    const w = Math.max(0, 1 - Math.abs(u) / (0.25 + 0.75 * (1 - v)));
    const a = Math.pow(w, 1.5) * Math.pow(1 - v, 0.7) * Math.min(1, v * 6);
    const k = (j * S + i) * 4;
    data[k] = 255;
    data[k + 1] = Math.round(120 + 120 * (1 - v) * w);
    data[k + 2] = Math.round(40 * w * (1 - v));
    data[k + 3] = Math.round(a * 255);
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.needsUpdate = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  const per = q === "low" ? 4 : 8;
  const geo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const time = { value: 0 };
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true, color: 0xffffff });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.time = time;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float time;\nattribute vec2 flame;")
      .replace(
        "#include <project_vertex>",
        /* glsl */ `
        vec3 base = vec3(instanceMatrix[3]);
        float t = time * (2.2 + flame.y) + flame.x * 6.28;
        float s = (0.9 + 0.35 * sin(t * 1.7) + 0.2 * sin(t * 3.1)) * instanceMatrix[0][0];
        vec4 mvC = modelViewMatrix * vec4(base, 1.0);
        vec2 corner = vec2(position.x * 0.6 + sin(t + position.y * 3.0) * 0.08 * position.y, position.y) * s;
        vec4 mvPosition = mvC + vec4(corner, 0.0, 0.0);
        gl_Position = projectionMatrix * mvPosition;`,
      );
  };
  mat.customProgramCacheKey = () => "bh-fire";
  const mesh = new THREE.InstancedMesh(geo, mat, spots.length * per);
  const flame = new Float32Array(spots.length * per * 2);
  const m = new THREE.Matrix4();
  let a = 3;
  const r = () => ((a = (a * 16807) % 2147483647) / 2147483647);
  spots.forEach(([x, y, z], i) => {
    for (let k = 0; k < per; k++) {
      const n = i * per + k;
      const sc = 0.6 + r() * 0.9;
      m.makeScale(sc, sc, sc).setPosition(x + (r() - 0.5) * 1.2, y, z + (r() - 0.5) * 1.2);
      mesh.setMatrixAt(n, m);
      flame[n * 2] = r();
      flame[n * 2 + 1] = r();
    }
  });
  geo.setAttribute("flame", new THREE.InstancedBufferAttribute(flame, 2));
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.castShadow = mesh.receiveShadow = false;
  const start = performance.now();
  return {
    object: mesh,
    update() {
      time.value = (performance.now() - start) / 1000;
    },
    triangles: 0,
    dispose() {
      geo.dispose();
      mat.dispose();
      tex.dispose();
    },
  };
}

// Silence unused-import lint for helpers kept for future dressing tweaks.
void fbox;
void TOWER;
