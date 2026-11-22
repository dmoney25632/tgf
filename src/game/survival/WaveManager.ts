import { WAVES, type EnemyType, type WaveTarget } from "./config";
import { PACING, planWave, type SquadRole, type WaveKind, type WavePlan } from "./waves";

export type WavePhase = "prematch" | "combat" | "intermission" | "victory" | "defeat";

/** One enemy the mode should place now, from a sector. */
export type SpawnRequest = { type: EnemyType; sector: number; squad: number };

export type WaveEvent =
  /** A squad will arrive in `eta` seconds. */
  | { kind: "incoming"; squad: number; role: SquadRole; sector: number; eta: number; size: number }
  /** The next squad was pulled forward because the field went quiet. */
  | { kind: "pulledIn"; squad: number; role: SquadRole; sector: number; eta: number; size: number }
  /** Holdout timer ran out: squads not yet in are called off. */
  | { kind: "holdComplete"; dropped: number };

/** An upcoming (or arriving) squad, for the HUD and the radar. */
export type IncomingSquad = { squad: number; role: SquadRole; sector: number; eta: number; size: number };

type SquadState = {
  role: SquadRole;
  sector: number;
  at: number;
  /** Members still to place (spawned from the end). */
  pending: EnemyType[];
  warned: boolean;
  spawnTimer: number;
};

/**
 * Wave progression: prematch countdown → combat (squads released on the
 * wave's timeline, members placed under an alive cap) → intermission
 * (shop) → next wave … until the target wave is cleared (victory) or the
 * team wipes (defeat). Holdout waves end their timeline when the hold timer
 * runs out. No three.js: the mode turns SpawnRequests into soldiers.
 */
export class WaveManager {
  phase: WavePhase = "prematch";
  wave = 0;
  timer: number = WAVES.firstDelay;
  /** Enemies still to spawn this wave (all squads). Clients mirror `remaining` through it. */
  readonly queue: EnemyType[] = [];
  total = 0;
  killed = 0;
  /** Seconds since the wave opened. */
  clock = 0;
  kind: WaveKind = "standard";
  title = "";
  /** Holdout seconds left (0 when not a holdout or the hold is over). */
  holdLeft = 0;
  plan: WavePlan | null = null;
  private squads: SquadState[] = [];

  constructor(
    readonly target: WaveTarget,
    private readonly countMul: number,
    /** Fighters on the player side (humans + bots weighted); 1 = solo. */
    public team: number,
    startWave = 1,
    public sectors = 1,
    private readonly rng: () => number = Math.random,
  ) {
    this.wave = startWave - 1;
  }

  /** Remaining = still queued + alive on the field. */
  remaining(alive: number) {
    return this.queue.length + alive;
  }

  get final() {
    return this.target !== 0 && this.wave >= this.target;
  }

  startNextWave() {
    this.wave++;
    this.phase = "combat";
    const plan = planWave(this.wave, { countMul: this.countMul, team: this.team, sectors: this.sectors, rng: this.rng });
    this.plan = plan;
    this.kind = plan.kind;
    this.title = plan.title;
    this.holdLeft = plan.hold;
    this.clock = 0;
    this.squads = plan.squads.map((s) => ({ role: s.role, sector: s.sector, at: s.at, pending: [...s.members].reverse(), warned: false, spawnTimer: 0 }));
    this.queue.length = 0;
    for (const s of plan.squads) this.queue.push(...s.members);
    this.total = this.queue.length;
    this.killed = 0;
  }

  /** Max enemies alive at once for this wave and quality. */
  aliveCap(qualityCap: number) {
    return Math.min(qualityCap, Math.round(WAVES.aliveBase + this.wave * WAVES.alivePerWave + (this.team - 1) * WAVES.alivePerTeammate));
  }

  /**
   * Advance the combat timeline. Returns who to spawn now (already removed
   * from the queue) and HUD-worthy events.
   */
  update(dt: number, alive: number, cap: number): { spawns: SpawnRequest[]; events: WaveEvent[] } {
    const spawns: SpawnRequest[] = [];
    const events: WaveEvent[] = [];
    if (this.phase !== "combat") return { spawns, events };
    this.clock += dt;

    // Holdout: when the timer runs out, squads still on the way are called off.
    if (this.holdLeft > 0) {
      this.holdLeft = Math.max(0, this.holdLeft - dt);
      if (this.holdLeft === 0) {
        let dropped = 0;
        for (const s of this.squads) {
          if (s.at > this.clock) {
            dropped += s.pending.length;
            for (const t of s.pending) this.unqueue(t);
            s.pending.length = 0;
          }
        }
        events.push({ kind: "holdComplete", dropped });
      }
    }

    // Holdout: reinforcements keep coming until the timer runs out.
    if (this.holdLeft > 6 && !this.squads.some((s) => s.pending.length)) this.reinforce();

    // Field gone quiet: pull the next squad in (keeps the pace without floods).
    const next = this.squads.find((s) => s.at > this.clock && s.pending.length);
    const spawning = this.squads.some((s) => s.at <= this.clock && s.pending.length);
    if (next && !spawning && alive <= PACING.pullInAlive * Math.ceil(this.team) && next.at - this.clock > PACING.pullInTo) {
      const shift = next.at - this.clock - PACING.pullInTo;
      for (const s of this.squads) if (s.at >= next.at) s.at -= shift;
      next.warned = true;
      events.push({ kind: "pulledIn", squad: this.squads.indexOf(next), role: next.role, sector: next.sector, eta: next.at - this.clock, size: next.pending.length });
    }

    let placed = alive;
    this.squads.forEach((s, i) => {
      if (!s.pending.length) return;
      const eta = s.at - this.clock;
      if (!s.warned && eta <= PACING.warn) {
        s.warned = true;
        events.push({ kind: "incoming", squad: i, role: s.role, sector: s.sector, eta: Math.max(0, eta), size: s.pending.length });
      }
      if (eta > 0) return;
      s.spawnTimer -= dt;
      // Members file in a beat apart, under the alive cap.
      while (s.pending.length && s.spawnTimer <= 0 && placed < cap) {
        const type = s.pending.pop()!;
        this.unqueue(type);
        spawns.push({ type, sector: s.sector, squad: i });
        placed++;
        s.spawnTimer += WAVES.memberInterval * (0.7 + this.rng() * 0.6);
      }
      if (s.spawnTimer < 0) s.spawnTimer = 0;
    });
    return { spawns, events };
  }

  /** Holdout: schedule one more squad a few seconds out, from a new direction. */
  private reinforce() {
    const last = this.squads[this.squads.length - 1];
    const rush = this.wave >= 4 && this.rng() < 0.4;
    const n = 3 + Math.floor(this.rng() * (rush ? 2 : 3));
    const members: EnemyType[] = Array(n).fill(rush ? "rusher" : "rifleman");
    let sector = Math.floor(this.rng() * this.sectors);
    if (this.sectors > 1 && last && sector === last.sector) sector = (sector + 1) % this.sectors;
    const at = this.clock + Math.max(PACING.pullInTo + 1, 9 - this.wave * 0.2);
    this.squads.push({ role: rush ? "rush" : "rifle", sector, at, pending: [...members], warned: false, spawnTimer: 0 });
    this.queue.push(...members);
    this.total += n;
  }

  /** Squads arriving within `window` seconds (or arriving now). */
  incoming(window: number = PACING.warn, out: IncomingSquad[] = []) {
    out.length = 0;
    this.squads.forEach((s, i) => {
      if (!s.pending.length) return;
      const eta = s.at - this.clock;
      if (eta <= window) out.push({ squad: i, role: s.role, sector: s.sector, eta: Math.max(0, eta), size: s.pending.length });
    });
    return out;
  }

  /** Seconds until the next squad that hasn't started arriving (Infinity if none). */
  get nextSquadIn() {
    let t = Infinity;
    for (const s of this.squads) if (s.pending.length && s.at > this.clock) t = Math.min(t, s.at - this.clock);
    return t;
  }

  /** Put an enemy back (no valid spawn point this frame). */
  requeue(r: SpawnRequest) {
    const s = this.squads[r.squad];
    if (!s) return;
    s.pending.push(r.type);
    this.queue.push(r.type);
    s.spawnTimer = 0.5;
  }

  /** A fast-rope trooper lands: take a foot soldier from the latest squad still to come. */
  takeTrooper(): EnemyType | null {
    for (let i = this.squads.length - 1; i >= 0; i--) {
      const p = this.squads[i].pending;
      let k = p.indexOf("rifleman");
      if (k < 0) k = p.indexOf("rusher");
      if (k < 0) continue;
      const [t] = p.splice(k, 1);
      this.unqueue(t);
      return t;
    }
    return null;
  }

  private unqueue(t: EnemyType) {
    const k = this.queue.lastIndexOf(t);
    if (k >= 0) this.queue.splice(k, 1);
    else this.queue.pop();
  }

  beginIntermission() {
    this.phase = "intermission";
    this.timer = this.kind === "boss" ? WAVES.intermissionAfterBoss : WAVES.intermission;
    this.squads = [];
    this.holdLeft = 0;
  }

  skip() {
    if (this.phase === "intermission" || this.phase === "prematch") this.timer = Math.min(this.timer, 0.01);
  }
}
