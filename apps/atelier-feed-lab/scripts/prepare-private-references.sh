#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
app_dir="$(cd "$script_dir/.." && pwd)"
references_dir="$app_dir/private/references"
raster_dir="$(mktemp -d)"

cleanup() {
  rm -rf "$raster_dir"
}
trap cleanup EXIT

mkdir -p "$references_dir"
pnpm exec tsx "$script_dir/render-vtuber-reference.mts"

for asset in star-cactus moon-lantern glasshouse night-window
do
  qlmanage -t -s 1024 -o "$raster_dir" "$app_dir/public/catalog/$asset.svg" >/dev/null 2>&1
  ffmpeg -hide_banner -loglevel error -y \
    -i "$raster_dir/$asset.svg.png" \
    -vf "scale=1024:1024:flags=lanczos,format=rgb24" \
    -frames:v 1 -compression_level 9 \
    "$references_dir/$asset.png"
done

echo "Prepared private image references in $references_dir"
