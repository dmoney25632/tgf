import type { EnemyType, DifficultyId, OperatorId } from "../survival/config";
import type { WeaponId } from "../weapons/weapons";
import type { MissionNet } from "../net/types";

/**
 * Mission data model. Everything here is plain, serializable data: mission
 * definitions are authored in campaign.ts and the live MissionState is a
 * POJO a network host can snapshot and send to clients.
 */

export type Point = { x: number; z: number };

/** One radio / subtitle line. `at` = seconds after the trigger. */
export type RadioLine = { speaker: string; text: string; at?: number };

/** A scripted group of attackers. */
export type WaveScript = {
  /** Seconds after the objective starts. */
  at: number;
  type: EnemyType;
  count: number;
  /** Entry points (one is picked per enemy, cycling). `y` places a perched sniper on a roof or tower. */
  from: (Point & { y?: number })[];
  /** Spawn as elites. */
  elite?: boolean;
  /** Re-send every N seconds while the objective is active (defend holds). */
  every?: number;
  /** Stop repeating after this many sends (including the first). */
  times?: number;
};

/** A hostile helicopter sortie during an objective. */
export type AirScript = {
  at: number;
  /** Fast-rope insert point and troop count (riflemen). */
  insert?: Point & { troops: number };
  orbit: Point & { radius: number; seconds: number };
  bearing?: number;
};

type ObjectiveBase = {
  /** Short HUD title, e.g. "REACH THE PUMPHOUSE". */
  title: string;
  /** Longer briefing text for the HUD panel. */
  detail?: string;
  waves?: WaveScript[];
  air?: AirScript[];
  /** Radio at objective start (timed by `at`). */
  radio?: RadioLine[];
  /** Radio when the objective completes. */
  done?: RadioLine[];
  /** Kill every scripted hostile before this objective can complete. */
  clearFirst?: boolean;
  /** Where the team respawns when the mission rolls back to this objective (default: the previous objective's point). */
  checkpoint?: Point & { yaw: number };
};

export type ObjectiveDef =
  | (ObjectiveBase & { kind: "reach"; at: Point; radius: number })
  | (ObjectiveBase & { kind: "defend"; at: Point; radius: number; seconds: number })
  | (ObjectiveBase & { kind: "destroy"; at: Point; label: string; plantTime: number; fuse: number; safeRadius: number })
  | (ObjectiveBase & { kind: "escort"; vip: Point & { name: string }; to: Point; radius: number })
  | (ObjectiveBase & { kind: "eliminate" })
  | (ObjectiveBase & { kind: "extract"; at: Point; radius: number; heliFrom: Point });

export type ObjectiveKind = ObjectiveDef["kind"];

export type MissionDef = {
  id: string;
  /** Campaign order (1-based). */
  index: number;
  title: string;
  /** Operation codename shown on the select screen. */
  codename: string;
  mapId: string;
  /** Location line, e.g. "Dustfall Outpost · Sarrow Basin". */
  location: string;
  time: string;
  briefing: string;
  /** Player insertion point. */
  start: Point & { yaw: number };
  objectives: ObjectiveDef[];
  /** Par time (s) for the time bonus. */
  par: number;
  /** Retries before the mission fails outright (default MISSION.maxRetries). */
  maxRetries?: number;
  /** Star-rating target times in seconds at Regular: [three stars, two stars]. See rating.ts. */
  stars?: [number, number];
  /** Shown on the mission screen while the team waits (loading-screen briefing bullets). */
  notes?: string[];
  /** Radio that plays at mission start. */
  intro?: RadioLine[];
  /** Radio at the end. */
  outro?: RadioLine[];
};

/** Lobby choices for a mission run. */
export type MissionConfig = {
  missionId: string;
  operator: OperatorId;
  primary?: WeaponId;
  secondary?: WeaponId;
  difficulty: DifficultyId;
  /** AI squadmates (0–2). In co-op, remote players take these slots. */
  squad: number;
  /** Optional networking hooks (see MissionNetOptions). */
  net?: MissionNetOptions;
  /** Online co-op (CoopSurvivalNet): remote players replace the AI squad; the host runs the script. */
  coop?: MissionNet;
};

/**
 * Plug-in point for a networking layer. The host runs the full simulation
 * and publishes snapshots; clients apply them. All payloads are plain data.
 */
export type MissionNetOptions = {
  role: "host" | "client" | "solo";
  /** Host: called on every state change worth replicating (objective, checkpoint, radio, end). */
  onState?(state: MissionState): void;
  /** Host: fine-grained events (for kill feeds, sounds, etc.). */
  onEvent?(event: MissionEvent): void;
};

export type MissionPhase = "briefing" | "active" | "complete" | "failed";

/** Live, serializable mission state. */
export type MissionState = {
  missionId: string;
  phase: MissionPhase;
  objective: number;
  /** Seconds into the current objective. */
  objectiveTime: number;
  /** 0..1 progress for timed objectives (defend, plant, fuse). */
  progress: number;
  /** destroy: "idle" | "planting" | "armed" | "done". escort: "captive" | "following" | "done". extract: "inbound" | "landed". */
  stage: string;
  /** Seconds left on a fuse / defend timer (−1 if none). */
  timer: number;
  elapsed: number;
  checkpoint: number;
  retries: number;
  kills: number;
  headshots: number;
  gunships: number;
  vipDowned: number;
  /** Times a team member went down (feeds the star rating). Optional for older hosts. */
  downs?: number;
  /** Scripted hostiles still to spawn for this objective. */
  pending: number;
  failReason: string;
};

export type MissionEvent =
  | { type: "objective"; index: number; title: string }
  | { type: "objectiveDone"; index: number }
  | { type: "radio"; speaker: string; text: string }
  | { type: "checkpoint"; index: number }
  | { type: "retry"; index: number }
  /** destroy objective `index`: the charge went off. */
  | { type: "detonate"; index: number }
  /** extract objective `index`: the transport was called. */
  | { type: "extract"; index: number }
  /** A gunship sortie launched (banner on clients). */
  | { type: "air" }
  | { type: "end"; victory: boolean };

export type MissionResult = {
  missionId: string;
  title: string;
  codename: string;
  victory: boolean;
  objectivesDone: number;
  objectivesTotal: number;
  seconds: number;
  par: number;
  retries: number;
  kills: number;
  headshots: number;
  gunships: number;
  score: number;
  grade: "S" | "A" | "B" | "C" | "D";
  /** 1–3 stars on a win (0 on a loss); see rating.ts. */
  stars: number;
  /** Team member downs during the run. */
  downs: number;
  /** Difficulty id the run was played on. */
  difficulty: string;
  breakdown: { label: string; value: number }[];
  failReason: string;
};
