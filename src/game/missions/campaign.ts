import type { MissionDef, Point } from "./types";

/**
 * "Sarrow Basin" — an original three-mission campaign.
 *
 * The Meridian Response Group (MRG), a private security contractor, guards
 * oil infrastructure in the fictional Sarrow Basin. When the Ashen Front, a
 * militia that funds itself by stealing and smuggling crude, cuts the
 * region's relay network, team VANTAGE (you, with KESTREL and HALDEN) is
 * sent in. Handler: ATLAS (Major Ines Calder, MRG operations).
 *
 *   1. Dry Season      — retake the Dustfall relay outpost, destroy the Front's mortar cache.
 *   2. Black Pipe      — sabotage the stolen export manifold at Cinder Flats, rescue engineer Dr. Nadia Orsk.
 *   3. Long Shadow     — the Front hits MRG's own Kestrel Yard; hold the uplink, kill the jammer, end the Warden.
 *
 * Coordinates are in each map's frame (x east, z south). tests/content.test.ts
 * checks every point is walkable and reachable on its map.
 */

const ATLAS = "ATLAS";
const KESTREL = "KESTREL";
const HALDEN = "HALDEN";
const ORSK = "DR. ORSK";
const FRONT = "ASHEN FRONT (intercept)";

// Dustfall Outpost entry points (outside the wall, inside the berm).
const DF_N: Point[] = [{ x: -20, z: -44 }, { x: 0, z: -44 }, { x: 20, z: -44 }];
const DF_E: Point[] = [{ x: 44, z: -20 }, { x: 44, z: 0 }, { x: 44, z: 20 }];
const DF_W: Point[] = [{ x: -44, z: -20 }, { x: -44, z: 0 }, { x: -44, z: 20 }];

// Cinder Flats entry points (berm foot).
const CF_N: Point[] = [{ x: -20, z: -44 }, { x: 0, z: -44 }, { x: 20, z: -44 }];
const CF_E: Point[] = [{ x: 44, z: -20 }, { x: 44, z: 0 }, { x: 44, z: 20 }];
const CF_W: Point[] = [{ x: -44, z: -20 }, { x: -44, z: 0 }, { x: -44, z: 20 }];

// Kestrel Yard: breach points along the walls (the Front blew the gates).
const KY_NE: Point[] = [{ x: 36, z: -36 }, { x: 38, z: -2 }];
const KY_N: Point[] = [{ x: 0, z: -34 }, { x: 14, z: -33 }];
const KY_W: Point[] = [{ x: -38, z: 0 }, { x: -37, z: -37 }];
const KY_E: Point[] = [{ x: 38, z: 20 }, { x: 38, z: -2 }];

export const CAMPAIGN: MissionDef[] = [
  {
    id: "dry-season",
    index: 1,
    title: "Dry Season",
    codename: "OPERATION SANDGLASS",
    mapId: "dustfall-outpost",
    location: "Dustfall Outpost · northern Sarrow Basin",
    time: "06:40 · overcast",
    briefing:
      "The Dustfall relay outpost went silent at 0300. Drone passes show Ashen Front fighters inside the wall and a mortar cache set up by the north containers. Push in from the south road, retake the ops building, destroy the cache and get to the pickup.",
    start: { x: 0, z: 45, yaw: 0 },
    par: 420,
    intro: [
      { speaker: ATLAS, text: "Vantage, Atlas. You're on the ground at Dustfall. Relay's been dark for four hours." },
      { speaker: ATLAS, text: "Ashen Front took the outpost overnight. We want it back before they wire it.", at: 5 },
      { speaker: KESTREL, text: "South gate's open. Moving up on your lead.", at: 10 },
    ],
    objectives: [
      {
        kind: "reach",
        title: "REACH THE SOUTH GATE",
        detail: "Push up the road to the outpost's south gate.",
        at: { x: 0, z: 36 },
        radius: 5,
        waves: [{ at: 3, type: "rifleman", count: 4, from: [{ x: -10, z: 22 }, { x: 10, z: 22 }] }],
        done: [{ speaker: HALDEN, text: "Gate's clear. Ops building, dead ahead." }],
      },
      {
        kind: "defend",
        title: "HOLD THE OPS BUILDING",
        detail: "Atlas is re-keying the relay from inside. Stay in the ops building until the uplink is back.",
        at: { x: 0, z: 0 },
        radius: 9,
        seconds: 75,
        radio: [
          { speaker: ATLAS, text: "Relay's answering. I need seventy-five seconds to re-key it. Hold that building." },
          { speaker: FRONT, text: "…they're in the ops room. All units, converge on the relay.", at: 12 },
          { speaker: KESTREL, text: "Heavy! Plated gunner coming through the north gate!", at: 34 },
        ],
        waves: [
          { at: 4, type: "rifleman", count: 4, from: DF_N },
          { at: 16, type: "rusher", count: 3, from: DF_E },
          { at: 22, type: "rifleman", count: 3, from: DF_W, every: 20, times: 3 },
          { at: 34, type: "armored", count: 1, from: [{ x: 0, z: -44 }] },
        ],
        done: [{ speaker: ATLAS, text: "Relay's ours. Good work. Now about that mortar cache." }],
      },
      {
        kind: "destroy",
        title: "DESTROY THE MORTAR CACHE",
        detail: "Plant a charge on the cache by the north-east containers, then get clear.",
        at: { x: 14, z: -18 },
        label: "MORTAR CACHE",
        plantTime: 3,
        fuse: 7,
        safeRadius: 7,
        radio: [
          { speaker: ATLAS, text: "Cache is north-east, by the olive container. Set a charge and back off." },
          { speaker: HALDEN, text: "Rotors. Somebody brought a gunship.", at: 11 },
        ],
        waves: [
          { at: 2, type: "rifleman", count: 4, from: [...DF_N, ...DF_E] },
          { at: 18, type: "rusher", count: 2, from: DF_N },
        ],
        air: [{ at: 10, insert: { x: 30, z: -40, troops: 3 }, orbit: { x: 0, z: -6, radius: 24, seconds: 30 }, bearing: -0.8 }],
        done: [{ speaker: KESTREL, text: "That's a lot of secondaries. Cache is gone." }],
      },
      {
        kind: "extract",
        title: "EXTRACT AT THE SOUTH ROAD",
        detail: "Get to the LZ outside the south gate and board the bird.",
        at: { x: 0, z: 40 },
        radius: 6,
        heliFrom: { x: 0, z: 190 },
        radio: [
          { speaker: ATLAS, text: "Bird's inbound to the south road. Purple smoke marks the LZ." },
          { speaker: FRONT, text: "…don't let them leave. Everyone to the south side!", at: 8 },
        ],
        waves: [
          { at: 2, type: "rifleman", count: 4, from: [...DF_W, ...DF_E], every: 18, times: 3 },
          { at: 20, type: "armored", count: 1, from: [{ x: -44, z: 0 }] },
        ],
      },
    ],
    outro: [{ speaker: ATLAS, text: "Wheels up, Vantage. Dustfall's relay is singing again. Next stop: Cinder Flats." }],
  },
  {
    id: "black-pipe",
    index: 2,
    title: "Black Pipe",
    codename: "OPERATION COPPERLINE",
    mapId: "cinder-flats",
    location: "Cinder Flats Refinery · central Sarrow Basin",
    time: "13:15 · clear, 41°C",
    briefing:
      "The Front is loading stolen crude through the Cinder Flats export manifold, and they're holding the field engineer, Dr. Nadia Orsk, to keep the valves open. Clear the control shack, wreck the manifold, free Orsk and walk her out to the south LZ.",
    start: { x: -43, z: 38, yaw: -Math.PI / 2 },
    par: 600,
    intro: [
      { speaker: ATLAS, text: "Vantage, Cinder Flats. Heat haze is bad. Watch the long lanes between the pump jacks." },
      { speaker: ATLAS, text: "Orsk was last seen near the north-east containers. Don't lose her.", at: 6 },
    ],
    objectives: [
      {
        kind: "reach",
        title: "SECURE THE CONTROL SHACK",
        detail: "Move through the tank farm to Control Two in the middle of the yard.",
        at: { x: 0, z: 0 },
        radius: 4,
        waves: [
          { at: 3, type: "rifleman", count: 4, from: [{ x: -10, z: 24 }, { x: 8, z: 12 }, { x: 0, z: 44 }] },
          { at: 14, type: "rusher", count: 2, from: CF_E },
        ],
        done: [{ speaker: HALDEN, text: "Control's ours. Manifold readings say they're pumping right now." }],
      },
      {
        kind: "destroy",
        title: "SABOTAGE THE EXPORT MANIFOLD",
        detail: "Charge the manifold at the north-east tank inlet.",
        at: { x: 24, z: -24 },
        label: "EXPORT MANIFOLD",
        plantTime: 3.5,
        fuse: 8,
        safeRadius: 8,
        radio: [
          { speaker: ATLAS, text: "Manifold's at the north-east tank. Blow it and their payday goes with it." },
          { speaker: FRONT, text: "…the contractors are at the manifold! Send the heavy!", at: 9 },
        ],
        waves: [
          { at: 2, type: "rifleman", count: 5, from: [...CF_E, ...CF_N] },
          { at: 9, type: "armored", count: 1, from: [{ x: 44, z: 0 }] },
        ],
        air: [{ at: 15, insert: { x: 30, z: -42, troops: 4 }, orbit: { x: 10, z: -10, radius: 22, seconds: 35 }, bearing: -0.5 }],
        done: [{ speaker: ATLAS, text: "Pressure's dropping across the field. Now find Orsk." }],
      },
      {
        kind: "escort",
        title: "RESCUE DR. ORSK",
        detail: "Free the engineer by the light tower, then keep her alive on the way to the south LZ.",
        vip: { x: 14, z: -20, name: "Dr. Orsk" },
        to: { x: 8, z: 40 },
        radius: 6,
        radio: [
          { speaker: KESTREL, text: "Got eyes on her. Tied up by the light tower, east of the pipe run." },
          { speaker: ORSK, text: "MRG? Thank God. My leg's bad, but I can walk if you go first.", at: 6 },
        ],
        waves: [
          { at: 6, type: "rifleman", count: 4, from: [...CF_W, ...CF_N] },
          { at: 20, type: "rusher", count: 2, from: CF_E, every: 25, times: 3 },
          { at: 32, type: "armored", count: 1, from: [{ x: -44, z: 20 }] },
        ],
        done: [{ speaker: ORSK, text: "That's the separator yard. I know where we are now." }],
      },
      {
        kind: "defend",
        title: "HOLD THE SOUTH LZ",
        detail: "The bird needs a minute. Keep Orsk alive at the landing zone.",
        at: { x: 8, z: 40 },
        radius: 9,
        seconds: 60,
        radio: [
          { speaker: ATLAS, text: "Bird's sixty seconds out. Hold the LZ, and keep the doctor's head down." },
          { speaker: HALDEN, text: "Gunship, west! Get under something!", at: 6 },
        ],
        waves: [
          { at: 3, type: "rifleman", count: 4, from: [...CF_W, ...CF_E], every: 15, times: 4 },
          { at: 12, type: "armored", count: 2, from: [{ x: 44, z: 20 }, { x: -44, z: 20 }] },
        ],
        air: [{ at: 5, orbit: { x: 6, z: 28, radius: 20, seconds: 50 }, bearing: Math.PI }],
      },
      {
        kind: "extract",
        title: "EXTRACT WITH DR. ORSK",
        detail: "Board the bird.",
        at: { x: 8, z: 40 },
        radius: 6,
        heliFrom: { x: 8, z: 200 },
        radio: [{ speaker: ATLAS, text: "Bird on short final. Get her aboard." }],
        waves: [{ at: 2, type: "rifleman", count: 3, from: CF_W }],
      },
    ],
    outro: [
      { speaker: ORSK, text: "They talked about a yard. Your yard. Kestrel. They're going after your base." },
      { speaker: ATLAS, text: "…understood. Vantage, you're not going home to rest.", at: 6 },
    ],
  },
  {
    id: "long-shadow",
    index: 3,
    title: "Long Shadow",
    codename: "OPERATION LONG SHADOW",
    mapId: "kestrel-yard",
    location: "Kestrel Yard · MRG training depot",
    time: "19:05 · dusk",
    briefing:
      "The Ashen Front's enforcer, the Warden, has breached Kestrel Yard, MRG's own depot, and a jammer truck is blinding the whole basin. Reach the warehouse uplink, hold it while Atlas reroutes, destroy the jammer and put the Warden down.",
    start: { x: 0, z: 34, yaw: 0 },
    par: 720,
    intro: [
      { speaker: ATLAS, text: "This is our house, Vantage. They came through three walls at once." },
      { speaker: HALDEN, text: "Firing line's still standing. Moving up the lanes.", at: 6 },
    ],
    objectives: [
      {
        kind: "reach",
        title: "REACH THE WAREHOUSE UPLINK",
        detail: "Cross the range to the roofless warehouse in the north-west corner.",
        at: { x: -24.5, z: -17 },
        radius: 4,
        waves: [
          { at: 4, type: "rifleman", count: 5, from: [...KY_NE, ...KY_N] },
          { at: 15, type: "rusher", count: 2, from: KY_W },
        ],
        done: [{ speaker: ATLAS, text: "Uplink's in the warehouse. Get inside and hold it." }],
      },
      {
        kind: "defend",
        title: "HOLD THE UPLINK",
        detail: "Atlas is rerouting the relay network through Kestrel. Stay inside the warehouse.",
        at: { x: -26, z: -27 },
        radius: 8,
        seconds: 90,
        radio: [
          { speaker: ATLAS, text: "Ninety seconds to reroute. They'll throw everything at that warehouse." },
          { speaker: FRONT, text: "…Warden says nobody leaves that building alive.", at: 20 },
          { speaker: KESTREL, text: "Two heavies, east side! And there's the gunship.", at: 44 },
        ],
        waves: [
          { at: 3, type: "rifleman", count: 4, from: [...KY_NE, ...KY_N], every: 20, times: 4 },
          { at: 24, type: "rusher", count: 3, from: [{ x: -37, z: 10 }] },
          { at: 44, type: "armored", count: 2, from: KY_NE },
        ],
        air: [{ at: 30, insert: { x: 0, z: -10, troops: 4 }, orbit: { x: -20, z: -20, radius: 20, seconds: 45 }, bearing: 0.3 }],
        done: [{ speaker: ATLAS, text: "Rerouted. Now I can see the jammer. East side, by the olive container." }],
      },
      {
        kind: "destroy",
        title: "DESTROY THE JAMMER TRUCK",
        detail: "Charge the jammer by the olive container on the east side.",
        at: { x: 22, z: -20 },
        label: "JAMMER",
        plantTime: 3,
        fuse: 8,
        safeRadius: 8,
        radio: [{ speaker: ATLAS, text: "Kill that jammer and the whole basin can talk again." }],
        waves: [
          { at: 2, type: "rifleman", count: 5, from: KY_NE },
          { at: 10, type: "armored", count: 1, from: [{ x: 38, z: 20 }] },
        ],
        done: [{ speaker: FRONT, text: "…we've lost the jammer. Warden, they're coming for you." }],
      },
      {
        kind: "eliminate",
        title: "TAKE DOWN THE WARDEN",
        detail: "The Front's enforcer and his heavies are pushing in from the north. Kill them all.",
        radio: [
          { speaker: ATLAS, text: "The Warden is on the field. Plated, heavy gun. Aim high and stay mobile." },
          { speaker: HALDEN, text: "Gunship's back! Find cover!", at: 10 },
        ],
        waves: [
          { at: 0, type: "rifleman", count: 6, from: [...KY_E, ...KY_W] },
          { at: 3, type: "warden", count: 1, from: [{ x: 0, z: -34 }] },
          { at: 6, type: "armored", count: 2, from: [{ x: -37, z: -37 }, { x: 36, z: -36 }] },
        ],
        air: [{ at: 10, insert: { x: 0, z: 0, troops: 4 }, orbit: { x: 0, z: 0, radius: 24, seconds: 60 }, bearing: -1.2 }],
        clearFirst: true,
        done: [{ speaker: KESTREL, text: "Warden's down. He's not getting up." }],
      },
      {
        kind: "extract",
        title: "EXTRACT FROM THE RANGE",
        detail: "Get to the LZ on the range.",
        at: { x: 0, z: 20 },
        radius: 6,
        heliFrom: { x: 0, z: 180 },
        radio: [{ speaker: ATLAS, text: "Bird's coming into the range. Last ones out, Vantage." }],
        waves: [{ at: 2, type: "rifleman", count: 4, from: [...KY_W, ...KY_E], every: 20, times: 2 }],
      },
    ],
    outro: [
      { speaker: ATLAS, text: "Relay network is up across the basin. The Front's lost its eyes, its oil money and its Warden." },
      { speaker: ATLAS, text: "Good work, Vantage. Go get some sleep.", at: 6 },
    ],
  },
];

export function getMission(id: string) {
  return CAMPAIGN.find((m) => m.id === id);
}
