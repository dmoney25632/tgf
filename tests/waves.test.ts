// Survival wave structure: squads on a timeline from compass sectors,
// escalating composition, boss and holdout waves, pacing under an alive cap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { composeWave, DIFFICULTY, type EnemyType } from "../src/game/survival/config";
import { compassWord, PACING, planWave, spawnSectors, waveKind } from "../src/game/survival/waves";
import { WaveManager } from "../src/game/survival/WaveManager";
import { SURVIVAL_MAPS } from "../src/game/world/maps/registry";

/** Small deterministic PRNG (mulberry32). */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const count = (members: EnemyType[], t: EnemyType) => members.filter((m) => m === t).length;
const all = (p: ReturnType<typeof planWave>) => p.squads.flatMap((s) => s.members);

test("wave kinds: boss every fifth wave, holdout on the third of each five", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13].map(waveKind), ["standard", "standard", "holdout", "standard", "boss", "standard", "standard", "holdout", "standard", "boss", "holdout"]);
});

test("a plan sends the whole composition, in squads, on an increasing timeline", () => {
  for (const wave of [1, 4, 7, 10, 15, 22]) {
    for (let seed = 1; seed <= 25; seed++) {
      const p = planWave(wave, { countMul: 1, team: 1, sectors: 6, rng: seeded(seed) });
      const comp = composeWave(wave, 1, 0);
      const members = all(p);
      // Wave 5's Iron Pair converts riflemen to Juggernauts; everything else matches composeWave.
      for (const t of ["warden", "sniper", "rusher"] as EnemyType[]) assert.equal(count(members, t), comp[t], `wave ${wave} ${t}`);
      assert.equal(p.total, members.length);
      assert.equal(p.total, Object.values(comp).reduce((a, b) => a + b, 0));
      for (let i = 1; i < p.squads.length; i++) assert.ok(p.squads[i].at >= p.squads[i - 1].at, "timeline is ordered");
      assert.ok(p.squads[0].at <= PACING.firstSquad + 0.01, "first squad arrives right away");
      for (const s of p.squads) {
        assert.ok(s.members.length >= 1 && s.members.length <= 8, `squad size ${s.members.length}`);
        assert.ok(s.sector >= 0 && s.sector < 6);
      }
    }
  }
});

test("squads are small and spread out: no single flood of enemies", () => {
  const p = planWave(12, { countMul: 1, team: 3, sectors: 8, rng: seeded(7) });
  assert.ok(p.squads.length >= 5, `${p.squads.length} squads`);
  // Never more than two squads land within the same second (a pincer).
  for (const s of p.squads) assert.ok(p.squads.filter((q) => Math.abs(q.at - s.at) < 1).length <= 2);
  // The wave stretches over time instead of arriving at once.
  assert.ok(p.squads[p.squads.length - 1].at > 45, `last squad at ${p.squads[p.squads.length - 1].at}s`);
});

test("consecutive squads come from different directions; pincers come from opposite sides", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const p = planWave(14, { countMul: 1, team: 1, sectors: 8, rng: seeded(seed) });
    for (let i = 1; i < p.squads.length; i++) {
      const a = p.squads[i - 1], b = p.squads[i];
      assert.notEqual(a.sector, b.sector, `seed ${seed} squad ${i}`);
      if (a.at === b.at) assert.equal(Math.abs(a.sector - b.sector), 4, "pincer from the opposite sector");
    }
  }
});

test("escalation: rushes, heavies and marksmen join as waves climb; boss waves have a boss squad", () => {
  const roles = (w: number) => new Set(planWave(w, { countMul: 1, team: 1, sectors: 4, rng: seeded(w) }).squads.map((s) => s.role));
  assert.deepEqual([...roles(1)], ["rifle"]);
  assert.ok(roles(4).has("rush") && roles(4).has("heavy"));
  assert.ok(roles(7).has("marksman"));
  const five = planWave(5, { countMul: 1, team: 1, sectors: 4, rng: seeded(5) });
  const pair = five.squads.find((s) => s.role === "boss")!;
  assert.equal(count(pair.members, "armored"), 2, "wave 5: Iron Pair");
  assert.equal(five.title, "Iron Pair");
  const ten = planWave(10, { countMul: 1, team: 1, sectors: 4, rng: seeded(10) });
  assert.equal(ten.title, "The Warden");
  assert.ok(ten.squads.find((s) => s.role === "boss")!.members.includes("warden"));
});

test("difficulty and team size scale the wave", () => {
  const total = (countMul: number, team: number) => planWave(8, { countMul, team, sectors: 4, rng: seeded(3) }).total;
  assert.ok(total(DIFFICULTY.veteran.count, 1) > total(DIFFICULTY.regular.count, 1));
  assert.ok(total(DIFFICULTY.regular.count, 1) > total(DIFFICULTY.recruit.count, 1));
  assert.ok(total(1, 4) > total(1, 2) && total(1, 2) > total(1, 1));
});

test("wave manager: squads arrive over time, stay under the alive cap, and warn before arriving", () => {
  const w = new WaveManager(10, 1, 1, 6, 4, seeded(42));
  w.startNextWave();
  const cap = w.aliveCap(20);
  let alive = 0, spawned = 0, incoming = 0, maxAlive = 0, t = 0;
  const firstAt = w.plan!.squads[0].at;
  while (w.queue.length && t < 600) {
    const { spawns, events } = w.update(0.1, alive, cap);
    t += 0.1;
    if (t < firstAt - 0.05) assert.equal(spawns.length, 0, "nobody before the first squad");
    spawned += spawns.length;
    alive += spawns.length;
    incoming += events.filter((e) => e.kind === "incoming" || e.kind === "pulledIn").length;
    maxAlive = Math.max(maxAlive, alive);
    // The player kills one enemy every 1.5 s.
    if (alive > 0 && Math.round(t * 10) % 15 === 0) alive--;
  }
  assert.equal(spawned, w.total);
  assert.ok(maxAlive <= cap, `max alive ${maxAlive} ≤ cap ${cap}`);
  assert.ok(incoming >= w.plan!.squads.length - 1, "every squad is announced");
});

test("wave manager pulls the next squad in when the field is cleared", () => {
  const w = new WaveManager(10, 1, 1, 4, 4, seeded(9));
  w.startNextWave();
  const second = w.plan!.squads[1].at;
  // Spawn the first squad, then report an empty field.
  let alive = 0;
  for (let t = 0; t < w.plan!.squads[0].at + 4; t += 0.1) alive += w.update(0.1, alive, 99).spawns.length;
  const { events } = w.update(0.1, 0, 99);
  const pulled = events.find((e) => e.kind === "pulledIn");
  if (second - w.clock > PACING.pullInTo + 0.2) {
    assert.ok(pulled, "next squad pulled in");
    assert.ok(w.nextSquadIn <= PACING.pullInTo + 0.01);
  }
});

test("holdout: reinforcements keep coming until the timer, then the rest is called off", () => {
  const w = new WaveManager(10, 1, 1, 3, 4, seeded(5));
  w.startNextWave();
  assert.equal(w.kind, "holdout");
  const hold = w.holdLeft;
  assert.ok(hold >= 60);
  let alive = 0, done = false, t = 0;
  while (t < hold + 30) {
    const { spawns, events } = w.update(0.25, alive, 99);
    t += 0.25;
    alive += spawns.length;
    alive = Math.max(0, alive - 1); // fast killers: the field keeps emptying
    if (events.some((e) => e.kind === "holdComplete")) {
      done = true;
      assert.ok(Math.abs(t - hold) < 0.5, "completes on the timer");
    }
    if (done && alive === 0 && w.queue.length === 0) break;
  }
  assert.ok(done, "hold completed");
  assert.equal(w.queue.length, 0, "nothing left to spawn after the hold");
  assert.ok(w.total > w.plan!.total, "reinforcements were added during the hold");
});

test("spawn sectors cover every spawn point and sit clockwise from north", () => {
  for (const m of SURVIVAL_MAPS) {
    const pts = m.def.survival!.enemySpawns;
    const secs = spawnSectors(pts);
    assert.ok(secs.length >= 2, `${m.id}: ${secs.length} sectors`);
    assert.equal(secs.reduce((n, s) => n + s.points.length, 0), pts.length);
  }
  assert.equal(compassWord(0), "NORTH");
  assert.equal(compassWord(Math.PI / 2), "EAST");
  assert.equal(compassWord(-Math.PI / 4), "NORTH-WEST");
  const s = spawnSectors([{ x: 0, z: -40 }, { x: 40, z: 0 }, { x: 0, z: 40 }, { x: -40, z: 0 }]);
  assert.deepEqual(s.map((q) => q.label), ["NORTH", "EAST", "SOUTH", "WEST"]);
});
