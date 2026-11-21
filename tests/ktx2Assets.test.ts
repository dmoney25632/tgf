// GPU-compressed asset delivery: the KTX2 copies the manifest promises exist
// on disk (no 404 probing at runtime), glTFs keep a JPEG fallback for every
// KTX2 texture, and the loader's pure format/variant logic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import * as THREE from "three";
import { MODELS, TEXTURE_SETS, textureKtx2Url, textureUrl } from "../src/game/assets/manifest";
import { compressedSupport, dequantize, ktx2Variant, type GlExtensions } from "../src/game/assets/AssetLoader";

const PUBLIC = join(process.cwd(), "public");
const KTX2_MAGIC = Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);

/** KTX2 header fields we care about (https://registry.khronos.org/KTX/specs/2.0/ktxspec.v2.html). */
function ktx2Header(file: string) {
  const b = readFileSync(file);
  assert.ok(b.subarray(0, 12).equals(KTX2_MAGIC), `${file}: not a KTX2 file`);
  return { vkFormat: b.readUInt32LE(12), width: b.readUInt32LE(20), height: b.readUInt32LE(24), levels: b.readUInt32LE(40), scheme: b.readUInt32LE(44) };
}

test("every ktx2 texture set has Basis KTX2 copies of each map (full + 512)", () => {
  for (const [id, entry] of Object.entries(TEXTURE_SETS)) {
    if (!entry.ktx2) continue;
    for (const kind of entry.maps) {
      assert.ok(existsSync(join(PUBLIC, textureUrl(id, kind))), `${id}/${kind}.jpg fallback missing`);
      for (const [small, edge] of [
        [false, 1024],
        [true, 512],
      ] as const) {
        const file = join(PUBLIC, textureKtx2Url(id, kind, small));
        assert.ok(existsSync(file), `${file} missing`);
        const h = ktx2Header(file);
        assert.equal(h.vkFormat, 0, `${file}: expected a Basis (supercompressed) texture`);
        assert.equal(Math.max(h.width, h.height), edge, `${file}: unexpected size`);
        assert.ok(h.levels > 1, `${file}: mipmaps missing`);
        // Normal maps are UASTC + Zstandard (2); the rest ETC1S / BasisLZ (1).
        assert.equal(h.scheme, kind === "normal" ? 2 : 1, `${file}: unexpected codec`);
      }
    }
  }
});

test("the Basis transcoder is served from /assets/basis and matches three's", () => {
  for (const f of ["basis_transcoder.js", "basis_transcoder.wasm"]) {
    const served = join(PUBLIC, "assets", "basis", f);
    assert.ok(existsSync(served), `${served} missing`);
    const lib = join(process.cwd(), "node_modules", "three", "examples", "jsm", "libs", "basis", f);
    assert.ok(readFileSync(served).equals(readFileSync(lib)), `${f} differs from three's (re-run npm run assets:ktx2 -- --write)`);
  }
});

function gltfFiles() {
  const files = Object.values(MODELS).map((m) => join(PUBLIC, "assets", m.file));
  const weapons = join(PUBLIC, "assets", "weapons");
  if (existsSync(weapons)) for (const id of readdirSync(weapons)) files.push(join(weapons, id, "model.gltf"));
  return files;
}

test("glTFs are meshopt-packed and every KTX2 texture keeps a JPEG fallback", () => {
  for (const file of gltfFiles()) {
    assert.ok(existsSync(file), `${file} missing`);
    const dir = dirname(file);
    const json = JSON.parse(readFileSync(file, "utf8"));
    assert.ok(json.extensionsUsed?.includes("EXT_meshopt_compression"), `${file}: not meshopt-packed`);
    assert.ok(!json.extensionsRequired?.includes("KHR_texture_basisu"), `${file}: KTX2 must stay optional`);
    for (const b of json.buffers ?? []) if (b.uri) assert.ok(existsSync(join(dir, decodeURI(b.uri))), `${file}: buffer ${b.uri} missing`);
    for (const t of json.textures ?? []) {
      const fallback = json.images[t.source];
      // A source image that was never shipped (rollershutter graffiti) gets no KTX2 either.
      if (!fallback?.uri || !existsSync(join(dir, decodeURI(fallback.uri)))) {
        assert.ok(!t.extensions?.KHR_texture_basisu, `${file}: KTX2 without a JPEG fallback`);
        continue;
      }
      const ktx = t.extensions?.KHR_texture_basisu;
      assert.ok(ktx, `${file}: texture without a KTX2 source`);
      const img = json.images[ktx.source];
      assert.equal(img.mimeType, "image/ktx2");
      ktx2Header(join(dir, decodeURI(img.uri)));
    }
  }
});

test("ktx2Variant picks the copy matching the preset cap", () => {
  assert.equal(ktx2Variant(512), "small");
  assert.equal(ktx2Variant(1024), "full");
  assert.equal(ktx2Variant(2048), "full");
  // Caps the encoded sizes don't match: JPEG path (resized on decode).
  assert.equal(ktx2Variant(256), null);
  assert.equal(ktx2Variant(768), null);
});

const exts = (...names: string[]): GlExtensions => ({ has: (n) => names.includes(n), get: () => null });

test("compressed textures only where the GPU has a usable compressed format", () => {
  assert.equal(compressedSupport(null), null);
  assert.equal(compressedSupport(exts()), null);
  // DXT without its sRGB variant can't hold sRGB albedo: JPEGs instead.
  assert.equal(compressedSupport(exts("WEBGL_compressed_texture_s3tc")), null);
  const dxt = compressedSupport(exts("WEBGL_compressed_texture_s3tc", "WEBGL_compressed_texture_s3tc_srgb"));
  assert.ok(dxt?.has("WEBGL_compressed_texture_s3tc"));
  // BC7 present, sRGB DXT not: KTX2 on, but DXT hidden from the transcoder.
  const bc7 = compressedSupport(exts("EXT_texture_compression_bptc", "WEBGL_compressed_texture_s3tc"));
  assert.ok(bc7?.has("EXT_texture_compression_bptc"));
  assert.equal(bc7?.has("WEBGL_compressed_texture_s3tc"), false);
  // iOS / Android.
  assert.ok(compressedSupport(exts("WEBGL_compressed_texture_astc")));
  assert.ok(compressedSupport(exts("WEBGL_compressed_texture_etc")));
});

test("dequantize turns quantized attributes into float copies", () => {
  const norm = new THREE.BufferAttribute(new Int16Array([32767, -32767, 0]), 3, true);
  const out = dequantize(norm);
  assert.ok(out.array instanceof Float32Array);
  assert.deepEqual(Array.from(out.array), [1, -1, 0]);
  const raw = new THREE.BufferAttribute(new Uint16Array([5, 1000]), 2);
  assert.deepEqual(Array.from(dequantize(raw).array), [5, 1000]);
  const ib = new THREE.InterleavedBuffer(new Float32Array([1, 2, 9, 3, 4, 9]), 3);
  assert.deepEqual(Array.from(dequantize(new THREE.InterleavedBufferAttribute(ib, 2, 0)).array), [1, 2, 3, 4]);
  const f = new THREE.BufferAttribute(new Float32Array([1, 2]), 2);
  assert.equal(dequantize(f), f);
});
