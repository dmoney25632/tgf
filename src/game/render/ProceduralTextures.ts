import * as THREE from "three";

/**
 * Seeded, tileable procedural PBR textures (albedo / normal / roughness).
 * Generated on the CPU once per (kind, size) and cached as raw pixels; each
 * map instance wraps them in its own DataTextures so GPU memory is released
 * with the map while regeneration stays free. `clearProceduralCache()` drops
 * the pixel cache.
 */

export type ProceduralKind =
  | "concrete"
  | "brick"
  | "corrugated"
  | "rust"
  | "wood"
  | "gravel"
  | "ground"
  | "canvas"
  | "rock"
  | "bark"
  | "metal"
  | "plain";

export type PixelSet = { size: number; albedo: Uint8Array; normal: Uint8Array; rough: Uint8Array };

const cache = new Map<string, PixelSet>();
const extraCache = new Map<string, Uint8Array>();

export function clearProceduralCache() {
  cache.clear();
  extraCache.clear();
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tileable 2D value noise: lattice wraps every `period` cells. */
class Noise {
  private readonly v = new Float32Array(1024);
  private readonly p = new Uint16Array(1024);
  constructor(seed: number) {
    const r = mulberry32(seed);
    for (let i = 0; i < 1024; i++) {
      this.v[i] = r();
      this.p[i] = Math.floor(r() * 1024);
    }
  }
  private h(ix: number, iy: number) {
    return this.v[(this.p[ix & 1023] + iy) & 1023];
  }
  /** x, y in lattice units; period in cells. */
  value(x: number, y: number, period: number) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const ax = ((x0 % period) + period) % period, ay = ((y0 % period) + period) % period;
    const bx = (ax + 1) % period, by = (ay + 1) % period;
    const a = this.h(ax, ay), b = this.h(bx, ay), c = this.h(ax, by), d = this.h(bx, by);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
  /** Fractal sum over u, v in [0,1); base period = cells per tile. */
  fbm(u: number, v: number, period: number, octaves = 4, gain = 0.5) {
    let sum = 0, amp = 1, norm = 0, p = period;
    for (let o = 0; o < octaves; o++) {
      sum += this.value(u * p, v * p, p) * amp;
      norm += amp;
      amp *= gain;
      p *= 2;
    }
    return sum / norm;
  }
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

type Sample = { r: number; g: number; b: number; h: number; rough: number };

/** Per-kind pixel shader: u, v in [0,1). Colours are sRGB 0..1. */
function shaderFor(kind: ProceduralKind, n: Noise, n2: Noise): (u: number, v: number, s: Sample) => void {
  switch (kind) {
    case "concrete":
      return (u, v, s) => {
        const m = n.fbm(u, v, 4, 5);
        const pores = n2.value(u * 180, v * 180, 180);
        const pore = pores > 0.86 ? (pores - 0.86) * 4 : 0;
        const stain = smooth(0.55, 0.8, n2.fbm(u, v, 3, 3));
        const g = 0.56 + (m - 0.5) * 0.18 - pore * 0.25 - stain * 0.08;
        s.r = g * 1.0; s.g = g * 0.985; s.b = g * 0.95;
        s.h = m * 0.6 - pore;
        s.rough = 0.88 + stain * 0.06;
      };
    case "brick": {
      const rows = 26, cols = 8;
      return (u, v, s) => {
        const row = Math.floor(v * rows);
        const fy = v * rows - row;
        const shift = row % 2 ? 0.5 : 0;
        const cx = u * cols + shift;
        const col = Math.floor(cx);
        const fx = cx - col;
        const mortarX = Math.min(fx, 1 - fx) * 4.6, mortarY = Math.min(fy, 1 - fy) * 1.4;
        const edge = Math.min(mortarX, mortarY);
        const isBrick = smooth(0.05, 0.11, edge);
        const id = n2.value((col % cols) * 7.3 + 0.5, row * 3.1 + 0.5, 1024);
        const grain = n.fbm(u, v, 16, 3);
        const chip = smooth(0.62, 0.75, n.fbm(u, v, 9, 3));
        const br = 0.5 + id * 0.16 + (grain - 0.5) * 0.12;
        const brick = [br * 0.98, br * 0.56, br * 0.42];
        const mort = 0.6 + (grain - 0.5) * 0.1;
        const t = isBrick * (1 - chip * 0.6);
        s.r = brick[0] * t + mort * (1 - t);
        s.g = brick[1] * t + mort * 0.97 * (1 - t);
        s.b = brick[2] * t + mort * 0.9 * (1 - t);
        s.h = isBrick * (0.8 + grain * 0.2) - chip * 0.3;
        s.rough = 0.9;
      };
    }
    case "corrugated":
      return (u, v, s) => {
        const ridge = 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * 30);
        const streak = n.fbm(u * 3, v * 0.25, 6, 4);
        const rust = smooth(0.58, 0.78, n2.fbm(u, v, 5, 5) * 0.7 + streak * 0.3);
        const paint = 0.52 + (n.fbm(u, v, 8, 3) - 0.5) * 0.12;
        s.r = paint * (1 - rust) + 0.45 * rust;
        s.g = paint * 0.99 * (1 - rust) + 0.25 * rust;
        s.b = paint * 0.95 * (1 - rust) + 0.14 * rust;
        s.h = ridge;
        s.rough = 0.55 + rust * 0.35;
      };
    case "rust":
      return (u, v, s) => {
        const a = n.fbm(u, v, 6, 5);
        const b = n2.fbm(u, v, 20, 3);
        const flake = smooth(0.5, 0.65, a);
        s.r = 0.38 + flake * 0.2 + b * 0.08;
        s.g = 0.2 + flake * 0.08 + b * 0.04;
        s.b = 0.12 + b * 0.03;
        s.h = flake * 0.6 + b * 0.4;
        s.rough = 0.8 + b * 0.15;
      };
    case "metal":
      return (u, v, s) => {
        const a = n.fbm(u, v, 6, 4);
        const scratch = n2.value(u * 220, v * 6, 220);
        const g = 0.32 + (a - 0.5) * 0.1 + (scratch > 0.9 ? 0.08 : 0);
        s.r = g; s.g = g * 1.01; s.b = g * 1.03;
        s.h = a * 0.3;
        s.rough = 0.5 + a * 0.25;
      };
    case "wood": {
      const planks = 6;
      return (u, v, s) => {
        const px = u * planks;
        const pi = Math.floor(px);
        const fx = px - pi;
        const gap = smooth(0.0, 0.05, Math.min(fx, 1 - fx));
        const id = n2.value(pi * 5.1 + 0.5, 3.3, 1024);
        const grain = n.fbm(u * 1 + id * 0.3, v, 24, 4);
        const streak = n.value(u * planks * 18, v * 3 + id * 9, planks * 18);
        const g = 0.42 + id * 0.12 + (grain - 0.5) * 0.18 + (streak - 0.5) * 0.06;
        s.r = g * 0.92 * gap; s.g = g * 0.84 * gap; s.b = g * 0.72 * gap;
        s.h = gap * (0.7 + grain * 0.3);
        s.rough = 0.86;
      };
    }
    case "gravel":
      return (u, v, s) => {
        const a = n.value(u * 64, v * 64, 64);
        const b = n2.value(u * 128, v * 128, 128);
        const stone = smooth(0.45, 0.62, a * 0.6 + b * 0.4);
        const dirt = n.fbm(u, v, 4, 4);
        const g = 0.38 + stone * 0.16 + (dirt - 0.5) * 0.12;
        s.r = g * 1.02; s.g = g * 0.96; s.b = g * 0.84;
        s.h = stone * 0.8 + b * 0.2;
        s.rough = 0.92;
      };
    case "ground":
      return (u, v, s) => {
        const patch = n.fbm(u, v, 4, 5);
        const fine = n2.fbm(u, v, 48, 3);
        const green = smooth(0.42, 0.62, patch);
        const dark = smooth(0.6, 0.75, n2.fbm(u, v, 6, 3));
        const soil = [0.36, 0.29, 0.21], moss = [0.34, 0.36, 0.2];
        const f = 0.85 + fine * 0.3 - dark * 0.2;
        s.r = (soil[0] * (1 - green) + moss[0] * green) * f;
        s.g = (soil[1] * (1 - green) + moss[1] * green) * f;
        s.b = (soil[2] * (1 - green) + moss[2] * green) * f;
        s.h = fine * 0.7 + patch * 0.3;
        s.rough = 0.95;
      };
    case "canvas":
      return (u, v, s) => {
        const N = 160;
        const w = Math.sin(u * Math.PI * 2 * N) * Math.sin(v * Math.PI * 2 * N);
        const m = n.fbm(u, v, 6, 4);
        const g = 0.6 + (m - 0.5) * 0.14 + w * 0.03;
        s.r = g; s.g = g * 0.95; s.b = g * 0.84;
        s.h = 0.5 + w * 0.5;
        s.rough = 0.95;
      };
    case "rock":
      return (u, v, s) => {
        const a = n.fbm(u, v, 4, 6);
        const ridged = 1 - Math.abs(n2.fbm(u, v, 6, 4) * 2 - 1);
        const crack = smooth(0.9, 0.97, ridged);
        const lichen = smooth(0.62, 0.72, n.fbm(u + 0.37, v + 0.11, 5, 3));
        const g = 0.46 + (a - 0.5) * 0.24 - crack * 0.18;
        s.r = g * (1 - lichen * 0.2) + lichen * 0.08;
        s.g = g * 0.97 * (1 - lichen * 0.1) + lichen * 0.1;
        s.b = g * 0.9 * (1 - lichen * 0.3);
        s.h = a - crack * 0.5;
        s.rough = 0.9;
      };
    case "bark":
      return (u, v, s) => {
        const ridges = 1 - Math.abs(n.fbm(u, v * 0.25, 10, 4) * 2 - 1);
        const fine = n2.fbm(u, v, 24, 3);
        const g = 0.22 + ridges * 0.16 + (fine - 0.5) * 0.08;
        s.r = g * 1.0; s.g = g * 0.86; s.b = g * 0.72;
        s.h = ridges * 0.8 + fine * 0.2;
        s.rough = 0.95;
      };
    case "plain":
    default:
      return (u, v, s) => {
        const a = n.fbm(u, v, 4, 3);
        const g = 0.5 + (a - 0.5) * 0.06;
        s.r = g; s.g = g; s.b = g;
        s.h = a * 0.2;
        s.rough = 0.8;
      };
  }
}

const NORMAL_STRENGTH: Record<ProceduralKind, number> = {
  concrete: 2.5, brick: 5, corrugated: 6, rust: 3, wood: 4, gravel: 5, ground: 4, canvas: 2, rock: 5, bark: 6, metal: 1.5, plain: 0.5,
};

/** Raw pixels for a kind at `size` (power of two). Cached. */
export function proceduralPixels(kind: ProceduralKind, size: number, seed = 7): PixelSet {
  const key = `${kind}:${size}:${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const n = new Noise(seed * 131 + kind.length * 17 + kind.charCodeAt(0));
  const n2 = new Noise(seed * 977 + kind.charCodeAt(1) * 3);
  const shade = shaderFor(kind, n, n2);
  const N = size * size;
  const albedo = new Uint8Array(N * 4);
  const normal = new Uint8Array(N * 4);
  const rough = new Uint8Array(N * 4);
  const height = new Float32Array(N);
  const s: Sample = { r: 0, g: 0, b: 0, h: 0, rough: 1 };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      shade(x / size, y / size, s);
      const i = y * size + x;
      albedo[i * 4] = clamp01(s.r) * 255;
      albedo[i * 4 + 1] = clamp01(s.g) * 255;
      albedo[i * 4 + 2] = clamp01(s.b) * 255;
      albedo[i * 4 + 3] = 255;
      rough[i * 4] = 255;
      rough[i * 4 + 1] = clamp01(s.rough) * 255;
      rough[i * 4 + 2] = 0;
      rough[i * 4 + 3] = 255;
      height[i] = s.h;
    }
  }
  // Normals from the wrapped height field (OpenGL convention, +Y = +v).
  const k = (NORMAL_STRENGTH[kind] * size) / 512;
  for (let y = 0; y < size; y++) {
    const ym = ((y - 1 + size) % size) * size, yp = ((y + 1) % size) * size, yr = y * size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size, xp = (x + 1) % size;
      const dx = (height[yr + xp] - height[yr + xm]) * k;
      const dy = (height[yp + x] - height[ym + x]) * k;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (yr + x) * 4;
      normal[i] = (-dx * inv * 0.5 + 0.5) * 255;
      normal[i + 1] = (-dy * inv * 0.5 + 0.5) * 255;
      normal[i + 2] = (inv * 0.5 + 0.5) * 255;
      normal[i + 3] = 255;
    }
  }
  const set = { size, albedo, normal, rough };
  cache.set(key, set);
  return set;
}

export function makeDataTexture(data: Uint8Array, size: number, srgb: boolean, anisotropy: number) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = anisotropy;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/**
 * Two-channel world grime noise: R = large blotches (macro variation),
 * G = vertically streaked detail. Tileable, linear.
 */
export function grimePixels(size = 256): Uint8Array {
  const key = `grime:${size}`;
  const hit = extraCache.get(key);
  if (hit) return hit;
  const n = new Noise(4242), n2 = new Noise(9191);
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const i = (y * size + x) * 4;
      out[i] = n.fbm(u, v, 4, 5) * 255;
      out[i + 1] = n2.fbm(u, v, 8, 4) * 255;
      out[i + 2] = n.fbm(u + 0.5, v + 0.5, 16, 3) * 255;
      out[i + 3] = 255;
    }
  }
  extraCache.set(key, out);
  return out;
}

/**
 * Leaf-cluster card (RGBA, alpha-tested): a dense clump of small leaves
 * with a darker core. `tint` picks a palette (0 = green, 1 = dry).
 */
export function leafPixels(size = 256, tint = 0, seed = 3): Uint8Array {
  const key = `leaf:${size}:${tint}:${seed}`;
  const hit = extraCache.get(key);
  if (hit) return hit;
  const out = new Uint8Array(size * size * 4);
  const r = mulberry32(seed * 1013 + tint * 7);
  const leaves = Math.round(size * 1.6);
  const palette = tint
    ? [[0.55, 0.5, 0.3], [0.48, 0.42, 0.24], [0.4, 0.38, 0.22]]
    : [[0.3, 0.38, 0.16], [0.24, 0.32, 0.13], [0.36, 0.4, 0.2], [0.2, 0.26, 0.12]];
  for (let k = 0; k < leaves; k++) {
    // Leaves cluster toward the centre, sparse at the edges.
    const ang = r() * Math.PI * 2;
    const rad = Math.sqrt(r()) * 0.44;
    const cx = (0.5 + Math.cos(ang) * rad) * size;
    const cy = (0.5 + Math.sin(ang) * rad) * size;
    const len = size * (0.035 + r() * 0.03);
    const wid = len * (0.35 + r() * 0.15);
    const rot = r() * Math.PI;
    const c = palette[Math.floor(r() * palette.length)];
    const shade = 0.7 + r() * 0.45 - rad * 0.3;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const ext = Math.ceil(len);
    for (let y = Math.max(0, Math.floor(cy - ext)); y < Math.min(size, Math.ceil(cy + ext)); y++) {
      for (let x = Math.max(0, Math.floor(cx - ext)); x < Math.min(size, Math.ceil(cx + ext)); x++) {
        const dx = x - cx, dy = y - cy;
        const lx = (dx * cs + dy * sn) / len, ly = (-dx * sn + dy * cs) / wid;
        const d = lx * lx + ly * ly;
        if (d > 1) continue;
        const i = (y * size + x) * 4;
        const vein = Math.abs(ly) < 0.12 ? 0.85 : 1;
        const lit = shade * vein * (1 - d * 0.25);
        out[i] = clamp01(c[0] * lit) * 255;
        out[i + 1] = clamp01(c[1] * lit) * 255;
        out[i + 2] = clamp01(c[2] * lit) * 255;
        out[i + 3] = 255;
      }
    }
  }
  // Bleed colour into transparent texels so mip levels don't fringe dark/white.
  for (let i = 0; i < size * size * 4; i += 4) {
    if (out[i + 3] === 0) {
      out[i] = palette[0][0] * 120;
      out[i + 1] = palette[0][1] * 120;
      out[i + 2] = palette[0][2] * 120;
    }
  }
  extraCache.set(key, out);
  return out;
}
