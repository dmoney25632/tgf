# Third-party assets

Everything in this folder is **CC0 (public domain)**. No attribution is required; sources are listed for provenance.

| Folder | Source | License |
|---|---|---|
| `textures/concrete_wall_008`, `dirty_concrete`, `brick_wall_006`, `corrugated_iron_02`, `rusty_metal_02`, `gravel_ground_01`, `brown_mud_leaves_01`, `weathered_planks` | [Poly Haven](https://polyhaven.com/textures) (1K JPG) | [CC0](https://polyhaven.com/license) |
| `textures/fabric044` | [ambientCG Fabric044](https://ambientcg.com/view?id=Fabric044) (1K JPG) | [CC0](https://docs.ambientcg.com/license/) |
| `hdri/kloofendal_48d_partly_cloudy_puresky_2k.hdr` | [Poly Haven](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky) | [CC0](https://polyhaven.com/license) |
| `models/*` (crates, ammo box, barrels, road barrier, cement bag, rocks, shrub, fern, weed plant) | [Poly Haven models](https://polyhaven.com/models) (1K glTF) | [CC0](https://polyhaven.com/license) |

Texture sets use `albedo.jpg`, `normal.jpg` (OpenGL convention), `roughness.jpg` and, where available, `ao.jpg`. `fabric044` has no AO map.

## Attribution-required assets (CC BY)

Unlike the table above, these assets are **not** CC0. Their licence requires attribution, which is given here and on the game's `/credits` page.

| Folder | Work | Author | License |
|---|---|---|---|
| `characters/head/` (`LeePerrySmith.glb`, `Map-COL.jpg`, `Map-SPEC.jpg`, `Infinite-Level_02_Tangent_SmoothUV.jpg`) | "Infinite, 3D Head Scan" of Lee Perry-Smith | [Infinite-Realities](http://www.ir-ltd.net/) (based on a work at triplegangers.com) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |

Gun models (first-person viewmodels):

| Folder | Work | Author | License |
|---|---|---|---|
| `weapons/m4a1/` (`model.gltf`, `model.bin`, textures) | "M4A1" | [TORI106](https://sketchfab.com/3d-models/m4a1-33107f38b23c45cc8103768c0e961cdf) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `weapons/akm/` (`model.gltf`, `model.bin`, textures) | "Ak47" | [wburton](https://sketchfab.com/3d-models/ak47-831519a097d84e079fd8bc4b15e5b57d) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `weapons/mp5/` (`model.gltf`, `model.bin`, textures) | "MP5 | PBR | High Poly" | [Stein Games](https://sketchfab.com/3d-models/mp5-pbr-high-poly-60ec470e41ff47368c792dd6caa74529) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `weapons/m1911/` (`model.gltf`, `model.bin`, textures) | "M1911 Handgun" | [SINNIK](https://sketchfab.com/3d-models/m1911-handgun-1f2209650c1d47cfb8d686ab99258409) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |

The gun models were obtained via the [FirstWave](https://github.com/moyzyy/FirstWave) project (commit `b4a5a01`); each folder keeps a `LICENSE.txt`. Changes: textures re-encoded from 2048 px PNG to 1024 px JPG; `m1911` effect meshes (muzzle fire, blend planes) removed. At runtime the models are re-oriented and scaled onto the procedural gun, the `akm` rig is baked to a static pose and its loose spare magazine dropped.

Obtained from the three.js repository (`examples/models/gltf/LeePerrySmith/`); the original licence text is kept as `characters/head/LeePerrySmith_License.txt`. Changes: the specular map was downscaled to 512 px; at runtime the bust is trimmed to head and neck, the albedo is re-tinted (skin tone, facial hair, painted eyes) and the head is fitted with procedurally modelled headgear.

## Environment additions (CC0)

| Folder | Source | License |
|---|---|---|
| `textures/worn_plaster_wall`, `rough_plaster_brick_02`, `rusty_corrugated_iron`, `worn_asphalt`, `rubble`, `damaged_concrete_floor` | [Poly Haven](https://polyhaven.com/textures) (1K JPG) | [CC0](https://polyhaven.com/license) |
| `models/covered_car`, `old_tyre`, `trashbag`, `plastic_jerrycan`, `propane_tank`, `utility_box_01`, `rollershutter_door`, `steel_frame_shelves_01`, `metal_office_desk`, `plastic_monobloc_chair_01`, `hanging_industrial_lamp` | [Poly Haven models](https://polyhaven.com/models) (1K glTF) | [CC0](https://polyhaven.com/license) |

## Map detail additions (CC0)

| Folder | Source | License |
|---|---|---|
| `models/plastic_crate_02`, `wooden_crate_02`, `Barrel_02`, `utility_box_02` | [Poly Haven models](https://polyhaven.com/models) (1K glTF; textures re-encoded to JPEG q80/q85 like `scripts/optimize-assets.sh`) | [CC0](https://polyhaven.com/license) |

The facade grime atlas (rain streaks, roof runs, rising damp, cracks, rust, algae, corner dirt) is painted procedurally on a canvas at load time (`src/game/world/architecture/grime.ts`); it uses no third-party images.

## Motion-captured soldiers (MIT + CC0)

Enemies and AI squadmates on the Medium / High presets. Licence texts are kept in `characters/soldiers/LICENSE.txt`.

| Folder | Work | Author | License |
|---|---|---|---|
| `characters/soldiers/` (`soldier_a/b/c.glb`, `soldier_*_color*.jpg`, `soldier_*_normal.jpg`, `soldier_*_orm.jpg`) | Microsoft Rocketbox avatars `Military_Male_01`, `_03`, `_04` | [Microsoft](https://github.com/microsoft/Microsoft-Rocketbox) | [MIT](https://github.com/microsoft/Microsoft-Rocketbox/blob/master/LICENSE.md) (attribution: copyright notice kept) |
| `characters/soldiers/anims.glb`, `soldiers.json` | Universal Animation Library [Standard] | [Quaternius](https://quaternius.com/packs/universalanimationlibrary.html) | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) |

Changes: FBX converted to metre-scale glTF, facial bones folded into the head, the knife removed, each avatar's four texture sets packed into one atlas (2048 px colour plus a 1024 px variant, 1024 px normal), the specular map turned into a roughness channel plus a team-tint mask, and a simplified LOD (~4.4k triangles) added. Animations (idle, walk, jog, sprint, crouch idle / walk, hit reacts, Death01, a finger grip) were retargeted onto the Rocketbox Biped skeleton and resampled at 30 fps. At runtime the camouflage is re-tinted per team and the arms are solved onto the game's own rifle.
