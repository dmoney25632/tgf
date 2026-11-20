import type { MapBox, MapDef } from "../MapLoader";

/**
 * Saltpan Gantry — an original desert salt and gravel works in the fictional
 * Harrow Pan, for Survival. A concrete-block retaining wall (±48 m) rings a
 * dusty yard. In the middle stands the rusted processing tower: two
 * climbable steel decks (3.6 m and 7.2 m) under a clad screen house and a
 * tall lattice crown. A long covered conveyor gallery runs east from the
 * tower down to a tail station, with a stepped maintenance stair alongside
 * it that bridges back onto the upper deck. Around the yard: a silo battery
 * (NW, fed by a second gallery), salt stockpile bays (NE), a gantry crane
 * over a container lane (SE), a concrete bunker, pump house and scrap
 * (SW), evaporation pans and brine pipes (W).
 *
 * x = east, z = south, y = up; box = centre + size. Structure visuals come
 * from dressing/saltpanGantry*.ts; their colliders here are "hidden" boxes.
 */
const CONCRETE = 0xcfc8b8;
const SANDBAG = 0xcdb98e;
const RUST = 0xb8734e;
const BLUE = 0x7f97ab;
const OLIVE = 0x9a9a6c;
const TAN = 0xd2bf94;
const RED = 0xa65a48;
const WHITE = 0xe2ddd0;
const WOOD = 0xd2c4ad;
const STEEL = 0xa4a6a8;
const ROCK = 0xbcaa8c;
const BARRIER = 0xd8d2c4;
const GREEN_SCREEN = 0x2bd36a;
const AMBER = 0xffa73a;

const boxes: MapBox[] = [];
const B = (b: MapBox) => boxes.push(b);
const hidden = (tag: string, surface: MapBox["surface"] = "metal") => ({ color: STEEL, surface, style: "hidden", tag }) as const;

// ---- Perimeter: concrete-block retaining wall (blocks drawn by the dressing) -----------
/** Inner face of the perimeter wall. */
export const WALL = { inner: 48, h: 4.8 };
for (const s of [-1, 1]) {
  B({ x: 0, z: s * (WALL.inner + 1), w: 100, h: WALL.h, d: 2, ...hidden("perimeter", "concrete") });
  B({ x: s * (WALL.inner + 1), z: 0, w: 2, h: WALL.h, d: 96, ...hidden("perimeter", "concrete") });
}

// ---- Processing tower ------------------------------------------------------------------
/**
 * 10 × 10 m steel frame. Deck 1 (top 3.6) and deck 2 (top 7.2) are walkable;
 * the clad screen house (6 × 6, to 16 m) and the lattice crown above are scenery.
 */
export const TOWER = { x: 0, z: -4, half: 5, col: 4.75, deck1: 3.6, deck2: 7.2, house: 3, houseTop: 16, crownTop: 31 };
const T = TOWER;
for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
  const cx = T.x + sx * T.col, cz = T.z + sz * T.col;
  // Stacked between the decks so nothing overlaps.
  B({ x: cx, z: cz, w: 0.5, d: 0.5, h: T.deck1 - 0.3, ...hidden("column") });
  B({ x: cx, z: cz, w: 0.5, d: 0.5, y: T.deck1, h: T.deck2 - 0.3 - T.deck1, ...hidden("column") });
  B({ x: cx, z: cz, w: 0.5, d: 0.5, y: T.deck2, h: T.houseTop - T.deck2, ...hidden("column") });
}
// Decks (tag "roof": the ground floor and deck 1 sit in their shade).
B({ x: T.x, z: T.z, w: 10, d: 10, y: T.deck1 - 0.3, h: 0.3, ...hidden("roof") });
B({ x: T.x + 0.75, z: T.z, w: 8.5, d: 10, y: T.deck2 - 0.3, h: 0.3, ...hidden("roof") });
B({ x: T.x - 4.25, z: T.z - 3, w: 1.5, d: 4, y: T.deck2 - 0.3, h: 0.3, ...hidden("deck") }); // west strip beside the stairwell
// Screen house on deck 2 and the conveyor head house on its east side.
B({ x: T.x, z: T.z, w: 6, d: 6, y: T.deck2, h: T.houseTop - T.deck2, ...hidden("house") });
export const HEAD = { x: T.x + 4.75, y: 10.5, z: -5.5, w: 3.5, h: 3.5, d: 3 };
B({ x: HEAD.x, z: HEAD.z, w: HEAD.w, d: HEAD.d, y: HEAD.y, h: HEAD.h, ...hidden("headhouse") });
// Ore hopper on deck 1 and its chute below (head height clear).
export const HOPPER = { x: T.x + 0.5, z: T.z, size: 2.6 };
B({ x: HOPPER.x, z: HOPPER.z, w: HOPPER.size, d: HOPPER.size, y: T.deck1, h: T.deck2 - 0.3 - T.deck1, ...hidden("hopper") });
B({ x: HOPPER.x, z: HOPPER.z, w: 1.2, d: 1.2, y: 2.0, h: T.deck1 - 0.3 - 2.0, ...hidden("chute") });
// Stair flight 1: ground → deck 1, from the east (9 rises of 0.4).
export const FLIGHT1 = { z: T.z + 3, x0: T.x + 5, run: 0.6, rise: 0.4, n: 9, width: 1.4 };
for (let i = 0; i < FLIGHT1.n; i++) {
  B({ x: FLIGHT1.x0 + FLIGHT1.run / 2 + FLIGHT1.run * (FLIGHT1.n - 1 - i), z: FLIGHT1.z, w: FLIGHT1.run, d: FLIGHT1.width, y: FLIGHT1.rise * i, h: FLIGHT1.rise, ...hidden("stair") });
}
// Stair flight 2: deck 1 → deck 2 along the west edge, climbing north.
export const FLIGHT2 = { x: T.x - 4.2, z0: T.z + 4.4, run: 0.6, rise: 0.4, n: 9, width: 1.4 };
for (let i = 0; i < FLIGHT2.n; i++) {
  B({ x: FLIGHT2.x, z: FLIGHT2.z0 - FLIGHT2.run / 2 - FLIGHT2.run * i, w: FLIGHT2.width, d: FLIGHT2.run, y: T.deck1 + FLIGHT2.rise * i, h: FLIGHT2.rise, ...hidden("stair") });
}
// Guard rails: collide at hip height only (bullets pass under).
const rail = (x: number, z: number, w: number, d: number, top: number) => B({ x, z, w, d, y: top + 0.85, h: 0.2, ...hidden("rail") });
rail(T.x, T.z - 4.95, 9, 0.1, T.deck1);
rail(T.x, T.z + 4.95, 9, 0.1, T.deck1);
rail(T.x - 4.95, T.z, 0.1, 9, T.deck1);
rail(T.x + 4.95, (T.z - 4.5 + FLIGHT1.z - 0.75) / 2, 0.1, FLIGHT1.z - 0.75 - (T.z - 4.5), T.deck1);
rail(T.x + 4.95, (FLIGHT1.z + 0.75 + T.z + 4.5) / 2, 0.1, T.z + 4.5 - (FLIGHT1.z + 0.75), T.deck1);

// ---- Conveyor gallery (east) with its maintenance stair and bridge ------------------------
/** Belt centreline from the head house down to the tail station (visual). */
export const CONVEYOR = { a: [T.x + 5.5, 12.5, -5.5] as const, b: [38.5, 1.35, -5.5] as const, width: 2.6, height: 2.3, trestles: [13, 21, 29] };
export const conveyorY = (x: number) => CONVEYOR.a[1] + ((x - CONVEYOR.a[0]) / (CONVEYOR.b[0] - CONVEYOR.a[0])) * (CONVEYOR.b[1] - CONVEYOR.a[1]);
for (const x of CONVEYOR.trestles) {
  const h = conveyorY(x) - 1.45;
  for (const z of [-7.3, -2.6]) B({ x, z, w: 0.4, d: 0.4, h, ...hidden("trestle") });
}
export const TAIL = { x: 37, z: -5.5, w: 8, d: 2.8, plinth: 1.6, h: 4 };
B({ x: TAIL.x, z: TAIL.z, w: TAIL.w, d: TAIL.d, h: TAIL.h, ...hidden("tail", "concrete") });
/** Stepped catwalk alongside the gallery (36 rises of 0.2) and the bridge onto deck 2. */
export const CATWALK = { z: -3.5, width: 1.2, xTop: 15.7, run: 0.59, rise: 0.2, n: 36 };
for (let i = 0; i < CATWALK.n; i++) {
  B({ x: CATWALK.xTop + CATWALK.run * (CATWALK.n - 1 - i) + CATWALK.run / 2, z: CATWALK.z, w: CATWALK.run, d: CATWALK.width, y: CATWALK.rise * i, h: CATWALK.rise, ...hidden("catwalk") });
}
export const BRIDGE = { x0: T.x + 5, x1: CATWALK.xTop, post: 10.5 };
B({ x: (BRIDGE.x0 + BRIDGE.x1) / 2, z: CATWALK.z, w: BRIDGE.x1 - BRIDGE.x0, d: CATWALK.width, y: T.deck2 - 0.3, h: 0.3, ...hidden("bridge") });
for (const s of [-1, 1]) rail((BRIDGE.x0 + BRIDGE.x1) / 2, CATWALK.z + s * 0.55, BRIDGE.x1 - BRIDGE.x0, 0.1, T.deck2);
B({ x: BRIDGE.post, z: CATWALK.z, w: 0.3, d: 0.3, h: T.deck2 - 0.3, ...hidden("bridgepost") });
// Deck 2 rails (gaps for the stairwell and the bridge).
rail(T.x, T.z - 4.95, 9, 0.1, T.deck2);
rail(T.x + 0.5, T.z + 4.95, 8, 0.1, T.deck2);
rail(T.x - 4.95, T.z - 2.75, 0.1, 3.5, T.deck2);
rail(T.x - 3.45, T.z + 1.95, 0.1, 5.9, T.deck2); // stairwell edge
rail(T.x + 4.95, (T.z - 4.5 + CATWALK.z - 0.65) / 2, 0.1, CATWALK.z - 0.65 - (T.z - 4.5), T.deck2);
rail(T.x + 4.95, (CATWALK.z + 0.65 + T.z + 4.5) / 2, 0.1, T.z + 4.5 - (CATWALK.z + 0.65), T.deck2);

// ---- Ground floor of the tower: concrete blast walls -------------------------------------
const wallC = { color: CONCRETE, surface: "concrete", mat: "concrete_dirty", tag: "blastwall" } as const;
B({ x: T.x, z: T.z - T.col, w: 9, d: 0.4, h: 1.2, ...wallC });
B({ x: T.x - T.col, z: T.z - 3, w: 0.4, d: 3, h: 1.2, ...wallC });
B({ x: T.x - T.col, z: T.z + 3, w: 0.4, d: 3, h: 1.2, ...wallC });
B({ x: T.x - 3.5, z: T.z + T.col, w: 2, d: 0.4, h: 1.2, ...wallC });
B({ x: T.x + 3.5, z: T.z + T.col, w: 2, d: 0.4, h: 1.2, ...wallC });

// ---- Second gallery to the silos (visual) and its support tower --------------------------
export const GALLERY2 = { a: [T.x - 3, 13.2, -6] as const, b: [-17, 15.4, -27.4] as const, tower: { x: -10, z: -16.7 } };
for (const sx of [-1, 1]) for (const sz of [-1, 1]) B({ x: GALLERY2.tower.x + sx, z: GALLERY2.tower.z + sz, w: 0.35, d: 0.35, h: 12.6, ...hidden("g2leg") });

// ---- Silo battery (NW) -------------------------------------------------------------------------
export const SILOS = [
  { x: -32, z: -30, r: 3.2, h: 14 },
  { x: -24.5, z: -30, r: 3.2, h: 14 },
  { x: -17, z: -30, r: 3.2, h: 14 },
];
for (const s of SILOS) {
  const silo = { h: s.h, ...hidden("silo") };
  B({ x: s.x, z: s.z, w: s.r * 1.96, d: s.r * 0.8, ...silo });
  B({ x: s.x, z: s.z, w: s.r * 0.8, d: s.r * 1.96, ...silo });
  B({ x: s.x, z: s.z, w: s.r * 1.44, d: s.r * 1.44, ...silo });
}

// ---- Salt stockpile bays (NE): block walls, a heap in each bay ----------------------------
export const BAYS = { x0: 12, x1: 34, back: -36.4, front: -29, walls: [12.4, 19.73, 27.07, 33.6], h: 2.4 };
B({ x: (BAYS.x0 + BAYS.x1) / 2, z: BAYS.back, w: BAYS.x1 - BAYS.x0, d: 0.8, h: BAYS.h, ...hidden("bay", "concrete") });
for (const x of BAYS.walls) B({ x, z: (BAYS.back + 0.4 + BAYS.front) / 2, w: 0.8, d: BAYS.front - BAYS.back - 0.4, h: BAYS.h, ...hidden("bay", "concrete") });
export const HEAPS = [0, 1, 2].map((i) => ({ x: (BAYS.walls[i] + BAYS.walls[i + 1]) / 2, z: -32.4, w: 5, d: 4.4, h: 1.8 }));
for (const h of HEAPS) B({ x: h.x, z: h.z, w: h.w, d: h.d, h: h.h, ...hidden("heap", "dirt") });

// ---- Gantry crane over the container lane (SE) ---------------------------------------------
export const CRANE = { x0: 13, x1: 35, z0: 17, z1: 31, h: 12.5 };
for (const x of [CRANE.x0, CRANE.x1]) {
  for (const z of [CRANE.z0, CRANE.z1]) B({ x, z, w: 0.8, d: 0.8, h: CRANE.h, ...hidden("craneleg") });
  B({ x, z: (CRANE.z0 + CRANE.z1) / 2, w: 0.7, d: CRANE.z1 - CRANE.z0 - 0.8, h: 0.4, ...hidden("cranesill") });
}
/** Container hanging from the crane's spreader, over the open lane. */
export const HUNG = { x: 24, z: 24, y: 6.2 };
B({ x: HUNG.x, z: HUNG.z, w: 6, h: 2.6, d: 2.4, y: HUNG.y, color: RED, surface: "metal", style: "container", tag: "hung" });

// ---- Containers -------------------------------------------------------------------------------
const containers: [number, number, number, number, number, number?][] = [
  // x, z, w, d, colour, y
  [17.5, 20.5, 6, 2.4, RUST],
  [17.5, 20.5, 6, 2.4, BLUE, 2.6],
  [17.5, 27.5, 6, 2.4, OLIVE],
  [30.5, 20.5, 6, 2.4, TAN],
  [30.5, 27.5, 6, 2.4, BLUE],
  [30.5, 27.5, 6, 2.4, RUST, 2.6],
  [10, -24, 2.4, 6, RUST],
  [-38, 22, 6, 2.4, OLIVE],
  [-38, 22, 6, 2.4, WHITE, 2.6],
  [40, 30, 2.4, 6, TAN],
  [-8, -30, 6, 2.4, BLUE],
];
for (const [x, z, w, d, color, y] of containers) B({ x, z, w, h: 2.6, d, y, color, surface: "metal", style: "container" });

// ---- SW: concrete bunker, pump house, haul truck, scrap -------------------------------------
export const BUNKER = { x: -17, z: 12, w: 7, d: 5, h: 2.4, t: 0.5 };
{
  const b = BUNKER, c = { color: CONCRETE, surface: "concrete", mat: "concrete_dirty", tag: "bunker" } as const;
  const zN = b.z - b.d / 2 + b.t / 2, zS = b.z + b.d / 2 - b.t / 2;
  const seg = (b.w - 1.6) / 2;
  B({ x: b.x - b.w / 2 + seg / 2, z: zN, w: seg, d: b.t, h: b.h, ...c });
  B({ x: b.x + b.w / 2 - seg / 2, z: zN, w: seg, d: b.t, h: b.h, ...c });
  B({ x: b.x, z: zS, w: b.w, d: b.t, h: 1.25, ...c });
  B({ x: b.x, z: zS, w: b.w, d: b.t, y: 1.7, h: b.h - 1.7, ...c }); // firing slit 1.25–1.7
  for (const s of [-1, 1]) B({ x: b.x + s * (b.w / 2 - b.t / 2), z: b.z, w: b.t, d: b.d - 2 * b.t, h: b.h, ...c });
  B({ x: b.x, z: b.z, w: b.w + 0.4, d: b.d + 0.4, y: b.h, h: 0.35, color: CONCRETE, surface: "concrete", mat: "concrete_dirty", tag: "roof" });
}
export const PUMPHOUSE = { x: -31, z: 28, w: 6, d: 4.5, h: 3.2 };
B({ ...PUMPHOUSE, color: 0xd8cdb6, surface: "concrete", mat: "concrete_dirty", tag: "pumphouse" });
export const TRUCK = { x: -4, z: 31, w: 8.6, d: 3, h: 3.2 };
B({ ...TRUCK, ...hidden("truck") });
export const SCRAP = [
  { x: -37, z: 37, w: 5, d: 4, h: 1.3 },
  { x: 37, z: 37, w: 4, d: 5, h: 1.3 },
  { x: -10, z: -39, w: 4.5, d: 3.5, h: 1.2 },
];
for (const s of SCRAP) B({ ...s, ...hidden("scrap") });
B({ x: -36, z: -12, w: 2.4, h: 2.4, d: 6, color: WHITE, surface: "metal", style: "tank" });

// ---- W: evaporation pans (flat, drawn by the dressing) and brine pipes -----------------------
export const PANS = { x0: -43, x1: -30, z0: -6, z1: 14 };
const pipeRun = (x: number, z: number, alongX: boolean, len: number) =>
  B({ x, z, w: alongX ? len : 0.9, h: 0.9, d: alongX ? 0.9 : len, color: STEEL, surface: "metal", style: "hidden", tag: alongX ? "pipeX" : "pipeZ" });
pipeRun(-27, 0, false, 12);
pipeRun(-35, 17, true, 10);
pipeRun(22, -14, true, 10);
pipeRun(-22, -16, true, 8);

// ---- Cover around the tower --------------------------------------------------------------
const sandbags = (x: number, z: number, along: "x" | "z", len = 4) =>
  B({ x, z, w: along === "x" ? len : 0.9, h: 1.05, d: along === "z" ? len : 0.9, color: SANDBAG, surface: "sand", style: "sandbags" });
sandbags(-9, 6, "z", 3);
sandbags(9, 6, "x");
sandbags(4, -13.5, "x", 3);
sandbags(-8, -13.5, "x", 3);
sandbags(-24, 2, "z", 3);
sandbags(26, -2, "z", 3);
sandbags(2, 22, "x", 4);
const barrier = (x: number, z: number, along: "x" | "z") => B({ x, z, w: along === "x" ? 3 : 0.7, h: 1.15, d: along === "z" ? 3 : 0.7, color: BARRIER, style: "barrier" });
barrier(-12, -2, "z");
barrier(14, -18, "x");
barrier(0, 26, "x");
barrier(-20, -8, "x");
barrier(22, 7, "z");
barrier(-24, 24, "x");
barrier(30, -20, "z");
// Squat concrete blocks at the tower base.
for (const [x, z, w, d] of [[-3.5, 6.5, 2, 1], [3.8, 10.5, 1, 2], [-6.5, -10.5, 1, 2], [11, -9, 2, 1]] as const) {
  B({ x, z, w, h: 1.5, d, color: CONCRETE, surface: "concrete", mat: "concrete_dirty", tag: "block" });
}

// Flood-light poles (lamps drawn by the dressing).
export const LIGHTS = [{ x: -14, z: 20 }, { x: 6, z: -20 }, { x: 30, z: 10 }, { x: -24, z: -6 }];
for (const l of LIGHTS) B({ x: l.x, z: l.z, w: 0.35, h: 9, d: 0.35, ...hidden("lightpole") });

// Supply crates.
for (const [x, z, h] of [[-6.5, 9.2, 1.2], [7.5, -16, 1.2], [16, 12, 0.9], [-15, -12, 0.9], [26, 14, 1.2], [-28, -14, 1.2], [-40, 30, 1.2], [8, 40, 1.2], [-26, 36, 0.9]] as const) {
  B({ x, z, w: 1.2, h, d: 1.2, color: WOOD, surface: "wood", style: "crate", tag: "supply" });
}
// Drums.
const drums: [number, number, "Barrel_01" | "barrel_03"][] = [
  [-6.2, 4.9, "Barrel_01"], [6.8, 7.6, "barrel_03"], [7.6, 8.2, "Barrel_01"], [-12.2, 9.6, "barrel_03"],
  [-29.4, 24.8, "Barrel_01"], [-28.6, 25.0, "barrel_03"], [33.8, -0.8, "Barrel_01"], [20.6, 15.4, "barrel_03"],
  [-21.5, -21.2, "Barrel_01"], [12.2, -20.6, "barrel_03"], [2.6, -11.4, "Barrel_01"],
];
drums.forEach(([x, z, model], i) => B({ x, z, w: 0.62, h: 0.9, d: 0.62, color: i % 2 ? 0x7d8a6a : 0x8a5a40, surface: "metal", style: "model", model, rotY: i * 1.3 }));
B({ x: -2.6, z: 4.6, w: 1.5, h: 0.3, d: 0.5, color: OLIVE, surface: "wood", style: "model", model: "old_military_crate" });
B({ x: 12.4, z: 2.2, w: 1.5, h: 0.3, d: 0.5, color: OLIVE, surface: "wood", style: "model", model: "old_military_crate", rotY: 1.2 });

// ---- Buy stations + ammo crates --------------------------------------------------------
const stations = [
  { x: -7.5, z: 3, name: "Hoist Armory" },
  { x: 8.5, z: -12.5, name: "Brine Armory" },
];
for (const s of stations) {
  B({ x: s.x, z: s.z, w: 1.4, h: 1.3, d: 0.9, color: STEEL, surface: "metal", mat: "metal_dark", tag: "station" });
  B({ x: s.x, z: s.z, w: 1.0, h: 0.5, d: 0.08, y: 1.35, color: 0x0c1a10, emissive: GREEN_SCREEN, decor: true });
  B({ x: s.x, z: s.z, w: 0.08, h: 2.6, d: 0.08, y: 0, color: STEEL, mat: "metal_dark", decor: true });
  B({ x: s.x, z: s.z, w: 0.3, h: 0.12, d: 0.3, y: 2.6, color: 0x111111, emissive: GREEN_SCREEN, decor: true });
}
const crates = [
  { x: 3.5, z: 13 },
  { x: -13, z: -6 },
  { x: 15, z: 5 },
  { x: -2, z: -16 },
];
for (const c of crates) {
  B({ x: c.x, z: c.z, w: 1.4, h: 0.7, d: 0.9, color: OLIVE, surface: "metal", tag: "ammo" });
  B({ x: c.x, z: c.z, w: 1.2, h: 0.06, d: 0.2, y: 0.7, color: 0x111111, emissive: AMBER, decor: true });
}

// ---- Rocks along the wall and the steel scaffold sniper perches in the corners -------------
const rocks: [number, number, number, number, number][] = [
  [-42, -38, 3, 1.6, 2.6], [40, -38, 3, 1.8, 2.5], [-44.5, 6, 2.2, 1.2, 3], [42, 16, 2.5, 1.4, 3.2], [-14, 43, 3.5, 1.5, 2.4], [14, -44.5, 3, 1.3, 2.2],
];
for (const [x, z, w, h, d] of rocks) B({ x, z, w, h, d, color: ROCK, surface: "sand", style: "rock" });

const perches = [
  { x: -43, y: 6, z: -43 },
  { x: 43, y: 6, z: -43 },
  { x: 43, y: 6, z: 43 },
  { x: -43, y: 6, z: 43 },
];
for (const p of perches) {
  B({ x: p.x, z: p.z, w: 4, h: p.y, d: 4, ...hidden("perch") });
  B({ x: p.x - Math.sign(p.x) * 1.6, z: p.z - Math.sign(p.z) * 1.6, w: 0.8, h: 0.9, d: 0.8, y: p.y, color: SANDBAG, surface: "sand", style: "sandbags" });
}

export const SALTPAN_GANTRY: MapDef = {
  id: "saltpan-gantry",
  name: "Saltpan Gantry",
  size: 100,
  groundColor: 0xb09468,
  skyTop: 0x5f86b4,
  skyHorizon: 0xdcd0b4,
  fogNear: 80,
  fogFar: 360,
  sunDirection: [0.42, 0.78, 0.46],
  sunColor: 0xffe6c0,
  sunIntensity: 3.6,
  hemiSky: 0xc4d4e6,
  hemiGround: 0x9a7c52,
  atmosphere: {
    fogDensity: 0.0036,
    fogColor: 0xdccdb0,
    skyGround: 0x9a8462,
    hemiIntensity: 0.62,
    cloudCover: 0.3,
    envIntensity: 0.45,
    exposure: 1.0,
  },
  dressing: "saltpanGantry",
  spawns: [{ x: 0, z: 8, yaw: 0 }],
  boxes,
  targets: [],
  plates: [],
  signs: [
    { x: -7.5, y: 2.2, z: 3.5, text: "ARMORY [F]" },
    { x: 8.5, y: 2.2, z: -13.0, text: "ARMORY [F]", rotY: Math.PI },
  ],
  survival: {
    enemySpawns: [
      { x: -20, z: -44 }, { x: 0, z: -44 }, { x: 22, z: -44 },
      { x: -20, z: 44 }, { x: 0, z: 44 }, { x: 20, z: 44 },
      { x: -44, z: -24 }, { x: -44, z: 0 }, { x: -44, z: 22 },
      { x: 44, z: -22 }, { x: 44, z: 6 }, { x: 44, z: 24 },
    ],
    perches,
    buyStations: stations,
    ammoCrates: crates,
    inner: 30,
  },
};
