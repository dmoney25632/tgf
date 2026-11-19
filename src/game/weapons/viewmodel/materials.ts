import * as THREE from "three";
import { detailTextures } from "./textures";

/**
 * PBR material set for the first-person weapons and arms. Every material
 * uses vertex colours: the geometry builder writes >1 on chamfered edges of
 * metal parts (bare-metal edge wear) and <1 on painted parts (darkened edges).
 * Reflections come from scene.environment (the viewmodel scene's envMap).
 */
export type ViewmodelMaterials = ReturnType<typeof createViewmodelMaterials>;

export function createViewmodelMaterials() {
  const t = detailTextures();
  const rep = (tex: THREE.Texture) => tex; // shared; UVs are box-projected in metres × UV_SCALE

  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ vertexColors: true, ...p });
  const ns = (s: number) => new THREE.Vector2(s, s);

  // Metals ---------------------------------------------------------------
  /** Hard-anodised aluminium receivers (very dark, satin). */
  const anodized = std({ color: 0x26272a, metalness: 0.3, roughness: 0.4, roughnessMap: rep(t.metalRough), normalMap: t.metalNormal, normalScale: ns(0.25) });
  /** Parkerised steel (barrels, pins, small parts). */
  const steel = std({ color: 0x3c3d3e, metalness: 0.75, roughness: 0.44, roughnessMap: t.metalRough, normalMap: t.metalNormal, normalScale: ns(0.35) });
  /** Blued / nitrided barrel steel, a little glossier. */
  const blued = std({ color: 0x2c2e32, metalness: 0.85, roughness: 0.3, roughnessMap: t.metalRough, normalMap: t.metalNormal, normalScale: ns(0.2) });
  /** Bright machined steel (bolt carrier, revolver cylinder face, extractor). */
  const bright = std({ color: 0x8c8e90, metalness: 1, roughness: 0.26, roughnessMap: t.metalRough, normalMap: t.metalNormal, normalScale: ns(0.2) });
  /** Stainless (revolver frame). */
  const stainless = std({ color: 0x6d7073, metalness: 1, roughness: 0.34, roughnessMap: t.metalRough, normalMap: t.metalNormal, normalScale: ns(0.3) });
  /** Tan cerakote over metal (DMR). */
  const cerakoteTan = std({ color: 0x8f7b5a, metalness: 0.25, roughness: 0.62, roughnessMap: t.polymerRough, normalMap: t.metalNormal, normalScale: ns(0.3) });
  const brass = std({ color: 0xc8a050, metalness: 1, roughness: 0.28, roughnessMap: t.metalRough });
  const copper = std({ color: 0xb06a3d, metalness: 1, roughness: 0.3 });

  // Polymers / rubber ----------------------------------------------------
  const polymer = std({ color: 0x252626, metalness: 0, roughness: 0.78, roughnessMap: t.polymerRough, normalMap: t.polymerNormal, normalScale: ns(0.4) });
  const polymerTan = std({ color: 0x8a7556, metalness: 0, roughness: 0.8, roughnessMap: t.polymerRough, normalMap: t.polymerNormal, normalScale: ns(0.4) });
  const polymerOlive = std({ color: 0x4b4f38, metalness: 0, roughness: 0.8, roughnessMap: t.polymerRough, normalMap: t.polymerNormal, normalScale: ns(0.4) });
  const polymerGray = std({ color: 0x3a3c3d, metalness: 0, roughness: 0.75, roughnessMap: t.polymerRough, normalMap: t.polymerNormal, normalScale: ns(0.4) });
  /** Stippled grip panels. */
  const grip = std({ color: 0x1b1c1c, metalness: 0, roughness: 0.88, normalMap: t.stippleNormal, normalScale: ns(0.9) });
  const gripTan = std({ color: 0x84704f, metalness: 0, roughness: 0.88, normalMap: t.stippleNormal, normalScale: ns(0.9) });
  const rubber = std({ color: 0x151515, metalness: 0, roughness: 0.92, normalMap: t.stippleNormal, normalScale: ns(0.5) });
  /** Olive webbing / canvas (LMG ammo pouch, slings). */
  const canvas = std({ color: 0x4f5139, metalness: 0, roughness: 0.95, normalMap: t.fabricNormal, normalScale: ns(0.8) });
  const shellHull = std({ color: 0x8e1f18, metalness: 0.05, roughness: 0.45 });
  const cord = std({ color: 0x2d2b26, metalness: 0, roughness: 0.9, normalMap: t.cordNormal, normalScale: ns(1) });

  // Optics ---------------------------------------------------------------
  const lens = new THREE.MeshStandardMaterial({
    color: 0x6a88a8, metalness: 1, roughness: 0.04, transparent: true, opacity: 0.22, depthWrite: false, envMapIntensity: 1.6,
  });
  /** Objective lens with amber coating (seen from the front / at an angle). */
  const lensCoated = new THREE.MeshStandardMaterial({ color: 0x5a3a20, metalness: 1, roughness: 0.05, emissive: 0x0c0604, envMapIntensity: 1.4 });
  const reticleRed = new THREE.MeshBasicMaterial({ color: new THREE.Color(4.5, 0.35, 0.25), toneMapped: false, transparent: true, depthWrite: false });
  const reticleAmber = new THREE.MeshBasicMaterial({ color: new THREE.Color(4.2, 1.6, 0.2), toneMapped: false, transparent: true, depthWrite: false });
  const tritium = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 3.2, 0.7), toneMapped: false });
  const tritiumOrange = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.2, 0.2), toneMapped: false });

  // Arms -----------------------------------------------------------------
  const glove = std({ color: 0x2b2a26, metalness: 0, roughness: 0.86, normalMap: t.fabricNormal, normalScale: ns(0.55) });
  /** Synthetic-suede palm + moulded knuckle guard (darker shade of the glove). */
  const gloveAccent = std({ color: 0x1a1917, metalness: 0, roughness: 0.7, normalMap: t.polymerNormal, normalScale: ns(0.5) });
  const sleeve = std({ color: 0x4d5240, metalness: 0, roughness: 0.96, normalMap: t.fabricNormal, normalScale: ns(0.9) });
  const watchFace = new THREE.MeshStandardMaterial({ color: 0x0b0d0e, metalness: 0.4, roughness: 0.12, emissive: new THREE.Color(0.02, 0.06, 0.03) });

  // Knife ---------------------------------------------------------------
  const blade = std({ color: 0x9da2a6, metalness: 1, roughness: 0.2, roughnessMap: t.metalRough, normalMap: t.metalNormal, normalScale: ns(0.15) });
  const bladeCoat = std({ color: 0x222324, metalness: 0.5, roughness: 0.55 });

  const all = {
    anodized, steel, blued, bright, stainless, cerakoteTan, brass, copper,
    polymer, polymerTan, polymerOlive, polymerGray, grip, gripTan, rubber, canvas, shellHull, cord,
    lens, lensCoated, reticleRed, reticleAmber, tritium, tritiumOrange,
    glove, gloveAccent, sleeve, watchFace, blade, bladeCoat,
  };
  return {
    ...all,
    dispose() {
      for (const m of Object.values(all)) m.dispose();
    },
  };
}

/** How the builder tints chamfered edges for a material (vertex colour multiplier). */
export function edgeWearFor(mats: ViewmodelMaterials, mat: THREE.Material): number {
  if (mat === mats.anodized || mat === mats.steel || mat === mats.blued) return 2.4;
  if (mat === mats.stainless || mat === mats.bright) return 1.25;
  if (mat === mats.cerakoteTan) return 0.55;
  if (mat === mats.polymer || mat === mats.polymerGray || mat === mats.grip || mat === mats.rubber) return 1.6;
  if (mat === mats.polymerTan || mat === mats.polymerOlive || mat === mats.gripTan) return 0.82;
  return 1;
}
