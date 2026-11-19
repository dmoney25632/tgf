import type { MapBox, MapDef } from "../MapLoader";

/**
 * Dustfall Outpost — an original desert forward operating base for Survival.
 * A walled compound (±32 m, four gates) around a central ops building, with
 * a watchtower and a container stack for height, sandbag and barrier lanes,
 * and open desert outside where enemies muster. Sniper ridges sit beyond the
 * corners. x = east, z = south, y = up; box = center + size.
 */
const WALL = 0xa89a7c;
const WALL_DARK = 0x8a7e66;
const CONCRETE = 0x9a958a;
const SAND = 0xb59e74;
const SANDBAG = 0x9c8a62;
const RUST = 0x8a4a2a;
const BLUE = 0x34506a;
const OLIVE = 0x56603e;
const TAN = 0x9a8460;
const WOOD = 0x7a5a32;
const STEEL = 0x3a3c3e;
const ROCK = 0x8c7a60;
const ROOF = 0x7f7a70;
const GREEN_SCREEN = 0x2bd36a;
const AMBER = 0xffa73a;

const boxes: MapBox[] = [];
const B = (b: MapBox) => boxes.push(b);

// ---- Compound wall with gates (N, S, E, W) -------------------------------------
const R = 32;
const GATE = 7;
const WALL_H = 3.2;
for (const side of [-1, 1]) {
  const seg = R - GATE / 2;
  // North/South walls (along x).
  B({ x: -(GATE / 2 + seg / 2), z: side * R, w: seg, h: WALL_H, d: 0.7, color: WALL });
  B({ x: GATE / 2 + seg / 2, z: side * R, w: seg, h: WALL_H, d: 0.7, color: WALL });
  // East/West walls (along z).
  B({ x: side * R, z: -(GATE / 2 + seg / 2), w: 0.7, h: WALL_H, d: seg, color: WALL });
  B({ x: side * R, z: GATE / 2 + seg / 2, w: 0.7, h: WALL_H, d: seg, color: WALL });
  // Gate pillars.
  for (const g of [-1, 1]) {
    B({ x: g * (GATE / 2 + 0.5), z: side * R, w: 1.1, h: 3.8, d: 1.1, color: WALL_DARK });
    B({ x: side * R, z: g * (GATE / 2 + 0.5), w: 1.1, h: 3.8, d: 1.1, color: WALL_DARK });
  }
}
// Corner guard posts.
for (const sx of [-1, 1]) for (const sz of [-1, 1]) B({ x: sx * R, z: sz * R, w: 2, h: 4.2, d: 2, color: WALL_DARK });

// Outer berm (map bounds) — tall sand ridges.
const OUT = 49;
for (const side of [-1, 1]) {
  B({ x: 0, z: side * OUT, w: 100, h: 6, d: 2, color: SAND, surface: "sand" });
  B({ x: side * OUT, z: 0, w: 2, h: 6, d: 100, color: SAND, surface: "sand" });
}

// ---- Central ops building (12 × 10, doors N/S, windows E/W) ---------------------
const OW = 12, OD = 10, OH = 3.2, T = 0.35;
// North + south walls with 2.4 m doors.
for (const z of [-OD / 2, OD / 2]) {
  B({ x: -3.6, z, w: 4.8, h: OH, d: T, color: CONCRETE });
  B({ x: 3.6, z, w: 4.8, h: OH, d: T, color: CONCRETE });
  B({ x: 0, z, w: 2.4, h: OH - 2.3, d: T, y: 2.3, color: CONCRETE }); // lintel
}
// East + west walls with two windows each.
for (const x of [-OW / 2, OW / 2]) {
  B({ x, z: 0, w: T, h: OH, d: 2.4, color: CONCRETE });
  B({ x, z: -4.1, w: T, h: OH, d: 1.8, color: CONCRETE });
  B({ x, z: 4.1, w: T, h: OH, d: 1.8, color: CONCRETE });
  for (const z of [-2.2, 2.2]) {
    B({ x, z, w: T, h: 1.0, d: 2.0, color: CONCRETE }); // sill
    B({ x, z, w: T, h: OH - 2.1, d: 2.0, y: 2.1, color: CONCRETE }); // head
  }
}
B({ x: 0, z: 0, w: OW + 0.4, h: 0.3, d: OD + 0.4, y: OH, color: ROOF }); // roof
// Interior: desks, a map table and lockers.
B({ x: -3.5, z: -2.5, w: 2.2, h: 0.85, d: 1, color: WOOD, surface: "wood" });
B({ x: 3.5, z: 2.5, w: 2.2, h: 0.85, d: 1, color: WOOD, surface: "wood" });
B({ x: 0, z: 0, w: 2.6, h: 0.95, d: 1.6, color: OLIVE, surface: "metal" });
B({ x: -5.4, z: 3.5, w: 0.6, h: 2, d: 2, color: STEEL, surface: "metal" });
B({ x: 5.4, z: -3.5, w: 0.6, h: 2, d: 2, color: STEEL, surface: "metal" });


// ---- Watchtower (NW) with stairs up to a 3.9 m deck -----------------------------
const TX = -20, TZ = -20;
for (const dx of [-1.8, 1.8]) for (const dz of [-1.8, 1.8]) B({ x: TX + dx, z: TZ + dz, w: 0.35, h: 3.6, d: 0.35, color: WOOD, surface: "wood" });
B({ x: TX, z: TZ, w: 4.4, h: 0.3, d: 4.4, y: 3.6, color: WOOD, surface: "wood" }); // deck (top 3.9)
B({ x: TX, z: TZ - 2.1, w: 4.4, h: 1.0, d: 0.2, y: 3.9, color: WOOD, surface: "wood" }); // parapets
B({ x: TX - 2.1, z: TZ, w: 0.2, h: 1.0, d: 4.4, y: 3.9, color: WOOD, surface: "wood" });
B({ x: TX, z: TZ + 2.1, w: 4.4, h: 1.0, d: 0.2, y: 3.9, color: WOOD, surface: "wood" });
B({ x: TX, z: TZ, w: 4.8, h: 0.2, d: 4.8, y: 6.1, color: OLIVE }); // canopy
for (const dx of [-2.1, 2.1]) for (const dz of [-2.1, 2.1]) B({ x: TX + dx, z: TZ + dz, w: 0.15, h: 1.2, d: 0.15, y: 4.9, color: WOOD, surface: "wood" });
// 13 solid steps of 0.3 m heading east from the deck.
for (let i = 0; i < 13; i++) {
  B({ x: TX + 2.2 + 0.3 + 0.6 * (12 - i), z: TZ + 1.2, w: 0.6, h: 0.3 * (i + 1), d: 1.4, color: WALL_DARK });
}

// ---- Container stack (SE) with crate steps to the roof ------------------------------
B({ x: 20, z: 18, w: 6, h: 2.6, d: 2.4, color: RUST, surface: "metal" });
B({ x: 20, z: 20.5, w: 6, h: 2.6, d: 2.4, color: BLUE, surface: "metal" });
B({ x: 21.8, z: 19.2, w: 2.4, h: 1.1, d: 4.8, y: 2.6, color: OLIVE, surface: "metal" }); // roof cover
const crateSteps = [0.43, 0.86, 1.29, 1.72, 2.15];
// Crate steps (each within the 0.45 m step-up) running west of the stack.
crateSteps.forEach((h, i) => B({ x: 11.2 + i * 1.2, z: 18.6, w: 1.2, h, d: 1.4, color: WOOD, surface: "wood" }));

// ---- Containers & cover around the yard -------------------------------------------
const containers: [number, number, number, number, number][] = [
  // x, z, w, d, color
  [-18, 12, 6, 2.4, BLUE],
  [-24, 4, 2.4, 6, RUST],
  [14, -14, 6, 2.4, OLIVE],
  [24, -6, 2.4, 6, TAN],
  [-10, 24, 6, 2.4, RUST],
  [8, -24, 6, 2.4, BLUE],
];
for (const [x, z, w, d, color] of containers) B({ x, z, w, h: 2.6, d, color, surface: "metal" });

// Sandbag nests behind each gate (crouch cover, 1.05 m).
const sandbags = (x: number, z: number, along: "x" | "z", len = 4) =>
  B({ x, z, w: along === "x" ? len : 0.9, h: 1.05, d: along === "z" ? len : 0.9, color: SANDBAG, surface: "sand" });
sandbags(-5, -24, "x"); sandbags(5, -24, "x");
sandbags(-5, 24, "x"); sandbags(5, 24, "x");
sandbags(-24, -5, "z"); sandbags(-24, 5, "z");
sandbags(24, -5, "z"); sandbags(24, 5, "z");
sandbags(0, -14, "x", 5);
sandbags(0, 14, "x", 5);

// Concrete barriers forming lanes.
const barrier = (x: number, z: number, along: "x" | "z") => B({ x, z, w: along === "x" ? 3 : 0.7, h: 1.15, d: along === "z" ? 3 : 0.7, color: 0xb8b2a4 });
barrier(-12, -6, "z"); barrier(12, 6, "z"); barrier(-12, 6, "z"); barrier(12, -6, "z");
barrier(-6, -18, "x"); barrier(6, 18, "x");
barrier(-26, -16, "x"); barrier(26, 16, "x"); barrier(-26, 20, "z"); barrier(26, -22, "z");

// Low walls / generator / fuel tanks.
B({ x: -14, z: -26, w: 5, h: 1.4, d: 0.6, color: WALL_DARK });
B({ x: 16, z: 26, w: 5, h: 1.4, d: 0.6, color: WALL_DARK });
B({ x: 26, z: 26, w: 2.6, h: 1.8, d: 1.6, color: OLIVE, surface: "metal" }); // generator
B({ x: -27, z: 26, w: 2, h: 2, d: 2, color: STEEL, surface: "metal" }); // fuel tank
B({ x: -27, z: 23.5, w: 2, h: 2, d: 2, color: STEEL, surface: "metal" });
// Supply crates scattered for cover.
for (const [x, z, h] of [[-8, 8, 1.2], [9, -9, 1.2], [-16, -10, 0.9], [17, 9, 0.9], [-7, -28, 1.2], [7, 28, 1.2], [28, -10, 1.2], [-28, 10, 1.2]] as const) {
  B({ x, z, w: 1.2, h, d: 1.2, color: WOOD, surface: "wood" });
}

// ---- Buy stations (glowing terminals) + ammo crates ---------------------------------
const stations = [
  { x: -8.6, z: 0, name: "West Armory" },
  { x: 8.6, z: 0, name: "East Armory" },
];
for (const s of stations) {
  B({ x: s.x, z: s.z, w: 1.4, h: 1.3, d: 0.9, color: STEEL, surface: "metal" });
  B({ x: s.x, z: s.z, w: 1.0, h: 0.5, d: 0.08, y: 1.35, color: 0x0c1a10, emissive: GREEN_SCREEN, decor: true });
  B({ x: s.x, z: s.z, w: 0.08, h: 2.6, d: 0.08, y: 0, color: STEEL, decor: true });
  B({ x: s.x, z: s.z, w: 0.3, h: 0.12, d: 0.3, y: 2.6, color: 0x111111, emissive: GREEN_SCREEN, decor: true });
}
const crates = [
  { x: 0, z: -9 },
  { x: 0, z: 9 },
  { x: -20, z: -13 },
  { x: 20, z: 13 },
];
for (const c of crates) {
  B({ x: c.x, z: c.z, w: 1.4, h: 0.7, d: 0.9, color: OLIVE, surface: "metal" });
  B({ x: c.x, z: c.z, w: 1.2, h: 0.06, d: 0.2, y: 0.7, color: 0x111111, emissive: AMBER, decor: true });
}

// ---- Outside: rocks, wrecks and sniper ridges --------------------------------------
const rocks: [number, number, number, number, number][] = [
  [-40, -10, 3, 2.2, 4], [38, 12, 4, 1.8, 3], [-12, 40, 5, 1.6, 2.5], [14, -40, 4, 2.0, 3],
  [40, -28, 3, 1.4, 3], [-38, 28, 3, 1.5, 4], [-30, -40, 4, 1.8, 2], [30, 40, 3, 2.2, 3],
];
for (const [x, z, w, h, d] of rocks) B({ x, z, w, h, d, color: ROCK, surface: "sand" });
B({ x: 40, z: -2, w: 4.5, h: 1.8, d: 2.2, color: 0x5a4a3a, surface: "metal" }); // burnt truck
B({ x: 40.2, z: -2, w: 1.6, h: 1.0, d: 2.0, y: 1.8, color: 0x4a3a2a, surface: "metal" });
B({ x: -40, z: 6, w: 2.2, h: 1.8, d: 4.5, color: 0x5a4a3a, surface: "metal" });

const perches = [
  { x: -43, y: 6, z: -43 },
  { x: 43, y: 6, z: -43 },
  { x: 43, y: 6, z: 43 },
  { x: -43, y: 6, z: 43 },
];
for (const p of perches) {
  B({ x: p.x, z: p.z, w: 5, h: p.y, d: 5, color: ROCK, surface: "sand" });
  B({ x: p.x - Math.sign(p.x) * 2.3, z: p.z - Math.sign(p.z) * 2.3, w: 0.8, h: 0.9, d: 0.8, y: p.y, color: SANDBAG, surface: "sand" });
}

export const DUSTFALL_OUTPOST: MapDef = {
  id: "dustfall-outpost",
  name: "Dustfall Outpost",
  size: 100,
  groundColor: 0xb09a72,
  skyTop: 0x4f7fb8,
  skyHorizon: 0xe6c9a0,
  fogNear: 55,
  fogFar: 260,
  sunDirection: [-0.55, 0.55, 0.3],
  sunColor: 0xffd6a0,
  sunIntensity: 2.9,
  hemiSky: 0xd8e2ee,
  hemiGround: 0x8a6a48,
  spawns: [{ x: 0, z: 2.5, yaw: 0 }],
  boxes,
  targets: [],
  plates: [],
  signs: [
    { x: -8.6, y: 2.2, z: 0.5, text: "ARMORY [F]" },
    { x: 8.6, y: 2.2, z: 0.5, text: "ARMORY [F]" },
  ],
  survival: {
    enemySpawns: [
      { x: -44, z: -20 }, { x: -44, z: 0 }, { x: -44, z: 20 },
      { x: 44, z: -20 }, { x: 44, z: 0 }, { x: 44, z: 20 },
      { x: -20, z: -44 }, { x: 0, z: -44 }, { x: 20, z: -44 },
      { x: -20, z: 44 }, { x: 0, z: 44 }, { x: 20, z: 44 },
    ],
    perches,
    buyStations: stations,
    ammoCrates: crates,
    inner: R,
  },
};
