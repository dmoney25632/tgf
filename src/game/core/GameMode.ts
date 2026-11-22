import type * as THREE from "three";
import type { HitPart } from "./types";
import type { Input } from "./Input";
import type { PlayerController } from "../player/PlayerController";
import type { WeaponSystem } from "../weapons/WeaponSystem";
import type { WeaponViewmodel } from "../weapons/WeaponViewmodel";
import type { GrenadeSystem } from "../weapons/GrenadeSystem";
import type { EffectsPool } from "../effects/EffectsPool";
import type { CameraShake } from "../effects/CameraShake";
import type { HUD } from "../ui/HUD";
import type { Sfx } from "../audio/Sfx";
import type { LoadedMap } from "../world/MapLoader";
import type { QualityName } from "../config";
import type { MissionResult } from "../missions/types";

/** Engine → React notifications. */
export type EngineEvent =
  | { type: "shop"; open: boolean }
  /** Full-screen map opened (pointer released) or closed (React re-locks). */
  | { type: "map"; open: boolean; via?: "pad" }
  | { type: "end"; summary: MatchSummary }
  | { type: "phase"; phase: string; wave: number };

export type MatchSummary = {
  mode: "survival" | "range" | "mission";
  victory: boolean;
  wavesSurvived: number;
  /** First wave of this run (>1 when the lobby skipped ahead). */
  startWave: number;
  waveTarget: number;
  kills: number;
  headshots: number;
  meleeKills: number;
  grenadeKills: number;
  shotsFired: number;
  shotsHit: number;
  damageDealt: number;
  damageTaken: number;
  timesDowned: number;
  moneyEarned: number;
  seconds: number;
  operator: string;
  difficulty: string;
  killsByType: Record<string, number>;
  map: string;
  /** Mission runs: score card. */
  mission?: MissionResult;
};

/** Everything a mode can use. Built by the engine. */
export type EngineContext = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  container: HTMLElement;
  input: Input;
  map: LoadedMap;
  player: PlayerController;
  weapons: WeaponSystem;
  grenades: GrenadeSystem;
  viewmodel: WeaponViewmodel;
  effects: EffectsPool;
  shake: CameraShake;
  hud: HUD;
  sfx: Sfx;
  callsign: string;
  quality: QualityName;
  /** Container size in CSS px, cached on resize (reading clientWidth per frame forces layout). */
  readonly view: { readonly w: number; readonly h: number };
  emit(e: EngineEvent): void;
  /** Release the mouse (menus). */
  unlock(): void;
  /** Respawn helper used by "reset position". */
  spawnPoint(out: THREE.Vector3): { yaw: number };
};

export type Vitals = { health: number; maxHealth: number; armor: number };

/**
 * A ruleset on top of the shared FPS core: firing range, survival, …
 * The engine owns the loop; modes add targets, rules, UI and AI.
 */
export interface GameMode {
  readonly label: string;
  /** Push raycast-able hitboxes for the player's weapon. */
  collectTargets(out: THREE.Object3D[]): void;
  /** Runs after weapons each frame. `playing` = pointer locked (unpaused). */
  update(dt: number, playing: boolean): void;
  /** Player's weapon hit something. Return a medal text, null for none, undefined for default. */
  onWeaponHit(part: HitPart, damage: number, killed: boolean, name: string, source: string, shotId: number, point: THREE.Vector3): string | null | undefined;
  onExplosion(at: THREE.Vector3): void;
  /** M84 stun went off (blind the AI it reaches). */
  onFlashbang?(at: THREE.Vector3): void;
  vitals(): Vitals;
  /** Called on manual respawn (range) / ignored in survival. */
  reset(): void;
  debug(out: Record<string, string | number>): void;
  dispose(): void;
}
