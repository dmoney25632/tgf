import { ENEMIES, type EnemyType } from "../survival/config";
import { WEAPONS, type WeaponId } from "../weapons/weapons";
import { DUSTFALL_OUTPOST } from "../world/maps/dustfallOutpost";
import { SALTPAN_GANTRY } from "../world/maps/saltpanGantry";
import { BRENNHOLLOW } from "../world/maps/brennhollow";
import { MORRO_AZUL } from "../world/maps/morroAzul";
import type { MapDef } from "../world/MapLoader";

/** Wire tables: both peers run the same build, so key order is shared. */
export const ENEMY_TYPES = Object.keys(ENEMIES) as EnemyType[];
export const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];

export const enemyTypeIndex = (t: string) => Math.max(0, ENEMY_TYPES.indexOf(t as EnemyType));
export const weaponIndex = (id: string) => Math.max(0, WEAPON_IDS.indexOf(id as WeaponId));

/** Maps that support co-op survival (need a survival layout). */
export const COOP_MAPS: MapDef[] = [DUSTFALL_OUTPOST, SALTPAN_GANTRY, BRENNHOLLOW, MORRO_AZUL].filter((m) => m.survival);
export const coopMap = (id: string) => COOP_MAPS.find((m) => m.id === id) ?? COOP_MAPS[0];
