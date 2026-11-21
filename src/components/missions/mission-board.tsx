import { cn } from "@/lib/utils";
import type { MissionBoardRow } from "@/app/play/[gameId]/mission-actions";
import { clock } from "@/game/missions/rating";

const DIFF: Record<string, string> = { recruit: "Recruit", regular: "Regular", veteran: "Veteran" };

/** "★★☆" for a 0–3 star count. */
export function Stars({ n, className }: { n: number; className?: string }) {
  return (
    <span className={cn("tracking-[0.12em] whitespace-nowrap", className)} aria-label={`${n} of 3 stars`}>
      <span className="text-amber-300">{"★".repeat(Math.max(0, Math.min(3, n)))}</span>
      <span className="text-white/20">{"★".repeat(3 - Math.max(0, Math.min(3, n)))}</span>
    </span>
  );
}

/** Fastest-clear table for one mission and mode (used by the mission screen, debrief and leaderboard page). */
export function MissionBoardTable({ rows, me, compact = false, empty }: { rows: MissionBoardRow[]; me?: string; compact?: boolean; empty: string }) {
  if (rows.length === 0) return <p className="rounded-md border border-white/10 bg-white/[0.03] px-4 py-5 text-center text-sm text-neutral-400">{empty}</p>;
  const cell = compact ? "px-2.5 py-1.5" : "px-4 py-2.5";
  return (
    <div className="overflow-x-auto rounded-lg border border-white/10">
      <table className={cn("w-full text-sm", !compact && "min-w-[560px]")}>
        <thead className="bg-white/[0.04] text-left font-mono text-[10px] tracking-[0.15em] text-neutral-400 uppercase">
          <tr>
            <th className={cell}>#</th>
            <th className={cell}>Player</th>
            <th className={cn(cell, "text-right")}>Time</th>
            <th className={cn(cell, "text-right")}>Rating</th>
            {!compact && <th className={cn(cell, "text-right")}>Difficulty</th>}
            {!compact && <th className={cn(cell, "text-right")}>Deaths</th>}
            {!compact && <th className={cn(cell, "text-right")}>Date</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.callsign}-${i}`} className={cn("border-t border-white/5", r.callsign === me ? "bg-white/10" : i % 2 ? "bg-white/[0.015]" : "")}>
              <td className={cn(cell, "font-mono text-neutral-400 tabular-nums")}>{i + 1}</td>
              <td className={cn(cell, "font-semibold")}>
                {r.callsign}
                {r.callsign === me && <span className="ml-1.5 text-xs font-normal text-neutral-400">(you)</span>}
                {compact && <span className="ml-1.5 text-[10px] font-normal text-neutral-500 uppercase">{DIFF[r.difficulty]?.[0] ?? ""}</span>}
              </td>
              <td className={cn(cell, "text-right font-mono font-bold tabular-nums")}>{clock(r.seconds)}</td>
              <td className={cn(cell, "text-right")}>
                <Stars n={r.stars} />
              </td>
              {!compact && <td className={cn(cell, "text-right text-neutral-300")}>{DIFF[r.difficulty] ?? r.difficulty}</td>}
              {!compact && <td className={cn(cell, "text-right tabular-nums")}>{r.deaths}</td>}
              {!compact && <td className={cn(cell, "text-right text-neutral-400")}>{new Date(r.played_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
