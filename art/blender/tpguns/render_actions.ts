// Offline check of how soldiers hold the real third-person guns: builds real
// Humanoids (procedural rig + mocap body + the tp gun from
// public/assets/weapons/tp), drives them into each action and rasterises close
// views on the CPU (no browser, no GPU), one PNG per gun:
//
//   node --experimental-transform-types --no-warnings --import ./tests/register.mjs \
//     art/blender/tpguns/render_actions.ts <outDir> [gun ...] [--poses idle,aim,...] [--views 0.6,1.57]
//
// Poses: idle aim walk run sprint crouch crouchAim fire hit reload1..reload6 throw1..throw5 down.
// Panels are close (upper body) views; the yaw list orbits the camera.
import fs from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import jpeg from "jpeg-js";
import { avatarFromScene, type AvatarMeta, type ClipName, type SoldierAvatar, type SoldierLibrary } from "../../../src/game/ai/soldier/assets";
import { npcIdentity, partSources, type AvatarId } from "../../../src/game/ai/soldier/identity";
import { Humanoid } from "../../../src/game/ai/Humanoid";
import { makeTpGun } from "../../../src/game/ai/humanoid/rifle";
import type { ThirdPersonKind, ViewModelKind } from "../../../src/game/weapons/weapons";
import { ENEMIES } from "../../../src/game/survival/config";
import { writePNG } from "../../../scripts/soldiers/lib.mjs";

(globalThis as { ProgressEvent?: unknown }).ProgressEvent ??= class extends Event {
  constructor(t: string, o: object) {
    super(t);
    Object.assign(this, o);
  }
};
const SOLDIERS = new URL("../../../public/assets/characters/soldiers/", import.meta.url);
const TP = new URL("../../../public/assets/weapons/tp/", import.meta.url);

async function parse(json: string, binFile: URL) {
  const j = JSON.parse(json);
  delete j.images;
  delete j.textures;
  delete j.samplers;
  for (const m of j.materials ?? []) {
    delete m.normalTexture;
    if (m.pbrMetallicRoughness) {
      delete m.pbrMetallicRoughness.baseColorTexture;
      delete m.pbrMetallicRoughness.metallicRoughnessTexture;
    }
  }
  j.extensionsUsed = (j.extensionsUsed ?? []).filter((e: string) => e !== "KHR_texture_basisu");
  j.buffers[0].uri = "data:application/octet-stream;base64," + fs.readFileSync(binFile).toString("base64");
  await MeshoptDecoder.ready;
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(JSON.stringify(j), "");
}

type Tex = { data: Uint8Array; width: number; height: number };
const jpg = (u: URL): Tex => {
  const d = jpeg.decode(fs.readFileSync(u), { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });
  return { data: d.data as Uint8Array, width: d.width, height: d.height };
};

// ---- Tiny rasteriser (adapted from scripts/soldiers/render.mjs): panels in a grid ---------------
type Panel = { meshes: THREE.Mesh[]; yaw: number; center: THREE.Vector3; span: number; label: string };
function draw(path: string, panels: Panel[], cols: number, W: number, H: number) {
  const rows = Math.ceil(panels.length / cols);
  const TW = W * cols, TH = H * rows;
  const img = new Uint8Array(TW * TH * 3).fill(205);
  const L = new THREE.Vector3(0.4, 0.8, 0.6).normalize();
  const v = new THREE.Vector3();
  panels.forEach((pn, pi) => {
    const ox = (pi % cols) * W, oy = Math.floor(pi / cols) * H;
    const zb = new Float32Array(W * H).fill(-1e9);
    const c = Math.cos(pn.yaw), s = Math.sin(pn.yaw);
    const sc = H / pn.span;
    const proj = (x: number, y: number, z: number) => {
      const dx = x - pn.center.x, dz = z - pn.center.z;
      return [W / 2 + (dx * c - dz * s) * sc, H / 2 - (y - pn.center.y) * sc, dx * s + dz * c];
    };
    for (const m of pn.meshes) {
      if (!m.visible) continue;
      let vis = true;
      m.traverseAncestors((a) => (vis &&= a.visible));
      if (!vis) continue;
      m.updateMatrixWorld(true);
      const sm = m as THREE.SkinnedMesh;
      if (sm.isSkinnedMesh) sm.skeleton.update();
      const g = m.geometry, pos = g.attributes.position, uv = g.attributes.uv;
      const P = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        m.getVertexPosition(i, v);
        v.applyMatrix4(m.matrixWorld);
        P[i * 3] = v.x;
        P[i * 3 + 1] = v.y;
        P[i * 3 + 2] = v.z;
      }
      const idx = g.index ? g.index.array : Uint32Array.from({ length: pos.count }, (_, i) => i);
      const tex: Tex | undefined = m.userData.tex;
      const tint: number[] = m.userData.color ?? [170, 170, 170];
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t], b = idx[t + 1], d = idx[t + 2];
        const A = proj(P[a * 3], P[a * 3 + 1], P[a * 3 + 2]), B = proj(P[b * 3], P[b * 3 + 1], P[b * 3 + 2]), C = proj(P[d * 3], P[d * 3 + 1], P[d * 3 + 2]);
        const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]];
        const e2 = [P[d * 3] - P[a * 3], P[d * 3 + 1] - P[a * 3 + 1], P[d * 3 + 2] - P[a * 3 + 2]];
        const n = v.set(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]).normalize();
        const sh = 0.3 + 0.7 * Math.abs(n.dot(L));
        const minX = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0]))), maxX = Math.min(W - 1, Math.ceil(Math.max(A[0], B[0], C[0])));
        const minY = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1]))), maxY = Math.min(H - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
        const area = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
        if (Math.abs(area) < 1e-9) continue;
        for (let y = minY; y <= maxY; y++)
          for (let x = minX; x <= maxX; x++) {
            const px = x + 0.5, py = y + 0.5;
            const w0 = ((B[0] - px) * (C[1] - py) - (B[1] - py) * (C[0] - px)) / area;
            const w1 = ((C[0] - px) * (A[1] - py) - (C[1] - py) * (A[0] - px)) / area;
            const w2 = 1 - w0 - w1;
            if (w0 < 0 || w1 < 0 || w2 < 0) continue;
            const z = w0 * A[2] + w1 * B[2] + w2 * C[2];
            const k = y * W + x;
            if (z <= zb[k]) continue;
            zb[k] = z;
            let col = tint;
            if (tex && uv) {
              const uu = w0 * uv.getX(a) + w1 * uv.getX(b) + w2 * uv.getX(d);
              const vv = w0 * uv.getY(a) + w1 * uv.getY(b) + w2 * uv.getY(d);
              const ix = Math.min(tex.width - 1, Math.max(0, Math.floor((uu - Math.floor(uu)) * tex.width)));
              const iy = Math.min(tex.height - 1, Math.max(0, Math.floor((vv - Math.floor(vv)) * tex.height)));
              const o = (iy * tex.width + ix) * 4;
              col = [tex.data[o], tex.data[o + 1], tex.data[o + 2]];
              if (m.userData.boost) col = col.map((q) => Math.min(255, q * m.userData.boost));
            }
            const K = ((oy + y) * TW + ox + x) * 3;
            img[K] = col[0] * sh;
            img[K + 1] = col[1] * sh;
            img[K + 2] = col[2] * sh;
          }
      }
    }
    // Panel frame.
    for (let x = 0; x < W; x++) for (const y of [0, H - 1]) img.fill(120, ((oy + y) * TW + ox + x) * 3, ((oy + y) * TW + ox + x) * 3 + 3);
    for (let y = 0; y < H; y++) for (const x of [0, W - 1]) img.fill(120, ((oy + y) * TW + ox + x) * 3, ((oy + y) * TW + ox + x) * 3 + 3);
  });
  writePNG(path, img, TW, TH, 3);
}

// ---- Poses --------------------------------------------------------------------------------
type Pose = { name: string; speed: number; crouch: boolean; aim: boolean; pitch: number; act?: "reload" | "throw"; at?: number; fire?: boolean; hit?: boolean; down?: boolean };
const POSES: Record<string, Pose> = {
  idle: { name: "idle", speed: 0, crouch: false, aim: false, pitch: -0.05 },
  aim: { name: "aim", speed: 0, crouch: false, aim: true, pitch: 0 },
  aimUp: { name: "aimUp", speed: 0, crouch: false, aim: true, pitch: 0.4 },
  walk: { name: "walk", speed: 1.6, crouch: false, aim: false, pitch: 0 },
  walkAim: { name: "walkAim", speed: 1.6, crouch: false, aim: true, pitch: 0 },
  run: { name: "run", speed: 4.2, crouch: false, aim: false, pitch: 0 },
  sprint: { name: "sprint", speed: 6.6, crouch: false, aim: false, pitch: 0 },
  crouch: { name: "crouch", speed: 0, crouch: true, aim: false, pitch: 0 },
  crouchAim: { name: "crouchAim", speed: 0, crouch: true, aim: true, pitch: 0 },
  fire: { name: "fire", speed: 0, crouch: false, aim: true, pitch: 0, fire: true },
  hit: { name: "hit", speed: 0, crouch: false, aim: true, pitch: 0, hit: true },
  down: { name: "down", speed: 0, crouch: false, aim: false, pitch: 0, down: true },
};
for (const [i, at] of [0.1, 0.2, 0.36, 0.52, 0.66, 0.9].entries()) POSES[`reload${i + 1}`] = { name: `reload@${at}`, speed: 0, crouch: false, aim: false, pitch: 0, act: "reload", at };
for (const [i, at] of [0.16, 0.36, 0.5, 0.58, 0.7].entries()) POSES[`throw${i + 1}`] = { name: `throw@${at}`, speed: 0, crouch: false, aim: false, pitch: 0, act: "throw", at };

const FAMILY: Partial<Record<ViewModelKind, ThirdPersonKind>> = {
  m4a1: "carbine", hk416: "carbine", m16a4: "carbine", scarl: "carbine", g36: "carbine", akm: "ak", aug: "bullpup", mp5: "smg", uzi: "smg", p90: "p90",
  m249: "lmg", pkm: "pkm", r870: "shotgun", m1014: "shotgun", m24: "bolt", svd: "svd", m82: "m82",
};

/** Prints how far each hand's palm is from its grip anchor (cm) and the IK reach error. */
function measure(h: Humanoid, tp: ReturnType<typeof makeTpGun> & object, name: string) {
  const body = (h as unknown as { mocap: { bone: Map<string, THREE.Object3D> } }).mocap;
  const G = (h as unknown as { gun: THREE.Object3D }).gun.matrixWorld;
  const out: string[] = [name];
  for (const [side, a] of [["R", tp.gripR], ["L", tp.gripL]] as const) {
    const anchor = new THREE.Matrix4().multiplyMatrices(G, a);
    const o = new THREE.Vector3().setFromMatrixPosition(anchor);
    const hand = new THREE.Vector3().setFromMatrixPosition(body.bone.get(`Bip01_${side}_Hand`)!.matrixWorld);
    const f = (n: string) => new THREE.Vector3().setFromMatrixPosition(body.bone.get(`Bip01_${side}_${n}`)!.matrixWorld);
    const palm = f("Finger1").add(f("Finger2")).add(f("Finger3")).add(hand).multiplyScalar(0.25);
    const loc = palm.clone().applyMatrix4(anchor.clone().invert());
    const sh = f("UpperArm"), el = f("Forearm");
    const reach = sh.distanceTo(el) + el.distanceTo(hand);
    out.push(`${side} reach ${(o.distanceTo(sh) * 100).toFixed(0)}/${(reach * 100).toFixed(0)}cm`);
    out.push(`${side}: palm-anchor ${(palm.distanceTo(o) * 100).toFixed(1)}cm local(${loc.toArray().map((x) => (x * 100).toFixed(1)).join(",")})`);
  }
  const inv = G.clone().invert();
  const loc = (n: string) => new THREE.Vector3().setFromMatrixPosition(body.bone.get(n)!.matrixWorld).applyMatrix4(inv).toArray().map((x) => (x * 100).toFixed(0)).join(",");
  out.push(`gun-local shR(${loc("Bip01_R_UpperArm")}) shL(${loc("Bip01_L_UpperArm")}) gripR z${(tp.gripR.elements[14] * 100).toFixed(0)} gripL z${(tp.gripL.elements[14] * 100).toFixed(0)}`);
  console.log(out.join("  "));
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (k: string) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv.splice(i, 2)[1] : null;
  };
  const poses = (opt("--poses") ?? "idle,aim,walk,sprint,crouchAim,fire,reload2,reload3,reload5,throw2,throw3,throw4").split(",");
  const yaws = (opt("--views") ?? "0.7").split(",").map(Number);
  const seed = Number(opt("--seed") ?? 3);
  const span = Number(opt("--span") ?? 1.25);
  const size = Number(opt("--size") ?? 300);
  const procedural = argv.includes("--procedural");
  const [out, ...want] = argv.filter((a) => !a.startsWith("--"));
  fs.mkdirSync(out, { recursive: true });

  const meta = JSON.parse(fs.readFileSync(new URL("soldiers.json", SOLDIERS), "utf8")) as { avatars: Record<AvatarId, AvatarMeta>; clips: SoldierLibrary["info"] };
  const anims = await new GLTFLoader().parseAsync(fs.readFileSync(new URL("anims.glb", SOLDIERS)).buffer.slice(0) as ArrayBuffer, "");
  const clips = new Map<ClipName, THREE.AnimationClip>();
  for (const c of anims.animations) clips.set(c.name as ClipName, c);
  const lib: SoldierLibrary = { clips, info: meta.clips, meta: meta as unknown as SoldierLibrary["meta"] };
  const avatars = new Map<AvatarId, SoldierAvatar>();
  const tex = new Map<AvatarId, Tex>();
  const need = async (id: AvatarId) => {
    if (avatars.has(id)) return;
    const g = await parse(fs.readFileSync(new URL(`soldier_${id}.gltf`, SOLDIERS), "utf8"), new URL(`soldier_${id}.bin`, SOLDIERS));
    avatars.set(id, avatarFromScene(id, g.scene, meta.avatars[id], false));
    tex.set(id, jpg(new URL(`soldier_${id}_color_1k.jpg`, SOLDIERS)));
  };
  const tpFile = JSON.parse(fs.readFileSync(new URL("guns.json", TP), "utf8"));
  const tpScene = (await parse(fs.readFileSync(new URL("model.gltf", TP), "utf8"), new URL("model.bin", TP))).scene;
  const atlas = jpg(new URL("tp_baseColor.jpg", TP));
  const guns = (want.length ? want : Object.keys(tpFile.guns)) as ViewModelKind[];

  for (const gun of guns) {
    const tp = makeTpGun(tpScene, tpFile, gun);
    if (!tp) {
      console.warn(`${gun}: no tp model`);
      continue;
    }
    const panels: Panel[] = [];
    for (const pk of poses) {
      const pose = POSES[pk];
      if (!pose) throw new Error(`unknown pose ${pk}`);
      const def = Object.values(ENEMIES).find((e) => e.kit === "standard")!;
      const base = { ...def.colors, kit: "standard" as const, scale: 1, seed, gun: FAMILY[gun], gunModel: gun };
      const id = npcIdentity(seed, base.kit);
      for (const s of Object.values(partSources(id))) if (s) await need(s);
      const dummy = { name: "x", applyDamage: () => ({ damage: 0, killed: false, counts: false }) };
      const h = new Humanoid(dummy as never, base);
      if (!procedural) h.useTpGun(tp);
      (h as unknown as { attachMocap: (l: SoldierLibrary, m: Map<AvatarId, SoldierAvatar>, look: unknown) => void }).attachMocap(lib, avatars, base);
      h.root.visible = true;
      const scene = new THREE.Scene();
      scene.add(h.root);
      const dt = 1 / 30;
      const step = () => {
        if (pose.speed > 0) h.root.position.z += pose.speed * dt;
        h.update(dt, pose.speed, pose.crouch, pose.pitch, pose.aim, !!pose.down);
      };
      for (let i = 0; i < 75; i++) step();
      if (pose.act) {
        if (pose.act === "reload") h.reload();
        else h.throwGrenade();
        const dur = (h as unknown as { actDur: number }).actDur;
        const n = Math.round((pose.at! * dur) / dt);
        for (let i = 0; i < n; i++) step();
      }
      if (pose.fire) {
        h.fire();
        step();
        step();
      }
      if (pose.hit) {
        h.flinch(false, 1, false);
        for (let i = 0; i < 4; i++) step();
      }
      scene.updateMatrixWorld(true);
      const meshes: THREE.Mesh[] = [];
      h.lod.levels[0].object.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
      });
      for (const m of meshes) {
        const mat = m.material as THREE.MeshStandardMaterial;
        if (mat === tp.material) {
          m.userData.tex = atlas;
          m.userData.boost = 1.6;
        } else if (mat.userData?.soldier) {
          m.userData.tex = tex.get(mat.name.slice(8, 9) as AvatarId);
        } else if (m.name === "grenade") m.userData.color = [70, 90, 50];
        else m.userData.color = [120, 118, 108];
      }
      const root = h.root.position;
      const cy = pose.crouch ? 0.85 : pose.down ? 0.55 : 1.22;
      if (argv.includes("--measure")) measure(h, tp, pose.name);
      // Close views frame the hands: midway between the gun's two grips.
      const G = (h as unknown as { gun: THREE.Object3D }).gun.matrixWorld;
      const mid = new THREE.Vector3().setFromMatrixPosition(tp.gripR).add(new THREE.Vector3().setFromMatrixPosition(tp.gripL)).multiplyScalar(0.5).applyMatrix4(G);
      const center = span < 1 ? mid : new THREE.Vector3(root.x, cy, root.z + 0.15);
      for (const yaw of yaws) panels.push({ meshes, yaw, center, span, label: `${pose.name} ${yaw}` });
    }
    const path = `${out}/${gun}${procedural ? "_proc" : ""}.png`;
    draw(path, panels, Math.min(panels.length, 6), size, size);
    console.log(path, panels.map((p) => p.label).join(" | "));
  }
}

await main();
