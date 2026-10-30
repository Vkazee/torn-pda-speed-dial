// ==UserScript==
// @name         Speed Dial
// @namespace    speeddial
// @version      0.1.0
// @description  One floating circle for Torn PDA. Tap it to fan out your tools. Each tool only runs while its panel is open.
// @match        https://www.torn.com/*
// @grant        none
// @require      https://raw.githubusercontent.com/Vkazee/torn-pda-speed-dial/main/core.js
// @require      https://raw.githubusercontent.com/Vkazee/torn-pda-speed-dial/main/modules/itemdock.js
// @require      https://raw.githubusercontent.com/Vkazee/torn-pda-speed-dial/main/modules/travelhelper.js
// ==/UserScript==

(function () {
  'use strict';
  if (window.SpeedDial) {
    window.SpeedDial.start({ apiKey: '###PDA-APIKEY###' }); // filled in by Torn PDA
    return;
  }
  // @require did not load: show a small red marker so the failure is visible
  const d = document.createElement('div');
  d.textContent = 'Speed Dial: @require failed';
  d.style.cssText = 'position:fixed;left:8px;top:220px;z-index:99998;background:#3a1f1d;border:1px solid #6b2c28;color:#f1b5b0;padding:6px 10px;border-radius:10px;font:12px sans-serif';
  (document.body || document.documentElement).appendChild(d);
})();
