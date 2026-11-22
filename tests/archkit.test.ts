// Modular architecture kit (art/blender/archkit -> public/assets/archkit): the
// runtime piece table matches the built kit, gameplay heights, the door hinge
// API, the box fallback (hidden while the kit draws, back on failure / Low),
// batching + LOD on a synthetic kit, and the Brennhollow before / after budget.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { QUALITY } from "../src/game/config";
import { MeshBuilder } from "../src/game/world/MeshBuilder";
import { createStyleKit } from "../src/game/world/BoxStyles";
import { DRESSINGS } from "../src/game/world/dressing/index";
import type { DressingKit } from "../src/game/world/dressing/common";
import { MAPS } from "../src/game/world/maps/registry";
import { Frame } from "../src/game/world/architecture/kit";
import { ArchKitLayer, COVER, FALLBACK, KIT_PIECES, archKitConfig, coverClass, type KitPiece } from "../src/game/world/architecture/archkit";

// Minimal DOM stand-ins so the canvas-painting dressings run under node (as in mapDetail.test.ts).
const ctx2d: unknown = new Proxy(
  {},
  {
    get: (_t, k) => {
      if (k === "createLinearGradient" || k === "createRadialGradient" || k === "createPattern") return () => ({ addColorStop() {} });
      if (k === "getImageData" || k === "createImageData") return (_x: number, _y: number, w = 1, h = 1) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
      if (k === "measureText") return () => ({ width: 10 });
      return () => {};
    },
    set: () => true,
  },
);
(globalThis as unknown as { document?: unknown }).document ??= { createElement: () => ({ width: 1, height: 1, style: {}, getContext: () => ctx2d }) };

const DIR = join(process.cwd(), "public", "assets", "archkit");
type Meta = { pieces: Record<string, { lod0: { tris: number; materials: string[] }; lod1: { tris: number } }>; heights: { low: number; mantle: number } };
const meta = (): Meta => JSON.parse(readFileSync(join(DIR, "archkit.json"), "utf8"));

test("archkit: the runtime piece table matches the built kit, both LODs, glTF twins + KTX2", () => {
  const m = meta();
  assert.deepEqual([...KIT_PIECES].sort(), Object.keys(m.pieces).sort());
  for (const [name, p] of Object.entries(m.pieces)) {
    assert.ok(p.lod0.tris > 0 && p.lod1.tris > 0, `${name}: empty LOD`);
    assert.ok(p.lod1.tris <= p.lod0.tris, `${name}: LOD1 heavier than LOD0`);
    assert.ok(p.lod0.tris <= 3000, `${name}: ${p.lod0.tris} tris over the per-piece budget`);
  }
  assert.equal(m.heights.low, COVER.low);
  assert.equal(m.heights.mantle, COVER.mantle);
  for (const f of ["archkit.gltf", "archkit_1k.gltf"]) {
    const json = JSON.parse(readFileSync(join(DIR, f), "utf8"));
    assert.ok(json.extensionsUsed.includes("EXT_meshopt_compression"), `${f}: meshopt`);
    assert.ok(!json.extensionsRequired?.includes("KHR_texture_basisu"), `${f}: KTX2 must stay optional`);
    const names = json.scenes[0].nodes.map((i: number) => json.nodes[i].name);
    for (const p of KIT_PIECES) assert.ok(names.includes(p) && names.includes(`${p}__lod1`), `${f}: ${p} nodes`);
    for (const b of json.buffers) if (b.uri) assert.ok(existsSync(join(DIR, b.uri)), `${f}: ${b.uri}`);
    for (const t of json.textures) {
      assert.ok(existsSync(join(DIR, json.images[t.source].uri)), `${f}: JPEG fallback`);
      assert.ok(existsSync(join(DIR, json.images[t.extensions.KHR_texture_basisu.source].uri)), `${f}: KTX2`);
    }
    for (const mesh of json.meshes) for (const p of mesh.primitives) assert.ok(p.attributes.COLOR_0 !== undefined, `${f}: baked AO (COLOR_0) kept`);
  }
});

test("archkit: cover classes follow the standard gameplay heights", () => {
  assert.equal(coverClass(0.5), "step");
  for (const h of [0.9, 1.0, 1.05, 1.1]) assert.equal(coverClass(h), "low", `${h}`);
  for (const h of [1.2, 1.5, 1.8, 1.9]) assert.equal(coverClass(h), "mantle", `${h}`);
  assert.equal(coverClass(2.1), "wall");
});

test("archkit: door leaves swing about their hinge, into the building", () => {
  const f = new Frame(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0)); // outward normal: -Z
  const K = new ArchKitLayer("high");
  const left = K.leaf("door_leaf_panel", f, -0.5, 1.0, 2.15, "left", 0);
  const right = K.leaf("door_leaf_plank", f, 0.5, 1.0, 2.15, "right", 0);
  const tip = (i: number) => {
    const d = K.doors[i];
    return new THREE.Vector3(1, 0, 0).applyMatrix4(K.placements[d.index].m.clone().scale(new THREE.Vector3(1 / d.width, 1, 1)));
  };
  // Closed: both leaves span the opening towards the middle.
  assert.ok(Math.abs(tip(left).x - 0.5) < 1e-6 && Math.abs(tip(right).x + 0.5) < 1e-6);
  for (const i of [left, right]) {
    const hinge = K.doors[i].hinge.clone();
    K.setDoorAngle(i, Math.PI / 2);
    assert.ok(new THREE.Vector3().setFromMatrixPosition(K.placements[K.doors[i].index].m).distanceTo(hinge) < 1e-6, "hinge fixed");
    // Inside the building is +Z here (the facade faces -Z).
    assert.ok(tip(i).z > hinge.z + 0.9, `leaf ${i} swings inward (tip z ${tip(i).z.toFixed(2)})`);
  }
});

/** Synthetic kit scene: one node per piece / LOD (box geometry), as the glTF has them. */
function fakeKit(pieces: KitPiece[]) {
  const scene = new THREE.Group();
  const atlas = new THREE.MeshStandardMaterial({ name: "kit_atlas" });
  const glass = new THREE.MeshStandardMaterial({ name: "kit_glass" });
  for (const p of pieces) {
    for (const [suffix, seg] of [["", 4], ["__lod1", 1]] as const) {
      const node = new THREE.Group();
      node.name = p + suffix;
      node.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.1, seg, seg, 1), atlas));
      if (p === "win_casement") node.add(new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.3), glass));
      scene.add(node);
    }
  }
  return scene;
}

test("archkit: pieces batch into one draw per material, LOD and range culling per instance", () => {
  const K = new ArchKitLayer("high");
  const f = new Frame(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0));
  for (let i = 0; i < 40; i++) K.at("win_casement", f, i * 3, 1, 0);
  K.at("door_lamp", f, 0, 2.2, 0);
  K.at("door_lamp", f, 200, 2.2, 0);
  const x = K.extra();
  K.attachScene(x.object, fakeKit(["win_casement", "door_lamp"]));
  const kinds = K.meshes.map((m) => m.name).sort();
  assert.deepEqual(kinds, ["archkit:atlas", "archkit:glass"]);
  const cam = new THREE.PerspectiveCamera();
  cam.position.set(0, 1.7, -5);
  cam.updateMatrixWorld();
  x.update!(cam);
  const atlas = K.meshes.find((m) => m.name === "archkit:atlas")!;
  const visible = () => K.placements.filter((p) => p.vis).length;
  // Far lamp (200 m) culled, every window drawn; near ones LOD0, far ones LOD1.
  assert.equal(visible(), 41);
  assert.equal(K.placements[0].lod, 0);
  assert.equal(K.placements[39].lod, 1);
  assert.ok(x.triangles! > 0);
  assert.equal(atlas.instanceCount, 42);
  // Quality to Low: the kit hides, the box stand-ins come back.
  x.setQuality!("low");
  assert.equal(x.object.visible, false);
  x.dispose();
});

function brennhollow(q: keyof typeof QUALITY, kit: boolean) {
  archKitConfig.enabled = kit;
  const entry = MAPS.find((m) => m.id === "brennhollow")!;
  const builder = new MeshBuilder();
  const props = { place: () => {} } as unknown as DressingKit["props"];
  const boxes = JSON.stringify(entry.def.boxes);
  const dk: DressingKit = {
    def: entry.def,
    builder,
    props,
    style: createStyleKit(builder, props),
    quality: QUALITY[q],
    materials: { get: () => new THREE.MeshStandardMaterial(), lib: { get: () => new THREE.MeshStandardMaterial() } } as unknown as DressingKit["materials"],
    windTime: { value: 0 },
  };
  const plan = DRESSINGS[entry.def.dressing!](dk);
  archKitConfig.enabled = true;
  assert.equal(JSON.stringify(entry.def.boxes), boxes, "the kit never touches map boxes (collision)");
  // Draw calls: one per merged (group, material) bucket of the main builder and the layers,
  // fallback buckets hidden; the kit adds one per material batch.
  let draws = 0, tris = 0, fallbackTris = 0, fallbackDraws = 0;
  const count = (list: THREE.Mesh[], group: string) => {
    for (const m of list) {
      const t = (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
      if (group.startsWith(FALLBACK)) {
        fallbackTris += t;
        fallbackDraws++;
        assert.equal(m.visible, false, "fallback hidden while the kit is attached");
      } else if (!group.startsWith("proxy:") && !group.startsWith("model:")) {
        draws++;
        tris += t;
      }
    }
  };
  for (const [group, list] of builder.build(() => new THREE.MeshStandardMaterial())) count(list, group);
  const layers = (plan.extras ?? []).filter((x) => x.object.name.startsWith("bh-layer:"));
  for (const l of layers) l.object.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) count([m], m.name.startsWith(FALLBACK) ? FALLBACK : "decor");
  });
  const K = (plan.extras ?? []).find((x) => x.object.name === "archkit")?.object.userData.archkit as ArchKitLayer | undefined;
  const pieces = new Map<string, number>();
  for (const p of K?.placements ?? []) pieces.set(p.piece, (pieces.get(p.piece) ?? 0) + 1);
  for (const x of plan.extras ?? []) x.dispose();
  // From the square, the church steps and the east lane: what the kit submits after range culling and LOD.
  const m = meta();
  const views = [new THREE.Vector3(0, 1.7, -8), new THREE.Vector3(-14, 1.7, 8), new THREE.Vector3(24, 1.7, -2)];
  const seen = K ? Math.max(...views.map((v) => K.estimate(v, (p, lod) => m.pieces[p][lod ? "lod1" : "lod0"].tris).triangles)) : 0;
  return { draws, tris, fallbackTris, fallbackDraws, kit: !!K, pieces, doors: K?.doors.length ?? 0, seen };
}

test("archkit: Brennhollow before / after (draws, triangles), Low untouched", () => {
  const m = meta();
  for (const q of ["medium", "high"] as const) {
    const before = brennhollow(q, false);
    const after = brennhollow(q, true);
    assert.equal(before.fallbackDraws, 0);
    assert.ok(after.kit && after.fallbackDraws > 0, "kit attached, boxes kept as hidden stand-ins");
    let lod0 = 0, lod1 = 0, n = 0;
    for (const [p, c] of after.pieces) {
      lod0 += m.pieces[p].lod0.tris * c;
      lod1 += m.pieces[p].lod1.tris * c;
      n += c;
    }
    // Draw calls: the kit adds 3 (atlas, glass, lamp) and must not grow the merged buckets.
    assert.ok(after.draws <= before.draws, `${q}: buckets ${after.draws} <= ${before.draws}`);
    assert.ok(n > 500, `${q}: ${n} kit instances`);
    // Mobile budget: the whole village at LOD1 stays under 0.4 M triangles of kit.
    assert.ok(lod1 < 400_000, `${q}: kit LOD1 ${lod1}`);
    // In range (before frustum culling, so ~4x what one view draws): the medium preset stays lean.
    assert.ok(after.seen < (q === "high" ? 500_000 : 260_000), `${q}: kit triangles in range ${after.seen}`);
    console.log(
      `# brennhollow ${q}: before ${before.draws} draws, ${before.tris} tris | after ${after.draws} + 3 kit draws, ` +
        `${after.tris} box tris + kit ${n} instances (${lod1} tris all-LOD1 .. ${lod0} all-LOD0), ${after.fallbackTris} fallback tris hidden, ${after.doors} kit door leaves; worst view ${after.seen} kit tris; ` +
        [...after.pieces].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([p, c]) => `${p} ${c}`).join(", "),
    );
  }
  const low = brennhollow("low", true);
  assert.equal(low.kit, false);
  assert.equal(low.fallbackDraws, 0, "Low builds the box path only");
});

test("archkit: building() places kit units when a kit is attached, same boxes otherwise", async () => {
  const { building } = await import("../src/game/world/architecture/Building");
  const { attachArchKit, finishArchKit } = await import("../src/game/world/architecture/archkit");
  const spec = { x: 0, z: 0, w: 14, d: 10, floors: 3, floorH: 3.1, seed: 7, damage: 0.2, front: 0, detail: true, glazed: true };
  const plain = new MeshBuilder();
  building(plain, null, spec);
  const withKit = new MeshBuilder();
  const K = attachArchKit(withKit, "high")!;
  building(withKit, null, spec);
  // Same geometry overall: the replaced boxes only moved to the fallback group.
  assert.equal(withKit.triangles(), plain.triangles());
  assert.ok(withKit.triangles(FALLBACK) > 0);
  const kinds = new Set(K.placements.map((p) => p.piece));
  for (const p of ["win_casement", "win_sill", "win_lintel", "door_frame", "door_step"] as KitPiece[]) assert.ok(kinds.has(p), `building places ${p}`);
  assert.ok(K.doors.length > 0, "door leaves are kit leaves (hinged)");
  for (const x of finishArchKit(withKit)) x.dispose();
});
