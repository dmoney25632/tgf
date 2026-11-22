import type { ViewModelKind } from "../weapons";
import { loadScene } from "../../assets/AssetLoader";
import { prepareRealGun, type RealGun, type RealTemplate } from "./realFit";

export type { RealGun, RealTemplate } from "./realFit";

/**
 * Photo-textured gun models that replace the built geometry in first person.
 * The built gun still supplies the hands, anchors (muzzle, ejection port,
 * sights, grips) and animation; the real model is fitted onto its bounds
 * (see realFit.ts). Sources and licences: public/assets/CREDITS.md.
 */
const M4A1: RealGun = { path: "/assets/weapons/m4a1/model.gltf", rot: [0, -90, 0], offset: [0, -0.013, 0], parts: { mag: true } };
const MP5: RealGun = { path: "/assets/weapons/mp5/model.gltf", rot: [0, 0, 0], offset: [0, -0.0095, 0], parts: { mag: true } };
const M1911: RealGun = { path: "/assets/weapons/m1911/model.gltf", rot: [0, 90, 0], offset: [0, 0.005, 0], parts: { bolt: true } };

/**
 * `rot` is checked per model (tests/realGuns.test.ts): barrel toward -Z, top
 * up, side silhouette matching the built gun better than flipped. `parts:
 * true` splits pieces off by the built part's bounds (magazine, pump, slide);
 * a RegExp names the file's own nodes.
 */
export const REAL_GUNS: Partial<Record<ViewModelKind, RealGun>> = {
  m4a1: M4A1,
  // The same rifle re-finished: the closest licence-clean stand-in for an HK416 so far.
  // r4m's HK416 A7 (its spare magazine and loose rounds were stripped from the file).
  hk416: { path: "/assets/weapons/hk416/model.gltf", rot: [0, -90, 0], offset: [0, -0.006, 0], parts: { mag: true } },
  // Rigged export (baked to its posed shape); a spare mag sits off to the side.
  akm: { path: "/assets/weapons/akm/model.gltf", rot: [0, 0, 0], offset: [0, -0.008, 0], drop: [{ axis: "x", below: -1.5 }], parts: { mag: true } },
  mp5: MP5,
  // The built suppressor stays on (guns.ts `suppressed`) and the real gun fits behind it, on its bore.
  mp5sd: { ...MP5, offset: undefined },
  m1911: M1911,
  mk23: { ...M1911, offset: undefined },
  m24: { path: "/assets/weapons/m24/model.gltf", rot: [0, 90, 0], parts: { mag: true } },
  svd: { path: "/assets/weapons/svd/model.gltf", rot: [0, 180, 0], parts: { mag: true } },
  r870: { path: "/assets/weapons/r870/model.gltf", rot: [0, 90, 0], offset: [0, 0.004, 0], parts: { pump: true } },
  // Folded bipod under the handguard: keep the built support hand.
  m249: { path: "/assets/weapons/m249/model.gltf", rot: [0, 180, 0], keepHand: true },
  // Rigged, posed nose-down (16° pitch fixes it); the speedloader and loose cases were stripped. The cylinder stays put on reloads.
  sw629: { path: "/assets/weapons/sw629/model.gltf", rot: [16, 180, 0], offset: [0, 0.011, 0] },
  // Poly Haven "Service Pistol" (wooden-grip variant); its loose magazine is seated in the grip.
  m9: { path: "/assets/weapons/m9/model.gltf", rot: [0, 90, 0], offset: [0, 0.002, 0], parts: { mag: /magazine/, bolt: /slide/ }, seat: ["mag"] },
  // A Glock 18 (the G17 plus a selector), rigged: baked to its rest pose, loose round stripped.
  g17: { path: "/assets/weapons/g17/model.gltf", rot: [0, 180, 0], parts: { mag: /Object_18/, bolt: true } },
  // Processed copies (decimated, metre scale, magazine as its own node). The G36's rail red dot was
  // stripped so the eye runs along the carry handle; the PKP's optic and side mount are gone.
  g36: { path: "/assets/weapons/g36/model.gltf", rot: [0, 0, 0], offset: [0, -0.016, 0], parts: { mag: /^mag$/ } },
  // Its 100-round box sits across the gun, so it is wider than the rifles.
  // Built in Blender by the art pipeline (art/blender/assets/uzi.py): +Y front, so no rotation.
  // The procedural Uzi has its stock extended (0.57 m) and this one folded (0.40 m), so the length fit
  // would blow it up 1.44x: scale it back near true size and slide it so the mag sits in the grip hand and the taller real sights sit on the eye line.
  uzi: { path: "/assets/weapons/uzi/model.gltf", rot: [0, 0, 0], scale: 0.62, offset: [0, -0.018, -0.02], parts: { mag: /^mag$/ } },
  pkm: { path: "/assets/weapons/pkm/model.gltf", rot: [0, 0, 0], offset: [0, -0.032, 0], parts: { mag: /^mag$/ } },
  m1014: { path: "/assets/weapons/m1014/model.gltf", rot: [0, 0, 0], offset: [0, 0.012, 0] },
};

const templates = new Map<ViewModelKind, Promise<RealTemplate | null>>();

/** Loads and orients a real gun (cached per kind); null if missing or failed. */
export function loadRealGun(kind: ViewModelKind): Promise<RealTemplate | null> {
  const cfg = REAL_GUNS[kind];
  if (!cfg) return Promise.resolve(null);
  let p = templates.get(kind);
  if (!p) {
    p = loadScene(cfg.path).then((scene) => (scene ? prepareRealGun(scene, cfg) : null));
    templates.set(kind, p);
  }
  return p;
}
