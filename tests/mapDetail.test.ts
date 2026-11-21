// Map detail layer: every dressing still builds on every preset with the new
// facade kit, grime layer and skyline; budgets scale with quality; the grime
// layer never stains across a window/door hole; skyline pieces stay outside
// the playable area; and nothing here changes collision (dressings never see
// the collision world, and map boxes are left untouched).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { QUALITY } from "../src/game/config";
import { MeshBuilder, type AddOptions } from "../src/game/world/MeshBuilder";
import { createStyleKit } from "../src/game/world/BoxStyles";
import { MODELS, type ModelId } from "../src/game/assets/manifest";
import { DRESSINGS } from "../src/game/world/dressing/index";
import type { DressingKit } from "../src/game/world/dressing/common";
import { MAPS } from "../src/game/world/maps/registry";
import { GrimeLayer, attachGrime, finishGrime, grimeOf, holeRects } from "../src/game/world/architecture/grime";
import { building } from "../src/game/world/architecture/Building";
import { Frame, type Opening } from "../src/game/world/architecture/kit";
import { skyline } from "../src/game/world/architecture/skyline";
import type { WorldMat } from "../src/game/world/WorldMaterials";

// Minimal DOM stand-ins so the canvas-painting dressings (water, palms, atlases) run under node.
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
const g = globalThis as unknown as { document?: unknown };
g.document ??= { createElement: () => ({ width: 1, height: 1, style: {}, getContext: () => ctx2d }) };
const fakeMaterials = { get: () => new THREE.MeshStandardMaterial(), lib: { get: () => new THREE.MeshStandardMaterial() } } as unknown as DressingKit["materials"];

function fakeProps() {
  const placed: { id: ModelId; tier: number; x: number; z: number }[] = [];
  const props = {
    place: (id: ModelId, p: { tier?: number; x: number; z: number }) => placed.push({ id, tier: p.tier ?? 0, x: p.x, z: p.z }),
  } as unknown as DressingKit["props"];
  return { props, placed };
}

function run(mapId: string, q: keyof typeof QUALITY) {
  const entry = MAPS.find((m) => m.id === mapId)!;
  const builder = new MeshBuilder();
  const { props, placed } = fakeProps();
  const boxesBefore = JSON.stringify(entry.def.boxes);
  const kit: DressingKit = {
    def: entry.def,
    builder,
    props,
    style: createStyleKit(builder, props),
    quality: QUALITY[q],
    materials: fakeMaterials,
    windTime: { value: 0 },
  };
  const plan = DRESSINGS[entry.def.dressing!](kit);
  assert.equal(JSON.stringify(entry.def.boxes), boxesBefore, `${mapId}: dressing must not touch map boxes (collision)`);
  const grime = (plan.extras ?? []).find((x) => x.object.name === "grime");
  const out = {
    tris: builder.triangles(),
    far: builder.triangles("far"),
    grime: grime?.triangles ?? 0,
    propTris: placed.filter((p) => p.tier <= { low: 0, medium: 1, high: 2 }[q]).reduce((a, p) => a + MODELS[p.id].tris, 0),
    placed,
  };
  for (const x of plan.extras ?? []) x.dispose();
  return out;
}

test("every dressing builds on every preset; detail and grime scale with quality", () => {
  for (const m of MAPS) {
    if (!m.def.dressing || !DRESSINGS[m.def.dressing]) continue;
    const res = (["low", "medium", "high"] as const).map((q) => run(m.id, q));
    const [lo, , hi] = res;
    assert.ok(lo.tris <= hi.tris, `${m.id}: static tris scale ${lo.tris} <= ${hi.tris}`);
    assert.ok(lo.grime <= hi.grime, `${m.id}: grime scales ${lo.grime} <= ${hi.grime}`);
    assert.ok(hi.tris < 1_200_000, `${m.id}: static triangles ${hi.tris}`);
    assert.ok(hi.grime < 60_000, `${m.id}: grime triangles ${hi.grime}`);
    assert.ok(lo.propTris < 1_200_000, `${m.id}: low-preset prop triangles ${lo.propTris}`);
  }
});

test("maps with buildings or masonry boxes get a grime layer", () => {
  for (const id of ["dustfall-outpost", "cinder-flats", "saltpan-gantry", "iron-crossing", "greywater", "kestrel-yard"]) {
    assert.ok(run(id, "medium").grime > 0, `${id} has grime`);
  }
});

test("bare-horizon maps get a skyline outside the play area", () => {
  for (const id of ["cinder-flats", "kestrel-yard", "iron-crossing"]) {
    const res = run(id, "high");
    assert.ok(res.far > 4000, `${id}: far triangles ${res.far}`);
  }
  // All skyline geometry stays beyond rMin (minus the largest piece) of the centre.
  class Spy extends MeshBuilder {
    minR = Infinity;
    add(geo: THREE.BufferGeometry, matrix: THREE.Matrix4 | null, mat: WorldMat, tint: THREE.ColorRepresentation, opts: AddOptions = {}) {
      const p = geo.attributes.position as THREE.BufferAttribute;
      const v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        if (matrix) v.applyMatrix4(matrix);
        this.minR = Math.min(this.minR, Math.hypot(v.x, v.z));
      }
      super.add(geo, matrix, mat, tint, opts);
    }
  }
  const B = new Spy();
  const pieces = skyline(B, { height: () => 0, seed: 1, quality: "high", rMin: 200, rMax: 300, ridge: { r: 340, h: [10, 40], tint: 0x888888 }, stacks: 4, tanks: 3, silos: 2, waterTowers: 2, masts: 2, farms: 3, blocks: 4, trees: 40, pylons: { angle: 0.3, offset: 220 } });
  assert.ok(pieces > 10, `pieces ${pieces}`);
  assert.ok(B.minR > 160, `nearest skyline vertex ${B.minR.toFixed(1)} m from centre`);
  const low = new MeshBuilder();
  skyline(low, { height: () => 0, seed: 1, quality: "low", rMin: 200, rMax: 300, stacks: 4, tanks: 3, farms: 3, blocks: 4, trees: 40 });
  assert.ok(low.triangles() < B.triangles(), "skyline scales with quality");
});

test("grime never hangs across an opening", () => {
  const layer = new GrimeLayer("wet", "high");
  const f = new Frame(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0));
  const openings: Opening[] = [];
  for (let fl = 0; fl < 3; fl++) for (let c = 0; c < 4; c++) openings.push({ u: 1.5 + c * 3, y: fl * 3.1 + 0.9, w: 1.05, h: 1.4, arch: c === 2 });
  openings.push({ u: 6, y: 0, w: 1.1, h: 2.2 });
  const holes = holeRects(openings);
  // Record each quad through the public quad() API.
  const quads: { u0: number; u1: number; y0: number; y1: number; d: number }[] = [];
  const orig = layer.quad.bind(layer);
  layer.quad = (c, right, up, w, h, kind, alpha, tint, flip) => {
    quads.push({ u0: c.x - w / 2, u1: c.x + w / 2, y0: c.y - h / 2, y1: c.y + h / 2, d: -c.z });
    orig(c, right, up, w, h, kind, alpha, tint, flip);
  };
  for (let seed = 1; seed < 40; seed++) layer.facade(f, { length: 13, top: 10.2, seed, holes, cracks: openings });
  assert.ok(quads.length > 200, `quads ${quads.length}`);
  // Crack quads may touch their own window's lintel corner; everything else stays clear of holes.
  const shrink = 0.12;
  for (const q of quads) {
    for (const h of holes) {
      const overlap = Math.min(q.u1, h.u1) - Math.max(q.u0, h.u0) > shrink && Math.min(q.y1, h.y1) - Math.max(q.y0, h.y0) > shrink;
      assert.ok(!overlap, `quad u ${q.u0.toFixed(2)}..${q.u1.toFixed(2)} y ${q.y0.toFixed(2)}..${q.y1.toFixed(2)} crosses a hole at u ${h.u0.toFixed(2)}..${h.u1.toFixed(2)} y ${h.y0.toFixed(2)}..${h.y1.toFixed(2)}`);
    }
    assert.ok(q.d > 0.01 && q.d < 0.08, "quads sit just proud of the wall");
  }
  assert.ok(layer.extra(), "layer builds a mesh");
});

test("building() detail: glazed openings, grime via the attached layer, deterministic layout", () => {
  const build = (glazed: boolean) => {
    const B = new MeshBuilder();
    attachGrime(B, "high", "dry");
    const { props, placed } = fakeProps();
    building(B, props, { x: 0, z: 0, w: 14, d: 10, floors: 3, seed: 1234, damage: 0.3, glazed });
    const g = grimeOf(B)!.quads;
    const extras = finishGrime(B);
    for (const x of extras) x.dispose();
    return { tris: B.triangles(), grime: g, placed: placed.length, extras: extras.length };
  };
  const a = build(false), b = build(true);
  assert.ok(b.tris > a.tris, "glazing adds panes");
  assert.ok(a.grime > 20 && a.extras === 1, `grime quads ${a.grime}`);
  assert.equal(a.placed, build(false).placed, "same seed, same clutter");
  // No layer attached: nothing extra, no throw.
  const B = new MeshBuilder();
  building(B, null, { x: 0, z: 0, w: 8, d: 8, floors: 2, seed: 5 });
  assert.equal(finishGrime(B).length, 0);
});
