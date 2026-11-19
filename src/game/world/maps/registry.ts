import type { MapDef } from "../MapLoader";
import { DUSTFALL_OUTPOST } from "./dustfallOutpost";
import { CINDER_FLATS } from "./cinderFlats";
import { KESTREL_YARD } from "./kestrelYard";

/** Lobby / mission metadata for a playable map. */
export type MapEntry = { id: string; name: string; blurb: string; survival: boolean; def: MapDef };

/**
 * Map registry: every playable map by id. Survival maps (with a
 * `survival` layout) appear in the lobby's map select; missions refer to
 * maps by id. Add new maps here.
 */
export const MAPS: MapEntry[] = [
  { id: DUSTFALL_OUTPOST.id, name: DUSTFALL_OUTPOST.name, blurb: "Walled farm outpost under grey skies. Tight gates, a watchtower and a container stack.", survival: true, def: DUSTFALL_OUTPOST },
  { id: CINDER_FLATS.id, name: CINDER_FLATS.name, blurb: "Desert oil-field yard: tank farm, pump jacks and pipe runs around a control shack. Long lanes, low cover.", survival: true, def: CINDER_FLATS },
  { id: KESTREL_YARD.id, name: KESTREL_YARD.name, blurb: "Walled training yard and firing range.", survival: false, def: KESTREL_YARD },
];

export const SURVIVAL_MAPS = MAPS.filter((m) => m.survival);

export function getMap(id: string | undefined): MapDef | undefined {
  return id ? MAPS.find((m) => m.id === id)?.def : undefined;
}
