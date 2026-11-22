import { QUALITY, type QualityName, type QualityPreset } from "../config";

/** Which named preset a QualityPreset object is (falls back on its label). */
export function qualityName(q: QualityPreset): QualityName {
  for (const k of Object.keys(QUALITY) as QualityName[]) if (QUALITY[k] === q) return k;
  const l = q.label.toLowerCase();
  return l === "low" || l === "high" ? l : "medium";
}

/** World-detail knobs per preset (environment only; render knobs live in config). */
export type WorldDetail = {
  /** Small clutter cells are hidden beyond this (m); 0 = never drawn. */
  clutterDistance: number;
  /** Build balconies/awnings/rooftop clutter on backdrop buildings. */
  backdropDetail: boolean;
  /** How many distant smoke columns rise. */
  smokeColumns: number;
  /** Particles per smoke column. */
  smokePuffs: number;
  /** 0..1 scale on scattered debris/litter counts (built once per map load). */
  debris: number;
};

const DETAIL: Record<QualityName, WorldDetail> = {
  low: { clutterDistance: 0, backdropDetail: false, smokeColumns: 2, smokePuffs: 10, debris: 0.4 },
  medium: { clutterDistance: 55, backdropDetail: true, smokeColumns: 3, smokePuffs: 18, debris: 0.8 },
  high: { clutterDistance: 85, backdropDetail: true, smokeColumns: 4, smokePuffs: 26, debris: 1 },
};

export const worldDetail = (q: QualityName) => DETAIL[q];

/** Light-bake knobs (see world/lighting/MapLighting). */
export type BakeDetail = {
  /** Box faces longer than this (m) are subdivided so per-vertex light has somewhere to land. */
  maxEdge: number;
  /** Hemisphere rays per vertex (upper bound) and the floor the budget may cut them to. */
  skyRays: number;
  minRays: number;
  /** Rays toward the sun per vertex (soft per-vertex shadow edge). */
  sunRays: number;
  /** One sun bounce (a secondary ray per hemisphere hit). */
  bounce: boolean;
  /** Occluder search distance for hemisphere rays (m). */
  rayLength: number;
  /** Total rays per bake (≈ 1 M rays/s on a laptop core on the dense maps); rays per vertex shrink to fit. */
  budget: number;
  /** Max main-thread time per bake slice (ms). */
  sliceMs: number;
};

const BAKE: Record<QualityName, BakeDetail> = {
  low: { maxEdge: 3, skyRays: 8, minRays: 4, sunRays: 1, bounce: false, rayLength: 10, budget: 500_000, sliceMs: 6 },
  medium: { maxEdge: 2.25, skyRays: 14, minRays: 6, sunRays: 2, bounce: true, rayLength: 14, budget: 1_200_000, sliceMs: 8 },
  high: { maxEdge: 1.5, skyRays: 24, minRays: 8, sunRays: 3, bounce: true, rayLength: 18, budget: 3_000_000, sliceMs: 10 },
};

/** Bake knobs for a preset, or null when it bakes nothing. */
export function bakeDetail(q: QualityPreset): BakeDetail | null {
  if (q.lightBake === "off") return null;
  const d = BAKE[qualityName(q)];
  return q.lightBake === "sky" ? { ...d, bounce: false } : d;
}
