import type { MapDef } from "../MapLoader";
import { DUSTFALL_OUTPOST } from "./dustfallOutpost";
import { CINDER_FLATS } from "./cinderFlats";
import { KESTREL_YARD } from "./kestrelYard";
import { SALTPAN_GANTRY } from "./saltpanGantry";
import { BRENNHOLLOW } from "./brennhollow";
import { MORRO_AZUL } from "./morroAzul";

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
  { id: SALTPAN_GANTRY.id, name: SALTPAN_GANTRY.name, blurb: "Sun-baked gravel works around a towering rusted gantry. Climb the conveyor ramp for the high ground; containers and silos below.", survival: true, def: SALTPAN_GANTRY },
  { id: BRENNHOLLOW.id, name: BRENNHOLLOW.name, blurb: "Shelled hillside village: stone houses, a statue square and a burning manor. Tight streets, gardens and courtyards.", survival: true, def: BRENNHOLLOW },
  { id: MORRO_AZUL.id, name: MORRO_AZUL.name, blurb: "Huge hillside favela: stacked brick houses up to five storeys, rooftop firefights, narrow becos, a walled futsal court. Climb inside for the high ground.", survival: true, def: MORRO_AZUL },
  { id: KESTREL_YARD.id, name: KESTREL_YARD.name, blurb: "Walled training yard and firing range.", survival: false, def: KESTREL_YARD },
];

export const SURVIVAL_MAPS = MAPS.filter((m) => m.survival);

export function getMap(id: string | undefined): MapDef | undefined {
  return id ? MAPS.find((m) => m.id === id)?.def : undefined;
}
