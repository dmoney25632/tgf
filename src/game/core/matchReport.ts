import type { MatchSummary } from "./GameMode";

/** Waves actually played this run (skipped starting waves don't count). */
export function wavesCleared(s: MatchSummary) {
  return Math.max(0, s.wavesSurvived - Math.max(0, (s.startWave ?? 1) - 1));
}

/** Run score shown on the summary and kept as the player's best score. */
export function matchScore(s: MatchSummary) {
  return s.kills * 100 + s.headshots * 50 + wavesCleared(s) * 500 + (s.victory ? 2500 : 0);
}

/** Payload for saveMatch(): survival runs carry the furthest wave they cleared. */
export function matchReport(s: MatchSummary, mode: string = s.mode, squad = 1) {
  const survival = s.mode === "survival";
  return {
    gameId: "iron-horizon",
    mode,
    map: s.map,
    kills: s.kills,
    deaths: s.timesDowned,
    shotsFired: s.shotsFired,
    shotsHit: s.shotsHit,
    won: s.victory,
    wave: survival ? s.wavesSurvived : 0,
    headshots: s.headshots,
    score: survival ? matchScore(s) : 0,
    difficulty: s.difficulty,
    seconds: Math.round(s.seconds),
    squad,
    meleeKills: s.meleeKills,
    grenadeKills: s.grenadeKills,
    damage: Math.round(s.damageDealt),
  };
}
