import * as THREE from "three";
import type { EngineContext } from "../core/GameMode";
import type { HitPart } from "../core/types";
import type { Agent } from "../ai/Agent";
import type { KillInfo } from "../ai/AgentManager";
import type { Combatant } from "../ai/types";
import { DIFFICULTY, ECONOMY, ENEMIES, OPERATORS, PERKS, PLAYER, WAVES, type EnemyType } from "../survival/config";
import { PlayerState } from "../survival/PlayerState";
import { Wallet } from "../survival/ShopSystem";
import type { WavePhase } from "../survival/WaveManager";
import type { TeamRow } from "../ui/SurvivalHUD";
import { GRENADE, MELEE, WEAPONS } from "../weapons/weapons";
import { RemoteAvatar, RemoteEnemy } from "./avatars";
import { fromBase64, toBase64 } from "./codec";
import { HitValidator, type Vec } from "./hitValidation";
import { ENEMY_TYPES, enemyTypeIndex, WEAPON_IDS, weaponIndex } from "./ids";
import { ClockSync } from "./interpolation";
import {
  AGENT_STATES, decodePlayerState, encodePlayerState, NET, NO_TARGET, PARTS, PHASES, phaseCode,
  SnapshotDecoder, SnapshotEncoder,
  type EnemyRec, type HitClaimWire, type HostEvent, type PlayerStateMsg, type PlayerVitals,
  type SnapshotPayload, type StatePayload, type NetRates, netRates,
} from "./protocol";
import type { NetTransport, RoomSettings, RosterEntry } from "./transport";
import type { CoopMode, MissionNet, SurvivalBridge, TeammateView } from "./types";
import type { MissionEvent, MissionState } from "../missions/types";

export type CoopMatchSetup = {
  transport: NetTransport;
  matchId: string;
  hostId: string;
  roster: RosterEntry[];
  settings: RoomSettings;
};

const REVIVE_RANGE = 2.2;
const SPAWN_OFFSETS: [number, number][] = [[0, 0], [1.6, 0], [-1.6, 0], [0, 1.8]];
const MAX_CLAIMS_PER_MSG = 64;
/** Missions: full state resend interval and gunship pose rate. */
const MISSION_STATE_EVERY = 1;
const AIR_EVERY = 0.25;
/** Per-message cap on gunship hit claims and on one claim's damage. */
const MAX_HELI_HITS = 24;
const MAX_HELI_HIT = 240;

type Peer = {
  entry: RosterEntry;
  slot: number;
  name: string;
  avatar: RemoteAvatar | null;
  clock: ClockSync;
  last: PlayerStateMsg | null;
  lastHeard: number;
  connected: boolean;
  heard: boolean;
  pendingShots: number;
  shotTimer: number;
  /** Latest vitals (host: computed from `state`; clients: from snapshots). */
  vitals: PlayerVitals;
  wasDowned: boolean;
  // ---- Host-authoritative copies ------------------------------------------------
  state: PlayerState;
  wallet: Wallet;
  combatant: Combatant | null;
  /** Latest reported position (host AI aims at this, not the delayed render). */
  pos: THREE.Vector3;
  speed: number;
  claims: HitClaimWire[];
  explosions: [number, number, number][];
  buys: [string, number][];
  /** Missions: holding interact at the objective; gunship hit claims. */
  interact: boolean;
  heliHits: [number, number, number, number][];
  lastRewardShot: number;
  lastExplosion: number;
};

const blankVitals = (slot: number): PlayerVitals => ({
  slot, downed: false, dead: false, beingRevived: false, connected: true, ready: false,
  health: 100, maxHealth: 100, armor: 0, bleed: 0, revive: 0, selfRevives: 0, money: ECONOMY.startMoney,
});

/**
 * Online co-op for Survival, host-authoritative.
 *
 * Host: runs the full simulation (AI, waves, damage, economy). Keeps a
 * PlayerState + Wallet per remote player, lets the AI target them, validates
 * their hit claims, and broadcasts delta snapshots at 12 Hz.
 * Clients: predict their own movement and shooting, render host enemies as
 * interpolated proxies ~100 ms in the past, send state + hit claims at 20 Hz,
 * and mirror waves/vitals/wallet from snapshots.
 * Everyone renders teammates as full soldiers with name tags.
 */
export class CoopSurvivalNet implements MissionNet {
  readonly role: "host" | "client";
  readonly slot: number;
  private readonly peers = new Map<number, Peer>();
  private mode!: CoopMode;
  private ctx!: EngineContext;
  private bridge!: SurvivalBridge;
  private readonly offs: (() => void)[] = [];

  // Local player.
  private stateAcc = 0;
  private stateSeq = 0;
  private lastShots = 0;
  private localReady = false;
  private reviveTarget = NO_TARGET;
  private readonly claims: HitClaimWire[] = [];
  private readonly explosions: [number, number, number][] = [];
  private readonly buys: [string, number][] = [];
  private readonly heliHits: [number, number, number, number][] = [];
  private msAcc = 0;
  private airAcc = 0;

  // Host.
  private readonly encoder: SnapshotEncoder;
  private lastKeyRequest = -1e9;
  private readonly validator = new HitValidator();
  private snapAcc = 0;
  private readonly events: HostEvent[] = [];
  private endEvent: HostEvent | null = null;
  private endRepeats = 0;
  private attributing = -1;
  private attributingWeapon = "";
  private lastPhase: WavePhase = "prematch";
  private lastWave = 0;
  private readonly agentById = new Map<number, Agent>();
  private readonly shotsBy = new Map<number, number>();

  // Client.
  private readonly decoder = new SnapshotDecoder();
  /** Decoder dropped a delta (gap / reorder) and is waiting for a keyframe. */
  private get wantKeyframe() {
    return this.decoder.dropped > 0 && !this.decoder.isSynced;
  }
  private readonly hostClock = new ClockSync();
  private readonly snapQueue: SnapshotPayload[] = [];
  /** Arrival time (performance.now) of each queued snapshot, for clock sync. */
  private readonly snapArrivals: number[] = [];
  private readonly proxies = new Map<number, RemoteEnemy>();
  private myVitals: PlayerVitals | null = null;
  private lastSnapAt = 0;
  private hostGoneSince = -1;
  private ended = false;
  private statusBannerAt = 0;
  private laserGeo: THREE.BoxGeometry | null = null;
  private laserMat: THREE.MeshBasicMaterial | null = null;

  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly tmp3 = new THREE.Vector3();

  constructor(private readonly setup: CoopMatchSetup) {
    const self = setup.roster.find((r) => r.id === setup.transport.selfId);
    if (!self) throw new Error("Not in this match's roster");
    this.slot = self.slot;
    this.role = setup.transport.selfId === setup.hostId ? "host" : "client";
    this.rates = netRates(setup.roster.length);
    this.encoder = new SnapshotEncoder(this.rates.keyframeEvery);
    for (const entry of setup.roster) {
      if (entry.slot === this.slot) continue;
      this.peers.set(entry.slot, {
        entry, slot: entry.slot, name: entry.name, avatar: null, clock: new ClockSync(), last: null,
        lastHeard: performance.now(), connected: true, heard: false, pendingShots: 0, shotTimer: 0,
        vitals: blankVitals(entry.slot), wasDowned: false,
        state: new PlayerState(), wallet: new Wallet(), combatant: null, pos: new THREE.Vector3(), speed: 0,
        claims: [], explosions: [], buys: [], interact: false, heliHits: [], lastRewardShot: -1, lastExplosion: -1e9,
      });
    }
  }

  /** Send rates for this room size, within NET.MSG_BUDGET (see protocol.ts). */
  readonly rates: NetRates;

  get playerCount() {
    return this.setup.roster.length;
  }

  get busy() {
    return this.reviveTarget !== NO_TARGET;
  }

  get teammatesUp() {
    for (const p of this.peers.values()) if (p.connected && !p.vitals.downed && !p.vitals.dead) return true;
    return false;
  }

  /** Diagnostics for the debug overlay / dev tools. */
  get stats() {
    return {
      role: this.role, slot: this.slot, proxies: this.proxies.size, decoderDropped: this.decoder.dropped,
      hostJitterMs: Math.round(this.hostClock.jitterMs), hostDelayMs: Math.round(this.hostClock.delayFor(this.streamDelay(this.rates.snapshotHz))),
      hitsAccepted: this.validator.accepted, hitsRejected: this.validator.rejected,
      peers: [...this.peers.values()].map((p) => ({ slot: p.slot, name: p.name, connected: p.connected, heard: p.heard })),
    };
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  attach(mode: CoopMode, ctx: EngineContext, bridge: SurvivalBridge) {
    this.mode = mode;
    this.ctx = ctx;
    this.bridge = bridge;
    const t = this.setup.transport;

    // Spread the squad around the spawn point.
    const [ox, oz] = SPAWN_OFFSETS[this.slot % SPAWN_OFFSETS.length];
    const { yaw } = ctx.spawnPoint(this.tmp2);
    this.spawnLocal(this.tmp2.x + ox, this.tmp2.z + oz, yaw);

    for (const p of this.peers.values()) {
      p.avatar = new RemoteAvatar(ctx.scene, p.name, p.entry.operator, p.entry.look);
      if (this.role === "host") {
        const op = OPERATORS[p.entry.operator] ?? OPERATORS.ridge;
        p.state.reset(op.maxHealth, op.startArmor);
        p.combatant = this.makeCombatant(p);
      }
    }
    if (this.role === "host") {
      mode.agents.net = {
        targets: [...this.peers.values()].map((p) => p.combatant!),
        onShot: (ag) => this.shotsBy.set(ag.id, (this.shotsBy.get(ag.id) ?? 0) + 1),
      };
      this.lastPhase = mode.waves.phase;
      this.lastWave = mode.waves.wave;
    }

    this.offs.push(t.on("s", (p) => this.onState(p as StatePayload & { m?: string })));
    this.offs.push(t.on("snap", (p) => {
      const sp = p as SnapshotPayload & { m?: string };
      if (this.role !== "client" || sp?.m !== this.setup.matchId) return;
      if (typeof sp.h === "string") this.onState({ m: sp.m, b: sp.h }); // host pose
      this.snapQueue.push(sp);
      this.snapArrivals.push(performance.now());
    }));
    this.offs.push(t.on("bye", (p) => this.onBye(p as { id: string; m?: string })));
    this.offs.push(t.onPresence((list) => {
      if (this.role !== "client") return;
      const here = list.some((m) => m.id === this.setup.hostId);
      if (here) this.hostGoneSince = -1;
      else if (this.hostGoneSince < 0) this.hostGoneSince = performance.now();
    }));
    this.lastSnapAt = performance.now();
  }

  private spawnLocal(x: number, z: number, yaw: number) {
    const nav = this.mode.nav;
    const cell = nav.nearestWalkable(x, z);
    if (cell >= 0) this.tmp.set(nav.cx(cell), nav.floor[cell], nav.cz(cell));
    else this.tmp.set(x, 0, z);
    this.ctx.player.spawn(this.tmp, yaw);
  }

  private makeCombatant(p: Peer): Combatant & { downed: boolean; yaw: number } {
    const isEnded = () => this.mode.ended;
    return {
      team: "player",
      get name() {
        return p.name;
      },
      get targetable() {
        return p.connected && p.heard && p.state.alive && !isEnded();
      },
      get downed() {
        return p.state.downed;
      },
      get yaw() {
        return p.last?.yaw ?? 0;
      },
      position: p.pos,
      aimPoint: (out) => out.set(p.pos.x, p.pos.y + (p.last?.crouch ? 0.95 : 1.3), p.pos.z),
      get moveSpeed() {
        return p.speed;
      },
      get crouched() {
        return p.last?.crouch ?? false;
      },
      takeFire: (amount, from) => this.damageRemote(p, amount, from),
      isPlayer: true,
    };
  }

  dispose() {
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.setup.transport.send("bye", { id: this.setup.transport.selfId, m: this.setup.matchId });
    for (const p of this.peers.values()) p.avatar?.dispose();
    for (const e of this.proxies.values()) {
      if (e.laser) this.ctx.scene.remove(e.laser);
      e.dispose();
    }
    this.proxies.clear();
    this.laserGeo?.dispose();
    this.laserMat?.dispose();
    if (this.mode?.agents) this.mode.agents.net = null;
  }

  // ---------------------------------------------------------------------------
  // Inbound
  // ---------------------------------------------------------------------------

  private onState(payload: StatePayload & { m?: string }) {
    if (!payload || typeof payload.b !== "string" || payload.m !== this.setup.matchId) return;
    let msg: PlayerStateMsg | null = null;
    try {
      msg = decodePlayerState(fromBase64(payload.b));
    } catch {
      return;
    }
    if (!msg || msg.slot === this.slot) return;
    const p = this.peers.get(msg.slot);
    if (!p) return;
    if (p.last && ((msg.seq - p.last.seq) & 0xffff) > 0x8000) return; // stale
    const now = performance.now();
    if (this.role === "host" && (!p.connected || !p.heard)) this.encoder.forceKeyframe();
    if (!p.connected) this.ctx.hud.killfeed(p.name, "", "RECONNECTED", false);
    // Movement estimate for the AI's accuracy model.
    if (p.last) {
      const dtS = Math.max(0.01, (msg.time - p.last.time) / 1000);
      p.speed = Math.min(12, Math.hypot(msg.x - p.last.x, msg.z - p.last.z) / dtS);
    }
    p.last = msg;
    p.lastHeard = now;
    p.connected = true;
    p.heard = true;
    p.pos.set(msg.x, msg.y, msg.z);
    p.clock.observe(msg.time, now);
    p.avatar?.buffer.push(msg.time, [msg.x, msg.y, msg.z, msg.yaw, msg.pitch]);
    p.pendingShots = Math.min(30, p.pendingShots + msg.shots);
    if (this.role === "host") {
      if (Array.isArray(payload.c)) for (const c of payload.c.slice(0, MAX_CLAIMS_PER_MSG)) if (Array.isArray(c) && c.length === 6) p.claims.push(c);
      if (Array.isArray(payload.x)) for (const x of payload.x.slice(0, 4)) if (Array.isArray(x) && x.length === 3) p.explosions.push(x);
      if (Array.isArray(payload.buy)) for (const b of payload.buy.slice(0, 16)) if (Array.isArray(b) && typeof b[0] === "string") p.buys.push(b);
      p.interact = payload.i === 1;
      if (Array.isArray(payload.hh)) for (const h of payload.hh.slice(0, MAX_HELI_HITS)) if (Array.isArray(h) && h.length === 4) p.heliHits.push(h);
      // A client's delta decoder lost sync: heal with a keyframe (rate-limited).
      if (payload.k === 1 && now - this.lastKeyRequest > 250) {
        this.lastKeyRequest = now;
        this.encoder.forceKeyframe();
      }
    }
  }

  private onBye(p: { id: string; m?: string }) {
    if (!p || p.m !== this.setup.matchId) return;
    if (p.id === this.setup.hostId && this.role === "client") {
      this.hostLost("THE HOST LEFT THE MATCH");
      return;
    }
    for (const peer of this.peers.values()) {
      if (peer.entry.id === p.id && peer.connected) {
        peer.connected = false;
        this.ctx.hud.killfeed(peer.name, "", "LEFT", false);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  update(dt: number) {
    const now = performance.now();
    if (this.role === "client") this.drainSnapshots(now);
    else this.hostSimulate(dt);

    // Liveness.
    for (const p of this.peers.values()) {
      if (p.connected && p.heard && now - p.lastHeard > NET.PEER_TIMEOUT_MS) {
        p.connected = false;
        this.ctx.hud.killfeed(p.name, "", "CONNECTION LOST", false);
      }
    }

    this.updateAvatars(dt, now);
    if (this.role === "client") this.updateProxies(dt, now);
    this.watchPeerDowns();

    if (this.role === "host") {
      // The host's own pose rides inside its snapshots (saves a broadcast).
      const iv = 1 / this.rates.snapshotHz;
      this.snapAcc += dt;
      if (this.snapAcc >= iv || this.endRepeats > 0) {
        this.snapAcc = Math.min(Math.max(0, this.snapAcc - iv), iv);
        this.sendSnapshot(now);
      }
    } else {
      const iv = 1 / this.rates.stateHz;
      this.stateAcc += dt;
      if (this.stateAcc >= iv) {
        this.stateAcc = Math.min(this.stateAcc - iv, iv);
        this.setup.transport.send("s", this.buildState(now));
      }
      this.clientWatchdog(now);
    }
  }

  private buildState(now: number): StatePayload & { m: string } {
    const ctx = this.ctx;
    const p = ctx.player;
    const s = this.mode.state;
    const shots = ctx.weapons.stats.shotsFired;
    const msg: PlayerStateMsg = {
      slot: this.slot,
      seq: (this.stateSeq = (this.stateSeq + 1) & 0xffff),
      time: now,
      // Frame-interpolated feet: sampled at exactly `now`, so remote interpolation sees an even path.
      x: p.feetPosition.x, y: p.feetPosition.y, z: p.feetPosition.z,
      yaw: p.yaw, pitch: p.pitch,
      crouch: p.crouching || p.sliding, sprint: p.sprinting, slide: p.sliding, grounded: p.grounded,
      ads: ctx.weapons.adsAmount > 0.5,
      downed: s.downed,
      selfReviving: s.downed && !s.dead && s.selfRevives > 0 && ctx.input.isDown("KeyF"),
      ready: this.localReady,
      weapon: weaponIndex(ctx.weapons.active.def.id),
      shots: Math.max(0, shots - this.lastShots),
      reviveTarget: this.reviveTarget,
    };
    this.lastShots = shots;
    const payload: StatePayload & { m: string } = { m: this.setup.matchId, b: toBase64(encodePlayerState(msg)) };
    if (this.claims.length) payload.c = this.claims.splice(0, MAX_CLAIMS_PER_MSG);
    if (this.explosions.length) payload.x = this.explosions.splice(0);
    if (this.buys.length) payload.buy = this.buys.splice(0);
    if (this.mode.mission?.holdingInteract) payload.i = 1;
    if (this.heliHits.length) payload.hh = this.heliHits.splice(0, MAX_HELI_HITS);
    if (this.role === "client" && this.wantKeyframe) payload.k = 1;
    return payload;
  }

  // ---------------------------------------------------------------------------
  // Host
  // ---------------------------------------------------------------------------

  private hostSimulate(dt: number) {
    const mode = this.mode;
    this.agentById.clear();
    for (const a of mode.agents.active) this.agentById.set(a.id, a);

    for (const p of this.peers.values()) {
      this.applyClaims(p);
      this.applyExplosions(p);
      this.applyBuys(p);
      this.applyHeliHits(p);
      // Remote vitals: downed / bleed-out / revive, same rules as the local player.
      if (p.heard && !mode.ended) {
        const reviving = this.isBeingRevived(p.slot);
        const self = !reviving && !!p.last?.selfReviving && p.state.downed && p.state.selfRevives > 0;
        const res = p.state.update(dt, reviving || self, self ? PLAYER.selfReviveTime : PLAYER.reviveTime);
        if (res === "revived" && self) p.state.selfRevives = Math.max(0, p.state.selfRevives - 1);
      }
      this.fillVitals(p.vitals, p.state, p.wallet, p.slot, p.connected, !!p.last?.ready);
    }

    // Wave flow side effects for remote players.
    const w = mode.waves;
    if (w.phase !== this.lastPhase || w.wave !== this.lastWave) {
      if (w.phase === "combat" && this.lastPhase !== "combat") this.onWaveStart();
      if (this.lastPhase === "combat" && (w.phase === "intermission" || w.phase === "victory")) this.onWaveCleared(w.wave);
      if (w.phase !== this.lastPhase) this.localReady = false;
      this.lastPhase = w.phase;
      this.lastWave = w.wave;
    }

    // Everyone ready → skip the countdown.
    if ((w.phase === "prematch" || w.phase === "intermission") && this.localReady) {
      let all = true;
      for (const p of this.peers.values()) if (p.connected && p.heard && !p.last?.ready) all = false;
      if (all) w.skip();
    }

    // Missions: resend the full state now and then (covers lost events / late snapshots), stream gunships.
    if (mode.mission) {
      this.msAcc += dt;
      if (this.msAcc >= MISSION_STATE_EVERY) {
        this.msAcc = 0;
        this.missionState(mode.mission.snapshot());
      }
      this.airAcc += dt;
      if (this.airAcc >= AIR_EVERY) {
        this.airAcc = 0;
        this.pushAir();
      }
    }

    if (mode.ended && !this.endEvent) {
      const earned = new Array(this.playerCount).fill(0);
      earned[this.slot] = mode.wallet.earned;
      for (const p of this.peers.values()) earned[p.slot] = p.wallet.earned;
      this.endEvent = { k: "end", victory: mode.mission ? mode.mission.victory : w.phase === "victory", earned };
      this.endRepeats = 3;
    }
  }

  private fillVitals(v: PlayerVitals, s: PlayerState, wallet: Wallet, slot: number, connected: boolean, ready: boolean) {
    v.slot = slot;
    v.downed = s.downed;
    v.dead = s.dead;
    v.beingRevived = s.downed && !s.dead && this.isBeingRevived(slot);
    v.connected = connected;
    v.ready = ready;
    v.health = s.health;
    v.maxHealth = s.maxHealth;
    v.armor = s.armor;
    v.bleed = s.bleed;
    v.revive = s.revive;
    v.selfRevives = s.selfRevives;
    v.money = wallet.money;
  }

  private positionOf(slot: number, out: THREE.Vector3) {
    if (slot === this.slot) return out.copy(this.ctx.player.position);
    const p = this.peers.get(slot);
    return p ? (this.role === "host" ? out.copy(p.pos) : out.copy(p.avatar?.position ?? p.pos)) : null;
  }

  /** Host: someone alive stands next to `slot` holding F on them. */
  private isBeingRevived(slot: number) {
    const target = this.positionOf(slot, this.tmp3);
    if (!target) return false;
    const near = (pos: THREE.Vector3) => Math.hypot(pos.x - target.x, pos.z - target.z) < REVIVE_RANGE + 0.8;
    if (slot !== this.slot && this.reviveTarget === slot && this.mode.state.alive && near(this.ctx.player.position)) return true;
    for (const p of this.peers.values()) {
      if (p.slot === slot || !p.connected || !p.last || p.last.reviveTarget !== slot) continue;
      if (p.state.alive && near(p.pos)) return true;
    }
    return false;
  }

  private damageRemote(p: Peer, amount: number, from: THREE.Vector3) {
    if (this.mode.ended || !p.state.alive) return;
    const before = p.state.health + p.state.armor;
    p.state.damage(amount);
    const taken = before - (p.state.health + p.state.armor);
    if (taken > 0) this.events.push({ k: "hurt", to: p.slot, a: Math.round(taken * 10) / 10, x: Math.round(from.x * 10) / 10, z: Math.round(from.z * 10) / 10 });
  }

  private applyClaims(p: Peer) {
    if (!p.claims.length) return;
    const now = performance.now() / 1000;
    const last = p.last;
    const eye: Vec = last ? { x: last.x, y: last.y + (last.crouch ? 1.0 : 1.6), z: last.z } : { x: 0, y: 0, z: 0 };
    const eyeV = new THREE.Vector3(eye.x, eye.y, eye.z);
    const world = this.ctx.map.collision;
    const los = (a: Vec, b: Vec) => world.lineOfSight(this.tmp.set(a.x, a.y, a.z), this.tmp2.set(b.x, b.y, b.z));
    for (const [id, d10, partIdx, srcIdx, wIdx, shotId] of p.claims) {
      const agent = this.agentById.get(id);
      const part = PARTS[partIdx] ?? "body";
      const melee = srcIdx === 1;
      const weapon = melee ? null : WEAPONS[WEAPON_IDS[wIdx]] ?? null;
      if (!melee && !weapon) continue;
      const pts: Vec[] = [];
      if (agent) {
        const a = agent.aimPoint(new THREE.Vector3());
        pts.push({ x: a.x, y: a.y, z: a.z }, { x: a.x, y: a.y + 0.4, z: a.z }, { x: agent.position.x, y: agent.position.y + 0.7, z: agent.position.z });
      }
      const verdict = this.validator.validate({
        now, shooterId: p.slot, shooterEye: eye,
        shooterCanFire: !!last && p.connected && !p.state.dead && !this.mode.ended,
        targetAlive: !!agent && agent.alive && agent.team === "enemy",
        targetPoints: pts, weapon, part, damage: d10 / 10, los,
      });
      if (!verdict.ok || !agent) continue;
      this.attributing = p.slot;
      this.attributingWeapon = melee ? MELEE.name : weapon!.name;
      const res = agent.applyDamage(verdict.damage, part, eyeV, melee ? "melee" : "");
      this.attributing = -1;
      if (res.counts && !res.killed && shotId !== p.lastRewardShot) {
        p.lastRewardShot = shotId;
        p.wallet.add(ECONOMY.hit * DIFFICULTY[this.mode.config.difficulty].reward);
      }
    }
    p.claims.length = 0;
  }

  private applyExplosions(p: Peer) {
    if (!p.explosions.length) return;
    const now = performance.now();
    for (const [cx, cy, cz] of p.explosions) {
      const at = new THREE.Vector3(cx / 100, cy / 100, cz / 100);
      // A grenade lands within throwing distance, and not faster than the cooldown.
      if (at.distanceTo(p.pos) > 50 || now - p.lastExplosion < GRENADE.cooldown * 600 || p.state.dead) continue;
      p.lastExplosion = now;
      this.attributing = p.slot;
      this.attributingWeapon = GRENADE.name;
      this.mode.agents.explode(at, GRENADE.radius, GRENADE.maxDamage);
      this.attributing = -1;
      // Thrower self-damage, like the local rule.
      this.tmp.set(p.pos.x, p.pos.y + 0.9, p.pos.z);
      this.tmp2.copy(at);
      this.tmp2.y += 0.35;
      const d = this.tmp.distanceTo(this.tmp2);
      if (d < GRENADE.radius && this.ctx.map.collision.lineOfSight(this.tmp2, this.tmp)) {
        this.damageRemote(p, GRENADE.maxDamage * GRENADE.selfDamage * Math.pow(1 - d / GRENADE.radius, 1.15), at);
      }
      this.playExplosion(at);
      this.events.push({ k: "fx", by: p.slot, x: Math.round(cx), y: Math.round(cy), z: Math.round(cz) });
    }
    p.explosions.length = 0;
  }

  private applyBuys(p: Peer) {
    if (!p.buys.length) return;
    for (const [id, rawPrice] of p.buys) {
      const price = Math.max(0, Math.min(5000, Math.round(Number(rawPrice) || 0)));
      const pay = Math.min(price, p.wallet.money);
      p.wallet.money -= pay;
      p.wallet.spent += pay;
      if (id === "armor") p.state.addArmor(ECONOMY.armorPlate);
      else if (id === "perk:secondwind") p.state.selfRevives++;
      else if (id === "perk:ironhide") {
        const hp = PERKS.ironhide.maxHealth ?? 0;
        p.state.maxHealth += hp;
        p.state.health += hp;
      }
    }
    p.buys.length = 0;
  }

  private onWaveStart() {
    const spawn = this.ctx.spawnPoint(this.tmp2);
    // Bled-out players come back for the next wave.
    const s = this.mode.state;
    if (s.dead) {
      s.reset(this.mode.loadout.maxHealth, 0);
      this.ctx.player.downed = false;
      this.ctx.weapons.lockSlot = -1;
      const [ox, oz] = SPAWN_OFFSETS[this.slot % 4];
      this.spawnLocal(this.tmp2.x + ox, this.tmp2.z + oz, spawn.yaw);
    }
    for (const p of this.peers.values()) {
      if (!p.state.dead) continue;
      p.state.reset(p.state.maxHealth, 0);
      const [ox, oz] = SPAWN_OFFSETS[p.slot % 4];
      this.events.push({ k: "respawn", to: p.slot, x: this.tmp2.x + ox, z: this.tmp2.z + oz });
    }
  }

  private onWaveCleared(wave: number) {
    const bonus = (ECONOMY.waveBonusBase + ECONOMY.waveBonusPerWave * wave) * DIFFICULTY[this.mode.config.difficulty].reward;
    for (const p of this.peers.values()) {
      p.wallet.add(bonus);
      p.state.heal();
    }
  }

  // ---------------------------------------------------------------------------
  // Missions (host API, called by MissionGameMode)
  // ---------------------------------------------------------------------------

  /** Host: replicate the mission state (latest wins within one snapshot). */
  missionState(s: MissionState) {
    if (this.role !== "host") return;
    for (let i = this.events.length - 1; i >= 0; i--) if (this.events[i].k === "ms") this.events.splice(i, 1);
    this.events.push({ k: "ms", s });
  }

  /** Host: replicate a discrete mission event. */
  missionEvent(e: MissionEvent) {
    if (this.role !== "host" || e.type === "end") return; // the end rides the regular "end" event
    this.events.push({ k: "mev", e });
  }

  /**
   * Host: put remote players back on their feet at (x, z) — everyone after a
   * checkpoint rollback, or only bled-out players when a new section starts.
   */
  respawnTeam(x: number, z: number, onlyDead: boolean) {
    if (this.role !== "host") return;
    for (const p of this.peers.values()) {
      if (onlyDead && !p.state.dead) continue;
      p.state.reset(p.state.maxHealth, onlyDead ? 0 : (OPERATORS[p.entry.operator] ?? OPERATORS.ridge).startArmor);
      const [ox, oz] = SPAWN_OFFSETS[p.slot % SPAWN_OFFSETS.length];
      this.events.push({ k: "respawn", to: p.slot, x: x + ox, z: z + oz });
    }
  }

  /** Client: replicated hostiles still alive. */
  get enemiesAlive() {
    let n = 0;
    for (const e of this.proxies.values()) if (e.active && e.alive) n++;
    return n;
  }

  /** Offset for the local player when the squad spawns together. */
  get spawnOffset(): [number, number] {
    return SPAWN_OFFSETS[this.slot % SPAWN_OFFSETS.length];
  }

  /** Host: remote players (for objective zones, extraction and gunship targets). */
  teammates(out: TeammateView[]) {
    out.length = 0;
    for (const p of this.peers.values()) {
      if (!p.connected || !p.heard) continue;
      out.push({ x: p.pos.x, z: p.pos.z, up: p.state.alive && !p.state.downed, interact: p.interact, combatant: p.combatant });
    }
    return out;
  }

  private pushAir() {
    const m = this.mode.mission;
    if (!m) return;
    const h: [number, number, number, number, number, number, number][] = [];
    let any = false;
    for (const heli of m.helis.helis) {
      const st = heli.alive ? 1 : heli.flightState === "dying" ? 2 : 0;
      if (st) any = true;
      const p = heli.position;
      h.push([Math.round(p.x * 10), Math.round(p.y * 10), Math.round(p.z * 10), Math.round(heli.heading() * 100), Math.round(heli.health), Math.round(heli.maxHealth), st]);
    }
    // Idle skies: one empty update after the last bird, then nothing.
    if (any || this.airWasActive) this.events.push({ k: "air", h });
    this.airWasActive = any;
  }
  private airWasActive = false;

  private applyHeliHits(p: Peer) {
    const m = this.mode.mission;
    if (!p.heliHits.length || !m) {
      p.heliHits.length = 0;
      return;
    }
    if (!p.state.dead && p.connected && !this.mode.ended) {
      let budget = MAX_HELI_HIT * 4;
      for (const [idx, d10, partIdx, src] of p.heliHits) {
        const heli = m.helis.helis[idx];
        const dmg = Math.min(MAX_HELI_HIT, Math.max(0, d10 / 10), budget);
        if (!heli || !heli.targetable || dmg <= 0) continue;
        // Must be within gun range of the shooter.
        if (heli.position.distanceTo(p.pos) > 180) continue;
        budget -= dmg;
        this.attributing = p.slot;
        this.attributingWeapon = src === 1 ? GRENADE.name : WEAPONS[WEAPON_IDS[p.last?.weapon ?? 0]]?.name ?? "";
        heli.applyDamage(dmg, PARTS[partIdx] ?? "body", p.pos, src === 1 ? "grenade" : "");
        this.attributing = -1;
      }
    }
    p.heliHits.length = 0;
  }

  /** Host: who's credited for the heli kill happening right now (-1 = local). */
  get creditSlot() {
    return this.attributing;
  }
  creditName(slot: number) {
    return this.nameOf(slot);
  }

  private applyAir(h: [number, number, number, number, number, number, number][]) {
    const m = this.mode.mission;
    if (!m || !Array.isArray(h)) return;
    const list = m.helis.helis;
    for (let i = 0; i < list.length; i++) {
      const heli = list[i];
      const r = h[i];
      if (!heli.remote) heli.remote = (amount, part, source) => this.queueHeliHit(i, amount, part, source);
      if (!Array.isArray(r) || r.length !== 7) continue;
      const [x, y, z, yaw, hp, max, st] = r;
      if (st === 1) heli.puppetTo(x / 10, y / 10, z / 10, yaw / 100, hp, Math.max(1, max));
      else if (st === 2) heli.puppetKill();
      else if (heli.alive) heli.hide();
    }
  }

  private queueHeliHit(index: number, amount: number, part: HitPart, source: string) {
    if (this.heliHits.length >= MAX_HELI_HITS * 2) return;
    this.heliHits.push([index, Math.round(amount * 10), Math.max(0, PARTS.indexOf(part)), source === "grenade" ? 1 : 0]);
  }

  private slotOfCombatant(c: Combatant | null) {
    if (!c) return NO_TARGET;
    if (c.isPlayer && !this.isPeerCombatant(c)) return this.slot;
    for (const p of this.peers.values()) if (p.combatant === c) return p.slot;
    return NO_TARGET;
  }
  private isPeerCombatant(c: Combatant) {
    for (const p of this.peers.values()) if (p.combatant === c) return true;
    return false;
  }

  private sendSnapshot(now: number) {
    const mode = this.mode;
    const players: PlayerVitals[] = [];
    const mine = blankVitals(this.slot);
    this.fillVitals(mine, mode.state, mode.wallet, this.slot, true, this.localReady);
    players.push(mine);
    for (const p of this.peers.values()) players.push(p.vitals);

    const enemies: EnemyRec[] = [];
    for (const a of mode.agents.active) {
      if (a.state === "inactive") continue;
      enemies.push({
        id: a.id,
        type: enemyTypeIndex(a.spec.role),
        elite: a.elite,
        maxHealth: a.maxHealth,
        x: a.position.x, y: a.position.y, z: a.position.z,
        yaw: a.yaw, pitch: a.aimPitch,
        state: Math.max(0, AGENT_STATES.indexOf(a.state)),
        crouched: a.crouched,
        aiming: a.hasLos && a.target !== null,
        health: a.health,
        target: this.slotOfCombatant(a.target),
        charge: a.aimCharge > 0 ? a.aimCharge : 0,
        shots: this.shotsBy.get(a.id) ?? 0,
      });
    }
    this.shotsBy.clear();
    const w = mode.waves;
    const bytes = this.encoder.encode({
      time: now, wave: w.wave, phase: phaseCode(w.phase), timer: w.timer,
      remaining: w.remaining(mode.agents.enemiesAlive), players, enemies,
    });
    const payload: SnapshotPayload & { m: string } = { m: this.setup.matchId, b: toBase64(bytes), h: this.buildState(now).b };
    const events = this.events.splice(0);
    if (this.endEvent && this.endRepeats > 0) {
      events.push(this.endEvent);
      this.endRepeats--;
    }
    if (events.length) payload.e = events;
    this.setup.transport.send("snap", payload);
  }

  // ---------------------------------------------------------------------------
  // Client
  // ---------------------------------------------------------------------------

  private drainSnapshots(now: number) {
    const q = this.snapQueue;
    const n = q.length;
    for (let i = 0; i < n; i++) {
      const payload = q[i];
      const arrived = this.snapArrivals[i] ?? now;
      this.lastSnapAt = now;
      let snap = null;
      try {
        snap = this.decoder.apply(fromBase64(payload.b));
      } catch {
        snap = null;
      }
      if (snap) {
        // Arrival time, not this frame's time: frame quantisation would read as jitter.
        this.hostClock.observe(snap.time, arrived);
        this.applyWaves(snap.wave, snap.phase, snap.timer, snap.remaining);
        for (const v of snap.players) {
          if (v.slot === this.slot) this.myVitals = v;
          else {
            const p = this.peers.get(v.slot);
            if (p) p.vitals = v;
          }
        }
        for (const e of snap.enemies.values()) this.applyEnemy(e, snap.time);
        for (const id of snap.removed) this.proxies.get(id)?.deactivate();
      }
      // Events are independent of delta sync.
      if (Array.isArray(payload.e)) for (const ev of payload.e) this.onHostEvent(ev);
    }
    q.length = 0;
    this.snapArrivals.length = 0;
  }

  private applyWaves(wave: number, phaseIdx: number, timer: number, remaining: number) {
    const w = this.mode.waves;
    const phase = (PHASES[phaseIdx] ?? "prematch") as WavePhase;
    const prev = w.phase;
    w.wave = wave;
    w.timer = timer;
    // remaining() = queue + alive; clients have no AI, so mirror it through the queue.
    if (w.queue.length !== remaining) {
      w.queue.length = 0;
      for (let i = 0; i < remaining; i++) w.queue.push("rifleman");
    }
    if (this.mode.ended) return;
    w.phase = phase;
    if (phase === prev) return;
    const ctx = this.ctx;
    const shud = this.bridge.shud;
    this.localReady = false;
    if (phase === "combat") {
      this.bridge.crateUsed.fill(false);
      ctx.sfx.waveStart();
      shud.showBanner(`WAVE ${wave}`, `${remaining} HOSTILES INBOUND`, 3, "#f2efe6");
      ctx.emit({ type: "phase", phase: "combat", wave });
    } else if (prev === "combat" && phase === "intermission") {
      ctx.sfx.waveClear();
      const bonus = Math.round((ECONOMY.waveBonusBase + ECONOMY.waveBonusPerWave * wave) * DIFFICULTY[this.mode.config.difficulty].reward);
      shud.moneyPop(bonus, "WAVE BONUS");
      shud.showBanner(`WAVE ${wave} CLEARED`, `+$${bonus}  ·  ARMORIES ONLINE`, 3, "#9be070");
      ctx.emit({ type: "phase", phase: "intermission", wave });
    } else if (phase === "victory") {
      ctx.sfx.waveClear();
      shud.showBanner("OUTPOST HELD", `ALL ${w.target} WAVES CLEARED`, 4, "#9be070");
    }
  }

  private applyEnemy(e: EnemyRec, time: number) {
    const type = ENEMY_TYPES[e.type] ?? "rifleman";
    let px = this.proxies.get(e.id);
    if (px && px.type !== type) {
      px.dispose();
      px = undefined;
    }
    if (!px) {
      px = new RemoteEnemy(this.ctx.scene, e.id, type, (en, amount, part, source) => this.queueClaim(en, amount, part, source));
      this.proxies.set(e.id, px);
    }
    px.apply(e);
    px.buffer.push(time, [e.x, e.y, e.z, e.yaw, e.pitch]);
  }

  private queueClaim(e: RemoteEnemy, amount: number, part: HitPart, source: string) {
    if (this.claims.length >= 256) return;
    const w = this.ctx.weapons;
    this.claims.push([e.id, Math.round(amount * 10), Math.max(0, PARTS.indexOf(part)), source === "melee" ? 1 : 0, weaponIndex(w.active.def.id), w.stats.shotsFired]);
  }

  private onHostEvent(ev: HostEvent) {
    if (!ev || typeof ev !== "object") return;
    const ctx = this.ctx;
    switch (ev.k) {
      case "hurt": {
        if (ev.to !== this.slot) return;
        const p = ctx.player;
        const dx = ev.x - p.position.x, dz = ev.z - p.position.z;
        const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
        const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
        const angle = Math.hypot(dx, dz) > 0.5 ? Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz) : null;
        ctx.hud.hurt(ev.a, angle);
        ctx.sfx.hurt(ev.a > 20);
        ctx.shake.add(Math.min(0.22, ev.a / 90));
        this.mode.state.damageTaken += ev.a;
        return;
      }
      case "kill": {
        const def = ENEMIES[ENEMY_TYPES[ev.t] ?? "rifleman"];
        ctx.hud.killfeed(this.nameOf(ev.by), ev.w, def.name, ev.hd);
        if (ev.by === this.slot) {
          this.bridge.shud.moneyPop(ev.$, ev.hd ? "HEADSHOT" : def.type === "warden" ? "BOSS" : "");
          this.bridge.countKill(def.type, ev.hd ? "head" : "body", ev.src);
          if (def.type === "warden") this.bridge.shud.showBanner("WARDEN DOWN", `+$${ev.$}`, 3, "#ffc845");
        }
        return;
      }
      case "fx": {
        if (ev.by === this.slot) return;
        this.playExplosion(this.tmp.set(ev.x / 100, ev.y / 100, ev.z / 100));
        return;
      }
      case "respawn": {
        if (ev.to !== this.slot) return;
        this.spawnLocal(ev.x, ev.z, this.ctx.player.yaw);
        ctx.player.downed = false;
        ctx.weapons.lockSlot = -1;
        this.mode.mission?.onRespawn();
        return;
      }
      case "ms": {
        if (ev.s && typeof ev.s === "object" && ev.s.missionId) this.mode.mission?.applySnapshot(ev.s);
        return;
      }
      case "mev": {
        if (ev.e && typeof ev.e === "object") this.mode.mission?.remoteEvent(ev.e);
        return;
      }
      case "air": {
        this.applyAir(ev.h);
        return;
      }
      case "end": {
        if (this.mode.ended) return;
        this.mode.wallet.earned = ev.earned?.[this.slot] ?? this.mode.wallet.earned;
        this.mode.end(ev.victory);
        return;
      }
    }
  }

  private playExplosion(at: THREE.Vector3) {
    const ctx = this.ctx;
    ctx.effects.explosion(at);
    const dist = at.distanceTo(ctx.camera.position);
    ctx.sfx.explosion(at, dist);
    ctx.shake.add(Math.max(0, 0.6 * (1 - dist / 36)));
  }

  private nameOf(slot: number) {
    if (slot === this.slot) return this.ctx.callsign;
    return this.peers.get(slot)?.name ?? "Squad";
  }

  private hostLost(reason: string) {
    if (this.ended || this.mode.ended) return;
    this.ended = true;
    this.bridge.shud.showBanner(reason, "MATCH ENDED", 4, "#ff8a6a");
    this.mode.end(false);
  }

  private clientWatchdog(now: number) {
    if (this.mode.ended) return;
    const silent = now - this.lastSnapAt;
    if (silent > NET.HOST_TIMEOUT_MS) return this.hostLost("LOST CONNECTION TO THE HOST");
    if (this.hostGoneSince >= 0 && now - this.hostGoneSince > 3000 && silent > 1500) return this.hostLost("THE HOST LEFT THE MATCH");
    if (silent > 1500 && now - this.statusBannerAt > 2500) {
      this.statusBannerAt = now;
      this.bridge.shud.showBanner("CONNECTION INTERRUPTED", "RECONNECTING…", 2, "#ffc845");
    }
  }

  clientVitals(): "revived" | "downed" | null {
    const v = this.myVitals;
    if (!v) return null;
    const s = this.mode.state;
    const wasDowned = s.downed;
    s.health = v.health;
    s.maxHealth = v.maxHealth;
    s.armor = v.armor;
    s.bleed = v.bleed;
    s.revive = v.revive;
    s.selfRevives = v.selfRevives;
    s.downed = v.downed || v.dead;
    s.dead = v.dead;
    this.mode.wallet.money = v.money;
    if (!wasDowned && s.downed) {
      s.timesDowned++;
      return "downed";
    }
    if (wasDowned && !s.downed) return "revived";
    return null;
  }

  // ---------------------------------------------------------------------------
  // Rendering remote entities
  // ---------------------------------------------------------------------------

  private updateAvatars(dt: number, now: number) {
    const canShop = this.mode.canShop;
    for (const p of this.peers.values()) {
      const av = p.avatar;
      if (!av) continue;
      const v = p.vitals;
      const status = !p.connected ? "OFFLINE" : v.dead ? "KIA" : v.downed ? "DOWN" : canShop && p.last?.ready ? "READY" : "";
      const as = this.avatarState;
      as.crouched = !!p.last?.crouch;
      as.downed = v.downed && !v.dead;
      as.dead = v.dead;
      as.connected = p.connected && p.heard;
      as.status = status;
      av.update(dt, p.clock.renderTime(now, this.streamDelay(p.entry.id === this.setup.hostId ? this.rates.snapshotHz : this.rates.stateHz)), as);
      if (!av.visible) {
        p.pendingShots = 0;
        continue;
      }
      if (p.pendingShots > 0) {
        p.shotTimer -= dt;
        if (p.shotTimer <= 0) {
          p.pendingShots--;
          const hz = p.entry.id === this.setup.hostId ? this.rates.snapshotHz : this.rates.stateHz;
          p.shotTimer = 1 / hz / Math.max(1, p.pendingShots + 1);
          this.teammateShot(p);
        }
      }
    }
  }

  private readonly avatarState = { crouched: false, downed: false, dead: false, connected: false, status: "" };

  /**
   * Minimum interpolation delay for a stream sent at `hz`: one send interval
   * plus a little slack. ClockSync raises it when the link is jittery, so a
   * calm connection shows teammates/enemies with the least possible lag.
   */
  private streamDelay(hz: number) {
    return Math.ceil(1000 / hz) + NET.INTERP_SLACK_MS;
  }

  private teammateShot(p: Peer) {
    const av = p.avatar!;
    const ctx = this.ctx;
    av.model.fire();
    const m = av.muzzle(this.tmp);
    const dir = av.aimDir(this.tmp2);
    const far = ctx.map.collision.raycast(m.x, m.y, m.z, dir.x, dir.y, dir.z, 120);
    const end = this.tmp3.copy(dir).multiplyScalar(far === Infinity ? 120 : far).add(m);
    ctx.effects.tracer(m, end, false);
    ctx.effects.muzzlePuff(m, dir);
    const wid = WEAPON_IDS[p.last?.weapon ?? 0];
    const heavy = wid && WEAPONS[wid].pellets > 1 ? 1.4 : 1;
    ctx.sfx.enemyShot(m, heavy, m.distanceTo(ctx.camera.position));
  }

  private updateProxies(dt: number, now: number) {
    const rt = this.hostClock.renderTime(now, this.streamDelay(this.rates.snapshotHz));
    for (const e of this.proxies.values()) {
      if (!e.active) continue;
      e.update(dt, rt);
      if (!e.alive) {
        e.pendingShots = 0;
        if (e.laser) e.laser.visible = false;
        continue;
      }
      if (e.type === "sniper") this.sniperLaser(e);
      if (e.pendingShots > 0) {
        e.shotTimer -= dt;
        if (e.shotTimer <= 0) {
          e.pendingShots--;
          e.shotTimer = 1 / this.rates.snapshotHz / Math.max(1, e.pendingShots + 1);
          this.enemyShot(e);
        }
      }
    }
  }

  private targetPoint(slot: number, out: THREE.Vector3) {
    if (slot === this.slot) {
      const p = this.ctx.player;
      return out.set(p.position.x, p.position.y + p.colliderHeight * 0.72, p.position.z);
    }
    const peer = this.peers.get(slot);
    if (!peer?.avatar?.visible) return null;
    return out.copy(peer.avatar.position).setY(peer.avatar.position.y + 1.25);
  }

  private enemyShot(e: RemoteEnemy) {
    const ctx = this.ctx;
    e.model.fire();
    const m = e.model.muzzle.getWorldPosition(this.tmp);
    let end = this.targetPoint(e.target, this.tmp2);
    if (!end) {
      const cp = Math.cos(e.pitch);
      end = this.tmp2.set(Math.sin(e.yaw) * cp, Math.sin(e.pitch), Math.cos(e.yaw) * cp).multiplyScalar(40).add(m);
    }
    end.x += (Math.random() - 0.5) * 1.2;
    end.y += (Math.random() - 0.5) * 0.8;
    end.z += (Math.random() - 0.5) * 1.2;
    ctx.effects.tracer(m, end, true);
    const dir = this.tmp3.subVectors(end, m).normalize();
    ctx.effects.muzzlePuff(m, dir);
    ctx.sfx.enemyShot(m, e.def.weapon.heavy, m.distanceTo(ctx.camera.position));
  }

  private sniperLaser(e: RemoteEnemy) {
    if (!this.laserGeo) {
      this.laserGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
      this.laserMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.3, 0.2), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    }
    if (!e.laser) {
      e.laser = new THREE.Mesh(this.laserGeo, this.laserMat!);
      e.laser.frustumCulled = false;
      this.ctx.scene.add(e.laser);
    }
    const target = e.charge > 0 ? this.targetPoint(e.target, this.tmp2) : null;
    if (!target) {
      e.laser.visible = false;
      return;
    }
    const m = e.model.muzzle.getWorldPosition(this.tmp);
    const len = m.distanceTo(target);
    e.laser.position.copy(m);
    e.laser.lookAt(target);
    const thick = 0.02 + e.charge * 0.025;
    e.laser.scale.set(thick, thick, len);
    e.laser.visible = true;
  }

  /** Killfeed + banner when a teammate goes down (every machine). */
  private watchPeerDowns() {
    for (const p of this.peers.values()) {
      const down = p.vitals.downed && !p.vitals.dead;
      if (down && !p.wasDowned && p.connected) {
        this.ctx.hud.killfeed("Hostiles", "", p.name, false);
        this.bridge.shud.showBanner(`${p.name.toUpperCase()} IS DOWN`, "HOLD [F] NEXT TO THEM TO REVIVE", 2.4, "#ff8a6a");
      }
      p.wasDowned = down;
    }
  }

  // ---------------------------------------------------------------------------
  // SurvivalNet hooks
  // ---------------------------------------------------------------------------

  revivingMe() {
    if (this.role === "host") return this.isBeingRevived(this.slot);
    return !!this.myVitals?.beingRevived;
  }

  teamWiped() {
    if (this.role !== "host") return false;
    const out = (s: PlayerState) => s.dead || (s.downed && s.selfRevives === 0);
    if (!out(this.mode.state)) return false;
    for (const p of this.peers.values()) if (p.connected && p.heard && !out(p.state)) return false;
    return true;
  }

  interact(_dt: number, holdingF: boolean) {
    this.reviveTarget = NO_TARGET;
    if (!this.mode.state.alive || this.mode.ended) return null;
    const me = this.ctx.player.position;
    let best: Peer | null = null;
    let bestD = REVIVE_RANGE;
    for (const p of this.peers.values()) {
      const v = p.vitals;
      if (!p.connected || !v.downed || v.dead || !p.avatar?.visible) continue;
      const d = Math.hypot(p.avatar.position.x - me.x, p.avatar.position.z - me.z);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (!best) return null;
    if (holdingF) this.reviveTarget = best.slot;
    return { prompt: `HOLD [F] REVIVE ${best.name.toUpperCase()}  (${Math.ceil(best.vitals.bleed)}s)`, progress: best.vitals.revive };
  }

  ready() {
    if (!this.mode.canShop) return;
    if (!this.localReady) {
      this.localReady = true;
      const others = [...this.peers.values()].filter((p) => p.connected && p.heard);
      const waiting = others.filter((p) => !p.last?.ready).length;
      this.bridge.shud.showBanner("READY", waiting ? `WAITING FOR ${waiting} TEAMMATE${waiting > 1 ? "S" : ""}` : "", 1.6, "#9be070");
    }
  }

  killCredit(k: KillInfo) {
    if (this.role !== "host") return false;
    const type = k.agent.spec.role as EnemyType;
    const def = ENEMIES[type];
    const t = enemyTypeIndex(type);
    if (this.attributing < 0) {
      const w = k.source === "melee" ? MELEE.name : k.source === "grenade" ? GRENADE.name : this.ctx.weapons.active.def.name;
      this.events.push({ k: "kill", by: this.slot, t, hd: k.part === "head" && !k.source, src: k.source, w, $: 0 });
      return false;
    }
    const p = this.peers.get(this.attributing);
    if (!p) return false;
    const diff = DIFFICULTY[this.mode.config.difficulty];
    const base = def.reward * diff.reward * (k.agent.elite ? WAVES.elite.reward : 1);
    const money = k.source === "melee" ? ECONOMY.meleeKill * diff.reward + base * 0.5 : k.source === "grenade" ? base + 30 : base + (k.part === "head" ? ECONOMY.headshotBonus : 0);
    const got = p.wallet.add(money);
    const head = k.part === "head" && !k.source;
    this.ctx.hud.killfeed(p.name, this.attributingWeapon, def.name, head);
    this.events.push({ k: "kill", by: p.slot, t, hd: head, src: k.source, w: this.attributingWeapon, $: got });
    if (type === "warden") this.bridge.shud.showBanner("WARDEN DOWN", `${p.name.toUpperCase()} TOOK IT`, 3, "#ffc845");
    return true;
  }

  onExplosion(at: THREE.Vector3) {
    const q: [number, number, number] = [Math.round(at.x * 100), Math.round(at.y * 100), Math.round(at.z * 100)];
    if (this.role === "client") {
      this.explosions.push(q);
      return true;
    }
    this.events.push({ k: "fx", by: this.slot, x: q[0], y: q[1], z: q[2] });
    return false;
  }

  onBuy(id: string, price: number) {
    if (this.role === "client" && price > 0) this.buys.push([id, price]);
  }

  collectTargets(out: THREE.Object3D[]) {
    if (this.role !== "client") return;
    for (const e of this.proxies.values()) {
      if (!e.alive || e.predictedDead) continue;
      const h = e.model.hitboxes;
      for (let i = 0; i < h.length; i++) out.push(h[i]);
    }
  }

  private readonly peerOrder: Peer[] = [];

  teamRows(out: TeamRow[]) {
    const canShop = this.mode.canShop;
    if (this.peerOrder.length !== this.peers.size) {
      this.peerOrder.length = 0;
      for (const p of this.peers.values()) this.peerOrder.push(p);
      this.peerOrder.sort((a, b) => a.slot - b.slot);
    }
    for (const p of this.peerOrder) {
      const v = p.vitals;
      out.push({
        name: p.name,
        health: v.health,
        max: v.maxHealth,
        status: !p.connected ? "OFFLINE" : v.dead ? "KIA" : v.downed ? `DOWN ${Math.ceil(v.bleed)}s` : canShop && v.ready ? "READY" : "",
      });
    }
  }
}
