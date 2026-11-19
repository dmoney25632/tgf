import * as THREE from "three";

/**
 * Procedural detail textures for the viewmodel (built once, cached, shared).
 * Generated as DataTextures from tileable value noise, so they need no DOM
 * canvas and cost a few ms at startup.
 */

const SIZE = 256;

/** Deterministic hash → [0, 1). */
function hash(x: number, y: number, seed: number) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Tileable value noise sampled at (x, y) in texels with a lattice of `cell` texels. */
function vnoise(x: number, y: number, cell: number, seed: number) {
  const n = SIZE / cell;
  const fx = x / cell;
  const fy = y / cell;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const w = (i: number) => ((i % n) + n) % n;
  const a = hash(w(x0), w(y0), seed);
  const b = hash(w(x0 + 1), w(y0), seed);
  const c = hash(w(x0), w(y0 + 1), seed);
  const d = hash(w(x0 + 1), w(y0 + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(x: number, y: number, base: number, octaves: number, seed: number) {
  let v = 0;
  let amp = 0.5;
  let cell = base;
  let norm = 0;
  for (let o = 0; o < octaves && cell >= 1; o++) {
    v += vnoise(x, y, cell, seed + o * 17) * amp;
    norm += amp;
    amp *= 0.5;
    cell /= 2;
  }
  return v / norm;
}

/** Height field → tangent-space normal map (RGBA8). */
function heightToNormal(h: Float32Array, strength: number) {
  const data = new Uint8Array(SIZE * SIZE * 4);
  const at = (x: number, y: number) => h[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * SIZE + x) * 4;
      data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  return data;
}

function toTexture(data: Uint8Array, srgb = false) {
  const tex = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Grayscale field → roughness map (G channel is read by three). */
function grayTexture(v: Float32Array) {
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) {
    const g = Math.max(0, Math.min(255, v[i] * 255));
    data[i * 4] = g;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = g;
    data[i * 4 + 3] = 255;
  }
  return toTexture(data);
}

export type DetailTextures = {
  /** Fine machining grain + sparse scratches. */
  metalNormal: THREE.DataTexture;
  metalRough: THREE.DataTexture;
  /** Pebbled injection-moulded polymer. */
  polymerNormal: THREE.DataTexture;
  polymerRough: THREE.DataTexture;
  /** Aggressive grip stippling. */
  stippleNormal: THREE.DataTexture;
  /** Woven fabric (sleeves, gloves). */
  fabricNormal: THREE.DataTexture;
  /** Wood-free laminated texture used for knife handle / cord wraps. */
  cordNormal: THREE.DataTexture;
  dispose(): void;
};

let cache: DetailTextures | null = null;

export function detailTextures(): DetailTextures {
  if (cache) return cache;
  const N = SIZE * SIZE;

  // Metal: soft fbm grain, faint linear machining marks, a few scratches.
  const mh = new Float32Array(N);
  const mr = new Float32Array(N);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      const grain = fbm(x, y, 8, 3, 3);
      const lines = vnoise(x, y * 0.06, 2, 9) * 0.35;
      mh[i] = grain * 0.6 + lines;
      mr[i] = 0.78 + (fbm(x, y, 64, 4, 21) - 0.5) * 0.45 + (grain - 0.5) * 0.12;
    }
  }
  // Scratches: random short strokes (lower height, polished → less rough).
  for (let s = 0; s < 70; s++) {
    let px = hash(s, 1, 77) * SIZE;
    let py = hash(s, 2, 77) * SIZE;
    const ang = hash(s, 3, 77) * Math.PI;
    const len = 8 + hash(s, 4, 77) * 40;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    for (let k = 0; k < len; k++) {
      const ix = ((Math.round(px) % SIZE) + SIZE) % SIZE;
      const iy = ((Math.round(py) % SIZE) + SIZE) % SIZE;
      const i = iy * SIZE + ix;
      mh[i] -= 0.5;
      mr[i] = Math.min(mr[i], 0.45);
      px += dx;
      py += dy;
    }
  }

  // Polymer: pebbled bumps.
  const ph = new Float32Array(N);
  const pr = new Float32Array(N);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      const peb = fbm(x, y, 4, 2, 41);
      ph[i] = peb;
      pr[i] = 0.85 + (fbm(x, y, 32, 3, 55) - 0.5) * 0.25 - (peb - 0.5) * 0.15;
    }
  }

  // Stipple: dense raised dots (Worley-ish via hashed cells).
  const sh = new Float32Array(N);
  const cell = 6;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      let best = 9;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const gx = cx + ox;
          const gy = cy + oy;
          const wx = ((gx % (SIZE / cell)) + SIZE / cell) % (SIZE / cell);
          const wy = ((gy % (SIZE / cell)) + SIZE / cell) % (SIZE / cell);
          const fx = (gx + 0.2 + hash(wx, wy, 5) * 0.6) * cell;
          const fy = (gy + 0.2 + hash(wx, wy, 6) * 0.6) * cell;
          best = Math.min(best, Math.hypot(x - fx, y - fy) / cell);
        }
      }
      sh[y * SIZE + x] = Math.max(0, 1 - best * 1.6);
    }
  }

  // Fabric: two-axis weave.
  const fh = new Float32Array(N);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const warp = Math.sin((x / SIZE) * Math.PI * 2 * 64) * 0.5 + 0.5;
      const weft = Math.sin((y / SIZE) * Math.PI * 2 * 64) * 0.5 + 0.5;
      const checker = (Math.floor(x / 4) + Math.floor(y / 4)) % 2;
      fh[y * SIZE + x] = (checker ? warp : weft) * 0.7 + fbm(x, y, 16, 3, 91) * 0.3;
    }
  }

  // Cord wrap: diagonal ridges.
  const ch = new Float32Array(N);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      ch[y * SIZE + x] = Math.abs(Math.sin(((x + y) / SIZE) * Math.PI * 24)) * 0.8 + fbm(x, y, 8, 2, 13) * 0.2;
    }
  }

  const metalNormal = toTexture(heightToNormal(mh, 1.4));
  const metalRough = grayTexture(mr);
  const polymerNormal = toTexture(heightToNormal(ph, 2.2));
  const polymerRough = grayTexture(pr);
  const stippleNormal = toTexture(heightToNormal(sh, 3));
  const fabricNormal = toTexture(heightToNormal(fh, 2.5));
  const cordNormal = toTexture(heightToNormal(ch, 2.5));
  const all = [metalNormal, metalRough, polymerNormal, polymerRough, stippleNormal, fabricNormal, cordNormal];
  cache = {
    metalNormal, metalRough, polymerNormal, polymerRough, stippleNormal, fabricNormal, cordNormal,
    dispose() {
      for (const t of all) t.dispose();
      cache = null;
    },
  };
  return cache;
}
