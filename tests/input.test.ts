// Pure input logic: rebinding, settings sanitising, stick deadzone/curves and
// prompt glyph formatting. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRemap, DEFAULT_BINDINGS, DEFAULT_SETTINGS, rebind, sanitizeSettings } from "../src/game/ui/Settings";
import { lookCurve, padLayoutFromId, radialDeadzone } from "../src/game/core/Input";
import { formatPrompt } from "../src/game/ui/Glyphs";

test("rebinding swaps keys so nothing is bound twice", () => {
  const b = rebind(DEFAULT_BINDINGS, "reload", "KeyF");
  assert.equal(b.reload, "KeyF");
  assert.equal(b.interact, "KeyR");
  const codes = Object.values(b);
  assert.equal(new Set(codes).size, codes.length);
  // Defaults are untouched (immutable update).
  assert.equal(DEFAULT_BINDINGS.reload, "KeyR");
});

test("remap routes physical keys to canonical codes and swallows moved ones", () => {
  const m = buildRemap(rebind(DEFAULT_BINDINGS, "jump", "KeyE"));
  assert.equal(m.get("KeyE"), "Space");
  assert.equal(m.get("Space"), null);
  assert.equal(m.has("Digit1"), false); // unbound keys pass through
  const swap = buildRemap(rebind(DEFAULT_BINDINGS, "fire", "Mouse2"));
  assert.equal(swap.get("Mouse2"), "Mouse0");
  assert.equal(swap.get("Mouse0"), "Mouse2");
});

test("settings sanitiser clamps, fills and keeps valid values", () => {
  const s = sanitizeSettings({ fov: 200, sensitivity: -3, padCurve: "bogus" as never, invertY: true, bindings: { jump: "KeyE", melee: "Escape" } as never });
  assert.equal(s.fov, 110);
  assert.equal(s.sensitivity, 0.1);
  assert.equal(s.padCurve, DEFAULT_SETTINGS.padCurve);
  assert.equal(s.invertY, true);
  assert.equal(s.bindings.jump, "KeyE");
  assert.equal(s.bindings.melee, "KeyV"); // Escape is never bindable
  assert.equal(sanitizeSettings(null, "low").quality, "low");
});

test("radial deadzone rescales and preserves direction", () => {
  const o = { x: 0, y: 0 };
  assert.equal(radialDeadzone(0.05, 0.05, 0.12, 0.04, o), 0);
  assert.deepEqual(o, { x: 0, y: 0 });
  const n = radialDeadzone(1, 0, 0.12, 0.04, o);
  assert.equal(n, 1);
  assert.equal(o.x, 1);
  const d = radialDeadzone(0.5, 0.5, 0.12, 0.04, o);
  assert.ok(d > 0 && d < 1);
  assert.ok(Math.abs(o.x - o.y) < 1e-9);
});

test("look curves map 0→0 and 1→1, standard is finer near centre", () => {
  for (const c of ["standard", "linear", "dynamic"] as const) {
    assert.equal(lookCurve(0, c), 0);
    assert.ok(Math.abs(lookCurve(1, c) - 1) < 1e-9);
  }
  assert.ok(lookCurve(0.3, "standard") < lookCurve(0.3, "linear"));
});

test("pad layout detection and prompt glyphs", () => {
  assert.equal(padLayoutFromId("Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)"), "ps");
  assert.equal(padLayoutFromId("Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)"), "xbox");
  const kb = formatPrompt("[F] OPEN <ARMORY>", { device: "kbm", layout: "xbox", bindings: DEFAULT_BINDINGS });
  assert.ok(kb.includes("&lt;ARMORY&gt;"));
  assert.ok(kb.includes(">F<"));
  const pad = formatPrompt("[F] OPEN", { device: "pad", layout: "xbox", bindings: DEFAULT_BINDINGS });
  assert.ok(pad.startsWith("HOLD <svg"));
  const rebound = formatPrompt("[R]", { device: "kbm", layout: "xbox", bindings: rebind(DEFAULT_BINDINGS, "reload", "KeyT") });
  assert.ok(rebound.includes(">T<"));
});
