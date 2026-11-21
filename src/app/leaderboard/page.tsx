import Link from "next/link";
import { Suspense } from "react";
import { SiteHeader } from "@/components/site-header";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ALL_MISSIONS, getMission } from "@/game/missions/campaign";
import { OPERATIONS } from "@/game/missions/operations";
import { MissionBoardTable } from "@/components/missions/mission-board";
import type { MissionBoardRow } from "@/app/play/[gameId]/mission-actions";

export const metadata = { title: "Leaderboard · TGF" };

const GAME = "iron-horizon";

/** One row of the public career view (callsign + aggregates only). */
type CareerRow = {
  callsign: string;
  matches: number;
  wins: number;
  kills: number;
  deaths: number;
  kd: number;
  accuracy: number;
  best_wave: number;
  waves_cleared: number;
  headshots: number;
  best_score: number;
  best_wave_at: string | null;
  melee_kills: number;
  grenade_kills: number;
  damage_dealt: number;
  playtime_seconds: number;
  best_kills: number;
  missions_cleared: number;
};
const CAREER_COLS =
  "callsign,matches,wins,kills,deaths,kd,accuracy,best_wave,waves_cleared,headshots,best_score,best_wave_at,melee_kills,grenade_kills,damage_dealt,playtime_seconds,best_kills,missions_cleared";

/** survival_board() row: one player's furthest run at one difficulty. */
type WaveRow = { callsign: string; best_wave: number; best_score: number; best_kills: number; runs: number; best_wave_at: string | null };

const TABS = {
  survival: { label: "Survival", blurb: "Furthest Survival wave each player has reached, solo or with a party. Ties go to whoever got there first." },
  career: { label: "Career", blurb: "Lifetime totals across every Iron Horizon match: Survival, missions and the range." },
  missions: { label: "Missions", blurb: "Fastest clear of each mission per player. Solo and co-op runs are ranked separately." },
} as const;
type Tab = keyof typeof TABS;

const DIFFS = {
  all: { label: "All difficulties", short: "All" },
  veteran: { label: "Veteran", short: "Veteran" },
  regular: { label: "Regular", short: "Regular" },
  recruit: { label: "Recruit", short: "Recruit" },
} as const;
type Diff = keyof typeof DIFFS;

/** Career sorts. Ratio stats only rank players with enough matches to mean something. */
const SORTS = {
  kills: { label: "Kills", col: "kills", min: 0 },
  kd: { label: "K/D", col: "kd", min: 5 },
  headshots: { label: "Headshots", col: "headshots", min: 0 },
  accuracy: { label: "Accuracy", col: "accuracy", min: 5 },
  waves: { label: "Waves cleared", col: "waves_cleared", min: 0 },
  melee: { label: "Melee kills", col: "melee_kills", min: 0 },
  grenades: { label: "Grenade kills", col: "grenade_kills", min: 0 },
  best: { label: "Best match", col: "best_kills", min: 0 },
  missions: { label: "Mission clears", col: "missions_cleared", min: 0 },
  matches: { label: "Matches", col: "matches", min: 0 },
  time: { label: "Time played", col: "playtime_seconds", min: 0 },
} as const;
type Sort = keyof typeof SORTS;

/** Missions on the times board: standalone operations first. */
const BOARD_MISSIONS = [...OPERATIONS, ...ALL_MISSIONS.filter((m) => !OPERATIONS.includes(m))];

const fmt = (n: number) => Number(n ?? 0).toLocaleString("en-US");
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
function hours(sec: number) {
  const s = Number(sec ?? 0);
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}
const pick = <T extends string>(v: unknown, keys: readonly T[], dflt: T): T => (typeof v === "string" && (keys as readonly string[]).includes(v) ? (v as T) : dflt);

export default function LeaderboardPage({ searchParams }: PageProps<"/leaderboard">) {
  return (
    <Suspense fallback={<SiteHeader user={null} hideNav />}>
      <LeaderboardContent searchParams={searchParams} />
    </Suspense>
  );
}

async function LeaderboardContent({ searchParams }: Pick<PageProps<"/leaderboard">, "searchParams">) {
  const user = await requireUser("/leaderboard");
  const q = await searchParams;
  // Old links (?tab=waves / ?tab=lifetime) map onto the new tabs.
  const rawTab = q.tab === "waves" ? "survival" : q.tab === "lifetime" ? "career" : q.tab;
  const tab = pick(rawTab, Object.keys(TABS) as Tab[], "survival");
  const diff = pick(q.diff, Object.keys(DIFFS) as Diff[], "all");
  const sort = pick(q.sort, Object.keys(SORTS) as Sort[], "kills");
  const mission = getMission(typeof q.mission === "string" ? q.mission : "") ?? BOARD_MISSIONS[0];
  const mmode: "solo" | "coop" = q.mode === "coop" ? "coop" : "solo";

  type Mine = { career: CareerRow | null; bests: Partial<Record<Exclude<Diff, "all">, number>>; clears: number };
  type Board = { failed: boolean; career: CareerRow[]; waves: WaveRow[]; missionRows: MissionBoardRow[] };
  const blank: Board = { failed: false, career: [], waves: [], missionRows: [] };
  const loaded = user.offline ? null : await loadBoards();
  const { failed, career, waves, missionRows } = loaded?.board ?? blank;
  const myRecord: Mine | null = loaded?.mine ?? null;

  async function loadBoards(): Promise<{ board: Board; mine: Mine }> {
    const supabase = await createClient();
    // The board for this tab, plus the signed-in player's own record (RLS: own rows only).
    const board = async (): Promise<Board> => {
      if (tab === "missions") {
        const { data, error } = await supabase.rpc("mission_board", { p_mission_id: mission.id, p_mode: mmode, p_limit: 50 });
        return { ...blank, failed: !!error, missionRows: (data as MissionBoardRow[] | null) ?? [] };
      }
      if (tab === "survival" && diff !== "all") {
        const { data, error } = await supabase.rpc("survival_board", { p_game_id: GAME, p_difficulty: diff, p_limit: 100 });
        return { ...blank, failed: !!error, waves: (data as WaveRow[] | null) ?? [] };
      }
      let query = supabase.from("leaderboard").select(CAREER_COLS).eq("game_id", GAME);
      if (tab === "survival") {
        query = query.gt("best_wave", 0).order("best_wave", { ascending: false }).order("best_wave_at", { ascending: true });
      } else {
        const s = SORTS[sort];
        if (s.min) query = query.gte("matches", s.min);
        query = query.order(s.col, { ascending: false }).order("kills", { ascending: false });
      }
      const { data, error } = await query.limit(100);
      const rows = (data as CareerRow[] | null) ?? [];
      if (tab === "career") return { ...blank, failed: !!error, career: rows };
      const w = rows.map((r) => ({ callsign: r.callsign, best_wave: r.best_wave, best_score: r.best_score, best_kills: r.best_kills, runs: r.matches, best_wave_at: r.best_wave_at }));
      return { ...blank, failed: !!error, waves: w };
    };
    const own = async (): Promise<Mine> => {
      const [c, b, m] = await Promise.all([
        supabase.from("leaderboard").select(CAREER_COLS).eq("game_id", GAME).eq("callsign", user.callsign).maybeSingle(),
        supabase.from("survival_bests").select("difficulty,best_wave").eq("user_id", user.id).eq("game_id", GAME),
        supabase.from("mission_runs").select("mission_id", { count: "exact", head: true }).eq("user_id", user.id),
      ]);
      const bests: Mine["bests"] = {};
      for (const r of (b.data as { difficulty: Exclude<Diff, "all">; best_wave: number }[] | null) ?? []) bests[r.difficulty] = r.best_wave;
      return { career: (c.data as CareerRow | null) ?? null, bests, clears: m.count ?? 0 };
    };
    const [bd, mine] = await Promise.all([board(), own()]);
    return { board: bd, mine };
  }

  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams({ tab, ...(tab === "survival" && diff !== "all" ? { diff } : {}), ...(tab === "career" && sort !== "kills" ? { sort } : {}), ...over });
    if (p.get("tab") === "survival") p.delete("tab");
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    const s = p.toString();
    return s ? `/leaderboard?${s}` : "/leaderboard";
  };
  const pill = (active: boolean) =>
    cn("rounded border px-2.5 py-1 transition-colors", active ? "border-white/60 bg-white/10 text-white" : "border-white/10 text-neutral-400 hover:border-white/25");

  const meWave = waves.findIndex((r) => r.callsign === user.callsign);
  const meCareer = career.findIndex((r) => r.callsign === user.callsign);

  return (
    <>
      <SiteHeader user={user} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] tracking-[0.3em] text-white/70 uppercase">Iron Horizon</p>
            <h1 className="mt-1 text-4xl font-black tracking-tight">Leaderboard</h1>
          </div>
          <Link href="/play/iron-horizon" className={cn(buttonVariants({ size: "lg" }), "h-11 px-8 font-bold")}>
            Play
          </Link>
        </div>

        {/* Your record */}
        {myRecord && (
          <section className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10 sm:grid-cols-4 lg:grid-cols-8" aria-label="Your record">
            {[
              ["Veteran", myRecord.bests.veteran ? `W${myRecord.bests.veteran}` : "—"],
              ["Regular", myRecord.bests.regular ? `W${myRecord.bests.regular}` : "—"],
              ["Recruit", myRecord.bests.recruit ? `W${myRecord.bests.recruit}` : "—"],
              ["Kills", fmt(myRecord.career?.kills ?? 0)],
              ["K/D", Number(myRecord.career?.kd ?? 0).toFixed(2)],
              ["Accuracy", `${Number(myRecord.career?.accuracy ?? 0).toFixed(1)}%`],
              ["Mission clears", fmt(myRecord.clears)],
              ["Time played", hours(myRecord.career?.playtime_seconds ?? 0)],
            ].map(([k, v]) => (
              <div key={k} className="bg-black px-4 py-3">
                <p className="font-mono text-[10px] tracking-[0.2em] text-neutral-500 uppercase">{k}</p>
                <p className="mt-0.5 text-xl font-black tabular-nums">{v}</p>
              </div>
            ))}
          </section>
        )}

        <nav className="mt-6 flex flex-wrap gap-1.5" aria-label="Leaderboard">
          {(Object.keys(TABS) as Tab[]).map((t) => (
            <Link
              key={t}
              href={t === "survival" ? "/leaderboard" : `/leaderboard?tab=${t}`}
              className={cn(
                "rounded-md border px-4 py-2 text-sm transition-colors",
                tab === t ? "border-white/70 bg-white/15 text-white" : "border-white/10 bg-white/[0.03] text-neutral-300 hover:border-white/25",
              )}
            >
              {TABS[t].label}
            </Link>
          ))}
        </nav>
        <p className="mt-3 text-sm text-muted-foreground">{TABS[tab].blurb}</p>

        {tab === "survival" && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
            {(Object.keys(DIFFS) as Diff[]).map((d) => (
              <Link key={d} href={qs({ diff: d === "all" ? "" : d })} className={pill(diff === d)}>
                {DIFFS[d].label}
              </Link>
            ))}
          </div>
        )}

        {tab === "career" && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="mr-1 text-muted-foreground">Rank by</span>
            {(Object.keys(SORTS) as Sort[]).map((s) => (
              <Link key={s} href={qs({ sort: s === "kills" ? "" : s })} className={pill(sort === s)}>
                {SORTS[s].label}
              </Link>
            ))}
            {SORTS[sort].min > 0 && <span className="ml-1 text-neutral-500">· min {SORTS[sort].min} matches</span>}
          </div>
        )}

        {tab === "missions" && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
            {BOARD_MISSIONS.map((m) => (
              <Link key={m.id} href={`/leaderboard?tab=missions&mission=${m.id}&mode=${mmode}`} className={pill(mission.id === m.id)}>
                {m.title}
              </Link>
            ))}
            <span className="mx-2 h-4 w-px bg-white/15" />
            {(["solo", "coop"] as const).map((m) => (
              <Link key={m} href={`/leaderboard?tab=missions&mission=${mission.id}&mode=${m}`} className={pill(mmode === m)}>
                {m === "solo" ? "Solo" : "Co-op"}
              </Link>
            ))}
            <Link href={`/play/iron-horizon?mission=${mission.id}`} className="ml-auto rounded border border-white/20 px-2.5 py-1 text-neutral-200 hover:border-white/40">
              Play {mission.title} →
            </Link>
          </div>
        )}

        {user.offline ? (
          <p className="mt-8 rounded-md border border-white/20 bg-white/5 px-4 py-3 text-sm">Offline dev mode: the leaderboard needs Supabase.</p>
        ) : failed ? (
          <p className="mt-8 rounded-md border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">Couldn&apos;t load the leaderboard. Try again in a moment.</p>
        ) : tab === "missions" ? (
          <div className="mt-6">
            <MissionBoardTable rows={missionRows} me={user.callsign} empty={`No ${mmode === "solo" ? "solo" : "co-op"} clears of ${mission.title} yet. Finish it to set the first time.`} />
          </div>
        ) : tab === "survival" ? (
          waves.length === 0 ? (
            <Empty>{diff === "all" ? "No Survival runs recorded yet." : `No ${DIFFS[diff].label} runs recorded yet.`} Finish a Survival match to claim the top spot.</Empty>
          ) : (
            <Table
              head={["#", "Player", "Furthest wave", "Best score", "Best kills", diff === "all" ? "Matches" : "Runs", "Reached"]}
              rows={waves.map((r, i) => ({
                key: r.callsign,
                me: i === meWave,
                cells: [
                  r.callsign,
                  <span key="w" className="text-lg font-black">{r.best_wave}</span>,
                  fmt(r.best_score),
                  fmt(r.best_kills),
                  fmt(r.runs),
                  <span key="d" className="text-neutral-400">{day(r.best_wave_at)}</span>,
                ],
              }))}
            />
          )
        ) : career.length === 0 ? (
          <Empty>{SORTS[sort].min ? `Nobody has ${SORTS[sort].min}+ matches yet.` : "No matches recorded yet."} Play a match to get on the board.</Empty>
        ) : (
          <Table
            head={["#", "Player", "Kills", "K/D", "Headshots", "Accuracy", "Melee", "Grenade", "Best match", "Waves", "Missions", "Matches", "Played"]}
            highlight={["kills", "kd", "headshots", "accuracy", "melee", "grenades", "best", "waves", "missions", "matches", "time"].indexOf(sort) + 2}
            rows={career.map((r, i) => ({
              key: r.callsign,
              me: i === meCareer,
              cells: [
                r.callsign,
                fmt(r.kills),
                Number(r.kd).toFixed(2),
                fmt(r.headshots),
                `${Number(r.accuracy).toFixed(1)}%`,
                fmt(r.melee_kills),
                fmt(r.grenade_kills),
                fmt(r.best_kills),
                fmt(r.waves_cleared),
                fmt(r.missions_cleared),
                fmt(r.matches),
                hours(r.playtime_seconds),
              ],
            }))}
          />
        )}

        {!user.offline && !failed && tab !== "missions" && (tab === "survival" ? waves.length > 0 && meWave < 0 : career.length > 0 && meCareer < 0) && (
          <p className="mt-3 text-xs text-muted-foreground">You&apos;re not in the top 100 here yet.</p>
        )}
      </main>
    </>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="mt-8 rounded-md border border-white/10 bg-white/[0.03] px-4 py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

/** Ranked table: first column is the rank, second the callsign, the rest right-aligned numbers. */
function Table({ head, rows, highlight }: { head: string[]; rows: { key: string; me: boolean; cells: React.ReactNode[] }[]; highlight?: number }) {
  return (
    <div className="mt-6 overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-white/[0.04] text-left font-mono text-[11px] tracking-[0.15em] text-neutral-400 uppercase">
          <tr>
            {head.map((h, i) => (
              <th key={h} className={cn("px-4 py-3 whitespace-nowrap", i > 1 && "text-right", i === highlight && "text-white")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key} className={cn("border-t border-white/5", r.me ? "bg-white/10" : i % 2 ? "bg-white/[0.015]" : "")}>
              <td className="px-4 py-2.5 font-mono text-neutral-400 tabular-nums">{i + 1}</td>
              {r.cells.map((c, j) => (
                <td key={j} className={cn("px-4 py-2.5 tabular-nums", j === 0 ? "font-semibold" : "text-right", j + 1 === highlight && "font-bold")}>
                  {c}
                  {j === 0 && r.me && <span className="ml-2 text-xs font-normal text-neutral-400">(you)</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
