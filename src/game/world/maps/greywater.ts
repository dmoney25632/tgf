import type { MapBox, MapDef } from "../MapLoader";

/**
 * Greywater Depot — an original night-time stealth map: an Ashen Front
 * supply depot in the Halvarn valley, ringed by wire and watchtowers.
 *
 * South to north (the team sneaks in from the south, z ≈ +118, and leaves
 * by the river in the north-east):
 *  - The approach (z +40 … +125): forest edge at the insertion, tall-grass
 *    fields either side of the dirt road, dry-stone field walls, hay bales,
 *    rock outcrops, a ruined farmhouse and a reed-choked drainage ditch that
 *    runs up the west side to the wire. The road has a vehicle checkpoint
 *    (z ≈ 72): boom gate, sandbagged post, a parked APC and a floodlight.
 *  - The perimeter road (8 m outside the fence) carries a patrol truck
 *    whose headlights sweep whatever it drives past.
 *  - The wire (x ±50, z −55 … +35): chain-link with barbed top. Ways in:
 *    the guarded south gate, a cut section in the west fence behind the
 *    motor pool, a collapsed panel on the east side and the back gate in the
 *    north fence. Watchtowers at the four corners with searchlights.
 *  - Inside: the motor pool and vehicle shed (west), barracks (east), the
 *    floodlit courtyard, containers, the generator and fuel tanks, and the
 *    command house in the north.
 *  - The command house: a single-storey front wing with three rooms (radio
 *    room, hall, mess) and a raised rear wing on a stone plinth (the upper
 *    floor: landing, map room and the colonel's office). An internal stair
 *    climbs from the hall; an exterior stair drops from the back door to
 *    the dark north yard.
 *  - Exfil: through the back gate (or the east collapse), across the north
 *    field and the treeline to the skiff at the river jetty (north-east).
 *
 * x = east, z = south, y = up; box = centre + size. Collision is a flat plane
 * at y = 0 (the river is fenced off by a bank collider); the raised wing is a
 * stack of 0.4 m layers so the 2.5-D nav grid can climb its stairs.
 * Boxes are sorted bottom-up at the end (NavGrid relies on that).
 *
 * Gameplay data that the stealth layer needs (lights, searchlights, the
 * truck's loop, concealment) is exported from here so visuals and detection
 * read the same numbers.
 */

const STONE = 0xa8a294;
const PLASTER = 0xcfc6b2;
const SANDBAG = 0xb8a882;
const OLIVE = 0x6a6e4e;
const RUST = 0x8a5a44;
const HAY = 0xc8b07a;
const ROCK = 0x9a958a;

const boxes: MapBox[] = [];
const B = (b: MapBox) => boxes.push(b);
const hidden = (tag: string, surface: MapBox["surface"] = "concrete") => ({ color: PLASTER, surface, style: "hidden", tag }) as const;

/** Playable bounds (bound walls sit just outside). */
export const BOUNDS = { x0: -100, x1: 100, z0: -115, z1: 125 };
/** NavGrid window covering the bounds (see MapDef.nav). */
export const NAV = { minX: -101, minZ: -116, width: 202, depth: 242 };

/** Team insertion (forest edge, south-west). Player yaw 0 faces −z (north). */
export const INSERT = { x: -22, z: 116, yaw: 0 };

// ---- Bounds --------------------------------------------------------------------------------------
B({ x: BOUNDS.x0 - 1, z: (BOUNDS.z0 + BOUNDS.z1) / 2, w: 2, h: 8, d: BOUNDS.z1 - BOUNDS.z0 + 4, ...hidden("bound") });
B({ x: BOUNDS.x1 + 1, z: (BOUNDS.z0 + BOUNDS.z1) / 2, w: 2, h: 8, d: BOUNDS.z1 - BOUNDS.z0 + 4, ...hidden("bound") });
B({ x: 0, z: BOUNDS.z1 + 1, w: BOUNDS.x1 - BOUNDS.x0, h: 8, d: 2, ...hidden("bound") });
B({ x: 0, z: BOUNDS.z0 - 1, w: BOUNDS.x1 - BOUNDS.x0, h: 8, d: 2, ...hidden("bound") });

// ---- River bank (north): you can't walk into the water except along the jetty ---------------------
/** River: water north of the bank line. The jetty pokes out over it. */
export const RIVER = { bank: -105, jetty: { x0: 55.6, x1: 60.4, z0: -114, z1: -105 } };
/** Where the skiff waits (exfil). */
export const EXFIL = { x: 58, z: -110.5 };
{
  const { bank, jetty } = RIVER;
  B({ x: (BOUNDS.x0 + jetty.x0 - 0.2) / 2, z: bank - 0.3, w: jetty.x0 - 0.2 - BOUNDS.x0, h: 2.5, d: 0.6, ...hidden("bank", "dirt") });
  B({ x: (BOUNDS.x1 + jetty.x1 + 0.2) / 2, z: bank - 0.3, w: BOUNDS.x1 - jetty.x1 - 0.2, h: 2.5, d: 0.6, ...hidden("bank", "dirt") });
  // Jetty rails (you walk the planks between them).
  for (const x of [jetty.x0 - 0.1, jetty.x1 + 0.1]) B({ x, z: (jetty.z0 + bank - 0.6) / 2, w: 0.2, h: 1.0, d: bank - 0.6 - jetty.z0, ...hidden("jetty", "wood") });
}
/** Boathouse by the jetty (cover on the last stretch). */
export const BOATHOUSE = { x: 67, z: -99, w: 6, d: 5, h: 3.2 };
B({ x: BOATHOUSE.x, z: BOATHOUSE.z, w: BOATHOUSE.w, d: BOATHOUSE.d, h: BOATHOUSE.h, ...hidden("boathouse", "wood") });

// ---- The wire --------------------------------------------------------------------------------------
/** Fence line and its gaps. */
export const FENCE = {
  x0: -50, x1: 50, z0: -55, z1: 35, t: 0.15, h: 2.8,
  /** Gaps: [from, to] along the side. */
  southGate: [-4.5, 4.5] as const,
  westCut: [6, 8.6] as const,
  eastCollapse: [-25, -19] as const,
  backGate: [14, 20] as const,
};
{
  const { x0, x1, z0, z1, t, h } = FENCE;
  const fx = (xa: number, xb: number, z: number) => B({ x: (xa + xb) / 2, z, w: xb - xa, d: t, h, ...hidden("fence", "metal") });
  const fz = (za: number, zb: number, x: number) => B({ x, z: (za + zb) / 2, w: t, d: zb - za, h, ...hidden("fence", "metal") });
  // South and north runs span the full width (corners included); the side runs fit between them.
  fx(x0 - t / 2, FENCE.southGate[0], z1);
  fx(FENCE.southGate[1], x1 + t / 2, z1);
  fx(x0 - t / 2, FENCE.backGate[0], z0);
  fx(FENCE.backGate[1], x1 + t / 2, z0);
  fz(z0 + t / 2, FENCE.westCut[0], x0);
  fz(FENCE.westCut[1], z1 - t / 2, x0);
  fz(z0 + t / 2, FENCE.eastCollapse[0], x1);
  fz(FENCE.eastCollapse[1], z1 - t / 2, x1);
}
/** Inside the wire (the infiltration zone). */
export const COMPOUND = { x0: FENCE.x0 + 0.2, x1: FENCE.x1 - 0.2, z0: FENCE.z0 + 0.2, z1: FENCE.z1 - 0.2 };

/** Watchtowers: lattice legs over a cabin; the guard stands on the deck at `perch`. */
export const TOWER = { size: 3, perch: 5.6 };
export const TOWERS = [
  { id: "sw", x: -46, z: 31 },
  { id: "se", x: 46, z: 31 },
  { id: "nw", x: -46, z: -51 },
  { id: "ne", x: 46, z: -51 },
] as const;
for (const t of TOWERS) B({ x: t.x, z: t.z, w: TOWER.size, d: TOWER.size, h: TOWER.perch, ...hidden("tower", "metal") });

/**
 * Searchlights: each tower's lamp sweeps a ground spot around `yaw`
 * (atan2(dx, dz) from the tower) by ±`arc`, at `reach` ± `swing` metres,
 * period `period` s. Lit spots count as full light for every guard.
 */
export type Searchlight = { tower: string; x: number; z: number; y: number; yaw: number; arc: number; reach: number; swing: number; period: number; phase: number; radius: number };
export const SEARCHLIGHTS: Searchlight[] = [
  { tower: "sw", x: -46, z: 31, y: TOWER.perch + 1.1, yaw: 0.36, arc: 0.72, reach: 30, swing: 9, period: 15, phase: 0, radius: 4.2 },
  { tower: "se", x: 46, z: 31, y: TOWER.perch + 1.1, yaw: -0.42, arc: 0.7, reach: 30, swing: 9, period: 17, phase: 1.7, radius: 4.2 },
  { tower: "nw", x: -46, z: -51, y: TOWER.perch + 1.1, yaw: 1.2, arc: 0.55, reach: 22, swing: 8, period: 13, phase: 0.6, radius: 4 },
  { tower: "ne", x: 46, z: -51, y: TOWER.perch + 1.1, yaw: 2.55, arc: 0.75, reach: 27, swing: 9, period: 16, phase: 2.4, radius: 4.2 },
];

/** Searchlight ground spot at time t (seconds). */
export function searchlightSpot(s: Searchlight, t: number, out: { x: number; z: number }) {
  const w = (Math.PI * 2) / s.period;
  const yaw = s.yaw + s.arc * Math.sin(w * t + s.phase);
  const r = s.reach + s.swing * Math.sin(w * 0.53 * t + s.phase * 1.7);
  out.x = s.x + Math.sin(yaw) * r;
  out.z = s.z + Math.cos(yaw) * r;
  return out;
}

// ---- Perimeter road and the patrol truck's loop -------------------------------------------------------
/** The truck drives this closed loop (clockwise seen from above), pausing at the south gate. */
export const TRUCK_LOOP: { x: number; z: number }[] = [
  { x: 0, z: 43 }, { x: -58, z: 43 }, { x: -58, z: -63 }, { x: 58, z: -63 }, { x: 58, z: 43 },
];
/** Seconds the truck idles at the first loop point (the gate) each lap. */
export const TRUCK_PAUSE = 7;
export const TRUCK_SPEED = 5.2;

// ---- South road: the vehicle checkpoint ------------------------------------------------------------------
export const CHECKPOINT = { z: 72, booth: { x: 7.6, z: 75, w: 2.6, d: 2.6, h: 2.6 }, apc: { x: -10.5, z: 77, w: 2.9, d: 7.4, h: 2.6 }, lamp: { x: 5, z: 70 } };
B({ x: CHECKPOINT.booth.x, z: CHECKPOINT.booth.z, w: CHECKPOINT.booth.w, d: CHECKPOINT.booth.d, h: CHECKPOINT.booth.h, ...hidden("booth") });
B({ x: CHECKPOINT.apc.x, z: CHECKPOINT.apc.z, w: CHECKPOINT.apc.w, d: CHECKPOINT.apc.d, h: CHECKPOINT.apc.h, ...hidden("apc", "metal") });
const sandbag = (x: number, z: number, w: number, d: number, tag = "sandbags") => B({ x, z, w, d, h: 1.05, color: SANDBAG, surface: "sand", style: "sandbags", tag });
sandbag(5.4, 68.6, 3.6, 0.9);
sandbag(-6.6, 69.2, 3.2, 0.9);

// ---- The approach: field walls, bales, rocks, the ruined farmhouse --------------------------------------
/** Dry-stone field walls (low cover; crouch behind them). [x0, z0, x1, z1] (axis aligned). */
export const FIELD_WALLS: [number, number, number, number][] = [
  [-70, 96, -34, 96], [-28, 96, -10, 96], [12, 98, 44, 98], [-70, 62, -46, 62], [-38, 62, -14, 62], [16, 60, 40, 60], [44, 60, 70, 60],
  [-14, 62.4, -14, 84], [24, 74, 24, 92],
];
for (const [x0, z0, x1, z1] of FIELD_WALLS) {
  const horiz = z0 === z1;
  B({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: horiz ? x1 - x0 : 0.7, d: horiz ? 0.7 : z1 - z0, h: 1.0, color: STONE, surface: "concrete", style: "hidden", tag: "drystone" });
}
/** Ruined farmhouse (solid shell, cover). */
export const FARMHOUSE = { x: -44, z: 80, w: 9, d: 7, h: 3.4 };
B({ x: FARMHOUSE.x, z: FARMHOUSE.z, w: FARMHOUSE.w, d: FARMHOUSE.d, h: FARMHOUSE.h, ...hidden("farmhouse", "concrete") });
for (const [x, z] of [[-26, 84], [-24.6, 84.2], [30, 84], [31.4, 84], [-56, 46], [36, 47]] as const) B({ x, z, w: 1.3, h: 1.3, d: 1.3, color: HAY, surface: "wood", style: "bale" });
for (const [x, z, w, h, d] of [
  [-8, 104, 3, 1.6, 2.4], [14, 112, 4, 2.0, 3], [-64, 78, 3.2, 1.8, 2.6], [52, 80, 3.6, 2.2, 3], [-30, 50, 2.6, 1.4, 2.2], [26, 50, 3, 1.5, 2.4],
  [-72, 30, 3, 1.8, 3], [72, 20, 3.4, 2, 3], [-74, -30, 3, 1.8, 2.6], [76, -40, 2.8, 1.6, 2.4], [30, -80, 3, 1.7, 2.6], [80, -86, 3.2, 1.9, 2.8],
] as const) B({ x, z, w, h, d, color: ROCK, surface: "sand", style: "rock" });

// ---- Inside the wire ---------------------------------------------------------------------------------------
/** South gate: a booth inside the opening; the boom is decor. */
export const GATE = { x: 0, z: FENCE.z1, booth: { x: 8.6, z: 31.4, w: 2.8, d: 2.8, h: 2.7 } };
B({ x: GATE.booth.x, z: GATE.booth.z, w: GATE.booth.w, d: GATE.booth.d, h: GATE.booth.h, ...hidden("gatebooth") });
sandbag(-8.6, 29.5, 3.8, 0.9);

/** Motor pool (west): vehicle shed against the wire, parked trucks, the APC, a fuel bowser. */
export const SHED = { x0: -46, x1: -30, z0: -6, z1: 6, h: 4.2 };
B({ x: SHED.x0 + 0.15, z: (SHED.z0 + SHED.z1) / 2, w: 0.3, d: SHED.z1 - SHED.z0, h: SHED.h, ...hidden("shed") });
for (const [x, z] of [[SHED.x1 - 0.2, SHED.z0 + 0.2], [SHED.x1 - 0.2, SHED.z1 - 0.2]] as const) B({ x, z, w: 0.3, d: 0.3, h: SHED.h, ...hidden("shedpost", "metal") });
export const PARKED: { x: number; z: number; yaw: number; kind: "truck" | "apc" | "bowser" }[] = [
  { x: -37, z: 0, yaw: Math.PI / 2, kind: "apc" },
  { x: -37, z: 15, yaw: Math.PI / 2, kind: "truck" },
  { x: -37, z: 23, yaw: Math.PI / 2, kind: "truck" },
  { x: -24, z: 25, yaw: 0, kind: "bowser" },
  { x: 33, z: -24, yaw: 0, kind: "truck" },
];
for (const v of PARKED) {
  const along = Math.abs(Math.sin(v.yaw)) > 0.7; // long axis along x
  const len = v.kind === "apc" ? 7.4 : v.kind === "bowser" ? 5.4 : 6.4;
  const wid = v.kind === "apc" ? 2.9 : 2.5;
  B({ x: v.x, z: v.z, w: along ? len : wid, d: along ? wid : len, h: v.kind === "apc" ? 2.6 : 2.8, ...hidden(v.kind, "metal") });
}
/** Barracks (east): long block, lit windows, door on the west side. */
export const BARRACKS = { x0: 26, x1: 44, z0: -12, z1: 12, h: 4.2 };
B({ x: (BARRACKS.x0 + BARRACKS.x1) / 2, z: (BARRACKS.z0 + BARRACKS.z1) / 2, w: BARRACKS.x1 - BARRACKS.x0, d: BARRACKS.z1 - BARRACKS.z0, h: BARRACKS.h, ...hidden("barracks") });
/** Generator shed and fuel tanks (north-east). */
export const GENERATOR = { x: 30, z: -38, w: 4, d: 3.2, h: 2.6 };
B({ x: GENERATOR.x, z: GENERATOR.z, w: GENERATOR.w, d: GENERATOR.d, h: GENERATOR.h, ...hidden("generator", "metal") });
for (const z of [-44, -48]) B({ x: 38, z, w: 6.4, h: 3, d: 3, color: 0x8e8a7e, surface: "metal", style: "tank" });
// Containers (cover across the yard).
for (const [x, z, w, d, c] of [
  [-14, 24, 6.1, 2.5, RUST],
  [16, 22, 2.5, 6.1, OLIVE],
  [20, -44, 6.1, 2.5, 0x5a6a74],
  [-28, -44, 2.5, 6.1, RUST],
  [-24, -20, 6.1, 2.5, OLIVE],
  [22, -8, 2.5, 6.1, 0x6a5a48],
] as const) B({ x, z, w, d, h: 2.6, color: c, surface: "metal", style: "container" });
// Crates and pallets.
for (const [x, z] of [[-8, 8], [-6.6, 8.2], [9, -6], [-18, -10], [12, 12], [-31, 26], [28, 16], [-4, -50], [6, -52]] as const) B({ x, z, w: 1.2, h: 1.0, d: 1.2, color: 0x9a8462, surface: "wood", style: "crate" });
/** Courtyard floodlight mast. */
export const MAST = { x: 0, z: 13 };
B({ x: MAST.x, z: MAST.z, w: 0.4, d: 0.4, h: 9, ...hidden("mast", "metal") });

// ---- The command house ---------------------------------------------------------------------------------------
/**
 * Front wing (ground level, rooms 4.6 m high) and rear wing on a 2.4 m stone
 * plinth (the upper floor). Walls are 0.3 m. Door gaps are 1.6 m (front),
 * 1.4 m inside; stairs are a 2.2 m lane of 0.4 m steps, 0.9 m deep.
 */
export const HQ = {
  x0: -14, x1: 14,
  /** Front wing z range and the rear wing (plinth) z range. */
  front: { z0: -30, z1: -18, h: 4.6 },
  rear: { z0: -44, z1: -30, h: 3.2 },
  plinth: 2.4,
  t: 0.3,
  stairHalf: 1.1,
  step: 0.9,
  rise: 0.4,
  /** Interior partitions (x) and their door gaps (z ranges). */
  front_part: 4,
  rear_part: 2.6,
  frontDoor: [-0.8, 0.8] as const,
  sideDoor: [-25.2, -23.8] as const,
  innerDoor: [-22.4, -21] as const,
  rearDoor: [-36.2, -34.8] as const,
};
export const HQ_ROOMS = {
  hall: { x0: -HQ.front_part, x1: HQ.front_part, z0: HQ.front.z0, z1: HQ.front.z1, y: 0 },
  radio: { x0: HQ.x0, x1: -HQ.front_part, z0: HQ.front.z0, z1: HQ.front.z1, y: 0 },
  mess: { x0: HQ.front_part, x1: HQ.x1, z0: HQ.front.z0, z1: HQ.front.z1, y: 0 },
  landing: { x0: -HQ.rear_part, x1: HQ.rear_part, z0: HQ.rear.z0, z1: HQ.rear.z1, y: HQ.plinth },
  maproom: { x0: HQ.x0, x1: -HQ.rear_part, z0: HQ.rear.z0, z1: HQ.rear.z1, y: HQ.plinth },
  office: { x0: HQ.rear_part, x1: HQ.x1, z0: HQ.rear.z0, z1: HQ.rear.z1, y: HQ.plinth },
};
/** Footprint the "enter the command house" objective checks (both wings). */
export const HQ_ZONE = { x0: HQ.x0 + HQ.t, x1: HQ.x1 - HQ.t, z0: HQ.rear.z0 + HQ.t, z1: HQ.front.z1 - HQ.t };
{
  const { x0, x1, t, plinth, rise, step, stairHalf: sh } = HQ;
  const F = HQ.front, R = HQ.rear;
  const wallX = (x: number, za: number, zb: number, y: number, h: number, tag = "hq") => B({ x, z: (za + zb) / 2, w: t, d: zb - za, y, h, ...hidden(tag, "concrete") });
  const wallZ = (z: number, xa: number, xb: number, y: number, h: number, tag = "hq") => B({ x: (xa + xb) / 2, z, w: xb - xa, d: t, y, h, ...hidden(tag, "concrete") });
  const DOOR_H = 2.3;
  // ---- Front wing walls (y 0 … F.h).
  const zs = F.z1 - t / 2;
  wallZ(zs, x0, HQ.frontDoor[0], 0, F.h);
  wallZ(zs, HQ.frontDoor[1], x1, 0, F.h);
  wallZ(zs, HQ.frontDoor[0], HQ.frontDoor[1], DOOR_H, F.h - DOOR_H, "header");
  // West wall with the side door; east wall solid. Side walls run from the plinth face to the south wall.
  wallX(x0 + t / 2, F.z0, HQ.sideDoor[0], 0, F.h);
  wallX(x0 + t / 2, HQ.sideDoor[1], F.z1 - t, 0, F.h);
  wallX(x0 + t / 2, HQ.sideDoor[0], HQ.sideDoor[1], DOOR_H, F.h - DOOR_H, "header");
  wallX(x1 - t / 2, F.z0, F.z1 - t, 0, F.h);
  // Partitions hall | radio room and hall | mess, each with a door.
  for (const sx of [-1, 1]) {
    const x = sx * HQ.front_part;
    wallX(x, F.z0, HQ.innerDoor[0], 0, F.h);
    wallX(x, HQ.innerDoor[1], F.z1 - t, 0, F.h);
    wallX(x, HQ.innerDoor[0], HQ.innerDoor[1], DOOR_H, F.h - DOOR_H, "header");
  }
  // Front roof.
  B({ x: (x0 + x1) / 2, z: (F.z0 + F.z1 + 0.3) / 2, w: x1 - x0 + 0.6, d: F.z1 + 0.3 - F.z0, y: F.h, h: 0.3, ...hidden("roof") });

  // ---- Rear wing plinth (solid, climbed by stacks) and both stairs.
  const n = Math.round(plinth / rise);
  for (let k = 1; k <= n; k++) {
    const y = (k - 1) * rise;
    B({ x: (x0 + x1) / 2, z: (R.z0 + R.z1) / 2, w: x1 - x0, d: R.z1 - R.z0, y, h: rise, ...hidden(k === n ? "plinth-top" : "plinth") });
    // Internal stair in the hall, climbing north to the plinth face.
    const inner = (n - k + 1) * step;
    B({ x: 0, z: R.z1 + inner / 2, w: sh * 2, d: inner, y, h: rise, ...hidden("stair") });
    // Exterior back stair, dropping north to the yard.
    B({ x: 0, z: R.z0 - inner / 2, w: sh * 2, d: inner, y, h: rise, ...hidden("stair") });
  }
  // ---- Rear wing walls (on the plinth, y plinth … plinth + R.h).
  const y0 = plinth;
  const top = y0 + R.h;
  const hdr = y0 + DOOR_H;
  wallZ(R.z1 - t / 2, x0, -sh, y0, R.h);
  wallZ(R.z1 - t / 2, sh, x1, y0, R.h);
  wallZ(R.z1 - t / 2, -sh, sh, hdr, top - hdr, "header");
  wallZ(R.z0 + t / 2, x0, -sh, y0, R.h);
  wallZ(R.z0 + t / 2, sh, x1, y0, R.h);
  wallZ(R.z0 + t / 2, -sh, sh, hdr, top - hdr, "header");
  wallX(x0 + t / 2, R.z0 + t, R.z1 - t, y0, R.h);
  wallX(x1 - t / 2, R.z0 + t, R.z1 - t, y0, R.h);
  for (const sx of [-1, 1]) {
    const x = sx * HQ.rear_part;
    wallX(x, R.z0 + t, HQ.rearDoor[0], y0, R.h);
    wallX(x, HQ.rearDoor[1], R.z1 - t, y0, R.h);
    wallX(x, HQ.rearDoor[0], HQ.rearDoor[1], hdr, top - hdr, "header");
  }
  B({ x: (x0 + x1) / 2, z: (R.z0 + R.z1) / 2, w: x1 - x0 + 0.6, d: R.z1 - R.z0 + 0.6, y: top, h: 0.3, ...hidden("roof") });

  // ---- Furniture (low obstacles and cover inside).
  const furn = (x: number, z: number, w: number, d: number, h: number, y: number, tag: string) => B({ x, z, w, d, h, y, ...hidden(tag, "wood") });
  furn(-10, -28.4, 3, 0.9, 0.8, 0, "radio-desk");
  furn(-12.9, -21, 0.9, 2.6, 1.9, 0, "radio-rack");
  furn(9, -24.5, 4, 1.2, 0.76, 0, "mess-table");
  furn(12.8, -28.6, 1.2, 1.6, 1.8, 0, "mess-shelf");
  furn(-8.4, -37, 3.2, 1.8, 0.86, y0, "map-table");
  furn(-12.9, -42, 0.9, 2.8, 1.9, y0, "map-cabinet");
  furn(9.2, -40.6, 2.4, 1.1, 0.8, y0, "desk");
  furn(13.1, -36, 0.9, 2.2, 1.9, y0, "office-cabinet");
}
/** The colonel's desk spot (where the target starts) and the office window. */
export const OFFICE = { desk: { x: 9.2, z: -39.3 }, window: { x: 12.2, z: -32.4 }, door: { x: 4, z: -35.5 } };

// ---- North field: treeline, the riverside track ------------------------------------------------------------
/** Tree trunks kept in play (colliders); the dressing adds canopies and many more out of bounds. */
export const TREES: [number, number][] = [
  // Insertion woods.
  [-30, 112], [-16, 108], [-36, 104], [-8, 118], [-44, 116], [-26, 122], [-2, 110], [-52, 108],
  // Approach field edges and the ditch.
  [-66, 70], [-60, 52], [-74, 88], [60, 70], [70, 50], [48, 108],
  // North treeline (between the back gate and the river).
  [-30, -78], [-20, -84], [-10, -76], [0, -86], [8, -80], [-40, -86], [-50, -78], [16, -88], [-60, -90], [26, -72], [36, -92], [44, -78],
  // East flank.
  [72, -10], [80, 8], [68, -60], [84, -66],
];
for (const [x, z] of TREES) B({ x, z, w: 0.6, d: 0.6, h: 4, ...hidden("tree", "wood") });

/** Bushes (visual + concealment). r = concealment radius. */
export const BUSHES: { x: number; z: number; r: number }[] = [
  // Screening the west fence cut.
  { x: -53.2, z: 4.2, r: 1.6 }, { x: -53.6, z: 10.6, r: 1.6 }, { x: -48.2, z: 3.6, r: 1.3 }, { x: -48, z: 11.2, r: 1.3 },
  // Along the ditch and field walls.
  { x: -62, z: 30, r: 1.5 }, { x: -60, z: 18, r: 1.4 }, { x: -66, z: 44, r: 1.5 }, { x: -44, z: 64, r: 1.4 }, { x: -20, z: 64, r: 1.3 },
  { x: 20, z: 63, r: 1.4 }, { x: 54, z: 40, r: 1.5 }, { x: 56, z: -14, r: 1.4 }, { x: 55, z: -28, r: 1.5 },
  // North yard and the exfil.
  { x: -10, z: -52, r: 1.2 }, { x: 24, z: -58.5, r: 1.4 }, { x: 10, z: -60, r: 1.3 }, { x: 40, z: -70, r: 1.5 }, { x: 50, z: -88, r: 1.5 },
  { x: 62, z: -94, r: 1.3 }, { x: 34, z: -100, r: 1.4 }, { x: -6, z: 92, r: 1.4 }, { x: 8, z: 86, r: 1.4 },
];

// ---- Ammo -----------------------------------------------------------------------------------------------------
export const AMMO = [{ x: -18, z: 112 }];
for (const c of AMMO) {
  B({ x: c.x, z: c.z, w: 1.4, h: 0.7, d: 0.9, color: OLIVE, surface: "metal", tag: "ammo" });
  B({ x: c.x, z: c.z, w: 1.2, h: 0.06, d: 0.2, y: 0.7, color: 0x111111, emissive: 0xffa73a, decor: true });
}

// ---------------------------------------------------------------------------------------------------------------
// Light and concealment (shared by the dressing and the stealth layer)
// ---------------------------------------------------------------------------------------------------------------

/** Static lights: position, reach (m) and strength at the source. Lamps are registered by the dressing too. */
export type LightSpot = { x: number; y: number; z: number; r: number; i: number; color: number; real?: boolean; indoor?: boolean };
export const LIGHTS: LightSpot[] = [
  // Courtyard flood (the big one) and the gate.
  { x: MAST.x, y: 8.6, z: MAST.z, r: 19, i: 1.15, color: 0xffe2b8, real: true },
  { x: -5.8, y: 3.6, z: 36.4, r: 9, i: 1, color: 0xffd8a0, real: true },
  { x: 5.8, y: 3.6, z: 36.4, r: 9, i: 1, color: 0xffd8a0 },
  // Checkpoint floodlight.
  { x: CHECKPOINT.lamp.x, y: 5, z: CHECKPOINT.lamp.z, r: 14, i: 1.05, color: 0xffe0b0, real: true },
  // Motor pool work light, barracks door, generator.
  { x: -32, y: 3.8, z: 3, r: 10, i: 0.9, color: 0xfff0d0, real: true },
  { x: 25.4, y: 3.2, z: 0, r: 8, i: 0.85, color: 0xffd090, real: true },
  { x: 27.6, y: 2.6, z: -38, r: 6, i: 0.6, color: 0xffd090 },
  // Command house: front door lamp and the rooms.
  { x: 0, y: 3.2, z: -17.3, r: 7, i: 0.9, color: 0xffd090, real: true },
  { x: 0, y: 3.8, z: -22, r: 6, i: 0.75, color: 0xffd8a8, real: true, indoor: true },
  { x: -9, y: 3.8, z: -24, r: 6, i: 0.65, color: 0xd8f0ff, real: true, indoor: true },
  { x: 9, y: 3.8, z: -24, r: 6, i: 0.7, color: 0xffd8a8, indoor: true },
  { x: 0, y: HQ.plinth + 2.7, z: -36, r: 5, i: 0.5, color: 0xffd8a8, indoor: true },
  { x: -8, y: HQ.plinth + 2.7, z: -37, r: 6, i: 0.75, color: 0xffd8a8, real: true, indoor: true },
  { x: 8.5, y: HQ.plinth + 2.7, z: -38, r: 6.5, i: 0.85, color: 0xffd0a0, real: true, indoor: true },
];
/** Moonlight everywhere outside the lamps (new moon: very dark). */
export const MOONLIGHT = 0.1;

/** Ground-level light at (x, y, z) from the static lamps (0 … 1, before searchlights / torches). */
export function staticLight(x: number, y: number, z: number) {
  let l = MOONLIGHT;
  for (const s of LIGHTS) {
    const dx = x - s.x, dz = z - s.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > s.r * s.r) continue;
    // Interior lamps light their own storey only (no leaking through floors).
    if (s.indoor && Math.abs(y - (s.y - 3.0)) > 1.2) continue;
    const k = 1 - Math.sqrt(d2) / s.r;
    l += s.i * k * k;
  }
  return Math.min(1, l);
}

const fract = (v: number) => v - Math.floor(v);
const hash = (x: number, z: number) => fract(Math.sin(x * 127.1 + z * 311.7) * 43758.5453);
function vnoise(x: number, z: number) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const fx = x - xi, fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}
const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The drainage ditch (reeds) from the woods up the west side to the wire. */
export const DITCH: [number, number][] = [[-70, 122], [-66, 96], [-62, 64], [-60, 36], [-56, 14], [-52, 8]];
function ditchDistance(x: number, z: number) {
  let best = Infinity;
  for (let i = 1; i < DITCH.length; i++) {
    const [ax, az] = DITCH[i - 1], [bx, bz] = DITCH[i];
    const vx = bx - ax, vz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)));
    best = Math.min(best, Math.hypot(x - (ax + vx * t), z - (az + vz * t)));
  }
  return best;
}

/** Distance to the dirt road (south road + perimeter loop + the road through the gate). */
export function roadDistance(x: number, z: number) {
  let d = z > FENCE.z1 - 2 ? Math.abs(x) : Infinity;
  const L = TRUCK_LOOP;
  for (let i = 0; i < L.length; i++) {
    const a = L[i], b = L[(i + 1) % L.length];
    const vx = b.x - a.x, vz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / (vx * vx + vz * vz)));
    d = Math.min(d, Math.hypot(x - (a.x + vx * t), z - (a.z + vz * t)));
  }
  return d;
}

/**
 * Tall grass / reed density at (x, z), 0 … 1. Crouching in density > 0.5
 * hides you from all but point-blank looks (see stealth/detection.ts). The
 * dressing plants its tall grass from this same function.
 */
export function tallGrassAt(x: number, z: number) {
  if (x < BOUNDS.x0 || x > BOUNDS.x1 || z < BOUNDS.z0 || z > BOUNDS.z1) return 0;
  if (roadDistance(x, z) < 4.5) return 0;
  const inWire = x > FENCE.x0 && x < FENCE.x1 && z > FENCE.z0 && z < FENCE.z1;
  const reeds = 1 - sstep(2.2, 4.4, ditchDistance(x, z));
  if (inWire) {
    // Weeds along the west wire behind the motor pool.
    return x < FENCE.x0 + 3.2 && z > -12 && z < 30 ? 0.75 : 0;
  }
  const n = vnoise(x * 0.07 + 3.1, z * 0.07 - 1.7) * 0.65 + vnoise(x * 0.19, z * 0.19 + 5) * 0.35;
  let field = 0;
  if (z > 44 && z < 106) field = x < -8 ? sstep(0.42, 0.55, n) : x > 10 ? sstep(0.5, 0.62, n) * 0.9 : 0;
  // North field (exfil): long grass east of the treeline.
  else if (z < -64 && z > -103 && x > 18 && x < 92) field = sstep(0.4, 0.52, n);
  // The verge outside the wire on the east and west.
  else if ((x < FENCE.x0 - 10 || x > FENCE.x1 + 10) && z < 40 && z > -100) field = sstep(0.5, 0.6, n) * 0.85;
  return Math.max(reeds, field);
}

/** Concealment at (x, z): tall grass / reeds or a bush, 0 … 1. */
export function concealmentAt(x: number, z: number) {
  let c = tallGrassAt(x, z);
  for (const b of BUSHES) {
    const d = Math.hypot(x - b.x, z - b.z);
    if (d < b.r) c = Math.max(c, 0.9 * (1 - (d / b.r) * 0.4));
  }
  return c;
}

// Bottom-up so the nav grid's floor pass climbs stacks in order.
boxes.sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.decor ? 1 : 0) - (b.decor ? 1 : 0));

export const GREYWATER: MapDef = {
  id: "greywater",
  name: "Greywater Depot",
  size: 260,
  groundColor: 0x4e5240,
  skyTop: 0x070b14,
  skyHorizon: 0x1c2434,
  fogNear: 40,
  fogFar: 220,
  // The "sun" is a low half-moon glow from the north-west.
  sunDirection: [-0.45, 0.42, -0.55],
  sunColor: 0x9db0d8,
  sunIntensity: 0.42,
  hemiSky: 0x33435e,
  hemiGround: 0x15170f,
  atmosphere: {
    fogDensity: 0.0125,
    fogColor: 0x1a2232,
    skyGround: 0x0c0e0c,
    hemiIntensity: 0.62,
    cloudCover: 0.35,
    envIntensity: 0.22,
    exposure: 1.32,
    grade: { saturation: 0.86, vibrance: 0.1, contrast: 0.3, gamma: 1.04, shadowTint: [0.86, 0.95, 1.12], highlightTint: [1.08, 1.0, 0.88], lift: 0.012 },
  },
  weather: { color: 0x3c4a2a, amount: 0.6 },
  dressing: "greywater",
  spawns: [INSERT],
  nav: NAV,
  boxes,
  targets: [],
  plates: [],
  signs: [
    { x: 6.8, y: 1.6, z: 36.2, text: "DEPOT 7", rotY: 0 },
    { x: -2.4, y: 1.7, z: 69.4, text: "HALT", rotY: 0 },
  ],
};

/**
 * Live state the mission writes each frame and the dressing's animated
 * extras read (searchlight sweep time, the patrol truck's pose). Kept here
 * so detection and visuals can't drift apart.
 */
export const GREYWATER_LIVE = {
  /** Mission clock (s) that drives the searchlight sweeps. */
  t: 0,
  truck: { x: TRUCK_LOOP[0].x, z: TRUCK_LOOP[0].z, yaw: -Math.PI / 2, lights: true, visible: true },
  /** Searchlights knocked out (index into SEARCHLIGHTS). */
  dead: [false, false, false, false],
};
