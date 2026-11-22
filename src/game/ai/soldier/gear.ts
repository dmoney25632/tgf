import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { cyl, dome, ellipsoid, GeoBuilder, loft, paint, rbox, seeded, shade, T, type Paint, type Ring } from "../humanoid/geo";
import { withQuality } from "../humanoid/body";
import { SURF } from "../humanoid/materials";
import type { SoldierIdentity } from "./identity";

/**
 * Procedural kit layered over the Rocketbox parts: boonie hat, goggles,
 * glasses / shades, shemagh, radio, packs, a light chest rig, belt pouches
 * and a holster, knee pads, the marksman's ghillie and the warden's plate
 * armour. Each piece is rigid on one Biped bone and authored in the male
 * avatars' bind space (metres, +X = the soldier's left, +Z forward); on
 * another skeleton (the women) every piece moves with its bone's bind
 * offset. Built once per (kit combination, palette, skeleton) and shared.
 */

/** Male bind-pose joint positions the gear is authored against. */
const REF: Record<string, [number, number, number]> = {
  Bip01_Pelvis: [0, 0.859, 0],
  Bip01_Spine1: [0, 1.122, -0.008],
  Bip01_Spine2: [0, 1.268, -0.019],
  Bip01_Neck: [0, 1.46, -0.012],
  Bip01_Head: [0, 1.524, 0.008],
  Bip01_L_UpperArm: [0.202, 1.371, -0.024],
  Bip01_R_UpperArm: [-0.202, 1.371, -0.024],
  Bip01_L_Thigh: [0.085, 0.859, 0],
  Bip01_R_Thigh: [-0.085, 0.859, 0],
  Bip01_L_Calf: [0.105, 0.477, 0.016],
  Bip01_R_Calf: [-0.105, 0.477, 0.016],
};
type GearBone = keyof typeof REF;

/** Per-bone extra scale about the joint on the female skeleton (narrower shoulders, smaller head). */
const FEMALE_SCALE: Partial<Record<GearBone, [number, number, number]>> = {
  Bip01_Spine2: [0.9, 0.95, 0.92],
  Bip01_Spine1: [0.94, 0.95, 0.94],
  Bip01_Neck: [0.92, 0.95, 0.92],
  Bip01_Head: [0.95, 0.95, 0.95],
};

export type GearPalette = { uniform: number; vest: number; helmet: number; accent: number };

export type SoldierGear = {
  /** Uber-material kit, [near, mid]. */
  kit: [THREE.BufferGeometry | null, THREE.BufferGeometry | null];
  /** Alpha-card ghillie fringe (both LODs). */
  ghillie: THREE.BufferGeometry | null;
  /** Transparent eyewear lenses (near LOD only). */
  lens: { geo: THREE.BufferGeometry; kind: "clear" | "dark" } | null;
};

type CamoStyle = "woodland" | "digital" | "arid";
function camoFor(hex: number): CamoStyle {
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(hex).getHSL(hsl);
  if (hsl.s < 0.09 || hsl.l < 0.16) return "digital";
  const deg = hsl.h * 360;
  if (deg >= 22 && deg < 52 && hsl.l > 0.2) return "arid";
  if (deg >= 52 && deg < 170) return "woodland";
  return "digital";
}
const mix = (a: number, b: number, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();

/** Gear-relevant bits of an identity (the cache key). */
export function gearKey(id: SoldierIdentity, pal: GearPalette, female: boolean) {
  return [
    female ? "f" : "m",
    id.headgear === "boonie" ? 1 : 0,
    id.goggles ? (id.balaclava || id.headgear !== "helmet" ? 2 : 1) : 0,
    id.head === "b" ? "none" : id.eyewear,
    id.shemagh ? (id.tone >> 3) & 3 : -1,
    +id.radio,
    id.pack,
    +id.chestRig,
    +!!id.vest,
    +id.pouches,
    +id.kneePads,
    +id.ghillie,
    id.armour === "warden" ? 1 : 0,
    pal.uniform,
    pal.vest,
    pal.helmet,
    pal.accent,
  ].join("|");
}

/** A strap / bar between two points (box of width w and thickness t). */
function bar(a: THREE.Vector3, b: THREE.Vector3, w: number, t: number, twist = 0) {
  const len = a.distanceTo(b);
  const g = rbox(w, len, t, 6, 4, 0.2);
  const dir = b.clone().sub(a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  if (twist) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), twist));
  return { g, m: new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)) };
}
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

const cache = new Map<string, SoldierGear>();

/**
 * Builds (or returns the cached) gear for an identity.
 * joints: the skeleton's canonical joint names; bindPos: a joint's bind position.
 */
export function soldierGear(id: SoldierIdentity, pal: GearPalette, female: boolean, joints: readonly string[], bindPos: (bone: string) => THREE.Vector3): SoldierGear {
  const key = gearKey(id, pal, female);
  let g = cache.get(key);
  if (g) return g;
  const lens: { b: GeoBuilder; kind: "clear" | "dark" } | null = id.head !== "b" && id.eyewear !== "none" ? { b: new GeoBuilder(), kind: id.eyewear === "shades" ? "dark" : "clear" } : null;
  const near = withQuality(0, () => build(id, pal, lens?.b ?? null));
  const mid = withQuality(1, () => build(id, pal, null));
  const ghillie = id.ghillie ? withQuality(0, () => ghillieCards(id, pal)) : null;
  const place = (parts: Map<GearBone, GeoBuilder>) => skinParts(parts, female, joints, bindPos);
  const lensParts = new Map<GearBone, GeoBuilder>();
  if (lens) lensParts.set("Bip01_Head", lens.b);
  const lensGeo = lens ? place(lensParts) : null;
  g = {
    kit: [place(near), place(mid)],
    ghillie: ghillie ? place(ghillie) : null,
    lens: lensGeo && lens ? { geo: lensGeo, kind: lens.kind } : null,
  };
  cache.set(key, g);
  return g;
}

export function disposeSoldierGear() {
  cache.forEach((g) => {
    g.kit[0]?.dispose();
    g.kit[1]?.dispose();
    g.ghillie?.dispose();
    g.lens?.geo.dispose();
  });
  cache.clear();
}

/** Merges each bone's builder, moves it onto this skeleton's joint and makes it rigidly skinned. */
function skinParts(parts: Map<GearBone, GeoBuilder>, female: boolean, joints: readonly string[], bindPos: (bone: string) => THREE.Vector3) {
  const list: THREE.BufferGeometry[] = [];
  for (const [bone, b] of parts) {
    const geo = b.merge();
    if (!geo) continue;
    const ji = joints.indexOf(bone);
    if (ji < 0) {
      geo.dispose();
      continue;
    }
    const ref = REF[bone];
    const at = bindPos(bone);
    const s = female ? FEMALE_SCALE[bone] : undefined;
    // Scale about the reference joint, then move to this skeleton's joint.
    const m = new THREE.Matrix4().makeTranslation(-ref[0], -ref[1], -ref[2]);
    if (s) m.premultiply(new THREE.Matrix4().makeScale(s[0], s[1], s[2]));
    m.premultiply(new THREE.Matrix4().makeTranslation(at.x, at.y, at.z));
    geo.applyMatrix4(m);
    const n = geo.getAttribute("position").count;
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      si[i * 4] = ji;
      sw[i * 4] = 1;
    }
    geo.setAttribute("skinIndex", new THREE.BufferAttribute(si, 4));
    geo.setAttribute("skinWeight", new THREE.BufferAttribute(sw, 4));
    list.push(geo);
  }
  if (!list.length) return null;
  const out = list.length === 1 ? list[0] : mergeGeometries(list, false);
  if (list.length > 1) list.forEach((x) => x.dispose());
  return out;
}

/** The uber-material kit for one LOD. lensB receives the clear / dark lenses (near LOD). */
function build(id: SoldierIdentity, pal: GearPalette, lensB: GeoBuilder | null) {
  const parts = new Map<GearBone, GeoBuilder>();
  const B = (bone: GearBone) => {
    let b = parts.get(bone);
    if (!b) parts.set(bone, (b = new GeoBuilder()));
    return b;
  };
  const add = (bone: GearBone, g: THREE.BufferGeometry, p: Paint, m?: THREE.Matrix4) => B(bone).add(g, p, m);
  const addBar = (bone: GearBone, a: THREE.Vector3, b: THREE.Vector3, w: number, t: number, p: Paint) => {
    const s = bar(a, b, w, t);
    add(bone, s.g, p, s.m);
  };

  const camo = SURF[camoFor(pal.uniform)];
  const nylon = paint(pal.vest, SURF.nylon, 0.85);
  const molle = paint(pal.vest, SURF.molle, 0.85);
  const nylonD = shade(nylon, 0.72);
  const strap = paint(mix(pal.vest, 0x1c1c1a, 0.45), SURF.nylon, 0.9);
  const rubber = paint(0x1d1e1f, SURF.hard, 0.7);
  const plastic = paint(0x2a2c2d, SURF.hard, 0.5);
  const metal = paint(0x45484b, SURF.hard, 0.4, 0.7);
  const vested = !!id.vest;
  /** Back surface (z) of the torso at a height, with or without the plate carrier. */
  const backZ = (y: number) => {
    const pts: [number, number][] = vested
      ? [[0.98, -0.12], [1.08, -0.15], [1.2, -0.235], [1.3, -0.245], [1.38, -0.205], [1.46, -0.15]]
      : [[0.98, -0.11], [1.08, -0.135], [1.2, -0.215], [1.3, -0.225], [1.38, -0.19], [1.46, -0.14]];
    if (y <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (y <= pts[i][0]) {
        const t = (y - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
        return pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t;
      }
    }
    return pts[pts.length - 1][1];
  };

  // ---- Head ----------------------------------------------------------------
  if (id.headgear === "boonie") {
    const hat = paint(mix(pal.uniform, pal.helmet, 0.35), camo, 0.95);
    add("Bip01_Head", loft([{ y: 1.668, rx: 0.098, rz: 0.112, cz: 0.012 }, { y: 1.72, rx: 0.097, rz: 0.11, cz: 0.008 }, { y: 1.755, rx: 0.088, rz: 0.1, cz: 0.004 }, { y: 1.768, rx: 0.06, rz: 0.07, cz: 0.004 }], 14, false, true), hat);
    add("Bip01_Head", loft([{ y: 1.668, rx: 0.1, rz: 0.114, cz: 0.012 }, { y: 1.69, rx: 0.1, rz: 0.114, cz: 0.012 }], 14, false, false), shade(strap, 0.9));
    // Floppy brim, drooping more at the back and sides.
    add("Bip01_Head", loft([{ y: 1.672, rx: 0.098, rz: 0.112, cz: 0.012 }, { y: 1.664, rx: 0.155, rz: 0.17, cz: 0.014 }, { y: 1.648, rx: 0.172, rz: 0.186, cz: 0.014 }], 16, false, false), hat);
  }
  if (id.goggles) {
    const overEyes = id.balaclava || id.headgear !== "helmet";
    const frame = paint(mix(pal.helmet, 0x202020, 0.5), SURF.hard, 0.6);
    const glass = paint(0x2b3a40, SURF.hard, 0.08, 0.6);
    if (overEyes) {
      add("Bip01_Head", rbox(0.17, 0.058, 0.038, 10, 3, 0.35), frame, T(0, 1.624, 0.112, 0.05));
      add("Bip01_Head", rbox(0.15, 0.044, 0.01, 10, 3, 0.2), glass, T(0, 1.625, 0.132, 0.05));
      add("Bip01_Head", loft([{ y: 1.618, rx: 0.088, rz: 0.104, cz: 0.012 }, { y: 1.636, rx: 0.088, rz: 0.104, cz: 0.012 }], 14, false, false), rubber);
    } else {
      // Pushed up on the helmet brow, strap round the shell.
      add("Bip01_Head", rbox(0.165, 0.055, 0.036, 10, 3, 0.35), frame, T(0, 1.712, 0.128, -0.42));
      add("Bip01_Head", rbox(0.145, 0.042, 0.01, 10, 3, 0.2), glass, T(0, 1.716, 0.147, -0.42));
      add("Bip01_Head", loft([{ y: 1.694, rx: 0.126, rz: 0.138, cz: 0.0 }, { y: 1.712, rx: 0.125, rz: 0.136, cz: 0.0 }], 16, false, false), rubber);
    }
  }
  if (id.eyewear !== "none" && id.head !== "b") {
    const dark = id.eyewear === "shades";
    const rim = paint(dark ? 0x1a1a1b : 0x2e2f30, SURF.hard, 0.35, dark ? 0.2 : 0.5);
    for (const s of [1, -1]) {
      // Rims, temples back to the ears.
      add("Bip01_Head", loft([{ y: -0.002, rx: 0.027, rz: 0.02 }, { y: 0.002, rx: 0.027, rz: 0.02 }], 12, false, false), rim, T(s * 0.033, 1.62, 0.121, Math.PI / 2, 0, 0));
      addBar("Bip01_Head", V(s * 0.06, 1.626, 0.116), V(s * 0.073, 1.624, 0.02), 0.004, 0.006, rim);
      lensB?.add(ellipsoid(0.026, 0.019, 0.004, 10, 6), paint(0xffffff), T(s * 0.033, 1.62, 0.122, 0, s * 0.08, 0));
    }
    addBar("Bip01_Head", V(-0.009, 1.626, 0.126), V(0.009, 1.626, 0.126), 0.004, 0.004, rim);
  }

  // ---- Neck ------------------------------------------------------------------
  if (id.shemagh) {
    const cloth = paint([0xb8a98a, 0x6e6a50, 0x3a3a36, 0x9a8a68][(id.tone >> 3) & 3], SURF.nylon, 0.98);
    const r: Ring[] = [
      { y: 1.405, rx: 0.098, rz: 0.11, cz: -0.012 },
      { y: 1.43, rx: 0.092, rz: 0.104, cz: -0.012 },
      { y: 1.46, rx: 0.08, rz: 0.088, cz: -0.014 },
      { y: 1.49, rx: 0.07, rz: 0.075, cz: -0.012 },
    ];
    add("Bip01_Neck", loft(r, 14, false, false), cloth);
    add("Bip01_Neck", ellipsoid(0.05, 0.035, 0.026, 8, 6), shade(cloth, 0.9), T(0.02, 1.41, 0.085, 0.3, 0, 0.3));
    add("Bip01_Neck", rbox(0.09, 0.11, 0.018, 6, 3, 0.3), cloth, T(0.035, 1.34, 0.1 + (vested ? 0.05 : 0.04), -0.1, 0, 0.12));
  }

  // ---- Chest / back ----------------------------------------------------------
  if (id.chestRig && !vested) {
    // Panel with three rifle-mag pouches, H harness over the shoulders.
    add("Bip01_Spine2", rbox(0.3, 0.17, 0.045, 10, 4, 0.25), molle, T(0, 1.13, 0.168, 0.05));
    for (const x of [-0.08, 0, 0.08]) {
      add("Bip01_Spine2", rbox(0.072, 0.11, 0.038, 8, 4, 0.3), nylon, T(x, 1.17, 0.205, 0.08));
      add("Bip01_Spine2", rbox(0.074, 0.012, 0.042, 6, 4, 0.2), nylonD, T(x, 1.226, 0.204, 0.08));
    }
    for (const s of [1, -1]) {
      addBar("Bip01_Spine2", V(s * 0.13, 1.2, 0.16), V(s * 0.11, 1.4, 0.1), 0.04, 0.008, strap);
      addBar("Bip01_Spine2", V(s * 0.11, 1.4, 0.1), V(s * 0.105, 1.452, -0.03), 0.04, 0.008, strap);
      addBar("Bip01_Spine2", V(s * 0.105, 1.452, -0.03), V(s * 0.1, 1.38, -0.2), 0.04, 0.008, strap);
      addBar("Bip01_Spine2", V(s * 0.1, 1.38, -0.2), V(s * 0.12, 1.16, -0.2), 0.04, 0.008, strap);
      addBar("Bip01_Spine2", V(s * 0.15, 1.1, 0.14), V(s * 0.19, 1.08, -0.05), 0.03, 0.008, strap);
    }
  }
  if (id.pack !== "none") {
    const big = id.pack === "assault";
    const t = big ? 0.15 : 0.055, rx = big ? 0.15 : 0.11;
    const y0 = big ? 1.0 : 1.04, y1 = big ? 1.44 : 1.42;
    const rings: Ring[] = [];
    const n = 6;
    for (let i = 0; i <= n; i++) {
      const y = y0 + ((y1 - y0) * i) / n;
      const edge = i === 0 || i === n ? 0.82 : 1;
      rings.push({ y, rx: rx * edge, rz: (t / 2) * edge, cz: backZ(y) - t / 2 - 0.004, p: 3.4 });
    }
    add("Bip01_Spine2", loft(rings, 12), big ? molle : nylon);
    if (big) {
      add("Bip01_Spine2", rbox(0.2, 0.16, 0.05, 8, 4, 0.3), nylon, T(0, 1.13, backZ(1.13) - t - 0.02));
      add("Bip01_Spine2", rbox(0.22, 0.03, 0.03, 8, 4, 0.3), nylonD, T(0, 1.44, backZ(1.42) - t / 2 - 0.004));
    } else {
      add("Bip01_Spine2", cyl(0.006, 0.006, 0.2, 6), rubber, T(0.08, 1.48, -0.13, 0.5, 0, -0.2));
    }
    if (!vested) {
      for (const s of [1, -1]) {
        addBar("Bip01_Spine2", V(s * 0.1, 1.4, -0.21), V(s * 0.1, 1.455, -0.04), 0.045, 0.01, strap);
        addBar("Bip01_Spine2", V(s * 0.1, 1.455, -0.04), V(s * 0.12, 1.37, 0.12), 0.045, 0.01, strap);
      }
    }
  }
  if (id.radio) {
    const z = backZ(1.28);
    const side = 0.1;
    const zr = id.pack === "none" ? z - 0.02 : z - (id.pack === "assault" ? 0.17 : 0.075);
    const xr = id.pack === "assault" ? 0.17 : side;
    add("Bip01_Spine2", rbox(0.065, 0.16, 0.036, 8, 4, 0.3), plastic, T(xr, 1.27, zr));
    add("Bip01_Spine2", rbox(0.07, 0.05, 0.04, 6, 4, 0.3), nylonD, T(xr, 1.22, zr + 0.002));
    add("Bip01_Spine2", cyl(0.0035, 0.006, 0.34, 6), rubber, T(xr + 0.01, 1.52, zr, -0.08, 0, -0.06));
    // Hand mic clipped to the shoulder strap.
    add("Bip01_Spine2", rbox(0.04, 0.055, 0.018, 6, 4, 0.3), plastic, T(0.12, 1.36, vested ? 0.14 : 0.12, -0.3));
  }

  // ---- Warden plate armour ------------------------------------------------------
  if (id.armour === "warden") {
    const steel = paint(mix(pal.helmet, 0x3c4044, 0.6), SURF.hard, 0.42, 0.55);
    const steelD = shade(steel, 0.7);
    const trim = paint(mix(pal.accent, 0x8a6a2a, 0.3), SURF.hard, 0.35, 0.6);
    // Chest plate over the carrier, gorget, back plate.
    add("Bip01_Spine2", loft([
      { y: 1.04, rx: 0.15, rz: 0.03, cz: 0.2, p: 3 },
      { y: 1.16, rx: 0.17, rz: 0.035, cz: 0.212, p: 3 },
      { y: 1.3, rx: 0.17, rz: 0.035, cz: 0.19, p: 3 },
      { y: 1.37, rx: 0.13, rz: 0.03, cz: 0.165, p: 3 },
    ], 12), steel);
    add("Bip01_Spine2", rbox(0.24, 0.012, 0.01, 6, 4, 0), trim, T(0, 1.33, 0.205, -0.25));
    add("Bip01_Spine2", loft([
      { y: 1.06, rx: 0.15, rz: 0.03, cz: -0.17, p: 3 },
      { y: 1.24, rx: 0.17, rz: 0.035, cz: -0.27, p: 3 },
      { y: 1.38, rx: 0.14, rz: 0.03, cz: -0.235, p: 3 },
    ], 12), steelD);
    add("Bip01_Neck", loft([{ y: 1.37, rx: 0.13, rz: 0.13, cz: -0.02 }, { y: 1.41, rx: 0.115, rz: 0.115, cz: -0.02 }, { y: 1.45, rx: 0.088, rz: 0.09, cz: -0.02 }], 14, false, false), steel);
    add("Bip01_Neck", loft([{ y: 1.448, rx: 0.09, rz: 0.092, cz: -0.02 }, { y: 1.458, rx: 0.09, rz: 0.092, cz: -0.02 }], 14, false, false), trim);
    for (const s of [1, -1]) {
      const bone: GearBone = s > 0 ? "Bip01_L_UpperArm" : "Bip01_R_UpperArm";
      // Layered pauldron over the shoulder, rerebrace down the upper arm.
      const cap = dome(0.1, 0.075, 0.11, () => 1.25, 14, 5, 0.01);
      add(bone, cap, steel, new THREE.Matrix4().compose(V(s * 0.215, 1.39, -0.02), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -s * 0.5)), V(1, 1, 1)));
      const cap2 = dome(0.09, 0.06, 0.1, () => 1.2, 12, 4, 0.008);
      add(bone, cap2, steelD, new THREE.Matrix4().compose(V(s * 0.25, 1.33, -0.02), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -s * 0.75)), V(1, 1, 1)));
      add(bone, rbox(0.012, 0.012, 0.18, 4, 4, 0), trim, T(s * 0.27, 1.355, -0.02, 0, 0, -s * 0.6));
      const thigh: GearBone = s > 0 ? "Bip01_L_Thigh" : "Bip01_R_Thigh";
      add(thigh, loft([{ y: 0.66, rx: 0.07, rz: 0.018, cz: 0.115, cx: s * 0.1 }, { y: 0.84, rx: 0.08, rz: 0.02, cz: 0.135, cx: s * 0.105 }], 8), steel, T(0, 0, 0, 0, 0, 0));
    }
    // Tassets hang from the belt in front.
    for (const s of [1, -1]) add("Bip01_Pelvis", rbox(0.13, 0.15, 0.022, 8, 4, 0.3), steelD, T(s * 0.085, 0.86, 0.165, -0.12, 0, s * 0.06));
    add("Bip01_Pelvis", rbox(0.36, 0.05, 0.25, 12, 4, 0.3), strap, T(0, 0.95, 0.0));
  }

  // ---- Belt kit -----------------------------------------------------------------
  if (id.pouches) {
    // Holster on the right thigh, dump pouch and IFAK on the left / rear.
    add("Bip01_R_Thigh", rbox(0.07, 0.17, 0.05, 8, 4, 0.3), shade(nylon, 0.9), T(-0.185, 0.76, 0.01, 0, 0, 0.06));
    add("Bip01_R_Thigh", rbox(0.032, 0.06, 0.05, 6, 4, 0.3), plastic, T(-0.19, 0.86, 0.02));
    for (const y of [0.8, 0.71]) add("Bip01_R_Thigh", loft([{ y: y - 0.012, rx: 0.09, rz: 0.088, cx: -0.098, cz: 0.012 }, { y: y + 0.012, rx: 0.09, rz: 0.088, cx: -0.098, cz: 0.012 }], 12, false, false), strap);
    add("Bip01_Pelvis", rbox(0.075, 0.1, 0.06, 8, 4, 0.3), molle, T(0.205, 0.95, -0.06, 0, 0.35));
    add("Bip01_Pelvis", rbox(0.13, 0.08, 0.05, 8, 4, 0.3), paint(mix(pal.vest, 0x5a2420, 0.25), SURF.nylon, 0.85), T(0, 0.96, -0.145));
    add("Bip01_Pelvis", rbox(0.06, 0.08, 0.05, 6, 4, 0.3), nylon, T(0.17, 0.96, 0.09, 0, -0.5));
  }
  if (id.kneePads) {
    for (const s of [1, -1]) {
      const bone: GearBone = s > 0 ? "Bip01_L_Calf" : "Bip01_R_Calf";
      add(bone, loft([
        { y: 0.43, rx: 0.048, rz: 0.016, cz: 0.105, cx: s * 0.105, p: 3 },
        { y: 0.48, rx: 0.054, rz: 0.022, cz: 0.12, cx: s * 0.105, p: 3 },
        { y: 0.54, rx: 0.05, rz: 0.018, cz: 0.112, cx: s * 0.105, p: 3 },
      ], 10), rubber);
      add(bone, loft([{ y: 0.445, rx: 0.068, rz: 0.07, cx: s * 0.104, cz: 0.028 }, { y: 0.465, rx: 0.068, rz: 0.07, cx: s * 0.104, cz: 0.028 }], 12, false, false), strap);
      add(bone, rbox(0.028, 0.018, 0.006, 4, 4, 0), metal, T(s * 0.15, 0.455, 0.06, 0, -s * 0.9));
    }
  }
  return parts;
}

/** Marksman's ghillie: burlap cards over the shoulders and back, a hood hanging off the boonie. */
function ghillieCards(id: SoldierIdentity, pal: GearPalette) {
  const r = seeded(91 + (id.tone & 0xff) + id.body.charCodeAt(0) * 7);
  const tones = [pal.uniform, pal.vest, mix(pal.uniform, 0x5c5a2e, 0.5), mix(pal.vest, 0x6a5232, 0.45), mix(pal.uniform, 0x8a8058, 0.4)];
  const card = (b: GeoBuilder, x: number, y: number, z: number, yaw: number, tilt: number, wd: number, ht: number) => {
    const g = new THREE.PlaneGeometry(wd, ht).translate(0, -ht / 2, 0);
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    const tone = paint(tones[Math.floor(r() * tones.length)], SURF.hard, 1);
    tone.color.multiplyScalar(0.8 + r() * 0.4);
    b.add(g, tone, T(x, y, z, tilt, yaw, (r() - 0.5) * 0.5), undefined, true);
  };
  const parts = new Map<GearBone, GeoBuilder>();
  const gs = new GeoBuilder();
  for (let i = 0; i < 56; i++) {
    // Shoulders and upper back, sparse at the front so the rig reads.
    let a = (r() - 0.5) * Math.PI * 2;
    if (Math.abs(a) < 0.9 && r() < 0.75) a = Math.sign(a || 1) * (0.9 + r() * 2.2);
    const y = 1.36 + r() * 0.1;
    card(gs, Math.sin(a) * 0.22, y, -0.03 + Math.cos(a) * 0.17, a, -0.25 - r() * 0.2, 0.1 + r() * 0.06, 0.2 + r() * 0.14);
  }
  parts.set("Bip01_Spine2", gs);
  const gh = new GeoBuilder();
  for (let i = 0; i < 22; i++) {
    let a = (r() - 0.5) * Math.PI * 2;
    if (Math.abs(a) < 0.75) a = Math.sign(a || 1) * (0.75 + r() * 2.4);
    card(gh, Math.sin(a) * 0.168, 1.665, 0.012 + Math.cos(a) * 0.182, a, -0.12 - r() * 0.15, 0.08 + r() * 0.05, 0.11 + r() * 0.1);
  }
  for (let i = 0; i < 9; i++) {
    const a = r() * Math.PI * 2;
    card(gh, Math.sin(a) * 0.06, 1.77, 0.008 + Math.cos(a) * 0.06, a, -1.15, 0.07, 0.13);
  }
  parts.set("Bip01_Head", gh);
  return parts;
}
