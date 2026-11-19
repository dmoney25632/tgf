import { composeWave, WAVES, type EnemyType, type WaveTarget } from "./config";

export type WavePhase = "prematch" | "combat" | "intermission" | "victory" | "defeat";

/**
 * Wave progression: prematch countdown → combat (spawn queue drains into
 * the field under an alive cap) → intermission (shop) → next wave … until
 * the target wave is cleared (victory) or the team wipes (defeat).
 */
export class WaveManager {
  phase: WavePhase = "prematch";
  wave = 0;
  timer: number = WAVES.firstDelay;
  /** Enemies still to spawn this wave. */
  readonly queue: EnemyType[] = [];
  total = 0;
  killed = 0;
  spawnTimer = 0;

  constructor(
    readonly target: WaveTarget,
    private readonly countMul: number,
    private readonly squadSize: number,
    startWave = 1,
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
    const comp = composeWave(this.wave, this.countMul, this.squadSize);
    this.queue.length = 0;
    // Interleave: heavies and specials appear through the wave, not all at once.
    const types = Object.keys(comp) as EnemyType[];
    for (const t of types) for (let i = 0; i < comp[t]; i++) this.queue.push(t);
    for (let i = this.queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
    }
    // The boss walks in a little after the wave opens. The queue spawns from
    // the end (pop), so "fifth to spawn" sits four slots from the tail.
    const w = this.queue.indexOf("warden");
    if (w >= 0) {
      this.queue.splice(w, 1);
      this.queue.splice(Math.max(0, this.queue.length - 4), 0, "warden");
    }
    this.total = this.queue.length;
    this.killed = 0;
    this.spawnTimer = 1;
  }

  /** Max enemies alive at once for this wave and quality. */
  aliveCap(qualityCap: number) {
    return Math.min(qualityCap, Math.round(WAVES.aliveBase + this.wave * WAVES.alivePerWave));
  }

  beginIntermission() {
    this.phase = "intermission";
    this.timer = WAVES.intermission;
  }

  skip() {
    if (this.phase === "intermission" || this.phase === "prematch") this.timer = Math.min(this.timer, 0.01);
  }
}
