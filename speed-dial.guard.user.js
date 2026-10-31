// ==UserScript==
// @name         Speed Dial (guard)
// @namespace    speeddial
// @version      0.1.0
// @description  Runs BEFORE Torn's scripts so that touches on Speed Dial never reach Torn's swipe handlers (sidebar following your finger). Install together with the loader/bundle.
// @match        https://www.torn.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';
  if (window.__sdGuard) return;
  window.__sdGuard = true;
  // Registered on window in the capture phase, first of all listeners.
  // stopImmediatePropagation also silences listeners that Torn adds on window later.
  // Only touches that start inside #sdial are affected; everything else is untouched.
  const cut = e => {
    const r = document.getElementById('sdial');
    if (r && r.contains(e.target)) e.stopImmediatePropagation();
  };
  ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(t =>
    window.addEventListener(t, cut, { capture: true, passive: true }));
})();
