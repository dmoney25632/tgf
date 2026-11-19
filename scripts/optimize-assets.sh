#!/usr/bin/env bash
# Re-encodes the photo textures under public/assets with macOS `sips` (no npm
# deps) and writes half-size variants used by the Low preset.
#
#   npm run assets:optimize
#
# - Colour / roughness / AO / ARM maps: JPEG q80. Normal maps: q85 (blocking
#   in normals shows up in specular highlights first).
# - Texture sets (public/assets/textures/<id>/<kind>.jpg) also get
#   <kind>_512.jpg, which AssetLoader prefers when maxTextureSize <= 512 and
#   falls back from if missing.
# - Model textures are re-encoded in place, so .gltf references don't change.
#
# Idempotent: every processed file is recorded with its resulting size in
# scripts/optimized-assets.txt; files whose size still matches are skipped,
# so re-running after new assets land only touches the new ones (and never
# re-compresses an already-compressed file).
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v sips >/dev/null; then
  echo "sips not found (macOS only). Nothing done." >&2
  exit 1
fi

LEDGER=scripts/optimized-assets.txt
touch "$LEDGER"
before=0
after=0
count=0

recorded_size() { awk -v p="$1" '$1 == p { print $2 }' "$LEDGER" | tail -1; }
record() {
  grep -v "^$1 " "$LEDGER" > "$LEDGER.tmp" || true
  echo "$1 $(stat -f %z "$1")" >> "$LEDGER.tmp"
  sort -o "$LEDGER" "$LEDGER.tmp"
  rm -f "$LEDGER.tmp"
}

while IFS= read -r -d '' f; do
  case "$f" in *_512.jpg) continue ;; esac
  size=$(stat -f %z "$f")
  if [ "$(recorded_size "$f")" = "$size" ]; then continue; fi
  q=80
  case "$f" in *normal*|*_nor_*) q=85 ;; esac
  tmp="$f.tmp.jpg"
  sips -s format jpeg -s formatOptions "$q" "$f" --out "$tmp" >/dev/null
  new=$(stat -f %z "$tmp")
  if [ "$new" -lt "$size" ]; then mv "$tmp" "$f"; else rm -f "$tmp"; new=$size; fi
  before=$((before + size))
  after=$((after + new))
  count=$((count + 1))
  record "$f"

  # Low-preset variant for texture sets.
  case "$f" in
    public/assets/textures/*)
      small="${f%.jpg}_512.jpg"
      sips -s format jpeg -s formatOptions "$q" -Z 512 "$f" --out "$small" >/dev/null
      ;;
  esac
done < <(find public/assets -type f -name '*.jpg' -print0 | sort -z)

echo "Re-encoded $count JPEGs: $((before / 1024)) kB -> $((after / 1024)) kB"
du -sh public/assets
