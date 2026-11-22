#!/bin/bash
S="${SOLDIER_WORK:-/tmp/tgf-soldiers}"
P=Assets/Avatars/Professions
rm -rf "$S/dl/rb/m01 sm002" "$S/dl/rb/m03 sm004" "$S/dl/rb/m04 sm005"
for a in "01 sm002" "03 sm004" "04 sm005"; do
  set -- $a
  mkdir -p "$S/dl/rb/m$1"
  L="$P/Military_Male_$1/Export/Military_Male_$1.fbx"
  for part in body_color_acu body_normal body_specular equipment_color_acu equipment_normal equipment_specular head_color head_normal head_specular helmet_color_acu helmet_normal helmet_specular; do
    L="$L $P/Military_Male_$1/Textures/$2_$part.tga"
  done
  sh "$S/scripts/fetch.sh" "$S/dl/rb/m$1" $L
done
du -sh "$S"/dl/rb/m*
