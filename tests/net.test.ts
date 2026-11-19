// Co-op net layer: snapshot encode/decode (keyframes, deltas, gaps), player
// state packing, the interpolation buffer and host-side hit validation.
// Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fromBase64, toBase64 } from "../src/game/net/codec";
import {
  decodePlayerState, encodePlayerState, NET, NO_TARGET, SnapshotDecoder, SnapshotEncoder, STATE_DEAD,
  type EnemyRec, type PlayerStateMsg, type PlayerVitals, type SnapshotFrame,
} from "../src/game/net/protocol";
import { ClockSync, InterpBuffer } from "../src/game/net/interpolation";
import { HitValidator, HIT_RULES, type HitClaimCheck } from "../src/game/net/hitValidation";
import { normalizeRoomCode, makeRoomCode } from "../src/game/net/transport";
import { WEAPONS } from "../src/game/weapons/weapons";

const enemy = (id: number, over: Partial<EnemyRec> = {}): EnemyRec => ({
  id, type: 1, elite: false, maxHealth: 120, x: id * 1.5, y: 0.25, z: -id, yaw: 1.2, pitch: 0.1,
  state: 2, crouched: false, aiming: true, health: 120, target: 0, charge: 0, shots: 0, ...over,
});
const vitals = (slot: number, over: Partial<PlayerVitals> = {}): PlayerVitals => ({
  slot, downed: false, dead: false, beingRevived: false, connected: true, ready: false,
  health: 87, maxHealth: 100, armor: 50, bleed: 0, revive: 0, selfRevives: 1, money: 1234, ...over,
});
const frame = (enemies: EnemyRec[], over: Partial<SnapshotFrame> = {}): SnapshotFrame => ({
  time: 1000, wave: 3, phase: 1, timer: 0, remaining: enemies.length + 4, players: [vitals(0), vitals(1)], enemies, ...over,
});

test("snapshot keyframe round-trips every field within quantization", () => {
  const enc = new SnapshotEncoder();
  const dec = new SnapshotDecoder();
  const es = [enemy(1), enemy(2, { elite: true, type: 4, crouched: true, charge: 0.5, target: NO_TARGET, shots: 3, yaw: -2.5 })];
  const snap = dec.apply(enc.encode(frame(es)))!;
  assert.ok(snap);
  assert.equal(snap.keyframe, true);
  assert.equal(snap.wave, 3);
  assert.equal(snap.remaining, 6);
  assert.deepEqual(snap.players[1], vitals(1));
  const b = snap.enemies.get(2)!;
  assert.equal(b.type, 4);
  assert.equal(b.elite, true);
  assert.equal(b.crouched, true);
  assert.equal(b.target, NO_TARGET);
  assert.equal(b.shots, 3);
  assert.ok(Math.abs(b.x - 3) < 0.006 && Math.abs(b.z + 2) < 0.006);
  assert.ok(Math.abs(b.charge - 0.5) < 0.01);
  // yaw comes back in [0, 2π) but must be the same angle (8-bit: ±0.7°).
  const dy = Math.atan2(Math.sin(b.yaw + 2.5), Math.cos(b.yaw + 2.5));
  assert.ok(Math.abs(dy) < 0.025, `yaw error ${dy}`);
});

test("deltas only carry what changed, and handle removals", () => {
  const enc = new SnapshotEncoder(100);
  const dec = new SnapshotDecoder();
  const es = Array.from({ length: 24 }, (_, i) => enemy(i + 1));
  const key = enc.encode(frame(es));
  dec.apply(key);
  // Nothing moved: a delta is just the header + players.
  const idle = enc.encode(frame(es));
  assert.ok(dec.apply(idle));
  assert.ok(idle.length < key.length / 4, `idle delta ${idle.length} vs key ${key.length}`);
  // Everyone moves: ~11 bytes per enemy.
  for (const e of es) e.x += 0.3;
  const moving = enc.encode(frame(es));
  const perEnemy = (moving.length - idle.length) / es.length;
  assert.ok(perEnemy <= 9, `${perEnemy} B/enemy for a position-only change`);
  // One dies, one leaves the field.
  es[0].state = STATE_DEAD;
  es[0].health = 0;
  const gone = es.pop()!;
  dec.apply(moving);
  const snap = dec.apply(enc.encode(frame(es)))!;
  assert.ok(snap);
  assert.equal(snap.enemies.get(1)!.state, STATE_DEAD);
  assert.equal(snap.enemies.get(1)!.health, 0);
  assert.ok(!snap.enemies.has(gone.id));
  assert.deepEqual(snap.removed, [gone.id]);
  assert.ok(Math.abs(snap.enemies.get(5)!.x - (5 * 1.5 + 0.3)) < 0.006);
  // Budget check (documented in protocol.ts): busy wave stays well under 1 KB as base64.
  const b64 = toBase64(moving);
  assert.ok(b64.length < 700, `busy delta is ${b64.length} chars`);
});

test("decoder drops deltas after a gap until the next keyframe", () => {
  const enc = new SnapshotEncoder(4);
  const dec = new SnapshotDecoder();
  const es = [enemy(1)];
  assert.ok(dec.apply(enc.encode(frame(es)))); // key (1)
  es[0].x = 5;
  enc.encode(frame(es)); // (2) lost in transit
  es[0].x = 6;
  assert.equal(dec.apply(enc.encode(frame(es))), null); // (3) gap → dropped
  es[0].x = 7;
  assert.equal(dec.apply(enc.encode(frame(es))), null); // (4) still waiting
  es[0].x = 8;
  const healed = dec.apply(enc.encode(frame(es)))!; // (5) keyframe
  assert.ok(healed?.keyframe);
  assert.ok(Math.abs(healed.enemies.get(1)!.x - 8) < 0.006);
  assert.equal(dec.dropped, 2);
});

test("keyframe implicitly removes entities the client still had", () => {
  const enc = new SnapshotEncoder(2);
  const dec = new SnapshotDecoder();
  dec.apply(enc.encode(frame([enemy(1), enemy(2)])));
  enc.forceKeyframe();
  const snap = dec.apply(enc.encode(frame([enemy(2)])))!;
  assert.ok(snap.keyframe);
  assert.deepEqual([...snap.enemies.keys()], [2]);
  assert.deepEqual(snap.removed, [1]);
});

test("player state packs into 23 bytes and round-trips", () => {
  const s: PlayerStateMsg = {
    slot: 2, seq: 65535, time: 123456789, x: -41.237, y: 1.5, z: 33.33, yaw: -1.3, pitch: -0.42,
    crouch: true, sprint: false, slide: true, grounded: true, ads: true, downed: false, selfReviving: true, ready: true,
    weapon: 5, shots: 3, reviveTarget: 1,
  };
  const bytes = encodePlayerState(s);
  assert.equal(bytes.length, 23);
  const r = decodePlayerState(fromBase64(toBase64(bytes)))!;
  assert.equal(r.slot, 2);
  assert.equal(r.seq, 65535);
  assert.equal(r.time, 123456789);
  assert.ok(Math.abs(r.x - s.x) < 0.006 && Math.abs(r.z - s.z) < 0.006);
  assert.ok(Math.abs(Math.atan2(Math.sin(r.yaw - s.yaw), Math.cos(r.yaw - s.yaw))) < 1e-3);
  assert.ok(Math.abs(r.pitch - s.pitch) < 1e-3);
  for (const k of ["crouch", "sprint", "slide", "grounded", "ads", "downed", "selfReviving", "ready", "weapon", "shots", "reviveTarget"] as const) {
    assert.equal(r[k], s[k], k);
  }
});

test("interpolation buffer: lerp, angle wrap, hold, capped extrapolation", () => {
  const b = new InterpBuffer(2, 4, [1]);
  assert.equal(b.sample(0, [0, 0]), false);
  b.push(100, [0, 3.0]);
  b.push(200, [10, -3.0]); // crosses ±π: should go the short way
  const out = [0, 0];
  b.sample(150, out);
  assert.equal(out[0], 5);
  assert.ok(Math.abs(Math.abs(out[1]) - Math.PI) < 0.2, `angle ${out[1]}`);
  b.sample(50, out);
  assert.equal(out[0], 0); // before the buffer: hold oldest
  b.sample(250, out, 100);
  assert.equal(out[0], 15); // extrapolate 50 ms
  b.sample(1000, out, 100);
  assert.equal(out[0], 20); // capped at 100 ms ahead
  // Out-of-order and duplicate samples are ignored.
  assert.equal(b.push(150, [99, 0]), false);
  assert.equal(b.push(200, [99, 0]), false);
  // Ring buffer keeps the newest `capacity` samples.
  for (let t = 300; t <= 700; t += 100) b.push(t, [t / 10, 0]);
  assert.equal(b.size, 4);
  b.sample(0, out);
  assert.equal(out[0], 40);
  b.sample(650, out);
  assert.equal(out[0], 65);
});

test("clock sync renders ~delay behind the sender despite jitter", () => {
  const c = new ClockSync();
  // Sender clock is 5000 ms ahead; one-way latency 40 ms ± 25 ms jitter.
  for (let i = 0; i < 200; i++) {
    const local = i * 50;
    const jitter = ((i * 7919) % 50) - 25;
    c.observe(local + 5000 - 40 - jitter, local + 0);
  }
  const rt = c.renderTime(10000, NET.INTERP_DELAY_MS);
  const senderNow = 10000 + 5000;
  const behind = senderNow - rt;
  assert.ok(behind > NET.INTERP_DELAY_MS && behind < NET.INTERP_DELAY_MS + 80, `behind ${behind}`);
});

// ---------------------------------------------------------------------------
// Hit validation
// ---------------------------------------------------------------------------

const rifle = WEAPONS.vk7;
const clearLos = () => true;
const claim = (over: Partial<HitClaimCheck> = {}): HitClaimCheck => ({
  now: 0, shooterId: 1, shooterEye: { x: 0, y: 1.6, z: 0 }, shooterCanFire: true, targetAlive: true,
  targetPoints: [{ x: 0, y: 1.25, z: -20 }], weapon: rifle, part: "body", damage: rifle.damage, los: clearLos, ...over,
});

test("hit validation accepts a legit hit and clamps inflated damage", () => {
  const v = new HitValidator();
  const ok = v.validate(claim());
  assert.ok(ok.ok);
  const huge = v.validate(claim({ now: 1, damage: 9999, part: "head" }));
  assert.ok(huge.ok);
  if (huge.ok) assert.ok(huge.damage <= rifle.damage * rifle.headMultiplier * HIT_RULES.headModCap + 1e-9);
  // Legit headshot with stacked perks stays unclamped.
  const head = rifle.damage * rifle.headMultiplier * 1.4;
  const h = v.validate(claim({ now: 2, damage: head, part: "head" }));
  assert.ok(h.ok && Math.abs(h.damage - head) < 1e-9);
});

test("hit validation rejects range, line of sight, dead targets and dead shooters", () => {
  const v = new HitValidator();
  const far = { x: 0, y: 1.25, z: -(rifle.range + HIT_RULES.rangeSlack + 5) };
  assert.deepEqual(v.validate(claim({ targetPoints: [far] })), { ok: false, reason: "range" });
  assert.deepEqual(v.validate(claim({ los: () => false })), { ok: false, reason: "los" });
  // One visible point is enough (head pokes over cover).
  let calls = 0;
  assert.ok(v.validate(claim({ targetPoints: [{ x: 0, y: 1, z: -10 }, { x: 0, y: 1.6, z: -10 }], los: () => ++calls === 2 })).ok);
  assert.deepEqual(v.validate(claim({ targetAlive: false })), { ok: false, reason: "dead" });
  assert.deepEqual(v.validate(claim({ shooterCanFire: false })), { ok: false, reason: "shooter" });
  assert.deepEqual(v.validate(claim({ damage: Number.NaN })), { ok: false, reason: "damage" });
  // Knife: only at arm's length.
  assert.equal(v.validate(claim({ weapon: null, targetPoints: [{ x: 0, y: 1.2, z: -6 }] })).ok, false);
  assert.equal(v.validate(claim({ weapon: null, damage: 150, targetPoints: [{ x: 0, y: 1.2, z: -1.5 }] })).ok, true);
  assert.equal(v.rejected, 6);
});

test("hit validation rate-limits claims to the weapon's fire rate", () => {
  const v = new HitValidator();
  let ok = 0;
  // 200 claims in one instant: only the burst allowance passes.
  for (let i = 0; i < 200; i++) if (v.validate(claim({ now: 10 })).ok) ok++;
  const perSec = (rifle.rpm / 60) * HIT_RULES.rateSlack + 1;
  assert.ok(ok <= Math.ceil(perSec * HIT_RULES.burstSeconds) && ok > rifle.rpm / 60 / 2, `burst ${ok}`);
  // Sustained fire at the real rpm for 5 s is never throttled.
  const v2 = new HitValidator();
  const interval = 60 / rifle.rpm;
  let rejected = 0;
  for (let t = 0; t < 5; t += interval) if (!v2.validate(claim({ now: t })).ok) rejected++;
  assert.equal(rejected, 0);
  // Shotguns: every pellet of a blast is its own claim.
  const sg = WEAPONS.breacher;
  const v3 = new HitValidator();
  let pellets = 0;
  for (let i = 0; i < sg.pellets; i++) if (v3.validate(claim({ weapon: sg, damage: sg.damage, targetPoints: [{ x: 0, y: 1.2, z: -4 }] })).ok) pellets++;
  assert.equal(pellets, sg.pellets);
});

test("room codes", () => {
  const code = makeRoomCode();
  assert.equal(code.length, 5);
  assert.equal(normalizeRoomCode(code.toLowerCase()), code);
  assert.equal(normalizeRoomCode("k7qx-2"), "K7QX2");
  assert.equal(normalizeRoomCode("AB0DE"), null); // 0 is excluded
  assert.equal(normalizeRoomCode("ABCD"), null);
});
