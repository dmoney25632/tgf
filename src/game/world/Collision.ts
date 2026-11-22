import * as THREE from "three";

const EPS = 0.001;
/** Grid cell size (m). Most colliders are walls/props a few metres across. */
const CELL = 4;
/** Boxes spanning more cells than this (ground slab, map bounds) are tested on every query. */
const MAX_CELLS_PER_BOX = 64;

/**
 * Moving world pieces (door leaves) as the collision world sees them. The
 * door system implements it; the AI calls `agentNear` while walking so
 * closed doors in its way swing open, and the nav grid keeps the swept
 * leaf footprints clear of paths.
 */
export interface DynamicHooks {
  /** An AI body at (x, z) moving with (vx, vz) this frame. */
  agentNear(x: number, z: number, vx: number, vz: number): void;
  /** Footprints the nav grid must treat as solid (open door leaves). */
  navBlockers(): readonly THREE.Box3[];
}

/**
 * Axis-aligned box collision world. The map registers solid boxes; the
 * player moves as an upright AABB resolved one axis at a time, which is
 * cheap, stable and good enough for a blocky military map.
 *
 * Queries go through a uniform XZ grid (built lazily after the last add), so
 * they only test nearby boxes instead of the whole map: big maps have 1000+
 * colliders and the AI runs hundreds of queries per frame.
 */
export class CollisionWorld {
  readonly boxes: THREE.Box3[] = [];

  // Grid (CSR layout): boxes of cell c are items[start[c] .. start[c + 1]).
  private dirty = true;
  private minX = 0;
  private minZ = 0;
  private nx = 0;
  private nz = 0;
  private start = new Int32Array(1);
  private items = new Int32Array(0);
  /** Boxes too big to grid: always tested. */
  private big: number[] = [];
  /** Per-box query stamp, so a box spanning several cells is tested once. */
  private stamp = new Uint32Array(0);
  private query = 0;
  private readonly cand: number[] = [];
  /**
   * Moving boxes (door leaves): not part of `boxes` (static consumers such as
   * the nav grid, cover and foliage never see them), tested on every query
   * and free to change in place. A disabled one is skipped entirely.
   */
  private readonly dyn: THREE.Box3[] = [];
  private readonly dynOn: boolean[] = [];
  /** Per static box: 1 = the player may not mantle onto it (roofs, bounds). */
  noClimb = new Uint8Array(0);
  /** Index of the static box the last `raycast` hit (-1 = none / a moving box). */
  lastHit = -1;
  /** Door system (or other moving pieces) hooked into this world, if any. */
  dynamic: DynamicHooks | null = null;

  add(box: THREE.Box3) {
    this.boxes.push(box);
    this.dirty = true;
  }

  /** Flags static box `i` as not climbable (mantle / vault never lands on it). */
  setNoClimb(i: number, on = true) {
    if (this.noClimb.length < this.boxes.length) {
      const n = new Uint8Array(Math.max(this.boxes.length, this.noClimb.length * 2));
      n.set(this.noClimb);
      this.noClimb = n;
    }
    this.noClimb[i] = on ? 1 : 0;
  }

  isNoClimb(i: number) {
    return i >= 0 && i < this.noClimb.length && this.noClimb[i] === 1;
  }

  /** Registers a moving box (mutate it in place afterwards). Returns its handle. */
  addDynamic(box: THREE.Box3) {
    this.dyn.push(box);
    this.dynOn.push(true);
    return this.dyn.length - 1;
  }

  setDynamicEnabled(handle: number, on: boolean) {
    this.dynOn[handle] = on;
  }

  get dynamicCount() {
    return this.dyn.length;
  }

  private build() {
    this.dirty = false;
    const n = this.boxes.length;
    this.stamp = new Uint32Array(n);
    this.big = [];
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    const gridded: number[] = [];
    for (let i = 0; i < n; i++) {
      const b = this.boxes[i];
      const cx = Math.ceil((b.max.x - b.min.x) / CELL) + 1, cz = Math.ceil((b.max.z - b.min.z) / CELL) + 1;
      if (cx * cz > MAX_CELLS_PER_BOX) {
        this.big.push(i);
        continue;
      }
      gridded.push(i);
      x0 = Math.min(x0, b.min.x); z0 = Math.min(z0, b.min.z);
      x1 = Math.max(x1, b.max.x); z1 = Math.max(z1, b.max.z);
    }
    if (!gridded.length) {
      this.nx = this.nz = 0;
      this.start = new Int32Array(1);
      this.items = new Int32Array(0);
      return;
    }
    this.minX = x0;
    this.minZ = z0;
    this.nx = Math.max(1, Math.ceil((x1 - x0) / CELL));
    this.nz = Math.max(1, Math.ceil((z1 - z0) / CELL));
    const cells = this.nx * this.nz;
    const count = new Int32Array(cells + 1);
    const each = (i: number, f: (c: number) => void) => {
      const b = this.boxes[i];
      const ax = this.cx(b.min.x), bx = this.cx(b.max.x), az = this.cz(b.min.z), bz = this.cz(b.max.z);
      for (let z = az; z <= bz; z++) for (let x = ax; x <= bx; x++) f(z * this.nx + x);
    };
    for (const i of gridded) each(i, (c) => count[c + 1]++);
    for (let c = 0; c < cells; c++) count[c + 1] += count[c];
    const items = new Int32Array(count[cells]);
    const fill = count.slice(0, cells);
    // Ascending box order within each cell (gridded is ascending).
    for (const i of gridded) each(i, (c) => (items[fill[c]++] = i));
    this.start = count;
    this.items = items;
  }

  private cx(x: number) {
    return Math.min(this.nx - 1, Math.max(0, Math.floor((x - this.minX) / CELL)));
  }
  private cz(z: number) {
    return Math.min(this.nz - 1, Math.max(0, Math.floor((z - this.minZ) / CELL)));
  }

  private nextQuery() {
    if (this.dirty) this.build();
    if (++this.query === 0xffffffff) {
      this.stamp.fill(0);
      this.query = 1;
    }
    return this.query;
  }

  /** Box indices whose cells touch the XZ rectangle, plus the big boxes (unsorted, deduped). */
  private gather(x0: number, z0: number, x1: number, z1: number) {
    const q = this.nextQuery();
    const out = this.cand;
    out.length = 0;
    for (const i of this.big) out.push(i);
    if (this.nx === 0) return out;
    if (x1 < this.minX || z1 < this.minZ || x0 > this.minX + this.nx * CELL || z0 > this.minZ + this.nz * CELL) return out;
    const ax = this.cx(x0), bx = this.cx(x1), az = this.cz(z0), bz = this.cz(z1);
    const st = this.stamp, items = this.items, start = this.start;
    for (let z = az; z <= bz; z++) {
      for (let x = ax; x <= bx; x++) {
        const c = z * this.nx + x;
        for (let k = start[c], e = start[c + 1]; k < e; k++) {
          const i = items[k];
          if (st[i] === q) continue;
          st[i] = q;
          out.push(i);
        }
      }
    }
    return out;
  }

  /**
   * Indices of boxes that may touch the XZ rectangle, ascending (same order as
   * `boxes`). The array is reused by the next query: copy it to keep it.
   */
  near(x0: number, z0: number, x1: number, z1: number): readonly number[] {
    const c = this.gather(x0, z0, x1, z1);
    if (c.length > 1) c.sort((a, b) => a - b);
    return c;
  }

  /** Does an upright box (feet position, radius, height) overlap anything? */
  overlaps(feet: THREE.Vector3, radius: number, height: number) {
    const c = this.gather(feet.x - radius, feet.z - radius, feet.x + radius, feet.z + radius);
    for (let k = 0; k < c.length; k++) {
      const b = this.boxes[c[k]];
      if (
        feet.x - radius < b.max.x - EPS && feet.x + radius > b.min.x + EPS &&
        feet.y < b.max.y - EPS && feet.y + height > b.min.y + EPS &&
        feet.z - radius < b.max.z - EPS && feet.z + radius > b.min.z + EPS
      ) return true;
    }
    for (let k = 0; k < this.dyn.length; k++) {
      if (!this.dynOn[k]) continue;
      const b = this.dyn[k];
      if (
        feet.x - radius < b.max.x - EPS && feet.x + radius > b.min.x + EPS &&
        feet.y < b.max.y - EPS && feet.y + height > b.min.y + EPS &&
        feet.z - radius < b.max.z - EPS && feet.z + radius > b.min.z + EPS
      ) return true;
    }
    return false;
  }

  /**
   * Moves `feet` by `delta` along a single axis and pushes it out of any box it
   * enters. Returns true if it collided.
   */
  moveAxis(feet: THREE.Vector3, axis: "x" | "y" | "z", delta: number, radius: number, height: number) {
    if (delta === 0) return false;
    const fx = feet.x, fz = feet.z;
    feet[axis] += delta;
    // Pushes land between the old and new position: gather over both, and
    // resolve in box order so results match a plain scan exactly.
    const x0 = Math.min(fx, feet.x), z0 = Math.min(fz, feet.z), x1 = Math.max(fx, feet.x), z1 = Math.max(fz, feet.z);
    const c = this.gather(x0 - radius, z0 - radius, x1 + radius, z1 + radius);
    if (c.length > 1) c.sort((a, b) => a - b);
    const start = feet[axis];
    let hit = false;
    for (let k = 0; k < c.length; k++) {
      const b = this.boxes[c[k]];
      if (
        !(feet.x - radius < b.max.x - EPS && feet.x + radius > b.min.x + EPS &&
          feet.y < b.max.y - EPS && feet.y + height > b.min.y + EPS &&
          feet.z - radius < b.max.z - EPS && feet.z + radius > b.min.z + EPS)
      ) continue;
      hit = true;
      if (axis === "y") {
        feet.y = delta > 0 ? b.min.y - height - EPS : b.max.y;
      } else {
        feet[axis] = delta > 0 ? b.min[axis] - radius - EPS : b.max[axis] + radius + EPS;
        // Pushed outside the gathered area (started deep inside a box): finish with a full scan.
        if (feet.x < x0 - 1e-9 || feet.x > x1 + 1e-9 || feet.z < z0 - 1e-9 || feet.z > z1 + 1e-9) {
          feet[axis] = start;
          return this.moveAxisScan(feet, axis, delta, radius, height);
        }
      }
    }
    return this.moveAxisDynamic(feet, axis, delta, radius, height) || hit;
  }

  /** Resolves the moving boxes after the static ones (same push rule). */
  private moveAxisDynamic(feet: THREE.Vector3, axis: "x" | "y" | "z", delta: number, radius: number, height: number) {
    let hit = false;
    for (let k = 0; k < this.dyn.length; k++) {
      if (!this.dynOn[k]) continue;
      const b = this.dyn[k];
      if (
        !(feet.x - radius < b.max.x - EPS && feet.x + radius > b.min.x + EPS &&
          feet.y < b.max.y - EPS && feet.y + height > b.min.y + EPS &&
          feet.z - radius < b.max.z - EPS && feet.z + radius > b.min.z + EPS)
      ) continue;
      hit = true;
      if (axis === "y") feet.y = delta > 0 ? b.min.y - height - EPS : b.max.y;
      else feet[axis] = delta > 0 ? b.min[axis] - radius - EPS : b.max[axis] + radius + EPS;
    }
    return hit;
  }

  /** moveAxis over every box (rare fallback); `feet` already includes `delta`. */
  private moveAxisScan(feet: THREE.Vector3, axis: "x" | "y" | "z", delta: number, radius: number, height: number) {
    let hit = false;
    for (const b of this.boxes) {
      if (
        !(feet.x - radius < b.max.x - EPS && feet.x + radius > b.min.x + EPS &&
          feet.y < b.max.y - EPS && feet.y + height > b.min.y + EPS &&
          feet.z - radius < b.max.z - EPS && feet.z + radius > b.min.z + EPS)
      ) continue;
      hit = true;
      if (axis === "y") feet.y = delta > 0 ? b.min.y - height - EPS : b.max.y;
      else feet[axis] = delta > 0 ? b.min[axis] - radius - EPS : b.max[axis] + radius + EPS;
    }
    return this.moveAxisDynamic(feet, axis, delta, radius, height) || hit;
  }

  /**
   * Ray vs boxes (slab test). Returns the hit distance or Infinity.
   * Used for AI line of sight, grenade bounces and explosion occlusion.
   * Walks the grid cells along the ray and stops once the next cell starts
   * beyond the nearest hit.
   */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, anyHit = false) {
    if (this.dirty) this.build();
    // Exactly-zero components give NaN slabs (0 * Infinity) for origins on a face.
    if (dx === 0) dx = 1e-12;
    if (dy === 0) dy = 1e-12;
    if (dz === 0) dz = 1e-12;
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    let best = maxDist;
    let bestBox = -1;
    const q = this.nextQuery();
    const st = this.stamp;
    const slab = (b: THREE.Box3) => {
      let t1 = (b.min.x - ox) * ix, t2 = (b.max.x - ox) * ix;
      let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2);
      t1 = (b.min.y - oy) * iy; t2 = (b.max.y - oy) * iy;
      tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
      t1 = (b.min.z - oz) * iz; t2 = (b.max.z - oz) * iz;
      tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
      return tmax >= Math.max(tmin, 0) ? Math.max(tmin, 0) : Infinity;
    };
    for (let k = 0; k < this.dyn.length; k++) {
      if (!this.dynOn[k]) continue;
      const t = slab(this.dyn[k]);
      if (t < best) best = t;
    }
    if (anyHit && best < maxDist) {
      this.lastHit = -1;
      return best;
    }
    const test = (i: number) => {
      const b = this.boxes[i];
      let t1 = (b.min.x - ox) * ix, t2 = (b.max.x - ox) * ix;
      let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2);
      t1 = (b.min.y - oy) * iy; t2 = (b.max.y - oy) * iy;
      tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
      t1 = (b.min.z - oz) * iz; t2 = (b.max.z - oz) * iz;
      tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
      if (tmax >= Math.max(tmin, 0) && tmin < best) {
        best = Math.max(tmin, 0);
        bestBox = i;
      }
    };
    this.lastHit = -1;
    for (const i of this.big) {
      test(i);
      if (anyHit && best < maxDist) {
        this.lastHit = bestBox;
        return best;
      }
    }
    if (this.nx > 0) {
      // Clip the ray to the grid's XZ rectangle.
      const gx1 = this.minX + this.nx * CELL, gz1 = this.minZ + this.nz * CELL;
      let a = (this.minX - ox) * ix, b = (gx1 - ox) * ix;
      let t0 = Math.min(a, b), t1 = Math.max(a, b);
      a = (this.minZ - oz) * iz; b = (gz1 - oz) * iz;
      t0 = Math.max(t0, Math.min(a, b), 0);
      t1 = Math.min(t1, Math.max(a, b), best);
      if (t0 <= t1) {
        // 2D DDA over cells.
        let x = this.cx(ox + dx * t0), z = this.cz(oz + dz * t0);
        const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
        const ddx = Math.abs(CELL * ix), ddz = Math.abs(CELL * iz);
        let nextX = ((this.minX + (x + (sx > 0 ? 1 : 0)) * CELL) - ox) * ix;
        let nextZ = ((this.minZ + (z + (sz > 0 ? 1 : 0)) * CELL) - oz) * iz;
        let tCell = t0;
        const items = this.items, start = this.start;
        for (;;) {
          if (tCell > best) break;
          const c = z * this.nx + x;
          for (let k = start[c], e = start[c + 1]; k < e; k++) {
            const i = items[k];
            if (st[i] === q) continue;
            st[i] = q;
            test(i);
          }
          if (anyHit && best < maxDist) {
            this.lastHit = bestBox;
            return best;
          }
          if (nextX < nextZ) {
            tCell = nextX;
            nextX += ddx;
            x += sx;
            if (x < 0 || x >= this.nx) break;
          } else {
            tCell = nextZ;
            nextZ += ddz;
            z += sz;
            if (z < 0 || z >= this.nz) break;
          }
          if (tCell > t1) break;
        }
      }
    }
    this.lastHit = bestBox;
    return best < maxDist ? best : Infinity;
  }

  /** True if the straight segment a→b passes through no solid box. */
  lineOfSight(a: THREE.Vector3, b: THREE.Vector3) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return true;
    return this.raycast(a.x, a.y, a.z, dx / len, dy / len, dz / len, len, true) === Infinity;
  }

  /** Highest box top under (x, z) at or below `maxY` (0 = ground). */
  floorAt(x: number, z: number, maxY: number, radius = 0) {
    let y = 0;
    const c = this.gather(x - radius, z - radius, x + radius, z + radius);
    for (let k = 0; k < c.length; k++) {
      const b = this.boxes[c[k]];
      if (x + radius > b.min.x && x - radius < b.max.x && z + radius > b.min.z && z - radius < b.max.z && b.max.y <= maxY + 1e-3 && b.max.y > y) y = b.max.y;
    }
    for (let k = 0; k < this.dyn.length; k++) {
      if (!this.dynOn[k]) continue;
      const b = this.dyn[k];
      if (x + radius > b.min.x && x - radius < b.max.x && z + radius > b.min.z && z - radius < b.max.z && b.max.y <= maxY + 1e-3 && b.max.y > y) y = b.max.y;
    }
    return y;
  }
}
