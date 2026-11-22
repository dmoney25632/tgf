import type * as THREE from "three";
import type { EngineContext } from "../core/GameMode";
import type { HitPart } from "../core/types";
import type { KillInfo } from "../ai/AgentManager";
import type { Combatant } from "../ai/types";
import type { EnemyType } from "../survival/config";
import type { SurvivalHUD, TeamRow } from "../ui/SurvivalHUD";
import type { NavGrid } from "../ai/NavGrid";
import type { AgentManager } from "../ai/AgentManager";
import type { PlayerState } from "../survival/PlayerState";
import type { Wallet } from "../survival/ShopSystem";
import type { WaveManager } from "../survival/WaveManager";
import type { DifficultyId } from "../survival/config";
import type { HelicopterManager } from "../vehicles/HelicopterManager";
import type { MissionEvent, MissionState } from "../missions/types";
import type { MapBlip } from "../ui/Minimap";

/**
 * What the co-op layer needs from a game mode. SurvivalGameMode and
 * MissionGameMode both satisfy it; missions add `mission` (shared objectives,
 * checkpoints and gunships). A mission's `waves` is a fixed "combat" phase so
 * the survival wave flow (banners, shop, ready-up) never triggers.
 */
export interface CoopMode {
  readonly nav: NavGrid;
  readonly agents: AgentManager;
  readonly state: PlayerState;
  readonly loadout: { readonly maxHealth: number };
  readonly ended: boolean;
  end(victory: boolean): void;
  readonly config: { readonly difficulty: DifficultyId };
  readonly wallet: Wallet;
  readonly waves: WaveManager;
  readonly canShop: boolean;
  readonly mission?: CoopMissionHooks;
}

export interface CoopMissionHooks {
  /** Host: the mission ended in a win. */
  readonly victory: boolean;
  /** Client: holding interact at the current objective (plant / rescue). */
  readonly holdingInteract: boolean;
  readonly helis: HelicopterManager;
  snapshot(): MissionState;
  /** Client: adopt the host's mission state. */
  applySnapshot(s: MissionState): void;
  /** Client: a discrete host event (radio, objective banner, detonation…). */
  remoteEvent(e: MissionEvent): void;
  /** Client: the host respawned us (checkpoint / redeploy). */
  onRespawn(): void;
}

/** Bits of SurvivalGameMode's private state the co-op layer may touch. */
export type SurvivalBridge = {
  shud: SurvivalHUD;
  crateUsed: boolean[];
  /** Records a kill credited to the local player (summary counters). */
  countKill(type: EnemyType, part: HitPart, source: string): void;
  /** Client: the host announced a squad arriving at (x, z) in `eta` s (minimap + alert). */
  incoming?(x: number, z: number, label: string, heavy: boolean, eta: number): void;
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
  attach(mode: CoopMode, ctx: EngineContext, bridge: SurvivalBridge): void;
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
  /** Minimap: teammates (and, on clients with radar, replicated hostiles). */
  mapBlips?(out: MapBlip[], radar: boolean): void;
  /** Host: tell clients a squad is incoming (radar marker + alert). */
  squadIncoming?(x: number, z: number, label: string, heavy: boolean, eta: number): void;
  /** Host: show this wave banner on clients too (wave intro, holdout complete). */
  waveBanner?(title: string, sub: string, color: string): void;
  dispose(): void;
}

/** Co-op layer as a mission sees it (CoopSurvivalNet implements both). */
export interface MissionNet extends SurvivalNet {
  missionState(s: MissionState): void;
  missionEvent(e: MissionEvent): void;
  respawnTeam(x: number, z: number, onlyDead: boolean): void;
  teammates(out: TeammateView[]): TeammateView[];
  readonly spawnOffset: [number, number];
  /** Host: slot credited for the damage being applied right now (-1 = local player). */
  readonly creditSlot: number;
  creditName(slot: number): string;
  /** Client: replicated hostiles still alive. */
  readonly enemiesAlive: number;
  /** Client: where a replicated enemy (host agent id) is drawn right now; false if unknown. */
  enemyPosition(id: number, out: THREE.Vector3): boolean;
}

/**
 * A remote player as the host sees them. `shots` is a running total of shots
 * fired (stealth missions turn the deltas into gunfire noise) with `weapon`
 * the id they were holding; `sprint` from their last state message.
 */
export type TeammateView = {
  x: number; z: number; up: boolean; interact: boolean; combatant: Combatant | null;
  slot?: number; shots?: number; weapon?: string; sprint?: boolean;
};
