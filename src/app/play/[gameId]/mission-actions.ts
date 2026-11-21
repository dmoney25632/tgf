"use server";

import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getMission } from "@/game/missions/campaign";

export type MissionRunReport = {
  missionId: string;
  mode: "solo" | "coop";
  difficulty: string;
  seconds: number;
  stars: number;
  deaths: number;
  /** Players in the run (1 solo, 2–4 co-op). */
  squad: number;
};

export type MissionBoardRow = {
  callsign: string;
  seconds: number;
  stars: number;
  difficulty: string;
  deaths: number;
  squad_size: number;
  played_at: string;
};

export type MissionBoard = {
  solo: MissionBoardRow[];
  coop: MissionBoardRow[];
  /** The caller's own fastest clear per mode (null without one). */
  mine: { solo: number | null; coop: number | null };
  /** No Supabase configured (offline dev / guest): boards are empty and runs aren't saved. */
  offline: boolean;
};

const DIFFS = new Set(["recruit", "regular", "veteran"]);
const int = (n: unknown) => Math.floor(Number(n));

/**
 * Submits a completed mission run to the fastest-time board via the
 * record_mission_run RPC (security definer: the user id comes from the JWT
 * and the database re-validates every field). Offline mode is a no-op.
 */
export async function saveMissionRun(run: MissionRunReport): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured) return { ok: false, error: "offline" };
  // Server actions are public endpoints: check the payload's shape before touching the database.
  if (!run || typeof run !== "object" || typeof run.missionId !== "string" || !getMission(run.missionId)) return { ok: false, error: "unknown mission" };
  if (run.mode !== "solo" && run.mode !== "coop") return { ok: false, error: "bad request" };
  if (typeof run.difficulty !== "string" || !DIFFS.has(run.difficulty)) return { ok: false, error: "bad request" };
  const seconds = int(run.seconds), stars = int(run.stars), deaths = int(run.deaths), squad = int(run.squad);
  if (!(seconds > 0 && seconds <= 21600) || !(stars >= 1 && stars <= 3) || !(deaths >= 0 && deaths <= 1000) || !(squad >= 1 && squad <= 4)) {
    return { ok: false, error: "bad request" };
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return { ok: false, error: "not signed in" };

  const { error } = await supabase.rpc("record_mission_run", {
    p_mission_id: run.missionId,
    p_mode: run.mode,
    p_difficulty: run.difficulty,
    p_seconds: seconds,
    p_stars: stars,
    p_deaths: deaths,
    p_squad: run.mode === "solo" ? 1 : Math.max(2, squad),
  });
  if (!error) return { ok: true };
  if (error.code === "54000") return { ok: false, error: "rate limited" };
  if (error.code === "22023") return { ok: false, error: "run rejected" };
  console.error("record_mission_run failed", error.code);
  return { ok: false, error: "could not save run" };
}

const EMPTY: MissionBoard = { solo: [], coop: [], mine: { solo: null, coop: null }, offline: false };

/** Top fastest clears of a mission (solo and co-op) plus the caller's own bests. */
export async function getMissionBoard(missionId: string, limit = 10): Promise<MissionBoard> {
  if (!isSupabaseConfigured) return { ...EMPTY, offline: true };
  if (typeof missionId !== "string" || !getMission(missionId)) return EMPTY;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const uid = claims?.claims?.sub;
  if (!uid) return EMPTY;
  const n = Math.max(1, Math.min(50, int(limit) || 10));
  const best = (mode: "solo" | "coop") =>
    supabase.from("mission_runs").select("seconds").eq("user_id", uid).eq("mission_id", missionId).eq("mode", mode).order("seconds", { ascending: true }).limit(1).maybeSingle();
  const [solo, coop, mySolo, myCoop] = await Promise.all([
    supabase.rpc("mission_board", { p_mission_id: missionId, p_mode: "solo", p_limit: n }),
    supabase.rpc("mission_board", { p_mission_id: missionId, p_mode: "coop", p_limit: n }),
    best("solo"),
    best("coop"),
  ]);
  // Before the migration is applied the RPCs simply fail: show empty boards, don't break the screen.
  return {
    solo: (solo.data as MissionBoardRow[] | null) ?? [],
    coop: (coop.data as MissionBoardRow[] | null) ?? [],
    mine: { solo: (mySolo.data?.seconds as number | undefined) ?? null, coop: (myCoop.data?.seconds as number | undefined) ?? null },
    offline: false,
  };
}
