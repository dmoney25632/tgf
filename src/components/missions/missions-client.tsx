"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GameView, type GameViewExtras } from "@/components/game/iron-horizon-client";
import { DEFAULT_CHOICE, type LobbyChoice } from "@/components/game/lobby";
import { CAMPAIGN } from "@/game/missions/campaign";
import type { MissionResult } from "@/game/missions/types";
import { MissionSelect, type MissionPick, type MissionRecords } from "./mission-select";
import { MissionSummaryView } from "./mission-summary";

const PICK_KEY = "tgf.iron-horizon.missions";
const RECORD_KEY = "tgf.iron-horizon.missions.best";
const GRADES = "DCBAS";

const DEFAULT_PICK: MissionPick = {
  mission: CAMPAIGN[0].id,
  operator: DEFAULT_CHOICE.operator,
  primary: DEFAULT_CHOICE.primary,
  secondary: DEFAULT_CHOICE.secondary,
  difficulty: DEFAULT_CHOICE.difficulty,
  squad: 2,
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<T>) } : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked: picks / records just won't persist.
  }
}

/** Campaign host: mission select → the shared Iron Horizon game view in mission mode. */
export function MissionsClient({ callsign }: { callsign: string }) {
  const [pick, setPick] = useState<MissionPick | null>(null);
  const [records, setRecords] = useState<MissionRecords>({});
  const [inGame, setInGame] = useState(false);
  const [run, setRun] = useState(0);

  useEffect(() => {
    const p = read(PICK_KEY, DEFAULT_PICK);
    const r = read<MissionRecords>(RECORD_KEY, {});
    queueMicrotask(() => {
      setPick(p);
      setRecords(r);
    });
  }, []);

  // Keep the best grade per mission (local only).
  const recordResult = useCallback((r: MissionResult) => {
    if (!r.victory) return;
    setRecords((prev) => {
      const old = prev[r.missionId];
      if (old && (GRADES.indexOf(old.grade) > GRADES.indexOf(r.grade) || (old.grade === r.grade && old.score >= r.score))) return prev;
      const next = { ...prev, [r.missionId]: { grade: r.grade, score: r.score } };
      write(RECORD_KEY, next);
      return next;
    });
  }, []);

  const choice: LobbyChoice | null = useMemo(
    () =>
      pick && {
        ...DEFAULT_CHOICE,
        mode: "survival",
        mission: pick.mission,
        operator: pick.operator,
        primary: pick.primary,
        secondary: pick.secondary,
        difficulty: pick.difficulty,
        squad: pick.squad,
      },
    [pick],
  );

  const extras: GameViewExtras | undefined = useMemo(() => {
    const m = CAMPAIGN.find((x) => x.id === pick?.mission);
    if (!m) return undefined;
    return {
      briefing: `${m.title} — ${m.briefing}`,
      renderSummary: (s, saved, onAgain, onLobby) => {
        const r = s.mission;
        if (!r) return null;
        return <MissionSummaryView s={s} r={r} saved={saved} onAgain={onAgain} onLobby={onLobby} onResult={recordResult} />;
      },
    };
  }, [pick?.mission, recordResult]);

  if (!pick || !choice) return <div className="fixed inset-0 bg-black" aria-busy="true" />;

  if (!inGame) {
    return (
      <MissionSelect
        callsign={callsign}
        initial={pick}
        records={records}
        onDeploy={(p) => {
          write(PICK_KEY, p);
          setPick(p);
          setRun((r) => r + 1);
          setInGame(true);
        }}
      />
    );
  }

  return <GameView key={run} callsign={callsign} choice={choice} extras={extras} onAgain={() => setRun((r) => r + 1)} onLobby={() => setInGame(false)} />;
}
