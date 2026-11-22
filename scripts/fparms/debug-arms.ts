// Prints where the skinned arms land for a weapon (anchors, wrist, elbow, shoulder, fingertips).
//   node --experimental-transform-types --no-warnings --import ./tests/register.mjs scripts/fparms/debug-arms.ts [model]
import * as THREE from "three";
import { WeaponViewmodel, type ViewmodelState } from "../../src/game/weapons/WeaponViewmodel";
import { WEAPONS, type WeaponDef } from "../../src/game/weapons/weapons";
import { anchorData } from "../../src/game/weapons/viewmodel/arms/anchor";
import { loadGltfGeometry } from "../../tests/realGunsHelpers";

const model = (process.argv[2] ?? "m4a1") as WeaponDef["model"];
const vm = new WeaponViewmodel(null);
vm.arms.setTemplate(await loadGltfGeometry(process.cwd(), "assets/characters/fparms/fparms.gltf"));
vm.useSkinnedArms();
vm.setWeapon(Object.values(WEAPONS).find((w) => w.model === model) as WeaponDef);
const st: ViewmodelState = { ads: 0, sprint: 0, slide: 0, bobDistance: 0, bobAmount: 0, yawDelta: 0, pitchDelta: 0, reload: -1, reloadEmpty: false, lowered: 0, grounded: true, melee: -1, throwing: -1, sinceShot: 9, shellReload: false };
Object.assign(st, JSON.parse(process.argv[3] ?? "{}"));
for (let i = 0; i < 30; i++) vm.update(1 / 60, st);
const f = (v: THREE.Vector3) => v.toArray().map((x) => x.toFixed(3)).join(", ");
vm.pivot.traverseVisible((o) => {
  const d = anchorData(o);
  if (!d) return;
  console.log("anchor", d.side, o.parent?.name || o.parent?.type, "local", f(o.position), "parentWorld", f(o.parent!.getWorldPosition(new THREE.Vector3())), "at", f(o.getWorldPosition(new THREE.Vector3())), "elbow", f(d.elbow.clone().applyMatrix4(o.parent!.matrixWorld)), "r", d.pose.r);
});
vm.scene.traverse((o) => {
  if (!(o as THREE.Bone).isBone) return;
  if (/(UpperArm|Forearm|_Hand|Finger1Tip|Finger0Tip|Finger4Tip)$/.test(o.name)) console.log(o.name, f(o.getWorldPosition(new THREE.Vector3())));
});
// Hand bones in their anchor's frame.
const anchors: THREE.Object3D[] = [];
vm.pivot.traverseVisible((o) => { if (anchorData(o)) anchors.push(o); });
for (const a of anchors) {
  const d = anchorData(a)!;
  const inv = a.matrixWorld.clone().invert();
  vm.scene.traverse((o) => {
    if ((o as THREE.Bone).isBone && o.name === `Bip01_${d.side}_Hand` && o.parent!.matrixWorld.determinant() !== 0) {
      console.log(d.side, "hand in anchor frame", f(o.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv)), "solved", f(new THREE.Vector3().setFromMatrixPosition(d.solved!.hand)));
    }
  });
}
