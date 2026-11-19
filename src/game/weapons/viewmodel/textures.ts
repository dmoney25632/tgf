import * as THREE from "three";

/**
 * Procedural detail maps for the viewmodel, packed into ONE texture array so
 * every gun, hand and sleeve shares a single material (one draw call per
 * moving part). Each layer is RGBA8, tileable, 1024²:
 *
 *   R, G — tangent-space normal X / Y (Z is reconstructed in the shader)
 *   B    — wear mask: scratches / scuffs that cut through paint to metal
 *   A    — roughness variation (0.5 = neutral): fingerprints, polish, grime
 *
 * Generated on the CPU from pre-baked lattice noise (no DOM canvas needed).
 */

export const DETAIL_SIZE = 1024;

export const LAYER = {
  metal: 0,
  polymer: 1,
  stipple: 2,
  fabric: 3,
  glove: 4,
  knurl: 5,
  rubber: 6,
} as const;
export type LayerName = keyof typeof LAYER;
const LAYERS = Object.keys(LAYER).length;

const S = DETAIL_SIZE;
const N = S * S;

/** Deterministic hash → [0, 1). */
function hash(x: number, y: number, seed: number) {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Tileable value noise: a random lattice of (S / cell)² points, smoothstep-
 * interpolated into `out` (added with weight `amp`).
 */
function addNoise(out: Float32Array, cell: number, amp: number, seed: number, sx = 1, sy = 1) {
  const nx = Math.max(1, Math.round(S / (cell * sx)));
  const ny = Math.max(1, Math.round(S / (cell * sy)));
  const lat = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) lat[j * nx + i] = hash(i, j, seed);
  const cx = S / nx;
  const cy = S / ny;
  for (let y = 0; y < S; y++) {
    const fy = y / cy;
    const y0 = Math.floor(fy);
    let ty = fy - y0;
    ty = ty * ty * (3 - 2 * ty);
    const r0 = (y0 % ny) * nx;
    const r1 = ((y0 + 1) % ny) * nx;
    for (let x = 0; x < S; x++) {
      const fx = x / cx;
      const x0 = Math.floor(fx);
      let tx = fx - x0;
      tx = tx * tx * (3 - 2 * tx);
      const c0 = x0 % nx;
      const c1 = (x0 + 1) % nx;
      const a = lat[r0 + c0];
      const b = lat[r0 + c1];
      const c = lat[r1 + c0];
      const d = lat[r1 + c1];
      out[y * S + x] += (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty) * amp;
    }
  }
}

function fbm(cell: number, octaves: number, seed: number, sx = 1, sy = 1) {
  const out = new Float32Array(N);
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves && cell >= 1; o++) {
    addNoise(out, cell, amp, seed + o * 31, sx, sy);
    norm += amp;
    amp *= 0.5;
    cell /= 2;
  }
  for (let i = 0; i < N; i++) out[i] /= norm;
  return out;
}

/** Cellular (Worley F1) distance in cell units, tileable. */
function worley(cell: number, seed: number, jitter = 0.8) {
  const out = new Float32Array(N);
  const n = Math.round(S / cell);
  const c = S / n;
  for (let y = 0; y < S; y++) {
    const gy = Math.floor(y / c);
    for (let x = 0; x < S; x++) {
      const gx = Math.floor(x / c);
      let best = 9;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const ix = gx + ox;
          const iy = gy + oy;
          const wx = ((ix % n) + n) % n;
          const wy = ((iy % n) + n) % n;
          const fx = (ix + 0.5 + (hash(wx, wy, seed) - 0.5) * jitter) * c;
          const fy = (iy + 0.5 + (hash(wx, wy, seed + 1) - 0.5) * jitter) * c;
          const d = (x - fx) * (x - fx) + (y - fy) * (y - fy);
          if (d < best * c * c) best = d / (c * c);
        }
      }
      out[y * S + x] = Math.sqrt(best);
    }
  }
  return out;
}

/** Draw anti-aliased strokes (scratches) into height + mask fields. */
function scratches(h: Float32Array, mask: Float32Array, count: number, seed: number, minLen: number, maxLen: number, depth: number, dirBias = -1) {
  for (let s = 0; s < count; s++) {
    let px = hash(s, 1, seed) * S;
    let py = hash(s, 2, seed) * S;
    const ang = dirBias >= 0 ? dirBias + (hash(s, 3, seed) - 0.5) * 0.5 : hash(s, 3, seed) * Math.PI;
    const len = minLen + hash(s, 4, seed) * (maxLen - minLen);
    const curve = (hash(s, 5, seed) - 0.5) * 0.004;
    const strength = 0.4 + hash(s, 6, seed) * 0.6;
    let a = ang;
    for (let k = 0; k < len; k++) {
      a += curve;
      const fade = Math.sin((k / len) * Math.PI);
      const ix = ((Math.round(px) % S) + S) % S;
      const iy = ((Math.round(py) % S) + S) % S;
      const i = iy * S + ix;
      h[i] -= depth * fade * strength;
      mask[i] = Math.max(mask[i], fade * strength);
      // 1-texel soft shoulder.
      const j = iy * S + ((ix + 1) % S);
      mask[j] = Math.max(mask[j], fade * strength * 0.4);
      px += Math.cos(a);
      py += Math.sin(a);
    }
  }
}

/** Height → packed RGBA layer (normal XY, wear mask, roughness variation). */
function pack(dst: Uint8Array, offset: number, h: Float32Array, strength: number, mask: Float32Array | null, rough: Float32Array) {
  const at = (x: number, y: number) => h[((y + S) % S) * S + ((x + S) % S)];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = y * S + x;
      const o = offset + i * 4;
      dst[o] = (-dx * inv * 0.5 + 0.5) * 255;
      dst[o + 1] = (-dy * inv * 0.5 + 0.5) * 255;
      dst[o + 2] = mask ? Math.min(255, Math.max(0, mask[i] * 255)) : 0;
      dst[o + 3] = Math.min(255, Math.max(0, rough[i] * 255));
    }
  }
}

let cache: THREE.DataArrayTexture | null = null;

/** The shared detail texture array (built once per page). */
export function detailArray(): THREE.DataArrayTexture {
  if (cache) return cache;
  const data = new Uint8Array(N * 4 * LAYERS);
  const off = (l: number) => l * N * 4;

  // ---- Metal: machining grain, tool marks, scratches, fingerprints ---------
  {
    const grain = fbm(6, 3, 3);
    const lines = fbm(3, 2, 9, 1, 40); // stretched → linear machining marks
    const h = new Float32Array(N);
    const mask = new Float32Array(N);
    for (let i = 0; i < N; i++) h[i] = grain[i] * 0.35 + lines[i] * 0.25;
    scratches(h, mask, 260, 77, 20, 160, 0.9);
    scratches(h, mask, 90, 78, 60, 260, 0.5, 0.1);
    // Fingerprints: clusters of concentric arcs → oily, lower roughness.
    const r = fbm(96, 4, 21);
    const prints = worley(220, 5, 0.9);
    const smudge = fbm(48, 3, 61);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        const blob = Math.max(0, 1 - prints[i] * 2.4);
        const ridges = blob > 0 ? (Math.sin(prints[i] * 220) * 0.5 + 0.5) * blob : 0;
        r[i] = 0.5 + (r[i] - 0.5) * 0.7 - ridges * 0.22 - Math.max(0, smudge[i] - 0.62) * 0.6 - mask[i] * 0.25;
      }
    }
    pack(data, off(LAYER.metal), h, 4.5, mask, r);
  }

  // ---- Polymer: pebbled injection-mould texture + scuffs -------------------
  {
    const peb = worley(7, 41, 0.9);
    const h = new Float32Array(N);
    const low = fbm(64, 3, 43);
    for (let i = 0; i < N; i++) h[i] = Math.min(1, peb[i]) * 0.5 + low[i] * 0.2;
    const mask = new Float32Array(N);
    scratches(h, mask, 140, 91, 10, 70, 0.4);
    const scuff = fbm(40, 4, 55);
    const r = fbm(80, 3, 57);
    for (let i = 0; i < N; i++) {
      mask[i] = Math.max(mask[i] * 0.8, Math.max(0, scuff[i] - 0.6) * 2);
      r[i] = 0.5 + (r[i] - 0.5) * 0.5 + (peb[i] - 0.4) * 0.15;
    }
    pack(data, off(LAYER.polymer), h, 3.2, mask, r);
  }

  // ---- Stipple: aggressive raised dots (grip panels) -----------------------
  {
    const d = worley(9, 5, 0.75);
    const fine = fbm(4, 2, 7);
    const h = new Float32Array(N);
    const r = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const bump = Math.max(0, 1 - d[i] * 1.7);
      h[i] = Math.sqrt(bump) + fine[i] * 0.15;
      r[i] = 0.5 + (bump > 0.5 ? -0.08 : 0.06);
    }
    pack(data, off(LAYER.stipple), h, 5, null, r);
  }

  // ---- Fabric: 2/1 twill weave + slubs (sleeves, slings) -------------------
  {
    const h = new Float32Array(N);
    const slub = fbm(24, 3, 91, 1, 4);
    const fuzz = fbm(4, 2, 93);
    const P = 8; // texels per thread
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const tx = Math.floor(x / P);
        const ty = Math.floor(y / P);
        const over = ((tx + ty) % 3) < 2; // twill diagonal
        const u = (x % P) / P;
        const v = (y % P) / P;
        const warp = Math.sin(u * Math.PI);
        const weft = Math.sin(v * Math.PI);
        const i = y * S + x;
        h[i] = (over ? 0.6 + warp * 0.4 * (0.8 + slub[i] * 0.4) : 0.3 + weft * 0.35) + fuzz[i] * 0.12;
      }
    }
    const r = fbm(64, 3, 95);
    for (let i = 0; i < N; i++) r[i] = 0.5 + (r[i] - 0.5) * 0.4;
    pack(data, off(LAYER.fabric), h, 2.6, null, r);
  }

  // ---- Glove: synthetic leather grain + scuffed wear on the palm -----------
  {
    const cells = worley(12, 17, 1);
    const fine = fbm(5, 3, 19);
    const h = new Float32Array(N);
    for (let i = 0; i < N; i++) h[i] = Math.min(1, cells[i] * 1.2) * 0.45 + fine[i] * 0.25;
    const mask = new Float32Array(N);
    const sc = fbm(56, 4, 23);
    for (let i = 0; i < N; i++) mask[i] = Math.max(0, sc[i] - 0.58) * 2.2;
    const r = fbm(40, 3, 29);
    for (let i = 0; i < N; i++) r[i] = 0.5 + (r[i] - 0.5) * 0.5 - mask[i] * 0.12 + (cells[i] < 0.25 ? 0.05 : 0);
    pack(data, off(LAYER.glove), h, 2.4, mask, r);
  }

  // ---- Knurl: diamond knurling (knobs, turrets, suppressor caps, cord) -----
  {
    const h = new Float32Array(N);
    const P = 16;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const a = Math.abs(((x + y) % P) / P - 0.5);
        const b = Math.abs((((x - y) % P) + P) % P / P - 0.5);
        h[y * S + x] = 1 - Math.max(a, b) * 2;
      }
    }
    const r = fbm(64, 2, 33);
    for (let i = 0; i < N; i++) r[i] = 0.5 + (r[i] - 0.5) * 0.4;
    pack(data, off(LAYER.knurl), h, 3.5, null, r);
  }

  // ---- Rubber: fine matte grain --------------------------------------------
  {
    const h = fbm(5, 3, 71);
    const r = fbm(48, 3, 73);
    for (let i = 0; i < N; i++) r[i] = 0.5 + (r[i] - 0.5) * 0.3;
    pack(data, off(LAYER.rubber), h, 1.8, null, r);
  }

  const tex = new THREE.DataArrayTexture(data, S, S, LAYERS);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  cache = tex;
  return tex;
}

export function disposeDetailArray() {
  cache?.dispose();
  cache = null;
}
