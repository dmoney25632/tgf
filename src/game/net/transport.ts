import type { DifficultyId, OperatorId, WaveTarget } from "../survival/config";
import type { WeaponId } from "../weapons/weapons";
import type { CharacterLook } from "../character";

/** Host-picked match settings, published in the host's presence payload. */
export type RoomSettings = {
  mapId: string;
  difficulty: DifficultyId;
  waveTarget: WaveTarget;
  startWave: number;
};

export type RosterEntry = { id: string; name: string; slot: number; operator: OperatorId; look?: CharacterLook };

/** One player's presence payload (lobby roster + in-match liveness). */
export type PeerMeta = {
  /** Auth user id (stable across reconnects). */
  id: string;
  /** Callsign (profiles are not readable cross-user, so it travels here). */
  name: string;
  host: boolean;
  ready: boolean;
  operator: OperatorId;
  primary: WeaponId;
  secondary: WeaponId;
  /** Custom appearance from the character page (validated on receipt). */
  look?: CharacterLook;
  /** Public Main World room (matchmaking lists it). */
  public?: boolean;
  joinedAt: number;
  /** Host only. */
  room?: RoomSettings & { status: "lobby" | "playing"; roster?: RosterEntry[]; matchId?: string };
};

export type TransportStatus = "connecting" | "connected" | "reconnecting" | "closed" | "error";

/** Every broadcast event name the game uses (Realtime bindings must exist before subscribe). */
export const NET_EVENTS = ["s", "snap", "launch", "bye"] as const;
export type NetEvent = (typeof NET_EVENTS)[number];

/**
 * What the co-op layer needs from a network: fire-and-forget broadcast to
 * everyone else in the room, plus a presence roster. Implemented by Supabase
 * Realtime (production) and a BroadcastChannel loopback (dev, two tabs).
 */
export interface NetTransport {
  readonly kind: "supabase" | "local";
  readonly selfId: string;
  readonly status: TransportStatus;
  connect(): Promise<void>;
  /** Broadcast to every other peer (never echoed back to the sender). */
  send(event: NetEvent, payload: unknown): void;
  on(event: NetEvent, cb: (payload: unknown) => void): () => void;
  /** Publish / update our presence payload. */
  track(meta: PeerMeta): void;
  /** Current roster including ourselves. */
  peers(): PeerMeta[];
  onPresence(cb: (peers: PeerMeta[]) => void): () => void;
  onStatus(cb: (s: TransportStatus, detail?: string) => void): () => void;
  close(): void;
}

/** Small shared event-hub used by both transports. */
export class Emitter {
  private readonly handlers = new Map<string, Set<(p: unknown) => void>>();
  on(event: string, cb: (p: unknown) => void) {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(cb);
    return () => set!.delete(cb);
  }
  emit(event: string, payload: unknown) {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const cb of [...set]) {
      try {
        cb(payload);
      } catch (e) {
        console.error(`[coop] handler for "${event}" failed`, e);
      }
    }
  }
  clear() {
    this.handlers.clear();
  }
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 5;

export function makeRoomCode(rand: () => number = Math.random) {
  let s = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) s += CODE_CHARS[Math.floor(rand() * CODE_CHARS.length)];
  return s;
}

/** Normalises user input ("k7qx-2" → "K7QX2"); null when it can't be a code. */
export function normalizeRoomCode(input: string) {
  const s = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of s) if (!CODE_CHARS.includes(ch)) return null;
  return s;
}
