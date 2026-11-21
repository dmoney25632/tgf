import type { MapBox, MapDef } from "../MapLoader";

/**
 * Iron Crossing — an original, long mission map: the Vellen gorge and the
 * three-span road-and-rail truss bridge at Brask.
 *
 * South to north (players push towards −z):
 *  - Brask (z ≈ +72 … +165): a riverside town on the south rim. The approach
 *    road runs through it to a little square; side streets reach a
 *    promenade along the gorge rim.
 *  - South bridgehead (z ≈ +60 … +80): the checkpoint booth, boom gates,
 *    jersey-barrier chicane and two sandbag nests.
 *  - The bridge (z −60 … +60): the deck sits 2.4 m up on its abutments
 *    (stepped approach ramps at each end). Road lane west, rail lane east
 *    with a stalled freight train. Wrecked cars, a shell-blocked road lane at
 *    z ≈ −30 and an enemy nest mid-span. Under each deck edge, inside the
 *    outer trusses, runs a maintenance catwalk on the girders' bottom chord:
 *    the flanking route. Stepped pier caps at z = ±20 and the abutments
 *    connect catwalk and deck; parapet gaps let you drop down.
 *  - North bridgehead (z ≈ −60 … −85): the MG bunker west of the road, a
 *    sandbag MG nest east, dragon's teeth and a signal mast.
 *  - The customs yard (z ≈ −88 … −112): customs house, truck lot, fuel
 *    tanks, water tower (sniper perch). Held for the extraction.
 *  - The LZ field (z ≈ −128) and the forest edge.
 *
 * x = east, z = south, y = up; box = centre + size. Collision is a flat
 * plane at y = 0: the gorge is fenced off by "rim" colliders and its depth
 * is drawn by the dressing (dressing/ironCrossing.ts). Elevated walkable
 * areas are stacks of 0.4 m layers so the 2.5-D nav grid can climb them.
 * Boxes are sorted bottom-up at the end (NavGrid relies on that).
 */

const CONCRETE = 0xcfc8b8;
const SANDBAG = 0xc4b48e;
const RUST = 0x9a6a4e;
const OLIVE = 0x8a8c62;
const BARRIER = 0xd8d2c4;
const ROCK = 0xb4ab9a;
const GREEN_SCREEN = 0x2bd36a;
const AMBER = 0xffa73a;

const boxes: MapBox[] = [];
const B = (b: MapBox) => boxes.push(b);
const hidden = (tag: string, surface: MapBox["surface"] = "concrete") => ({ color: CONCRETE, surface, style: "hidden", tag }) as const;

/** Map bounds (bound walls sit just outside). */
export const BOUNDS = { x0: -50, x1: 50, z0: -165, z1: 170 };
/** NavGrid window covering the bounds (see MapDef.nav). */
export const NAV = { minX: -51, minZ: -166, width: 102, depth: 338 };

/** Deck stack layer (the approach ramps rise 0.2 m per step: almost a slope). */
export const LAYER = 0.2;
/** Pier-cap stair layer (proper steps). */
export const CAP_LAYER = 0.4;
/** Ramp / pier-cap step depth (≥ one nav cell so neighbours never differ by two layers). */
export const STEP = 0.9;

/**
 * The bridge. The deck stack is `layers` × LAYER: the lower layers fill the
 * substructure (|x| ≤ core), the top one is the deck slab and overhangs the
 * catwalks to |x| = deckHalf (2.2 m headroom underneath). Catwalks run at
 * y = 0 between the core and the outer truss wall (|x| = catOut).
 */
export const BRIDGE = {
  /** Gorge rims (z of the abutment faces). */
  south: 60,
  north: -60,
  deck: 2.4,
  layers: 12,
  core: 7.5,
  deckHalf: 8.5,
  catOut: 10.4,
  wallT: 0.4,
  /** Flat bridgehead platform beyond each rim before the ramp starts. */
  pad: 4,
  piers: [20, -20],
  /** Road lane x range and rail lane x range on the deck. */
  road: [-8.5, 1.5] as const,
  rail: [1.5, 8.5] as const,
  /** Rail track centre. */
  track: 5,
};

// ---- Bounds ---------------------------------------------------------------------------------
B({ x: BOUNDS.x0 - 1, z: (BOUNDS.z0 + BOUNDS.z1) / 2, w: 2, h: 8, d: BOUNDS.z1 - BOUNDS.z0 + 4, ...hidden("bound") });
B({ x: BOUNDS.x1 + 1, z: (BOUNDS.z0 + BOUNDS.z1) / 2, w: 2, h: 8, d: BOUNDS.z1 - BOUNDS.z0 + 4, ...hidden("bound") });
B({ x: 0, z: BOUNDS.z1 + 1, w: BOUNDS.x1 - BOUNDS.x0, h: 8, d: 2, ...hidden("bound") });
B({ x: 0, z: BOUNDS.z0 - 1, w: BOUNDS.x1 - BOUNDS.x0, h: 8, d: 2, ...hidden("bound") });

// ---- Gorge rims: you can't walk off the edge (the plane at y = 0 continues under the drop) ----
{
  const { south, north, catOut, wallT } = BRIDGE;
  const outer = catOut + wallT;
  for (const [z, s] of [[south, 1], [north, -1]] as const) {
    const zc = z + s * 0.3;
    // West and east of the bridge.
    B({ x: (BOUNDS.x0 + -outer) / 2, z: zc, w: -outer - BOUNDS.x0, h: 3, d: 0.6, ...hidden("rim", "dirt") });
    B({ x: (BOUNDS.x1 + outer) / 2, z: zc, w: BOUNDS.x1 - outer, h: 3, d: 0.6, ...hidden("rim", "dirt") });
  }
  // Outer truss walls along the catwalks (the gorge drops away beyond them).
  for (const s of [-1, 1]) B({ x: s * (catOut + wallT / 2), z: (south + north) / 2, w: wallT, h: 3, d: south - north + 1.2, ...hidden("truss", "metal") });
}

// ---- Deck stack, approach ramps and the stepped pier caps --------------------------------------
{
  const { south, north, layers, core, deckHalf, pad, catOut, piers } = BRIDGE;
  for (let k = 1; k <= layers; k++) {
    const ext = pad + (layers - k) * STEP;
    const half = k === layers ? deckHalf : core;
    B({ x: 0, z: (south + north) / 2, w: half * 2, d: south - north + ext * 2, y: (k - 1) * LAYER, h: LAYER, ...hidden(k === layers ? "deck" : "stack") });
  }
  // Pier caps: stepped humps on each catwalk, up to the deck through a parapet gap.
  for (const pz of piers) {
    const n = Math.round(BRIDGE.deck / CAP_LAYER);
    for (const s of [-1, 1]) {
      for (let k = 1; k <= n; k++) {
        const half = 1.5 + (n - k) * STEP;
        const x0 = k === n ? deckHalf : core;
        B({ x: s * (x0 + catOut) / 2, z: pz, w: catOut - x0, d: half * 2, y: (k - 1) * CAP_LAYER, h: CAP_LAYER, ...hidden("piercap") });
      }
    }
  }
}

/** Deck parapets (low walls along the slab edge) with gaps at the pier caps and drop-down gaps. */
export const PARAPET_GAPS = [
  // [z centre, length]
  [20, 3.4], [-20, 3.4], [44, 2.4], [-4, 2.4], [-44, 2.4],
] as const;
{
  const { south, north, deck, deckHalf, pad } = BRIDGE;
  const z0 = north - pad, z1 = south + pad;
  for (const s of [-1, 1]) {
    // Split the run around the gaps.
    const gaps = [...PARAPET_GAPS].map(([z, l]) => [z - l / 2, z + l / 2]).sort((a, b) => a[0] - b[0]);
    let from = z0;
    for (const [g0, g1] of [...gaps, [z1, z1]]) {
      if (g0 - from > 0.5) B({ x: s * (deckHalf - 0.15), z: (from + g0) / 2, w: 0.3, h: 1.05, d: g0 - from, y: deck, ...hidden("parapet") });
      from = g1;
    }
  }
}

// ---- On the deck: wrecks, the stalled train, the shell-blocked lane, nests ---------------------
/** Wrecked vehicles on the deck: centre, yaw, kind (colliders approximate the hull). */
export const WRECKS: { x: number; z: number; yaw: number; kind: "sedan" | "pickup" | "truck" }[] = [
  { x: -5.2, z: 52, yaw: 0.35, kind: "sedan" },
  { x: -1.6, z: 38, yaw: -0.2, kind: "pickup" },
  { x: -6.0, z: 27, yaw: 1.3, kind: "sedan" },
  { x: -2.2, z: 8, yaw: 0.15, kind: "truck" },
  { x: -6.4, z: -8, yaw: -0.5, kind: "sedan" },
  { x: -1.8, z: -44, yaw: 0.6, kind: "pickup" },
  { x: -6.2, z: -52, yaw: -1.4, kind: "sedan" },
];
{
  const d = BRIDGE.deck;
  for (const w of WRECKS) {
    const len = w.kind === "truck" ? 6.8 : w.kind === "pickup" ? 5.2 : 4.4;
    const wid = w.kind === "truck" ? 2.4 : 1.9;
    const h = w.kind === "truck" ? 2.8 : 1.45;
    // Long axis mostly along x when |yaw| > 45°.
    const across = Math.abs(Math.sin(w.yaw)) > Math.SQRT1_2;
    const c = Math.abs(Math.cos(w.yaw)), sn = Math.abs(Math.sin(w.yaw));
    const ex = across ? len * sn * 0.85 + wid * c * 0.5 : wid + len * sn * 0.6;
    const ez = across ? wid + len * c * 0.4 : len * c * 0.9 + wid * sn * 0.4;
    B({ x: w.x, z: w.z, w: Math.min(ex, 5.6), d: Math.min(ez, 7), y: d, h, ...hidden("wreck", "metal") });
  }
}

/** Freight wagons on the rail lane (z centres); the second is derailed and canted. */
export const TRAIN = { x: BRIDGE.track, wagons: [{ z: 14, len: 12 }, { z: 0, len: 12, derailed: true }, { z: -13, len: 11 }], width: 2.9, height: 3.6 };
for (const w of TRAIN.wagons) {
  const dx = w.derailed ? -0.6 : 0;
  B({ x: TRAIN.x + dx, z: w.z, w: TRAIN.width, d: w.len, y: BRIDGE.deck, h: TRAIN.height, ...hidden("wagon", "metal") });
}
/** Shell hit on the road lane: collapsed slab and twisted girder block it; the rail side stays open. */
export const CRATER = { x: -3.35, z: -30, w: 9.7, d: 5 };
B({ x: CRATER.x, z: CRATER.z, w: CRATER.w, d: CRATER.d, y: BRIDGE.deck, h: 1.8, ...hidden("crater", "concrete") });

const sandbag = (x: number, z: number, w: number, d: number, y = 0, tag = "nest") => B({ x, z, w, d, h: 1.05, y, color: SANDBAG, surface: "sand", style: "sandbags", tag });
// Mid-span enemy nest across the road lane, facing south.
sandbag(-4.6, -16, 6.2, 0.9, BRIDGE.deck);
sandbag(-7.4, -17.4, 0.9, 1.9, BRIDGE.deck);
// North-end nest on the rail lane.
sandbag(5.4, -50, 4.4, 0.9, BRIDGE.deck);
// Jersey barriers on the deck near the south end (an abandoned checkpoint lane).
for (const [x, z] of [[-6.5, 46], [-0.2, 44]] as const) B({ x, z, w: 3, d: 0.6, h: 0.95, y: BRIDGE.deck, color: BARRIER, surface: "concrete", style: "barrier" });

// ---- South bridgehead: checkpoint booth, chicane, nests -----------------------------------------
/** Checkpoint booth (enterable): footprint and door on its east side. */
export const BOOTH = { x: -12, z: 71.6, w: 3.6, d: 3.4, h: 2.7, door: 1.5 };
{
  const { x, z, w, d, h, door } = BOOTH;
  const t = 0.2;
  B({ x, z: z - d / 2 + t / 2, w, d: t, h, ...hidden("booth") });
  B({ x, z: z + d / 2 - t / 2, w, d: t, h, ...hidden("booth") });
  B({ x: x - w / 2 + t / 2, z, w: t, d: d - t * 2, h, ...hidden("booth") });
  // East wall split around the door.
  const seg = (d - t * 2 - door) / 2;
  B({ x: x + w / 2 - t / 2, z: z - door / 2 - seg / 2, w: t, d: seg, h, ...hidden("booth") });
  B({ x: x + w / 2 - t / 2, z: z + door / 2 + seg / 2, w: t, d: seg, h, ...hidden("booth") });
  // Roof (shade).
  B({ x, z, w: w + 0.6, d: d + 0.6, y: h, h: 0.2, ...hidden("roof") });
}
// Chicane of jersey barriers on the approach road.
for (const [x, z, w] of [[-2.2, 82, 6], [2.6, 88, 6], [-2.2, 94, 6]] as const) B({ x, z, w, d: 0.6, h: 0.95, color: BARRIER, surface: "concrete", style: "barrier" });
// Nests either side of the bridge mouth, facing south (the way you come in).
sandbag(6.2, 76, 4.2, 0.9);
sandbag(8.6, 74.4, 0.9, 2.3);
sandbag(-14.6, 77, 4.0, 0.9);
// Ammo crates (the squad resupplies at checkpoints).
export const AMMO = [
  { x: -15.4, z: 74.6 },
  { x: -15, z: -66 },
  { x: -6, z: -96 },
];
for (const c of AMMO) {
  B({ x: c.x, z: c.z, w: 1.4, h: 0.7, d: 0.9, color: OLIVE, surface: "metal", tag: "ammo" });
  B({ x: c.x, z: c.z, w: 1.2, h: 0.06, d: 0.2, y: 0.7, color: 0x111111, emissive: AMBER, decor: true });
}

// ---- Brask: the riverside town -------------------------------------------------------------------
/**
 * Town blocks (solid; facades by the dressing). Approach road |x| < 5.5;
 * the square at z 94…112; side streets at z ≈ 128 and z ≈ 82.
 */
export type Block = { x0: number; x1: number; z0: number; z1: number; floors: number; seed: number; tint?: number; damage?: number; front: 0 | 1 | 2 | 3 };
export const BLOCKS: Block[] = [
  // West of the road.
  { x0: -24, x1: -8, z0: 136, z1: 150, floors: 3, seed: 11, front: 1 },
  { x0: -42, x1: -28, z0: 138, z1: 156, floors: 2, seed: 12, front: 1, damage: 0.4 },
  { x0: -22, x1: -8, z0: 114, z1: 124, floors: 3, seed: 13, front: 1, damage: 0.2 },
  { x0: -40, x1: -27, z0: 112, z1: 124, floors: 2, seed: 14, front: 1 },
  { x0: -30, x1: -18, z0: 86, z1: 94, floors: 2, seed: 15, front: 2, damage: 0.5 },
  { x0: -44, x1: -34, z0: 86, z1: 100, floors: 2, seed: 16, front: 1 },
  // East of the road.
  { x0: 8, x1: 22, z0: 136, z1: 152, floors: 3, seed: 21, front: 3 },
  { x0: 26, x1: 42, z0: 140, z1: 156, floors: 2, seed: 22, front: 3, damage: 0.3 },
  { x0: 8, x1: 20, z0: 114, z1: 126, floors: 2, seed: 23, front: 3 },
  { x0: 26, x1: 40, z0: 112, z1: 124, floors: 3, seed: 24, front: 3, damage: 0.6 },
  { x0: 18, x1: 30, z0: 84, z1: 94, floors: 2, seed: 25, front: 2 },
  { x0: 34, x1: 44, z0: 84, z1: 98, floors: 2, seed: 26, front: 3, damage: 0.35 },
];
for (const b of BLOCKS) B({ x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, w: b.x1 - b.x0, d: b.z1 - b.z0, h: b.floors * 3.3 + 0.6, ...hidden("block", "concrete") });

/** Church on the square's west side; its tower is a sniper perch. */
export const CHURCH = { x0: -26, x1: -12, z0: 96, z1: 108, tower: { x: -10, z: 98, size: 4, perch: 7.2 } };
{
  const c = CHURCH;
  B({ x: (c.x0 + c.x1) / 2, z: (c.z0 + c.z1) / 2, w: c.x1 - c.x0, d: c.z1 - c.z0, h: 9, ...hidden("church", "concrete") });
  const t = c.tower;
  B({ x: t.x, z: t.z, w: t.size, d: t.size, h: t.perch, ...hidden("tower", "concrete") });
}
/** Fountain in the middle of the square (low; cover). */
export const FOUNTAIN = { x: 10, z: 103, r: 2.4 };
B({ x: FOUNTAIN.x, z: FOUNTAIN.z, w: 4.4, d: 4.4, h: 0.9, ...hidden("fountain", "concrete") });
// Square clutter: a burnt bus as cover, market crates.
B({ x: -2.6, z: 120, w: 2.6, d: 9, h: 3, ...hidden("bus", "metal") });
for (const [x, z] of [[17, 108], [14.8, 96.5], [24, 103]] as const) B({ x, z, w: 1.2, h: 1.0, d: 1.2, color: 0xb59a74, surface: "wood", style: "crate" });
// Riverside promenade: a low stone balustrade on the rim between the blocks (cover, not a wall).
for (const [x0, x1] of [[-44, -16], [16, 44]] as const) B({ x: (x0 + x1) / 2, z: 63.2, w: x1 - x0, d: 0.5, h: 0.9, ...hidden("balustrade", "concrete") });
// Parked trucks on the promenade.
B({ x: -28, z: 68, w: 6.6, d: 2.5, h: 2.8, ...hidden("truck", "metal") });
B({ x: 30, z: 69, w: 2.5, d: 6.4, h: 2.8, ...hidden("truck", "metal") });

// ---- North bridgehead: MG bunker, MG nest, dragon's teeth, signal mast ---------------------------
/**
 * The MG bunker: concrete box west of the road, firing slit facing the
 * bridge (south), entrance on the north side. Plant the charge at its back.
 */
export const BUNKER = { x: -12, z: -76, w: 9, d: 6.5, h: 2.9, t: 0.6, slit: { y: 1.05, h: 0.45 }, door: 2 };
{
  const { x, z, w, d, h, t, slit, door } = BUNKER;
  // South wall: below and above the slit (the slit runs most of the width).
  B({ x, z: z + d / 2 - t / 2, w, d: t, h: slit.y, ...hidden("bunker") });
  B({ x, z: z + d / 2 - t / 2, w, d: t, y: slit.y + slit.h, h: h - slit.y - slit.h, ...hidden("bunker") });
  // Side walls.
  B({ x: x - w / 2 + t / 2, z, w: t, d: d - t * 2, h, ...hidden("bunker") });
  B({ x: x + w / 2 - t / 2, z, w: t, d: d - t * 2, h, ...hidden("bunker") });
  // North wall split around the door.
  const seg = (w - door) / 2;
  B({ x: x - door / 2 - seg / 2, z: z - d / 2 + t / 2, w: seg, d: t, h, ...hidden("bunker") });
  B({ x: x + door / 2 + seg / 2, z: z - d / 2 + t / 2, w: seg, d: t, h, ...hidden("bunker") });
  // Roof slab.
  B({ x, z, w: w + 0.4, d: d + 0.4, y: h, h: 0.6, ...hidden("roof") });
}
/** Where the charge goes (behind the bunker by its door). */
export const BUNKER_CHARGE = { x: BUNKER.x + 2.6, z: BUNKER.z - BUNKER.d / 2 - 1.1 };
// MG nest east of the road.
sandbag(12, -71, 4.6, 0.9);
sandbag(14.7, -73, 0.9, 2.2);
sandbag(9.3, -73, 0.9, 2.2);
// Dragon's teeth across the road north of the bridge (gaps to walk through).
for (const x of [-4.4, -1.4, 1.6, 4.6]) B({ x, z: -82, w: 1.1, d: 1.1, h: 1.0, ...hidden("teeth", "concrete") });
/** Signal mast by the rail line: a sniper platform. */
export const MAST = { x: 22, z: -70, size: 3, perch: 6.4 };
B({ x: MAST.x, z: MAST.z, w: MAST.size, d: MAST.size, h: MAST.perch, ...hidden("mast", "metal") });

// ---- Customs yard (held for extraction) ------------------------------------------------------------
export const CUSTOMS = { x0: -26, x1: -14, z0: -108, z1: -94, h: 6.8 };
B({ x: (CUSTOMS.x0 + CUSTOMS.x1) / 2, z: (CUSTOMS.z0 + CUSTOMS.z1) / 2, w: CUSTOMS.x1 - CUSTOMS.x0, d: CUSTOMS.z1 - CUSTOMS.z0, h: CUSTOMS.h, ...hidden("customs", "concrete") });
/** The yard's hold point (defend zone centre). */
export const YARD = { x: 0, z: -100, r: 11 };
// Containers and trucks in the lot (cover).
for (const [x, z, w, d, c] of [
  [-6.5, -92, 2.5, 6.1, 0x8a5a44],
  [7, -106, 6.1, 2.5, 0x5f7a8c],
  [12.5, -96, 2.5, 6.1, OLIVE],
  [-6, -112, 6.1, 2.5, RUST],
] as const) B({ x, z, w, d, h: 2.6, color: c, surface: "metal", style: "container" });
B({ x: 4.5, z: -91.5, w: 2.4, d: 6.4, h: 2.8, ...hidden("truck", "metal") });
// Fuel tanks east of the yard.
for (const z of [-104, -112]) B({ x: 26, z, w: 7, h: 3.2, d: 3.2, color: 0xb8b2a4, surface: "metal", style: "tank" });
/** Water tower: sniper perch over the yard. */
export const TOWER = { x: 30, z: -90, size: 3.6, perch: 7.6 };
B({ x: TOWER.x, z: TOWER.z, w: TOWER.size, d: TOWER.size, h: TOWER.perch, ...hidden("watertower", "metal") });
// Sandbag ring for the defenders on the yard's north edge.
sandbag(2.5, -114, 5, 0.9);
sandbag(16, -112, 0.9, 4);

// ---- LZ field and forest edge ------------------------------------------------------------------------
export const LZ = { x: 2, z: -132 };
for (const [x, z, w, h, d] of [
  [-30, -140, 4, 2.2, 3], [24, -146, 3.5, 1.8, 4], [-12, -156, 5, 2.4, 3], [38, -128, 3, 1.6, 3], [-38, -118, 3, 2, 4],
] as const) B({ x, z, w, h, d, color: ROCK, surface: "sand", style: "rock" });
// Sign posts (visual) and a buy-free mission map: the buy screens are not used here.
B({ x: -2.6, z: 69, w: 0.08, h: 0.06, d: 0.08, y: 2.2, color: 0x111111, emissive: GREEN_SCREEN, decor: true });

/** Tree positions kept clear of play (the dressing scatters more beyond the bounds). */
export const TOWN_TREES: [number, number][] = [
  [-4.5, 106], [4.6, 132], [-46, 108], [46, 132], [-46, 70], [46, 76], [38, 106], [-34, 128],
];
for (const [x, z] of TOWN_TREES) B({ x, z, w: 0.6, d: 0.6, h: 4, ...hidden("tree", "wood") });

// Bottom-up so the nav grid's floor pass climbs stacks in order.
boxes.sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.decor ? 1 : 0) - (b.decor ? 1 : 0));

export const IRON_CROSSING: MapDef = {
  id: "iron-crossing",
  name: "Iron Crossing",
  size: 340,
  groundColor: 0x7a7c5c,
  skyTop: 0x5a7fa8,
  skyHorizon: 0xd4d6d0,
  fogNear: 90,
  fogFar: 420,
  sunDirection: [-0.5, 0.62, 0.6],
  sunColor: 0xffdcb0,
  sunIntensity: 3.0,
  hemiSky: 0xc8d6e6,
  hemiGround: 0x6a6448,
  atmosphere: {
    fogDensity: 0.0042,
    fogColor: 0xc9cfcc,
    skyGround: 0x5e6048,
    hemiIntensity: 0.7,
    cloudCover: 0.55,
    envIntensity: 0.5,
    exposure: 1.02,
  },
  dressing: "ironCrossing",
  spawns: [{ x: 0, z: 160, yaw: 0 }],
  nav: NAV,
  boxes,
  targets: [],
  plates: [],
  signs: [
    { x: 6.4, y: 1.9, z: 70.5, text: "BRASK", rotY: 0 },
    { x: -6.4, y: 1.9, z: -68, text: "VELLEN", rotY: Math.PI },
  ],
};
