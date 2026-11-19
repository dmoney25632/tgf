"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getBrowserClient } from "@/lib/supabase/client";
import { DIFFICULTY, OPERATORS, OPERATOR_IDS, type DifficultyId, type OperatorId } from "@/game/survival/config";
import { PRIMARY_IDS, SECONDARY_IDS, WEAPONS, type WeaponId } from "@/game/weapons/weapons";
import { NET } from "@/game/net/protocol";
import { COOP_MAPS } from "@/game/net/ids";
import {
  makeRoomCode, normalizeRoomCode,
  type NetTransport, type PeerMeta, type RoomSettings, type RosterEntry,
} from "@/game/net/transport";
import { CoopGame, type CoopLaunch, type CoopLoadout } from "./coop-game";

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
      active ? "border-amber-400/70 bg-amber-400/15 text-amber-200" : "border-white/10 bg-white/[0.03] text-neutral-300 enabled:hover:border-white/25",
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
}: {
  userId: string | null;
  callsign: string;
  transport: "supabase" | "local";
  /** Dev builds may opt into the loopback with ?transport=local even when Supabase is configured. */
  allowLocal?: boolean;
}) {
  const [stage, setStage] = useState<Stage>("menu");
  const [code, setCode] = useState("");
  const [joinInput, setJoinInput] = useState("");
  const [isHost, setIsHost] = useState(false);
  const [peers, setPeers] = useState<PeerMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadout, setLoadout] = useState<CoopLoadout>(DEFAULT_LOADOUT);
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<RoomSettings>(DEFAULT_SETTINGS);
  const [matchStatus, setMatchStatus] = useState<MatchStatus>({ status: "lobby" });
  const [launch, setLaunch] = useState<CoopLaunch | null>(null);
  const [played, setPlayed] = useState<string[]>([]);
  const [identity, setIdentity] = useState<{ id: string; name: string } | null>(null);
  const transportRef = useRef<NetTransport | null>(null);
  const joinedAtRef = useRef(0);
  const [useLocal, setUseLocal] = useState(kind === "local");

  useEffect(() => {
    // Restore loadout + dev transport flag after mount (no window during SSR).
    let saved = DEFAULT_LOADOUT;
    try {
      const raw = window.localStorage.getItem(LOADOUT_KEY);
      if (raw) saved = { ...DEFAULT_LOADOUT, ...(JSON.parse(raw) as Partial<CoopLoadout>) };
    } catch {
      // Storage blocked: defaults.
    }
    const params = new URLSearchParams(window.location.search);
    const local = kind === "local" || (allowLocal && params.get("transport") === "local");
    const room = normalizeRoomCode(params.get("room") ?? "");
    queueMicrotask(() => {
      setLoadout(saved);
      setUseLocal(local);
      if (room) setJoinInput(room);
    });
  }, [kind, allowLocal]);

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
      joinedAt: joinedAtRef.current,
      room: isHost ? { ...settings, ...matchStatus } : undefined,
    };
  }, [identity, isHost, ready, loadout, settings, matchStatus]);

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

  const leaveRoom = useCallback((reason: string | null = null) => {
    transportRef.current?.close();
    transportRef.current = null;
    setPeers([]);
    setStage("menu");
    setLaunch(null);
    setIsHost(false);
    setReady(false);
    setMatchStatus({ status: "lobby" });
    setError(reason);
  }, []);

  useEffect(() => () => transportRef.current?.close(), []);

  // ---- Connect --------------------------------------------------------------------
  const connect = async (roomCode: string, host: boolean) => {
    setError(null);
    setStage("connecting");
    const id = userId ?? `dev-${rid(10)}`;
    // Two tabs on one machine share the offline guest name: tag them apart.
    const name = userId ? callsign : `${callsign}-${rid(3).toUpperCase()}`;
    try {
      let t: NetTransport;
      if (useLocal) {
        const { LocalTransport } = await import("@/game/net/localTransport");
        const q = new URLSearchParams(window.location.search);
        t = new LocalTransport(id, roomCode, { latencyMs: Number(q.get("lag")) || 0, jitterMs: Number(q.get("jitter")) || 0, loss: Number(q.get("loss")) || 0 });
      } else {
        const client = getBrowserClient();
        if (!client) throw new Error("Online play isn't configured on this deployment.");
        const { SupabaseTransport } = await import("@/game/net/supabaseTransport");
        t = new SupabaseTransport(client, id, roomCode);
      }
      transportRef.current = t;
      t.onPresence((list) => setPeers([...list]));
      t.on("launch", (p) => {
        const l = p as CoopLaunch;
        if (l && Array.isArray(l.roster) && l.roster.some((r) => r.id === id)) setLaunch((cur) => cur ?? l);
      });
      await t.connect();
      joinedAtRef.current = Date.now();
      setIdentity({ id, name });
      setIsHost(host);
      setCode(roomCode);
      setReady(false);
      setStage("lobby");
      if (!host) {
        window.setTimeout(() => {
          const tr = transportRef.current;
          if (tr !== t) return;
          const list = tr.peers();
          const h = list.find((p) => p.host);
          if (!h) leaveRoom(`Room ${roomCode} not found. Check the code with your host.`);
          else if (list.filter((p) => p.id !== id && p.joinedAt < joinedAtRef.current).length >= NET.MAX_PLAYERS && h.room?.status !== "playing")
            leaveRoom(`Room ${roomCode} is full (${NET.MAX_PLAYERS} players).`);
        }, JOIN_TIMEOUT_MS);
      }
    } catch (e) {
      transportRef.current?.close();
      transportRef.current = null;
      setStage("menu");
      setError(e instanceof Error ? e.message : "Couldn't connect.");
    }
  };

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
      { id: identity.id, name: identity.name, slot: 0, operator: loadout.operator },
      ...sorted.map((p, i) => ({ id: p.id, name: p.name, slot: i + 1, operator: p.operator })),
    ];
    const l: CoopLaunch = { matchId: rid(8), roster, settings, hostId: identity.id };
    setMatchStatus({ status: "playing", roster, matchId: l.matchId });
    t.send("launch", l);
    setPlayed((p) => [...p, l.matchId]);
    setLaunch(l);
    setStage("game");
  };

  const backToLobby = () => {
    setLaunch(null);
    setReady(false);
    if (isHost) setMatchStatus({ status: "lobby" });
    setStage("lobby");
  };

  const rejoin = () => {
    if (!hostMeta?.room?.matchId || !hostMeta.room.roster) return;
    const room = hostMeta.room;
    setLaunch({ matchId: room.matchId!, roster: room.roster!, settings: room, hostId: hostMeta.id });
    setStage("game");
  };

  // ---------------------------------------------------------------------------
  if (stage === "game" && launch && transportRef.current) {
    return <CoopGame key={launch.matchId} launch={launch} transport={transportRef.current} loadout={loadout} callsign={identity?.name ?? callsign} onExit={backToLobby} />;
  }

  const shareUrl = typeof window !== "undefined" && code ? `${window.location.origin}/coop?room=${code}${useLocal ? "&transport=local" : ""}` : "";

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,#2b2f22_0%,#0b0b0a_60%)] px-4 py-8 text-neutral-100">
      <div className="mx-auto max-w-4xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] tracking-[0.3em] text-amber-400/80 uppercase">Iron Horizon · Online co-op</p>
            <h1 className="mt-1 text-3xl font-bold">Survival Squad</h1>
            <p className="mt-1 text-sm text-neutral-400">2–4 players hold the outpost together. Signed in as {identity?.name ?? callsign}.</p>
          </div>
          <div className="flex gap-2">
            <Link href="/play/iron-horizon" className={buttonVariants({ variant: "outline", size: "sm" })}>
              Solo
            </Link>
            <Link href="/dashboard" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              Dashboard
            </Link>
          </div>
        </div>

        {useLocal && (
          <p className="mt-4 rounded-md border border-sky-400/30 bg-sky-400/10 px-3 py-2 text-xs text-sky-200">
            Dev loopback transport: rooms connect browser tabs on this machine (BroadcastChannel), no Supabase needed. Add
            <span className="font-mono"> &amp;lag=80&amp;jitter=20</span> to the URL to simulate latency.
          </p>
        )}
        {error && <p className="mt-4 rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}

        {(stage === "menu" || stage === "connecting") && (
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-neutral-950/80 p-6">
              <h2 className="text-lg font-semibold">Host a room</h2>
              <p className="mt-1 text-sm text-neutral-400">Get a short code to share. You run the match, so keep this tab in front.</p>
              <button
                type="button"
                disabled={stage === "connecting"}
                onClick={() => connect(makeRoomCode(), true)}
                className={cn(buttonVariants({ size: "lg" }), "mt-5 h-11 w-full")}
              >
                {stage === "connecting" ? "Connecting…" : "Create room"}
              </button>
            </div>
            <form
              className="rounded-xl border border-white/10 bg-neutral-950/80 p-6"
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
                  className="h-11 min-w-0 flex-1 rounded-md border border-white/15 bg-black/40 px-3 font-mono text-lg tracking-[0.3em] uppercase outline-none focus:border-amber-400/60"
                />
                <button type="submit" disabled={stage === "connecting"} className={cn(buttonVariants({ size: "lg" }), "h-11")}>
                  Join
                </button>
              </div>
            </form>
          </div>
        )}

        {stage === "lobby" && (
          <div className="mt-8 grid gap-4 lg:grid-cols-[1fr_1.2fr]">
            <div className="rounded-xl border border-white/10 bg-neutral-950/80 p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Label>Room code</Label>
                  <p className="font-mono text-4xl font-bold tracking-[0.35em] text-amber-300" data-testid="room-code">
                    {code}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void navigator.clipboard?.writeText(shareUrl).catch(() => {})}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                  title={shareUrl}
                >
                  Copy link
                </button>
              </div>

              <div className="mt-6">
                <Label>
                  Squad {peers.length}/{NET.MAX_PLAYERS}
                </Label>
                <ul className="grid gap-1.5">
                  {[...peers]
                    .sort((a, b) => Number(b.host) - Number(a.host) || a.joinedAt - b.joinedAt)
                    .map((p) => (
                      <li key={p.id} className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm">
                        <span className="flex items-center gap-2">
                          <span className="font-medium">{p.name}</span>
                          {p.id === identity?.id && <span className="text-xs text-neutral-500">(you)</span>}
                          {p.host && <span className="rounded bg-amber-400/15 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-amber-300 uppercase">Host</span>}
                        </span>
                        <span className="flex items-center gap-3 text-xs">
                          <span className="text-neutral-500">{OPERATORS[p.operator]?.name ?? p.operator}</span>
                          <span className={p.ready ? "text-lime-300" : "text-neutral-500"}>{p.host ? "HOST" : p.ready ? "READY" : "NOT READY"}</span>
                        </span>
                      </li>
                    ))}
                </ul>
              </div>

              <div className="mt-6 grid gap-4">
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
                    {([5, 10, 15, 0] as const).map((w) => (
                      <Pill key={w} active={roomSettings.waveTarget === w} disabled={!isHost} onClick={() => setSettings((s) => ({ ...s, waveTarget: w }))}>
                        {w === 0 ? "Endless" : `${w} waves`}
                      </Pill>
                    ))}
                  </div>
                </div>
                {!isHost && <p className="text-xs text-neutral-500">The host picks the map and difficulty.</p>}
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-neutral-950/80 p-6">
              <Label>Operator</Label>
              <div className="flex flex-wrap gap-1.5">
                {OPERATOR_IDS.map((id: OperatorId) => (
                  <Pill key={id} active={loadout.operator === id} disabled={ready} onClick={() => setLoadout((l) => ({ ...l, operator: id, primary: OPERATORS[id].primary, secondary: OPERATORS[id].secondary }))}>
                    {OPERATORS[id].name} · {OPERATORS[id].role}
                  </Pill>
                ))}
              </div>
              <p className="mt-2 text-xs text-neutral-500">{OPERATORS[loadout.operator].blurb}</p>
              <div className="mt-5">
                <Label>Primary</Label>
                <div className="flex flex-wrap gap-1.5">
                  {PRIMARY_IDS.map((id: WeaponId) => (
                    <Pill key={id} active={loadout.primary === id} disabled={ready} onClick={() => setLoadout((l) => ({ ...l, primary: id }))}>
                      {WEAPONS[id].name}
                    </Pill>
                  ))}
                </div>
              </div>
              <div className="mt-5">
                <Label>Sidearm</Label>
                <div className="flex flex-wrap gap-1.5">
                  {SECONDARY_IDS.map((id: WeaponId) => (
                    <Pill key={id} active={loadout.secondary === id} disabled={ready} onClick={() => setLoadout((l) => ({ ...l, secondary: id }))}>
                      {WEAPONS[id].name}
                    </Pill>
                  ))}
                </div>
              </div>

              <div className="mt-8 flex flex-wrap gap-2">
                {isHost ? (
                  <button
                    type="button"
                    disabled={!everyoneReady}
                    onClick={startMatch}
                    className={cn(buttonVariants({ size: "lg" }), "h-11 flex-1 text-base")}
                    title={everyoneReady ? "" : "Waiting for everyone to ready up"}
                  >
                    {everyoneReady ? `Launch (${peers.length} player${peers.length === 1 ? "" : "s"})` : `Waiting for ${others.filter((p) => !p.ready).length} to ready up`}
                  </button>
                ) : rejoinable ? (
                  <button type="button" onClick={rejoin} className={cn(buttonVariants({ size: "lg" }), "h-11 flex-1 text-base")}>
                    Rejoin match in progress
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setReady((r) => !r)}
                    className={cn(buttonVariants({ variant: ready ? "outline" : "default", size: "lg" }), "h-11 flex-1 text-base")}
                  >
                    {ready ? "Not ready" : "Ready up"}
                  </button>
                )}
                <button type="button" onClick={() => leaveRoom()} className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "h-11")}>
                  Leave room
                </button>
              </div>
              {!isHost && hostRoom?.status === "playing" && !rejoinable && (
                <p className="mt-3 text-xs text-neutral-500">A match is in progress. You can join the next one.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
