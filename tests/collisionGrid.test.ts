// The gridded CollisionWorld must answer exactly like a plain scan over every box.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { CollisionWorld } from "../src/game/world/Collision";
import { MORRO_AZUL } from "../src/game/world/maps/morroAzul";

const EPS = 0.001;

function brute(boxes: THREE.Box3[]) {
  return {
    raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number) {
      let best = maxDist;
      if (dx === 0) dx = 1e-12;
      if (dy === 0) dy = 1e-12;
      if (dz === 0) dz = 1e-12;
      const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
      for (const b of boxes) {
        let t1 = (b.min.x - ox) * ix, t2 = (b.max.x - ox) * ix;
        let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2);
        t1 = (b.min.y - oy) * iy; t2 = (b.max.y - oy) * iy;
        tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
        t1 = (b.min.z - oz) * iz; t2 = (b.max.z - oz) * iz;
        tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
        if (tmax >= Math.max(tmin, 0) && tmin < best) best = Math.max(tmin, 0);
      }
      return best < maxDist ? best : Infinity;
    },
    floorAt(x: number, z: number, maxY: number, radius = 0) {
      let y = 0;
      for (const b of boxes) if (x + radius > b.min.x && x - radius < b.max.x && z + radius > b.min.z && z - radius < b.max.z && b.max.y <= maxY + 1e-3 && b.max.y > y) y = b.max.y;
      return y;
    },
    moveAxis(feet: THREE.Vector3, axis: "x" | "y" | "z", delta: number, radius: number, height: number) {
      if (delta === 0) return false;
      feet[axis] += delta;
      let hit = false;
      for (const b of boxes) {
        if (!(feet.x - radius < b.max.x - EPS && feet.x + radius > b.min.x + EPS && feet.y < b.max.y - EPS && feet.y + height > b.min.y + EPS && feet.z - radius < b.max.z - EPS && feet.z + radius > b.min.z + EPS)) continue;
        hit = true;
        if (axis === "y") feet.y = delta > 0 ? b.min.y - height - EPS : b.max.y;
        else feet[axis] = delta > 0 ? b.min[axis] - radius - EPS : b.max[axis] + radius + EPS;
      }
      return hit;
    },
  };
}

function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

test("collision grid matches a full scan on the Morro Azul colliders", () => {
  const world = new CollisionWorld();
  const boxes: THREE.Box3[] = [new THREE.Box3(new THREE.Vector3(-180, -1, -180), new THREE.Vector3(180, 0, 180))];
  for (const b of MORRO_AZUL.boxes.filter((k) => !k.decor)) {
    const y = b.y ?? 0;
    boxes.push(new THREE.Box3(new THREE.Vector3(b.x - b.w / 2, y, b.z - b.d / 2), new THREE.Vector3(b.x + b.w / 2, y + b.h, b.z + b.d / 2)));
  }
  for (const b of boxes) world.add(b);
  const ref = brute(boxes);
  const r = rng(7);
  const p = () => (r() - 0.5) * 190;
  for (let i = 0; i < 3000; i++) {
    const ox = p(), oy = r() * 14, oz = p();
    let dx = r() - 0.5, dz = r() - 0.5;
    const dy = (r() - 0.5) * 0.6;
    if (i % 50 === 0) [dx, dz] = [0, 0]; // straight down/up
    if (i % 37 === 0) dz = 0; // axis-aligned
    const l = Math.hypot(dx, dy, dz) || 1;
    const far = r() * 140;
    const a = world.raycast(ox, oy, oz, dx / l, dy / l, dz / l, far);
    const b = ref.raycast(ox, oy, oz, dx / l, dy / l, dz / l, far);
    assert.ok(a === b || Math.abs(a - b) < 1e-9, `ray ${i}: ${a} vs ${b}`);
    const los = world.lineOfSight(new THREE.Vector3(ox, oy, oz), new THREE.Vector3(ox + (dx / l) * far, oy + (dy / l) * far, oz + (dz / l) * far));
    assert.equal(los, b === Infinity || far < 1e-4, `los ${i}`);

    const fy = r() * 14, rad = r() * 0.5;
    assert.equal(world.floorAt(ox, oz, fy, rad), ref.floorAt(ox, oz, fy, rad), `floor ${i}`);

    const axis = (["x", "y", "z"] as const)[i % 3];
    const d = (r() - 0.5) * 1.5;
    const f1 = new THREE.Vector3(ox, fy, oz), f2 = f1.clone();
    assert.equal(world.moveAxis(f1, axis, d, 0.4, 1.8), ref.moveAxis(f2, axis, d, 0.4, 1.8), `move hit ${i}`);
    assert.ok(f1.distanceTo(f2) < 1e-12, `move ${i}: ${f1.toArray()} vs ${f2.toArray()}`);
  }
});

test("collision grid rebuilds after more boxes are added", () => {
  const world = new CollisionWorld();
  world.add(new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 1)));
  assert.equal(world.raycast(-5, 0.5, 0.5, 1, 0, 0, 20), 5);
  world.add(new THREE.Box3(new THREE.Vector3(-3, 0, 0), new THREE.Vector3(-2, 1, 1)));
  assert.equal(world.raycast(-5, 0.5, 0.5, 1, 0, 0, 20), 2);
  assert.equal(world.floorAt(-2.5, 0.5, 5), 1);
});
