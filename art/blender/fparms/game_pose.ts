// Exports first-person poses from the real game code for the Blender preview
// renders (render.py): for each scenario, the WeaponViewmodel is built in node
// with the skinned arms installed, updated like the game does, and written as
//   <out>/<name>.json  camera (world matrix, vertical fov, aspect) + per-bone
//                      deformation matrices (posed world x inverse bind) of
//                      the first visible arms rig, glTF Y-up space
//   <out>/<name>.glb   the rest of the viewmodel (gun, magazine, knife ...)
//
//   node --experimental-transform-types --no-warnings --import ./tests/register.mjs \
//     art/blender/fparms/game_pose.ts <out dir> [arms.gltf under public/] [scenario ...]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { WeaponViewmodel, type ViewmodelState } from "../../../src/game/weapons/WeaponViewmodel";
import { WEAPONS, type WeaponDef } from "../../../src/game/weapons/weapons";
import { loadGltfGeometry } from "../../../tests/realGunsHelpers";

(globalThis as { FileReader?: unknown }).FileReader = class {
  result: ArrayBuffer | null = null;
  onloadend?: (e: unknown) => void;
  readAsArrayBuffer(b: Blob) {
    void b.arrayBuffer().then((r) => {
      this.result = r;
      this.onloadend?.({ target: this });
    });
  }
};

type Scene = { model: WeaponDef["model"]; state?: Partial<ViewmodelState> };
const SCENES: Record<string, Scene> = {
  m4a1: { model: "m4a1" },
  m4a1_ads: { model: "m4a1", state: { ads: 1 } },
  m4a1_reload: { model: "m4a1", state: { reload: 0.3 } },
  akm: { model: "akm" },
  m9: { model: "m9" },
  knife: { model: "knife" },
  r870_pump: { model: "r870", state: { sinceShot: 0.35 } },
};
const base: ViewmodelState = {
  ads: 0, sprint: 0, slide: 0, bobDistance: 0, bobAmount: 0, yawDelta: 0, pitchDelta: 0, reload: -1, reloadEmpty: false, lowered: 0,
  grounded: true, melee: -1, throwing: -1, sinceShot: 9, shellReload: false,
};

const OUT = process.argv[2];
const ARMS = process.argv[3] ?? "assets/characters/fparms/fparms.gltf";
let names = process.argv.slice(4);
if (!names.length) names = Object.keys(SCENES);
mkdirSync(OUT, { recursive: true });
const arms = await loadGltfGeometry(process.cwd(), ARMS);
for (const name of names) {
  const sc = SCENES[name];
  const vm = new WeaponViewmodel(null);
  vm.setAspect(16 / 9);
  vm.arms.setTemplate(arms);
  vm.useSkinnedArms();
  vm.setWeapon(Object.values(WEAPONS).find((w) => w.model === sc.model) as WeaponDef);
  const st = { ...base, ...sc.state };
  vm.debug = sc.state ?? {};
  for (let i = 0; i < 60; i++) vm.update(1 / 60, st);
  vm.scene.updateMatrixWorld(true);
  vm.camera.updateMatrixWorld(true);
  let rig: THREE.SkinnedMesh | null = null;
  vm.scene.traverseVisible((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh && !rig) rig = o as THREE.SkinnedMesh;
  });
  if (!rig) throw new Error(`${name}: no arms`);
  const sm = rig as THREE.SkinnedMesh;
  sm.skeleton.update();
  const bones: Record<string, number[]> = {};
  sm.skeleton.bones.forEach((b, i) => {
    const d = new THREE.Matrix4().multiplyMatrices(b.matrixWorld, sm.skeleton.boneInverses[i]);
    bones[b.name] = d.toArray();
  });
  writeFileSync(
    join(OUT, `${name}.json`),
    JSON.stringify({ camera: { matrix: vm.camera.matrixWorld.toArray(), fov: vm.camera.fov, aspect: vm.camera.aspect }, mesh: sm.matrixWorld.toArray(), bones }),
  );
  // Everything else visible (the gun): plain meshes, world space.
  const out = new THREE.Group();
  vm.scene.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) return;
    const mat = m.material as THREE.Material;
    if (mat.blending === THREE.AdditiveBlending || (mat as THREE.MeshBasicMaterial).isMeshBasicMaterial) return;
    const g = m.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!["position", "normal", "color"].includes(k)) g.deleteAttribute(k);
    g.applyMatrix4(m.matrixWorld);
    const c = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.5, metalness: 0.2, vertexColors: !!g.attributes.color }));
    out.add(c);
  });
  const glb = await new Promise<ArrayBuffer>((res, rej) => new GLTFExporter().parse(out, (r) => res(r as ArrayBuffer), rej, { binary: true }));
  writeFileSync(join(OUT, `${name}.glb`), Buffer.from(glb));
  console.log(name, "bones", Object.keys(bones).length, "gun meshes", out.children.length);
  vm.dispose();
}
