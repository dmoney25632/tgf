// Mobile touch controls: floating stick math, multi-touch finger routing,
// look scaling, orientation/platform detection, touch settings and layout.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FloatingStick,
  isSprintPush,
  needsRotate,
  orientationOf,
  platformFrom,
  TOUCH_RAD_PER_PX,
  TouchTracker,
  touchToMouseUnits,
  zoneFor,
} from "../src/game/mobile/touchMath";
import { DEFAULT_TOUCH_SETTINGS, sanitizeTouchSettings } from "../src/game/mobile/touchSettings";
import { buttonRect, TOUCH_BUTTONS } from "../src/game/mobile/layout";
import { MOBILE_OVERRIDES } from "../src/game/mobile/mobileQuality";

const cfg = { radius: 50, deadzone: 0.1, sprintAt: 1.05, follow: 1.6 };

test("floating stick: base appears under the thumb, deadzone, forward = screen up", () => {
  const s = new FloatingStick(cfg);
  s.start(7, 100, 300);
  assert.equal(s.active, true);
  assert.equal(s.ox, 100);
  s.move(102, 299); // inside the deadzone
  assert.equal(s.x, 0);
  assert.equal(s.y, 0);
  s.move(100, 250); // full push up
  assert.ok(Math.abs(s.y - 1) < 1e-9);
  assert.ok(Math.abs(s.x) < 1e-9);
  s.move(125, 300); // half push right (after deadzone rescale)
  assert.ok(s.x > 0.4 && s.x < 0.5, `x=${s.x}`);
  assert.equal(s.y === 0 || Object.is(s.y, -0), true);
  s.end();
  assert.equal(s.active, false);
  assert.equal(s.x, 0);
});

test("floating stick: knob clamps to the rim and the base follows a wandering thumb", () => {
  const s = new FloatingStick(cfg);
  s.start(1, 0, 0);
  s.move(0, -70); // 1.4 × radius: knob stays on the rim
  assert.equal(s.ky, -50);
  assert.equal(s.oy, 0);
  s.move(0, -200); // beyond follow distance: base is dragged
  assert.ok(Math.abs(s.oy - -120) < 1e-9, `oy=${s.oy}`);
  assert.ok(Math.abs(s.y - 1) < 1e-9);
});

test("sprint only when pushed over the rim, roughly forward", () => {
  const s = new FloatingStick(cfg);
  s.start(1, 0, 0);
  s.move(0, -50); // exactly the rim (1.0 < 1.05)
  assert.equal(s.sprint, false);
  s.move(0, -60);
  assert.equal(s.sprint, true);
  s.move(60, 0); // sideways over the rim: no sprint
  assert.equal(s.sprint, false);
  s.move(0, 60); // backwards: no sprint
  assert.equal(s.sprint, false);
  assert.equal(isSprintPush(1.2, 0.5, 0.7, 1.05), true);
  assert.equal(isSprintPush(1.2, 0.7, 0.7, 1.05), false);
});

test("zones: left half moves, right half looks; mirrored when left-handed", () => {
  assert.equal(zoneFor(100, 800, false), "stick");
  assert.equal(zoneFor(500, 800, false), "look");
  assert.equal(zoneFor(100, 800, true), "look");
  assert.equal(zoneFor(500, 800, true), "stick");
});

test("touch tracker: each finger keeps its role; one stick; buttons tracked by id", () => {
  const t = new TouchTracker();
  assert.equal(t.down(1, 50, 300, "stick").kind, "stick");
  // A second finger in the stick half becomes a look finger.
  assert.equal(t.down(2, 60, 200, "stick").kind, "look");
  const fire = t.down(3, 700, 300, "look", "fire", true);
  assert.deepEqual(fire, { kind: "button", id: "fire", look: true });
  assert.equal(t.holding("fire"), true);
  assert.equal(t.size, 3);
  assert.equal(t.up(3)?.kind, "button");
  assert.equal(t.holding("fire"), false);
  assert.equal(t.up(99), undefined);
  t.up(1);
  assert.equal(t.hasStick(), false);
  assert.equal(t.down(4, 40, 300, "stick").kind, "stick");
});

test("touch tracker: only the latest aiming finger turns the view", () => {
  const t = new TouchTracker();
  const d = { x: 0, y: 0 };
  t.down(1, 600, 200, "look");
  t.move(1, 610, 205, d);
  assert.deepEqual(d, { x: 10, y: 5 });
  t.down(2, 700, 300, "look", "fire", true); // fire button drag takes over aiming
  t.move(1, 640, 205, d);
  assert.deepEqual(d, { x: 0, y: 0 });
  t.move(2, 690, 310, d);
  assert.deepEqual(d, { x: -10, y: 10 });
  t.up(2); // look hands back to finger 1, from its latest position
  t.move(1, 650, 205, d);
  assert.deepEqual(d, { x: 10, y: 0 });
  // Non-aiming buttons never produce look.
  t.down(3, 750, 100, "look", "reload", false);
  t.move(3, 780, 140, d);
  assert.deepEqual(d, { x: 0, y: 0 });
  t.clear();
  assert.equal(t.size, 0);
});

test("touch look converts to mouse units with its own sensitivity and ADS scale", () => {
  const mouseRad = 0.0028 * 1.5; // engine: base × mouse sensitivity (hip)
  const u = touchToMouseUnits(100, 1, 0.6, 0, mouseRad);
  assert.ok(Math.abs(u * mouseRad - 100 * TOUCH_RAD_PER_PX) < 1e-12);
  // Full ADS: 60% of the hip turn (independent of the mouse's ADS factor).
  const adsMouseRad = mouseRad * 0.62;
  const a = touchToMouseUnits(100, 1, 0.6, 1, adsMouseRad);
  assert.ok(Math.abs(a * adsMouseRad - 100 * TOUCH_RAD_PER_PX * 0.6) < 1e-12);
  assert.equal(touchToMouseUnits(100, 1, 1, 0, 0), 0);
  assert.ok(touchToMouseUnits(-40, 2, 1, 0, mouseRad) < 0);
});

test("orientation and the rotate prompt", () => {
  assert.equal(orientationOf(390, 844), "portrait");
  assert.equal(orientationOf(844, 390), "landscape");
  assert.equal(needsRotate(true, 390, 844), true);
  assert.equal(needsRotate(true, 844, 390), false);
  assert.equal(needsRotate(false, 390, 844), false); // desktop window: never
  assert.equal(needsRotate(true, 820, 1180), false); // upright tablet is fine
});

test("platform detection: iPhone, iPadOS (Mac UA + touch), Android, desktop", () => {
  const iphone = platformFrom("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15", 5, true);
  assert.deepEqual(iphone, { ios: true, android: false, touch: true });
  const ipad = platformFrom("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15", 5, true);
  assert.equal(ipad.ios, true);
  const mac = platformFrom("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15", 0, false);
  assert.deepEqual(mac, { ios: false, android: false, touch: false });
  const android = platformFrom("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/131 Mobile", 5, true);
  assert.deepEqual(android, { ios: false, android: true, touch: true });
  // A touchscreen laptop with a mouse (fine primary pointer) keeps mouse controls.
  assert.equal(platformFrom("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", 10, false).touch, false);
});

test("touch settings sanitiser clamps and fills", () => {
  assert.deepEqual(sanitizeTouchSettings(null), DEFAULT_TOUCH_SETTINGS);
  const s = sanitizeTouchSettings({ sensitivity: 99, opacity: -1, leftHanded: true, buttonScale: "big", leftFire: 1 });
  assert.equal(s.sensitivity, 3);
  assert.equal(s.opacity, 0.15);
  assert.equal(s.leftHanded, true);
  assert.equal(s.buttonScale, 1);
  assert.equal(s.leftFire, true);
});

test("layout: buttons fit a small landscape phone and keep the crosshair clear", () => {
  // iPhone SE landscape at default size; a 6.1" phone at the largest size.
  for (const [w, h, scale] of [[667, 375, 1], [844, 390, 1.3]])
  for (const left of [false, true]) {
    for (const b of TOUCH_BUTTONS) {
      const r = buttonRect(b, w, h, scale, left);
      assert.ok(r.left >= 0 && r.left + r.width <= w, `${b.id} x out of bounds`);
      assert.ok(r.top >= 0 && r.top + r.height <= h, `${b.id} y out of bounds`);
      if (b.center) continue; // contextual pills sit below the crosshair
      // Nothing within 100 px of the screen centre.
      const cx = Math.max(r.left, Math.min(w / 2, r.left + r.width));
      const cy = Math.max(r.top, Math.min(h / 2, r.top + r.height));
      assert.ok(Math.hypot(cx - w / 2, cy - h / 2) > 100, `${b.id} crowds the crosshair`);
    }
  }
  const ids = TOUCH_BUTTONS.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("mobile presets cap resolution near 1.5× and drop the costly passes", () => {
  assert.ok((MOBILE_OVERRIDES.medium.maxPixelRatio ?? 9) <= 1.5);
  assert.ok((MOBILE_OVERRIDES.low.maxPixelRatio ?? 9) <= 1.25);
  for (const q of ["low", "medium", "high"] as const) {
    assert.equal(MOBILE_OVERRIDES[q].godRays, false);
    assert.equal(MOBILE_OVERRIDES[q].msaaSamples, 0);
    assert.ok((MOBILE_OVERRIDES[q].minResolutionScale ?? 1) < (MOBILE_OVERRIDES[q].resolutionScale ?? 1));
  }
});
