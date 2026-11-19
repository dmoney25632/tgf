"use server";

import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getGame } from "@/lib/games";

export type MatchReport = {
  gameId: string;
  mode: string;
  map: string;
  kills: number;
  deaths: number;
  shotsFired: number;
  shotsHit: number;
  won: boolean;
};

const clampInt = (n: unknown, max: number) => Math.max(0, Math.min(max, Math.floor(Number(n) || 0)));

/**
 * Records a finished match for the signed-in player via the record_match RPC.
 * Offline dev mode (no Supabase env) is a no-op.
 */
export async function saveMatch(report: MatchReport): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured) return { ok: false, error: "offline" };
  // Server actions are public endpoints: never trust the payload's shape.
  if (!report || typeof report !== "object" || typeof report.gameId !== "string") return { ok: false, error: "bad request" };
  if (!getGame(report.gameId)) return { ok: false, error: "unknown game" };

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return { ok: false, error: "not signed in" };

  const shotsFired = clampInt(report.shotsFired, 100000);
  const { error } = await supabase.rpc("record_match", {
    p_game_id: report.gameId,
    p_mode: String(report.mode).slice(0, 32),
    p_map: String(report.map).slice(0, 64),
    p_kills: clampInt(report.kills, 500),
    p_deaths: clampInt(report.deaths, 500),
    p_shots_fired: shotsFired,
    p_shots_hit: Math.min(shotsFired, clampInt(report.shotsHit, 100000)),
    p_won: Boolean(report.won),
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}
