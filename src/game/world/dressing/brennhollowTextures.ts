import * as THREE from "three";
import { makeDataTexture } from "../../render/ProceduralTextures";

/**
 * Brennhollow's own tileable PBR textures, generated on the CPU once per
 * size and cached as pixels (albedo, normal from a height field,
 * roughness): slate roof courses, granite setts, rubble-stone masonry and a
 * meadow for the hills. Each feeds one merged mesh, so they cost one draw
 * call apiece.
 */

export type TexKind = "slate" | "setts" | "stone" | "meadow" | "timber";
type Pixels = { size: number; albedo: Uint8Array; normal: Uint8Array; rough: Uint8Array };
const cache = new Map<string, Pixels>();

function hash2(x: number, y: number, s = 0) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Periodic value noise (period p cells). */
function pnoise(x: number, y: number, p: number, s = 0) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(mod(x0, p), mod(y0, p), s), b = hash2(mod(x0 + 1, p), mod(y0, p), s);
  const c = hash2(mod(x0, p), mod(y0 + 1, p), s), d = hash2(mod(x0 + 1, p), mod(y0 + 1, p), s);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function pfbm(x: number, y: number, p: number, oct: number, s = 0) {
  let v = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) {
    v += pnoise(x, y, p, s + i * 17) * a;
    n += a;
    x *= 2;
    y *= 2;
    p *= 2;
    a *= 0.5;
  }
  return v / n;
}
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

type Sample = { r: number; g: number; b: number; h: number; rough: number };

function generate(kind: TexKind, S: number): Pixels {
  const albedo = new Uint8Array(S * S * 4), normal = new Uint8Array(S * S * 4), rough = new Uint8Array(S * S * 4);
  const height = new Float32Array(S * S);
  const o: Sample = { r: 0, g: 0, b: 0, h: 0, rough: 1 };
  const fn = SAMPLERS[kind];
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      fn(i / S, j / S, o);
      const k = j * S + i;
      albedo[k * 4] = Math.round(clamp01(o.r) * 255);
      albedo[k * 4 + 1] = Math.round(clamp01(o.g) * 255);
      albedo[k * 4 + 2] = Math.round(clamp01(o.b) * 255);
      albedo[k * 4 + 3] = 255;
      rough[k * 4] = rough[k * 4 + 1] = rough[k * 4 + 2] = Math.round(clamp01(o.rough) * 255);
      rough[k * 4 + 3] = 255;
      height[k] = o.h;
    }
  }
  const strength = NORMAL_STRENGTH[kind] * (S / 512);
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const hl = height[j * S + mod(i - 1, S)], hr = height[j * S + mod(i + 1, S)];
      const hd = height[mod(j - 1, S) * S + i], hu = height[mod(j + 1, S) * S + i];
      let nx = (hl - hr) * strength, ny = (hd - hu) * strength;
      const nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      const k = (j * S + i) * 4;
      normal[k] = Math.round((nx * 0.5 + 0.5) * 255);
      normal[k + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normal[k + 2] = Math.round((nz / l * 0.5 + 0.5) * 255);
      normal[k + 3] = 255;
    }
  }
  return { size: S, albedo, normal, rough };
}

const NORMAL_STRENGTH: Record<TexKind, number> = { slate: 7, setts: 9, stone: 7, meadow: 4, timber: 5 };

/** Texture-space (u, v in 0..1, v up). */
const SAMPLERS: Record<TexKind, (u: number, v: number, o: Sample) => void> = {
  // 1.6 m tile: 8 courses of overlapping slates, staggered joints, lichen, streaks.
  slate(u, v, o) {
    const rows = 8;
    const rv = v * rows;
    const row = Math.floor(rv), fv = rv - row;
    const n = 5 + Math.floor(hash2(row, 3) * 2);
    const ru = u * n + (row % 2) * 0.5 + hash2(row, 7) * 0.2;
    const col = Math.floor(ru), fu = ru - col;
    const id = hash2(mod(col, n), row, 11);
    // Each slate sits proud at its lower edge (where it overlaps the course below) and tapers up.
    const edgeU = Math.min(fu, 1 - fu);
    const joint = sstep(0.0, 0.035, edgeU);
    const chip = hash2(mod(col, n), row, 13) < 0.12 ? sstep(0.0, 0.25, fv + (fu - 0.5) * 0.6) : 1;
    const grain = pfbm(u * 40, v * 6, 40, 2, 5) * 0.08;
    o.h = (0.35 + (1 - fv) * 0.65) * joint * chip + grain;
    const tone = 0.21 + id * 0.08 + (pfbm(u * 8, v * 8, 8, 3, 2) - 0.5) * 0.05;
    const blue = 0.012 + hash2(mod(col, n), row, 17) * 0.02;
    let r = tone, g = tone + blue * 0.6, b = tone + blue * 1.6;
    // Lichen blotches (ochre-grey) and darker damp at the overlaps.
    const lich = sstep(0.62, 0.74, pfbm(u * 12, v * 12, 12, 3, 9));
    r += lich * 0.16;
    g += lich * 0.15;
    b += lich * 0.06;
    const damp = (1 - sstep(0.0, 0.18, fv)) * 0.35 + (1 - joint) * 0.6;
    const k = 1 - damp * 0.6;
    o.r = r * k;
    o.g = g * k;
    o.b = b * k;
    o.rough = 0.62 + id * 0.15 + damp * 0.2 - lich * 0.05 + 0.1;
  },
  // 2 m tile: granite setts in staggered courses, joints of dirt with the odd tuft.
  setts(u, v, o) {
    const rows = 16;
    const rv = v * rows;
    const row = Math.floor(rv), fv = rv - row;
    const n = 14;
    const ru = u * n + (row % 2) * 0.5 + (hash2(row, 2) - 0.5) * 0.3;
    const col = Math.floor(ru), fu = ru - col;
    const id = hash2(mod(col, n), row, 5);
    const wobble = (pnoise(u * 60, v * 60, 60, 3) - 0.5) * 0.08;
    const eu = Math.min(fu, 1 - fu) + wobble, ev = Math.min(fv, 1 - fv) + wobble;
    const e = Math.min(eu * 1.15, ev);
    const top = sstep(0.02, 0.2, e);
    const worn = pfbm(u * 30, v * 30, 30, 2, 7);
    o.h = top * (0.75 + id * 0.25) * (0.9 + worn * 0.2) + Math.sqrt(Math.max(0, e)) * 0.25;
    const speck = hash2(Math.floor(u * 512), Math.floor(v * 512), 9);
    const base = 0.38 + id * 0.16 + (speck - 0.5) * 0.06;
    const warm = hash2(mod(col, n), row, 8);
    let r = base + warm * 0.05, g = base + warm * 0.02, b = base - 0.01 - warm * 0.03;
    const mudN = pfbm(u * 6, v * 6, 6, 3, 4);
    const mud = sstep(0.55, 0.75, mudN) * 0.4;
    r = r * (1 - mud) + 0.33 * mud;
    g = g * (1 - mud) + 0.29 * mud;
    b = b * (1 - mud) + 0.22 * mud;
    // Joints: dark grit, mossy green in places.
    const j = 1 - top;
    const moss = sstep(0.5, 0.7, pfbm(u * 10 + 3, v * 10, 10, 2, 12));
    const jr = 0.18 + moss * 0.02, jg = 0.16 + moss * 0.1, jb = 0.12;
    o.r = r * (1 - j) + jr * j;
    o.g = g * (1 - j) + jg * j;
    o.b = b * (1 - j) + jb * j;
    o.rough = 0.72 + j * 0.25 - top * worn * 0.12;
  },
  // 2.4 m tile: rubble-stone masonry, irregular stones in rough courses, lime mortar.
  stone(u, v, o) {
    const rows = 9;
    const wv = v * rows + (pnoise(u * 6, v * 6, 6, 1) - 0.5) * 0.14;
    const row = Math.floor(wv);
    let fv = wv - row;
    const rr = mod(row, rows);
    const n = 6 + Math.floor(hash2(rr, 7) * 4);
    const ru = u * n + hash2(rr, 1) * 3 + (pnoise(u * 10, v * 10, 10, 2) - 0.5) * 0.18;
    const col = Math.floor(ru);
    let fu = ru - col;
    const cc = mod(col, n);
    let id = hash2(cc, rr, 3);
    // Some stones are pairs of smaller ones (split across or along), giving a rubble look.
    let sub = 0;
    if (id > 0.62) {
      if (id > 0.82) { sub = fv > 0.5 ? 1 : 2; fv = fv > 0.5 ? (fv - 0.5) * 2 : fv * 2; }
      else { const cut = 0.35 + hash2(cc, rr, 9) * 0.3; sub = fu > cut ? 3 : 4; fu = fu > cut ? (fu - cut) / (1 - cut) : fu / cut; }
      id = hash2(cc * 3 + sub, rr, 5);
    }
    const ex = Math.min(fu, 1 - fu) * (1.4 + id * 0.6), ey = Math.min(fv, 1 - fv);
    const e = Math.min(ex, ey);
    const bump = pfbm(u * 24, v * 24, 24, 3, 6);
    const top = sstep(0.01, 0.06 + id * 0.04, e + (bump - 0.5) * 0.05);
    o.h = top * (0.65 + Math.min(1, e * 5) * 0.2 + bump * 0.35 + id * 0.1);
    const hue = hash2(cc + sub * 17, rr, 4);
    const tone = 0.5 + id * 0.3 + (bump - 0.5) * 0.16;
    let r = tone + (hue - 0.5) * 0.1, g = tone * 0.96, b = tone * 0.88 - (hue - 0.5) * 0.06;
    if (hue > 0.85) { r *= 0.78; g *= 0.8; b *= 0.84; }
    else if (hue < 0.12) { r *= 1.06; g *= 0.98; b *= 0.86; }
    const stain = sstep(0.6, 0.85, pfbm(u * 4, v * 3, 4, 3, 8)) * 0.15;
    r *= 1 - stain; g *= 1 - stain * 0.9; b *= 1 - stain * 0.8;
    const m = 1 - top;
    const mortar = 0.44 + (pnoise(u * 90, v * 90, 90, 5) - 0.5) * 0.1;
    o.r = r * (1 - m) + mortar * 0.98 * m;
    o.g = g * (1 - m) + mortar * 0.94 * m;
    o.b = b * (1 - m) + mortar * 0.86 * m;
    o.rough = 0.85 + m * 0.12;
  },
  // 4 m tile: meadow grass seen from a distance (blades, clover, earth showing through).
  meadow(u, v, o) {
    const n1 = pfbm(u * 8, v * 8, 8, 4, 1);
    const blades = pnoise(u * 220, v * 60, 220, 2) * 0.6 + pnoise(u * 90, v * 300, 90, 3) * 0.4;
    const earth = sstep(0.62, 0.78, pfbm(u * 5, v * 5, 5, 3, 4)) * 0.5;
    const flower = hash2(Math.floor(u * 300), Math.floor(v * 300), 6) > 0.997 ? 1 : 0;
    o.h = blades * 0.8 + n1 * 0.4 - earth * 0.3;
    const g0 = 0.3 + n1 * 0.12 + blades * 0.08;
    let r = g0 * 0.62, g = g0, b = g0 * 0.34;
    r = r * (1 - earth) + 0.32 * earth;
    g = g * (1 - earth) + 0.27 * earth;
    b = b * (1 - earth) + 0.18 * earth;
    if (flower) { r = 0.85; g = 0.82; b = 0.7; }
    o.r = r;
    o.g = g;
    o.b = b;
    o.rough = 0.95;
  },
  // 2 m tile: weathered vertical boards (barn gables, sheds, shutters).
  timber(u, v, o) {
    const n = 10;
    const ru = u * n;
    const col = Math.floor(ru), fu = ru - col;
    const id = hash2(col, 1, 2);
    const grain = pnoise(u * n * 6 + id * 9, v * 40, n * 6, 3) * 0.6 + pnoise(u * 300, v * 8, 300, 4) * 0.4;
    const gap = sstep(0.0, 0.05, Math.min(fu, 1 - fu));
    o.h = gap * (0.7 + grain * 0.3);
    // Near-neutral and light: the vertex tint gives the wood its colour.
    const tone = 0.8 + id * 0.16 + (grain - 0.5) * 0.2;
    const silver = hash2(col, 3, 4) * 0.3;
    const k = 0.45 + gap * 0.55;
    o.r = Math.min(1, tone * (1 + silver * 0.05)) * k;
    o.g = Math.min(1, tone * (0.97 + silver * 0.03)) * k;
    o.b = Math.min(1, tone * (0.93 + silver * 0.06)) * k;
    o.rough = 0.92;
  },
};

/** Metres per texture repeat. */
export const TILE: Record<TexKind, number> = { slate: 1.6, setts: 2.0, stone: 2.0, meadow: 4, timber: 2 };

/** A lit, vertex-coloured standard material for a kind (caller owns/disposes it). */
export function villageMaterial(kind: TexKind, size: number, anisotropy: number) {
  const key = `${kind}:${size}`;
  let px = cache.get(key);
  if (!px) {
    px = generate(kind, size);
    cache.set(key, px);
  }
  const map = makeDataTexture(px.albedo, size, true, anisotropy);
  const normalMap = makeDataTexture(px.normal, size, false, anisotropy);
  const roughnessMap = makeDataTexture(px.rough, size, false, anisotropy);
  const rep = 1 / TILE[kind];
  for (const t of [map, normalMap, roughnessMap]) t.repeat.set(rep, rep);
  const mat = new THREE.MeshStandardMaterial({ map, normalMap, roughnessMap, vertexColors: true, roughness: 1, metalness: 0 });
  mat.name = `bh-${kind}`;
  mat.normalScale.set(1, 1);
  return { mat, dispose: () => [map, normalMap, roughnessMap, mat].forEach((d) => d.dispose()) };
}
