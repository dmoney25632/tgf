/**
 * Central tuning for Iron Horizon. Units: meters, seconds, degrees unless noted.
 * Everything that affects "feel" lives here (or in weapons/weapons.ts) so it
 * can be iterated on without touching system code.
 */

/** Physics runs at a fixed rate; rendering interpolates between steps. */
export const SIM = {
  hz: 120,
  maxStepsPerFrame: 8,
} as const;

export const MOVEMENT = {
  walkSpeed: 5.6,
  sprintSpeed: 8.6,
  crouchSpeed: 2.9,
  /** Speed multiplier while fully aimed down sights. */
  adsSpeedMultiplier: 0.62,
  /** Ground acceleration toward target speed (m/s²). High = snappy starts. */
  groundAccel: 80,
  /** Ground braking with no input (m/s²). ~0.07s from walk speed to zero. */
  groundDecel: 85,
  /** Air acceleration (Quake-style: adds along wish dir, keeps momentum). */
  airAccel: 14,
  /** Max speed the air control can push you toward. */
  airMaxSpeed: 4,
  jumpVelocity: 5.9,
  gravity: 17,
  /** Extra gravity after the apex for a less floaty fall. */
  fallGravityMultiplier: 1.25,
  /** Grace period to still jump after walking off a ledge. */
  coyoteTime: 0.1,
  /** A jump pressed slightly before landing still fires. */
  jumpBuffer: 0.12,
  /** Max ledge height walked up automatically. */
  stepHeight: 0.45,
  /** How fast the camera catches up after a step (1/s). */
  stepSmoothing: 14,
  standHeight: 1.8,
  crouchHeight: 1.15,
  slideHeight: 0.95,
  eyeOffset: 0.12,
  radius: 0.35,
  /** Stand/crouch camera transition speed (1/s). */
  crouchLerp: 14,
} as const;

export const SLIDE = {
  /** Need at least this horizontal speed to start a slide. */
  minStartSpeed: 6.5,
  /** Speed set at slide start (if faster than current). */
  boostSpeed: 10.8,
  /** Friction while sliding (m/s²). */
  friction: 9,
  duration: 0.8,
  /** Slide ends once you slow below this. */
  endSpeed: 3.2,
  /** Steering strength while sliding (fraction of normal ground accel). */
  steer: 0.12,
  cooldown: 0.45,
  /** Camera roll during slide (deg). */
  tilt: 4,
} as const;

export const LOOK = {
  /** Radians per pixel at sensitivity 1.0. */
  baseSensitivity: 0.0021,
  adsSensitivityMultiplier: 0.62,
  /** Keep pitch this far from straight up/down so the camera never flips. */
  poleMargin: 0.08,
} as const;

export const CAMERA = {
  fov: 80,
  /** FOV added at full sprint / during a slide. */
  sprintFovBoost: 6,
  slideFovBoost: 8,
  fovLerp: 10,
  viewmodelFov: 56,
  near: 0.05,
  far: 600,
} as const;

export const HEAD_BOB = {
  /** Vertical / lateral amplitude at walk speed (m). */
  vertical: 0.028,
  lateral: 0.018,
  /** Cycles per meter traveled. */
  frequency: 0.32,
  sprintMultiplier: 1.35,
  /** Bob kept while aiming (0..1). */
  adsMultiplier: 0.12,
  /** Landing dip per m/s of fall speed. */
  landKickPerSpeed: 0.012,
  landKickMax: 0.14,
} as const;

/** Trauma-based camera shake. Shake = trauma² × max. */
export const SHAKE = {
  decay: 3.2,
  maxPitch: 1.6,
  maxYaw: 1.2,
  maxRoll: 1.8,
  maxOffset: 0.025,
  frequency: 24,
} as const;

export type QualityName = "low" | "medium" | "high";

export type QualityPreset = {
  label: string;
  /** Upper bound on devicePixelRatio. */
  maxPixelRatio: number;
  /** Multiplier on the final pixel ratio (render resolution). */
  resolutionScale: number;
  shadows: boolean;
  shadowMapSize: number;
  postProcessing: boolean;
  bloom: boolean;
  ambientOcclusion: boolean;
  /** MSAA samples on the post-processing target (0 = use FXAA). */
  msaaSamples: number;
  maxDecals: number;
  maxParticles: number;
};

export const QUALITY: Record<QualityName, QualityPreset> = {
  low: {
    label: "Low",
    maxPixelRatio: 1,
    resolutionScale: 0.75,
    shadows: false,
    shadowMapSize: 512,
    postProcessing: false,
    bloom: false,
    ambientOcclusion: false,
    msaaSamples: 0,
    maxDecals: 48,
    maxParticles: 256,
  },
  medium: {
    label: "Medium",
    maxPixelRatio: 1.5,
    resolutionScale: 1,
    shadows: true,
    shadowMapSize: 1024,
    postProcessing: true,
    bloom: true,
    ambientOcclusion: false,
    msaaSamples: 0,
    maxDecals: 96,
    maxParticles: 512,
  },
  high: {
    label: "High",
    maxPixelRatio: 2,
    resolutionScale: 1,
    shadows: true,
    shadowMapSize: 2048,
    postProcessing: true,
    bloom: true,
    ambientOcclusion: true,
    msaaSamples: 4,
    maxDecals: 160,
    maxParticles: 768,
  },
};

/** Pick a sensible default for the device. */
export function detectQuality(): QualityName {
  if (typeof navigator === "undefined") return "medium";
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const cores = navigator.hardwareConcurrency ?? 4;
  if (mobile || cores <= 4) return "low";
  if (cores >= 8 && window.devicePixelRatio <= 2) return "high";
  return "medium";
}
