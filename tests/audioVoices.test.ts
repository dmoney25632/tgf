import { test } from "node:test";
import assert from "node:assert/strict";
import { VoiceAllocator, arrivalDelay, distanceCutoff, distanceGain, softClipCurve, type VoiceRule } from "../src/game/audio/voices";

const RULES: Record<string, VoiceRule> = {
  gun: { max: 3, minInterval: 0.02, priority: 3, steal: "oldest" },
  enemy: { max: 2, minInterval: 0.03, priority: 1, steal: "quietest" },
  step: { max: 4, minInterval: 0.07, priority: 0.5, steal: "oldest" },
};

test("full-auto: a category never exceeds its cap; the oldest shot is stolen", () => {
  const a = new VoiceAllocator<string>(RULES, 32);
  const stolen: string[] = [];
  for (let i = 0; i < 10; i++) {
    const t = i * 0.065;
    const g = a.request("gun", t, t + 0.5, 0.7, `shot${i}`);
    assert.ok(g, `shot ${i} granted`);
    stolen.push(...g.stolen);
    assert.ok(a.count("gun") <= 3);
  }
  assert.deepEqual(stolen.slice(0, 2), ["shot0", "shot1"]);
});

test("rapid repeats inside minInterval are throttled (pellets / same-frame events)", () => {
  const a = new VoiceAllocator<number>(RULES, 32);
  assert.ok(a.request("step", 1, 1.1, 1, 1));
  assert.equal(a.request("step", 1, 1.1, 1, 2), null);
  assert.equal(a.request("step", 1.05, 1.15, 1, 3), null);
  assert.ok(a.request("step", 1.08, 1.2, 1, 4));
});

test("quietest policy: a quieter distant shot is dropped, a louder one replaces the quietest", () => {
  const a = new VoiceAllocator<string>(RULES, 32);
  assert.ok(a.request("enemy", 0, 1, 0.5, "near"));
  assert.ok(a.request("enemy", 0.05, 1, 0.1, "far"));
  assert.equal(a.request("enemy", 0.1, 1, 0.05, "farther"), null);
  const g = a.request("enemy", 0.15, 1, 0.3, "mid");
  assert.ok(g);
  assert.deepEqual(g.stolen, ["far"]);
  assert.equal(a.count("enemy"), 2);
});

test("global cap steals the least important voice across categories", () => {
  const a = new VoiceAllocator<string>(RULES, 3);
  assert.ok(a.request("step", 0, 1, 1, "step0"));
  assert.ok(a.request("step", 0.1, 1, 1, "step1"));
  assert.ok(a.request("enemy", 0.1, 1, 1, "enemy0"));
  const g = a.request("gun", 0.2, 1, 0.7, "gun0");
  assert.ok(g);
  assert.deepEqual(g.stolen, ["step0"]);
  assert.equal(a.count(), 3);
  // Nothing quieter left than a footstep: another footstep can't get in.
  assert.equal(a.request("step", 0.3, 1, 0.1, "step2"), null);
});

test("voices free up when they end or are released", () => {
  const a = new VoiceAllocator<string>(RULES, 32);
  const g = a.request("gun", 0, 0.3, 1, "a");
  a.request("gun", 0.1, 0.4, 1, "b");
  a.request("gun", 0.2, 0.5, 1, "c");
  assert.equal(a.count("gun"), 3);
  a.release(g!.id);
  assert.equal(a.count("gun"), 2);
  a.prune(0.45);
  assert.equal(a.count("gun"), 1);
  assert.deepEqual(a.clear(), ["c"]);
  assert.equal(a.count(), 0);
});

test("stress: 1000 events in one burst stay bounded", () => {
  const a = new VoiceAllocator<number>(RULES, 8);
  let granted = 0;
  for (let i = 0; i < 1000; i++) {
    const cat = ["gun", "enemy", "step"][i % 3];
    const t = i * 0.001;
    if (a.request(cat, t, t + 2, Math.random(), i)) granted++;
    assert.ok(a.count() <= 8);
  }
  assert.ok(granted < 200, `granted ${granted}`);
});

test("distance model matches PannerNode inverse curve and cuts highs far away", () => {
  assert.equal(distanceGain(1, 4, 1.2), 1);
  assert.equal(distanceGain(4, 4, 1.2), 1);
  assert.ok(Math.abs(distanceGain(14, 4, 1) - 4 / 14) < 1e-9);
  assert.equal(distanceCutoff(0), 20000);
  assert.ok(distanceCutoff(60) < 5000 && distanceCutoff(60) > 1000);
  assert.ok(distanceCutoff(500) >= 900);
  assert.ok(distanceCutoff(30) > distanceCutoff(60));
  assert.ok(Math.abs(arrivalDelay(34.3) - 0.1) < 1e-9);
  assert.equal(arrivalDelay(1000), 0.3);
});

test("soft clip: linear below the knee, never beyond full scale, odd-symmetric", () => {
  const n = 4097;
  const c = softClipCurve(n, 0.85);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    assert.ok(Math.abs(c[i]) <= 1);
    if (Math.abs(x) <= 0.85) assert.ok(Math.abs(c[i] - x) < 1e-6);
    assert.ok(Math.abs(c[i] + c[n - 1 - i]) < 1e-6);
    if (i > 0) assert.ok(c[i] >= c[i - 1]);
  }
});
