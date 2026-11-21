"use client";

import { useEffect, useState } from "react";
import { WEAPONS, type WeaponId } from "@/game/weapons/weapons";
import { OPERATORS, type DifficultyId, type OperatorId, type WaveTarget } from "@/game/survival/config";
import type { Character, CharacterLook } from "@/game/character";
import { SURVIVAL_MAPS } from "@/game/world/maps/registry";
import { getMission } from "@/game/missions/campaign";
import { coopMission } from "@/game/net/ids";
import { prefetchGameEngine } from "./prefetch-engine";
import { LobbyView } from "./lobby-view";
import type { PlayMode } from "./mode-picker";

export type LobbyChoice = {
  mode: "survival" | "range";
  operator: OperatorId;
  primary: WeaponId;
  secondary: WeaponId;
  difficulty: DifficultyId;
  waveTarget: WaveTarget;
  squad: number;
  startWave: number;
  /** Survival map id (world/maps/registry). */
  map?: string;
  /** Story mission id (game/missions/campaign); set by the missions screen. */
  mission?: string;
  /** Saved character appearance (character page). */
  look?: CharacterLook;
  /** The mode the lobby's Play button starts (remembered between visits). */
  pick?: PlayMode["kind"];
  /** Mission selected in the mode picker (kept apart from `mission`, which means "launching one"). */
  pickMission?: string;
};

export const DEFAULT_CHOICE: LobbyChoice = {
  mode: "survival",
  operator: "ridge",
  primary: "m4a1",
  secondary: "m9",
  difficulty: "regular",
  waveTarget: 10,
  squad: 2,
  startWave: 1,
};

export function weaponBars(id: WeaponId) {
  const d = WEAPONS[id];
  return [
    ["Damage", Math.min(1, (d.damage * d.pellets) / 160)],
    ["Fire rate", d.rpm / 950],
    ["Range", d.falloffEnd / 150],
    ["Control", 1 - (d.recoil.pattern[0][0] * d.recoil.kickScale) / 4.5],
    ["Mobility", (d.mobility - 0.8) / 0.3],
  ] as const;
}

/** Online hooks: Main World matchmaking and private lobbies (create / join by code). */
export type PartyActions = {
  /** null = available; otherwise why online play is unavailable. */
  unavailable: string | null;
  onWorld: (c: LobbyChoice) => void;
  onCreate: (c: LobbyChoice) => void;
  onJoin: (code: string, c: LobbyChoice) => void;
};


/** The lobby's selected mode, from the saved picks. */
export function modeFromChoice(c: LobbyChoice, online: boolean): PlayMode {
  const mission = getMission(c.pickMission ?? "")?.id;
  if (c.pick === "mission" && mission) return { kind: "mission", missionId: mission, difficulty: c.difficulty, squad: c.squad };
  if (c.pick === "world" && online) return { kind: "world" };
  if (c.pick === "range") return { kind: "range" };
  const map = SURVIVAL_MAPS.find((m) => m.id === c.map)?.id ?? SURVIVAL_MAPS[0].id;
  return { kind: "survival", map, difficulty: c.difficulty, waveTarget: c.waveTarget, squad: c.squad };
}

/** Fold a mode-picker result back into the saved picks. */
export function choiceWithMode(c: LobbyChoice, m: PlayMode): LobbyChoice {
  switch (m.kind) {
    case "survival":
      return { ...c, pick: "survival", map: m.map, difficulty: m.difficulty, waveTarget: m.waveTarget, squad: m.squad };
    case "mission":
      return { ...c, pick: "mission", pickMission: m.missionId, difficulty: m.difficulty, squad: m.squad };
    default:
      return { ...c, pick: m.kind };
  }
}

/**
 * Home screen: you (and an empty squad to invite into), a mode card and one
 * big Play button. Pick a mode, hit Play. Party up to play with friends.
 */
export function Lobby({
  callsign,
  character,
  initial,
  onDeploy,
  party,
  notice,
  onBriefing,
  onChange,
}: {
  callsign: string;
  character: Character;
  initial: LobbyChoice;
  /** Start a solo run (survival, range, or a mission when `mission` is set). */
  onDeploy: (c: LobbyChoice) => void;
  party: PartyActions;
  notice?: string | null;
  /** Opens a mission's full briefing screen. */
  onBriefing?: (c: LobbyChoice, missionId: string) => void;
  /** Picks changed (saved by the host page). */
  onChange?: (c: LobbyChoice) => void;
}) {
  const [c, setC] = useState<LobbyChoice>(initial);
  const online = !party.unavailable;
  const mode = modeFromChoice(c, online);
  const op = OPERATORS[character.operator];
  useEffect(() => prefetchGameEngine(), []);

  const update = (next: LobbyChoice) => {
    setC(next);
    onChange?.(next);
  };

  /** Seed a new party with the selected mode when the squad can play it together. */
  const forParty = (): LobbyChoice => {
    const coop = mode.kind === "mission" ? coopMission(mode.missionId)?.id : undefined;
    return { ...c, mode: "survival", mission: coop };
  };

  const play = () => {
    switch (mode.kind) {
      case "world":
        return party.onWorld({ ...c, mode: "survival", mission: undefined });
      case "mission":
        return onDeploy({ ...c, mode: "survival", mission: mode.missionId });
      case "range":
        return onDeploy({ ...c, mode: "range", mission: undefined });
      default:
        return onDeploy({ ...c, mode: "survival", mission: undefined });
    }
  };

  return (
    <LobbyView
      callsign={callsign}
      look={character.look}
      roleLine={`${op.role} · ${op.traits[0]}`}
      members={[]}
      maxPlayers={4}
      invite={{ unavailable: party.unavailable, onCreate: () => party.onCreate(forParty()), onJoin: (code) => party.onJoin(code, forParty()) }}
      mode={mode}
      modeContext="solo"
      onModeChange={(m) => update(choiceWithMode(c, m))}
      onBriefing={onBriefing ? (id) => onBriefing(c, id) : undefined}
      worldUnavailable={party.unavailable}
      primary={{ label: "Play", onClick: play }}
      notice={notice}
      loadout={{ primary: c.primary, secondary: c.secondary }}
      onLoadout={(p) => update({ ...c, ...p })}
    />
  );
}
