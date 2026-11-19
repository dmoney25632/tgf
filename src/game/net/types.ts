import type * as THREE from "three";
import type { EngineContext } from "../core/GameMode";
import type { HitPart } from "../core/types";
import type { KillInfo } from "../ai/AgentManager";
import type { EnemyType } from "../survival/config";
import type { SurvivalGameMode } from "../survival/SurvivalGameMode";
import type { SurvivalHUD, TeamRow } from "../ui/SurvivalHUD";

/** Bits of SurvivalGameMode's private state the co-op layer may touch. */
export type SurvivalBridge = {
  shud: SurvivalHUD;
  crateUsed: boolean[];
  /** Records a kill credited to the local player (summary counters). */
  countKill(type: EnemyType, part: HitPart, source: string): void;
};

/**
 * The only surface SurvivalGameMode sees of online co-op. Passed in as
 * `SurvivalConfig.net`; absent for solo play, which then runs exactly as
 * before. Implemented by CoopSurvivalNet.
 */
export interface SurvivalNet {
  readonly role: "host" | "client";
  /** Humans in the match (for wave sizing). */
  readonly playerCount: number;
  /** Reviving a teammate right now (weapons lowered). */
  readonly busy: boolean;
  /** Any teammate still on their feet. */
  readonly teammatesUp: boolean;
  attach(mode: SurvivalGameMode, ctx: EngineContext, bridge: SurvivalBridge): void;
  /** Every frame, after AI. */
  update(dt: number): void;
  /** Client: copy host vitals into the local PlayerState; returns transitions. */
  clientVitals(): "revived" | "downed" | null;
  /** A teammate is channelling a revive on the local player. */
  revivingMe(): boolean;
  /** Host: every player is down or dead with no self-revive left. */
  teamWiped(): boolean;
  /** Revive prompts for downed teammates; null when none is in reach. */
  interact(dt: number, holdingF: boolean): { prompt: string; progress: number } | null;
  /** Local player readied up (N / shop "ready"). */
  ready(): void;
  /** Host: an enemy died. True when the kill belongs to a remote player (already credited). */
  killCredit(k: KillInfo): boolean;
  /** True when the explosion was handed to the host (client) and the mode must skip it. */
  onExplosion(at: THREE.Vector3): boolean;
  onBuy(id: string, price: number): void;
  collectTargets(out: THREE.Object3D[]): void;
  teamRows(out: TeamRow[]): void;
  dispose(): void;
}
