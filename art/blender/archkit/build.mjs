#!/usr/bin/env node
// Builds the modular architecture kit into public/assets/archkit/:
//
//   node art/blender/archkit/build.mjs                  # Blender build + pack + KTX2
//   node art/blender/archkit/build.mjs --raw <dir>      # pack an existing Blender export (<dir>/archkit.gltf)
//   node art/blender/archkit/build.mjs --previews <dir> # where the preview renders go (default: art/previews/archkit)
//
// 1. Blender (headless): art/blender/archkit/build.py bakes the 16-cell atlas, builds
//    every piece (LOD0 + LOD1), bakes AO into COLOR_0 and exports one glTF.
// 2. Atlas PNGs -> JPEG (sips), 2048 px for High and a 1024 px set for Medium.
// 3. gltfpack -cc (meshopt) + quantization, keeping node / material names and
//    every vertex attribute (COLOR_0 carries the baked AO and the tint mask).
// 4. archkit_1k.gltf: a twin sharing the .bin, sampling the 1024 px JPEGs.
// 5. KTX2 copies of every JPEG (same encoder settings as scripts/encode-ktx2.mjs:
//    normal UASTC + RDO, colour ETC1S sRGB, data ETC1S linear), attached with
//    KHR_texture_basisu; the JPEG stays the core source (fallback).
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeToKTX2 } from "ktx2-encoder";
import jpeg from "jpeg-js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const OUT = join(ROOT, "public", "assets", "archkit");
const BLENDER = process.env.BLENDER ?? "/Applications/Blender.app/Contents/MacOS/Blender";
const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const kb = (n) => `${Math.round(n / 1024)} kB`;

let raw = opt("--raw");
if (!raw) {
  raw = mkdtempSync(join(tmpdir(), "archkit-"));
  const previews = resolve(opt("--previews", join(ROOT, "art", "previews", "archkit")));
  console.log(`blender -> ${raw}`);
  execFileSync(BLENDER, ["-b", "--factory-startup", "-noaudio", "-P", join(ROOT, "art", "blender", "archkit", "build.py"), "--", "--out", join(raw, "archkit.gltf"), "--previews", previews], { stdio: "inherit" });
}
raw = resolve(raw);
mkdirSync(OUT, { recursive: true });

// 2. Atlas -> JPEG (full + 1k).
const gl = JSON.parse(readFileSync(join(raw, "archkit.gltf"), "utf8"));
for (const im of gl.images ?? []) {
  const png = join(raw, decodeURI(im.uri));
  const stem = basename(png).replace(/\.png$/i, "");
  execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "92", png, "--out", join(OUT, `${stem}.jpg`)], { stdio: "pipe" });
  execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "90", "-Z", "1024", png, "--out", join(OUT, `${stem}_1k.jpg`)], { stdio: "pipe" });
  im.uri = `${stem}.jpg`;
  im.mimeType = "image/jpeg";
}
const staged = join(raw, "archkit_jpg.gltf");
writeFileSync(staged, JSON.stringify(gl));
for (const f of readdirSync(OUT)) if (f.endsWith(".jpg")) copyFileSync(join(OUT, f), join(raw, f));

// 3. gltfpack.
const tmp = mkdtempSync(join(tmpdir(), "archkit-pack-"));
const packed = join(tmp, "archkit.gltf");
execFileSync(process.execPath, [join(ROOT, "node_modules", "gltfpack", "cli.js"), "-i", staged, "-o", packed, "-cc", "-tr", "-kn", "-km", "-kv"], { stdio: "pipe" });
const json = JSON.parse(readFileSync(packed, "utf8"));
// Pieces are the scene's top-level nodes (quantized meshes hang under them as child nodes).
const top = (d) => d.scenes[d.scene ?? 0].nodes.map((i) => d.nodes[i].name).sort().join("|");
const nodesBefore = top(gl);
const nodesAfter = top(json);
if (nodesBefore !== nodesAfter) throw new Error("gltfpack changed the piece nodes");
const colours = json.meshes.every((m) => m.primitives.every((p) => p.attributes.COLOR_0 !== undefined));
if (!colours) throw new Error("gltfpack dropped COLOR_0");
for (const b of json.buffers) if (b.uri) renameSync(join(tmp, b.uri), join(OUT, b.uri));
rmSync(tmp, { recursive: true, force: true });

// 4. + 5.
function decodeImage(buf) {
  const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });
  return { width: img.width, height: img.height, data: img.data };
}
function options(role) {
  const common = { isKTX2File: true, generateMipmap: true, isYFlip: false, imageDecoder: async (b) => decodeImage(b) };
  if (role === "normal") return { ...common, isUASTC: true, uastcLDRQualityLevel: 2, enableRDO: true, rdoQualityLevel: 1, needSupercompression: true, isNormalMap: true, isPerceptual: false, isSetKTX2SRGBTransferFunc: false };
  const srgb = role === "color";
  return { ...common, isUASTC: false, qualityLevel: srgb ? 200 : 170, compressionLevel: 2, isPerceptual: srgb, isSetKTX2SRGBTransferFunc: srgb };
}
async function withKtx2(doc, suffix) {
  const d = structuredClone(doc);
  const role = new Map();
  for (const m of d.materials ?? []) {
    if (m.pbrMetallicRoughness?.baseColorTexture) role.set(m.pbrMetallicRoughness.baseColorTexture.index, "color");
    if (m.normalTexture) role.set(m.normalTexture.index, "normal");
    if (m.pbrMetallicRoughness?.metallicRoughnessTexture) role.set(m.pbrMetallicRoughness.metallicRoughnessTexture.index, "data");
  }
  const images = d.images.map((im) => ({ ...im, uri: im.uri.replace(/\.jpg$/, `${suffix}.jpg`) }));
  d.images = [...images];
  for (let i = 0; i < d.textures.length; i++) {
    const t = d.textures[i];
    const src = images[t.source].uri;
    const ktx = src.replace(/\.jpg$/, ".ktx2");
    const out = await encodeToKTX2(readFileSync(join(OUT, src)), options(role.get(i) ?? "color"));
    writeFileSync(join(OUT, ktx), out);
    console.log(`${ktx}: ${kb(statSync(join(OUT, src)).size)} jpg -> ${kb(out.length)} ktx2 (${role.get(i) ?? "color"})`);
    const idx = d.images.push({ uri: ktx, mimeType: "image/ktx2" }) - 1;
    t.extensions = { ...t.extensions, KHR_texture_basisu: { source: idx } };
  }
  d.extensionsUsed = [...new Set([...(d.extensionsUsed ?? []), "KHR_texture_basisu"])];
  return d;
}
writeFileSync(join(OUT, "archkit.gltf"), JSON.stringify(await withKtx2(json, "")));
writeFileSync(join(OUT, "archkit_1k.gltf"), JSON.stringify(await withKtx2(json, "_1k")));
copyFileSync(join(raw, "archkit.json"), join(OUT, "archkit.json"));
let total = 0;
for (const f of readdirSync(OUT)) total += statSync(join(OUT, f)).size;
console.log(`archkit -> ${OUT} (${kb(total)} total)`);
