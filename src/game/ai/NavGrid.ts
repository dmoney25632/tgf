import * as THREE from "three";
import type { CollisionWorld } from "../world/Collision";

const SQRT2 = Math.SQRT2;
const DIRS: readonly [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

/** A cover spot beside an obstacle: `nx,nz` points from the obstacle toward the spot. */
export type CoverPoint = { x: number; z: number; y: number; nx: number; nz: number; tall: boolean; claimed: number };

/** String-pulling lookahead (cells): waypoints end up at most ~18 m apart. */
const SMOOTH_WINDOW = 24;

/**
 * Ground-level navigation heightfield over the map, with A* on an 8-connected
 * grid (binary heap, typed arrays, reused between searches) and line-of-sight
 * path smoothing. Boxes are inflated by the agent radius; low boxes (≤ step
 * height) become walkable floor. Elevated decks are not part of the ground
 * nav — snipers spawn on their perches directly.
 */
export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  readonly floor: Float32Array;
  readonly walkable: Uint8Array;
  readonly cover: CoverPoint[] = [];

  private readonly g: Float32Array;
  private readonly f: Float32Array;
  private readonly parent: Int32Array;
  private readonly visit: Uint32Array;
  private readonly closed: Uint32Array;
  private readonly heap: Int32Array;
  private heapSize = 0;
  private stamp = 0;
  /** Searches performed this frame (budget). */
  searches = 0;

  constructor(
    private readonly world: CollisionWorld,
    readonly minX: number,
    readonly minZ: number,
    width: number,
    depth: number,
    readonly cell = 0.75,
    radius = 0.4,
    maxStep = 0.5,
    headroom = 1.9,
  ) {
    this.cols = Math.ceil(width / cell);
    this.rows = Math.ceil(depth / cell);
    const n = this.cols * this.rows;
    this.floor = new Float32Array(n);
    this.walkable = new Uint8Array(n);
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.visit = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.heap = new Int32Array(n);

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = minX + (c + 0.5) * cell;
        const z = minZ + (r + 0.5) * cell;
        let floor = 0;
        // Only boxes near this cell (in box order, so results match a full scan).
        const near = world.near(x - radius, z - radius, x + radius, z + radius);
        const boxes = world.boxes;
        // Low boxes become floor (curbs, pallets, steps).
        for (let k = 0; k < near.length; k++) {
          const b = boxes[near[k]];
          if (x + radius > b.min.x && x - radius < b.max.x && z + radius > b.min.z && z - radius < b.max.z && b.min.y <= floor + 0.01 && b.max.y <= floor + maxStep && b.max.y > floor) floor = b.max.y;
        }
        let blocked = false;
        for (let k = 0; k < near.length; k++) {
          const b = boxes[near[k]];
          if (!(x + radius > b.min.x && x - radius < b.max.x && z + radius > b.min.z && z - radius < b.max.z)) continue;
          if (b.max.y > floor + 0.02 && b.min.y < floor + headroom) {
            blocked = true;
            break;
          }
        }
        const i = r * this.cols + c;
        this.floor[i] = floor;
        this.walkable[i] = blocked ? 0 : 1;
      }
    }
    this.buildCover();
  }

  index(x: number, z: number) {
    const c = Math.floor((x - this.minX) / this.cell);
    const r = Math.floor((z - this.minZ) / this.cell);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }
  cx(i: number) {
    return this.minX + ((i % this.cols) + 0.5) * this.cell;
  }
  cz(i: number) {
    return this.minZ + (Math.floor(i / this.cols) + 0.5) * this.cell;
  }

  isWalkable(x: number, z: number) {
    const i = this.index(x, z);
    return i >= 0 && this.walkable[i] === 1;
  }

  floorAt(x: number, z: number) {
    const i = this.index(x, z);
    return i >= 0 ? this.floor[i] : 0;
  }

  /** Nearest walkable cell to (x, z) within a few rings, or -1. */
  nearestWalkable(x: number, z: number, rings = 6) {
    const i0 = this.index(x, z);
    if (i0 >= 0 && this.walkable[i0]) return i0;
    const c0 = Math.floor((x - this.minX) / this.cell);
    const r0 = Math.floor((z - this.minZ) / this.cell);
    let best = -1;
    let bestD = Infinity;
    for (let ring = 1; ring <= rings; ring++) {
      for (let dr = -ring; dr <= ring; dr++) {
        for (let dc = -ring; dc <= ring; dc++) {
          if (Math.abs(dr) !== ring && Math.abs(dc) !== ring) continue;
          const c = c0 + dc, r = r0 + dr;
          if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
          const i = r * this.cols + c;
          if (!this.walkable[i]) continue;
          const d = dr * dr + dc * dc;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /**
   * A* from (sx,sz) to (tx,tz). Writes smoothed waypoints (x,z pairs) into
   * `out` and returns the count, or 0 if unreachable / budget exhausted.
   */
  findPath(sx: number, sz: number, tx: number, tz: number, out: Float32Array, maxNodes = 6000, partial = false): number {
    // Count every request against the per-frame budget, failed lookups included.
    this.searches++;
    const start = this.nearestWalkable(sx, sz);
    const goal = this.nearestWalkable(tx, tz);
    if (start < 0 || goal < 0) return 0;
    if (start === goal) {
      out[0] = tx;
      out[1] = tz;
      return 1;
    }
    const stamp = ++this.stamp;
    const cols = this.cols;
    const gx = goal % cols, gz = Math.floor(goal / cols);
    this.heapSize = 0;
    this.visit[start] = stamp;
    this.g[start] = 0;
    this.f[start] = this.h(start % cols, Math.floor(start / cols), gx, gz);
    this.parent[start] = -1;
    this.push(start);
    let expanded = 0;
    let found = false;
    // Closest expanded cell to the goal: the partial-path target when the goal can't be reached.
    let bestCell = start;
    let bestH = this.f[start];

    while (this.heapSize > 0) {
      const cur = this.pop();
      if (cur === goal) {
        found = true;
        break;
      }
      if (this.closed[cur] === stamp) continue;
      this.closed[cur] = stamp;
      if (++expanded > maxNodes) break;
      const c = cur % cols, r = Math.floor(cur / cols);
      const hc = this.f[cur] - this.g[cur];
      if (hc < bestH) {
        bestH = hc;
        bestCell = cur;
      }
      const fy = this.floor[cur];
      for (const [dc, dr, cost] of DIRS) {
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= this.rows) continue;
        const ni = nr * cols + nc;
        if (!this.walkable[ni] || this.closed[ni] === stamp) continue;
        if (Math.abs(this.floor[ni] - fy) > 0.5) continue;
        // No corner cutting on diagonals.
        if (dc !== 0 && dr !== 0 && (!this.walkable[r * cols + nc] || !this.walkable[nr * cols + c])) continue;
        const ng = this.g[cur] + cost;
        if (this.visit[ni] !== stamp || ng < this.g[ni]) {
          this.visit[ni] = stamp;
          this.g[ni] = ng;
          this.f[ni] = ng + this.h(nc, nr, gx, gz);
          this.parent[ni] = cur;
          this.push(ni);
        }
      }
    }
    if (!found && (!partial || bestCell === start)) return 0;
    const end = found ? goal : bestCell;
    if (!found) {
      tx = this.cx(end);
      tz = this.cz(end);
    }

    // Walk back into a temporary reversed list (reuse heap memory).
    let n = 0;
    for (let i = end; i !== -1; i = this.parent[i]) this.heap[n++] = i;
    // heap[n-1] = start … heap[0] = goal. String-pull: skip cells in direct LOS.
    let count = 0;
    let anchorX = sx, anchorZ = sz;
    let k = n - 1;
    const maxOut = out.length / 2;
    while (k > 0 && count < maxOut - 1) {
      let far = k - 1;
      // Farthest visible cell, looking at most SMOOTH_WINDOW cells ahead (keeps this linear in path length).
      for (let j = Math.max(0, k - SMOOTH_WINDOW); j < k; j++) {
        const cand = this.heap[j];
        if (this.clearLine(anchorX, anchorZ, this.cx(cand), this.cz(cand))) {
          far = j;
          break;
        }
      }
      const cell = this.heap[far];
      anchorX = far === 0 ? tx : this.cx(cell);
      anchorZ = far === 0 ? tz : this.cz(cell);
      if (far === 0 && !this.isWalkable(tx, tz)) {
        anchorX = this.cx(cell);
        anchorZ = this.cz(cell);
      }
      out[count * 2] = anchorX;
      out[count * 2 + 1] = anchorZ;
      count++;
      k = far;
    }
    return count;
  }

  /** Grid walk between two points; true if every sampled cell is walkable with gentle height change. */
  clearLine(ax: number, az: number, bx: number, bz: number) {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    const steps = Math.ceil(len / (this.cell * 0.5));
    let prev = this.floorAt(ax, az);
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const x = ax + dx * t, z = az + dz * t;
      const i = this.index(x, z);
      if (i < 0 || !this.walkable[i]) return false;
      if (Math.abs(this.floor[i] - prev) > 0.5) return false;
      prev = this.floor[i];
    }
    return true;
  }

  private h(c: number, r: number, gc: number, gr: number) {
    const dx = Math.abs(c - gc), dz = Math.abs(r - gr);
    return dx + dz + (SQRT2 - 2) * Math.min(dx, dz);
  }

  private push(i: number) {
    const heap = this.heap, f = this.f;
    let k = this.heapSize++;
    heap[k] = i;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (f[heap[p]] <= f[i]) break;
      heap[k] = heap[p];
      k = p;
    }
    heap[k] = i;
  }

  private pop() {
    const heap = this.heap, f = this.f;
    const top = heap[0];
    const last = heap[--this.heapSize];
    let k = 0;
    const n = this.heapSize;
    while (true) {
      let c = k * 2 + 1;
      if (c >= n) break;
      if (c + 1 < n && f[heap[c + 1]] < f[heap[c]]) c++;
      if (f[heap[c]] >= f[last]) break;
      heap[k] = heap[c];
      k = c;
    }
    heap[k] = last;
    return top;
  }

  /** Cover spots on each side of every box tall enough to hide behind. */
  private buildCover() {
    const v = new THREE.Vector3();
    for (const b of this.world.boxes) {
      const h = b.max.y - b.min.y;
      if (b.min.y > 0.3 || h < 0.95) continue;
      const tall = b.max.y > 1.75;
      const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
      const sx = b.max.x - b.min.x, sz = b.max.z - b.min.z;
      const sides: [number, number, number, number][] = [
        [b.max.x + 0.75, cz, 1, 0], [b.min.x - 0.75, cz, -1, 0],
        [cx, b.max.z + 0.75, 0, 1], [cx, b.min.z - 0.75, 0, -1],
      ];
      for (const [x, z, nx, nz] of sides) {
        // Long walls get several spots along their length.
        const along = nx !== 0 ? sz : sx;
        const count = Math.max(1, Math.min(4, Math.floor(along / 2.5)));
        for (let k = 0; k < count; k++) {
          const off = count === 1 ? 0 : (k / (count - 1) - 0.5) * (along - 1.2);
          const px = nx !== 0 ? x : x + off;
          const pz = nz !== 0 ? z : z + off;
          if (!this.isWalkable(px, pz)) continue;
          v.set(px, 0, pz);
          this.cover.push({ x: px, z: pz, y: this.floorAt(px, pz), nx, nz, tall, claimed: 0 });
        }
      }
    }
  }
}
