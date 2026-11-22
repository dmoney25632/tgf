import type { MapDef } from "../MapLoader";
import { HOUSES } from "../maps/brennhollow";
import { PLAZA as MA_PLAZA, COURT as MA_COURT, ROADS_X as MA_ROADS_X, ROADS_Z as MA_ROADS_Z, HALF as MA_HALF } from "../maps/morroAzul";
import { TRUCK_LOOP, FENCE as GW_FENCE, RIVER as GW_RIVER, BOUNDS as GW_BOUNDS } from "../maps/greywater";
import { BOUNDS as IC_BOUNDS, YARD as IC_YARD } from "../maps/ironCrossing";
import { CRANE, PANS, TOWER as SG_TOWER, CONVEYOR } from "../maps/saltpanGantry";

/**
 * Ground features the box list doesn't carry (roads, plazas, water and the
 * roofs of dressing-drawn houses), for the map overview. Roads are drawn by
 * each map's dressing from closures, so their centre lines are restated
 * here from the same constants where the map exports them. Keep in step with
 * world/dressing/* when a road moves.
 */
export type OverviewRoad = { pts: [number, number][]; w: number; paved?: boolean };
export type OverviewArea = { x0: number; x1: number; z0: number; z1: number; kind: "paved" | "yard" | "water" | "field" };
export type OverviewBuilding = { x0: number; x1: number; z0: number; z1: number; h: number; color?: number };
export type OverviewFeatures = { roads: OverviewRoad[]; areas: OverviewArea[]; buildings: OverviewBuilding[] };

const EMPTY: OverviewFeatures = { roads: [], areas: [], buildings: [] };

/** Brennhollow lanes (dressing/brennhollow.ts ROADS). */
const BH_ROADS: OverviewRoad[] = [
  { pts: [[-160, 6], [-90, 4], [-48, 2.5], [-12, 2.5]], w: 8.5, paved: true },
  { pts: [[12, -0.8], [48, -0.8], [90, -3], [170, -8]], w: 7.5, paved: true },
  { pts: [[0.5, 10], [0.5, 30], [0.6, 48], [-3, 70], [-14, 120]], w: 6.5 },
  { pts: [[-11, -12], [-11, -30], [-11, -48], [-16, -80]], w: 7 },
  { pts: [[12, -12], [12, -44]], w: 3.6 },
  { pts: [[8, -16.2], [36, -16.2], [44, -18]], w: 3.2 },
  { pts: [[-13, -14.5], [-30, -13], [-46, -12]], w: 3.6 },
  { pts: [[24, 2], [26.5, 18], [34, 27], [38, 46]], w: 3.4 },
  { pts: [[-14, 6], [-28, 19], [-29, 30], [-28, 48]], w: 3.2 },
  { pts: [[24.7, -18], [24.7, -25]], w: 2.6 },
];

const FEATURES: Record<string, () => OverviewFeatures> = {
  brennhollow: () => ({
    roads: BH_ROADS,
    areas: [{ x0: -12, x1: 12, z0: -12.5, z1: 10, kind: "paved" }],
    // Houses are drawn by the dressing; their walls are colliders, the roofs aren't.
    buildings: HOUSES.filter((h) => h.roof).map((h) => ({ x0: h.x0, x1: h.x1, z0: h.z0, z1: h.z1, h: h.floors * h.fh + 1.5, color: h.tint })),
  }),
  "morro-azul": () => {
    const roads: OverviewRoad[] = [];
    for (const [x, hw] of MA_ROADS_X) roads.push({ pts: [[x, -MA_HALF], [x, MA_HALF]], w: hw * 2, paved: hw > 3 });
    for (const [z, hw] of MA_ROADS_Z) roads.push({ pts: [[-MA_HALF, z], [MA_HALF, z]], w: hw * 2, paved: hw > 3 });
    return { roads, areas: [{ ...MA_PLAZA, kind: "paved" }, { ...MA_COURT, kind: "yard" }], buildings: [] };
  },
  "dustfall-outpost": () => ({
    roads: [
      { pts: [[-220, -74], [220, -74]], w: 7.5, paved: true },
      { pts: [[0, -74], [0, -40]], w: 4 },
    ],
    areas: [],
    buildings: [],
  }),
  "cinder-flats": () => ({
    roads: [
      { pts: [[0, -46], [0, 46]], w: 5.4 },
      { pts: [[-46, 0], [46, 0]], w: 5.4 },
    ],
    areas: [],
    buildings: [],
  }),
  "saltpan-gantry": () => ({
    roads: [
      { pts: [[1, SG_TOWER.z], [1, 48]], w: 6 },
      { pts: [[4, CONVEYOR.a[2] + 3.5], [46, CONVEYOR.a[2] + 3.5]], w: 5 },
      { pts: [[6, (CRANE.z0 + CRANE.z1) / 2], [46, (CRANE.z0 + CRANE.z1) / 2]], w: 7.5 },
      { pts: [[-46, 2], [-4, 2]], w: 5 },
      { pts: [[6, -24], [40, -24]], w: 5.4 },
    ],
    areas: [{ ...PANS, kind: "water" }],
    buildings: [],
  }),
  greywater: () => {
    const loop = TRUCK_LOOP.map((p) => [p.x, p.z] as [number, number]);
    loop.push(loop[0]);
    return {
      roads: [{ pts: loop, w: 6 }, { pts: [[0, GW_FENCE.z1 - 2], [0, GW_BOUNDS.z1]], w: 6, paved: true }],
      areas: [{ x0: GW_BOUNDS.x0, x1: GW_BOUNDS.x1, z0: GW_BOUNDS.z0 - 20, z1: GW_RIVER.bank, kind: "water" }],
      buildings: [],
    };
  },
  "iron-crossing": () => ({
    roads: [
      { pts: [[0, IC_BOUNDS.z0], [0, IC_BOUNDS.z1]], w: 10, paved: true },
      { pts: [[-46, 80], [46, 80]], w: 8 },
      { pts: [[-46, 128], [46, 128]], w: 8 },
    ],
    areas: [{ x0: IC_YARD.x - IC_YARD.r * 1.4, x1: IC_YARD.x + IC_YARD.r * 1.4, z0: IC_YARD.z - IC_YARD.r, z1: IC_YARD.z + IC_YARD.r, kind: "yard" }],
    buildings: [],
  }),
};

export function overviewFeatures(def: MapDef): OverviewFeatures {
  return FEATURES[def.id]?.() ?? EMPTY;
}
