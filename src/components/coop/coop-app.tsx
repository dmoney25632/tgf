"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DIFFICULTY, OPERATORS, OPERATOR_IDS, type DifficultyId, type OperatorId } from "@/game/survival/config";
import { PRIMARY_IDS, SECONDARY_IDS, WEAPONS, type WeaponId } from "@/game/weapons/weapons";
import { NET } from "@/game/net/protocol";
import { COOP_MAPS } from "@/game/net/ids";
import {
  makeRoomCode, normalizeRoomCode,
  type NetTransport, type PeerMeta, type RoomSettings, type RosterEntry,
} from "@/game/net/transport";
import { CoopGame, type CoopLaunch, type CoopLoadout } from "./coop-game";
import { WORLD_CHANNEL, WORLD_COUNTDOWN_MS, WORLD_SCAN_MS, listingMeta, pickWorldRoom, readListings } from "@/game/net/world";

const LOADOUT_KEY = "tgf.iron-horizon.coop";
const DEFAULT_SETTINGS: RoomSettings = { mapId: COOP_MAPS[0]?.id ?? "dustfall-outpost", difficulty: "regular", waveTarget: 10, startWave: 1 };
const DEFAULT_LOADOUT: CoopLoadout = { operator: "ridge", primary: "vk7", secondary: "marrow9" };
const JOIN_TIMEOUT_MS = 4500;

type Stage = "menu" | "connecting" | "lobby" | "game";
type MatchStatus = { status: "lobby" | "playing"; roster?: RosterEntry[]; matchId?: string };

const rid = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => (b % 36).toString(36)).join("");

const Pill = ({ active, onClick, children, disabled }: { active: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    className={cn(
      "rounded-md border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60",
      active ? "border-white/70 bg-white/15 text-white" : "border-white/10 bg-white/[0.03] text-neutral-300 enabled:hover:border-white/25",
    )}
  >
    {children}
  </button>
);

const Label = ({ children }: { children: React.ReactNode }) => (
  <p className="mb-2 font-mono text-[11px] tracking-[0.25em] text-neutral-500 uppercase">{children}</p>
);

/**
 * Co-op front end: create a room (short code) or join one, a roster with
 * ready states, host-picked map/difficulty, then everyone launches into the
 * same match. One transport lives for the whole visit (lobby → match →
 * lobby), so the room survives between matches.
 */
export function CoopApp({
  userId,
  callsign,
  transport: kind,
  allowLocal = false,
  devParams,
  start,
  initialLoadout,
  initialRoom,
  onLeave,
}: {
  userId: string | null;
  callsign: string;
  transport: "supabase" | "local";
  /** Dev builds may opt into the loopback with ?transport=local even when Supabase is configured. */
  allowLocal?: boolean;
  /** DEV harness: query-string overrides (autohost/autojoin/autolaunch/lag/jitter/loss) instead of the URL. */
  devParams?: string;
  /** Embedded in the main lobby: create (host) or join this party right away, no menu. `world` matchmakes into a public Main World squad instead. */
  start?: { code: string; host: boolean; world?: boolean };
  /** Seed the loadout / host room settings from the main lobby picks. */
  initialLoadout?: CoopLoadout;
  initialRoom?: Partial<RoomSettings>;
  /** Embedded: leaving the party (or failing to join) returns to the main lobby. */
  onLeave?: (reason: string | null) => void;
}) {
  const [stage, setStage] = useState<Stage>("menu");
  const [code, setCode] = useState("");
  const [joinInput, setJoinInput] = useState("");
  const [isHost, setIsHost] = useState(false);
  const [peers, setPeers] = useState<PeerMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadout, setLoadout] = useState<CoopLoadout>(DEFAULT_LOADOUT);
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<RoomSettings>(() => ({ ...DEFAULT_SETTINGS, ...initialRoom, mapId: DEFAULT_SETTINGS.mapId }));
  const [matchStatus, setMatchStatus] = useState<MatchStatus>({ status: "lobby" });
  const [launch, setLaunch] = useState<CoopLaunch | null>(null);
  const [played, setPlayed] = useState<string[]>([]);
  const [identity, setIdentity] = useState<{ id: string; name: string } | null>(null);
  const transportRef = useRef<NetTransport | null>(null);
  const [joinedAt, setJoinedAt] = useState(0);
  const [transport, setTransport] = useState<NetTransport | null>(null);
  const [useLocal, setUseLocal] = useState(kind === "local");
  /** DEV harness (/coop/dev): auto host / join / ready / launch over the loopback. */
  const [auto, setAuto] = useState<{ code: string; host: boolean; launchAt: number } | null>(null);
  /** Main World: this room is public (listed in the directory, launches on a countdown). */
  const [isPublic, setIsPublic] = useState(false);
  const [openedAt, setOpenedAt] = useState(0);
  const [now, setNow] = useState(0);
  const directoryRef = useRef<NetTransport | null>(null);

  useEffect(() => {
    // Restore loadout + dev transport flag after mount (no window during SSR).
    let saved = DEFAULT_LOADOUT;
    try {
      const raw = window.localStorage.getItem(LOADOUT_KEY);
      if (initialLoadout) saved = initialLoadout;
      else if (raw) saved = { ...DEFAULT_LOADOUT, ...(JSON.parse(raw) as Partial<CoopLoadout>) };
    } catch {
      // Storage blocked: defaults.
    }
    const params = new URLSearchParams(devParams ?? window.location.search);
    const local = kind === "local" || (allowLocal && params.get("transport") === "local");
    const room = normalizeRoomCode(params.get("room") ?? "");
    queueMicrotask(() => {
      setLoadout(saved);
      setUseLocal(local);
      if (room) setJoinInput(room);
      if (local) {
        const h = normalizeRoomCode(params.get("autohost") ?? "");
        const j = normalizeRoomCode(params.get("autojoin") ?? "");
        if (h || j) setAuto({ code: (h ?? j)!, host: !!h, launchAt: Number(params.get("autolaunch")) || 0 });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialLoadout is a mount-time seed
  }, [kind, allowLocal, devParams]);

  const hostMeta = peers.find((p) => p.host) ?? null;
  const roomSettings = isHost ? settings : (hostMeta?.room ?? DEFAULT_SETTINGS);
  const others = peers.filter((p) => p.id !== identity?.id);

  // ---- Presence payload -------------------------------------------------------
  const meta = useMemo<PeerMeta | null>(() => {
    if (!identity) return null;
    return {
      id: identity.id,
      name: identity.name,
      host: isHost,
      ready: isHost ? true : ready,
      operator: loadout.operator,
      primary: loadout.primary,
      secondary: loadout.secondary,
      look: loadout.look,
      public: isPublic || undefined,
      joinedAt,
      room: isHost ? { ...settings, ...matchStatus } : undefined,
    };
  }, [identity, isHost, ready, loadout, settings, matchStatus, joinedAt, isPublic]);

  useEffect(() => {
    if (meta && (stage === "lobby" || stage === "game")) transportRef.current?.track(meta);
  }, [meta, stage]);

  useEffect(() => {
    try {
      window.localStorage.setItem(LOADOUT_KEY, JSON.stringify(loadout));
    } catch {
      // ignore
    }
  }, [loadout]);

  /** A launch for us arrived (or we rejoined a match): the join watchdog stands down. */
  const launchSeenRef = useRef(false);
  const leaveRoom = useCallback((reason: string | null = null) => {
    transportRef.current?.close();
    transportRef.current = null;
    directoryRef.current?.close();
    directoryRef.current = null;
    setIsPublic(false);
    setTransport(null);
    setPeers([]);
    setStage("menu");
    setLaunch(null);
    setIsHost(false);
    setReady(false);
    setMatchStatus({ status: "lobby" });
    setError(reason);
    onLeave?.(reason);
  }, [onLeave]);

  useEffect(
    () => () => {
      transportRef.current?.close();
      directoryRef.current?.close();
    },
    [],
  );

  const openTransport = async (roomCode: string, id: string): Promise<NetTransport> => {
    if (useLocal) {
      const { LocalTransport } = await import("@/game/net/localTransport");
      const q = new URLSearchParams(devParams ?? window.location.search);
      return new LocalTransport(id, roomCode, { latencyMs: Number(q.get("lag")) || 0, jitterMs: Number(q.get("jitter")) || 0, loss: Number(q.get("loss")) || 0 });
    }
    // Loaded on demand: keeps supabase-js out of the lobby bundle.
    const { getBrowserClient } = await import("@/lib/supabase/client");
    const client = getBrowserClient();
    if (!client) throw new Error("Online play isn't configured on this deployment.");
    const { SupabaseTransport } = await import("@/game/net/supabaseTransport");
    return new SupabaseTransport(client, id, roomCode);
  };

  const playerId = useRef<string | null>(null);
  const selfId = () => (playerId.current ??= userId ?? `dev-${rid(10)}`);

  // ---- Connect --------------------------------------------------------------------
  const connect = async (roomCode: string, host: boolean, publicRoom = false) => {
    setError(null);
    setStage("connecting");
    const id = selfId();
    // Two tabs on one machine share the offline guest name: tag them apart.
    const name = userId ? callsign : `${callsign}-${rid(3).toUpperCase()}`;
    try {
      const t = await openTransport(roomCode, id);
      transportRef.current = t;
      t.onPresence((list) => setPeers([...list]));
      t.on("launch", (p) => {
        const l = p as CoopLaunch;
        if (l && Array.isArray(l.roster) && l.roster.some((r) => r.id === id)) {
          launchSeenRef.current = true;
          setLaunch((cur) => cur ?? l);
        }
      });
      await t.connect();
      const joined = Date.now();
      setJoinedAt(joined);
      setTransport(t);
      setIdentity({ id, name });
      setIsHost(host);
      setIsPublic(publicRoom);
      setOpenedAt(joined);
      setCode(roomCode);
      // Joiners are ready as soon as they arrive: the host just hits Launch.
      setReady(!host);
      setStage("lobby");
      if (!host) {
        window.setTimeout(() => {
          const tr = transportRef.current;
          // Already launched: a slow presence sync (busy main
          // thread while the match loads) must not kick us out of a live match.
          if (tr !== t || launchSeenRef.current) return;
          const list = tr.peers();
          const h = list.find((p) => p.host);
          if (!h) leaveRoom(publicRoom ? "That squad just closed. Try Main World again." : `Room ${roomCode} not found. Check the code with your host.`);
          else if (list.filter((p) => p.id !== id && p.joinedAt < joined).length >= NET.MAX_PLAYERS && h.room?.status !== "playing")
            leaveRoom(`Room ${roomCode} is full (${NET.MAX_PLAYERS} players).`);
        }, JOIN_TIMEOUT_MS);
      }
    } catch (e) {
      transportRef.current?.close();
      transportRef.current = null;
      setStage("menu");
      const msg = e instanceof Error ? e.message : "Couldn't connect.";
      setError(msg);
      onLeave?.(msg);
    }
  };

  // ---- Main World: find an open public squad, or open one -------------------------------
  const joinWorld = async () => {
    setError(null);
    setStage("connecting");
    const id = selfId();
    try {
      const dir = await openTransport(WORLD_CHANNEL, id);
      directoryRef.current = dir;
      await dir.connect();
      await new Promise((r) => window.setTimeout(r, WORLD_SCAN_MS));
      if (directoryRef.current !== dir) return; // left while scanning
      const pick = pickWorldRoom(readListings(dir, id), NET.MAX_PLAYERS);
      if (pick) {
        // Joiners don't advertise anything: drop the directory.
        dir.close();
        directoryRef.current = null;
        await connect(pick.code, false, true);
      } else {
        // Main World squads: endless waves on a random map keeps the world varied.
        setSettings((s) => ({ ...s, difficulty: "regular", waveTarget: 0, startWave: 1, mapId: COOP_MAPS[Math.floor(Math.random() * COOP_MAPS.length)]?.id ?? s.mapId }));
        await connect(makeRoomCode(), true, true);
      }
    } catch (e) {
      directoryRef.current?.close();
      directoryRef.current = null;
      setStage("menu");
      const msg = e instanceof Error ? e.message : "Couldn't reach the Main World.";
      setError(msg);
      onLeave?.(msg);
    }
  };

  // Public host: keep our squad listed in the directory.
  useEffect(() => {
    const dir = directoryRef.current;
    if (!dir || !isHost || !isPublic || !identity) return;
    dir.track(listingMeta({ id: identity.id, code, players: peers.length || 1, status: matchStatus.status, openedAt }));
  }, [isHost, isPublic, identity, code, peers.length, matchStatus.status, openedAt]);

  // ---- Embedded: create / join straight away -----------------------------------------
  const startedRef = useRef(false);
  useEffect(() => {
    if (!start || startedRef.current) return;
    startedRef.current = true;
    queueMicrotask(() => void (start.world ? joinWorld() : connect(start.code, start.host)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount
  }, [start]);

  // ---- DEV harness automation --------------------------------------------------------
  useEffect(() => {
    if (!auto) return;
    if (stage === "menu" && !error) queueMicrotask(() => void connect(auto.code, auto.host));
    else if (stage === "lobby" && !auto.host && !ready) queueMicrotask(() => setReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- connect is a plain handler
  }, [auto, stage, error, ready]);

  // ---- Host disappears from the lobby ---------------------------------------------
  const hostSeenRef = useRef(false);
  useEffect(() => {
    if (stage !== "lobby" || isHost) return;
    if (hostMeta) {
      hostSeenRef.current = true;
      return;
    }
    if (!hostSeenRef.current) return;
    const t = window.setTimeout(() => leaveRoom("The host closed the room."), 3000);
    return () => window.clearTimeout(t);
  }, [stage, isHost, hostMeta, leaveRoom]);

  // ---- Clients: launch / rejoin from the host's presence ----------------------------
  const hostRoom = hostMeta?.room;
  const rejoinable =
    !isHost && hostRoom?.status === "playing" && !!hostRoom.matchId && !!hostRoom.roster?.some((r) => r.id === identity?.id);
  useEffect(() => {
    if (stage !== "lobby" || isHost || !hostMeta) return;
    const room = hostMeta.room;
    let next: CoopLaunch | null = launch;
    // A reload mid-match lands here: the host still lists us, so jump back in.
    if (!next && rejoinable && room?.matchId && !played.includes(room.matchId)) {
      next = { matchId: room.matchId, roster: room.roster!, settings: room, hostId: hostMeta.id };
    }
    if (!next || played.includes(next.matchId)) return;
    const l = next;
    launchSeenRef.current = true;
    queueMicrotask(() => {
      setPlayed((p) => [...p, l.matchId]);
      setLaunch(l);
      setStage("game");
    });
  }, [stage, isHost, hostMeta, launch, played, rejoinable]);

  // ---- Host: launch -----------------------------------------------------------------
  const everyoneReady = others.every((p) => p.ready);
  const startMatch = () => {
    const t = transportRef.current;
    if (!t || !identity) return;
    const sorted = [...others].sort((a, b) => a.joinedAt - b.joinedAt).slice(0, NET.MAX_PLAYERS - 1);
    const roster: RosterEntry[] = [
      { id: identity.id, name: identity.name, slot: 0, operator: loadout.operator, look: loadout.look },
      ...sorted.map((p, i) => ({ id: p.id, name: p.name, slot: i + 1, operator: p.operator, look: p.look })),
    ];
    const l: CoopLaunch = { matchId: rid(8), roster, settings, hostId: identity.id };
    setMatchStatus({ status: "playing", roster, matchId: l.matchId });
    t.send("launch", l);
    setPlayed((p) => [...p, l.matchId]);
    setLaunch(l);
    setStage("game");
  };

  const autoLaunch = !!auto?.host && played.length === 0 && auto.launchAt > 0 && stage === "lobby" && matchStatus.status === "lobby" && peers.length >= auto.launchAt && everyoneReady;
  useEffect(() => {
    if (!autoLaunch) return;
    const t = window.setTimeout(startMatch, 500);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once when the room is ready
  }, [autoLaunch]);

  // ---- Public host: launch on a countdown (or as soon as the squad is full) --------------
  const worldCountdown = isHost && isPublic && stage === "lobby" && matchStatus.status === "lobby";
  useEffect(() => {
    if (!worldCountdown) return;
    const tick = () => setNow(Date.now());
    tick();
    const t = window.setInterval(tick, 250);
    return () => window.clearInterval(t);
  }, [worldCountdown]);
  const launchIn = Math.max(0, openedAt + WORLD_COUNTDOWN_MS - now);
  const worldGo = worldCountdown && now > 0 && (launchIn === 0 || peers.length >= NET.MAX_PLAYERS);
  useEffect(() => {
    if (!worldGo) return;
    queueMicrotask(startMatch);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once per countdown
  }, [worldGo]);

  const backToLobby = () => {
    setLaunch(null);
    setReady(!isHost);
    if (isHost) setMatchStatus({ status: "lobby" });
    // A public squad reopens for new players with a fresh countdown.
    setOpenedAt(Date.now());
    setStage("lobby");
  };

  const rejoin = () => {
    if (!hostMeta?.room?.matchId || !hostMeta.room.roster) return;
    const room = hostMeta.room;
    setLaunch({ matchId: room.matchId!, roster: room.roster!, settings: room, hostId: hostMeta.id });
    setStage("game");
  };

  // ---------------------------------------------------------------------------
  if (stage === "game" && launch && transport) {
    return <CoopGame key={launch.matchId} launch={launch} transport={transport} loadout={loadout} callsign={identity?.name ?? callsign} onExit={backToLobby} />;
  }

  const shareUrl = typeof window !== "undefined" && code ? `${window.location.origin}/play/iron-horizon?room=${code}${useLocal ? "&transport=local" : ""}` : "";
  const mapName = COOP_MAPS.find((m) => m.id === roomSettings.mapId)?.name ?? roomSettings.mapId;
  const title = isPublic ? "Main World" : "Private lobby";

  return (
    <div className="min-h-dvh bg-black px-4 py-6 text-neutral-100 md:px-8">
      <div className="mx-auto max-w-3xl">
        <header className="flex items-center justify-between gap-3">
          <button type="button" onClick={() => leaveRoom()} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-neutral-400", !start && "hidden")}>
            ← Leave
          </button>
          <div className={cn("flex gap-2", start && "hidden")}>
            <Link href="/play/iron-horizon" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              ← Lobby
            </Link>
          </div>
          <p className="font-mono text-[10px] tracking-[0.3em] text-neutral-500 uppercase">{stage === "lobby" ? title : "Survival squad"}</p>
        </header>

        {useLocal && (
          <p className="mt-4 rounded-md border border-white/20 bg-white/5 px-3 py-2 text-xs text-neutral-300">
            Dev loopback transport: rooms connect browser tabs on this machine (BroadcastChannel), no Supabase needed. Add
            <span className="font-mono"> &amp;lag=80&amp;jitter=20</span> to the URL to simulate latency.
          </p>
        )}
        {error && <p className="mt-4 rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}

        {start && stage !== "lobby" && (
          <p className="mt-24 animate-pulse text-center font-mono text-sm tracking-[0.3em] text-neutral-400 uppercase">
            {start.world ? "Finding a squad…" : start.host ? "Creating lobby…" : `Joining ${start.code}…`}
          </p>
        )}

        {!start && (stage === "menu" || stage === "connecting") && (
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 p-6">
              <h2 className="text-lg font-semibold">Host a room</h2>
              <p className="mt-1 text-sm text-neutral-400">Get a short code to share. You run the match, so keep this tab in front.</p>
              <button type="button" disabled={stage === "connecting"} onClick={() => connect(makeRoomCode(), true)} className={cn(buttonVariants({ size: "lg" }), "mt-5 h-11 w-full")}>
                {stage === "connecting" ? "Connecting…" : "Create room"}
              </button>
            </div>
            <form
              className="rounded-2xl border border-white/10 p-6"
              onSubmit={(e) => {
                e.preventDefault();
                const c = normalizeRoomCode(joinInput);
                if (!c) setError("Room codes are 5 letters/digits, like K7QX2.");
                else void connect(c, false);
              }}
            >
              <h2 className="text-lg font-semibold">Join by code</h2>
              <p className="mt-1 text-sm text-neutral-400">Ask your host for their room code.</p>
              <div className="mt-5 flex gap-2">
                <input
                  value={joinInput}
                  onChange={(e) => setJoinInput(e.target.value.toUpperCase())}
                  maxLength={7}
                  placeholder="K7QX2"
                  aria-label="Room code"
                  className="h-11 min-w-0 flex-1 rounded-md border border-white/15 bg-black/40 px-3 font-mono text-lg tracking-[0.3em] uppercase outline-none focus:border-white/60"
                />
                <button type="submit" disabled={stage === "connecting"} className={cn(buttonVariants({ size: "lg" }), "h-11")}>
                  Join
                </button>
              </div>
            </form>
          </div>
        )}

        {stage === "lobby" && (
          <div className="mt-8 grid gap-8">
            {/* Room header: code to share (private) or the launch countdown (Main World). */}
            <div className="flex flex-wrap items-end justify-between gap-4">
              {isPublic ? (
                <div>
                  <h1 className="text-3xl font-black tracking-tight">{mapName}</h1>
                  <p className="mt-1 text-sm text-neutral-400">
                    {matchStatus.status === "playing" || hostRoom?.status === "playing"
                      ? "Match in progress."
                      : isHost
                        ? `Deploying in ${Math.ceil(launchIn / 1000)}s — players from the world can drop in until then.`
                        : "You're in. Deploying as soon as the squad fills or the timer runs out."}
                  </p>
                </div>
              ) : (
                <div>
                  <p className="font-mono text-4xl font-bold tracking-[0.35em]" data-testid="room-code">
                    {code}
                  </p>
                  <p className="mt-1 text-sm text-neutral-400">{isHost ? "Share this code. Friends who join show up below." : "The host starts the match."}</p>
                </div>
              )}
              {!isPublic && (
                <button type="button" onClick={() => void navigator.clipboard?.writeText(shareUrl).catch(() => {})} className={buttonVariants({ variant: "outline", size: "sm" })} title={shareUrl}>
                  Copy invite link
                </button>
              )}
            </div>

            <div>
              <Label>
                Squad {peers.length}/{NET.MAX_PLAYERS}
              </Label>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {[...peers]
                  .sort((a, b) => Number(b.host) - Number(a.host) || a.joinedAt - b.joinedAt)
                  .map((p) => (
                    <li key={p.id} className="flex items-center justify-between rounded-lg border border-white/10 px-3 py-2.5 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium">{p.name}</span>
                        {p.id === identity?.id && <span className="text-xs text-neutral-500">you</span>}
                      </span>
                      <span className="flex shrink-0 items-center gap-2 text-xs text-neutral-500">
                        {OPERATORS[p.operator]?.role ?? p.operator}
                        <span className={cn("h-2 w-2 rounded-full", p.host || p.ready ? "bg-white" : "bg-white/20")} title={p.host ? "Host" : p.ready ? "Ready" : "Not ready"} />
                      </span>
                    </li>
                  ))}
                {Array.from({ length: Math.max(0, NET.MAX_PLAYERS - peers.length) }, (_, i) => (
                  <li key={`open-${i}`} className="rounded-lg border border-dashed border-white/10 px-3 py-2.5 text-sm text-neutral-600">
                    Open slot
                  </li>
                ))}
              </ul>
            </div>

            {!isPublic && (
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <Label>Map</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {COOP_MAPS.map((m) => (
                      <Pill key={m.id} active={roomSettings.mapId === m.id} disabled={!isHost} onClick={() => setSettings((s) => ({ ...s, mapId: m.id }))}>
                        {m.name}
                      </Pill>
                    ))}
                  </div>
                </div>
                <div>
                  <Label>Difficulty</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {(Object.keys(DIFFICULTY) as DifficultyId[]).map((d) => (
                      <Pill key={d} active={roomSettings.difficulty === d} disabled={!isHost} onClick={() => setSettings((s) => ({ ...s, difficulty: d }))}>
                        {DIFFICULTY[d].name}
                      </Pill>
                    ))}
                  </div>
                </div>
                <div>
                  <Label>Waves</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {([10, 20, 0] as const).map((w) => (
                      <Pill key={w} active={roomSettings.waveTarget === w} disabled={!isHost} onClick={() => setSettings((s) => ({ ...s, waveTarget: w }))}>
                        {w === 0 ? "Endless" : w}
                      </Pill>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Primary</Label>
                <div className="flex flex-wrap gap-1.5">
                  {PRIMARY_IDS.map((id: WeaponId) => (
                    <Pill key={id} active={loadout.primary === id} onClick={() => setLoadout((l) => ({ ...l, primary: id }))}>
                      {WEAPONS[id].name}
                    </Pill>
                  ))}
                </div>
              </div>
              <div>
                <Label>Sidearm</Label>
                <div className="flex flex-wrap gap-1.5">
                  {SECONDARY_IDS.map((id: WeaponId) => (
                    <Pill key={id} active={loadout.secondary === id} onClick={() => setLoadout((l) => ({ ...l, secondary: id }))}>
                      {WEAPONS[id].name}
                    </Pill>
                  ))}
                </div>
              </div>
            </div>
            {!start && (
              <div>
                <Label>Class</Label>
                <div className="flex flex-wrap gap-1.5">
                  {OPERATOR_IDS.map((id: OperatorId) => (
                    <Pill key={id} active={loadout.operator === id} onClick={() => setLoadout((l) => ({ ...l, operator: id, primary: OPERATORS[id].primary, secondary: OPERATORS[id].secondary }))}>
                      {OPERATORS[id].role}
                    </Pill>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {isHost ? (
                <button
                  type="button"
                  disabled={!everyoneReady}
                  onClick={startMatch}
                  className={cn(buttonVariants({ size: "lg" }), "h-12 flex-1 text-base font-bold")}
                  title={everyoneReady ? "" : "Waiting for everyone to ready up"}
                >
                  {everyoneReady ? (isPublic ? "Deploy now" : `Launch (${peers.length} player${peers.length === 1 ? "" : "s"})`) : `Waiting for ${others.filter((p) => !p.ready).length} to ready up`}
                </button>
              ) : rejoinable ? (
                <button type="button" onClick={rejoin} className={cn(buttonVariants({ size: "lg" }), "h-12 flex-1 text-base font-bold")}>
                  Rejoin match in progress
                </button>
              ) : (
                <button type="button" onClick={() => setReady((r) => !r)} className={cn(buttonVariants({ variant: ready ? "outline" : "default", size: "lg" }), "h-12 flex-1 text-base font-bold")}>
                  {ready ? "Not ready" : "Ready up"}
                </button>
              )}
              {!start && (
                <button type="button" onClick={() => leaveRoom()} className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "h-12")}>
                  Leave
                </button>
              )}
            </div>
            {!isHost && hostRoom?.status === "playing" && !rejoinable && <p className="-mt-4 text-xs text-neutral-500">A match is in progress. You can join the next one.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
