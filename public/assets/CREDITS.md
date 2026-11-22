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

## More first-person gun models

| Folder | Work | Author | License |
|---|---|---|---|
| `weapons/m24/` | "M24 Bounty Hunter Sniper Rifle" | [Naudaff3D](https://sketchfab.com/3d-models/m24-bounty-hunter-sniper-rifle-d40e74e2259549f5b025807163f1028c) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `weapons/svd/` | "Dragunov SVD" | [Vintar](https://sketchfab.com/3d-models/dragunov-svd-e3520e52a0d547b6b7c7ff2726161702) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `weapons/r870/` | "Remington870 Shotgun" | [Trip (Triptonic)](https://sketchfab.com/3d-models/remington870-shotgun-a4852997660a43839c30e36dfca5a3e7) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `weapons/m249/` | "M249 Machine Gun" | [Kendrick Russell (Buce)](https://sketchfab.com/3d-models/m249-machine-gun-bf0105376a2d4c37926f3ce95316460d) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `weapons/sw629/` | "357 Python Revolver (Rigged)" | [Erai (Khosro3D)](https://sketchfab.com/3d-models/357-python-revolver-rigged-3b81c991e9c84236a5c03895f9ca0aa3) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `weapons/m9/` | "Service Pistol" | [Mateusz Sadek, Poly Haven](https://polyhaven.com/a/service_pistol) | [CC0](https://polyhaven.com/license) |

Each folder holds `model.gltf`, `model.bin`, JPG textures and a `LICENSE.txt`.

The Sketchfab models came from open-source game repositories that redistribute them:

- M24: 317gw/HYPERLUNATIC
- SVD: ZHe-testName/StalkerCV
- Remington 870: Noureddine-Hci/RevenantOps
- M249: Yni-Viar/scp-continued-path (that copy's meshes were already merged)
- Python: Haruluya/Rock-sugar

Each model's licence was checked against the Sketchfab API.

Changes to the files:

- Textures re-encoded as JPG at 1024 px or less. The SVD's are 512 px, converted from AVIF.
- The Python revolver's speedloader and loose cases removed, and its rig baked to a static pose.
- The Service Pistol's alternate variant, loaded magazine and loose round removed.

At runtime each model is re-oriented, scaled and fitted onto the procedural gun. Its magazine, pump or slide is split off to animate, and the Service Pistol's magazine is seated in the grip.

## First-person gun models, third batch (CC BY 4.0)

| Folder | Work | Author | License |
|---|---|---|---|
| `weapons/hk416/` | "HK 416 A7 (free download)" | [r4m](https://sketchfab.com/3d-models/hk-416-a7-free-download-a16768f0ffa24737a4fe324a411cfbd9) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `weapons/g17/` | "G18" | [IVA (dxmhl)](https://sketchfab.com/3d-models/g18-fdd5cdd7b31c49f2b16a868ebdf4a75f) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `weapons/g36/` | "G36 with attachments" | [Kelisei Ventura (frankestudios71)](https://sketchfab.com/3d-models/g36-with-attachments-de744d8804ce4231ba3c76f791980832) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `weapons/pkm/` | "PKP_pecheneg" | [chipmunkman](https://sketchfab.com/3d-models/pkp-pecheneg-ee7b308b1a7d45479776aa1ca57faf0f) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `weapons/m1014/` | "Shotgun BENELLI M4 Super 90 14\"" | [drcrazzie](https://sketchfab.com/3d-models/shotgun-benelli-m4-super-90-14-a4cb85ebf36c40f9af47dd3e38d340a2) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |

Each folder holds `model.gltf`, `model.bin`, JPG textures and a `LICENSE.txt`. Each licence was checked against the Sketchfab API.

Sources:

- HK416: Patriqu/CosmicFPSLibgdx (the original Sketchfab export).
- G18, used for the Glock 17: OpenSCCT/OpenSCCT (the original export).
- G36, PKP and Benelli: birkmann/zugriff, which ships processed copies (decimated, magazine split off, 512 px textures, the PKP's optic removed) under the original licences.

Changes to the files:

- Textures re-encoded as JPG at 1024 px or less.
- HK416: the spare magazine and loose rounds removed.
- G18: the loose round removed.
- G36: the rail red dot removed.
- PKP: the leftover optic side mount removed.

At runtime the G18's rig is baked to a static pose. The models are fitted onto the procedural gun the same way as the batches above.

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
| `characters/soldiers/` (`soldier_<a-h>.gltf/.bin`, `soldier_*_color*`, `soldier_*_normal.*`, `soldier_*_orm.*`) | Microsoft Rocketbox avatars `Military_Male_01` to `_06`, `Military_Female_01`, `_02` | [Microsoft](https://github.com/microsoft/Microsoft-Rocketbox) | [MIT](https://github.com/microsoft/Microsoft-Rocketbox/blob/master/LICENSE.md) (attribution: copyright notice kept) |
| `characters/fparms/` (`fparms.gltf`, `fparms.bin`, `fparms_color/normal/orm.jpg` + `.ktx2`) | First-person arms cut from Microsoft Rocketbox `Military_Male_01` | [Microsoft](https://github.com/microsoft/Microsoft-Rocketbox) | [MIT](https://github.com/microsoft/Microsoft-Rocketbox/blob/master/LICENSE.md) (attribution: copyright notice kept) |
| `characters/soldiers/anims.glb`, `soldiers.json` | Universal Animation Library [Standard] | [Quaternius](https://quaternius.com/packs/universalanimationlibrary.html) | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) |

Changes: FBX converted to metre-scale glTF, facial bones folded into the head, the knife removed, each avatar split into swappable parts (body, head, helmet, equipment) with simplified LODs, its four texture sets packed into one atlas (2048 px colour plus a 1024 px variant, 1024 px normal), the specular map turned into a roughness channel plus team-tint and skin masks, beard / eye-band masks added to the heads; meshopt + KTX2 compressed. At runtime soldiers mix one avatar's uniform with another's face and helmet, re-tint skin, add facial hair, balaclavas and procedural kit (boonie, goggles, packs, radios, pouches, knee pads, ghillie, plates). Animations (idle, walk, jog, sprint, crouch idle / walk, hit reacts, Death01, a finger grip) were retargeted onto the Rocketbox Biped skeleton and resampled at 30 fps. At runtime the camouflage is re-tinted per team and the arms are solved onto the game's own rifle.

First-person arms (`characters/fparms/`, built by `scripts/fparms/build.mjs`): the sleeves and gloved hands of `Military_Male_01` cut out of the body, smoothed (two PN-triangle subdivisions) and re-simplified to 16k triangles, re-rigged onto a 53-bone two-arm skeleton (three forearm twist bones, three bones plus a tip per finger), and the textures cropped to the arms (2048×1024 colour and normal, 1024×512 ORM with a glove mask). The albedo is normalised per region and re-tinted from the player's operator colours at runtime.
