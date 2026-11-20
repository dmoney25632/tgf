import { rng, type BushPlacement } from "../Foliage";
import type { Splat } from "../Terrain";
import { clearOf, concertina, fbm2, poleLine, rubble, scatterTrees, smoothstep, type Dressing, type PoleSpot } from "./common";

const WALL = 40.5;

/** Kestrel Yard (firing range): gravel yard inside concrete walls, farmland beyond. */
export const kestrel: Dressing = (kit) => {
  const { def, builder: B } = kit;
  const r = rng(77);
  const boxes = def.boxes;

  const height = (x: number, z: number) => {
    const d = Math.max(Math.abs(x), Math.abs(z));
    if (d <= 42) return 0;
    return smoothstep(42, 120, d) * (2 + 14 * fbm2(x * 0.01 - 4, z * 0.01 + 7, 4));
  };
  const splat = (x: number, z: number, o: Splat) => {
    const d = Math.max(Math.abs(x), Math.abs(z));
    const n = fbm2(x * 0.07, z * 0.07, 3);
    if (d < WALL) {
      o.gravel = 1;
      o.ground = smoothstep(WALL - 3, WALL - 0.5, d) + smoothstep(0.62, 0.75, n) * 0.5;
      o.mud = smoothstep(0.6, 0.72, fbm2(x * 0.15 + 3, z * 0.15, 2)) * 0.7;
    } else {
      o.gravel = 0.05;
      o.ground = 1;
      o.mud = smoothstep(0.58, 0.72, n) * 0.7;
    }
  };
  const grass = (x: number, z: number) => {
    const d = Math.max(Math.abs(x), Math.abs(z));
    if (d < WALL - 0.6) return d > WALL - 3 ? 0.55 : 0;
    if (d < WALL + 0.8 || Math.abs(z + 58) < 2.5) return 0; // wall foot, track under the power line
    // Farmland meadow: dense, thinning in worn patches.
    const n = fbm2(x * 0.05 + 11, z * 0.05 - 3, 3);
    return Math.min(1, 0.95 - smoothstep(0.62, 0.75, n) * 0.7);
  };
  const tallGrass = (x: number, z: number) => {
    const d = Math.max(Math.abs(x), Math.abs(z));
    if (d < WALL + 1.2 || Math.abs(z + 58) < 3) return 0;
    if (d < WALL + 3.5) return 0.7; // unmown strip against the wall
    const n = fbm2(x * 0.06 - 5, z * 0.06 + 9, 3);
    return smoothstep(0.48, 0.62, n) * 0.85;
  };

  for (const w of boxes.filter((b) => b.tag === "wall")) {
    const alongX = w.w > w.d;
    const len = alongX ? w.w : w.d;
    B.box("concrete", w.x, w.h + 0.08, w.z, alongX ? w.w : w.w + 0.16, 0.16, alongX ? w.d + 0.16 : w.d, 0xd2cec4);
    for (let a = -len / 2 + 3; a < len / 2 - 2; a += 6) {
      if (alongX) B.box("concrete_dirty", w.x + a, w.h / 2, w.z, 0.12, w.h, w.d + 0.06, 0x8f8b82);
      else B.box("concrete_dirty", w.x, w.h / 2, w.z + a, w.w + 0.06, w.h, 0.12, 0x8f8b82);
    }
    if (alongX) concertina(B, w.x - len / 2, w.z, w.x + len / 2, w.z, w.h + 0.45);
    else concertina(B, w.x, w.z - len / 2, w.x, w.z + len / 2, w.h + 0.45);
  }
  rubble(B, -26, -27, 5, 20, r, boxes);
  rubble(B, 20, -18, 3, 8, r, boxes);

  const poles: PoleSpot[] = [];
  for (let x = -180; x <= 180; x += 32) poles.push({ x, y: height(x, -58), z: -58, rotY: Math.PI / 2 });
  poleLine(B, poles, r, 1.0);

  const trees = [...scatterTrees(130, 50, 180, r, (x, z) => Math.abs(z + 58) < 5), ...scatterTrees(45, 47, 85, r, (x, z) => Math.abs(z + 58) < 5)];
  const bushes: BushPlacement[] = [];
  for (let i = 0; i < 40; i++) {
    const a = (r() * 2 - 1) * 38;
    const side = Math.floor(r() * 4);
    const off = WALL - 1.3 - r() * 0.6;
    const [x, z] = side === 0 ? [a, -off] : side === 1 ? [a, off] : side === 2 ? [-off, a] : [off, a];
    if (clearOf(boxes, x, z, 1) && !(z > 20 && Math.abs(x) < 20)) bushes.push({ x, z, scale: 0.7 + r() * 0.4, dry: r() < 0.4 });
  }
  return {
    terrain: { height, splat, inner: 60, outer: 700 },
    foliage: { grass, grassBounds: 75, trees, bushes, tallGrass, tallGrassBounds: 85 },
  };
};
