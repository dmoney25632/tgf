// Turns the Blender build (build_fparms.py: arms.json/.bin + PNG textures)
// into the game asset, keeping the skeleton of source/rocketbox_arms.glb
// verbatim (bone names, hierarchy, rest pose, inverse bind matrices): that
// skeleton is the contract with src/game/weapons/viewmodel/arms/rig.ts.
//
//   node art/blender/fparms/assemble.mjs <work dir> <out dir>
//
// Writes <out dir>/fparms.gltf + fparms.bin + fparms_{color,normal,orm}.jpg
// and <work dir>/preview.glb (same skinned mesh, for render.py).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

globalThis.ProgressEvent ??= class extends Event { constructor(t, i = {}) { super(t); Object.assign(this, i); } };
globalThis.FileReader = class {
  readAsArrayBuffer(b) { b.arrayBuffer().then((r) => { this.result = r; this.onloadend?.({ target: this }); this.onload?.({ target: this }); }); }
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [WORK, OUT] = process.argv.slice(2);
if (!WORK || !OUT) throw new Error("usage: assemble.mjs <work dir> <out dir>");
fs.mkdirSync(OUT, { recursive: true });

const srcGlb = fs.readFileSync(path.join(HERE, "source", "rocketbox_arms.glb"));
const gltf = await new GLTFLoader().parseAsync(srcGlb.buffer.slice(srcGlb.byteOffset, srcGlb.byteOffset + srcGlb.byteLength), "");
let mesh = null;
gltf.scene.traverse((o) => { if (o.isSkinnedMesh && !mesh) mesh = o; });
const bones = mesh.skeleton.bones;

const meta = JSON.parse(fs.readFileSync(path.join(WORK, "arms.json"), "utf8"));
const bin = fs.readFileSync(path.join(WORK, "arms.bin"));
const arr = (k, Ctor) => {
  const a = meta.arrays[k];
  return new Ctor(bin.buffer.slice(bin.byteOffset + a.offset, bin.byteOffset + a.offset + a.length));
};
// Joint index (Blender export) -> skeleton bone index (by name).
const map = meta.joints.map((n) => {
  const i = bones.findIndex((b) => b.name === n);
  if (i < 0) throw new Error(`bone ${n} missing from the source skeleton`);
  return i;
});
const joints = arr("joints", Uint16Array).map((j) => map[j]);
const geo = new THREE.BufferGeometry();
geo.setAttribute("position", new THREE.BufferAttribute(arr("position", Float32Array), 3));
geo.setAttribute("normal", new THREE.BufferAttribute(arr("normal", Float32Array), 3));
geo.setAttribute("uv", new THREE.BufferAttribute(arr("uv", Float32Array), 2));
geo.setAttribute("skinIndex", new THREE.BufferAttribute(joints, 4));
geo.setAttribute("skinWeight", new THREE.BufferAttribute(arr("weights", Float32Array), 4));
const index = arr("index", Uint32Array);
geo.setIndex(new THREE.BufferAttribute(geo.attributes.position.count < 65536 ? Uint16Array.from(index) : index, 1));
geo.computeBoundingBox();
geo.computeBoundingSphere();
const old = mesh.geometry;
mesh.geometry = geo;
old.dispose();
mesh.material = new THREE.MeshStandardMaterial({ name: "fparms", roughness: 1, metalness: 0 });
mesh.name = "arms";
console.log("triangles", index.length / 3, "vertices", geo.attributes.position.count, "bones", bones.length);

const glb = await new Promise((res, rej) => new GLTFExporter().parse(gltf.scene, (r) => res(Buffer.from(r)), rej, { binary: true, onlyVisible: false }));
fs.writeFileSync(path.join(WORK, "preview.glb"), glb);

// GLB -> .gltf + .bin with external JPEG textures (what scripts/encode-ktx2.mjs packs).
const jsonLen = glb.readUInt32LE(12);
const json = JSON.parse(glb.subarray(20, 20 + jsonLen).toString("utf8"));
const binStart = 20 + jsonLen;
const binLen = glb.readUInt32LE(binStart);
fs.writeFileSync(path.join(OUT, "fparms.bin"), glb.subarray(binStart + 8, binStart + 8 + binLen));
json.buffers = [{ uri: "fparms.bin", byteLength: binLen }];
json.images = [{ uri: "fparms_color.jpg", mimeType: "image/jpeg" }, { uri: "fparms_normal.jpg", mimeType: "image/jpeg" }, { uri: "fparms_orm.jpg", mimeType: "image/jpeg" }];
json.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }];
json.textures = [0, 1, 2].map((i) => ({ sampler: 0, source: i }));
const m = json.materials[0];
m.pbrMetallicRoughness = { baseColorTexture: { index: 0 }, metallicFactor: 1, roughnessFactor: 1, metallicRoughnessTexture: { index: 2 } };
m.normalTexture = { index: 1 };
json.asset.extras = {
  source: "Microsoft Rocketbox Military_Male_01 (MIT), rebuilt in Blender (art/blender/fparms)",
  tintMid: 0.25,
  regionMask: "ORM red: 0 sleeve (tint 1), 1 glove (tint 0), 0.5 untinted (skin, watch)",
};
fs.writeFileSync(path.join(OUT, "fparms.gltf"), JSON.stringify(json));

for (const [name, q] of [["fparms_color", 90], ["fparms_normal", 94], ["fparms_orm", 92]]) {
  execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", String(q), path.join(WORK, `${name}.png`), "--out", path.join(OUT, `${name}.jpg`)], { stdio: "ignore" });
}
console.log("wrote", OUT);
