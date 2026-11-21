import { test } from "node:test";
import assert from "node:assert/strict";
import { pickWorldRoom, WORLD_COUNTDOWN_MS, type WorldListing } from "../src/game/net/world";
import { defaultCharacter, sanitizeCharacter, sanitizeLook } from "../src/game/character";

const L = (code: string, players: number, status: WorldListing["status"] = "lobby", openedAt = 1000): WorldListing => ({ id: code, code, players, status, openedAt });

test("Main World joins the fullest open lobby", () => {
  const now = 2000;
  assert.equal(pickWorldRoom([L("AAAAA", 1), L("BBBBB", 3), L("CCCCC", 2)], 4, now)?.code, "BBBBB");
});

test("Main World skips full, playing and about-to-launch squads", () => {
  const now = 1000 + WORLD_COUNTDOWN_MS - 500;
  assert.equal(pickWorldRoom([L("AAAAA", 4, "lobby", now), L("BBBBB", 1, "playing", now), L("CCCCC", 1)], 4, now), null);
});

test("character data from storage or peers is validated", () => {
  assert.deepEqual(sanitizeCharacter(null), defaultCharacter());
  const c = sanitizeCharacter({ operator: "wren", look: { uniform: 0x123456, gear: 99, skin: "red" } });
  assert.equal(c.operator, "wren");
  assert.equal(c.look.uniform, 0x123456);
  assert.equal(c.look.gear, defaultCharacter("wren").look.gear);
  assert.equal(c.look.skin, defaultCharacter("wren").look.skin);
  assert.equal(sanitizeLook({ accent: 0x1000000 }).accent, defaultCharacter().look.accent);
});
