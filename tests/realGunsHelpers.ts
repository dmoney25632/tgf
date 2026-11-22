// Node-side helpers for the real gun tests: load a glTF from public/ without
// textures (no image decoding in node) and score how well a fitted model's
// side silhouette matches the built gun.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

// three's FileLoader reports progress with the DOM ProgressEvent.
const g = globalThis as { ProgressEvent?: unknown };
g.ProgressEvent ??= class extends Event {
  constructor(type: string, init: object = {}) {
    super(type);
    Object.assign(this, init);
  }
};

/** Loads `public/<path>` geometry-only (buffers inlined, images dropped). */
export async function loadGltfGeometry(root: string, path: string): Promise<THREE.Group> {
  const file = join(root, "public", path);
  const json = JSON.parse(readFileSync(file, "utf8"));
  for (const b of json.buffers ?? []) {
    if (b.uri && !b.uri.startsWith("data:")) b.uri = "data:application/octet-stream;base64," + readFileSync(join(dirname(file), decodeURIComponent(b.uri))).toString("base64");
  }
  delete json.images;
  delete json.textures;
  delete json.samplers;
  for (const m of json.materials ?? []) {
    for (const k of Object.keys(m)) if (k.endsWith("Texture")) delete m[k];
    if (m.pbrMetallicRoughness) for (const k of Object.keys(m.pbrMetallicRoughness)) if (k.endsWith("Texture")) delete m.pbrMetallicRoughness[k];
    delete m.extensions;
  }
  await MeshoptDecoder.ready;
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(JSON.stringify(json), "");
  gltf.scene.updateMatrixWorld(true);
  return gltf.scene;
}

/** Drawn vertex positions of every mesh under `root`, in `root`'s parent space. */
export function vertices(root: THREE.Object3D, into: THREE.Vector3[] = [], space: THREE.Object3D | null = root.parent) {
  root.updateMatrixWorld(true);
  space?.updateMatrixWorld(true);
  const inv = space ? space.matrixWorld.clone().invert() : new THREE.Matrix4();
  const m = new THREE.Matrix4();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !o.visible) return;
    m.multiplyMatrices(inv, mesh.matrixWorld);
    const pos = mesh.geometry.attributes.position;
    const idx = mesh.geometry.index;
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i += 3) into.push(new THREE.Vector3().fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(m));
  });
  return into;
}

/** Occupancy of the side (z, y) silhouette on a `cell` grid. */
export function silhouette(points: THREE.Vector3[], cell = 0.01) {
  const s = new Set<string>();
  for (const p of points) s.add(`${Math.round(p.z / cell)},${Math.round(p.y / cell)}`);
  return s;
}

/** Fraction of `a`'s cells that have a cell of `b` within one cell. */
export function overlap(a: Set<string>, b: Set<string>) {
  let hit = 0;
  for (const k of a) {
    const [z, y] = k.split(",").map(Number);
    let near = false;
    for (let dz = -1; dz <= 1 && !near; dz++) for (let dy = -1; dy <= 1 && !near; dy++) near = b.has(`${z + dz},${y + dy}`);
    if (near) hit++;
  }
  return a.size ? hit / a.size : 0;
}
