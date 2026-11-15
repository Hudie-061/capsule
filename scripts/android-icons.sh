#!/usr/bin/env bash
# Replace Capacitor's default launcher icons with the app icon.
set -euo pipefail
command -v convert >/dev/null || sudo apt-get install -y -qq imagemagick
RES=android/app/src/main/res
rm -rf "$RES/mipmap-anydpi-v26"   # use plain PNG icons instead of adaptive ones
for pair in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
  dir="$RES/mipmap-${pair%%:*}"; size="${pair##*:}"
  convert public/icon-512.png -resize "${size}x${size}" "$dir/ic_launcher.png"
  convert public/icon-512.png -resize "${size}x${size}" "$dir/ic_launcher_round.png"
done
