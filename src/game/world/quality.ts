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
