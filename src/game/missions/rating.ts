import type { MissionDef } from "./types";

/**
 * Star rating (1–3) for a finished mission run, from completion time, the
 * difficulty it was played on and how often the team died.
 *
 *  - Time sets the base: at or under the three-star target → 3, at or under
 *    the two-star target → 2, otherwise 1. Targets are authored at Regular
 *    (`MissionDef.stars`) and scaled per difficulty: Recruit is stricter on
 *    time, Veteran more lenient.
 *  - Deaths (checkpoint restarts plus team downs) beyond the difficulty's
 *    allowance cost a star, and a second star past three more.
 *  - Recruit caps at two stars; Veteran never drops below two on a clean run.
 *  - A loss is always zero stars.
 *
 * Pure and engine-free: the mission screen shows `starTargets` before a run
 * and the debrief shows `rateMission`'s reasons after.
 */

export const STARS = {
  /** Target-time multiplier per difficulty. */
  time: { recruit: 0.85, regular: 1, veteran: 1.2 } as Record<string, number>,
  /** Deaths allowed before losing a star. */
  allowance: { recruit: 0, regular: 1, veteran: 2 } as Record<string, number>,
  /** Max stars per difficulty. */
  cap: { recruit: 2, regular: 3, veteran: 3 } as Record<string, number>,
  /** A checkpoint restart counts as this many downs. */
  retryWeight: 2,
};

export type StarTargets = { three: number; two: number };

/** Target times (s) for a mission at a difficulty. */
export function starTargets(def: Pick<MissionDef, "stars" | "par">, difficulty: string): StarTargets {
  const [three, two] = def.stars ?? [Math.round(def.par * 0.75), def.par];
  const k = STARS.time[difficulty] ?? 1;
  return { three: Math.round(three * k), two: Math.round(two * k) };
}

export type RunFacts = { victory: boolean; seconds: number; difficulty: string; retries: number; downs: number };
export type Rating = { stars: number; targets: StarTargets; deaths: number; notes: string[] };

export function rateMission(def: Pick<MissionDef, "stars" | "par">, run: RunFacts): Rating {
  const targets = starTargets(def, run.difficulty);
  const deaths = run.retries * STARS.retryWeight + run.downs;
  const notes: string[] = [];
  if (!run.victory) return { stars: 0, targets, deaths, notes: ["Mission failed"] };
  let stars = run.seconds <= targets.three ? 3 : run.seconds <= targets.two ? 2 : 1;
  notes.push(stars === 3 ? "Under the three-star time" : stars === 2 ? "Under the two-star time" : "Over the two-star time");
  const allow = STARS.allowance[run.difficulty] ?? 1;
  if (deaths > allow) {
    const lost = deaths > allow + 3 ? 2 : 1;
    stars -= lost;
    notes.push(`${deaths} death${deaths === 1 ? "" : "s"} (allowance ${allow}): −${lost}`);
  }
  if (run.difficulty === "veteran" && deaths <= allow && stars < 2) {
    stars = 2;
    notes.push("Veteran, clean run: at least two stars");
  }
  const cap = STARS.cap[run.difficulty] ?? 3;
  if (stars > cap) {
    stars = cap;
    notes.push(`${run.difficulty === "recruit" ? "Recruit" : "Difficulty"} caps at ${cap} stars`);
  }
  return { stars: Math.max(1, Math.min(3, stars)), targets, deaths, notes };
}

/** "m:ss" for target times and run clocks. */
export function clock(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
