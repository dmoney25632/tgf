// Stealth: the pure detection math (sight, light, stance, cover, hearing),
// the stealth star rules, the director's assassinate / compromise hooks, and
// the Nightjar stealth layer driven headless on the real Greywater colliders
// with real Agents and a stand-in agent manager.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  DETECT, NOISE, angleWeight, coneLight, effectiveRange, hears, lightAt, profile, secondsToDetect, stepGauge, stepNoise, visionRate,
  type Observer, type Subject,
} from "../src/game/missions/stealth/detection";
import { rateMission, isGhost } from "../src/game/missions/rating";
import { MissionDirector, scoreMission, type DirectorHost, type MissionFacts } from "../src/game/missions/MissionDirector";
import { NIGHTJAR_MISSION } from "../src/game/missions/stealth/nightjar";
import { StealthDirector, truckPose } from "../src/game/missions/stealth/StealthDirector";
import { getMission } from "../src/game/missions/campaign";
import { Agent } from "../src/game/ai/Agent";
import type { AgentManager } from "../src/game/ai/AgentManager";
import type { Combatant } from "../src/game/ai/types";
import { CollisionWorld } from "../src/game/world/Collision";
import { ENEMIES, type EnemyType } from "../src/game/survival/config";
import { GREYWATER, OFFICE, TRUCK_LOOP } from "../src/game/world/maps/greywater";
import type { StealthTally } from "../src/game/missions/types";

const guard = (over: Partial<Observer> = {}): Observer => ({ x: 0, y: 1.6, z: 0, yaw: 0, awareness: 0, ...over });
const subj = (over: Partial<Subject> = {}): Subject => ({ x: 0, y: 1.5, z: 10, crouching: false, speed: 1.5, concealment: 0, light: 0.1, ...over });

// ---- Sight ----------------------------------------------------------------------------------------

test("detection: light sets how far a guard can see", () => {
  assert.ok(effectiveRange(1, 0) > effectiveRange(0.1, 0) * 2.5);
  assert.ok(Math.abs(effectiveRange(0, 0) - DETECT.range * DETECT.darkRange) < 1e-9);
  // 20 m away: invisible in moonlight, seen under a lamp.
  assert.equal(visionRate(guard(), subj({ z: 20, light: 0.1 }), true), 0);
  assert.ok(visionRate(guard(), subj({ z: 20, light: 1 }), true) > 0);
  // Alerted guards see further.
  assert.ok(effectiveRange(0.5, 2) > effectiveRange(0.5, 1) && effectiveRange(0.5, 1) > effectiveRange(0.5, 0));
});

test("detection: vision cone — sharp centre, weak periphery, blind behind", () => {
  assert.equal(angleWeight(0), 1);
  assert.equal(angleWeight(DETECT.focus), 1);
  assert.ok(angleWeight((DETECT.focus + DETECT.fov) / 2) < 1);
  assert.equal(angleWeight(DETECT.fov + 0.01), 0);
  // Agent yaw 0 faces +z: a subject at −z is behind.
  assert.equal(visionRate(guard(), subj({ z: -6, light: 1 }), true), 0);
  assert.ok(visionRate(guard(), subj({ z: 6, light: 1 }), true) > 0);
  // Line of sight is required.
  assert.equal(visionRate(guard(), subj({ z: 6, light: 1 }), false), 0);
});

test("detection: crouching, standing still, cover and sprinting", () => {
  const walk = profile({ crouching: false, speed: 1.5, concealment: 0 });
  assert.ok(profile({ crouching: true, speed: 1.5, concealment: 0 }) < walk);
  assert.ok(profile({ crouching: false, speed: 0, concealment: 0 }) < walk);
  assert.ok(profile({ crouching: false, speed: 6, concealment: 0 }) > walk);
  // Crouched in tall grass you're nearly invisible; standing in it helps a little.
  const hidden = profile({ crouching: true, speed: 0, concealment: 1 });
  assert.ok(hidden < walk * 0.08, `crouched in grass ${hidden}`);
  assert.ok(profile({ crouching: false, speed: 1.5, concealment: 1 }) > walk * 0.6);
  // Time to be identified at 8 m in moonlight: walking upright vs crouched still in reeds.
  const upright = secondsToDetect(guard(), subj({ z: 8 }));
  const reeds = secondsToDetect(guard(), subj({ z: 8, crouching: true, speed: 0, concealment: 0.95 }));
  assert.ok(upright < 3, `upright ${upright.toFixed(2)} s`);
  assert.ok(reeds > 20, `reeds ${reeds.toFixed(1)} s`);
});

test("detection: close sense catches an upright walker from behind, not a crouch-walker", () => {
  assert.ok(visionRate(guard(), subj({ z: -1.2, speed: 1.5 }), true) > 0);
  assert.equal(visionRate(guard(), subj({ z: -1.2, speed: 1.5, crouching: true, y: 1 }), true), 0);
});

test("detection: the gauge fills while seen, holds for a grace period, then decays", () => {
  let g = 0;
  g = stepGauge(g, 0.5, 1, 0, "regular");
  assert.ok(Math.abs(g - 0.5) < 1e-9);
  assert.ok(stepGauge(0, 0.5, 1, 0, "veteran") > stepGauge(0, 0.5, 1, 0, "recruit"), "difficulty scales fill");
  assert.equal(stepGauge(g, 0, 1, DETECT.grace - 0.1, "regular"), g, "grace");
  assert.ok(stepGauge(g, 0, 1, DETECT.grace + 1, "regular") < g, "decay");
  assert.equal(stepGauge(0.999, 10, 1, 0, "regular"), 1, "capped");
});

test("detection: light sources add up and cap at 1", () => {
  const cone = { x: 0, z: 0, dx: 0, dz: 1, reach: 20, halfAngle: 0.4, strength: 0.9 };
  assert.ok(coneLight(cone, 0, 8) > 0.4);
  assert.equal(coneLight(cone, 8, 0), 0, "outside the cone");
  assert.equal(coneLight(cone, 0, 25), 0, "past its reach");
  assert.ok(Math.abs(lightAt(0.1, 0, 0, [{ x: 0, z: 0, radius: 4 }], []) - 1) < 1e-9);
  assert.ok(Math.abs(lightAt(0.1, 50, 50, [{ x: 0, z: 0, radius: 4 }], [cone]) - 0.1) < 1e-9);
});

// ---- Hearing --------------------------------------------------------------------------------------

test("hearing: gunshots carry, suppressed shots and crouch-walking don't", () => {
  const g = { x: 0, z: 0 };
  assert.ok(hears(g, { x: 60, z: 0 }, "gunshot", false));
  assert.ok(!hears(g, { x: 60, z: 0 }, "suppressed", false));
  assert.ok(hears(g, { x: 5, z: 0 }, "suppressed", false));
  assert.ok(!hears(g, { x: 5, z: 0 }, "suppressed", true), "walls muffle");
  assert.ok(!hears(g, { x: 0.5, z: 0 }, "crouchWalk", false));
  assert.ok(hears(g, { x: 3, z: 0 }, "walk", false) && !hears(g, { x: 6, z: 0 }, "walk", false));
  assert.ok(hears(g, { x: 8, z: 0 }, "sprint", false));
  assert.ok(NOISE.gunshot > NOISE.sprint && NOISE.sprint > NOISE.suppressed && NOISE.suppressed > NOISE.walk);
  assert.equal(stepNoise(0.2, false, false), null);
  assert.equal(stepNoise(2, true, false), "crouchWalk");
  assert.equal(stepNoise(2, false, false), "walk");
  assert.equal(stepNoise(6, false, true), "sprint");
});

// ---- Stars ------------------------------------------------------------------------------------------

const tally = (over: Partial<StealthTally> = {}): StealthTally => ({ alarms: 0, spotted: 0, kills: 0, takedowns: 0, bodies: 0, ...over });
const run = (over: Partial<Parameters<typeof rateMission>[1]> = {}) =>
  rateMission(NIGHTJAR_MISSION, { victory: true, seconds: 500, difficulty: "regular", retries: 0, downs: 0, stealth: tally(), ...over });

test("stealth stars: alarms, kills and the ghost bonus", () => {
  assert.equal(run().stars, 3);
  assert.equal(run({ stealth: tally({ alarms: 1 }) }).stars, 2);
  assert.equal(run({ stealth: tally({ alarms: 2 }) }).stars, 1);
  assert.equal(run({ stealth: tally({ alarms: 5 }) }).stars, 1, "never below one");
  assert.equal(run({ stealth: tally({ kills: 12, spotted: 1 }) }).stars, 3, "12 kills allowed");
  assert.equal(run({ stealth: tally({ kills: 13, spotted: 1 }) }).stars, 2);
  // Slow but unseen: the ghost bonus lifts a one-star time to two.
  assert.equal(run({ seconds: 1200, stealth: tally({ spotted: 1 }) }).stars, 1);
  assert.equal(run({ seconds: 1200 }).stars, 2);
  assert.ok(isGhost(tally({ takedowns: 0 })) && !isGhost(tally({ bodies: 1 })));
  // Recruit still caps at two; a loss is zero.
  assert.equal(run({ difficulty: "recruit", seconds: 100 }).stars, 2);
  assert.equal(run({ victory: false }).stars, 0);
  // Veteran's clean-run floor doesn't rescue an alarm.
  assert.equal(run({ difficulty: "veteran", seconds: 2000, stealth: tally({ alarms: 1 }) }).stars, 1);
});

// ---- Director hooks -----------------------------------------------------------------------------------

function fakeHost() {
  const log: string[] = [];
  const host: DirectorHost = {
    spawn: () => log.push("spawn"),
    launchAir: () => true,
    radio: () => {},
    objectiveStarted: (i) => log.push(`start ${i}`),
    objectiveDone: (i) => log.push(`done ${i}`),
    detonate: () => {},
    vipFreed: () => {},
    callExtract: () => {},
    restoreCheckpoint: (i, reason) => log.push(`restore ${i} ${reason}`),
    end: (v) => log.push(`end ${v}`),
  };
  return { host, log };
}
const facts = (): MissionFacts => ({
  hostiles: 20, inZone: false, contested: false, interacting: false, vipAlive: false, vipDead: false,
  vipAtGoal: false, heliLanded: false, allAboard: false, teamWiped: false, spawnRoom: 28,
});
const tick = (d: MissionDirector, f: MissionFacts, s: number) => {
  for (let t = 0; t < s; t += 0.1) d.update(0.1, f);
};

test("Nightjar director: wire → command house → Kerr → jetty, compromise restarts the section", () => {
  assert.equal(getMission("nightjar"), NIGHTJAR_MISSION);
  const { host, log } = fakeHost();
  const d = new MissionDirector(NIGHTJAR_MISSION, host);
  const f = facts();
  d.start();
  f.inZone = true;
  tick(d, f, 0.5);
  assert.ok(log.includes("done 0"));
  tick(d, f, 2);
  assert.equal(d.state.objective, 1);
  // Veteran compromise: the attempt fails and rolls back to this section's checkpoint.
  f.inZone = false;
  f.compromised = "COMPROMISED: SPOTTED BY A GUARD";
  tick(d, f, 0.2);
  f.compromised = undefined;
  tick(d, f, 4);
  assert.ok(log.some((l) => l === "restore 1 COMPROMISED: SPOTTED BY A GUARD"));
  assert.equal(d.state.retries, 1);
  f.inZone = true;
  tick(d, f, 2.5);
  assert.equal(d.state.objective, 2);
  // Assassinate: standing around doesn't do it; the target's death does.
  f.inZone = false;
  tick(d, f, 5);
  assert.equal(d.state.objective, 2);
  f.targetDead = true;
  tick(d, f, 2.5);
  assert.equal(d.state.objective, 3);
  f.inZone = true;
  tick(d, f, 1);
  assert.equal(d.state.phase, "complete");
  d.state.stealth = { ...tally({ takedowns: 3 }), status: "hidden", timer: -1, sus: [], target: -1, identified: true, cue: "", clock: 0, truck: [0, 1, 1] };
  const r = scoreMission(NIGHTJAR_MISSION, d.state, 1, "regular");
  assert.deepEqual(r.stealth, tally({ takedowns: 3 }));
  assert.ok(r.breakdown.some((b) => b.label === "Silent takedowns" && b.value > 0));
  assert.ok(r.breakdown.some((b) => b.label === "Ghost"));
});

// ---- The stealth layer, headless ------------------------------------------------------------------------

const world = (() => {
  const w = new CollisionWorld();
  w.add(new THREE.Box3(new THREE.Vector3(-400, -1, -400), new THREE.Vector3(400, 0, 400)));
  for (const b of GREYWATER.boxes) {
    if (b.decor) continue;
    const y = b.y ?? 0;
    w.add(new THREE.Box3(new THREE.Vector3(b.x - b.w / 2, y, b.z - b.d / 2), new THREE.Vector3(b.x + b.w / 2, y + b.h, b.z + b.d / 2)));
  }
  return w;
})();

/** Just the AgentManager surface the stealth layer uses (guards never move here). */
type FakeAgents = Pick<AgentManager, "brain" | "corpseTime" | "trackUnseen" | "active" | "navigate">;
function layer(difficulty = "regular", failOnDetect = false) {
  const fake: FakeAgents = { brain: null, corpseTime: 4.6, trackUnseen: true, active: [], navigate: () => true };
  let nextId = 1;
  const banners: string[] = [];
  const s = new StealthDirector(fake as unknown as AgentManager, world, difficulty, failOnDetect, false, {
    spawn: (type: EnemyType, x, z, yaw, y) => {
      const d = ENEMIES[type];
      const ag = new Agent({ role: type, name: d.name, team: "enemy", health: d.health, bodyArmor: d.bodyArmor, speed: d.speed, runSpeed: d.runSpeed, range: d.range, weapon: d.weapon, coverBias: d.coverBias, flinch: d.flinch, look: { ...d.colors, kit: d.kit, scale: d.scale } }, nextId++);
      ag.spawn(new THREE.Vector3(x, y ?? world.floorAt(x, z, 3), z), yaw, 1); // the game snaps to the nav floor (ground or the HQ plinth)
      fake.active.push(ag);
      return ag;
    },
    radio: () => {},
    banner: (t) => banners.push(t),
    alarmSound: () => {},
  });
  s.reset(false);
  return { s, fake, banners };
}
function player(x: number, z: number, crouched = false, speed = 0): Combatant {
  const position = new THREE.Vector3(x, 0, z);
  return {
    team: "player", name: "P", targetable: true, position, isPlayer: true, moveSpeed: speed, crouched,
    aimPoint: (o) => o.set(position.x, 1.3, position.z), takeFire: () => {},
  };
}
/** Run the layer for `seconds`: per-frame update plus each guard's 5 Hz brain. */
function simulate(L: ReturnType<typeof layer>, team: Parameters<StealthDirector["update"]>[1], seconds: number) {
  for (let t = 0; t < seconds; t += 0.2) {
    L.s.update(0.2, team);
    for (const ag of L.fake.active) if (ag.alive) L.fake.brain!(ag);
  }
}
const byPlan = (L: ReturnType<typeof layer>, x: number, z: number) => L.fake.active.find((a) => Math.hypot(a.position.x - x, a.position.z - z) < 0.5)!;

test("stealth layer: the garrison spawns calm, Kerr is the target, corpses persist", () => {
  const L = layer();
  assert.ok(L.fake.active.length >= 20);
  assert.equal(L.s.target?.spec.role, "officer");
  assert.equal(L.fake.corpseTime, Infinity);
  assert.equal(L.fake.trackUnseen, false);
  for (const a of L.fake.active) assert.equal(a.state, "patrol");
  assert.equal(L.s.status, "hidden");
});

// In front of the right gate guard, under the gate lamps — east of the road, behind the patrol truck
// (which pulls away west from the gate at the start), so the gate guard is the one who sees you.
const GATE_SPOT = { x: 6.2, z: 45 };

test("stealth layer: standing in the gate light gets you spotted, the radio call raises the alarm", () => {
  const L = layer("regular");
  const me = { combatant: player(GATE_SPOT.x, GATE_SPOT.z), sprinting: false, shots: 0, suppressed: false };
  simulate(L, [me], 1.2);
  assert.notEqual(L.s.status, "hidden", "noticed");
  simulate(L, [me], 4);
  assert.equal(L.s.status, "alert");
  assert.equal(L.s.tally.alarms, 1);
  assert.ok(L.s.tally.spotted >= 1);
  assert.ok(L.banners.includes("ALARM RAISED"));
});

test("stealth layer: killing the spotter during the radio call keeps it quiet", () => {
  const L = layer("regular");
  const me = { combatant: player(GATE_SPOT.x, GATE_SPOT.z), sprinting: false, shots: 0, suppressed: false };
  const gate = byPlan(L, 6.2, 38.2);
  let t = 0;
  while (t < 6) {
    simulate(L, [me], 0.2);
    t += 0.2;
    const snap = L.s.snapshot(undefined);
    const i = snap.sus.indexOf(gate.id);
    if (i >= 0 && snap.sus[i + 2] === 4) break; // calling
  }
  assert.ok(t < 6, "the gate guard started calling it in");
  // Suppressed headshot: he drops before the call goes through. (His partner may still see you.)
  gate.applyDamage(999, "head", undefined, "");
  L.s.onKill(gate, "", true);
  me.combatant.position.set(-40, 0, 90); // and you slip away into the dark
  simulate(L, [me], 3);
  assert.equal(L.s.tally.alarms, 0);
});

test("stealth layer: Veteran detection compromises instead of alarming", () => {
  const L = layer("veteran", true);
  const me = { combatant: player(GATE_SPOT.x, GATE_SPOT.z), sprinting: false, shots: 0, suppressed: false };
  simulate(L, [me], 5);
  assert.equal(L.s.tally.alarms, 0);
  assert.match(L.s.takeCompromise(), /^COMPROMISED: /);
  assert.equal(L.s.takeCompromise(), "", "consumed once");
});

test("stealth layer: crouched in the reed ditch, the west patrol walks right past", () => {
  const L = layer("veteran", true);
  const wp = byPlan(L, -60, 38);
  // Ten metres up the ditch from his post, crouched still in the reeds, in the dark.
  const me = { combatant: player(-61.3, 48, true, 0), sprinting: false, shots: 0, suppressed: false };
  wp.yaw = 0; // looking straight at you
  simulate(L, [me], 8);
  assert.equal(L.s.takeCompromise(), "");
  assert.equal(L.s.tally.spotted, 0);
});

test("stealth layer: a loud shot brings the base down; a suppressed one at range goes unheard", () => {
  const quiet = layer("regular");
  const me = { combatant: player(-75, 0, true, 0), sprinting: false, shots: 0, suppressed: true };
  simulate(quiet, [me], 0.4);
  me.shots = 3;
  simulate(quiet, [me], 4);
  assert.equal(quiet.s.tally.alarms, 0, "suppressed: nobody hears it 15 m away");
  const loud = layer("regular");
  const me2 = { combatant: player(-75, 0, true, 0), sprinting: false, shots: 0, suppressed: false };
  simulate(loud, [me2], 0.4);
  me2.shots = 1;
  simulate(loud, [me2], 4);
  assert.equal(loud.s.tally.alarms, 1, "unsuppressed: the west patrol hears it and calls it in");
});

test("stealth layer: melee on an unaware guard is a silent takedown; his body gets found", () => {
  const L = layer("regular");
  const smoker = byPlan(L, 24, 4);
  L.s.onDamaged(smoker, false, "melee");
  assert.ok(!smoker.alive, "takedowns always kill an unaware guard");
  L.s.onKill(smoker, "melee", true);
  assert.equal(L.s.tally.takedowns, 1);
  assert.equal(L.s.tally.kills, 1);
  // Leave it where the barracks patrol walks past (no player around): eventually someone sees it.
  const patrol = byPlan(L, 22, 15);
  patrol.position.set(22, 0, 9);
  patrol.yaw = Math.atan2(24 - 22, 4 - 9);
  simulate(L, [], 2);
  assert.equal(L.s.tally.bodies, 1);
  assert.equal(L.s.status, "suspicious");
  assert.equal(L.s.tally.alarms, 0, "a body puts them on edge, it doesn't sound the alarm");
});

test("stealth layer: the target is identified once a player gets a clear look", () => {
  const L = layer("regular");
  assert.ok(!L.s.targetIdentified);
  // On the landing upstairs, looking into the office.
  const me = { combatant: player(OFFICE.door.x, OFFICE.door.z, true, 0), sprinting: false, shots: 0, suppressed: false };
  me.combatant.position.y = 2.4;
  simulate(L, [me], 0.6);
  assert.ok(L.s.targetIdentified);
});

test("stealth layer: truck pose follows the perimeter loop", () => {
  const p = { x: 0, z: 0, hx: 0, hz: 0 };
  truckPose(0, p);
  assert.deepEqual([p.x, p.z], [TRUCK_LOOP[0].x, TRUCK_LOOP[0].z]);
  truckPose(58, p);
  assert.ok(Math.abs(p.x + 58) < 1e-6 && Math.abs(p.z - 43) < 1e-6 && p.hx === -1);
  truckPose(58 + 106, p);
  assert.ok(Math.abs(p.x + 58) < 1e-6 && Math.abs(p.z + 63) < 1e-6);
});
