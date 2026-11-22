// Mantle & vault: probe logic against the AABB world, the motion curve, and
// the player controller driving it (fixed steps, cancel when blocked).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { CollisionWorld } from "../src/game/world/Collision";
import { TRAVERSAL, planIsClear, planTraversal, samplePlan, type TraversalBody } from "../src/game/player/traversal";
import { PlayerController, type MoveIntent } from "../src/game/player/PlayerController";
import { MOVEMENT } from "../src/game/config";

const BODY: TraversalBody = { radius: MOVEMENT.radius, standHeight: MOVEMENT.standHeight, crouchHeight: MOVEMENT.crouchHeight, stepHeight: MOVEMENT.stepHeight };
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => new THREE.Box3(v(x0, y0, z0), v(x1, y1, z1));

function world(...boxes: THREE.Box3[]) {
  const w = new CollisionWorld();
  w.add(box(-50, -1, -50, 50, 0, 50)); // ground
  for (const b of boxes) w.add(b);
  return w;
}

// Facing −z (yaw 0): obstacles sit at negative z.
const FWD: [number, number] = [0, -1];

test("vault: a 1 m wall 0.4 m thick is vaulted, landing on the far side", () => {
  const w = world(box(-3, 0, -1.0, 3, 1.0, -0.6));
  const p = planTraversal(w, v(0, 0, 0), ...FWD, BODY);
  assert.ok(p, "plan found");
  assert.equal(p.kind, "vault");
  assert.ok(p.end.z < -1.0 - BODY.radius, `lands past the wall (z ${p.end.z.toFixed(2)})`);
  // The last part of the drop is a real fall: the plan ends just above the ground, falling.
  assert.ok(p.exitAirborne && p.end.y > 0 && p.end.y < 1.0, `ends dropping (y ${p.end.y.toFixed(2)})`);
  assert.ok(p.exitVy < -2 && p.exitVy > -7, `hands physics a believable fall speed (${p.exitVy.toFixed(1)} m/s)`);
  assert.ok(p.duration >= 0.35 && p.duration <= 0.7, `brief (${p.duration.toFixed(2)} s)`);
  assert.ok(planIsClear(w, p, BODY));
  // The tucked body never enters the wall along the curve.
  const q = new THREE.Vector3();
  for (let i = 0; i <= 60; i++) {
    samplePlan(p, i / 60, q);
    assert.ok(!w.overlaps(q, BODY.radius * TRAVERSAL.tuckRadiusScale, TRAVERSAL.tuckHeight), `clear at s=${(i / 60).toFixed(2)}`);
  }
});

test("vault curve is continuous (no snapping between fixed steps)", () => {
  const w = world(box(-3, 0, -1.0, 3, 1.0, -0.6));
  const p = planTraversal(w, v(0, 0, 0), ...FWD, BODY)!;
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  const steps = Math.ceil(p.duration * 120);
  let maxStep = 0;
  for (let i = 0; i < steps; i++) {
    samplePlan(p, i / steps, a);
    samplePlan(p, (i + 1) / steps, b);
    maxStep = Math.max(maxStep, a.distanceTo(b));
  }
  // 120 Hz: never more than ~8 cm per step (≈9.6 m/s peak, a fast hop but no pop).
  assert.ok(maxStep < 0.08, `max per-step move ${maxStep.toFixed(3)} m`);
  samplePlan(p, 0, a);
  assert.ok(a.distanceTo(p.start) < 1e-6, "starts where the player stands");
  samplePlan(p, 1, a);
  assert.ok(a.distanceTo(p.end) < 1e-6, "ends at the landing");
});

test("mantle: a 1.6 m deep crate is climbed onto", () => {
  const w = world(box(-1, 0, -2.6, 1, 1.6, -0.55));
  const p = planTraversal(w, v(0, 0, 0), ...FWD, BODY);
  assert.ok(p);
  assert.equal(p.kind, "mantle");
  assert.ok(Math.abs(p.end.y - 1.6) < 1e-6, "stands on top");
  assert.ok(p.end.z < -0.55 - BODY.radius + 0.01, "fully over the lip");
  assert.equal(p.crouchEnd, false);
  assert.ok(p.duration <= 0.7 + 1e-6, `brief (${p.duration.toFixed(2)} s)`);
});

test("vault height obstacle that is too deep becomes a mantle", () => {
  const w = world(box(-1, 0, -3, 1, 1.0, -0.6));
  const p = planTraversal(w, v(0, 0, 0), ...FWD, BODY);
  assert.ok(p);
  assert.equal(p.kind, "mantle");
});

test("too tall, too low, nothing ahead: no traversal", () => {
  assert.equal(planTraversal(world(box(-3, 0, -1, 3, 2.3, -0.6)), v(0, 0, 0), ...FWD, BODY), null, "2.3 m wall");
  assert.equal(planTraversal(world(box(-3, 0, -1, 3, 0.4, -0.6)), v(0, 0, 0), ...FWD, BODY), null, "0.4 m step (auto step-up)");
  assert.equal(planTraversal(world(), v(0, 0, 0), ...FWD, BODY), null, "open ground");
  assert.equal(planTraversal(world(box(-3, 0, -3.0, 3, 1.0, -2.6)), v(0, 0, 0), ...FWD, BODY), null, "wall out of reach");
});

test("headroom: low ceiling turns the mantle into a crouch, or blocks it", () => {
  const crate = box(-1, 0, -2.6, 1, 1.6, -0.55);
  const p = planTraversal(world(crate, box(-1, 2.9, -2.6, 1, 3.2, -0.55)), v(0, 0, 0), ...FWD, BODY);
  assert.ok(p, "crouch-height gap");
  assert.equal(p.crouchEnd, true);
  assert.equal(planTraversal(world(crate, box(-1, 2.4, -2.6, 1, 2.7, -0.55)), v(0, 0, 0), ...FWD, BODY), null, "no room even crouched");
  // A ceiling right above the player blocks the rise itself.
  assert.equal(planTraversal(world(crate, box(-1, 2.2, -0.5, 1, 2.5, 0.5)), v(0, 0, 0), ...FWD, BODY), null, "no room to climb");
});

test("window: vault through a 0.95 m sill under a lintel", () => {
  // Wall 0.45 thick at z −0.6..−1.05 with a 1 m wide opening from 0.95 to 2.35.
  const w = world(
    box(-3, 0, -1.05, -0.5, 3, -0.6), box(0.5, 0, -1.05, 3, 3, -0.6),
    box(-0.5, 0, -1.05, 0.5, 0.95, -0.6), box(-0.5, 2.35, -1.05, 0.5, 3, -0.6),
  );
  const p = planTraversal(w, v(0, 0, 0), ...FWD, BODY);
  assert.ok(p, "window vault");
  assert.equal(p.kind, "vault");
  assert.ok(p.end.z < -1.05);
});

test("exploits: no-climb boxes, map bounds and max height are respected", () => {
  const w = world(box(-1, 0, -2.6, 1, 1.6, -0.55));
  w.setNoClimb(1);
  assert.equal(planTraversal(w, v(0, 0, 0), ...FWD, BODY), null, "flagged box");
  const w2 = world(box(-1, 0, -2.6, 1, 1.6, -0.55));
  assert.equal(planTraversal(w2, v(0, 0, 0), ...FWD, BODY, { bound: 0.5, maxY: Infinity }), null, "end outside the bound");
  assert.equal(planTraversal(w2, v(0, 0, 0), ...FWD, BODY, { bound: Infinity, maxY: 1.2 }), null, "above max height");
  assert.equal(planTraversal(w2, v(0, 0, 0), ...FWD, BODY, { bound: Infinity, maxY: Infinity, disabled: true }), null, "disabled");
  // Airborne: height counts from where you last stood, so jumping doesn't extend the reach.
  const tall = world(box(-1, 0, -2.6, 1, 2.6, -0.55));
  assert.equal(planTraversal(tall, v(0, 0.9, 0), ...FWD, BODY, undefined, 0), null, "2.6 m from a jump");
  assert.ok(planTraversal(tall, v(0, 0.9, 0), ...FWD, BODY, undefined, 0.8), "same ledge from a 0.8 m step is fine");
});

test("moving boxes (door leaves) are never climbed", () => {
  const w = world();
  w.addDynamic(box(-1, 0, -1.0, 1, 1.0, -0.6));
  assert.equal(planTraversal(w, v(0, 0, 0), ...FWD, BODY), null);
});

// ---- Controller --------------------------------------------------------------------

const intent = (over: Partial<MoveIntent> = {}): MoveIntent => ({
  forward: 1, strafe: 0, sprint: false, crouch: false, crouchPressed: false, jumpPressed: false, ads: 0, blockSprint: false, ...over,
});

function settle(pc: PlayerController, steps = 30) {
  for (let i = 0; i < steps; i++) pc.fixedStep(1 / 120, intent({ forward: 0 }));
}

test("controller: jump + forward at a low wall vaults it and keeps moving", () => {
  const w = world(box(-3, 0, -1.0, 3, 1.0, -0.6));
  const pc = new PlayerController(new THREE.PerspectiveCamera(), w);
  pc.spawn(v(0, 0, -0.15), 0);
  settle(pc);
  pc.frameInput(1 / 120, intent({ jumpPressed: true }));
  let started = false;
  let maxStep = 0;
  const prev = pc.position.clone();
  for (let i = 0; i < 120; i++) {
    pc.fixedStep(1 / 120, intent({ jumpPressed: i === 0 }));
    if (pc.traversing) started = true;
    maxStep = Math.max(maxStep, pc.position.distanceTo(prev));
    prev.copy(pc.position);
    assert.ok(!w.overlaps(pc.position, MOVEMENT.radius * 0.8, 1.0), `never inside the wall (step ${i})`);
  }
  assert.ok(started, "vault started");
  assert.equal(pc.traversing, false, "vault finished");
  assert.ok(pc.position.z < -1.0 - MOVEMENT.radius, `past the wall (z ${pc.position.z.toFixed(2)})`);
  assert.ok(pc.grounded, "on the ground");
  assert.ok(maxStep < 0.085, `smooth (max ${maxStep.toFixed(3)} m per step)`);
});

test("controller: jump without forward input is a plain jump", () => {
  const w = world(box(-3, 0, -1.0, 3, 1.0, -0.6));
  const pc = new PlayerController(new THREE.PerspectiveCamera(), w);
  pc.spawn(v(0, 0, -0.15), 0);
  settle(pc);
  pc.frameInput(1 / 120, intent({ forward: 0, jumpPressed: true }));
  pc.fixedStep(1 / 120, intent({ forward: 0 }));
  assert.equal(pc.traversing, false);
  assert.ok(pc.velocity.y > 0, "jumped");
});

test("controller: mantle onto a 1.8 m ledge ends standing on top", () => {
  const w = world(box(-2, 0, -3, 2, 1.8, -0.6));
  const pc = new PlayerController(new THREE.PerspectiveCamera(), w);
  pc.spawn(v(0, 0, -0.2), 0);
  settle(pc);
  pc.frameInput(1 / 120, intent({ jumpPressed: true }));
  for (let i = 0; i < 120; i++) pc.fixedStep(1 / 120, intent());
  assert.ok(Math.abs(pc.position.y - 1.8) < 0.02, `on the ledge (y ${pc.position.y.toFixed(2)})`);
  assert.ok(pc.position.z < -0.6);
});

test("controller: a door swinging into the path cancels the move cleanly", () => {
  const w = world(box(-2, 0, -3, 2, 1.8, -0.6));
  const pc = new PlayerController(new THREE.PerspectiveCamera(), w);
  pc.spawn(v(0, 0, -0.2), 0);
  settle(pc);
  pc.frameInput(1 / 120, intent({ jumpPressed: true }));
  pc.fixedStep(1 / 120, intent());
  assert.ok(pc.traversing);
  // A leaf appears on the ledge top right where we're heading.
  w.addDynamic(box(-2, 1.8, -1.2, 2, 3.5, -0.7));
  for (let i = 0; i < 90 && pc.traversing; i++) pc.fixedStep(1 / 120, intent());
  assert.equal(pc.traversing, false, "cancelled");
  assert.ok(!w.overlaps(pc.position, MOVEMENT.radius * 0.8, 1.0), "not stuck inside anything");
  for (let i = 0; i < 240; i++) pc.fixedStep(1 / 120, intent({ forward: 0 }));
  assert.ok(pc.grounded, "falls back to physics");
});
