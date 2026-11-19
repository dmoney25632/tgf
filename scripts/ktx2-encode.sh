#!/usr/bin/env bash
# Optional GPU-compressed delivery: KTX2 (Basis) textures + meshopt geometry.
#
#   npm run assets:ktx2            # dry run: shows what would be encoded
#   npm run assets:ktx2 -- --write # encode (needs the tools below)
#
# Not run in CI or on Vercel. Needs, on the machine running it:
#   - gltfpack  (meshoptimizer; `brew install meshoptimizer` or `npx gltfpack`)
#   - toktx / ktx (KTX-Software >= 4.3; https://github.com/KhronosGroup/KTX-Software)
# This script never installs system tools.
#
# What it does with --write:
#   1. Copies three's Basis transcoder to public/assets/basis/ (AssetLoader
#      loads it from there, only when a glTF uses KHR_texture_basisu).
#   2. Re-packs every public/assets/models/<id>/<id>_1k.gltf in place with
#      gltfpack: meshopt geometry + quantization (-cc) and KTX2 textures (-tc),
#      keeping the .gltf file name so manifest.ts stays valid. AssetLoader
#      detects EXT_meshopt_compression / KHR_texture_basisu and loads the
#      decoders on demand.
#   3. Leaves texture sets (public/assets/textures) as JPEG: the material
#      library builds THREE.Textures from images; switching those to .ktx2 needs
#      a manifest change (owned by the asset list) plus a KTX2Loader path in
#      Materials.ts.
#
# Then run `npm run assets:optimize` (records sizes) and check visually.
set -euo pipefail
cd "$(dirname "$0")/.."

WRITE=0
[ "${1:-}" = "--write" ] && WRITE=1

have() { command -v "$1" >/dev/null 2>&1; }
if ! have gltfpack; then
  echo "gltfpack not found. Install meshoptimizer (gltfpack) to encode; nothing done."
  echo "Loader support is already in place (src/game/assets/AssetLoader.ts)."
  exit 0
fi
if ! have toktx && ! have ktx; then
  echo "toktx/ktx not found: gltfpack -tc needs KTX-Software. Geometry-only (-cc) will be used."
  TEX=""
else
  TEX="-tc"
fi

if [ "$WRITE" = 1 ]; then
  mkdir -p public/assets/basis
  cp node_modules/three/examples/jsm/libs/basis/basis_transcoder.{js,wasm} public/assets/basis/
fi

for gltf in public/assets/models/*/*_1k.gltf; do
  dir=$(dirname "$gltf")
  before=$(du -sk "$dir" | cut -f1)
  if [ "$WRITE" = 0 ]; then
    echo "would encode $gltf (${before} kB)"
    continue
  fi
  out="$dir/.packed"
  rm -rf "$out" && mkdir -p "$out"
  # -kn/-km keep node and material names (variants are split by top-level node).
  gltfpack -i "$gltf" -o "$out/$(basename "$gltf")" -cc $TEX -kn -km
  # Replace the old glTF, buffers and textures with the packed set.
  rm -rf "$dir"/*.gltf "$dir"/*.bin "$dir/textures"
  mv "$out"/* "$dir"/
  rmdir "$out"
  echo "$gltf: ${before} kB -> $(du -sk "$dir" | cut -f1) kB"
done
