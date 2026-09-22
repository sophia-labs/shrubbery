#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
app_dir="$(cd "$script_dir/.." && pwd)"
stills_dir="$app_dir/public/stills"
clips_dir="$app_dir/public/clips"
render_dir="$(mktemp -d)"

cleanup() {
  rm -rf "$render_dir"
}
trap cleanup EXIT

mkdir -p "$clips_dir"

for still in \
  idle-glasshouse \
  idle-night \
  cactus-glasshouse \
  cactus-night \
  lantern-glasshouse \
  lantern-night
do
  qlmanage -t -s 1024 -o "$render_dir" "$stills_dir/$still.svg" >/dev/null 2>&1
  ffmpeg -hide_banner -loglevel error -y \
    -loop 1 -framerate 24 -i "$render_dir/$still.svg.png" \
    -vf "scale=1024:1024,zoompan=z='1.025+0.012*(1-cos(2*PI*on/119))/2':x='iw/2-(iw/zoom/2)+6*sin(2*PI*on/119)':y='ih/2-(ih/zoom/2)+4*sin(4*PI*on/119)':d=1:s=768x768:fps=24,noise=alls=1.5:allf=t+u,format=yuv420p" \
    -frames:v 120 -an -c:v libx264 -preset veryfast -crf 24 -movflags +faststart \
    "$clips_dir/$still.mp4"
done

echo "Rendered local clips in $clips_dir"
