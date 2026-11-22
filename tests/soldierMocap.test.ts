// Motion-captured soldiers: locomotion blend space, gait phase, hip yaw,
// world-space two-bone IK, and the shipped asset bundle (clips, skeleton,
// LOD budgets). Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as THREE from "three";
import { advancePhase, blendStride, hipYaw, LOCO_CLIPS, locoWeights, type ClipInfo, type LocoClip, type LocoWeights } from "../src/game/ai/soldier/locomotion";
import { solveTwoBone, wpos, wquat } from "../src/game/ai/soldier/ik";

const DIR = new URL("../public/assets/characters/soldiers/", import.meta.url);
const meta = JSON.parse(fs.readFileSync(new URL("soldiers.json", DIR), "utf8")) as {
  avatars: Record<string, { sex: string; cap: boolean; parts: string[]; tris: Record<string, [number, number]>; gains: number[] }>;
  clips: Record<LocoClip | "hitChest" | "hitHead" | "death", ClipInfo>;
};

test("loco weights always sum to 1 and pick the right clips", () => {
  const w = {} as LocoWeights;
  for (let s = 0; s <= 9; s += 0.25) {
    for (const c of [0, 0.3, 1]) {
      locoWeights(s, c, w);
      const sum = LOCO_CLIPS.reduce((a, k) => a + w[k], 0);
      assert.ok(Math.abs(sum - 1) < 1e-9, `sum ${sum} at speed ${s} crouch ${c}`);
      for (const k of LOCO_CLIPS) assert.ok(w[k] >= 0);
    }
  }
  assert.equal(locoWeights(0, 0, w).idle, 1);
  assert.equal(locoWeights(1.2, 0, w).walk, 1);
  assert.equal(locoWeights(4.4, 0, w).jog, 1); // rifleman run speed
  assert.equal(locoWeights(8, 0, w).sprint, 1);
  assert.equal(locoWeights(0, 1, w).crouchIdle, 1);
  assert.equal(locoWeights(1.5, 1, w).crouchWalk, 1);
  // Backwards uses the magnitude.
  assert.equal(locoWeights(-1.2, 0, w).walk, 1);
});

test("blended stride stays between the clips' strides; phase keeps feet planted", () => {
  const w = {} as LocoWeights;
  const info = meta.clips;
  for (let s = 0.6; s <= 8; s += 0.2) {
    locoWeights(s, 0, w);
    const st = blendStride(w, info);
    assert.ok(st >= info.walk.stride - 1e-6 && st <= info.sprint.stride + 1e-6, `stride ${st} at ${s}`);
  }
  assert.equal(blendStride(locoWeights(0, 0, w), info), 0);
  // One cycle of travel at the walk stride = one full phase turn.
  const stride = info.walk.stride;
  let p = 0.25;
  for (let i = 0; i < 100; i++) p = advancePhase(p, stride / 100 / 1.2, 1.2, stride);
  assert.ok(Math.abs(p - 0.25) < 1e-9 || Math.abs(p - 0.25) > 0.999999);
  assert.ok(advancePhase(0.1, 0.1, -2, 1) >= 0 && advancePhase(0.1, 0.1, -2, 1) < 1);
  assert.equal(advancePhase(0.3, 1, 2, 0), 0.3);
});

test("hip yaw: strafes turn the hips, backpedal plays the gait backwards", () => {
  assert.deepEqual(hipYaw(0), { yaw: 0, dir: 1 });
  const left = hipYaw(Math.PI / 2);
  assert.equal(left.dir, 1);
  assert.ok(left.yaw > 0.9 && left.yaw <= 1.05);
  const right = hipYaw(-Math.PI / 2);
  assert.ok(right.yaw < -0.9);
  const back = hipYaw(Math.PI);
  assert.equal(back.dir, -1);
  assert.ok(Math.abs(back.yaw) < 1e-9);
  const backLeft = hipYaw((3 * Math.PI) / 4);
  assert.equal(backLeft.dir, -1);
  assert.ok(backLeft.yaw < 0); // walking backwards toward the back-left: hips turn right
});

test("two-bone IK reaches the target, bends toward the pole, sets the end rotation", () => {
  // Arm hanging along -Y from a shoulder at (0, 1.4, 0), odd local axes on purpose.
  const root = new THREE.Group();
  const upper = new THREE.Bone(), lower = new THREE.Bone(), end = new THREE.Bone();
  root.add(upper);
  upper.add(lower);
  lower.add(end);
  upper.position.set(0, 1.4, 0);
  upper.quaternion.setFromEuler(new THREE.Euler(0.3, -1.2, 2.0));
  const down = new THREE.Vector3(0, -1, 0);
  // Place children 0.28 m / 0.26 m "down" in the parent's world frame.
  root.updateMatrixWorld(true);
  const toLocal = (b: THREE.Object3D, d: THREE.Vector3, len: number) => d.clone().multiplyScalar(len).applyQuaternion(wquat(b, new THREE.Quaternion()).invert());
  lower.position.copy(toLocal(upper, down, 0.28));
  lower.quaternion.setFromEuler(new THREE.Euler(-0.7, 0.4, 0.1));
  root.updateMatrixWorld(true);
  end.position.copy(toLocal(lower, down, 0.26));
  root.updateMatrixWorld(true);

  const target = new THREE.Vector3(0.1, 1.25, 0.4);
  const pole = new THREE.Vector3(-1, -1, 0);
  const endQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.5, -0.3));
  solveTwoBone(upper, lower, end, target, pole, endQ);
  root.updateMatrixWorld(true);
  const got = wpos(end, new THREE.Vector3());
  assert.ok(got.distanceTo(target) < 1e-4, `wrist off by ${got.distanceTo(target)}`);
  const elbow = wpos(lower, new THREE.Vector3());
  assert.ok(Math.abs(elbow.distanceTo(wpos(upper, new THREE.Vector3())) - 0.28) < 1e-5);
  // Elbow on the pole side of the shoulder-target line.
  const a = wpos(upper, new THREE.Vector3());
  const axis = target.clone().sub(a).normalize();
  const off = elbow.clone().sub(a);
  off.addScaledVector(axis, -off.dot(axis));
  assert.ok(off.dot(pole) > 0);
  assert.ok(wquat(end, new THREE.Quaternion()).angleTo(endQ) < 1e-4);

  // Out of reach: the arm straightens toward the target.
  solveTwoBone(upper, lower, end, new THREE.Vector3(0, 1.4, 2), pole, null);
  root.updateMatrixWorld(true);
  const tip = wpos(end, new THREE.Vector3());
  assert.ok(tip.z > 0.5 && Math.abs(tip.y - 1.4) < 0.01);
});

test("soldier bundle: eight avatars of swappable parts within the triangle budget, all clips present", () => {
  const ids = Object.keys(meta.avatars);
  assert.deepEqual(ids.sort(), ["a", "b", "c", "d", "e", "f", "g", "h"]);
  let firstJoints: string | null = null;
  for (const id of ids) {
    const a = meta.avatars[id];
    assert.ok(a.parts.includes("body") && a.parts.includes("head"), id);
    let t0 = 0, t1 = 0;
    for (const p of a.parts) {
      const [lod0, lod1] = a.tris[p];
      assert.ok(lod1 < lod0 * 0.6, `${id}/${p} tris ${lod0}/${lod1}`);
      t0 += lod0;
      t1 += lod1;
    }
    assert.ok(t0 <= 16000 && t1 <= 5500, `${id} tris ${t0}/${t1}`);
    for (const f of [`soldier_${id}.gltf`, `soldier_${id}_1k.gltf`, `soldier_${id}.bin`, `soldier_${id}_color.jpg`, `soldier_${id}_color_1k.jpg`, `soldier_${id}_normal.jpg`, `soldier_${id}_orm.jpg`, `soldier_${id}_color.ktx2`, `soldier_${id}_color_1k.ktx2`, `soldier_${id}_normal.ktx2`, `soldier_${id}_orm.ktx2`]) {
      assert.ok(fs.existsSync(new URL(f, DIR)), f);
    }
    // Every part mesh (and its LOD) by name, one joint order for all avatars.
    const g = JSON.parse(fs.readFileSync(new URL(`soldier_${id}.gltf`, DIR), "utf8")) as { nodes: { name: string; mesh?: number }[]; skins: { joints: number[] }[] };
    const names = g.nodes.filter((n) => n.mesh !== undefined).map((n) => n.name);
    for (const p of a.parts) assert.ok(names.includes(p) && names.includes(`${p}_lod1`), `${id}: ${p}`);
    const joints = g.skins[0].joints.map((j) => g.nodes[j].name).join(",");
    for (const s of g.skins) assert.equal(s.joints.map((j) => g.nodes[j].name).join(","), joints);
    firstJoints ??= joints;
    assert.equal(joints, firstJoints, `${id}: joint order`);
  }
  for (const c of ["idle", "walk", "jog", "sprint", "crouchIdle", "crouchWalk", "hitChest", "hitHead", "death"] as const) {
    assert.ok(meta.clips[c].duration > 0, c);
  }
  // Walk < jog < sprint in speed (stride / duration).
  const v = (c: LocoClip) => meta.clips[c].stride / meta.clips[c].duration;
  assert.ok(v("walk") < v("jog") && v("jog") < v("sprint"));
  // glTF bundle carries the animations by the names the runtime asks for.
  const buf = fs.readFileSync(new URL("anims.glb", DIR));
  const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString()) as { animations: { name: string }[]; nodes: { name: string }[] };
  const names = json.animations.map((a) => a.name);
  for (const n of ["idle", "walk", "jog", "sprint", "crouchIdle", "crouchWalk", "hitChest", "hitHead", "death", "grip"]) assert.ok(names.includes(n), n);
  for (const b of ["Bip01", "Bip01_Pelvis", "Bip01_R_Hand", "Bip01_L_Foot", "Bip01_Head"]) assert.ok(json.nodes.some((n) => n.name === b), b);
  const lic = fs.readFileSync(new URL("LICENSE.txt", DIR), "utf8");
  assert.match(lic, /MIT/);
  assert.match(lic, /CC0/);
});
