#!/usr/bin/env bash
# Regenerates the PWA PNG icons in public/ from public/icon.svg and public/icon-maskable.svg
# with headless Chrome (or Edge). Run from dashboard/: CHROME=/path/to/chrome scripts/render-icons.sh
set -euo pipefail
cd "$(dirname "$0")/../public"
CHROME="${CHROME:-google-chrome}"
TMP="$(mktemp -d)"
render() { # <svg> <size> <out.png>
  printf '<!doctype html><body style="margin:0"><img src="file://%s/%s" width="%s" height="%s" style="display:block">' "$PWD" "$1" "$2" "$2" > "$TMP/$3.html"
  "$CHROME" --headless --disable-gpu --hide-scrollbars --user-data-dir="$TMP/profile-$3" --default-background-color=00000000 \
    --allow-file-access-from-files --window-size="$2,$2" --screenshot="$PWD/$3" "file://$TMP/$3.html"
}
render icon.svg 192 icon-192.png
render icon.svg 512 icon-512.png
render icon-maskable.svg 512 icon-maskable-512.png
render icon-maskable.svg 180 apple-touch-icon.png
