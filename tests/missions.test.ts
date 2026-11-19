// Headless tests for the mission campaign: data sanity, nav reachability of
// every scripted point on its map, and the MissionDirector flow.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { CollisionWorld } from "../src/game/world/Collision";
import { NavGrid } from "../src/game/ai/NavGrid";
import type { MapDef } from "../src/game/world/MapLoader";
import { CAMPAIGN } from "../src/game/missions/campaign";
import { getMap } from "../src/game/world/maps/registry";
import { MissionDirector, scoreMission, type DirectorHost, type MissionFacts } from "../src/game/missions/MissionDirector";
import type { MissionDef, Point } from "../src/game/missions/types";

function navFor(map: MapDef) {
  const world = new CollisionWorld();
  world.add(new THREE.Box3(new THREE.Vector3(-100, -1, -100), new THREE.Vector3(100, 0, 100)));
  for (const b of map.boxes) {
    if (b.decor) continue;
    const y = b.y ?? 0;
    world.add(new THREE.Box3(new THREE.Vector3(b.x - b.w / 2, y, b.z - b.d / 2), new THREE.Vector3(b.x + b.w / 2, y + b.h, b.z + b.d / 2)));
  }
  return new NavGrid(world, -50, -50, 100, 100);
}

function missionPoints(m: MissionDef) {
  const goals: { p: Point; what: string }[] = [];
  const entries: { p: Point; what: string }[] = [];
  m.objectives.forEach((o, i) => {
    if ("at" in o) goals.push({ p: o.at, what: `obj ${i + 1} ${o.kind}` });
    if (o.kind === "escort") {
      goals.push({ p: o.vip, what: `obj ${i + 1} vip` });
      goals.push({ p: o.to, what: `obj ${i + 1} escort goal` });
    }
    for (const w of o.waves ?? []) for (const p of w.from) entries.push({ p, what: `obj ${i + 1} ${w.type} entry` });
    for (const a of o.air ?? []) if (a.insert) entries.push({ p: a.insert, what: `obj ${i + 1} rope insert` });
  });
  return { goals, entries };
}

test("campaign: three missions on registered maps with unique ids", () => {
  assert.equal(CAMPAIGN.length, 3);
  assert.equal(new Set(CAMPAIGN.map((m) => m.id)).size, 3);
  for (const m of CAMPAIGN) {
    assert.ok(getMap(m.mapId), `${m.id} map ${m.mapId} registered`);
    assert.ok(m.objectives.length >= 4, `${m.id} has a full objective chain`);
    assert.equal(m.objectives[m.objectives.length - 1].kind, "extract", `${m.id} ends in extraction`);
  }
});

for (const m of CAMPAIGN) {
  test(`mission ${m.id}: every objective, entry and insert point is walkable and reachable`, () => {
    const map = getMap(m.mapId)!;
    const nav = navFor(map);
    const out = new Float32Array(4096);
    const { goals, entries } = missionPoints(m);
    const bad: string[] = [];
    for (const { p, what } of [{ p: m.start as Point, what: "start" }, ...goals, ...entries]) {
      const c = nav.nearestWalkable(p.x, p.z);
      if (c < 0 || Math.hypot(nav.cx(c) - p.x, nav.cz(c) - p.z) > 2.5) {
        bad.push(`${what} (${p.x}, ${p.z}) blocked`);
        continue;
      }
      if (what === "start") continue;
      const n = nav.findPath(m.start.x, m.start.z, p.x, p.z, out);
      const ok = n > 0 && Math.hypot(out[(n - 1) * 2] - p.x, out[(n - 1) * 2 + 1] - p.z) < 2.5;
      if (!ok) bad.push(`${what} (${p.x}, ${p.z}) unreachable`);
    }
    assert.deepEqual(bad, []);
  });
}

function fakeHost() {
  const log: string[] = [];
  const host: DirectorHost = {
    spawn: (type) => void log.push(`spawn ${type}`),
    launchAir: () => (log.push("air"), true),
    radio: (l) => void log.push(`radio ${l.speaker}`),
    objectiveStarted: (i, d, resumed) => void log.push(`start ${i} ${d.kind}${resumed ? " resumed" : ""}`),
    objectiveDone: (i) => void log.push(`done ${i}`),
    detonate: () => void log.push("boom"),
    vipFreed: () => void log.push("freed"),
    callExtract: () => void log.push("extract"),
    restoreCheckpoint: (i) => void log.push(`restore ${i}`),
    end: (v) => void log.push(`end ${v}`),
  };
  return { host, log };
}

const facts = (): MissionFacts => ({
  hostiles: 0, inZone: false, contested: false, interacting: false, vipAlive: true, vipDead: false,
  vipAtGoal: false, heliLanded: false, allAboard: false, teamWiped: false, spawnRoom: 20,
});

const run = (d: MissionDirector, f: MissionFacts, seconds: number) => {
  for (let t = 0; t < seconds; t += 0.1) d.update(0.1, f);
};

test("director: Black Pipe runs start to finish on facts alone", () => {
  const def = CAMPAIGN.find((m) => m.id === "black-pipe")!;
  const { host, log } = fakeHost();
  const d = new MissionDirector(def, host);
  const f = facts();
  d.start();
  assert.equal(d.state.phase, "active");
  // 1. reach
  run(d, f, 5);
  assert.ok(log.includes("spawn rifleman"), "scripted waves spawn");
  f.inZone = true;
  run(d, f, 2);
  assert.ok(log.includes("done 0"));
  // 2. destroy: plant (hold) → fuse → boom
  f.inZone = false;
  f.interacting = true;
  run(d, f, 5);
  assert.equal(d.state.stage, "armed");
  f.interacting = false;
  run(d, f, 9);
  assert.ok(log.includes("boom"));
  assert.ok(log.includes("air"), "gunship sortie launched");
  run(d, f, 2);
  assert.ok(log.includes("done 1"));
  // 3. escort: free, then walk to the goal
  f.interacting = true;
  run(d, f, 3);
  assert.ok(log.includes("freed"));
  f.interacting = false;
  f.vipAtGoal = true;
  run(d, f, 2);
  assert.ok(log.includes("done 2"));
  // 4. defend: timer only runs while held and uncontested
  f.inZone = true;
  f.contested = true;
  run(d, f, 10);
  assert.ok(d.state.timer > 55, "contested zone pauses the clock");
  f.contested = false;
  run(d, f, 62);
  assert.ok(log.includes("done 3"));
  // 5. extract
  run(d, f, 2);
  assert.ok(log.includes("extract"));
  f.heliLanded = true;
  f.allAboard = true;
  run(d, f, 1);
  assert.equal(d.state.phase, "complete");
  assert.ok(log.includes("end true"));
  assert.ok(log.includes("radio ATLAS"), "radio lines play");
  const r = scoreMission(def, d.state);
  assert.equal(r.victory, true);
  assert.equal(r.objectivesDone, def.objectives.length);
  assert.ok(r.score > 0);
  assert.equal(JSON.parse(JSON.stringify(d.state)).missionId, def.id, "state is plain serializable data");
});

test("director: a team wipe rolls back to the checkpoint, then fails after max retries", () => {
  const def = CAMPAIGN[0];
  const { host, log } = fakeHost();
  const d = new MissionDirector(def, host);
  const f = facts();
  d.start();
  f.inZone = true;
  run(d, f, 3);
  assert.equal(d.state.objective, 1);
  f.inZone = false;
  f.teamWiped = true;
  run(d, f, 0.2);
  f.teamWiped = false;
  run(d, f, 4);
  assert.ok(log.includes("restore 1"));
  assert.ok(log.includes("start 1 defend resumed"));
  assert.equal(d.state.retries, 1);
  for (let i = 0; i < 3; i++) {
    f.teamWiped = true;
    run(d, f, 0.2);
    f.teamWiped = false;
    run(d, f, 4);
  }
  assert.equal(d.state.phase, "failed");
  assert.equal(scoreMission(def, d.state).grade, "D");
});
