// Interactive doors: leaf geometry, collision that moves with the leaf, the
// swing holding off the player, AI pushing doors open, co-op prediction, the
// nav grid (doorway open, open-leaf footprint blocked, vault cells) and the
// Brennhollow doors sitting in their wall openings.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { CollisionWorld } from "../src/game/world/Collision";
import { DOOR, DoorSystem, leafBoxes, segmentCount, setDoorLeafFactory, type MapDoor } from "../src/game/world/interaction/doors";
import { NavGrid, WALK } from "../src/game/ai/NavGrid";
import { BRENNHOLLOW, HOUSES } from "../src/game/world/maps/brennhollow";

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => new THREE.Box3(v(x0, y0, z0), v(x1, y1, z1));

/** A wall along x at z 0..0.45 with a 1.6 m doorway at x −0.8..0.8; the door hangs at the inner (+z) face, swinging in (+z). */
function doorway() {
  const w = new CollisionWorld();
  w.add(box(-50, -1, -50, 50, 0, 50));
  w.add(box(-6, 0, 0, -0.8, 3, 0.45));
  w.add(box(0.8, 0, 0, 6, 3, 0.45));
  w.add(box(-0.8, 2.2, 0, 0.8, 3, 0.45));
  // Hinge at x −0.8, leaf points +x (yaw 0); opening toward +z needs a negative swing (dir (cos, −sin)).
  const door: MapDoor = { x: -0.8, z: 0.42, yaw: 0, w: 1.59, h: 2.18, swing: -Math.PI / 2 };
  return { w, door };
}

function run(doors: DoorSystem, seconds: number, body: Parameters<DoorSystem["update"]>[1] = null) {
  for (let t = 0; t < seconds; t += 1 / 60) doors.update(1 / 60, body);
}

test("leaf boxes follow the swing", () => {
  const d: MapDoor = { x: 0, z: 0, yaw: 0, w: 1.2, h: 2.1, swing: -Math.PI / 2 };
  const n = segmentCount(d.w);
  const boxes = Array.from({ length: n }, () => new THREE.Box3());
  leafBoxes(d, 0, boxes);
  const closed = new THREE.Box3();
  for (const b of boxes) closed.union(b);
  assert.ok(closed.min.x > 0 && closed.max.x <= 1.2 + 1e-9 && closed.max.z - closed.min.z < 0.06, "closed: thin along +x");
  leafBoxes(d, d.swing, boxes);
  const open = new THREE.Box3();
  for (const b of boxes) open.union(b);
  assert.ok(open.max.x - open.min.x < 0.06 && open.min.z > 0 && open.max.z <= 1.2 + 1e-9, "open: thin along +z (into the room)");
  // Half open: segments stay tight (none bigger than ~0.4 m across).
  leafBoxes(d, d.swing / 2, boxes);
  for (const b of boxes) assert.ok(b.max.x - b.min.x < 0.4 && b.max.z - b.min.z < 0.4);
});

test("closed doors block movement and rays; open doors don't", () => {
  const { w, door } = doorway();
  const doors = new DoorSystem(w, new THREE.Group(), [door]);
  const feet = v(0, 0, -1);
  // Walk through the doorway (+z) in 5 cm steps.
  const walk = (f: THREE.Vector3) => {
    let hit = false;
    for (let i = 0; i < 50; i++) hit = w.moveAxis(f, "z", 0.05, 0.35, 1.8) || hit;
    return hit;
  };
  const shut = feet.clone();
  assert.equal(walk(shut), true, "closed leaf stops the player");
  assert.ok(shut.z < 0.42, "stopped in front of the leaf");
  assert.ok(w.raycast(0, 1.5, -1, 0, 0, 1, 5) < 1.6, "closed leaf stops rays (AI sight)");
  doors.toggle(0);
  run(doors, DOOR.swingTime + 0.1);
  assert.equal(doors.amount(0), 1);
  const f = feet.clone();
  assert.equal(walk(f), false, "open: walk straight through");
  assert.ok(Math.abs(f.z - 1.5) < 1e-6);
  assert.equal(w.raycast(0, 1.5, -1, 0, 0, 1, 5), Infinity, "open: rays pass");
});

test("a swing never pushes into the player: it holds until they step clear", () => {
  const { w, door } = doorway();
  const doors = new DoorSystem(w, new THREE.Group(), [door]);
  const body = { feet: v(-0.1, 0, 0.9), radius: 0.35, height: 1.8 }; // inside the swing arc
  doors.toggle(0);
  run(doors, 1.5, body);
  assert.ok(doors.amount(0) < 1, "held short of the player");
  assert.ok(!w.overlaps(body.feet, body.radius, body.height), "leaf never overlaps the player");
  body.feet.set(2, 0, 3);
  run(doors, 1.0, body);
  assert.equal(doors.amount(0), 1, "finishes once clear");
});

test("AI walking into a closed door opens it; walking past along the wall doesn't", () => {
  const { w, door } = doorway();
  const doors = new DoorSystem(w, new THREE.Group(), [door]);
  w.dynamic!.agentNear(4, 1.2, 0, 3); // beside the wall, walking parallel
  assert.equal(doors.isOpen(0), false);
  w.dynamic!.agentNear(0, -1.2, 0, 3); // heading at the doorway
  assert.equal(doors.isOpen(0), true);
});

test("co-op client: toggles are predicted and requested; host state wins afterwards", () => {
  const { w, door } = doorway();
  const doors = new DoorSystem(w, new THREE.Group(), [door]);
  doors.authority = false;
  doors.toggle(0);
  assert.equal(doors.isOpen(0), true, "predicted locally");
  assert.deepEqual(doors.drainRequests(), [[0, 1]]);
  doors.applyStates([0]);
  assert.equal(doors.isOpen(0), true, "a stale host state doesn't snap it back");
  run(doors, DOOR.predictHold + 0.1);
  doors.applyStates([0]);
  assert.equal(doors.isOpen(0), false, "authoritative state applies after the prediction window");
  // AI never opens doors on a client (the host runs the AI).
  w.dynamic!.agentNear(0, -1.2, 0, 3);
  assert.equal(doors.isOpen(0), false);
  assert.deepEqual(doors.states(), [0]);
});

test("locked doors never open", () => {
  const { w, door } = doorway();
  const doors = new DoorSystem(w, new THREE.Group(), [{ ...door, locked: true }]);
  doors.toggle(0);
  w.dynamic!.agentNear(0, -1.2, 0, 3);
  assert.equal(doors.isOpen(0), false);
  assert.equal(doors.focus(v(0, 1.6, -1), v(0, 0, 1)), -1);
});

test("focus: the leaf under the crosshair, not through a wall", () => {
  const { w, door } = doorway();
  const doors = new DoorSystem(w, new THREE.Group(), [door]);
  assert.equal(doors.focus(v(0, 1.6, -1), v(0, 0, 1)), 0, "aiming at it");
  assert.equal(doors.focus(v(3, 1.6, -1), v(0, 0, 1)), -1, "aiming at the wall beside it");
  assert.equal(doors.focus(v(0, 1.6, -6), v(0, 0, 1)), -1, "out of reach");
});

test("kit hook: a factory leaf replaces the placeholder and joins the raycast list", () => {
  const { w, door } = doorway();
  const list: THREE.Object3D[] = [];
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.05));
  setDoorLeafFactory(() => mesh);
  try {
    const doors = new DoorSystem(w, new THREE.Group(), [door], list);
    assert.ok(list.includes(mesh));
    const other = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.05));
    doors.setLeaf(0, other);
    assert.ok(list.includes(other) && !list.includes(mesh), "swapped in the raycast list");
    doors.dispose();
    assert.equal(list.length, 0);
    assert.equal(w.raycast(0, 1.5, -1, 0, 0, 1, 5), Infinity, "disposed: collision gone");
  } finally {
    setDoorLeafFactory(null);
  }
});

test("nav: the doorway stays walkable, the open leaf's footprint doesn't", () => {
  const { w, door } = doorway();
  new DoorSystem(w, new THREE.Group(), [door]);
  const nav = new NavGrid(w, -6, -6, 12, 12, 0.5);
  const out = new Float32Array(256);
  assert.ok(nav.findPath(0, -3, 0, 3, out) > 0, "path through the (closed) doorway");
  // The open leaf lies along +z from the hinge at x −0.6.
  assert.equal(nav.isWalkable(-0.75, 1.25), false, "open-leaf footprint blocked");
  assert.equal(nav.isWalkable(0.25, 1.25), true, "rest of the doorway clear");
});

test("nav: low thin cover is a vault cell; tall walls and deep blocks aren't", () => {
  const w = new CollisionWorld();
  w.add(box(-50, -1, -50, 50, 0, 50));
  w.add(box(-20, 0, -0.3, 20, 1.0, 0.3)); // sandbag line across the whole grid
  w.add(box(-20, 0, 6, 20, 2.5, 6.6)); // tall wall further on
  w.add(box(-3, 0, -6, 3, 1.0, -3)); // deep low block
  const nav = new NavGrid(w, -10, -10, 20, 20);
  assert.equal(nav.walkable[nav.index(0, 0)], WALK.vault, "sandbags: vault");
  assert.ok(nav.vaultAt(0, 0) > 0.9);
  assert.equal(nav.walkable[nav.index(0, 6.3)], WALK.blocked, "tall wall");
  assert.equal(nav.walkable[nav.index(0, -4.5)], WALK.blocked, "deep block");
  assert.equal(nav.isWalkable(0, 0), false, "nothing stops on a vault cell");
  const out = new Float32Array(256);
  assert.ok(nav.findPath(0, -2, 0, 3, out) > 0, "path vaults the sandbag line");
});

test("Brennhollow: interactive doors hang in their openings and close them", () => {
  const doors = BRENNHOLLOW.doors ?? [];
  assert.equal(doors.length, 10, "hall ×4 leaves, church ×2, manor ×2, barn ×2");
  const w = new CollisionWorld();
  w.add(box(-100, -1, -100, 100, 0, 100));
  for (const b of BRENNHOLLOW.boxes) {
    if (b.decor) continue;
    const y = b.y ?? 0;
    w.add(box(b.x - b.w / 2, y, b.z - b.d / 2, b.x + b.w / 2, y + b.h, b.z + b.d / 2));
  }
  const solid = w.boxes.slice(1);
  const boxes = Array.from({ length: 4 }, () => new THREE.Box3());
  for (const d of doors) {
    for (const angle of [0, d.swing]) {
      const segs = leafBoxes(d, angle, boxes.slice(0, segmentCount(d.w)));
      for (const s of segs) {
        // Shrink: touching the jamb / reveal is fine, cutting into a wall is not.
        const t = s.clone().expandByScalar(-0.035);
        for (const b of solid) assert.ok(!t.intersectsBox(b), `${d.id} at ${angle ? "open" : "closed"} cuts into a wall`);
      }
    }
  }
  // Closed doors seal the doorway (both leaves of a pair together).
  const sys = new DoorSystem(w, new THREE.Group(), doors.map((d) => ({ ...d, open: false })));
  for (const h of HOUSES.filter((x) => x.enter)) {
    for (const o of h.doors.filter((x) => x.leaf)) {
      const nx = o.side === 1 ? -1 : o.side === 3 ? 1 : 0, nz = o.side === 0 ? 1 : o.side === 2 ? -1 : 0;
      const [px, pz] = o.side === 0 ? [h.x0 + o.u, h.z0] : o.side === 1 ? [h.x1, h.z0 + o.u] : o.side === 2 ? [h.x1 - o.u, h.z1] : [h.x0, h.z1 - o.u];
      const dist = w.raycast(px - nx * 1.5, 1.2, pz - nz * 1.5, nx, 0, nz, 3);
      assert.ok(dist < 2.2, `${h.id} door on side ${o.side} is shut by its leaf`);
    }
  }
  sys.dispose();
  // With every door open the interiors stay reachable for the AI.
  new DoorSystem(w, new THREE.Group(), doors.map((d) => ({ ...d, open: true })));
  const nav = new NavGrid(w, -50, -50, 100, 100);
  const out = new Float32Array(8192);
  const g = BRENNHOLLOW.spawns[0];
  for (const [x, z, name] of [[-18, -7, "hall"], [0, -25, "church"], [27, -27, "manor hall"], [36, 12, "barn"]] as const) {
    assert.ok(nav.findPath(g.x, g.z, x, z, out) > 0, `${name} reachable with the door leaves in the nav`);
  }
});
