// Offline check of the first-person arms: builds the real WeaponViewmodel in
// node, installs the skinned arms from public/assets/characters/fparms, poses
// a weapon (hip, ADS, mid-reload, melee, grenade...) and rasterises the
// viewmodel scene on the CPU into a PNG (no GPU / browser needed).
//
//   node --experimental-transform-types --no-warnings --import ./tests/register.mjs \
//     scripts/fparms/render-viewmodel.ts <out dir> [scenario ...]
//
// Scenarios: see SCENES below ("all" renders every one). Add ":proc" to a
// name to render the procedural fallback arms instead (e.g. m4a1:proc).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import * as THREE from "three";
import jpeg from "jpeg-js";
import { WeaponViewmodel, type ViewmodelState } from "../../src/game/weapons/WeaponViewmodel";
import { WEAPONS, type WeaponDef } from "../../src/game/weapons/weapons";
import { REAL_GUNS } from "../../src/game/weapons/viewmodel/realGuns";
import { prepareRealGun } from "../../src/game/weapons/viewmodel/realFit";
import { loadGltfGeometry } from "../../tests/realGunsHelpers";

const ROOT = process.cwd();
const OUT = process.argv[2];
const W = 1280;
const H = 720;

type Scene = { model: WeaponDef["model"]; state?: Partial<ViewmodelState>; real?: boolean; colors?: [number, number] };
const SCENES: Record<string, Scene> = {
  m4a1: { model: "m4a1" },
  m4a1_real: { model: "m4a1", real: true },
  m4a1_ads: { model: "m4a1", state: { ads: 1 } },
  m4a1_reload: { model: "m4a1", state: { reload: 0.3 } },
  m4a1_reload2: { model: "m4a1", state: { reload: 0.72, reloadEmpty: true } },
  m4a1_sprint: { model: "m4a1", state: { sprint: 1 } },
  m4a1_tan: { model: "m4a1", colors: [0x7a6a4a, 0x8a7a5a] },
  akm: { model: "akm" },
  mp5: { model: "mp5" },
  p90: { model: "p90" },
  m249: { model: "m249" },
  m249_reload: { model: "m249", state: { reload: 0.4 } },
  r870: { model: "r870" },
  r870_pump: { model: "r870", state: { sinceShot: 0.35 } },
  r870_shell: { model: "r870", state: { shellReload: true, reload: 0.1 } },
  m24: { model: "m24" },
  m24_bolt: { model: "m24", state: { sinceShot: 0.55 } },
  m9: { model: "m9" },
  m9_reload: { model: "m9", state: { reload: 0.45 } },
  sw629: { model: "sw629" },
  sw629_reload: { model: "sw629", state: { reload: 0.5 } },
  knife: { model: "knife" },
  knife_slash: { model: "knife", state: { melee: 0.35, meleeKind: "slash" } },
  quick_knife: { model: "m4a1", state: { melee: 0.22, meleeKind: "quick" } },
  grenade: { model: "m4a1", state: { throwing: 0.3 } },
};

const baseState: ViewmodelState = {
  ads: 0, sprint: 0, slide: 0, bobDistance: 0, bobAmount: 0, yawDelta: 0, pitchDelta: 0, reload: -1, reloadEmpty: false, lowered: 0,
  grounded: true, melee: -1, throwing: -1, sinceShot: 9, shellReload: false,
};

function decodeJpeg(path: string) {
  const img = jpeg.decode(readFileSync(path), { useTArray: true, formatAsRGBA: true });
  return { w: img.width, h: img.height, d: img.data };
}
const srgb2lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const LUT = new Float32Array(256).map((_, i) => srgb2lin(i));

function writePNG(path: string, rgb: Uint8Array, w: number, h: number) {
  const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, body: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(body.length); const tb = Buffer.concat([Buffer.from(type), body]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(tb)); return Buffer.concat([l, tb, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgb.buffer, y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

/** Rasterises every visible mesh of the viewmodel scene from its camera. */
function rasterise(vm: WeaponViewmodel, cam: THREE.PerspectiveCamera, tex: { color: ReturnType<typeof decodeJpeg>; orm: ReturnType<typeof decodeJpeg> }, tints: THREE.Color[]) {
  const color = new Float32Array(W * H * 3);
  const zb = new Float32Array(W * H).fill(Infinity);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = (y * W + x) * 3, g = 0.05 + 0.05 * (1 - y / H);
    color[k] = g * 1.1; color[k + 1] = g * 1.15; color[k + 2] = g * 1.3;
  }
  cam.updateMatrixWorld(true);
  vm.scene.updateMatrixWorld(true);
  const L = new THREE.Vector3(0.45, 0.8, 0.4).normalize();
  const F = new THREE.Vector3(-0.6, 0.2, 0.7).normalize();
  const proj = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  const v = new THREE.Vector3();
  const meshes: THREE.Mesh[] = [];
  vm.scene.traverseVisible((o) => { if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).material && !(o as THREE.Mesh).userData.skipRaster) meshes.push(o as THREE.Mesh); });
  for (const mesh of meshes) {
    const mat = mesh.material as THREE.Material;
    if (mat.blending === THREE.AdditiveBlending || (mat as THREE.MeshBasicMaterial).isMeshBasicMaterial) continue;
    const g = mesh.geometry;
    const pos = g.attributes.position;
    const n = pos.count;
    const skinned = (mesh as THREE.SkinnedMesh).isSkinnedMesh;
    if (skinned) (mesh as THREE.SkinnedMesh).skeleton.update();
    const P = new Float32Array(n * 3); // view space
    const S = new Float32Array(n * 3); // screen x, y, 1/w
    const view = new THREE.Matrix4().multiplyMatrices(cam.matrixWorldInverse, mesh.matrixWorld);
    for (let i = 0; i < n; i++) {
      if (skinned) (mesh as THREE.SkinnedMesh).getVertexPosition(i, v);
      else v.fromBufferAttribute(pos, i);
      v.applyMatrix4(mesh.matrixWorld);
      const w4 = new THREE.Vector4(v.x, v.y, v.z, 1).applyMatrix4(proj);
      v.applyMatrix4(cam.matrixWorldInverse);
      P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
      S[i * 3] = (w4.x / w4.w * 0.5 + 0.5) * W; S[i * 3 + 1] = (1 - (w4.y / w4.w * 0.5 + 0.5)) * H; S[i * 3 + 2] = 1 / w4.w;
    }
    void view;
    const idx = g.index ? g.index.array : null;
    const tc = idx ? idx.length : n;
    // Smooth normals (skinned) from the deformed surface; flat for the gun.
    let NV: Float32Array | null = null;
    if (skinned && idx) {
      NV = new Float32Array(n * 3);
      const keyOf = new Map<string, number>();
      const rep = new Int32Array(n);
      for (let i = 0; i < n; i++) {
        const sp = g.attributes.position;
        const key = `${sp.getX(i).toFixed(5)},${sp.getY(i).toFixed(5)},${sp.getZ(i).toFixed(5)}`;
        if (!keyOf.has(key)) keyOf.set(key, i);
        rep[i] = keyOf.get(key)!;
      }
      for (let t = 0; t < tc; t += 3) {
        const a = idx[t], b = idx[t + 1], c = idx[t + 2];
        const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]];
        const e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
        const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
        for (const q of [a, b, c]) { const r = rep[q]; NV[r * 3] += nx; NV[r * 3 + 1] += ny; NV[r * 3 + 2] += nz; }
      }
      for (let i = 0; i < n; i++) { const r = rep[i]; NV[i * 3] = NV[r * 3]; NV[i * 3 + 1] = NV[r * 3 + 1]; NV[i * 3 + 2] = NV[r * 3 + 2]; }
    }
    const col = g.attributes.color;
    const surf = g.attributes.surf;
    const uv = g.attributes.uv;
    const pbr = g.attributes.pbr;
    for (let t = 0; t < tc; t += 3) {
      const a = idx ? idx[t] : t, b = idx ? idx[t + 1] : t + 1, c = idx ? idx[t + 2] : t + 2;
      if (S[a * 3 + 2] <= 0 || S[b * 3 + 2] <= 0 || S[c * 3 + 2] <= 0) continue;
      const ax = S[a * 3], ay = S[a * 3 + 1], bx = S[b * 3], by = S[b * 3 + 1], cx = S[c * 3], cy = S[c * 3 + 1];
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(area) < 1e-9) continue;
      // Face normal (view space), facing the camera.
      const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]];
      const e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
      const fn = new THREE.Vector3(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]).normalize();
      const toCam = new THREE.Vector3(-P[a * 3], -P[a * 3 + 1], -P[a * 3 + 2]).normalize();
      const flip = fn.dot(toCam) < 0 ? -1 : 1;
      let base: number[] | null = null;
      let rough = 0.7;
      let metal = 0;
      if (!skinned) {
        base = col ? [col.getX(a), col.getY(a), col.getZ(a)] : [0.3, 0.3, 0.3];
        if (surf && surf.getY(a) > 0.5) { const tt = tints[Math.round(surf.getY(a) - 1)]; base = [base[0] * tt.r, base[1] * tt.g, base[2] * tt.b]; }
        if (pbr) { metal = pbr.getX(a); rough = pbr.getY(a); }
        if (!col) { base = [0.32, 0.32, 0.33]; rough = 0.5; }
      }
      const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxX = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
      const minY = Math.max(0, Math.floor(Math.min(ay, by, cy))), maxY = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
        const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const iw = w0 * S[a * 3 + 2] + w1 * S[b * 3 + 2] + w2 * S[c * 3 + 2];
        const z = 1 / iw;
        const k = y * W + x;
        if (z >= zb[k]) continue;
        zb[k] = z;
        const q0 = w0 * S[a * 3 + 2] / iw, q1 = w1 * S[b * 3 + 2] / iw, q2 = w2 * S[c * 3 + 2] / iw;
        let nrm = fn.clone().multiplyScalar(flip);
        let alb: number[];
        if (skinned && uv) {
          const u = q0 * uv.getX(a) + q1 * uv.getX(b) + q2 * uv.getX(c);
          const vv = q0 * uv.getY(a) + q1 * uv.getY(b) + q2 * uv.getY(c);
          const tx = tex.color, ix = Math.min(tx.w - 1, Math.max(0, Math.floor(u * tx.w))), iy = Math.min(tx.h - 1, Math.max(0, Math.floor(vv * tx.h)));
          const o = (iy * tx.w + ix) * 4;
          const om = tex.orm, ox = Math.min(om.w - 1, Math.floor(u * om.w)), oy = Math.min(om.h - 1, Math.floor(vv * om.h));
          const oo = (oy * om.w + ox) * 4;
          const tint = tints[om.d[oo] > 127 ? 0 : 1];
          alb = [LUT[tx.d[o]] * 4 * tint.r, LUT[tx.d[o + 1]] * 4 * tint.g, LUT[tx.d[o + 2]] * 4 * tint.b];
          rough = om.d[oo + 1] / 255;
          if (NV) {
            nrm = new THREE.Vector3(
              q0 * NV[a * 3] + q1 * NV[b * 3] + q2 * NV[c * 3],
              q0 * NV[a * 3 + 1] + q1 * NV[b * 3 + 1] + q2 * NV[c * 3 + 1],
              q0 * NV[a * 3 + 2] + q1 * NV[b * 3 + 2] + q2 * NV[c * 3 + 2],
            ).normalize();
            if (nrm.dot(fn) * flip < 0) nrm.negate();
          }
        } else alb = base!;
        const vpos = new THREE.Vector3(q0 * P[a * 3] + q1 * P[b * 3] + q2 * P[c * 3], q0 * P[a * 3 + 1] + q1 * P[b * 3 + 1] + q2 * P[c * 3 + 1], q0 * P[a * 3 + 2] + q1 * P[b * 3 + 2] + q2 * P[c * 3 + 2]);
        const vdir = vpos.clone().negate().normalize();
        const ndl = Math.max(0, nrm.dot(L));
        const fill = Math.max(0, nrm.dot(F)) * 0.25;
        const hemi = 0.22 + 0.12 * nrm.y;
        const hv = L.clone().add(vdir).normalize();
        const spec = Math.pow(Math.max(0, nrm.dot(hv)), 2 / Math.max(0.02, rough * rough * rough) ) * (1 - rough) * (metal > 0.5 ? 1.2 : 0.35);
        const kd = 1 - metal * 0.8;
        for (let ch = 0; ch < 3; ch++) {
          const s = metal > 0.5 ? alb[ch] * spec + 0.04 : spec * 0.6;
          color[k * 3 + ch] = alb[ch] * kd * (ndl * 2.0 + fill + hemi) + s + alb[ch] * metal * 0.25;
        }
      }
    }
  }
  const out = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H * 3; i++) {
    const c = color[i] / (1 + color[i] * 0.25);
    const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
    out[i] = Math.max(0, Math.min(255, Math.round(s * 255)));
  }
  return out;
}

const defFor = (model: WeaponDef["model"]) => Object.values(WEAPONS).find((w) => w.model === model) as WeaponDef;

async function main() {
  mkdirSync(OUT, { recursive: true });
  let names = process.argv.slice(3);
  if (!names.length || names.includes("all")) names = Object.keys(SCENES);
  const armsScene = await loadGltfGeometry(ROOT, "assets/characters/fparms/fparms.gltf");
  const tex = { color: decodeJpeg(join(ROOT, "public/assets/characters/fparms/fparms_color.jpg")), orm: decodeJpeg(join(ROOT, "public/assets/characters/fparms/fparms_orm.jpg")) };
  for (const raw of names) {
    const [name, flag] = raw.split(":");
    const sc = SCENES[name];
    if (!sc) throw new Error(`unknown scene ${name}`);
    const vm = new WeaponViewmodel(null);
    vm.setAspect(W / H);
    if (flag !== "proc") {
      vm.arms.setTemplate(armsScene);
      vm.useSkinnedArms();
    }
    if (sc.colors) vm.setOperatorColors(sc.colors[0], sc.colors[1]);
    if (sc.real && REAL_GUNS[sc.model]) {
      const cfg = REAL_GUNS[sc.model]!;
      const g = await loadGltfGeometry(ROOT, cfg.path.replace(/^\//, ""));
      const priv = vm as unknown as { real: Map<string, unknown>; models: Map<string, unknown> };
      priv.real.set(sc.model, prepareRealGun(g, cfg));
      priv.models.delete(sc.model);
    }
    const def = defFor(sc.model);
    vm.setWeapon(def);
    const st = { ...baseState, ...sc.state };
    vm.debug = sc.state ?? {};
    for (let i = 0; i < 60; i++) vm.update(1 / 60, st);
    const tints = (vm as unknown as { mats: { tints: THREE.Color[] } }).mats.tints;
    let cam = vm.camera;
    if (flag === "side" || flag === "top" || flag === "front") {
      // Debug views around the gun (third person).
      cam = new THREE.PerspectiveCamera(40, W / H, 0.01, 10);
      const at = new THREE.Vector3(0.05, -0.18, -0.28);
      cam.position.copy(at).add(flag === "side" ? new THREE.Vector3(0.9, 0.05, 0) : flag === "top" ? new THREE.Vector3(0, 0.9, 0.001) : new THREE.Vector3(0, 0, -0.9));
      cam.lookAt(at);
    }
    const img = rasterise(vm, cam, tex, tints);
    const file = join(OUT, `${raw.replace(":", "_")}.png`);
    writePNG(file, img, W, H);
    console.log(file);
  }
}

await main();
