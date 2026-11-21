import type { MapBox, MapDef } from "../MapLoader";

/**
 * Morro Azul — an original hillside favela for Survival, about three times
 * the area of the other maps. A paved main road climbs north–south through
 * the middle and crosses an east–west street at a small plaza (bus shelter,
 * a burnt-out sedan, the armory). Narrow concrete alleys (becos) cut every
 * block into stacked brick and painted-render houses, two to five storeys,
 * flat slab roofs crowded with water tanks, dishes and laundry. A dozen
 * houses near the centre are enterable: switchback stairs to every floor,
 * open windows on each storey and a walkable roof terrace. East of the
 * plaza sits a walled futsal court. Hills packed with more houses rise all
 * around beyond the play area (drawn by dressing/morroAzul.ts).
 *
 * x = east, z = south, y = up; box = centre + size. Everything is data so
 * the collider layout and the visuals are generated from the same lots.
 */

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

/** Playable half-extent; the boundary ring sits just outside. */
export const HALF = 86;
export const BOUND = 88;

/** Streets: [centre, half-width]. Main road / cross street are wide; the rest are alleys. */
export const ROADS_X: [number, number][] = [[0, 5], [-31, 1.6], [31, 1.6], [-60, 1.6], [60, 1.6]];
export const ROADS_Z: [number, number][] = [[0, 4.5], [-30, 1.6], [30, 1.6], [-59, 1.6], [59, 1.6]];
export const PLAZA = { x0: -13, x1: 13, z0: -12, z1: 11 };
export const COURT = { x0: 8, x1: 28, z0: 8, z1: 27.5 };

export type Side = 0 | 1 | 2 | 3; // N (z0), E (x1), S (z1), W (x0)

export type Lot = {
  id: string;
  x0: number; x1: number; z0: number; z1: number;
  floors: number;
  fh: number;
  /** Street-facing side (shop fronts, doors). */
  front: Side;
  /** Walk-in with stairs to every floor and the roof. */
  enter: boolean;
  /** Render colour (tint over plaster); brick floors ignore it. */
  paint: number;
  /** Floors at or above this index show bare brick (unfinished upper storeys). */
  brickFrom: number;
  /** Unfinished slab on top: corner columns with rebar instead of a parapet. */
  laje: boolean;
  /** Ground floor is a shop (roll-up shutter, awning, sign). */
  shop: boolean;
  /** Sides touching a neighbour (no windows). */
  blank: Side[];
  seed: number;
};

export type Door = { side: Side; u: number; w: number; h: number };
export type Win = { side: Side; u: number; y: number; w: number; h: number };
export type Stair = { axis: "x" | "z"; /** Lane A / B centre on the cross axis. */ lanes: [number, number]; /** Run start / end on the axis (A climbs start→end, B end→start). */ a: number; b: number; width: number; steps: number; rise: number };

export const WALL_T = 0.25;
export const STEP_RUN = 0.38;

export function rnd(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const sideLength = (l: Lot, s: Side) => (s % 2 === 0 ? l.x1 - l.x0 : l.z1 - l.z0);

/** World (x, z) of a point u along a facade (counter-clockwise from the corner, as in Building.facades). */
export function facadePoint(l: { x0: number; x1: number; z0: number; z1: number }, s: Side, u: number): [number, number] {
  return s === 0 ? [l.x0 + u, l.z0] : s === 1 ? [l.x1, l.z0 + u] : s === 2 ? [l.x1 - u, l.z1] : [l.x0, l.z1 - u];
}

/** Vivid-but-faded render colours of the hill. */
export const PAINTS = [0x5fb3a8, 0xe6c85a, 0xd77a6a, 0x7fa6d6, 0xa6c86a, 0xe0a0b8, 0xf0e2c0, 0x8fd0c8, 0xe8b070, 0xb89ad0, 0xd8d0c0, 0x6ec1d8];

// ---------------------------------------------------------------------------
// Blocks → lots
// ---------------------------------------------------------------------------

function intervals(roads: [number, number][]) {
  const edges = roads.map(([c, h]) => [c - h, c + h] as [number, number]).sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let at = -HALF;
  for (const [a, b] of edges) {
    if (a > at + 4) out.push([at, a]);
    at = Math.max(at, b);
  }
  if (HALF > at + 4) out.push([at, HALF]);
  return out;
}

/** Splits [a, b] into pieces of roughly `target` with optional alley gaps between them. */
function cuts(a: number, b: number, target: number, r: () => number, gapChance: number) {
  const n = Math.max(1, Math.round((b - a) / target));
  const pieces: [number, number][] = [];
  const raw: number[] = [a];
  for (let i = 1; i < n; i++) raw.push(a + ((b - a) * i) / n + (r() - 0.5) * 1.6);
  raw.push(b);
  for (let i = 0; i < n; i++) {
    let lo = raw[i], hi = raw[i + 1];
    // Beco between this lot and the next.
    if (i < n - 1 && r() < gapChance) hi -= 1.8;
    pieces.push([lo, hi]);
    lo = hi;
  }
  return pieces;
}

const overlaps = (a: { x0: number; x1: number; z0: number; z1: number }, b: { x0: number; x1: number; z0: number; z1: number }, m = 0) =>
  a.x0 < b.x1 + m && a.x1 > b.x0 - m && a.z0 < b.z1 + m && a.z1 > b.z0 - m;

function buildLots(): Lot[] {
  const r = rnd(20261121);
  const lots: Lot[] = [];
  let enterable = 0;
  const xs = intervals(ROADS_X), zs = intervals(ROADS_Z);
  for (const [bx0, bx1] of xs) {
    for (const [bz0, bz1] of zs) {
      const block = { x0: bx0, x1: bx1, z0: bz0, z1: bz1 };
      if (overlaps(block, COURT)) continue; // the court fills its block
      for (const [x0, x1] of cuts(bx0, bx1, 8.5, r, 0.45)) {
        for (const [z0, z1] of cuts(bz0, bz1, 8.5, r, 0.45)) {
          const lot0 = { x0, x1, z0, z1 };
          if (overlaps(lot0, PLAZA)) continue;
          if (x1 - x0 < 4.2 || z1 - z0 < 4.2) continue;
          // Back lots fully inside a block: some become yards (open space, clutter).
          const touches = [z0 === bz0, x1 === bx1, z1 === bz1, x0 === bx0];
          const inner = !touches.some(Boolean);
          if (inner && r() < 0.45) continue;
          if (r() < 0.05) continue; // vacant lot
          // Front: the side on the widest street it touches (main road / cross street first).
          const streetW = (s: Side) => {
            if (!touches[s]) return -1;
            const list = s % 2 === 0 ? ROADS_Z : ROADS_X;
            const edge = s === 0 ? z0 : s === 1 ? x1 : s === 2 ? z1 : x0;
            const road = list.find(([c, h]) => Math.abs(Math.abs(edge - c) - h) < 0.01);
            return road ? road[1] : edge === -HALF || edge === HALF ? 0 : 0.5;
          };
          let front: Side = 2;
          let best = -2;
          for (const s of [0, 1, 2, 3] as Side[]) {
            const w = streetW(s) + r() * 0.1;
            if (w > best) {
              best = w;
              front = s;
            }
          }
          const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
          const dist = Math.hypot(cx, cz);
          const W = x1 - x0, D = z1 - z0;
          const canEnter = Math.max(W, D) >= 7 && Math.min(W, D) >= 5.2 && !inner && dist < 50 && dist > 12;
          const enter = canEnter && enterable < 13 && r() < 0.62;
          if (enter) enterable++;
          const floors = enter ? 2 + (r() < 0.45 ? 1 : 0) : Math.max(1, Math.min(5, Math.round(1.6 + r() * 2.6 + (dist > 60 ? 0.6 : 0))));
          const fh = enter ? 2.9 : 2.75 + r() * 0.3;
          const brickFrom = r() < 0.35 ? 0 : r() < 0.5 ? floors : Math.max(1, floors - 1 - Math.floor(r() * 2));
          const onMain = best >= 4;
          lots.push({
            id: `L${lots.length}`,
            x0, x1, z0, z1, floors, fh, front, enter,
            paint: PAINTS[Math.floor(r() * PAINTS.length)],
            brickFrom,
            laje: r() < (enter ? 0.3 : 0.4) && floors >= 2,
            shop: !enter && onMain && r() < 0.6,
            blank: [],
            seed: Math.floor(r() * 1e9),
          });
        }
      }
    }
  }
  // Party walls: a side touching a neighbour gets no windows.
  for (const a of lots) {
    for (const b of lots) {
      if (a === b) continue;
      const zOver = a.z0 < b.z1 - 0.5 && a.z1 > b.z0 + 0.5, xOver = a.x0 < b.x1 - 0.5 && a.x1 > b.x0 + 0.5;
      if (zOver && Math.abs(a.x1 - b.x0) < 0.05) a.blank.push(1);
      if (zOver && Math.abs(a.x0 - b.x1) < 0.05) a.blank.push(3);
      if (xOver && Math.abs(a.z1 - b.z0) < 0.05) a.blank.push(2);
      if (xOver && Math.abs(a.z0 - b.z1) < 0.05) a.blank.push(0);
    }
    // Never blank the front; a shop needs its street face.
    a.blank = a.blank.filter((s) => s !== a.front);
  }
  return lots;
}

export const LOTS: Lot[] = buildLots();

// ---------------------------------------------------------------------------
// Openings + stairs (shared by colliders and visuals)
// ---------------------------------------------------------------------------

/** Stair lanes against the long wall away from the front (enterable lots only). */
export function stairOf(l: Lot): Stair {
  const W = l.x1 - l.x0, D = l.z1 - l.z0;
  const axis: "x" | "z" = W >= D ? "x" : "z";
  const steps = Math.ceil(l.fh / 0.38);
  const rise = l.fh / steps;
  const run = steps * STEP_RUN;
  const width = 1.0;
  // Long walls: for axis x they are N/S (z0 / z1); pick the one that isn't the front.
  let lanes: [number, number];
  if (axis === "x") {
    const back = l.front === 0 ? 1 : -1; // +1: against z1 (south) wall
    const wallZ = back > 0 ? l.z1 - WALL_T : l.z0 + WALL_T;
    lanes = [wallZ - back * (width / 2), wallZ - back * (width * 1.5)];
  } else {
    const back = l.front === 3 ? 1 : -1; // +1: against x1 (east) wall
    const wallX = back > 0 ? l.x1 - WALL_T : l.x0 + WALL_T;
    lanes = [wallX - back * (width / 2), wallX - back * (width * 1.5)];
  }
  const lo = (axis === "x" ? l.x0 : l.z0) + WALL_T + 0.9;
  return { axis, lanes, a: lo, b: lo + run, width, steps, rise };
}

/** Is the stair against this side (no windows there)? */
function stairSide(l: Lot, st: Stair): Side {
  if (st.axis === "x") return l.front === 0 ? 2 : 0;
  return l.front === 3 ? 1 : 3;
}

export function doorsOf(l: Lot): Door[] {
  const L = sideLength(l, l.front);
  if (l.shop) return [{ side: l.front, u: L / 2, w: Math.min(3.2, L - 1.6), h: 2.5 }];
  if (!l.enter) return [{ side: l.front, u: L * (0.3 + (l.seed % 40) / 100), w: 1.0, h: 2.15 }];
  // Keep doors clear of the stair lanes on the short sides.
  const st = stairOf(l);
  const back = stairSide(l, st);
  const place = (s: Side) => {
    const len = sideLength(l, s);
    const short = st.axis === "x" ? s % 2 === 1 : s % 2 === 0;
    if (!short) return len / 2;
    // u runs counter-clockwise; the stair wall is at one end of the short side.
    return (s + 3) % 4 === back ? len - 1.5 : 1.5;
  };
  const doors: Door[] = [{ side: l.front, u: place(l.front), w: 1.7, h: 2.2 }];
  // A back door on the opposite side when it isn't a party wall (flanking routes).
  const opp = ((l.front + 2) % 4) as Side;
  if (!l.blank.includes(opp) && opp !== back) doors.push({ side: opp, u: place(opp), w: 1.6, h: 2.15 });
  return doors;
}

/** Window grid per floor (deterministic). */
export function windowsOf(l: Lot): Win[] {
  const out: Win[] = [];
  const r = rnd(l.seed);
  const doors = doorsOf(l);
  const stair = l.enter ? stairSide(l, stairOf(l)) : -1;
  for (const s of [0, 1, 2, 3] as Side[]) {
    if (l.blank.includes(s) || s === stair) continue;
    const L = sideLength(l, s);
    const cols = Math.max(1, Math.min(l.enter ? 2 : 3, Math.floor((L - 1.2) / 2.8)));
    for (let f = 0; f < l.floors; f++) {
      for (let c = 0; c < cols; c++) {
        const u = ((c + 0.5) * L) / cols + (r() - 0.5) * 0.4;
        if (u < 0.9 || u > L - 0.9) continue;
        if (f === 0 && doors.some((d) => d.side === s && Math.abs(d.u - u) < d.w / 2 + 0.8)) continue;
        if (f === 0 && l.shop && s === l.front) continue;
        if (!l.enter && r() < 0.15) continue;
        const w = r() < 0.25 ? 1.4 : 1.0;
        out.push({ side: s, u, y: f * l.fh + 1.0, w, h: 1.15 });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Colliders
// ---------------------------------------------------------------------------

const boxes: MapBox[] = [];
const B = (b: MapBox) => boxes.push(b);
const R = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, b: Omit<MapBox, "x" | "z" | "w" | "d" | "y" | "h">) => {
  if (x1 - x0 < 0.02 || z1 - z0 < 0.02 || y1 - y0 < 0.02) return;
  B({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, y: y0 || undefined, h: y1 - y0, ...b });
};
const hidden = (tag: string, surface: MapBox["surface"] = "concrete") => ({ color: 0xcfc8bc, style: "hidden" as const, surface, tag });

/** One wall band (u0..u1, y0..y1) split around openings into piers, sills and lintels. */
function wallBand(l: Lot, s: Side, u0: number, u1: number, y0: number, y1: number, ops: { u: number; y: number; w: number; h: number }[], tag: string) {
  const T = WALL_T;
  const list = ops.filter((o) => o.u + o.w / 2 > u0 && o.u - o.w / 2 < u1 && o.y < y1 && o.y + o.h > y0).sort((a, b) => a.u - b.u);
  const piece = (a: number, b: number, ya: number, yb: number) => {
    if (b - a < 0.05 || yb - ya < 0.05) return;
    const [ax, az] = facadePoint(l, s, a), [bx, bz] = facadePoint(l, s, b);
    const nx = s === 1 ? -T : s === 3 ? T : 0, nz = s === 0 ? T : s === 2 ? -T : 0;
    R(Math.min(ax, bx, ax + nx), Math.max(ax, bx, ax + nx), Math.min(az, bz, az + nz), Math.max(az, bz, az + nz), ya, yb, hidden(tag));
  };
  let at = u0;
  for (const o of list) {
    const a = Math.max(u0, o.u - o.w / 2), b = Math.min(u1, o.u + o.w / 2);
    piece(at, a, y0, y1);
    piece(a, b, y0, Math.max(y0, o.y));
    piece(a, b, Math.min(y1, o.y + o.h), y1);
    at = b;
  }
  piece(at, u1, y0, y1);
}

/** Interior slab at height y with a rectangular hole (x/z ranges) cut out. */
function slab(ix0: number, ix1: number, iz0: number, iz1: number, y: number, hole: [number, number, number, number] | null, tag: string) {
  const y0 = y - 0.2;
  if (!hole) return R(ix0, ix1, iz0, iz1, y0, y, hidden(tag));
  const [hx0, hx1, hz0, hz1] = [Math.max(ix0, hole[0]), Math.min(ix1, hole[1]), Math.max(iz0, hole[2]), Math.min(iz1, hole[3])];
  R(ix0, ix1, iz0, hz0, y0, y, hidden(tag));
  R(ix0, ix1, hz1, iz1, y0, y, hidden(tag));
  R(ix0, hx0, hz0, hz1, y0, y, hidden(tag));
  R(hx1, ix1, hz0, hz1, y0, y, hidden(tag));
}

/** Footprint of a lane's run on the slab, as [x0, x1, z0, z1]. */
export function laneRect(st: Stair, lane: 0 | 1, pad = 0): [number, number, number, number] {
  const c = st.lanes[lane], h = st.width / 2;
  return st.axis === "x" ? [st.a - pad, st.b + pad, c - h, c + h] : [c - h, c + h, st.a - pad, st.b + pad];
}

for (const l of LOTS) {
  const H = l.floors * l.fh;
  if (!l.enter) {
    R(l.x0, l.x1, l.z0, l.z1, 0, H, hidden("house"));
    continue;
  }
  const doors = doorsOf(l);
  const wins = windowsOf(l);
  const ops = [...doors.map((d) => ({ side: d.side, u: d.u, y: 0, w: d.w, h: d.h })), ...wins];
  const T = WALL_T;
  for (const s of [0, 1, 2, 3] as Side[]) {
    const L = sideLength(l, s);
    // N/S walls run the full length; E/W fit between them.
    const [u0, u1] = s % 2 === 0 ? [0, L] : [T, L - T];
    for (let f = 0; f < l.floors; f++) {
      wallBand(l, s, u0, u1, f * l.fh, (f + 1) * l.fh, ops.filter((o) => o.side === s), "wall");
    }
    // Roof parapet (laje roofs only get corner columns).
    if (!l.laje) wallBand(l, s, u0, u1, H, H + 1.0, [], "parapet");
  }
  const st = stairOf(l);
  const ix0 = l.x0 + T, ix1 = l.x1 - T, iz0 = l.z0 + T, iz1 = l.z1 - T;
  for (let f = 0; f < l.floors; f++) {
    const lane = (f % 2) as 0 | 1;
    const base = f * l.fh;
    const c = st.lanes[lane], h = st.width / 2;
    for (let i = 0; i < st.steps; i++) {
      // Lane A climbs a→b, lane B climbs b→a.
      const p = lane === 0 ? st.a + i * STEP_RUN : st.b - (i + 1) * STEP_RUN;
      const top = base + st.rise * (i + 1);
      if (st.axis === "x") R(p, p + STEP_RUN, c - h, c + h, base, top, hidden("stair"));
      else R(c - h, c + h, p, p + STEP_RUN, base, top, hidden("stair"));
    }
    // Slab above this flight: hole over the flight's lane.
    const y = (f + 1) * l.fh;
    slab(ix0, ix1, iz0, iz1, y, laneRect(st, lane), f + 1 === l.floors ? "roof" : "floor");
    // Guard rail along the hole's inner edge (leaves the top end open).
    const [hx0, hx1, hz0, hz1] = laneRect(st, lane);
    // Toward the other lane (the side a player could step off).
    const inward = (st.lanes[1] - st.lanes[0]) * (lane === 0 ? 1 : -1);
    if (st.axis === "x") {
      const zEdge = inward > 0 ? hz1 - 0.06 : hz0;
      const [ra, rb] = lane === 0 ? [hx0, hx1 - 1.0] : [hx0 + 1.0, hx1];
      R(ra, rb, zEdge, zEdge + 0.06, y, y + 1.0, hidden("rail", "metal"));
    } else {
      const xEdge = inward > 0 ? hx1 - 0.06 : hx0;
      const [ra, rb] = lane === 0 ? [hz0, hz1 - 1.0] : [hz0 + 1.0, hz1];
      R(xEdge, xEdge + 0.06, ra, rb, y, y + 1.0, hidden("rail", "metal"));
    }
  }
  if (l.laje) {
    for (const [cx, cz] of [[l.x0, l.z0], [l.x1 - 0.3, l.z0], [l.x0, l.z1 - 0.3], [l.x1 - 0.3, l.z1 - 0.3]]) R(cx, cx + 0.3, cz, cz + 0.3, H, H + 2.4, hidden("column"));
  }
}

// ---- Futsal court: mural walls on the alley sides, fence posts on the street sides --------
{
  const c = COURT, T = 0.3, H = 3.2;
  // North side (cross street): low wall + fence (fence drawn by the dressing), gate gap in the middle.
  const mid = (c.x0 + c.x1) / 2;
  R(c.x0, mid - 1.4, c.z0, c.z0 + T, 0, 1.0, hidden("courtlow"));
  R(mid + 1.4, c.x1, c.z0, c.z0 + T, 0, 1.0, hidden("courtlow"));
  // West side (main road): low wall, gap near the south.
  R(c.x0, c.x0 + T, c.z0 + T, c.z1 - 4, 0, 1.0, hidden("courtlow"));
  // East and south: tall mural walls with a gap.
  R(c.x1 - T, c.x1, c.z0 + T, c.z1 - 6, 0, H, hidden("courtwall"));
  R(c.x1 - T, c.x1, c.z1 - 3.6, c.z1, 0, H, hidden("courtwall"));
  R(c.x0 + 3, c.x1 - T, c.z1 - T, c.z1, 0, H, hidden("courtwall"));
  // Goals (posts + crossbar) at the north and south ends of the pitch.
  for (const gz of [c.z0 + 2.2, c.z1 - 2.2]) {
    for (const gx of [mid - 1.5, mid + 1.4]) R(gx, gx + 0.1, gz - 0.05, gz + 0.05, 0, 2.0, hidden("goal", "metal"));
  }
  // Benches.
  R(c.x1 - 1.2, c.x1 - 0.7, c.z0 + 4, c.z0 + 7, 0, 0.45, hidden("bench", "wood"));
}

// ---- Plaza: bus shelter, kiosk, burnt sedan, planters -------------------------------------
export const SHELTER = { x: -9.5, z: -8.4 };
R(SHELTER.x - 2, SHELTER.x + 2, SHELTER.z - 0.95, SHELTER.z - 0.75, 0, 2.5, hidden("shelter", "metal"));
R(SHELTER.x - 1.6, SHELTER.x + 1.6, SHELTER.z - 0.6, SHELTER.z - 0.2, 0, 0.45, hidden("bench", "wood"));
export const KIOSK = { x: 9.6, z: -8.2 };
R(KIOSK.x - 1.3, KIOSK.x + 1.3, KIOSK.z - 1.1, KIOSK.z + 1.1, 0, 2.6, hidden("kiosk", "metal"));
export const WRECKS: { x: number; z: number; yaw: number; kind: "sedan" | "pickup" }[] = [
  { x: 2.6, z: -6.5, yaw: 0.35, kind: "sedan" },
  { x: -2.4, z: 26, yaw: -0.1, kind: "sedan" },
  { x: 2.8, z: -44, yaw: 3.0, kind: "pickup" },
  { x: -38, z: 1.8, yaw: 1.5, kind: "sedan" },
  { x: 46, z: -2.0, yaw: -1.62, kind: "pickup" },
  { x: -2.6, z: 66, yaw: 0.08, kind: "pickup" },
];
for (const w of WRECKS) {
  const along = Math.abs(Math.sin(w.yaw)) > 0.7; // long axis on x
  const [hw, hd] = along ? [2.3, 1.0] : [1.0, 2.3];
  R(w.x - hw, w.x + hw, w.z - hd, w.z + hd, 0, 1.45, hidden("wreck", "metal"));
}
for (const [x, z] of [[-11, 6], [11, 6.5], [-4, 9.5]] as const) R(x - 0.8, x + 0.8, z - 0.8, z + 0.8, 0, 0.6, hidden("planter"));
// Plaza trees (trunks; canopies drawn by the dressing).
export const TREES: [number, number][] = [[-11, 6], [11, 6.5]];

// ---- Street cover: concrete barriers, oil drums, crates, a sandbag post ---------------------
for (const [x, z, w, d] of [[-2.2, -20, 3.0, 0.7], [2.4, 18, 3.0, 0.7], [-22, -1.6, 0.7, 3.0], [24, 1.2, 0.7, 3.0], [1.6, 40, 3.0, 0.7], [-1.8, -62, 3.0, 0.7], [-48, -2, 0.7, 3.0], [64, 2, 0.7, 3.0]] as const) {
  B({ x, z, w, h: 1.05, d, color: 0xc8c4ba, surface: "concrete", style: "barrier", tag: "barrier" });
}
for (const [x, z] of [[-4.2, -27], [3.6, 35], [-29.6, 2.9], [33.4, -3.4], [-3.8, 52], [4.2, -52], [-62, 3], [61.6, -3]] as const) {
  B({ x, z, w: 1.2, h: 1.0, d: 1.2, color: 0xb8a888, surface: "wood", style: "crate", tag: "crate" });
}
B({ x: 0, z: -14.6, w: 3.4, h: 1.05, d: 0.9, color: 0xc4b48e, surface: "sand", style: "sandbags", tag: "nest" });
B({ x: -1.7, z: -13.4, w: 0.9, h: 1.05, d: 1.5, color: 0xc4b48e, surface: "sand", style: "sandbags", tag: "nest" });

// ---- Power poles along the main road and the cross street (the dressing strings the wires) --
export const POLES: [number, number, number][] = [];
for (let z = -80; z <= 80; z += 16) if (Math.abs(z) > 10) POLES.push([z % 32 === 0 ? -4.6 : 4.6, z + 0.5, 0]);
for (let x = -80; x <= 80; x += 16) if (Math.abs(x) > 14) POLES.push([x + 0.5, x % 32 === 0 ? 4.1 : -4.1, Math.PI / 2]);
for (const [x, z, rotY] of POLES) B({ x, z, w: 0.32, h: 3, d: 0.32, color: 0xa89a84, surface: "wood", style: "pole", tag: "pole", rotY });

// ---- Boundary: a collider ring just outside the playable area -------------------------------
for (const s of [-1, 1]) {
  R(-BOUND - 1, BOUND + 1, s > 0 ? BOUND : -BOUND - 1, s > 0 ? BOUND + 1 : -BOUND, 0, 8, hidden("bound", "concrete"));
  R(s > 0 ? BOUND : -BOUND - 1, s > 0 ? BOUND + 1 : -BOUND, -BOUND, BOUND, 0, 8, hidden("bound", "concrete"));
}

// ---- Buy stations + ammo crates -------------------------------------------------------------
const GREEN_SCREEN = 0x2bd36a;
const AMBER = 0xffa73a;
const STEEL = 0xa4a6a8;
const stations = [
  { x: -7.2, z: -10.6, name: "Plaza Armory" },
  { x: 12.4, z: 3.8, name: "Court Armory" },
  { x: -3.6, z: 44, name: "South Armory" },
];
for (const s of stations) {
  B({ x: s.x, z: s.z, w: 1.4, h: 1.3, d: 0.9, color: STEEL, surface: "metal", mat: "metal_dark", tag: "station" });
  B({ x: s.x, z: s.z, w: 1.0, h: 0.5, d: 0.08, y: 1.35, color: 0x0c1a10, emissive: GREEN_SCREEN, decor: true });
  B({ x: s.x, z: s.z, w: 0.08, h: 2.6, d: 0.08, y: 0, color: STEEL, mat: "metal_dark", decor: true });
  B({ x: s.x, z: s.z, w: 0.3, h: 0.12, d: 0.3, y: 2.6, color: 0x111111, emissive: GREEN_SCREEN, decor: true });
}
const crates = [
  { x: 6.4, z: 9.6 },
  { x: -9.2, z: 2.6 },
  { x: 3.2, z: -32.4 },
  { x: -33.2, z: -2.6 },
  { x: 33.4, z: 2.6 },
  { x: -3.4, z: 34.2 },
];
for (const c of crates) {
  B({ x: c.x, z: c.z, w: 1.4, h: 0.7, d: 0.9, color: 0x9a9a6c, surface: "metal", tag: "ammo" });
  B({ x: c.x, z: c.z, w: 1.2, h: 0.06, d: 0.2, y: 0.7, color: 0x111111, emissive: AMBER, decor: true });
}

// ---- Sniper perches: tall solid roofs out toward the edges ---------------------------------
function perches() {
  const tall = LOTS.filter((l) => !l.enter && l.floors >= 3 && Math.hypot((l.x0 + l.x1) / 2, (l.z0 + l.z1) / 2) > 45);
  const picks: { x: number; y: number; z: number }[] = [];
  // One per compass sector so snipers come from every side.
  for (let k = 0; k < 6; k++) {
    const a0 = (k / 6) * Math.PI * 2 - Math.PI;
    const a1 = a0 + Math.PI / 3;
    const l = tall
      .filter((t) => {
        const a = Math.atan2((t.z0 + t.z1) / 2, (t.x0 + t.x1) / 2);
        return a >= a0 && a < a1;
      })
      .sort((p, q) => q.floors - p.floors)[0];
    if (l) picks.push({ x: (l.x0 + l.x1) / 2, y: l.floors * l.fh, z: (l.z0 + l.z1) / 2 });
  }
  return picks;
}

// ---- Enemy spawns: the street and alley mouths at the edge --------------------------------
const E = HALF - 2;
const enemySpawns = [
  { x: 0, z: -E }, { x: 0, z: E }, { x: -E, z: 0 }, { x: E, z: 0 },
  { x: -31, z: -E }, { x: 31, z: -E }, { x: -31, z: E }, { x: 31, z: E },
  { x: -E, z: -30 }, { x: -E, z: 30 }, { x: E, z: -30 }, { x: E, z: 30 },
  { x: -60, z: -E }, { x: 60, z: E }, { x: -E, z: 59 }, { x: E, z: -59 },
];

/** Shop-sign texts (all invented). */
export const SHOP_SIGNS = ["MERCADINHO SOL", "BAR DO TIÃO", "AÇAÍ & CIA", "CONSERTOS", "SALÃO DA NEIDE", "LANCHES 24H", "MATERIAL DE OBRA", "FARMÁCIA", "OFICINA", "PADARIA ESTRELA"];

export const MORRO_AZUL: MapDef = {
  id: "morro-azul",
  name: "Morro Azul",
  size: 180,
  groundColor: 0x8a8070,
  skyTop: 0x5c8ed0,
  skyHorizon: 0xcfdbe4,
  fogNear: 120,
  fogFar: 520,
  sunDirection: [0.5, 0.7, 0.35],
  sunColor: 0xfff0d8,
  sunIntensity: 2.9,
  hemiSky: 0xc8daf0,
  hemiGround: 0x7a6a52,
  atmosphere: {
    fogDensity: 0.0024,
    fogColor: 0xc9d6e0,
    skyGround: 0x6a6450,
    hemiIntensity: 0.75,
    cloudCover: 0.35,
    envIntensity: 0.5,
    exposure: 1.02,
  },
  dressing: "morroAzul",
  spawns: [{ x: 0, z: 3, yaw: 0 }],
  boxes,
  targets: [],
  plates: [],
  signs: stations.map((s) => ({ x: s.x, y: 2.2, z: s.z + 0.5, text: "ARMORY [F]" })),
  survival: {
    enemySpawns,
    perches: perches(),
    buyStations: stations,
    ammoCrates: crates,
    inner: 40,
  },
};
