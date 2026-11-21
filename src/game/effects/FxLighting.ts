import * as THREE from "three";

/**
 * Shared, scene-derived lighting for the unlit effect shaders (smoke, dust,
 * decals, grenade smoke). One set of uniform objects is referenced by every
 * effect material, so a single sync per frame relights them all and no
 * shader variant depends on it.
 *
 * Values are normalised so a typical day map gives sunK ≈ 1 and ambK ≈ 1;
 * a night map (e.g. Greywater) darkens effects accordingly.
 */
export type FxLightUniforms = {
  fxSunDir: { value: THREE.Vector3 };
  fxSunColor: { value: THREE.Color };
  fxAmbColor: { value: THREE.Color };
  fxTime: { value: number };
};

/** Day reference intensities (sun × LIGHT_BALANCE.sun, hemi × LIGHT_BALANCE.hemi). */
const SUN_REF = 4;
const HEMI_REF = 0.75;

export class FxLighting {
  readonly uniforms: FxLightUniforms = {
    fxSunDir: { value: new THREE.Vector3(0.35, 0.85, 0.4).normalize() },
    fxSunColor: { value: new THREE.Color(1, 0.96, 0.9) },
    fxAmbColor: { value: new THREE.Color(0.62, 0.66, 0.72) },
    fxTime: { value: 0 },
  };
  private sun: THREE.DirectionalLight | null = null;
  private hemi: THREE.HemisphereLight | null = null;
  private rescan = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly c = new THREE.Color();

  constructor(private readonly scene: THREE.Scene) {}

  private lastSync = -1;

  /** Advances the shared effect clock (decal fade) and re-reads the lights. */
  update(dt: number) {
    this.uniforms.fxTime.value += dt;
    this.rescan -= dt;
    this.syncLights();
  }

  /**
   * Re-reads the sun / sky lights (found lazily: the atmosphere may be built
   * after the effects). Idempotent per clock tick, so several users may call it.
   */
  syncLights() {
    if (this.lastSync === this.uniforms.fxTime.value) return;
    this.lastSync = this.uniforms.fxTime.value;
    if ((!this.sun || !this.sun.parent) && this.rescan <= 0) {
      this.rescan = 1.5;
      this.sun = null;
      this.hemi = null;
      this.scene.traverse((o) => {
        if (!this.sun && (o as THREE.DirectionalLight).isDirectionalLight) this.sun = o as THREE.DirectionalLight;
        if (!this.hemi && (o as THREE.HemisphereLight).isHemisphereLight) this.hemi = o as THREE.HemisphereLight;
      });
    }
    const u = this.uniforms;
    if (this.sun) {
      this.tmp.copy(this.sun.position).sub(this.sun.target.position);
      if (this.tmp.lengthSq() > 1e-6) u.fxSunDir.value.copy(this.tmp.normalize());
      const k = Math.min(1.4, this.sun.intensity / SUN_REF) * (this.sun.visible ? 1 : 0);
      normTint(this.c.copy(this.sun.color), 0.25);
      u.fxSunColor.value.copy(this.c).multiplyScalar(k);
    }
    if (this.hemi) {
      const k = Math.max(0.08, Math.min(1.4, this.hemi.intensity / HEMI_REF));
      normTint(this.c.copy(this.hemi.color), 0.55);
      u.fxAmbColor.value.copy(this.c).multiplyScalar(0.66 * k);
    }
  }
}

/** Scale a colour so its brightest channel is 1, then pull it `toWhite` of the way to white. */
function normTint(c: THREE.Color, toWhite: number) {
  const m = Math.max(c.r, c.g, c.b, 1e-4);
  c.r = c.r / m + (1 - c.r / m) * toWhite;
  c.g = c.g / m + (1 - c.g / m) * toWhite;
  c.b = c.b / m + (1 - c.b / m) * toWhite;
  return c;
}

/** GLSL uniform declarations matching FxLightUniforms. */
export const FX_LIGHT_PARS = /* glsl */ `
  uniform vec3 fxSunDir;
  uniform vec3 fxSunColor;
  uniform vec3 fxAmbColor;
  uniform float fxTime;
`;

/** The scene's shared effect lighting (created on first use, kept on scene.userData). */
export function fxLightingFor(scene: THREE.Scene): FxLighting {
  const cur = scene.userData.ihFxLighting;
  if (cur instanceof FxLighting) return cur;
  const l = new FxLighting(scene);
  scene.userData.ihFxLighting = l;
  return l;
}
