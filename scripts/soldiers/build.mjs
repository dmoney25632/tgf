// Builds public/assets/characters/soldiers/* from the downloaded Rocketbox
// military avatars (MIT) and (optionally) the Quaternius Universal
// Animation Library (CC0).
//
//   SOLDIER_WORK=<scratch> node scripts/soldiers/build.mjs public/assets/characters/soldiers
//
// <scratch>/dl/<Avatar_Name>/ holds each avatar's FBX + TGA textures
// (scripts/soldiers/fetch_rb.sh). Per avatar it writes soldier_<id>.gltf +
// .bin (one shared skin, parts body / head / helmet / equipment, each with a
// simplified *_lod1 twin; canonical joint order, so male parts swap between
// male skeletons and female parts between female ones) and an atlas set:
// _color.jpg (2048), _color_1k.jpg, _normal.jpg (1024),
// _orm.jpg (1024: R team-tint mask, G roughness, B skin mask). The head part
// carries uv1 masks (x beard, y balaclava eye band). Then run
// `npm run assets:ktx2 -- --write`, which meshopt-packs the glTFs, derives
// the soldier_<id>_1k.gltf twins and adds KTX2 copies of the textures.
// anims.glb is rebuilt only when the UAL download is present.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { THREE, writePNG, downsample } from "./lib.mjs";
import { loadAvatar, buildAtlas, headMasks, rasterUV, triComponents, PARTS } from "./avatar.mjs";
import { render } from "./render.mjs";

const NM = "/Users/dayton/dev/tgf/node_modules";
const { GLTFExporter } = await import(NM + "/three/examples/jsm/exporters/GLTFExporter.js");
const { MeshoptSimplifier } = await import(NM + "/three/examples/jsm/libs/meshopt_simplifier.module.js");
globalThis.FileReader = class {
  readAsArrayBuffer(b) { b.arrayBuffer().then((r) => { this.result = r; this.onloadend?.({ target: this }); this.onload?.({ target: this }); }); }
  readAsDataURL(b) { b.arrayBuffer().then((r) => { this.result = "data:application/octet-stream;base64," + Buffer.from(r).toString("base64"); this.onloadend?.({ target: this }); this.onload?.({ target: this }); }); }
};

const S = process.env.SOLDIER_WORK ?? "/tmp/tgf-soldiers";
const OUT = process.argv[2];
const ONLY = process.argv[3] ? new Set(process.argv[3].split(",")) : null;
const TMP = `${S}/out/tmp`;
const PREV = `${S}/out/prev`;
for (const d of [OUT, TMP, PREV]) fs.mkdirSync(d, { recursive: true });

/**
 * id -> source. cap: the head texture carries a patrol cap (its own mesh
 * island, tinted like the uniform). Ids a..c keep their old avatars.
 */
export const AVATARS = [
  { id: "a", name: "Military_Male_01", prefix: "sm002", sex: "m" },
  { id: "b", name: "Military_Male_03", prefix: "sm004", sex: "m" },
  { id: "c", name: "Military_Male_04", prefix: "sm005", sex: "m" },
  { id: "d", name: "Military_Male_02", prefix: "sm024", sex: "m", cap: true },
  { id: "e", name: "Military_Male_05", prefix: "sm022", sex: "m", cap: true },
  { id: "f", name: "Military_Male_06", prefix: "sm021", sex: "m", cap: true },
  { id: "g", name: "Military_Female_01", prefix: "sf003", sex: "f" },
  { id: "h", name: "Military_Female_02", prefix: "sf004", sex: "f" },
];

const jpg = (png, out, q) => execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", String(q), png, "--out", out], { stdio: "ignore" });
const srgb2lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lin2srgb = (c) => Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055));
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hsv = (r, g, b) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0;
  if (mx > mn) h = mx === r ? ((g - b) / (mx - mn)) * 60 : mx === g ? (2 + (b - r) / (mx - mn)) * 60 : (4 + (r - g) / (mx - mn)) * 60;
  if (h < 0) h += 360;
  return [h, mx > 0 ? (mx - mn) / mx : 0, mx];
};

/** glTF JSON (+ external .bin) of a group of skinned meshes; one material using the atlas. */
async function writeGltf(group, base) {
  const json = await new Promise((res, rej) => new GLTFExporter().parse(group, res, rej, { binary: false, onlyVisible: false }));
  const uri = json.buffers[0].uri;
  const bin = Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64");
  fs.writeFileSync(`${OUT}/${base}.bin`, bin);
  json.buffers[0] = { uri: `${base}.bin`, byteLength: bin.length };
  json.images = [{ uri: `${base}_color.jpg`, mimeType: "image/jpeg" }, { uri: `${base}_normal.jpg`, mimeType: "image/jpeg" }, { uri: `${base}_orm.jpg`, mimeType: "image/jpeg" }];
  json.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }];
  json.textures = [0, 1, 2].map((i) => ({ sampler: 0, source: i }));
  json.materials = [{
    name: "soldier",
    pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicRoughnessTexture: { index: 2 }, metallicFactor: 0, roughnessFactor: 1 },
    normalTexture: { index: 1 },
  }];
  for (const m of json.meshes) for (const p of m.primitives) p.material = 0;
  delete json.extensionsUsed;
  fs.writeFileSync(`${OUT}/${base}.gltf`, JSON.stringify(json));
}

await MeshoptSimplifier.ready;
const meta = fs.existsSync(`${OUT}/soldiers.json`) ? JSON.parse(fs.readFileSync(`${OUT}/soldiers.json`, "utf8")) : { avatars: {}, clips: {} };
const newAvatars = {};
for (const av of AVATARS) {
  if (ONLY && !ONLY.has(av.id)) { newAvatars[av.id] = meta.avatars[av.id]; continue; }
  const dir = `${S}/dl/${av.name}`;
  const A = loadAvatar(dir, `${av.name}.fbx`, av.prefix);
  const head = A.parts.head;
  headMasks(head, A.face);

  // Cap island (cap heads): head triangles in components that sit above the brows.
  const eyeY = (A.face.eyeL.y + A.face.eyeR.y) / 2;
  const comp = triComponents(head.index.array, head.attributes.position.count);
  const cs = new Map(); // component -> { n, min, max } (height)
  for (let t = 0; t < comp.length; t++) {
    let c = cs.get(comp[t]);
    if (!c) cs.set(comp[t], (c = { n: 0, min: 1e9, max: -1e9 }));
    c.n++;
    for (let k = 0; k < 3; k++) {
      const y = head.attributes.position.getY(head.index.array[t * 3 + k]);
      c.min = Math.min(c.min, y);
      c.max = Math.max(c.max, y);
    }
  }
  const isCap = (t) => {
    const c = cs.get(comp[t]);
    return !!av.cap && c.n < 1500 && c.min > eyeY - 0.04 && c.max > eyeY + 0.08;
  };

  // ---- Geometry: parts + LOD1 ------------------------------------------------
  const tris = {};
  for (const part of PARTS) {
    const g = A.parts[part];
    if (!g) continue;
    const ratio = part === "body" ? 0.3 : part === "head" ? 0.33 : 0.32;
    const idx = new Uint32Array(g.index.array);
    const target = Math.floor((idx.length * ratio) / 3) * 3;
    const [lod1Idx] = MeshoptSimplifier.simplify(idx, g.attributes.position.array, 3, target, 0.02, part === "head" ? [] : ["LockBorder"]);
    // Compact the LOD1 vertex set.
    const used = new Map(), order = [];
    for (const vi of lod1Idx) if (!used.has(vi)) { used.set(vi, order.length); order.push(vi); }
    const g1 = new THREE.BufferGeometry();
    for (const [k, attr] of Object.entries(g.attributes)) {
      const n = attr.itemSize, arr = new attr.array.constructor(order.length * n);
      order.forEach((vi, i) => { for (let c = 0; c < n; c++) arr[i * n + c] = attr.array[vi * n + c]; });
      g1.setAttribute(k, new THREE.BufferAttribute(arr, n, attr.normalized));
    }
    g1.setIndex(new THREE.BufferAttribute(new Uint16Array(Array.from(lod1Idx, (vi) => used.get(vi))), 1));
    A.parts[part + "_lod1"] = g1;
    tris[part] = [g.index.count / 3, lod1Idx.length / 3];
  }
  const group = new THREE.Group();
  group.name = `soldier_${av.id}`;
  group.add(A.bones[0]);
  group.updateMatrixWorld(true);
  for (const [name, g] of Object.entries(A.parts)) {
    const m = new THREE.SkinnedMesh(g, new THREE.MeshStandardMaterial());
    m.name = name;
    group.add(m);
    m.bind(A.skeleton, new THREE.Matrix4());
  }
  await writeGltf(group, `soldier_${av.id}`);

  // ---- Textures ---------------------------------------------------------------
  const col = buildAtlas(dir, av.prefix, "color", 1024);
  writePNG(`${TMP}/c.png`, col.data, col.width, col.height);
  jpg(`${TMP}/c.png`, `${OUT}/soldier_${av.id}_color.jpg`, 82);
  const col1 = downsample(col, 2);
  writePNG(`${TMP}/c1.png`, col1.data, col1.width, col1.height);
  jpg(`${TMP}/c1.png`, `${OUT}/soldier_${av.id}_color_1k.jpg`, 84);
  const nrm = downsample(buildAtlas(dir, av.prefix, "normal", 1024), 2);
  writePNG(`${TMP}/n.png`, nrm.data, nrm.width, nrm.height);
  jpg(`${TMP}/n.png`, `${OUT}/soldier_${av.id}_normal.jpg`, 88);
  const spec = downsample(buildAtlas(dir, av.prefix, "specular", 1024, [40, 40, 40, 255]), 2);

  // ORM-style mask texture at 1024: R team-tint mask, G roughness, B skin mask.
  const W = 1024;
  const capMask = new Uint8Array(W * W);
  if (av.cap) rasterUV(capMask, W, head, isCap, 2);
  // Boots never count as skin (khaki suede reads warm and saturated).
  const feet = new Uint8Array(W * W);
  const body = A.parts.body;
  rasterUV(feet, W, body, (t) => [0, 1, 2].every((k) => body.attributes.position.getY(body.index.array[t * 3 + k]) < 0.3), 1);
  // Bare skin on the body is only ever forearms / hands (patches, flags and the tan undershirt are warm too).
  const zone = new Uint8Array(W * W);
  const bp = body.attributes.position;
  rasterUV(zone, W, body, (t) => [0, 1, 2].every((k) => { const i = body.index.array[t * 3 + k]; return Math.abs(bp.getX(i)) > 0.33; }), 1);
  const headSkin = new Uint8Array(W * W); // head-skin island (not eyes / cap / sunglasses get sorted by colour)
  rasterUV(headSkin, W, head, (t) => !isCap(t), 1);
  const orm = new Uint8Array(W * W * 4);
  const sum = [0, 0, 0, 0], cnt = [0, 0, 0, 0];
  const skinAcc = { body: [0, 0, 0, 0], head: [0, 0, 0, 0] };
  const quadOf = (x, y) => (y < W / 2 ? (x < W / 2 ? 0 : 1) : x < W / 2 ? 2 : 3); // body, head, helmet, equipment
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    const p = o; // col1 has the same size
    const r = col1.data[p], gg = col1.data[p + 1], b = col1.data[p + 2];
    const [hue, sat, val] = hsv(r, gg, b);
    const q = quadOf(x, y);
    const warm = hue >= 2 && hue <= 48 ? 1 : 0;
    // Skin: warm and saturated enough; dark skin is allowed (low value), khaki boots are not (low saturation).
    let skin = feet[y * W + x] || !zone[y * W + x] ? 0 : warm * sm(0.2, 0.32, sat) * sm(18, 40, val);
    if (q === 1) skin = headSkin[y * W + x] && !capMask[y * W + x] ? Math.max(skin, warm * sm(0.12, 0.2, sat) * sm(10, 25, val)) : 0;
    const mask = q === 1 ? capMask[y * W + x] / 255 : 1 - skin;
    const sp = spec.data[o] / 255;
    orm[o] = Math.round(mask * 255);
    orm[o + 1] = Math.round(THREE.MathUtils.clamp(0.95 - sp * 0.9, 0.3, 0.95) * 255);
    orm[o + 2] = Math.round(skin * 255);
    orm[o + 3] = 255;
    if (mask > 0.9) { sum[q] += 0.2126 * srgb2lin(r) + 0.7152 * srgb2lin(gg) + 0.0722 * srgb2lin(b); cnt[q]++; }
    if (skin > 0.9 && (q === 0 || q === 1)) {
      const s = skinAcc[q === 0 ? "body" : "head"];
      s[0] += srgb2lin(r); s[1] += srgb2lin(gg); s[2] += srgb2lin(b); s[3]++;
    }
  }
  writePNG(`${TMP}/o.png`, orm, W, W);
  jpg(`${TMP}/o.png`, `${OUT}/soldier_${av.id}_orm.jpg`, 88);
  // Tint gain per quadrant so that the camo's mean luminance maps to the tint colour.
  const gains = sum.map((s, i) => (cnt[i] > 200 ? +(cnt[i] / s).toFixed(3) : 0));
  const mean = (s) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : [0.5, 0.35, 0.25]);
  const skinHex = (s) => mean(s).map(lin2srgb).reduce((h, c) => h * 256 + Math.min(255, c), 0);
  if (skinAcc.body[3] < 2000) skinAcc.body = skinAcc.head; // gloved: no bare skin to match
  const top = new THREE.Box3().setFromBufferAttribute(head.attributes.position).max.y;
  newAvatars[av.id] = {
    sex: av.sex,
    cap: !!av.cap,
    parts: Object.keys(tris),
    tris,
    gains,
    skin: { head: skinHex(skinAcc.head), body: skinHex(skinAcc.body) },
    eyes: +eyeY.toFixed(4),
    top: +top.toFixed(4),
  };
  console.log(av.id, av.name, JSON.stringify(newAvatars[av.id]));

  // Preview: all parts, textured, front and side.
  const ms = PARTS.filter((p) => A.parts[p]).map((p) => {
    const m = new THREE.SkinnedMesh(A.parts[p], new THREE.MeshBasicMaterial());
    m.bind(A.skeleton, new THREE.Matrix4());
    m.userData.tex = col1;
    m.userData.gltfUV = true;
    return m;
  });
  render(`${PREV}/build_${av.id}.png`, ms, { W: 200, H: 260, views: [{ yaw: 0 }, { yaw: Math.PI * 0.75 }] });
  // Mask preview (ORM as colour).
  const ormImg = { data: orm, width: W, height: W };
  for (const m of ms) m.userData.tex = ormImg;
  render(`${PREV}/mask_${av.id}.png`, ms, { W: 200, H: 260, views: [{ yaw: 0 }, { yaw: Math.PI }] });
}
meta.avatars = newAvatars;

// ---- Animations (only with the UAL download; otherwise anims.glb is kept) ------
const UAL = `${S}/dl/ual/Universal Animation Library[Standard]/Unreal-Godot/`;
if (fs.existsSync(UAL)) {
  const { loadSource, makeRetargeter, rootSpeed, MAP } = await import("./retarget.mjs");
  const ref = loadAvatar(`${S}/dl/${AVATARS[0].name}`, `${AVATARS[0].name}.fbx`, AVATARS[0].prefix);
  const src = await loadSource(UAL + "UAL1_Standard.glb");
  const rm = await loadSource(UAL + "UAL1_Standard_RM.glb");
  const R = makeRetargeter(src, ref.group);
  const BODY = new Set(MAP.map((m) => m[1]).filter((n) => !/Finger/.test(n)));
  BODY.add("Bip01");
  const FING = new Set(MAP.map((m) => m[1]).filter((n) => /Finger/.test(n)));
  const want = {
    Idle_Loop: "idle", Walk_Loop: "walk", Jog_Fwd_Loop: "jog", Sprint_Loop: "sprint", Crouch_Idle_Loop: "crouchIdle", Crouch_Fwd_Loop: "crouchWalk",
    Hit_Chest: "hitChest", Hit_Head: "hitHead", Death01: "death",
  };
  const clips = [];
  for (const [sn, id] of Object.entries(want)) {
    const c = src.clips.find((c) => c.name === sn);
    clips.push(R.retarget(c, { name: id, only: BODY }));
    const sp = rootSpeed(rm, rm.clips.find((c) => c.name === sn));
    meta.clips[id] = { duration: +c.duration.toFixed(4), stride: +(sp.d * R.hipK).toFixed(4) };
  }
  clips.push(R.retarget(src.clips.find((c) => c.name === "Pistol_Idle_Loop"), { name: "grip", only: FING, frames: 1 }));
  const bonesOnly = new THREE.Group();
  bonesOnly.name = "rig";
  bonesOnly.add(ref.bones[0].clone(true));
  const glb = await new Promise((res, rej) => new GLTFExporter().parse(bonesOnly, (r) => res(Buffer.from(r)), rej, { binary: true, animations: clips }));
  fs.writeFileSync(`${OUT}/anims.glb`, glb);
}
fs.writeFileSync(`${OUT}/soldiers.json`, JSON.stringify(meta, null, 1));
