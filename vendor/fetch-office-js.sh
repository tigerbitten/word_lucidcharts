#!/usr/bin/env bash
# Copies Office.js from Microsoft's CDN into vendor/office/ so the add-in only
# talks to our own host. Microsoft's guidance for locked-down environments is to
# "download the necessary files from the CDN and bundle them with your add-in";
# the @microsoft/office-js npm package is no longer supported. Re-run every few
# months: a frozen copy misses the host fixes the CDN ships.
set -euo pipefail
CDN=https://officeapis.public.onecdn.static.microsoft/1
OUT="$(dirname "$0")/office"
rm -rf "$OUT"
mkdir -p "$OUT"
get() { mkdir -p "$OUT/$(dirname "$1")"; curl -fsS -o "$OUT/$1" "$CDN/$1"; echo "  $1"; }

get office.js

# office.js loads <host>-<platform>-<version>.js from its own folder, with the
# version capped by this map. Fail loudly if Microsoft adds a newer one.
for map in 'word:{ios:"16.00",mac:"16.00",web:"16.00",win32:"16.01",winrt:"16.00"}' \
           'powerpoint:{ios:"16.00",mac:"16.00",web:"16.00",win32:"16.01",winrt:"16.00"}'; do
  grep -qF "$map" "$OUT/office.js" || { echo "host file versions changed in office.js, expected $map" >&2; exit 1; }
done
# Older Office builds ask for 16.00, so win32 needs both. winrt (Windows 10 Mobile)
# has no published file. Office 2013 (15.x) can't run this add-in's APIs anyway.
for host in word powerpoint; do
  for f in win32-16.00 win32-16.01 mac-16.00 web-16.00 ios-16.00; do get "$host-$f.js"; done
done

# Telemetry scripts the host files load. What they try to send is blocked by the
# CSP in taskpane.html and signin.html; shipping them keeps the loader on its normal path.
get telemetry/oteljs_agave.js
get ariatelemetry/aria-web-telemetry.js

# UI strings for every locale office.js supports. A missing one falls back to
# en-us only after a 5-second timeout.
locales=$(grep -oE 'OSF.SupportedLocales=\{[^}]*\}' "$OUT/office.js" | grep -oE '"[a-z-]+"' | tr -d '"')
[ -n "$locales" ] || { echo "couldn't find OSF.SupportedLocales in office.js" >&2; exit 1; }
for loc in $locales; do get "$loc/office_strings.js"; done

echo "done: $(find "$OUT" -type f | wc -l) files, $(du -sh "$OUT" | cut -f1)"
