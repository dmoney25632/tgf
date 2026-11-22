// Writes the kit geometry gear.ts builds for an identity to an OBJ (bind
// pose, three.js axes), for the Blender before / after renders
// (render_kit.py). Vertex colours carry the palette paint x bake; one
// material group per (surface, roughness, metalness).
//
//   node --experimental-transform-types --no-warnings --import ./tests/register.mjs \
//     art/blender/kit/dump_gear.ts <out.obj> <kit.gltf | procedural> <joints.json> '<identity overrides json>'
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { setSoldierKit, soldierGear } from "../../../src/game/ai/soldier/gear";
import { npcIdentity, type SoldierIdentity } from "../../../src/game/ai/soldier/identity";

const g = globalThis as { ProgressEvent?: unknown };
g.ProgressEvent ??= class extends Event {
  constructor(type: string, init: object = {}) {
    super(type);
    Object.assign(this, init);
  }
};

const [out, kit, jointsFile, over] = process.argv.slice(2);
if (kit !== "procedural") {
  const json = JSON.parse(readFileSync(kit, "utf8"));
  for (const b of json.buffers ?? []) if (b.uri && !b.uri.startsWith("data:")) b.uri = "data:application/octet-stream;base64," + readFileSync(join(dirname(kit), b.uri)).toString("base64");
  await MeshoptDecoder.ready;
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(JSON.stringify(json), "");
  if (!setSoldierKit(gltf.scene)) throw new Error("kit incomplete");
}
const jointPos = JSON.parse(readFileSync(jointsFile, "utf8")) as Record<string, [number, number, number]>;
const joints = Object.keys(jointPos);
const id: SoldierIdentity = { ...npcIdentity(0, "standard"), ...JSON.parse(over || "{}") };
const pal = { uniform: 0x5b6148, vest: 0x4b4a38, helmet: 0x55553f, accent: 0xc0392b };
const female = id.body === "g" || id.body === "h";
const gear = soldierGear(id, pal, female, joints, (n) => new THREE.Vector3(...(jointPos[n] ?? [0, 0, 0])));

const toS = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const lines: string[] = [];
let base = 1;
let tris = 0;
const emit = (geo: THREE.BufferGeometry | null, name: string, fixed?: string) => {
  if (!geo) return;
  const P = geo.getAttribute("position"), C = geo.getAttribute("color"), M = geo.getAttribute("aMat"), N = geo.getAttribute("normal");
  lines.push(`o ${name}`);
  for (let i = 0; i < P.count; i++) {
    const c = C ? [toS(C.getX(i)), toS(C.getY(i)), toS(C.getZ(i))] : [0.8, 0.8, 0.8];
    lines.push(`v ${P.getX(i).toFixed(5)} ${P.getY(i).toFixed(5)} ${P.getZ(i).toFixed(5)} ${c.map((x) => Math.min(1, Math.max(0, x)).toFixed(4)).join(" ")}`);
  }
  for (let i = 0; i < P.count; i++) lines.push(`vn ${N.getX(i).toFixed(4)} ${N.getY(i).toFixed(4)} ${N.getZ(i).toFixed(4)}`);
  const idx = geo.index!;
  const groups = new Map<string, number[]>();
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i);
    const k = fixed ?? (M ? `s${Math.round(M.getX(a))}_r${M.getY(a).toFixed(2)}_m${M.getZ(a).toFixed(2)}` : "s0_r0.80_m0.00");
    let l = groups.get(k);
    if (!l) groups.set(k, (l = []));
    l.push(a, idx.getX(i + 1), idx.getX(i + 2));
  }
  for (const [k, l] of groups) {
    lines.push(`usemtl ${k}`);
    for (let i = 0; i < l.length; i += 3) lines.push(`f ${l[i] + base}//${l[i] + base} ${l[i + 1] + base}//${l[i + 1] + base} ${l[i + 2] + base}//${l[i + 2] + base}`);
  }
  tris += idx.count / 3;
  base += P.count;
};
emit(gear.kit[0], "kit");
emit(gear.lens?.geo ?? null, "lens", gear.lens?.kind === "dark" ? "lensdark_r0.05_m0.60" : "lensclear_r0.05_m0.10");
emit(gear.ghillie, "ghillie", "s9_r1.00_m0.00");
writeFileSync(out, lines.join("\n"));
console.log(JSON.stringify({ out, near: gear.kit[0] ? gear.kit[0].index!.count / 3 : 0, mid: gear.kit[1] ? gear.kit[1].index!.count / 3 : 0, total: tris }));
