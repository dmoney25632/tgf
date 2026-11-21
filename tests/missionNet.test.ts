// Co-op missions over the existing net protocol: the binary tables are
// unchanged (missions ride the JSON side channels), Iron Crossing's large
// map fits the position quantisation, and room settings stay compatible
// with rooms that have no mission.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodePlayerState, encodePlayerState, SnapshotDecoder, SnapshotEncoder, type EnemyRec, type HostEvent, type PlayerStateMsg, type StatePayload } from "../src/game/net/protocol";
import { COOP_MAPS, coopMission, coopRoomMap } from "../src/game/net/ids";
import type { RoomSettings } from "../src/game/net/transport";
import { newMissionState } from "../src/game/missions/MissionDirector";
import { IRON_CROSSING_MISSION } from "../src/game/missions/operations";
import { BOUNDS } from "../src/game/world/maps/ironCrossing";

const msg = (over: Partial<PlayerStateMsg> = {}): PlayerStateMsg => ({
  slot: 1, seq: 7, time: 123456, x: BOUNDS.x1 - 1, y: 2.4, z: BOUNDS.z1 - 1, yaw: 1, pitch: 0.2,
  crouch: false, sprint: true, slide: false, grounded: true, ads: false, downed: false, selfReviving: false,
  ready: false, weapon: 0, shots: 2, reviveTarget: 255, ...over,
});

test("mission co-op: player state is still the same binary record, and the map's far corners fit", () => {
  for (const [x, z] of [[BOUNDS.x0 + 1, BOUNDS.z0 + 1], [BOUNDS.x1 - 1, BOUNDS.z1 - 1]]) {
    const bytes = encodePlayerState(msg({ x, z }));
    assert.equal(bytes.length, 23, "no new fields in the binary state");
    const back = decodePlayerState(bytes)!;
    assert.ok(Math.abs(back.x - x) < 0.02 && Math.abs(back.z - z) < 0.02, `(${x}, ${z}) round-trips`);
  }
});

test("mission co-op: a perched sniper on the far bank round-trips in snapshots", () => {
  const sniper: EnemyRec = {
    id: 9, type: 3, elite: false, maxHealth: 90, x: 30, y: 7.6, z: -90, yaw: 2, pitch: -0.1,
    state: 0, crouched: false, aiming: true, health: 90, target: 1, charge: 0.4, shots: 0,
  };
  const enc = new SnapshotEncoder();
  const dec = new SnapshotDecoder();
  const f = dec.apply(enc.encode({ time: 1, wave: 0, phase: 1, timer: 0, remaining: 3, players: [], enemies: [sniper] }))!;
  const e = f.enemies.get(9)!;
  assert.ok(Math.abs(e.y - 7.6) < 0.02 && Math.abs(e.z + 90) < 0.02);
});

test("mission co-op: mission traffic is plain JSON on the existing side channels", () => {
  const s = newMissionState(IRON_CROSSING_MISSION.id);
  s.objective = 3;
  s.stage = "armed";
  s.downs = 2;
  const events: HostEvent[] = [
    { k: "ms", s },
    { k: "mev", e: { type: "radio", speaker: "ATLAS", text: "Charge on the rear door." } },
    { k: "mev", e: { type: "detonate", index: 3 } },
    { k: "air", h: [[12, 220, -300, 157, 1400, 1900, 1], [0, 0, 0, 0, 0, 0, 0]] },
    // Survival kinds are untouched.
    { k: "respawn", to: 1, x: 0, z: 160 },
  ];
  const back = JSON.parse(JSON.stringify(events)) as HostEvent[];
  assert.deepEqual(back, events);
  const extras: StatePayload = { b: "AAAA", i: 1, hh: [[0, 455, 1, 0]] };
  assert.deepEqual(JSON.parse(JSON.stringify(extras)), extras);
});

test("mission co-op: rooms without a mission are Survival rooms, escorts stay solo-only", () => {
  const old: RoomSettings = { mapId: COOP_MAPS[1].id, difficulty: "regular", waveTarget: 10, startWave: 1 };
  assert.equal(coopRoomMap(old.mapId, old.missionId), COOP_MAPS[1]);
  assert.equal(coopRoomMap("nope", undefined), COOP_MAPS[0]);
  assert.equal(coopMission("iron-crossing"), IRON_CROSSING_MISSION);
  assert.equal(coopRoomMap(old.mapId, "iron-crossing").id, "iron-crossing");
  assert.equal(coopMission("black-pipe"), undefined, "escort missions need a replicated VIP");
  assert.equal(coopMission("not-a-mission"), undefined);
});
