/**
 * Snapshot interpolation for remote entities. Samples are (time, values[]);
 * `sample(t)` linearly interpolates the pair around t (angles take the short
 * way round), holds the oldest sample before the buffer, and extrapolates a
 * little past the newest so a late packet doesn't freeze the entity.
 *
 * Late-packet correction: when a sample arrives while we were extrapolating,
 * the path jumps (the guess was wrong). Instead of popping, the difference
 * at the last sampled time is kept as a correction that decays over
 * `smoothMs`, so the entity glides back onto the true path.
 */
export class InterpBuffer {
  private readonly times: Float64Array;
  private readonly values: Float64Array;
  private head = 0; // index of the oldest sample
  private count = 0;
  private readonly angle: boolean[];
  /** Decaying visual correction per dimension (late-packet smoothing). */
  private readonly corr: Float64Array;
  private readonly scratchA: Float64Array;
  private readonly scratchB: Float64Array;
  private lastT = -Infinity;
  private lastMaxExtrapolate = 120;
  private hasCorr = false;
  /** True when the most recent sample() extrapolated past the newest sample. */
  extrapolated = false;

  constructor(
    readonly dims: number,
    readonly capacity = 32,
    angleDims: readonly number[] = [],
    /** Correction time constant (sender ms). */
    readonly smoothMs = 90,
    /** Corrections larger than this (any dim) are applied instantly (teleport). */
    readonly maxCorrection = 2.5,
    /** A gap longer than this between samples restarts the buffer (respawn / reconnect). */
    readonly gapResetMs = 1500,
  ) {
    this.times = new Float64Array(capacity);
    this.values = new Float64Array(capacity * dims);
    this.corr = new Float64Array(dims);
    this.scratchA = new Float64Array(dims);
    this.scratchB = new Float64Array(dims);
    this.angle = Array.from({ length: dims }, (_, i) => angleDims.includes(i));
  }

  get size() {
    return this.count;
  }

  get newestTime() {
    return this.count ? this.times[(this.head + this.count - 1) % this.capacity] : -Infinity;
  }

  clear() {
    this.head = this.count = 0;
    this.corr.fill(0);
    this.hasCorr = false;
    this.lastT = -Infinity;
    this.extrapolated = false;
  }

  /** Out-of-order or duplicate timestamps are ignored. */
  push(t: number, v: ArrayLike<number>) {
    if (this.count && t <= this.newestTime) return false;
    if (this.count && t - this.newestTime > this.gapResetMs) this.clear();
    // Were we showing an extrapolated guess? Remember it to blend from.
    const wasAhead = this.count >= 2 && this.lastT > this.newestTime;
    if (wasAhead) this.raw(this.lastT, this.scratchA, this.lastMaxExtrapolate);

    let idx: number;
    if (this.count < this.capacity) {
      idx = (this.head + this.count) % this.capacity;
      this.count++;
    } else {
      idx = this.head;
      this.head = (this.head + 1) % this.capacity;
    }
    this.times[idx] = t;
    for (let d = 0; d < this.dims; d++) this.values[idx * this.dims + d] = v[d];

    if (wasAhead) {
      this.raw(this.lastT, this.scratchB, this.lastMaxExtrapolate);
      let big = false;
      for (let d = 0; d < this.dims; d++) {
        let delta = this.scratchA[d] - this.scratchB[d];
        if (this.angle[d]) delta = wrap(delta);
        const c = this.corr[d] + delta;
        if (Math.abs(c) > this.maxCorrection) big = true;
        this.corr[d] = c;
      }
      if (big) this.corr.fill(0);
      this.hasCorr = !big;
    }
    return true;
  }

  /** Writes the state at time t into `out`. Returns false when empty. */
  sample(t: number, out: number[] | Float64Array | Float32Array, maxExtrapolate = 120) {
    if (!this.count) return false;
    // Decay the correction with (sender) time; a clock that runs backwards resets it.
    if (this.hasCorr) {
      if (t < this.lastT) {
        this.corr.fill(0);
        this.hasCorr = false;
      } else if (t > this.lastT) {
        const k = Math.exp(-(t - this.lastT) / this.smoothMs);
        let any = false;
        for (let d = 0; d < this.dims; d++) {
          const c = this.corr[d] * k;
          this.corr[d] = Math.abs(c) < 1e-4 ? 0 : c;
          if (this.corr[d] !== 0) any = true;
        }
        this.hasCorr = any;
      }
    }
    this.lastT = t;
    this.lastMaxExtrapolate = maxExtrapolate;
    this.raw(t, out, maxExtrapolate);
    if (this.hasCorr) for (let d = 0; d < this.dims; d++) out[d] += this.corr[d];
    return true;
  }

  /** Uncorrected interpolation / capped extrapolation at t. */
  private raw(t: number, out: number[] | Float64Array | Float32Array, maxExtrapolate: number) {
    const cap = this.capacity;
    const at = (i: number) => (this.head + i) % cap;
    const first = at(0);
    if (this.count === 1 || t <= this.times[first]) {
      this.extrapolated = this.count === 1 && t > this.times[first];
      this.copy(first, out);
      return;
    }
    const last = at(this.count - 1);
    if (t >= this.times[last]) {
      // Extrapolate from the last two samples, capped.
      this.extrapolated = t > this.times[last];
      const prev = at(this.count - 2);
      const span = this.times[last] - this.times[prev];
      const ahead = Math.min(t - this.times[last], maxExtrapolate);
      const k = span > 0 ? ahead / span : 0;
      this.lerp(prev, last, 1 + k, out);
      return;
    }
    this.extrapolated = false;
    // Binary search for the bracketing pair.
    let lo = 0, hi = this.count - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.times[at(mid)] <= t) lo = mid;
      else hi = mid;
    }
    const a = at(lo), b = at(hi);
    const k = (t - this.times[a]) / (this.times[b] - this.times[a]);
    this.lerp(a, b, k, out);
  }

  private copy(i: number, out: number[] | Float64Array | Float32Array) {
    for (let d = 0; d < this.dims; d++) out[d] = this.values[i * this.dims + d];
  }

  private lerp(i: number, j: number, k: number, out: number[] | Float64Array | Float32Array) {
    const D = this.dims;
    for (let d = 0; d < D; d++) {
      const a = this.values[i * D + d];
      let delta = this.values[j * D + d] - a;
      if (this.angle[d]) delta = wrap(delta);
      out[d] = a + delta * k;
    }
  }
}

function wrap(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * Maps a sender's clock onto ours and runs a smooth playback clock for
 * interpolation (an adaptive jitter buffer).
 *
 * - offset ≈ senderTime − arrivalTime of the *fastest* packet seen (it jumps
 *   forward on a faster packet and decays slowly toward slower ones, so drift
 *   and route changes are absorbed).
 * - `late` tracks how much later than that fastest path packets typically
 *   arrive (fast attack, slow release ≈ a high percentile of the jitter), and
 *   `interval` the sender's packet spacing. The render delay is
 *   max(floor, interval + late + margin): just enough that the newest sample
 *   is almost always ahead of the render time, so we interpolate instead of
 *   extrapolating and snapping back.
 * - renderTime() never jumps: the playback clock follows the target by
 *   speeding up / slowing down by at most ±`maxWarp` (inaudible/invisible
 *   time warp), and only hard-resyncs when it is far off (reconnect, stall).
 */
export class ClockSync {
  private offset = 0;
  private primed = false;
  private late = 0;
  private interval = 0;
  private lastSender = -Infinity;
  private lastArrival = -Infinity;
  // Playback clock (sender time) and the local time it was last advanced.
  private play = 0;
  private playAt = 0;
  private playing = false;

  constructor(
    /** Max playback speed change while catching up (fraction of real time). */
    readonly maxWarp = 0.1,
    /** Error below this follows over ~`followMs`; above `resyncMs` snaps. */
    readonly followMs = 400,
    readonly resyncMs = 400,
    /** Hard cap on the adaptive delay. */
    readonly maxDelayMs = 450,
  ) {}

  observe(senderTime: number, localNow: number) {
    // A long silence (background tab, reconnect): start over.
    if (this.primed && localNow - this.lastArrival > 2500) {
      this.primed = false;
      this.playing = false;
      this.late = 0;
      this.interval = 0;
      this.lastSender = -Infinity;
    }
    this.lastArrival = localNow;
    const sample = senderTime - localNow;
    if (!this.primed || sample > this.offset) {
      this.offset = sample;
      this.primed = true;
    } else {
      this.offset += (sample - this.offset) * 0.01;
    }
    const lateness = this.offset - sample;
    this.late += (lateness - this.late) * (lateness > this.late ? 0.3 : 0.02);
    if (senderTime > this.lastSender) {
      const iv = senderTime - this.lastSender;
      if (iv < 1000) this.interval = this.interval ? this.interval + (iv - this.interval) * 0.1 : iv;
      this.lastSender = senderTime;
    }
  }

  get ready() {
    return this.primed;
  }

  /** Typical lateness beyond the fastest path (ms, diagnostics). */
  get jitterMs() {
    return this.late;
  }

  /** Smoothed sender packet interval (ms). */
  get intervalMs() {
    return this.interval;
  }

  /** Sender clock now (estimate). */
  senderNow(localNow: number) {
    return localNow + this.offset;
  }

  /** Render delay for a given floor: the floor, raised when the link is jittery. */
  delayFor(minDelayMs: number) {
    const adaptive = this.interval + this.late * 1.0 + 10;
    return Math.min(this.maxDelayMs, Math.max(minDelayMs, adaptive));
  }

  /**
   * Sender-clock time to render at. `delayMs` is the minimum buffer; the
   * effective delay grows with measured jitter. Monotonic and smooth.
   */
  renderTime(localNow: number, delayMs: number) {
    const target = localNow + this.offset - this.delayFor(delayMs);
    if (!this.playing) {
      this.playing = true;
      this.play = target;
      this.playAt = localNow;
      return target;
    }
    const elapsed = localNow - this.playAt;
    if (elapsed <= 0) return this.play;
    const predicted = this.play + elapsed;
    const err = target - predicted;
    if (Math.abs(err) > this.resyncMs) {
      this.play = target;
    } else {
      const step = err * Math.min(1, elapsed / this.followMs);
      const cap = elapsed * this.maxWarp;
      this.play = predicted + Math.max(-cap, Math.min(cap, step));
    }
    this.playAt = localNow;
    return this.play;
  }
}
