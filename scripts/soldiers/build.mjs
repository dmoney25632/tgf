// Builds public/assets/characters/soldiers/* from the downloaded Rocketbox
// avatars (MIT) and the Quaternius Universal Animation Library (CC0).
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { THREE, writePNG } from "./lib.mjs";
import { loadAvatar, buildAtlas } from "./avatar.mjs";
import { loadSource, makeRetargeter, rootSpeed, MAP } from "./retarget.mjs";
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
const TMP = `${S}/out/tmp`;
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });
const UAL = `${S}/dl/ual/Universal Animation Library[Standard]/Unreal-Godot/`;
const AVATARS = [
  { id: "a", dir: "m01", fbx: "Military_Male_01.fbx", prefix: "sm002" },
  { id: "b", dir: "m03", fbx: "Military_Male_03.fbx", prefix: "sm004" },
  { id: "c", dir: "m04", fbx: "Military_Male_04.fbx", prefix: "sm005" },
];

const exportGLB = (obj, animations = []) => new Promise((res, rej) => new GLTFExporter().parse(obj, (r) => res(Buffer.from(r)), rej, { binary: true, animations, onlyVisible: false }));
const jpg = (png, out, q) => execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", String(q), png, "--out", out], { stdio: "ignore" });

await MeshoptSimplifier.ready;
const srgb2lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };

const meta = { avatars: {}, clips: {} };
let refAvatar = null;
const restRef = new Map();
for (const av of AVATARS) {
  const a = loadAvatar(`${S}/dl/rb/${av.dir}`, av.fbx, av.prefix);
  // Rest-pose consistency across avatars (clips are shared).
  let maxDq = 0;
  for (const b of a.bones) {
    if (!restRef.has(b.name)) restRef.set(b.name, b.quaternion.clone());
    else maxDq = Math.max(maxDq, 1 - Math.abs(restRef.get(b.name).dot(b.quaternion)));
  }
  console.log(av.id, "tris", a.tris, "bones", a.bones.length, "rest quat delta vs a", maxDq.toExponential(2));

  // LOD1: simplified index over the same vertices.
  const g = a.mesh.geometry;
  const idx = new Uint32Array(g.index.array);
  const pos = g.attributes.position.array;
  const target = Math.floor(idx.length * 0.3 / 3) * 3;
  const [lod1Idx, err] = MeshoptSimplifier.simplify(idx, pos, 3, target, 0.01, []);
  console.log(av.id, "lod1 tris", lod1Idx.length / 3, "err", err);
  const g1 = new THREE.BufferGeometry();
  for (const k of Object.keys(g.attributes)) g1.setAttribute(k, g.attributes[k]);
  g1.setIndex(new THREE.BufferAttribute(new Uint16Array(lod1Idx), 1));
  const m1 = new THREE.SkinnedMesh(g1, a.mesh.material);
  m1.name = "lod1";
  a.group.add(m1);
  m1.bind(a.skeleton, new THREE.Matrix4());
  fs.writeFileSync(`${OUT}/soldier_${av.id}.glb`, await exportGLB(a.group));

  // Textures.
  const col = buildAtlas(`${S}/dl/rb/${av.dir}`, av.prefix, "color", 1024);
  writePNG(`${TMP}/c.png`, col.data, col.width, col.height);
  jpg(`${TMP}/c.png`, `${OUT}/soldier_${av.id}_color.jpg`, 82);
  const nrm = buildAtlas(`${S}/dl/rb/${av.dir}`, av.prefix, "normal", 512);
  writePNG(`${TMP}/n.png`, nrm.data, nrm.width, nrm.height);
  jpg(`${TMP}/n.png`, `${OUT}/soldier_${av.id}_normal.jpg`, 85);
  const spec = buildAtlas(`${S}/dl/rb/${av.dir}`, av.prefix, "specular", 512, [40, 40, 40, 255]);
  // ORM-style: R = team-tint mask, G = roughness, B = 0. Mask from the colour atlas at 512.
  const W = 1024, orm = new Uint8Array(W * W * 4);
  const sum = [0, 0, 0, 0], cnt = [0, 0, 0, 0];
  const quadOf = (x, y) => (y < W / 2 ? (x < W / 2 ? 0 : 1) : x < W / 2 ? 2 : 3); // body, head, helmet, equipment
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    let r = 0, gg = 0, b = 0;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) { const p = ((y * 2 + j) * col.width + x * 2 + i) * 4; r += col.data[p]; gg += col.data[p + 1]; b += col.data[p + 2]; }
    r /= 4; gg /= 4; b /= 4;
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), sat = mx > 0 ? (mx - mn) / mx : 0;
    let hue = 0;
    if (mx > mn) hue = mx === r ? ((gg - b) / (mx - mn)) * 60 : mx === gg ? (2 + (b - r) / (mx - mn)) * 60 : (4 + (r - gg) / (mx - mn)) * 60;
    if (hue < 0) hue += 360;
    const q = quadOf(x, y);
    const warm = hue >= 2 && hue <= 45 ? 1 : 0;
    const skin = warm * THREE.MathUtils.smoothstep(sat, 0.24, 0.36) * THREE.MathUtils.smoothstep(mx, 50, 90);
    const mask = q === 1 ? 0 : 1 - skin;
    const sp = spec.data[o] / 255;
    orm[o] = Math.round(mask * 255);
    orm[o + 1] = Math.round(THREE.MathUtils.clamp(0.95 - sp * 0.9, 0.3, 0.95) * 255);
    orm[o + 2] = 0;
    orm[o + 3] = 255;
    if (mask > 0.9) { sum[q] += 0.2126 * srgb2lin(r) + 0.7152 * srgb2lin(gg) + 0.0722 * srgb2lin(b); cnt[q]++; }
  }
  writePNG(`${TMP}/o.png`, orm, W, W);
  jpg(`${TMP}/o.png`, `${OUT}/soldier_${av.id}_orm.jpg`, 85);
  // Tint gain per quadrant so that the camo's mean luminance maps to the tint colour.
  const gains = sum.map((s, i) => (cnt[i] ? +(cnt[i] / s).toFixed(3) : 1));
  meta.avatars[av.id] = { tris: [a.tris, lod1Idx.length / 3], gains };
  console.log(av.id, "gains", gains);
  if (!refAvatar) refAvatar = a;
  render(`${S}/out/prev/build_${av.id}.png`, [a.mesh], { tex: col, W: 200, H: 260 });
}

// Animations, retargeted onto avatar a's skeleton (all three share rest rotations).
const src = await loadSource(UAL + "UAL1_Standard.glb");
const rm = await loadSource(UAL + "UAL1_Standard_RM.glb");
const R = makeRetargeter(src, refAvatar.group);
const BODY = new Set(MAP.map((m) => m[1]).filter((n) => !/Finger/.test(n)));
BODY.add("Bip01");
const FINGERS = new Set(MAP.map((m) => m[1]).filter((n) => /Finger/.test(n)));
const want = {
  Idle_Loop: "idle", Walk_Loop: "walk", Jog_Fwd_Loop: "jog", Sprint_Loop: "sprint", Crouch_Idle_Loop: "crouchIdle", Crouch_Fwd_Loop: "crouchWalk",
  Hit_Chest: "hitChest", Hit_Head: "hitHead", Death01: "death",
};
const clips = [];
for (const [sn, id] of Object.entries(want)) {
  const c = src.clips.find((c) => c.name === sn);
  const out = R.retarget(c, { name: id, only: BODY });
  clips.push(out);
  const rmc = rm.clips.find((c) => c.name === sn);
  const sp = rootSpeed(rm, rmc);
  meta.clips[id] = { duration: +c.duration.toFixed(4), stride: +(sp.d * R.hipK).toFixed(4) };
}
// Static finger grip from the two-handed pistol idle.
const grip = R.retarget(src.clips.find((c) => c.name === "Pistol_Idle_Loop"), { name: "grip", only: FINGERS, frames: 1 });
clips.push(grip);
const skel = refAvatar.group.clone(false);
const bonesOnly = new THREE.Group();
bonesOnly.name = "rig";
bonesOnly.add(refAvatar.bones[0].clone(true));
fs.writeFileSync(`${OUT}/anims.glb`, await exportGLB(bonesOnly, clips));
void skel;
fs.writeFileSync(`${OUT}/soldiers.json`, JSON.stringify(meta, null, 1));
console.log(JSON.stringify(meta));
