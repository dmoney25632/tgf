"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button-variants";
import { ALL_MISSIONS, getMission } from "@/game/missions/campaign";
import { OPERATIONS } from "@/game/missions/operations";
import { starTargets, clock } from "@/game/missions/rating";
import { DIFFICULTY, OPERATORS, type DifficultyId } from "@/game/survival/config";
import { getMissionBoard, type MissionBoard } from "@/app/play/[gameId]/mission-actions";
import { PAD_FOCUS_CSS, useGamepadNav } from "@/components/game/gamepad";
import type { LobbyChoice } from "@/components/game/lobby";
import { MissionBoardTable, Stars } from "./mission-board";

/** Standalone operations first, then the Sarrow Basin campaign. */
const LIST = [...OPERATIONS, ...ALL_MISSIONS.filter((m) => !OPERATIONS.includes(m))];

const ART: Record<string, string> = {
  "iron-crossing": "radial-gradient(ellipse at 70% 10%, rgba(214,226,236,.36), transparent 55%), linear-gradient(170deg, #46505a, #10141a 72%)",
};
const art = (id: string) => ART[id] ?? "radial-gradient(ellipse at 75% 20%, rgba(220,226,232,.3), transparent 60%), linear-gradient(160deg, #3a3d40, #121314 70%)";

/** Loads the fastest-times boards for a mission (empty offline). */
export function useMissionBoard(missionId: string, bump = 0) {
  const [board, setBoard] = useState<MissionBoard | null>(null);
  useEffect(() => {
    let live = true;
    getMissionBoard(missionId)
      .then((b) => live && setBoard(b))
      .catch(() => live && setBoard({ solo: [], coop: [], mine: { solo: null, coop: null }, offline: false }));
    return () => {
      live = false;
    };
  }, [missionId, bump]);
  return board;
}

/**
 * Mission select + briefing: pick an operation, read the briefing and the
 * objective chain, see the star target times for the chosen difficulty and
 * the fastest-clear boards, then deploy solo or host a co-op party.
 *
 * Entry hooks (see components/game/iron-horizon-client.tsx): the lobby's
 * "Missions" button and the `/play/iron-horizon?mission=<id>` route.
 */
export function MissionScreen({
  callsign,
  initial,
  partyUnavailable,
  onDeploy,
  onHostCoop,
  onBack,
}: {
  callsign: string;
  initial: LobbyChoice;
  /** Reason co-op is unavailable (null when parties work). */
  partyUnavailable: string | null;
  onDeploy: (c: LobbyChoice) => void;
  onHostCoop: (c: LobbyChoice) => void;
  onBack: () => void;
}) {
  const [c, setC] = useState<LobbyChoice>(() => ({ ...initial, mission: getMission(initial.mission ?? "")?.id ?? LIST[0].id }));
  const [boardMode, setBoardMode] = useState<"solo" | "coop">("solo");
  const def = getMission(c.mission!) ?? LIST[0];
  const board = useMissionBoard(def.id);
  const rootRef = useRef<HTMLDivElement>(null);
  const deploy = () => onDeploy({ ...c, mission: def.id });
  useGamepadNav(rootRef, { onStart: deploy, onBack });
  const set = (patch: Partial<LobbyChoice>) => setC((p) => ({ ...p, ...patch }));
  const op = OPERATORS[c.operator];
  const rows = board ? board[boardMode] : [];
  const mine = board?.mine[boardMode] ?? null;

  return (
    <div ref={rootRef} className="fixed inset-0 overflow-y-auto text-neutral-100">
      <style>{PAD_FOCUS_CSS}</style>
      <div aria-hidden className="pointer-events-none fixed inset-0 opacity-60 transition-[background] duration-700" style={{ background: art(def.id) }} />
      <div aria-hidden className="pointer-events-none fixed inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,.3),rgba(0,0,0,.86)_55%,#000)]" />

      <div className="relative mx-auto max-w-7xl px-4 pt-5 pb-32 md:px-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] tracking-[0.3em] text-neutral-400 uppercase">Iron Horizon · Missions</p>
            <p className="mt-1 text-lg leading-none font-black tracking-[0.18em] uppercase">Operator {callsign}</p>
          </div>
          <button type="button" onClick={onBack} className={buttonVariants({ variant: "ghost", size: "sm" })}>
            ← Lobby
          </button>
        </header>

        <div className="mt-6 grid gap-6 lg:grid-cols-[260px_1fr]">
          {/* Mission list */}
          <nav className="flex gap-2 overflow-x-auto lg:flex-col" aria-label="Missions">
            {LIST.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => set({ mission: m.id })}
                className={cn(
                  "min-w-[200px] rounded-lg border p-3 text-left transition-colors lg:min-w-0",
                  def.id === m.id ? "border-white/80 bg-white/[0.14]" : "border-white/10 bg-white/[0.03] hover:border-white/30",
                )}
              >
                <div className="font-mono text-[10px] tracking-[0.2em] text-neutral-400 uppercase">{OPERATIONS.includes(m) ? "Operation" : `Campaign ${m.index}`}</div>
                <div className="mt-0.5 font-bold">{m.title}</div>
                <div className="text-xs text-neutral-400">{m.location}</div>
              </button>
            ))}
          </nav>

          <div className="grid gap-6 xl:grid-cols-[1.25fr_1fr]">
            {/* Briefing */}
            <section className="rounded-xl border border-white/10 bg-black/40 p-5 backdrop-blur-sm">
              <p className="font-mono text-[11px] tracking-[0.3em] text-white/80 uppercase">{def.codename}</p>
              <h1 className="mt-1 text-4xl font-black tracking-[0.04em] uppercase md:text-5xl">{def.title}</h1>
              <p className="mt-1 text-sm text-neutral-400">
                {def.location} · {def.time}
              </p>
              <p className="mt-4 text-sm leading-relaxed text-neutral-200">{def.briefing}</p>
              {def.notes && (
                <ul className="mt-3 space-y-1.5 text-sm text-neutral-300">
                  {def.notes.map((n) => (
                    <li key={n} className="flex gap-2">
                      <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-white/60" />
                      {n}
                    </li>
                  ))}
                </ul>
              )}
              <h2 className="mt-5 font-mono text-[11px] tracking-[0.25em] text-neutral-400 uppercase">Objectives</h2>
              <ol className="mt-2 space-y-1.5">
                {def.objectives.map((o, i) => (
                  <li key={o.title} className="flex gap-3 text-sm">
                    <span className="w-5 shrink-0 font-mono text-neutral-500 tabular-nums">{i + 1}</span>
                    <span>
                      <span className="font-semibold tracking-wide">{o.title}</span>
                      {o.detail && <span className="block text-xs text-neutral-400">{o.detail}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            </section>

            <div className="grid content-start gap-6">
              {/* Setup */}
              <section className="rounded-xl border border-white/10 bg-black/40 p-5 backdrop-blur-sm">
                <h2 className="font-mono text-[11px] tracking-[0.25em] text-neutral-400 uppercase">Difficulty</h2>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(Object.keys(DIFFICULTY) as DifficultyId[]).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => set({ difficulty: d })}
                      className={cn("rounded-md border px-3 py-1.5 text-sm", c.difficulty === d ? "border-white/80 bg-white/15" : "border-white/10 bg-white/[0.03] hover:border-white/30")}
                    >
                      {DIFFICULTY[d].name}
                    </button>
                  ))}
                </div>
                <table className="mt-3 w-full text-sm">
                  <thead className="text-left font-mono text-[10px] tracking-[0.15em] text-neutral-500 uppercase">
                    <tr>
                      <th className="py-1 font-normal">Target times</th>
                      <th className="py-1 text-right font-normal">
                        <Stars n={3} />
                      </th>
                      <th className="py-1 text-right font-normal">
                        <Stars n={2} />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(Object.keys(DIFFICULTY) as DifficultyId[]).map((d) => {
                      const t = starTargets(def, d);
                      return (
                        <tr key={d} className={cn("border-t border-white/5", c.difficulty === d ? "text-white" : "text-neutral-500")}>
                          <td className="py-1">{DIFFICULTY[d].name}</td>
                          <td className="py-1 text-right font-mono tabular-nums">{d === "recruit" ? "—" : `≤ ${clock(t.three)}`}</td>
                          <td className="py-1 text-right font-mono tabular-nums">≤ {clock(t.two)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-neutral-500">
                  Finish under a target time for its stars. Deaths past the allowance (none on Recruit, one on Regular, two on Veteran; a checkpoint restart counts as two) cost a star. Recruit tops out at two.
                </p>

                <h2 className="mt-4 font-mono text-[11px] tracking-[0.25em] text-neutral-400 uppercase">Solo squad bots</h2>
                <div className="mt-2 flex gap-1.5">
                  {[0, 1, 2].map((n) => (
                    <button key={n} type="button" onClick={() => set({ squad: n })} className={cn("rounded-md border px-3 py-1.5 text-sm", c.squad === n ? "border-white/80 bg-white/15" : "border-white/10 bg-white/[0.03] hover:border-white/30")}>
                      {n === 0 ? "None" : `+${n}`}
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-xs text-neutral-400">
                  Loadout: <span className="text-neutral-200">{op.name}</span> (change it in the lobby).
                </p>

                <div className="mt-5 flex flex-wrap gap-2">
                  <button type="button" data-nav-default onClick={deploy} className={cn(buttonVariants({ size: "lg" }), "h-11 px-8 font-bold tracking-wider uppercase")}>
                    Deploy solo
                  </button>
                  <button
                    type="button"
                    disabled={!!partyUnavailable}
                    title={partyUnavailable ?? "Create a party; friends join with the room code and you launch the mission together."}
                    onClick={() => onHostCoop({ ...c, mission: def.id })}
                    className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-11 px-6 font-bold tracking-wider uppercase")}
                  >
                    Host co-op
                  </button>
                </div>
                {partyUnavailable && <p className="mt-2 text-xs text-neutral-500">{partyUnavailable}</p>}
              </section>

              {/* Fastest times */}
              <section className="rounded-xl border border-white/10 bg-black/40 p-5 backdrop-blur-sm">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-mono text-[11px] tracking-[0.25em] text-neutral-400 uppercase">Fastest clears</h2>
                  <div className="flex gap-1">
                    {(["solo", "coop"] as const).map((m) => (
                      <button key={m} type="button" onClick={() => setBoardMode(m)} className={cn("rounded border px-2.5 py-1 text-xs", boardMode === m ? "border-white/60 bg-white/10" : "border-white/10 text-neutral-400")}>
                        {m === "solo" ? "Solo" : "Co-op"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mt-3">
                  {!board ? (
                    <p className="text-sm text-neutral-500">Loading…</p>
                  ) : board.offline ? (
                    <p className="text-sm text-neutral-400">Offline mode: mission times aren&apos;t recorded.</p>
                  ) : (
                    <MissionBoardTable rows={rows} me={callsign} compact empty={`No ${boardMode === "solo" ? "solo" : "co-op"} clears yet. Set the first time.`} />
                  )}
                </div>
                {mine !== null && <p className="mt-2 text-xs text-neutral-400">Your best: <span className="font-mono text-neutral-200">{clock(mine)}</span></p>}
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
