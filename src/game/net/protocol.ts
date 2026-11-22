import { ByteReader, ByteWriter } from "./codec";
import type { MissionEvent, MissionState } from "../missions/types";

/**
 * Co-op wire protocol (host-authoritative survival).
 *
 * Rates (see NET below) and typical sizes, measured by tests/net.test.ts:
 *  - Player state, client → everyone, ≤20 Hz: 23 bytes binary
 *    (55 B JSON payload; hit claims add ~20 B each while firing).
 *  - Host snapshot, host → everyone, ≤12 Hz: 19 B header + 14 B per player +
 *    9–11 B per moving enemy (delta) / 19 B per enemy (keyframe, 1 per second).
 *    A busy wave (4 players, 24 enemies) is 339 B delta / 531 B keyframe
 *    binary = 475 B / 731 B JSON payload. Far below Realtime's payload cap
 *    (256 KB free / 3 MB pro). ≈6 KB/s down per client at 12 Hz.
 *  - Message rate per room with N players (Realtime counts every delivery,
 *    i.e. one broadcast to N−1 subscribers costs N−1 messages). The host's
 *    own pose rides inside its snapshot, so only clients send state:
 *      deliveries/s = (N−1)·snapshotHz + (N−1)²·stateHz
 *    netRates() picks the best tier in RATE_TIERS that fits NET.MSG_BUDGET
 *    (80/s, under the Free plan's 100/s; raise it on Pro, 500/s):
 *      2 players: state 20 Hz, snapshots 12 Hz, keyframe 1 s  →  32/s
 *      3 players: state 12 Hz, snapshots 10 Hz, keyframe 1 s  →  68/s
 *      4 players: state  6 Hz, snapshots  8 Hz, keyframe 2 s  →  78/s
 *    Interpolation delay = send interval + 20 ms, raised adaptively by the
 *    measured jitter (ClockSync in interpolation.ts): calm links get the
 *    least lag, jittery ones a deeper buffer instead of rubber-banding.
 *    Gameplay events (hit claims, purchases, kills, hurt…) ride inside these
 *    periodic messages rather than costing extra ones.
 */
export const NET = {
  /**
   * Realtime messages per second one room may cost (all deliveries). 80 keeps
   * a room under the Free plan's 100 msg/s; on Pro (500/s) raise to ~400 and
   * 4-player rooms get the full 20 Hz / 12 Hz rates.
   */
  MSG_BUDGET: 80,
  /** Best-case rates (used whenever they fit the budget). */
  STATE_HZ: 20,
  SNAPSHOT_HZ: 12,
  /** Full snapshot every N snapshots (≈1 s) so a dropped delta heals quickly. */
  KEYFRAME_EVERY: 12,
  /** Minimum render delay for remote entities. */
  INTERP_DELAY_MS: 100,
  /**
   * In-game render delay floor = one send interval + this slack; ClockSync
   * adds measured jitter on top (see interpolation.ts), capped at 450 ms.
   */
  INTERP_SLACK_MS: 20,
  /** Max extrapolation past the newest sample when packets are late. */
  MAX_EXTRAPOLATE_MS: 120,
  /** No packets from a peer for this long → treated as disconnected. */
  PEER_TIMEOUT_MS: 5000,
  /** Client: no snapshot for this long → "host lost", match ends. */
  HOST_TIMEOUT_MS: 8000,
  MAX_PLAYERS: 4,
  VERSION: 1,
} as const;

export const MSG = { snapshot: 1, state: 2 } as const;

/** Send rates for one match, fixed at launch from the roster size. */
export type NetRates = {
  /** Client player-state rate (the host's pose rides in its snapshots). */
  stateHz: number;
  snapshotHz: number;
  /** Full snapshot every N snapshots. */
  keyframeEvery: number;
  /** Render remote entities this far behind (covers the slowest stream + jitter). */
  interpMs: number;
  /** Realtime deliveries per second for the whole room. */
  msgsPerSec: number;
};

/** Rate tiers, best first: [stateHz, snapshotHz, keyframe seconds]. */
export const RATE_TIERS: readonly (readonly [number, number, number])[] = [
  [NET.STATE_HZ, NET.SNAPSHOT_HZ, 1],
  [15, 12, 1],
  [12, 10, 1],
  [10, 10, 1],
  [8, 8, 2],
  [6, 8, 2],
  [5, 6, 2],
];

/** Deliveries/s for a room: snapshots to every client + client state to everyone else. */
export function roomMessageRate(players: number, stateHz: number, snapshotHz: number) {
  const others = Math.max(0, players - 1);
  return others * snapshotHz + others * others * stateHz;
}

/** Highest rate tier that keeps a room of `players` within `budget` msgs/s. */
export function netRates(players: number, budget: number = NET.MSG_BUDGET): NetRates {
  const n = Math.max(1, Math.min(NET.MAX_PLAYERS, Math.round(players)));
  const tier = RATE_TIERS.find(([st, sn]) => roomMessageRate(n, st, sn) <= budget) ?? RATE_TIERS[RATE_TIERS.length - 1];
  const [stateHz, snapshotHz, kfSeconds] = tier;
  return {
    stateHz,
    snapshotHz,
    keyframeEvery: Math.max(1, Math.round(snapshotHz * kfSeconds)),
    interpMs: Math.max(NET.INTERP_DELAY_MS, Math.ceil((1200 / Math.min(stateHz, snapshotHz)) / 10) * 10),
    msgsPerSec: roomMessageRate(n, stateHz, snapshotHz),
  };
}

/** Position quantum: centimetres in int16 (±327 m, maps are ±60 m). */
const POS_Q = 100;
const TAU = Math.PI * 2;

export const PHASES = ["prematch", "combat", "intermission", "victory", "defeat"] as const;
export type PhaseName = (typeof PHASES)[number];
export const phaseCode = (p: string) => Math.max(0, PHASES.indexOf(p as PhaseName));

/** Agent states, in wire order (see ai/Agent.ts AgentState). */
/** Wire table (index = byte on the wire): append only. */
export const AGENT_STATES = ["inactive", "advance", "engage", "toCover", "inCover", "perch", "follow", "revive", "downed", "dead", "patrol"] as const;
export const STATE_DEAD = AGENT_STATES.indexOf("dead");

export const NO_TARGET = 255;

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export type EnemyRec = {
  id: number;
  /** Index into the enemy type table (Object.keys(ENEMIES)). */
  type: number;
  elite: boolean;
  maxHealth: number;
  x: number;
  y: number;
  z: number;
  /** Radians, model facing (+Z at 0). */
  yaw: number;
  pitch: number;
  /** Index into AGENT_STATES. */
  state: number;
  crouched: boolean;
  aiming: boolean;
  health: number;
  /** Player slot being targeted, NO_TARGET for none. */
  target: number;
  /** Sniper laser charge 0..1 (0 = off). */
  charge: number;
  /** Shots fired since the previous snapshot (tracers / sound on clients). */
  shots: number;
};

export type PlayerVitals = {
  slot: number;
  downed: boolean;
  dead: boolean;
  /** Someone is channelling a revive on this player right now. */
  beingRevived: boolean;
  connected: boolean;
  ready: boolean;
  health: number;
  maxHealth: number;
  armor: number;
  /** Seconds until bleed-out while downed. */
  bleed: number;
  /** 0..1 revive progress. */
  revive: number;
  selfRevives: number;
  money: number;
};

export type SnapshotFrame = {
  time: number;
  wave: number;
  phase: number;
  timer: number;
  remaining: number;
  players: PlayerVitals[];
  enemies: EnemyRec[];
};

export type DecodedSnapshot = Omit<SnapshotFrame, "enemies"> & {
  seq: number;
  keyframe: boolean;
  /** Full, merged enemy state after applying this snapshot. */
  enemies: Map<number, EnemyRec>;
  /** Ids that left the field this snapshot (pooled on the host). */
  removed: number[];
};

const F_POS = 1, F_ROT = 2, F_STATE = 4, F_HEALTH = 8, F_IDENT = 16, F_TARGET = 32, F_SHOTS = 64;
const F_ALL = F_POS | F_ROT | F_STATE | F_HEALTH | F_IDENT | F_TARGET;

/** Quantized enemy, the unit of delta comparison. */
type QEnemy = {
  x: number; y: number; z: number; yaw: number; pitch: number; state: number;
  health: number; ident: number; maxHealth: number; target: number; charge: number;
};

const qAngle8 = (a: number) => ((Math.round((a / TAU) * 256) % 256) + 256) % 256;
const dqAngle8 = (q: number) => (q / 256) * TAU;
const qPitch8 = (p: number) => Math.round((Math.max(-1.5, Math.min(1.5, p)) / 1.5) * 127);
const dqPitch8 = (q: number) => (q / 127) * 1.5;

function quantizeEnemy(e: EnemyRec): QEnemy {
  return {
    x: Math.round(e.x * POS_Q),
    y: Math.round(e.y * POS_Q),
    z: Math.round(e.z * POS_Q),
    yaw: qAngle8(e.yaw),
    pitch: qPitch8(e.pitch),
    state: (e.state & 15) | (e.crouched ? 16 : 0) | (e.aiming ? 32 : 0),
    health: Math.max(0, Math.min(0xffff, Math.ceil(e.health))),
    ident: (e.type & 127) | (e.elite ? 128 : 0),
    maxHealth: Math.max(0, Math.min(0xffff, Math.round(e.maxHealth))),
    target: e.target & 255,
    charge: Math.round(Math.max(0, Math.min(1, e.charge)) * 255),
  };
}

function writePlayer(w: ByteWriter, p: PlayerVitals) {
  w.u8(p.slot);
  w.u8((p.downed ? 1 : 0) | (p.dead ? 2 : 0) | (p.beingRevived ? 4 : 0) | (p.connected ? 8 : 0) | (p.ready ? 16 : 0));
  w.u16(Math.ceil(p.health));
  w.u16(p.maxHealth);
  w.u8(Math.ceil(p.armor));
  w.u8(p.bleed * 4);
  w.u8(p.revive * 255);
  w.u8(p.selfRevives);
  w.u32(p.money);
}

function readPlayer(r: ByteReader): PlayerVitals {
  const slot = r.u8();
  const f = r.u8();
  return {
    slot,
    downed: (f & 1) !== 0,
    dead: (f & 2) !== 0,
    beingRevived: (f & 4) !== 0,
    connected: (f & 8) !== 0,
    ready: (f & 16) !== 0,
    health: r.u16(),
    maxHealth: r.u16(),
    armor: r.u8(),
    bleed: r.u8() / 4,
    revive: r.u8() / 255,
    selfRevives: r.u8(),
    money: r.u32(),
  };
}

/**
 * Host side: turns full frames into keyframes / deltas against what it last
 * sent. Deltas only carry changed fields per enemy (bitmask) plus a removal
 * list; a keyframe carries everything and implicitly removes the rest.
 */
export class SnapshotEncoder {
  private seq = 0;
  private sinceKey = Infinity;
  private readonly baseline = new Map<number, QEnemy>();
  private readonly seen = new Set<number>();

  constructor(private readonly keyframeEvery: number = NET.KEYFRAME_EVERY) {}

  /** Next snapshot is a keyframe (a peer joined / reconnected). */
  forceKeyframe() {
    this.sinceKey = Infinity;
  }

  encode(f: SnapshotFrame): Uint8Array {
    const key = this.sinceKey >= this.keyframeEvery;
    this.sinceKey = key ? 1 : this.sinceKey + 1;
    this.seq = (this.seq + 1) & 0xffff;

    const w = new ByteWriter(64 + f.enemies.length * 20);
    w.u8(MSG.snapshot);
    w.u8(NET.VERSION);
    w.u8(key ? 1 : 0);
    w.u16(this.seq);
    w.u32(f.time);
    w.u8(f.wave);
    w.u8(f.phase);
    w.u16(Math.max(0, f.timer) * 10);
    w.u16(f.remaining);

    w.u8(f.players.length);
    for (const p of f.players) writePlayer(w, p);

    // Removals (deltas only).
    this.seen.clear();
    for (const e of f.enemies) this.seen.add(e.id);
    const removed: number[] = [];
    for (const id of this.baseline.keys()) if (!this.seen.has(id)) removed.push(id);
    for (const id of removed) this.baseline.delete(id);
    if (key) this.baseline.clear();
    w.u8(key ? 0 : Math.min(255, removed.length));
    if (!key) for (let i = 0; i < Math.min(255, removed.length); i++) w.u16(removed[i]);

    const countAt = w.reserveU16();
    let count = 0;
    for (const e of f.enemies) {
      const q = quantizeEnemy(e);
      const prev = this.baseline.get(e.id);
      let mask = 0;
      if (!prev) mask = F_ALL;
      else {
        if (q.x !== prev.x || q.y !== prev.y || q.z !== prev.z) mask |= F_POS;
        if (q.yaw !== prev.yaw || q.pitch !== prev.pitch) mask |= F_ROT;
        if (q.state !== prev.state) mask |= F_STATE;
        if (q.health !== prev.health) mask |= F_HEALTH;
        if (q.ident !== prev.ident || q.maxHealth !== prev.maxHealth) mask |= F_IDENT;
        if (q.target !== prev.target || q.charge !== prev.charge) mask |= F_TARGET;
      }
      const shots = Math.min(255, Math.max(0, e.shots | 0));
      if (shots > 0) mask |= F_SHOTS;
      this.baseline.set(e.id, q);
      if (!mask) continue;
      count++;
      w.u16(e.id);
      w.u8(mask);
      if (mask & F_POS) {
        w.i16(q.x);
        w.i16(q.y);
        w.i16(q.z);
      }
      if (mask & F_ROT) {
        w.u8(q.yaw);
        w.i8(q.pitch);
      }
      if (mask & F_STATE) w.u8(q.state);
      if (mask & F_HEALTH) w.u16(q.health);
      if (mask & F_IDENT) {
        w.u8(q.ident);
        w.u16(q.maxHealth);
      }
      if (mask & F_TARGET) {
        w.u8(q.target);
        w.u8(q.charge);
      }
      if (mask & F_SHOTS) w.u8(shots);
    }
    w.patchU16(countAt, count);
    return w.bytes();
  }
}

/**
 * Client side: applies keyframes / deltas into a merged enemy table. A
 * delta that doesn't follow the last applied seq is dropped and the decoder
 * waits for the next keyframe (≤1 s) rather than drifting.
 */
export class SnapshotDecoder {
  readonly enemies = new Map<number, EnemyRec>();
  private lastSeq = -1;
  private synced = false;
  /** Deltas dropped while waiting for a keyframe (diagnostics). */
  dropped = 0;

  get isSynced() {
    return this.synced;
  }

  apply(bytes: Uint8Array): DecodedSnapshot | null {
    const r = new ByteReader(bytes);
    if (r.u8() !== MSG.snapshot) return null;
    if (r.u8() !== NET.VERSION) return null;
    const keyframe = (r.u8() & 1) !== 0;
    const seq = r.u16();
    if (!keyframe) {
      const expected = (this.lastSeq + 1) & 0xffff;
      if (!this.synced || seq !== expected) {
        this.synced = false;
        this.dropped++;
        return null;
      }
    }
    const time = r.u32();
    const wave = r.u8();
    const phase = r.u8();
    const timer = r.u16() / 10;
    const remaining = r.u16();
    const np = r.u8();
    const players: PlayerVitals[] = [];
    for (let i = 0; i < np; i++) players.push(readPlayer(r));

    const removed: number[] = [];
    const nr = r.u8();
    for (let i = 0; i < nr; i++) removed.push(r.u16());

    const present = keyframe ? new Set<number>() : null;
    const n = r.u16();
    const touched = new Set<EnemyRec>();
    for (let i = 0; i < n; i++) {
      const id = r.u16();
      const mask = r.u8();
      let e = this.enemies.get(id);
      if (!e) {
        e = { id, type: 0, elite: false, maxHealth: 1, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, state: 0, crouched: false, aiming: false, health: 0, target: NO_TARGET, charge: 0, shots: 0 };
        this.enemies.set(id, e);
      }
      e.shots = 0;
      if (mask & F_POS) {
        e.x = r.i16() / POS_Q;
        e.y = r.i16() / POS_Q;
        e.z = r.i16() / POS_Q;
      }
      if (mask & F_ROT) {
        e.yaw = dqAngle8(r.u8());
        e.pitch = dqPitch8(r.i8());
      }
      if (mask & F_STATE) {
        const s = r.u8();
        e.state = s & 15;
        e.crouched = (s & 16) !== 0;
        e.aiming = (s & 32) !== 0;
      }
      if (mask & F_HEALTH) e.health = r.u16();
      if (mask & F_IDENT) {
        const ident = r.u8();
        e.type = ident & 127;
        e.elite = (ident & 128) !== 0;
        e.maxHealth = r.u16();
      }
      if (mask & F_TARGET) {
        e.target = r.u8();
        e.charge = r.u8() / 255;
      }
      if (mask & F_SHOTS) e.shots = r.u8();
      touched.add(e);
      present?.add(id);
    }
    // Shots are per-snapshot counts: clear them on entities we didn't touch.
    for (const e of this.enemies.values()) if (!touched.has(e)) e.shots = 0;
    for (const id of removed) this.enemies.delete(id);
    if (present) {
      for (const id of [...this.enemies.keys()]) {
        if (!present.has(id)) {
          this.enemies.delete(id);
          removed.push(id);
        }
      }
    }
    this.lastSeq = seq;
    this.synced = true;
    return { seq, keyframe, time, wave, phase, timer, remaining, players, enemies: this.enemies, removed };
  }
}

// ---------------------------------------------------------------------------
// Player state (every peer, 20 Hz)
// ---------------------------------------------------------------------------

export type PlayerStateMsg = {
  slot: number;
  seq: number;
  /** Sender clock, ms. */
  time: number;
  x: number;
  y: number;
  z: number;
  /** Camera yaw/pitch (player convention: yaw 0 looks down −Z). */
  yaw: number;
  pitch: number;
  crouch: boolean;
  sprint: boolean;
  slide: boolean;
  grounded: boolean;
  ads: boolean;
  downed: boolean;
  selfReviving: boolean;
  ready: boolean;
  /** Index into the weapon table (Object.keys(WEAPONS)). */
  weapon: number;
  /** Shots fired since the previous state message. */
  shots: number;
  /** Slot this player is reviving, NO_TARGET for none. */
  reviveTarget: number;
};

export function encodePlayerState(s: PlayerStateMsg): Uint8Array {
  const w = new ByteWriter(24);
  w.u8(MSG.state);
  w.u8(NET.VERSION);
  w.u8(s.slot);
  w.u16(s.seq & 0xffff);
  w.u32(s.time);
  w.i16(s.x * POS_Q);
  w.i16(s.y * POS_Q);
  w.i16(s.z * POS_Q);
  const yaw = ((s.yaw % TAU) + TAU) % TAU;
  w.u16(Math.round((yaw / TAU) * 65536) % 65536);
  w.i16(Math.max(-1.6, Math.min(1.6, s.pitch)) * 20000);
  w.u8(
    (s.crouch ? 1 : 0) | (s.sprint ? 2 : 0) | (s.slide ? 4 : 0) | (s.grounded ? 8 : 0) |
      (s.ads ? 16 : 0) | (s.downed ? 32 : 0) | (s.selfReviving ? 64 : 0) | (s.ready ? 128 : 0),
  );
  w.u8(s.weapon);
  w.u8(Math.min(255, s.shots));
  w.u8(s.reviveTarget);
  return w.bytes();
}

export function decodePlayerState(bytes: Uint8Array): PlayerStateMsg | null {
  const r = new ByteReader(bytes);
  if (r.u8() !== MSG.state || r.u8() !== NET.VERSION) return null;
  const slot = r.u8();
  const seq = r.u16();
  const time = r.u32();
  const x = r.i16() / POS_Q, y = r.i16() / POS_Q, z = r.i16() / POS_Q;
  const yaw = (r.u16() / 65536) * TAU;
  const pitch = r.i16() / 20000;
  const f = r.u8();
  return {
    slot, seq, time, x, y, z, yaw, pitch,
    crouch: (f & 1) !== 0,
    sprint: (f & 2) !== 0,
    slide: (f & 4) !== 0,
    grounded: (f & 8) !== 0,
    ads: (f & 16) !== 0,
    downed: (f & 32) !== 0,
    selfReviving: (f & 64) !== 0,
    ready: (f & 128) !== 0,
    weapon: r.u8(),
    shots: r.u8(),
    reviveTarget: r.u8(),
  };
}

// ---------------------------------------------------------------------------
// Side-channel gameplay events (JSON, piggy-backed on the periodic messages)
// ---------------------------------------------------------------------------

/** Client → host hit claim: [enemyId, damage×10, part, source, weaponIdx, shotId]. */
export type HitClaimWire = [number, number, number, number, number, number];
export const PARTS = ["head", "body", "legs"] as const;
export const SOURCES = ["", "melee"] as const;

/** Client → host extras on a state message. */
export type StateExtras = {
  /** Hit claims since the last message. */
  c?: HitClaimWire[];
  /** Grenade explosions (x, y, z cm). */
  x?: [number, number, number][];
  /** Purchases: [itemId, price]. */
  buy?: [string, number][];
  /**
   * Client → host: "my delta decoder lost sync, send a keyframe". Rides on
   * the regular state message (no extra Realtime traffic), so a lost or
   * reordered delta heals in about one round trip instead of waiting up to
   * a full keyframe interval with frozen enemies.
   */
  k?: 1;
  /**
   * Missions (added later; hosts that predate them ignore these):
   * `i` — holding interact at the current objective (plant / rescue);
   * `hh` — hits on host gunships: [heliIndex, damage×10, part, source].
   */
  i?: 1;
  hh?: [number, number, number, number][];
  /** Door toggles (client → host; hosts that predate doors ignore it): [doorIndex, open 0/1]. */
  dr?: [number, number][];
};

/** Host → peers events on a snapshot. */
export type HostEvent =
  /** Player `to` was hurt by `a` from (x, z). */
  | { k: "hurt"; to: number; a: number; x: number; z: number }
  /** Enemy of type `t` killed by slot `by` (255 = environment) with `w` weapon name. */
  | { k: "kill"; by: number; t: number; hd: boolean; src: string; w: string; $: number }
  /** Explosion effect thrown by `by`. */
  | { k: "fx"; by: number; x: number; y: number; z: number }
  /** Player respawned at the start of a wave. */
  | { k: "respawn"; to: number; x: number; z: number }
  /** Match over. `earned` per slot for the summary; `reason` for host-left etc. */
  | { k: "end"; victory: boolean; earned: number[]; reason?: string }
  // ---- Missions (added later; clients that predate them skip unknown kinds) ----
  /** Full mission state (on change and once a second): objectives, checkpoint, timers. */
  | { k: "ms"; s: MissionState }
  /** Discrete mission event (objective, radio line, checkpoint, retry, detonation, extraction). */
  | { k: "mev"; e: MissionEvent }
  /** Host gunships, ~4 Hz: [x×10, y×10, z×10, yaw×100, health, maxHealth, state 0 idle · 1 flying · 2 dying] per slot. */
  | { k: "air"; h: [number, number, number, number, number, number, number][] }
  /** Door targets (0 closed · 1 open, map door order): on change and every couple of seconds. */
  | { k: "doors"; o: number[] };

/** `h`: the host's own player state (same encoding as StatePayload.b). */
export type SnapshotPayload = { b: string; e?: HostEvent[]; h?: string };
export type StatePayload = { b: string } & StateExtras;
