// The grid raycast must report the same hits as three's default Mesh.raycast.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { accelerateRaycast } from "../src/game/world/MeshRaycastGrid";

function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

for (const [side, indexed, name] of [[THREE.FrontSide, true, "front/indexed"], [THREE.DoubleSide, false, "double/non-indexed"], [THREE.BackSide, true, "back/indexed"]] as const) {
  test(`grid raycast matches three (${name})`, () => {
    const r = rng(11);
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 600; i++) {
      const g = new THREE.BoxGeometry(0.3 + r() * 6, 0.3 + r() * 8, 0.3 + r() * 6);
      g.translate((r() - 0.5) * 160, r() * 6, (r() - 0.5) * 160);
      parts.push(indexed ? g : g.toNonIndexed());
    }
    const ground = new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2);
    parts.push(indexed ? ground : ground.toNonIndexed());
    const geo = mergeGeometries(parts.map((p) => { p.deleteAttribute("uv"); p.deleteAttribute("normal"); return p; }))!;
    const mat = new THREE.MeshBasicMaterial({ side });
    const plain = new THREE.Mesh(geo, mat);
    const fast = new THREE.Mesh(geo, mat);
    fast.position.set(3, 0.5, -2);
    plain.position.copy(fast.position);
    plain.updateMatrixWorld(true);
    fast.updateMatrixWorld(true);
    assert.ok(accelerateRaycast(fast));
    const rc = new THREE.Raycaster();
    for (let i = 0; i < 1500; i++) {
      const o = new THREE.Vector3((r() - 0.5) * 170, r() * 10, (r() - 0.5) * 170);
      const d = new THREE.Vector3(r() - 0.5, (r() - 0.5) * 0.7, r() - 0.5);
      if (i % 40 === 0) d.set(0, -1, 0);
      d.normalize();
      rc.set(o, d);
      rc.far = 5 + r() * 150;
      const a = rc.intersectObject(plain, false);
      const b = rc.intersectObject(fast, false);
      assert.equal(b.length, a.length, `ray ${i}: ${b.length} vs ${a.length} hits`);
      for (let k = 0; k < a.length; k++) {
        assert.ok(Math.abs(a[k].distance - b[k].distance) < 1e-6, `ray ${i} hit ${k} distance`);
        assert.ok(a[k].point.distanceTo(b[k].point) < 1e-6, `ray ${i} hit ${k} point`);
        assert.ok(a[k].face!.normal.distanceTo(b[k].face!.normal) < 1e-6, `ray ${i} hit ${k} normal`);
      }
    }
  });
}
