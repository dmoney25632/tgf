import type { EnemyType } from "../survival/config";
import { rateMission } from "./rating";
import type { AirScript, MissionDef, MissionResult, MissionState, ObjectiveDef, RadioLine, WaveScript } from "./types";

/**
 * Engine-free mission scripting: objective flow, timed waves / air sorties,
 * radio cues, checkpoints and scoring. The game mode feeds it facts about
 * the world each frame (`MissionFacts`) and carries out its requests through
 * `DirectorHost`. All live state is the plain `MissionState` object, so a
 * network host can snapshot it and tests can drive it without three.js.
 *
 * Steady state allocates nothing: the spawn queue and schedules are
 * preallocated pools reused across objectives and retries.
 */

/** What the world looks like this frame (filled in by the game mode). */
export type MissionFacts = {
  /** Scripted hostiles alive (agents + gunships). */
  hostiles: number;
  /** A living team member stands in the current objective's zone. */
  inZone: boolean;
  /** Hostiles inside the zone (defend pauses while contested by more than the team). */
  contested: boolean;
  /** The player is holding interact at the objective (plant charge / free VIP). */
  interacting: boolean;
  /** escort: the VIP is alive (not downed / dead). */
  vipAlive: boolean;
  /** escort: the VIP is dead (bled out). */
  vipDead: boolean;
  /** escort: the VIP is inside the goal radius. */
  vipAtGoal: boolean;
  /** extract: transport is on the ground. */
  heliLanded: boolean;
  /** extract: every living team member (and VIP, if any) is at the LZ. */
  allAboard: boolean;
  /** Everyone is down with no one to revive them. */
  teamWiped: boolean;
  /** Free slots under the alive cap. */
  spawnRoom: number;
};

export type DirectorHost = {
  /** `y` (when set) places the enemy at that height instead of on the nav floor (perched snipers). */
  spawn(type: EnemyType, x: number, z: number, elite: boolean, y?: number): void;
  /** False when no helicopter is free (retried shortly after). */
  launchAir(air: AirScript, objective: ObjectiveDef): boolean;
  radio(line: RadioLine): void;
  objectiveStarted(index: number, def: ObjectiveDef, resumed: boolean): void;
  objectiveDone(index: number, def: ObjectiveDef): void;
  /** destroy: the charge went off. */
  detonate(def: Extract<ObjectiveDef, { kind: "destroy" }>): void;
  /** escort: the VIP was freed. */
  vipFreed(def: Extract<ObjectiveDef, { kind: "escort" }>): void;
  /** extract: send the bird. */
  callExtract(def: Extract<ObjectiveDef, { kind: "extract" }>): void;
  /** Roll the world back to the current checkpoint (clear hostiles, respawn team). */
  restoreCheckpoint(index: number, reason: string): void;
  end(victory: boolean): void;
};

export const MISSION = {
  /** Seconds between individual scripted spawns. */
  spawnGap: 0.35,
  /** Holding interact to free a captive. */
  rescueTime: 2.4,
  /** Retries before the mission fails outright. */
  maxRetries: 3,
  /** Delay before rolling back after a wipe. */
  retryDelay: 3.2,
  /** Pause between objectives. */
  gap: 1.5,
  /** Defend: progress rate while contested. */
  contestedRate: 0,
  points: {
    objective: 1000,
    kill: 100,
    headshot: 50,
    gunship: 1500,
    /** Per second under par. */
    timeBonus: 10,
    retry: -1500,
  },
};

type SpawnReq = { type: EnemyType; x: number; z: number; elite: boolean; y: number };
type Schedule = { script: WaveScript | null; next: number; sent: number };
type AirReq = { script: AirScript | null; next: number; done: boolean };
type RadioReq = { line: RadioLine | null; t: number };

const POOL = 64;

export function newMissionState(id: string): MissionState {
  return {
    missionId: id, phase: "briefing", objective: 0, objectiveTime: 0, progress: 0, stage: "", timer: -1,
    elapsed: 0, checkpoint: 0, retries: 0, kills: 0, headshots: 0, gunships: 0, vipDowned: 0, downs: 0, pending: 0, failReason: "",
  };
}

export class MissionDirector {
  readonly state: MissionState;
  private readonly spawns: SpawnReq[] = [];
  private spawnHead = 0;
  private spawnTail = 0;
  private spawnTimer = 0;
  private readonly sched: Schedule[] = [];
  private schedN = 0;
  private readonly air: AirReq[] = [];
  private airN = 0;
  private readonly radios: RadioReq[] = [];
  private radioN = 0;
  private radioClock = 0;
  private gapTimer = -1;
  private retryTimer = -1;
  private retryReason = "";
  private endSent = false;
  private interactProgress = 0;

  constructor(readonly def: MissionDef, private readonly host: DirectorHost) {
    this.state = newMissionState(def.id);
    for (let i = 0; i < POOL; i++) {
      this.spawns.push({ type: "rifleman", x: 0, z: 0, elite: false, y: NaN });
      this.radios.push({ line: null, t: 0 });
    }
    for (let i = 0; i < 16; i++) {
      this.sched.push({ script: null, next: 0, sent: 0 });
      this.air.push({ script: null, next: 0, done: false });
    }
  }

  get maxRetries() {
    return this.def.maxRetries ?? MISSION.maxRetries;
  }

  get objective(): ObjectiveDef | undefined {
    return this.def.objectives[this.state.objective];
  }

  /** 0..1 hold progress for the interact prompt (-1 when not holding). */
  get holdProgress() {
    return this.interactProgress > 0 ? this.interactProgress : -1;
  }

  start() {
    const s = this.state;
    s.phase = "active";
    this.radioClock = 0;
    this.radioN = 0;
    if (this.def.intro) this.queueRadio(this.def.intro);
    this.beginObjective(0, false);
  }

  /** Counted by the mode as kills happen. */
  credit(kind: "kill" | "headshot" | "gunship" | "vipDowned" | "down") {
    const s = this.state;
    if (kind === "kill") s.kills++;
    else if (kind === "down") s.downs = (s.downs ?? 0) + 1;
    else if (kind === "headshot") s.headshots++;
    else if (kind === "gunship") s.gunships++;
    else s.vipDowned++;
  }

  update(dt: number, f: MissionFacts) {
    const s = this.state;
    if (s.phase !== "active") {
      this.tickRadio(dt);
      return;
    }
    s.elapsed += dt;
    this.tickRadio(dt);

    // Rollback after a wipe.
    if (this.retryTimer >= 0) {
      this.retryTimer -= dt;
      if (this.retryTimer < 0) this.rollback();
      return;
    }
    if (f.teamWiped || f.vipDead) {
      this.fail(f.teamWiped ? "TEAM WIPED" : "THE VIP WAS KILLED");
      return;
    }

    if (this.gapTimer >= 0) {
      this.gapTimer -= dt;
      if (this.gapTimer < 0) this.beginObjective(s.objective + 1, false);
      return;
    }

    const obj = this.objective;
    if (!obj) return;
    s.objectiveTime += dt;
    this.tickScripts(dt, obj, f);
    this.tickObjective(dt, obj, f);
  }

  // ---------------------------------------------------------------------------

  private beginObjective(i: number, resumed: boolean) {
    const s = this.state;
    if (i >= this.def.objectives.length) {
      this.finish(true);
      return;
    }
    s.objective = i;
    s.objectiveTime = 0;
    s.progress = 0;
    s.timer = -1;
    s.checkpoint = i;
    this.interactProgress = 0;
    const obj = this.def.objectives[i];
    s.stage = obj.kind === "destroy" ? "idle" : obj.kind === "escort" ? "captive" : obj.kind === "extract" ? "inbound" : "";
    if (obj.kind === "defend") s.timer = obj.seconds;
    // Schedules.
    this.spawnHead = this.spawnTail = 0;
    this.schedN = 0;
    for (const w of obj.waves ?? []) {
      const e = this.sched[this.schedN++];
      e.script = w;
      e.next = w.at;
      e.sent = 0;
    }
    this.airN = 0;
    for (const a of obj.air ?? []) {
      const e = this.air[this.airN++];
      e.script = a;
      e.next = a.at;
      e.done = false;
    }
    if (obj.radio) this.queueRadio(obj.radio);
    this.updatePending();
    this.host.objectiveStarted(i, obj, resumed);
    if (obj.kind === "extract") this.host.callExtract(obj);
  }

  private tickScripts(dt: number, obj: ObjectiveDef, f: MissionFacts) {
    const s = this.state;
    const t = s.objectiveTime;
    for (let i = 0; i < this.schedN; i++) {
      const e = this.sched[i];
      const w = e.script!;
      const times = w.every ? (w.times ?? Infinity) : 1;
      if (e.sent >= times || t < e.next) continue;
      for (let k = 0; k < w.count; k++) {
        const p = w.from[(k + e.sent) % w.from.length];
        // Perched spawns go exactly where authored; ground spawns fan out around the point.
        if (p.y !== undefined) this.enqueue(w.type, p.x, p.z, !!w.elite, p.y);
        else this.enqueue(w.type, p.x + ((k % 3) - 1) * 1.6, p.z + (((k / 3) | 0) % 3 - 1) * 1.6, !!w.elite);
      }
      e.sent++;
      e.next = t + (w.every ?? 0);
    }
    for (let i = 0; i < this.airN; i++) {
      const e = this.air[i];
      if (e.done || t < e.next) continue;
      if (this.host.launchAir(e.script!, obj)) e.done = true;
      else e.next = t + 3;
    }
    // Drip-feed queued spawns under the alive cap.
    this.spawnTimer -= dt;
    if (this.spawnTail > this.spawnHead && this.spawnTimer <= 0 && f.spawnRoom > 0) {
      const r = this.spawns[this.spawnHead % POOL];
      this.spawnHead++;
      if (Number.isNaN(r.y)) this.host.spawn(r.type, r.x, r.z, r.elite);
      else this.host.spawn(r.type, r.x, r.z, r.elite, r.y);
      this.spawnTimer = MISSION.spawnGap;
    }
    this.updatePending();
  }

  private updatePending() {
    let n = this.spawnTail - this.spawnHead;
    for (let i = 0; i < this.schedN; i++) {
      const e = this.sched[i];
      const w = e.script!;
      // Only one-shot waves count as "still to come"; repeating pressure doesn't block completion.
      if (!w.every && e.sent === 0) n += w.count;
    }
    for (let i = 0; i < this.airN; i++) if (!this.air[i].done && !this.air[i].script!.orbit.seconds) n++;
    this.state.pending = n;
  }

  private enqueue(type: EnemyType, x: number, z: number, elite: boolean, y = NaN) {
    if (this.spawnTail - this.spawnHead >= POOL) return;
    const r = this.spawns[this.spawnTail % POOL];
    this.spawnTail++;
    r.y = y;
    r.type = type;
    r.x = x;
    r.z = z;
    r.elite = elite;
  }

  private tickObjective(dt: number, obj: ObjectiveDef, f: MissionFacts) {
    const s = this.state;
    const cleared = !obj.clearFirst || (f.hostiles === 0 && s.pending === 0);
    switch (obj.kind) {
      case "reach":
        if (f.inZone && cleared) this.complete();
        break;
      case "defend": {
        if (f.inZone && !f.contested) s.timer = Math.max(0, s.timer - dt);
        s.progress = 1 - s.timer / obj.seconds;
        if (s.timer <= 0 && cleared) this.complete();
        break;
      }
      case "destroy": {
        if (s.stage === "idle" || s.stage === "planting") {
          if (f.interacting) {
            s.stage = "planting";
            this.interactProgress = Math.min(1, this.interactProgress + dt / obj.plantTime);
          } else {
            this.interactProgress = Math.max(0, this.interactProgress - dt * 2);
            if (this.interactProgress === 0) s.stage = "idle";
          }
          s.progress = this.interactProgress;
          if (this.interactProgress >= 1) {
            this.interactProgress = 0;
            s.stage = "armed";
            s.timer = obj.fuse;
            s.progress = 0;
          }
        } else if (s.stage === "armed") {
          s.timer = Math.max(0, s.timer - dt);
          s.progress = 1 - s.timer / obj.fuse;
          if (s.timer <= 0) {
            s.stage = "done";
            s.timer = -1;
            this.host.detonate(obj);
          }
        } else if (s.stage === "done" && cleared) this.complete();
        break;
      }
      case "escort": {
        if (s.stage === "captive") {
          if (f.interacting) this.interactProgress = Math.min(1, this.interactProgress + dt / MISSION.rescueTime);
          else this.interactProgress = Math.max(0, this.interactProgress - dt * 2);
          s.progress = this.interactProgress;
          if (this.interactProgress >= 1) {
            this.interactProgress = 0;
            s.stage = "following";
            s.progress = 0;
            this.host.vipFreed(obj);
          }
        } else if (s.stage === "following" && f.vipAtGoal && f.vipAlive && cleared) {
          s.stage = "done";
          this.complete();
        }
        break;
      }
      case "eliminate":
        if (s.objectiveTime > 1 && f.hostiles === 0 && s.pending === 0) this.complete();
        break;
      case "extract":
        if (f.heliLanded && s.stage === "inbound") s.stage = "landed";
        if (s.stage === "landed" && f.allAboard) {
          s.stage = "aboard";
          this.complete();
        }
        break;
    }
  }

  private complete() {
    const s = this.state;
    const obj = this.objective!;
    this.host.objectiveDone(s.objective, obj);
    if (obj.done) this.queueRadio(obj.done);
    s.progress = 1;
    s.timer = -1;
    this.interactProgress = 0;
    this.schedN = 0;
    this.airN = 0;
    this.spawnHead = this.spawnTail = 0;
    s.pending = 0;
    if (s.objective + 1 >= this.def.objectives.length) this.finish(true);
    else this.gapTimer = MISSION.gap;
  }

  private fail(reason: string) {
    const s = this.state;
    s.failReason = reason;
    if (s.retries >= this.maxRetries) {
      this.finish(false);
      return;
    }
    this.retryReason = reason;
    this.retryTimer = MISSION.retryDelay;
    this.schedN = 0;
    this.airN = 0;
    this.spawnHead = this.spawnTail = 0;
  }

  private rollback() {
    const s = this.state;
    s.retries++;
    this.retryTimer = -1;
    this.host.restoreCheckpoint(s.checkpoint, this.retryReason);
    this.beginObjective(s.checkpoint, true);
  }

  private finish(victory: boolean) {
    const s = this.state;
    if (this.endSent) return;
    this.endSent = true;
    s.phase = victory ? "complete" : "failed";
    if (victory) {
      s.objective = this.def.objectives.length;
      s.failReason = "";
      if (this.def.outro) this.queueRadio(this.def.outro);
    }
    this.host.end(victory);
  }

  // ---- Radio -------------------------------------------------------------------------

  private queueRadio(lines: RadioLine[]) {
    // Lines are relative to now; keep the queue compact.
    let w = 0;
    for (let i = 0; i < this.radioN; i++) {
      const r = this.radios[i];
      if (r.line) {
        const d = this.radios[w++];
        d.line = r.line;
        d.t = r.t;
      }
    }
    this.radioN = w;
    // Don't talk over a line still on screen: start after the last queued one.
    let base = this.radioClock;
    for (let i = 0; i < this.radioN; i++) base = Math.max(base, this.radios[i].t + 3.5);
    for (const line of lines) {
      if (this.radioN >= POOL) break;
      const r = this.radios[this.radioN++];
      r.line = line;
      r.t = base + (line.at ?? 0);
    }
  }

  private tickRadio(dt: number) {
    this.radioClock += dt;
    for (let i = 0; i < this.radioN; i++) {
      const r = this.radios[i];
      if (r.line && this.radioClock >= r.t) {
        this.host.radio(r.line);
        r.line = null;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export function scoreMission(def: MissionDef, s: MissionState, difficultyMul = 1, difficulty = "regular"): MissionResult {
  const P = MISSION.points;
  const victory = s.phase === "complete";
  const done = victory ? def.objectives.length : s.objective;
  const seconds = Math.round(s.elapsed);
  const under = victory ? Math.max(0, def.par - seconds) : 0;
  const breakdown = [
    { label: "Objectives", value: done * P.objective },
    { label: "Kills", value: s.kills * P.kill },
    { label: "Headshots", value: s.headshots * P.headshot },
    { label: "Gunships downed", value: s.gunships * P.gunship },
    { label: "Time bonus", value: Math.round(under * P.timeBonus) },
    { label: "Retries", value: s.retries ? s.retries * P.retry : 0 },
  ];
  const raw = breakdown.reduce((a, b) => a + b.value, 0);
  const score = Math.max(0, Math.round(raw * difficultyMul));
  let grade: MissionResult["grade"] = "D";
  if (victory) {
    if (s.retries === 0 && seconds <= def.par) grade = "S";
    else if (s.retries <= 1 && seconds <= def.par * 1.4) grade = "A";
    else if (s.retries <= 2) grade = "B";
    else grade = "C";
  }
  return {
    missionId: def.id, title: def.title, codename: def.codename, victory,
    objectivesDone: done, objectivesTotal: def.objectives.length,
    seconds, par: def.par, retries: s.retries, kills: s.kills, headshots: s.headshots, gunships: s.gunships,
    score, grade, breakdown, failReason: victory ? "" : s.failReason,
    stars: rateMission(def, { victory, seconds, difficulty, retries: s.retries, downs: s.downs ?? 0 }).stars,
    downs: s.downs ?? 0,
    difficulty,
  };
}
