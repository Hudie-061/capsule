#!/usr/bin/env bash
# Permissions the web app asks for inside the APK: the Capacitor WebView passes the browser's requests on to
# Android, and Android only shows its prompt for permissions declared in the manifest.
# - location: the weather on «Сегодня» (src/lib/forecast.js); the app asks for an approximate position only,
#   and Android 12+ lets the person choose «Приблизительно»;
# - camera: «Снять с подсказками» (src/body-capture.jsx, getUserMedia).
# Run after `npx cap add android` (the folder is made fresh in CI).
set -euo pipefail
manifest=android/app/src/main/AndroidManifest.xml
for perm in ACCESS_COARSE_LOCATION ACCESS_FINE_LOCATION CAMERA; do
  if ! grep -q "android.permission.$perm\"" "$manifest"; then
    sed -i "s#<application#<uses-permission android:name=\"android.permission.$perm\" />\n    <application#" "$manifest"
  fi
done
grep -n "uses-permission" "$manifest"
