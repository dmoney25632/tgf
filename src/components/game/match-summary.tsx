"use client";

import Link from "next/link";
import { useRef } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MatchSummary } from "@/game/core/GameMode";
import { ENEMIES, type EnemyType } from "@/game/survival/config";
import { PAD_FOCUS_CSS, useGamepadNav } from "./gamepad";

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const fmt = (n: number) => n.toLocaleString("en-US");

/** End-of-match report with replay / loadout / exit actions. */
export function MatchSummaryView({
  s,
  saved,
  onAgain,
  onLobby,
}: {
  s: MatchSummary;
  saved: string;
  onAgain: () => void;
  onLobby: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useGamepadNav(rootRef, { onY: onAgain, onBack: onLobby });
  const acc = s.shotsFired ? ((s.shotsHit / s.shotsFired) * 100).toFixed(1) : "0.0";
  // Only waves actually played this run count — skipped waves don't earn score.
  const cleared = Math.max(0, s.wavesSurvived - (s.startWave - 1));
  const score = s.kills * 100 + s.headshots * 50 + cleared * 500 + (s.victory ? 2500 : 0);
  const stat = (label: string, value: string | number, accent = false) => (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2.5">
      <div className="text-[11px] tracking-wider text-neutral-500 uppercase">{label}</div>
      <div className={cn("mt-0.5 text-xl font-bold tabular-nums", accent && "text-amber-300")}>{value}</div>
    </div>
  );
  const skipped = s.startWave > 1 ? ` (started at wave ${s.startWave})` : "";
  const waves = `Cleared ${cleared} wave${cleared === 1 ? "" : "s"}${skipped} · reached wave ${s.wavesSurvived + (s.victory ? 0 : 1)}${s.waveTarget ? ` of ${s.waveTarget}` : " (endless)"} in ${fmtTime(s.seconds)}.`;

  return (
    <div ref={rootRef} className="absolute inset-0 z-20 flex animate-in items-center justify-center overflow-y-auto bg-black/70 px-4 py-6 backdrop-blur duration-500 fade-in">
      <style>{PAD_FOCUS_CSS}</style>
      <div className="w-full max-w-3xl animate-in rounded-xl duration-500 slide-in-from-bottom-4 border border-white/10 bg-neutral-950/95 p-6 text-neutral-100">
        <p className="font-mono text-[11px] tracking-[0.3em] text-neutral-500 uppercase">
          {s.map} · {s.difficulty} · {s.operator}
        </p>
        <h2 className={cn("mt-1 text-4xl font-black tracking-tight", s.victory ? "text-lime-300" : "text-red-400")}>
          {s.victory ? "Outpost held" : "Mission failed"}
        </h2>
        <p className="mt-1 text-neutral-400">{waves}</p>

        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {stat("Score", fmt(score), true)}
          {stat("Eliminations", s.kills)}
          {stat("Headshot kills", s.headshots)}
          {stat("Accuracy", `${acc}%`)}
          {stat("Damage dealt", fmt(s.damageDealt))}
          {stat("Damage taken", fmt(s.damageTaken))}
          {stat("Times downed", s.timesDowned)}
          {stat("Funds earned", `$${fmt(s.moneyEarned)}`)}
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          {(Object.keys(s.killsByType) as EnemyType[]).map((t) => (
            <span key={t} className="rounded border border-white/10 px-2 py-1 text-neutral-300">
              {ENEMIES[t]?.name ?? t} × {s.killsByType[t]}
            </span>
          ))}
          {s.meleeKills > 0 && <span className="rounded border border-white/10 px-2 py-1 text-neutral-300">Knife × {s.meleeKills}</span>}
          {s.grenadeKills > 0 && <span className="rounded border border-white/10 px-2 py-1 text-neutral-300">Frag × {s.grenadeKills}</span>}
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <button type="button" data-nav-default onClick={onAgain} className={cn(buttonVariants({ size: "lg" }), "h-11 flex-1")}>
            Play again
          </button>
          <button type="button" onClick={onLobby} className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-11 flex-1")}>
            Change loadout
          </button>
          <Link href="/dashboard" className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "h-11")}>
            Dashboard
          </Link>
        </div>
        {saved && <p className="mt-3 text-xs text-neutral-500">{saved}</p>}
      </div>
    </div>
  );
}
