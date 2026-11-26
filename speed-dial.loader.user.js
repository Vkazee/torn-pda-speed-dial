// ==UserScript==
// @name         Speed Dial (loader)
// @namespace    speeddial
// @version      0.6.0
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
  const CK = 'speedDial.src.';        // offline cache: the code of each file is kept under CK + path (store.js never copies this prefix to the app)
  const K_MAN = CK + '@man';          // last manifest (file list + version of every file)
  const K_VER = CK + '@ver';          // path -> version of the copy kept in the cache
  const K_CHK = CK + '@chk';          // when the manifest was last downloaded (ms)
  const CHECK_MS = 2 * 60 * 1000;     // inside this time the saved manifest is trusted as it is: no request at all
  const MUST = ['store.js', 'core.js']; // nothing can run without these; every other file may fail on its own

  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };
  const jget = k => { try { return JSON.parse(lsGet(k)); } catch (e) { return null; } };

  // one line in the Terminal (Settings). Before core.js exists the line waits in window.__sdBoot, exactly like store.js does.
  const note = (msg, l) => {
    try {
      const S = window.SpeedDial;
      if (S && S.log) S.log('loader', msg, l);
      else (window.__sdBoot = window.__sdBoot || []).push(['loader', msg, l || 'i', Date.now()]);
    } catch (e) { /* the log itself must never stop loading */ }
  };

  // fetch text via PDA's own HTTP bridge (no CORS issues), fall back to fetch().
  // At document-start the bridge may not exist yet, so wait for it (up to 4s) before falling back.
  const waitPda = async () => { for (let i = 0; i < 40 && typeof PDA_httpGet !== 'function'; i++) await new Promise(r => setTimeout(r, 100)); };
  // q = the query string that makes the URL unique: t=<now> always bypasses GitHub's cache, v=<version> gives each version of a file its own URL
  const get = async (path, q) => {
    const u = BASE + path + '?' + q;
    await waitPda();
    if (typeof PDA_httpGet === 'function') {
      const r = await PDA_httpGet(u);
      if (r && r.status >= 400) throw new Error('HTTP ' + r.status + ' ' + path);
      return r.responseText;
    }
    const r = await fetch(u);
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + path);
    return r.text();
  };
  const bytes = s => { try { return new TextEncoder().encode(s).length; } catch (e) { return 0; } };   // 0 = cannot tell: skip the size check

  // A version looks like "<checksum>-<size in bytes>" (written by build.sh). The size is a cheap guard against a stale copy from GitHub's cache:
  // if it does not match, ask once more with a fresh URL. A copy that still differs is used anyway (and noted) rather than not starting.
  const getFile = async (path, v) => {
    const size = +String(v).split('-')[1] || 0;
    let txt = await get(path, v ? 'v=' + encodeURIComponent(v) : 't=' + Date.now());
    const n = bytes(txt);
    if (size && n && n !== size) {
      note(path + ': size ' + n + ' B, manifest says ' + size + ' B; asking again', 'w');
      txt = await get(path, 't=' + Date.now());
      if (bytes(txt) !== size) note(path + ': still differs from the manifest, using it anyway', 'w');
    }
    return txt;
  };

  // The file list and the version of every file. A manifest checked less than CHECK_MS ago is used without any request.
  const getManifest = async () => {
    let man = jget(K_MAN);
    if (man && !(man.files && man.files.length)) man = null;
    if (man && Date.now() - (+lsGet(K_CHK) || 0) < CHECK_MS) return man;
    try {
      const m = JSON.parse(await get('manifest.json', 't=' + Date.now()));
      if (!m || !(m.files && m.files.length)) throw new Error('manifest has no file list');
      lsSet(K_MAN, JSON.stringify(m)); lsSet(K_CHK, String(Date.now()));
      return m;
    } catch (e) {
      if (!man) throw e;
      lsSet(K_CHK, String(Date.now() - CHECK_MS + 30000));   // offline or GitHub down: look again in 30 s
      note('manifest download failed, using the saved list: ' + (e && e.message || e), 'w');
      return man;
    }
  };

  const fail = msg => {
    const d = document.createElement('div');
    d.textContent = 'Speed Dial: ' + msg;
    d.onclick = () => d.remove();   // tap to dismiss
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
      const man = await getManifest();
      const ver = man.v && typeof man.v === 'object' ? man.v : {};   // an old manifest has no versions: every file is then downloaded each time, as before
      const have = jget(K_VER) || {};
      let got = 0, kept = 0;

      // 1) per file: same version as the saved copy -> no request; otherwise download it; if that fails, fall back to the saved copy
      const codes = await Promise.all(man.files.map(async path => {
        const v = String(ver[path] || '');
        const saved = lsGet(CK + path);
        if (saved && v && have[path] === v) { kept++; return { code: saved }; }
        try { const code = await getFile(path, v); got++; return { code, v, fresh: true }; }
        catch (e) {
          const why = e && e.message || String(e);
          if (saved) { kept++; note(path + ': download failed, using the saved copy (' + why + ')', 'w'); return { code: saved }; }
          return { err: why };
        }
      }));

      // 2) remember what was downloaded (and its version), forget files that left the manifest (also the copy of the old-style manifest)
      codes.forEach((c, i) => {
        if (!c.fresh) return;
        const p = man.files[i];
        if (lsSet(CK + p, c.code) && c.v) have[p] = c.v; else delete have[p];   // not stored or no version: next time it is downloaded again
      });
      Object.keys(have).forEach(p => { if (man.files.indexOf(p) < 0) delete have[p]; });
      lsSet(K_VER, JSON.stringify(have));
      try {
        Object.keys(localStorage)
          .filter(k => k.indexOf(CK) === 0 && k.charAt(CK.length) !== '@' && man.files.indexOf(k.slice(CK.length)) < 0)
          .forEach(k => localStorage.removeItem(k));
      } catch (e) { /* cleanup is optional */ }

      await waitPda();   // PDA's bridge (and PDA_storage) may not exist yet at document-start
      // PDA_storage only exists in this userscript's own scope, not on the page: hand it to store.js (first file in manifest.json)
      window.__sdNative = typeof PDA_storage !== 'undefined' ? PDA_storage : null;
      const nonce = await getNonce();
      if (!nonce) return fail('no page nonce found (CSP)');

      // 3) run in manifest order. store.js and core.js must work; any other file that fails is skipped and the rest still starts.
      const skipped = [];
      for (let i = 0; i < man.files.length; i++) {
        const f = man.files[i], c = codes[i];
        let why = c.err;
        if (!why) { try { run(c.code, f, nonce); } catch (e) { why = e.message || 'error'; } }
        if (why) {
          if (MUST.indexOf(f) > -1) return fail(f + ': ' + why);
          skipped.push(f + ': ' + why);
          note(f + ' skipped: ' + why, 'e');
          continue;
        }
        if (typeof window.__sdInit === 'function') {   // store.js: load your saved data before core.js and the modules read it
          const init = window.__sdInit; window.__sdInit = null;
          try { await init(); } catch (e) { /* store.js logs its own failure and falls back to localStorage */ }
        }
      }
      if (!window.SpeedDial) return fail('core did not load');
      note(man.files.length + ' file(s): ' + got + ' downloaded, ' + kept + ' from the saved copy' + (skipped.length ? ', ' + skipped.length + ' skipped' : ''));
      window.SpeedDial.start({ apiKey: API_KEY });
      if (skipped.length) fail(skipped.length + ' file(s) skipped: ' + skipped.join(' | '));
    } catch (e) {
      fail('load failed (' + (e && e.message || e) + ')');
    }
  })();
})();
