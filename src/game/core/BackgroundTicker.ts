/**
 * A steady tick for hidden tabs. requestAnimationFrame stops entirely in a
 * background tab and main-thread timers are throttled to ≥1 s (minutes after
 * a while), which would freeze an online host's simulation and make
 * teammates' avatars stall then rubber-band. Timers inside a dedicated
 * worker are not throttled, and its messages are delivered to the hidden
 * page right away, so a tiny blob worker drives the tick. Falls back to a
 * plain interval (throttled, but better than nothing) when workers are
 * unavailable.
 */
export class BackgroundTicker {
  private worker: Worker | null = null;
  private url: string | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly onTick: () => void,
    readonly hz = 30,
  ) {}

  get running() {
    return this.worker !== null || this.interval !== null;
  }

  start() {
    if (this.running) return;
    const ms = Math.max(4, Math.round(1000 / this.hz));
    try {
      if (typeof Worker === "undefined" || typeof Blob === "undefined") throw new Error("no worker");
      if (!this.url) this.url = URL.createObjectURL(new Blob([`setInterval(function(){postMessage(0)},${ms});`], { type: "text/javascript" }));
      const w = new Worker(this.url);
      w.onmessage = () => this.onTick();
      w.onerror = () => {
        this.stop();
        this.interval = setInterval(this.onTick, ms);
      };
      this.worker = w;
    } catch {
      this.interval = setInterval(this.onTick, ms);
    }
  }

  stop() {
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.terminate();
      this.worker = null;
    }
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  dispose() {
    this.stop();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
  }
}
