import { BUNKER, BUNKER_CHARGE, CHURCH, LZ, MAST, TOWER, YARD, AMMO } from "../world/maps/ironCrossing";
import type { MissionDef, Point } from "./types";
import { NIGHTJAR_AMMO, NIGHTJAR_MISSION } from "./stealth/nightjar";

/**
 * Standalone operations: single missions outside the Sarrow Basin campaign,
 * each with its own map, checkpoints, star targets and leaderboard.
 *
 * "Iron Crossing" (OPERATION KEYSTONE). After losing the basin, the Ashen
 * Front fell back across the Vellen gorge and dug in on the far end of the
 * Brask rail-and-road bridge, the only crossing for sixty kilometres. Team
 * VANTAGE lands south of Brask, fights through the town, takes the
 * bridgehead checkpoint, crosses the three spans under fire (or along the
 * catwalks beneath the deck), blows the MG bunker on the far side, holds the
 * customs yard until the engineers are across and extracts by helicopter.
 *
 * Coordinates are in the Iron Crossing map frame (x east, z south; the
 * insertion is at the south end, z ≈ 160, and the team pushes north).
 * tests/ironCrossingMission.test.ts checks every point is reachable.
 */

const ATLAS = "ATLAS";
const KESTREL = "KESTREL";
const HALDEN = "HALDEN";
const FRONT = "ASHEN FRONT (intercept)";
const SAPPER = "SAPPER-2";

// ---- Entry points --------------------------------------------------------------------------------
/** Brask: side streets and the north end of the main street. */
const TOWN_N: Point[] = [{ x: -3, z: 128 }, { x: 3, z: 127 }];
const TOWN_SIDE: Point[] = [{ x: -44, z: 128 }, { x: 46, z: 128 }, { x: -44, z: 80 }, { x: 46, z: 80 }];
const SQUARE_E: Point[] = [{ x: 24, z: 104 }, { x: 30, z: 106 }];
/** South bridgehead: the nests by the booth, and reinforcements from the deck. */
const HEAD_NESTS: Point[] = [{ x: 6.2, z: 78.4 }, { x: -14.6, z: 79.4 }, { x: 8.6, z: 72 }];
const DECK_S: Point[] = [{ x: -3, z: 52 }, { x: -6, z: 40 }];
/** Mid-bridge: deck lanes north of the train, and both catwalks. */
const DECK_MID: Point[] = [{ x: -3, z: -22 }, { x: -6, z: -10 }, { x: 2.6, z: -24 }];
const DECK_N: Point[] = [{ x: -3, z: -44 }, { x: 0, z: -56 }];
const CATWALKS: Point[] = [{ x: -9.3, z: -34 }, { x: 9.3, z: -34 }];
/** North bank: the road beyond the bunker and the customs yard approaches. */
const NORTH_ROAD: Point[] = [{ x: -4, z: -96 }, { x: 6, z: -94 }];
const FIELD: Point[] = [{ x: -22, z: -142 }, { x: 22, z: -142 }, { x: 0, z: -152 }];
const FLANK_E: Point[] = [{ x: 42, z: -108 }, { x: 44, z: -124 }];
const FLANK_W: Point[] = [{ x: -42, z: -118 }, { x: -40, z: -86 }];
/** Perched sniper spots (y = perch floor). */
const CHURCH_TOWER = { x: CHURCH.tower.x, z: CHURCH.tower.z, y: CHURCH.tower.perch };
const SIGNAL_MAST = { x: MAST.x, z: MAST.z, y: MAST.perch };
const WATER_TOWER = { x: TOWER.x, z: TOWER.z, y: TOWER.perch };

export const IRON_CROSSING_MISSION: MissionDef = {
  id: "iron-crossing",
  index: 4,
  title: "Iron Crossing",
  codename: "OPERATION KEYSTONE",
  mapId: "iron-crossing",
  location: "Brask bridge · Vellen gorge",
  time: "07:15 · haze, light wind",
  briefing:
    "The Ashen Front is dug in across the Brask bridge, the only crossing over the Vellen gorge. Push through Brask, take the checkpoint at the south end, fight across the three spans and destroy the MG bunker covering the north ramp. Then hold the customs yard while our engineers cross, and get to the LZ.",
  notes: [
    "Sniper in the church tower over the square. Use the side streets.",
    "The deck is a shooting gallery: the stalled train and wrecks are cover, the catwalks under the deck are a flanking route (drop through the parapet gaps, climb the pier steps).",
    "The MG bunker can only be killed with a charge at its rear door.",
    "Ammo crates at the booth, the north ramp and the customs yard: hold [F].",
    "Every objective is a checkpoint. Solo: dying restarts it. Co-op: revive each other; if everyone goes down, the squad redeploys at the checkpoint.",
  ],
  start: { x: 0, z: 160, yaw: 0 },
  par: 660,
  stars: [540, 780],
  maxRetries: 5,
  intro: [
    { speaker: ATLAS, text: "Vantage, Atlas. You're down south of Brask. The bridge is two hundred metres past the square." },
    { speaker: ATLAS, text: "The Front holds both ends. We need that crossing standing, so no air strikes. It's on you.", at: 5 },
    { speaker: KESTREL, text: "Main street's quiet. Too quiet. Watch the windows.", at: 11 },
  ],
  objectives: [
    {
      kind: "reach",
      title: "PUSH THROUGH BRASK",
      detail: "Fight up the main street to the fountain square.",
      at: { x: 2, z: 104 },
      radius: 7,
      checkpoint: { x: 0, z: 160, yaw: 0 },
      waves: [
        { at: 1, type: "sniper", count: 1, from: [CHURCH_TOWER] },
        { at: 3, type: "rifleman", count: 4, from: TOWN_N },
        { at: 12, type: "rusher", count: 3, from: TOWN_SIDE },
        { at: 22, type: "rifleman", count: 3, from: SQUARE_E },
      ],
      radio: [
        { speaker: HALDEN, text: "Glint, church tower! Sniper over the square!", at: 4 },
        { speaker: KESTREL, text: "Use the side streets, stay out of his lane.", at: 8 },
      ],
      done: [{ speaker: ATLAS, text: "Square's yours. The bridgehead checkpoint is just past the promenade." }],
    },
    {
      kind: "reach",
      title: "SEIZE THE BRIDGEHEAD CHECKPOINT",
      detail: "Clear the sandbag nests around the checkpoint booth at the south end of the bridge.",
      at: { x: -1.5, z: 74 },
      radius: 6,
      clearFirst: true,
      checkpoint: { x: 2, z: 108, yaw: 0 },
      waves: [
        { at: 0, type: "rifleman", count: 3, from: HEAD_NESTS },
        { at: 8, type: "rifleman", count: 3, from: DECK_S },
        { at: 18, type: "armored", count: 1, from: [{ x: -3, z: 50 }] },
      ],
      radio: [
        { speaker: FRONT, text: "…movement at the booth. Hold the south end, nobody crosses." },
        { speaker: KESTREL, text: "Plated gunner coming off the deck!", at: 18 },
      ],
      done: [
        { speaker: ATLAS, text: "Checkpoint's ours. That's the south end." },
        { speaker: HALDEN, text: "Long way across. Lots of open deck.", at: 3 },
      ],
    },
    {
      kind: "reach",
      title: "REACH THE STALLED TRAIN",
      detail: "Cross the first span to the freight train halfway over the gorge. Wrecks and wagons are cover; the catwalks under the deck flank the road.",
      at: { x: -2, z: 4 },
      radius: 6,
      checkpoint: { x: -1.5, z: 74, yaw: 0 },
      waves: [
        { at: 2, type: "sniper", count: 1, from: [SIGNAL_MAST] },
        { at: 4, type: "rifleman", count: 4, from: DECK_MID },
        { at: 14, type: "rusher", count: 2, from: CATWALKS },
        { at: 26, type: "rifleman", count: 3, from: DECK_N },
      ],
      air: [{ at: 20, orbit: { x: 0, z: 0, radius: 34, seconds: 40 }, bearing: Math.PI / 2 }],
      radio: [
        { speaker: ATLAS, text: "Go, go. Mast on the north bank has a shooter. Use the train." },
        { speaker: KESTREL, text: "Rotors. Gunship coming up the gorge!", at: 18 },
        { speaker: FRONT, text: "…Vulture, they're on the bridge. Light it up.", at: 21 },
      ],
      done: [{ speaker: HALDEN, text: "At the train. The MG nest at the far end has the whole north span covered." }],
    },
    {
      kind: "destroy",
      title: "DESTROY THE MG BUNKER",
      detail: "Cross the north span and plant a charge at the bunker's rear door.",
      at: { x: BUNKER_CHARGE.x, z: BUNKER_CHARGE.z },
      label: "MG BUNKER",
      plantTime: 3,
      fuse: 6,
      safeRadius: 8,
      checkpoint: { x: -2, z: 6, yaw: 0 },
      waves: [
        { at: 0, type: "armored", count: 1, from: [{ x: BUNKER.x - 1.5, z: BUNKER.z }], elite: true },
        { at: 0, type: "rifleman", count: 2, from: [{ x: 12, z: -69 }, { x: 14, z: -69.5 }] },
        { at: 2, type: "sniper", count: 1, from: [WATER_TOWER] },
        { at: 6, type: "rifleman", count: 3, from: DECK_N },
        { at: 20, type: "rifleman", count: 2, from: NORTH_ROAD, every: 22, times: 3 },
        { at: 30, type: "rusher", count: 2, from: CATWALKS },
      ],
      radio: [
        { speaker: ATLAS, text: "That bunker has to go before the engineers can cross. Charge on the rear door." },
        { speaker: KESTREL, text: "Water tower, north-east. Another sniper.", at: 6 },
        { speaker: HALDEN, text: "Catwalks are clear. Go under them.", at: 14 },
      ],
      done: [
        { speaker: ATLAS, text: "Bunker's gone. Engineers are rolling onto the bridge." },
      ],
    },
    {
      kind: "defend",
      title: "HOLD THE CUSTOMS YARD",
      detail: "Hold the customs yard while the engineers clear the charges on the bridge.",
      at: { x: YARD.x, z: YARD.z },
      radius: 11,
      seconds: 90,
      checkpoint: { x: -4, z: -66, yaw: 0 },
      waves: [
        { at: 3, type: "rifleman", count: 4, from: FIELD },
        { at: 14, type: "rusher", count: 3, from: FLANK_E },
        { at: 22, type: "rifleman", count: 3, from: FLANK_W, every: 24, times: 3 },
        { at: 42, type: "armored", count: 1, from: [{ x: 0, z: -152 }] },
        { at: 55, type: "rusher", count: 3, from: FIELD },
      ],
      air: [{ at: 30, insert: { x: 14, z: -124, troops: 4 }, orbit: { x: YARD.x, z: YARD.z, radius: 26, seconds: 35 }, bearing: -Math.PI / 2 }],
      radio: [
        { speaker: SAPPER, text: "Atlas, Sapper-2. They wired the deck. Ninety seconds and it's safe." },
        { speaker: FRONT, text: "…they took the yard. Everything we have, push them back into the gorge.", at: 10 },
        { speaker: KESTREL, text: "Second gunship, dropping troops in the field!", at: 28 },
      ],
      done: [
        { speaker: SAPPER, text: "Deck's clean. Bridge is ours." },
        { speaker: ATLAS, text: "Bird's inbound to the field LZ. Get out of there, Vantage.", at: 3 },
      ],
    },
    {
      kind: "extract",
      title: "EXTRACT AT THE LZ",
      detail: "Get the squad onto the helicopter in the field north of the yard.",
      at: { x: LZ.x, z: LZ.z },
      radius: 7,
      heliFrom: { x: -150, z: -260 },
      checkpoint: { x: YARD.x, z: YARD.z + 4, yaw: 0 },
      waves: [{ at: 6, type: "rifleman", count: 3, from: [{ x: -30, z: -152 }, { x: 30, z: -150 }] }],
      radio: [{ speaker: KESTREL, text: "Smoke's out. Bird's thirty seconds." }],
    },
  ],
  outro: [
    { speaker: ATLAS, text: "Bridge is standing and the Front's lost its last crossing. Good work, Vantage." },
    { speaker: HALDEN, text: "Next time they can blow their own bridge.", at: 5 },
  ],
};

/** Hold-[F] ammo crates per mission id (map points). */
export const MISSION_AMMO: Record<string, Point[]> = {
  "iron-crossing": AMMO.map((a) => ({ x: a.x, z: a.z })),
  nightjar: NIGHTJAR_AMMO,
};

export const OPERATIONS: MissionDef[] = [IRON_CROSSING_MISSION, NIGHTJAR_MISSION];

