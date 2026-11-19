"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GameEngine, GameSettings } from "@/game/core/Engine";
import type { EngineEvent, MatchSummary } from "@/game/core/GameMode";
import type { SurvivalGameMode } from "@/game/survival/SurvivalGameMode";
import { detectQuality, QUALITY, type QualityName } from "@/game/config";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { saveMatch } from "@/app/play/[gameId]/actions";
import { DEFAULT_CHOICE, Lobby, type LobbyChoice } from "./lobby";
import { ShopOverlay } from "./shop-overlay";
import { MatchSummaryView } from "./match-summary";

const CONTROLS: [string, string][] = [
  ["WASD", "Move"],
  ["Shift", "Sprint"],
  ["C / Ctrl", "Crouch (toggle / hold)"],
  ["C while sprinting", "Slide"],
  ["Space", "Jump"],
  ["LMB / RMB", "Fire / Aim"],
  ["R", "Reload"],
  ["V", "Knife"],
  ["G", "Frag grenade"],
  ["1-2 · Q · Wheel", "Switch weapon"],
  ["F", "Interact / revive / armory"],
  ["N", "Ready up (between waves)"],
  ["Tab", "Scoreboard"],
  ["F3", "Debug overlay"],
];

const SETTINGS_KEY = "tgf.iron-horizon.settings";
const LOBBY_KEY = "tgf.iron-horizon.lobby";

function load<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<T>) } : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked (private mode etc.) — preferences just won't persist.
  }
}

/**
 * Iron Horizon host: lobby → match. The engine (and Three.js) is imported
 * lazily so it never ships with the rest of the site.
 */
export function IronHorizonClient({ callsign }: { callsign: string }) {
  const [choice, setChoice] = useState<LobbyChoice | null>(null);
  const [inGame, setInGame] = useState(false);
  const [run, setRun] = useState(0);

  useEffect(() => {
    // Restore the last lobby picks after mount (localStorage isn't available during SSR).
    const restored = load(LOBBY_KEY, DEFAULT_CHOICE);
    queueMicrotask(() => setChoice(restored));
  }, []);

  if (!choice) return <div className="fixed inset-0 bg-black" aria-busy="true" />;

  if (!inGame) {
    return (
      <Lobby
        callsign={callsign}
        initial={choice}
        onDeploy={(c) => {
          save(LOBBY_KEY, c);
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

function GameView({ callsign, choice, onAgain, onLobby }: { callsign: string; choice: LobbyChoice; onAgain: () => void; onLobby: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [ready, setReady] = useState(false);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<GameSettings | null>(null);
  const [shopOpen, setShopOpen] = useState(false);
  const [summary, setSummary] = useState<MatchSummary | null>(null);
  const [saved, setSaved] = useState("");
  const [survivalMode, setSurvivalMode] = useState<SurvivalGameMode | null>(null);
  const survival = choice.mode === "survival";

  const onEvent = useCallback((e: EngineEvent) => {
    if (e.type === "shop") setShopOpen(e.open);
    if (e.type === "end") {
      setSummary(e.summary);
      setShopOpen(false);
      const s = e.summary;
      saveMatch({
        gameId: "iron-horizon",
        mode: "survival",
        map: s.map,
        kills: s.kills,
        deaths: s.timesDowned,
        shotsFired: s.shotsFired,
        shotsHit: s.shotsHit,
        won: s.victory,
      })
        .then((r) => setSaved(r.ok ? "Match saved to your career stats." : r.error === "offline" ? "Offline mode — stats not saved." : `Stats not saved: ${r.error}`))
        .catch(() => setSaved("Stats not saved (network error)."));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let engine: GameEngine | null = null;
    const initial = load<GameSettings>(SETTINGS_KEY, { sensitivity: 1, adsSensitivity: 1, quality: detectQuality(), volume: 0.8 });

    import("@/game/core/Engine")
      .then(({ GameEngine }) => {
        if (cancelled || !hostRef.current) return;
        engine = new GameEngine(hostRef.current, {
          callsign,
          settings: initial,
          mode: choice.mode,
          mapId: choice.map,
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
          onLockChange: setLocked,
          onEvent,
        });
        engine.start();
        engineRef.current = engine;
        setSettings(initial);
        setSurvivalMode(engine.survival);
        if (process.env.NODE_ENV !== "production") (window as unknown as { __tgf?: GameEngine }).__tgf = engine;
        setReady(true);
      })
      .catch((e: unknown) => {
        console.error(e);
        const msg = e instanceof Error ? e.message : String(e);
        setError(
          /webgl|context/i.test(msg)
            ? "Couldn't start 3D graphics. Enable hardware acceleration or try a recent Chrome, Edge or Firefox."
            : `Failed to start the game: ${msg}`,
        );
      });

    return () => {
      cancelled = true;
      engine?.dispose();
      engineRef.current = null;
    };
  }, [callsign, choice, onEvent]);

  const update = (patch: Partial<GameSettings>) => {
    if (!settings) return;
    // Side effects stay out of the state updater (StrictMode runs updaters twice).
    const next = { ...settings, ...patch };
    engineRef.current?.applySettings(patch);
    save(SETTINGS_KEY, next);
    setSettings(next);
  };

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

  const resumeFromShop = (ready: boolean) => {
    const s = survivalMode;
    if (!s) return;
    if (ready) s.readyUp();
    else s.closeShop();
    setShopOpen(false);
    engineRef.current?.lock();
  };

  const showPause = !locked && !shopOpen && !summary;

  return (
    <div className="fixed inset-0 bg-black">
      <div ref={hostRef} className="absolute inset-0" />

      {shopOpen && survivalMode && <ShopOverlay mode={survivalMode} onResume={resumeFromShop} />}

      {summary && <MatchSummaryView s={summary} saved={saved} onAgain={onAgain} onLobby={onLobby} />}

      {showPause && (
        <div className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-black/55 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl border border-white/10 bg-neutral-950/90 p-6 text-neutral-100">
            <p className="font-mono text-[11px] tracking-[0.3em] text-amber-400/80 uppercase">
              Iron Horizon · {survival ? "Survival" : "Training"}
            </p>
            <h1 className="mt-1 text-2xl font-bold">{survival ? "Dustfall Outpost" : "Kestrel Yard — Firing Range"}</h1>
            <p className="mt-1 text-sm text-neutral-400">
              {survival
                ? "Hold the compound. Armories (F) and ammo crates open between waves. Squadmates revive you if you go down."
                : `Operator ${callsign}. Targets reset after 2.5 s. Steel plates hang at 70 m.`}
            </p>

            {error ? (
              <p className="mt-4 text-sm text-red-400">{error}</p>
            ) : (
              <div className="mt-5 flex gap-2">
                <button
                  type="button"
                  disabled={!ready}
                  onClick={() => engineRef.current?.lock()}
                  className={cn(buttonVariants({ size: "lg" }), "h-11 flex-1 text-base")}
                >
                  {ready ? "Click to deploy" : "Loading…"}
                </button>
                <button
                  type="button"
                  disabled={!ready}
                  onClick={fullscreen}
                  className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-11")}
                  title="Fullscreen also lets Ctrl crouch safely"
                >
                  Fullscreen
                </button>
              </div>
            )}

            {settings && (
              <div className="mt-6 grid gap-4 text-sm">
                <Slider label="Sensitivity" value={settings.sensitivity} min={0.2} max={3} step={0.05} onChange={(v) => update({ sensitivity: v })} />
                <Slider
                  label="ADS sensitivity"
                  value={settings.adsSensitivity}
                  min={0.3}
                  max={2}
                  step={0.05}
                  onChange={(v) => update({ adsSensitivity: v })}
                />
                <Slider label="Volume" value={settings.volume} min={0} max={1} step={0.05} onChange={(v) => update({ volume: v })} />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-neutral-400">Quality</span>
                  <div className="flex flex-wrap gap-1">
                    {(Object.keys(QUALITY) as QualityName[]).map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => update({ quality: q })}
                        className={cn(buttonVariants({ variant: settings.quality === q ? "default" : "outline", size: "sm" }), "min-w-16")}
                      >
                        {QUALITY[q].label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              {CONTROLS.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="font-mono text-neutral-300">{k}</dt>
                  <dd className="text-neutral-500">{v}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-6 flex gap-2">
              {!survival && (
                <button
                  type="button"
                  disabled={!ready}
                  onClick={() => engineRef.current?.respawn()}
                  className={cn(buttonVariants({ variant: "outline" }), "flex-1")}
                >
                  Reset position
                </button>
              )}
              <button type="button" onClick={onLobby} className={cn(buttonVariants({ variant: "outline" }), "flex-1")}>
                {survival ? "Abandon to lobby" : "Lobby"}
              </button>
              <Link href="/dashboard" className={cn(buttonVariants({ variant: "ghost" }), "flex-1")}>
                Exit to dashboard
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Slider(props: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="w-32 shrink-0 text-neutral-400">{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="flex-1 accent-amber-400"
      />
      <span className="w-12 text-right font-mono tabular-nums">{props.value.toFixed(2)}</span>
    </label>
  );
}
