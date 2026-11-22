#!/usr/bin/env node
// GPU-compressed delivery: KTX2 (Basis Universal) textures + meshopt geometry,
// using only npm packages (WASM encoders, no system tools):
//   - ktx2-encoder (Basis Universal encoder, WASM) + jpeg-js (JPEG decode)
//   - gltfpack (meshoptimizer, WASM build; its npm build can't write KTX2,
//     so textures are encoded here and attached with KHR_texture_basisu)
//
//   npm run assets:ktx2                 # dry run: lists what would change
//   npm run assets:ktx2 -- --write      # encode
//   npm run assets:ktx2 -- --write --force   # re-encode existing .ktx2 too
//
// What --write does:
//   1. Copies three's Basis transcoder to public/assets/basis/ (AssetLoader
//      points KTX2Loader there, through versionedUrl).
//   2. Texture sets: public/assets/textures/<id>/<kind>[_512].jpg ->
//      <kind>[_512].ktx2 next to it. Normal maps: UASTC + RDO + Zstandard
//      (block artefacts in normals show in highlights); albedo: ETC1S sRGB;
//      roughness / AO: ETC1S linear. Mipmaps are baked in. Encoded Y-flipped,
//      so a KTX2 texture (always flipY = false) samples like the JPEG with
//      flipY = true. The JPEGs stay as the fallback (no compressed-texture
//      support, KTX2 failure, other presets).
//   3. glTF (public/assets/models/<id>/<id>_1k.gltf, public/assets/weapons/<id>/model.gltf):
//      gltfpack -cc (meshopt) in place, file names kept so manifests stay
//      valid; models are quantized (AssetLoader dequantizes when baking),
//      weapons are not (-noq: realGuns.ts edits vertices in mesh space).
//      Each texture then gets a .ktx2 sibling of its JPEG and a
//      KHR_texture_basisu source; the JPEG stays as the core `source`, so the
//      extension is "used" but not "required" and GLTFLoader falls back to
//      it when no KTX2Loader is set (devices without compressed formats).
//
// Idempotent: existing .ktx2 files are kept (unless --force) and glTFs that
// already use EXT_meshopt_compression are not re-packed.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeToKTX2 } from "ktx2-encoder";
import jpeg from "jpeg-js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = join(ROOT, "public", "assets");
const args = new Set(process.argv.slice(2));
const WRITE = args.has("--write");
const FORCE = args.has("--force");

const rel = (p) => relative(ROOT, p);
const kb = (n) => `${Math.round(n / 1024)} kB`;
const size = (p) => (existsSync(p) ? statSync(p).size : 0);
const totals = { jpg: 0, ktx2: 0, binBefore: 0, binAfter: 0, files: 0 };

async function decodeImage(buf) {
  const head = buf.subarray(0, 4);
  if (head[0] !== 0xff || head[1] !== 0xd8) throw new Error("only JPEG sources are supported");
  const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });
  return { width: img.width, height: img.height, data: img.data };
}

/** Decode, then halve with a 2x2 box filter until the longest edge is <= max. */
const decodeAtMost = (max) => async (buf) => {
  let img = await decodeImage(buf);
  while (Math.max(img.width, img.height) > max) {
    const w = Math.max(1, img.width >> 1);
    const h = Math.max(1, img.height >> 1);
    const out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (let c = 0; c < 4; c++) {
          const at = (yy, xx) => img.data[(Math.min(yy, img.height - 1) * img.width + Math.min(xx, img.width - 1)) * 4 + c];
          out[(y * w + x) * 4 + c] = (at(2 * y, 2 * x) + at(2 * y, 2 * x + 1) + at(2 * y + 1, 2 * x) + at(2 * y + 1, 2 * x + 1) + 2) >> 2;
        }
      }
    }
    img = { width: w, height: h, data: out };
  }
  return img;
};

/** Encoder settings per texture role. */
function options(role, flipY, maxSize) {
  const imageDecoder = maxSize ? decodeAtMost(maxSize) : decodeImage;
  const common = { isKTX2File: true, generateMipmap: true, isYFlip: flipY, imageDecoder };
  if (role === "normal") {
    return {
      ...common,
      isUASTC: true,
      uastcLDRQualityLevel: 2,
      enableRDO: true,
      rdoQualityLevel: 1,
      needSupercompression: true,
      isNormalMap: true,
      isPerceptual: false,
      isSetKTX2SRGBTransferFunc: false,
    };
  }
  const srgb = role === "color";
  return {
    ...common,
    isUASTC: false,
    // ETC1S quality 1..255: colour gets more codebook than single-channel data.
    qualityLevel: srgb ? 200 : 170,
    compressionLevel: 2,
    isPerceptual: srgb,
    isSetKTX2SRGBTransferFunc: srgb,
  };
}

async function encode(src, dst, role, flipY, maxSize = 0) {
  totals.jpg += size(src);
  if (existsSync(dst) && !FORCE) {
    totals.ktx2 += size(dst);
    return false;
  }
  if (!WRITE) {
    console.log(`would encode ${rel(src)} -> ${basename(dst)} (${role})`);
    return false;
  }
  const t = Date.now();
  const out = await encodeToKTX2(readFileSync(src), options(role, flipY, maxSize));
  writeFileSync(dst, out);
  totals.ktx2 += out.length;
  totals.files++;
  console.log(`${rel(dst)}: ${kb(size(src))} jpg -> ${kb(out.length)} ktx2 (${role}, ${Date.now() - t} ms)`);
  return true;
}

function copyTranscoder() {
  const from = join(ROOT, "node_modules", "three", "examples", "jsm", "libs", "basis");
  const to = join(ASSETS, "basis");
  for (const f of ["basis_transcoder.js", "basis_transcoder.wasm"]) {
    const a = join(from, f);
    const b = join(to, f);
    if (existsSync(b) && readFileSync(a).equals(readFileSync(b))) continue;
    if (!WRITE) {
      console.log(`would copy ${f} -> ${rel(to)}`);
      continue;
    }
    mkdirSync(to, { recursive: true });
    copyFileSync(a, b);
    console.log(`copied ${f} -> ${rel(to)}`);
  }
}

const roleOf = (kind) => (kind === "albedo" ? "color" : kind === "normal" ? "normal" : "data");

async function textureSets() {
  const base = join(ASSETS, "textures");
  for (const id of readdirSync(base).sort()) {
    const dir = join(base, id);
    if (!statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir).sort()) {
      const m = /^(albedo|normal|roughness|ao)(_512)?\.jpg$/.exec(f);
      if (!m) continue;
      await encode(join(dir, f), join(dir, f.replace(/\.jpg$/, ".ktx2")), roleOf(m[1]), true);
      // No <kind>_512.jpg (optimize-assets not run for this set): build the
      // 512 px KTX2 from the full JPEG so the Low preset copy always exists.
      if (!m[2] && !existsSync(join(dir, `${m[1]}_512.jpg`))) {
        await encode(join(dir, f), join(dir, `${m[1]}_512.ktx2`), roleOf(m[1]), true, 512);
      }
    }
  }
}

/** Top-level node names (variants), to check gltfpack kept the structure. */
function structure(json) {
  const scene = json.scenes?.[json.scene ?? 0];
  return (scene?.nodes ?? []).map((n) => json.nodes[n].name ?? `#${n}`).join("|");
}

function bufferFiles(json) {
  return (json.buffers ?? []).map((b) => b.uri).filter((u) => u && !u.startsWith("data:"));
}

function pack(file, quantize) {
  const dir = dirname(file);
  const before = JSON.parse(readFileSync(file, "utf8"));
  const oldBins = bufferFiles(before);
  const binBefore = oldBins.reduce((s, b) => s + size(join(dir, b)), 0);
  if (before.extensionsUsed?.includes("EXT_meshopt_compression")) {
    totals.binBefore += binBefore;
    totals.binAfter += binBefore;
    return;
  }
  if (!WRITE) {
    console.log(`would pack ${rel(file)} (${kb(binBefore)} buffers)`);
    return;
  }
  const tmp = mkdtempSync(join(tmpdir(), "ih-gltfpack-"));
  try {
    const out = join(tmp, basename(file));
    // -cc: meshopt compression (higher ratio). -tr: keep the texture URIs.
    // -kn / -km: keep named nodes and materials (variants are top-level nodes).
    const flags = ["-cc", "-tr", "-kn", "-km", ...(quantize ? [] : ["-noq"])];
    execFileSync(process.execPath, [join(ROOT, "node_modules", "gltfpack", "cli.js"), "-i", file, "-o", out, ...flags], { stdio: "pipe" });
    const after = JSON.parse(readFileSync(out, "utf8"));
    if (structure(after) !== structure(before)) throw new Error(`gltfpack changed the top-level nodes of ${rel(file)}`);
    const newBins = bufferFiles(after);
    for (const b of oldBins) if (!newBins.includes(b)) rmSync(join(dir, b), { force: true });
    for (const b of newBins) renameSync(join(tmp, b), join(dir, b));
    renameSync(out, file);
    const binAfter = newBins.reduce((s, b) => s + size(join(dir, b)), 0);
    totals.binBefore += binBefore;
    totals.binAfter += binAfter;
    console.log(`${rel(file)}: buffers ${kb(binBefore)} -> ${kb(binAfter)} (meshopt${quantize ? " + quantized" : ""})`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Adds a KHR_texture_basisu .ktx2 source to every texture (JPEG kept as fallback). */
async function attachKtx2(file) {
  const dir = dirname(file);
  const json = JSON.parse(readFileSync(file, "utf8"));
  const textures = json.textures ?? [];
  if (!textures.length) return;
  // Role per texture from how materials use it.
  const roles = new Map();
  const mark = (info, role) => {
    if (!info) return;
    const prev = roles.get(info.index);
    // normal beats colour beats data (UASTC / sRGB win when shared).
    const rank = { data: 0, color: 1, normal: 2 };
    if (!prev || rank[role] > rank[prev]) roles.set(info.index, role);
  };
  for (const m of json.materials ?? []) {
    mark(m.pbrMetallicRoughness?.baseColorTexture, "color");
    mark(m.emissiveTexture, "color");
    mark(m.normalTexture, "normal");
    mark(m.pbrMetallicRoughness?.metallicRoughnessTexture, "data");
    mark(m.occlusionTexture, "data");
  }
  let changed = false;
  const images = json.images ?? [];
  const ktxImage = new Map();
  for (let i = 0; i < textures.length; i++) {
    const tex = textures[i];
    if (tex.extensions?.KHR_texture_basisu || tex.source === undefined) continue;
    const img = images[tex.source];
    if (!img?.uri || !/\.jpe?g$/i.test(img.uri)) continue;
    const uri = img.uri.replace(/\.jpe?g$/i, ".ktx2");
    const role = roles.get(i) ?? "color";
    if (!existsSync(join(dir, decodeURI(img.uri)))) {
      console.warn(`skipping ${rel(file)}: image ${img.uri} not on disk`);
      continue;
    }
    await encode(join(dir, decodeURI(img.uri)), join(dir, decodeURI(uri)), role, false);
    if (!WRITE) continue;
    let idx = ktxImage.get(uri);
    if (idx === undefined) {
      idx = images.findIndex((im) => im.uri === uri);
      if (idx < 0) idx = images.push({ name: img.name ? `${img.name}_ktx2` : undefined, uri, mimeType: "image/ktx2" }) - 1;
      ktxImage.set(uri, idx);
    }
    tex.extensions = { ...tex.extensions, KHR_texture_basisu: { source: idx } };
    changed = true;
  }
  if (!changed) return;
  json.images = images;
  json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), "KHR_texture_basisu"])];
  // Not "required": the JPEG source stays the fallback.
  if (json.extensionsRequired) json.extensionsRequired = json.extensionsRequired.filter((e) => e !== "KHR_texture_basisu");
  writeFileSync(file, JSON.stringify(json));
}

function gltfFiles() {
  const out = [];
  for (const [sub, pattern, quantize] of [
    ["models", /_1k\.gltf$/, true],
    ["weapons", /^model\.gltf$/, false],
    ["characters", /^fparms\.gltf$/, false],
  ]) {
    const base = join(ASSETS, sub);
    if (!existsSync(base)) continue;
    for (const id of readdirSync(base).sort()) {
      const dir = join(base, id);
      if (!statSync(dir).isDirectory()) continue;
      for (const f of readdirSync(dir)) if (pattern.test(f)) out.push([join(dir, f), quantize]);
    }
  }
  return out;
}

copyTranscoder();
await textureSets();
const setJpg = totals.jpg;
const setKtx = totals.ktx2;
for (const [file, quantize] of gltfFiles()) {
  pack(file, quantize);
  await attachKtx2(file);
}
console.log(
  `\ntexture sets: ${kb(setJpg)} jpg -> ${kb(setKtx)} ktx2` +
    `\nglTF textures: ${kb(totals.jpg - setJpg)} jpg -> ${kb(totals.ktx2 - setKtx)} ktx2` +
    `\nglTF buffers: ${kb(totals.binBefore)} -> ${kb(totals.binAfter)}` +
    `\n${totals.files} file(s) encoded${WRITE ? "" : " (dry run: pass --write)"}`,
);
