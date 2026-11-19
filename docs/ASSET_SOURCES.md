# Iron Horizon: asset sources, licenses and web delivery

Research date: 2026-11-19. This is a practical guide, not legal advice. Re-check a source's license page on the day you download from it, and record the URL, author, license and date in `public/assets/CREDITS.md`.

**Where we are now:** the repo already ships Poly Haven and ambientCG CC0 textures, a Poly Haven HDRI and Poly Haven glTF models, plus the CC BY 3.0 Lee Perry-Smith head scan (credited in `CREDITS.md` and on `/credits`). The current footprint is about 38 MB of textures, 42 MB of models and 4.4 MB of HDRI, all as JPG/PNG inside plain glTF, with no GPU texture compression and no geometry compression.

**The one rule that matters for a web game:** every file we ship is publicly downloadable from DevTools or the CDN URL, in effectively raw form. Licenses that allow "use inside a game, but no redistribution of the raw asset" are risky for us even when they are fine for a packaged desktop game. Prefer CC0 first, CC BY second (with credit), and treat everything else as "do not ship" unless we get written permission.

---

## 1. License table

| Source | License | Attribution needed | Login needed to download | OK for our public web game | Notes |
|---|---|---|---|---|---|
| [Poly Haven](https://polyhaven.com/license) (textures, HDRIs, models) | CC0 | No | No | **Yes** | The license page explicitly allows redistribution and use in commercial products. It also has a public API with file sizes (`api.polyhaven.com`). Our first choice. |
| [ambientCG](https://docs.ambientcg.com/license/) (textures, HDRIs, some models) | CC0 | No (suggested credit line offered) | No | **Yes** | The license page explicitly allows "raw files in a project such as a video game". |
| [cgbookcase](https://www.cgbookcase.com/textures) | CC0 1.0 | No | No (Patreon only for bulk downloads) | **Yes** | About 580 textures, including road markings, leaves and grunge overlays. Its license URL moved (the old `/license` page returns 404). Each texture page carries a "cc0 texture" label. |
| [3DTextures.me](https://3dtextures.me/about) | CC0 | No | No | **Yes** | The FAQ says: "You can redistribute them". The only restriction is that you cannot claim to be the author. Some downloads go through Google Drive. |
| [TextureCan](https://www.texturecan.com/terms/) | CC0 1.0 | No | No | **Yes, with a check** | The terms warn that textures may contain logos or brand names, and say avoiding them is the user's responsibility. Inspect each texture before shipping it. |
| [Texture Ninja](https://texture-ninja.com) | CC0 (photos) | No | No | **Yes** | These are raw reference photos (about 5,000). They need tiling and PBR map generation before use. The site is no longer being expanded. |
| [ShareTextures](https://www.sharetextures.com/p/license) | "Custom CC0 with restrictions" | No | No | **No / ask first** | The page states: "No asset redistribution on other websites, in plugins, or as part of collections without our written permission", and that CC0 applies only to direct downloads. Serving the files publicly from our CDN is a gray area, so email the site before using them. |
| [Textures.com](https://www.textures.com/about/terms-of-use) free tier | Proprietary, royalty-free | No | **Yes** (free account, limited daily credits) | **No** | Allowed inside games, but its terms ban distributing the content "alone or in a texture pack". In a web game the raw JPGs are exposed, and only one free account per person is allowed. Avoid. |
| [Quixel Megascans / Fab](https://www.fab.com/cla) | Fab Standard License (EULA) | No | **Yes** (Epic account) | **No (high risk)** | Megascans became free on Fab again in Nov 2026. The license allows distributing "Projects with the Fab assets incorporated" but forbids redistributing assets "on a standalone basis". A web game serves each texture and mesh as a separately fetchable file, which looks like standalone redistribution of the source format. Do not use without Epic's written confirmation. |
| [Sketchfab](https://sketchfab.com/licenses) | Per model: CC0, CC BY, CC BY-SA, CC BY-NC, CC BY-ND, Standard/Editorial (paid) | Yes for anything except CC0 | **Yes** (free account; the Download API also needs OAuth) | **CC0 and CC BY only** | Filter by license. Reject NC (non-commercial, which rules out a future paid build), ND (no changes, but we must retarget and compress) and SA (share-alike spreads to derivatives). Expect mislabeled uploads, such as models ripped from commercial games and labeled CC BY. Vet each one (see Risks). |
| [Kenney](https://kenney.nl/support) | CC0 | No | No | **Yes** | Stylized low-poly, so it does not suit a photoreal look. Useful for greybox blockouts, UI icons and placeholders. |
| [Quaternius](https://quaternius.com) | CC0 | No | No (itch.io, pay what you want) | **Yes** | Models are stylized (Universal Base Characters average about 13k triangles). The **Universal Animation Library 1 and 2** are the valuable part: CC0, 250+ humanoid clips, glTF/FBX, with a rig built for retargeting. |
| [Smithsonian Open Access 3D](https://3d.si.edu/cc0) | CC0 on items marked CC0; "Usage conditions apply" on others | No for CC0 items | No | **Yes, CC0-marked items only** | Most of the roughly 3,800 3D items are CC0. Non-CC0 items need written permission for commercial use. Content is museum objects (some aircraft, vehicles and artifacts), mostly high-poly scans that need decimating. |
| [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets) | Per asset (CC BY 4.0, CC0, some proprietary terms); see each model's README | Usually | No | **Per asset** | These are test and showcase models, not game content. Useful for testing KTX2 and meshopt (for example the `*-KTX2` and meshopt variants). Five assets are flagged for possible removal. |
| [OpenGameArt](https://opengameart.org/content/faq) | Per asset: CC0, CC BY, OGA-BY, CC BY-SA, GPL, LGPL | Depends | No | **CC0 / CC BY / OGA-BY only** | Avoid GPL and CC BY-SA for art we want to keep proprietary. Realistic military content is thin. |
| [MakeHuman / MPFB 2](https://static.makehumancommunity.org/about/license.html) | Code: AGPL/GPL. Bundled assets **and exported models: CC0** | No | No | **Yes** | The official FAQ says exported models are CC0 and usable in closed-source games. The GPL covers the tool, not our exports. This is our best route to realistic soldier bodies. |
| [CMU Graphics Lab Motion Capture DB](http://mocap.cs.cmu.edu) | Custom: "free for all uses" | Requested (cite CMU and NSF EIA-0196217) | No | **Yes** | Commercial products may include it, but the raw data may not be resold. Some mirrors are **stricter**: the 4TU FBX conversion is CC BY-NC 4.0, so do not use that copy. The data is raw (foot sliding, jitter) and needs cleanup and retargeting. |
| [Mixamo](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html) | Adobe terms, royalty-free | No | **Yes** (Adobe ID) | **Avoid** | Allowed royalty-free in games, but distributing the **raw character and animation files** is not allowed. A web game serves them as fetchable GLBs, which is the same exposure problem as Fab. The service is also in maintenance mode. |
| Ready Player Me | n/a | n/a | n/a | **No, the service is gone** | Netflix acquired it in Dec 2025, and the public creator and APIs shut down on 31 Jan 2026. Do not build on it. |
| Lee Perry-Smith head (already in the repo) | CC BY 3.0 (Infinite-Realities) | **Yes** (already given) | No | **Yes** | Keep `LeePerrySmith_License.txt` and the `/credits` entry. |

Free alternatives to Mixamo: Quaternius UAL 1 and 2 (CC0, retargetable rig), CMU mocap retargeted in Blender, and Blender's own retargeting tools (or the Rokoko Blender add-on) to put clips onto an MPFB skeleton. We must still check the license of every clip we retarget.

---

## 2. Copied iconic maps: not allowed

**Question:** can we rebuild a famous small desert oil-rig yard map from a big shooter franchise?
**Answer: No.**

- **Copyright.** A game level is protected expression: its specific layout, sightlines, structure placement, prop arrangement and art. Courts have held that unauthorized new levels for an existing game are infringing derivative works (*Micro Star v. FormGen*, 9th Cir. 1998). Near-identical clones have lost (*Tetris Holding v. Xio*, 2012). Rebuilding it with our own CC0 assets does not help, because the infringement is in the layout and composition, not the source files.
- **Trademark and unfair competition.** The map's name and recognizable silhouette are tied to the franchise. Using them to attract players invites a false-association claim.
- **EULA.** Extracting geometry or tracing overhead captures from the game breaches its license on top of the copyright problem.
- **What *is* free to use:** ideas and genre conventions (scènes à faire). Examples are a small arena on desert industry, a central elevated vantage point, and crates and containers used as cover. Copyright filters these out. So build from a fresh blockout with our own name, layout, landmark and lane structure. Never start from an overhead image of the original, and do not reuse its name or its signature central-tower silhouette.

---

## 3. Two original map briefs

### Map A: "Saltpan Station" (desert oil-field service yard)
**Fantasy:** a remote pumping and separation station on a dry salt pan at late afternoon. It is small and fast-paced (about 70 x 55 m playable), for 6v6.

- **Landmark:** a **gas-separation skid** of horizontal tanks and a flare stack, offset to the north-east corner, with a catwalk you can reach by a ladder only. It is a risky power position, not a central tower.
- **Layout:** three lanes.
  - **West:** a **pipe trench**, a sunken 1.5 m channel along buried flowlines. It gives crouch cover and is a flanking route.
  - **Middle:** an open **pad** with two working **pumpjacks**, which move and so make moving cover. Sandbagged wellheads and an overturned pipe rack sit between them.
  - **East:** a **truck loading rack** with a tanker trailer and stacked shipping containers that form a short maze.
- **Spawns:** at the south gatehouse (a chain-link perimeter with a security light) and the north **control shack** (two rooms with a roller-shutter door).
- **Verticality:** the separator catwalk, the container tops (reached by one crate stack) and the control-shack roof. There is no single dominant tower.
- **Light and sky:** a clear, harsh sun, with long shadows from the flare stack and heat haze from the flare.

**Asset list (all CC0 unless marked CC BY):**
- **Sky/IBL:** Poly Haven `goegap` (desert, clear, high contrast) or `kloofendal_43d_clear_puresky`. Use `rogland_sunset` for a dusk variant.
- **Ground:** `dry_ground_01`, `aerial_sand`, `sandy_gravel`, plus cgbookcase road markings for the access road. Blend them with a vertex-colour or splat mask.
- **Hard surfaces:** `cracked_concrete` (pads), `rusty_metal_sheet` and our existing `rusty_corrugated_iron` (sheds), Poly Haven `container_side` (container material).
- **Industrial kit (Poly Haven):** `modular_industrial_pipes_01`, `modular_pipes`, `small_lpg_tank`, `propane_tank` (already in the repo), `portable_generator`, `flood_lights`, `modular_chainlink_fence`, `modular_electricity_poles`, `overhead_crane`, `barrel_03`, `metal_jerrycan_green`, `old_military_crate`, `wooden_military_crate`, `security_light`, `exterior_aircon_unit`, `concrete_road_barrier_02`.
- **Rocks and flora:** `namaqualand_boulder_02` to `_06`, `quiver_tree_01`, `wild_rooibos_bush`.
- **CC BY (Sketchfab):** oil pump jack, large industrial storage tanks, shipping container, Ural 4320 truck (see shortlist).
- **Build ourselves:** the flare stack, separator skid shell, pipe racks and catwalk, made from primitives with the pipe and metal textures. These are simple shapes that are cheaper to make than to source.

### Map B: "Marrow Quay" (ruined coastal town)
**Fantasy:** a small stucco-and-sandstone fishing town on a hillside above a harbour, months after shelling. It is overcast or hazy morning light, medium-sized (about 110 x 80 m) for 8v8.

- **Landmark:** a **collapsed market hall** with a broken clock gable at mid-slope. Its rubble ramp creates a climbable route to the first floor.
- **Layout:** a slope with three terraces. The **lower quay** has a seawall, beached boats, crates, nets and a harbour crane stub. The **middle street** is a narrow lane with shopfronts, roller shutters and a burnt-out car. The **upper terrace** has a church square and stairs.
- **Connections:** stair alleys and one blown-out house you can walk through link the terraces. A rocky cliff path wraps the west edge as a long sightline. Breaks in the seawall let players drop down to the beach.
- **Spawns:** east beach / boatyard versus the upper church square.
- **Light and sky:** coastal haze, with the sea as a bright backdrop.

**Asset list:**
- **Sky/IBL:** Poly Haven `victoria_curve_02` or `simons_town_road` (coastal road, ocean). Use `blouberg_sunrise_1` for a dawn variant.
- **Walls:** `white_stucco`, `damaged_plaster`, `worn_cracked_plaster`, `seaworn_sandstone_brick`, `yellow_plaster`, plus our existing `worn_plaster_wall` and `rough_plaster_brick_02`.
- **Ground:** `coast_sand_01`, `cobblestone_floor_04` (or any `cobblestone_*`), `worn_asphalt` and `rubble` (both already in the repo).
- **Roofs:** `clay_roof_tiles`, `clay_roof_tiles_02`.
- **Shutters and doors:** `painted_metal_shutter`, `rusty_metal_shutter`, and the Poly Haven models `rollershutter_door` and `rollershutter_window_01` to `03`.
- **Street kit (Poly Haven `hidden_alley` collection):** `street_lamp_01` and `02`, `water_manhole_cover`, `metal_trash_can`, `modular_metal_gutter`, `modular_fire_escape`, `utility_box_02`, `modular_electricity_poles`, plus our existing `covered_car`, `old_tyre` and `trashbag`.
- **Coast:** `coastal_cliff_01`, `coast_rocks_01` to `05` and `sand_rocks_small_01`. These are heavy (15 to 22 MB at 1k), so decimate them and use them sparingly. Add `lifebuoy`, `life_jacket`, `ocean_buoy`, `wooden_crate_01` and `02`, `wooden_barrels_01`.
- **Boats:** Smithsonian / Scottish Maritime Museum CC0 boat scans (the "Venus" fourareen), plus a CC BY Sketchfab fishing boat.
- **Ruins (CC BY, Sketchfab):** a ruined buildings pack, a rubble pile photoscan and a crashed car. Build most houses ourselves as modular wall, floor and opening pieces with the plaster and sandstone textures, using decals for damage. That keeps the draw-call count and file size under control.

---

## 4. Top-30 shortlist

Sizes are the download sizes reported by each site's API on 2026-11-19:
- **Poly Haven model:** the full 1k glTF package (glTF, .bin and textures).
- **Poly Haven texture:** albedo, OpenGL normal and packed ARM map (AO, roughness, metalness) at 1k JPG.
- **Sketchfab:** the auto-converted GLB archive.

Expect 50 to 80% smaller files after the pipeline in section 5.

| # | Asset | For | Source / license | URL | Size | Notes |
|---|---|---|---|---|---|---|
| 1 | `goegap` HDRI | A | Poly Haven, CC0 | https://polyhaven.com/a/goegap | 1k 1.4 MB / 2k 5.4 MB | Desert, clear midday sky. Ship 2k for the sky and generate PMREM at runtime. |
| 2 | `kloofendal_43d_clear_puresky` HDRI | A | Poly Haven, CC0 | https://polyhaven.com/a/kloofendal_43d_clear_puresky | 1k 1.2 / 2k 4.6 MB | Pure sky with no ground, which suits a large terrain. |
| 3 | `victoria_curve_02` HDRI | B | Poly Haven, CC0 | https://polyhaven.com/a/victoria_curve_02 | 1k 1.6 / 2k 6.5 MB | Coastal road and ocean. `simons_town_road` (2k 6.2 MB) is the alternative. |
| 4 | `dry_ground_01` | A | Poly Haven, CC0 | https://polyhaven.com/a/dry_ground_01 | 1.0 MB | Main yard ground. |
| 5 | `aerial_sand` | A | Poly Haven, CC0 | https://polyhaven.com/a/aerial_sand | 1.3 MB | Large-scale sand layer. |
| 6 | `sandy_gravel` | A | Poly Haven, CC0 | https://polyhaven.com/a/sandy_gravel | 2.7 MB | Pads and roads. |
| 7 | `cracked_concrete` | A | Poly Haven, CC0 | https://polyhaven.com/a/cracked_concrete | 2.3 MB | Pump pads. |
| 8 | `rusty_metal_sheet` | A | Poly Haven, CC0 | https://polyhaven.com/a/rusty_metal_sheet | 1.9 MB | Tanks and skids. |
| 9 | `white_stucco` | B | Poly Haven, CC0 | https://polyhaven.com/a/white_stucco | 1.8 MB | Main house walls. |
| 10 | `damaged_plaster` | B | Poly Haven, CC0 | https://polyhaven.com/a/damaged_plaster | 2.4 MB | Shelled walls. |
| 11 | `seaworn_sandstone_brick` | B | Poly Haven, CC0 | https://polyhaven.com/a/seaworn_sandstone_brick | 2.1 MB | Seawall and quay. |
| 12 | `coast_sand_01` | B | Poly Haven, CC0 | https://polyhaven.com/a/coast_sand_01 | 2.8 MB | Beach. |
| 13 | `modular_industrial_pipes_01` | A | Poly Haven, CC0 | https://polyhaven.com/a/modular_industrial_pipes_01 | 4.8 MB (2k 16.6) | Pipe-rack kit. |
| 14 | `modular_pipes` | A | Poly Haven, CC0 | https://polyhaven.com/a/modular_pipes | 5.8 MB | Trench flowlines. |
| 15 | `small_lpg_tank` | A | Poly Haven, CC0 | https://polyhaven.com/a/small_lpg_tank | 2.8 MB | Cover prop. |
| 16 | `portable_generator` | A | Poly Haven, CC0 | https://polyhaven.com/a/portable_generator | 3.4 MB | |
| 17 | `flood_lights` | A | Poly Haven, CC0 | https://polyhaven.com/a/flood_lights | 6.9 MB | Can carry a real light. |
| 18 | `modular_chainlink_fence` | A, B | Poly Haven, CC0 | https://polyhaven.com/a/modular_chainlink_fence | 7.3 MB | Use alpha-tested material. |
| 19 | `modular_electricity_poles` | A, B | Poly Haven, CC0 | https://polyhaven.com/a/modular_electricity_poles | 12.4 MB | Shrink textures to 512 px. |
| 20 | `old_military_crate` and `wooden_military_crate` | A, B | Poly Haven, CC0 | https://polyhaven.com/a/old_military_crate, https://polyhaven.com/a/wooden_military_crate | 2.5 / 3.0 MB | |
| 21 | `namaqualand_boulder_02` (and `_03` to `_06`) | A | Poly Haven, CC0 | https://polyhaven.com/a/namaqualand_boulder_02 | 5.1 MB | Desert rocks. |
| 22 | `coastal_cliff_01` | B | Poly Haven, CC0 | https://polyhaven.com/a/coastal_cliff_01 | 15.4 MB | Decimate and use only one. |
| 23 | `street_lamp_01`, `water_manhole_cover`, `metal_trash_can` | B | Poly Haven, CC0 | https://polyhaven.com/a/street_lamp_01, https://polyhaven.com/a/water_manhole_cover, https://polyhaven.com/a/metal_trash_can | 2.2 / 2.3 / 5.0 MB | Street dressing. |
| 24 | Oil Pump Jack (bespalov) | A | Sketchfab, **CC BY** | https://sketchfab.com/3d-models/08f0fc1d37d74831912c7b9c59c84d5a | GLB 0.8 MB, 16.7k faces | Low-poly. Re-texture with `rusty_metal_sheet` and animate the beam in code. |
| 25 | Large Industrial Storage Tanks (duanesmind) | A | Sketchfab, **CC BY** | https://sketchfab.com/3d-models/bd3ac97071104b64bc388a155b64f79e | GLB 11.3 MB, 9.8k faces | Parts are separate objects, so it can be built into a tank farm. |
| 26 | Classic Shipping Container (Sebastian.Hamish.Webster) | A, B | Sketchfab, **CC BY** | https://sketchfab.com/3d-models/772f4be391a245f699c54e6cf157c58d | GLB 12.9 MB, 17k faces | Game-ready. Resize textures to 1k. |
| 27 | Ural 4320 truck (davidbroutian) | A | Sketchfab, **CC BY** | https://sketchfab.com/3d-models/f953c51a5dbc4a15949f4dcc0905c4e8 | GLB 4.4 MB, 8.5k faces | Static wreck or set dressing. Remove any badges. |
| 28 | Ruined buildings pack (tobiasherbers2) + Rubble Pile photoscan (GameDevNick) + Crashed Abandoned Car (rashad-brahimli) | B | Sketchfab, **CC BY** | https://sketchfab.com/3d-models/690edb7d64b84df7bfeee3b54746d6eb, https://sketchfab.com/3d-models/5986d1487d9443b883d67b121c2c903c, https://sketchfab.com/3d-models/66ef51a84c9843dda53bf0b4b9020011 | 6.5 / 25.3 / 51.3 MB | The ruins are background-quality, the rubble scan has 60k faces, and the car has 4K textures, so shrink it to 1k. |
| 29 | Bell UH-1H Huey and CH-47 Chinook (mgg8) | A, B | Sketchfab, **CC0** | https://sketchfab.com/3d-models/9cd1ffd586f248839bce6b11345bdec3, https://sketchfab.com/3d-models/ed278aac484d4b36b1d8e23844960795 | GLB 6.9 / 8.5 MB, 137k / 190k faces | These are the only realistic CC0 helicopters found. The author describes them as "procedural" models, so check quality closely. Decimate to under 30k triangles and use as flyby or static props. A CC BY fallback is the Sikorsky UH-60M (MirzaArrafiERV_45, https://sketchfab.com/3d-models/12b4e525676a49678ac3006b360c8750, 4.2 MB, 46k faces). |
| 30 | **Soldier stack:** MPFB 2 human (CC0 export) + Quaternius Universal Animation Library 1 and 2 (CC0) + Military Character Kit 1.1 (britdawgmasterfunk; the author's description says CC0, although Sketchfab shows CC BY) + Tactical Plate Carrier (txyrm70, CC BY) + Combat helmet K6-3 (shamanoff, CC BY) + CMU mocap clips | Soldiers | Mixed CC0 / CC BY | https://github.com/makehumancommunity/mpfb2, https://quaternius.com/packs/universalanimationlibrary.html, https://quaternius.com/packs/universalanimationlibrary2.html, https://sketchfab.com/3d-models/bf37b98b99534ed2b5eb4507f0564e1d, https://sketchfab.com/3d-models/3b51e6329dbb4b0aa14e43f12eb6c42a, https://sketchfab.com/3d-models/94701874d8b949718708b018c8d4f61d, http://mocap.cs.cmu.edu | Kit GLB 43.5 MB (1.4M faces, so take only the parts we need); vest 8.2 MB (3k faces); helmet 13.6 MB (4k faces); MPFB and UAL are small | Pipeline: build the body in MPFB with the game-engine skeleton, then retarget the UAL clips (locomotion, crouch, death, rifle poses) in Blender. Fill gaps such as rifle reloads from CMU. Attach the vest, helmet and pouches as rigid skinned parts. Keep the Lee Perry-Smith head as our face scan, or give MPFB faces painted detail. Credit the Military Character Kit as CC BY to be safe. |

Also worth looking at: Poly Haven `overhead_crane` (7.3 MB), `security_light`, `exterior_aircon_unit` and `concrete_road_barrier_02`; HMMWV M998A1 (42manako, CC BY, 4.3 MB, 20k faces, https://sketchfab.com/3d-models/ffbc4b053628413fb84acf5b89595d96); Low Poly T-72 (MrTheRich, CC BY, https://sketchfab.com/3d-models/8c9d0d6640a244e39082cd9fdf565cef); the Smithsonian CC0 aircraft at https://3d.si.edu/cc0 (decimate first).

**Vehicles and helicopters, in short:** realistic **CC0** vehicles are rare. The mgg8 aircraft set and the britdawgmasterfunk Military Landvehicle Kit (whose description says CC0) are the main exceptions. Most good options are **CC BY** on Sketchfab, such as 42manako's HMMWVs, Ural 4320, UH-60 variants and the BTR or T-72 scans. Scans run 100k to 3M faces and 100 to 260 MB, so they always need decimating and re-baking.

---

## 5. Web delivery: KTX2 and meshopt (no new runtime npm packages)

Everything needed at runtime is already in `three@0.187.0`:

| Need | Already in node_modules | Runtime cost |
|---|---|---|
| KTX2 / Basis textures | `three/addons/loaders/KTX2Loader.js` + `examples/jsm/libs/basis/basis_transcoder.{js,wasm}` | About 576 KB, fetched once and cached. Copy both files to `public/basis/`. |
| Meshopt geometry | `three/addons/libs/meshopt_decoder.module.js` | 32 KB (the WASM is embedded) |
| Draco geometry | `examples/jsm/libs/draco/gltf/` | About 250 KB (WASM plus wrapper). Optional. |

Wiring in `AssetLoader.ts`, with no new dependencies:

```ts
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

const ktx2 = new KTX2Loader().setTranscoderPath("/basis/").detectSupport(renderer);
const gltf = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
// Standalone texture sets: ktx2.loadAsync("/assets/textures/<id>/albedo.ktx2")
```

**Build-time tools.** These run on a dev machine or in CI, so nothing ships to players. Run the npm-based CLIs with `npx` and do not add them to `package.json`, or add them as devDependencies only.

- **glTF Transform CLI** (`npx @gltf-transform/cli`): `inspect`, `resize`, `meshopt`, `draco`, `etc1s`, `uastc`, `optimize`. A typical run is `gltf-transform optimize in.gltf out.glb --compress meshopt --texture-compress ktx2`; run `optimize -h` for the exact flags in our version. KTX2 encoding shells out to **KTX-Software** (`ktx` or `toktx`, version 4.3 or later), which must be installed on the build machine.
- **gltfpack** (meshoptimizer; native binary or `npx gltfpack`): a one-step `gltfpack -i in.gltf -o out.glb -cc -tc` (meshopt plus KTX2).
- **KTX-Software `ktx create`** for standalone texture sets. Use `--encode basis-lz` (ETC1S) for albedo and ARM, and `--encode uastc --zstd 18` for normal maps, with `--generate-mipmap`. Normal maps should be stored linear, not sRGB.

**Recommendations:**
1. **Textures:** move every PBR set to KTX2. Use ETC1S for albedo, roughness, AO and ARM, and UASTC for normals. Switch to Poly Haven's packed **ARM** map, which turns four files into three and matches three.js `aoMap`, `roughnessMap` and `metalnessMap`. Cap background props at 512 px and hero surfaces at 1k. Keep 2k only for the ground and the viewmodel.
2. **Geometry:** use **meshopt** (`EXT_meshopt_compression`) with quantization. Its decoder is the smallest (32 KB) and fastest. Use Draco only if a specific heavy scan compresses much better with it.
3. **HDRI:** ship one 2k `.hdr` for the visible sky and let PMREM handle lighting. Consider a 1k HDR plus a separate LDR/KTX2 sky backdrop. (HDR files compress poorly, about 4.5 to 6.5 MB at 2k.)
4. **Check Vercel transport compression.** Vercel's documented list of compressed MIME types does not include `model/gltf-binary` or `application/octet-stream`. Run `curl -sI -H 'Accept-Encoding: br,gzip' https://<deploy>/assets/models/x.glb | grep -i content-encoding`. If the header is missing, meshopt's extra gains from gzip are lost (meshopt is designed to be paired with gzip or Brotli). In that case either compare Draco against meshopt on our real files, or ship KTX2 + meshopt and accept the smaller savings. Set long `Cache-Control: immutable` headers on hashed asset paths either way.

**Expected savings** (rule-of-thumb ranges; measure on our files):

| | Today (JPG/PNG in glTF) | After KTX2 + meshopt |
|---|---|---|
| VRAM per 1k map (with mipmaps) | About 5.6 MB (decoded to RGBA8) | ETC1S as BC1/ETC2: about 0.7 MB. UASTC as BC7/ASTC: about 1.4 MB. **Roughly 4 to 8x less.** |
| Our 15 texture sets, about 57 maps at 1k | About 320 MB VRAM | About 50 to 60 MB VRAM |
| Texture download | Albedo plus three maps, about 2.2 MB per set (for example `concrete_wall_008`) | ETC1S is usually 0.6 to 1x the JPG size; UASTC with zstd for normals is 1 to 1.5x. Downloads are **roughly the same to 40% smaller**. The main gains are VRAM, no main-thread JPG decoding, and faster GPU upload. |
| Geometry (.bin) | Float32 positions, normals and UVs | Quantization plus meshopt: 2 to 4x smaller before gzip, 4 to 8x after gzip. Draco: 5 to 10x on its own, but with a slower decode. |
| Typical Poly Haven 1k prop | 2.5 to 7 MB | About 0.5 to 2 MB once textures are resized and converted (textures dominate these packages) |

Note: three's `KTX2Loader` picks the best GPU format from `detectSupport(renderer)`: ASTC or ETC2 on mobile, BC7 or BC1/BC3 on desktop. It falls back to uncompressed RGBA only if the device supports none of them.

---

## 6. Risks and how to handle them

1. **CC BY compliance.** Every CC BY asset needs the title, author, source link, license link and a note of our changes on `/credits` and in `CREDITS.md`. Missing credit ends the license. Track each one when it is added, not just before launch.
2. **Mislabeled Sketchfab uploads.** Some "CC BY" models are rips of commercial game assets (for example, the search results included a "Spartan Armour MKV - Halo Reach" model) or of other people's work. Reject anything named after a game or franchise, and anything whose author cannot plausibly have made it. Do a reverse-image search on suspicious hero assets. Some uploads are labeled CC BY but described as CC0 (britdawgmasterfunk), so follow the **stricter** label.
3. **Real vehicles, insignia and trade dress.** *AM General v. Activision* (S.D.N.Y. 2020) protected Humvees in *Call of Duty* as artistic expression, but that was one US ruling, won by a well-funded publisher. Strip manufacturer badges, use generic in-game names (for example "light utility vehicle", not "HMMWV"), avoid real unit insignia, and never use real names in marketing.
4. **Likeness.** Scanned faces belong to real people. Our CC BY head is covered by its license, but any new scan needs a license that covers the person's likeness, or should be avoided. MPFB-generated faces avoid the problem.
5. **Raw-file exposure in a web game.** Fab/Megascans, Mixamo, Textures.com and ShareTextures all limit redistributing raw assets. Our CDN effectively redistributes them. Do not use them without written permission. Compression to KTX2 or meshopt does not change the legal position.
6. **Logos in CC0 photos.** TextureCan, Texture Ninja and other photo sources can contain brand marks or graffiti that is someone else's art. Inspect and clean them.
7. **Mirror and derivative licenses.** Use original sources. For example, the CMU FBX conversion on 4TU is CC BY-NC, which is stricter than CMU's own terms.
8. **Service changes.** Ready Player Me is gone, Mixamo is in maintenance mode, and Megascans' terms have changed repeatedly since 2024. Keep a local archive of each license page (date and URL) alongside the asset's provenance.
9. **Bandwidth and performance.** Scans of 100 to 260 MB and 4K texture sets wreck load times. Set a budget, such as under 25 MB of compressed first-load data per map and under 1,500 draw calls, and enforce it with `gltf-transform inspect` in CI.
10. **Quality of procedural or AI-made models.** The mgg8 aircraft describe themselves as procedural. Check the topology, UVs and scale before committing to them.
11. **Copied map layouts.** See section 2. Keep blockout history (dated screenshots of iterations) as evidence of independent creation.
