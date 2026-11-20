import type { MapBox, MapDef } from "../MapLoader";

/**
 * Cinder Flats Refinery — an original desert oil-field yard in the fictional
 * Sarrow Basin, for Survival and the mission campaign. A sand-bermed yard
 * (±49 m) around a concrete control shack, with four storage tanks in the
 * corners, nodding pump jacks out in the east and west fields, knee-high
 * pipe runs for crouch cover, an overhead pipe rack, separator vessels,
 * container stacks, flood-light towers and scaffold sniper perches.
 *
 * Lanes: a north–south road and an east–west road cross at the shack; the
 * low pipe runs split each half into an inner lane (cover close to the
 * shack) and an outer field (long sight lines between pump jacks).
 * x = east, z = south, y = up; box = centre + size. Visuals for the tanks,
 * pump jacks, pipe racks and light towers come from dressing/cinderFlats.ts
 * (their colliders here are "hidden" boxes).
 */
const CONCRETE = 0xcfc8b8;
const PLASTER = 0xd6ccb6;
const SAND = 0xcdb68c;
const SANDBAG = 0xcdb98e;
const RUST = 0xc27c55;
const BLUE = 0x7f97ab;
const OLIVE = 0x9a9a6c;
const TAN = 0xd2bf94;
const WHITE = 0xe2ddd0;
const WOOD = 0xd2c4ad;
const STEEL = 0xa4a6a8;
const ROCK = 0xb3a48a;
const BARRIER = 0xd8d2c4;
const GREEN_SCREEN = 0x2bd36a;
const AMBER = 0xffa73a;
const LAMP = 0xfff1c8;

const boxes: MapBox[] = [];
const B = (b: MapBox) => boxes.push(b);

// ---- Perimeter: sand berm ---------------------------------------------------------
const OUT = 49;
for (const side of [-1, 1]) {
  B({ x: 0, z: side * OUT, w: 100, h: 5, d: 2, color: SAND, surface: "sand", style: "berm" });
  B({ x: side * OUT, z: 0, w: 2, h: 5, d: 100, color: SAND, surface: "sand", style: "berm" });
}

// ---- Control shack (10 × 7, doors N/S, windows E/W) --------------------------------
const SW = 10, SD = 7, SH = 3, T = 0.3;
const shack = { color: PLASTER, mat: "concrete_dirty", tag: "shack" } as const;
for (const z of [-SD / 2, SD / 2]) {
  B({ x: -3.05, z, w: 3.9, h: SH, d: T, ...shack });
  B({ x: 3.05, z, w: 3.9, h: SH, d: T, ...shack });
  B({ x: 0, z, w: 2.2, h: SH - 2.25, d: T, y: 2.25, ...shack }); // lintel
}
for (const x of [-SW / 2, SW / 2]) {
  B({ x, z: -2.5, w: T, h: SH, d: 2.0, ...shack });
  B({ x, z: 2.5, w: T, h: SH, d: 2.0, ...shack });
  B({ x, z: 0, w: T, h: 1.0, d: 3.0, ...shack }); // sill
  B({ x, z: 0, w: T, h: SH - 2.1, d: 3.0, y: 2.1, ...shack }); // head
}
B({ x: 0, z: 0, w: SW + 0.4, h: 0.25, d: SD + 0.4, y: SH, color: CONCRETE, mat: "concrete", tag: "roof" });
B({ x: -3, z: -2.6, w: 2.4, h: 0.9, d: 0.8, color: STEEL, surface: "metal", mat: "metal_painted", tag: "console" });
B({ x: -3, z: -2.85, w: 2.0, h: 0.5, d: 0.08, y: 0.9, color: 0x0c1a10, emissive: 0x3ad0ff, decor: true });
B({ x: -4.2, z: 2.2, w: 0.7, h: 2, d: 1.8, color: STEEL, surface: "metal", mat: "metal_dark", tag: "locker" });
B({ x: 3.6, z: 2.4, w: 1.8, h: 0.8, d: 0.9, color: WOOD, surface: "wood", tag: "desk" });
B({ x: 2.8, z: -1.2, w: 1.0, h: 1.0, d: 0.6, y: SH + 0.25, color: STEEL, surface: "metal", mat: "metal_dark", tag: "ac" }); // roof AC unit

// ---- Storage tanks (vertical, drawn by the dressing; colliders approximate the drum) ----
export const TANKS: { x: number; z: number; r: number; h: number }[] = [
  { x: -30, z: -28, r: 6, h: 9 },
  { x: 30, z: 28, r: 6, h: 9 },
  { x: 28, z: -30, r: 4, h: 7 },
  { x: -28, z: 30, r: 4, h: 7 },
];
for (const t of TANKS) {
  const tank = { h: t.h, color: WHITE, surface: "metal", style: "hidden", tag: "storage" } as const;
  B({ x: t.x, z: t.z, w: t.r * 1.96, d: t.r * 0.8, ...tank });
  B({ x: t.x, z: t.z, w: t.r * 0.8, d: t.r * 1.96, ...tank });
  B({ x: t.x, z: t.z, w: t.r * 1.44, d: t.r * 1.44, ...tank });
}

// ---- Pump jacks (base skid collider; frame drawn by the dressing) -------------------
export const PUMPJACKS: { x: number; z: number; alongX: boolean; color: number }[] = [
  { x: -18, z: -12, alongX: true, color: 0xd8b04a },
  { x: -37, z: 6, alongX: false, color: 0xc86a3a },
  { x: 16, z: 14, alongX: true, color: 0xd8b04a },
  { x: 38, z: -8, alongX: false, color: 0x6f8fb0 },
  { x: -8, z: 32, alongX: true, color: 0xc86a3a },
];
for (const p of PUMPJACKS) {
  B({ x: p.x, z: p.z, w: p.alongX ? 5.5 : 1.5, h: 1.6, d: p.alongX ? 1.5 : 5.5, color: STEEL, surface: "metal", style: "hidden", tag: "pumpjack" });
}

// ---- Knee-high pipe runs (crouch cover, gaps for crossings) ------------------------
const pipeRun = (x: number, z: number, alongX: boolean, len: number) =>
  B({ x, z, w: alongX ? len : 0.9, h: 0.9, d: alongX ? 0.9 : len, color: STEEL, surface: "metal", style: "hidden", tag: alongX ? "pipeX" : "pipeZ" });
pipeRun(-12, -16, false, 14);
pipeRun(-12, 16, false, 12);
pipeRun(12, -16, false, 12);
pipeRun(12, 17, false, 10);
pipeRun(-30, -14, true, 10);
pipeRun(28, 12, true, 8);

// ---- Overhead pipe rack (posts collide; the rack itself is decor) -------------------
export const RACK = { z: 21, x0: -26, x1: 26, step: 6.5, height: 4.4 };
for (let x = RACK.x0; x <= RACK.x1 + 1e-6; x += RACK.step) {
  B({ x, z: RACK.z, w: 0.35, h: RACK.height, d: 1.6, color: STEEL, surface: "metal", style: "hidden", tag: "rackpost" });
}

// ---- Flood-light towers (lattice drawn by the dressing) ------------------------------
export const LIGHTS: { x: number; z: number }[] = [
  { x: -16, z: -17 },
  { x: 17, z: -18 },
  { x: -15, z: 13.5 },
  { x: 17, z: 17.5 },
];
for (const l of LIGHTS) {
  B({ x: l.x, z: l.z, w: 0.6, h: 10, d: 0.6, color: STEEL, surface: "metal", style: "hidden", tag: "lighttower" });
  B({ x: l.x, z: l.z, w: 1.6, h: 0.5, d: 0.25, y: 10.1, color: 0x222222, emissive: LAMP, decor: true });
}

// ---- Containers -------------------------------------------------------------------------
const containers: [number, number, number, number, number, number?][] = [
  // x, z, w, d, colour, y
  [20, -13, 6, 2.4, RUST],
  [25, -18, 2.4, 6, BLUE],
  [20, -13, 6, 2.4, OLIVE, 2.6],
  [-21, 18, 6, 2.4, OLIVE],
  [33, 3, 2.4, 6, TAN],
  [-34, -6, 6, 2.4, BLUE],
  [-6, -36, 6, 2.4, RUST],
];
for (const [x, z, w, d, color, y] of containers) B({ x, z, w, h: 2.6, d, y, color, surface: "metal", style: "container" });

// ---- Horizontal separator vessels -------------------------------------------------------
B({ x: 8, z: 27, w: 6, h: 2.4, d: 2.4, color: WHITE, surface: "metal", style: "tank" });
B({ x: -6, z: -27, w: 6, h: 2.4, d: 2.4, color: TAN, surface: "metal", style: "tank" });
B({ x: 36, z: 16, w: 2.4, h: 2.4, d: 6, color: WHITE, surface: "metal", style: "tank" });

// ---- Cover around the shack -------------------------------------------------------------
const sandbags = (x: number, z: number, along: "x" | "z", len = 4) =>
  B({ x, z, w: along === "x" ? len : 0.9, h: 1.05, d: along === "z" ? len : 0.9, color: SANDBAG, surface: "sand", style: "sandbags" });
sandbags(-4, -8, "x");
sandbags(4, 8, "x");
sandbags(-24, 0, "z", 3);
sandbags(24, 0, "z", 3);
const barrier = (x: number, z: number, along: "x" | "z") => B({ x, z, w: along === "x" ? 3 : 0.7, h: 1.15, d: along === "z" ? 3 : 0.7, color: BARRIER, style: "barrier" });
barrier(-9, -6, "z");
barrier(9, 6, "z");
barrier(4, -14, "x");
barrier(-4, 14, "x");
barrier(0, -30, "x");
barrier(0, 30, "x");
barrier(-30, 0, "z");
barrier(30, 0, "z");

// Supply crates.
for (const [x, z, h] of [[-7, 15.2, 1.2], [7, -15.2, 1.2], [15, 3, 0.9], [-15, -3, 0.9], [26, 9, 1.2], [-26, -9, 1.2], [-40, 20, 1.2], [40, -20, 1.2]] as const) {
  B({ x, z, w: 1.2, h, d: 1.2, color: WOOD, surface: "wood", style: "crate", tag: "supply" });
}

// Oil drums.
const drums: [number, number, "Barrel_01" | "barrel_03"][] = [
  [-15.6, -10.4, "Barrel_01"], [-16.3, -9.6, "barrel_03"], [18.6, 15.9, "barrel_03"], [19.3, 15.1, "Barrel_01"],
  [35.6, -5.2, "Barrel_01"], [-35.3, 8.9, "barrel_03"], [-5.5, 33.8, "Barrel_01"], [22.6, -10.5, "barrel_03"],
  [-22.8, 20.4, "Barrel_01"], [6.2, 2.1, "barrel_03"],
];
drums.forEach(([x, z, model], i) => B({ x, z, w: 0.62, h: 0.9, d: 0.62, color: i % 2 ? 0x7d8a6a : 0x8a5a40, surface: "metal", style: "model", model, rotY: i * 1.3 }));
B({ x: -2.6, z: 4.6, w: 1.5, h: 0.3, d: 0.5, color: OLIVE, surface: "wood", style: "model", model: "old_military_crate" });
B({ x: 21, z: -10.8, w: 1.5, h: 0.3, d: 0.5, color: OLIVE, surface: "wood", style: "model", model: "old_military_crate", rotY: Math.PI });

// ---- Buy stations + ammo crates --------------------------------------------------------
const stations = [
  { x: -8, z: 3.5, name: "Pump Armory" },
  { x: 8, z: -3.5, name: "Valve Armory" },
];
for (const s of stations) {
  B({ x: s.x, z: s.z, w: 1.4, h: 1.3, d: 0.9, color: STEEL, surface: "metal", mat: "metal_dark", tag: "station" });
  B({ x: s.x, z: s.z, w: 1.0, h: 0.5, d: 0.08, y: 1.35, color: 0x0c1a10, emissive: GREEN_SCREEN, decor: true });
  B({ x: s.x, z: s.z, w: 0.08, h: 2.6, d: 0.08, y: 0, color: STEEL, mat: "metal_dark", decor: true });
  B({ x: s.x, z: s.z, w: 0.3, h: 0.12, d: 0.3, y: 2.6, color: 0x111111, emissive: GREEN_SCREEN, decor: true });
}
const crates = [
  { x: 0, z: 11 },
  { x: 0, z: -11 },
  { x: -20, z: 3 },
  { x: 20, z: -3 },
];
for (const c of crates) {
  B({ x: c.x, z: c.z, w: 1.4, h: 0.7, d: 0.9, color: OLIVE, surface: "metal", tag: "ammo" });
  B({ x: c.x, z: c.z, w: 1.2, h: 0.06, d: 0.2, y: 0.7, color: 0x111111, emissive: AMBER, decor: true });
}

// ---- Outside the yard: rocks, a burnt pickup, scaffold sniper perches -------------------
const rocks: [number, number, number, number, number][] = [
  [-41, -18, 3, 1.8, 3.5], [41, 24, 3.5, 1.6, 3], [-14, 42, 4, 1.4, 2.5], [16, -42, 4, 1.8, 3],
];
for (const [x, z, w, h, d] of rocks) B({ x, z, w, h, d, color: ROCK, surface: "sand", style: "rock" });
B({ x: 36, z: -40, w: 4.5, h: 1.7, d: 2.2, color: 0x9a8a7a, surface: "metal", mat: "metal_rust", tag: "wreck" });
B({ x: 36.4, z: -40, w: 1.6, h: 0.9, d: 2.0, y: 1.7, color: 0x8a7a6a, surface: "metal", mat: "metal_rust", tag: "wreck-cab" });

// Flare stack flame (the stack itself is drawn by the dressing beyond the east berm).
B({ x: 66, z: -60, w: 0.9, h: 1.8, d: 0.9, y: 24.4, color: 0xff8a2a, emissive: 0xff7a1a, decor: true });

const perches = [
  { x: -43, y: 6, z: -43 },
  { x: 43, y: 6, z: -43 },
  { x: 43, y: 6, z: 43 },
  { x: -43, y: 6, z: 43 },
];
for (const p of perches) {
  B({ x: p.x, z: p.z, w: 5, h: p.y, d: 5, color: STEEL, surface: "metal", style: "perch" });
  B({ x: p.x - Math.sign(p.x) * 2.3, z: p.z - Math.sign(p.z) * 2.3, w: 0.8, h: 0.9, d: 0.8, y: p.y, color: SANDBAG, surface: "sand", style: "sandbags" });
}

export const CINDER_FLATS: MapDef = {
  id: "cinder-flats",
  name: "Cinder Flats Refinery",
  size: 100,
  groundColor: 0x9a8058,
  skyTop: 0x6f8fae,
  skyHorizon: 0xd8c6a2,
  fogNear: 70,
  fogFar: 320,
  sunDirection: [0.45, 0.72, -0.35],
  sunColor: 0xffe2b8,
  sunIntensity: 3.4,
  hemiSky: 0xc9d4de,
  hemiGround: 0x8a6e48,
  atmosphere: {
    fogDensity: 0.0042,
    fogColor: 0xd2bf9c,
    skyGround: 0x8a7656,
    hemiIntensity: 0.6,
    cloudCover: 0.22,
    envIntensity: 0.42,
    exposure: 1.0,
  },
  dressing: "cinderFlats",
  spawns: [{ x: 0, z: 6.5, yaw: 0 }],
  boxes,
  targets: [],
  plates: [],
  signs: [
    { x: -8, y: 2.2, z: 4.0, text: "ARMORY [F]" },
    { x: 8, y: 2.2, z: -4.0, text: "ARMORY [F]", rotY: Math.PI },
    { x: 0, y: 2.6, z: 3.72, text: "CONTROL 2" },
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
    inner: 30,
  },
};
