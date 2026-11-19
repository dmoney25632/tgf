import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { HDRI, MODELS, TEXTURE_SETS, assetUrl, textureUrl, type ModelId, type TextureMapKind } from "./manifest";

/**
 * Loads optional on-disk assets listed in the manifest. Everything resolves to
 * `null` on failure (never throws), and results are cached at module level so
 * remounting the engine doesn't refetch. GPU copies are owned by whoever
 * builds Textures/Meshes from them; `clearAssetCaches()` drops the CPU side.
 */

type Img = HTMLImageElement | HTMLCanvasElement;

const imageCache = new Map<string, Promise<Img | null>>();
const modelCache = new Map<ModelId, Promise<PreparedModel | null>>();
let hdriCache: Promise<THREE.DataTexture | null> | null = null;
const warned = new Set<string>();

function warnOnce(key: string, err?: unknown) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[assets] ${key} unavailable, using procedural fallback`, err ?? "");
}

function downscale(img: HTMLImageElement, max: number): Img {
  if (img.width <= max && img.height <= max) return img;
  const s = max / Math.max(img.width, img.height);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.width * s));
  c.height = Math.max(1, Math.round(img.height * s));
  const ctx = c.getContext("2d");
  if (!ctx) return img;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

function loadImage(url: string, maxSize: number): Promise<Img | null> {
  const key = `${url}@${maxSize}`;
  let p = imageCache.get(key);
  if (!p) {
    p = new Promise<Img | null>((resolve) => {
      new THREE.ImageLoader().load(
        url,
        (img) => resolve(downscale(img, maxSize)),
        undefined,
        (err) => {
          warnOnce(url, err);
          resolve(null);
        },
      );
    });
    imageCache.set(key, p);
  }
  return p;
}

export type TextureSetImages = Partial<Record<TextureMapKind, Img>>;

/** Loads every map the manifest lists for a set (null if the set isn't listed or albedo fails). */
export async function loadTextureSet(id: string, maxSize: number): Promise<TextureSetImages | null> {
  const entry = TEXTURE_SETS[id];
  if (!entry || typeof window === "undefined") return null;
  const imgs = await Promise.all(entry.maps.map((k) => loadImage(textureUrl(id, k), maxSize)));
  const out: TextureSetImages = {};
  entry.maps.forEach((k, i) => {
    const img = imgs[i];
    if (img) out[k] = img;
  });
  return out.albedo ? out : null;
}

/** Equirectangular HDR sky, or null when not listed / failed. */
export function loadHdri(): Promise<THREE.DataTexture | null> {
  if (!HDRI || typeof window === "undefined") return Promise.resolve(null);
  if (!hdriCache) {
    const url = assetUrl(HDRI.file);
    hdriCache = new HDRLoader()
      .loadAsync(url)
      .then((tex) => {
        tex.mapping = THREE.EquirectangularReflectionMapping;
        return tex;
      })
      .catch((err) => {
        warnOnce(url, err);
        return null;
      });
  }
  return hdriCache;
}

export type ModelPart = { geometry: THREE.BufferGeometry; material: THREE.Material };
export type ModelVariant = { parts: ModelPart[]; bounds: THREE.Box3 };
export type PreparedModel = { id: ModelId; variants: ModelVariant[] };

const KEEP = ["position", "normal", "uv"];

/** Bakes meshes under `root` (relative to `root`) into one geometry per material. */
function bake(root: THREE.Object3D): ModelVariant | null {
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const m = new THREE.Matrix4();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const g = mesh.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (!KEEP.includes(name)) g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    g.applyMatrix4(m.multiplyMatrices(inv, mesh.matrixWorld));
    const list = groups.get(mesh.material) ?? [];
    list.push(g);
    groups.set(mesh.material, list);
  });
  const parts: ModelPart[] = [];
  const bounds = new THREE.Box3();
  for (const [material, geos] of groups) {
    const allIndexed = geos.every((g) => g.index);
    const src = allIndexed ? geos : geos.map((g) => (g.index ? g.toNonIndexed() : g));
    const merged = src.length === 1 ? src[0] : mergeGeometries(src, false);
    if (!merged) continue;
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    bounds.union(merged.boundingBox!);
    parts.push({ geometry: merged, material });
  }
  return parts.length ? { parts, bounds } : null;
}

/** Loads + prepares a manifest model (baked transforms, merged per material). */
export function loadModel(id: ModelId): Promise<PreparedModel | null> {
  const entry = MODELS[id];
  if (!entry || typeof window === "undefined") return Promise.resolve(null);
  let p = modelCache.get(id);
  if (!p) {
    const url = assetUrl(entry.file);
    p = new GLTFLoader()
      .loadAsync(url)
      .then((gltf) => {
        const scene = gltf.scene;
        scene.updateMatrixWorld(true);
        const variants: ModelVariant[] = [];
        if (entry.variants === "nodes") {
          for (const child of scene.children) {
            const v = bake(child);
            if (v) variants.push(v);
          }
        } else {
          const v = bake(scene);
          if (v) variants.push(v);
        }
        return variants.length ? { id, variants } : null;
      })
      .catch((err) => {
        warnOnce(url, err);
        return null;
      });
    modelCache.set(id, p);
  }
  return p;
}

/** Frees GPU copies of a prepared model (the CPU data stays cached). */
export function releaseModel(m: PreparedModel) {
  for (const v of m.variants) {
    for (const part of v.parts) {
      part.geometry.dispose();
      const mat = part.material as THREE.MeshStandardMaterial;
      for (const t of [mat.map, mat.normalMap, mat.roughnessMap, mat.metalnessMap, mat.aoMap, mat.alphaMap]) t?.dispose();
      mat.dispose();
    }
  }
}

/** Drops all cached asset data (call after disposing every map that used it). */
export function clearAssetCaches() {
  imageCache.clear();
  for (const p of modelCache.values()) void p.then((m) => m && releaseModel(m));
  modelCache.clear();
  if (hdriCache) void hdriCache.then((t) => t?.dispose());
  hdriCache = null;
}
