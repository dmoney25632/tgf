"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { DeviceSnapshot } from "./gamepad";
import { PadGlyph } from "./glyph";

const TIPS = [
  "Sprint, then crouch to slide — you keep the speed and drop under fire.",
  "Aiming or firing cancels a sprint. Weapons are slower to raise straight out of one.",
  "Headshots pay a bonus in funds. Heavies wear armor that shrugs off body shots.",
  "Armories and ammo crates only open between waves. Plan your spending.",
  "A downed squadmate bleeds out — hold interact beside them to bring them back.",
  "Shotguns can interrupt a shell reload: fire as soon as there's a round in the tube.",
  "Snipers sit on perches. Watch for the glint of a laser before you cross open ground.",
  "Frags bounce. Cook them off walls to clear a corner without exposing yourself.",
  "On a controller, click the left stick to sprint and hold X / □ to interact.",
  "Settings → Controller lets you tune response curve, deadzone and aim assist.",
];

/**
 * Pre-match loading screen: map card, real progress (asset loader driven,
 * timed fallback), rotating tips, then "deploy" once everything is ready.
 */
export function LoadingScreen({
  mapName,
  modeLabel,
  objective,
  progress,
  ready,
  leaving,
  dev,
  error,
  notice,
  onDeploy,
  onGone,
}: {
  mapName: string;
  modeLabel: string;
  objective: string;
  progress: number;
  ready: boolean;
  leaving: boolean;
  dev: DeviceSnapshot;
  error: string | null;
  notice?: string;
  onDeploy: (e: React.MouseEvent) => void;
  onGone: () => void;
}) {
  const [tip, setTip] = useState(() => Math.floor(Math.random() * TIPS.length));
  useEffect(() => {
    const t = window.setInterval(() => setTip((i) => (i + 1) % TIPS.length), 5200);
    return () => window.clearInterval(t);
  }, []);
  const pct = Math.round(progress * 100);

  return (
    <div
      className={cn(
        "absolute inset-0 z-30 flex flex-col justify-end overflow-hidden bg-[#090a08] text-neutral-100 transition-opacity duration-500",
        leaving ? "pointer-events-none opacity-0" : "opacity-100",
      )}
      onTransitionEnd={(e) => {
        if (leaving && e.target === e.currentTarget) onGone();
      }}
      onClick={ready && !leaving ? onDeploy : undefined}
      role={ready ? "button" : undefined}
      aria-label={ready ? "Deploy" : undefined}
    >
      {/* Backdrop: graded gradient + scanline texture (no imagery needed). */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_20%,rgba(214,170,96,.16),transparent_60%),radial-gradient(ellipse_at_10%_90%,rgba(60,90,80,.18),transparent_55%)]" />
      <div className="absolute inset-0 opacity-[0.07] [background:repeating-linear-gradient(0deg,#fff_0,#fff_1px,transparent_1px,transparent_3px)]" />
      <div className="absolute top-0 left-0 h-full w-1 bg-amber-400/70" />

      <div className="relative mx-auto w-full max-w-5xl px-6 pb-10 md:px-10 md:pb-14">
        <p className="font-mono text-[11px] tracking-[0.36em] text-amber-400/90 uppercase">Iron Horizon · {modeLabel}</p>
        <h1 className="mt-2 text-4xl font-black tracking-[0.06em] uppercase md:text-6xl">{mapName}</h1>
        <p className="mt-2 max-w-xl text-sm text-neutral-400 md:text-base">{objective}</p>

        <div className="mt-10 flex items-end justify-between gap-6">
          <p key={tip} className="max-w-xl animate-in text-sm text-neutral-300 duration-500 fade-in slide-in-from-bottom-1">
            <span className="mr-2 font-mono text-[10px] tracking-[0.3em] text-amber-400/80 uppercase">Tip</span>
            {TIPS[tip]}
          </p>
          <span className="shrink-0 font-mono text-sm text-neutral-400 tabular-nums">{error ? "ERR" : `${pct}%`}</span>
        </div>
        <div className="mt-3 h-[3px] w-full overflow-hidden bg-white/10">
          <div className="h-full origin-left bg-amber-400 transition-transform duration-200 ease-out" style={{ transform: `scaleX(${progress})` }} />
        </div>

        <div className="mt-5 min-h-8">
          {notice && !error && <p className="mb-2 text-xs text-amber-200/90">{notice}</p>}
          {error ? (
            <p className="text-sm text-red-400">{error}</p>
          ) : ready ? (
            <button
              type="button"
              data-nav-default
              onClick={(e) => {
                e.stopPropagation();
                onDeploy(e);
              }}
              className="inline-flex animate-pulse items-center gap-2.5 text-sm font-bold tracking-[0.3em] text-neutral-100 uppercase outline-none"
            >
              {dev.device === "pad" ? <PadGlyph btn="A" layout={dev.layout} size={22} /> : <span className="rounded border border-white/40 px-2 py-0.5 text-[11px]">Click</span>}
              to deploy
            </button>
          ) : (
            <p className="font-mono text-[11px] tracking-[0.3em] text-neutral-500 uppercase">Loading assets…</p>
          )}
        </div>
      </div>
    </div>
  );
}
