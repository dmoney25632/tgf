// The Blender-authored soldier kit (public/assets/characters/kit/kit.gltf,
// built by art/blender/kit/build.mjs): every piece gear.ts asks for is in the
// file with both LODs, the authored gear is rigidly skinned like the
// procedural one, stays inside the per-soldier triangle budget, and the
// procedural kit comes back when the asset is withdrawn.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { loadGltfGeometry } from "./realGunsHelpers";
import { KIT_PIECES, setSoldierKit, soldierGear, soldierKitReady } from "../src/game/ai/soldier/gear";
import { npcIdentity, type Kit, type SoldierIdentity } from "../src/game/ai/soldier/identity";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const KITS: Kit[] = ["standard", "rusher", "heavy", "sniper", "warden"];
const joints = ["Bip01", "Bip01_Pelvis", "Bip01_Spine", "Bip01_Spine1", "Bip01_Spine2", "Bip01_Neck", "Bip01_Head", "Bip01_L_UpperArm", "Bip01_R_UpperArm", "Bip01_L_Thigh", "Bip01_R_Thigh", "Bip01_L_Calf", "Bip01_R_Calf"];
const at = (n: string) => new THREE.Vector3(0, n.includes("Head") ? 1.524 : 1, 0);
const pal = { uniform: 0x5b6148, vest: 0x4b4a38, helmet: 0x55553f, accent: 0xc0392b };
const tris = (g: THREE.BufferGeometry | null) => (g ? g.index!.count / 3 : 0);

test("kit.gltf carries every piece, both LODs, with uv and baked colour", async () => {
  const scene = await loadGltfGeometry(ROOT, "assets/characters/kit/kit.gltf");
  const names = new Set(scene.children.map((c) => c.name));
  for (const n of KIT_PIECES) {
    assert.ok(names.has(n), n);
    if (!/_lens$/.test(n)) assert.ok(names.has(`${n}_lod1`), `${n}_lod1`);
  }
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const a of ["position", "normal", "uv", "color"]) assert.ok(m.geometry.getAttribute(a), `${o.parent?.name}/${o.name}: ${a}`);
    assert.match((m.material as THREE.Material).name, /^k_/);
  });
  assert.ok(setSoldierKit(scene));
  assert.ok(soldierKitReady());
});

test("authored gear: rigid skin, palette applied, mid <= near, within budget", async () => {
  assert.ok(setSoldierKit(await loadGltfGeometry(ROOT, "assets/characters/kit/kit.gltf")));
  let worst = 0;
  for (const kit of KITS) {
    for (let s = 0; s < 12; s++) {
      const id = npcIdentity(s, kit);
      const female = id.body === "g" || id.body === "h";
      const g = soldierGear(id, pal, female, joints, at);
      assert.strictEqual(g, soldierGear(id, pal, female, joints, at));
      for (const geo of [g.kit[0], g.kit[1]]) {
        if (!geo) continue;
        const si = geo.getAttribute("skinIndex"), sw = geo.getAttribute("skinWeight"), c = geo.getAttribute("color");
        for (const a of ["position", "normal", "uv", "color", "aMat", "aWear"]) assert.ok(geo.getAttribute(a), a);
        for (let i = 0; i < si.count; i += 29) {
          assert.ok(si.getX(i) > 0 && si.getX(i) < joints.length);
          assert.equal(sw.getX(i), 1);
          assert.ok(Number.isFinite(geo.getAttribute("position").getY(i)));
          assert.ok(c.getX(i) >= 0 && c.getX(i) <= 1.5);
        }
      }
      if (g.kit[0] && g.kit[1]) assert.ok(tris(g.kit[1]) <= tris(g.kit[0]), `${kit} ${s}`);
      worst = Math.max(worst, tris(g.kit[0]) + (g.lens ? tris(g.lens.geo) : 0));
    }
  }
  // Heaviest combination: helmet-less cap, rig, assault pack, radio, pouches, pads, shemagh, glasses.
  const heavy: SoldierIdentity = { ...npcIdentity(0, "standard"), body: "d", head: "d", helmet: null, vest: null, headgear: "cap", chestRig: true, pack: "assault", radio: true, pouches: true, kneePads: true, shemagh: true, eyewear: "glasses", goggles: false, balaclava: false, armour: "none", ghillie: false };
  const h = soldierGear(heavy, pal, false, joints, at);
  worst = Math.max(worst, tris(h.kit[0]) + (h.lens ? tris(h.lens.geo) : 0));
  assert.ok(worst <= 8500, `kit ${worst} tris on one soldier`);
  assert.ok(tris(h.kit[1]) <= 4500, `mid LOD ${tris(h.kit[1])} tris`);
  setSoldierKit(null);
});

test("procedural kit is the fallback", () => {
  setSoldierKit(null);
  assert.equal(soldierKitReady(), false);
  const id = npcIdentity(3, "standard");
  const g = soldierGear(id, pal, false, joints, at);
  assert.ok(g.kit[0]);
  // An incomplete scene is refused and keeps the procedural kit.
  const partial = new THREE.Group();
  partial.add(Object.assign(new THREE.Object3D(), { name: "boonie" }));
  assert.equal(setSoldierKit(partial), false);
  assert.equal(soldierKitReady(), false);
});
