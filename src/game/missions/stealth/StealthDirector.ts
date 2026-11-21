import * as THREE from "three";
import type { Agent } from "../../ai/Agent";
import type { AgentManager } from "../../ai/AgentManager";
import type { Combatant } from "../../ai/types";
import type { CollisionWorld } from "../../world/Collision";
import type { EnemyType } from "../../survival/config";
import type { RadioLine, StealthSnapshot, StealthStatus, StealthTally } from "../types";
import {
  BARRACKS, GREYWATER_LIVE, HQ_ZONE, SEARCHLIGHTS, TRUCK_LOOP, TRUCK_PAUSE, TRUCK_SPEED, concealmentAt, searchlightSpot, staticLight,
} from "../../world/maps/greywater";
import {
  DETECT, NOISE, alarming, effectiveRange, hears, lightAt, profile, stepGauge, stepNoise, visionRate,
  type Awareness, type ConeLight, type NoiseKind, type SpotLight, type Subject,
} from "./detection";
import { AREA_CUES, GARRISON, REINFORCEMENTS, SEARCH_POINTS, type GuardPlan } from "./nightjar";

/**
 * Host-side stealth layer for Nightjar: owns the garrison's calm-night
 * behaviour, perception (sight, hearing, bodies), the alarm and the stealth
 * tallies. It plugs into AgentManager as its `brain`: while a guard is calm,
 * suspicious, investigating or searching the director moves it (state
 * "patrol"); once the alarm is up it hands the guard back to the normal
 * combat AI.
 *
 * Guard modes:
 *  - calm: walks its route / holds its post.
 *  - suspicious: gauge past DETECT.suspicious; stops and stares at what it saw.
 *  - investigate: walks to the spot it saw or heard something, looks around.
 *  - calling: identified an intruder (or heard a gunshot, or was hit) and is
 *    radioing it in: 2 s, then the alarm. Kill it first and nobody knows.
 *  - alert: the alarm is up; combat AI.
 *  - search: after an alarm cools down (or a body is found) everyone walks
 *    their routes faster and looks harder (awareness 1).
 *
 * Alarm outcome depends on difficulty (MissionDef.stealth.failOnDetect):
 * Recruit / Regular raise a hard alarm (reinforcements, the truck stops and
 * dismounts its crew; −1 star each), Veteran is compromised outright (the
 * mission director restarts from the checkpoint).
 */

export type GuardMode = "calm" | "suspicious" | "investigate" | "calling" | "alert" | "search";
const MODE_CODE: Record<GuardMode, number> = { calm: 0, suspicious: 1, investigate: 1, search: 2, alert: 3, calling: 4 };

export const STEALTH = {
  /** Seconds a guard takes to radio in what it saw. */
  callTime: 2,
  /** Alarm cools down after this long with no guard in contact. */
  alarmCool: 45,
  /** Base-wide search after an alarm / a body is found. */
  searchAfterAlarm: 30,
  searchAfterBody: 90,
  /** Bodies are noticed within this range (scaled by light like sight). */
  bodyRange: 22,
  /** Investigation: look-around time at the spot. */
  lookAround: 6,
  /** A suspicious guard gives up after this long without seeing anything more. */
  suspiciousHold: 2.4,
  /** Target counts as identified once a team member has a clear look within this range. */
  identifyRange: 26,
  /** Truck: headlight reach / half-angle and how close ahead a player makes it brake. */
  headlight: { reach: 24, halfAngle: 0.4, strength: 0.95 },
  torch: { reach: 15, halfAngle: 0.3, strength: 0.75 },
  truckBrake: 9,
};

type Guard = {
  plan: GuardPlan;
  agent: Agent;
  mode: GuardMode;
  modeT: number;
  wp: number;
  pauseT: number;
  /** Per-subject awareness gauge and seconds since last sighting. */
  gauge: number[];
  unseen: number[];
  spotted: boolean;
  interest: THREE.Vector3;
  last: number;
  callReason: string;
  /** Search route (reinforcements / dismounts). */
  sweep: GuardPlan["route"] | null;
  torch: THREE.Mesh | null;
  /** investigate: modeT when it reached the spot (NaN = still walking). */
  arrive: number;
  /** Seconds stuck on an unreachable waypoint. */
  stuck: number;
};

export type StealthSubject = {
  combatant: Combatant;
  sprinting: boolean;
  /** Cumulative shots and whether that weapon is suppressed. */
  shots: number;
  suppressed: boolean;
};

export type StealthHost = {
  spawn(type: EnemyType, x: number, z: number, yaw: number, y?: number): Agent | null;
  radio(line: RadioLine): void;
  banner(title: string, sub: string, color: string): void;
  /** Plays a short alarm / warning sound. */
  alarmSound(): void;
};

const MAX_SUBJECTS = 4;

export class StealthDirector {
  readonly tally: StealthTally = { alarms: 0, spotted: 0, kills: 0, takedowns: 0, bodies: 0 };
  status: StealthStatus = "hidden";
  /** Mission clock (drives searchlights). */
  time = 0;
  cue = "";
  private cueT = 0;
  targetDead = false;
  targetIdentified = false;
  target: Agent | null = null;
  private compromised = "";
  private alarm = false;
  private alarmT = 0;
  private lastContact = 0;
  private searchT = 0;
  private reinf = 0;
  private readonly guards = new Map<Agent, Guard>();
  private readonly found = new Set<Agent>();
  private readonly cues = new Set<string>();
  private subjects: Subject[] = [];
  private subjectRefs: (StealthSubject | null)[] = [];
  private readonly lastShots: number[] = [];
  private readonly stepT: number[] = [];
  private readonly spots: SpotLight[] = SEARCHLIGHTS.map(() => ({ x: 0, z: 0, radius: 4 }));
  private readonly cones: ConeLight[] = [];
  private readonly truckCone: ConeLight = { x: 0, z: 0, dx: 1, dz: 0, reach: STEALTH.headlight.reach, halfAngle: STEALTH.headlight.halfAngle, strength: STEALTH.headlight.strength };
  private readonly torchCones: ConeLight[] = [];
  // Patrol truck.
  private truckD = 0;
  private truckPause = TRUCK_PAUSE;
  private truckStopT = 0;
  private truckHalted = false;
  private readonly truckGauge: number[] = [0, 0, 0, 0];
  private readonly truckUnseen: number[] = [9, 9, 9, 9];
  private truckSpotted = false;
  private truckCrew = 2;
  private readonly loopLen: number;
  private readonly truck = { x: 0, z: 0, hx: 1, hz: 0 };
  private identifyT = 0;
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly torchGeo: THREE.BufferGeometry;
  private readonly torchMat: THREE.Material;

  constructor(
    private readonly agents: AgentManager,
    private readonly world: CollisionWorld,
    private readonly difficulty: string,
    private readonly failOnDetect: boolean,
    private readonly lowQuality: boolean,
    private readonly host: StealthHost,
  ) {
    let len = 0;
    for (let i = 0; i < TRUCK_LOOP.length; i++) {
      const p = TRUCK_LOOP[i], q = TRUCK_LOOP[(i + 1) % TRUCK_LOOP.length];
      len += Math.hypot(q.x - p.x, q.z - p.z);
    }
    this.loopLen = len;
    agents.brain = (ag) => this.think(ag);
    agents.corpseTime = Infinity;
    agents.trackUnseen = false;
    // Torch beams (visual): a faint cone from the guard's chest.
    const g = new THREE.ConeGeometry(1, 1, 12, 1, true);
    g.translate(0, -0.5, 0);
    g.rotateX(-Math.PI / 2);
    this.torchGeo = g;
    this.torchMat = new THREE.MeshBasicMaterial({ color: 0xfff2d0, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.placeTruck();
  }

  // ---------------------------------------------------------------------------------------------
  // Garrison
  // ---------------------------------------------------------------------------------------------

  /** (Re)spawn the calm garrison. `targetDone`: Kerr is already dead (checkpoint after the kill). */
  reset(targetDone: boolean) {
    for (const g of this.guards.values()) this.dropTorch(g);
    this.guards.clear();
    this.found.clear();
    this.alarm = false;
    this.alarmT = 0;
    this.searchT = 0;
    this.reinf = 0;
    this.status = "hidden";
    this.compromised = "";
    this.cue = "";
    this.truckHalted = false;
    this.truckStopT = 0;
    this.truckGauge.fill(0);
    this.truckSpotted = false;
    this.truckCrew = 2;
    this.target = null;
    this.targetDead = targetDone;
    if (!targetDone) this.targetIdentified = false;
    for (let i = 0; i < GREYWATER_LIVE.dead.length; i++) GREYWATER_LIVE.dead[i] = false;
    GREYWATER_LIVE.truck.lights = true;
    for (const plan of GARRISON) {
      if (plan.optional && this.lowQuality) continue;
      if (plan.target && targetDone) continue;
      const p = plan.route[0];
      const ag = this.host.spawn(plan.type, p.x, p.z, p.look ?? 0, plan.y);
      if (!ag) continue;
      this.register(ag, plan, null);
      if (plan.target) this.target = ag;
    }
  }

  private register(ag: Agent, plan: GuardPlan, sweep: GuardPlan["route"] | null, mode: GuardMode = "calm") {
    ag.state = "patrol";
    ag.target = null;
    ag.anchored = !!plan.anchored;
    ag.patrolSpeed = plan.speed ?? 1.5;
    ag.lookYaw = plan.route[0].look ?? NaN;
    const g: Guard = {
      plan, agent: ag, mode, modeT: 0, wp: 0, pauseT: plan.route[0].pause ?? 0, gauge: [0, 0, 0, 0], unseen: [9, 9, 9, 9], spotted: false,
      interest: new THREE.Vector3(), last: this.time, callReason: "", sweep, torch: null, arrive: NaN, stuck: 0,
    };
    if (plan.torch) {
      const m = new THREE.Mesh(this.torchGeo, this.torchMat);
      m.position.set(0.22, 1.25, 0.3);
      m.rotation.x = 0.12;
      m.scale.set(STEALTH.torch.reach * Math.tan(STEALTH.torch.halfAngle), STEALTH.torch.reach * Math.tan(STEALTH.torch.halfAngle), STEALTH.torch.reach);
      m.frustumCulled = false;
      ag.model.root.add(m);
      g.torch = m;
    }
    this.guards.set(ag, g);
    if (mode === "alert") this.toCombat(g);
    return g;
  }

  private dropTorch(g: Guard) {
    if (g.torch) g.torch.removeFromParent();
    g.torch = null;
  }

  // ---------------------------------------------------------------------------------------------
  // Per-frame (host)
  // ---------------------------------------------------------------------------------------------

  /** Feed this frame's team (local player first). */
  update(dt: number, team: StealthSubject[]) {
    this.time += dt;
    GREYWATER_LIVE.t = this.time;
    if (this.cueT > 0 && (this.cueT -= dt) <= 0 && this.status === "hidden") this.cue = "";
    // ---- Moving lights -----------------------------------------------------------------------
    for (let i = 0; i < SEARCHLIGHTS.length; i++) {
      searchlightSpot(SEARCHLIGHTS[i], this.time, this.spots[i]);
      this.spots[i].radius = GREYWATER_LIVE.dead[i] ? 0 : SEARCHLIGHTS[i].radius;
    }
    this.tickTruck(dt);
    this.cones.length = 0;
    if (GREYWATER_LIVE.truck.lights) this.cones.push(this.truckCone);
    let ti = 0;
    for (const g of this.guards.values()) {
      if (!g.torch || !g.agent.alive || g.mode === "alert") continue;
      const c = (this.torchCones[ti++] ??= { x: 0, z: 0, dx: 0, dz: 1, reach: STEALTH.torch.reach, halfAngle: STEALTH.torch.halfAngle, strength: STEALTH.torch.strength });
      c.x = g.agent.position.x;
      c.z = g.agent.position.z;
      c.dx = Math.sin(g.agent.yaw);
      c.dz = Math.cos(g.agent.yaw);
      this.cones.push(c);
    }
    // ---- Subjects --------------------------------------------------------------------------------
    const subs = this.subjects;
    subs.length = 0;
    this.subjectRefs.length = 0;
    for (let i = 0; i < Math.min(MAX_SUBJECTS, team.length); i++) {
      const t = team[i];
      const c = t.combatant;
      const ok = c.targetable;
      const p = c.position;
      const s: Subject = {
        x: p.x, y: p.y + (c.crouched ? 1.0 : 1.55), z: p.z, crouching: c.crouched, speed: c.moveSpeed,
        concealment: concealmentAt(p.x, p.z), light: this.lightAt(p.x, p.y, p.z),
      };
      subs.push(s);
      this.subjectRefs.push(ok ? t : null);
      // Gunfire → noise (suppressed: a few metres).
      const prev = this.lastShots[i] ?? t.shots;
      if (t.shots > prev) this.noise(t.suppressed ? "suppressed" : "gunshot", p.x, p.y, p.z);
      this.lastShots[i] = t.shots;
      // Footsteps (4 Hz).
      this.stepT[i] = (this.stepT[i] ?? 0) - dt;
      if (ok && this.stepT[i] <= 0) {
        this.stepT[i] = 0.25;
        const k = stepNoise(c.moveSpeed, c.crouched, t.sprinting);
        if (k && NOISE[k] > 0) this.noise(k, p.x, p.y, p.z);
      }
      if (ok) this.areaCues(p.x, p.z);
    }
    // ---- Target identification ----------------------------------------------------------------------
    this.identifyT -= dt;
    if (!this.targetIdentified && this.target?.alive && this.identifyT <= 0) {
      this.identifyT = 0.25;
      const tg = this.target;
      tg.eye(this.b);
      for (let i = 0; i < subs.length; i++) {
        if (!this.subjectRefs[i]) continue;
        const s = subs[i];
        if (Math.hypot(s.x - tg.position.x, s.z - tg.position.z, s.y - this.b.y) > STEALTH.identifyRange) continue;
        if (!this.world.lineOfSight(this.a.set(s.x, s.y, s.z), this.b)) continue;
        this.targetIdentified = true;
        this.host.banner("TARGET IDENTIFIED", "COL. KERR IS MARKED", "#ffc845");
        break;
      }
    }
    if (this.target && !this.target.alive) this.targetDead = true;
    // ---- Alarm timeline ---------------------------------------------------------------------------------
    if (this.alarm) {
      this.alarmT += dt;
      for (const r of REINFORCEMENTS) {
        if (this.reinf & (1 << REINFORCEMENTS.indexOf(r))) continue;
        if (this.alarmT < r.at) continue;
        this.reinf |= 1 << REINFORCEMENTS.indexOf(r);
        for (let k = 0; k < r.count; k++) this.spawnSweeper(r.type, r.from.x + (k - 1) * 1.4, r.from.z + (k % 2) * 1.2);
      }
      for (const g of this.guards.values()) if (g.agent.alive && g.agent.hasLos && g.agent.target?.isPlayer) this.lastContact = this.time;
      if (this.time - this.lastContact > STEALTH.alarmCool) this.coolDown();
    } else if (this.searchT > 0) {
      this.searchT -= dt;
      if (this.searchT <= 0) {
        for (const g of this.guards.values()) if (g.mode === "search") this.setMode(g, "calm");
        this.cue = "";
      }
    }
    this.status = this.alarm ? "alert" : this.searchT > 0 || this.anySuspicious() ? "suspicious" : "hidden";
  }

  /** Total light at a ground position for detection. */
  lightAt(x: number, y: number, z: number) {
    const base = staticLight(x, y, z);
    const indoors = x > HQ_ZONE.x0 && x < HQ_ZONE.x1 && z > HQ_ZONE.z0 && z < HQ_ZONE.z1;
    if (indoors || y > 1.5) return lightAt(base, x, z, [], indoors ? [] : this.cones);
    return lightAt(base, x, z, this.spots, this.cones);
  }

  private anySuspicious() {
    for (const g of this.guards.values()) if (g.agent.alive && (g.mode === "suspicious" || g.mode === "investigate" || g.mode === "calling")) return true;
    return this.truckGauge.some((v) => v >= DETECT.suspicious);
  }

  /** Consume a pending compromise (Veteran): the mission director fails the attempt with this reason. */
  takeCompromise() {
    const r = this.compromised;
    this.compromised = "";
    return r;
  }

  // ---------------------------------------------------------------------------------------------
  // Noise
  // ---------------------------------------------------------------------------------------------

  noise(kind: NoiseKind, x: number, y: number, z: number) {
    const r = NOISE[kind];
    if (r <= 0) return;
    this.b.set(x, y + 1.2, z);
    for (const g of this.guards.values()) {
      const ag = g.agent;
      if (!ag.alive || g.mode === "alert" || g.mode === "calling") continue;
      const d = Math.hypot(ag.position.x - x, ag.position.z - z);
      if (d > r) continue;
      const occluded = d > r * NOISE.occluded && !this.world.lineOfSight(ag.eye(this.a), this.b);
      if (!hears(ag.position, { x, z }, kind, occluded)) continue;
      if (alarming(kind)) {
        g.interest.set(x, y, z);
        this.startCall(g, kind === "explosion" ? "AN EXPLOSION" : "GUNFIRE");
      } else if (g.mode !== "investigate" || g.modeT > 2) {
        g.interest.set(x, y, z);
        this.setMode(g, "suspicious");
        g.modeT = -0.6; // a beat longer before walking over
        if (!this.cue) this.flashCue(kind === "body" ? "SOMETHING HEARD" : "FOOTSTEPS HEARD");
      }
    }
    // The truck crew hears gunfire too.
    if (alarming(kind) && Math.hypot(this.truck.x - x, this.truck.z - z) < r * 0.6 && this.truckCrew > 0 && !this.alarm) this.raise("THE TRUCK CREW HEARD GUNFIRE");
  }

  // ---------------------------------------------------------------------------------------------
  // Kills / damage
  // ---------------------------------------------------------------------------------------------

  /** A guard was hit. Unaware guards die to a melee takedown; anyone hurt but alive starts calling it in. */
  onDamaged(ag: Agent, killed: boolean, source: string) {
    const g = this.guards.get(ag);
    if (!g || killed) return;
    if (source === "melee" && g.mode !== "alert" && g.mode !== "calling") {
      ag.applyDamage(ag.health + 1, "body", undefined, "melee");
      return;
    }
    if (g.mode !== "alert" && g.mode !== "calling") {
      const s = this.nearestSubject(ag.position.x, ag.position.z);
      if (s) g.interest.set(s.x, s.y, s.z);
      this.startCall(g, "A GUARD WAS SHOT");
    }
  }

  /** Any enemy death (any killer). `byTeam`: a player did it. */
  onKill(ag: Agent, source: string, byTeam: boolean) {
    const g = this.guards.get(ag);
    if (ag === this.target) {
      this.targetDead = true;
    } else if (byTeam) {
      this.tally.kills++;
      if (source === "melee" && g && g.mode !== "alert") this.tally.takedowns++;
    }
    if (g) {
      this.dropTorch(g);
      const tower = g.plan.searchlight;
      if (tower !== undefined) GREYWATER_LIVE.dead[tower] = true;
    }
    // The body hitting the floor.
    this.noise("body", ag.position.x, ag.position.y, ag.position.z);
  }

  // ---------------------------------------------------------------------------------------------
  // The brain (AgentManager.brain, 5 Hz per guard)
  // ---------------------------------------------------------------------------------------------

  private think(ag: Agent): boolean {
    const g = this.guards.get(ag);
    if (!g) return false;
    const dt = Math.min(0.5, this.time - g.last);
    g.last = this.time;
    if (g.mode === "alert") return false;
    g.modeT += dt;

    // ---- Perception -----------------------------------------------------------------------------------
    const aw: Awareness = g.mode === "calm" ? (this.searchT > 0 ? 1 : 0) : 1;
    ag.eye(this.a);
    const obs = { x: this.a.x, y: this.a.y, z: this.a.z, yaw: ag.yaw, awareness: aw };
    let best = -1;
    let bestG = 0;
    for (let i = 0; i < this.subjects.length; i++) {
      const s = this.subjects[i];
      let rate = 0;
      if (this.subjectRefs[i]) {
        // Cheap pre-check (no ray) before the line-of-sight test.
        rate = visionRate(obs, s, true);
        if (rate > 0 && !this.world.lineOfSight(this.a, this.b.set(s.x, s.y, s.z))) rate = 0;
      }
      g.unseen[i] = rate > 0 ? 0 : g.unseen[i] + dt;
      g.gauge[i] = stepGauge(g.gauge[i], rate, dt, g.unseen[i], this.difficulty);
      if (g.gauge[i] > bestG) {
        bestG = g.gauge[i];
        best = i;
      }
    }
    if (g.mode === "calling") {
      if (best >= 0 && g.unseen[best] === 0) g.interest.set(this.subjects[best].x, 0, this.subjects[best].z);
      this.faceInterest(g);
      ag.pathLen = 0;
      if (g.modeT >= STEALTH.callTime) this.raise(g.callReason || "SPOTTED");
      return true;
    }
    if (bestG >= DETECT.detected && best >= 0) {
      if (!g.spotted) {
        g.spotted = true;
        this.tally.spotted++;
      }
      g.interest.set(this.subjects[best].x, 0, this.subjects[best].z);
      this.startCall(g, "SPOTTED BY A GUARD");
      return true;
    }
    if (bestG >= DETECT.suspicious && best >= 0 && g.unseen[best] === 0) {
      g.interest.set(this.subjects[best].x, 0, this.subjects[best].z);
      if (g.mode !== "suspicious") this.setMode(g, "suspicious");
    }
    if (g.mode !== "suspicious" && g.mode !== "investigate") this.lookForBodies(g);

    // ---- Behaviour -------------------------------------------------------------------------------------
    switch (g.mode) {
      case "suspicious":
        ag.pathLen = 0;
        this.faceInterest(g);
        if (g.modeT > STEALTH.suspiciousHold && (best < 0 || g.unseen[best] > 1)) this.setMode(g, "investigate");
        break;
      case "investigate": {
        if (g.plan.anchored) {
          this.faceInterest(g);
          if (g.modeT > STEALTH.lookAround) this.setMode(g, this.searchT > 0 ? "search" : "calm");
          break;
        }
        ag.patrolSpeed = 1.7;
        if (Number.isNaN(g.arrive)) {
          const d = Math.hypot(g.interest.x - ag.position.x, g.interest.z - ag.position.z);
          if (d < 1.6 || g.modeT > 25) g.arrive = g.modeT;
          else if ((ag.pathLen === 0 || ag.pathIdx >= ag.pathLen) && !this.agents.navigate(ag, g.interest.x, g.interest.z) && g.modeT > 4) g.arrive = g.modeT;
          ag.lookYaw = NaN;
        } else {
          // At the spot (or it can't get there): look around, then back to the route.
          const t = g.modeT - g.arrive;
          ag.pathLen = 0;
          ag.lookYaw = Math.atan2(g.interest.x - ag.position.x, g.interest.z - ag.position.z) + Math.sin(t * 1.4) * 1.2;
          if (t > STEALTH.lookAround) this.setMode(g, this.searchT > 0 ? "search" : "calm");
        }
        break;
      }
      case "calm":
      case "search":
        this.walkRoute(g, dt);
        break;
    }
    ag.state = "patrol";
    ag.target = null;
    return true;
  }

  private walkRoute(g: Guard, dt: number) {
    const ag = g.agent;
    const route = g.sweep ?? g.plan.route;
    const pt = route[g.wp % route.length];
    ag.patrolSpeed = (g.plan.speed ?? 1.5) * (g.mode === "search" ? 1.25 : 1);
    if (route.length === 1 && !g.plan.anchored) {
      // Post: go back to it, then hold the look direction.
      const d = Math.hypot(pt.x - ag.position.x, pt.z - ag.position.z);
      if (d > 0.7) {
        if (ag.pathLen === 0 || ag.pathIdx >= ag.pathLen) this.agents.navigate(ag, pt.x, pt.z);
        ag.lookYaw = NaN;
      } else {
        ag.pathLen = 0;
        ag.lookYaw = (pt.look ?? ag.yaw) + (g.mode === "search" ? Math.sin(this.time * 0.7) * 0.8 : Math.sin(this.time * 0.25 + ag.id) * 0.35);
      }
      return;
    }
    if (g.plan.anchored) {
      // Tower: watch the searchlight pool.
      const sl = g.plan.searchlight;
      if (sl !== undefined && !GREYWATER_LIVE.dead[sl]) {
        const s = this.spots[sl];
        ag.lookYaw = Math.atan2(s.x - ag.position.x, s.z - ag.position.z);
      } else ag.lookYaw = (pt.look ?? 0) + Math.sin(this.time * 0.3) * 0.7;
      ag.pathLen = 0;
      return;
    }
    const d = Math.hypot(pt.x - ag.position.x, pt.z - ag.position.z);
    if (d > 0.8) {
      if (ag.pathLen === 0 || ag.pathIdx >= ag.pathLen) {
        if (!this.agents.navigate(ag, pt.x, pt.z)) {
          // Unreachable waypoint (shouldn't happen; tests check routes): skip it.
          g.stuck += dt;
          if (g.stuck > 3) this.nextWaypoint(g, route);
        } else g.stuck = 0;
      }
      ag.lookYaw = NaN;
      return;
    }
    ag.pathLen = 0;
    if (pt.look !== undefined) ag.lookYaw = pt.look + Math.sin(this.time * 0.5 + ag.id) * 0.3;
    g.pauseT -= dt;
    if (g.pauseT <= 0) this.nextWaypoint(g, route);
  }

  private nextWaypoint(g: Guard, route: GuardPlan["route"]) {
    g.wp = (g.wp + 1) % route.length;
    g.pauseT = route[g.wp].pause ?? 0.5;
    g.stuck = 0;
    g.agent.pathLen = 0;
  }

  private faceInterest(g: Guard) {
    const ag = g.agent;
    ag.lookYaw = Math.atan2(g.interest.x - ag.position.x, g.interest.z - ag.position.z);
  }

  private setMode(g: Guard, m: GuardMode) {
    g.mode = m;
    g.modeT = 0;
    if (m === "investigate") g.arrive = NaN;
    if (m === "calm" || m === "search") {
      g.pauseT = 0.5;
      g.agent.pathLen = 0;
    }
  }

  private lookForBodies(g: Guard) {
    const ag = g.agent;
    for (const c of this.agents.active) {
      if (c.state !== "dead" || this.found.has(c)) continue;
      const dx = c.position.x - ag.position.x, dz = c.position.z - ag.position.z;
      const d = Math.hypot(dx, dz);
      const range = Math.min(STEALTH.bodyRange, effectiveRange(this.lightAt(c.position.x, c.position.y, c.position.z), 0) * 0.85);
      if (d > range) continue;
      let off = Math.atan2(dx, dz) - ag.yaw;
      off = Math.abs(Math.atan2(Math.sin(off), Math.cos(off)));
      if (off > DETECT.fov) continue;
      if (!this.world.lineOfSight(this.a, this.b.set(c.position.x, c.position.y + 0.3, c.position.z))) continue;
      this.found.add(c);
      if (this.alarm) continue;
      this.tally.bodies++;
      this.searchT = Math.max(this.searchT, STEALTH.searchAfterBody);
      g.interest.copy(c.position);
      this.setMode(g, "investigate");
      for (const o of this.guards.values()) if (o !== g && o.mode === "calm") this.setMode(o, "search");
      this.flashCue("BODY FOUND");
      this.host.banner("BODY FOUND", "THE BASE IS ON EDGE", "#ffc845");
      this.host.radio({ speaker: "ASHEN FRONT (intercept)", text: "Man down by the " + this.where(c.position.x, c.position.z) + "! Search the base!" });
      return;
    }
  }

  private where(x: number, z: number) {
    if (x > HQ_ZONE.x0 && x < HQ_ZONE.x1 && z > HQ_ZONE.z0 && z < HQ_ZONE.z1) return "command house";
    if (x < -25 && z > -10 && z < 30) return "motor pool";
    if (x > BARRACKS.x0 - 6 && z > BARRACKS.z0 && z < BARRACKS.z1) return "barracks";
    if (z < -55) return "river";
    if (z > 35) return "south road";
    return "yard";
  }

  // ---------------------------------------------------------------------------------------------
  // Alarm
  // ---------------------------------------------------------------------------------------------

  private startCall(g: Guard, reason: string) {
    if (this.alarm) {
      this.toCombat(g);
      return;
    }
    if (g.mode === "calling") return;
    g.mode = "calling";
    g.modeT = 0;
    g.callReason = reason;
    g.agent.pathLen = 0;
    this.faceInterest(g);
    this.flashCue("RADIO CALL — STOP HIM");
  }

  private raise(reason: string) {
    if (this.alarm) return;
    if (this.failOnDetect) {
      if (!this.compromised) this.compromised = `COMPROMISED: ${reason}`;
      return;
    }
    this.alarm = true;
    this.alarmT = 0;
    this.lastContact = this.time;
    this.reinf = 0;
    this.tally.alarms++;
    this.searchT = 0;
    this.truckHalted = true;
    for (const g of this.guards.values()) this.toCombat(g);
    this.cue = reason;
    this.host.alarmSound();
    this.host.banner("ALARM RAISED", `${reason} · REINFORCEMENTS INBOUND`, "#ff5a4a");
    this.host.radio({ speaker: "ASHEN FRONT (intercept)", text: "Intruders in the depot! All units, all units!" });
    // The truck stops and its crew piles out.
    for (let k = 0; k < this.truckCrew; k++) {
      const s = k === 0 ? 1 : -1;
      this.spawnSweeper("rifleman", this.truck.x - this.truck.hz * 2.2 * s, this.truck.z + this.truck.hx * 2.2 * s);
    }
    this.truckCrew = 0;
  }

  private toCombat(g: Guard) {
    g.mode = "alert";
    g.modeT = 0;
    const ag = g.agent;
    if (!ag.alive) return;
    this.dropTorch(g);
    ag.state = g.plan.anchored ? "engage" : "advance";
    ag.pathLen = 0;
    // The colonel and his tower riflemen hold where they are.
    if (g.plan.target) ag.anchored = true;
    ag.lookYaw = NaN;
    ag.lastSeen.copy(g.interest.lengthSq() > 0 ? g.interest : ag.position);
  }

  /** No contact for a while: the alarm winds down into a search, then calm. */
  private coolDown() {
    this.alarm = false;
    this.searchT = STEALTH.searchAfterAlarm;
    this.cue = "SEARCHING";
    for (const g of this.guards.values()) {
      if (!g.agent.alive) continue;
      g.gauge.fill(DETECT.suspicious * 0.8);
      g.spotted = false;
      g.agent.target = null;
      g.agent.state = "patrol";
      if (g.plan.target) g.agent.anchored = false;
      if (g.plan.anchored) g.agent.anchored = true;
      this.setMode(g, "search");
    }
    this.host.banner("ALARM OVER", "THEY'RE STILL SEARCHING · STAY HIDDEN", "#ffc845");
  }

  private spawnSweeper(type: EnemyType, x: number, z: number) {
    const ag = this.host.spawn(type, x, z, 0);
    if (!ag) return;
    const off = Math.floor(Math.random() * SEARCH_POINTS.length);
    const sweep = SEARCH_POINTS.map((_, i) => ({ ...SEARCH_POINTS[(i + off) % SEARCH_POINTS.length], pause: 3 }));
    const plan: GuardPlan = { id: "sweeper", type, route: [{ x, z }], speed: 1.8 };
    this.register(ag, plan, sweep, this.alarm ? "alert" : "search");
  }

  private flashCue(text: string) {
    this.cue = text;
    this.cueT = 3;
  }

  private areaCues(x: number, z: number) {
    for (const c of AREA_CUES) {
      if (this.cues.has(c.id) || x < c.x0 || x > c.x1 || z < c.z0 || z > c.z1) continue;
      this.cues.add(c.id);
      this.host.radio({ speaker: c.speaker, text: c.text });
    }
  }

  private nearestSubject(x: number, z: number) {
    let best: Subject | null = null;
    let bd = Infinity;
    for (let i = 0; i < this.subjects.length; i++) {
      if (!this.subjectRefs[i]) continue;
      const s = this.subjects[i];
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------------------------------------
  // Patrol truck
  // ---------------------------------------------------------------------------------------------

  private tickTruck(dt: number) {
    let moving = !this.truckHalted;
    if (moving && this.truckPause > 0) {
      this.truckPause -= dt;
      moving = false;
    }
    if (moving && this.truckStopT > 0) {
      this.truckStopT -= dt;
      moving = false;
    }
    // The crew watches through the windscreen (eyes ~2.3 m up, looking along the road).
    const obs = { x: this.truck.x + this.truck.hx * 1.5, y: 2.3, z: this.truck.z + this.truck.hz * 1.5, yaw: Math.atan2(this.truck.hx, this.truck.hz), awareness: 0 as Awareness };
    let bestG = 0;
    if (this.truckCrew > 0 && !this.alarm) {
      this.a.set(obs.x, obs.y, obs.z);
      for (let i = 0; i < this.subjects.length; i++) {
        const s = this.subjects[i];
        let rate = 0;
        if (this.subjectRefs[i]) {
          rate = visionRate(obs, s, true);
          if (rate > 0 && !this.world.lineOfSight(this.a, this.b.set(s.x, s.y, s.z))) rate = 0;
          // Someone standing in the road ahead: brake.
          const ax = s.x - this.truck.x, az = s.z - this.truck.z;
          const ahead = ax * this.truck.hx + az * this.truck.hz;
          if (ahead > 0 && ahead < STEALTH.truckBrake && Math.abs(ax * this.truck.hz - az * this.truck.hx) < 2.2) this.truckStopT = Math.max(this.truckStopT, 3);
        }
        this.truckUnseen[i] = rate > 0 ? 0 : this.truckUnseen[i] + dt;
        this.truckGauge[i] = stepGauge(this.truckGauge[i], rate, dt, this.truckUnseen[i], this.difficulty);
        bestG = Math.max(bestG, this.truckGauge[i]);
      }
      if (bestG >= DETECT.suspicious) this.truckStopT = Math.max(this.truckStopT, 2.5);
      if (bestG >= DETECT.detected) {
        if (!this.truckSpotted) {
          this.truckSpotted = true;
          this.tally.spotted++;
        }
        this.raise("SPOTTED BY THE PATROL TRUCK");
      }
    }
    if (moving) {
      this.truckD += TRUCK_SPEED * dt;
      if (this.truckD >= this.loopLen) {
        this.truckD -= this.loopLen;
        this.truckPause = TRUCK_PAUSE;
      }
    }
    this.placeTruck();
    this.truckCone.x = this.truck.x + this.truck.hx * 3.2;
    this.truckCone.z = this.truck.z + this.truck.hz * 3.2;
    this.truckCone.dx = this.truck.hx;
    this.truckCone.dz = this.truck.hz;
  }

  /** Truck pose from its distance along the loop (shared with clients through the snapshot). */
  private placeTruck() {
    truckPose(this.truckD, this.truck);
    const L = GREYWATER_LIVE.truck;
    L.x = this.truck.x;
    L.z = this.truck.z;
    L.yaw = Math.atan2(-this.truck.hz, this.truck.hx);
  }

  // ---------------------------------------------------------------------------------------------
  // Replication / HUD
  // ---------------------------------------------------------------------------------------------

  /** Visibility (0–1) of the local player right now: light × profile (for the HUD meter). */
  visibility(i = 0) {
    const s = this.subjects[i];
    if (!s) return 0;
    return Math.min(1, s.light * 1.25 * profile(s) / DETECT.run);
  }

  /** Highest awareness any guard has of subject `i`, 0–1. */
  maxGauge(i = 0) {
    let m = 0;
    for (const g of this.guards.values()) if (g.agent.alive) m = Math.max(m, g.gauge[i] ?? 0);
    return Math.max(m, this.truckGauge[i] ?? 0);
  }

  snapshot(out: StealthSnapshot | undefined): StealthSnapshot {
    const s: StealthSnapshot = out ?? {
      alarms: 0, spotted: 0, kills: 0, takedowns: 0, bodies: 0, status: "hidden", timer: -1, sus: [], target: -1, identified: false, cue: "", clock: 0, truck: [0, 0, 1],
    };
    Object.assign(s, this.tally);
    s.status = this.status;
    s.timer = this.alarm ? Math.max(0, STEALTH.alarmCool - (this.time - this.lastContact)) : this.searchT > 0 ? this.searchT : -1;
    s.sus.length = 0;
    for (const g of this.guards.values()) {
      if (!g.agent.alive) continue;
      let m = 0;
      for (const v of g.gauge) m = Math.max(m, v);
      if (m < 0.03 && g.mode === "calm") continue;
      if (g.mode === "alert") continue;
      s.sus.push(g.agent.id, Math.round(m * 100), MODE_CODE[g.mode]);
    }
    s.target = this.target?.alive ? this.target.id : -1;
    s.identified = this.targetIdentified;
    s.cue = this.cue;
    s.clock = Math.round(this.time * 10) / 10;
    s.truck = [Math.round(this.truckD * 10) / 10, this.truckHalted || this.truckPause > 0 || this.truckStopT > 0 ? 0 : 1, GREYWATER_LIVE.truck.lights ? 1 : 0];
    return s;
  }

  /** Per-guard indicator list for the local HUD (host): agent, gauge 0–1, mode code. */
  indicators(out: { agent: Agent; pct: number; mode: number }[]) {
    out.length = 0;
    for (const g of this.guards.values()) {
      if (!g.agent.alive || g.mode === "alert") continue;
      const m = g.gauge[0];
      if (m < 0.03 && g.mode === "calm") continue;
      out.push({ agent: g.agent, pct: m, mode: MODE_CODE[g.mode] });
    }
    return out;
  }

  /** Can a melee takedown happen on this agent now (unaware guard)? */
  unaware(ag: Agent) {
    const g = this.guards.get(ag);
    return !!g && ag.alive && g.mode !== "alert" && g.mode !== "calling";
  }

  dispose() {
    for (const g of this.guards.values()) this.dropTorch(g);
    this.guards.clear();
    this.torchGeo.dispose();
    this.torchMat.dispose();
    this.agents.brain = null;
  }
}

/** Truck position and heading at distance `d` along TRUCK_LOOP. */
export function truckPose(d: number, out: { x: number; z: number; hx: number; hz: number }) {
  const L = TRUCK_LOOP;
  let rest = d;
  for (let i = 0; i < L.length; i++) {
    const p = L[i], q = L[(i + 1) % L.length];
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    if (rest <= len || i === L.length - 1) {
      const t = Math.max(0, Math.min(1, rest / len));
      out.x = p.x + (q.x - p.x) * t;
      out.z = p.z + (q.z - p.z) * t;
      out.hx = (q.x - p.x) / len;
      out.hz = (q.z - p.z) / len;
      return out;
    }
    rest -= len;
  }
  return out;
}
