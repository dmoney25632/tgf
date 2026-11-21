"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button-variants";
import type { MatchSummary } from "@/game/core/GameMode";
import { getMission } from "@/game/missions/campaign";
import { clock, rateMission } from "@/game/missions/rating";
import { saveMissionRun } from "@/app/play/[gameId]/mission-actions";
import { PAD_FOCUS_CSS, useGamepadNav } from "@/components/game/gamepad";
import { MissionBoardTable, Stars } from "./mission-board";
import { useMissionBoard } from "./mission-screen";

/** Runs already submitted this page load (StrictMode mounts effects twice). */
const submitted = new Set<string>();

/**
 * Mission complete / failed screen: stars and how they were earned, time
 * against the targets, the objective tally and score, and the run's
 * submission to the fastest-clear board (solo or co-op).
 */
export function MissionDebrief({
  s,
  saved,
  callsign,
  mode,
  squad,
  onAgain,
  onLobby,
  againLabel = "Retry mission",
  lobbyLabel = "Missions",
}: {
  s: MatchSummary;
  saved: string;
  callsign: string;
  mode: "solo" | "coop";
  /** Human players in the run. */
  squad: number;
  onAgain?: () => void;
  onLobby: () => void;
  againLabel?: string;
  lobbyLabel?: string;
}) {
  const r = s.mission;
  const def = r ? getMission(r.missionId) : undefined;
  const rootRef = useRef<HTMLDivElement>(null);
  useGamepadNav(rootRef, { onY: onAgain, onBack: onLobby });
  const [status, setStatus] = useState<string>(r?.victory ? "Submitting your time…" : "");
  const [bump, setBump] = useState(0);
  const board = useMissionBoard(r?.missionId ?? "", bump);

  useEffect(() => {
    if (!r?.victory || r.stars < 1) return;
    const key = `${r.missionId}:${r.seconds}:${r.kills}:${s.shotsFired}`;
    if (submitted.has(key)) return;
    submitted.add(key);
    saveMissionRun({ missionId: r.missionId, mode, difficulty: r.difficulty, seconds: r.seconds, stars: r.stars, deaths: r.retries * 2 + r.downs, squad: mode === "solo" ? 1 : Math.max(2, squad) })
      .then((res) => {
        setStatus(res.ok ? `Time recorded on the ${mode === "solo" ? "solo" : "co-op"} board.` : res.error === "offline" ? "Offline mode: times aren't recorded." : `Time not recorded: ${res.error}.`);
        if (res.ok) setBump((b) => b + 1);
      })
      .catch(() => setStatus("Time not recorded (network error)."));
  }, [r, mode, squad, s.shotsFired]);

  if (!r || !def) return null;
  const rating = rateMission(def, { victory: r.victory, seconds: r.seconds, difficulty: r.difficulty, retries: r.retries, downs: r.downs, stealth: r.stealth });
  const t = rating.targets;
  const stat = (label: string, value: string | number) => (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
      <div className="text-[10px] tracking-wider text-neutral-500 uppercase">{label}</div>
      <div className="mt-0.5 text-lg font-bold tabular-nums">{value}</div>
    </div>
  );

  return (
    <div ref={rootRef} className="absolute inset-0 z-40 overflow-y-auto bg-black/85 text-neutral-100 backdrop-blur-sm">
      <style>{PAD_FOCUS_CSS}</style>
      <div className="mx-auto max-w-5xl px-5 py-10 md:px-8">
        <p className="font-mono text-[11px] tracking-[0.3em] text-white/70 uppercase">
          {r.codename} · {mode === "solo" ? "Solo" : `Co-op · ${squad} players`}
        </p>
        <h1 className={cn("mt-1 text-4xl font-black tracking-[0.05em] uppercase md:text-6xl", r.victory ? "text-white" : "text-red-300")}>{r.victory ? "Mission complete" : "Mission failed"}</h1>
        <p className="mt-1 text-sm text-neutral-400">{r.victory ? r.title : r.failReason || r.title}</p>

        <div className="mt-6 grid gap-6 md:grid-cols-[1fr_1.1fr]">
          <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
            <Stars n={rating.stars} className="text-5xl" />
            <div className="mt-3 flex items-baseline gap-3">
              <span className="font-mono text-3xl font-black tabular-nums">{clock(r.seconds)}</span>
              <span className="text-sm text-neutral-400">{r.difficulty.charAt(0).toUpperCase() + r.difficulty.slice(1)}</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1 font-mono text-xs text-neutral-400">
              <span>
                <Stars n={3} /> ≤ {r.difficulty === "recruit" ? "—" : clock(t.three)}
              </span>
              <span>
                <Stars n={2} /> ≤ {clock(t.two)}
              </span>
            </div>
            <ul className="mt-3 space-y-1 text-xs text-neutral-300">
              {rating.notes.map((n) => (
                <li key={n}>· {n}</li>
              ))}
            </ul>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {stat("Objectives", `${r.objectivesDone}/${r.objectivesTotal}`)}
              {stat("Checkpoint restarts", r.retries)}
              {stat("Downs", r.downs)}
              {stat("Kills", r.kills)}
              {stat("Headshots", r.headshots)}
              {r.stealth ? stat("Silent takedowns", r.stealth.takedowns) : stat("Gunships", r.gunships)}
              {r.stealth && stat("Alarms", r.stealth.alarms)}
              {r.stealth && stat("Times spotted", r.stealth.spotted)}
              {r.stealth && stat("Bodies found", r.stealth.bodies)}
            </div>
            <div className="mt-4 text-sm">
              {r.breakdown.filter((b) => b.value !== 0).map((b) => (
                <div key={b.label} className="flex justify-between border-t border-white/5 py-1">
                  <span className="text-neutral-400">{b.label}</span>
                  <span className="font-mono tabular-nums">{b.value.toLocaleString("en-US")}</span>
                </div>
              ))}
              <div className="flex justify-between border-t border-white/20 py-1.5 font-bold">
                <span>Score · grade {r.grade}</span>
                <span className="font-mono tabular-nums">{r.score.toLocaleString("en-US")}</span>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
            <h2 className="font-mono text-[11px] tracking-[0.25em] text-neutral-400 uppercase">Fastest {mode === "solo" ? "solo" : "co-op"} clears</h2>
            <div className="mt-3">
              {!board ? (
                <p className="text-sm text-neutral-500">Loading…</p>
              ) : board.offline ? (
                <p className="text-sm text-neutral-400">Offline mode: mission times aren&apos;t recorded.</p>
              ) : (
                <MissionBoardTable rows={board[mode]} me={callsign} compact empty="No clears yet." />
              )}
            </div>
            {status && <p className="mt-3 text-xs text-neutral-300">{status}</p>}
            {saved && <p className="mt-1 text-xs text-neutral-500">{saved}</p>}
          </section>
        </div>

        <div className="mt-8 flex flex-wrap gap-2">
          {onAgain && (
            <button type="button" data-nav-default onClick={onAgain} className={cn(buttonVariants({ size: "lg" }), "h-11 px-8 font-bold tracking-wider uppercase")}>
              {againLabel}
            </button>
          )}
          <button type="button" onClick={onLobby} className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-11 px-6 font-bold tracking-wider uppercase")}>
            {lobbyLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
