import { ENEMIES, type EnemyType } from "../survival/config";
import { WEAPONS, type WeaponId } from "../weapons/weapons";
import { DUSTFALL_OUTPOST } from "../world/maps/dustfallOutpost";
import { SALTPAN_GANTRY } from "../world/maps/saltpanGantry";
import { BRENNHOLLOW } from "../world/maps/brennhollow";
import { MORRO_AZUL } from "../world/maps/morroAzul";
import type { MapDef } from "../world/MapLoader";
import { getMission } from "../missions/campaign";
import { getMap } from "../world/maps/registry";

/** Wire tables: both peers run the same build, so key order is shared. */
export const ENEMY_TYPES = Object.keys(ENEMIES) as EnemyType[];
export const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];

export const enemyTypeIndex = (t: string) => Math.max(0, ENEMY_TYPES.indexOf(t as EnemyType));
export const weaponIndex = (id: string) => Math.max(0, WEAPON_IDS.indexOf(id as WeaponId));

/** Maps that support co-op survival (need a survival layout). */
export const COOP_MAPS: MapDef[] = [DUSTFALL_OUTPOST, SALTPAN_GANTRY, BRENNHOLLOW, MORRO_AZUL].filter((m) => m.survival);
export const coopMap = (id: string) => COOP_MAPS.find((m) => m.id === id) ?? COOP_MAPS[0];

/**
 * Missions playable in co-op: everything except escorts (the VIP is a host-side
 * AI squadmate that clients don't replicate).
 */
export const coopMission = (id: string | undefined) => {
  const m = id ? getMission(id) : undefined;
  return m && !m.objectives.some((o) => o.kind === "escort") ? m : undefined;
};
/** Map for a co-op room: the mission's map, else the survival map. */
export const coopRoomMap = (mapId: string, missionId?: string) => {
  const m = coopMission(missionId);
  return (m && getMap(m.mapId)) || coopMap(mapId);
};
