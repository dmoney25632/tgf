"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GameEngine } from "@/game/core/Engine";
import type { EngineEvent, MatchSummary } from "@/game/core/GameMode";
import type { SurvivalGameMode } from "@/game/survival/SurvivalGameMode";
import type { LoadTracker } from "@/game/ui/LoadProgress";
import { detectQuality } from "@/game/config";
import { mobileDefaultQuality } from "@/game/mobile/device";
import { loadSettings, sanitizeSettings, saveSettings, type GameSettings } from "@/game/ui/Settings";
import { saveMatch } from "@/app/play/[gameId]/actions";
import { matchReport } from "@/game/core/matchReport";
import { DEFAULT_CHOICE, Lobby, type LobbyChoice, type PartyActions } from "./lobby";
import { CoopApp } from "@/components/coop/coop-app";
import { makeRoomCode, normalizeRoomCode } from "@/game/net/transport";
import { ShopOverlay } from "./shop-overlay";
import { MatchSummaryView } from "./match-summary";
import { LoadingScreen } from "./loading-screen";
import { PauseMenu } from "./pause-menu";
import { useGamepadNav, useInputDevice } from "./gamepad";

const LOBBY_KEY = "tgf.iron-horizon.lobby";

function loadLobby(): LobbyChoice {
  try {
    const raw = window.localStorage.getItem(LOBBY_KEY);
    return raw ? { ...DEFAULT_CHOICE, ...(JSON.parse(raw) as Partial<LobbyChoice>) } : DEFAULT_CHOICE;
  } catch {
    return DEFAULT_CHOICE;
  }
}

function saveLobby(value: LobbyChoice) {
  try {
    window.localStorage.setItem(LOBBY_KEY, JSON.stringify(value));
  } catch {
    // Storage blocked (private mode etc.) — picks just won't persist.
  }
}

/**
 * Iron Horizon host: lobby → match. The engine (and Three.js) is imported
 * lazily so it never ships with the rest of the site.
 */
export function IronHorizonClient({
  callsign,
  userId = null,
  partyTransport = null,
}: {
  callsign: string;
  /** Account id for online parties (null for the offline guest). */
  userId?: string | null;
  /** How parties connect; null = parties unavailable (guest on a live deployment). */
  partyTransport?: "supabase" | "local" | null;
}) {
  const [choice, setChoice] = useState<LobbyChoice | null>(null);
  const [inGame, setInGame] = useState(false);
  const [run, setRun] = useState(0);
  const [party, setParty] = useState<{ code: string; host: boolean; key: number } | null>(null);
  const [partyNotice, setPartyNotice] = useState<string | null>(null);

  useEffect(() => {
    // Restore the last lobby picks after mount (localStorage isn't available during SSR).
    const restored = loadLobby();
    // Invite links (?room=CODE) drop you straight into that party.
    const room = normalizeRoomCode(new URLSearchParams(window.location.search).get("room") ?? "");
    queueMicrotask(() => {
      setChoice(room ? { ...restored, mode: "survival" } : restored);
      if (room && partyTransport) setParty({ code: room, host: false, key: Date.now() });
    });
  }, [partyTransport]);

  const enterParty = useCallback((code: string, host: boolean, c: LobbyChoice) => {
    saveLobby(c);
    setChoice(c);
    setPartyNotice(null);
    setParty({ code, host, key: Date.now() });
  }, []);

  const leaveParty = useCallback((reason: string | null) => {
    setParty(null);
    setPartyNotice(reason);
    // Drop ?room= so a reload doesn't rejoin a party you just left.
    if (window.location.search.includes("room=")) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  if (!choice) return <div className="fixed inset-0 bg-black" aria-busy="true" />;

  if (party && partyTransport) {
    return (
      <CoopApp
        key={party.key}
        userId={partyTransport === "local" ? null : userId}
        callsign={callsign}
        transport={partyTransport}
        start={{ code: party.code, host: party.host }}
        initialLoadout={{ operator: choice.operator, primary: choice.primary, secondary: choice.secondary }}
        initialRoom={{ difficulty: choice.difficulty, waveTarget: choice.waveTarget, startWave: choice.startWave }}
        onLeave={leaveParty}
      />
    );
  }

  const partyActions: PartyActions = {
    unavailable: partyTransport ? null : "Sign in with an account to play online with friends.",
    onCreate: (c) => enterParty(makeRoomCode(), true, c),
    onJoin: (code, c) => enterParty(code, false, c),
  };

  if (!inGame) {
    return (
      <Lobby
        callsign={callsign}
        initial={choice}
        party={partyActions}
        notice={partyNotice}
        onDeploy={(c) => {
          saveLobby(c);
          setChoice(c);
          setRun((r) => r + 1);
          setInGame(true);
        }}
      />
    );
  }

  return (
    <GameView
      key={run}
      callsign={callsign}
      choice={choice}
      onAgain={() => setRun((r) => r + 1)}
      onLobby={() => setInGame(false)}
    />
  );
}

const MIN_LOADING_MS = 1300;
const MAX_LOADING_MS = 20000;

/** Mission runs pass a summary renderer and briefing (see components/missions). */
export type GameViewExtras = { briefing?: string; renderSummary?: (s: MatchSummary, saved: string, onAgain: () => void, onLobby: () => void) => React.ReactNode };

export function GameView({ callsign, choice, onAgain, onLobby, extras }: { callsign: string; choice: LobbyChoice; onAgain: () => void; onLobby: () => void; extras?: GameViewExtras }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const loadRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [deployed, setDeployed] = useState(false);
  const [loadGone, setLoadGone] = useState(false);
  const [locked, setLocked] = useState(false);
  const [lockError, setLockError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<GameSettings | null>(null);
  const [mapName, setMapName] = useState(choice.mode === "survival" ? "Dustfall Outpost" : "Kestrel Yard");
  const [shopOpen, setShopOpen] = useState(false);
  const [summary, setSummary] = useState<MatchSummary | null>(null);
  const [saved, setSaved] = useState("");
  const [survivalMode, setSurvivalMode] = useState<SurvivalGameMode | null>(null);
  const dev = useInputDevice();
  const survival = choice.mode === "survival";
  const objective = extras?.briefing
    ? extras.briefing
    : survival
    ? "Hold the compound against escalating waves. Armories and ammo crates open between waves; squadmates revive you if you go down."
    : `Operator ${callsign}. Zero your weapons on pop-up targets (they reset after 2.5 s) and steel plates out to 70 m.`;

  const onEvent = useCallback((e: EngineEvent) => {
    if (e.type === "shop") setShopOpen(e.open);
    if (e.type === "end") {
      setSummary(e.summary);
      setShopOpen(false);
      const s = e.summary;
      saveMatch(matchReport(s))
        .then((r) => setSaved(r.ok ? "Match saved to your career stats." : r.error === "offline" ? "Offline mode — stats not saved." : `Stats not saved: ${r.error}`))
        .catch(() => setSaved("Stats not saved (network error)."));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let engine: GameEngine | null = null;
    let tracker: LoadTracker | null = null;
    let raf = 0;
    let shown = 0;
    let engineAt = 0;
    const t0 = performance.now();
    const initial = loadSettings(mobileDefaultQuality() ?? detectQuality());

    // Progress: module download (estimated) → real asset loads through the
    // three.js loading manager → done. Timed fallback when nothing loads
    // (everything cached) and a hard cap so a stuck request never blocks play.
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      let target: number;
      let finished = false;
      if (!engineAt || !tracker) target = 0.3 * (1 - Math.exp(-(now - t0) / 1400));
      else {
        const s = tracker.snapshot();
        const since = now - engineAt;
        let frac: number;
        if (s.started && s.total > 0) {
          frac = s.loaded / s.total;
          finished = s.loaded >= s.total && s.idleMs > 350;
        } else {
          frac = Math.min(1, Math.max(0, (since - 250) / 800));
          finished = since > 1100;
        }
        if (since > MAX_LOADING_MS) finished = true;
        target = finished && now - t0 > MIN_LOADING_MS ? 1 : 0.32 + 0.6 * frac;
      }
      shown = Math.max(shown, shown + (target - shown) * 0.16);
      if (target === 1 && shown > 0.995) shown = 1;
      setProgress((p) => (Math.abs(p - shown) >= 0.004 || shown === 1 ? shown : p));
      if (shown === 1) {
        cancelAnimationFrame(raf);
        tracker?.dispose();
        tracker = null;
        setLoaded(true);
      }
    };
    raf = requestAnimationFrame(tick);

    Promise.all([import("@/game/core/Engine"), import("@/game/ui/LoadProgress")])
      .then(([{ GameEngine }, { trackAssetLoading }]) => {
        if (cancelled || !hostRef.current) return;
        tracker = trackAssetLoading();
        engine = new GameEngine(hostRef.current, {
          callsign,
          settings: initial,
          onSettingsChange: (next) => setSettings(next),
          mode: choice.mission ? "mission" : choice.mode,
          mapId: choice.map,
          mission: choice.mission ? { missionId: choice.mission, operator: choice.operator, primary: choice.primary, secondary: choice.secondary, difficulty: choice.difficulty, squad: choice.squad } : undefined,
          loadout: [choice.primary, choice.secondary],
          survival: {
            operator: choice.operator,
            primary: choice.primary,
            secondary: choice.secondary,
            difficulty: choice.difficulty,
            waveTarget: choice.waveTarget,
            squad: choice.squad,
            startWave: choice.startWave,
          },
          onLockChange: (engaged) => {
            setLocked(engaged);
            if (engaged) {
              setDeployed(true);
              setLockError(false);
            }
          },
          onLockError: () => setLockError(true),
          onEvent,
        });
        engineAt = performance.now();
        engine.start();
        engineRef.current = engine;
        setSettings(engine.settings ? { ...engine.settings } : initial);
        setMapName(engine.mapName);
        setSurvivalMode(engine.survival);
        if (process.env.NODE_ENV !== "production") (window as unknown as { __tgf?: GameEngine }).__tgf = engine;
        setReady(true);
      })
      .catch((e: unknown) => {
        console.error(e);
        const msg = e instanceof Error ? e.message : String(e);
        cancelAnimationFrame(raf);
        setError(
          /webgl|context/i.test(msg)
            ? "Couldn't start 3D graphics. Enable hardware acceleration or try a recent Chrome, Edge or Firefox."
            : `Failed to start the game: ${msg}`,
        );
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      tracker?.dispose();
      engine?.dispose();
      engineRef.current = null;
    };
  }, [callsign, choice, onEvent]);

  const update = useCallback(
    (patch: Partial<GameSettings>) => {
      if (!settings) return;
      // Side effects stay out of the state updater (StrictMode runs updaters twice).
      const next = sanitizeSettings({ ...settings, ...patch });
      engineRef.current?.applySettings(patch);
      saveSettings(next);
      setSettings(next);
    },
    [settings],
  );

  const resume = useCallback((via?: "pad") => engineRef.current?.lock(via), []);

  const fullscreen = async () => {
    try {
      await document.documentElement.requestFullscreen();
      // Keyboard lock (Chrome) stops Ctrl+W & co. from leaving the game.
      const kb = (navigator as unknown as { keyboard?: { lock?: (keys?: string[]) => Promise<void> } }).keyboard;
      await kb?.lock?.(["KeyW", "KeyA", "KeyS", "KeyD", "ControlLeft", "Escape", "Tab"]).catch(() => {});
    } catch {
      // Fullscreen refused; nothing else to do.
    }
    engineRef.current?.lock();
  };

  const resumeFromShop = (ready: boolean, via?: "pad") => {
    const s = survivalMode;
    if (!s) return;
    if (ready) s.readyUp();
    else s.closeShop();
    setShopOpen(false);
    engineRef.current?.lock(via);
  };

  const canDeploy = ready && loaded && !deployed && !error;
  useGamepadNav(loadRef, { onStart: () => resume("pad") }, canDeploy);

  const showPause = deployed && !locked && !shopOpen && !summary;

  return (
    <div className="fixed inset-0 bg-black">
      <div ref={hostRef} className="absolute inset-0" />

      {!loadGone && (
        <div ref={loadRef}>
          <LoadingScreen
            mapName={mapName}
            modeLabel={choice.mission ? "Mission" : survival ? "Survival" : "Training"}
            objective={objective}
            progress={progress}
            ready={canDeploy}
            leaving={deployed}
            dev={dev}
            error={error}
            notice={lockError && !deployed ? "The browser didn't capture the mouse — click again to deploy." : undefined}
            onDeploy={(e) => resume(e.nativeEvent.isTrusted ? undefined : "pad")}
            onGone={() => setLoadGone(true)}
          />
        </div>
      )}

      {shopOpen && survivalMode && <ShopOverlay mode={survivalMode} dev={dev} onResume={resumeFromShop} />}

      {summary && (extras?.renderSummary?.(summary, saved, onAgain, onLobby) ?? <MatchSummaryView s={summary} saved={saved} onAgain={onAgain} onLobby={onLobby} />)}

      {showPause && settings && (
        <PauseMenu
          survival={survival}
          mapName={mapName}
          objective={objective}
          settings={settings}
          onSettings={update}
          dev={dev}
          lockError={lockError}
          onResume={resume}
          onRespawn={survival ? undefined : () => engineRef.current?.respawn()}
          onLobby={onLobby}
          onFullscreen={fullscreen}
        />
      )}
    </div>
  );
}
