import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import type { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { HDRI, MODELS, TEXTURE_SETS, assetUrl, textureKtx2Url, textureUrl, type ModelId, type TextureMapKind } from "./manifest";

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
 * - GPU-compressed textures (KTX2 / Basis Universal, scripts/encode-ktx2.mjs)
 *   are used only when the GPU has a compressed format (ASTC, BC7, ETC2 or
 *   sRGB-capable S3TC); otherwise, or when transcoding fails, the JPEGs are.
 *   Texture sets: `loadCompressedTextureSet`; glTF: KHR_texture_basisu with
 *   the JPEG kept as the core source.
 * - glTF files using EXT_meshopt_compression or KHR_texture_basisu get the
 *   matching decoder loaded on demand.
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
/**
 * Lets loaders that need GPU capabilities (KTX2) query the renderer.
 * Optional: without it the formats are probed on a throwaway WebGL2 context.
 */
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
/** Edge size of the full texture-set maps (and of their .ktx2 copies). */
const FULL_VARIANT = 1024;

/** Where the Basis transcoder is served from (copied there by scripts/encode-ktx2.mjs). */
const BASIS_PATH = "/assets/basis/";

/** The part of WebGLExtensions that KTX2Loader.detectSupport reads. */
export type GlExtensions = { has(name: string): boolean; get(name: string): unknown };

const S3TC = "WEBGL_compressed_texture_s3tc";
const S3TC_SRGB = "WEBGL_compressed_texture_s3tc_srgb";
const ASTC = "WEBGL_compressed_texture_astc";
const BPTC = "EXT_texture_compression_bptc";
const ETC2 = "WEBGL_compressed_texture_etc";
const COMPRESSED_EXTENSIONS = [
  ASTC,
  BPTC,
  ETC2,
  "WEBGL_compressed_texture_etc1",
  S3TC,
  S3TC_SRGB,
  "WEBGL_compressed_texture_pvrtc",
  "WEBKIT_WEBGL_compressed_texture_pvrtc",
];

/** Compressed-format extensions of a throwaway WebGL2 context (same GPU and browser as the game's). */
function probeExtensions(): GlExtensions | null {
  if (typeof document === "undefined") return null;
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) return null;
    const supported = new Set(gl.getSupportedExtensions() ?? []);
    const found = new Set(COMPRESSED_EXTENSIONS.filter((n) => supported.has(n)));
    const astc = found.has(ASTC) ? (gl.getExtension(ASTC) as { getSupportedProfiles(): string[] } | null) : null;
    const profiles = astc?.getSupportedProfiles() ?? [];
    (gl.getExtension("WEBGL_lose_context") as { loseContext(): void } | null)?.loseContext();
    return { has: (n) => found.has(n), get: (n) => (n === ASTC ? { getSupportedProfiles: () => profiles } : null) };
  } catch {
    return null;
  }
}

/**
 * The extensions KTX2Loader may pick from, or null when transcoding could
 * only produce uncompressed RGBA (no VRAM gain: the JPEGs are used instead).
 * S3TC counts only with its sRGB variant, which sRGB albedo maps need.
 */
export function compressedSupport(ext: GlExtensions | null): GlExtensions | null {
  if (!ext) return null;
  const dxt = ext.has(S3TC) && ext.has(S3TC_SRGB);
  if (!ext.has(ASTC) && !ext.has(BPTC) && !ext.has(ETC2) && !dxt) return null;
  return { has: (n) => (n === S3TC ? dxt : ext.has(n)), get: (n) => ext.get(n) };
}

let ktx2: Promise<KTX2Loader | null> | null = null;

/** Shared KTX2Loader (one transcoder worker pool), or null when compressed textures aren't usable here. */
function ktx2Loader(): Promise<KTX2Loader | null> {
  ktx2 ??= (async () => {
    const ext = compressedSupport(assetRenderer ? assetRenderer.extensions : probeExtensions());
    if (!ext) return null;
    const { KTX2Loader } = await import("three/addons/loaders/KTX2Loader.js");
    const l = new KTX2Loader().setTranscoderPath(versionedUrl(BASIS_PATH));
    // detectSupport only reads `extensions` of a WebGLRenderer.
    l.detectSupport({ extensions: ext } as unknown as THREE.WebGLRenderer);
    return l;
  })().catch((err) => {
    warnOnce("KTX2 transcoder", err);
    return null;
  });
  return ktx2;
}

const ktxCache = new Map<string, Promise<THREE.CompressedTexture | null>>();

function loadKtx2(loader: KTX2Loader, url: string): Promise<THREE.CompressedTexture | null> {
  let p = ktxCache.get(url);
  if (!p) {
    p = loader
      .loadAsync(versionedUrl(url))
      .then((t) => ((t as THREE.CompressedTexture).isCompressedTexture ? (t as THREE.CompressedTexture) : null))
      .catch(() => null);
    ktxCache.set(url, p);
  }
  return p;
}

/**
 * Which .ktx2 copy suits a preset's texture cap: the 512 px one at exactly
 * 512, the full one at 1024 or more, none (JPEGs, resized on decode) for
 * other caps, since compressed mips can't be resized at load.
 */
export function ktx2Variant(maxSize: number): "small" | "full" | null {
  if (maxSize === SMALL_VARIANT) return "small";
  return maxSize >= FULL_VARIANT ? "full" : null;
}

export type CompressedTextureSet = Partial<Record<TextureMapKind, THREE.CompressedTexture>>;

/**
 * GPU-compressed maps of a set, transcoded off-thread to ASTC / BC7 / ETC2 /
 * BC1-3. Null when the set has no KTX2 copies, the GPU has no compressed
 * format or any map fails: callers then use `loadTextureSet` (JPEGs).
 * Results are cached templates: clone them (clones share one GPU upload
 * through their common source).
 */
export async function loadCompressedTextureSet(id: string, maxSize: number): Promise<CompressedTextureSet | null> {
  const entry = TEXTURE_SETS[id];
  const variant = ktx2Variant(maxSize);
  if (!entry?.ktx2 || !variant || typeof window === "undefined") return null;
  const loader = await ktx2Loader();
  if (!loader) return null;
  const texs = await Promise.all(entry.maps.map((k) => loadKtx2(loader, textureKtx2Url(id, k, variant === "small"))));
  if (texs.some((t) => !t)) {
    warnOnce(`ktx2:${id}`);
    return null;
  }
  const out: CompressedTextureSet = {};
  entry.maps.forEach((k, i) => (out[k] = texs[i]!));
  return out;
}

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

/**
 * Float32 copy of a quantized attribute (KHR_mesh_quantization: int8/int16,
 * maybe normalized or interleaved, as gltfpack writes). Baking applies node
 * matrices to the vertices, which would overflow the integer range, and
 * mergeGeometries needs matching array types.
 */
export function dequantize(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute {
  if (!(attr as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute && attr.array instanceof Float32Array) {
    return attr as THREE.BufferAttribute;
  }
  const n = attr.count;
  const size = attr.itemSize;
  const out = new Float32Array(n * size);
  for (let i = 0; i < n; i++) for (let c = 0; c < size; c++) out[i * size + c] = attr.getComponent(i, c);
  return new THREE.BufferAttribute(out, size);
}

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
    for (const name of Object.keys(g.attributes)) {
      if (!KEEP.includes(name)) g.deleteAttribute(name);
      else g.setAttribute(name, dequantize(g.getAttribute(name)));
    }
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
    // Without a KTX2Loader, GLTFLoader uses each texture's JPEG `source`
    // (scripts/encode-ktx2.mjs never marks the extension as required).
    const ktx = await ktx2Loader();
    if (ktx) loader.setKTX2Loader(ktx);
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
  for (const p of ktxCache.values()) void p.then((t) => t?.dispose());
  ktxCache.clear();
  for (const p of modelCache.values()) void p.then((m) => m && releaseModel(m));
  modelCache.clear();
  if (hdriCache) void hdriCache.then((t) => t?.dispose());
  hdriCache = null;
}

const sceneCache = new Map<string, Promise<THREE.Group | null>>();

/**
 * Loads a glTF scene as-is (materials and textures kept), cached by URL.
 * Callers clone the result. Used for the first-person gun models in
 * /assets/weapons (see public/assets/CREDITS.md).
 */
export function loadScene(path: string): Promise<THREE.Group | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  let p = sceneCache.get(path);
  if (!p) {
    const url = versionedUrl(path);
    p = loadGltf(url)
      .then((gltf) => {
        gltf.scene.updateMatrixWorld(true);
        return gltf.scene;
      })
      .catch((err) => {
        warnOnce(url, err);
        return null;
      });
    sceneCache.set(path, p);
  }
  return p;
}
