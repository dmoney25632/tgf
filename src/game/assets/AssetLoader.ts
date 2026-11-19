import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import type { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { HDRI, MODELS, TEXTURE_SETS, assetUrl, textureUrl, type ModelId, type TextureMapKind } from "./manifest";

/**
 * Loads optional on-disk assets listed in the manifest. Everything resolves to
 * `null` on failure (never throws), and results are cached at module level so
 * remounting the engine doesn't refetch. GPU copies are owned by whoever
 * builds Textures/Meshes from them; `clearAssetCaches()` drops the CPU side.
 *
 * Delivery details handled here (not in the manifest):
 * - URLs are rewritten to /assets/v/<content hash>/... so they can be served
 *   with immutable caching (see next.config.ts).
 * - Texture sets prefer the `<kind>_512.jpg` variant when the preset caps
 *   textures at 512 px, falling back to the full file if it is missing.
 * - Images are decoded (and resized) off the main thread with
 *   createImageBitmap, already flipped for WebGL, so uploads don't stall.
 * - glTF files using EXT_meshopt_compression or KHR_texture_basisu get the
 *   matching decoder loaded on demand (see scripts/ktx2-encode.sh).
 */

/**
 * Decoded image. ImageBitmaps are pre-flipped (imageOrientation "flipY"), so
 * textures built from them must set `flipY = false` (see `isPreFlipped`).
 */
type Img = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

const imageCache = new Map<string, Promise<Img | null>>();
const modelCache = new Map<ModelId, Promise<PreparedModel | null>>();
let hdriCache: Promise<THREE.DataTexture | null> | null = null;
const warned = new Set<string>();

const ASSET_VERSION = process.env.NEXT_PUBLIC_ASSET_VERSION ?? "";

/** /assets/x → /assets/v/<hash>/x (immutable-cacheable). */
export function versionedUrl(url: string) {
  if (!ASSET_VERSION || !url.startsWith("/assets/")) return url;
  return `/assets/v/${ASSET_VERSION}/${url.slice("/assets/".length)}`;
}

/** True when the image is already flipped for WebGL (set texture.flipY = false). */
export function isPreFlipped(img: unknown) {
  return typeof ImageBitmap !== "undefined" && img instanceof ImageBitmap;
}

let assetRenderer: THREE.WebGLRenderer | null = null;
/** Lets loaders that need GPU capabilities (KTX2) query the renderer. */
export function setAssetRenderer(r: THREE.WebGLRenderer | null) {
  assetRenderer = r;
}

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

/** Fallback path: <img> element + canvas downscale on the main thread. */
function loadImageElement(url: string, maxSize: number): Promise<Img | null> {
  return new Promise<Img | null>((resolve) => {
    new THREE.ImageLoader().load(
      url,
      (img) => resolve(downscale(img, maxSize)),
      undefined,
      () => resolve(null),
    );
  });
}

const canBitmap = typeof createImageBitmap === "function" && typeof fetch === "function";

/** fetch + off-thread decode/resize. Null on HTTP error; throws if decode fails. */
async function loadBitmap(url: string, maxSize: number): Promise<Img | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const blob = await res.blob();
  const opts: ImageBitmapOptions = { imageOrientation: "flipY", premultiplyAlpha: "none", colorSpaceConversion: "none" };
  const full = await createImageBitmap(blob, opts);
  if (full.width <= maxSize && full.height <= maxSize) return full;
  const s = maxSize / Math.max(full.width, full.height);
  const w = Math.max(1, Math.round(full.width * s));
  const h = Math.max(1, Math.round(full.height * s));
  full.close();
  return createImageBitmap(blob, { ...opts, resizeWidth: w, resizeHeight: h, resizeQuality: "high" });
}

async function fetchImage(url: string, maxSize: number): Promise<Img | null> {
  if (canBitmap) {
    try {
      return await loadBitmap(url, maxSize);
    } catch {
      // Older Safari/Firefox reject some ImageBitmap options: use <img>.
    }
  }
  return loadImageElement(url, maxSize);
}

function loadImage(url: string, maxSize: number, smallUrl?: string): Promise<Img | null> {
  const key = `${url}@${maxSize}`;
  let p = imageCache.get(key);
  if (!p) {
    p = (async () => {
      const small = smallUrl ? await fetchImage(versionedUrl(smallUrl), maxSize) : null;
      const img = small ?? (await fetchImage(versionedUrl(url), maxSize));
      if (!img) warnOnce(url);
      return img;
    })();
    imageCache.set(key, p);
  }
  return p;
}

/** Edge size of the pre-scaled texture-set variants written by scripts/optimize-assets.sh. */
const SMALL_VARIANT = 512;

export type TextureSetImages = Partial<Record<TextureMapKind, Img>>;

/** Loads every map the manifest lists for a set (null if the set isn't listed or albedo fails). */
export async function loadTextureSet(id: string, maxSize: number): Promise<TextureSetImages | null> {
  const entry = TEXTURE_SETS[id];
  if (!entry || typeof window === "undefined") return null;
  const imgs = await Promise.all(
    entry.maps.map((k) => {
      const url = textureUrl(id, k);
      const small = maxSize <= SMALL_VARIANT ? url.replace(/\.jpg$/, `_${SMALL_VARIANT}.jpg`) : undefined;
      return loadImage(url, maxSize, small);
    }),
  );
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
    const url = versionedUrl(assetUrl(HDRI.file));
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
    // Transmission makes three.js re-render every opaque object into an extra
    // target each frame (doubling draw calls). Cheap alpha glass instead.
    const phys = mesh.material as THREE.MeshPhysicalMaterial;
    if (phys.isMeshPhysicalMaterial && phys.transmission > 0) {
      phys.transmission = 0;
      phys.transparent = true;
      phys.opacity = 0.35;
      phys.depthWrite = false;
    }
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

type MeshoptDecoderLike = Parameters<GLTFLoader["setMeshoptDecoder"]>[0];
let meshopt: Promise<MeshoptDecoderLike> | null = null;
let ktx2: Promise<KTX2Loader> | null = null;

/** Where the Basis transcoder is served from (copied there by scripts/ktx2-encode.sh). */
const BASIS_PATH = "/assets/basis/";

/**
 * Loads a glTF, pulling in the meshopt / KTX2 decoders only when the file
 * declares those extensions, so plain assets never pay for them.
 */
async function loadGltf(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const loader = new GLTFLoader();
  if (text.includes("EXT_meshopt_compression")) {
    meshopt ??= import("three/addons/libs/meshopt_decoder.module.js").then(async ({ MeshoptDecoder }) => {
      await MeshoptDecoder.ready;
      return MeshoptDecoder as MeshoptDecoderLike;
    });
    loader.setMeshoptDecoder(await meshopt);
  }
  if (text.includes("KHR_texture_basisu")) {
    ktx2 ??= import("three/addons/loaders/KTX2Loader.js").then(({ KTX2Loader }) => {
      const l = new KTX2Loader().setTranscoderPath(versionedUrl(BASIS_PATH));
      if (assetRenderer) l.detectSupport(assetRenderer);
      return l;
    });
    loader.setKTX2Loader(await ktx2);
  }
  return loader.parseAsync(text, THREE.LoaderUtils.extractUrlBase(url));
}

/** Loads + prepares a manifest model (baked transforms, merged per material). */
export function loadModel(id: ModelId): Promise<PreparedModel | null> {
  const entry = MODELS[id];
  if (!entry || typeof window === "undefined") return Promise.resolve(null);
  let p = modelCache.get(id);
  if (!p) {
    const url = versionedUrl(assetUrl(entry.file));
    p = loadGltf(url)
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
