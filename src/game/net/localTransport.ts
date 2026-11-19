import { Emitter, NET_EVENTS, type NetEvent, type NetTransport, type PeerMeta, type TransportStatus } from "./transport";

type Wire =
  | { t: "msg"; from: string; event: NetEvent; payload: unknown }
  | { t: "presence"; meta: PeerMeta }
  | { t: "leave"; id: string };

export type LocalTransportOptions = {
  /** Simulated one-way latency (ms) and ± jitter, to exercise interpolation. */
  latencyMs?: number;
  jitterMs?: number;
  /** Drop this fraction of game messages (0..1). */
  loss?: number;
};

const HEARTBEAT_MS = 1000;
const PRESENCE_TIMEOUT_MS = 3500;

/**
 * DEV ONLY loopback transport: a BroadcastChannel between tabs of the same
 * browser stands in for Supabase Realtime, so co-op can be tested without a
 * project. Presence is emulated with heartbeats. Enabled by /coop when
 * Supabase isn't configured (or with ?transport=local) outside production.
 */
export class LocalTransport implements NetTransport {
  readonly kind = "local" as const;
  status: TransportStatus = "connecting";
  private bc: BroadcastChannel | null = null;
  private readonly events = new Emitter();
  private readonly presence = new Emitter();
  private readonly statusHub = new Emitter();
  private readonly others = new Map<string, { meta: PeerMeta; seen: number }>();
  private meta: PeerMeta | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly onUnload = () => this.close();

  constructor(
    readonly selfId: string,
    readonly roomCode: string,
    private readonly opts: LocalTransportOptions = {},
  ) {}

  async connect() {
    this.bc = new BroadcastChannel(`tgf-coop:${this.roomCode}`);
    this.bc.onmessage = (e: MessageEvent<Wire>) => this.receive(e.data);
    this.timer = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
    window.addEventListener("pagehide", this.onUnload);
    this.status = "connected";
    this.statusHub.emit("status", { s: "connected" });
    this.heartbeat();
  }

  private receive(w: Wire) {
    if (!w || typeof w !== "object") return;
    if (w.t === "presence") {
      const isNew = !this.others.has(w.meta.id);
      this.others.set(w.meta.id, { meta: w.meta, seen: performance.now() });
      this.syncPresence();
      // Answer newcomers right away so they see us without waiting a beat.
      if (isNew) this.post({ t: "presence", meta: this.meta! });
    } else if (w.t === "leave") {
      if (this.others.delete(w.id)) this.syncPresence();
    } else if (w.t === "msg" && (NET_EVENTS as readonly string[]).includes(w.event)) {
      const { latencyMs = 0, jitterMs = 0, loss = 0 } = this.opts;
      if (loss > 0 && (w.event === "s" || w.event === "snap") && Math.random() < loss) return;
      const delay = latencyMs + (Math.random() * 2 - 1) * jitterMs;
      if (delay > 0) setTimeout(() => this.events.emit(w.event, w.payload), delay);
      else this.events.emit(w.event, w.payload);
    }
  }

  private heartbeat() {
    const now = performance.now();
    let changed = false;
    for (const [id, p] of this.others) {
      if (now - p.seen > PRESENCE_TIMEOUT_MS) {
        this.others.delete(id);
        changed = true;
      }
    }
    if (this.meta) this.post({ t: "presence", meta: this.meta });
    if (changed) this.syncPresence();
  }

  private syncPresence() {
    this.presence.emit("sync", this.peers());
  }

  private post(w: Wire) {
    if (!this.bc || (w.t === "presence" && !w.meta)) return;
    try {
      this.bc.postMessage(w);
    } catch {
      // Channel closed mid-teardown.
    }
  }

  send(event: NetEvent, payload: unknown) {
    this.post({ t: "msg", from: this.selfId, event, payload });
  }

  on(event: NetEvent, cb: (payload: unknown) => void) {
    return this.events.on(event, cb);
  }

  track(meta: PeerMeta) {
    this.meta = meta;
    this.post({ t: "presence", meta });
    this.syncPresence();
  }

  peers(): PeerMeta[] {
    const list = [...this.others.values()].map((p) => p.meta);
    if (this.meta) list.push(this.meta);
    return list;
  }

  onPresence(cb: (peers: PeerMeta[]) => void) {
    return this.presence.on("sync", (p) => cb(p as PeerMeta[]));
  }

  onStatus(cb: (s: TransportStatus, detail?: string) => void) {
    return this.statusHub.on("status", (p) => {
      const { s, detail } = p as { s: TransportStatus; detail?: string };
      cb(s, detail);
    });
  }

  close() {
    if (!this.bc) return;
    this.post({ t: "leave", id: this.selfId });
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    window.removeEventListener("pagehide", this.onUnload);
    this.bc.close();
    this.bc = null;
    this.events.clear();
    this.presence.clear();
    this.status = "closed";
    this.statusHub.emit("status", { s: "closed" });
    this.statusHub.clear();
  }
}
