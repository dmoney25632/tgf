/**
 * Snapshot interpolation for remote entities. Samples are (time, values[]);
 * `sample(t)` linearly interpolates the pair around t (angles take the short
 * way round), holds the oldest sample before the buffer, and extrapolates a
 * little past the newest so a late packet doesn't freeze the entity.
 */
export class InterpBuffer {
  private readonly times: Float64Array;
  private readonly values: Float64Array;
  private head = 0; // index of the oldest sample
  private count = 0;
  private readonly angle: boolean[];

  constructor(
    readonly dims: number,
    readonly capacity = 32,
    angleDims: readonly number[] = [],
  ) {
    this.times = new Float64Array(capacity);
    this.values = new Float64Array(capacity * dims);
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
  }

  /** Out-of-order or duplicate timestamps are ignored. */
  push(t: number, v: ArrayLike<number>) {
    if (this.count && t <= this.newestTime) return false;
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
    return true;
  }

  /** Writes the state at time t into `out`. Returns false when empty. */
  sample(t: number, out: number[] | Float64Array | Float32Array, maxExtrapolate = 120) {
    if (!this.count) return false;
    const cap = this.capacity;
    const at = (i: number) => (this.head + i) % cap;
    const first = at(0);
    if (this.count === 1 || t <= this.times[first]) {
      this.copy(first, out);
      return true;
    }
    const last = at(this.count - 1);
    if (t >= this.times[last]) {
      // Extrapolate from the last two samples, capped.
      const prev = at(this.count - 2);
      const span = this.times[last] - this.times[prev];
      const ahead = Math.min(t - this.times[last], maxExtrapolate);
      const k = span > 0 ? ahead / span : 0;
      this.lerp(prev, last, 1 + k, out);
      return true;
    }
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
    return true;
  }

  private copy(i: number, out: number[] | Float64Array | Float32Array) {
    for (let d = 0; d < this.dims; d++) out[d] = this.values[i * this.dims + d];
  }

  private lerp(i: number, j: number, k: number, out: number[] | Float64Array | Float32Array) {
    const D = this.dims;
    for (let d = 0; d < D; d++) {
      const a = this.values[i * D + d];
      let delta = this.values[j * D + d] - a;
      if (this.angle[d]) delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      out[d] = a + delta * k;
    }
  }
}

/**
 * Maps a sender's clock onto ours. offset ≈ senderTime − localTime for the
 * fastest packet seen; it jumps forward on a faster packet and decays slowly
 * so clock drift and route changes are absorbed. renderTime() is then
 * "sender now" minus the interpolation delay, in sender time.
 */
export class ClockSync {
  private offset = 0;
  private primed = false;

  observe(senderTime: number, localNow: number) {
    const sample = senderTime - localNow;
    if (!this.primed || sample > this.offset) {
      this.offset = sample;
      this.primed = true;
    } else {
      this.offset += (sample - this.offset) * 0.01;
    }
  }

  get ready() {
    return this.primed;
  }

  /** Sender clock now (estimate). */
  senderNow(localNow: number) {
    return localNow + this.offset;
  }

  renderTime(localNow: number, delayMs: number) {
    return localNow + this.offset - delayMs;
  }
}
