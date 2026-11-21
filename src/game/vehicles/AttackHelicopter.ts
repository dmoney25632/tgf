import * as THREE from "three";
import type { HitPart, HitResult, Hittable } from "../core/types";
import type { Combatant } from "../ai/types";
import type { EffectsPool } from "../effects/EffectsPool";
import type { Sfx } from "../audio/Sfx";
import type { CollisionWorld } from "../world/Collision";
import { heliAssets, MAIN_ROTOR_POS, MUZZLE_LOCAL, ROPE_POS, SKID_DROP, TAIL_ROTOR_POS, TURRET_POS, type HeliLivery } from "./heliModel";

/** Plain, serializable flight plan (also what a network host would send). */
export type HeliPlan = {
  /** Where it appears (far outside the map) and leaves to. */
  entry: { x: number; z: number };
  exit: { x: number; z: number };
  /** Optional fast-rope insertion before the gun run. */
  insert?: { x: number; z: number; troops: number };
  /** Gun-run orbit. seconds 0 = no orbit (pure transport). */
  orbit: { x: number; z: number; radius: number; altitude: number; seconds: number };
  /** Friendly transport: lands at `land` and waits (extraction). Not hittable, unarmed. */
  land?: { x: number; z: number };
  friendly?: boolean;
  health?: number;
  damageMul?: number;
};

export type HeliState = "idle" | "inbound" | "insert" | "orbit" | "egress" | "landing" | "landed" | "dying" | "wreck";

export const HELI = {
  health: 1900,
  maxSpeed: 30,
  accel: 9,
  rpm: 560,
  burst: [14, 22] as [number, number],
  burstPause: [2.0, 3.4] as [number, number],
  damage: 13,
  /** Cone half-angle (rad) of the chin gun's dispersion. */
  spread: 0.026,
  /** Visual round speed used for lead. */
  roundSpeed: 340,
  hitRadius: 0.55,
  range: 95,
  hoverAltitude: 11,
  ropeInterval: 0.85,
  /** Explosive (grenade / charge) damage multiplier. */
  explosiveMul: 2.2,
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export type HeliHooks = {
  /** Fast-rope trooper touches down at `at`; return false when none are left to send. */
  onDeploy(heli: AttackHelicopter, at: THREE.Vector3): boolean;
  /** Shot down (source "" = player gun, "grenade", "ai"). */
  onDestroyed(heli: AttackHelicopter, source: string): void;
  /** Wreck hits the ground: splash damage, shake. */
  onCrash(heli: AttackHelicopter, at: THREE.Vector3): void;
};

/**
 * One helicopter: flight model (steering + banking), scripted plan
 * (inbound → fast-rope insert → orbit gun runs → egress, or land for
 * extraction), a chin gun that leads its target with dispersion, damage,
 * and a smoking death spiral into a crash. Allocation-free per frame.
 */
export class AttackHelicopter implements Hittable, Combatant {
  readonly root = new THREE.Group();
  readonly hitboxes: THREE.Mesh[] = [];
  readonly position: THREE.Vector3;
  readonly velocity = new THREE.Vector3();
  state: HeliState = "idle";
  health = HELI.health;
  maxHealth = HELI.health;
  readonly name: string;
  readonly isPlayer = false;
  readonly crouched = false;
  damageMul = 1;

  private plan: HeliPlan | null = null;
  private readonly hull: THREE.Mesh;
  private readonly turret: THREE.Mesh;
  private readonly rotor: THREE.Mesh;
  private readonly tail: THREE.Mesh;
  private readonly disc: THREE.Mesh;
  private readonly rope: THREE.Mesh;
  private readonly muzzle = new THREE.Object3D();

  private yaw = 0;
  private pitch = 0;
  private roll = 0;
  private yawRate = 0;
  private rotorSpin = 0;
  private rotorSpeed = 1;
  private orbitAngle = 0;
  private stateTime = 0;
  private deployTimer = 0;
  private troopsLeft = 0;
  private burstLeft = 0;
  private fireTimer = 0;
  private pauseTimer = 2;
  private wreckTimer = 0;
  private smokeTimer = 0;
  /** Current gun target and its estimated velocity (for lead). */
  private target: Combatant | null = null;
  private readonly targetVel = new THREE.Vector3();
  private readonly targetPrev = new THREE.Vector3();
  private hasPrev = false;
  private retargetTimer = 0;
  lastDamageSource = "";
  /**
   * Network puppet (co-op clients): the host flies the real gunship. Hits are
   * forwarded through `remote` instead of applied, and `puppetTo` steers the
   * model to the host's pose. Null for locally simulated helicopters.
   */
  remote: ((amount: number, part: HitPart, source: string) => void) | null = null;
  private readonly puppetGoal = new THREE.Vector3();
  private puppetYaw = 0;

  // Scratch.
  private readonly goal = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly accel = new THREE.Vector3();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly c = new THREE.Vector3();
  private readonly d = new THREE.Vector3();

  constructor(
    readonly id: number,
    private readonly world: CollisionWorld,
    private readonly effects: EffectsPool,
    private readonly sfx: Sfx,
    private readonly listener: THREE.Vector3,
    private readonly hooks: HeliHooks,
    livery: HeliLivery,
  ) {
    const A = heliAssets();
    this.name = livery === "friendly" ? "Transport" : "Gunship";
    this.position = this.root.position;
    this.root.rotation.order = "YXZ";
    this.hull = new THREE.Mesh(A.hull, A.mats[livery]);
    this.hull.castShadow = true;
    this.turret = new THREE.Mesh(A.turret, A.mats[livery]);
    this.turret.position.copy(TURRET_POS);
    this.turret.rotation.order = "YXZ";
    this.muzzle.position.copy(MUZZLE_LOCAL);
    this.turret.add(this.muzzle);
    this.rotor = new THREE.Mesh(A.rotor, A.dark);
    this.rotor.position.copy(MAIN_ROTOR_POS);
    this.rotor.castShadow = true;
    this.tail = new THREE.Mesh(A.tail, A.dark);
    this.tail.position.copy(TAIL_ROTOR_POS);
    this.disc = new THREE.Mesh(A.disc, A.discMat);
    this.disc.position.copy(MAIN_ROTOR_POS);
    this.disc.position.y += 0.06;
    this.disc.renderOrder = 1;
    this.rope = new THREE.Mesh(A.rope, A.ropeMat);
    this.rope.position.copy(ROPE_POS);
    this.rope.visible = false;
    this.root.add(this.hull, this.turret, this.rotor, this.tail, this.disc, this.rope);

    // Hit proxies: fuselage, cockpit ("head" = crew), tail boom.
    const hm = new THREE.MeshBasicMaterial({ visible: false });
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, part: HitPart) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), hm);
      m.position.set(x, y, z);
      m.visible = false;
      m.userData = { hittable: this, part, surface: "metal" };
      this.root.add(m);
      this.hitboxes.push(m);
    };
    box(1.7, 1.9, 4.6, 0, 0, 0, "body");
    box(1.2, 1.3, 2.4, 0, 0.35, 2.3, "head");
    box(0.9, 1.4, 5.6, 0, 0.6, -4.8, "legs");
    box(4.0, 0.5, 1.0, 0, -0.2, 0.2, "body");
    this.root.visible = false;
  }

  get alive() {
    return this.state !== "idle" && this.state !== "dying" && this.state !== "wreck";
  }
  get team() {
    return "enemy" as const;
  }
  get targetable() {
    return this.alive && !this.plan?.friendly;
  }
  get moveSpeed() {
    return this.velocity.length();
  }
  get active() {
    return this.state !== "idle";
  }
  get friendly() {
    return !!this.plan?.friendly;
  }
  get landed() {
    return this.state === "landed";
  }
  get flightState() {
    return this.state;
  }
  /** Heading (rad), for network replication and backstab checks. */
  heading() {
    return this.yaw;
  }

  aimPoint(out: THREE.Vector3) {
    return out.copy(this.position);
  }

  launch(plan: HeliPlan) {
    this.plan = plan;
    this.maxHealth = this.health = plan.health ?? HELI.health;
    this.damageMul = plan.damageMul ?? 1;
    this.position.set(plan.entry.x, plan.orbit.altitude + 18, plan.entry.z);
    const tx = plan.insert?.x ?? plan.land?.x ?? plan.orbit.x, tz = plan.insert?.z ?? plan.land?.z ?? plan.orbit.z;
    this.yaw = Math.atan2(tx - plan.entry.x, tz - plan.entry.z);
    this.velocity.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(HELI.maxSpeed * 0.8);
    this.pitch = this.roll = this.yawRate = 0;
    this.troopsLeft = plan.insert?.troops ?? 0;
    this.orbitAngle = Math.atan2(plan.entry.z - plan.orbit.z, plan.entry.x - plan.orbit.x);
    this.burstLeft = 0;
    this.pauseTimer = 3;
    this.target = null;
    this.hasPrev = false;
    this.rotorSpeed = 1;
    this.lastDamageSource = "";
    this.setState("inbound");
    this.hull.material = heliAssets().mats[plan.friendly ? "friendly" : "hostile"];
    this.turret.material = this.hull.material;
    this.rope.visible = false;
    this.turret.visible = !plan.friendly;
    this.root.visible = true;
    this.root.rotation.set(0, this.yaw, 0);
  }

  /** Abort the plan and fly out (wave cleared, mission phase over). */
  recall() {
    if (this.state === "inbound" || this.state === "insert" || this.state === "orbit" || this.state === "landing" || this.state === "landed") {
      this.rope.visible = false;
      this.setState("egress");
    }
  }

  hide() {
    this.state = "idle";
    this.root.visible = false;
    this.rope.visible = false;
    this.plan = null;
  }

  // ---------------------------------------------------------------------------
  // Damage
  // ---------------------------------------------------------------------------

  applyDamage(amount: number, part: HitPart, _from?: THREE.Vector3, source = ""): HitResult {
    if (!this.alive || this.plan?.friendly) return { damage: 0, killed: false, counts: false };
    if (this.remote) {
      // The host decides; show the hit marker now.
      this.remote(amount, part, source);
      return { damage: amount, killed: false, counts: true };
    }
    const mul = source === "grenade" ? HELI.explosiveMul : part === "head" ? 1.25 : part === "legs" ? 0.8 : 1;
    const dmg = Math.min(this.health, amount * mul);
    this.health -= dmg;
    this.lastDamageSource = source;
    const killed = this.health <= 0;
    if (killed) {
      this.health = 0;
      this.setState("dying");
      this.yawRate = (Math.random() < 0.5 ? -1 : 1) * 1.2;
      this.rope.visible = false;
      this.hooks.onDestroyed(this, source);
    }
    return { damage: dmg, killed, counts: true };
  }

  takeFire(amount: number, from: THREE.Vector3) {
    this.applyDamage(amount * 0.6, "body", from, "ai");
  }

  /** Grenade / charge splash. */
  explode(at: THREE.Vector3, radius: number, maxDamage: number) {
    if (!this.targetable) return false;
    const d = at.distanceTo(this.position);
    if (d > radius + 2) return false;
    return this.applyDamage(maxDamage * Math.max(0.15, 1 - d / (radius + 2)), "body", at, "grenade").killed;
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  /** Co-op client: appear (if idle) and glide towards the host's pose. */
  puppetTo(x: number, y: number, z: number, yaw: number, health: number, maxHealth: number) {
    if (this.state === "idle" || this.state === "wreck") {
      this.launch({ entry: { x, z }, exit: { x, z }, orbit: { x, z, radius: 0, altitude: y, seconds: 0 }, health: maxHealth });
      this.position.set(x, y, z);
      this.yaw = yaw;
    }
    this.puppetGoal.set(x, y, z);
    this.puppetYaw = yaw;
    this.health = health;
    this.maxHealth = maxHealth;
  }

  /** Co-op client: the host's gunship went down — spiral in locally. */
  puppetKill() {
    if (!this.alive) return;
    this.health = 0;
    this.setState("dying");
    this.yawRate = (Math.random() < 0.5 ? -1 : 1) * 1.2;
    this.rope.visible = false;
  }

  update(dt: number, targets: readonly Combatant[]) {
    if (this.state === "idle" || !this.plan) return;
    if (this.remote && this.alive) {
      // Puppet: follow the host's pose, no AI, no gun.
      const k = Math.min(1, dt * 6);
      this.velocity.subVectors(this.puppetGoal, this.position).multiplyScalar(Math.min(4, 1 / Math.max(dt, 1e-3)) * k * 0.25);
      this.position.lerp(this.puppetGoal, k);
      let dy = this.puppetYaw - this.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw += dy * k;
      this.pitch += (0.08 - this.pitch) * k;
      this.roll += (-dy * 0.6 - this.roll) * k;
      this.updateVisuals(dt, false);
      return;
    }
    const plan = this.plan;
    this.stateTime += dt;
    let fire = false;
    let hover = false;
    let maxSpeed = HELI.maxSpeed;

    switch (this.state) {
      case "inbound": {
        if (plan.insert) {
          this.goal.set(plan.insert.x, HELI.hoverAltitude + 6, plan.insert.z);
          if (this.flatDist(this.goal) < 6) this.setState("insert");
        } else if (plan.land) {
          this.goal.set(plan.land.x, plan.orbit.altitude, plan.land.z);
          if (this.flatDist(this.goal) < 8) this.setState("landing");
        } else {
          this.orbitPoint(this.goal, plan);
          if (this.flatDist(this.goal) < 12) this.setState("orbit");
        }
        maxSpeed = Math.min(HELI.maxSpeed, 6 + this.flatDist(this.goal) * 0.5);
        break;
      }
      case "insert": {
        const ins = plan.insert!;
        this.goal.set(ins.x, this.groundY(ins.x, ins.z) + HELI.hoverAltitude, ins.z);
        hover = true;
        maxSpeed = 6;
        const settled = this.flatDist(this.goal) < 2.5 && Math.abs(this.position.y - this.goal.y) < 1.5;
        this.rope.visible = settled && this.troopsLeft > 0;
        if (settled) {
          const len = this.position.y - SKID_DROP + 1.6 - this.groundY(this.position.x, this.position.z);
          this.rope.scale.set(1, Math.max(1, len), 1);
          this.deployTimer -= dt;
          if (this.deployTimer <= 0 && this.troopsLeft > 0) {
            this.deployTimer = HELI.ropeInterval;
            this.a.set(this.position.x + (this.troopsLeft % 2 ? 0.75 : -0.75), 0, this.position.z);
            this.a.y = this.groundY(this.a.x, this.a.z);
            if (this.hooks.onDeploy(this, this.a)) this.troopsLeft--;
            else this.troopsLeft = 0;
          }
        }
        // Return fire while roping (door gun discipline: short bursts only).
        fire = settled;
        if ((this.troopsLeft <= 0 && this.deployTimer <= 0) || this.stateTime > 22) {
          this.rope.visible = false;
          this.setState(plan.orbit.seconds > 0 ? "orbit" : "egress");
        }
        break;
      }
      case "orbit": {
        this.orbitAngle += (HELI.maxSpeed * 0.5 * dt) / Math.max(10, plan.orbit.radius);
        this.orbitPoint(this.goal, plan);
        maxSpeed = HELI.maxSpeed * 0.6;
        fire = true;
        if (this.stateTime > plan.orbit.seconds) this.setState("egress");
        break;
      }
      case "egress": {
        this.goal.set(plan.exit.x, plan.orbit.altitude + 25, plan.exit.z);
        if (this.flatDist(this.goal) < 15 || this.stateTime > 30) {
          this.hide();
          return;
        }
        break;
      }
      case "landing": {
        const L = plan.land!;
        const gy = this.groundY(L.x, L.z);
        const above = this.flatDist(this.goal) < 3 ? 0 : 8;
        this.goal.set(L.x, gy + SKID_DROP + above, L.z);
        hover = true;
        maxSpeed = 8;
        if (this.flatDist(this.goal) < 0.8 && this.position.y - (gy + SKID_DROP) < 0.15) {
          this.position.y = gy + SKID_DROP;
          this.velocity.set(0, 0, 0);
          this.setState("landed");
        }
        break;
      }
      case "landed":
        this.rotorSpeed = 0.75;
        this.updateVisuals(dt, true);
        return;
      case "dying":
        this.updateDying(dt);
        return;
      case "wreck":
        this.wreckTimer -= dt;
        this.smokeTimer -= dt;
        if (this.smokeTimer <= 0) {
          this.smokeTimer = 0.09;
          const p = this.position;
          this.effects.smoke.spawn(p.x + rand(-1, 1), p.y + 0.5, p.z + rand(-1, 1), rand(-0.3, 0.3), 1.6, rand(-0.3, 0.3), 0.09, 0.085, 0.08, 4, 1.0, 4.5, 0.55, -0.1, 0.4);
          if (Math.random() < 0.6) this.effects.fire.spawn(p.x + rand(-0.8, 0.8), p.y + 0.3, p.z + rand(-0.8, 0.8), 0, 2.2, 0, 2.2, 1.1, 0.35, 0.5, 0.5, 0.15, 0.9, -1, 1);
        }
        if (this.wreckTimer <= 0) this.hide();
        return;
    }

    this.steer(dt, maxSpeed, hover);
    this.aimAndFire(dt, fire && !plan.friendly, targets);
    this.updateVisuals(dt, false);
  }

  private setState(s: HeliState) {
    this.state = s;
    this.stateTime = 0;
    if (s === "insert") this.deployTimer = 1.2;
  }

  private orbitPoint(out: THREE.Vector3, plan: HeliPlan) {
    const o = plan.orbit;
    return out.set(o.x + Math.cos(this.orbitAngle) * o.radius, o.altitude + Math.sin(this.stateTime * 0.7 + this.id) * 2, o.z + Math.sin(this.orbitAngle) * o.radius);
  }

  private flatDist(p: THREE.Vector3) {
    return Math.hypot(p.x - this.position.x, p.z - this.position.z);
  }

  private groundY(x: number, z: number) {
    const hit = this.world.raycast(x, 60, z, 0, -1, 0, 80);
    return hit === Infinity ? 0 : Math.max(0, 60 - hit);
  }

  /** Arrive-style steering with an acceleration cap; derives bank and pitch from it. */
  private steer(dt: number, maxSpeed: number, hover: boolean) {
    this.desired.subVectors(this.goal, this.position);
    const dist = this.desired.length();
    const speed = Math.min(maxSpeed, dist * (hover ? 0.9 : 0.6));
    if (dist > 1e-3) this.desired.multiplyScalar(speed / dist);
    else this.desired.set(0, 0, 0);
    this.accel.subVectors(this.desired, this.velocity);
    const al = this.accel.length();
    const maxA = HELI.accel * dt;
    if (al > maxA) this.accel.multiplyScalar(maxA / al);
    this.velocity.add(this.accel);
    this.position.addScaledVector(this.velocity, dt);

    // Heading: along the flight path, or toward the target on gun runs.
    const flat = Math.hypot(this.velocity.x, this.velocity.z);
    let want = this.yaw;
    if (this.target && (this.state === "orbit" || this.state === "insert")) {
      want = Math.atan2(this.target.position.x - this.position.x, this.target.position.z - this.position.z);
    } else if (flat > 2) want = Math.atan2(this.velocity.x, this.velocity.z);
    let dy = want - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += THREE.MathUtils.clamp(dy, -1.1 * dt, 1.1 * dt);

    // Accel in the body frame → nose-down pitch and bank.
    const ax = this.accel.x / Math.max(dt, 1e-4), az = this.accel.z / Math.max(dt, 1e-4);
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const fwdA = ax * sy + az * cy;
    const latA = ax * cy - az * sy;
    const fwdV = this.velocity.x * sy + this.velocity.z * cy;
    const k = Math.min(1, dt * 2.5);
    this.pitch += (THREE.MathUtils.clamp(fwdV * 0.008 + fwdA * 0.03, -0.3, 0.35) - this.pitch) * k;
    this.roll += (THREE.MathUtils.clamp(latA * 0.04 + dy * 0.4, -0.45, 0.45) - this.roll) * k;
  }

  private pickTarget(targets: readonly Combatant[]) {
    let best: Combatant | null = null;
    let bestScore = Infinity;
    for (const t of targets) {
      if (!t.targetable) continue;
      const d = t.position.distanceTo(this.position) * (t.isPlayer ? 0.7 : 1);
      if (d < bestScore) {
        bestScore = d;
        best = t;
      }
    }
    if (best !== this.target) this.hasPrev = false;
    this.target = best;
  }

  private aimAndFire(dt: number, armed: boolean, targets: readonly Combatant[]) {
    this.retargetTimer -= dt;
    if (this.retargetTimer <= 0) {
      this.retargetTimer = 0.6;
      this.pickTarget(targets);
    }
    const t = this.target;
    if (!t || !t.targetable) {
      this.burstLeft = 0;
      return;
    }
    // Track the target's velocity (smoothed) for lead.
    if (this.hasPrev && dt > 0) {
      this.a.subVectors(t.position, this.targetPrev).multiplyScalar(1 / dt);
      if (this.a.lengthSq() < 400) this.targetVel.lerp(this.a, Math.min(1, dt * 4));
    } else this.targetVel.set(0, 0, 0);
    this.targetPrev.copy(t.position);
    this.hasPrev = true;

    // Turret slews toward the lead point (in hull space).
    t.aimPoint(this.b);
    const dist = this.b.distanceTo(this.position);
    this.b.addScaledVector(this.targetVel, dist / HELI.roundSpeed);
    this.root.updateMatrixWorld();
    this.hull.worldToLocal(this.c.copy(this.b));
    this.c.sub(TURRET_POS);
    const ty = THREE.MathUtils.clamp(Math.atan2(this.c.x, this.c.z), -2, 2);
    const tp = THREE.MathUtils.clamp(-Math.atan2(this.c.y, Math.hypot(this.c.x, this.c.z)), -0.2, 1.2);
    const k = Math.min(1, dt * 5);
    this.turret.rotation.y += (ty - this.turret.rotation.y) * k;
    this.turret.rotation.x += (tp - this.turret.rotation.x) * k;
    const onTarget = Math.abs(ty - this.turret.rotation.y) < 0.12 && Math.abs(tp - this.turret.rotation.x) < 0.12;
    if (!armed || dist > HELI.range) {
      this.burstLeft = 0;
      return;
    }

    if (this.burstLeft <= 0) {
      this.pauseTimer -= dt;
      if (this.pauseTimer > 0 || !onTarget) return;
      this.muzzle.getWorldPosition(this.a);
      t.aimPoint(this.c);
      if (!this.world.lineOfSight(this.a, this.c)) {
        this.pauseTimer = 0.4;
        return;
      }
      this.burstLeft = Math.round(rand(HELI.burst[0], HELI.burst[1]) * (this.state === "insert" ? 0.5 : 1));
      this.fireTimer = 0;
    }
    this.fireTimer -= dt;
    while (this.fireTimer <= 0 && this.burstLeft > 0) {
      this.fireRound(t);
      this.burstLeft--;
      this.fireTimer += 60 / HELI.rpm;
      if (this.burstLeft === 0) this.pauseTimer = rand(HELI.burstPause[0], HELI.burstPause[1]);
    }
  }

  /** One chin-gun round: lead + dispersion, hitscan against the world, splash-free hit test on the target. */
  private fireRound(t: Combatant) {
    const muzzle = this.muzzle.getWorldPosition(this.a);
    t.aimPoint(this.b);
    const dist = this.b.distanceTo(muzzle);
    this.b.addScaledVector(this.targetVel, dist / HELI.roundSpeed);
    // Dispersion cone.
    this.d.subVectors(this.b, muzzle).normalize();
    this.c.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).cross(this.d).normalize();
    const r = Math.tan(HELI.spread) * Math.sqrt(Math.random()) * 1.6;
    this.d.addScaledVector(this.c, r).normalize();
    const far = this.world.raycast(muzzle.x, muzzle.y, muzzle.z, this.d.x, this.d.y, this.d.z, HELI.range + 30);
    const len = far === Infinity ? HELI.range + 30 : far;
    this.c.copy(this.d).multiplyScalar(len).add(muzzle);
    // Did the round pass through the target's body before hitting the world?
    t.aimPoint(this.b);
    this.b.y -= t.crouched ? 0.1 : 0.25;
    const along = this.projectAlong(muzzle, this.d, this.b);
    if (along > 0 && along < len) {
      const px = muzzle.x + this.d.x * along - this.b.x, py = muzzle.y + this.d.y * along - this.b.y, pz = muzzle.z + this.d.z * along - this.b.z;
      if (px * px + py * py * 0.35 + pz * pz < HELI.hitRadius * HELI.hitRadius) t.takeFire(HELI.damage * this.damageMul, this.position, this);
    }
    this.effects.tracer(muzzle, this.c, true);
    if (far !== Infinity) {
      this.b.copy(this.d).negate();
      this.effects.impact(this.c, this.b, "sand", Math.random() < 0.3);
    }
    // Crack past the listener.
    this.b.subVectors(this.listener, muzzle);
    const lt = THREE.MathUtils.clamp(this.b.dot(this.d), 0, len);
    this.b.copy(this.d).multiplyScalar(lt).add(muzzle);
    if (this.b.distanceToSquared(this.listener) < 5) this.sfx.whizz(this.b);
    this.effects.muzzlePuff(muzzle, this.d);
    this.sfx.enemyShot(muzzle, 1.9, muzzle.distanceTo(this.listener));
  }

  private projectAlong(o: THREE.Vector3, dir: THREE.Vector3, p: THREE.Vector3) {
    return (p.x - o.x) * dir.x + (p.y - o.y) * dir.y + (p.z - o.z) * dir.z;
  }

  private updateDying(dt: number) {
    this.yawRate = THREE.MathUtils.clamp(this.yawRate + Math.sign(this.yawRate) * 2.4 * dt, -6, 6);
    this.yaw += this.yawRate * dt;
    this.velocity.x *= 1 - Math.min(1, dt * 0.5);
    this.velocity.z *= 1 - Math.min(1, dt * 0.5);
    this.velocity.y = Math.max(-16, this.velocity.y - 7 * dt);
    this.position.addScaledVector(this.velocity, dt);
    this.roll += (0.5 * Math.sign(this.yawRate) - this.roll) * Math.min(1, dt * 1.5);
    this.pitch += (0.25 - this.pitch) * Math.min(1, dt);
    this.rotorSpeed = Math.max(0.35, this.rotorSpeed - dt * 0.15);
    // Black smoke + fire from the engine deck.
    this.smokeTimer -= dt;
    if (this.smokeTimer <= 0) {
      this.smokeTimer = 0.03;
      this.a.set(0, 1.1, -1.4);
      this.root.localToWorld(this.a);
      this.effects.smoke.spawn(this.a.x, this.a.y, this.a.z, rand(-1, 1), 1.5, rand(-1, 1), 0.07, 0.065, 0.06, 2.8, 0.8, 3.6, 0.75, -0.2, 0.6);
      this.effects.fire.spawn(this.a.x, this.a.y, this.a.z, rand(-1, 1), 1, rand(-1, 1), 2.4, 1.1, 0.3, 0.35, 0.7, 0.2, 1, -1, 1);
    }
    const gy = this.groundY(this.position.x, this.position.z);
    if (this.position.y - SKID_DROP <= gy + 0.2 || this.stateTime > 9) {
      this.position.y = gy + SKID_DROP * 0.6;
      this.crash();
    }
    this.updateVisuals(dt, false);
  }

  private crash() {
    this.state = "wreck";
    this.wreckTimer = 14;
    this.velocity.set(0, 0, 0);
    this.rotorSpeed = 0;
    this.roll = 0.7 * Math.sign(this.yawRate || 1);
    this.pitch = 0.15;
    this.root.rotation.set(this.pitch, this.yaw, this.roll);
    const p = this.position;
    this.effects.explosion(p);
    this.a.set(p.x + Math.sin(this.yaw) * -3, p.y + 0.5, p.z + Math.cos(this.yaw) * -3);
    this.effects.explosion(this.a);
    // Airframe debris: big dark chunks + panels.
    for (let i = 0; i < 36; i++) {
      const ang = Math.random() * Math.PI * 2;
      const s = 4 + Math.random() * 9;
      const g = 0.12 + Math.random() * 0.12;
      this.effects.debris.spawn(p.x, p.y + 1, p.z, Math.cos(ang) * s, 4 + Math.random() * 10, Math.sin(ang) * s, g, g, g * 0.95, 1.6 + Math.random() * 1.4, 0.14 + Math.random() * 0.16, 0.12, 1, 16, 0.4);
    }
    this.rope.visible = false;
    this.disc.visible = false;
    this.sfx.explosion(p, p.distanceTo(this.listener));
    this.hooks.onCrash(this, p);
  }

  private updateVisuals(dt: number, grounded: boolean) {
    if (this.state !== "wreck") this.root.rotation.set(grounded ? 0 : this.pitch, this.yaw, grounded ? 0 : this.roll);
    this.rotorSpin += dt * 19 * this.rotorSpeed;
    this.rotor.rotation.y = this.rotorSpin;
    this.tail.rotation.x = this.rotorSpin * 3.1;
    this.disc.visible = this.rotorSpeed > 0.3;
    // Thin smoke trail once badly damaged.
    if (this.alive && this.health < this.maxHealth * 0.45) {
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0) {
        this.smokeTimer = 0.07;
        this.a.set(0, 1.1, -1.6);
        this.root.localToWorld(this.a);
        this.effects.smoke.spawn(this.a.x, this.a.y, this.a.z, rand(-0.4, 0.4), 0.8, rand(-0.4, 0.4), 0.22, 0.21, 0.2, 2, 0.4, 2.2, 0.45, -0.1, 0.8);
      }
    }
  }

  dispose() {
    for (const h of this.hitboxes) h.geometry.dispose();
    (this.hitboxes[0]?.material as THREE.Material | undefined)?.dispose();
    this.root.removeFromParent();
  }
}
