#!/bin/sh
# Builds dist/speed-dial.bundle.user.js (single file, no hosting needed)
# from store.js + core.js + every module/feature listed in manifest.json (same order as the loader).
cd "$(dirname "$0")" || exit 1
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
// @version      0.7.0
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
for f in $(grep -o '"[^"]*\.js"' manifest.json | tr -d '"' | grep -v '^store\.js$' | grep -v '^core\.js$'); do
  echo
  wrap "$f"
done
cat <<'TAIL'

    window.SpeedDial.start({ apiKey: '###PDA-APIKEY###' }); // filled in by Torn PDA
  } catch (e) { console.error('Speed Dial:', e); }
})();
TAIL
} > dist/speed-dial.bundle.user.js
echo "built dist/speed-dial.bundle.user.js"
