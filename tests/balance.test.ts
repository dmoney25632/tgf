// Survival balance rules: sniper one-shots, unlimited sidearm, leaderboard report.
import { test } from "node:test";
import assert from "node:assert/strict";
import { WEAPONS, damageAt } from "../src/game/weapons/weapons";
import { DIFFICULTY, ENEMIES, WAVES } from "../src/game/survival/config";
import { matchReport, matchScore } from "../src/game/core/matchReport";
import type { MatchSummary } from "../src/game/core/GameMode";

test("bolt / anti-materiel snipers one-shot every regular enemy through wave 25 on Veteran, even elites, at long range", () => {
  for (const w of [WEAPONS.m24, WEAPONS.m82]) {
  for (const type of ["rifleman", "rusher", "sniper"] as const) {
    const hp = ENEMIES[type].health * (1 + WAVES.healthPerWave * 24) * WAVES.elite.health * DIFFICULTY.veteran.enemyHealth;
    for (const dist of [5, 80, 250]) {
      const body = damageAt(w, dist) * ENEMIES[type].bodyArmor;
      assert.ok(body >= hp, `${type} @${dist}m: ${body} < ${hp.toFixed(0)}`);
      assert.ok(body * w.limbMultiplier >= hp, `${type} legs @${dist}m`);
    }
  }
  // Juggernauts drop to a single headshot early on.
  assert.ok(damageAt(w, 50) * w.headMultiplier >= ENEMIES.armored.health);
  }
});

const base: MatchSummary = {
  mode: "survival", victory: false, wavesSurvived: 12, startWave: 1, waveTarget: 20, kills: 80, headshots: 30, meleeKills: 0, grenadeKills: 0,
  shotsFired: 900, shotsHit: 400, damageDealt: 0, damageTaken: 0, timesDowned: 2, moneyEarned: 0, seconds: 600, operator: "ridge", difficulty: "regular",
  killsByType: {}, map: "dustfall-outpost",
};

test("survival reports carry the furthest wave and score; other modes don't", () => {
  const r = matchReport(base);
  assert.equal(r.wave, 12);
  assert.equal(r.headshots, 30);
  assert.equal(r.score, matchScore(base));
  assert.equal(matchReport(base, "survival-coop").mode, "survival-coop");
  const range = matchReport({ ...base, mode: "range" });
  assert.equal(range.wave, 0);
  assert.equal(range.score, 0);
});

test("skipped starting waves don't earn score", () => {
  assert.equal(matchScore({ ...base, startWave: 7 }), matchScore(base) - 6 * 500);
});

test("reports carry difficulty, length, squad and kill breakdown for the leaderboards", () => {
  const r = matchReport({ ...base, meleeKills: 4, grenadeKills: 6, damageDealt: 12345.6, seconds: 600.4 }, "survival-coop", 3);
  assert.equal(r.difficulty, "regular");
  assert.equal(r.seconds, 600);
  assert.equal(r.squad, 3);
  assert.equal(r.meleeKills, 4);
  assert.equal(r.grenadeKills, 6);
  assert.equal(r.damage, 12346);
  assert.equal(matchReport(base).squad, 1);
});
