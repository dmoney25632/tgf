"use server";

import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export type BoardRow = {
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
};

export type LobbyData = {
  /** Top 10 by furthest wave. */
  waves: BoardRow[];
  /** Top 10 by lifetime kills. */
  kills: BoardRow[];
  /** The signed-in player's own totals (null before their first match). */
  me: BoardRow | null;
  /** 1-based world rank by best wave / kills (null without a record). */
  waveRank: number | null;
  killRank: number | null;
  /** Players on the board. */
  players: number;
  /** The player directly above you on the wave board (your next target). */
  nextUp: BoardRow | null;
};

const COLS = "callsign,matches,wins,kills,deaths,accuracy,best_wave,waves_cleared,headshots,best_score";
const EMPTY: LobbyData = { waves: [], kills: [], me: null, waveRank: null, killRank: null, players: 0, nextUp: null };

/**
 * Everything the lobby's world-leaderboard and service-record panels show.
 * Reads the public leaderboard view (callsigns + aggregates only) plus the
 * caller's own row; never exposes ids or emails.
 */
export async function getLobbyData(): Promise<LobbyData> {
  if (!isSupabaseConfigured) return EMPTY;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const uid = claims?.claims?.sub;
  if (!uid) return EMPTY;

  const board = () => supabase.from("leaderboard").select(COLS).eq("game_id", "iron-horizon");
  const [waves, kills, profile, count] = await Promise.all([
    board().gt("best_wave", 0).order("best_wave", { ascending: false }).order("best_wave_at", { ascending: true }).limit(10),
    board().order("kills", { ascending: false }).limit(10),
    supabase.from("profiles").select("callsign").eq("id", uid).maybeSingle(),
    supabase.from("leaderboard").select("callsign", { count: "exact", head: true }).eq("game_id", "iron-horizon"),
  ]);
  const callsign = profile.data?.callsign as string | undefined;
  const me = callsign ? (((await board().eq("callsign", callsign).maybeSingle()).data as BoardRow | null) ?? null) : null;

  let waveRank: number | null = null;
  let killRank: number | null = null;
  let nextUp: BoardRow | null = null;
  if (me) {
    const [aboveWave, aboveKills, next] = await Promise.all([
      me.best_wave > 0
        ? supabase.from("leaderboard").select("callsign", { count: "exact", head: true }).eq("game_id", "iron-horizon").gt("best_wave", me.best_wave)
        : Promise.resolve({ count: null }),
      supabase.from("leaderboard").select("callsign", { count: "exact", head: true }).eq("game_id", "iron-horizon").gt("kills", me.kills),
      board().gt("best_wave", me.best_wave).order("best_wave", { ascending: true }).limit(1).maybeSingle(),
    ]);
    waveRank = me.best_wave > 0 && aboveWave.count !== null ? aboveWave.count + 1 : null;
    killRank = aboveKills.count !== null ? aboveKills.count + 1 : null;
    nextUp = (next.data as BoardRow | null) ?? null;
  }

  return {
    waves: (waves.data as BoardRow[] | null) ?? [],
    kills: (kills.data as BoardRow[] | null) ?? [],
    me,
    waveRank,
    killRank,
    players: count.count ?? 0,
    nextUp,
  };
}
