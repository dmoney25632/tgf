import type { NetTransport, PeerMeta } from "./transport";

/**
 * Main World matchmaking. Hosts of public squads advertise themselves in the
 * presence of one shared directory channel (`coop:WORLD`; the letter O is not
 * a room-code character, so no party can collide with it). "Join World"
 * reads the directory, joins the fullest open squad still in its lobby, or
 * opens a new public squad when none has room.
 */
export const WORLD_CHANNEL = "WORLD";
/** Public squads launch this long after opening (or right away when full). */
export const WORLD_COUNTDOWN_MS = 20_000;
/** How long to listen to the directory before deciding. */
export const WORLD_SCAN_MS = 1_600;

export type WorldListing = {
  /** Host's player id (presence key). */
  id: string;
  code: string;
  players: number;
  status: "lobby" | "playing";
  /** When the listing's lobby opened (ms epoch). */
  openedAt: number;
};

/** Presence payloads must be PeerMeta-shaped for the transports; listings ride along. */
export const listingMeta = (l: WorldListing) => l as unknown as PeerMeta;

export function readListings(t: NetTransport, selfId: string): WorldListing[] {
  return (t.peers() as unknown as Partial<WorldListing>[]).filter(
    (l): l is WorldListing =>
      typeof l.code === "string" && typeof l.id === "string" && l.id !== selfId && typeof l.players === "number" && (l.status === "lobby" || l.status === "playing"),
  );
}

/** Fullest open lobby first (fills squads), then the one that launches soonest. */
export function pickWorldRoom(list: WorldListing[], maxPlayers: number, now = Date.now()): WorldListing | null {
  const open = list.filter((l) => l.status === "lobby" && l.players < maxPlayers && now - l.openedAt < WORLD_COUNTDOWN_MS - 2_000);
  open.sort((a, b) => b.players - a.players || a.openedAt - b.openedAt);
  return open[0] ?? null;
}
