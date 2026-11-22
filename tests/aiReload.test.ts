// AI magazine sizes for the soldiers' reload cycle (AgentManager). Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { aiMagSize } from "../src/game/ai/AgentManager";
import { ENEMIES, SQUAD } from "../src/game/survival/config";

test("every AI weapon gets a sane magazine, longer than its longest burst", () => {
  for (const [k, e] of [...Object.entries(ENEMIES), ["squad", SQUAD]] as [string, { weapon: Parameters<typeof aiMagSize>[0] }][]) {
    const n = aiMagSize(e.weapon);
    assert.ok(n >= 5 && n <= 100, `${k}: ${n}`);
    assert.ok(n >= e.weapon.burst[1], `${k}: ${n} rounds < burst ${e.weapon.burst[1]}`);
  }
  assert.equal(aiMagSize({ rpm: 70, burst: [1, 1] }), 6); // pump shotgun
  assert.equal(aiMagSize({ rpm: 820, burst: [24, 40] }), 100); // belt fed
  assert.equal(aiMagSize({ rpm: 520, burst: [3, 7] }), 30);
});
