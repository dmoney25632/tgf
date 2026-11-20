import type { QualityName, QualityPreset } from "../config";

/**
 * Mobile tuning of the quality presets. Phones have tiny screens with huge
 * pixel ratios (3×) and tile-based GPUs that hate full-screen passes, so on
 * touch devices each preset is re-tuned: render resolution capped near 1.5×
 * (sharp on a 6" screen) with dynamic resolution underneath, smaller and
 * less frequent shadows, no screen-space AO / god rays / MSAA on the lower
 * tiers, thinner foliage, shorter grass and smaller particle/decal pools.
 * Applied in place (before the engine reads a preset), only on touch devices.
 */
export const MOBILE_OVERRIDES: Record<QualityName, Partial<QualityPreset>> = {
  low: {
    maxPixelRatio: 1.25,
    resolutionScale: 1,
    minResolutionScale: 0.55,
    shadows: false,
    postProcessing: false,
    bloom: false,
    ambientOcclusion: false,
    aoSamples: 0,
    godRays: false,
    msaaSamples: 0,
    maxDecals: 32,
    maxParticles: 160,
    maxTextureSize: 512,
    proceduralTextureSize: 256,
    anisotropy: 2,
    foliageDensity: 0.22,
    grassDistance: 24,
    hdri: false,
    dustMotes: false,
    maxLocalLights: 1,
    targetFrameMs: 16.7,
  },
  medium: {
    maxPixelRatio: 1.5,
    resolutionScale: 1,
    minResolutionScale: 0.6,
    shadows: true,
    shadowMapSize: 1024,
    shadowInterval: 2,
    shadowExtent: 26,
    postProcessing: true,
    bloom: true,
    ambientOcclusion: false,
    aoSamples: 0,
    godRays: false,
    msaaSamples: 0,
    maxDecals: 64,
    maxParticles: 300,
    maxTextureSize: 1024,
    proceduralTextureSize: 512,
    anisotropy: 2,
    foliageDensity: 0.4,
    grassDistance: 34,
    dustMotes: false,
    maxLocalLights: 2,
    targetFrameMs: 16.7,
  },
  high: {
    maxPixelRatio: 2,
    resolutionScale: 1,
    minResolutionScale: 0.6,
    shadows: true,
    shadowMapSize: 1024,
    shadowInterval: 1,
    shadowExtent: 34,
    postProcessing: true,
    bloom: true,
    ambientOcclusion: true,
    aoSamples: 6,
    godRays: false,
    msaaSamples: 0,
    maxDecals: 96,
    maxParticles: 420,
    anisotropy: 4,
    foliageDensity: 0.65,
    grassDistance: 46,
    maxLocalLights: 3,
    targetFrameMs: 16.7,
  },
};

let applied = false;

/** Tune `presets` for a mobile GPU (idempotent). */
export function tuneQualityForMobile(presets: Record<QualityName, QualityPreset>) {
  if (applied) return;
  applied = true;
  for (const name of Object.keys(MOBILE_OVERRIDES) as QualityName[]) {
    if (presets[name]) Object.assign(presets[name], MOBILE_OVERRIDES[name]);
  }
}
