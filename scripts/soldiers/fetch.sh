#!/bin/sh
# usage: fetch.sh <outdir> <repo-relative path>...
OUT="$1"; shift
BASE=https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master
for p in "$@"; do
  f="$OUT/$(basename "$p")"
  [ -s "$f" ] && continue
  curl -fsSL -o "$f" "$BASE/$p" || echo "FAIL $p"
done
