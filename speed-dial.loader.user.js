// ==UserScript==
// @name         Speed Dial (loader)
// @namespace    speeddial
// @version      0.3.0
// @description  Loads Speed Dial core + modules from GitHub (list in manifest.json). Install once, never edit again.
// @match        https://www.torn.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';
  const BASE = 'https://raw.githubusercontent.com/Vkazee/torn-pda-speed-dial/main/';
  const API_KEY = '###PDA-APIKEY###'; // filled in by Torn PDA
  const CK = 'speedDial.src.'; // offline cache prefix

  // fetch text via PDA's own HTTP bridge (no CORS issues), fall back to fetch()
  const get = url => new Promise((resolve, reject) => {
    const u = url + '?t=' + Date.now();
    if (typeof PDA_httpGet === 'function') {
      PDA_httpGet(u).then(r => {
        if (r && r.status >= 400) reject(new Error('HTTP ' + r.status + ' ' + url));
        else resolve(r.responseText);
      }).catch(reject);
    } else {
      fetch(u).then(r => r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status + ' ' + url))).then(resolve, reject);
    }
  });

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
