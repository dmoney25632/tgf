// Shared helpers for the offline soldier conversion (node only).
import fs from "node:fs";
import zlib from "node:zlib";
const NM = "/Users/dayton/dev/tgf/node_modules";
globalThis.self = globalThis;
export const THREE = await import(NM + "/three/build/three.module.js");
const { FBXLoader } = await import(NM + "/three/examples/jsm/loaders/FBXLoader.js");
const { GLTFLoader } = await import(NM + "/three/examples/jsm/loaders/GLTFLoader.js");
const { TGALoader } = await import(NM + "/three/examples/jsm/loaders/TGALoader.js");

THREE.TextureLoader.prototype.load = function () { return new THREE.Texture(); };
THREE.ImageLoader.prototype.load = function () { return {}; };

const ab = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

export function loadFBX(path) {
  return new FBXLoader().parse(ab(fs.readFileSync(path)), "");
}

export function loadGLB(path) {
  return new Promise((res, rej) => new GLTFLoader().parse(ab(fs.readFileSync(path)), "", res, rej));
}

/** TGA -> { data: RGBA Uint8Array (row 0 = top), width, height }. */
export function loadTGA(path) {
  const t = new TGALoader().parse(fs.readFileSync(path));
  // TGALoader returns rows bottom-up for flipY=true textures; normalise to top-down.
  const { width: w, height: h } = t;
  const src = t.data, out = new Uint8Array(w * h * 4);
  const flip = false; // TGALoader already yields top-down rows
  for (let y = 0; y < h; y++) {
    const sy = flip ? h - 1 - y : y;
    out.set(src.subarray(sy * w * 4, (sy + 1) * w * 4), y * w * 4);
  }
  return { data: out, width: w, height: h };
}

/** Minimal PNG writer (RGBA or RGB). */
export function writePNG(path, data, w, h, channels = 4) {
  const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, body) => { const l = Buffer.alloc(4); l.writeUInt32BE(body.length); const tb = Buffer.concat([Buffer.from(type), body]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(tb)); return Buffer.concat([l, tb, c]); };
  const raw = Buffer.alloc((w * channels + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * channels + 1)] = 0; Buffer.from(data.buffer, data.byteOffset + y * w * channels, w * channels).copy(raw, y * (w * channels + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = channels === 4 ? 6 : 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  fs.writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

/** Box-downsample an RGBA image by an integer factor. */
export function downsample(img, f) {
  const w = img.width / f, h = img.height / f, out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
    let s = 0;
    for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) s += img.data[((y * f + j) * img.width + x * f + i) * 4 + c];
    out[(y * w + x) * 4 + c] = Math.round(s / (f * f));
  }
  return { data: out, width: w, height: h };
}
