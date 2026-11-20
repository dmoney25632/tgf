import { test } from "node:test";
import assert from "node:assert/strict";
import { dynamicResolutionBudget, snapRefreshMs } from "../src/game/render/dynamicResolution";
import { QUALITY } from "../src/game/config";

const hz = (ms: number) => Math.round(1000 / ms);

test("refresh snapping picks the common rate the frame pacing fits", () => {
  assert.equal(hz(snapRefreshMs(16.7)), 60);
  assert.equal(hz(snapRefreshMs(8.4)), 120);
  assert.equal(hz(snapRefreshMs(6.95)), 144);
  assert.equal(hz(snapRefreshMs(4.2)), 240);
  // Slower than 60 never claims a sub-60 display.
  assert.equal(hz(snapRefreshMs(25)), 60);
});

test("60 Hz: the preset budget, full resolution range", () => {
  const q = QUALITY.medium;
  const b = dynamicResolutionBudget(q, 1000 / 60, 18);
  assert.equal(b.target, q.targetFrameMs);
  assert.equal(b.floor, q.minResolutionScale);
});

test("144 Hz: chases the refresh rate but only with gentle drops", () => {
  const q = QUALITY.high;
  const b = dynamicResolutionBudget(q, 1000 / 144, 9);
  assert.ok(Math.abs(b.target - 1000 / 144) < 1e-6);
  assert.ok(b.floor >= 0.8 * q.resolutionScale - 1e-6);
  assert.ok(b.floor > q.minResolutionScale);
});

test("high refresh but missing 60 fps: falls back to the hard budget and full range", () => {
  const q = QUALITY.high;
  const b = dynamicResolutionBudget(q, 1000 / 144, 22);
  assert.equal(b.target, q.targetFrameMs);
  assert.equal(b.floor, q.minResolutionScale);
});

test("never chases past 144 Hz", () => {
  const b = dynamicResolutionBudget(QUALITY.medium, 1000 / 240, 5);
  assert.ok(b.target >= 1000 / 144 - 1e-6);
});
