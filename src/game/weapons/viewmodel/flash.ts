import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { FlashStyle } from "./guns";

/**
 * Layered first-person muzzle flash: a camera-facing core star (4 variants in
 * a 2×2 atlas), crossed forward petals, and sideways jets for muzzle brakes /
 * revolver cylinder gaps. Two meshes per weapon, additive, bloom-bright.
 */

const S = 128;

function hash(i: number, seed: number) {
  let h = Math.imul(i ^ (seed * 2654435761), 0x45d9f3b);
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth 1D periodic noise over angle. */
function angNoise(a: number, n: number, seed: number) {
  const x = ((a / (Math.PI * 2)) * n + n) % n;
  const i = Math.floor(x);
  const f = x - i;
  const s = f * f * (3 - 2 * f);
  return hash(i % n, seed) * (1 - s) + hash((i + 1) % n, seed) * s;
}

function rgba(w: number, h: number) {
  return new Uint8Array(w * h * 4);
}

function put(d: Uint8Array, i: number, r: number, g: number, b: number, a: number) {
  d[i] = Math.min(255, r * 255);
  d[i + 1] = Math.min(255, g * 255);
  d[i + 2] = Math.min(255, b * 255);
  d[i + 3] = Math.min(255, a * 255);
}

/** 2×2 atlas of star-shaped flash cores. */
function coreAtlas() {
  const W = S * 2;
  const d = rgba(W, W);
  for (let v = 0; v < 4; v++) {
    const ox = (v % 2) * S;
    const oy = Math.floor(v / 2) * S;
    const spikes = 5 + v;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = (x + 0.5) / S - 0.5;
        const dy = (y + 0.5) / S - 0.5;
        const r = Math.hypot(dx, dy) * 2;
        const a = Math.atan2(dy, dx);
        const sp = Math.pow(angNoise(a, spikes * 2, v * 7 + 1), 2.2) * 0.85 + angNoise(a, 23, v + 40) * 0.25;
        const reach = 0.25 + sp * 0.75;
        const star = Math.max(0, 1 - r / reach);
        const core = Math.exp(-r * r * 26);
        const i = (r < 1 ? Math.pow(star, 1.6) * 0.85 : 0) + core;
        const hot = Math.min(1, core * 1.4 + star * 0.3);
        put(d, ((oy + y) * W + ox + x) * 4, 1, 0.55 + hot * 0.45, 0.18 + hot * 0.75, Math.min(1, i));
      }
    }
  }
  return tex(d, W, W);
}

/** Elongated flame tongue (base at v = 0, tip at v = 1). */
function petalTexture() {
  const W = 64;
  const H = 128;
  const d = rgba(W, H);
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    const width = Math.pow(Math.sin(Math.min(1, v * 1.15) * Math.PI * 0.5 + 0.25), 1.2) * (1 - v) * 0.5 + 0.03;
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W - 0.5;
      const n = 0.75 + angNoise(v * 6.28 + u * 3, 9, 3) * 0.5;
      const across = Math.exp(-(u * u) / (width * width * 0.35));
      const along = Math.pow(1 - v, 1.3) * (v < 0.08 ? v / 0.08 : 1);
      const i = across * along * n;
      const hot = Math.exp(-(u * u) / (width * width * 0.06)) * (1 - v);
      put(d, (y * W + x) * 4, 1, 0.45 + hot * 0.5, 0.12 + hot * 0.6, Math.min(1, i * 1.3));
    }
  }
  return tex(d, W, H);
}

function tex(d: Uint8Array, w: number, h: number) {
  const t = new THREE.DataTexture(d, w, h, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export type FlashKit = {
  core: THREE.MeshBasicMaterial;
  petal: THREE.MeshBasicMaterial;
  dispose(): void;
};

export function createFlashKit(): FlashKit {
  const coreTex = coreAtlas();
  coreTex.repeat.set(0.5, 0.5);
  const petalTex = petalTexture();
  const base = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false } as const;
  const core = new THREE.MeshBasicMaterial({ ...base, map: coreTex, color: new THREE.Color(5, 3.6, 2.4) });
  const petal = new THREE.MeshBasicMaterial({ ...base, map: petalTex, color: new THREE.Color(4.2, 2.6, 1.4) });
  return {
    core,
    petal,
    dispose() {
      coreTex.dispose();
      petalTex.dispose();
      core.dispose();
      petal.dispose();
    },
  };
}

/** Plane whose long side runs from the origin along `dir` (lying in the plane rotated `roll` about dir). */
function tongue(len: number, width: number, dir: THREE.Vector3, roll: number, offset: THREE.Vector3) {
  const g = new THREE.PlaneGeometry(width, len);
  g.translate(0, len / 2, 0); // base at origin, tip at +Y
  g.rotateY(roll);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  g.applyQuaternion(q);
  g.translate(offset.x, offset.y, offset.z);
  return g;
}

/** Build the flash group for one weapon (child of its muzzle object). */
export function buildFlash(kit: FlashKit, style: FlashStyle, scale: number, disposables: { dispose(): void }[]) {
  const group = new THREE.Group();
  const cores: THREE.BufferGeometry[] = [];
  const petals: THREE.BufferGeometry[] = [];
  const fwd = new THREE.Vector3(0, 0, -1);
  const o = new THREE.Vector3();
  const coreSize = { brake: 0.11, hider: 0.09, shotgun: 0.17, pistol: 0.09, revolver: 0.13 }[style] * scale;
  cores.push(new THREE.PlaneGeometry(coreSize, coreSize).translate(0, 0, -0.01));
  // Second, smaller core a little ahead for depth.
  cores.push(new THREE.PlaneGeometry(coreSize * 0.6, coreSize * 0.6).translate(0, 0, -0.05 * scale));

  const nPetals = style === "shotgun" ? 4 : style === "hider" ? 4 : 3;
  const len = { brake: 0.16, hider: 0.13, shotgun: 0.24, pistol: 0.1, revolver: 0.17 }[style] * scale;
  const wid = { brake: 0.06, hider: 0.05, shotgun: 0.11, pistol: 0.045, revolver: 0.08 }[style] * scale;
  for (let i = 0; i < nPetals; i++) petals.push(tongue(len, wid, fwd, (i / nPetals) * Math.PI, o));
  if (style === "hider" || style === "shotgun") {
    // Short star prongs splaying outward.
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const d = new THREE.Vector3(Math.cos(a) * 0.55, Math.sin(a) * 0.55, -1);
      petals.push(tongue(len * 0.45, wid * 0.55, d, 0, o));
    }
  }
  if (style === "brake") {
    // Side jets from the brake ports (just behind the muzzle).
    for (const sx of [-1, 1]) {
      for (let p = 0; p < 2; p++) {
        const d = new THREE.Vector3(sx, 0.12, -0.25 + p * 0.2);
        petals.push(tongue(len * 0.42, wid * 0.65, d, 0, new THREE.Vector3(0, 0, 0.018 + p * 0.016)));
        petals.push(tongue(len * 0.42, wid * 0.65, d, Math.PI / 2, new THREE.Vector3(0, 0, 0.018 + p * 0.016)));
      }
    }
  }
  if (style === "revolver") {
    // Cylinder-gap flash, ~0.2 m behind the muzzle.
    for (const sx of [-1, 1]) {
      const d = new THREE.Vector3(sx, 0.35, -0.2);
      petals.push(tongue(0.05, 0.035, d, 0, new THREE.Vector3(sx * 0.012, -0.004, 0.196)));
      petals.push(tongue(0.05, 0.035, d, Math.PI / 2, new THREE.Vector3(sx * 0.012, -0.004, 0.196)));
    }
  }
  const cg = mergeGeometries(cores, false)!;
  const pg = mergeGeometries(petals, false)!;
  for (const g of [...cores, ...petals]) g.dispose();
  disposables.push(cg, pg);
  const cm = new THREE.Mesh(cg, kit.core);
  const pm = new THREE.Mesh(pg, kit.petal);
  cm.frustumCulled = pm.frustumCulled = false;
  cm.renderOrder = pm.renderOrder = 10;
  group.add(pm, cm);
  group.visible = false;
  return { group, core: cm, petals: pm };
}
