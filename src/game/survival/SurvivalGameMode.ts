import * as THREE from "three";
import type { EngineContext, GameMode, MatchSummary, Vitals } from "../core/GameMode";
import type { HitPart } from "../core/types";
import { NavGrid } from "../ai/NavGrid";
import { AgentManager, type KillInfo } from "../ai/AgentManager";
import type { Agent } from "../ai/Agent";
import type { Combatant } from "../ai/types";
import { disposeHumanoidCache } from "../ai/Humanoid";
import { SurvivalHUD, type TeamRow } from "../ui/SurvivalHUD";
import { GRENADE, MELEE, type WeaponId } from "../weapons/weapons";
import {
  DIFFICULTY, ECONOMY, ENEMIES, OPERATORS, PLAYER, WAVES,
  type DifficultyId, type EnemyType, type OperatorId, type WaveTarget,
} from "./config";
import { PlayerLoadout } from "./PlayerLoadout";
import { PlayerState } from "./PlayerState";
import { ShopSystem, Wallet, type ShopView } from "./ShopSystem";
import { WaveManager } from "./WaveManager";
import { EnemySpawner } from "./EnemySpawner";
import type { SurvivalNet } from "../net/types";
import { HelicopterManager } from "../vehicles/HelicopterManager";
import type { AttackHelicopter } from "../vehicles/AttackHelicopter";
import { AIR, composeAir, sortiePlan, type AirSortie } from "./airSupport";

export type SurvivalConfig = {
  operator: OperatorId;
  primary?: WeaponId;
  secondary?: WeaponId;
  difficulty: DifficultyId;
  waveTarget: WaveTarget;
  squad: number;
  startWave?: number;
  /** [coop] Online co-op session; absent for solo play. */
  net?: SurvivalNet;
};

const STATION_RANGE = 2.6;
const CRATE_RANGE = 2.2;
const BOT_REVIVE_RANGE = 2.2;
const BOT_REVIVE_TIME = 2.5;

/**
 * Wave-based co-op survival: the player (plus 0–2 squad bots) defends
 * Dustfall Outpost against escalating waves. Owns the AI director, wave
 * flow, economy/shop, revive rules and the survival HUD.
 */
export class SurvivalGameMode implements GameMode {
  readonly label = "SURVIVAL";
  readonly state = new PlayerState();
  readonly wallet = new Wallet();
  readonly loadout: PlayerLoadout;
  readonly shop: ShopSystem;
  readonly waves: WaveManager;
  readonly nav: NavGrid;
  readonly agents: AgentManager;
  private readonly spawner: EnemySpawner;
  private readonly shud: SurvivalHUD;
  private readonly diff: (typeof DIFFICULTY)[DifficultyId];
  private readonly perchOf = new Map<Agent, number>();
  private readonly crateUsed: boolean[];
  private readonly combatant: Combatant & { downed: boolean; yaw: number };

  shopOpen = false;
  ended = false;
  private endTimer = -1;
  private victory = false;
  private seconds = 0;
  private selfReviving = false;
  private botReviveTarget: Agent | null = null;
  private lastRewardShot = -1;
  private heartbeat = 0;
  private readonly kills: Record<string, number> = {};
  private grenadeKills = 0;
  private meleeKills = 0;
  private headshotKills = 0;
  private prompt = "";
  private promptProgress = -1;
  private readonly teamRows: TeamRow[] = [];
  private readonly net: SurvivalNet | undefined;
  readonly helis: HelicopterManager;
  /** Sorties still to launch this wave (delay counts down). */
  private readonly airQueue: AirSortie[] = [];
  private readonly heliTargets: Combatant[] = [];

  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly view = new THREE.Vector3();

  constructor(private readonly ctx: EngineContext, readonly config: SurvivalConfig) {
    const layout = ctx.map.def.survival!;
    this.net = config.net;
    this.diff = DIFFICULTY[config.difficulty];
    this.crateUsed = layout.ammoCrates.map(() => false);

    // ---- Player ----------------------------------------------------------------
    this.loadout = new PlayerLoadout(config.operator, config.primary, config.secondary);
    const op = this.loadout.operator;
    this.loadout.apply(ctx.weapons);
    ctx.weapons.infiniteSecondary = true;
    ctx.weapons.resetAmmo();
    ctx.viewmodel.setOperatorColors(op.colors.glove, op.colors.sleeve);
    ctx.viewmodel.setWeapon(ctx.weapons.active.def);
    ctx.grenades.count = op.grenades;
    ctx.grenades.maxCarry = GRENADE.maxCarry + (op.grenades > 2 ? 1 : 0);
    this.state.reset(this.loadout.maxHealth, op.startArmor);
    ctx.hud.modeLabel = "SURVIVAL";

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

    // ---- World / AI ------------------------------------------------------------
    this.nav = new NavGrid(ctx.map.collision, -50, -50, 100, 100);
    this.agents = new AgentManager(ctx.scene, ctx.map.collision, this.nav, ctx.effects, ctx.sfx, this.combatant, ctx.camera.position, {
      onEnemyKilled: (k) => this.onEnemyKilled(k),
      onAgentDamaged: (agent, amount, part, killed, source) => {
        if (source === "grenade" && agent.team === "enemy") this.shud.damageNumber(agent.aimPoint(this.tmp), amount, killed ? "kill" : "body");
      },
      onSquadDowned: (agent) => {
        ctx.hud.killfeed("Hostiles", "", agent.name, false);
        this.shud.showBanner(`${agent.name.toUpperCase()} IS DOWN`, "HOLD [F] NEXT TO THEM TO REVIVE", 2.4, "#ff8a6a");
      },
    });
    if (this.net?.role !== "client") {
      this.agents.prewarm("rifleman", 12);
      this.agents.prewarm("rusher", 4);
      this.agents.prewarm("armored", 3);
      this.agents.prewarm("sniper", 2);
    }

    const others = Object.values(OPERATORS).filter((o) => o.id !== op.id);
    // [coop] Humans replace the squad bots online.
    for (let i = 0; i < (this.net ? 0 : Math.min(2, config.squad)); i++) {
      const c = others[i].colors;
      this.agents.addSquadmate(i, { uniform: c.sleeve, vest: c.vest, helmet: c.helmet, accent: c.accent });
    }

    this.spawner = new EnemySpawner(layout, this.nav);
    this.helis = new HelicopterManager(ctx.scene, ctx.map.collision, ctx.effects, ctx.sfx, ctx.camera.position, {
      onDeploy: (_h, at) => this.deployTrooper(at),
      onDestroyed: (h, source) => this.onHeliDestroyed(h, source),
      onCrash: (_h, at) => this.onHeliCrash(at),
    });
    this.agents.extraHostiles = this.helis.airborne;
    this.waves = new WaveManager(config.waveTarget, this.diff.count, Math.min(2, config.squad), config.startWave ?? 1);
    this.shop = new ShopSystem({
      wallet: this.wallet,
      loadout: this.loadout,
      weapons: ctx.weapons,
      grenades: ctx.grenades,
      state: this.state,
      squadDown: () => this.agents.squad.filter((s) => !s.alive).length,
      reviveSquad: () => this.agents.restoreSquad(ctx.player.position),
      onLoadoutChanged: () => {
        ctx.viewmodel.setWeapon(ctx.weapons.active.def);
      },
    });
    this.shud = new SurvivalHUD(ctx.container);
    // Skipping ahead comes with the funds you'd have earned.
    if ((config.startWave ?? 1) > 1) this.wallet.money += 650 * ((config.startWave ?? 1) - 1);
    this.reset();
    this.net?.attach(this, ctx, {
      shud: this.shud,
      crateUsed: this.crateUsed,
      countKill: (type, part, source) => {
        this.kills[type] = (this.kills[type] ?? 0) + 1;
        if (source === "melee") this.meleeKills++;
        else if (source === "grenade") this.grenadeKills++;
        else if (part === "head") this.headshotKills++;
      },
    });
  }

  // ---------------------------------------------------------------------------
  // GameMode
  // ---------------------------------------------------------------------------

  reset() {
    const spawn = this.ctx.spawnPoint(this.tmp);
    this.ctx.player.spawn(this.tmp, spawn.yaw);
    if (this.agents.squad.length) this.agents.restoreSquad(this.ctx.player.position);
  }

  collectTargets(out: THREE.Object3D[]) {
    this.agents.hitboxes(out);
    this.net?.collectTargets(out);
    this.helis.hitboxes(out);
  }

  vitals(): Vitals {
    return { health: this.state.health, maxHealth: this.state.maxHealth, armor: this.state.armor };
  }

  update(dt: number, playing: boolean) {
    const ctx = this.ctx;
    ctx.camera.getWorldDirection(this.view);
    // [coop] Online matches keep simulating behind menus.
    if (!playing && !this.net) {
      this.drawHud(0);
      return;
    }
    if (!this.ended) this.seconds += dt;

    // ---- Player vitals / revive ---------------------------------------------------
    const holdingF = ctx.input.isDown("KeyF");
    this.selfReviving = this.state.downed && this.state.selfRevives > 0 && holdingF;
    const reviving = this.selfReviving || this.agents.reviver !== null || (this.net?.revivingMe() ?? false);
    // [coop] Clients mirror the host's vitals instead of simulating them.
    const res = this.net?.role === "client" ? this.net.clientVitals() : this.state.update(dt, reviving, this.selfReviving ? PLAYER.selfReviveTime : PLAYER.reviveTime);
    if (res === "revived") this.onPlayerRevived();
    else if (res === "downed") this.onPlayerDowned();
    else if (res === "bledout" && !this.net) this.end(false); // [coop] bled-out players sit out until the next wave
    ctx.player.downed = this.state.downed;
    ctx.player.speedMultiplier = this.loadout.speed * ctx.weapons.active.def.mobility;
    ctx.weapons.disabled = this.ended || this.selfReviving || this.botReviveTarget !== null || (this.net?.busy ?? false);
    ctx.grenades.disabled = this.state.downed || this.ended;

    // Low-health heartbeat.
    if (this.state.alive && this.state.health / this.state.maxHealth < 0.3) {
      this.heartbeat -= dt;
      if (this.heartbeat <= 0) {
        ctx.sfx.heartbeat();
        this.heartbeat = 0.9;
      }
    }

    // ---- Waves ------------------------------------------------------------------
    if (!this.ended && this.net?.role !== "client") this.updateWaves(dt);

    // ---- AI ---------------------------------------------------------------------
    this.agents.update(dt);
    this.net?.update(dt);
    if (this.net?.role !== "client") {
      const ht = this.heliTargets;
      ht.length = 0;
      if (this.combatant.targetable) ht.push(this.combatant);
      for (const s of this.agents.squad) if (s.targetable) ht.push(s);
      this.helis.update(dt, ht);
    }

    // ---- Team wipe ----------------------------------------------------------------
    const wiped = this.net ? this.net.teamWiped() : this.state.downed && !this.agents.squad.some((s) => s.alive) && this.state.selfRevives === 0;
    if (!this.ended && wiped) this.end(false);

    if (this.ended && this.endTimer >= 0) {
      this.endTimer -= dt;
      if (this.endTimer < 0) {
        ctx.unlock();
        ctx.emit({ type: "end", summary: this.summary() });
      }
    }

    this.interactions(dt);
    this.drawHud(dt);
  }

  onWeaponHit(part: HitPart, damage: number, killed: boolean, _name: string, source: string, shotId: number, point: THREE.Vector3) {
    const kind = killed ? "kill" : part === "head" ? "head" : "body";
    this.shud.damageNumber(point, damage, kind);
    if (!killed && shotId !== this.lastRewardShot) {
      this.lastRewardShot = shotId;
      this.wallet.add(ECONOMY.hit * this.diff.reward);
    }
    if (killed && source === MELEE.name) return "KNIFE KILL";
    if (killed && part === "head") return "HEADSHOT";
    return null;
  }

  onExplosion(at: THREE.Vector3) {
    if (this.net?.onExplosion(at)) return; // [coop] clients: the host resolves grenade damage
    this.agents.explode(at, GRENADE.radius, GRENADE.maxDamage);
    this.helis.explode(at, GRENADE.radius, GRENADE.maxDamage);
    // Self damage (with occlusion).
    const p = this.ctx.player;
    this.tmp.set(p.position.x, p.position.y + 0.9, p.position.z);
    this.tmp2.copy(at);
    this.tmp2.y += 0.35;
    const d = this.tmp.distanceTo(this.tmp2);
    if (d < GRENADE.radius && this.ctx.map.collision.lineOfSight(this.tmp2, this.tmp)) {
      this.playerHit(GRENADE.maxDamage * GRENADE.selfDamage * Math.pow(1 - d / GRENADE.radius, 1.15), at);
    }
  }

  debug(out: Record<string, string | number>) {
    out.wave = `${this.waves.wave} ${this.waves.phase} queue ${this.waves.queue.length}`;
    out.enemies = `${this.agents.enemiesAlive} alive / ${this.agents.active.length} active`;
    out.money = this.wallet.money;
    out.vitals = `${Math.round(this.state.health)}/${this.state.maxHealth} armor ${Math.round(this.state.armor)}`;
    out.nav = `${this.nav.cols}x${this.nav.rows} cover ${this.nav.cover.length}`;
    out.air = `${this.helis.hostileAlive} helis · ${this.airQueue.length} queued`;
  }

  // ---------------------------------------------------------------------------
  // Shop (called from React)
  // ---------------------------------------------------------------------------

  shopView(): ShopView {
    return this.shop.view();
  }

  buy(id: string) {
    const money = this.wallet.money;
    const r = this.shop.buy(id);
    if (r.ok) this.net?.onBuy(id, money - this.wallet.money);
    if (r.ok) this.ctx.sfx.cash();
    else this.ctx.sfx.denied();
    return r;
  }

  closeShop() {
    if (!this.shopOpen) return;
    this.shopOpen = false;
    this.ctx.emit({ type: "shop", open: false });
  }

  readyUp() {
    this.closeShop();
    if (this.net) this.net.ready();
    else this.waves.skip();
  }

  get canShop() {
    return this.waves.phase === "intermission" || this.waves.phase === "prematch";
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private updateWaves(dt: number) {
    const w = this.waves;
    const ctx = this.ctx;
    if (w.phase === "prematch" || w.phase === "intermission") {
      if (ctx.input.pressed("KeyN")) {
        if (this.net) this.net.ready();
        else w.skip();
      }
      w.timer -= dt;
      if (w.timer <= 0) {
        w.startNextWave();
        this.crateUsed.fill(false);
        this.spawner.freePerches();
        if (this.agents.squad.length) this.agents.restoreSquad(ctx.player.position);
        ctx.sfx.waveStart();
        const boss = w.queue.includes("warden");
        this.airQueue.length = 0;
        for (const s of composeAir(w.wave)) this.airQueue.push(s);
        const air = this.airQueue.length ? `  ·  ${this.airQueue.length > 1 ? "GUNSHIPS" : "GUNSHIP"} EXPECTED` : "";
        this.shud.showBanner(`WAVE ${w.wave}`, (boss ? "WARNING: THE WARDEN IS INBOUND" : `${w.total} HOSTILES INBOUND`) + air, 3, boss ? "#ff6a4a" : "#f2efe6");
        ctx.emit({ type: "phase", phase: "combat", wave: w.wave });
      }
      return;
    }
    if (w.phase !== "combat") return;

    this.updateAir(dt);

    // Spawn under the alive cap; faster trickle in later waves.
    const alive = this.agents.enemiesAlive;
    const cap = w.aliveCap(WAVES.maxAliveByQuality[ctx.quality]);
    w.spawnTimer -= dt;
    if (w.queue.length && alive < cap && w.spawnTimer <= 0) {
      const type = w.queue[w.queue.length - 1];
      const pick = this.spawner.pick(type, ctx.player.position, this.view, this.tmp);
      if (pick) {
        w.queue.pop();
        this.spawn(type, this.tmp, pick.yaw, pick.perch);
      } else if (type === "sniper") {
        // No free perch: swap for a rifleman.
        w.queue[w.queue.length - 1] = "rifleman";
      }
      const [a, b] = WAVES.spawnInterval;
      w.spawnTimer = (a + Math.random() * (b - a)) * Math.max(0.45, 1 - w.wave * 0.04);
    }

    // Re-read: a spawn this frame may have just emptied the queue.
    if (w.queue.length === 0 && this.agents.enemiesAlive === 0) {
      const bonus = this.wallet.add((ECONOMY.waveBonusBase + ECONOMY.waveBonusPerWave * w.wave) * this.diff.reward);
      this.shud.moneyPop(bonus, "WAVE BONUS");
      ctx.sfx.waveClear();
      this.helis.recallAll();
      this.airQueue.length = 0;
      this.state.heal();
      if (this.agents.squad.length) this.agents.restoreSquad(ctx.player.position);
      if (w.final) {
        this.shud.showBanner("OUTPOST HELD", `ALL ${w.target} WAVES CLEARED`, 4, "#9be070");
        this.end(true);
      } else {
        w.beginIntermission();
        this.shud.showBanner(`WAVE ${w.wave} CLEARED`, `+$${bonus}  ·  ARMORIES ONLINE`, 3, "#9be070");
        ctx.emit({ type: "phase", phase: "intermission", wave: w.wave });
      }
    }
  }

  /** Launch due helicopter sorties. */
  private updateAir(dt: number) {
    const q = this.airQueue;
    for (let i = q.length - 1; i >= 0; i--) {
      q[i].delay -= dt;
      if (q[i].delay > 0) continue;
      const s = q[i];
      // Rope in where enemies would enter (off-screen, far from the player).
      const pick = this.spawner.pick("rifleman", this.ctx.player.position, this.view, this.tmp);
      const lz = pick ? this.tmp : this.ctx.map.def.survival!.enemySpawns[0];
      const wv = Math.max(0, this.waves.wave - AIR.fromWave);
      const plan = sortiePlan(s, lz, { x: 0, z: 0 }, this.diff.enemyHealth * (1 + AIR.healthPerWave * wv), this.diff.enemyDamage * (1 + WAVES.damagePerWave * wv));
      if (this.helis.launch(plan)) {
        q.splice(i, 1);
        this.shud.showBanner("GUNSHIP INBOUND", "SHOOT IT DOWN — AIM FOR THE COCKPIT", 2.6, "#ffb46a");
      } else s.delay = 3;
    }
  }

  /** A fast-rope trooper lands: take a foot soldier from the wave's queue. */
  private deployTrooper(at: THREE.Vector3) {
    const q = this.waves.queue;
    if (this.ended || this.waves.phase !== "combat") return false;
    let i = q.lastIndexOf("rifleman");
    if (i < 0) i = q.lastIndexOf("rusher");
    if (i < 0) return false;
    const type = q[i];
    q.splice(i, 1);
    const cell = this.nav.nearestWalkable(at.x, at.z);
    if (cell >= 0) at.set(this.nav.cx(cell), this.nav.floor[cell], this.nav.cz(cell));
    this.spawn(type, at, Math.atan2(-at.x, -at.z), -1);
    return true;
  }

  private onHeliDestroyed(h: AttackHelicopter, source: string) {
    const got = this.wallet.add(AIR.reward * this.diff.reward * (source === "ai" ? ECONOMY.botKillShare : 1));
    if (source !== "ai") this.kills.Gunship = (this.kills.Gunship ?? 0) + 1;
    this.shud.moneyPop(got, "GUNSHIP");
    this.ctx.hud.killfeed(source === "ai" ? "Squad" : this.ctx.callsign, source === "grenade" ? GRENADE.name : this.ctx.weapons.active.def.name, h.name, false);
    this.shud.showBanner("GUNSHIP DOWN", `+$${got}`, 2.6, "#ffc845");
  }

  private onHeliCrash(at: THREE.Vector3) {
    this.agents.explode(at, AIR.crashRadius, AIR.crashDamage);
    const d = at.distanceTo(this.ctx.camera.position);
    this.ctx.shake.add(Math.max(0, 0.7 * (1 - d / 45)));
    const p = this.ctx.player.position;
    const pd = Math.hypot(p.x - at.x, p.z - at.z);
    if (pd < AIR.crashRadius) this.playerHit(AIR.crashDamage * 0.5 * (1 - pd / AIR.crashRadius), at);
  }

  // ---------------------------------------------------------------------------
  // Dev helpers (window.__tgf.mode in development), used for perf captures.
  // ---------------------------------------------------------------------------

  /** Spawn `n` enemies of a type at regular spawn points (bypasses the wave queue). */
  debugSpawn(type: EnemyType, n: number) {
    for (let i = 0; i < n; i++) {
      const pick = this.spawner.pick(type, this.ctx.player.position, this.view, this.tmp);
      if (pick) this.spawn(type, this.tmp, pick.yaw, pick.perch);
    }
  }

  /** Launch a gunship now (orbit seconds, troops). */
  debugHeli(orbit = 60, troops = 0) {
    this.airQueue.push({ delay: 0, troops, orbit });
  }

  private spawn(type: EnemyType, at: THREE.Vector3, yaw: number, perch: number) {
    const wv = this.waves.wave - 1;
    const healthMul = this.diff.enemyHealth * (1 + WAVES.healthPerWave * wv);
    const damageMul = this.diff.enemyDamage * (1 + WAVES.damagePerWave * wv);
    const accMul = this.diff.accuracy * (1 + WAVES.accuracyPerWave * wv);
    const E = WAVES.elite;
    const eliteChance = Math.min(E.maxChance, E.chance + E.chancePerWave * (this.waves.wave - E.fromWave));
    const elite =
      this.waves.wave >= E.fromWave && (type === "rifleman" || type === "rusher" || type === "armored") && Math.random() < eliteChance;
    const agent = elite
      ? this.agents.spawnEnemy(type, at, yaw, healthMul * E.health, damageMul * E.damage, accMul * E.accuracy, true)
      : this.agents.spawnEnemy(type, at, yaw, healthMul, damageMul, accMul);
    if (perch >= 0) this.perchOf.set(agent, perch);
  }

  private onEnemyKilled(k: KillInfo) {
    const ctx = this.ctx;
    const def = ENEMIES[k.agent.spec.role as EnemyType];
    const perch = this.perchOf.get(k.agent);
    if (perch !== undefined) {
      this.spawner.releasePerch(perch);
      this.perchOf.delete(k.agent);
    }
    this.waves.killed++;
    if (this.net?.killCredit(k)) return; // [coop] a remote player's kill, already credited
    const base = def.reward * this.diff.reward * (k.agent.elite ? WAVES.elite.reward : 1);
    let money = 0;
    let weaponName: string = ctx.weapons.active.def.name;
    let killer = ctx.callsign;
    if (k.source === "ai") {
      money = base * ECONOMY.botKillShare;
      killer = this.agents.squad.find((s) => s.target === k.agent)?.name ?? "Squad";
      weaponName = "VK-7";
    } else {
      this.kills[def.type] = (this.kills[def.type] ?? 0) + 1;
      if (k.source === "melee") {
        money = ECONOMY.meleeKill * this.diff.reward + base * 0.5;
        weaponName = MELEE.name;
        this.meleeKills++;
      } else if (k.source === "grenade") {
        money = base + 30;
        weaponName = GRENADE.name;
        this.grenadeKills++;
      } else {
        money = base + (k.part === "head" ? ECONOMY.headshotBonus : 0);
        if (k.part === "head") this.headshotKills++;
      }
    }
    const got = this.wallet.add(money);
    this.shud.moneyPop(got, k.source === "ai" ? "SQUAD KILL" : k.part === "head" && !k.source ? "HEADSHOT" : def.type === "warden" ? "BOSS" : k.agent.elite ? "ELITE" : "");
    ctx.hud.killfeed(killer, weaponName, def.name, k.part === "head");
    if (def.type === "warden") {
      this.shud.showBanner("WARDEN DOWN", `+$${got}`, 3, "#ffc845");
      ctx.shake.add(0.2);
    }
  }

  private playerHit(amount: number, from: THREE.Vector3) {
    if (this.ended) return;
    const ctx = this.ctx;
    const wasDowned = this.state.downed;
    const before = this.state.health + this.state.armor;
    const r = this.state.damage(amount);
    const taken = before - (this.state.health + this.state.armor);
    if (taken <= 0) return;
    // Direction relative to the view (0 = ahead, + = right).
    const p = ctx.player;
    const dx = from.x - p.position.x, dz = from.z - p.position.z;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    const angle = Math.hypot(dx, dz) > 0.5 ? Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz) : null;
    ctx.hud.hurt(taken, angle);
    ctx.sfx.hurt(taken > 20);
    ctx.shake.add(Math.min(0.22, taken / 90));
    if (r.downed && !wasDowned) this.onPlayerDowned();
  }

  private onPlayerDowned() {
    const ctx = this.ctx;
    ctx.sfx.downed();
    ctx.weapons.forceSlot(1);
    ctx.weapons.lockSlot = 1;
    ctx.player.downed = true;
    ctx.hud.killfeed("Hostiles", "", ctx.callsign, false);
  }

  private onPlayerRevived() {
    const ctx = this.ctx;
    if (this.selfReviving) this.state.selfRevives = Math.max(0, this.state.selfRevives - 1);
    this.selfReviving = false;
    ctx.player.downed = false;
    ctx.weapons.lockSlot = -1;
    this.shud.showBanner("BACK IN THE FIGHT", "", 1.6, "#9be070");
  }

  private interactions(dt: number) {
    const ctx = this.ctx;
    const layout = ctx.map.def.survival!;
    const p = ctx.player.position;
    const input = ctx.input;
    this.prompt = "";
    this.promptProgress = -1;
    if (this.ended) return;

    if (this.state.downed) {
      this.botReviveTarget = null;
      return;
    }

    // Revive a downed squadmate (hold F).
    let downedBot: Agent | null = null;
    for (const s of this.agents.squad) {
      if (s.state === "downed" && Math.hypot(s.position.x - p.x, s.position.z - p.z) < BOT_REVIVE_RANGE) downedBot = s;
    }
    if (downedBot) {
      if (input.isDown("KeyF")) {
        this.botReviveTarget = downedBot;
        downedBot.reviveProgress += dt / BOT_REVIVE_TIME;
        if (downedBot.reviveProgress >= 1) {
          downedBot.reviveProgress = 0;
          downedBot.state = "follow";
          downedBot.health = downedBot.maxHealth * 0.5;
          downedBot.model.revive();
          this.botReviveTarget = null;
          ctx.sfx.cash();
        }
      } else {
        this.botReviveTarget = null;
        downedBot.reviveProgress = Math.max(0, downedBot.reviveProgress - dt);
      }
      this.prompt = `HOLD [F] REVIVE ${downedBot.name.toUpperCase()}  (${Math.ceil(downedBot.bleed)}s)`;
      this.promptProgress = downedBot.reviveProgress;
      return;
    }
    this.botReviveTarget = null;

    // [coop] Revive a downed teammate.
    const coop = this.net?.interact(dt, input.isDown("KeyF"));
    if (coop) {
      this.prompt = coop.prompt;
      this.promptProgress = coop.progress;
      return;
    }

    for (const s of layout.buyStations) {
      if (Math.hypot(s.x - p.x, s.z - p.z) > STATION_RANGE) continue;
      if (!this.canShop) {
        this.prompt = "ARMORY OFFLINE DURING WAVE";
        return;
      }
      this.prompt = `[F] OPEN ${s.name.toUpperCase()}  ·  $${this.wallet.money}`;
      if (input.pressed("KeyF")) {
        this.shopOpen = true;
        ctx.unlock();
        ctx.emit({ type: "shop", open: true });
      }
      return;
    }
    layout.ammoCrates.forEach((c, i) => {
      if (this.prompt || Math.hypot(c.x - p.x, c.z - p.z) > CRATE_RANGE) return;
      // Mid-wave (or once the free restock is used): buy a full resupply here.
      if (!this.canShop || this.crateUsed[i]) {
        const price = this.shop.ammoPrice;
        const full = ctx.weapons.slots.every((s) => s.ammo >= s.def.magSize && s.reserve >= Math.round(s.def.reserveAmmo * ctx.weapons.mods.reserve));
        this.prompt = full ? "AMMO FULL" : `[F] BUY AMMO  ·  $${price}  (YOU HAVE $${this.wallet.money})`;
        if (!full && input.pressed("KeyF")) {
          const r = this.buy("ammo");
          if (r.ok) {
            ctx.sfx.reload("magIn");
            this.shud.showBanner("RESUPPLIED", `-$${price}`, 1.2, "#ffc845");
          } else this.shud.showBanner(r.message.toUpperCase(), "", 1.2, "#ff5a4a");
        }
        return;
      }
      this.prompt = "[F] RESUPPLY AMMO (FREE)";
      if (input.pressed("KeyF")) {
        this.crateUsed[i] = true;
        ctx.weapons.refillAmmo(1);
        ctx.sfx.reload("magIn");
        this.shud.showBanner("RESUPPLIED", "", 1.2, "#ffc845");
      }
    });
  }

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
      rows.push({
        name: s.name,
        health: s.health,
        max: s.maxHealth,
        status: s.state === "downed" ? `DOWN ${Math.ceil(s.bleed)}s` : s.state === "dead" || s.state === "inactive" ? "KIA" : s.state === "revive" ? "REVIVING" : "",
      });
    }
    this.net?.teamRows(rows);
    let boss: { name: string; frac: number } | null = null;
    for (const a of this.agents.active) {
      if (a.spec.role === "warden" && a.alive) boss = { name: a.name, frac: a.health / a.maxHealth };
    }
    if (!boss) {
      for (const h of this.helis.helis) if (h.targetable) boss = { name: h.name.toUpperCase(), frac: h.health / h.maxHealth };
    }
    const sw = this.state.selfRevives > 0;
    this.shud.frame(
      {
        wave: this.waves.wave,
        waveTarget: this.waves.target,
        phase: this.waves.phase,
        remaining: this.waves.remaining(this.agents.enemiesAlive),
        timer: this.waves.timer,
        money: this.wallet.money,
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
              : this.agents.squad.some((s) => s.alive) || this.net?.teammatesUp
                ? "HOLD ON — YOUR SQUAD IS COMING  ·  SIDEARM STILL WORKS"
                : "NO ONE LEFT TO REVIVE YOU",
        boss,
      },
      dt,
      ctx.camera,
      ctx.container.clientWidth,
      ctx.container.clientHeight,
    );
  }

  /** Public for co-op: clients end when the host says so. */
  end(victory: boolean) {
    if (this.ended) return;
    this.ended = true;
    this.victory = victory;
    this.waves.phase = victory ? "victory" : "defeat";
    this.endTimer = victory ? 3 : 2.5;
    if (!victory) {
      const cleared = Math.max(0, this.waves.wave - (this.config.startWave ?? 1));
      this.shud.showBanner("MISSION FAILED", `CLEARED ${cleared} WAVE${cleared === 1 ? "" : "S"}`, 4, "#ff5a4a");
    }
  }

  summary(): MatchSummary {
    const s = this.ctx.weapons.stats;
    return {
      mode: "survival",
      victory: this.victory,
      wavesSurvived: this.victory ? this.waves.wave : Math.max(0, this.waves.wave - 1),
      startWave: this.config.startWave ?? 1,
      waveTarget: this.waves.target,
      kills: s.kills + this.grenadeKills,
      headshots: this.headshotKills,
      meleeKills: this.meleeKills,
      grenadeKills: this.grenadeKills,
      shotsFired: s.shotsFired,
      shotsHit: s.shotsHit,
      damageDealt: Math.round(s.damage),
      damageTaken: Math.round(this.state.damageTaken),
      timesDowned: this.state.timesDowned,
      moneyEarned: this.wallet.earned,
      seconds: Math.round(this.seconds),
      operator: this.loadout.operator.name,
      difficulty: this.diff.name,
      killsByType: { ...this.kills },
      map: this.ctx.map.def.name,
    };
  }

  dispose() {
    this.net?.dispose();
    this.shud.dispose();
    this.helis.dispose();
    this.agents.dispose();
    disposeHumanoidCache();
  }
}
