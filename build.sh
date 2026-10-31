#!/bin/sh
# Builds dist/speed-dial.bundle.user.js (single file, no hosting needed)
# from core.js + every file in modules/.
cd "$(dirname "$0")" || exit 1
mkdir -p dist
{
cat <<'HEAD'
// ==UserScript==
// @name         Speed Dial (bundle)
// @namespace    speeddial
// @version      0.4.0
// @description  One floating circle for Torn PDA. Tap it to fan out your tools (Item Dock, Travel Helper). Each tool only runs while its panel is open.
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
cat core.js
for f in modules/*.js; do
  echo
  cat "$f"
done
cat <<'TAIL'

(function () {
  'use strict';
  window.SpeedDial.start({ apiKey: '###PDA-APIKEY###' }); // filled in by Torn PDA
})();
TAIL
} > dist/speed-dial.bundle.user.js
echo "built dist/speed-dial.bundle.user.js"
