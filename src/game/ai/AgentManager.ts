import * as THREE from "three";
import { trackBlob } from "../render/BlobShadows";
import type { HitPart } from "../core/types";
import type { EffectsPool } from "../effects/EffectsPool";
import type { Sfx } from "../audio/Sfx";
import type { CollisionWorld } from "../world/Collision";
import { ENEMIES, SQUAD, type EnemyType } from "../survival/config";
import { Agent, type AgentSpec } from "./Agent";
import { attachJuggernautArmor, disposeJuggernautArmor } from "./heavy/JuggernautArmor";
import { tickStagger } from "./heavy/Juggernaut";
import type { CoverPoint, NavGrid } from "./NavGrid";
import type { Combatant } from "./types";

const THINK_INTERVAL = 0.2;
const MAX_SEARCHES_PER_FRAME = 3;
/** And at most this much A* time per frame (ms): big maps make single searches expensive. */
const MAX_SEARCH_MS_PER_FRAME = 1.5;
const BODY_RADIUS = 0.32;

export type KillInfo = { agent: Agent; part: HitPart; source: string };
export type AgentEvents = {
  /** An enemy died. source: "" = player gun/knife, "grenade", "ai" (squad bot). */
  onEnemyKilled(info: KillInfo): void;
  /** Squad bot or enemy damaged by a non-gun source (for damage numbers). */
  onAgentDamaged(agent: Agent, amount: number, part: HitPart, killed: boolean, source: string): void;
  onSquadDowned(agent: Agent): void;
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * AI director for every soldier on the field: pooled enemies by type and the
 * friendly squad. Thinks at 5 Hz per agent (staggered), moves and animates
 * every frame, budgets A* searches, picks cover, and resolves AI gunfire with
 * an accuracy model (distance, target movement/stance, warm-up, flinch).
 */
export class AgentManager {
  readonly active: Agent[] = [];
  readonly squad: Agent[] = [];
  private readonly pools = new Map<string, Agent[]>();
  private readonly lasers = new Map<Agent, THREE.Mesh>();
  private nextId = 1;
  private time = 0;
  /** A* time spent this frame (ms). */
  private searchMs = 0;
  /** Squad bot currently reviving the player, if any. */
  reviver: Agent | null = null;
  /** Running squad revive progress for the player (0..1 handled by PlayerState). */
  playerTargets: Combatant[] = [];
  /** [coop] Host only: remote human players the AI can target, and a shot counter for snapshots. Null in solo. */
  net: { targets: Combatant[]; onShot(ag: Agent): void } | null = null;
  /** Extra hostiles the squad can shoot at (e.g. attack helicopters). */
  extraHostiles: Combatant[] = [];
  /**
   * Optional per-enemy brain run before combat thinking (5 Hz). Return true
   * when it handled the agent this tick (stealth missions: unaware guards on
   * patrol). Return false to let the normal combat AI think.
   */
  brain: ((ag: Agent) => boolean) | null = null;
  /** Seconds a corpse stays before it's pooled (Infinity: bodies stay until clear()). */
  corpseTime = 4.6;
  /**
   * Enemies that lost sight keep homing on the team's real position (Survival
   * pressure). False: they go to where they last saw / heard you and search.
   */
  trackUnseen = true;

  private readonly laserGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
  private readonly laserMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.3, 0.2), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });

  // Scratch (no allocations in the loop).
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly c = new THREE.Vector3();
  private readonly d = new THREE.Vector3();
  private readonly e = new THREE.Vector3();
  private readonly feet = new THREE.Vector3();
  private readonly enemyList: Combatant[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: CollisionWorld,
    readonly nav: NavGrid,
    private readonly effects: EffectsPool,
    private readonly sfx: Sfx,
    private readonly player: Combatant,
    private readonly listener: THREE.Vector3,
    private readonly events: AgentEvents,
  ) {}

  // ---------------------------------------------------------------------------
  // Spawning / pooling
  // ---------------------------------------------------------------------------

  prewarm(type: EnemyType, n: number) {
    const pool = this.pool(type);
    while (pool.length < n) pool.push(this.create(type));
  }

  spawnEnemy(type: EnemyType, at: THREE.Vector3, yaw: number, healthMul: number, damageMul: number, accuracyMul: number, elite = false) {
    const pool = this.pool(type);
    const agent = pool.pop() ?? this.create(type);
    agent.spawn(at, yaw, healthMul, elite);
    agent.damageMul = damageMul;
    agent.accuracyMul = accuracyMul;
    if (type === "sniper") agent.state = "perch";
    this.active.push(agent);
    return agent;
  }

  /**
   * Friendly bot that follows the player. `opts.unarmed` makes a non-combatant
   * (escort / rescue VIP): it follows and can be downed and revived, but never shoots.
   */
  addSquadmate(
    index: number,
    colors: { uniform: number; vest: number; helmet: number; accent: number },
    opts: { name?: string; health?: number; unarmed?: boolean } = {},
  ) {
    const spec: AgentSpec = {
      role: "squad", name: opts.name ?? SQUAD.names[index] ?? `Squad ${index + 1}`, team: "player",
      health: opts.health ?? SQUAD.health, bodyArmor: 1, speed: SQUAD.speed, runSpeed: SQUAD.runSpeed, range: [4, 40],
      weapon: opts.unarmed ? { ...SQUAD.weapon, damage: 0, range: 0 } : SQUAD.weapon, coverBias: 0, flinch: 0,
      look: { ...colors, skin: 0xb08a6a, kit: "standard", scale: 1 },
    };
    const agent = new Agent(spec, this.nextId++);
    trackBlob(agent.model.root, { radius: 0.45 });
    agent.onDamage = (ag, amount, part, killed) => {
      this.events.onAgentDamaged(ag, amount, part, killed, "ai");
      if (killed) this.events.onSquadDowned(ag);
    };
    this.scene.add(agent.model.root);
    this.squad.push(agent);
    return agent;
  }

  /** Revive + heal the whole squad near the player (wave start). */
  restoreSquad(around: THREE.Vector3) {
    this.squad.forEach((s, i) => {
      const ang = (i / Math.max(1, this.squad.length)) * Math.PI * 2 + 0.6;
      this.a.set(around.x + Math.cos(ang) * 2.5, 0, around.z + Math.sin(ang) * 2.5);
      const cell = this.nav.nearestWalkable(this.a.x, this.a.z);
      if (cell >= 0) this.a.set(this.nav.cx(cell), this.nav.floor[cell], this.nav.cz(cell));
      if (s.state === "inactive" || s.state === "dead" || s.state === "downed") {
        s.spawn(this.a, 0, 1);
      } else s.health = s.maxHealth;
      s.state = "follow";
      s.model.revive();
    });
  }

  private pool(type: string) {
    let p = this.pools.get(type);
    if (!p) this.pools.set(type, (p = []));
    return p;
  }

  private create(type: EnemyType) {
    const def = ENEMIES[type];
    const spec: AgentSpec = {
      role: type, name: def.name, team: "enemy", health: def.health, bodyArmor: def.bodyArmor,
      speed: def.speed, runSpeed: def.runSpeed, range: def.range, weapon: def.weapon,
      coverBias: def.coverBias, flinch: def.flinch,
      look: { ...def.colors, kit: def.kit, scale: def.scale },
      suppress: def.suppress, stagger: def.stagger,
    };
    const agent = new Agent(spec, this.nextId++);
    trackBlob(agent.model.root, { radius: 0.45 });
    if (type === "armored") attachJuggernautArmor(agent.model);
    agent.onDamage = (ag, amount, part, killed) => {
      const src = ag.lastHitSource;
      if (src) this.events.onAgentDamaged(ag, amount, part, killed, src);
      if (killed) this.events.onEnemyKilled({ agent: ag, part, source: src });
    };
    this.scene.add(agent.model.root);
    if (type === "sniper") {
      const laser = new THREE.Mesh(this.laserGeo, this.laserMat);
      laser.visible = false;
      laser.frustumCulled = false;
      this.scene.add(laser);
      this.lasers.set(agent, laser);
    }
    return agent;
  }

  get enemiesAlive() {
    let n = 0;
    for (const a of this.active) if (a.alive) n++;
    return n;
  }

  /** Raycast list for the player's weapon: live enemy hitboxes only. */
  hitboxes(out: THREE.Object3D[]) {
    for (const a of this.active) {
      if (!a.alive) continue;
      const h = a.model.hitboxes;
      for (let i = 0; i < h.length; i++) out.push(h[i]);
    }
  }

  /** Remove everything (match reset). */
  clear() {
    for (const a of this.active) {
      a.deactivate();
      this.pool(a.spec.role).push(a);
      const l = this.lasers.get(a);
      if (l) l.visible = false;
    }
    this.active.length = 0;
    for (const s of this.squad) s.deactivate();
  }

  /**
   * Radial damage with line-of-sight occlusion. Hits enemies only (no
   * friendly fire on bots). Returns the number of kills.
   */
  explode(at: THREE.Vector3, radius: number, maxDamage: number) {
    let kills = 0;
    this.a.copy(at);
    this.a.y += 0.35;
    for (const ag of this.active) {
      if (!ag.alive) continue;
      ag.aimPoint(this.b);
      const dist = this.a.distanceTo(this.b);
      if (dist > radius) continue;
      if (!this.world.lineOfSight(this.a, this.b)) continue;
      const dmg = maxDamage * Math.pow(1 - dist / radius, 1.15);
      const res = ag.applyDamage(dmg, "body", at, "grenade");
      if (res.killed) kills++;
    }
    return kills;
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  update(dt: number) {
    this.time += dt;
    this.nav.searches = 0;
    this.searchMs = 0;
    this.reviver = null;

    for (let i = this.active.length - 1; i >= 0; i--) {
      const ag = this.active[i];
      if (ag.state === "dead") {
        ag.deathTimer += dt;
        ag.model.update(dt, 0, false, 0, false);
        ag.model.root.position.x = ag.position.x;
        ag.model.root.position.z = ag.position.z;
        const laser = this.lasers.get(ag);
        if (laser) laser.visible = false;
        if (ag.deathTimer > this.corpseTime) {
          ag.deactivate();
          this.active.splice(i, 1);
          this.pool(ag.spec.role).push(ag);
        }
        continue;
      }
      this.tickAgent(ag, dt);
    }
    for (const s of this.squad) {
      if (s.state === "inactive") continue;
      if (s.state === "dead") continue;
      this.tickAgent(s, dt);
    }
  }

  private tickAgent(ag: Agent, dt: number) {
    ag.stateTime += dt;
    ag.sinceHit += dt;
    ag.sinceDamage += dt;
    ag.flinchTimer = Math.max(0, ag.flinchTimer - dt);
    ag.seenTimer += dt;
    if (ag.spec.stagger) tickStagger(ag, dt);

    if (ag.state === "downed") {
      ag.bleed -= dt;
      ag.velocity.set(0, 0, 0);
      ag.model.update(dt, 0, false, 0, false, true);
      this.syncModel(ag);
      if (ag.bleed <= 0) {
        ag.state = "dead";
        ag.model.root.visible = false;
      }
      return;
    }

    // Squad regen.
    if (ag.team === "player" && ag.sinceDamage > SQUAD.regenDelay && ag.health < ag.maxHealth) {
      ag.health = Math.min(ag.maxHealth, ag.health + SQUAD.regenRate * dt);
    }

    ag.thinkTimer -= dt;
    if (ag.thinkTimer <= 0) {
      ag.thinkTimer += THINK_INTERVAL;
      if (ag.team === "enemy") this.thinkEnemy(ag);
      else this.thinkSquad(ag);
    }

    this.act(ag, dt);
  }

  // ---------------------------------------------------------------------------
  // Perception
  // ---------------------------------------------------------------------------

  private canSee(ag: Agent, target: Combatant) {
    if (ag.blindTimer > 0) return false;
    ag.eye(this.a);
    target.aimPoint(this.b);
    if (this.obscured?.(this.a, this.b)) return false;
    return this.world.lineOfSight(this.a, this.b);
  }

  /** Smoke (or any obscurant) between two points: set by the game mode from GrenadeSystem. */
  obscured: ((a: THREE.Vector3, b: THREE.Vector3) => boolean) | null = null;

  /**
   * M84 stun: every agent with a clear line to the burst is blinded, longer
   * when close and facing it. Returns how many were caught.
   */
  flashbang(at: THREE.Vector3, radius: number, maxBlind: number) {
    let caught = 0;
    this.a.copy(at);
    this.a.y += 0.25;
    for (const ag of this.active) {
      if (!ag.alive) continue;
      ag.eye(this.b);
      const dist = this.a.distanceTo(this.b);
      if (dist > radius || !this.world.lineOfSight(this.a, this.b)) continue;
      const fx = Math.sin(ag.yaw), fz = Math.cos(ag.yaw);
      const facing = ((this.a.x - this.b.x) * fx + (this.a.z - this.b.z) * fz) / Math.max(0.01, Math.hypot(this.a.x - this.b.x, this.a.z - this.b.z));
      const t = maxBlind * (1 - dist / radius) * (0.45 + 0.55 * Math.max(0, facing)) + (dist < 3 ? 1 : 0);
      if (t <= 0.2) continue;
      ag.blindTimer = Math.max(ag.blindTimer, t);
      ag.hasLos = false;
      ag.flinchTimer = Math.max(ag.flinchTimer, 0.5);
      caught++;
    }
    return caught;
  }

  private hostilesOf(ag: Agent) {
    const list = this.enemyList;
    list.length = 0;
    if (ag.team === "enemy") {
      if (this.player.targetable) list.push(this.player);
      for (const s of this.squad) if (s.targetable) list.push(s);
      if (this.net) for (const r of this.net.targets) if (r.targetable) list.push(r); // [coop]
    } else {
      for (const e of this.active) if (e.alive) list.push(e);
      for (const e of this.extraHostiles) if (e.targetable) list.push(e);
    }
    return list;
  }

  /** Nearest visible hostile (player weighted as more attractive), else nearest known. */
  private acquire(ag: Agent) {
    const list = this.hostilesOf(ag);
    let best: Combatant | null = null;
    let bestScore = Infinity;
    let nearest: Combatant | null = null;
    let nearestD = Infinity;
    let checks = 0;
    const range = ag.spec.weapon.range * 1.1;
    for (const t of list) {
      const d = t.position.distanceTo(ag.position);
      const score = d * (t.isPlayer ? 0.75 : 1) * (t === ag.target ? 0.85 : 1);
      if (score < nearestD) {
        nearestD = score;
        nearest = t;
      }
      if (d > range || score >= bestScore || checks > 6) continue;
      checks++;
      if (this.canSee(ag, t)) {
        best = t;
        bestScore = score;
      }
    }
    if (best) {
      ag.target = best;
      ag.hasLos = true;
      ag.seenTimer = 0;
      ag.lastSeen.copy(best.position);
    } else {
      ag.hasLos = false;
      // Enemies are "directed" toward the team even without sight.
      ag.target = ag.team === "enemy" ? nearest : ag.target && ag.target.targetable ? ag.target : null;
      if (ag.target && ag.team === "enemy" && ag.seenTimer > 2 && this.trackUnseen) ag.lastSeen.copy(ag.target.position);
    }
  }

  // ---------------------------------------------------------------------------
  // Decisions
  // ---------------------------------------------------------------------------

  private thinkEnemy(ag: Agent) {
    if (this.brain?.(ag)) return;
    this.acquire(ag);
    const t = ag.target;
    const role = ag.spec.role;
    if (!t) {
      ag.state = role === "sniper" ? "perch" : "advance";
      return;
    }
    const dist = t.position.distanceTo(ag.position);
    const [near, far] = ag.spec.range;

    if (role === "sniper") {
      ag.state = "perch";
      return;
    }
    if (ag.anchored) {
      // Rooted on a perch: shoot when there's a line, otherwise wait.
      this.setState(ag, ag.hasLos ? "engage" : "advance");
      return;
    }

    if (role === "rusher" || role === "armored" || role === "warden") {
      // Relentless: keep closing; shoot on the move.
      if (dist > near || !ag.hasLos) this.setState(ag, "advance");
      else this.setState(ag, "engage");
      // The Warden enrages at half health.
      if (role === "warden" && ag.health < ag.maxHealth * 0.5) ag.damageMul = Math.max(ag.damageMul, 1.35);
      return;
    }

    // Rifleman: advance → engage → cover/peek cycles.
    switch (ag.state) {
      case "advance":
        if (ag.hasLos && dist < far) this.setState(ag, "engage");
        break;
      case "engage":
        if (!ag.hasLos && ag.seenTimer > 1.8) this.setState(ag, "advance");
        else if (dist > far * 1.25) this.setState(ag, "advance");
        else if (ag.sinceHit < 0.4 && Math.random() < ag.spec.coverBias) this.tryCover(ag);
        else if (ag.stateTime > 3 && Math.random() < ag.spec.coverBias * 0.25) this.tryCover(ag);
        break;
      case "toCover":
        if (!ag.cover) this.setState(ag, "engage");
        else if (dist < 5) this.leaveCover(ag);
        break;
      case "inCover": {
        if (!ag.cover) {
          this.setState(ag, "engage");
          break;
        }
        // Flanked (they can see us while hiding) or too close → move.
        if ((ag.coverPhase === "hide" && ag.hasLos && ag.crouched && ag.stateTime > 0.6) || dist < 5) this.leaveCover(ag);
        else if (ag.stateTime > 11) this.leaveCover(ag);
        break;
      }
      default:
        this.setState(ag, "advance");
    }
  }

  private thinkSquad(ag: Agent) {
    const p = this.player;
    if (ag.spec.weapon.damage === 0) {
      // Non-combatant (VIP): just stick with the player.
      ag.target = null;
      ag.hasLos = false;
      if (ag.state !== "follow") this.setState(ag, "follow");
      return;
    }
    // Revive the player if downed (bots are brave).
    if (!p.targetable && (p as unknown as { downed?: boolean }).downed) {
      this.setState(ag, "revive");
      this.acquire(ag);
      return;
    }
    if (ag.state === "revive") this.setState(ag, "follow");
    this.acquire(ag);
    if (ag.target && ag.hasLos) {
      if (ag.state !== "engage") this.setState(ag, "engage");
    } else if (ag.state !== "follow") this.setState(ag, "follow");
  }

  private setState(ag: Agent, s: Agent["state"]) {
    if (ag.state === s) return;
    if (ag.state === "inCover" || ag.state === "toCover") {
      if (s !== "inCover" && s !== "toCover") {
        ag.release();
        ag.crouched = false;
      }
    }
    ag.state = s;
    ag.stateTime = 0;
    ag.repathTimer = 0;
  }

  private leaveCover(ag: Agent) {
    ag.release();
    ag.crouched = false;
    this.setState(ag, ag.hasLos ? "engage" : "advance");
  }

  /** Find a nearby unclaimed spot that hides us from the threat but lets us peek. */
  private tryCover(ag: Agent) {
    const t = ag.target;
    if (!t) return;
    t.aimPoint(this.c);
    const threat = this.c;
    let best: CoverPoint | null = null;
    let bestScore = Infinity;
    let tested = 0;
    for (const cp of this.nav.cover) {
      if (cp.claimed > 0) continue;
      const dx = cp.x - ag.position.x, dz = cp.z - ag.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 14) continue;
      const tx = cp.x - threat.x, tz = cp.z - threat.z;
      const td = Math.hypot(tx, tz);
      if (td < 6) continue;
      // The obstacle must sit between us and the threat (normal faces away).
      if ((cp.nx * tx + cp.nz * tz) / td < 0.35) continue;
      const score = d + Math.abs(td - 16) * 0.3;
      if (score >= bestScore) continue;
      if (tested++ > 12) break;
      this.a.set(cp.x, cp.y + 0.95, cp.z);
      if (this.world.lineOfSight(threat, this.a)) continue; // not actually hidden
      best = cp;
      bestScore = score;
    }
    if (!best) return;
    ag.release();
    ag.cover = best;
    best.claimed++;
    this.setState(ag, "toCover");
    this.goTo(ag, best.x, best.z);
  }

  // ---------------------------------------------------------------------------
  // Action (every frame)
  // ---------------------------------------------------------------------------

  private act(ag: Agent, dt: number) {
    const t = ag.target;
    const role = ag.spec.role;
    let speed = 0;
    let wantFire = false;
    let faceTarget = false;
    ag.crouched = ag.state === "inCover" ? ag.coverPhase === "hide" : false;

    switch (ag.state) {
      case "advance": {
        const run = role === "rusher" || (ag.seenTimer > 3 && role === "rifleman");
        speed = run ? ag.spec.runSpeed : ag.spec.speed;
        if (t) {
          ag.repathTimer -= dt;
          const moved = ag.goal.distanceToSquared(ag.lastSeen) > 9;
          if (ag.repathTimer <= 0 || (moved && ag.repathTimer < 0.6) || ag.pathLen === 0) this.goTo(ag, ag.lastSeen.x, ag.lastSeen.z, role === "rusher" ? 0.6 : 1.4);
          if (ag.hasLos) {
            wantFire = role !== "rifleman" || ag.seenTimer < 0.5;
            faceTarget = wantFire;
          }
        }
        break;
      }
      case "engage": {
        faceTarget = true;
        wantFire = true;
        // Light strafing so they're not statues.
        if (ag.team === "enemy" && role === "rifleman") {
          speed = ag.spec.speed * 0.35;
          if (ag.pathLen === 0 || ag.pathIdx >= ag.pathLen || ag.repathTimer <= 0) {
            ag.repathTimer = rand(1.4, 2.6);
            const side = Math.random() < 0.5 ? -1 : 1;
            const yaw = ag.yaw + (Math.PI / 2) * side;
            const sx = ag.position.x + Math.sin(yaw) * 2.5, sz = ag.position.z + Math.cos(yaw) * 2.5;
            if (this.nav.isWalkable(sx, sz)) this.goTo(ag, sx, sz, 99);
          }
          ag.repathTimer -= dt;
        } else if (ag.team === "player") {
          speed = this.followSpeed(ag, dt) * 0.6;
        } else if (role === "warden" || role === "armored") {
          speed = 0;
        }
        break;
      }
      case "toCover": {
        speed = ag.spec.runSpeed;
        if (ag.cover && Math.hypot(ag.cover.x - ag.position.x, ag.cover.z - ag.position.z) < 0.6) {
          ag.state = "inCover";
          ag.stateTime = 0;
          ag.coverPhase = "hide";
          ag.coverTimer = rand(1.1, 2.4);
          ag.pathLen = 0;
        }
        wantFire = ag.hasLos && ag.sinceHit > 0.3;
        faceTarget = wantFire;
        break;
      }
      case "inCover": {
        ag.coverTimer -= dt;
        if (ag.coverTimer <= 0) {
          ag.coverPhase = ag.coverPhase === "hide" ? "peek" : "hide";
          ag.coverTimer = ag.coverPhase === "peek" ? rand(1.4, 2.6) : rand(1.0, 2.2);
        }
        faceTarget = true;
        wantFire = ag.coverPhase === "peek";
        break;
      }
      case "perch": {
        faceTarget = ag.hasLos;
        this.sniperAim(ag, dt);
        break;
      }
      case "follow": {
        speed = this.followSpeed(ag, dt);
        break;
      }
      case "patrol": {
        speed = ag.pathIdx < ag.pathLen ? ag.patrolSpeed : 0;
        break;
      }
      case "revive": {
        const p = this.player.position;
        const d = Math.hypot(p.x - ag.position.x, p.z - ag.position.z);
        if (d > 1.3) {
          speed = ag.spec.runSpeed;
          ag.repathTimer -= dt;
          if (ag.repathTimer <= 0 || ag.pathLen === 0) this.goTo(ag, p.x, p.z, 1);
        } else {
          ag.pathLen = 0;
          ag.crouched = true;
          this.reviver = ag;
        }
        // Return fire if something is right on top of us.
        wantFire = ag.hasLos && ag.target !== null && ag.target.position.distanceTo(ag.position) < 8;
        faceTarget = wantFire;
        break;
      }
    }

    if (ag.flinchTimer > 0) speed *= 0.25;
    // Flashbanged: stumble about, can't aim.
    if (ag.blindTimer > 0) {
      ag.blindTimer = Math.max(0, ag.blindTimer - dt);
      speed *= 0.35;
      wantFire = false;
      faceTarget = false;
    }
    // Staggered heavy: rooted, weapon off target.
    const staggered = ag.staggerTimer > 0;
    if (staggered) {
      speed = 0;
      wantFire = false;
    }
    // Suppression: a heavy that just lost sight keeps raking the spot it last saw you.
    const suppressing =
      !staggered && !!ag.spec.suppress && ag.team === "enemy" && t !== null && !ag.hasLos && ag.seenTimer > 0.25 && ag.seenTimer < ag.spec.suppress;

    // ---- Facing -----------------------------------------------------------
    let desiredYaw = ag.yaw;
    if (suppressing) {
      desiredYaw = Math.atan2(ag.lastSeen.x - ag.position.x, ag.lastSeen.z - ag.position.z);
      ag.aimPitch *= 1 - Math.min(1, dt * 4);
    } else if (faceTarget && t) {
      desiredYaw = Math.atan2(t.position.x - ag.position.x, t.position.z - ag.position.z);
      t.aimPoint(this.b);
      ag.eye(this.a);
      const h = Math.hypot(this.b.x - this.a.x, this.b.z - this.a.z);
      ag.aimPitch += (Math.atan2(this.b.y - this.a.y, h) - ag.aimPitch) * Math.min(1, dt * 8);
    } else {
      ag.aimPitch *= 1 - Math.min(1, dt * 4);
      if (ag.state === "patrol" && !Number.isNaN(ag.lookYaw) && (speed === 0 || ag.moveSpeed < 0.4)) desiredYaw = ag.lookYaw;
      else if (ag.moveSpeed > 0.5) desiredYaw = Math.atan2(ag.velocity.x, ag.velocity.z);
    }
    let dy = desiredYaw - ag.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    // Calm guards turn their heads at a walking pace; combat snaps.
    const turn = (ag.state === "patrol" ? 2.6 : ag.spec.role === "warden" || ag.spec.role === "armored" ? 3.5 : 7) * dt;
    ag.yaw += THREE.MathUtils.clamp(dy, -turn, turn);

    // ---- Move -----------------------------------------------------------------
    this.move(ag, speed, dt);

    // ---- Fire -------------------------------------------------------------
    if (wantFire && t && ag.hasLos && Math.abs(dy) < 0.4) {
      ag.engageTime += dt;
      this.trigger(ag, dt, false);
    } else if (suppressing && Math.abs(dy) < 0.5) {
      this.trigger(ag, dt, true);
    } else {
      ag.engageTime = Math.max(0, ag.engageTime - dt * 2);
      if (ag.burstLeft > 0 && !wantFire) ag.burstLeft = 0;
      ag.pauseTimer = Math.max(ag.pauseTimer - dt, 0);
    }

    ag.model.update(dt, ag.moveSpeed, ag.crouched, ag.aimPitch, faceTarget || wantFire || suppressing);
    this.syncModel(ag);
  }

  private followSpeed(ag: Agent, dt: number) {
    const p = this.player.position;
    const idx = this.squad.indexOf(ag);
    const yaw = (this.player as unknown as { yaw?: number }).yaw ?? 0;
    const side = idx % 2 === 0 ? -1 : 1;
    // Slot behind-left / behind-right of the player.
    const ang = yaw + Math.PI + side * 0.7;
    const sx = p.x + Math.sin(ang) * 4, sz = p.z + Math.cos(ang) * 4;
    const d = Math.hypot(sx - ag.position.x, sz - ag.position.z);
    ag.repathTimer -= dt;
    if (d < 2.2) {
      ag.pathLen = 0;
      return 0;
    }
    if (ag.repathTimer <= 0 || ag.pathLen === 0 || ag.goal.distanceToSquared(this.a.set(sx, 0, sz)) > 9) this.goTo(ag, sx, sz, 1.2);
    return d > 9 ? ag.spec.runSpeed : ag.spec.speed;
  }

  /**
   * External brains (state "patrol"): path an agent to (x, z). False when the
   * search was deferred (per-frame budget / retry back-off) or found nothing.
   */
  navigate(ag: Agent, x: number, z: number) {
    this.goTo(ag, x, z, 99);
    return ag.pathLen > 0 && ag.goal.x === x && ag.goal.z === z;
  }

  private goTo(ag: Agent, x: number, z: number, repath = 1.5) {
    if (ag.anchored) return;
    // After a failed search, wait before retrying: callers re-request whenever
    // pathLen is 0, which would otherwise search every frame.
    const now = performance.now();
    if (now < ag.pathRetryAt) return;
    if (this.nav.searches >= MAX_SEARCHES_PER_FRAME || this.searchMs >= MAX_SEARCH_MS_PER_FRAME) {
      ag.repathTimer = 0.05 + Math.random() * 0.1;
      return;
    }
    ag.goal.set(x, 0, z);
    const t0 = performance.now();
    // Partial paths: an unreachable goal still gets the agent as close as the grid allows.
    ag.pathLen = this.nav.findPath(ag.position.x, ag.position.z, x, z, ag.path, 6000, true);
    this.searchMs += performance.now() - t0;
    ag.pathIdx = 0;
    ag.repathTimer = repath * (0.8 + Math.random() * 0.4);
    if (ag.pathLen === 0) ag.pathRetryAt = now + 400 + Math.random() * 300;
  }

  private move(ag: Agent, speed: number, dt: number) {
    if (ag.spec.role === "sniper" || ag.anchored) {
      ag.velocity.set(0, 0, 0);
      return;
    }
    let dx = 0, dz = 0;
    if (speed > 0 && ag.pathIdx < ag.pathLen) {
      let wx = ag.path[ag.pathIdx * 2], wz = ag.path[ag.pathIdx * 2 + 1];
      let ddx = wx - ag.position.x, ddz = wz - ag.position.z;
      let dist = Math.hypot(ddx, ddz);
      if (dist < 0.5 && ag.pathIdx < ag.pathLen - 1) {
        ag.pathIdx++;
        wx = ag.path[ag.pathIdx * 2];
        wz = ag.path[ag.pathIdx * 2 + 1];
        ddx = wx - ag.position.x;
        ddz = wz - ag.position.z;
        dist = Math.hypot(ddx, ddz);
      }
      if (dist < 0.3 && ag.pathIdx === ag.pathLen - 1) ag.pathIdx++;
      else if (dist > 1e-3) {
        dx = ddx / dist;
        dz = ddz / dist;
      }
    }

    // Separation from nearby agents.
    let sx = 0, sz = 0;
    const list = ag.team === "enemy" ? this.active : this.squad;
    for (const o of list) {
      if (o === ag || !o.alive) continue;
      const ox = ag.position.x - o.position.x, oz = ag.position.z - o.position.z;
      const d2 = ox * ox + oz * oz;
      if (d2 > 0.0001 && d2 < 0.8) {
        const d = Math.sqrt(d2);
        sx += (ox / d) * (0.9 - d);
        sz += (oz / d) * (0.9 - d);
      }
    }

    const tvx = dx * speed + sx * 3, tvz = dz * speed + sz * 3;
    const k = Math.min(1, dt * (speed > 0 ? 10 : 14));
    ag.velocity.x += (tvx - ag.velocity.x) * k;
    ag.velocity.z += (tvz - ag.velocity.z) * k;

    // Collide the upper body only; low steps are handled by the nav floor.
    const floor = this.nav.floorAt(ag.position.x, ag.position.z);
    // Vaulting: on (or about to step onto) a vault cell, lift the collider over the low obstacle.
    const sp = Math.hypot(ag.velocity.x, ag.velocity.z);
    const ahead = sp > 0.2 ? 0.55 / sp : 0;
    const vault = Math.max(this.nav.vaultAt(ag.position.x, ag.position.z), this.nav.vaultAt(ag.position.x + ag.velocity.x * ahead, ag.position.z + ag.velocity.z * ahead));
    const f = this.feet.set(ag.position.x, floor + (vault > 0 ? vault + 0.03 : 0.55), ag.position.z);
    const px = f.x, pz = f.z;
    // Doors in the way swing open (and the door system learns where bodies are).
    this.world.dynamic?.agentNear(f.x, f.z, ag.velocity.x, ag.velocity.z);
    const bodyH = vault > 0 ? 0.7 : 1.2;
    this.world.moveAxis(f, "x", ag.velocity.x * dt, BODY_RADIUS, bodyH);
    this.world.moveAxis(f, "z", ag.velocity.z * dt, BODY_RADIUS, bodyH);
    ag.position.x = f.x;
    ag.position.z = f.z;
    const moved = Math.hypot(f.x - px, f.z - pz);
    if (speed > 0.5 && moved < speed * dt * 0.2) {
      ag.stuckTimer += dt;
      if (ag.stuckTimer > 0.8) {
        ag.stuckTimer = 0;
        ag.repathTimer = 0;
        ag.pathLen = 0;
      }
    } else ag.stuckTimer = 0;
    // Over a vault cell the body rides up onto the obstacle (a quick hop), then back down.
    const target = this.nav.floorAt(ag.position.x, ag.position.z) + this.nav.vaultAt(ag.position.x, ag.position.z) * 0.85;
    ag.position.y += (target - ag.position.y) * Math.min(1, dt * 12);
  }

  private syncModel(ag: Agent) {
    const r = ag.model.root;
    r.position.x = ag.position.x;
    r.position.z = ag.position.z;
    if (!ag.model.dying) r.position.y = ag.position.y;
    r.rotation.y = ag.yaw;
  }

  // ---------------------------------------------------------------------------
  // Shooting
  // ---------------------------------------------------------------------------

  private trigger(ag: Agent, dt: number, suppress: boolean) {
    const w = ag.spec.weapon;
    if (ag.burstLeft <= 0) {
      ag.pauseTimer -= dt;
      if (ag.pauseTimer > 0) return;
      ag.burstLeft = Math.round(rand(w.burst[0], w.burst[1]));
      ag.fireTimer = 0;
    }
    ag.fireTimer -= dt;
    while (ag.fireTimer <= 0 && ag.burstLeft > 0) {
      if (suppress) this.suppressShot(ag);
      else this.shoot(ag);
      ag.burstLeft--;
      ag.fireTimer += 60 / w.rpm;
      if (ag.burstLeft === 0) ag.pauseTimer = rand(w.burstPause[0], w.burstPause[1]);
    }
  }

  private hitChance(ag: Agent, t: Combatant, dist: number) {
    const w = ag.spec.weapon;
    const sniper = ag.spec.role === "sniper";
    const distF = sniper ? THREE.MathUtils.clamp(45 / Math.max(dist, 5), 0.6, 1.1) : THREE.MathUtils.clamp(10 / Math.max(dist, 3), 0.22, 1.6);
    const moveF = 1 - Math.min(sniper ? 0.6 : 0.5, t.moveSpeed / (sniper ? 9 : 11));
    const crouchF = t.crouched ? 0.8 : 1;
    const warm = sniper ? 1 : 0.45 + 0.55 * Math.min(1, ag.engageTime / 1.4);
    const flinchF = ag.sinceHit < 0.6 ? 0.45 : 1;
    const selfMove = ag.moveSpeed > 1.2 ? 0.75 : 1;
    return THREE.MathUtils.clamp(w.accuracy * ag.accuracyMul * distF * moveF * crouchF * warm * flinchF * selfMove, 0.02, 0.93);
  }

  private shoot(ag: Agent) {
    const t = ag.target;
    if (!t || !t.targetable) return;
    const w = ag.spec.weapon;
    ag.eye(this.a);
    t.aimPoint(this.b);
    if (!this.world.lineOfSight(this.a, this.b)) {
      ag.hasLos = false;
      ag.burstLeft = 0;
      return;
    }
    const muzzle = ag.model.muzzle.getWorldPosition(this.c);
    const dist = muzzle.distanceTo(this.b);
    if (dist > w.range) return;
    ag.model.fire();
    this.net?.onShot(ag); // [coop]

    const hit = Math.random() < this.hitChance(ag, t, dist);
    const fall = THREE.MathUtils.lerp(1, w.falloff, Math.min(1, dist / w.range));
    this.d.subVectors(this.b, muzzle).normalize();
    if (hit) {
      t.takeFire(w.damage * ag.damageMul * fall, ag.position, ag);
      this.e.copy(this.b).addScaledVector(this.d, -0.2);
      this.effects.tracer(muzzle, this.e, ag.team === "enemy");
    } else {
      // Miss: a point offset around the target, carried on until it hits something.
      this.e.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).cross(this.d).normalize().multiplyScalar(rand(0.45, 1.5));
      this.e.add(this.b).sub(muzzle).normalize();
      const far = this.world.raycast(muzzle.x, muzzle.y, muzzle.z, this.e.x, this.e.y, this.e.z, 120);
      const len = Math.min(far === Infinity ? 120 : far, 120);
      const end = this.e.multiplyScalar(len).add(muzzle);
      this.effects.tracer(muzzle, end, ag.team === "enemy");
      if (far !== Infinity && far < 120) {
        this.a.copy(this.d).negate();
        this.effects.impact(end, this.a, "concrete", false);
      }
      // Near miss past the player → whizz.
      if (t.isPlayer) {
        this.closestPointOnSegment(muzzle, end, this.listener, this.a);
        if (this.a.distanceToSquared(this.listener) < 4) this.sfx.whizz(this.a);
      }
    }
    this.effects.muzzlePuff(muzzle, this.d);
    this.sfx.enemyShot(muzzle, w.heavy, muzzle.distanceTo(this.listener));
  }

  /**
   * Suppressive round at the last-seen position: tracer, impact, whizz and a
   * nudge of camera shake if it cracks past the player. Never damages (no line of sight).
   */
  private suppressShot(ag: Agent) {
    const w = ag.spec.weapon;
    const muzzle = ag.model.muzzle.getWorldPosition(this.c);
    this.b.set(ag.lastSeen.x + rand(-0.9, 0.9), ag.lastSeen.y + rand(0.5, 1.7), ag.lastSeen.z + rand(-0.9, 0.9));
    this.d.subVectors(this.b, muzzle);
    const len0 = this.d.length();
    if (len0 < 1e-3) return;
    this.d.multiplyScalar(1 / len0);
    ag.model.fire();
    const far = this.world.raycast(muzzle.x, muzzle.y, muzzle.z, this.d.x, this.d.y, this.d.z, w.range);
    const len = far === Infinity ? w.range : Math.min(far, w.range);
    this.e.copy(this.d).multiplyScalar(len).add(muzzle);
    this.effects.tracer(muzzle, this.e, true);
    if (far !== Infinity && far < w.range) {
      this.a.copy(this.d).negate();
      this.effects.impact(this.e, this.a, "concrete", Math.random() < 0.35);
    }
    this.closestPointOnSegment(muzzle, this.e, this.listener, this.a);
    if (this.a.distanceToSquared(this.listener) < 6) this.sfx.whizz(this.a);
    this.d.subVectors(this.e, muzzle).normalize();
    this.effects.muzzlePuff(muzzle, this.d);
    this.sfx.enemyShot(muzzle, w.heavy, muzzle.distanceTo(this.listener));
  }

  private closestPointOnSegment(a: THREE.Vector3, b: THREE.Vector3, p: THREE.Vector3, out: THREE.Vector3) {
    out.subVectors(b, a);
    const len2 = out.lengthSq();
    const t = len2 > 0 ? THREE.MathUtils.clamp(this.d.subVectors(p, a).dot(out) / len2, 0, 1) : 0;
    this.d.subVectors(b, a).normalize();
    return out.multiplyScalar(t).add(a);
  }

  /** Sniper: red laser telegraph for ~1.6 s before each shot. Break line of sight to dodge. */
  private sniperAim(ag: Agent, dt: number) {
    const laser = this.lasers.get(ag);
    const t = ag.target;
    const w = ag.spec.weapon;
    if (ag.pauseTimer > 0) ag.pauseTimer -= dt;
    if (!t || !ag.hasLos || ag.pauseTimer > 0) {
      ag.aimCharge = ag.aimCharge > 0 ? Math.max(0, ag.aimCharge - dt) : -1;
      if (laser) laser.visible = ag.aimCharge > 0;
      if (ag.aimCharge <= 0) {
        ag.aimCharge = -1;
        if (laser) laser.visible = false;
      }
      return;
    }
    if (ag.aimCharge < 0) ag.aimCharge = 0;
    const chargeTime = 1.6 / Math.max(0.8, ag.accuracyMul);
    ag.aimCharge += dt / chargeTime;
    if (laser) {
      const m = ag.model.muzzle.getWorldPosition(this.c);
      t.aimPoint(this.b);
      // Laser lags then locks on.
      const wobble = (1 - Math.min(1, ag.aimCharge * 1.3)) * 1.2;
      this.b.x += Math.sin(this.time * 3.1 + ag.id) * wobble;
      this.b.y += Math.sin(this.time * 2.3 + ag.id * 2) * wobble * 0.5;
      this.b.z += Math.cos(this.time * 2.7 + ag.id) * wobble;
      const len = m.distanceTo(this.b);
      laser.position.copy(m);
      laser.lookAt(this.b);
      const thick = 0.02 + ag.aimCharge * 0.025;
      laser.scale.set(thick, thick, len);
      laser.visible = true;
      this.laserMat.opacity = 0.35 + 0.4 * Math.min(1, ag.aimCharge);
    }
    if (ag.aimCharge >= 1) {
      ag.engageTime = 2;
      this.shoot(ag);
      ag.aimCharge = -1;
      ag.pauseTimer = rand(w.burstPause[0], w.burstPause[1]);
      if (laser) laser.visible = false;
    }
  }

  dispose() {
    this.laserGeo.dispose();
    this.laserMat.dispose();
    disposeJuggernautArmor();
  }
}
