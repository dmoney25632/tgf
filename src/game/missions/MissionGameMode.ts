import * as THREE from "three";
import type { EngineContext, GameMode, MatchSummary, Vitals } from "../core/GameMode";
import type { HitPart } from "../core/types";
import { NavGrid } from "../ai/NavGrid";
import { AgentManager, type KillInfo } from "../ai/AgentManager";
import type { Agent } from "../ai/Agent";
import type { Combatant } from "../ai/types";
import { disposeHumanoidCache } from "../ai/Humanoid";
import { SurvivalHUD, type TeamRow } from "../ui/SurvivalHUD";
import { GRENADE, MELEE } from "../weapons/weapons";
import { DIFFICULTY, ENEMIES, OPERATORS, PLAYER, WAVES, type EnemyType } from "../survival/config";
import { PlayerLoadout } from "../survival/PlayerLoadout";
import { PlayerState } from "../survival/PlayerState";
import { HelicopterManager } from "../vehicles/HelicopterManager";
import { Wallet } from "../survival/ShopSystem";
import { WaveManager } from "../survival/WaveManager";
import type { CoopMissionHooks, CoopMode, MissionNet, TeammateView } from "../net/types";
import type { AttackHelicopter } from "../vehicles/AttackHelicopter";
import { AIR } from "../survival/airSupport";
import { getMission } from "./campaign";
import { MissionDirector, scoreMission, type DirectorHost, type MissionFacts } from "./MissionDirector";
import { MissionHUD } from "./MissionHUD";
import { MISSION_AMMO } from "./operations";
import { clock, starTargets, type StarTargets } from "./rating";
import type { AirScript, MissionConfig, MissionDef, MissionEvent, MissionResult, MissionState, ObjectiveDef, Point, RadioLine } from "./types";

const INTERACT_RANGE = 2.3;
const BOT_REVIVE_RANGE = 2.2;
const BOT_REVIVE_TIME = 2.5;
const VIP_HEALTH = 180;
const CHARGE_RADIUS = 9;
const CHARGE_DAMAGE = 420;
/** Hold [F] at an ammo crate: refill time and per-crate cooldown. */
const RESUPPLY_TIME = 1.2;
const RESUPPLY_COOLDOWN = 45;
/** Default AI nav window for maps that don't size their own. */
const NAV_DEFAULT = { minX: -50, minZ: -50, width: 100, depth: 100 };
/** Small per-mission bump so the campaign escalates. */
const MISSION_SCALE = [1, 1.08, 1.16];

/**
 * Scripted story missions on top of the shared FPS core. Owns the player's
 * vitals / revive rules (as survival does), the AI squad, scripted enemy
 * waves and gunships, objective props (charges, the VIP, the extraction
 * bird) and the mission overlay. Objective logic lives in MissionDirector.
 *
 * Networking: `config.net` mirrors SurvivalGameMode's optional hooks. A host
 * gets `onState(snapshot)` on every replicated change and `onEvent` for
 * discrete events; a client calls `applySnapshot` with the host's state and
 * skips scripting (role "client").
 */
export class MissionGameMode implements GameMode, CoopMode {
  readonly label = "MISSION";
  readonly def: MissionDef;
  readonly state = new PlayerState();
  readonly loadout: PlayerLoadout;
  readonly nav: NavGrid;
  readonly agents: AgentManager;
  readonly helis: HelicopterManager;
  readonly director: MissionDirector;
  // ---- Co-op (see net/types CoopMode) ------------------------------------------------
  /** Unused by missions; the co-op layer's survival economy writes here harmlessly. */
  readonly wallet = new Wallet();
  /** Fixed "combat" phase so the co-op layer's survival wave flow never fires. */
  readonly waves = Object.assign(new WaveManager(0, 1, 1), { phase: "combat" as const });
  readonly canShop = false;
  private readonly coop: MissionNet | undefined;
  private readonly isClient: boolean;
  private readonly mates: TeammateView[] = [];
  private readonly shud: SurvivalHUD;
  private readonly mhud: MissionHUD;
  private readonly diff: (typeof DIFFICULTY)[keyof typeof DIFFICULTY];
  private readonly scale: number;
  private readonly combatant: Combatant & { downed: boolean; yaw: number };
  private readonly heliTargets: Combatant[] = [];
  private readonly teamRows: TeamRow[] = [];
  private readonly facts: MissionFacts = {
    hostiles: 0, inZone: false, contested: false, interacting: false, vipAlive: false, vipDead: false,
    vipAtGoal: false, heliLanded: false, allAboard: false, teamWiped: false, spawnRoom: 0,
  };

  // Objective props.
  private readonly props = new THREE.Group();
  private readonly targets: { def: ObjectiveDef; mesh: THREE.Group; charge: THREE.Mesh }[] = [];
  private readonly propMats: THREE.Material[] = [];
  private readonly propGeos: THREE.BufferGeometry[] = [];
  private vip: Agent | null = null;
  private vipActive = false;
  private smokeTimer = 0;
  private blink = 0;

  ended = false;
  private endTimer = -1;
  private seconds = 0;
  private wiped = false;
  private selfReviving = false;
  private botReviveTarget: Agent | null = null;
  private heartbeat = 0;
  private grenadeKills = 0;
  private meleeKills = 0;
  private readonly kills: Record<string, number> = {};
  private prompt = "";
  private promptProgress = -1;
  private statusKey = -1;
  private result: MissionResult | null = null;
  /** Star target times at this difficulty (shown on the HUD clock). */
  readonly stars: StarTargets;
  private readonly ammo: (Point & { ready: number; hold: number })[];

  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly wp = new THREE.Vector3();

  constructor(private readonly ctx: EngineContext, readonly config: MissionConfig) {
    const def = getMission(config.missionId);
    if (!def) throw new Error(`Unknown mission ${config.missionId}`);
    this.def = def;
    this.coop = config.coop;
    this.isClient = (config.coop?.role ?? config.net?.role) === "client";
    this.diff = DIFFICULTY[config.difficulty];
    this.scale = MISSION_SCALE[def.index - 1] ?? 1;

    // ---- Player ------------------------------------------------------------------
    this.loadout = new PlayerLoadout(config.operator, config.primary, config.secondary);
    const op = this.loadout.operator;
    this.loadout.apply(ctx.weapons);
    ctx.weapons.resetAmmo();
    ctx.viewmodel.setOperatorColors(op.colors.glove, op.colors.sleeve);
    ctx.viewmodel.setWeapon(ctx.weapons.active.def);
    ctx.grenades.count = op.grenades + 1;
    ctx.grenades.maxCarry = GRENADE.maxCarry + 1;
    this.state.reset(this.loadout.maxHealth, op.startArmor);
    ctx.hud.modeLabel = "MISSION";

    const isEnded = () => this.ended;
    const player = ctx.player;
    const state = this.state;
    this.combatant = {
      team: "player",
      get name() {
        return ctx.callsign;
      },
      get targetable() {
        return state.alive && !isEnded();
      },
      get downed() {
        return state.downed;
      },
      get yaw() {
        return player.yaw;
      },
      position: player.position,
      aimPoint: (out) => out.set(player.position.x, player.position.y + player.colliderHeight * 0.72, player.position.z),
      get moveSpeed() {
        return player.speed;
      },
      get crouched() {
        return player.crouching;
      },
      takeFire: (amount, from) => this.playerHit(amount, from),
      isPlayer: true,
    };

    // ---- AI / air ------------------------------------------------------------------
    // Nav grid sized to the map (large mission maps declare their window).
    const nw = ctx.map.def.nav ?? NAV_DEFAULT;
    this.nav = new NavGrid(ctx.map.collision, nw.minX, nw.minZ, nw.width, nw.depth);
    this.stars = starTargets(def, config.difficulty);
    this.ammo = (MISSION_AMMO[def.id] ?? []).map((p) => ({ ...p, ready: 0, hold: 0 }));
    this.agents = new AgentManager(ctx.scene, ctx.map.collision, this.nav, ctx.effects, ctx.sfx, this.combatant, ctx.camera.position, {
      onEnemyKilled: (k) => this.onEnemyKilled(k),
      onAgentDamaged: (agent, amount, _part, killed, source) => {
        if (source === "grenade" && agent.team === "enemy") this.shud.damageNumber(agent.aimPoint(this.tmp), amount, killed ? "kill" : "body");
      },
      onSquadDowned: (agent) => {
        ctx.hud.killfeed("Hostiles", "", agent.name, false);
        if (agent === this.vip) this.director.credit("vipDowned");
        this.shud.showBanner(`${agent.name.toUpperCase()} IS DOWN`, "HOLD [F] NEXT TO THEM TO REVIVE", 2.4, "#ff8a6a");
      },
    });
    this.agents.prewarm("rifleman", 10);
    this.agents.prewarm("rusher", 4);
    this.agents.prewarm("armored", 2);
    const others = Object.values(OPERATORS).filter((o) => o.id !== op.id);
    const callsigns = ["Kestrel", "Halden"];
    // Co-op: remote players take the squad slots.
    for (let i = 0; i < (this.coop ? 0 : Math.min(2, config.squad)); i++) {
      const c = others[i].colors;
      this.agents.addSquadmate(i, { uniform: c.sleeve, vest: c.vest, helmet: c.helmet, accent: c.accent }, { name: callsigns[i] });
    }
    this.helis = new HelicopterManager(ctx.scene, ctx.map.collision, ctx.effects, ctx.sfx, ctx.camera.position, {
      onDeploy: (_h, at) => this.deployTrooper(at),
      onDestroyed: (h, source) => this.onHeliDestroyed(h, source),
      onCrash: (_h, at) => this.onHeliCrash(at),
    });
    this.agents.extraHostiles = this.helis.airborne;

    // ---- Props ------------------------------------------------------------------------
    this.buildProps();
    ctx.scene.add(this.props);

    // ---- HUD --------------------------------------------------------------------------
    this.shud = new SurvivalHUD(ctx.container);
    const roots = ctx.container.querySelectorAll(".ih-hud");
    this.mhud = new MissionHUD(ctx.container);
    this.mhud.attach(roots[roots.length - 1] ?? null);

    // ---- Script -----------------------------------------------------------------------
    this.director = new MissionDirector(def, this.host);
    this.coop?.attach(this, ctx, {
      shud: this.shud,
      crateUsed: [],
      countKill: (type, part, source) => {
        this.kills[type] = (this.kills[type] ?? 0) + 1;
        if (source === "melee") this.meleeKills++;
        else if (source === "grenade") this.grenadeKills++;
        void part;
      },
    });
    const [sx, sz] = this.coop?.spawnOffset ?? [0, 0];
    this.spawnTeamAt({ x: def.start.x + sx, z: def.start.z + sz }, def.start.yaw);
    if (!this.isClient) this.director.start();
    else this.mhud.objective(`OBJECTIVE 1 / ${def.objectives.length}`, def.objectives[0].title, def.objectives[0].detail ?? "");
    this.shud.showBanner(def.title.toUpperCase(), `${def.codename}  ·  ${def.location.toUpperCase()}`, 4.2, "#f2efe6");
    this.publish({ type: "objective", index: 0, title: def.objectives[0].title });
  }

  // ---------------------------------------------------------------------------
  // Director host
  // ---------------------------------------------------------------------------

  private readonly host: DirectorHost = {
    spawn: (type, x, z, elite, y) => this.spawnEnemy(type, x, z, elite, y),
    launchAir: (air) => this.launchAir(air),
    radio: (line) => this.onRadio(line),
    objectiveStarted: (i, def, resumed) => {
      this.statusKey = -1;
      this.mhud.objective(`OBJECTIVE ${i + 1} / ${this.def.objectives.length}`, def.title, def.detail ?? "");
      if (def.kind === "escort") this.prepareVip(def.vip);
      if (i > 0 && !resumed && this.coop) this.redeployDead(def);
      if (i > 0 || resumed) {
        this.ctx.sfx.waveStart();
        this.shud.showBanner(resumed ? "CHECKPOINT" : "NEW OBJECTIVE", def.title, 2.8, resumed ? "#86c7ff" : "#f2efe6");
      }
      this.publish({ type: "objective", index: i, title: def.title });
    },
    objectiveDone: (i, def) => {
      this.ctx.sfx.waveClear();
      this.shud.showBanner("OBJECTIVE COMPLETE", i + 1 < this.def.objectives.length ? `${def.title}  ·  CHECKPOINT SAVED` : def.title, 2.4, "#9be070");
      this.state.heal();
      this.publish({ type: "objectiveDone", index: i });
      this.publish({ type: "checkpoint", index: i + 1 });
    },
    detonate: (def) => this.detonate(def),
    vipFreed: () => {
      if (!this.vip) return;
      this.vip.state = "follow";
      this.vip.health = this.vip.maxHealth;
      this.vip.bleed = 0;
      this.vip.model.revive();
      this.ctx.sfx.cash();
      this.shud.showBanner("VIP FREED", "KEEP THEM ALIVE", 2.2, "#9be070");
    },
    callExtract: (def) => {
      this.launchTransport(def);
      this.publish({ type: "extract", index: this.def.objectives.indexOf(def) });
    },
    restoreCheckpoint: (index, reason) => this.restoreCheckpoint(index, reason),
    end: (victory) => this.end(victory),
  };

  // ---------------------------------------------------------------------------
  // GameMode
  // ---------------------------------------------------------------------------

  reset() {
    // Missions respawn through checkpoints only.
  }

  collectTargets(out: THREE.Object3D[]) {
    this.agents.hitboxes(out);
    this.helis.hitboxes(out);
    this.coop?.collectTargets(out);
  }

  vitals(): Vitals {
    return { health: this.state.health, maxHealth: this.state.maxHealth, armor: this.state.armor };
  }

  update(dt: number, playing: boolean) {
    const ctx = this.ctx;
    if (!playing) {
      this.drawHud(0);
      return;
    }
    if (!this.ended) this.seconds += dt;

    // ---- Player vitals / revive --------------------------------------------------------
    const holdingF = ctx.input.isDown("KeyF");
    this.selfReviving = this.state.downed && this.state.selfRevives > 0 && holdingF;
    const reviving = this.selfReviving || this.agents.reviver !== null || (this.coop?.revivingMe() ?? false);
    if (this.isClient && this.coop) {
      // Co-op client: the host owns vitals.
      const res = this.coop.clientVitals();
      if (res === "downed") this.onLocalDowned();
      else if (res === "revived") this.onPlayerRevived();
    } else if (!this.wiped) {
      const res = this.state.update(dt, reviving, this.selfReviving ? PLAYER.selfReviveTime : PLAYER.reviveTime);
      if (res === "revived") this.onPlayerRevived();
      // Solo: bleeding out ends the attempt. Co-op: you sit out until a teammate reaches the next checkpoint.
      else if (res === "bledout" && !this.coop) this.wiped = true;
    }
    ctx.player.downed = this.state.downed;
    ctx.player.speedMultiplier = this.loadout.speed * ctx.weapons.active.def.mobility;
    ctx.weapons.disabled = this.ended || this.selfReviving || this.botReviveTarget !== null || (this.coop?.busy ?? false);
    ctx.grenades.disabled = this.state.downed || this.ended;
    if (this.state.alive && this.state.health / this.state.maxHealth < 0.3) {
      this.heartbeat -= dt;
      if (this.heartbeat <= 0) {
        ctx.sfx.heartbeat();
        this.heartbeat = 0.9;
      }
    }

    // ---- World --------------------------------------------------------------------------
    this.agents.update(dt);
    this.coop?.update(dt);
    if (this.vip && this.vipActive && this.director.state.stage === "captive" && this.vip.state === "downed") this.vip.bleed = 99;
    const ht = this.heliTargets;
    ht.length = 0;
    if (!this.isClient) {
      if (this.combatant.targetable) ht.push(this.combatant);
      for (const s of this.agents.squad) if (s.targetable) ht.push(s);
      if (this.coop) for (const m of this.coop.teammates(this.mates)) if (m.combatant?.targetable) ht.push(m.combatant);
    }
    this.helis.update(dt, ht);
    this.updateProps(dt);

    // ---- Script -------------------------------------------------------------------------
    this.interactions(dt);
    if (!this.isClient) {
      this.gatherFacts();
      this.director.update(dt, this.facts);
    } else if (this.coop) this.facts.hostiles = this.coop.enemiesAlive + this.helis.hostileAlive;

    if (this.ended && this.endTimer >= 0) {
      this.endTimer -= dt;
      if (this.endTimer < 0) {
        ctx.unlock();
        ctx.emit({ type: "end", summary: this.summary() });
      }
    }
    this.drawHud(dt);
  }

  onWeaponHit(part: HitPart, damage: number, killed: boolean, _name: string, source: string, _shotId: number, point: THREE.Vector3) {
    this.shud.damageNumber(point, damage, killed ? "kill" : part === "head" ? "head" : "body");
    if (killed && source === MELEE.name) return "KNIFE KILL";
    if (killed && part === "head") return "HEADSHOT";
    return null;
  }

  onExplosion(at: THREE.Vector3) {
    if (this.coop?.onExplosion(at)) return; // co-op clients: the host resolves grenade damage
    this.agents.explode(at, GRENADE.radius, GRENADE.maxDamage);
    this.helis.explode(at, GRENADE.radius, GRENADE.maxDamage);
    this.selfBlast(at, GRENADE.radius, GRENADE.maxDamage * GRENADE.selfDamage);
  }

  debug(out: Record<string, string | number>) {
    const s = this.director.state;
    out.mission = `${this.def.id} obj ${s.objective + 1}/${this.def.objectives.length} ${this.director.objective?.kind ?? "-"} ${s.stage} t ${s.objectiveTime.toFixed(1)}`;
    out.script = `pending ${s.pending} · hostiles ${this.facts.hostiles} · retries ${s.retries}`;
    out.enemies = `${this.agents.enemiesAlive} alive / ${this.agents.active.length} active`;
    out.vitals = `${Math.round(this.state.health)}/${this.state.maxHealth} armor ${Math.round(this.state.armor)}`;
    out.air = `${this.helis.hostileAlive} helis · transport ${this.helis.transport.flightState}`;
  }

  // ---------------------------------------------------------------------------
  // Networking
  // ---------------------------------------------------------------------------

  /** Serializable copy of the mission state (host → clients). */
  snapshot(): MissionState {
    return { ...this.director.state };
  }

  /** Client: adopt the host's mission state. */
  applySnapshot(s: MissionState) {
    const prev = this.director.state.objective;
    Object.assign(this.director.state, s);
    const obj = this.director.objective;
    if (obj && s.objective !== prev) this.mhud.objective(`OBJECTIVE ${s.objective + 1} / ${this.def.objectives.length}`, obj.title, obj.detail ?? "");
  }

  private publish(e: MissionEvent) {
    if (this.isClient) return;
    const net = this.config.net;
    net?.onEvent?.(e);
    net?.onState?.(this.snapshot());
    if (this.coop) {
      this.coop.missionEvent(e);
      this.coop.missionState(this.snapshot());
    }
  }

  /** Co-op hooks (CoopMode.mission): mission state, events and gunships over the wire. */
  get mission(): CoopMissionHooks {
    return (this.hooks ??= this.makeHooks());
  }
  private hooks: CoopMissionHooks | null = null;

  private makeHooks(): CoopMissionHooks {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const m = this;
    return {
      get victory() {
        return m.director.state.phase === "complete";
      },
      get holdingInteract() {
        return (m.prompt.startsWith("HOLD [F] P") || m.prompt.startsWith("HOLD [F] F")) && m.ctx.input.isDown("KeyF");
      },
      get helis() {
        return m.helis;
      },
      snapshot: () => m.snapshot(),
      applySnapshot: (s) => m.applySnapshot(s),
      remoteEvent: (e) => m.remoteEvent(e),
      onRespawn: () => {
        m.ctx.weapons.refillAmmo(1);
        m.ctx.grenades.count = Math.max(m.ctx.grenades.count, m.loadout.operator.grenades + 1);
        for (const a of m.ammo) a.ready = 0;
      },
    };
  }

  /** Co-op client: a host mission event (state itself arrives via applySnapshot). */
  private remoteEvent(e: MissionEvent) {
    const def = this.def;
    switch (e.type) {
      case "objective": {
        const o = def.objectives[e.index];
        if (!o) return;
        this.statusKey = -1;
        this.mhud.objective(`OBJECTIVE ${e.index + 1} / ${def.objectives.length}`, o.title, o.detail ?? "");
        if (e.index > 0) {
          this.ctx.sfx.waveStart();
          this.shud.showBanner("NEW OBJECTIVE", o.title, 2.8, "#f2efe6");
        }
        return;
      }
      case "objectiveDone": {
        const o = def.objectives[e.index];
        this.ctx.sfx.waveClear();
        if (o) this.shud.showBanner("OBJECTIVE COMPLETE", e.index + 1 < def.objectives.length ? `${o.title}  ·  CHECKPOINT SAVED` : o.title, 2.4, "#9be070");
        return;
      }
      case "radio":
        this.mhud.radio(e.speaker, e.text);
        return;
      case "retry": {
        for (const t of this.targets) if (def.objectives.indexOf(t.def) >= e.index) t.mesh.visible = true;
        this.helis.transport.hide();
        this.shud.showBanner("SQUAD WIPED", `REDEPLOYING AT CHECKPOINT  ·  ${this.director.state.retries} / ${this.director.maxRetries}`, 3, "#ff8a6a");
        return;
      }
      case "detonate": {
        const o = def.objectives[e.index];
        if (o?.kind === "destroy") this.detonateFx(o);
        return;
      }
      case "extract": {
        const o = def.objectives[e.index];
        if (o?.kind === "extract") this.launchTransport(o);
        return;
      }
      case "air":
        this.shud.showBanner("GUNSHIP INBOUND", "SHOOT IT DOWN — AIM FOR THE COCKPIT", 2.6, "#ffb46a");
        return;
    }
  }

  private launchTransport(def: Extract<ObjectiveDef, { kind: "extract" }>) {
    const from = def.heliFrom;
    this.helis.launchTransport({
      entry: from,
      exit: { x: -from.x, z: -from.z },
      orbit: { x: def.at.x, z: def.at.z, radius: 0, altitude: 12, seconds: 0 },
      land: def.at,
    });
  }

  /** Co-op host: bled-out players rejoin at the start of each new section. */
  private redeployDead(def: ObjectiveDef) {
    const at = def.checkpoint ?? { x: this.ctx.player.position.x, z: this.ctx.player.position.z };
    this.coop?.respawnTeam(at.x, at.z, true);
    if (this.state.dead) {
      this.state.reset(this.loadout.maxHealth, 0);
      this.ctx.player.downed = false;
      this.ctx.weapons.lockSlot = -1;
      const [ox, oz] = this.coop?.spawnOffset ?? [0, 0];
      this.spawnTeamAt({ x: at.x + ox, z: at.z + oz }, def.checkpoint?.yaw ?? this.ctx.player.yaw);
    }
  }

  // ---------------------------------------------------------------------------
  // Facts / interactions
  // ---------------------------------------------------------------------------

  /** Where the current objective is (and how close counts), for zones and the waypoint. */
  private objectivePoint(obj: ObjectiveDef | undefined, out: THREE.Vector3): number {
    if (!obj) return -1;
    let p: Point | null = null;
    let r = 0;
    switch (obj.kind) {
      case "reach":
      case "defend":
      case "extract":
        p = obj.at;
        r = obj.radius;
        break;
      case "destroy":
        p = obj.at;
        r = INTERACT_RANGE;
        break;
      case "escort":
        if (this.director.state.stage === "captive") {
          p = obj.vip;
          r = INTERACT_RANGE;
        } else {
          p = obj.to;
          r = obj.radius;
        }
        break;
      case "eliminate":
        return -1;
    }
    out.set(p.x, this.floorAt(p.x, p.z), p.z);
    return r;
  }

  private gatherFacts() {
    const f = this.facts;
    const obj = this.director.objective;
    const p = this.ctx.player.position;
    f.hostiles = this.agents.enemiesAlive + this.helis.hostileAlive;
    f.spawnRoom = WAVES.maxAliveByQuality[this.ctx.quality] - this.agents.enemiesAlive;
    const r = this.objectivePoint(obj, this.wp);
    const c = this.wp;
    const near = (x: number, z: number, rad: number) => Math.hypot(x - c.x, z - c.z) <= rad;
    const playerUp = this.state.alive && !this.state.downed;
    const mates = this.coop ? this.coop.teammates(this.mates) : this.mates;
    f.inZone = false;
    f.contested = false;
    if (r > 0) {
      f.inZone = playerUp && near(p.x, p.z, r);
      for (const m of mates) if (m.up && near(m.x, m.z, r)) f.inZone = true;
      if (!f.inZone && obj?.kind === "defend") for (const s of this.agents.squad) if (s !== this.vip && s.alive && near(s.position.x, s.position.z, r)) f.inZone = true;
      if (obj?.kind === "defend") {
        // Contested: more hostiles inside than defenders (and at least three).
        let n = 0;
        let team = playerUp && near(p.x, p.z, r) ? 1 : 0;
        for (const a of this.agents.active) if (a.alive && near(a.position.x, a.position.z, r)) n++;
        for (const s of this.agents.squad) if (s.alive && near(s.position.x, s.position.z, r)) team++;
        for (const m of mates) if (m.up && near(m.x, m.z, r)) team++;
        f.contested = n >= 3 && n > team;
      }
    }
    f.interacting = this.prompt.startsWith("HOLD [F] P") || this.prompt.startsWith("HOLD [F] F") ? this.ctx.input.isDown("KeyF") : false;
    // A teammate holding interact at the objective counts too.
    if (!f.interacting && r > 0) for (const m of mates) if (m.up && m.interact && near(m.x, m.z, INTERACT_RANGE + 0.8)) f.interacting = true;
    const vip = this.vip;
    const escorting = this.vipActive && vip !== null && this.director.state.stage !== "captive";
    f.vipAlive = escorting && vip!.alive;
    f.vipDead = escorting && (vip!.state === "dead" || vip!.state === "inactive");
    f.vipAtGoal = false;
    if (escorting && obj?.kind === "escort") f.vipAtGoal = Math.hypot(vip!.position.x - obj.to.x, vip!.position.z - obj.to.z) <= obj.radius;
    f.heliLanded = this.helis.transport.landed;
    f.allAboard = false;
    if (obj?.kind === "extract") {
      // Everyone still standing has to be at the LZ (and at least one of you).
      let aboard = playerUp ? near(p.x, p.z, obj.radius) : true;
      let anyUp = playerUp;
      for (const m of mates) {
        if (!m.up) continue;
        anyUp = true;
        if (!near(m.x, m.z, obj.radius)) aboard = false;
      }
      f.allAboard = anyUp && aboard && (!escorting || (vip!.alive && near(vip!.position.x, vip!.position.z, obj.radius + 2)));
    }
    f.teamWiped = this.coop
      ? this.coop.teamWiped()
      : this.wiped || (this.state.downed && this.state.selfRevives === 0 && !this.agents.squad.some((s) => s !== this.vip && s.alive));
  }

  private interactions(dt: number) {
    const ctx = this.ctx;
    const p = ctx.player.position;
    const input = ctx.input;
    this.prompt = "";
    this.promptProgress = -1;
    if (this.ended || this.state.downed) {
      this.botReviveTarget = null;
      return;
    }

    // Co-op: revive a downed teammate (the host resolves it).
    const coopPrompt = this.coop?.interact(dt, input.isDown("KeyF"));
    if (coopPrompt) {
      this.prompt = coopPrompt.prompt;
      this.promptProgress = coopPrompt.progress;
      return;
    }

    // Revive a downed squadmate / the VIP (hold F).
    let downed: Agent | null = null;
    for (const s of this.agents.squad) {
      if (s.state !== "downed" || (s === this.vip && this.director.state.stage === "captive")) continue;
      if (Math.hypot(s.position.x - p.x, s.position.z - p.z) < BOT_REVIVE_RANGE) downed = s;
    }
    if (downed) {
      if (input.isDown("KeyF")) {
        this.botReviveTarget = downed;
        downed.reviveProgress += dt / BOT_REVIVE_TIME;
        if (downed.reviveProgress >= 1) {
          downed.reviveProgress = 0;
          downed.state = "follow";
          downed.health = downed.maxHealth * 0.5;
          downed.model.revive();
          this.botReviveTarget = null;
          ctx.sfx.cash();
        }
      } else {
        this.botReviveTarget = null;
        downed.reviveProgress = Math.max(0, downed.reviveProgress - dt);
      }
      this.prompt = `HOLD [F] REVIVE ${downed.name.toUpperCase()}  (${Math.ceil(downed.bleed)}s)`;
      this.promptProgress = downed.reviveProgress;
      return;
    }
    this.botReviveTarget = null;

    // Ammo crates: hold [F] to refill (per-crate cooldown).
    for (const a of this.ammo) {
      if (a.ready > this.seconds || Math.hypot(a.x - p.x, a.z - p.z) > INTERACT_RANGE + 0.4) {
        a.hold = 0;
        continue;
      }
      a.hold = input.isDown("KeyF") ? a.hold + dt / RESUPPLY_TIME : 0;
      if (a.hold >= 1) {
        a.hold = 0;
        a.ready = this.seconds + RESUPPLY_COOLDOWN;
        ctx.weapons.refillAmmo(1);
        ctx.grenades.count = Math.max(ctx.grenades.count, this.loadout.operator.grenades + 1);
        ctx.sfx.cash();
        this.shud.showBanner("RESUPPLIED", "", 1.2, "#9be070");
        return;
      }
      this.prompt = "HOLD [F] RESUPPLY AMMO";
      this.promptProgress = a.hold;
      return;
    }

    const obj = this.director.objective;
    const stage = this.director.state.stage;
    if (obj?.kind === "destroy" && (stage === "idle" || stage === "planting")) {
      if (Math.hypot(obj.at.x - p.x, obj.at.z - p.z) < INTERACT_RANGE) {
        this.prompt = `HOLD [F] PLANT CHARGE ON ${obj.label}`;
        this.promptProgress = Math.max(0, this.director.holdProgress);
      }
    } else if (obj?.kind === "escort" && stage === "captive") {
      if (Math.hypot(obj.vip.x - p.x, obj.vip.z - p.z) < INTERACT_RANGE) {
        this.prompt = `HOLD [F] FREE ${obj.vip.name.toUpperCase()}`;
        this.promptProgress = Math.max(0, this.director.holdProgress);
      }
    } else if (obj?.kind === "destroy" && stage === "armed") {
      const d = Math.hypot(obj.at.x - p.x, obj.at.z - p.z);
      if (d < obj.safeRadius) this.prompt = "CHARGE ARMED — GET CLEAR";
    }
  }

  // ---------------------------------------------------------------------------
  // Spawning
  // ---------------------------------------------------------------------------

  private floorAt(x: number, z: number) {
    const cell = this.nav.nearestWalkable(x, z);
    return cell >= 0 ? this.nav.floor[cell] : 0;
  }

  private snap(x: number, z: number, out: THREE.Vector3) {
    const cell = this.nav.nearestWalkable(x, z);
    if (cell >= 0) out.set(this.nav.cx(cell), this.nav.floor[cell], this.nav.cz(cell));
    else out.set(x, 0, z);
    return out;
  }

  private spawnEnemy(type: EnemyType, x: number, z: number, elite: boolean, y?: number) {
    if (this.ended) return;
    // Perched spawns (tower / roof snipers) keep their authored height.
    const at = y === undefined ? this.snap(x, z, this.tmp) : this.tmp.set(x, y, z);
    const p = this.ctx.player.position;
    const yaw = Math.atan2(-(p.x - at.x), -(p.z - at.z));
    const m = this.scale;
    const E = WAVES.elite;
    if (elite) this.agents.spawnEnemy(type, at, yaw, this.diff.enemyHealth * m * E.health, this.diff.enemyDamage * m * E.damage, this.diff.accuracy * E.accuracy, true);
    else this.agents.spawnEnemy(type, at, yaw, this.diff.enemyHealth * m, this.diff.enemyDamage * m, this.diff.accuracy);
  }

  private launchAir(a: AirScript) {
    const R = AIR.entryRadius;
    const b = a.bearing ?? Math.random() * Math.PI * 2;
    const h = this.helis.launch({
      entry: { x: a.orbit.x + Math.cos(b) * R, z: a.orbit.z + Math.sin(b) * R },
      exit: { x: a.orbit.x - Math.cos(b + 0.6) * R, z: a.orbit.z - Math.sin(b + 0.6) * R },
      insert: a.insert,
      orbit: { x: a.orbit.x, z: a.orbit.z, radius: a.orbit.radius, altitude: AIR.altitude, seconds: a.orbit.seconds },
      health: Math.round(1900 * this.diff.enemyHealth * this.scale),
      damageMul: this.diff.enemyDamage * this.scale,
    });
    if (!h) return false;
    this.shud.showBanner("GUNSHIP INBOUND", "SHOOT IT DOWN — AIM FOR THE COCKPIT", 2.6, "#ffb46a");
    this.publish({ type: "air" });
    return true;
  }

  private deployTrooper(at: THREE.Vector3) {
    if (this.ended) return false;
    this.spawnEnemy("rifleman", at.x, at.z, false);
    return true;
  }

  private spawnTeamAt(p: Point, yaw: number) {
    const at = this.snap(p.x, p.z, this.tmp2);
    this.ctx.player.spawn(at, yaw);
    if (this.agents.squad.length) this.agents.restoreSquad(this.ctx.player.position);
    // restoreSquad also wakes the VIP: put them back where the script wants them.
    if (this.vip) {
      if (!this.vipActive) this.vip.deactivate();
      else if (this.director.state.stage === "captive") this.placeCaptive();
    }
  }

  private prepareVip(at: Point & { name: string }) {
    if (!this.vip) {
      this.vip = this.agents.addSquadmate(2, { uniform: 0x8a8e94, vest: 0x5b6670, helmet: 0x3c4148, accent: 0xd8d2c4 }, { name: at.name, health: VIP_HEALTH, unarmed: true });
    }
    this.vipActive = true;
    this.placeCaptive();
  }

  private placeCaptive() {
    const obj = this.director.objective;
    const vip = this.vip;
    if (!vip || obj?.kind !== "escort") return;
    const at = this.snap(obj.vip.x, obj.vip.z, this.tmp);
    vip.spawn(at, 0, 1);
    vip.state = "downed";
    vip.health = 0;
    vip.bleed = 99;
  }

  // ---------------------------------------------------------------------------
  // Objective props
  // ---------------------------------------------------------------------------

  private buildProps() {
    const crateGeo = new THREE.BoxGeometry(1.6, 1.0, 1.1).translate(0, 0.5, 0);
    const lidGeo = new THREE.BoxGeometry(1.0, 0.5, 0.8).translate(0.1, 1.25, 0);
    const chargeGeo = new THREE.BoxGeometry(0.34, 0.2, 0.12);
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x4f5638, roughness: 0.8 });
    const lidMat = new THREE.MeshStandardMaterial({ color: 0x2c2f2a, roughness: 0.6, metalness: 0.4 });
    const chargeMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, emissive: 0xff2a10, emissiveIntensity: 0 });
    this.propGeos.push(crateGeo, lidGeo, chargeGeo);
    this.propMats.push(crateMat, lidMat, chargeMat);
    for (const o of this.def.objectives) {
      if (o.kind !== "destroy") continue;
      const g = new THREE.Group();
      g.add(new THREE.Mesh(crateGeo, crateMat), new THREE.Mesh(lidGeo, lidMat));
      const charge = new THREE.Mesh(chargeGeo, chargeMat);
      charge.position.set(0, 0.6, 0.6);
      charge.visible = false;
      g.add(charge);
      g.position.set(o.at.x, this.floorAt(o.at.x, o.at.z), o.at.z);
      g.rotation.y = Math.atan2(o.at.x, o.at.z);
      for (const c of g.children) c.castShadow = c.receiveShadow = true;
      this.props.add(g);
      this.targets.push({ def: o, mesh: g, charge });
    }
  }

  private updateProps(dt: number) {
    const obj = this.director.objective;
    const stage = this.director.state.stage;
    // Armed charge blinks faster as the fuse runs out.
    for (const t of this.targets) {
      const armed = t.def === obj && stage === "armed";
      t.charge.visible = armed || (t.def === obj && stage === "planting");
      if (armed) {
        const fuse = this.director.state.timer;
        this.blink += dt * (fuse < 2.5 ? 9 : 3.5);
        (t.charge.material as THREE.MeshStandardMaterial).emissiveIntensity = Math.sin(this.blink * Math.PI * 2) > 0 ? 3 : 0;
      }
    }
    // Coloured smoke on the LZ while the bird is coming.
    if (obj?.kind === "extract" && stage !== "aboard") {
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0) {
        this.smokeTimer = 0.12;
        const y = this.floorAt(obj.at.x, obj.at.z);
        this.ctx.effects.smoke.spawn(obj.at.x, y + 0.2, obj.at.z, (Math.random() - 0.5) * 0.6, 1.4 + Math.random(), (Math.random() - 0.5) * 0.6, 0.55, 0.32, 0.7, 4.5, 0.6, 3.4, 0.55, -0.05, 0.4);
      }
    }
  }

  private detonate(def: Extract<ObjectiveDef, { kind: "destroy" }>) {
    const at = this.detonateFx(def);
    this.agents.explode(at, CHARGE_RADIUS, CHARGE_DAMAGE);
    this.selfBlast(at, def.safeRadius, CHARGE_DAMAGE * 0.4);
    this.publish({ type: "detonate", index: this.def.objectives.indexOf(def) });
  }

  /** The blast's look and sound (everyone); damage is the host's. */
  private detonateFx(def: Extract<ObjectiveDef, { kind: "destroy" }>) {
    const ctx = this.ctx;
    const t = this.targets.find((x) => x.def === def);
    const at = this.tmp.set(def.at.x, this.floorAt(def.at.x, def.at.z) + 0.6, def.at.z);
    if (t) t.mesh.visible = false;
    ctx.effects.explosion(at);
    this.tmp2.set(at.x + 0.8, at.y + 0.4, at.z - 0.5);
    ctx.effects.explosion(this.tmp2);
    ctx.sfx.explosion(at, at.distanceTo(ctx.camera.position));
    ctx.shake.add(Math.max(0.15, 0.8 * (1 - at.distanceTo(ctx.camera.position) / 40)));
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2, v = 4 + Math.random() * 7;
      ctx.effects.debris.spawn(at.x, at.y + 0.5, at.z, Math.cos(a) * v, 5 + Math.random() * 8, Math.sin(a) * v, 0.18, 0.16, 0.13, 2.4, 0.14, 0.1, 1, 14, 0.2);
    }
    return at;
  }

  private selfBlast(at: THREE.Vector3, radius: number, maxDamage: number) {
    const p = this.ctx.player;
    this.tmp2.set(p.position.x, p.position.y + 0.9, p.position.z);
    const from = this.wp.copy(at);
    from.y += 0.35;
    const d = this.tmp2.distanceTo(from);
    if (d < radius && this.ctx.map.collision.lineOfSight(from, this.tmp2)) this.playerHit(maxDamage * Math.pow(1 - d / radius, 1.15), at);
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  private onRadio(line: RadioLine) {
    this.mhud.radio(line.speaker, line.text);
    this.publish({ type: "radio", speaker: line.speaker, text: line.text });
  }

  private onEnemyKilled(k: KillInfo) {
    const ctx = this.ctx;
    if (this.coop?.killCredit(k)) {
      // A teammate's kill (already in the killfeed): it still counts for the squad's mission tally.
      this.director.credit("kill");
      if (k.part === "head" && !k.source) this.director.credit("headshot");
      return;
    }
    const def = ENEMIES[k.agent.spec.role as EnemyType];
    let weaponName: string = ctx.weapons.active.def.name;
    let killer = ctx.callsign;
    if (k.source === "ai") {
      killer = this.agents.squad.find((s) => s.target === k.agent)?.name ?? "Squad";
      weaponName = "VK-7";
    } else {
      this.kills[def.type] = (this.kills[def.type] ?? 0) + 1;
      this.director.credit("kill");
      if (k.source === "melee") {
        weaponName = MELEE.name;
        this.meleeKills++;
      } else if (k.source === "grenade") {
        weaponName = GRENADE.name;
        this.grenadeKills++;
      } else if (k.part === "head") this.director.credit("headshot");
    }
    ctx.hud.killfeed(killer, weaponName, def.name, k.part === "head");
    if (def.type === "warden") {
      this.shud.showBanner("WARDEN DOWN", "", 3, "#ffc845");
      ctx.shake.add(0.2);
    }
  }

  private onHeliDestroyed(h: AttackHelicopter, source: string) {
    this.director.credit("gunship");
    const by = this.coop?.creditSlot ?? -1;
    if (by >= 0) {
      this.ctx.hud.killfeed(this.coop!.creditName(by), source === "grenade" ? GRENADE.name : "", h.name, false);
      this.shud.showBanner("GUNSHIP DOWN", "", 2.6, "#ffc845");
      return;
    }
    if (source !== "ai") this.kills.Gunship = (this.kills.Gunship ?? 0) + 1;
    this.ctx.hud.killfeed(source === "ai" ? "Squad" : this.ctx.callsign, source === "grenade" ? GRENADE.name : this.ctx.weapons.active.def.name, h.name, false);
    this.shud.showBanner("GUNSHIP DOWN", "", 2.6, "#ffc845");
  }

  private onHeliCrash(at: THREE.Vector3) {
    const d = at.distanceTo(this.ctx.camera.position);
    this.ctx.shake.add(Math.max(0, 0.7 * (1 - d / 45)));
    if (this.isClient) {
      this.shud.showBanner("GUNSHIP DOWN", "", 2.6, "#ffc845");
      return;
    }
    this.agents.explode(at, AIR.crashRadius, AIR.crashDamage);
    const p = this.ctx.player.position;
    const pd = Math.hypot(p.x - at.x, p.z - at.z);
    if (pd < AIR.crashRadius) this.playerHit(AIR.crashDamage * 0.5 * (1 - pd / AIR.crashRadius), at);
  }

  private playerHit(amount: number, from: THREE.Vector3) {
    if (this.ended || this.wiped || this.isClient) return;
    const ctx = this.ctx;
    const wasDowned = this.state.downed;
    const before = this.state.health + this.state.armor;
    const r = this.state.damage(amount);
    const taken = before - (this.state.health + this.state.armor);
    if (taken <= 0) return;
    const p = ctx.player;
    const dx = from.x - p.position.x, dz = from.z - p.position.z;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    const angle = Math.hypot(dx, dz) > 0.5 ? Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz) : null;
    ctx.hud.hurt(taken, angle);
    ctx.sfx.hurt(taken > 20);
    ctx.shake.add(Math.min(0.22, taken / 90));
    if (r.downed && !wasDowned) this.onLocalDowned();
  }

  private onLocalDowned() {
    const ctx = this.ctx;
    ctx.sfx.downed();
    ctx.weapons.forceSlot(1);
    ctx.weapons.lockSlot = 1;
    ctx.player.downed = true;
    ctx.hud.killfeed("Hostiles", "", ctx.callsign, false);
    if (!this.isClient) this.director.credit("down");
  }

  private onPlayerRevived() {
    if (this.selfReviving) this.state.selfRevives = Math.max(0, this.state.selfRevives - 1);
    this.selfReviving = false;
    this.ctx.player.downed = false;
    this.ctx.weapons.lockSlot = -1;
    this.shud.showBanner("BACK IN THE FIGHT", "", 1.6, "#9be070");
  }

  private restoreCheckpoint(index: number, reason: string) {
    const ctx = this.ctx;
    this.agents.clear();
    this.helis.clear();
    this.wiped = false;
    this.state.reset(this.loadout.maxHealth, this.loadout.operator.startArmor);
    ctx.player.downed = false;
    ctx.weapons.lockSlot = -1;
    ctx.weapons.refillAmmo(1);
    // Objectives from the checkpoint on get their props back.
    for (const t of this.targets) {
      const i = this.def.objectives.indexOf(t.def);
      if (i >= index) t.mesh.visible = true;
    }
    // VIP: captive again if we roll back to (or before) the rescue.
    const esc = this.def.objectives.findIndex((o) => o.kind === "escort");
    if (esc >= 0 && index <= esc) this.vipActive = false;
    // Respawn at the objective's authored checkpoint, else the previous objective's position.
    const cp = this.def.objectives[index]?.checkpoint;
    let p: Point = cp ?? this.def.start;
    let yaw = cp?.yaw ?? this.def.start.yaw;
    for (let i = index - 1; !cp && i >= 0; i--) {
      const o = this.def.objectives[i];
      const at = "to" in o ? o.to : "at" in o ? o.at : null;
      if (at) {
        p = at;
        const next = this.def.objectives[index];
        const nt = next && ("at" in next ? next.at : "vip" in next ? next.vip : null);
        yaw = nt ? Math.atan2(-(nt.x - p.x), -(nt.z - p.z)) : yaw;
        break;
      }
    }
    const [ox, oz] = this.coop?.spawnOffset ?? [0, 0];
    this.spawnTeamAt({ x: p.x + ox, z: p.z + oz }, yaw);
    // Co-op: the whole squad redeploys at the checkpoint.
    this.coop?.respawnTeam(p.x, p.z, false);
    if (this.vipActive && this.vip) {
      // Escort already done: the VIP comes back with the team.
      this.snap(p.x + 1.5, p.z + 1.5, this.tmp);
      this.vip.spawn(this.tmp, yaw, 1);
      this.vip.state = "follow";
    }
    ctx.grenades.count = Math.max(ctx.grenades.count, this.loadout.operator.grenades + 1);
    for (const a of this.ammo) a.ready = 0;
    this.shud.showBanner(reason, `RETRYING FROM CHECKPOINT  ·  ${this.director.state.retries} / ${this.director.maxRetries}`, 3, "#ff8a6a");
    this.publish({ type: "retry", index });
  }

  end(victory: boolean) {
    if (this.ended) return;
    this.ended = true;
    this.endTimer = victory ? 6 : 3;
    this.helis.recallAll();
    if (this.isClient) this.helis.recallAll();
    this.result = scoreMission(this.def, this.director.state, this.diff.reward, this.config.difficulty);
    if (victory) this.shud.showBanner("MISSION COMPLETE", `${this.def.codename}  ·  ${"★".repeat(this.result.stars)}${"☆".repeat(3 - this.result.stars)}  ·  ${clock(this.result.seconds)}`, 5, "#9be070");
    else this.shud.showBanner("MISSION FAILED", this.director.state.failReason, 4, "#ff5a4a");
    this.publish({ type: "end", victory });
  }

  /** Final score card (null until the mission ends). */
  get missionResult() {
    return this.result;
  }

  summary(): MatchSummary {
    const s = this.ctx.weapons.stats;
    const r = this.result ?? scoreMission(this.def, this.director.state, this.diff.reward, this.config.difficulty);
    return {
      mode: "mission",
      victory: r.victory,
      wavesSurvived: r.objectivesDone,
      startWave: 1,
      waveTarget: r.objectivesTotal,
      kills: s.kills + this.grenadeKills,
      headshots: r.headshots,
      meleeKills: this.meleeKills,
      grenadeKills: this.grenadeKills,
      shotsFired: s.shotsFired,
      shotsHit: s.shotsHit,
      damageDealt: Math.round(s.damage),
      damageTaken: Math.round(this.state.damageTaken),
      timesDowned: this.state.timesDowned,
      moneyEarned: 0,
      seconds: Math.round(this.seconds),
      operator: this.loadout.operator.name,
      difficulty: this.diff.name,
      killsByType: { ...this.kills },
      map: this.ctx.map.def.name,
      mission: r,
    };
  }

  // ---------------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------------

  private drawHud(dt: number) {
    const ctx = this.ctx;
    const rows = this.teamRows;
    rows.length = 0;
    rows.push({
      name: `${ctx.callsign} · ${this.loadout.operator.name}`,
      health: this.state.health,
      max: this.state.maxHealth,
      status: this.state.downed ? `DOWN ${Math.ceil(this.state.bleed)}s` : "",
      you: true,
    });
    this.coop?.teamRows(rows);
    for (const s of this.agents.squad) {
      if (s === this.vip && !this.vipActive) continue;
      const captive = s === this.vip && this.director.state.stage === "captive";
      rows.push({
        name: s === this.vip ? `${s.name} · VIP` : s.name,
        health: s.health,
        max: s.maxHealth,
        status: captive ? "CAPTIVE" : s.state === "downed" ? `DOWN ${Math.ceil(s.bleed)}s` : s.state === "dead" || s.state === "inactive" ? "KIA" : s.state === "revive" ? "REVIVING" : "",
      });
    }
    let boss: { name: string; frac: number } | null = null;
    for (const a of this.agents.active) if (a.spec.role === "warden" && a.alive) boss = { name: a.name, frac: a.health / a.maxHealth };
    if (!boss) for (const h of this.helis.helis) if (h.targetable) boss = { name: h.name.toUpperCase(), frac: h.health / h.maxHealth };

    this.drawObjectiveStatus();
    this.drawClock();
    const r = this.objectivePoint(this.director.objective, this.wp);
    const obj = this.director.objective;
    const label = !obj ? "" : obj.kind === "destroy" ? obj.label : obj.kind === "escort" ? (this.director.state.stage === "captive" ? obj.vip.name.toUpperCase() : "LZ") : obj.kind === "extract" ? "EXTRACT" : obj.kind === "defend" ? "DEFEND" : "OBJECTIVE";
    if (r > 0) this.wp.y += 1.6;
    const w = ctx.container.clientWidth, h = ctx.container.clientHeight;
    this.mhud.frame(dt, ctx.camera, w, h, r > 0 && !this.ended ? this.wp : null, label, ctx.player.position);

    const sw = this.state.selfRevives > 0;
    this.shud.frame(
      {
        wave: 0, waveTarget: 0, phase: "mission", remaining: 0, timer: 0, money: 0,
        team: rows,
        prompt: this.prompt,
        promptProgress: this.promptProgress,
        downed: this.state.downed,
        bleed: this.state.bleed,
        bleedMax: PLAYER.bleedOut,
        reviveProgress: this.state.revive,
        downedHint: this.selfReviving
          ? "SECOND WIND…"
          : this.agents.reviver
            ? `${this.agents.reviver.name.toUpperCase()} IS REVIVING YOU`
            : sw
              ? "HOLD [F] — SECOND WIND  ·  SIDEARM STILL WORKS"
              : this.agents.squad.some((s) => s !== this.vip && s.alive) || this.coop?.teammatesUp
                ? "HOLD ON — YOUR SQUAD IS COMING  ·  SIDEARM STILL WORKS"
                : "NO ONE LEFT TO REVIVE YOU",
        boss,
      },
      dt,
      ctx.camera,
      w,
      h,
    );
  }

  /** Rebuilds the status line only when what it shows changes. */
  private drawObjectiveStatus() {
    const s = this.director.state;
    const obj = this.director.objective;
    const hostiles = this.facts.hostiles;
    const tsec = Math.max(0, Math.ceil(s.timer));
    const stageCode = s.stage === "armed" ? 1 : s.stage === "planting" ? 2 : s.stage === "following" ? 3 : s.stage === "landed" ? 4 : s.stage === "captive" ? 5 : 0;
    const vipHp = this.vip && this.vipActive ? Math.ceil((this.vip.health / this.vip.maxHealth) * 10) : 0;
    const key = (s.phase === "active" ? 1 : 2) + s.objective * 4 + stageCode * 64 + tsec * 512 + Math.min(hostiles, 99) * 512 * 1024 + (this.facts.contested ? 1 << 27 : 0) + vipHp * (1 << 28);
    const frac = obj?.kind === "defend" || (obj?.kind === "destroy" && s.stage === "armed") ? s.progress : -1;
    if (key === this.statusKey) {
      this.mhud.progress(this.lastStatus, frac);
      return;
    }
    this.statusKey = key;
    const mmss = `${Math.floor(tsec / 60)}:${String(tsec % 60).padStart(2, "0")}`;
    const left = hostiles > 0 ? `${hostiles} HOSTILE${hostiles === 1 ? "" : "S"}` : "AREA CLEAR";
    let txt = "";
    if (s.phase === "complete") txt = `<span style="color:#9be070">MISSION COMPLETE</span>`;
    else if (s.phase === "failed") txt = `<span style="color:#ff5a4a">MISSION FAILED</span>`;
    else if (!obj) txt = "";
    else if (obj.kind === "defend") txt = this.facts.contested ? `<span style="color:#ff7a5a">CONTESTED</span> · ${mmss}` : `HOLD ${mmss} · ${left}`;
    else if (obj.kind === "destroy") txt = s.stage === "armed" ? `<span style="color:#ff7a5a">DETONATION ${mmss}</span> · GET CLEAR` : s.stage === "done" ? left : `PLANT THE CHARGE · ${left}`;
    else if (obj.kind === "escort") txt = s.stage === "captive" ? `FREE ${obj.vip.name.toUpperCase()} · ${left}` : `${obj.vip.name.toUpperCase()} ${vipHp * 10}% · ${left}`;
    else if (obj.kind === "eliminate") txt = hostiles + s.pending > 0 ? `${hostiles + s.pending} HOSTILES LEFT` : "AREA CLEAR";
    else if (obj.kind === "extract") txt = s.stage === "landed" ? "BIRD ON THE GROUND · GET ABOARD" : `BIRD INBOUND · ${left}`;
    else txt = left;
    this.lastStatus = txt;
    this.mhud.progress(txt, frac);
  }
  private lastStatus = "";

  /** Run clock and the next star target (whole seconds only). */
  private drawClock() {
    const s = this.director.state;
    const sec = Math.floor(s.elapsed);
    if (sec === this.clockSec && s.phase === this.clockPhase) return;
    this.clockSec = sec;
    this.clockPhase = s.phase;
    const t = this.stars;
    const next = sec <= t.three ? `★★★ ${clock(t.three)}` : sec <= t.two ? `★★ ${clock(t.two)}` : "★";
    this.mhud.clock(s.phase === "briefing" ? "" : `${clock(sec)}  ·  ${next}  ·  RETRIES ${s.retries}/${this.director.maxRetries}`);
  }
  private clockSec = -1;
  private clockPhase = "";

  dispose() {
    this.coop?.dispose();
    this.mhud.dispose();
    this.shud.dispose();
    this.helis.dispose();
    this.agents.dispose();
    this.ctx.scene.remove(this.props);
    for (const g of this.propGeos) g.dispose();
    for (const m of this.propMats) m.dispose();
    disposeHumanoidCache();
  }
}
