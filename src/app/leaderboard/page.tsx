import Link from "next/link";
import { Suspense } from "react";
import { SiteHeader } from "@/components/site-header";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Leaderboard · TGF" };

type Row = {
  callsign: string;
  matches: number;
  wins: number;
  kills: number;
  deaths: number;
  accuracy: number;
  best_wave: number;
  waves_cleared: number;
  headshots: number;
  best_score: number;
  best_wave_at: string | null;
};

const TABS = {
  waves: { label: "Furthest wave", blurb: "Highest Survival wave each player has cleared (solo or party). Ties go to whoever got there first." },
  lifetime: { label: "Lifetime stats", blurb: "Career totals across every Iron Horizon match." },
} as const;
type Tab = keyof typeof TABS;

const SORTS = {
  kills: { label: "Kills", col: "kills" },
  waves: { label: "Waves cleared", col: "waves_cleared" },
  matches: { label: "Matches", col: "matches" },
  headshots: { label: "Headshots", col: "headshots" },
  score: { label: "Best score", col: "best_score" },
  accuracy: { label: "Accuracy", col: "accuracy" },
} as const;
type Sort = keyof typeof SORTS;

export default function LeaderboardPage({ searchParams }: PageProps<"/leaderboard">) {
  return (
    <Suspense fallback={<SiteHeader user={null} hideNav />}>
      <LeaderboardContent searchParams={searchParams} />
    </Suspense>
  );
}

const fmt = (n: number) => Number(n ?? 0).toLocaleString("en-US");

async function LeaderboardContent({ searchParams }: Pick<PageProps<"/leaderboard">, "searchParams">) {
  const user = await requireUser("/leaderboard");
  const q = await searchParams;
  const tab: Tab = q.tab === "lifetime" ? "lifetime" : "waves";
  const sort: Sort = typeof q.sort === "string" && q.sort in SORTS ? (q.sort as Sort) : "kills";

  let rows: Row[] = [];
  let failed = false;
  if (!user.offline) {
    const supabase = await createClient();
    let query = supabase
      .from("leaderboard")
      .select("callsign,matches,wins,kills,deaths,accuracy,best_wave,waves_cleared,headshots,best_score,best_wave_at")
      .eq("game_id", "iron-horizon");
    query =
      tab === "waves"
        ? query.gt("best_wave", 0).order("best_wave", { ascending: false }).order("best_wave_at", { ascending: true })
        : query.order(SORTS[sort].col, { ascending: false }).order("kills", { ascending: false });
    const { data, error } = await query.limit(100);
    if (error) failed = true;
    rows = (data as Row[] | null) ?? [];
  }
  const me = rows.findIndex((r) => r.callsign === user.callsign);

  return (
    <>
      <SiteHeader user={user} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] tracking-[0.3em] text-white/70 uppercase">Iron Horizon</p>
            <h1 className="mt-1 text-4xl font-black tracking-tight">Leaderboard</h1>
            <p className="mt-1 text-sm text-muted-foreground">{TABS[tab].blurb}</p>
          </div>
          <Link href="/play/iron-horizon" className={cn(buttonVariants({ size: "lg" }), "h-11 px-8 font-bold")}>
            Play
          </Link>
        </div>

        <nav className="mt-6 flex flex-wrap gap-1.5" aria-label="Leaderboard">
          {(Object.keys(TABS) as Tab[]).map((t) => (
            <Link
              key={t}
              href={t === "waves" ? "/leaderboard" : "/leaderboard?tab=lifetime"}
              className={cn(
                "rounded-md border px-4 py-2 text-sm transition-colors",
                tab === t ? "border-white/70 bg-white/15 text-white" : "border-white/10 bg-white/[0.03] text-neutral-300 hover:border-white/25",
              )}
            >
              {TABS[t].label}
            </Link>
          ))}
        </nav>

        {tab === "lifetime" && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="mr-1 text-muted-foreground">Sort by</span>
            {(Object.keys(SORTS) as Sort[]).map((s) => (
              <Link
                key={s}
                href={`/leaderboard?tab=lifetime&sort=${s}`}
                className={cn("rounded border px-2.5 py-1", sort === s ? "border-white/60 bg-white/10 text-white" : "border-white/10 text-neutral-400 hover:border-white/25")}
              >
                {SORTS[s].label}
              </Link>
            ))}
          </div>
        )}

        {user.offline ? (
          <p className="mt-8 rounded-md border border-white/20 bg-white/5 px-4 py-3 text-sm">Offline dev mode: the leaderboard needs Supabase.</p>
        ) : failed ? (
          <p className="mt-8 rounded-md border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">Couldn&apos;t load the leaderboard. Try again in a moment.</p>
        ) : rows.length === 0 ? (
          <p className="mt-8 rounded-md border border-white/10 bg-white/[0.03] px-4 py-6 text-center text-sm text-muted-foreground">
            No runs recorded yet. Finish a Survival match to claim the top spot.
          </p>
        ) : (
          <div className="mt-6 overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-white/[0.04] text-left font-mono text-[11px] tracking-[0.15em] text-neutral-400 uppercase">
                {tab === "waves" ? (
                  <tr>
                    <th className="px-4 py-3">#</th>
                    <th className="px-4 py-3">Player</th>
                    <th className="px-4 py-3 text-right">Best wave</th>
                    <th className="px-4 py-3 text-right">Best score</th>
                    <th className="px-4 py-3 text-right">Kills</th>
                    <th className="px-4 py-3 text-right">Matches</th>
                    <th className="px-4 py-3 text-right">Reached</th>
                  </tr>
                ) : (
                  <tr>
                    <th className="px-4 py-3">#</th>
                    <th className="px-4 py-3">Player</th>
                    <th className="px-4 py-3 text-right">Kills</th>
                    <th className="px-4 py-3 text-right">K/D</th>
                    <th className="px-4 py-3 text-right">Headshots</th>
                    <th className="px-4 py-3 text-right">Accuracy</th>
                    <th className="px-4 py-3 text-right">Waves</th>
                    <th className="px-4 py-3 text-right">Matches</th>
                    <th className="px-4 py-3 text-right">Wins</th>
                    <th className="px-4 py-3 text-right">Best wave</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.callsign} className={cn("border-t border-white/5", i === me ? "bg-white/10" : i % 2 ? "bg-white/[0.015]" : "")}>
                    <td className="px-4 py-2.5 font-mono text-neutral-400 tabular-nums">{i + 1}</td>
                    <td className="px-4 py-2.5 font-semibold">
                      {r.callsign}
                      {i === me && <span className="ml-2 text-xs font-normal text-neutral-400">(you)</span>}
                    </td>
                    {tab === "waves" ? (
                      <>
                        <td className="px-4 py-2.5 text-right text-lg font-black tabular-nums">{r.best_wave}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{fmt(r.best_score)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{fmt(r.kills)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{fmt(r.matches)}</td>
                        <td className="px-4 py-2.5 text-right text-neutral-400">{r.best_wave_at ? new Date(r.best_wave_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}</td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-2.5 text-right font-bold tabular-nums">{fmt(r.kills)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{(r.kills / Math.max(1, r.deaths)).toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{fmt(r.headshots)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{Number(r.accuracy).toFixed(1)}%</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{fmt(r.waves_cleared)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{fmt(r.matches)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{fmt(r.wins)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{r.best_wave}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!user.offline && rows.length > 0 && me < 0 && (
          <p className="mt-3 text-xs text-muted-foreground">You&apos;re not in the top 100 here yet. Your own totals are on your account page.</p>
        )}
      </main>
    </>
  );
}
