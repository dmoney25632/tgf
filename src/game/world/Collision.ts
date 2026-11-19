import * as THREE from "three";

const EPS = 0.001;

/**
 * Axis-aligned box collision world. The map registers solid boxes; the
 * player moves as an upright AABB resolved one axis at a time, which is
 * cheap, stable and good enough for a blocky military map.
 */
export class CollisionWorld {
  readonly boxes: THREE.Box3[] = [];

  add(box: THREE.Box3) {
    this.boxes.push(box);
  }

  /** Does an upright box (feet position, radius, height) overlap anything? */
  overlaps(feet: THREE.Vector3, radius: number, height: number) {
    for (const b of this.boxes) {
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
    feet[axis] += delta;
    let hit = false;
    for (const b of this.boxes) {
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
      }
    }
    return hit;
  }

  /**
   * Ray vs all boxes (slab test). Returns the hit distance or Infinity.
   * Used for AI line of sight, grenade bounces and explosion occlusion.
   */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number) {
    let best = maxDist;
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    for (const b of this.boxes) {
      let t1 = (b.min.x - ox) * ix, t2 = (b.max.x - ox) * ix;
      let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2);
      t1 = (b.min.y - oy) * iy; t2 = (b.max.y - oy) * iy;
      tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
      t1 = (b.min.z - oz) * iz; t2 = (b.max.z - oz) * iz;
      tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
      if (tmax >= Math.max(tmin, 0) && tmin < best) best = Math.max(tmin, 0);
    }
    return best < maxDist ? best : Infinity;
  }

  /** True if the straight segment a→b passes through no solid box. */
  lineOfSight(a: THREE.Vector3, b: THREE.Vector3) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return true;
    return this.raycast(a.x, a.y, a.z, dx / len, dy / len, dz / len, len) === Infinity;
  }

  /** Highest box top under (x, z) at or below `maxY` (0 = ground). */
  floorAt(x: number, z: number, maxY: number, radius = 0) {
    let y = 0;
    for (const b of this.boxes) {
      if (x + radius > b.min.x && x - radius < b.max.x && z + radius > b.min.z && z - radius < b.max.z && b.max.y <= maxY + 1e-3 && b.max.y > y) y = b.max.y;
    }
    return y;
  }
}
