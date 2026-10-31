// ==UserScript==
// @name         Speed Dial (loader)
// @namespace    speeddial
// @version      0.4.0
// @description  Loads Speed Dial core + modules from GitHub (list in manifest.json). Install once, never edit again.
// @match        https://www.torn.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

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

  const BASE = 'https://raw.githubusercontent.com/Vkazee/torn-pda-speed-dial/main/';
  const API_KEY = '###PDA-APIKEY###'; // filled in by Torn PDA
  const CK = 'speedDial.src.'; // offline cache prefix

  // fetch text via PDA's own HTTP bridge (no CORS issues), fall back to fetch().
  // At document-start the bridge may not exist yet, so wait for it (up to 4s) before falling back.
  const waitPda = async () => { for (let i = 0; i < 40 && typeof PDA_httpGet !== 'function'; i++) await new Promise(r => setTimeout(r, 100)); };
  const get = async url => {
    const u = url + '?t=' + Date.now();
    await waitPda();
    if (typeof PDA_httpGet === 'function') {
      const r = await PDA_httpGet(u);
      if (r && r.status >= 400) throw new Error('HTTP ' + r.status + ' ' + url);
      return r.responseText;
    }
    const r = await fetch(u);
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
    return r.text();
  };

  // network first; if it fails, use the last good copy
  const load = async path => {
    try {
      const txt = await get(BASE + path);
      try { localStorage.setItem(CK + path, txt); } catch (e) {}
      return txt;
    } catch (e) {
      const c = localStorage.getItem(CK + path);
      if (c) return c;
      throw e;
    }
  };

  const fail = msg => {
    const d = document.createElement('div');
    d.textContent = 'Speed Dial: ' + msg;
    d.style.cssText = 'position:fixed;left:8px;top:220px;z-index:99998;max-width:80vw;background:#3a1f1d;border:1px solid #6b2c28;color:#f1b5b0;padding:6px 10px;border-radius:10px;font:12px sans-serif';
    (document.body || document.documentElement).appendChild(d);
  };

  // Torn's CSP blocks eval but allows inline scripts that carry the page's nonce.
  // Copy the nonce from any existing <script nonce> and reuse it for our own script tag.
  const getNonce = async () => {
    for (let i = 0; i < 50; i++) {
      const el = document.querySelector('script[nonce]');
      const n = el && (el.nonce || el.getAttribute('nonce'));
      if (n) return n;
      await new Promise(r => setTimeout(r, 100));
    }
    return '';
  };

  const run = (code, file, nonce) => {
    let err = '';
    const onErr = e => { err = e.message || 'error'; };
    window.addEventListener('error', onErr);
    const el = document.createElement('script');
    if (nonce) el.nonce = nonce;
    el.textContent = code + '\n//# sourceURL=speeddial/' + file;
    (document.head || document.documentElement).appendChild(el); // runs synchronously
    el.remove();
    window.removeEventListener('error', onErr);
    if (err) throw new Error(err);
  };

  (async () => {
    try {
      if (window.SpeedDial && window.SpeedDial.started) return;
      const man = JSON.parse(await load('manifest.json'));
      const codes = await Promise.all(man.files.map(load)); // download in parallel
      const nonce = await getNonce();
      if (!nonce) return fail('no page nonce found (CSP)');
      for (let i = 0; i < man.files.length; i++) {            // run in manifest order
        try { run(codes[i], man.files[i], nonce); }
        catch (e) { return fail(man.files[i] + ': ' + e.message); }
      }
      if (!window.SpeedDial) return fail('core did not load');
      window.SpeedDial.start({ apiKey: API_KEY });
    } catch (e) {
      fail('load failed (' + e.message + ')');
    }
  })();
})();
