import * as THREE from "three";
import type { HitPart, HitResult, Hittable } from "../core/types";
import type { AgentWeapon, EnemyDef } from "../survival/config";
import { Humanoid, type HumanoidLook } from "./Humanoid";
import type { Combatant, Team } from "./types";
import type { CoverPoint } from "./NavGrid";

export type AgentRole = EnemyDef["type"] | "squad";
export type AgentState = "inactive" | "advance" | "engage" | "toCover" | "inCover" | "perch" | "follow" | "revive" | "downed" | "dead";

export type AgentSpec = {
  role: AgentRole;
  name: string;
  team: Team;
  health: number;
  bodyArmor: number;
  speed: number;
  runSpeed: number;
  range: [number, number];
  weapon: AgentWeapon;
  coverBias: number;
  flinch: number;
  look: HumanoidLook;
};

export type DamageListener = (agent: Agent, amount: number, part: HitPart, killed: boolean, from: THREE.Vector3 | undefined) => void;

/**
 * One AI soldier (enemy or squadmate). Pure state + a Humanoid view; the
 * AgentManager drives perception, decisions and movement.
 */
export class Agent implements Hittable, Combatant {
  readonly model: Humanoid;
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  aimPitch = 0;
  health = 100;
  maxHealth = 100;
  state: AgentState = "inactive";
  /** Wave 10+ hardened variant: tougher, sharper, worth more. */
  elite = false;
  /** performance.now() before which goTo() won't retry a failed path search. */
  pathRetryAt = 0;
  /** Scaled stats for this spawn. */
  damageMul = 1;
  accuracyMul = 1;

  // Perception / decisions.
  target: Combatant | null = null;
  readonly lastSeen = new THREE.Vector3();
  seenTimer = 99;
  hasLos = false;
  thinkTimer = Math.random() * 0.2;
  engageTime = 0;
  stateTime = 0;

  // Navigation.
  readonly path = new Float32Array(64);
  pathLen = 0;
  pathIdx = 0;
  readonly goal = new THREE.Vector3();
  repathTimer = 0;
  stuckTimer = 0;
  cover: CoverPoint | null = null;
  coverPhase: "hide" | "peek" = "hide";
  coverTimer = 0;
  crouched = false;

  // Firing.
  burstLeft = 0;
  fireTimer = 0;
  pauseTimer = 0.5;
  /** Sniper telegraph (0..1 progress), -1 idle. */
  aimCharge = -1;
  flinchTimer = 0;
  sinceHit = 99;

  // Death / downed.
  deathTimer = 0;
  bleed = 0;
  reviveProgress = 0;
  sinceDamage = 99;
  killedBy: string | null = null;
  lastHitPart: HitPart = "body";
  /** Melee / explosive kill flags for rewards. */
  lastHitSource = "";

  onDamage: DamageListener | null = null;

  constructor(readonly spec: AgentSpec, readonly id: number) {
    this.model = new Humanoid(this, spec.look);
    this.model.root.visible = false;
  }

  get team() {
    return this.spec.team;
  }
  get name() {
    return this.spec.name;
  }
  get isPlayer() {
    return false;
  }
  get active() {
    return this.state !== "inactive";
  }
  get alive() {
    return this.state !== "inactive" && this.state !== "dead" && this.state !== "downed";
  }
  get targetable() {
    return this.alive;
  }
  get moveSpeed() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  aimPoint(out: THREE.Vector3) {
    return out.set(this.position.x, this.position.y + (this.crouched ? 0.85 : 1.25) * this.model.scale, this.position.z);
  }
  eye(out: THREE.Vector3) {
    return out.set(this.position.x, this.position.y + (this.crouched ? 1.05 : 1.55) * this.model.scale, this.position.z);
  }

  spawn(at: THREE.Vector3, yaw: number, healthMul: number, elite = false) {
    this.elite = elite;
    this.model.setElite(elite);
    this.position.copy(at);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.maxHealth = this.health = Math.round(this.spec.health * healthMul);
    this.state = "advance";
    this.target = null;
    this.seenTimer = 99;
    this.pathLen = this.pathIdx = 0;
    this.repathTimer = 0;
    this.cover = null;
    this.crouched = false;
    this.burstLeft = 0;
    this.pauseTimer = 0.4 + Math.random() * 0.8;
    this.aimCharge = -1;
    this.flinchTimer = 0;
    this.sinceHit = this.sinceDamage = 99;
    this.engageTime = 0;
    this.stateTime = 0;
    this.killedBy = null;
    this.model.revive();
    this.model.root.visible = true;
    this.model.root.position.copy(at);
    this.model.root.rotation.y = yaw;
  }

  /** Player bullets / knife / grenades. */
  applyDamage(amount: number, part: HitPart, from?: THREE.Vector3, source = ""): HitResult {
    if (!this.alive) return { damage: 0, killed: false, counts: false };
    const armor = part === "head" ? 1 : this.spec.bodyArmor;
    const dmg = Math.min(this.health, amount * armor);
    this.health -= amount * armor;
    this.lastHitPart = part;
    this.lastHitSource = source;
    this.sinceHit = 0;
    this.sinceDamage = 0;
    let fromBehind = false;
    if (from) {
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      fromBehind = (from.x - this.position.x) * fx + (from.z - this.position.z) * fz < 0;
    }
    const killed = this.health <= 0;
    if (killed) {
      this.health = 0;
      if (this.team === "player") {
        this.state = "downed";
        this.bleed = 40;
        this.reviveProgress = 0;
      } else {
        this.state = "dead";
        this.deathTimer = 0;
        this.model.die(fromBehind);
        this.release();
      }
    } else {
      this.model.flinch(part === "head", amount / 40, fromBehind);
      if (this.spec.flinch > 0) this.flinchTimer = Math.max(this.flinchTimer, this.spec.flinch);
    }
    this.onDamage?.(this, dmg, part, killed, from);
    return { damage: dmg, killed, counts: true };
  }

  /** AI fire (bots get shot by enemies). */
  takeFire(amount: number, from: THREE.Vector3) {
    this.applyDamage(amount, "body", from, "ai");
  }

  /** Free a claimed cover spot. */
  release() {
    if (this.cover) this.cover.claimed = Math.max(0, this.cover.claimed - 1);
    this.cover = null;
  }

  deactivate() {
    this.release();
    this.state = "inactive";
    this.model.root.visible = false;
  }
}
