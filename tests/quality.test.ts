import { test } from "node:test";
import assert from "node:assert/strict";
import { ADAPTIVE_LEVELS, QUALITY, adaptivePreset } from "../src/game/config";

test("adaptive level 0 is the chosen preset", () => {
  for (const q of Object.values(QUALITY)) assert.equal(adaptivePreset(q, 0), q);
});

test("adaptive steps only ever get cheaper and never toggle shader defines", () => {
  for (const base of Object.values(QUALITY)) {
    let prev = base;
    for (let level = 1; level <= ADAPTIVE_LEVELS; level++) {
      const q = adaptivePreset(base, level);
      assert.ok(q.resolutionScale <= prev.resolutionScale, "resolution never rises");
      assert.ok(q.shadowMapSize <= prev.shadowMapSize, "shadow map never grows");
      assert.ok(q.msaaSamples <= prev.msaaSamples);
      assert.ok(!q.ambientOcclusion || prev.ambientOcclusion);
      assert.ok((q.shadowUpdateInterval ?? 1) >= (prev.shadowUpdateInterval ?? 1));
      // Toggling shadows or post-processing would recompile every material.
      assert.equal(q.shadows, base.shadows);
      assert.equal(q.postProcessing, base.postProcessing);
      assert.ok(q.resolutionScale >= base.resolutionScale * 0.5);
      prev = q;
    }
  }
});

test("adaptive does not mutate the base preset", () => {
  const before = JSON.stringify(QUALITY.high);
  adaptivePreset(QUALITY.high, ADAPTIVE_LEVELS);
  assert.equal(JSON.stringify(QUALITY.high), before);
});
