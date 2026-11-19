import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { Emitter, NET_EVENTS, type NetEvent, type NetTransport, type PeerMeta, type TransportStatus } from "./transport";

/**
 * Private channels: Realtime checks RLS on realtime.messages (migration
 * 20261119110000_realtime_coop_channels.sql allows authenticated users on
 * 'coop:*'). Flip to false only to debug against a project without that
 * migration (and with public Realtime access enabled).
 */
export const COOP_PRIVATE_CHANNELS = true;

/**
 * Supabase Realtime transport: Broadcast for game traffic, Presence for the
 * roster, on topic `coop:<roomCode>`. supabase-js rejoins the channel by
 * itself after a socket drop; we surface that as "reconnecting".
 */
export class SupabaseTransport implements NetTransport {
  readonly kind = "supabase" as const;
  status: TransportStatus = "connecting";
  private channel: RealtimeChannel | null = null;
  private readonly events = new Emitter();
  private readonly presence = new Emitter();
  private readonly statusHub = new Emitter();
  private meta: PeerMeta | null = null;
  private roster: PeerMeta[] = [];
  private joined = false;

  constructor(
    private readonly client: SupabaseClient,
    readonly selfId: string,
    readonly roomCode: string,
  ) {}

  async connect() {
    // Private channels authorize with the user's JWT, so hand it over first.
    const { data } = await this.client.auth.getSession();
    if (data.session?.access_token) await this.client.realtime.setAuth(data.session.access_token);

    const ch = this.client.channel(`coop:${this.roomCode}`, {
      config: {
        private: COOP_PRIVATE_CHANNELS,
        broadcast: { self: false, ack: false },
        presence: { key: this.selfId, enabled: true },
      },
    });
    for (const ev of NET_EVENTS) ch.on("broadcast", { event: ev }, (m) => this.events.emit(ev, m.payload));
    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState<PeerMeta>();
      this.roster = Object.values(state)
        .map((list) => list[list.length - 1])
        .filter((m): m is PeerMeta & { presence_ref: string } => Boolean(m && m.id));
      this.presence.emit("sync", this.roster);
    });
    this.channel = ch;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      ch.subscribe((status, err) => {
        if (status === "SUBSCRIBED") {
          this.joined = true;
          this.setStatus("connected");
          if (this.meta) void ch.track(this.meta);
          if (!settled) {
            settled = true;
            resolve();
          }
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          this.joined = false;
          this.setStatus(settled ? "reconnecting" : "error", err?.message);
          if (!settled) {
            settled = true;
            reject(new Error(err?.message || `Realtime ${status.toLowerCase()}`));
          }
        } else if (status === "CLOSED") {
          this.joined = false;
          this.setStatus("closed");
        }
      });
    });
  }

  private setStatus(s: TransportStatus, detail?: string) {
    this.status = s;
    this.statusHub.emit("status", { s, detail });
  }

  send(event: NetEvent, payload: unknown) {
    // Before the join completes supabase-js would fall back to REST; skip instead.
    if (!this.channel || !this.joined) return;
    void this.channel.send({ type: "broadcast", event, payload });
  }

  on(event: NetEvent, cb: (payload: unknown) => void) {
    return this.events.on(event, cb);
  }

  track(meta: PeerMeta) {
    this.meta = meta;
    if (this.channel && this.joined) void this.channel.track(meta);
  }

  peers() {
    return this.roster;
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
    const ch = this.channel;
    this.channel = null;
    this.joined = false;
    if (ch) {
      void ch.untrack().catch(() => {});
      void this.client.removeChannel(ch);
    }
    this.events.clear();
    this.presence.clear();
    this.setStatus("closed");
    this.statusHub.clear();
  }
}
