"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ACTIONS, type GameSettings } from "@/game/ui/Settings";
import { PAD_ACTIONS } from "@/game/ui/Glyphs";
import { PAD_FOCUS_CSS, useGamepadNav, viaFromEvent, type DeviceSnapshot } from "./gamepad";
import { Hint, KeyGlyph, PadGlyph } from "./glyph";
import { SETTINGS_TABS, SettingsPanel, type SettingsTab } from "./settings-panel";

type View = "main" | "settings" | "controls";

export type PauseMenuProps = {
  survival: boolean;
  mapName: string;
  objective: string;
  settings: GameSettings;
  onSettings: (patch: Partial<GameSettings>) => void;
  dev: DeviceSnapshot;
  lockError: boolean;
  onResume: (via?: "pad") => void;
  onRespawn?: () => void;
  onLobby: () => void;
  onFullscreen?: () => void;
};

/**
 * Console-style pause menu: a vertical command list on the left, the active
 * page (briefing, settings, controls) on the right. Fully navigable with a
 * gamepad (d-pad/stick, A select, B back, LB/RB settings tabs, Start resume).
 */
export function PauseMenu(p: PauseMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>("main");
  const [tab, setTab] = useState<SettingsTab>("graphics");

  useGamepadNav(rootRef, {
    onBack: () => (view === "main" ? p.onResume("pad") : setView("main")),
    onStart: () => p.onResume("pad"),
    onTab: (dir) => {
      if (view !== "settings") return;
      const i = SETTINGS_TABS.findIndex((t) => t.id === tab);
      setTab(SETTINGS_TABS[(i + dir + SETTINGS_TABS.length) % SETTINGS_TABS.length].id);
    },
  });

  const item = (id: string, label: string, onClick: (e: React.MouseEvent) => void, opts: { active?: boolean; primary?: boolean } = {}) => (
    <button
      key={id}
      type="button"
      onClick={onClick}
      data-nav-default={opts.primary ? "" : undefined}
      className={cn(
        "group relative flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-bold tracking-[0.22em] uppercase transition-colors outline-none",
        opts.active ? "bg-amber-400/12 text-amber-200" : "text-neutral-300 hover:bg-white/[0.05] hover:text-white focus-visible:bg-white/[0.05]",
      )}
    >
      <span className={cn("absolute top-0 left-0 h-full w-[3px] bg-amber-400 transition-opacity", opts.active ? "opacity-100" : "opacity-0 group-hover:opacity-60")} />
      {label}
    </button>
  );

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 z-20 flex animate-in items-center justify-center overflow-y-auto bg-black/60 px-4 py-6 backdrop-blur-[6px] duration-200 fade-in"
      onMouseDown={(e) => {
        // Pointer lock was refused: any click on the backdrop retries.
        if (p.lockError && e.target === e.currentTarget) p.onResume();
      }}
    >
      <style>{PAD_FOCUS_CSS}</style>
      <div className="flex w-full max-w-5xl animate-in flex-col gap-4 duration-300 zoom-in-[0.98] md:flex-row" onMouseDown={(e) => e.stopPropagation()}>
        {/* Left: commands */}
        <nav className="flex w-full shrink-0 flex-col border-l border-white/10 md:w-64">
          <p className="px-4 font-mono text-[10px] tracking-[0.34em] text-amber-400/90 uppercase">Paused</p>
          <h1 className="px-4 pt-1 pb-4 text-2xl leading-tight font-black tracking-[0.04em] text-white uppercase">{p.mapName}</h1>
          {item("resume", "Resume", (e) => p.onResume(viaFromEvent(e)), { primary: true })}
          {item("settings", "Settings", () => setView("settings"), { active: view === "settings" })}
          {item("controls", "Controls", () => setView("controls"), { active: view === "controls" })}
          {p.onRespawn && item("respawn", "Reset position", () => p.onRespawn?.())}
          {p.onFullscreen && item("fullscreen", "Fullscreen", () => p.onFullscreen?.())}
          {item("lobby", p.survival ? "Abandon to lobby" : "Lobby", () => p.onLobby())}
          <Link
            href="/dashboard"
            className="px-4 py-2.5 text-sm font-bold tracking-[0.22em] text-neutral-500 uppercase transition-colors outline-none hover:text-neutral-200"
          >
            Exit to dashboard
          </Link>
        </nav>

        {/* Right: page */}
        <section className="min-h-[420px] min-w-0 flex-1 rounded-md border border-white/10 bg-neutral-950/85 p-5 text-neutral-100 shadow-2xl">
          {p.lockError && (
            <div role="alert" className="mb-4 rounded border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
              The browser didn&apos;t capture the mouse. <span className="font-semibold">Click anywhere</span> (or Resume) to try again — after pressing Esc, browsers
              need about a second before the mouse can be captured again.
            </div>
          )}
          {view === "main" && <Briefing {...p} />}
          {view === "settings" && <SettingsPanel settings={p.settings} onChange={p.onSettings} dev={p.dev} tab={tab} onTab={setTab} />}
          {view === "controls" && <Controls settings={p.settings} dev={p.dev} />}

          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/5 pt-3">
            <Hint dev={p.dev} pad="A" label="Select" />
            <Hint dev={p.dev} pad="B" label={view === "main" ? "Resume" : "Back"} />
            {view === "settings" && p.dev.device === "pad" && (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.16em] text-neutral-300 uppercase">
                <PadGlyph btn="LB" layout={p.dev.layout} />
                <PadGlyph btn="RB" layout={p.dev.layout} />
                Tabs
              </span>
            )}
            {p.dev.device !== "pad" && <Hint dev={p.dev} pad="MENU" keyCode="Escape" label="Pause / release mouse" />}
            {p.dev.device === "pad" && <Hint dev={p.dev} pad="MENU" label="Resume" />}
          </div>
        </section>
      </div>
    </div>
  );
}

function Briefing({ survival, objective, dev }: PauseMenuProps) {
  return (
    <div className="animate-in duration-200 fade-in">
      <p className="font-mono text-[10px] tracking-[0.3em] text-neutral-500 uppercase">{survival ? "Survival · Objective" : "Training · Objective"}</p>
      <p className="mt-2 max-w-prose text-base leading-relaxed text-neutral-200">{objective}</p>
      <div className="mt-6 grid gap-2 text-sm text-neutral-400">
        <p>
          {dev.connected ? (
            <>
              Controller detected ({dev.layout === "ps" ? "PlayStation-style" : "Xbox-style"} layout). Press <PadGlyph btn="MENU" layout={dev.layout} className="mx-0.5" /> or{" "}
              <PadGlyph btn="A" layout={dev.layout} className="mx-0.5" /> on Resume to play with it — no mouse capture needed.
            </>
          ) : (
            "Plug in a controller and press any button to play with it. Prompts switch automatically to whatever you touch last."
          )}
        </p>
      </div>
    </div>
  );
}

function Controls({ settings, dev }: { settings: GameSettings; dev: DeviceSnapshot }) {
  return (
    <div className="animate-in duration-200 fade-in">
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 gap-y-1.5 text-sm">
        <span className="text-[10px] font-semibold tracking-[0.24em] text-neutral-500 uppercase">Action</span>
        <span className="text-[10px] font-semibold tracking-[0.24em] text-neutral-500 uppercase">Keyboard</span>
        <span className="text-[10px] font-semibold tracking-[0.24em] text-neutral-500 uppercase">Controller</span>
        {ACTIONS.map((a) => (
          <div key={a.id} className="contents">
            <span className="text-neutral-300">{a.label}</span>
            <span className="flex justify-center">
              <KeyGlyph code={settings.bindings[a.id]} />
            </span>
            <span className="flex justify-center">
              <PadGlyph btn={PAD_ACTIONS[a.id]} layout={dev.layout} />
            </span>
          </div>
        ))}
        <span className="text-neutral-300">Switch weapon (direct)</span>
        <span className="flex justify-center gap-1">
          <KeyGlyph code="Digit1" />
          <KeyGlyph code="Digit2" />
        </span>
        <span />
        <span className="text-neutral-300">Debug overlay</span>
        <span className="flex justify-center">
          <KeyGlyph code="F3" />
        </span>
        <span />
      </div>
      <p className="mt-4 text-xs text-neutral-500">Rebind keys in Settings → Keybinds.</p>
    </div>
  );
}
