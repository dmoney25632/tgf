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
  /** reach: also completes when a team member is anywhere inside this rectangle (e.g. "inside the wire"). */
  zone?: Rect;
  /** Waypoint label (default per kind). assassinate: shown until the target is identified. */
  marker?: string;
};

/** Axis-aligned rectangle on the ground. */
export type Rect = { x0: number; x1: number; z0: number; z1: number };

export type ObjectiveDef =
  | (ObjectiveBase & { kind: "reach"; at: Point; radius: number })
  | (ObjectiveBase & { kind: "defend"; at: Point; radius: number; seconds: number })
  | (ObjectiveBase & { kind: "destroy"; at: Point; label: string; plantTime: number; fuse: number; safeRadius: number })
  | (ObjectiveBase & { kind: "escort"; vip: Point & { name: string }; to: Point; radius: number })
  | (ObjectiveBase & { kind: "eliminate" })
  /** Kill one named target (the mission spawns and moves it). Completes when the target dies. */
  | (ObjectiveBase & { kind: "assassinate"; target: Point & { name: string; short: string } })
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
  /** Stealth rules (detection layer, star modifiers). See missions/stealth. */
  stealth?: StealthRules;
  /** Briefing intel map (drawn on the mission screen). */
  intel?: IntelMap;
};

export type StealthRules = {
  /** Difficulties on which full detection compromises the run (checkpoint restart) instead of raising a hard alarm. */
  failOnDetect: string[];
  /** Non-target kills allowed before the rating drops a star. */
  killAllowance: number;
  /** No AI squadmates: stealth is a players-only job. */
  noSquad: true;
};

/** A top-down sketch for the briefing: rectangles, lines and labelled points in map metres. */
export type IntelMap = {
  bounds: Rect;
  areas: (Rect & { label?: string; kind: "fence" | "building" | "water" | "road" | "cover" | "danger" })[];
  lines: { pts: Point[]; kind: "route" | "patrol" | "exfil" }[];
  marks: (Point & { label: string; kind: "start" | "target" | "exfil" | "tower" | "entry" | "vehicle" })[];
};

/** Stealth tallies (feed the star rating and the debrief). */
export type StealthTally = {
  /** Hard alarms raised. */
  alarms: number;
  /** Times any guard fully identified a player. */
  spotted: number;
  /** Non-target kills. */
  kills: number;
  /** Silent takedowns (knife / melee from behind). */
  takedowns: number;
  /** Bodies found by guards. */
  bodies: number;
};

export type StealthStatus = "hidden" | "suspicious" | "alert";

/** Replicated stealth snapshot (host → clients, ~5 Hz). */
export type StealthSnapshot = StealthTally & {
  status: StealthStatus;
  /** Seconds left on the alarm / search (−1 if none). */
  timer: number;
  /** Flat [agentId, awareness% (0–100), mode, …] for every guard with a non-zero gauge. Mode: 0 calm, 1 suspicious, 2 searching, 3 alerted, 4 calling it in. */
  sus: number[];
  /** Target's agent id (−1 if none) and whether the team has eyes on it (marker shown). */
  target: number;
  identified: boolean;
  /** Short line under the status badge ("BODY FOUND", "RADIO CALL"…). */
  cue: string;
  /** Host stealth clock (s): drives the searchlight sweeps on clients. */
  clock: number;
  /** Patrol truck: [distance along its loop (m), moving 0/1, headlights 0/1]. */
  truck: number[];
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
  /** Stealth missions only. */
  stealth?: StealthSnapshot;
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
  /** Stealth missions only. */
  stealth?: StealthTally;
};
