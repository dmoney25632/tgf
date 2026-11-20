import type { QualityPreset } from "../config";
const REFRESH_RATES = [60, 75, 90, 100, 120, 144, 165, 240];

/** Nearest common refresh interval (ms) at or above the measured frame interval. */
export function snapRefreshMs(avgMs: number) {
  const hz = 1000 / avgMs;
  let best = 60;
  for (const r of REFRESH_RATES) if (r <= hz * 1.04) best = r;
  return 1000 / best;
}

/** Highest frame rate dynamic resolution will trade pixels for. */
const MAX_CHASE_HZ = 144;

/**
 * Frame budget and resolution floor for dynamic resolution. The preset's
 * targetFrameMs (60 fps) is the hard budget: to hold it the scale may fall to
 * minResolutionScale. On faster displays the budget tightens to the refresh
 * interval (up to 144 Hz), but only gentle drops (to 80 % of the preset scale)
 * are spent chasing it, so a 120/144 Hz screen gets smoother motion without
 * turning blurry. Pure function (unit-tested).
 */
export function dynamicResolutionBudget(q: Pick<QualityPreset, "targetFrameMs" | "minResolutionScale" | "resolutionScale">, refreshMs: number, avgMs: number) {
  const hard = q.targetFrameMs;
  const soft = Math.max(refreshMs, 1000 / MAX_CHASE_HZ);
  if (soft >= hard * 0.93 || avgMs > hard * 1.1) return { target: hard, floor: q.minResolutionScale };
  return { target: soft, floor: Math.max(q.minResolutionScale, Math.round(q.resolutionScale * 0.8 * 20) / 20) };
}
