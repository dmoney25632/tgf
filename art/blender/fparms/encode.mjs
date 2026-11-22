// GPU delivery for the first-person arms only (same formats as
// scripts/encode-ktx2.mjs, without touching any other asset):
//   - fparms.gltf: gltfpack -cc (meshopt), not quantized, names kept
//   - fparms_color: ETC1S sRGB; fparms_normal: UASTC normal map;
//     fparms_orm: UASTC (not ETC1S: the red region mask 0 / 0.5 / 1 must not
//     bleed into roughness / metalness, like the soldiers' mask textures)
//   - each texture gets a KHR_texture_basisu source, the JPEG stays the fallback
//
//   node art/blender/fparms/encode.mjs [dir]   (default public/assets/characters/fparms)
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeToKTX2 } from "ktx2-encoder";
import jpeg from "jpeg-js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DIR = resolve(process.argv[2] ?? join(ROOT, "public", "assets", "characters", "fparms"));
const FILE = join(DIR, "fparms.gltf");

let json = JSON.parse(readFileSync(FILE, "utf8"));
if (!json.extensionsUsed?.includes("EXT_meshopt_compression")) {
  const tmp = mkdtempSync(join(tmpdir(), "fparms-pack-"));
  try {
    execFileSync(process.execPath, [join(ROOT, "node_modules", "gltfpack", "cli.js"), "-i", FILE, "-o", join(tmp, "fparms.gltf"), "-cc", "-tr", "-kn", "-km", "-noq"], { stdio: "pipe" });
    const packed = JSON.parse(readFileSync(join(tmp, "fparms.gltf"), "utf8"));
    for (const b of json.buffers) rmSync(join(DIR, b.uri), { force: true });
    for (const b of packed.buffers) if (b.uri) renameSync(join(tmp, b.uri), join(DIR, b.uri));
    renameSync(join(tmp, "fparms.gltf"), FILE);
    json = packed;
    console.log("packed fparms.gltf (meshopt)");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const decode = async (buf) => {
  const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });
  return { width: img.width, height: img.height, data: img.data };
};
const common = { isKTX2File: true, generateMipmap: true, isYFlip: false, imageDecoder: decode };
const OPTS = {
  color: { ...common, isUASTC: false, qualityLevel: 200, compressionLevel: 2, isPerceptual: true, isSetKTX2SRGBTransferFunc: true },
  normal: { ...common, isUASTC: true, uastcLDRQualityLevel: 2, enableRDO: true, rdoQualityLevel: 1, needSupercompression: true, isNormalMap: true, isPerceptual: false, isSetKTX2SRGBTransferFunc: false },
  orm: { ...common, isUASTC: true, uastcLDRQualityLevel: 2, enableRDO: true, rdoQualityLevel: 4, needSupercompression: true, isPerceptual: false, isSetKTX2SRGBTransferFunc: false },
};
for (let i = 0; i < json.textures.length; i++) {
  const tex = json.textures[i];
  const img = json.images[tex.source];
  const kind = /fparms_(\w+)\.jpg$/.exec(img.uri)?.[1];
  if (!kind || !OPTS[kind]) continue;
  const uri = img.uri.replace(/\.jpg$/, ".ktx2");
  const out = await encodeToKTX2(readFileSync(join(DIR, img.uri)), OPTS[kind]);
  writeFileSync(join(DIR, uri), out);
  console.log(`${uri}: ${Math.round(out.length / 1024)} kB`);
  let idx = json.images.findIndex((im) => im.uri === uri);
  if (idx < 0) idx = json.images.push({ uri, mimeType: "image/ktx2" }) - 1;
  tex.extensions = { ...tex.extensions, KHR_texture_basisu: { source: idx } };
}
json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), "KHR_texture_basisu"])];
if (json.extensionsRequired) json.extensionsRequired = json.extensionsRequired.filter((e) => e !== "KHR_texture_basisu");
writeFileSync(FILE, JSON.stringify(json));
