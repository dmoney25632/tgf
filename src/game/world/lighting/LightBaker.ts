import { BoxTracer, GROUND, type TraceHit } from "./BoxTracer";

/**
 * Per-vertex light bake: for every vertex of the static world it traces a
 * fixed set of cosine-weighted hemisphere rays against the map's boxes and
 * stores
 *  - sky visibility: how much of the environment (sky dome + far ground) the
 *    point sees, weighted by how bright each direction of the ambient model
 *    is. Ambient / IBL light is multiplied by it, so rooms, alleys, the
 *    undersides of awnings and the feet of walls darken properly;
 *  - one sun bounce: for rays that hit a surface, the sun light that surface
 *    receives (its albedo × N·L × sun visibility). Added as warm indirect
 *    light, it fills shaded walls next to sunlit yards and spills in through
 *    doorways;
 *  - sun occlusion: a few rays toward the sun. The real-time shadow map
 *    stays the source of direct shadows; this is used where there is none
 *    (beyond the shadow cascades, and on presets without shadow maps).
 *
 * Work is split into resumable steps (`run()` yields) so the caller can
 * time-slice it; results are compact Uint8 arrays ready to upload.
 */

export type BakeSettings = {
  /** Hemisphere rays per vertex (upper bound; the budget can lower it). */
  skyRays: number;
  /** Rays toward the sun per vertex (0 = no sun occlusion). */
  sunRays: number;
  /** Trace a secondary sun ray from every hemisphere hit (one bounce). */
  bounce: boolean;
  /** Max occluder distance for hemisphere rays (m). */
  rayLength: number;
  /** Total ray budget; skyRays shrink (to >= minRays) to fit it. */
  budget: number;
  minRays: number;
};

export type BakeEnvironment = {
  /** Unit vector toward the sun. */
  sun: [number, number, number];
  /** Brightness of the ambient model below the horizon relative to above (hemi ground / sky). */
  groundWeight: number;
  /** Ground bounce scale (the ambient model already carries some ground light). */
  groundBounce: number;
  /** Angular radius of the sun-ray cone (rad); softens per-vertex shadow edges. */
  sunSpread: number;
};

export type BakeReceiver = {
  /** World-space positions / normals (xyz per vertex). */
  positions: ArrayLike<number>;
  normals: ArrayLike<number>;
  /** Share results between identical (position, normal) vertices (non-indexed meshes). */
  dedupe: boolean;
};

export type BakeResult = {
  /** rgb = sqrt(bounce), a = sky visibility (all /255). */
  gi: Uint8Array;
  /** Sun occlusion (0 = sees the sun, 255 = blocked). */
  sun: Uint8Array;
};

const GOLDEN = 2.399963229728653;
/** Dedupe grid: samples per metre. */
const DEDUPE_CELL = 4;

/** Cosine-weighted hemisphere directions (z up), Fibonacci spiral: smooth, deterministic. */
export function hemisphereSet(n: number) {
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const r = Math.sqrt(u);
    const phi = i * GOLDEN + 0.3;
    out[i * 3] = r * Math.cos(phi);
    out[i * 3 + 1] = r * Math.sin(phi);
    out[i * 3 + 2] = Math.sqrt(Math.max(0, 1 - u));
  }
  return out;
}

/** Orthonormal basis around n (Duff et al. 2017), written as t, b. */
function basis(nx: number, ny: number, nz: number, o: Float32Array) {
  const s = nz >= 0 ? 1 : -1;
  const a = -1 / (s + nz);
  const b = nx * ny * a;
  o[0] = 1 + s * nx * nx * a; o[1] = s * b; o[2] = -s * nx;
  o[3] = b; o[4] = s + ny * ny * a; o[5] = -ny;
}

/** Rays a bake of `vertices` unique vertices will trace at most. */
export function plannedRays(vertices: number, s: BakeSettings) {
  return vertices * (raysPerVertex(vertices, s) * (s.bounce ? 1.5 : 1) + s.sunRays);
}

function raysPerVertex(vertices: number, s: BakeSettings) {
  if (!vertices) return s.skyRays;
  const perVertex = s.budget / vertices - s.sunRays;
  // A bounce costs up to one extra (any-hit) ray per hemisphere ray; ~half hit.
  const fit = Math.floor(perVertex / (s.bounce ? 1.5 : 1));
  return Math.max(s.minRays, Math.min(s.skyRays, fit));
}

export class LightBaker {
  /** Fraction done (0..1). */
  progress = 0;
  /** Rays traced so far (debug / perf budgeting). */
  rays = 0;
  readonly results: BakeResult[];
  private readonly hit: TraceHit = { t: 0, nx: 0, ny: 0, nz: 0, r: 0, g: 0, b: 0, box: -1 };

  constructor(
    private readonly tracer: BoxTracer,
    private readonly receivers: readonly BakeReceiver[],
    private readonly settings: BakeSettings,
    private readonly env: BakeEnvironment,
  ) {
    this.results = receivers.map((r) => {
      const n = r.positions.length / 3;
      const gi = new Uint8Array(n * 4);
      for (let i = 0; i < n; i++) gi[i * 4 + 3] = 255;
      return { gi, sun: new Uint8Array(n) };
    });
  }

  /** Runs everything at once (tests, cached reloads). */
  bakeSync() {
    const gen = this.run(Infinity);
    while (!gen.next().done);
    return this.results;
  }

  /**
   * Resumable bake: yields after every `step` vertices. Drive it with a
   * time budget per slice; results are complete when it returns.
   */
  *run(step = 256): Generator<number, BakeResult[], void> {
    // Unique (position, normal) vertices per receiver.
    const maps: Int32Array[] = [];
    const uniques: number[][] = [];
    let total = 0;
    for (const r of this.receivers) {
      const n = r.positions.length / 3;
      const map = new Int32Array(n);
      const uniq: number[] = [];
      if (r.dedupe) {
        const seen = new Map<number, number>();
        const P = r.positions, N = r.normals;
        const q = DEDUPE_CELL;
        const cell = (v: number) => Math.min(16383, Math.max(0, Math.round(v * q) + 8192));
        const nb = (v: number) => Math.round(v * 4) + 4;
        for (let i = 0; i < n; i++) {
          // 0.25 m cells × ~15° normal buckets: exact duplicates (non-indexed
          // triangles) and the dense vertices of small detail (sandbags, litter)
          // share one sample, big subdivided faces keep one per vertex.
          // Packed into one exact integer (< 2^53): 14 + 14 + 14 bits + 9³ normals.
          const key = ((cell(P[i * 3]) * 16384 + cell(P[i * 3 + 1])) * 16384 + cell(P[i * 3 + 2])) * 729 + (nb(N[i * 3]) * 9 + nb(N[i * 3 + 1])) * 9 + nb(N[i * 3 + 2]);
          if ((i & 16383) === 16383) yield 0;
          let u = seen.get(key);
          if (u === undefined) {
            u = uniq.length;
            seen.set(key, u);
            uniq.push(i);
          }
          map[i] = u;
        }
      } else {
        for (let i = 0; i < n; i++) {
          map[i] = i;
          uniq.push(i);
        }
      }
      maps.push(map);
      uniques.push(uniq);
      total += uniq.length;
    }
    const s = this.settings;
    const rays = raysPerVertex(total, s);
    const dirs = hemisphereSet(rays);
    const sunDirs = this.sunSet();
    const frame = new Float32Array(6);
    const value = new Float32Array(5);
    let done = 0;
    yield 0;
    for (let ri = 0; ri < this.receivers.length; ri++) {
      const r = this.receivers[ri];
      const uniq = uniques[ri];
      const map = maps[ri];
      // Per unique vertex: bounce rgb, sky, sun occlusion.
      const vals = new Float32Array(uniq.length * 5);
      for (let u = 0; u < uniq.length; u++) {
        const i = uniq[u];
        this.sample(r.positions, r.normals, i, dirs, sunDirs, frame, value);
        vals.set(value, u * 5);
        if (++done % step === 0) {
          this.progress = done / total;
          yield this.progress;
        }
      }
      const res = this.results[ri];
      for (let i = 0; i < map.length; i++) {
        const o = map[i] * 5;
        res.gi[i * 4] = enc(Math.sqrt(vals[o]));
        res.gi[i * 4 + 1] = enc(Math.sqrt(vals[o + 1]));
        res.gi[i * 4 + 2] = enc(Math.sqrt(vals[o + 2]));
        res.gi[i * 4 + 3] = enc(vals[o + 3]);
        res.sun[i] = enc(vals[o + 4]);
      }
    }
    this.progress = 1;
    return this.results;
  }

  /** Sun-cone directions (unit). */
  private sunSet() {
    const n = Math.max(0, this.settings.sunRays);
    const [lx, ly, lz] = this.env.sun;
    const out = new Float32Array(n * 3);
    const f = new Float32Array(6);
    basis(lx, ly, lz, f);
    const spread = n > 1 ? this.env.sunSpread : 0;
    for (let i = 0; i < n; i++) {
      const rr = spread * Math.sqrt((i + 0.5) / n);
      const a = i * GOLDEN;
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      let dx = lx + f[0] * x + f[3] * y, dy = ly + f[1] * x + f[4] * y, dz = lz + f[2] * x + f[5] * y;
      const l = Math.hypot(dx, dy, dz);
      dx /= l; dy /= l; dz /= l;
      out.set([dx, dy, dz], i * 3);
    }
    return out;
  }

  private readonly push = { x: 0, y: 0, z: 0 };

  /** Bakes one vertex into value = [bounce r, g, b, sky, sunOcc]. */
  private sample(P: ArrayLike<number>, N: ArrayLike<number>, i: number, dirs: Float32Array, sunDirs: Float32Array, f: Float32Array, value: Float32Array) {
    const T = this.tracer, s = this.settings, env = this.env, hit = this.hit;
    let nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    // Offset off the surface (avoids self-hits on the face the vertex lies on).
    let px = P[i * 3] + nx * 0.03, py = P[i * 3 + 1] + ny * 0.03, pz = P[i * 3 + 2] + nz * 0.03;
    // Buried (terrain under a wall, faces against a neighbour): step out once.
    if (T.pushOut(px, py, pz, this.push)) {
      px = this.push.x; py = this.push.y; pz = this.push.z;
      if (T.inside(px, py, pz) >= 0) {
        value[0] = value[1] = value[2] = 0;
        value[3] = 0.25;
        value[4] = 1;
        return;
      }
    }
    const [lx, ly, lz] = env.sun;

    // Sun occlusion.
    let sunOcc = 0;
    if (sunDirs.length && nx * lx + ny * ly + nz * lz > 0.01) {
      let blocked = 0;
      const n = sunDirs.length / 3;
      for (let k = 0; k < n; k++) {
        this.rays++;
        if (T.occluded(px, py, pz, sunDirs[k * 3], sunDirs[k * 3 + 1], sunDirs[k * 3 + 2], 120)) blocked++;
      }
      sunOcc = blocked / n;
    }

    // Open sky with nothing around: skip the hemisphere.
    if (ny > 0.6 && T.nothingNear(px, py, pz, s.rayLength * 0.6)) {
      value[0] = value[1] = value[2] = 0;
      value[3] = 1;
      value[4] = sunOcc;
      return;
    }

    basis(nx, ny, nz, f);
    const n = dirs.length / 3;
    let wOpen = 0, wSum = 0, br = 0, bg = 0, bb = 0;
    const gw = env.groundWeight;
    for (let k = 0; k < n; k++) {
      const a = dirs[k * 3], b = dirs[k * 3 + 1], c = dirs[k * 3 + 2];
      const dx = f[0] * a + f[3] * b + nx * c;
      const dy = f[1] * a + f[4] * b + ny * c;
      const dz = f[2] * a + f[5] * b + nz * c;
      // Ambient-model brightness of this direction (sky above, dim ground below).
      const w = gw + (1 - gw) * Math.min(1, Math.max(0, dy * 0.5 + 0.5));
      wSum += w;
      this.rays++;
      // Ground hits look at "the ground" the ambient model already has: open.
      const any = T.trace(px, py, pz, dx, dy, dz, s.rayLength, hit, s.bounce);
      if (!any || hit.box === GROUND) wOpen += w;
      if (!s.bounce) continue;
      if (!any) {
        // Toward the ground but beyond rayLength: still sunlit ground, usually.
        const gt = dy < -0.05 ? T.groundT(px, py, pz, dx, dy, dz, s.rayLength * 4) : -1;
        if (gt < 0) continue;
        hit.t = gt;
        hit.box = GROUND;
        hit.nx = 0; hit.ny = 1; hit.nz = 0;
      }
      const cos = hit.nx * lx + hit.ny * ly + hit.nz * lz;
      if (cos <= 0) continue;
      const hx = px + dx * hit.t + hit.nx * 0.03, hy = py + dy * hit.t + hit.ny * 0.03, hz = pz + dz * hit.t + hit.nz * 0.03;
      this.rays++;
      if (T.occluded(hx, hy, hz, lx, ly, lz, 120)) continue;
      const e = cos * (hit.box === GROUND ? env.groundBounce : 1);
      if (hit.box === GROUND && !any) {
        // Albedo of the ground (the trace above didn't fill it).
        const g = T.groundAlbedo;
        br += g[0] * e; bg += g[1] * e; bb += g[2] * e;
      } else {
        br += hit.r * e; bg += hit.g * e; bb += hit.b * e;
      }
    }
    value[0] = br / n;
    value[1] = bg / n;
    value[2] = bb / n;
    value[3] = wSum > 0 ? wOpen / wSum : 1;
    value[4] = sunOcc;
  }
}

const enc = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
