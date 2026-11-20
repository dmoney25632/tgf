// Co-op smoothness: adaptive jitter buffer (ClockSync), late-packet
// correction and gap handling (InterpBuffer), background ticking, codec.
// Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ClockSync, InterpBuffer } from "../src/game/net/interpolation";
import { ByteReader, ByteWriter, fromBase64, toBase64 } from "../src/game/net/codec";
import { BackgroundTicker } from "../src/game/core/BackgroundTicker";

/** Deterministic PRNG so the network simulations are repeatable. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

type SimResult = { extrapolatedPct: number; maxClockStepErr: number; maxPosStep: number; meanDelay: number };

/**
 * One entity moving at a constant 6 m/s, sent at `hz` with one-way latency
 * `lat` ± `jitter` (in-order delivery, like a WebSocket), rendered at `fps`.
 * Measures how often we extrapolate, how uneven the render clock is, and the
 * largest per-frame position step (a pop shows up as a big step).
 */
function simulate(hz: number, lat: number, jitter: number, fps: number, floorMs: number, seconds = 30, seed = 7): SimResult {
  const rand = rng(seed);
  const clock = new ClockSync();
  const buf = new InterpBuffer(1, 64);
  const senderOffset = 123456; // sender's performance.now() origin differs from ours
  const speed = 6 / 1000; // m per ms
  const packets: { arrive: number; t: number; x: number }[] = [];
  let lastArrive = 0;
  for (let t = 0; t < seconds * 1000; t += 1000 / hz) {
    const arrive = Math.max(lastArrive, t + lat + (rand() * 2 - 1) * jitter);
    lastArrive = arrive;
    packets.push({ arrive, t: t + senderOffset, x: t * speed });
  }
  let pi = 0;
  const out = [0];
  let frames = 0, extrap = 0, maxClockStepErr = 0, maxPosStep = 0, delaySum = 0;
  let prevRt = NaN, prevX = NaN;
  const frameMs = 1000 / fps;
  for (let now = 0; now < seconds * 1000; now += frameMs) {
    while (pi < packets.length && packets[pi].arrive <= now) {
      const p = packets[pi++];
      clock.observe(p.t, p.arrive);
      buf.push(p.t, [p.x]);
    }
    if (!clock.ready || now < 2000) continue; // warm-up
    const rt = clock.renderTime(now, floorMs);
    buf.sample(rt, out);
    frames++;
    if (buf.extrapolated) extrap++;
    delaySum += clock.senderNow(now) - rt;
    if (!Number.isNaN(prevRt)) {
      maxClockStepErr = Math.max(maxClockStepErr, Math.abs(rt - prevRt - frameMs));
      maxPosStep = Math.max(maxPosStep, Math.abs(out[0] - prevX));
    }
    prevRt = rt;
    prevX = out[0];
  }
  return { extrapolatedPct: (100 * extrap) / frames, maxClockStepErr, maxPosStep, meanDelay: delaySum / frames };
}

test("jitter buffer: calm link stays near the floor delay and never extrapolates", () => {
  const r = simulate(20, 40, 2, 144, 70);
  assert.ok(r.extrapolatedPct < 0.5, `extrapolated ${r.extrapolatedPct}%`);
  assert.ok(r.meanDelay < 95, `delay ${r.meanDelay}`); // ~ one interval + slack, no more
});

test("jitter buffer: ±40 ms jitter at 12 Hz rarely extrapolates and grows the delay", () => {
  const r = simulate(12, 60, 40, 60, 104);
  assert.ok(r.extrapolatedPct < 3, `extrapolated ${r.extrapolatedPct}%`);
  assert.ok(r.meanDelay > 120 && r.meanDelay < 260, `delay ${r.meanDelay}`);
});

test("render clock is smooth: per-frame steps stay within the time-warp limit", () => {
  for (const fps of [60, 144, 240]) {
    const r = simulate(12, 60, 40, fps, 104);
    // maxWarp 10% of a frame, plus float noise.
    assert.ok(r.maxClockStepErr <= (1000 / fps) * 0.1 + 1e-6, `fps ${fps}: clock step err ${r.maxClockStepErr}`);
    // 6 m/s → 0.1 m per 60 Hz frame; allow warp + correction slack, but no pops.
    assert.ok(r.maxPosStep < (6 / fps) * 1.6, `fps ${fps}: pos step ${r.maxPosStep}`);
  }
});

test("clock sync resyncs after a long silence (background tab / reconnect)", () => {
  const c = new ClockSync();
  for (let i = 0; i < 50; i++) c.observe(1000 + i * 50, 100 + i * 50);
  const before = c.renderTime(2600, 100);
  // Sender restarts its clock far ahead (new tab) after 10 s of silence.
  for (let i = 0; i < 5; i++) c.observe(900000 + i * 50, 12600 + i * 50);
  const after = c.renderTime(12850, 100);
  assert.ok(Math.abs(after - (900000 + 250 - 100)) < 200, `after ${after} (before ${before})`);
});

test("late packet after extrapolation glides back instead of popping", () => {
  const b = new InterpBuffer(1, 16);
  b.push(0, [0]);
  b.push(100, [1]);
  const out = [0];
  // Extrapolating at constant velocity…
  b.sample(150, out);
  assert.ok(b.extrapolated);
  assert.ok(Math.abs(out[0] - 1.5) < 1e-9);
  // …but the entity actually stopped at 1.0 (sample at 200 says so).
  b.push(200, [1]);
  b.sample(150, out); // same time: identical output, no jump
  assert.ok(Math.abs(out[0] - 1.5) < 1e-9, `no pop: ${out[0]}`);
  b.sample(166, out);
  assert.ok(out[0] > 1.0 && out[0] < 1.5, `blending: ${out[0]}`);
  b.sample(700, out);
  assert.ok(Math.abs(out[0] - 1) < 0.01, `settled: ${out[0]}`);
});

test("huge corrections teleport, angle corrections wrap the short way", () => {
  const b = new InterpBuffer(2, 16, [1], 90, 2.5);
  b.push(0, [0, 3.0]);
  b.push(100, [0, 3.1]);
  const out = [0, 0];
  b.sample(150, out);
  b.push(200, [50, -3.1]); // respawned far away: no smoothing
  b.sample(200, out);
  assert.equal(out[0], 50);
  // Angle crossed ±π: the correction is small (short way), not ~2π.
  assert.ok(Math.abs(Math.atan2(Math.sin(out[1] + 3.1), Math.cos(out[1] + 3.1))) < 0.3, `yaw ${out[1]}`);
});

test("a long gap between samples restarts the buffer (no slide across the map)", () => {
  const b = new InterpBuffer(1, 16, [], 90, 2.5, 1500);
  b.push(0, [0]);
  b.push(100, [1]);
  b.push(5000, [40]);
  assert.equal(b.size, 1);
  const out = [0];
  b.sample(2000, out);
  assert.equal(out[0], 40);
});

test("codec: base64 round trip and byte reader/writer edges", () => {
  const w = new ByteWriter(2); // forces growth
  for (let i = 0; i < 300; i++) w.u8(i & 0xff);
  w.i16(-32768);
  w.u16(70000); // clamped
  w.u32(2 ** 32 + 5); // clamped
  const bytes = w.bytes();
  const back = fromBase64(toBase64(bytes));
  assert.deepEqual([...back], [...bytes]);
  const r = new ByteReader(back);
  for (let i = 0; i < 300; i++) assert.equal(r.u8(), i & 0xff);
  assert.equal(r.i16(), -32768);
  assert.equal(r.u16(), 0xffff);
  assert.equal(r.u32(), 0xffffffff);
  assert.throws(() => r.u8(), RangeError);
});

test("background ticker falls back to an interval without workers and stops cleanly", async () => {
  let ticks = 0;
  const t = new BackgroundTicker(() => ticks++, 200);
  t.start();
  t.start(); // idempotent
  for (let i = 0; i < 100 && ticks < 3; i++) await new Promise((r) => setTimeout(r, 10));
  t.stop();
  const at = ticks;
  assert.ok(at >= 3, `ticks ${at}`);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(ticks, at);
  assert.equal(t.running, false);
  t.dispose();
});

test("lost delta: decoder asks for a keyframe and the next one resyncs it", async () => {
  const { SnapshotEncoder, SnapshotDecoder } = await import("../src/game/net/protocol");
  const enc = new SnapshotEncoder(100);
  const dec = new SnapshotDecoder();
  const enemy = (x: number) => ({ id: 7, type: 0, elite: false, maxHealth: 100, x, y: 0, z: 0, yaw: 0, pitch: 0, state: 1, crouched: false, aiming: false, health: 100, target: 255, charge: 0, shots: 0 });
  const frame = (t: number, x: number) => ({ time: t, wave: 1, phase: 1, timer: 0, remaining: 1, players: [], enemies: [enemy(x)] });
  assert.ok(dec.apply(enc.encode(frame(0, 0)))?.keyframe);
  enc.encode(frame(100, 1)); // lost in transit
  assert.equal(dec.apply(enc.encode(frame(200, 2))), null);
  assert.equal(dec.isSynced, false); // → client sets `k: 1` on its next state message
  enc.forceKeyframe(); // host reacts
  const s = dec.apply(enc.encode(frame(300, 3)));
  assert.ok(s?.keyframe);
  assert.equal(s?.enemies.get(7)?.x, 3);
  assert.ok(dec.apply(enc.encode(frame(400, 4)))); // deltas flow again
});
