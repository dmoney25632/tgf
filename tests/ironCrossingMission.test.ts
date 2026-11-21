// Mission-flow tests for Iron Crossing: data sanity, every scripted point
// reachable on the map's own nav window, perched snipers standing on real
// tops, the director running start → extraction with checkpoints and
// retries, and the star rating.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { CollisionWorld } from "../src/game/world/Collision";
import { NavGrid } from "../src/game/ai/NavGrid";
import { getMap } from "../src/game/world/maps/registry";
import { ALL_MISSIONS, CAMPAIGN, getMission } from "../src/game/missions/campaign";
import { IRON_CROSSING_MISSION, MISSION_AMMO, OPERATIONS } from "../src/game/missions/operations";
import { MissionDirector, scoreMission, type DirectorHost, type MissionFacts } from "../src/game/missions/MissionDirector";
import { rateMission, starTargets, clock } from "../src/game/missions/rating";
import type { Point } from "../src/game/missions/types";

const def = IRON_CROSSING_MISSION;
const map = getMap(def.mapId)!;

let cached: NavGrid | null = null;
function nav() {
  if (cached) return cached;
  const world = new CollisionWorld();
  world.add(new THREE.Box3(new THREE.Vector3(-400, -1, -400), new THREE.Vector3(400, 0, 400)));
  for (const b of map.boxes) {
    if (b.decor) continue;
    const y = b.y ?? 0;
    world.add(new THREE.Box3(new THREE.Vector3(b.x - b.w / 2, y, b.z - b.d / 2), new THREE.Vector3(b.x + b.w / 2, y + b.h, b.z + b.d / 2)));
  }
  const w = map.nav!;
  cached = new NavGrid(world, w.minX, w.minZ, w.width, w.depth);
  return cached;
}

test("operations: Iron Crossing is registered, separate from the 3-mission campaign", () => {
  assert.equal(CAMPAIGN.length, 3);
  assert.ok(OPERATIONS.includes(def));
  assert.equal(new Set(ALL_MISSIONS.map((m) => m.id)).size, ALL_MISSIONS.length);
  assert.equal(getMission("iron-crossing"), def);
  assert.ok(map, "map registered");
  assert.ok(map.nav, "map sizes its own nav window");
  assert.equal(def.objectives[def.objectives.length - 1].kind, "extract");
  assert.ok(def.objectives.some((o) => o.air?.length), "a gunship moment");
  assert.ok(def.objectives.some((o) => o.waves?.some((w) => w.type === "sniper")), "snipers");
  assert.ok(def.briefing.length > 80 && (def.notes?.length ?? 0) >= 3, "loading-screen briefing");
  assert.ok(def.stars && def.stars[0] < def.stars[1], "star targets");
  for (const o of def.objectives) assert.ok(o.checkpoint, `${o.title} has a checkpoint`);
});

test("Iron Crossing: every objective, checkpoint, entry, insert and crate is reachable", () => {
  const n = nav();
  const out = new Float32Array(8192);
  const pts: { p: Point; what: string }[] = [];
  def.objectives.forEach((o, i) => {
    if ("at" in o) pts.push({ p: o.at, what: `obj ${i + 1} ${o.kind}` });
    if (o.checkpoint) pts.push({ p: o.checkpoint, what: `obj ${i + 1} checkpoint` });
    for (const w of o.waves ?? []) for (const p of w.from) if (p.y === undefined) pts.push({ p, what: `obj ${i + 1} ${w.type} entry` });
    for (const a of o.air ?? []) if (a.insert) pts.push({ p: a.insert, what: `obj ${i + 1} rope insert` });
  });
  for (const p of MISSION_AMMO[def.id]) pts.push({ p: { x: p.x + 1.3, z: p.z }, what: "ammo crate" });
  const bad: string[] = [];
  for (const { p, what } of pts) {
    const c = n.nearestWalkable(p.x, p.z);
    if (c < 0 || Math.hypot(n.cx(c) - p.x, n.cz(c) - p.z) > 2.5) {
      bad.push(`${what} (${p.x}, ${p.z}) blocked`);
      continue;
    }
    const k = n.findPath(def.start.x, def.start.z, p.x, p.z, out, 60000);
    if (!(k > 0 && Math.hypot(out[(k - 1) * 2] - p.x, out[(k - 1) * 2 + 1] - p.z) < 2.5)) bad.push(`${what} (${p.x}, ${p.z}) unreachable`);
  }
  assert.deepEqual(bad, []);
});

test("Iron Crossing: perched snipers stand on the top of a solid box", () => {
  for (const o of def.objectives) {
    for (const w of o.waves ?? []) {
      for (const p of w.from) {
        if (p.y === undefined) continue;
        const top = map.boxes.find((b) => !b.decor && Math.abs(b.x - p.x) < b.w / 2 && Math.abs(b.z - p.z) < b.d / 2 && Math.abs((b.y ?? 0) + b.h - p.y!) < 0.05);
        assert.ok(top, `perch (${p.x}, ${p.y}, ${p.z}) sits on a box top`);
      }
    }
  }
});

function fakeHost() {
  const log: string[] = [];
  const host: DirectorHost = {
    spawn: (type, _x, _z, _e, y) => void log.push(`spawn ${type}${y !== undefined ? " perched" : ""}`),
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
  vipAtGoal: false, heliLanded: false, allAboard: false, teamWiped: false, spawnRoom: 28,
});
const run = (d: MissionDirector, f: MissionFacts, seconds: number) => {
  for (let t = 0; t < seconds; t += 0.1) d.update(0.1, f);
};

test("Iron Crossing director: insertion → bridgehead → train → bunker → yard → extraction", () => {
  const { host, log } = fakeHost();
  const d = new MissionDirector(def, host);
  const f = facts();
  d.start();
  // 1. Brask: the tower sniper is placed perched.
  run(d, f, 4);
  assert.ok(log.includes("spawn sniper perched"));
  f.inZone = true;
  run(d, f, 1);
  assert.ok(log.includes("done 0"));
  // 2. Bridgehead: clearFirst — standing in the zone isn't enough while hostiles live.
  f.hostiles = 3;
  run(d, f, 30);
  assert.ok(!log.includes("done 1"), "can't seize the checkpoint while it's held");
  f.hostiles = 0;
  run(d, f, 0.5);
  assert.ok(log.includes("done 1"));
  f.inZone = false;
  run(d, f, 1.5);
  assert.equal(d.state.checkpoint, 2, "reaching the next section saves it");
  // 3. Train: gunship sortie while crossing.
  run(d, f, 22);
  assert.ok(log.includes("spawn sniper perched") && log.filter((l) => l === "spawn sniper perched").length >= 2, "mast sniper");
  f.inZone = true;
  run(d, f, 2);
  assert.ok(log.includes("air"));
  assert.ok(log.includes("done 2"));
  // 4. Bunker: plant, fuse, boom.
  f.inZone = false;
  f.interacting = true;
  run(d, f, 5);
  assert.equal(d.state.stage, "armed");
  f.interacting = false;
  run(d, f, 8);
  assert.ok(log.includes("boom"));
  run(d, f, 2);
  assert.ok(log.includes("done 3"));
  // A wipe at the yard rolls back to the yard, not the start.
  f.teamWiped = true;
  run(d, f, 0.2);
  f.teamWiped = false;
  run(d, f, 4);
  assert.ok(log.includes("restore 4"));
  assert.ok(log.includes("start 4 defend resumed"));
  assert.equal(d.state.retries, 1);
  // 5. Hold the yard.
  f.inZone = true;
  run(d, f, 95);
  assert.ok(log.includes("done 4"));
  // 6. Extract.
  run(d, f, 2);
  assert.ok(log.includes("extract"));
  f.heliLanded = true;
  f.allAboard = true;
  run(d, f, 1);
  assert.equal(d.state.phase, "complete");
  d.credit("down");
  const r = scoreMission(def, d.state, 1, "regular");
  assert.equal(r.victory, true);
  assert.equal(r.downs, 1);
  assert.equal(r.difficulty, "regular");
  assert.ok(r.stars >= 1 && r.stars <= 3);
  assert.equal(JSON.parse(JSON.stringify(d.state)).downs, 1, "downs are part of the replicated state");
});

test("Iron Crossing director: per-mission retry budget", () => {
  const { host } = fakeHost();
  const d = new MissionDirector(def, host);
  const f = facts();
  d.start();
  assert.equal(d.maxRetries, 5);
  for (let i = 0; i < 5; i++) {
    f.teamWiped = true;
    run(d, f, 0.2);
    f.teamWiped = false;
    run(d, f, 4);
    assert.equal(d.state.phase, "active", `retry ${i + 1} keeps the mission alive`);
  }
  f.teamWiped = true;
  run(d, f, 0.5);
  assert.equal(d.state.phase, "failed");
  assert.equal(scoreMission(def, d.state, 1, "regular").stars, 0);
});

test("star rating: time, deaths and difficulty", () => {
  const t = starTargets(def, "regular");
  assert.deepEqual(t, { three: def.stars![0], two: def.stars![1] });
  const base = { victory: true, difficulty: "regular", retries: 0, downs: 0 };
  assert.equal(rateMission(def, { ...base, seconds: t.three }).stars, 3);
  assert.equal(rateMission(def, { ...base, seconds: t.two }).stars, 2);
  assert.equal(rateMission(def, { ...base, seconds: t.two + 1 }).stars, 1);
  // Deaths past the allowance cost a star (a retry counts double).
  assert.equal(rateMission(def, { ...base, seconds: t.three, downs: 1 }).stars, 3);
  assert.equal(rateMission(def, { ...base, seconds: t.three, downs: 2 }).stars, 2);
  assert.equal(rateMission(def, { ...base, seconds: t.three, retries: 1 }).stars, 2);
  assert.equal(rateMission(def, { ...base, seconds: t.three, retries: 3 }).stars, 1);
  // Never below one on a win, zero on a loss.
  assert.equal(rateMission(def, { ...base, seconds: 99999, retries: 5 }).stars, 1);
  assert.equal(rateMission(def, { ...base, victory: false, seconds: 10 }).stars, 0);
  // Recruit: stricter times and capped at two; Veteran: more lenient, two minimum when clean.
  const rt = starTargets(def, "recruit"), vt = starTargets(def, "veteran");
  assert.ok(rt.three < t.three && vt.three > t.three);
  assert.equal(rateMission(def, { ...base, difficulty: "recruit", seconds: 10 }).stars, 2);
  assert.equal(rateMission(def, { ...base, difficulty: "veteran", seconds: 99999 }).stars, 2);
  assert.equal(rateMission(def, { ...base, difficulty: "veteran", seconds: vt.three, downs: 2 }).stars, 3);
  assert.equal(clock(605), "10:05");
});
