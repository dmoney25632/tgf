import type { MapBox, MapDef } from "../MapLoader";

/**
 * Brennhollow — an original, shelled hillside village in a green valley,
 * for Survival. Players hold the cobbled square (a bronze stonemason on a
 * granite plinth, a knocked-out tank and a dusty pickup); the whitewashed
 * hall with red shutters on its west side is enterable with an upper floor
 * overlooking the square. North stands the church with an onion-domed
 * tower; north-east the shelled manor burns inside its walled garden behind
 * an arched gateway. Lanes lead out between stone houses, gardens, a barn
 * and orchards to the edges, where enemies push in. A grassy bank with
 * hedgerows bounds the village; hills, forest and mountains rise beyond.
 *
 * x = east, z = south, y = up; box = centre + size. Houses are data
 * (HOUSES) shared with the dressing: enterable ones get per-wall colliders
 * split around their doors and windows, the rest one solid box plus a
 * stepped roof mass. Visuals are drawn by dressing/brennhollow*.ts.
 */

const STONE = 0xcfc8bc;
const WOOD = 0xc8b49a;
const STEEL = 0xa4a6a8;
const SANDBAG = 0xc4b48e;
const GREEN_SCREEN = 0x2bd36a;
const AMBER = 0xffa73a;

export type Side = 0 | 1 | 2 | 3; // N, E, S, W (facade frames: u runs counter-clockwise from the corner)
export type HouseOpening = { side: Side; u: number; y: number; w: number; h: number; arch?: boolean; kind: "door" | "win" | "hole" | "arch" };
export type WallKind = "stone" | "plaster" | "white" | "ochre";

export type HouseDef = {
  id: string;
  x0: number; x1: number; z0: number; z1: number;
  floors: number;
  fh: number;
  wall: WallKind;
  tint: number;
  shutter: number;
  /** Ridge axis, roof pitch (rad); null = roofless ruin. */
  roof: { axis: "x" | "z"; pitch: number; hip?: boolean } | null;
  /** Interior is walkable (per-wall colliders). */
  enter?: boolean;
  /** Stair to the upper floor (enter only): bottom-step x/z, run direction, width. */
  stair?: { x: number; z: number; dir: "+x" | "-x" | "+z" | "-z"; width: number };
  doors: { side: Side; u: number; w: number; h?: number; arch?: boolean }[];
  /** Facades with no windows (party walls / backs). */
  blank?: Side[];
  damage: number;
  ruin?: boolean;
  chimneys?: [number, number][];
};

export const WALL_T = 0.45;

export const HOUSES: HouseDef[] = [
  // The hall: whitewashed, red shutters, faces the square (east). Enterable, upper floor.
  {
    id: "hall", x0: -25, x1: -13, z0: -12, z1: -3, floors: 2, fh: 3.3, wall: "white", tint: 0xf0ece2, shutter: 0xa8322a,
    roof: { axis: "x", pitch: 0.72 }, enter: true, stair: { x: -16.9, z: -11.0, dir: "-x", width: 1.1 },
    doors: [{ side: 1, u: 4.5, w: 2.0, h: 2.6 }, { side: 2, u: 8.5, w: 1.6 }, { side: 3, u: 3.0, w: 1.6 }],
    damage: 0.35, chimneys: [[-23.4, -7.5], [-14.8, -5.2]],
  },
  { id: "nw1", x0: -24, x1: -16, z0: -26, z1: -17, floors: 2, fh: 3.0, wall: "plaster", tint: 0xd8c9a8, shutter: 0x5f6e52, roof: { axis: "z", pitch: 0.8 }, doors: [{ side: 2, u: 4, w: 1.2 }], damage: 0.4, chimneys: [[-20, -24.5]] },
  {
    id: "nw2", x0: -35, x1: -28, z0: -24, z1: -15, floors: 2, fh: 3.0, wall: "stone", tint: 0xc4baa8, shutter: 0x6a5a48,
    roof: null, ruin: true, enter: true, doors: [{ side: 2, u: 3.5, w: 1.8 }, { side: 1, u: 4.5, w: 1.6 }, { side: 0, u: 2.5, w: 1.6 }], damage: 1,
  },
  { id: "nw3", x0: -45, x1: -38, z0: -33, z1: -24, floors: 1, fh: 4.2, wall: "stone", tint: 0xb8ae9c, shutter: 0x6a5a48, roof: { axis: "z", pitch: 0.75 }, doors: [{ side: 1, u: 4.5, w: 2.6, h: 3.0 }], damage: 0.3 },
  // Church nave (tower handled separately). Enterable.
  {
    id: "church", x0: -6, x1: 6, z0: -34, z1: -18.6, floors: 1, fh: 8, wall: "white", tint: 0xe8e2d4, shutter: 0x4a3a2a,
    roof: { axis: "z", pitch: 0.85 }, enter: true, doors: [{ side: 1, u: 10, w: 1.8, h: 2.7 }], damage: 0.25,
  },
  // Shelled manor (front hall + blown corner handled separately).
  { id: "manor", x0: 19, x1: 31, z0: -36, z1: -25, floors: 3, fh: 3.4, wall: "ochre", tint: 0xd8b888, shutter: 0x3f5a48, roof: { axis: "x", pitch: 0.95, hip: true }, doors: [{ side: 2, u: 6.5, w: 2.0, h: 2.8, arch: true }], damage: 0.85, chimneys: [[28.5, -31], [21, -33]] },
  { id: "e1", x0: 15, x1: 23, z0: -14, z1: -6, floors: 2, fh: 3.0, wall: "plaster", tint: 0xe2d6bc, shutter: 0x6e4a32, roof: { axis: "x", pitch: 0.75 }, doors: [{ side: 2, u: 3, w: 1.2 }], damage: 0.5, chimneys: [[17, -10]] },
  { id: "e2", x0: 26, x1: 34, z0: -15, z1: -7, floors: 2, fh: 3.0, wall: "stone", tint: 0xc8bfae, shutter: 0x4c6278, roof: { axis: "z", pitch: 0.8 }, doors: [{ side: 2, u: 4, w: 1.2 }], damage: 0.7, chimneys: [[30, -13.5]] },
  { id: "e3", x0: 38, x1: 45, z0: -15, z1: -8, floors: 1, fh: 3.6, wall: "plaster", tint: 0xc8bca4, shutter: 0x5a5a50, roof: { axis: "x", pitch: 0.6 }, doors: [{ side: 2, u: 3.5, w: 2.4, h: 2.6 }], damage: 0.4 },
  { id: "se1", x0: 15, x1: 24, z0: 5, z1: 13, floors: 2, fh: 3.0, wall: "ochre", tint: 0xe0c89a, shutter: 0x2f5a3a, roof: { axis: "x", pitch: 0.78 }, doors: [{ side: 0, u: 4.5, w: 1.2 }], damage: 0.45, chimneys: [[22.5, 9]] },
  // Barn: stone base, timber gables. Enterable with a hayloft (sniper perch).
  {
    id: "barn", x0: 30, x1: 42, z0: 7, z1: 19, floors: 1, fh: 5.2, wall: "stone", tint: 0xbab09e, shutter: 0x5a4430,
    roof: { axis: "z", pitch: 0.82 }, enter: true, doors: [{ side: 0, u: 6, w: 3.6, h: 3.6 }, { side: 3, u: 6, w: 2.4, h: 2.8 }], blank: [1], damage: 0.3,
  },
  { id: "s1", x0: -13, x1: -4, z0: 13, z1: 21, floors: 2, fh: 3.0, wall: "plaster", tint: 0xe6dcc4, shutter: 0x4c6a7a, roof: { axis: "x", pitch: 0.8 }, doors: [{ side: 0, u: 4.5, w: 1.3 }], damage: 0.35, chimneys: [[-11, 17]] },
  { id: "s2", x0: 5, x1: 12.5, z0: 13, z1: 22, floors: 2, fh: 3.0, wall: "stone", tint: 0xd0c6b4, shutter: 0x7a3a2a, roof: { axis: "z", pitch: 0.82 }, doors: [{ side: 0, u: 3.5, w: 1.3 }], damage: 0.55, chimneys: [[9, 20.5]] },
  { id: "s3", x0: -12, x1: -4, z0: 26, z1: 34, floors: 2, fh: 3.0, wall: "ochre", tint: 0xd6b890, shutter: 0x5a6e4a, roof: { axis: "z", pitch: 0.8 }, doors: [{ side: 1, u: 4, w: 1.2 }], damage: 0.6, chimneys: [[-8, 32.5]] },
  // Ruin with a slab left at the first floor (sniper perch; the ground floor is filled with rubble).
  { id: "s4", x0: 5, x1: 12, z0: 27, z1: 35, floors: 2, fh: 3.0, wall: "plaster", tint: 0xd2c6b0, shutter: 0x6a6a5a, roof: null, ruin: true, doors: [], damage: 1 },
  { id: "sw1", x0: -26, x1: -16, z0: 8, z1: 16, floors: 2, fh: 3.1, wall: "plaster", tint: 0xc9cdb8, shutter: 0x6e3a2a, roof: { axis: "x", pitch: 0.75 }, doors: [{ side: 0, u: 5, w: 1.3 }], damage: 0.5, chimneys: [[-24, 12]] },
  { id: "sw2", x0: -38, x1: -30, z0: 8, z1: 15, floors: 2, fh: 2.9, wall: "stone", tint: 0xc0b6a4, shutter: 0x5a6e7a, roof: { axis: "z", pitch: 0.85 }, doors: [{ side: 0, u: 4, w: 1.2 }], damage: 0.8 },
  { id: "sw3", x0: -24, x1: -16, z0: 24, z1: 32, floors: 1, fh: 3.4, wall: "white", tint: 0xece6d8, shutter: 0x3a5a7a, roof: { axis: "x", pitch: 0.7 }, doors: [{ side: 1, u: 4, w: 1.2 }], damage: 0.3, chimneys: [[-18, 28]] },
];

export const houseById = (id: string) => HOUSES.find((h) => h.id === id)!;
export const sideLength = (h: HouseDef, s: Side) => (s % 2 === 0 ? h.x1 - h.x0 : h.z1 - h.z0);

/** World (x, z) of a point u along a facade (u runs as in Building.facades). */
export function facadePoint(h: { x0: number; x1: number; z0: number; z1: number }, s: Side, u: number): [number, number] {
  return s === 0 ? [h.x0 + u, h.z0] : s === 1 ? [h.x1, h.z0 + u] : s === 2 ? [h.x1 - u, h.z1] : [h.x0, h.z1 - u];
}

function rnd(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Doors + a regular window grid per facade (deterministic; shared by colliders and visuals). */
export function houseOpenings(h: HouseDef): HouseOpening[] {
  const out: HouseOpening[] = [];
  const r = rnd(h.id.split("").reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  for (const d of h.doors) out.push({ side: d.side, u: d.u, y: 0, w: d.w, h: d.h ?? 2.25, arch: d.arch, kind: "door" });
  if (h.id === "church") {
    for (const s of [1, 3] as Side[]) for (let i = 0; i < 4; i++) {
      const u = 2.4 + i * 3.4;
      if (s === 1 && Math.abs(u - 10) < 1.8) continue;
      out.push({ side: s, u, y: 3.0, w: 1.3, h: 2.6, arch: true, kind: "win" });
    }
    return out;
  }
  if (h.id === "barn") {
    for (const s of [0, 2] as Side[]) out.push({ side: s, u: 9.8, y: 3.4, w: 1.2, h: 1.0, kind: "win" });
    out.push({ side: 3, u: 2.4, y: 1.3, w: 0.8, h: 0.8, kind: "win" }, { side: 3, u: 9.6, y: 1.3, w: 0.8, h: 0.8, kind: "win" });
    return out;
  }
  for (const s of [0, 1, 2, 3] as Side[]) {
    if (h.blank?.includes(s)) continue;
    const L = sideLength(h, s);
    const cols = Math.max(1, Math.floor((L - 0.8) / 2.6));
    const step = L / cols;
    for (let fl = 0; fl < h.floors; fl++) {
      for (let c = 0; c < cols; c++) {
        const u = (c + 0.5) * step;
        if (u < 1.0 || u > L - 1.0) continue;
        const clash = h.doors.some((d) => d.side === s && Math.abs(d.u - u) < d.w / 2 + 0.9);
        if (fl === 0 && clash) continue;
        if (fl === 0 && r() < 0.15) continue;
        const y = fl === 0 ? 0.95 : fl * h.fh + 0.8;
        out.push({ side: s, u, y, w: 1.0, h: Math.min(1.4, h.fh - 1.25), kind: "win" });
      }
    }
  }
  return out;
}

const boxes: MapBox[] = [];
const B = (b: MapBox) => boxes.push(b);
/** Box from min/max corners. */
const R = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, b: Omit<MapBox, "x" | "z" | "w" | "d" | "y" | "h">) => {
  if (x1 - x0 < 0.02 || z1 - z0 < 0.02 || y1 - y0 < 0.02) return;
  B({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, y: y0 || undefined, h: y1 - y0, ...b });
};

const hidden = (tag: string, surface: MapBox["surface"] = "concrete") => ({ color: STONE, style: "hidden" as const, surface, tag });

/**
 * Collider pieces of one wall band (u0..u1 along a facade, y0..y1) split
 * around the openings: piers full height, sills under and lintels over.
 */
function wallColliders(h: HouseDef, s: Side, u0: number, u1: number, y0: number, y1: number, openings: HouseOpening[], tag: string, T = WALL_T) {
  const ops = openings.filter((o) => o.side === s && o.u + o.w / 2 > u0 && o.u - o.w / 2 < u1 && o.y < y1 && o.y + o.h > y0).sort((a, b) => a.u - b.u);
  const piece = (a: number, b: number, ya: number, yb: number) => {
    if (b - a < 0.05 || yb - ya < 0.05) return;
    const [ax, az] = facadePoint(h, s, a), [bx, bz] = facadePoint(h, s, b);
    // Thickness goes into the house.
    const nx = s === 1 ? -T : s === 3 ? T : 0, nz = s === 0 ? T : s === 2 ? -T : 0;
    R(Math.min(ax, bx, ax + nx), Math.max(ax, bx, ax + nx), Math.min(az, bz, az + nz), Math.max(az, bz, az + nz), ya, yb, hidden(tag));
  };
  // Group openings stacked in one column (ground + upper windows), then fill around them.
  const cols: { a: number; b: number; gaps: [number, number][] }[] = [];
  for (const o of ops) {
    const a = Math.max(u0, o.u - o.w / 2), b = Math.min(u1, o.u + o.w / 2);
    const gap: [number, number] = [Math.max(y0, o.y), Math.min(y1, o.y + o.h + (o.arch ? o.w / 2 : 0))];
    const c = cols.find((k) => a < k.b && b > k.a);
    if (c) {
      c.a = Math.min(c.a, a);
      c.b = Math.max(c.b, b);
      c.gaps.push(gap);
    } else cols.push({ a, b, gaps: [gap] });
  }
  cols.sort((p, q) => p.a - q.a);
  let at = u0;
  for (const c of cols) {
    piece(at, c.a, y0, y1);
    let y = y0;
    for (const [ga, gb] of c.gaps.sort((p, q) => p[0] - q[0])) {
      if (ga > y) piece(c.a, c.b, y, ga);
      y = Math.max(y, gb);
    }
    piece(c.a, c.b, y, y1);
    at = c.b;
  }
  piece(at, u1, y0, y1);
}

/** Stepped roof mass above a solid wall top (approximates the pitched roof for bullets / LOS). */
function roofMass(h: HouseDef, top: number) {
  if (!h.roof) return;
  const along = h.roof.axis;
  const span = along === "x" ? h.z1 - h.z0 : h.x1 - h.x0;
  const rise = (span / 2) * Math.tan(h.roof.pitch);
  const cx = (h.x0 + h.x1) / 2, cz = (h.z0 + h.z1) / 2;
  const tier = (y0: number, y1: number, half: number) => {
    if (along === "x") R(h.x0 + 0.3, h.x1 - 0.3, cz - half, cz + half, y0, y1, hidden("roofmass", "wood"));
    else R(cx - half, cx + half, h.z0 + 0.3, h.z1 - 0.3, y0, y1, hidden("roofmass", "wood"));
  };
  tier(top, top + rise * 0.5, (span / 2) * 0.72);
  tier(top + rise * 0.5, top + rise * 0.85, (span / 2) * 0.3);
}

// ---- Houses ---------------------------------------------------------------------
for (const h of HOUSES) {
  const ops = houseOpenings(h);
  const H = h.floors * h.fh;
  const T = h.id === "church" ? 0.6 : WALL_T;
  if (h.id === "manor") {
    // Rear block solid; front hall enterable on the ground floor; SW corner blown open above it.
    const zf = -29;
    R(h.x0, h.x1, h.z0, zf, 0, H, hidden("house"));
    wallColliders(h, 2, 0, h.x1 - h.x0, 0, h.fh, ops, "manorwall");
    const wops: HouseOpening[] = [{ side: 3, u: 2.2, y: 0, w: 2.0, h: 2.2, kind: "hole" }];
    // West and east walls of the front hall (frame u from z1 / z0).
    wallColliders(h, 3, T, h.z1 - zf, 0, h.fh, wops, "manorwall");
    wallColliders(h, 1, zf - h.z0, h.z1 - h.z0 - T, 0, h.fh, [], "manorwall");
    R(h.x0, h.x1, zf, h.z1, h.fh, h.fh + 0.2, hidden("roof"));
    R(24, h.x1, zf, h.z1, h.fh + 0.2, H, hidden("house"));
    // Broken wall stubs round the open corner (sniper cover).
    R(h.x0, 24, h.z1 - T, h.z1, h.fh + 0.2, h.fh + 1.0, hidden("stub"));
    R(h.x0, h.x0 + T, zf, h.z1 - T, h.fh + 0.2, h.fh + 1.6, hidden("stub"));
    roofMass({ ...h, z1: zf }, H);
    continue;
  }
  if (h.id === "s4") {
    // Rubble-filled ground floor, first-floor slab, broken walls on three sides above.
    R(h.x0, h.x1, h.z0, h.z1, 0, h.fh, hidden("house"));
    const up: HouseOpening[] = [{ side: 2, u: 2.0, y: 3.8, w: 1.0, h: 1.2, kind: "win" }, { side: 2, u: 5.2, y: 3.8, w: 1.0, h: 1.2, kind: "win" }];
    wallColliders(h, 2, 0, h.x1 - h.x0, h.fh, h.fh + 2.6, up, "ruinwall");
    wallColliders(h, 1, T, h.z1 - h.z0 - T, h.fh, h.fh + 1.8, [], "ruinwall");
    wallColliders(h, 3, T, h.z1 - h.z0 - T, h.fh, h.fh + 1.2, [], "ruinwall");
    continue;
  }
  if (!h.enter) {
    R(h.x0, h.x1, h.z0, h.z1, 0, H, hidden("house"));
    roofMass(h, H);
    continue;
  }
  const Wn = h.x1 - h.x0, Dn = h.z1 - h.z0;
  const wallTop = h.ruin ? h.fh + 1.6 : H;
  if (h.id === "church") {
    // South wall: west and east of the tower full height; under the tower a wall with the arch to the nave.
    R(h.x0, -2.6, h.z1 - T, h.z1, 0, H, hidden("churchwall"));
    R(2.6, h.x1, h.z1 - T, h.z1, 0, H, hidden("churchwall"));
    R(-2.6, -1.0, h.z1 - T, h.z1, 0, 4, hidden("churchwall"));
    R(1.0, 2.6, h.z1 - T, h.z1, 0, 4, hidden("churchwall"));
    R(-1.0, 1.0, h.z1 - T, h.z1, 3.6, 4, hidden("churchwall"));
    R(-2.6, 2.6, h.z1 - T, h.z1, 4, H, hidden("churchwall"));
  } else wallColliders(h, 2, 0, Wn, 0, wallTop, ops, "wall", T);
  wallColliders(h, 0, 0, Wn, 0, wallTop, ops, "wall", T);
  wallColliders(h, 1, T, Dn - T, 0, wallTop, ops, "wall", T);
  wallColliders(h, 3, T, Dn - T, 0, wallTop, ops, "wall", T);
  if (h.ruin) continue;
  R(h.x0, h.x1, h.z0, h.z1, H, H + 0.3, hidden("roof"));
  roofMass(h, H + 0.3);
  // Upper floor with a stairwell.
  if (h.stair && h.floors > 1) {
    const st = h.stair;
    const n = Math.ceil(h.fh / 0.38);
    const rise = h.fh / n, run = 0.42;
    const sgn = st.dir[0] === "-" ? -1 : 1;
    const alongX = st.dir[1] === "x";
    for (let i = 0; i < n; i++) {
      const a = (alongX ? st.x : st.z) + sgn * run * i, b = a + sgn * run;
      const lo = Math.min(a, b), hi = Math.max(a, b);
      if (alongX) R(lo, hi, st.z - st.width / 2, st.z + st.width / 2, 0, rise * (i + 1), hidden("stair", "wood"));
      else R(st.x - st.width / 2, st.x + st.width / 2, lo, hi, 0, rise * (i + 1), hidden("stair", "wood"));
    }
    // Slab = interior minus the hole over the run (+ 0.4 m at the bottom end).
    const ix0 = h.x0 + T, ix1 = h.x1 - T, iz0 = h.z0 + T, iz1 = h.z1 - T;
    const endA = (alongX ? st.x : st.z) - sgn * 0.4, endB = (alongX ? st.x : st.z) + sgn * run * n;
    const hx0 = alongX ? Math.min(endA, endB) : st.x - st.width / 2, hx1 = alongX ? Math.max(endA, endB) : st.x + st.width / 2;
    const hz0 = alongX ? st.z - st.width / 2 : Math.min(endA, endB), hz1 = alongX ? st.z + st.width / 2 : Math.max(endA, endB);
    const y0 = h.fh - 0.2, y1 = h.fh;
    R(ix0, ix1, iz0, Math.max(iz0, hz0), y0, y1, hidden("floor", "wood"));
    R(ix0, ix1, Math.min(iz1, hz1), iz1, y0, y1, hidden("floor", "wood"));
    R(ix0, Math.max(ix0, hx0), hz0, hz1, y0, y1, hidden("floor", "wood"));
    R(Math.min(ix1, hx1), ix1, hz0, hz1, y0, y1, hidden("floor", "wood"));
    // Banister along the open side of the stairwell.
    const bz = hz0 > iz0 + 0.1 ? hz0 : hz1;
    if (alongX) R(hx0 + 0.6, hx1, bz - 0.04, bz + 0.04, y1, y1 + 1.0, hidden("banister", "wood"));
  }
}

// ---- Church tower: hollow porch, solid shaft, open belfry -------------------------
export const TOWER = { x0: -2.6, x1: 2.6, z0: -18.6, z1: -13.4, porch: 4, shaft: 12, belfry: 15.6 };
{
  const t = TOWER, T = 0.6;
  R(t.x0, -1.0, t.z1 - T, t.z1, 0, t.porch, hidden("tower"));
  R(1.0, t.x1, t.z1 - T, t.z1, 0, t.porch, hidden("tower"));
  R(-1.0, 1.0, t.z1 - T, t.z1, 3.6, t.porch, hidden("tower"));
  R(t.x0, t.x0 + T, t.z0, t.z1 - T, 0, t.porch, hidden("tower"));
  R(t.x1 - T, t.x1, t.z0, t.z1 - T, 0, t.porch, hidden("tower"));
  R(t.x0, t.x1, t.z0, t.z1, t.porch, t.shaft, hidden("roof"));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const cx = sx * 2.1, cz = (t.z0 + t.z1) / 2 + sz * 2.1;
    R(cx - 0.5, cx + 0.5, cz - 0.5, cz + 0.5, t.shaft, t.belfry, hidden("belfry"));
  }
  R(t.x0, t.x1, t.z0, t.z1, t.belfry, t.belfry + 0.5, hidden("belfry"));
}

// ---- Church interior: pews, chancel step, altar -------------------------------------
for (let i = 0; i < 7; i++) {
  const z = -21.2 - i * 1.25;
  for (const sx of [-1, 1]) {
    const broken = (i * 7 + sx * 3) % 5 === 0;
    const x = sx * 2.6 + (broken ? sx * 0.25 : 0);
    B({ x, z: z + (broken ? 0.2 : 0), w: 3.2, h: 0.9, d: 0.55, color: WOOD, surface: "wood", style: "hidden", tag: "pew", rotY: broken ? 0.18 * sx : 0 });
  }
}
R(-5.4, 5.4, -33.4, -30.6, 0, 0.3, hidden("chancel"));
R(-1.2, 1.2, -32.6, -31.6, 0.3, 1.25, hidden("altar"));

// ---- Barn hayloft (sniper perch) ------------------------------------------------------
R(30.45, 41.55, 15.2, 18.55, 3.4, 3.6, hidden("loft", "wood"));
for (const x of [33, 36, 39]) R(x - 0.15, x + 0.15, 15.05, 15.35, 0, 3.4, hidden("loftpost", "wood"));
R(30.45, 41.55, 15.2, 15.3, 3.6, 4.4, hidden("loftrail", "wood"));

// ---- Manor yard: stone walls, arched gateway, breach ---------------------------------
export const MANOR_YARD = { x0: 14, x1: 37, z0: -43.6, z1: -18, gate: [23.0, 26.4] as [number, number], breach: [-33, -29] as [number, number], door: [-32, -30.2] as [number, number] };
{
  const m = MANOR_YARD, T = 0.6, H = 2.6;
  const yw = (x0: number, x1: number, z0: number, z1: number, h = H) => R(x0, x1, z0, z1, 0, h, hidden("yardwall"));
  yw(m.x0, m.gate[0] - 0.5, m.z1 - T, m.z1);
  yw(m.gate[1] + 0.5, m.x1, m.z1 - T, m.z1);
  // Gate pillars (taller) + arch lintel.
  R(m.gate[0] - 0.5, m.gate[0], m.z1 - 0.8, m.z1 + 0.2, 0, 3.6, hidden("gatepier"));
  R(m.gate[1], m.gate[1] + 0.5, m.z1 - 0.8, m.z1 + 0.2, 0, 3.6, hidden("gatepier"));
  R(m.gate[0], m.gate[1], m.z1 - 0.8, m.z1 + 0.2, 3.25, 4.1, hidden("gatearch"));
  yw(m.x0, m.x1, m.z0, m.z0 + T);
  yw(m.x0, m.x0 + T, m.z0 + T, m.door[0]);
  yw(m.x0, m.x0 + T, m.door[1], m.z1 - T);
  yw(m.x1 - T, m.x1, m.z0 + T, m.breach[0]);
  yw(m.x1 - T, m.x1, m.breach[1], m.z1 - T);
  // Rubble from the breach (low, crouch cover) and from the blown manor corner.
  R(37.4, 39.2, -32.6, -30.4, 0, 0.9, hidden("rubble"));
  R(15.6, 18.4, -26.2, -22.4, 0, 1.2, hidden("rubble"));
  R(18.6, 21.4, -24.4, -22.6, 0, 0.7, hidden("rubble"));
}

// ---- Garden and field walls (cover), hedges, fences ---------------------------------------
const lowWalls: [number, number, number, number, number][] = [
  // x0, x1, z0, z1, h
  [-1.2, 9.6, -46, -45.4, 1.0], [9.6, 10.2, -45.4, -36, 1.0], [9.6, 10.2, -32, -20, 1.0], // churchyard
  [-6, -1.8, -45.4, -44.8, 0.6],
  [-26, -16.5, -16.6, -16, 1.1], [-28, -27.4, -14.4, -4, 1.1], // north alley, hall back yard
  [-44, -36, -21.6, -21, 1.2], [-44, -43.4, -21, -12, 1.2], [-40, -30, -8.6, -8, 1.2],
  [-30, -26.6, 17.6, 18.2, 1.2], [-36, -27, 19, 19.6, 1.1], [-12, -4.4, 22.6, 23.2, 1.1], [-26.6, -26, 18.2, 34, 1.1], [-26, -16, 34, 34.6, 1.1],
  [-3.6, -3, 38, 44, 1.0], [4.4, 5, 37, 45, 1.0], [12.6, 13.2, 14, 26, 1.2], [5, 12.5, 23, 23.6, 1.1],
  [15, 24, 14.4, 15, 1.2], [24.4, 25, 5, 15, 1.2], [14.4, 15, 26, 40, 1.1],
  [26, 34, -5.4, -4.8, 0.9], [36, 46, -17.6, -17, 1.2],
  [-46, -40, 4.8, 5.4, 1.1], [-46, -38, -6.6, -6, 1.0],
];
for (const [x0, x1, z0, z1, h] of lowWalls) R(x0, x1, z0, z1, 0, h, hidden("lowwall"));
const fences: [number, number, number, number][] = [
  [26, 44, 22, 22.3], [44, 44.3, 22.3, 36], [26, 26.3, 30, 44], [-46, -32, 36, 36.3], [-20, -8, 40, 40.3], [38, 46, -40, -39.7],
];
for (const [x0, x1, z0, z1] of fences) R(x0, x1, z0, z1, 0, 1.3, hidden("fence", "wood"));

// ---- Village bounds: a grassy bank topped with hedgerows (collider ring) ----------------
const OUT = 48.6;
for (const s of [-1, 1]) {
  R(-OUT - 1, OUT + 1, s > 0 ? OUT : -OUT - 1, s > 0 ? OUT + 1 : -OUT, 0, 6, hidden("bound", "dirt"));
  R(s > 0 ? OUT : -OUT - 1, s > 0 ? OUT + 1 : -OUT, -OUT, OUT, 0, 6, hidden("bound", "dirt"));
}

// ---- The square ---------------------------------------------------------------------------
export const SQUARE = { x0: -12, x1: 12, z0: -12.5, z1: 10 };
export const STATUE = { x: 0, z: -2, plinth: 1.7 };
R(-1.4, 1.4, -3.4, -0.6, 0, STATUE.plinth, hidden("plinth"));
R(-0.45, 0.45, -2.45, -1.55, STATUE.plinth, STATUE.plinth + 2.5, hidden("statue", "metal"));
// Knocked-out tank (SE corner) and dusty pickup (W side); colliders hug the hulls.
export const TANK = { x: 8.4, z: 6.4, yaw: Math.PI + 0.22 };
R(4.7, 12.1, 4.4, 8.4, 0, 1.9, hidden("tank", "metal"));
R(6.9, 10.1, 5.0, 7.8, 1.9, 2.75, hidden("tankturret", "metal"));
export const PICKUP = { x: -8.2, z: 3.2, yaw: 0.06 };
R(-10.85, -5.55, 2.15, 4.25, 0, 1.75, hidden("pickup", "metal"));
// Stone planters, benches, a sandbag nest, a market stall wreck, rubble heaps.
R(-5.2, -3.6, 6.2, 7.6, 0, 0.75, hidden("planter"));
R(3.4, 5.0, -9.2, -7.6, 0, 0.75, hidden("planter"));
R(-4.6, -2.6, -7.4, -6.9, 0, 0.5, hidden("bench", "wood"));
R(2.6, 4.6, 2.6, 3.1, 0, 0.5, hidden("bench", "wood"));
B({ x: 5.5, z: -3.2, w: 0.9, h: 1.05, d: 3.6, color: SANDBAG, surface: "sand", style: "sandbags", tag: "nest" });
B({ x: 7.4, z: -5.4, w: 2.9, h: 1.05, d: 0.9, color: SANDBAG, surface: "sand", style: "sandbags", tag: "nest" });
R(-11.6, -9.4, -1.2, 1.0, 0, 1.0, hidden("stall", "wood"));
R(10.2, 11.8, -1.2, 0.8, 0, 0.8, hidden("rubble"));
R(-3.3, -1.9, 12.4, 14.2, 0, 0.7, hidden("rubble"));
// Lamp posts (slender colliders).
export const LAMPS: [number, number][] = [[-11.3, -4.2], [11.3, -7.5], [-6.5, 9.4], [6, -12.0]];
for (const [x, z] of LAMPS) R(x - 0.12, x + 0.12, z - 0.12, z + 0.12, 0, 3.6, hidden("lamp", "metal"));

// ---- Lanes: wrecks, barricades, carts, bales, crates ------------------------------------------
R(29.0, 33.6, -2.9, -1.0, 0, 1.45, hidden("burntcar", "metal")); // east road
R(-38.0, -33.4, 1.4, 3.3, 0, 1.45, hidden("burntcar", "metal")); // west road
R(-1.6, 1.4, 30.0, 31.6, 0, 1.1, hidden("cart", "wood")); // overturned cart, south lane
R(32, 35.4, 30, 32.4, 0, 2.2, hidden("tractor", "metal")); // farmyard tractor wreck
for (const [x, z] of [[29, 26], [30.6, 26], [38, 34], [38, 35.6], [-38, 42], [-36.4, 42], [41, -26], [41, -24.4]] as const) {
  B({ x, z, w: 1.5, h: 1.25, d: 1.5, color: 0xd6cfb0, surface: "sand", style: "bale" });
}
for (const [x, z, h] of [[-30, -6.0, 1.2], [-15.2, 6.3, 0.9], [27, 3.6, 1.2], [-2.8, 27, 0.9], [-33, -30, 1.2], [20, 24, 0.9], [41.5, -2.5, 1.2]] as const) {
  B({ x, z, w: 1.2, h, d: 1.2, color: WOOD, surface: "wood", style: "crate", tag: "supply" });
}
// Sandbag barricades across the lane mouths at the edges.
B({ x: -40, z: -1.0, w: 0.9, h: 1.05, d: 3.0, color: SANDBAG, surface: "sand", style: "sandbags", tag: "barricade" });
B({ x: 40, z: 0.6, w: 0.9, h: 1.05, d: 3.0, color: SANDBAG, surface: "sand", style: "sandbags", tag: "barricade" });
B({ x: 1.8, z: 40, w: 3.0, h: 1.05, d: 0.9, color: SANDBAG, surface: "sand", style: "sandbags", tag: "barricade" });
// Woodpile, well and orchard trees (trunk colliders; canopies drawn by the dressing).
R(-41.6, -38.6, -22.8, -22.2, 0, 1.3, hidden("woodpile", "wood"));
R(-19.4, -18.0, 19.0, 20.4, 0, 0.9, hidden("well"));
export const ORCHARD: [number, number][] = [];
for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) ORCHARD.push([-44 + i * 6.5 + (j % 2) * 2, -45 + j * 5]);
for (const [x, z] of [[18, 20], [21, 31], [-44, 13], [-32, 28], [44, 8], [-9, 44]] as const) ORCHARD.push([x, z]);
for (const [x, z] of ORCHARD) R(x - 0.25, x + 0.25, z - 0.25, z + 0.25, 0, 3, hidden("tree", "wood"));

// Telephone poles (the dressing strings the wires).
export const POLES: [number, number, number][] = [
  [-44, -2.4, 0], [-31, -2.4, 0], [-12.6, 0.4, 0.5], [13.6, -4.6, 0], [25, -4.6, 0], [36.5, -4.6, 0], [47, -4.6, 0],
  [-3.8, 24, Math.PI / 2], [3.9, 36, Math.PI / 2],
];
for (const [x, z, rotY] of POLES) B({ x, z, w: 0.32, h: 3, d: 0.32, color: WOOD, surface: "wood", style: "pole", tag: "pole", rotY });

// ---- Buy stations + ammo crates --------------------------------------------------------------
const stations = [
  { x: -10.6, z: -11.2, name: "Hall Armory" },
  { x: 9.6, z: -10.8, name: "Church Armory" },
];
for (const s of stations) {
  B({ x: s.x, z: s.z, w: 1.4, h: 1.3, d: 0.9, color: STEEL, surface: "metal", mat: "metal_dark", tag: "station" });
  B({ x: s.x, z: s.z, w: 1.0, h: 0.5, d: 0.08, y: 1.35, color: 0x0c1a10, emissive: GREEN_SCREEN, decor: true });
  B({ x: s.x, z: s.z, w: 0.08, h: 2.6, d: 0.08, y: 0, color: STEEL, mat: "metal_dark", decor: true });
  B({ x: s.x, z: s.z, w: 0.3, h: 0.12, d: 0.3, y: 2.6, color: 0x111111, emissive: GREEN_SCREEN, decor: true });
}
const crates = [
  { x: -9.8, z: 7.8 },
  { x: 1.2, z: -11.0 },
  { x: -19.6, z: -5.2 },
  { x: 10.6, z: 1.8 },
];
for (const c of crates) {
  B({ x: c.x, z: c.z, w: 1.4, h: 0.7, d: 0.9, color: 0x9a9a6c, surface: "metal", tag: "ammo" });
  B({ x: c.x, z: c.z, w: 1.2, h: 0.06, d: 0.2, y: 0.7, color: 0x111111, emissive: AMBER, decor: true });
}

const perches = [
  { x: 0, y: TOWER.shaft, z: -16 },
  { x: 20.6, y: 3.6, z: -26.8 },
  { x: 36, y: 3.6, z: 17.2 },
  { x: 8.5, y: 3.0, z: 31 },
];

export const BRENNHOLLOW: MapDef = {
  id: "brennhollow",
  name: "Brennhollow",
  size: 100,
  groundColor: 0x5f6a48,
  skyTop: 0x7d93ab,
  skyHorizon: 0xc9d0cf,
  fogNear: 80,
  fogFar: 380,
  sunDirection: [0.42, 0.62, -0.5],
  sunColor: 0xfff0dc,
  sunIntensity: 2.7,
  hemiSky: 0xc4d0dc,
  hemiGround: 0x4f5638,
  atmosphere: {
    fogDensity: 0.0032,
    fogColor: 0xbfc8c8,
    skyGround: 0x56604a,
    hemiIntensity: 0.65,
    cloudCover: 0.62,
    envIntensity: 0.45,
    exposure: 1.0,
  },
  dressing: "brennhollow",
  spawns: [{ x: 0, z: 4.5, yaw: 0 }],
  boxes,
  targets: [],
  plates: [],
  signs: [
    { x: -10.6, y: 2.2, z: -10.7, text: "ARMORY [F]" },
    { x: 9.6, y: 2.2, z: -10.3, text: "ARMORY [F]" },
  ],
  survival: {
    enemySpawns: [
      { x: -11, z: -46 }, { x: -36, z: -46 }, { x: 44, z: -45 },
      { x: 46, z: -1 }, { x: 46, z: -24 }, { x: 46, z: 28 },
      { x: 0, z: 46 }, { x: -28, z: 46 }, { x: 30, z: 46 },
      { x: -46, z: 2 }, { x: -46, z: -30 }, { x: -46, z: 26 },
    ],
    perches,
    buyStations: stations,
    ammoCrates: crates,
    inner: 30,
  },
};
