# Art pipeline

Original 3D assets (weapons now; props and gear next) are authored as **Blender Python build scripts** and exported to the game's glTF + KTX2 format with one command. The scripts are the source of truth: there are no hand-edited binaries to lose, every asset is reproducible, and changes show up as reviewable diffs.

## Setup

1. Install Blender 5.x (`brew install --cask blender`, or from blender.org).
2. If Blender is not at `/Applications/Blender.app`, set `BLENDER=/path/to/blender`.
3. Run `npm run art:check` to confirm Blender is found and `art/assets.json` is valid.

## Commands

| Command | What it does |
| --- | --- |
| `npm run art:build` | Builds every asset in `art/assets.json` |
| `npm run art:build -- uzi` | Builds one asset |
| `npm run art:build -- uzi --no-previews` | Skips the preview renders (faster) |
| `npm run art:check` | Validates the manifest and shows the Blender version |

Each build runs in this order:

1. Blender runs headless (`art/blender/build_asset.py`), executes the asset script and applies modifiers.
2. It bakes the procedural materials to a PBR set: baseColor, metallicRoughness and normal.
3. It adds LODs if requested, exports `.gltf` with separate textures, and checks the triangle budget.
4. It renders previews to `art/previews/<id>_{three_quarter,side,pov}.png`. This folder is gitignored, so check the renders before you commit.
5. `scripts/art.mjs` converts the PNG textures to JPG, then runs `scripts/encode-ktx2.mjs --write`. That step does the KTX2 textures and meshopt geometry.

**Restart `next dev` after a rebuild**, because the asset version hash is computed when the dev server starts.

## Conventions

- **Units and axes.** Use metres, with +Z up and the front of the asset along +Y. The exporter converts to glTF Y-up, so weapons arrive barrel-forward along -Z and need `rot: [0, 0, 0]` in `REAL_GUNS`.
- **Real dimensions.** Model from published specs, such as overall length, barrel length and height. `scene.fit_length` can enforce an overall length.
- **Animated parts.** These are separate objects named for what they are (`mag`, `bolt`, `pump`). The `REAL_GUNS` `parts` regexes match those names.
- **Materials.** Use the presets in `tgf/materials.py`, such as `parkerized`, `polymer_black` and `wood_walnut`. They add procedural mottling, edge wear and bump, which get baked away, so the game sees only standard glTF PBR.
- **Geometry.** Start from the primitives in `tgf/model.py` (`box`, `cyl`, `tube`, `profile`, `cut`, `array`). Every part gets a real bevel plus weighted normals, which is most of what makes hard surfaces read as machined rather than blocky.
- **Budgets.** Aim for 10–25k triangles per first-person weapon and 1024² textures per baked object. A build fails (exit 2) when it goes over `budget`.

## Adding an asset

1. Create `art/blender/assets/<id>.py` with `build(ctx)` that returns `{"objects": [...], "bake": True, "bake_size": 1024, "budget": 24000}`. Use `uzi.py` as a template.
2. Add an entry to `art/assets.json` with these fields:
   - `id`
   - `kind`
   - `script`
   - `out`, which must be under `public/assets/`
   - `license`
   - `author`
3. Run `npm run art:build -- <id>` and look at the previews.
4. Wire the asset into the game. For a weapon, add a `REAL_GUNS` entry in `src/game/weapons/viewmodel/realGuns.ts`, then run `npm test`.

## Third-party sources

Reference meshes or scans can go in `art/source/<id>/` and be loaded with `scene.import_source(path)` (fbx, obj, gltf, glb or blend). Only use sources with a verified CC0, MIT or CC-BY licence. Record CC-BY sources in `public/assets/CREDITS.md` and `src/app/credits/page.tsx`. Never use Mixamo, Sketchfab Standard or ripped assets.
