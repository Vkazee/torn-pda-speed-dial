#!/bin/sh
# Release script. Run it after EVERY change to a file listed in manifest.json, then push everything it touched.
#   ./build.sh          1) keeps SD.ver in core.js equal to the version on core.js's first line
#                       2) rewrites manifest.json: the "files" list stays as you wrote it, the "v" list (a version per file) is recomputed
#                       3) builds dist/speed-dial.bundle.user.js (single file, no hosting needed)
#   ./build.sh --check  changes nothing; exits 1 if the manifest or the bundle is out of date (handy before a push or in CI)
# Why step 2 matters: the loader only downloads a file again when its version in manifest.json changed. Forget this step and nobody gets your edit.
cd "$(dirname "$0")" || exit 1
CHECK=0; [ "$1" = "--check" ] && CHECK=1
STALE=0

# file list = the "files" array of manifest.json (one per line or all on one line)
FILES=$(tr '\n' ' ' < manifest.json | sed 's/.*"files"[^[]*\[\([^]]*\)\].*/\1/' | grep -o '"[^"]*"' | tr -d '"')
[ -n "$FILES" ] || { echo "build.sh: no files found in manifest.json"; exit 1; }
for f in $FILES; do [ -f "$f" ] || { echo "build.sh: $f is in manifest.json but does not exist"; exit 1; }; done

# ---- 1) one place for the version: the first line of core.js ("// Speed Dial core vX.Y.Z") ----
VER=$(sed -n 's/^\/\/ Speed Dial core v\([0-9.]*\).*/\1/p' core.js | head -1)
if [ -n "$VER" ] && ! grep -q "started: false, ver: '$VER'" core.js; then
  if [ $CHECK -eq 1 ]; then echo "stale: SD.ver in core.js is not $VER"; STALE=1
  else sed -i "s/\(started: false, ver: '\)[0-9.]*'/\1$VER'/" core.js; echo "core.js: SD.ver set to $VER"; fi
fi

# ---- 2) manifest.json: version of a file = "<checksum>-<size in bytes>" (cksum is part of POSIX, so it exists on Termux, Linux and macOS) ----
NEW=$(mktemp)
{
  echo '{'
  echo '  "files": ['
  N=$(echo "$FILES" | wc -l); I=0
  for f in $FILES; do I=$((I+1)); SEP=','; [ $I -eq $N ] && SEP=''; echo "    \"$f\"$SEP"; done
  echo '  ],'
  echo '  "v": {'
  I=0
  for f in $FILES; do I=$((I+1)); SEP=','; [ $I -eq $N ] && SEP=''; echo "    \"$f\": \"$(cksum < "$f" | awk '{print $1 "-" $2}')\"$SEP"; done
  echo '  }'
  echo '}'
} > "$NEW"
if ! cmp -s "$NEW" manifest.json; then
  if [ $CHECK -eq 1 ]; then echo "stale: manifest.json needs ./build.sh"; STALE=1
  else chmod 644 "$NEW"; mv "$NEW" manifest.json; echo "manifest.json: versions updated"; fi
fi
rm -f "$NEW"

# ---- 3) bundle ----
OUT=dist/speed-dial.bundle.user.js
[ $CHECK -eq 1 ] && OUT=$(mktemp)
mkdir -p dist
# Each file runs in its own try/catch, like the loader does: a runtime error in one module must not stop the rest.
# (A syntax error cannot be caught this way; only the loader isolates those, because it runs every file as its own script.)
wrap() {
  echo "try {"
  cat "$1"
  echo
  echo "} catch (e) { console.error('Speed Dial: $1:', e); try { window.SpeedDial && window.SpeedDial.log('boot', '$1 failed: ' + (e && e.message || e), 'e'); } catch (x) { /* log not ready yet */ } }"
}
{
cat <<'HEAD'
// ==UserScript==
// @name         Speed Dial (bundle)
// @namespace    speeddial
// @version      ###VER###
// @description  One floating circle for Torn PDA. Tap it to fan out your tools (Item Dock, Travel Helper). Each tool only runs while its panel is open. Page features run only while switched on in Settings.
// @match        https://www.torn.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

HEAD
cat <<'GUARD'
(function () {
  'use strict';
  // ---- touch guard: must run BEFORE Torn's own scripts (hence @run-at document-start) ----
  // Torn's swipe handlers (sidebar that follows your finger) must never see a gesture that starts on Speed Dial.
  // A gesture that starts inside #sdial stays ours until the last finger lifts, even if the element under it is re-rendered.
  if (!window.__sdGuard) {
    window.__sdGuard = true;
    let own = false;
    const inUI = t => { const r = document.getElementById('sdial'); return !!(r && t && r.contains(t)); };
    const cut = e => {
      if (e.type === 'touchstart') own = (e.touches.length > 1 && own) || inUI(e.target);
      if (own) e.stopImmediatePropagation();
      if ((e.type === 'touchend' || e.type === 'touchcancel') && e.touches.length === 0) own = false;
    };
    ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(t => window.addEventListener(t, cut, { capture: true, passive: true }));
  }

})();

GUARD
cat <<'PRE'
// ---- native storage: PDA_storage only exists in this script's own scope, so it is handed to store.js first ----
(async function () {
  'use strict';
  try {
    for (let i = 0; i < 20 && typeof PDA_httpGet !== 'function'; i++) await new Promise(r => setTimeout(r, 100));   // PDA's bridge may not exist yet at document-start
    window.__sdNative = typeof PDA_storage !== 'undefined' ? PDA_storage : null;
PRE
wrap store.js
cat <<'MID'

    if (typeof window.__sdInit === 'function') { const init = window.__sdInit; window.__sdInit = null; try { await init(); } catch (e) {} }
MID
wrap core.js
for f in $FILES; do
  case "$f" in store.js|core.js) continue;; esac
  echo
  wrap "$f"
done
cat <<'TAIL'

    window.SpeedDial.start({ apiKey: '###PDA-APIKEY###' }); // filled in by Torn PDA
  } catch (e) { console.error('Speed Dial:', e); }
})();
TAIL
} > "$OUT"
sed -i "s/###VER###/${VER:-0}/" "$OUT"
if [ $CHECK -eq 1 ]; then
  cmp -s "$OUT" dist/speed-dial.bundle.user.js || { echo "stale: dist/speed-dial.bundle.user.js needs ./build.sh"; STALE=1; }
  rm -f "$OUT"
  [ $STALE -eq 0 ] && echo "up to date (v${VER:-?})"
  exit $STALE
fi
echo "built dist/speed-dial.bundle.user.js (v${VER:-?})"
