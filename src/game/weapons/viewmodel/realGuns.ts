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
  hk416: { ...M4A1, tint: 0xd2c8b4 },
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
