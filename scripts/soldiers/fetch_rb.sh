#!/bin/bash
# Downloads the Rocketbox (MIT) sources scripts/soldiers/build.mjs needs into
# $SOLDIER_WORK/dl/<Avatar_Name>/: FBX + every TGA texture of the eight
# military avatars (2048 px per material), and FBX + head textures of the
# civilian head donors (see HEADS in build.mjs). ~1 GB; files already on
# disk are skipped.
#
#   SOLDIER_WORK=<scratch> bash scripts/soldiers/fetch_rb.sh
S="${SOLDIER_WORK:-/tmp/tgf-soldiers}"
HERE="$(cd "$(dirname "$0")" && pwd)"
P=Assets/Avatars/Professions
get() { # <Avatar_Name> <prefix> <part>...
  local name="$1" pre="$2"; shift 2
  local out="$S/dl/$name" list="$P/$name/Export/$name.fbx"
  mkdir -p "$out"
  for part in "$@"; do
    for kind in color normal specular; do
      local f="$pre"_"$part"_"$kind"
      # Uniform parts ship as *_color_acu; heads mostly as *_color.
      if [ "$kind" = color ] && [ "$part" != head ]; then f="$f"_acu; fi
      list="$list $P/$name/Textures/$f.tga"
    done
  done
  sh "$HERE/fetch.sh" "$out" $list 2>&1 | grep -v "_head_color.tga\|error: 404"
  # Cap heads ship *_head_color_acu instead.
  [ -s "$out/${pre}_head_color.tga" ] || sh "$HERE/fetch.sh" "$out" "$P/$name/Textures/${pre}_head_color_acu.tga"
}
get Military_Male_01 sm002 body head helmet equipment &
get Military_Male_03 sm004 body head helmet equipment &
get Military_Male_04 sm005 body head helmet equipment &
get Military_Male_02 sm024 body head &
get Military_Male_05 sm022 body head &
get Military_Male_06 sm021 body head &
get Military_Female_01 sf003 body head helmet equipment &
get Military_Female_02 sf004 body head helmet equipment &
wait
# Head donors: bare short hair, no alpha-card hair (no *_opacity texture).
get Business_Male_04 m015 head &
get Business_Male_05 m016 head &
get Sports_Male_01 m021 head &
get Sports_Male_04 m026 head &
wait
# Construction workers' heads are modelled to sit under a hard hat (their own helmet material).
get Construction_Male_03 m102 head &
get Construction_Male_08 m108 head &
get Medical_Male_04 m162 head &
wait
du -sh "$S"/dl/*
