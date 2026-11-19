import * as THREE from "three";

/**
 * Procedural, tileable textures for the soldiers, generated once into typed
 * arrays (DataTexture, so this also runs headless) and shared by every
 * soldier. All patterns are original designs.
 *
 * - camo mask (RGBA): R = large soft blobs, G = second blob layer,
 *   B = blocky "digital" layer, A = fine fibre noise. The uber shader turns
 *   these masks into colour using each vertex's base colour, so one texture
 *   serves every palette.
 * - fabric normal: woven ripstop grid + fibre noise.
 * - ghillie strands: alpha-cut hanging burlap strips.
 */

let camo: THREE.DataTexture | null = null;
let fabricN: THREE.DataTexture | null = null;
let strands: THREE.DataTexture | null = null;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Periodic value noise: a lattice of `period` cells that wraps seamlessly. */
function lattice(period: number, seed: number) {
  const r = rng(seed);
  const v = new Float32Array(period * period);
  for (let i = 0; i < v.length; i++) v[i] = r();
  return (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % period) + period) % period, y0 = ((yi % period) + period) % period;
    const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
    const a = v[y0 * period + x0], b = v[y0 * period + x1];
    const c = v[y1 * period + x0], d = v[y1 * period + x1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

/** Tileable fBm over [0,1)^2. */
function fbm(base: number, octaves: number, seed: number) {
  const layers = Array.from({ length: octaves }, (_, o) => ({ f: base << o, n: lattice(base << o, seed + o * 101) }));
  return (u: number, v: number) => {
    let sum = 0, amp = 1, norm = 0;
    for (const l of layers) {
      sum += l.n(u * l.f, v * l.f) * amp;
      norm += amp;
      amp *= 0.5;
    }
    return sum / norm;
  };
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export function camoTexture() {
  if (camo) return camo;
  const N = 256;
  const data = new Uint8Array(N * N * 4);
  const blobA = fbm(4, 4, 11);
  const blobB = fbm(5, 4, 37);
  const warp = fbm(3, 2, 71);
  const dig = lattice(32, 93);
  const fibre = fbm(32, 2, 5);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N;
      // Domain-warped blobs give organic, brush-stroke-ish shapes.
      const w = (warp(u, v) - 0.5) * 0.12;
      const a = smooth(0.52, 0.56, blobA(u + w, v - w));
      const b = smooth(0.55, 0.585, blobB(u - w * 0.7, v + w * 1.3)) * (1 - a * 0.6);
      // Blocky layer: 8px cells, clustered by the blob field so it reads as
      // pixel-edged patches rather than uniform static.
      const cx = Math.floor(x / 8), cy = Math.floor(y / 8);
      const cell = dig(cx + 0.5, cy + 0.5);
      const d = cell > 0.62 - (blobB((cx + 0.5) / 32, (cy + 0.5) / 32) - 0.5) * 0.5 ? 1 : 0;
      const f = fibre(u, v);
      const i = (y * N + x) * 4;
      data[i] = a * 255;
      data[i + 1] = b * 255;
      data[i + 2] = d * 255;
      data[i + 3] = f * 255;
    }
  }
  camo = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  camo.wrapS = camo.wrapT = THREE.RepeatWrapping;
  camo.magFilter = THREE.LinearFilter;
  camo.minFilter = THREE.LinearMipmapLinearFilter;
  camo.generateMipmaps = true;
  camo.colorSpace = THREE.NoColorSpace;
  camo.needsUpdate = true;
  return camo;
}

export function fabricNormalTexture() {
  if (fabricN) return fabricN;
  const N = 128;
  const h = new Float32Array(N * N);
  const noise = fbm(16, 3, 202);
  const ripstop = 16; // grid cells per tile
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N;
      // Plain weave: alternating over/under threads.
      const wu = Math.sin(u * Math.PI * 2 * 32), wv = Math.sin(v * Math.PI * 2 * 32);
      let val = 0.5 + 0.25 * wu * Math.sign(wv) * 0.6 + 0.25 * wv * Math.sign(wu) * 0.6;
      // Ripstop reinforcement grid.
      const gx = Math.abs(((u * ripstop) % 1) - 0.5), gy = Math.abs(((v * ripstop) % 1) - 0.5);
      if (gx > 0.44 || gy > 0.44) val += 0.35;
      val += (noise(u, v) - 0.5) * 0.6;
      h[y * N + x] = val;
    }
  }
  const data = new Uint8Array(N * N * 4);
  const s = 2.2;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const l = h[y * N + ((x + N - 1) % N)], r = h[y * N + ((x + 1) % N)];
      const d = h[((y + N - 1) % N) * N + x], t = h[((y + 1) % N) * N + x];
      let nx = (l - r) * s, ny = (d - t) * s;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      const i = (y * N + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = (nz / len) * 0.5 * 255 + 127.5;
      data[i + 3] = 255;
    }
  }
  fabricN = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  fabricN.wrapS = fabricN.wrapT = THREE.RepeatWrapping;
  fabricN.magFilter = THREE.LinearFilter;
  fabricN.minFilter = THREE.LinearMipmapLinearFilter;
  fabricN.generateMipmaps = true;
  fabricN.colorSpace = THREE.NoColorSpace;
  fabricN.needsUpdate = true;
  return fabricN;
}

/** Hanging burlap strips: white albedo (tinted by vertex colour), alpha cut. */
export function strandTexture() {
  if (strands) return strands;
  const W = 64, H = 128;
  const data = new Uint8Array(W * H * 4);
  const r = rng(404);
  const cols: { x: number; w: number; len: number; shade: number; wob: number }[] = [];
  for (let i = 0; i < 22; i++) cols.push({ x: r() * W, w: 1.5 + r() * 3, len: 0.45 + r() * 0.55, shade: 0.65 + r() * 0.35, wob: r() * 6 });
  for (let y = 0; y < H; y++) {
    const v = y / H; // 0 = top (attached), 1 = hanging tip
    for (let x = 0; x < W; x++) {
      let a = 0, shade = 0;
      for (const c of cols) {
        if (v > c.len) continue;
        const cx = c.x + Math.sin(v * 9 + c.wob) * 2.5 * v;
        let dx = Math.abs(x - cx);
        dx = Math.min(dx, W - dx);
        const taper = c.w * (1 - (v / c.len) * 0.6);
        if (dx < taper) {
          a = 1;
          shade = Math.max(shade, c.shade * (0.8 + 0.2 * Math.cos(dx)));
        }
      }
      const i = (y * W + x) * 4;
      const g = shade * 255;
      data[i] = g;
      data[i + 1] = g;
      data[i + 2] = g;
      data[i + 3] = a * 255;
    }
  }
  strands = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  strands.magFilter = THREE.LinearFilter;
  strands.minFilter = THREE.LinearMipmapLinearFilter;
  strands.generateMipmaps = true;
  strands.colorSpace = THREE.SRGBColorSpace;
  strands.needsUpdate = true;
  return strands;
}

export function disposeTextures() {
  camo?.dispose();
  fabricN?.dispose();
  strands?.dispose();
  camo = fabricN = strands = null;
}
