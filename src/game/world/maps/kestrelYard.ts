import type { MapBox, MapDef } from "../MapLoader";

/**
 * Kestrel Yard — an original freight-depot training ground.
 * South: firing line + range lanes with distance markers and a raised
 * overlook (stairs test step-up). North: containers, a roofless warehouse,
 * and a steel-plate gantry at ~70 m.
 * Coordinates: x = east, z = south, y = up. Box = center (x, z), size (w, h, d).
 */
const CONCRETE = 0xc8c6be;
const CONCRETE_DARK = 0xa8a69e;
const RUST = 0xc27c55;
const STEEL_BLUE = 0x8299ae;
const OLIVE = 0x949b6c;
const CRATE = 0xd2c4ad;
const SANDBAG = 0xc4b48e;
const BARRIER = 0xd6d2c6;
const STEEL = 0xa4a6a8;

const stairs = (): MapBox[] => {
  // 5 steps of 0.3 m up to a 1.8 m platform (each within the 0.45 m step-up).
  const steps: MapBox[] = [];
  for (let k = 1; k <= 5; k++) {
    steps.push({ x: 30 - 0.25 - 0.5 * (5 - k), z: 30, w: 0.5, h: 0.3 * k, d: 3, color: CONCRETE_DARK });
  }
  return steps;
};

export const KESTREL_YARD: MapDef = {
  id: "kestrel-yard",
  name: "Kestrel Yard",
  size: 80,
  groundColor: 0x7a7060,
  skyTop: 0x737d86,
  skyHorizon: 0xb5b9b0,
  fogNear: 60,
  fogFar: 220,
  sunDirection: [0.45, 0.8, 0.35],
  sunColor: 0xfff1de,
  sunIntensity: 3.3,
  hemiSky: 0xc3cacc,
  hemiGround: 0x545040,
  atmosphere: { fogDensity: 0.0042, fogColor: 0xb3b7ae, cloudCover: 0.5, hemiIntensity: 0.6, envIntensity: 0.42, exposure: 1.08 },
  dressing: "kestrel",
  spawns: [{ x: 0, z: 34, yaw: 0 }],
  boxes: [
    // Perimeter walls
    { x: 0, z: -40.5, w: 82, h: 5, d: 1, color: CONCRETE, tag: "wall" },
    { x: 0, z: 40.5, w: 82, h: 5, d: 1, color: CONCRETE, tag: "wall" },
    { x: -40.5, z: 0, w: 1, h: 5, d: 82, color: CONCRETE, tag: "wall" },
    { x: 40.5, z: 0, w: 1, h: 5, d: 82, color: CONCRETE, tag: "wall" },

    // Firing line: sandbags with gaps + benches
    { x: -9, z: 28, w: 8, h: 1.0, d: 1, color: SANDBAG, surface: "sand", style: "sandbags" },
    { x: 0, z: 28, w: 6, h: 1.0, d: 1, color: SANDBAG, surface: "sand", style: "sandbags" },
    { x: 9, z: 28, w: 8, h: 1.0, d: 1, color: SANDBAG, surface: "sand", style: "sandbags" },
    { x: -3.5, z: 29.6, w: 1.8, h: 0.85, d: 0.6, color: CRATE, surface: "wood", style: "crate" },
    { x: 3.5, z: 29.6, w: 1.8, h: 0.85, d: 0.6, color: CRATE, surface: "wood", style: "crate" },
    // Curbs near spawn (walk over them: step-up)
    { x: -6, z: 32, w: 4, h: 0.2, d: 0.5, color: CONCRETE_DARK },
    { x: 6, z: 32, w: 4, h: 0.2, d: 0.5, color: CONCRETE_DARK },

    // Lane dividers (low walls) down the range
    { x: -16, z: 14, w: 0.4, h: 1.2, d: 26, color: CONCRETE },
    { x: 16, z: 14, w: 0.4, h: 1.2, d: 26, color: CONCRETE },
    { x: 0, z: 12, w: 3, h: 0.9, d: 0.8, color: BARRIER, style: "barrier" },

    // Overlook platform (east) + stairs
    { x: 34, z: 31, w: 8, h: 1.8, d: 10, color: CONCRETE_DARK },
    { x: 34, z: 26.2, w: 8, h: 1.0, d: 0.3, y: 1.8, color: STEEL, surface: "metal", mat: "metal_dark" }, // railing wall
    ...stairs(),

    // Shipping containers (2.4 x 2.6 x 6)
    { x: -24, z: 6, w: 6, h: 2.6, d: 2.4, color: RUST, surface: "metal", style: "container" },
    { x: -24, z: 6, w: 6, h: 2.6, d: 2.4, y: 2.6, color: STEEL_BLUE, surface: "metal", style: "container" },
    { x: 24, z: 2, w: 2.4, h: 2.6, d: 6, color: OLIVE, surface: "metal", style: "container" },
    { x: 26, z: -10, w: 6, h: 2.6, d: 2.4, color: RUST, surface: "metal", style: "container" },
    { x: -8, z: -8, w: 2.4, h: 2.6, d: 6, color: STEEL_BLUE, surface: "metal", style: "container" },
    { x: 10, z: -20, w: 6, h: 2.6, d: 2.4, color: OLIVE, surface: "metal", style: "container" },
    { x: 30, z: 14, w: 2.4, h: 2.6, d: 6, color: STEEL_BLUE, surface: "metal", style: "container" },
    { x: 30, z: -26, w: 2.4, h: 2.6, d: 6, color: RUST, surface: "metal", style: "container" },

    // Crate staircase onto the olive container (jump: 0.9 → 1.8 → 2.6)
    { x: 21.6, z: 5.6, w: 0.9, h: 0.9, d: 0.9, color: CRATE, surface: "wood", style: "crate" },
    { x: 22.3, z: 4.4, w: 0.9, h: 1.8, d: 0.9, color: CRATE, surface: "wood", style: "crate" },

    // Loose cover
    { x: -4, z: 4, w: 1.2, h: 1.2, d: 1.2, color: CRATE, surface: "wood", style: "crate" },
    { x: -2.8, z: 4.2, w: 1.0, h: 1.0, d: 1.0, color: CRATE, surface: "wood", style: "crate" },
    { x: 20, z: 10, w: 1.2, h: 1.2, d: 1.2, color: CRATE, surface: "wood", style: "crate" },
    { x: -28, z: 18, w: 1.4, h: 1.4, d: 1.4, color: CRATE, surface: "wood", style: "crate" },
    { x: 18, z: -28, w: 1.2, h: 1.2, d: 1.2, color: CRATE, surface: "wood", style: "crate" },

    // Warehouse (roofless) NW: x -34..-18, z -34..-20
    { x: -26, z: -34, w: 16, h: 4, d: 0.5, color: CONCRETE },
    { x: -34, z: -27, w: 0.5, h: 4, d: 14, color: CONCRETE },
    { x: -30.5, z: -20, w: 7, h: 4, d: 0.5, color: CONCRETE },
    { x: -20, z: -20, w: 4, h: 4, d: 0.5, color: CONCRETE }, // door x -27..-22
    { x: -24.5, z: -20, w: 5, h: 1.0, d: 0.5, y: 3, color: CONCRETE },
    { x: -18, z: -31, w: 0.5, h: 4, d: 6, color: CONCRETE },
    { x: -18, z: -22, w: 0.5, h: 4, d: 4, color: CONCRETE }, // door z -28..-24
    { x: -29, z: -29, w: 4, h: 1.2, d: 1.2, color: CRATE, surface: "wood", style: "crate" },
    { x: -23, z: -26, w: 1.2, h: 1.0, d: 3, color: BARRIER },

    // Steel gantry at the far end (~70 m) for the plates
    { x: -6, z: -37, w: 0.3, h: 4.6, d: 0.3, color: STEEL, surface: "metal", mat: "metal_dark" },
    { x: 10, z: -37, w: 0.3, h: 4.6, d: 0.3, color: STEEL, surface: "metal", mat: "metal_dark" },
    { x: 2, z: -37, w: 16.3, h: 0.3, d: 0.3, y: 4.6, color: STEEL, surface: "metal", mat: "metal_dark" },
    // Berm behind the plates
    { x: 2, z: -39.2, w: 22, h: 2.2, d: 1.6, color: 0xb0a890, surface: "sand", mat: "ground" },
  ],
  targets: [
    // Close lane (~14 m)
    { x: -7, z: 20 },
    { x: 0, z: 20 },
    { x: 7, z: 20 },
    // Movers (~26 m)
    { x: -8, z: 8, move: { axis: "x", range: 4, speed: 2.4 } },
    { x: 7, z: 6, move: { axis: "x", range: 3.5, speed: 3.2 } },
    // Mid (~40-46 m)
    { x: -3, z: -6 },
    { x: 4, z: -10, move: { axis: "x", range: 2.5, speed: 1.8 } },
    // Elevated
    { x: 24, z: 2, y: 2.6 },
    { x: -24, z: 6, y: 5.2 },
    // Yard
    { x: -26, z: -28 },
    { x: 22, z: -18 },
    { x: -2, z: -30 },
  ],
  plates: [
    { name: "Steel 70m A", x: -3, y: 4.45, z: -37, size: 0.55 },
    { name: "Steel 70m B", x: 2, y: 4.45, z: -37, size: 0.45 },
    { name: "Steel 70m C", x: 7, y: 4.45, z: -37, size: 0.35 },
  ],
  signs: [
    { x: -15.6, y: 1.6, z: 24, text: "10 M", rotY: Math.PI / 2 },
    { x: -15.6, y: 1.6, z: 14, text: "20 M", rotY: Math.PI / 2 },
    { x: -15.6, y: 1.6, z: 4, text: "30 M", rotY: Math.PI / 2 },
    { x: 15.6, y: 1.6, z: 24, text: "10 M", rotY: -Math.PI / 2 },
    { x: 15.6, y: 1.6, z: 14, text: "20 M", rotY: -Math.PI / 2 },
    { x: 15.6, y: 1.6, z: 4, text: "30 M", rotY: -Math.PI / 2 },
    { x: 2, y: 5.3, z: -36.9, text: "70 M" },
  ],
};
