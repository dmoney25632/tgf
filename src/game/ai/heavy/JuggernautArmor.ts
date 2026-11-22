import * as THREE from "three";
import type { Humanoid } from "../Humanoid";
import type { BoneName } from "../humanoid/rig";
import { PartGeometry } from "../../content/PartGeometry";

/**
 * Extra bolt-on heavy armour for the Juggernaut, layered over the Humanoid's
 * "heavy" kit: a closed EOD-style helmet with a glowing visor slit, a gorget,
 * layered chest/back plates with a battery pack, abdomen lames, tassets,
 * pauldrons, thigh plates and greaves.
 *
 * Built once (shared geometry + two shared materials), then parented to the
 * Humanoid's bones so it follows the animation. The bones are found through
 * the public hitbox proxies (each proxy is parented to its bone), so this
 * file does not depend on Humanoid internals.
 */

type Slot = "head" | "spine" | "pelvis" | "uArm" | "thigh" | "shin";
const SLOTS: [BoneName, Slot, boolean][] = [
  ["head", "head", false],
  ["spine", "spine", false],
  ["pelvis", "pelvis", false],
  ["uArmR", "uArm", false],
  ["uArmL", "uArm", true],
  ["thighR", "thigh", false],
  ["thighL", "thigh", true],
  ["shinR", "shin", false],
  ["shinL", "shin", true],
];

const STEEL = 0x45494c;
const STEEL_D = 0x2c2f31;
const STEEL_L = 0x5d6266;
const HAZARD = 0xb8692e;
const STRAP = 0x23221f;

let cache: { geo: Record<Slot, THREE.BufferGeometry>; geoL: Record<Slot, THREE.BufferGeometry>; visor: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial; glow: THREE.MeshBasicMaterial } | null = null;

function build() {
  const P = () => new PartGeometry();

  const head = P()
    .blob(0.165, 0.155, 0.175, STEEL, 0, 0.145, 0.0, 14) // shell
    .box(0.22, 0.09, 0.07, STEEL_D, 0, 0.11, 0.145) // visor frame
    .box(0.19, 0.085, 0.06, STEEL_L, 0, 0.035, 0.135, -0.25) // chin guard
    .box(0.27, 0.07, 0.1, STEEL_D, 0, 0.03, -0.125, 0.35) // neck guard
    .box(0.05, 0.06, 0.18, STEEL_D, 0.165, 0.12, 0) // ear cups
    .box(0.05, 0.06, 0.18, STEEL_D, -0.165, 0.12, 0)
    .box(0.03, 0.02, 0.2, HAZARD, 0, 0.29, 0.0); // crest stripe

  const spine = P()
    .box(0.44, 0.36, 0.075, STEEL, 0, 0.23, 0.175, -0.06) // chest plate
    .box(0.36, 0.16, 0.05, STEEL_L, 0, 0.32, 0.215, -0.1) // upper chest plate
    .box(0.06, 0.02, 0.01, HAZARD, 0.12, 0.38, 0.245) // hazard tabs
    .box(0.06, 0.02, 0.01, HAZARD, -0.12, 0.38, 0.245)
    .box(0.42, 0.38, 0.07, STEEL_D, 0, 0.23, -0.17) // back plate
    .box(0.3, 0.3, 0.13, STEEL_D, 0, 0.25, -0.26) // battery / ammo pack
    .box(0.32, 0.04, 0.14, STRAP, 0, 0.12, -0.26)
    .cyl(0.05, 0.05, 0.22, 8, STEEL_L, 0.11, 0.25, -0.34, 0, 0, Math.PI / 2) // feed housing
    .box(0.07, 0.34, 0.26, STEEL, 0.225, 0.2, 0) // side plates
    .box(0.07, 0.34, 0.26, STEEL, -0.225, 0.2, 0)
    .cyl(0.17, 0.2, 0.09, 12, STEEL_D, 0, 0.44, 0) // gorget
    .box(0.36, 0.06, 0.06, STEEL, 0, 0.07, 0.17, 0.08) // abdomen lames
    .box(0.34, 0.06, 0.06, STEEL_L, 0, 0.01, 0.165, 0.12);

  const pelvis = P()
    .box(0.4, 0.08, 0.3, STRAP, 0, 0.02, 0) // belt
    .box(0.15, 0.17, 0.045, STEEL, 0.095, -0.12, 0.15, 0.12) // front tassets
    .box(0.15, 0.17, 0.045, STEEL, -0.095, -0.12, 0.15, 0.12)
    .box(0.06, 0.15, 0.2, STEEL_D, 0.2, -0.1, 0.0) // hip plates
    .box(0.06, 0.15, 0.2, STEEL_D, -0.2, -0.1, 0.0);

  const uArm = P()
    .blob(0.12, 0.085, 0.13, STEEL, 0, 0.0, 0.0, 10) // pauldron
    .blob(0.105, 0.06, 0.115, STEEL_L, 0, -0.08, 0.0, 10)
    .box(0.13, 0.12, 0.13, STEEL_D, 0, -0.17, 0.0); // rerebrace

  const thigh = P()
    .box(0.18, 0.3, 0.05, STEEL, 0, -0.17, 0.105, -0.04)
    .box(0.05, 0.26, 0.15, STEEL_D, 0, -0.18, 0.0);

  const shin = P()
    .blob(0.085, 0.07, 0.07, STEEL_L, 0, -0.01, 0.075, 8) // knee cop
    .box(0.14, 0.3, 0.05, STEEL, 0, -0.22, 0.08) // greave
    .box(0.03, 0.26, 0.12, STEEL_D, 0, -0.22, 0.0);

  const geo = { head: head.build(), spine: spine.build(), pelvis: pelvis.build(), uArm: uArm.build(), thigh: thigh.build(), shin: shin.build() };
  // Left-side copies mirrored in x (the rig is symmetric about each bone).
  const mirror = (g: THREE.BufferGeometry) => {
    const m = g.clone().scale(-1, 1, 1);
    // Mirroring flips winding: swap two vertices per triangle.
    const p = m.attributes.position as THREE.BufferAttribute;
    const n = m.attributes.normal as THREE.BufferAttribute;
    const c = m.attributes.color as THREE.BufferAttribute;
    for (const a of [p, n, c]) {
      const arr = a.array as Float32Array;
      for (let i = 0; i < a.count; i += 3) {
        for (let k = 0; k < 3; k++) {
          const t = arr[(i + 1) * 3 + k];
          arr[(i + 1) * 3 + k] = arr[(i + 2) * 3 + k];
          arr[(i + 2) * 3 + k] = t;
        }
      }
    }
    return m;
  };
  const geoL = { ...geo, uArm: mirror(geo.uArm), thigh: mirror(geo.thigh), shin: mirror(geo.shin) };
  const visor = new THREE.BoxGeometry(0.17, 0.022, 0.012).translate(0, 0.115, 0.182);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.42, metalness: 0.55, envMapIntensity: 0.8 });
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.9, 0.25), toneMapped: false });
  return { geo, geoL, visor, mat, glow };
}

/** Bolts the armour onto a Juggernaut's Humanoid (once per pooled agent). */
export function attachJuggernautArmor(model: Humanoid) {
  if (!cache) cache = build();
  const c = cache;
  const hb = model.hitboxes;
  if (hb.length < 13) return; // Unknown rig layout: skip the extras rather than float them.
  for (const [bone, slot, left] of SLOTS) {
    const m = new THREE.Mesh(left ? c.geoL[slot] : c.geo[slot], c.mat);
    m.castShadow = slot === "spine" || slot === "head";
    m.receiveShadow = true;
    m.name = "jugArmor";
    if (slot === "head") {
      const v = new THREE.Mesh(c.visor, c.glow);
      v.name = "jugVisor";
      m.add(v);
    }
    // Rides on the procedural bone and (once loaded) the motion-captured body's matching bone.
    model.attachToBone(bone, m);
  }
  // Everything is plated: hits spark like armour instead of bleeding.
  for (const h of hb) if (h.userData.part !== "head") h.userData.surface = "armor";
}

export function disposeJuggernautArmor() {
  if (!cache) return;
  for (const g of Object.values(cache.geo)) g.dispose();
  for (const k of ["uArm", "thigh", "shin"] as const) cache.geoL[k].dispose();
  cache.visor.dispose();
  cache.mat.dispose();
  cache.glow.dispose();
  cache = null;
}
