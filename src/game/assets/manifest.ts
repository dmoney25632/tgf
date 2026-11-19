/**
 * Static asset manifest. Lists exactly which files exist under /public/assets
 * so the game never probes for missing files (no 404 spam). Every entry is
 * optional at runtime: if a listed file fails to load, the procedural
 * fallback stays in place.
 *
 * Layout (all CC0, see public/assets/CREDITS.md):
 *   /assets/textures/<id>/albedo.jpg   sRGB base colour
 *   /assets/textures/<id>/normal.jpg   tangent-space normal, OpenGL (+Y) convention
 *   /assets/textures/<id>/roughness.jpg
 *   /assets/textures/<id>/ao.jpg       optional
 *   /assets/hdri/<file>.hdr            equirectangular sky (Radiance HDR)
 *   /assets/models/<id>/<id>_1k.gltf   glTF + .bin + textures/ alongside
 *
 * To add a texture set: drop the files in, add an entry to TEXTURE_SETS and
 * point a semantic material at it in MATERIAL_TEXTURES. Removing an entry
 * reverts that material to its procedural texture.
 */

export const ASSET_BASE = "/assets";

export type TextureMapKind = "albedo" | "normal" | "roughness" | "ao";

export type TextureSetEntry = {
  /** Which maps exist on disk. */
  maps: readonly TextureMapKind[];
};

const FULL: readonly TextureMapKind[] = ["albedo", "normal", "roughness", "ao"];

export const TEXTURE_SETS: Record<string, TextureSetEntry> = {
  concrete_wall_008: { maps: FULL },
  dirty_concrete: { maps: FULL },
  brick_wall_006: { maps: FULL },
  corrugated_iron_02: { maps: FULL },
  rusty_metal_02: { maps: FULL },
  gravel_ground_01: { maps: FULL },
  brown_mud_leaves_01: { maps: FULL },
  weathered_planks: { maps: FULL },
  fabric044: { maps: ["albedo", "normal", "roughness"] },
  worn_plaster_wall: { maps: FULL },
  rough_plaster_brick_02: { maps: FULL },
  worn_asphalt: { maps: FULL },
  rubble: { maps: FULL },
  damaged_concrete_floor: { maps: FULL },
  rusty_corrugated_iron: { maps: FULL },
};

/**
 * Semantic material → texture set id (null = procedural only). Names are the
 * MaterialName values used by maps and the set-dressing code.
 */
export const MATERIAL_TEXTURES = {
  concrete: "concrete_wall_008",
  concrete_dirty: "dirty_concrete",
  brick: "brick_wall_006",
  metal_corrugated: "corrugated_iron_02",
  metal_painted: "rusty_metal_02",
  metal_rust: "rusty_metal_02",
  metal_dark: null,
  wood: "weathered_planks",
  sandbag: "fabric044",
  canvas: "fabric044",
  gravel: "gravel_ground_01",
  ground: "brown_mud_leaves_01",
  rock: null,
  bark: null,
  plain: null,
} as const satisfies Record<string, string | null>;

export type MaterialName = keyof typeof MATERIAL_TEXTURES;

/**
 * World-only materials built by world/WorldMaterials (not part of the shared
 * render MaterialLibrary). Photo-backed ones name their texture set here;
 * null = generated on a canvas at load time.
 */
export const EXTRA_MATERIAL_TEXTURES = {
  plaster: "worn_plaster_wall",
  plaster_damaged: "rough_plaster_brick_02",
  asphalt: "worn_asphalt",
  rubble: "rubble",
  concrete_broken: "damaged_concrete_floor",
  corrugated_rust: "rusty_corrugated_iron",
  cloth: null,
  chainlink: null,
  decal: null,
  frond: null,
  glow: null,
} as const satisfies Record<string, string | null>;

export type ExtraMaterialName = keyof typeof EXTRA_MATERIAL_TEXTURES;

/** Optional HDRI sky. Set to null to always use the procedural sky. */
export const HDRI: { file: string } | null = { file: "hdri/overcast_soil_puresky_2k.hdr" };

export type ModelId =
  | "wooden_crate_01"
  | "old_military_crate"
  | "ammo_box"
  | "Barrel_01"
  | "barrel_03"
  | "concrete_road_barrier_02"
  | "cement_bag"
  | "rock_07"
  | "rock_moss_set_01"
  | "shrub_03"
  | "fern_02"
  | "weed_plant_02"
  | "covered_car"
  | "old_tyre"
  | "trashbag"
  | "plastic_jerrycan"
  | "propane_tank"
  | "utility_box_01"
  | "rollershutter_door"
  | "steel_frame_shelves_01"
  | "metal_office_desk"
  | "plastic_monobloc_chair_01"
  | "hanging_industrial_lamp";

export type ModelEntry = {
  /** Path under ASSET_BASE. */
  file: string;
  /** Approx. triangle count of the whole file (budgeting). */
  tris: number;
  /**
   * "whole": the file is one prop (node transforms baked together).
   * "nodes": each top-level node is a separate variant (plant/rock sets).
   */
  variants: "whole" | "nodes";
  castShadow: boolean;
};

const model = (id: ModelId, tris: number, variants: ModelEntry["variants"], castShadow = true): ModelEntry => ({
  file: `models/${id}/${id}_1k.gltf`,
  tris,
  variants,
  castShadow,
});

export const MODELS: Record<ModelId, ModelEntry> = {
  wooden_crate_01: model("wooden_crate_01", 6576, "whole"),
  old_military_crate: model("old_military_crate", 10476, "whole"),
  ammo_box: model("ammo_box", 4382, "whole", false),
  Barrel_01: model("Barrel_01", 2682, "whole"),
  barrel_03: model("barrel_03", 1473, "whole"),
  concrete_road_barrier_02: model("concrete_road_barrier_02", 23822, "whole"),
  cement_bag: model("cement_bag", 844, "whole"),
  rock_07: model("rock_07", 14844, "whole"),
  rock_moss_set_01: model("rock_moss_set_01", 63127, "nodes"),
  shrub_03: model("shrub_03", 8287, "nodes", false),
  fern_02: model("fern_02", 6232, "nodes", false),
  weed_plant_02: model("weed_plant_02", 11116, "nodes", false),
  covered_car: model("covered_car", 12592, "whole"),
  old_tyre: model("old_tyre", 2880, "whole"),
  trashbag: model("trashbag", 4482, "whole", false),
  plastic_jerrycan: model("plastic_jerrycan", 7348, "whole", false),
  propane_tank: model("propane_tank", 5238, "whole", false),
  utility_box_01: model("utility_box_01", 4404, "whole"),
  rollershutter_door: model("rollershutter_door", 552, "whole", false),
  steel_frame_shelves_01: model("steel_frame_shelves_01", 4348, "whole", false),
  metal_office_desk: model("metal_office_desk", 6898, "whole", false),
  plastic_monobloc_chair_01: model("plastic_monobloc_chair_01", 3356, "whole", false),
  hanging_industrial_lamp: model("hanging_industrial_lamp", 9530, "whole", false),
};

export const textureUrl = (set: string, kind: TextureMapKind) => `${ASSET_BASE}/textures/${set}/${kind}.jpg`;
export const assetUrl = (path: string) => `${ASSET_BASE}/${path}`;
