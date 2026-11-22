/**
 * CPU ray tracer for the light bake. The maps are built almost entirely from
 * (possibly rotated) boxes, so occlusion is traced against those boxes as
 * oriented bounding boxes instead of the merged triangle soup: one slab test
 * replaces 12 triangle tests and a whole crate or wall is a single item.
 *
 * Boxes sit in a uniform XZ grid (CSR layout, like CollisionWorld and
 * MeshRaycastGrid) walked with a 2D DDA; the ray is first clipped to the
 * scene's height range so sky rays leave after a cell or two. The ground is
 * a height field (the terrain's visual height function), intersected by a
 * few secant steps.
 *
 * Pure maths, no three.js objects: runs in node tests and could move to a
 * worker unchanged.
 */

export type OccluderBox = {
  /** Centre (world). */
  cx: number; cy: number; cz: number;
  /** Half extents along the box's local axes. */
  hx: number; hy: number; hz: number;
  /**
   * Local axes in world space (row-major: ax, ay, az), omitted when axis
   * aligned. Must be orthonormal.
   */
  axes?: ArrayLike<number>;
  /** Linear albedo (0..1). */
  r: number; g: number; b: number;
};

export type TraceHit = {
  /** Distance along the (unit) ray. */
  t: number;
  /** World normal of the face that was hit. */
  nx: number; ny: number; nz: number;
  /** Linear albedo at the hit. */
  r: number; g: number; b: number;
  /** Box index, or -2 for the ground. */
  box: number;
};

const CELL = 3;
/** Boxes spanning more cells than this go in the always-tested list. */
const MAX_CELLS_PER_BOX = 96;
export const GROUND = -2;

export class BoxTracer {
  readonly count: number;
  /** cx, cy, cz, hx, hy, hz per box. */
  private readonly geo: Float32Array;
  /** 9 axis components per box (identity for axis aligned ones). */
  private readonly rot: Float32Array;
  private readonly aligned: Uint8Array;
  private readonly albedo: Float32Array;
  private readonly minX: number;
  private readonly minZ: number;
  private readonly nx: number;
  private readonly nz: number;
  private readonly start: Int32Array;
  private readonly items: Int32Array;
  private readonly big: Int32Array;
  private readonly stamp: Uint32Array;
  private query = 0;
  /** Scene height range (boxes only). */
  readonly minY: number;
  readonly maxY: number;
  /** Per-cell top of the tallest box (for the "nothing near" fast path). */
  private readonly cellTop: Float32Array;

  constructor(
    boxes: readonly OccluderBox[],
    /** Ground height (null = no ground). */
    private readonly ground: ((x: number, z: number) => number) | null = () => 0,
    readonly groundAlbedo: [number, number, number] = [0.25, 0.22, 0.18],
  ) {
    const n = (this.count = boxes.length);
    this.geo = new Float32Array(n * 6);
    this.rot = new Float32Array(n * 9);
    this.aligned = new Uint8Array(n);
    this.albedo = new Float32Array(n * 3);
    this.stamp = new Uint32Array(n);
    // World AABBs.
    const aabb = new Float32Array(n * 6);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const b = boxes[i];
      this.geo.set([b.cx, b.cy, b.cz, b.hx, b.hy, b.hz], i * 6);
      this.albedo.set([b.r, b.g, b.b], i * 3);
      const a = b.axes;
      const R = this.rot;
      if (a) {
        for (let k = 0; k < 9; k++) R[i * 9 + k] = a[k];
        // Near-identity rotations take the cheap path.
        this.aligned[i] = Math.abs(a[0]) > 0.99999 && Math.abs(a[4]) > 0.99999 && Math.abs(a[8]) > 0.99999 ? 1 : 0;
        if (this.aligned[i]) {
          R.fill(0, i * 9, i * 9 + 9);
          R[i * 9] = R[i * 9 + 4] = R[i * 9 + 8] = 1;
        }
      } else {
        R[i * 9] = R[i * 9 + 4] = R[i * 9 + 8] = 1;
        this.aligned[i] = 1;
      }
      // Extent of a rotated box along world axis j: sum_k |axis_k[j]| * h_k.
      const h = [b.hx, b.hy, b.hz];
      for (let j = 0; j < 3; j++) {
        let e = 0;
        for (let k = 0; k < 3; k++) e += Math.abs(R[i * 9 + k * 3 + j]) * h[k];
        const c = j === 0 ? b.cx : j === 1 ? b.cy : b.cz;
        aabb[i * 6 + j] = c - e;
        aabb[i * 6 + 3 + j] = c + e;
      }
      x0 = Math.min(x0, aabb[i * 6]); x1 = Math.max(x1, aabb[i * 6 + 3]);
      y0 = Math.min(y0, aabb[i * 6 + 1]); y1 = Math.max(y1, aabb[i * 6 + 4]);
      z0 = Math.min(z0, aabb[i * 6 + 2]); z1 = Math.max(z1, aabb[i * 6 + 5]);
    }
    if (!n) x0 = z0 = y0 = x1 = z1 = y1 = 0;
    this.minY = y0;
    this.maxY = y1;
    this.minX = x0 - 0.01;
    this.minZ = z0 - 0.01;
    this.nx = Math.max(1, Math.ceil((x1 + 0.01 - this.minX) / CELL));
    this.nz = Math.max(1, Math.ceil((z1 + 0.01 - this.minZ) / CELL));
    const cells = this.nx * this.nz;
    const count = new Int32Array(cells + 1);
    const range = new Int32Array(n * 4);
    const big: number[] = [];
    this.cellTop = new Float32Array(cells).fill(-Infinity);
    for (let i = 0; i < n; i++) {
      const ax = this.cx(aabb[i * 6]), bx = this.cx(aabb[i * 6 + 3]);
      const az = this.cz(aabb[i * 6 + 2]), bz = this.cz(aabb[i * 6 + 5]);
      if ((bx - ax + 1) * (bz - az + 1) > MAX_CELLS_PER_BOX) {
        big.push(i);
        range[i * 4] = -1;
        continue;
      }
      range.set([ax, bx, az, bz], i * 4);
      for (let z = az; z <= bz; z++) {
        for (let x = ax; x <= bx; x++) {
          count[z * this.nx + x + 1]++;
          const c = z * this.nx + x;
          this.cellTop[c] = Math.max(this.cellTop[c], aabb[i * 6 + 4]);
        }
      }
    }
    for (let c = 0; c < cells; c++) count[c + 1] += count[c];
    const items = new Int32Array(count[cells]);
    const fill = count.slice(0, cells);
    for (let i = 0; i < n; i++) {
      if (range[i * 4] < 0) continue;
      for (let z = range[i * 4 + 2]; z <= range[i * 4 + 3]; z++) for (let x = range[i * 4]; x <= range[i * 4 + 1]; x++) items[fill[z * this.nx + x]++] = i;
    }
    this.start = count;
    this.items = items;
    this.big = Int32Array.from(big);
    this.bigTop = big.reduce((m, i) => Math.max(m, aabb[i * 6 + 4]), -Infinity);
  }

  private readonly bigTop: number;

  private cx(x: number) {
    return Math.min(this.nx - 1, Math.max(0, Math.floor((x - this.minX) / CELL)));
  }
  private cz(z: number) {
    return Math.min(this.nz - 1, Math.max(0, Math.floor((z - this.minZ) / CELL)));
  }

  /**
   * True when no box top rises above `y - 0.05` within `r` (XZ) of the
   * point: nothing there can occlude its upper hemisphere.
   */
  nothingNear(x: number, y: number, z: number, r: number) {
    if (this.bigTop > y - 0.05) return false;
    const ax = this.cx(x - r), bx = this.cx(x + r), az = this.cz(z - r), bz = this.cz(z + r);
    // Outside the grid entirely?
    if (x + r < this.minX || z + r < this.minZ || x - r > this.minX + this.nx * CELL || z - r > this.minZ + this.nz * CELL) return true;
    for (let cz = az; cz <= bz; cz++) for (let cx = ax; cx <= bx; cx++) if (this.cellTop[cz * this.nx + cx] > y - 0.05) return false;
    return true;
  }

  /** Index of a box containing the point (shrunk by `eps`), or -1. */
  inside(x: number, y: number, z: number, eps = 0.002) {
    const test = (i: number) => {
      const g = this.geo, R = this.rot;
      const px = x - g[i * 6], py = y - g[i * 6 + 1], pz = z - g[i * 6 + 2];
      const lx = R[i * 9] * px + R[i * 9 + 1] * py + R[i * 9 + 2] * pz;
      const ly = R[i * 9 + 3] * px + R[i * 9 + 4] * py + R[i * 9 + 5] * pz;
      const lz = R[i * 9 + 6] * px + R[i * 9 + 7] * py + R[i * 9 + 8] * pz;
      return Math.abs(lx) < g[i * 6 + 3] - eps && Math.abs(ly) < g[i * 6 + 4] - eps && Math.abs(lz) < g[i * 6 + 5] - eps;
    };
    for (let k = 0; k < this.big.length; k++) if (test(this.big[k])) return this.big[k];
    if (x < this.minX || z < this.minZ || x >= this.minX + this.nx * CELL || z >= this.minZ + this.nz * CELL) return -1;
    const c = this.cz(z) * this.nx + this.cx(x);
    for (let k = this.start[c]; k < this.start[c + 1]; k++) if (test(this.items[k])) return this.items[k];
    return -1;
  }

  /**
   * Pushes a point out of the box it is buried in, through the nearest face
   * (returns false if it wasn't inside anything). Writes into `out`.
   */
  pushOut(x: number, y: number, z: number, out: { x: number; y: number; z: number }, margin = 0.04) {
    const i = this.inside(x, y, z);
    if (i < 0) return false;
    const g = this.geo, R = this.rot;
    const px = x - g[i * 6], py = y - g[i * 6 + 1], pz = z - g[i * 6 + 2];
    const l = [R[i * 9] * px + R[i * 9 + 1] * py + R[i * 9 + 2] * pz, R[i * 9 + 3] * px + R[i * 9 + 4] * py + R[i * 9 + 5] * pz, R[i * 9 + 6] * px + R[i * 9 + 7] * py + R[i * 9 + 8] * pz];
    const h = [g[i * 6 + 3], g[i * 6 + 4], g[i * 6 + 5]];
    // Nearest face, but never out through the bottom (buried terrain points belong above).
    let best = -1, bestD = Infinity;
    for (let k = 0; k < 3; k++) {
      const d = h[k] - Math.abs(l[k]);
      const down = k === 1 && l[1] < 0 && R[i * 9 + 4] > 0.7;
      if (!down && d < bestD) {
        bestD = d;
        best = k;
      }
    }
    l[best] = Math.sign(l[best] || 1) * (h[best] + margin);
    // Back to world: p = c + sum_k l_k * axis_k.
    out.x = g[i * 6] + R[i * 9] * l[0] + R[i * 9 + 3] * l[1] + R[i * 9 + 6] * l[2];
    out.y = g[i * 6 + 1] + R[i * 9 + 1] * l[0] + R[i * 9 + 4] * l[1] + R[i * 9 + 7] * l[2];
    out.z = g[i * 6 + 2] + R[i * 9 + 2] * l[0] + R[i * 9 + 5] * l[1] + R[i * 9 + 8] * l[2];
    return true;
  }

  // Slab-test results (avoid allocations in the hot loop).
  private sT = 0;
  private sAxis = 0;
  private sSign = 0;

  /** Ray vs box i (unit dir). Entry distance in sT (> tMin), or false. */
  private slab(i: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tMax: number) {
    const g = this.geo;
    let px = ox - g[i * 6], py = oy - g[i * 6 + 1], pz = oz - g[i * 6 + 2];
    let qx = dx, qy = dy, qz = dz;
    if (!this.aligned[i]) {
      const R = this.rot, o = i * 9;
      const lx = R[o] * px + R[o + 1] * py + R[o + 2] * pz;
      const ly = R[o + 3] * px + R[o + 4] * py + R[o + 5] * pz;
      const lz = R[o + 6] * px + R[o + 7] * py + R[o + 8] * pz;
      px = lx; py = ly; pz = lz;
      const ex = R[o] * dx + R[o + 1] * dy + R[o + 2] * dz;
      const ey = R[o + 3] * dx + R[o + 4] * dy + R[o + 5] * dz;
      const ez = R[o + 6] * dx + R[o + 7] * dy + R[o + 8] * dz;
      qx = ex; qy = ey; qz = ez;
    }
    const hx = g[i * 6 + 3], hy = g[i * 6 + 4], hz = g[i * 6 + 5];
    let t0 = -Infinity, t1 = tMax, axis = -1, sign = 0;
    // X
    if (Math.abs(qx) < 1e-12) {
      if (px < -hx || px > hx) return false;
    } else {
      const inv = 1 / qx;
      let a = (-hx - px) * inv, b = (hx - px) * inv, s = -1;
      if (a > b) { const t = a; a = b; b = t; s = 1; }
      if (a > t0) { t0 = a; axis = 0; sign = s; }
      if (b < t1) t1 = b;
      if (t0 > t1) return false;
    }
    // Y
    if (Math.abs(qy) < 1e-12) {
      if (py < -hy || py > hy) return false;
    } else {
      const inv = 1 / qy;
      let a = (-hy - py) * inv, b = (hy - py) * inv, s = -1;
      if (a > b) { const t = a; a = b; b = t; s = 1; }
      if (a > t0) { t0 = a; axis = 1; sign = s; }
      if (b < t1) t1 = b;
      if (t0 > t1) return false;
    }
    // Z
    if (Math.abs(qz) < 1e-12) {
      if (pz < -hz || pz > hz) return false;
    } else {
      const inv = 1 / qz;
      let a = (-hz - pz) * inv, b = (hz - pz) * inv, s = -1;
      if (a > b) { const t = a; a = b; b = t; s = 1; }
      if (a > t0) { t0 = a; axis = 2; sign = s; }
      if (b < t1) t1 = b;
      if (t0 > t1) return false;
    }
    if (t1 < 0) return false;
    // Origin inside the box: hit at once (the point is buried).
    if (t0 < 0) {
      this.sT = 0;
      this.sAxis = axis < 0 ? 1 : axis;
      this.sSign = -sign || 1;
      return true;
    }
    this.sT = t0;
    // The entry face's outward normal points against the ray along that axis.
    this.sAxis = axis;
    this.sSign = sign;
    return true;
  }

  /** Clips [0, tMax] to the scene's height slab; returns the new tMax (or -1 = misses all boxes). */
  private clipY(oy: number, dy: number, tMax: number) {
    if (dy > 1e-9) {
      if (oy > this.maxY) return -1;
      return Math.min(tMax, (this.maxY - oy) / dy);
    }
    if (dy < -1e-9) {
      if (oy < this.minY) return -1;
      return Math.min(tMax, (this.minY - oy) / dy);
    }
    return oy > this.maxY || oy < this.minY ? -1 : tMax;
  }

  // Closest-hit state of the last walk.
  private wBest = 0;
  private wBox = -1;
  private wAxis = 0;
  private wSign = 0;

  /** Tests box i; updates the closest hit. Returns true when `any` should stop. */
  private visit(i: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, any: boolean) {
    if (!this.slab(i, ox, oy, oz, dx, dy, dz, this.wBest) || this.sT >= this.wBest) return false;
    this.wBest = this.sT;
    this.wBox = i;
    this.wAxis = this.sAxis;
    this.wSign = this.sSign;
    return any;
  }

  /**
   * Walks the grid cells the ray crosses within [0, tMax], testing every
   * candidate box once. Closest hit lands in wBest/wBox (wBox = -1: none);
   * with `any` it stops at the first hit.
   */
  private walk(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tMax: number, any: boolean) {
    this.wBest = tMax;
    this.wBox = -1;
    if (++this.query === 0xffffffff) {
      this.stamp.fill(0);
      this.query = 1;
    }
    const q = this.query, stamp = this.stamp;
    for (let k = 0; k < this.big.length; k++) {
      const i = this.big[k];
      stamp[i] = q;
      if (this.visit(i, ox, oy, oz, dx, dy, dz, any)) return;
    }
    const ix = Math.abs(dx) < 1e-12 ? 1e12 : 1 / dx;
    const iz = Math.abs(dz) < 1e-12 ? 1e12 : 1 / dz;
    const gx1 = this.minX + this.nx * CELL, gz1 = this.minZ + this.nz * CELL;
    let a = (this.minX - ox) * ix, b = (gx1 - ox) * ix;
    let t0 = Math.min(a, b), t1 = Math.max(a, b);
    a = (this.minZ - oz) * iz;
    b = (gz1 - oz) * iz;
    t0 = Math.max(t0, Math.min(a, b), 0);
    t1 = Math.min(t1, Math.max(a, b), this.wBest);
    if (t0 > t1) return;
    let x = Math.min(this.nx - 1, Math.max(0, Math.floor((ox + dx * t0 - this.minX) / CELL)));
    let z = Math.min(this.nz - 1, Math.max(0, Math.floor((oz + dz * t0 - this.minZ) / CELL)));
    const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const ddx = Math.abs(CELL * ix), ddz = Math.abs(CELL * iz);
    let nextX = Math.abs(dx) < 1e-12 ? Infinity : (this.minX + (x + (sx > 0 ? 1 : 0)) * CELL - ox) * ix;
    let nextZ = Math.abs(dz) < 1e-12 ? Infinity : (this.minZ + (z + (sz > 0 ? 1 : 0)) * CELL - oz) * iz;
    const { start, items } = this;
    const nx = this.nx, nz = this.nz;
    for (;;) {
      const c = z * nx + x;
      for (let k = start[c], e = start[c + 1]; k < e; k++) {
        const i = items[k];
        if (stamp[i] === q) continue;
        stamp[i] = q;
        if (this.visit(i, ox, oy, oz, dx, dy, dz, any)) return;
      }
      const exit = nextX < nextZ ? nextX : nextZ;
      // Anything hit so far that lies before this cell's exit is the closest.
      if (exit >= this.wBest || exit > t1) return;
      if (nextX < nextZ) {
        nextX += ddx;
        x += sx;
        if (x < 0 || x >= nx) return;
      } else {
        nextZ += ddz;
        z += sz;
        if (z < 0 || z >= nz) return;
      }
    }
  }

  /** Ground intersection (secant steps on the height field), or -1. */
  groundT(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tMax: number) {
    const h = this.ground;
    if (!h || dy > -1e-4) return -1;
    let t = Math.max(0, (oy - h(ox, oz)) / -dy);
    for (let k = 0; k < 3; k++) {
      const x = ox + dx * t, z = oz + dz * t;
      const y = oy + dy * t;
      const e = y - h(x, z);
      if (Math.abs(e) < 0.01) break;
      t = Math.max(0, t + e / -dy);
    }
    return t <= tMax ? t : -1;
  }

  /** Closest hit (boxes, then ground) within tMax; false on a miss. Unit `d`. */
  trace(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tMax: number, hit: TraceHit, withGround = true) {
    let best = tMax, bestBox = -1;
    const tm = this.count ? this.clipY(oy, dy, tMax) : -1;
    if (tm >= 0) {
      this.walk(ox, oy, oz, dx, dy, dz, tm, false);
      if (this.wBox >= 0) {
        best = this.wBest;
        bestBox = this.wBox;
      }
    }
    if (withGround) {
      const gt = this.groundT(ox, oy, oz, dx, dy, dz, best);
      if (gt >= 0 && gt < best) {
        hit.t = gt;
        hit.box = GROUND;
        hit.nx = 0; hit.ny = 1; hit.nz = 0;
        hit.r = this.groundAlbedo[0];
        hit.g = this.groundAlbedo[1];
        hit.b = this.groundAlbedo[2];
        return true;
      }
    }
    if (bestBox < 0) return false;
    hit.t = best;
    hit.box = bestBox;
    // Local face normal (axis, sign) rotated to world: row `axis` of the rotation.
    const R = this.rot, o = bestBox * 9 + this.wAxis * 3, sign = this.wSign;
    hit.nx = R[o] * sign;
    hit.ny = R[o + 1] * sign;
    hit.nz = R[o + 2] * sign;
    hit.r = this.albedo[bestBox * 3];
    hit.g = this.albedo[bestBox * 3 + 1];
    hit.b = this.albedo[bestBox * 3 + 2];
    return true;
  }

  /** Any box within tMax (no ground)? Cheaper than trace: stops at the first hit. */
  occluded(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tMax: number) {
    if (!this.count) return false;
    const tm = this.clipY(oy, dy, tMax);
    if (tm < 0) return false;
    this.walk(ox, oy, oz, dx, dy, dz, tm, true);
    return this.wBox >= 0;
  }
}
