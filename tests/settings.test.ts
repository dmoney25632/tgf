import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, sanitizeSettings } from "../src/game/ui/Settings";
import { LOOK, QUALITY } from "../src/game/config";

test("new settings default to smooth play: auto quality on, OS pointer feel", () => {
  assert.equal(DEFAULT_SETTINGS.autoQuality, true);
  assert.equal(DEFAULT_SETTINGS.rawInput, false);
});

test("old saved settings (no rawInput / autoQuality) pick up the defaults", () => {
  const s = sanitizeSettings({ quality: "high", sensitivity: 1.4 });
  assert.equal(s.rawInput, false);
  assert.equal(s.autoQuality, true);
  assert.equal(s.quality, "high");
  assert.equal(s.sensitivity, 1.4);
});

test("toggles round-trip and junk falls back", () => {
  assert.equal(sanitizeSettings({ rawInput: true, autoQuality: false }).rawInput, true);
  assert.equal(sanitizeSettings({ rawInput: true, autoQuality: false }).autoQuality, false);
  assert.equal(sanitizeSettings({ rawInput: "yes" as unknown as boolean }).rawInput, false);
});

test("mouse look is responsive: a 1000 px swipe at sensitivity 1 turns well past 90°", () => {
  const deg = (1000 * LOOK.baseSensitivity * 180) / Math.PI;
  assert.ok(deg > 140 && deg < 200, `${deg.toFixed(0)}°`);
});

test("every preset leaves dynamic resolution room to drop", () => {
  for (const q of Object.values(QUALITY)) assert.ok(q.minResolutionScale < q.resolutionScale, q.label);
});

test("audio mix + vertical ratio default sensibly and clamp junk", () => {
  const d = sanitizeSettings({});
  assert.equal(d.effectsVolume, 1);
  assert.equal(d.uiVolume, 0.85);
  assert.equal(d.verticalRatio, 1);
  const s = sanitizeSettings({ effectsVolume: 4, uiVolume: -1, verticalRatio: 9 });
  assert.equal(s.effectsVolume, 1);
  assert.equal(s.uiVolume, 0);
  assert.equal(s.verticalRatio, 1.5);
});
