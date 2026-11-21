import * as THREE from "three";

/**
 * Deterministic CPU noise + the procedurally generated effect textures
 * (fireball flipbook). Everything here is licence-free and built once.
 */

export function hash(x: number, y: number, s: number) {
  let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function noise(x: number, y: number, s: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi, s);
  const b = hash(xi + 1, yi, s);
  const c = hash(xi, yi + 1, s);
  const d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x: number, y: number, s: number) {
  return noise(x, y, s) * 0.5 + noise(x * 2, y * 2, s + 1) * 0.3 + noise(x * 4, y * 4, s + 2) * 0.2;
}

export const sat = (v: number) => Math.max(0, Math.min(1, v));
export const sstep = (a: number, b: number, x: number) => {
  const t = sat((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Fireball flipbook layout: FRAMES_X × FRAMES_X frames, FRAME_PX square each. */
export const FLIPBOOK = { cols: 4, frames: 16, px: 64 } as const;

/**
 * One fireball frame at normalised time t ∈ 0..1, written into `out`
 * (FRAME_PX² × 4 bytes) as R = heat, G = coverage, B = top-lit shading.
 * Early frames are a dense white-hot core; it billows outward, the heat
 * collapses inward and the edges roll over into dark smoke.
 */
export function fireballFrame(t: number, out: Uint8Array, stride: number, ox: number, oy: number, px: number = FLIPBOOK.px) {
  const dens = (u: number, v: number) => {
    const grow = 0.42 + 0.5 * Math.sqrt(t);
    // Domain-warped billows that churn outward with time.
    const wx = fbm(u * 2.2 + 3.1, v * 2.2 - t * 1.7, 5) - 0.5;
    const wy = fbm(u * 2.2 - 1.3, v * 2.2 - t * 1.3, 9) - 0.5;
    const n = fbm(u * 3.4 + wx * 1.6, v * 3.4 + wy * 1.6 - t * 2.2, 17);
    const r = Math.hypot(u, v) / grow;
    return sat((1 - r) * 1.6 + (n - 0.5) * (0.9 + t * 0.8) - t * 0.35);
  };
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const u = ((x + 0.5) / px) * 2 - 1;
      const v = ((y + 0.5) / px) * 2 - 1;
      const d = dens(u, v);
      const cov = sstep(0.02, 0.45, d) * sstep(1, 0.86, Math.hypot(u, v));
      // Heat: strongest in the thick core, burning out from the rim inward.
      const n2 = fbm(u * 5 + 11, v * 5 - t * 3, 23);
      const heat = sat(sstep(0.35 + t * 0.55, 0.95, d + (n2 - 0.5) * 0.3) * (1.15 - t * 0.85));
      // Light from above: denser below the sample = lit top surface.
      const e = 2 / px;
      const shade = sat(0.55 + (dens(u, v - e * 2) - dens(u, v + e * 2)) * 2.4);
      const i = ((oy + y) * stride + ox + x) * 4;
      out[i] = heat * 255;
      out[i + 1] = cov * 255;
      out[i + 2] = shade * 255;
      out[i + 3] = 255;
    }
  }
}

/** The whole flipbook as raw RGBA bytes (cols·px square). */
export function fireballAtlasData(px: number = FLIPBOOK.px) {
  const { cols, frames } = FLIPBOOK;
  const W = cols * px;
  const data = new Uint8Array(W * W * 4);
  for (let f = 0; f < frames; f++) fireballFrame(f / (frames - 1), data, W, (f % cols) * px, Math.floor(f / cols) * px, px);
  return { data, size: W };
}

export function fireballAtlas(px: number = FLIPBOOK.px) {
  const { data, size } = fireballAtlasData(px);
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}
