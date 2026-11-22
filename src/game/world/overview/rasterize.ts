import type { MapBox, MapDef } from "../MapLoader";
import { overviewFeatures, type OverviewFeatures } from "./features";

/**
 * Top-down overview of a map, rasterised straight from its data: ground,
 * roads and paved areas, building footprints and every collider box shaded
 * by height, with soft sun shadows and crisp edges. Pure TypeScript (no DOM,
 * no three.js), so the lobby, the HUD minimap and tests share one source and
 * the image always matches the level.
 *
 * Image space: +x (east) runs right, +z (south) runs down, so north is up.
 */

export type Bounds = { minX: number; minZ: number; maxX: number; maxZ: number };
export type OverviewImage = {
  width: number;
  height: number;
  /** RGBA, row-major, top row = north edge. */
  data: Uint8ClampedArray;
  bounds: Bounds;
  /** Pixels per metre. */
  scale: number;
};

export type OverviewOptions = {
  /** Pixels per metre (default 4). Clamped so the long side stays ≤ maxSize. */
  scale?: number;
  maxSize?: number;
  bounds?: Bounds;
};

/** The part of the map worth showing: the play area plus where enemies come from. */
export function overviewBounds(def: MapDef): Bounds {
  const half = def.size / 2;
  if (def.survival) {
    const s = def.survival;
    let ext = s.inner + 12;
    for (const p of s.enemySpawns) ext = Math.max(ext, Math.abs(p.x) + 8, Math.abs(p.z) + 8);
    for (const p of s.perches) ext = Math.max(ext, Math.abs(p.x) + 6, Math.abs(p.z) + 6);
    ext = Math.min(Math.max(ext, 30), Math.max(half, 30));
    return { minX: -ext, minZ: -ext, maxX: ext, maxZ: ext };
  }
  if (def.nav) return { minX: def.nav.minX, minZ: def.nav.minZ, maxX: def.nav.minX + def.nav.width, maxZ: def.nav.minZ + def.nav.depth };
  return { minX: -half, minZ: -half, maxX: half, maxZ: half };
}

type RGB = [number, number, number];
const rgb = (hex: number): RGB => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scaleRgb = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
const lum = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const desat = (c: RGB, t: number): RGB => {
  const l = lum(c);
  return mix(c, [l, l, l], t);
};

/** Small deterministic hash noise (0..1) so the ground has some grain. */
function grain(x: number, z: number) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** What a box reads as from above. */
export type BoxClass = "skip" | "tree" | "low" | "cover" | "structure" | "building";

export function classifyBox(b: MapBox): BoxClass {
  if (b.tag === "tree" || b.tag === "trunk") return "tree";
  const top = (b.y ?? 0) + b.h;
  const area = b.w * b.d;
  // Collider-only boxes are real geometry the dressing draws (houses, towers, wrecks).
  if (b.style === "hidden" && (b.tag === "bound" || b.tag === "rim" || b.tag === "floor" || b.tag === "stair")) return "skip";
  if (b.decor) {
    // Decor: only roofs / canopies matter from above.
    if (top > 2.2 && area > 4) return "building";
    return "skip";
  }
  if (b.style === "pole" || area < 0.05) return "skip";
  if (top < 0.55) return "low";
  if (top < 1.7) return "cover";
  if (top < 3.4 && area < 30) return "structure";
  return "building";
}

const SHADE: Record<Exclude<BoxClass, "skip">, { base: RGB; tint: number; edge: number }> = {
  tree: { base: [52, 78, 46], tint: 0, edge: 0.75 },
  low: { base: [150, 146, 132], tint: 0.15, edge: 0.88 },
  cover: { base: [176, 160, 122], tint: 0.35, edge: 0.7 },
  structure: { base: [168, 172, 170], tint: 0.35, edge: 0.66 },
  building: { base: [196, 190, 176], tint: 0.3, edge: 0.6 },
};

/** Per-pixel writer with clip + alpha blend. */
class Canvas {
  readonly data: Uint8ClampedArray;
  constructor(readonly w: number, readonly h: number) {
    this.data = new Uint8ClampedArray(w * h * 4);
  }
  set(i: number, j: number, c: RGB, a = 1) {
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return;
    const k = (j * this.w + i) * 4;
    const d = this.data;
    if (a >= 1) {
      d[k] = c[0];
      d[k + 1] = c[1];
      d[k + 2] = c[2];
    } else {
      d[k] += (c[0] - d[k]) * a;
      d[k + 1] += (c[1] - d[k + 1]) * a;
      d[k + 2] += (c[2] - d[k + 2]) * a;
    }
    d[k + 3] = 255;
  }
  darken(i: number, j: number, k: number) {
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return;
    const o = (j * this.w + i) * 4;
    const d = this.data;
    d[o] *= k;
    d[o + 1] *= k;
    d[o + 2] *= k;
  }
}

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az;
  const l = dx * dx + dz * dz;
  const t = l > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l)) : 0;
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}

/**
 * Rasterise a map's overview. Deterministic: the same map and options always
 * give the same pixels (cache-friendly, testable).
 */
export function renderOverview(def: MapDef, opts: OverviewOptions = {}, features: OverviewFeatures = overviewFeatures(def)): OverviewImage {
  const bounds = opts.bounds ?? overviewBounds(def);
  const spanX = bounds.maxX - bounds.minX, spanZ = bounds.maxZ - bounds.minZ;
  const maxSize = opts.maxSize ?? 2048;
  const scale = Math.min(opts.scale ?? 4, maxSize / Math.max(spanX, spanZ));
  const W = Math.max(1, Math.round(spanX * scale)), H = Math.max(1, Math.round(spanZ * scale));
  const cv = new Canvas(W, H);
  const toI = (x: number) => (x - bounds.minX) * scale;
  const toJ = (z: number) => (z - bounds.minZ) * scale;
  const toX = (i: number) => bounds.minX + (i + 0.5) / scale;
  const toZ = (j: number) => bounds.minZ + (j + 0.5) / scale;

  // ---- Ground: the map's ground colour, muted and darkened for contrast ----
  const ground = scaleRgb(desat(rgb(def.groundColor), 0.35), 0.62);
  const outside = scaleRgb(ground, 0.78);
  const inner = def.survival?.inner ?? Infinity;
  const px = cv.data;
  for (let j = 0; j < H; j++) {
    const z = toZ(j);
    for (let i = 0; i < W; i++) {
      const x = toX(i);
      const g = 0.94 + grain(Math.floor(x * 0.7), Math.floor(z * 0.7)) * 0.08 + grain(i, j) * 0.04;
      // The defended compound sits a shade brighter than the approaches.
      const c = Math.max(Math.abs(x), Math.abs(z)) > inner + 1 ? outside : ground;
      const o = (j * W + i) * 4;
      px[o] = c[0] * g;
      px[o + 1] = c[1] * g;
      px[o + 2] = c[2] * g;
      px[o + 3] = 255;
    }
  }

  // ---- Areas (plazas, yards, water) and roads ----
  const AREA: Record<string, RGB> = { paved: [128, 124, 116], yard: [104, 100, 90], water: [46, 70, 86], field: scaleRgb(ground, 1.12) };
  for (const a of features.areas) {
    const c = AREA[a.kind];
    const i0 = Math.floor(toI(a.x0)), i1 = Math.ceil(toI(a.x1)), j0 = Math.floor(toJ(a.z0)), j1 = Math.ceil(toJ(a.z1));
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) cv.set(i, j, c, 0.85);
  }
  const roadC: RGB = [138, 133, 122];
  const lineC: RGB = [168, 162, 148];
  // Coverage per pixel (max over segments), then one composite: overlapping
  // segments and junctions don't double up.
  const cov = new Float32Array(W * H);
  const kerb = new Uint8Array(W * H);
  for (const r of features.roads) {
    const half = r.w / 2;
    for (let k = 1; k < r.pts.length; k++) {
      const [ax, az] = r.pts[k - 1], [bx, bz] = r.pts[k];
      const i0 = Math.max(0, Math.floor(toI(Math.min(ax, bx) - half - 1))), i1 = Math.min(W, Math.ceil(toI(Math.max(ax, bx) + half + 1)));
      const j0 = Math.max(0, Math.floor(toJ(Math.min(az, bz) - half - 1))), j1 = Math.min(H, Math.ceil(toJ(Math.max(az, bz) + half + 1)));
      const weight = r.paved ? 0.95 : 0.7;
      for (let j = j0; j < j1; j++) {
        const z = toZ(j);
        for (let i = i0; i < i1; i++) {
          const d = segDist(toX(i), z, ax, az, bx, bz);
          if (d > half + 0.5) continue;
          const o = j * W + i;
          // Anti-aliased edge (half a metre); a faint kerb line on paved roads.
          const a = Math.min(1, half + 0.5 - d) * weight;
          if (a > cov[o]) cov[o] = a;
          if (r.paved && d > half - 0.45 && d < half) kerb[o] = 1;
          else if (d <= half - 0.45) kerb[o] = 2;
        }
      }
    }
  }
  for (let o = 0; o < W * H; o++) if (cov[o] > 0) cv.set(o % W, (o / W) | 0, kerb[o] === 1 ? lineC : roadC, cov[o]);

  // ---- Boxes: shadows first, then fills tallest last ----
  const sun = def.sunDirection;
  const sh = Math.hypot(sun[0], sun[2]) || 1;
  // Shadows fall away from the sun; length grows with height (capped so tall towers don't smear).
  const sdx = (-sun[0] / sh) * 0.32, sdz = (-sun[2] / sh) * 0.32;
  type Drawn = { b: MapBox; cls: Exclude<BoxClass, "skip">; top: number };
  const drawn: Drawn[] = [];
  for (const b of def.boxes) {
    const cls = classifyBox(b);
    if (cls === "skip") continue;
    drawn.push({ b, cls, top: (b.y ?? 0) + b.h });
  }
  for (const f of features.buildings) drawn.push({ b: { x: (f.x0 + f.x1) / 2, z: (f.z0 + f.z1) / 2, w: f.x1 - f.x0, d: f.z1 - f.z0, h: f.h, color: f.color ?? 0xb8b0a0 }, cls: "building", top: f.h });
  drawn.sort((a, b) => a.top - b.top);

  const shadow = new Uint8Array(W * H);
  const markRect = (x0: number, x1: number, z0: number, z1: number) => {
    const i0 = Math.max(0, Math.floor(toI(x0))), i1 = Math.min(W, Math.ceil(toI(x1)));
    const j0 = Math.max(0, Math.floor(toJ(z0))), j1 = Math.min(H, Math.ceil(toJ(z1)));
    for (let j = j0; j < j1; j++) shadow.fill(1, j * W + i0, j * W + i1);
  };
  for (const { b, cls, top } of drawn) {
    if (cls === "tree" || cls === "low") continue;
    const len = Math.min(top, 7);
    const ox = sdx * len, oz = sdz * len;
    const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2;
    // The box swept along the shadow direction, as overlapping steps.
    const steps = Math.max(1, Math.ceil(Math.hypot(ox, oz) * scale / Math.max(1, Math.min(b.w, b.d) * scale * 0.5)));
    for (let s = 1; s <= Math.min(steps, 24); s++) {
      const t = s / Math.min(steps, 24);
      markRect(x0 + ox * t, x1 + ox * t, z0 + oz * t, z1 + oz * t);
    }
  }
  for (let o = 0; o < W * H; o++) if (shadow[o]) cv.darken(o % W, (o / W) | 0, 0.74);

  for (const { b, cls, top } of drawn) {
    const st = SHADE[cls];
    const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2;
    if (cls === "tree") {
      const r = Math.max(1.6, Math.max(b.w, b.d) * 1.6);
      const ci = toI(b.x), cj = toJ(b.z), rp = r * scale;
      for (let j = Math.floor(cj - rp); j <= Math.ceil(cj + rp); j++) {
        for (let i = Math.floor(ci - rp); i <= Math.ceil(ci + rp); i++) {
          const d = Math.hypot(i + 0.5 - ci, j + 0.5 - cj);
          if (d > rp) continue;
          cv.set(i, j, scaleRgb(st.base, 0.85 + 0.3 * (1 - d / rp)), Math.min(1, rp - d) * 0.9);
        }
      }
      continue;
    }
    // Height brightens (taller reads lighter), the box's own tint adds identity.
    const hk = Math.min(1, top / 9);
    const fill = mix(mix(st.base, desat(rgb(b.color), 0.25), st.tint), [236, 232, 222], hk * 0.35 * (cls === "building" ? 1 : 0.4));
    const edge = scaleRgb(fill, st.edge);
    const fi0 = toI(x0), fi1 = toI(x1), fj0 = toJ(z0), fj1 = toJ(z1);
    // Thin walls still get at least one pixel.
    const i0 = Math.floor(fi0), j0 = Math.floor(fj0);
    const i1 = Math.max(i0 + 1, Math.ceil(fi1)), j1 = Math.max(j0 + 1, Math.ceil(fj1));
    const thin = i1 - i0 <= 2 || j1 - j0 <= 2;
    for (let j = j0; j < j1; j++) {
      for (let i = i0; i < i1; i++) {
        // Coverage for anti-aliased edges.
        const cx = Math.min(i + 1, fi1) - Math.max(i, fi0);
        const cz = Math.min(j + 1, fj1) - Math.max(j, fj0);
        const cov = thin ? 1 : Math.max(0, Math.min(1, cx)) * Math.max(0, Math.min(1, cz));
        if (cov <= 0) continue;
        const border = !thin && (i === i0 || j === j0 || i === i1 - 1 || j === j1 - 1);
        cv.set(i, j, border || thin ? edge : fill, cov);
      }
    }
  }

  return { width: W, height: H, data: cv.data, bounds, scale };
}

/** World → image pixel (floating point). */
export function worldToImage(img: { bounds: Bounds; scale: number }, x: number, z: number): [number, number] {
  return [(x - img.bounds.minX) * img.scale, (z - img.bounds.minZ) * img.scale];
}
