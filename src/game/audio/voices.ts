/**
 * Pure audio bookkeeping (no Web Audio here, so it unit-tests in Node):
 * voice limiting / stealing / throttling, distance models and the master
 * soft-clip curve. Sfx.ts owns the actual nodes.
 */

export type StealPolicy = "oldest" | "quietest";

export type VoiceRule = {
  /** Max voices of this category sounding at once. */
  max: number;
  /** Min seconds between two starts of this category (repeat throttle). */
  minInterval: number;
  /** Multiplies the level when ranking voices for the global cap. */
  priority: number;
  /**
   * "oldest": a new voice always replaces the oldest of its category (player
   * gunfire: the newest shot is what matters). "quietest": it only replaces a
   * quieter one, otherwise it is dropped (distant enemy fire).
   */
  steal: StealPolicy;
};

type Entry<T> = { id: number; cat: string; at: number; end: number; score: number; handle: T };

export type Grant<T> = { id: number; stolen: T[] };

export class VoiceAllocator<T> {
  private entries: Entry<T>[] = [];
  private readonly last = new Map<string, number>();
  private nextId = 1;
  private readonly rules: Record<string, VoiceRule>;
  private readonly globalMax: number;

  constructor(rules: Record<string, VoiceRule>, globalMax: number) {
    this.rules = rules;
    this.globalMax = globalMax;
  }

  /** Forget voices whose scheduled end has passed. */
  prune(now: number) {
    if (this.entries.some((e) => e.end <= now)) this.entries = this.entries.filter((e) => e.end > now);
  }

  /**
   * Ask for a voice of `cat` starting at `at`, lasting until `end`, at `level`
   * (0..1+, linear). Returns null when throttled or there is no room for it;
   * otherwise its id plus the handles the caller must fade out and free.
   */
  request(cat: string, at: number, end: number, level: number, handle: T): Grant<T> | null {
    const rule = this.rules[cat] ?? DEFAULT_RULE;
    const prev = this.last.get(cat);
    if (prev !== undefined && Math.abs(at - prev) < rule.minInterval) return null;
    this.prune(at);

    const score = level * rule.priority;
    const stolen: Entry<T>[] = [];

    const same = this.entries.filter((e) => e.cat === cat);
    if (same.length >= rule.max) {
      const victim = rule.steal === "oldest" ? oldest(same) : quietest(same);
      if (rule.steal === "quietest" && victim.score >= score) return null;
      stolen.push(victim);
    }

    if (this.entries.length - stolen.length >= this.globalMax) {
      const pool = this.entries.filter((e) => !stolen.includes(e));
      const victim = quietest(pool);
      if (victim.score >= score) return null;
      stolen.push(victim);
    }

    if (stolen.length) this.entries = this.entries.filter((e) => !stolen.includes(e));
    const id = this.nextId++;
    this.entries.push({ id, cat, at, end, score, handle });
    this.last.set(cat, at);
    return { id, stolen: stolen.map((e) => e.handle) };
  }

  /** The voice finished on its own (or was faded out by the caller). */
  release(id: number) {
    const i = this.entries.findIndex((e) => e.id === id);
    if (i >= 0) this.entries.splice(i, 1);
  }

  count(cat?: string) {
    return cat === undefined ? this.entries.length : this.entries.filter((e) => e.cat === cat).length;
  }

  /** Drop everything (dispose); returns the handles still sounding. */
  clear(): T[] {
    const h = this.entries.map((e) => e.handle);
    this.entries = [];
    this.last.clear();
    return h;
  }
}

const DEFAULT_RULE: VoiceRule = { max: 4, minInterval: 0, priority: 1, steal: "oldest" };

function oldest<T>(list: Entry<T>[]) {
  return list.reduce((a, b) => (b.at < a.at ? b : a));
}

function quietest<T>(list: Entry<T>[]) {
  return list.reduce((a, b) => (b.score < a.score || (b.score === a.score && b.at < a.at) ? b : a));
}

// ---------------------------------------------------------------------------
// Distance
// ---------------------------------------------------------------------------

/** Same curve as PannerNode's "inverse" distance model. */
export function distanceGain(d: number, ref: number, rolloff: number) {
  const dd = Math.max(d, ref);
  return ref / (ref + rolloff * (dd - ref));
}

/** Air absorption: lowpass cutoff (Hz) for a source `d` metres away. */
export function distanceCutoff(d: number) {
  return Math.max(900, Math.min(20000, 20000 * Math.exp(-Math.max(0, d - 4) / 38)));
}

/** Speed-of-sound arrival delay (s), capped so far fights don't feel laggy. */
export function arrivalDelay(d: number, cap = 0.3) {
  return Math.min(cap, Math.max(0, d) / 343);
}

// ---------------------------------------------------------------------------
// Master safety
// ---------------------------------------------------------------------------

/**
 * WaveShaper curve: exactly linear up to `knee`, then a tanh shoulder that
 * reaches ±1 asymptotically. Output can never exceed full scale, so nothing
 * hard-clips at the DAC even if every bus peaks at once.
 */
export function softClipCurve(n = 4096, knee = 0.85) {
  const c = new Float32Array(n);
  const room = 1 - knee;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + room * Math.tanh((a - knee) / room);
    c[i] = Math.sign(x) * y;
  }
  return c;
}

/** dB → linear gain. */
export function dbToGain(db: number) {
  return Math.pow(10, db / 20);
}
