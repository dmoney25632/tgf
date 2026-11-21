import {
  AMMO, BARRACKS, CHECKPOINT, COMPOUND, EXFIL, FENCE, HQ, HQ_ZONE, INSERT, OFFICE, RIVER, SEARCHLIGHTS, SHED, TOWER, TOWERS, TRUCK_LOOP,
  GENERATOR, FARMHOUSE, BOATHOUSE,
} from "../../world/maps/greywater";
import type { EnemyType } from "../../survival/config";
import type { MissionDef, Point } from "../types";

/**
 * "Nightjar" (OPERATION STILLWATER): a stealth assassination at Greywater
 * Depot. Colonel Mattias Kerr runs the Ashen Front's supply line out of the
 * depot's command house. Team VANTAGE goes in on foot at 02:40 on a new
 * moon: through the fields and the reed ditch, past the road checkpoint and
 * the patrol truck, through a gap in the wire, into the command house and up
 * to his office. Then out the back, across the north field to a skiff at
 * the jetty, before anyone knows he's dead.
 *
 * Coordinates are in the Greywater map frame (x east, z south). The
 * garrison below is the stealth layer's input (StealthDirector); every
 * point is checked for reachability by tests/greywater.test.ts.
 */

const ATLAS = "ATLAS";
const KESTREL = "KESTREL";
const FRONT = "ASHEN FRONT (intercept)";

/** How a guard spends a calm night. */
export type GuardPlan = {
  id: string;
  type: EnemyType;
  /** Patrol: walk these points in a loop (pausing `pause` s and looking `look` at each). Post: one point. */
  route: (Point & { pause?: number; look?: number })[];
  /** Feet height for perched guards (towers). Anchored: never leaves the spot. */
  y?: number;
  anchored?: boolean;
  /** Tower guard: index into SEARCHLIGHTS; he watches its pool. */
  searchlight?: number;
  /** Walking pace (m/s). */
  speed?: number;
  /** Carries a torch (outside patrols). */
  torch?: boolean;
  /** Skipped on Low quality. */
  optional?: boolean;
  /** The assassination target. */
  target?: boolean;
};

const S = 0; // yaw: facing +z (south)
const N = Math.PI;
const E = Math.PI / 2;
const W = -Math.PI / 2;

const perch = TOWER.perch;

export const GARRISON: GuardPlan[] = [
  // ---- Outside the wire -----------------------------------------------------------------------------
  { id: "field", type: "rifleman", torch: true, optional: true, route: [{ x: -30, z: 57, pause: 4, look: S }, { x: -6, z: 55 }, { x: 18, z: 52, pause: 3 }, { x: 31, z: 67, pause: 4, look: S }, { x: 6, z: 64 }] },
  { id: "west-perimeter", type: "rifleman", torch: true, route: [{ x: -60, z: 38, pause: 3, look: W }, { x: -60, z: -8 }, { x: -60, z: -58, pause: 3, look: W }, { x: -60, z: -8 }] },
  { id: "east-perimeter", type: "rifleman", torch: true, optional: true, route: [{ x: 60, z: 38, pause: 3, look: E }, { x: 60, z: -20 }, { x: 60, z: -58, pause: 3, look: E }, { x: 60, z: -20 }] },
  { id: "checkpoint-a", type: "rifleman", route: [{ x: 2.5, z: 70.2, look: S }] },
  { id: "checkpoint-b", type: "rifleman", optional: true, route: [{ x: -4, z: 74.5, pause: 9, look: E }, { x: -4, z: 66, pause: 6, look: S }] },
  { id: "riverside", type: "rifleman", torch: true, optional: true, route: [{ x: 10, z: -96, pause: 4, look: N }, { x: 48, z: -99, pause: 5, look: E }, { x: 40, z: -78 }] },
  { id: "back-gate", type: "rifleman", route: [{ x: 17, z: -57.8, look: N }] },
  // ---- The towers -----------------------------------------------------------------------------------
  ...TOWERS.map((t, i): GuardPlan => ({ id: `tower-${t.id}`, type: "rifleman", y: perch, anchored: true, searchlight: i, route: [{ x: t.x, z: t.z, look: SEARCHLIGHTS[i].yaw }] })),
  // ---- Inside the wire ---------------------------------------------------------------------------------
  { id: "gate-l", type: "rifleman", route: [{ x: -6.2, z: 38, look: S }] },
  { id: "gate-r", type: "rifleman", route: [{ x: 6.2, z: 38.2, look: S + 0.3 }] },
  { id: "courtyard", type: "rifleman", route: [{ x: -10, z: 20, pause: 3 }, { x: 10, z: 18, pause: 2 }, { x: 12, z: 4, pause: 3, look: E }, { x: -12, z: 0, pause: 3, look: W }] },
  { id: "motor-pool", type: "rifleman", route: [{ x: -27, z: -3, pause: 3 }, { x: -27, z: 20, pause: 3, look: W }, { x: -42.5, z: 10, pause: 6, look: N }] },
  { id: "mechanic", type: "rifleman", optional: true, route: [{ x: -36, z: 8.2, look: N }] },
  { id: "barracks", type: "rifleman", route: [{ x: 22, z: 15, pause: 2 }, { x: 22, z: -15, pause: 3 }, { x: 46.5, z: -15, pause: 4, look: E }, { x: 22, z: -15 }] },
  { id: "smoker", type: "rifleman", optional: true, route: [{ x: 24, z: 4, look: W }] },
  { id: "north-yard", type: "rifleman", torch: true, route: [{ x: -24, z: -49, pause: 4, look: N }, { x: 30, z: -49.5, pause: 4, look: N }] },
  // ---- The command house -------------------------------------------------------------------------------
  { id: "hq-door", type: "rifleman", route: [{ x: 1.9, z: -16.2, look: S }] },
  { id: "hq-ground", type: "rifleman", speed: 1.2, route: [{ x: 0, z: -20, pause: 3 }, { x: -9, z: -24.5, pause: 5, look: W }, { x: 0, z: -20, pause: 2 }, { x: 9, z: -21, pause: 5, look: E }] },
  { id: "hq-upper", type: "rifleman", speed: 1.2, route: [{ x: 0, z: -33, pause: 4, look: S }, { x: -7, z: -34, pause: 4, look: W }, { x: 0, z: -33 }, { x: 0, z: -42.2, pause: 4, look: N }] },
  { id: "bodyguard", type: "armored", speed: 1.1, route: [{ x: 4.6, z: -38.5, pause: 9, look: W }, { x: 12.4, z: -42.4, pause: 7, look: W }] },
  { id: "kerr", type: "officer", target: true, speed: 1.0, route: [{ x: OFFICE.desk.x, z: OFFICE.desk.z, pause: 22, look: N }, { x: OFFICE.window.x, z: OFFICE.window.z, pause: 9, look: E }, { x: -6.2, z: -35.6, pause: 11, look: Math.atan2(-2.2, -1.4) }] },
];

/** Reinforcements after a hard alarm: [delay (s), type, count, from]. */
export const REINFORCEMENTS: { at: number; type: EnemyType; count: number; from: Point }[] = [
  { at: 8, type: "rifleman", count: 3, from: { x: BARRACKS.x0 - 1.6, z: 0 } },
  { at: 25, type: "rifleman", count: 3, from: { x: 0, z: 46 } },
  { at: 25, type: "rusher", count: 2, from: { x: 0, z: -66 } },
];

/** Where reinforcements sweep once the alarm cools down (search pattern). */
export const SEARCH_POINTS: Point[] = [
  { x: 0, z: 10 }, { x: -30, z: 12 }, { x: 30, z: -26 }, { x: 0, z: -48 }, { x: -20, z: -30 }, { x: 36, z: 22 },
];

/** Radio cues when the first team member enters an area (once per run). */
export const AREA_CUES: { id: string; x0: number; x1: number; z0: number; z1: number; speaker: string; text: string }[] = [
  { id: "ditch", x0: -72, x1: -54, z0: 30, z1: 90, speaker: KESTREL, text: "Reeds are good cover. Stay low and they won't see you." },
  { id: "checkpoint", x0: -20, x1: 20, z0: 64, z1: 84, speaker: KESTREL, text: "Road checkpoint, two on the boom. Go wide." },
  { id: "wire", x0: -60, x1: -50, z0: 0, z1: 16, speaker: ATLAS, text: "That's the cut in the wire. Watch the motor pool patrol." },
  { id: "inside", ...COMPOUND, speaker: ATLAS, text: "You're inside. Command house is the long building north of the courtyard." },
  { id: "hq", ...HQ_ZONE, speaker: ATLAS, text: "Kerr's office is upstairs, east side. Stair's in the hall." },
];

/** Briefing points (also used by the tests). */
export const NIGHTJAR_POINTS = {
  insert: INSERT,
  westCut: { x: FENCE.x0 - 1.2, z: (FENCE.westCut[0] + FENCE.westCut[1]) / 2 },
  westCutInside: { x: FENCE.x0 + 1.5, z: (FENCE.westCut[0] + FENCE.westCut[1]) / 2 },
  sideDoor: { x: HQ.x0 - 0.8, z: (HQ.sideDoor[0] + HQ.sideDoor[1]) / 2 },
  office: OFFICE.desk,
  backGate: { x: (FENCE.backGate[0] + FENCE.backGate[1]) / 2, z: FENCE.z0 + 2 },
  exfil: EXFIL,
};

export const NIGHTJAR_MISSION: MissionDef = {
  id: "nightjar",
  index: 5,
  title: "Nightjar",
  codename: "OPERATION STILLWATER",
  mapId: "greywater",
  location: "Greywater depot · Halvarn valley",
  time: "02:40 · new moon, ground mist",
  briefing:
    "Colonel Mattias Kerr runs the Ashen Front's fuel convoys out of Greywater Depot. Tonight he's working late in the command house. Get through the fields and the wire without being seen, find Kerr and kill him, then slip out to the boat at the river jetty. If they raise the alarm, Kerr runs for cover and the whole garrison comes looking.",
  notes: [
    "Stay in the dark. Lamps, searchlight pools, truck headlights and torches make you visible from much further away.",
    "Crouch in tall grass, reeds or bushes and you're nearly invisible. Crouch-walking is silent; walking can be heard up close, sprinting further.",
    "Watch the marker over each guard: it fills as he notices you. Yellow ? means suspicious, red ! means he's calling it in. Kill him within two seconds and nobody hears.",
    "[V] from behind is a silent takedown. The MP5SD and Mk 23 are suppressed. Any other gunshot brings the base down on you.",
    "Guards find bodies. A body won't trigger the alarm, but it puts the whole base on edge.",
    "Recruit / Regular: being spotted sets off a hard alarm (reinforcements, and stars lost). Veteran: being spotted compromises the mission. You restart at the checkpoint.",
    "Checkpoints: inside the wire, the command house, and once Kerr is dead.",
  ],
  start: { x: INSERT.x, z: INSERT.z, yaw: INSERT.yaw },
  par: 720,
  stars: [600, 900],
  maxRetries: 4,
  stealth: { failOnDetect: ["veteran"], killAllowance: 12, noSquad: true },
  intro: [
    { speaker: ATLAS, text: "Vantage, Atlas. You're in the trees south of Greywater. No moon, ground mist. It's a good night for it." },
    { speaker: ATLAS, text: "Kerr's in the command house. Get in, put him down, get out to the jetty. Nobody sees you.", at: 6 },
    { speaker: KESTREL, text: "Patrol truck circles the wire. Keep out of its lights.", at: 13 },
  ],
  objectives: [
    {
      kind: "reach",
      title: "GET INSIDE THE WIRE",
      detail: "Cross the fields unseen and get through the fence. There's a cut section behind the motor pool (west), a collapsed panel on the east side, or the guarded gate.",
      at: NIGHTJAR_POINTS.westCut,
      radius: 1.8,
      marker: "CUT WIRE",
      zone: COMPOUND,
      checkpoint: { x: INSERT.x, z: INSERT.z, yaw: INSERT.yaw },
      radio: [{ speaker: KESTREL, text: "Ditch on the left runs right up to the wire. Reeds all the way.", at: 22 }],
      done: [{ speaker: ATLAS, text: "You're through. Command house, north side of the yard." }],
    },
    {
      kind: "reach",
      title: "GET INTO THE COMMAND HOUSE",
      detail: "Reach the command house without raising the alarm. The side door on the west wall is out of the courtyard light.",
      at: NIGHTJAR_POINTS.sideDoor,
      radius: 1.4,
      marker: "SIDE DOOR",
      zone: HQ_ZONE,
      checkpoint: { x: NIGHTJAR_POINTS.westCutInside.x, z: NIGHTJAR_POINTS.westCutInside.z, yaw: -Math.PI / 2 },
      done: [{ speaker: ATLAS, text: "Upstairs, east office. He'll have a bodyguard." }],
    },
    {
      kind: "assassinate",
      title: "ELIMINATE COL. KERR",
      detail: "Find Colonel Kerr on the upper floor and kill him. He moves between his desk, the window and the map room.",
      target: { x: OFFICE.desk.x, z: OFFICE.desk.z, name: "Colonel Mattias Kerr", short: "COL. KERR" },
      marker: "KERR'S OFFICE (UPSTAIRS)",
      checkpoint: { x: HQ.x0 - 2.2, z: (HQ.sideDoor[0] + HQ.sideDoor[1]) / 2, yaw: -Math.PI / 2 },
      done: [
        { speaker: ATLAS, text: "Confirmed. Kerr is down." },
        { speaker: ATLAS, text: "Out the back stair, through the north gate. Boat's at the jetty, north-east.", at: 3 },
      ],
    },
    {
      kind: "reach",
      title: "EXFILTRATE TO THE JETTY",
      detail: "Leave by the back stair and the north gate (or the east collapse), cross the north field and reach the skiff at the river jetty.",
      at: EXFIL,
      radius: 4,
      marker: "EXFIL · SKIFF",
      checkpoint: { x: 0, z: HQ.rear.z0 - 6.5, yaw: 0 },
      radio: [{ speaker: FRONT, text: "…Depot Seven, routine check. Colonel, respond.", at: 25 }],
      done: [{ speaker: KESTREL, text: "Everyone's aboard. Pushing off." }],
    },
  ],
  outro: [
    { speaker: ATLAS, text: "Kerr is dead and the convoys stop. Good work, Vantage." },
    { speaker: KESTREL, text: "Quietest night we've had all year.", at: 5 },
  ],
  intel: {
    bounds: { x0: -100, x1: 100, z0: -115, z1: 125 },
    areas: [
      { x0: -100, x1: 100, z0: -115, z1: RIVER.bank, kind: "water", label: "HALVARN RIVER" },
      { x0: FENCE.x0, x1: FENCE.x1, z0: FENCE.z0, z1: FENCE.z1, kind: "fence" },
      { x0: HQ.x0, x1: HQ.x1, z0: HQ.rear.z0, z1: HQ.front.z1, kind: "building", label: "COMMAND HOUSE" },
      { x0: BARRACKS.x0, x1: BARRACKS.x1, z0: BARRACKS.z0, z1: BARRACKS.z1, kind: "building", label: "BARRACKS" },
      { x0: SHED.x0, x1: SHED.x1, z0: SHED.z0, z1: SHED.z1, kind: "building", label: "MOTOR POOL" },
      { x0: GENERATOR.x - 2, x1: GENERATOR.x + 2, z0: GENERATOR.z - 1.6, z1: GENERATOR.z + 1.6, kind: "building" },
      { x0: FARMHOUSE.x - FARMHOUSE.w / 2, x1: FARMHOUSE.x + FARMHOUSE.w / 2, z0: FARMHOUSE.z - FARMHOUSE.d / 2, z1: FARMHOUSE.z + FARMHOUSE.d / 2, kind: "building", label: "RUIN" },
      { x0: BOATHOUSE.x - 3, x1: BOATHOUSE.x + 3, z0: BOATHOUSE.z - 2.5, z1: BOATHOUSE.z + 2.5, kind: "building" },
      { x0: -8, x1: 8, z0: 6, z1: 22, kind: "danger", label: "FLOODLIT" },
      { x0: -3.3, x1: 3.3, z0: FENCE.z1, z1: 125, kind: "road" },
      { x0: -74, x1: -54, z0: 10, z1: 120, kind: "cover", label: "REED DITCH" },
      { x0: -70, x1: -10, z0: 66, z1: 100, kind: "cover", label: "TALL GRASS" },
    ],
    lines: [
      { pts: [...TRUCK_LOOP, TRUCK_LOOP[0]], kind: "patrol" },
      { pts: [INSERT, { x: -60, z: 96 }, { x: -60, z: 40 }, { x: -56, z: 12 }, NIGHTJAR_POINTS.westCut, { x: -16, z: -24.5 }], kind: "route" },
      { pts: [{ x: 0, z: -46 }, NIGHTJAR_POINTS.backGate, { x: 17, z: -64 }, { x: 40, z: -86 }, EXFIL], kind: "exfil" },
    ],
    marks: [
      { ...INSERT, label: "INSERT", kind: "start" },
      { x: OFFICE.desk.x, z: OFFICE.desk.z, label: "KERR (UPSTAIRS)", kind: "target" },
      { ...EXFIL, label: "SKIFF", kind: "exfil" },
      ...TOWERS.map((t) => ({ x: t.x, z: t.z, label: "", kind: "tower" as const })),
      { ...NIGHTJAR_POINTS.westCut, label: "CUT WIRE", kind: "entry" },
      { x: FENCE.x1 + 1, z: (FENCE.eastCollapse[0] + FENCE.eastCollapse[1]) / 2, label: "COLLAPSE", kind: "entry" },
      { x: CHECKPOINT.apc.x, z: CHECKPOINT.apc.z, label: "CHECKPOINT", kind: "vehicle" },
    ],
  },
};

export const NIGHTJAR_AMMO: Point[] = AMMO.map((a) => ({ x: a.x, z: a.z }));
