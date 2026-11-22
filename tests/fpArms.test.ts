// Skinned first-person arms: the asset, the hand solve and the posing onto
// every gun's hand anchors (procedural guns in node; no GPU needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { loadGltfGeometry } from "./realGunsHelpers";
import { makeTemplate, solveHand, type ArmsTemplate } from "../src/game/weapons/viewmodel/arms/rig";
import { anchorData, type HandAnchorData } from "../src/game/weapons/viewmodel/arms/anchor";
import { WeaponViewmodel, type ViewmodelState } from "../src/game/weapons/WeaponViewmodel";
import { WEAPONS, type WeaponDef } from "../src/game/weapons/weapons";
import { PROC_ARM } from "../src/game/weapons/viewmodel/geo";

const ROOT = process.cwd();
const DIR = join(ROOT, "public", "assets", "characters", "fparms");
let template: Promise<THREE.Group> | null = null;
const scene = () => (template ??= loadGltfGeometry(ROOT, "assets/characters/fparms/fparms.gltf"));

const state: ViewmodelState = {
  ads: 0, sprint: 0, slide: 0, bobDistance: 0, bobAmount: 0, yawDelta: 0, pitchDelta: 0, reload: -1, reloadEmpty: false, lowered: 0,
  grounded: true, melee: -1, throwing: -1, sinceShot: 9, shellReload: false,
};

const anchor = (side: "L" | "R", r: number, extra: Partial<HandAnchorData["pose"]> = {}): HandAnchorData => ({
  side,
  pose: { r, ...extra },
  placement: { at: [0, 0, 0], axis: [1, 0, 0], palm: [0, -1, 0], elbow: [0, -0.3, 0.3], left: side === "L" },
  elbow: new THREE.Vector3(0, -0.3, 0.3),
});

test("fparms asset: one skinned mesh in the triangle budget, textures in place", async () => {
  for (const f of ["fparms.gltf", "fparms.bin", "fparms_color.jpg", "fparms_normal.jpg", "fparms_orm.jpg"]) assert.ok(existsSync(join(DIR, f)), `${f} missing`);
  const json = JSON.parse(readFileSync(join(DIR, "fparms.gltf"), "utf8"));
  assert.equal(json.skins?.length, 1);
  const t = makeTemplate(await scene());
  assert.ok(t.tris >= 10000 && t.tris <= 20000, `triangles ${t.tris}`);
  assert.ok(t.mesh.skeleton.bones.length <= 64, "bone count");
});

test("hand solve: wrist behind the knuckles, palm on the object, fingers wrapped around it", async () => {
  const t: ArmsTemplate = makeTemplate(await scene());
  for (const side of ["R", "L"] as const) {
    for (const r of [0.0135, 0.024, 0.033]) {
      const d = anchor(side, r);
      const s = solveHand(t, d);
      const wrist = new THREE.Vector3().setFromMatrixPosition(s.hand);
      const rest = t.sides[side];
      const k1 = rest.fingers[1][0].pos.clone().applyMatrix4(s.hand);
      const k4 = rest.fingers[4][0].pos.clone().applyMatrix4(s.hand);
      // Anchor frame: wrist toward -Z, index -> pinky toward +X (right) / -X (left), palm below (-Y).
      assert.ok(wrist.z < -0.04, `${side} r=${r}: wrist z ${wrist.z.toFixed(3)}`);
      assert.ok(wrist.y < 0, `${side}: wrist below the object`);
      const k = side === "R" ? 1 : -1;
      assert.ok((k4.x - k1.x) * k > 0.03, `${side}: index -> pinky runs along the object`);
      // Finger tips end up close to the object surface (wrapped, not sticking out).
      const tmp = new THREE.Object3D();
      const bones = t.mesh.skeleton.bones;
      void tmp;
      void bones;
      for (let f = 1; f < 5; f++) {
        let q = new THREE.Quaternion().setFromRotationMatrix(s.hand);
        let p = rest.fingers[f][0].pos.clone().applyMatrix4(s.hand);
        for (let i = 0; i < 3; i++) {
          q = q.clone().multiply(new THREE.Quaternion().fromArray(s.fingers, (f * 3 + i) * 4));
          const child = i < 2 ? rest.fingers[f][i + 1].pos : rest.tips[f];
          p = child.clone().applyQuaternion(q).add(p);
        }
        const radial = Math.hypot(p.y, p.z);
        assert.ok(radial < r + 0.03, `${side} finger ${f} tip ${radial.toFixed(3)} from the axis (r ${r})`);
      }
    }
  }
});

test("viewmodel: skinned arms replace the procedural ones and land on every gun's hands", async () => {
  const armsScene = await scene();
  const models = [...new Set(Object.values(WEAPONS).map((w) => w.model))];
  const vm = new WeaponViewmodel(null);
  vm.arms.setTemplate(armsScene);
  vm.useSkinnedArms();
  const wrist = new THREE.Vector3();
  const anchorPos = new THREE.Vector3();
  for (const model of models) {
    vm.setWeapon(Object.values(WEAPONS).find((w) => w.model === model) as WeaponDef);
    vm.update(1 / 60, state);
    let procVisible = 0;
    vm.pivot.traverseVisible((o) => {
      if (o.userData[PROC_ARM]) procVisible++;
    });
    assert.equal(procVisible, 0, `${model}: procedural arms still visible`);
    const anchors: THREE.Object3D[] = [];
    vm.pivot.traverseVisible((o) => {
      if (anchorData(o)) anchors.push(o);
    });
    assert.ok(anchors.length >= 1, `${model}: no hand anchors`);
    // Each visible hand is posed: some hand bone sits next to each anchor.
    const hands: THREE.Bone[] = [];
    vm.scene.traverseVisible((o) => {
      if ((o as THREE.Bone).isBone && /_Hand$/.test(o.name) && o.parent!.matrixWorld.determinant() !== 0) hands.push(o as THREE.Bone);
    });
    for (const a of anchors) {
      a.getWorldPosition(anchorPos);
      const near = hands.some((h) => h.getWorldPosition(wrist).distanceTo(anchorPos) < 0.15);
      assert.ok(near, `${model}: no hand near the ${anchorData(a)!.side} anchor`);
    }
  }
  vm.dispose();
});
