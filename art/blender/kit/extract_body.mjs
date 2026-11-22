// Dumps Rocketbox soldier parts (bind pose, metres, three.js axes) to OBJ +
// joint positions, so the Blender kit build can fit and preview against the
// real bodies. Node only; reads the meshopt-packed shipped glTFs.
//   node art/blender/kit/extract_body.mjs <outdir> a d g
import fs from "node:fs";
import path from "node:path";
const NM = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../node_modules");
globalThis.self = globalThis;
globalThis.ProgressEvent ??= class extends Event { constructor(t, i = {}) { super(t); Object.assign(this, i); } };
const THREE = await import(NM + "/three/build/three.module.js");
const { GLTFLoader } = await import(NM + "/three/examples/jsm/loaders/GLTFLoader.js");
const { MeshoptDecoder } = await import(NM + "/three/examples/jsm/libs/meshopt_decoder.module.js");

const [out, ...ids] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../public/assets/characters/soldiers");
await MeshoptDecoder.ready;
for (const id of ids) {
  const file = path.join(DIR, `soldier_${id}.gltf`);
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const b of json.buffers) if (b.uri) b.uri = "data:application/octet-stream;base64," + fs.readFileSync(path.join(DIR, b.uri)).toString("base64");
  delete json.images; delete json.textures; delete json.samplers;
  for (const m of json.materials ?? []) { for (const k of Object.keys(m)) if (k.endsWith("Texture")) delete m[k]; if (m.pbrMetallicRoughness) for (const k of Object.keys(m.pbrMetallicRoughness)) if (k.endsWith("Texture")) delete m.pbrMetallicRoughness[k]; delete m.extensions; }
  const extUsed = (json.extensionsUsed ?? []).filter((e) => e !== "KHR_texture_basisu");
  json.extensionsUsed = extUsed;
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(JSON.stringify(json), "");
  gltf.scene.updateMatrixWorld(true);
  const joints = {};
  let lines = [], vbase = 1;
  gltf.scene.traverse((o) => {
    if (!o.isSkinnedMesh || /_lod1$/.test(o.name)) return;
    const sk = o.skeleton;
    sk.bones.forEach((b, i) => { const m = sk.boneInverses[i].clone().invert(); const p = new THREE.Vector3().setFromMatrixPosition(m); joints[b.name] = [p.x, p.y, p.z].map((v) => +v.toFixed(4)); });
    const g = o.geometry;
    const P = g.getAttribute("position"), UV = g.getAttribute("uv"), N = g.getAttribute("normal");
    const bm = o.bindMatrix;
    lines.push(`o ${o.name}`);
    const v = new THREE.Vector3();
    for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(bm); lines.push(`v ${v.x.toFixed(5)} ${v.y.toFixed(5)} ${v.z.toFixed(5)}`); }
    for (let i = 0; i < P.count; i++) lines.push(`vt ${UV.getX(i).toFixed(5)} ${(1 - UV.getY(i)).toFixed(5)}`);
    const nm = new THREE.Matrix3().getNormalMatrix(bm);
    for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); lines.push(`vn ${v.x.toFixed(4)} ${v.y.toFixed(4)} ${v.z.toFixed(4)}`); }
    const idx = g.index;
    for (let i = 0; i < idx.count; i += 3) { const a = idx.getX(i) + vbase, b = idx.getX(i + 1) + vbase, c = idx.getX(i + 2) + vbase; lines.push(`f ${a}/${a}/${a} ${b}/${b}/${b} ${c}/${c}/${c}`); }
    vbase += P.count;
  });
  fs.writeFileSync(path.join(out, `soldier_${id}.obj`), lines.join("\n"));
  fs.writeFileSync(path.join(out, `soldier_${id}_joints.json`), JSON.stringify(joints, null, 1));
  console.log(id, Object.keys(joints).length, "joints", vbase - 1, "verts");
}
