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
import type { AttackHelicopter } from "../vehicles/AttackHelicopter";
import { AIR } from "../survival/airSupport";
import { getMission } from "./campaign";
import { MissionDirector, scoreMission, type DirectorHost, type MissionFacts } from "./MissionDirector";
import { MissionHUD } from "./MissionHUD";
import type { AirScript, MissionConfig, MissionDef, MissionEvent, MissionResult, MissionState, ObjectiveDef, Point, RadioLine } from "./types";

const INTERACT_RANGE = 2.3;
const BOT_REVIVE_RANGE = 2.2;
const BOT_REVIVE_TIME = 2.5;
const VIP_HEALTH = 180;
const CHARGE_RADIUS = 9;
const CHARGE_DAMAGE = 420;
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
export class MissionGameMode implements GameMode {
  readonly label = "MISSION";
  readonly def: MissionDef;
  readonly state = new PlayerState();
  readonly loadout: PlayerLoadout;
  readonly nav: NavGrid;
  readonly agents: AgentManager;
  readonly helis: HelicopterManager;
  readonly director: MissionDirector;
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

  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly wp = new THREE.Vector3();

  constructor(private readonly ctx: EngineContext, readonly config: MissionConfig) {
    const def = getMission(config.missionId);
    if (!def) throw new Error(`Unknown mission ${config.missionId}`);
    this.def = def;
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
    // Nav covers the whole map (at least the classic 100 m square).
    const navSize = Math.max(100, ctx.map.def.size);
    this.nav = new NavGrid(ctx.map.collision, -navSize / 2, -navSize / 2, navSize, navSize);
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
    for (let i = 0; i < Math.min(2, config.squad); i++) {
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
    this.spawnTeamAt(def.start, def.start.yaw);
    if (config.net?.role !== "client") this.director.start();
    this.shud.showBanner(def.title.toUpperCase(), `${def.codename}  ·  ${def.location.toUpperCase()}`, 4.2, "#f2efe6");
    this.publish({ type: "objective", index: 0, title: def.objectives[0].title });
  }

  // ---------------------------------------------------------------------------
  // Director host
  // ---------------------------------------------------------------------------

  private readonly host: DirectorHost = {
    spawn: (type, x, z, elite) => this.spawnEnemy(type, x, z, elite),
    launchAir: (air) => this.launchAir(air),
    radio: (line) => this.onRadio(line),
    objectiveStarted: (i, def, resumed) => {
      this.statusKey = -1;
      this.mhud.objective(`OBJECTIVE ${i + 1} / ${this.def.objectives.length}`, def.title, def.detail ?? "");
      if (def.kind === "escort") this.prepareVip(def.vip);
      if (i > 0 || resumed) {
        this.ctx.sfx.waveStart();
        this.shud.showBanner(resumed ? "CHECKPOINT" : "NEW OBJECTIVE", def.title, 2.8, resumed ? "#86c7ff" : "#f2efe6");
      }
      this.publish({ type: "objective", index: i, title: def.title });
    },
    objectiveDone: (i, def) => {
      this.ctx.sfx.waveClear();
      this.shud.showBanner("OBJECTIVE COMPLETE", def.title, 2.4, "#9be070");
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
      const from = def.heliFrom;
      this.helis.launchTransport({
        entry: from,
        exit: { x: -from.x, z: -from.z },
        orbit: { x: def.at.x, z: def.at.z, radius: 0, altitude: 12, seconds: 0 },
        land: def.at,
      });
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
    const reviving = this.selfReviving || this.agents.reviver !== null;
    if (!this.wiped) {
      const res = this.state.update(dt, reviving, this.selfReviving ? PLAYER.selfReviveTime : PLAYER.reviveTime);
      if (res === "revived") this.onPlayerRevived();
      else if (res === "bledout") this.wiped = true;
    }
    ctx.player.downed = this.state.downed;
    ctx.player.speedMultiplier = this.loadout.speed * ctx.weapons.active.def.mobility;
    ctx.weapons.disabled = this.ended || this.selfReviving || this.botReviveTarget !== null;
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
    if (this.vip && this.vipActive && this.director.state.stage === "captive" && this.vip.state === "downed") this.vip.bleed = 99;
    const ht = this.heliTargets;
    ht.length = 0;
    if (this.combatant.targetable) ht.push(this.combatant);
    for (const s of this.agents.squad) if (s.targetable) ht.push(s);
    this.helis.update(dt, ht);
    this.updateProps(dt);

    // ---- Script -------------------------------------------------------------------------
    this.interactions(dt);
    if (this.config.net?.role !== "client") {
      this.gatherFacts();
      this.director.update(dt, this.facts);
    }

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
    const net = this.config.net;
    if (!net || net.role === "client") return;
    net.onEvent?.(e);
    net.onState?.(this.snapshot());
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
    f.inZone = false;
    f.contested = false;
    if (r > 0) {
      f.inZone = playerUp && near(p.x, p.z, r);
      if (!f.inZone && obj?.kind === "defend") for (const s of this.agents.squad) if (s !== this.vip && s.alive && near(s.position.x, s.position.z, r)) f.inZone = true;
      if (obj?.kind === "defend") {
        // Contested: more hostiles inside than defenders (and at least three).
        let n = 0;
        let team = playerUp && near(p.x, p.z, r) ? 1 : 0;
        for (const a of this.agents.active) if (a.alive && near(a.position.x, a.position.z, r)) n++;
        for (const s of this.agents.squad) if (s.alive && near(s.position.x, s.position.z, r)) team++;
        f.contested = n >= 3 && n > team;
      }
    }
    f.interacting = this.prompt.startsWith("HOLD [F] P") || this.prompt.startsWith("HOLD [F] F") ? this.ctx.input.isDown("KeyF") : false;
    const vip = this.vip;
    const escorting = this.vipActive && vip !== null && this.director.state.stage !== "captive";
    f.vipAlive = escorting && vip!.alive;
    f.vipDead = escorting && (vip!.state === "dead" || vip!.state === "inactive");
    f.vipAtGoal = false;
    if (escorting && obj?.kind === "escort") f.vipAtGoal = Math.hypot(vip!.position.x - obj.to.x, vip!.position.z - obj.to.z) <= obj.radius;
    f.heliLanded = this.helis.transport.landed;
    f.allAboard = false;
    if (obj?.kind === "extract") {
      f.allAboard = playerUp && near(p.x, p.z, obj.radius) && (!escorting || (vip!.alive && near(vip!.position.x, vip!.position.z, obj.radius + 2)));
    }
    f.teamWiped =
      this.wiped || (this.state.downed && this.state.selfRevives === 0 && !this.agents.squad.some((s) => s !== this.vip && s.alive));
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

  private spawnEnemy(type: EnemyType, x: number, z: number, elite: boolean) {
    if (this.ended) return;
    const at = this.snap(x, z, this.tmp);
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
    this.agents.explode(at, CHARGE_RADIUS, CHARGE_DAMAGE);
    this.selfBlast(at, def.safeRadius, CHARGE_DAMAGE * 0.4);
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
    if (source !== "ai") this.kills.Gunship = (this.kills.Gunship ?? 0) + 1;
    this.ctx.hud.killfeed(source === "ai" ? "Squad" : this.ctx.callsign, source === "grenade" ? GRENADE.name : this.ctx.weapons.active.def.name, h.name, false);
    this.shud.showBanner("GUNSHIP DOWN", "", 2.6, "#ffc845");
  }

  private onHeliCrash(at: THREE.Vector3) {
    this.agents.explode(at, AIR.crashRadius, AIR.crashDamage);
    const d = at.distanceTo(this.ctx.camera.position);
    this.ctx.shake.add(Math.max(0, 0.7 * (1 - d / 45)));
    const p = this.ctx.player.position;
    const pd = Math.hypot(p.x - at.x, p.z - at.z);
    if (pd < AIR.crashRadius) this.playerHit(AIR.crashDamage * 0.5 * (1 - pd / AIR.crashRadius), at);
  }

  private playerHit(amount: number, from: THREE.Vector3) {
    if (this.ended || this.wiped) return;
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
    if (r.downed && !wasDowned) {
      ctx.sfx.downed();
      ctx.weapons.forceSlot(1);
      ctx.weapons.lockSlot = 1;
      ctx.player.downed = true;
      ctx.hud.killfeed("Hostiles", "", ctx.callsign, false);
    }
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
    // Respawn at the previous objective's position.
    let p: Point = this.def.start;
    let yaw = this.def.start.yaw;
    for (let i = index - 1; i >= 0; i--) {
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
    this.spawnTeamAt(p, yaw);
    if (this.vipActive && this.vip) {
      // Escort already done: the VIP comes back with the team.
      this.snap(p.x + 1.5, p.z + 1.5, this.tmp);
      this.vip.spawn(this.tmp, yaw, 1);
      this.vip.state = "follow";
    }
    this.shud.showBanner(reason, `RETRYING FROM CHECKPOINT  ·  ${this.director.state.retries} / 3`, 3, "#ff8a6a");
    this.publish({ type: "retry", index });
  }

  private end(victory: boolean) {
    if (this.ended) return;
    this.ended = true;
    this.endTimer = victory ? 6 : 3;
    this.helis.recallAll();
    this.result = scoreMission(this.def, this.director.state, this.diff.reward);
    if (victory) this.shud.showBanner("MISSION COMPLETE", `${this.def.codename}  ·  GRADE ${this.result.grade}`, 5, "#9be070");
    else this.shud.showBanner("MISSION FAILED", this.director.state.failReason, 4, "#ff5a4a");
    this.publish({ type: "end", victory });
  }

  /** Final score card (null until the mission ends). */
  get missionResult() {
    return this.result;
  }

  summary(): MatchSummary {
    const s = this.ctx.weapons.stats;
    const r = this.result ?? scoreMission(this.def, this.director.state, this.diff.reward);
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
              : this.agents.squad.some((s) => s !== this.vip && s.alive)
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

  dispose() {
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
