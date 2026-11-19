"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MatchSummary } from "@/game/core/GameMode";
import type { MissionResult } from "@/game/missions/types";
import { PAD_FOCUS_CSS, useGamepadNav } from "@/components/game/gamepad";

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const fmt = (n: number) => n.toLocaleString("en-US");

const GRADE_COLOR: Record<MissionResult["grade"], string> = {
  S: "text-amber-300",
  A: "text-lime-300",
  B: "text-sky-300",
  C: "text-neutral-300",
  D: "text-red-400",
};

/** Mission debrief: grade, score breakdown and combat stats. */
export function MissionSummaryView({
  s,
  r,
  saved,
  onAgain,
  onLobby,
  onResult,
}: {
  s: MatchSummary;
  r: MissionResult;
  saved: string;
  onAgain: () => void;
  onLobby: () => void;
  /** Called once when the debrief appears (best-grade bookkeeping). */
  onResult?: (r: MissionResult) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const reported = useRef(false);
  useEffect(() => {
    if (reported.current) return;
    reported.current = true;
    onResult?.(r);
  }, [r, onResult]);
  useGamepadNav(rootRef, { onY: onAgain, onBack: onLobby });
  const acc = s.shotsFired ? ((s.shotsHit / s.shotsFired) * 100).toFixed(1) : "0.0";
  const stat = (label: string, value: string | number) => (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2.5">
      <div className="text-[11px] tracking-wider text-neutral-500 uppercase">{label}</div>
      <div className="mt-0.5 text-xl font-bold tabular-nums">{value}</div>
    </div>
  );

  return (
    <div ref={rootRef} className="absolute inset-0 z-20 flex animate-in items-center justify-center overflow-y-auto bg-black/70 px-4 py-6 backdrop-blur duration-500 fade-in">
      <style>{PAD_FOCUS_CSS}</style>
      <div className="w-full max-w-3xl animate-in rounded-xl border border-white/10 bg-neutral-950/95 p-6 text-neutral-100 duration-500 slide-in-from-bottom-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] tracking-[0.3em] text-neutral-500 uppercase">
              {r.codename} · {s.map} · {s.difficulty}
            </p>
            <h2 className={cn("mt-1 text-4xl font-black tracking-tight", r.victory ? "text-lime-300" : "text-red-400")}>
              {r.victory ? `${r.title} — complete` : "Mission failed"}
            </h2>
            <p className="mt-1 text-neutral-400">
              {r.objectivesDone} / {r.objectivesTotal} objectives · {fmtTime(r.seconds)} (par {fmtTime(r.par)}) · {r.retries} checkpoint {r.retries === 1 ? "retry" : "retries"}
              {r.failReason ? ` · ${r.failReason.toLowerCase()}` : ""}
            </p>
          </div>
          <div className="text-right">
            <div className={cn("text-6xl leading-none font-black", GRADE_COLOR[r.grade])}>{r.grade}</div>
            <div className="mt-1 font-mono text-xs text-neutral-500">GRADE</div>
          </div>
        </div>

        <div className="mt-5 grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="rounded-lg border border-white/10 bg-black/30 p-3">
            {r.breakdown.map((b) => (
              <div key={b.label} className="flex justify-between py-1 text-sm">
                <span className="text-neutral-400">{b.label}</span>
                <span className={cn("tabular-nums", b.value < 0 ? "text-red-300" : "text-neutral-200")}>{fmt(b.value)}</span>
              </div>
            ))}
            <div className="mt-1 flex justify-between border-t border-white/10 pt-2 font-bold">
              <span>Score</span>
              <span className="text-amber-300 tabular-nums">{fmt(r.score)}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {stat("Eliminations", r.kills)}
            {stat("Headshots", r.headshots)}
            {stat("Gunships", r.gunships)}
            {stat("Accuracy", `${acc}%`)}
            {stat("Damage dealt", fmt(s.damageDealt))}
            {stat("Times downed", s.timesDowned)}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <button type="button" data-nav-default onClick={onAgain} className={cn(buttonVariants({ size: "lg" }), "h-11 flex-1")}>
            Replay mission
          </button>
          <button type="button" onClick={onLobby} className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-11 flex-1")}>
            Mission select
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
