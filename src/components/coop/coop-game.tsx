"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GameEngine } from "@/game/core/Engine";
import { loadSettings } from "@/game/ui/Settings";
import { useInputDevice } from "@/components/game/gamepad";
import type { EngineEvent, MatchSummary } from "@/game/core/GameMode";
import type { SurvivalGameMode } from "@/game/survival/SurvivalGameMode";
import type { CoopSurvivalNet } from "@/game/net/CoopSurvivalNet";
import type { NetTransport, RoomSettings, RosterEntry } from "@/game/net/transport";
import type { OperatorId } from "@/game/survival/config";
import type { CharacterLook } from "@/game/character";
import type { WeaponId } from "@/game/weapons/weapons";
import { detectQuality } from "@/game/config";
import { mobileDefaultQuality } from "@/game/mobile/device";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { saveMatch } from "@/app/play/[gameId]/actions";
import { matchReport } from "@/game/core/matchReport";
import { ShopOverlay } from "@/components/game/shop-overlay";
import { MatchSummaryView } from "@/components/game/match-summary";

export type CoopLaunch = { matchId: string; roster: RosterEntry[]; settings: RoomSettings; hostId: string };
export type CoopLoadout = { operator: OperatorId; primary: WeaponId; secondary: WeaponId; look?: CharacterLook };

/** One online co-op survival match. The engine + net layer load lazily. */
export function CoopGame({
  launch,
  transport,
  loadout,
  callsign,
  onExit,
}: {
  launch: CoopLaunch;
  transport: NetTransport;
  loadout: CoopLoadout;
  callsign: string;
  onExit: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [ready, setReady] = useState(false);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shopOpen, setShopOpen] = useState(false);
  const [summary, setSummary] = useState<MatchSummary | null>(null);
  const [saved, setSaved] = useState("");
  const [mode, setMode] = useState<SurvivalGameMode | null>(null);
  const isHost = launch.hostId === transport.selfId;
  const dev = useInputDevice();

  const onEvent = useCallback((e: EngineEvent) => {
    if (e.type === "shop") setShopOpen(e.open);
    if (e.type === "end") {
      setSummary(e.summary);
      setShopOpen(false);
      const s = e.summary;
      saveMatch(matchReport(s, "survival-coop"))
        .then((r) => setSaved(r.ok ? "Match saved to your career stats." : r.error === "offline" ? "Offline mode — stats not saved." : `Stats not saved: ${r.error}`))
        .catch(() => setSaved("Stats not saved (network error)."));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let engine: GameEngine | null = null;
    Promise.all([import("@/game/core/Engine"), import("@/game/net/CoopSurvivalNet"), import("@/game/net/ids")])
      .then(([{ GameEngine }, { CoopSurvivalNet }, { coopMap }]) => {
        if (cancelled || !hostRef.current) return;
        const net: CoopSurvivalNet = new CoopSurvivalNet({ transport, matchId: launch.matchId, hostId: launch.hostId, roster: launch.roster, settings: launch.settings });
        const s = launch.settings;
        engine = new GameEngine(hostRef.current, {
          callsign,
          settings: loadSettings(mobileDefaultQuality() ?? detectQuality()),
          mode: "survival",
          map: coopMap(s.mapId),
          loadout: [loadout.primary, loadout.secondary],
          survival: {
            operator: loadout.operator,
            primary: loadout.primary,
            secondary: loadout.secondary,
            look: loadout.look,
            difficulty: s.difficulty,
            waveTarget: s.waveTarget,
            squad: launch.roster.length - 1,
            startWave: s.startWave,
            net,
          },
          onLockChange: setLocked,
          onEvent,
        });
        engine.start();
        engineRef.current = engine;
        setMode(engine.survival);
        if (process.env.NODE_ENV !== "production") Object.assign(window, { __tgf: engine, __tgfNet: net, [isHost ? "__tgfHost" : "__tgfClient"]: { engine, net } });
        setReady(true);
      })
      .catch((e: unknown) => {
        console.error(e);
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
      engine?.dispose();
      engineRef.current = null;
    };
  }, [launch, transport, loadout, callsign, onEvent, isHost]);

  const resumeFromShop = (r: boolean, via?: "pad") => {
    if (!mode) return;
    if (r) mode.readyUp();
    else mode.closeShop();
    setShopOpen(false);
    engineRef.current?.lock(via);
  };

  const showPause = !locked && !shopOpen && !summary;
  const names = launch.roster.map((r) => r.name).join(" · ");

  return (
    <div className="fixed inset-0 bg-black">
      <div ref={hostRef} className="absolute inset-0" />
      {shopOpen && mode && <ShopOverlay mode={mode} dev={dev} onResume={resumeFromShop} />}
      {summary && <MatchSummaryView s={summary} saved={saved} onAgain={onExit} onLobby={onExit} />}
      {showPause && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-white/10 bg-neutral-950/90 p-6 text-neutral-100">
            <p className="font-mono text-[11px] tracking-[0.3em] text-white/80 uppercase">Iron Horizon · Online co-op</p>
            <h1 className="mt-1 text-2xl font-bold">Hold the outpost</h1>
            <p className="mt-1 text-sm text-neutral-400">{names}</p>
            <p className="mt-3 text-xs text-neutral-500">
              The match keeps running while this menu is open.{" "}
              {isHost ? "You are the host: if you leave, the match ends for everyone." : "Hold F next to a downed teammate to revive them."}
            </p>
            {error ? (
              <p className="mt-4 text-sm text-red-400">Failed to start the game: {error}</p>
            ) : (
              <button type="button" disabled={!ready} onClick={() => engineRef.current?.lock()} className={cn(buttonVariants({ size: "lg" }), "mt-5 h-11 w-full text-base")}>
                {ready ? "Click to deploy" : "Loading…"}
              </button>
            )}
            <button type="button" onClick={onExit} className={cn(buttonVariants({ variant: "outline" }), "mt-3 w-full")}>
              {isHost ? "End match and return to lobby" : "Leave match"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
