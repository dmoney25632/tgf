# Third-party assets

Everything in this folder is **CC0 (public domain)**. No attribution is required; sources are listed for provenance.

| Folder | Source | License |
|---|---|---|
| `textures/concrete_wall_008`, `dirty_concrete`, `brick_wall_006`, `corrugated_iron_02`, `rusty_metal_02`, `gravel_ground_01`, `brown_mud_leaves_01`, `weathered_planks` | [Poly Haven](https://polyhaven.com/textures) (1K JPG) | [CC0](https://polyhaven.com/license) |
| `textures/fabric044` | [ambientCG Fabric044](https://ambientcg.com/view?id=Fabric044) (1K JPG) | [CC0](https://docs.ambientcg.com/license/) |
| `hdri/overcast_soil_puresky_2k.hdr` | [Poly Haven](https://polyhaven.com/a/overcast_soil_puresky) | [CC0](https://polyhaven.com/license) |
| `models/*` (crates, ammo box, barrels, road barrier, cement bag, rocks, shrub, fern, weed plant) | [Poly Haven models](https://polyhaven.com/models) (1K glTF) | [CC0](https://polyhaven.com/license) |

Texture sets use `albedo.jpg`, `normal.jpg` (OpenGL convention), `roughness.jpg` and, where available, `ao.jpg`. `fabric044` has no AO map.

## Attribution-required assets (CC BY)

Unlike the table above, these assets are **not** CC0. Their licence requires attribution, which is given here and on the game's `/credits` page.

| Folder | Work | Author | License |
|---|---|---|---|
| `characters/head/` (`LeePerrySmith.glb`, `Map-COL.jpg`, `Map-SPEC.jpg`, `Infinite-Level_02_Tangent_SmoothUV.jpg`) | "Infinite, 3D Head Scan" of Lee Perry-Smith | [Infinite-Realities](http://www.ir-ltd.net/) (based on a work at triplegangers.com) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |

Obtained from the three.js repository (`examples/models/gltf/LeePerrySmith/`); the original licence text is kept as `characters/head/LeePerrySmith_License.txt`. Changes: the specular map was downscaled to 512 px; at runtime the bust is trimmed to head and neck, the albedo is re-tinted (skin tone, facial hair, painted eyes) and the head is fitted with procedurally modelled headgear.

## Environment additions (CC0)

| Folder | Source | License |
|---|---|---|
| `textures/worn_plaster_wall`, `rough_plaster_brick_02`, `rusty_corrugated_iron`, `worn_asphalt`, `rubble`, `damaged_concrete_floor` | [Poly Haven](https://polyhaven.com/textures) (1K JPG) | [CC0](https://polyhaven.com/license) |
| `models/covered_car`, `old_tyre`, `trashbag`, `plastic_jerrycan`, `propane_tank`, `utility_box_01`, `rollershutter_door`, `steel_frame_shelves_01`, `metal_office_desk`, `plastic_monobloc_chair_01`, `hanging_industrial_lamp` | [Poly Haven models](https://polyhaven.com/models) (1K glTF) | [CC0](https://polyhaven.com/license) |
