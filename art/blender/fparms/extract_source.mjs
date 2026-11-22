// One-off: freezes the Rocketbox-derived arms built by scripts/fparms/build.mjs
// (meshopt-packed public/assets/characters/fparms/fparms.gltf at commit 1c10e59)
// into a plain GLB the Blender pipeline can import: skinned mesh, skeleton,
// UVs. The skeleton in it is the runtime contract (bone names, rest pose),
// and assemble.mjs copies it verbatim into the rebuilt asset.
//
//   node art/blender/fparms/extract_source.mjs <fparms.gltf> art/blender/fparms/source/rocketbox_arms.glb
import fs from "node:fs";
import path from "node:path";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

globalThis.ProgressEvent ??= class extends Event { constructor(t, i = {}) { super(t); Object.assign(this, i); } };
globalThis.FileReader = class {
  readAsArrayBuffer(b) { b.arrayBuffer().then((r) => { this.result = r; this.onloadend?.({ target: this }); this.onload?.({ target: this }); }); }
};

const [src, out] = process.argv.slice(2);
const json = JSON.parse(fs.readFileSync(src, "utf8"));
for (const b of json.buffers) if (b.uri) b.uri = "data:application/octet-stream;base64," + fs.readFileSync(path.join(path.dirname(src), b.uri)).toString("base64");
delete json.images; delete json.textures; delete json.samplers;
for (const m of json.materials) { delete m.normalTexture; m.pbrMetallicRoughness = { metallicFactor: 0, roughnessFactor: 1 }; }
await MeshoptDecoder.ready;
const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(JSON.stringify(json), "");
const glb = await new Promise((res, rej) => new GLTFExporter().parse(gltf.scene, (r) => res(Buffer.from(r)), rej, { binary: true, onlyVisible: false }));
fs.writeFileSync(out, glb);
console.log(out, glb.length);
