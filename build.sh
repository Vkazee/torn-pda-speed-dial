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
// @version      0.1.0
// @description  One floating circle for Torn PDA. Tap it to fan out your tools (Item Dock, Travel Helper). Each tool only runs while its panel is open.
// @match        https://www.torn.com/*
// @grant        none
// ==/UserScript==

HEAD
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
