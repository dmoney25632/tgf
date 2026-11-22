// Offline preview of the runtime soldier assembly: builds real Humanoids
// (procedural rig + motion-captured body from the shipped glTFs, gear,
// identity, materials) in node and rasterises them with render.mjs,
// emulating the soldier shader's re-tint (camo tint, skin tone, beard,
// balaclava) on the CPU. No browser, no GPU.
//
//   node --experimental-transform-types --no-warnings --import ./tests/register.mjs \
//     scripts/soldiers/assemble.ts out.png "npc:1:standard" "player:2:0xb27c58" ...
//
// Spec: npc:<seed>:<kit>  |  player:<gear>:<skin>. Optional env: POSE=idle|aim|walk|crouch, VIEWS=front|side|both, SPAN, FACE=1 (head close-up).
import fs from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import jpeg from "jpeg-js";
import { avatarFromScene, type AvatarMeta, type ClipName, type SoldierAvatar, type SoldierLibrary } from "../../src/game/ai/soldier/assets";
import { npcIdentity, partSources, playerIdentity, type AvatarId, type Kit } from "../../src/game/ai/soldier/identity";
import { Humanoid } from "../../src/game/ai/Humanoid";
import { attachJuggernautArmor } from "../../src/game/ai/heavy/JuggernautArmor";
import { ENEMIES } from "../../src/game/survival/config";
import { render } from "./render.mjs";

// Node has no ProgressEvent (FileLoader reports progress on data: URIs).
(globalThis as { ProgressEvent?: unknown }).ProgressEvent ??= class extends Event {
  constructor(t: string, o: object) {
    super(t);
    Object.assign(this, o);
  }
};
const DIR = new URL("../../public/assets/characters/soldiers/", import.meta.url);
const file = (f: string) => new URL(f, DIR);
const meta = JSON.parse(fs.readFileSync(file("soldiers.json"), "utf8")) as { avatars: Record<AvatarId, AvatarMeta>; clips: SoldierLibrary["info"] };

async function parse(json: string, bin?: Buffer) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const j = JSON.parse(json);
  // Geometry only: textures come from the JPEGs below.
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
  if (bin) j.buffers[0].uri = "data:application/octet-stream;base64," + bin.toString("base64");
  return loader.parseAsync(JSON.stringify(j), "");
}

type Tex = { data: Uint8Array; width: number; height: number };
const jpg = (f: string): Tex => {
  const d = jpeg.decode(fs.readFileSync(file(f)), { useTArray: true, formatAsRGBA: true });
  return { data: d.data as Uint8Array, width: d.width, height: d.height };
};
const toLin = (c: number) => Math.pow(c / 255, 2.2);
const toSrgb = (c: number) => 255 * Math.pow(Math.min(1, Math.max(0, c)), 1 / 2.2);
const sample = (t: Tex, u: number, v: number, o: number[]) => {
  const x = Math.min(t.width - 1, Math.max(0, Math.floor(u * t.width)));
  const y = Math.min(t.height - 1, Math.max(0, Math.floor(v * t.height)));
  const i = (y * t.width + x) * 4;
  o[0] = t.data[i]; o[1] = t.data[i + 1]; o[2] = t.data[i + 2];
  return o;
};
const hash = (x: number, y: number) => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
};
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** CPU port of the soldier shader's map_fragment patch (assets.ts soldierMaterial). */
function avatarShade(orm: Tex, U: Record<string, { value: THREE.Color | THREE.Vector3 | THREE.Vector4 | number }>) {
  const o = [0, 0, 0];
  return (col: number[], u: number, v: number, geo: THREE.BufferGeometry, a: number, b: number, d: number, w0: number, w1: number, w2: number) => {
    sample(orm, u, v, o);
    const R = o[0] / 255, Bm = o[2] / 255;
    let c = [toLin(col[0]), toLin(col[1]), toLin(col[2])];
    const top = v < 0.5, right = u > 0.5, head = top && right;
    const tint = (top ? (right ? U.uTintHelmet : U.uTintBody) : right ? U.uTintVest : U.uTintHelmet).value as THREE.Color;
    const g = U.uGain.value as THREE.Vector4;
    const gain = top ? (right ? g.y : g.x) : right ? g.w : g.z;
    const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const k = R * (gain > 0 ? 1 : 0), L = Math.min(lum * gain, 2.5);
    c = [c[0] + (tint.r * L - c[0]) * k, c[1] + (tint.g * L - c[1]) * k, c[2] + (tint.b * L - c[2]) * k];
    const sk = (head ? U.uSkinHead : U.uSkinBody).value as THREE.Vector3;
    c = [c[0] * (1 + (sk.x - 1) * Bm), c[1] * (1 + (sk.y - 1) * Bm), c[2] * (1 + (sk.z - 1) * Bm)];
    if (head) {
      const m1 = geo.getAttribute("uv1") as THREE.BufferAttribute;
      const mx = m1.getX(a) * w0 + m1.getX(b) * w1 + m1.getX(d) * w2;
      const my = m1.getY(a) * w0 + m1.getY(b) * w1 + m1.getY(d) * w2;
      const n = hash(Math.floor(u * 1400), Math.floor(v * 1400));
      const bb = mx * (U.uBeard.value as number);
      const hair = bb * smooth(0.25, 0.75, n + bb * 0.6);
      const f = Math.min(0.92, hair * 1.4) * Bm;
      c = [c[0] * (1 - f * 0.84), c[1] * (1 - f * 0.87), c[2] * (1 - f * 0.89)];
      const knit = (U.uBalaclava.value as number) * (1 - smooth(0.35, 0.75, my));
      if (knit > 0) {
        const kc = U.uKnit.value as THREE.Color;
        const rib = 0.82 + 0.18 * Math.sin(u * 2600) * (0.7 + 0.3 * hash(Math.floor(u * 700), Math.floor(v * 700)));
        c = [c[0] + (kc.r * rib - c[0]) * knit, c[1] + (kc.g * rib - c[1]) * knit, c[2] + (kc.b * rib - c[2]) * knit];
      }
    }
    return [toSrgb(c[0] * 1.25), toSrgb(c[1] * 1.25), toSrgb(c[2] * 1.25)];
  };
}

const WHITE: Tex = { data: new Uint8Array([255, 255, 255, 255]), width: 1, height: 1 };
/** Vertex-coloured (linear) meshes: uber gear, rifle, armour. */
function vertexShade(mul = 1.25) {
  return (_c: number[], _u: number, _v: number, geo: THREE.BufferGeometry, a: number, b: number, d: number, w0: number, w1: number, w2: number) => {
    const C = geo.getAttribute("color") as THREE.BufferAttribute | undefined;
    if (!C) return [150, 150, 150];
    const ch = (i: number) => toSrgb((C.getComponent(a, i) * w0 + C.getComponent(b, i) * w1 + C.getComponent(d, i) * w2) * mul);
    return [ch(0), ch(1), ch(2)];
  };
}

async function main() {
  const [out, ...specs] = process.argv.slice(2);
  const anims = await new GLTFLoader().parseAsync(fs.readFileSync(file("anims.glb")).buffer.slice(0) as ArrayBuffer, "");
  const clips = new Map<ClipName, THREE.AnimationClip>();
  for (const c of anims.animations) clips.set(c.name as ClipName, c);
  const lib: SoldierLibrary = { clips, info: meta.clips, meta: meta as unknown as SoldierLibrary["meta"] };

  const avatars = new Map<AvatarId, SoldierAvatar>();
  const tex = new Map<AvatarId, { color: Tex; orm: Tex }>();
  const need = async (id: AvatarId) => {
    if (avatars.has(id)) return;
    const g = await parse(fs.readFileSync(file(`soldier_${id}.gltf`), "utf8"), fs.readFileSync(file(`soldier_${id}.bin`)));
    avatars.set(id, avatarFromScene(id, g.scene, meta.avatars[id], false));
    tex.set(id, { color: jpg(`soldier_${id}_color_1k.jpg`), orm: jpg(`soldier_${id}_orm.jpg`) });
  };

  const pose = process.env.POSE ?? "idle";
  const meshes: THREE.Object3D[] = [];
  const gap = 0.85;
  let k = 0;
  for (const spec of specs) {
    const [kind, a, b] = spec.split(":");
    const base = kind === "player" ? { uniform: 0x5b6148, vest: 0x4b4a38, helmet: 0x55553f, accent: 0xc0392b, skin: Number(b), kit: "standard" as const, scale: 1, variant: Number(a) } : (() => {
      const kit = (b ?? "standard") as Kit;
      const def = Object.values(ENEMIES).find((e) => e.kit === kit)!;
      return { ...def.colors, kit, scale: 1, seed: Number(a) };
    })();
    const id = kind === "player" ? playerIdentity(Number(a), Number(b)) : npcIdentity(Number(a), base.kit);
    for (const s of Object.values(partSources(id))) if (s) await need(s);
    const dummy = { name: "x", applyDamage: () => ({ damage: 0, killed: false, counts: false }) };
    const h = new Humanoid(dummy as never, base);
    if (base.kit === "heavy") attachJuggernautArmor(h);
    (h as unknown as { attachMocap: (l: SoldierLibrary, m: Map<AvatarId, SoldierAvatar>, look: unknown) => void }).attachMocap(lib, avatars, base);
    h.root.position.x = k++ * gap;
    h.root.rotation.y = Number(process.env.YAW ?? 0);
    h.root.visible = true;
    const scene = new THREE.Scene();
    scene.add(h.root);
    for (let i = 0; i < 60; i++) {
      const sp = pose === "walk" ? 1.4 : 0;
      if (pose === "walk") h.root.position.z += sp / 30;
      h.update(1 / 30, sp, pose === "crouch", pose === "aim" ? -0.05 : 0.05, pose === "aim");
    }
    h.root.position.z = 0;
    h.update(1 / 30, 0, pose === "crouch", 0.05, pose === "aim");
    scene.updateMatrixWorld(true);
    const near = h.lod.levels[0].object;
    near.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o);
    });
    // Attachments (Juggernaut plates on the mocap sockets).
    h.root.traverse((o) => {
      if (o.name === "jugArmor" && o.visible && o.parent?.name.startsWith("socket_")) {
        o.traverse((x) => {
          if ((x as THREE.Mesh).isMesh) meshes.push(x);
        });
      }
    });
    console.log(spec, JSON.stringify(id));
  }
  // Shading per mesh.
  for (const o of meshes) {
    const m = o as THREE.Mesh;
    const mat = m.material as THREE.MeshStandardMaterial;
    const U = mat.userData?.soldier;
    if (U) {
      // Which avatar's atlas: materials are named soldier_<id>|...
      const aid = mat.name.slice(8, 9) as AvatarId;
      const t = tex.get(aid)!;
      m.userData.tex = t.color;
      m.userData.gltfUV = true;
      m.userData.shade = avatarShade(t.orm, U);
    } else if (mat.transparent) {
      m.userData.tex = WHITE;
      m.userData.shade = () => [40, 44, 48];
    } else {
      m.userData.tex = WHITE;
      m.userData.shade = vertexShade(mat.map ? 1.1 : 1.25);
    }
  }
  const face = process.env.FACE === "1";
  const views = process.env.VIEWS === "side" ? [{ yaw: Math.PI / 2 }] : process.env.VIEWS === "both" ? [{ yaw: 0 }, { yaw: Math.PI / 2 }] : process.env.VIEWS === "back" ? [{ yaw: Math.PI }] : [{ yaw: 0.35 }];
  const n = specs.length;
  const span = Number(process.env.SPAN ?? (face ? 0.55 : 2.0));
  const H = Number(process.env.H ?? 420);
  const W = Math.round(((n - 1) * gap + (face ? 0.6 : 0.9)) * (H / span));
  render(out, meshes, { W, H, views, center: new THREE.Vector3(((n - 1) * gap) / 2, face ? 1.6 : 0.95, 0), span, bg: 225 });
}

await main();
