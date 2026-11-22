// Third-person soldier guns (public/assets/weapons/tp, built by
// art/blender/tpguns/build.mjs): frame, anchors, budgets and the weapon ->
// model mapping. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as THREE from "three";
import { makeTpGun, tpModelFor, TP_FAMILY_MODEL, type TpFile } from "../src/game/ai/humanoid/rifle";
import { WEAPONS, type ThirdPersonKind, type ViewModelKind } from "../src/game/weapons/weapons";

const DIR = new URL("../public/assets/weapons/tp/", import.meta.url);
const file = JSON.parse(fs.readFileSync(new URL("guns.json", DIR), "utf8")) as TpFile & {
  guns: Record<string, { bounds: [number[], number[]]; tris: { tris: number; magTris: number; lod1Tris: number } }>;
};
const resolve = (k: ViewModelKind) => (file.guns[k] ? k : file.alias[k]);
const pos = (m: number[]) => new THREE.Vector3(m[12], m[13], m[14]);

test("tp guns are in the soldier rifle frame (butt at origin, +Z muzzle, +Y up)", () => {
  for (const [k, g] of Object.entries(file.guns)) {
    const [lo, hi] = g.bounds;
    assert.ok(Math.abs(lo[2]) < 0.02, `${k} butt at z=${lo[2]}`);
    assert.ok(Math.abs(hi[2] - g.length) < 0.03, `${k} length ${g.length} vs bounds ${hi[2]}`);
    assert.ok(g.length > 0.3 && g.length < 1.6, `${k} real-world length ${g.length}`);
    assert.ok(Math.abs(g.muzzle[2] - hi[2]) < 0.06, `${k} muzzle at the front`);
    assert.ok(g.muzzle[1] > lo[1] && g.muzzle[1] < hi[1], `${k} muzzle inside the height`);
  }
});

test("grips sit on the gun: strong hand behind the support hand, both inside the bounds", () => {
  for (const [k, g] of Object.entries(file.guns)) {
    const [lo, hi] = g.bounds;
    const r = pos(g.gripR.m), l = pos(g.gripL.m);
    assert.equal(g.gripR.side, "R");
    assert.equal(g.gripL.side, "L");
    assert.ok(l.z > r.z + 0.08, `${k} support hand ahead of the strong hand (${r.z.toFixed(2)} / ${l.z.toFixed(2)})`);
    for (const [n, p] of [["R", r], ["L", l]] as const) {
      for (const a of [0, 1, 2] as const) assert.ok(p.getComponent(a) > lo[a] - 0.06 && p.getComponent(a) < hi[a] + 0.06, `${k} grip ${n} axis ${a} outside the gun`);
    }
    if (g.mag) {
      for (const a of [0, 1, 2] as const) assert.ok(g.mag.well[a] > lo[a] - 0.03 && g.mag.well[a] < hi[a] + 0.03, `${k} mag well outside the gun`); // bullpups: behind the grip
      if (g.mag.grab) assert.equal(g.mag.grab.side, "L");
    }
    if (g.reload === "mag") assert.ok(g.mag, `${k} magazine reload needs a magazine`);
  }
});

test("tp gun budgets (mobile friendly)", () => {
  for (const [k, g] of Object.entries(file.guns)) {
    assert.ok(g.tris.tris <= 3600, `${k} ${g.tris.tris} tris`);
    assert.ok(g.tris.magTris <= 400, `${k} mag ${g.tris.magTris} tris`);
    assert.ok(g.tris.lod1Tris <= g.tris.tris, `${k} lod1 not lighter`);
  }
  const gltf = JSON.parse(fs.readFileSync(new URL("model.gltf", DIR), "utf8"));
  assert.equal(gltf.materials.length, 1, "one shared material");
  for (const n of gltf.nodes) assert.ok(!n.rotation && !n.translation && !n.scale, `${n.name} has a node transform (runtime reads raw geometry)`);
});

test("every long gun a soldier can carry has a tp model; pistols keep the procedural gun", () => {
  for (const [id, w] of Object.entries(WEAPONS)) {
    if (w.tp === "pistol") {
      assert.equal(tpModelFor(w.tp, w.model), null, id);
      continue;
    }
    const m = tpModelFor(w.tp, w.model);
    assert.ok(m, id);
    // A model still being authored is allowed to be missing (the procedural gun stays).
    if (fs.existsSync(new URL(`../${w.model}/model.gltf`, DIR))) assert.ok(resolve(m!), `${id}: no tp model for ${m}`);
  }
  for (const fam of Object.keys(TP_FAMILY_MODEL) as ThirdPersonKind[]) {
    const m = TP_FAMILY_MODEL[fam];
    if (m && fs.existsSync(new URL(`../${m}/model.gltf`, DIR))) assert.ok(resolve(m), `family ${fam}: ${m}`);
  }
});

test("makeTpGun finds the nodes and resolves aliases", () => {
  const scene = new THREE.Group();
  const mk = (name: string) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    m.name = name;
    scene.add(m);
  };
  const kind = Object.keys(file.guns)[0] as ViewModelKind;
  mk(kind);
  mk(`${kind}_mag`);
  const g = makeTpGun(scene, file, kind)!;
  assert.ok(g);
  assert.equal(g.body[1], g.body[0], "missing lod1 falls back to lod0");
  assert.equal(g.material.side, THREE.FrontSide);
  const alias = Object.entries(file.alias).find(([, v]) => v === kind)?.[0] as ViewModelKind | undefined;
  if (alias) assert.equal(makeTpGun(scene, file, alias)?.kind, kind);
  assert.equal(makeTpGun(scene, file, "m9" as ViewModelKind), null);
});
