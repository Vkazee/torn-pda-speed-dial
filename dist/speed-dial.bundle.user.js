// ==UserScript==
// @name         Speed Dial (bundle)
// @namespace    speeddial
// @version      0.8.0
// @description  One floating circle for Torn PDA. Tap it to fan out your tools (Item Dock, Travel Helper). Each tool only runs while its panel is open. Page features run only while switched on in Settings.
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

})();

// ---- native storage: PDA_storage only exists in this script's own scope, so it is handed to store.js first ----
(async function () {
  'use strict';
  try {
    for (let i = 0; i < 20 && typeof PDA_httpGet !== 'function'; i++) await new Promise(r => setTimeout(r, 100));   // PDA's bridge may not exist yet at document-start
    window.__sdNative = typeof PDA_storage !== 'undefined' ? PDA_storage : null;
try {
// Speed Dial store v0.2.0
// Keeps your saved data (Targets, menu layout, shortcuts, window positions, Item Dock items, Travel Helper settings, Gym Guide choices)
// in Torn PDA's native storage (PDA_storage): on disk in the app, not wiped when the browser cache is cleared.
// PDA_storage is asynchronous, so everything is loaded ONCE before core.js and the modules start, then read from memory.
// Writes go to memory at once and to the app in one batch about half a second later (and when the page is hidden).
// localStorage still gets a copy of every write, and is the fallback when this PDA has no native storage.
// The first time, anything already in localStorage is copied into the app, so nothing is lost.
// The loader (or bundle) hands PDA_storage over as window.__sdNative, because it only exists in the userscript's own scope.
(function () {
  'use strict';
  if (window.__sdStore) return;

  // Only keys starting with one of these go to the app. A new module must name its key 'speedDial.<name>' or it silently stays in localStorage only.
  const PFX = ['speedDial.', 'itemDock.', 'travelHelper.', 'gymGuide.'];
  const mine = k => PFX.some(p => k.indexOf(p) === 0) && !/^speedDial\.(src\.|data1$)/.test(k);   // not the downloaded-source cache
  const ls = {
    get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, s) => { try { localStorage.setItem(k, s); } catch (e) { log('localStorage write ' + k + ' failed: ' + (e && e.message || e), 'w'); } }
  };

  const odd = new Set();                // keys already warned about (wrong prefix), so the log gets one line per key
  let nat = null;                       // PDA_storage, once loaded
  const cache = Object.create(null);    // key -> JSON text (only while nat is on)
  const dirty = new Set();              // keys not yet written to the app
  let timer = 0, busy = false, warned = false;

  // debug log (Terminal in Settings). core.js does not exist yet while this file loads, so early lines wait in window.__sdBoot and core.js picks them up.
  const log = (m, l) => {
    try {
      const S = window.SpeedDial;
      if (S && S.log) S.log('store', m, l);
      else (window.__sdBoot = window.__sdBoot || []).push(['store', m, l || 'i', Date.now()]);
    } catch (e) { /* the logger itself must never throw (and cannot log its own failure) */ }
  };
  const say = m => { try { window.SpeedDial && window.SpeedDial.toast(m); } catch (e) { /* toast is only a courtesy; the failure is already in the log */ } };
  const sched = ms => { if (!timer) timer = setTimeout(flush, ms); };

  async function flush() {
    if (timer) { clearTimeout(timer); timer = 0; }
    if (!nat || busy || !dirty.size) return;
    busy = true;
    const keys = Array.from(dirty);
    dirty.clear();
    const o = {};
    keys.forEach(k => { try { o[k] = JSON.parse(cache[k]); } catch (e) { log('could not save ' + k + ' to the app (bad JSON): ' + (e && e.message || e), 'e'); } });
    let ok = true;
    try { await nat.setMany(o); log('saved ' + keys.length + ' key(s) to the app'); }
    catch (e) {
      ok = false;
      log('save to the app FAILED' + (e && e.code ? ' (' + e.code + ')' : '') + ': ' + (e && e.message || e), 'e');
      keys.forEach(k => dirty.add(k));   // try again later
      if (!warned) { warned = true; say(e && e.code === 'QuotaExceeded' ? 'Speed Dial: PDA storage is full' : 'Speed Dial: could not save to PDA storage'); }
    }
    busy = false;
    if (dirty.size) sched(ok ? 400 : 15000);
  }

  window.__sdInit = async () => {
    const n = window.__sdNative;
    if (!n || typeof n.loadAll !== 'function' || typeof n.setMany !== 'function') { log('no native storage in this PDA: localStorage only', 'w'); return; }   // old PDA: stay on localStorage
    const all = (await n.loadAll()) || {};
    Object.keys(all).forEach(k => { if (mine(k) && all[k] != null) cache[k] = JSON.stringify(all[k]); });
    const move = {};
    try {   // first run: copy what is in localStorage but not yet in the app
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !mine(k) || k in cache) continue;
        const raw = localStorage.getItem(k);
        try { move[k] = JSON.parse(raw); cache[k] = raw; } catch (e) { log('skipped ' + k + ' (not valid JSON in localStorage)', 'w'); }
      }
    } catch (e) { log('could not read localStorage for the first-run copy: ' + (e && e.message || e), 'w'); }
    nat = n;
    log('native storage on: ' + Object.keys(all).filter(mine).length + ' key(s) loaded, ' + Object.keys(move).length + ' copied from localStorage');
    Object.keys(move).forEach(k => dirty.add(k));
    if (dirty.size) await flush();
  };

  window.__sdStore = {
    get: k => (nat && mine(k)) ? (k in cache ? cache[k] : null) : ls.get(k),
    set(k, s) {
      if (!PFX.some(p => k.indexOf(p) === 0) && !odd.has(k)) { odd.add(k); log('key "' + k + '" has no known prefix: it stays in localStorage only (name it speedDial.<n>)', 'w'); }
      ls.set(k, s);   // copy in the browser too
      if (nat && mine(k)) { cache[k] = s; dirty.add(k); sched(500); }
    },
    get native() { return !!nat; },
    flush
  };

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', () => { flush(); });
})();

} catch (e) { console.error('Speed Dial: store.js:', e); try { window.SpeedDial && window.SpeedDial.log('boot', 'store.js failed: ' + (e && e.message || e), 'e'); } catch (x) { /* log not ready yet */ } }

    if (typeof window.__sdInit === 'function') { const init = window.__sdInit; window.__sdInit = null; try { await init(); } catch (e) {} }
try {
// Speed Dial core v0.13.0
// One floating circle. Tap it and one circle per module fans out. Tap a module circle to open or close its floating window.
// A module may also be a shortcut circle: { emoji, href } opens a page on tap instead of a panel.
// At most 3 modules are shown as circles (default: Item Dock, Travel Helper, Targets). Everything else (calculator, your shortcuts, new modules)
// lives in the pinned "Show More" circle. The Settings module (pinned, always last) lets you choose which 3 stay on screen and drag them into your own order.
// A module only builds its UI, timers and API calls while its window is open (lazy).
// A feature (SD.feature) runs on a Torn page itself, outside the circles. It only runs while it is switched on in Settings and the page matches.
(function () {
  'use strict';
  if (window.SpeedDial) return;

  const SD = window.SpeedDial = { mods: [], key: '', hasKey: false, started: false, ver: '0.13.0' };
  const POS = 'speedDial.pos1';
  const DK = 'speedDial.data1';
  const TTL = 30000;
  const FAB = 40;              // main circle (px)
  const MOD = 36;              // module circles (px)
  const OFF = (FAB - MOD) / 2; // centres a module circle under the main one
  const GAP = MOD + 10;        // distance between circle tops
  const LAY = 'speedDial.layout1';   // { order: [ids], front: [ids] | null }

  // ---------- debug log (the Terminal page in Settings) ----------
  // Kept in memory only: a ring buffer of the last LOGMAX lines. No timer, no API call, nothing is drawn unless the Terminal page is open.
  // It reaches storage only when you tap Save in Terminal (key speedDial.log1). Anything that looks like your API key is masked before it is stored.
  // New modules and features: call SD.log('tag', 'message') for what they do, and SD.log('tag', 'message', 'w') (warn) or 'e' (error) when something goes wrong,
  // especially inside a catch block, so errors are never silent.
  const LOGMAX = 300;
  const DBG = 'speedDial.dbg1';     // { on: true | false }, logging switch (default on)
  const LOGK = 'speedDial.log1';    // the saved copy of the log
  const buf = [];
  const subs = new Set();
  let dbgOn = true;
  const mask = s => {
    s = String(s);
    if (SD.key && SD.key.length > 4) s = s.split(SD.key).join('***');
    return s.replace(/([?&]key=)[^&\s"']+/gi, '$1***');
  };
  const tell = e => subs.forEach(f => { try { f(e); } catch (x) { /* a broken subscriber must not break logging; cannot log here (would loop) */ } });
  // lvl: 'i' (default) | 'w' | 'e'; ts is only used for lines that waited in window.__sdBoot
  SD.log = (tag, msg, lvl, ts) => {
    if (!dbgOn) return;
    let m;
    try { m = typeof msg === 'string' ? msg : ((msg && msg.message) || JSON.stringify(msg)); } catch (x) { m = String(msg); }
    const e = { t: ts || Date.now(), g: String(tag).slice(0, 10), m: mask(m).slice(0, 400), l: (lvl === 'e' || lvl === 'w') ? lvl : 'i' };
    buf.push(e);
    if (buf.length > LOGMAX) buf.shift();
    tell(e);
  };
  SD.logs = () => buf.slice();
  SD.logSub = fn => { subs.add(fn); return () => subs.delete(fn); };   // fn(entry) per new line, fn(null) after Clear; returns the unsubscribe function
  SD.logClear = () => { buf.length = 0; tell(null); };
  SD.logIsOn = () => dbgOn;
  SD.logSet = on => {
    on = !!on;
    if (!on) SD.log('log', 'logging switched off');
    dbgOn = on;
    SD.write(DBG, { on });
    if (on) SD.log('log', 'logging switched on');
  };
  SD.logSave = () => { SD.write(LOGK, buf.slice()); return buf.length; };
  SD.logSaved = () => { const v = SD.read(LOGK, []); return Array.isArray(v) ? v : []; };
  SD.logUnsave = () => SD.write(LOGK, []);
  SD.logTime = t => new Date(t).toTimeString().slice(0, 8);
  // only errors that come from Speed Dial's own files (the loader names them speeddial/<file>); Torn's own errors are not our business
  const ours = s => /speeddial|speed-dial/i.test(String(s || ''));
  addEventListener('error', e => {
    if (ours(e.filename) || ours(e.error && e.error.stack)) SD.log('error', (e.message || 'error') + ' @ ' + String(e.filename || '').split('/').pop() + ':' + e.lineno, 'e');
  });
  addEventListener('unhandledrejection', e => {
    const r = e.reason;
    if (ours(r && r.stack)) SD.log('promise', 'unhandled: ' + ((r && r.message) || r), 'e');
  });

  // ---------- helpers shared by modules ----------
  // saved data goes through store.js (Torn PDA native storage, with localStorage as copy/fallback).
  // New modules/features: ALWAYS use SD.read / SD.write, never localStorage directly, and start the key with 'speedDial.' (see store.js PFX).
  SD.read = (k, def) => {
    try { const v = JSON.parse(window.__sdStore ? window.__sdStore.get(k) : localStorage.getItem(k)); return v == null ? def : v; }
    catch (e) { if (SD.log) SD.log('store', 'read ' + k + ' failed, default used: ' + e.message, 'w'); return def; }
  };
  SD.write = (k, v) => {
    try {
      const t = JSON.stringify(v);
      if (window.__sdStore) window.__sdStore.set(k, t); else localStorage.setItem(k, t);
      if (SD.log && k !== LOGK && k !== DBG) SD.log('store', 'write ' + k + ' (' + t.length + ' B)');
    } catch (e) { if (SD.log) SD.log('store', 'write ' + k + ' FAILED: ' + e.message, 'e'); }
  };
  dbgOn = (SD.read(DBG, {}) || {}).on !== false;
  (window.__sdBoot || []).forEach(a => SD.log(a[0], a[1], a[2], a[3]));   // lines store.js wrote before this file existed
  window.__sdBoot = null;
  SD.log('boot', 'core v' + SD.ver + ' loaded');
  // (SD.read exists from here on, so the logging switch and the lines that waited for core.js are handled now)
  SD.esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // minutes precision: 2h 14m
  SD.dur = sec => {
    const m = Math.ceil(Math.max(0, sec) / 60), h = Math.floor(m / 60);
    return h ? h + 'h ' + (m % 60) + 'm' : m + 'm';
  };
  // seconds precision: 5m 12s
  SD.durS = s => {
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? h + 'h ' + m + 'm' : m ? m + 'm ' + sec + 's' : sec + 's';
  };
  SD.hhmm = ms => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  // spin a refresh button while a promise runs (at least 0.7s so the tap is visible)
  SD.spin = (btn, p) => {
    const t0 = Date.now();
    btn.classList.add('spin');
    return Promise.resolve(p).catch(() => {}).then(() => {
      setTimeout(() => btn.classList.remove('spin'), Math.max(0, 700 - (Date.now() - t0)));
    });
  };
  // Edit / Done toggle button: same wording and the same green "on" look in every window
  SD.editBtn = (btn, on) => {
    btn.textContent = on ? 'Done' : 'Edit';
    btn.classList.toggle('sd-on', !!on);
  };
  // shared icons (full <svg> markup, styled by #sdial svg)
  SD.icons = {
    refresh: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.3-4.5L4 8.5"/><path d="M4 4v4.5h4.5"/><path d="M4 13a8 8 0 0 0 14.3 4.5L20 15.5"/><path d="M20 20v-4.5h-4.5"/></svg>'
  };
  SD.css = (id, text) => {
    if (document.getElementById(id)) return;
    const s = document.createElement('style');
    s.id = id; s.textContent = text;
    document.head.appendChild(s);
  };

  let toastEl = null, toastTimer;
  SD.toast = msg => {
    SD.log('toast', msg);
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.style.cssText = 'position:fixed;left:50%;bottom:72px;transform:translateX(-50%);max-width:82vw;z-index:2147483647;display:none;background:#1c1c1c;border:1px solid #3a3a3a;color:#e6e6e6;padding:8px 12px;border-radius:10px;font:12px/1.35 -apple-system,Roboto,sans-serif;text-align:center';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.style.display = 'none'; }, 3500);
  };

  // official API (throws on API errors)
  SD.api = async url => {
    const t0 = Date.now(), ep = String(url).replace(/^https:\/\/api\.torn\.com/, '');
    let j;
    try {
      const r = await fetch(url + (url.indexOf('?') > -1 ? '&' : '?') + 'key=' + SD.key);
      j = await r.json();
    } catch (e) {
      SD.log('api', ep + ' network/parse FAILED after ' + (Date.now() - t0) + 'ms: ' + (e && e.message), 'e');
      throw e;
    }
    if (j.error) {
      SD.log('api', ep + ' error ' + j.error.code + ': ' + (j.error.error || ''), 'e');
      const er = new Error(j.error.error || 'API error');
      er.api = true;                 // an answer from Torn (bad key, rate limit, ...), not a network failure
      er.code = j.error.code;
      throw er;
    }
    SD.log('api', ep + ' ok ' + (Date.now() - t0) + 'ms');
    return j;
  };

  // ---------- shared player data: ONE call for every module, cached 30s ----------
  let D = null, inflight = null, err = '', errCode = 0;
  const readCache = () => {
    try { const c = JSON.parse(sessionStorage.getItem(DK)); if (c && c.t) D = c; } catch (e) { SD.log('data', 'session cache unreadable, ignored: ' + e.message, 'w'); }
  };
  SD.peek = () => { if (!D) readCache(); return D; };
  SD.error = () => err;
  SD.errorCode = () => errCode;   // Torn API error code of the last failed status call (0 = none / network)

  // maxAge (ms, optional) = how old the cached status may be before it is fetched again (default TTL = 30s)
  SD.data = function (force, maxAge) {
    if (!SD.hasKey) return Promise.resolve(null);
    SD.peek();
    if (!force && D && Date.now() - D.t < (typeof maxAge === 'number' ? maxAge : TTL)) { SD.log('data', 'cache hit (' + Math.round((Date.now() - D.t) / 1000) + 's old)'); ring(); return Promise.resolve(D); }   // cache masih segar: tetap gambar outline
    if (inflight) return inflight;
    const t0 = Date.now();
    SD.log('data', 'fetching status' + (force ? ' (forced)' : ''));
    inflight = SD.api('https://api.torn.com/user/?selections=basic,travel,cooldowns,bars')   // SD.api logs the call and throws on API errors
      .then(j => {
        const st = j.status || {}, tr = j.travel || {}, c = j.cooldowns || {};
        const state = st.state || 'Okay';
        const desc = String(st.description || '').replace(/<[^>]*>/g, '').trim();
        const dest = tr.destination ? String(tr.destination) : '';
        const away = !!dest && dest.toLowerCase() !== 'torn';
        D = {
          t: Date.now(),
          state,
          level: typeof j.level === 'number' ? j.level : 0,   // 0 = unknown
          until: state === 'Okay' ? 0 : (st.until || 0),
          desc,
          dest,
          // outside Torn, or in a foreign hospital ("In a Mexican hospital ...")
          abroad: away || (state === 'Hospital' && /\bin an? [a-z' -]+ hospital\b/i.test(desc)),
          left: typeof tr.time_left === 'number' ? tr.time_left : Math.max(0, (tr.timestamp || 0) - Math.floor(Date.now() / 1000)),
          energy: j.energy || null,
          nerve: j.nerve || null,
          cd: { drug: c.drug || 0, medical: c.medical || 0, booster: c.booster || 0 }
        };
        err = ''; errCode = 0;
        SD.log('data', 'ok ' + (Date.now() - t0) + 'ms state=' + state + ' dest=' + (dest || '-') + ' abroad=' + D.abroad);
        try { sessionStorage.setItem(DK, JSON.stringify(D)); } catch (e) { SD.log('data', 'sessionStorage cache failed: ' + e.message, 'w'); }
        return D;
      })
      .catch(e => { errCode = (e && e.api && e.code) || 0; err = e && e.api ? (e.message || 'API error') : 'Network error'; SD.log('data', (e && e.api ? 'API error: ' : 'network error: ') + (e && e.message), 'e'); return D; })
      .then(r => { inflight = null; ring(); return r; });
    return inflight;
  };

  // home | flying | abroad | none
  SD.mode = d => {
    if (!d) return 'none';
    if (d.state === 'Traveling') return 'flying';
    return (d.abroad || d.state === 'Abroad') ? 'abroad' : 'home';
  };

  // ---------- module registry ----------
  // m = { id, label, icon (inner SVG markup, 24x24, stroke style) | emoji, width, mount(ctx) -> { unmount() }?, href?, ord? }
  // emoji replaces the SVG icon; href makes the circle a shortcut (no panel); ord sorts circles (default 0, same ord = order of registering)
  // pinned: true keeps the circle last and always visible (Show More and Settings); pinned circles sit after the 3 on-screen ones, sorted by ord
  // more: true marks the Show More circle itself (it gets a dot while a window of something inside Show More is open)
  SD.register = m => {
    SD.mods.push(m);
    SD.log('mod', 'register ' + m.id);
    if (stack) refreshCircles();
  };
  SD.unregister = id => {
    const i = SD.mods.findIndex(m => m.id === id);
    if (i < 0) return;
    const m = SD.mods[i];
    SD.log('mod', 'unregister ' + id);
    closeWin(id);
    SD.mods.splice(i, 1);
    const ly = layout0();                       // forget a removed module in the saved layout
    ly.order = ly.order.filter(x => x !== id);
    if (ly.front) ly.front = ly.front.filter(x => x !== id);
    SD.write(LAY, ly);
    if (stack) refreshCircles();
  };

  // ---------- menu layout: your order + which modules stay on screen (edited in Settings) ----------
  // front = ids of the (max 3) modules shown as circles. null = never chosen yet, so the default three are used.
  // Every other module is listed in Show More. (An old saved "hidden" list is ignored: nothing is hidden any more.)
  const MAXF = 3;
  const HOME = ['itemdock', 'travel', 'targets'];   // default on-screen modules
  SD.maxFront = MAXF;
  let LY = null;
  const layout0 = () => {
    if (!LY) {
      const v = SD.read(LAY, {}) || {};
      const ids = a => (Array.isArray(a) ? a.filter(x => typeof x === 'string') : []);
      LY = { order: ids(v.order), front: Array.isArray(v.front) ? ids(v.front) : null };
    }
    return LY;
  };
  // every module except pinned ones, in menu order.
  // modules you never placed (new ones) come after the placed ones, in their default order.
  SD.ordered = () => {
    const ly = layout0();
    return SD.mods.map((m, i) => [m, i]).filter(x => !x[0].pinned)
      .sort((a, b) => {
        const ia = ly.order.indexOf(a[0].id), ib = ly.order.indexOf(b[0].id);
        if (ia > -1 && ib > -1) return ia - ib;
        if (ia > -1) return -1;
        if (ib > -1) return 1;
        return ((a[0].ord || 0) - (b[0].ord || 0)) || (a[1] - b[1]);
      }).map(x => x[0]);
  };
  // modules shown as circles (max 3), in menu order
  SD.front = () => {
    const ly = layout0(), ids = ly.front || HOME;
    return SD.ordered().filter(m => ids.indexOf(m.id) > -1).slice(0, MAXF);
  };
  // modules inside Show More, in menu order
  SD.more = () => {
    const f = SD.front().map(m => m.id);
    return SD.ordered().filter(m => f.indexOf(m.id) < 0);
  };
  SD.isFront = id => SD.front().some(m => m.id === id);
  // order / front = arrays of module ids (front: max 3). Ids of modules that are not loaded right now are kept as they were.
  SD.setLayout = (order, front) => {
    const ly = layout0();
    const here = id => SD.mods.some(m => m.id === id);
    LY = {
      order: order.concat(ly.order.filter(id => order.indexOf(id) < 0 && !here(id))),
      front: front.filter(here).slice(0, MAXF).concat((ly.front || []).filter(id => !here(id)))
    };
    SD.write(LAY, LY);
    SD.log('layout', 'on screen: ' + LY.front.join(', ') + ' | order: ' + LY.order.length + ' module(s)');
    if (stack) refreshCircles();
  };

  // ---------- page features: things that run ON a Torn page, outside the circles ----------
  // f = { id, label, group (category: filter chip and section title on the Settings > Features page; default "Other"),
  //       info (short explanation shown behind the "!" in Settings), where (page name, for humans),
  //       was (id of an older feature this one was split off from: until the user flips this switch itself it follows the old switch),
  //       match (RegExp on location.pathname | function(location) | string path prefix | omitted = every page),
  //       def (true = on until the user switches it off; default off), start(ctx) -> { stop() } }
  // ctx = { alive, every(fn, ms), after(fn, ms), css(text), on(target, type, fn, opts) }  - all of these are undone when the feature stops.
  // start() may throw to refuse (for example when an old standalone copy is still running); the message is shown as a toast.
  const FK = 'speedDial.features1';   // { id: true | false }
  const fon = new Map();              // running features: id -> { timers, styles, ons, inst }
  let FS = null;
  const fstate = () => FS || (FS = SD.read(FK, {}) || {});
  SD.features = [];
  const fget = id => SD.features.find(f => f.id === id);

  SD.featureOn = id => {
    const v = fstate()[id], f = fget(id);
    if (typeof v === 'boolean') return v;
    const w = f && f.was ? fstate()[f.was] : undefined;
    return typeof w === 'boolean' ? w : !!(f && f.def);
  };
  SD.featureFits = id => {
    const f = fget(id);
    if (!f) return false;
    const m = f.match;
    try {
      if (!m) return true;
      if (typeof m === 'function') return !!m(location);
      if (typeof m.test === 'function') return m.test(location.pathname);   // RegExp
      return location.pathname.indexOf(String(m)) === 0;
    } catch (e) { return false; }
  };
  SD.featureActive = id => fon.has(id);

  function fstop(id) {
    const me = fon.get(id);
    if (!me) return;
    fon.delete(id);
    me.timers.forEach(t => (t[0] === 'i' ? clearInterval(t[1]) : clearTimeout(t[1])));
    me.ons.forEach(o => { try { o[0].removeEventListener(o[1], o[2], o[3]); } catch (e) { SD.log('feature', id + ' could not remove a listener: ' + e.message, 'w'); } });
    const inst = me.inst;
    me.inst = null;
    if (inst && typeof inst.stop === 'function') { try { inst.stop(); } catch (e) { SD.log('feature', id + ' stop() threw: ' + e.message, 'e'); } }
    me.styles.forEach(st => st.remove());
    SD.log('feature', 'stop ' + id);
  }

  function fstart(f) {
    const me = { timers: [], styles: [], ons: [], inst: null };
    fon.set(f.id, me);
    const ok = () => fon.get(f.id) === me;
    const ctx = {
      get alive() { return ok(); },
      every: (fn, ms) => { if (!ok()) return 0; const id = setInterval(fn, ms); me.timers.push(['i', id]); return id; },
      after: (fn, ms) => { if (!ok()) return 0; const id = setTimeout(fn, ms); me.timers.push(['t', id]); return id; },
      css: text => { const st = document.createElement('style'); st.textContent = text; document.head.appendChild(st); me.styles.push(st); return st; },
      on: (t, type, fn, o) => { t.addEventListener(type, fn, o); me.ons.push([t, type, fn, o]); }
    };
    SD.log('feature', 'start ' + f.id);
    try { me.inst = f.start(ctx) || null; }
    catch (e) { fstop(f.id); SD.log('feature', f.id + ' refused/failed to start: ' + (e && e.message || e), 'w'); SD.toast(f.label + ': ' + (e && e.message || 'could not start')); }
  }

  // start or stop one feature so it matches "switched on AND on the right page"
  function fsync(f) {
    const want = SD.featureOn(f.id) && SD.featureFits(f.id);
    const run = fon.has(f.id);
    if (want && !run) fstart(f);
    else if (!want && run) fstop(f.id);
  }

  SD.feature = f => {
    if (!f || !f.id || typeof f.start !== 'function' || fget(f.id)) return;
    SD.features.push(f);
    if (SD.started) fsync(f);
  };
  SD.setFeature = (id, on) => {
    const f = fget(id);
    if (!f) return;
    fstate()[id] = !!on;
    SD.log('feature', id + ' switched ' + (on ? 'on' : 'off'));
    SD.write(FK, FS);
    fsync(f);
  };

  // ---------- hub UI ----------
  let root, fab, stack, wrap, P, menuOpen = false, WP = null;
  const circles = [];
  const wins = new Map();
  const zorder = [];
  const WIN = 'speedDial.win1';   // { moduleId: [x, y] }
  const WM = 4;

  const CSS = `
    #sdial{position:fixed;z-index:2147483647;font:13px/1.25 -apple-system,Roboto,sans-serif;-webkit-tap-highlight-color:transparent;
      --sd-bg:#1c1c1c;--sd-bg2:#242424;--sd-hov:#2e2e2e;--sd-line:#333;--sd-line2:#3a3a3a;
      --sd-text:#e6e6e6;--sd-text2:#d0d0d0;--sd-dim:#8a8a8a;
      --sd-red:#e5534b;--sd-redt:#f1807a;--sd-blue:#4a8fd9;--sd-bluet:#6fa8e8;--sd-yel:#d9a441;--sd-green:#85b200;
      --sd-h:34px;--sd-hi:36px;--sd-hl:38px;
      --st:var(--sd-text2)}
    #sdial *{box-sizing:border-box}
    #sdial svg{width:20px;height:20px;stroke:var(--sd-text2);fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
    #sdial button.sd-on.sd-on.sd-on{border-color:var(--sd-green);background:#25360f;color:#c6e66a}   /* triple class on purpose: must beat every module's own button rule */
    @keyframes sdspin{to{transform:rotate(360deg)}}
    #sdial .spin svg{animation:sdspin .8s linear infinite}
    #sdial .fab{position:relative;z-index:2000;touch-action:none;width:${FAB}px;height:${FAB}px;border-radius:50%;border:1px solid var(--sd-line2);background:var(--sd-bg);display:flex;align-items:center;justify-content:center;opacity:.85;box-shadow:0 2px 6px rgba(0,0,0,.4);padding:0}
    #sdial .fab.on{opacity:1;border-color:var(--sd-text2)}
    #sdial .fab.away{opacity:1;border-color:var(--sd-blue);box-shadow:0 0 0 2px rgba(74,143,217,.3),0 2px 6px rgba(0,0,0,.4)}
    #sdial .fab.hosp{opacity:1;border-color:var(--sd-yel);box-shadow:0 0 0 2px rgba(217,164,65,.3),0 2px 6px rgba(0,0,0,.4)}
    #sdial .fab.blk{opacity:1;border-color:var(--sd-red);box-shadow:0 0 0 2px rgba(229,83,75,.35),0 2px 6px rgba(0,0,0,.4)}
    #sdial .mod{position:absolute;z-index:2000;left:${OFF}px;width:${MOD}px;height:${MOD}px;border-radius:50%;border:1px solid var(--sd-line2);background:var(--sd-bg);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.4);padding:0;opacity:0;transform:scale(.5);pointer-events:none;transition:opacity .12s,transform .12s}
    #sdial .stack.show .mod{opacity:1;transform:scale(1);pointer-events:auto}
    #sdial[data-st="away"]{--st:var(--sd-blue)}
    #sdial[data-st="hosp"]{--st:var(--sd-yel)}
    #sdial[data-st="blk"]{--st:var(--sd-red)}
    #sdial .mod.act{border-color:var(--st)}
    #sdial .mod:active{background:var(--sd-hov)}
    #sdial .mod.sub::after{content:'';position:absolute;top:-1px;right:-1px;width:6px;height:6px;border-radius:50%;background:var(--st);border:1.5px solid var(--sd-bg)}
    #sdial .emo{font-size:18px;line-height:1;pointer-events:none}
    #sdial .lb{position:absolute;top:50%;left:${FAB}px;transform:translateY(-50%);white-space:nowrap;padding:3px 8px;border-radius:8px;background:var(--sd-bg);border:1px solid var(--sd-line);color:var(--sd-text);font-size:12px;pointer-events:none}
    #sdial.r .lb{left:auto;right:${FAB}px}
    #sdial.pnl .lb{display:none}
    #sdial .win{position:fixed;left:0;top:0;display:flex;flex-direction:column;overflow:hidden;background:var(--sd-bg);border:1px solid var(--st);border-radius:12px;box-shadow:0 6px 18px rgba(0,0,0,.5);color:var(--sd-text);max-height:calc(100vh - 8px)}
    #sdial .win.mv{will-change:transform}
    #sdial[data-st="away"] .win{box-shadow:0 0 0 2px rgba(74,143,217,.3),0 6px 18px rgba(0,0,0,.5)}
    #sdial[data-st="hosp"] .win{box-shadow:0 0 0 2px rgba(217,164,65,.3),0 6px 18px rgba(0,0,0,.5)}
    #sdial[data-st="blk"] .win{box-shadow:0 0 0 2px rgba(229,83,75,.35),0 6px 18px rgba(0,0,0,.5)}
    #sdial .win .tb{flex:0 0 var(--sd-h);height:var(--sd-h);display:flex;align-items:center;padding:0 0 0 10px;background:var(--sd-bg2);border-bottom:1px solid #2c2c2c;touch-action:none;cursor:grab;user-select:none;-webkit-user-select:none}
    #sdial .win.mv .tb{cursor:grabbing}
    #sdial .win .tt{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--sd-text2);pointer-events:none}
    #sdial .win .cl{flex:0 0 44px;width:44px;height:var(--sd-h);border:0;background:none;color:var(--sd-text2);font-size:14px;padding:0}
    #sdial .win .cl:active{background:var(--sd-hov)}
    #sdial .win .bd{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;touch-action:pan-y;padding:6px}
  `;

  let lastRing = null;
  function ring() {
    if (!fab) return;
    const d = D;
    const m = SD.mode(d);
    // one colour per situation: red = jail / federal, yellow = hospital (at home or abroad), blue = traveling / abroad
    const red = !!d && (d.state === 'Jail' || d.state === 'Federal');
    const hosp = !!d && d.state === 'Hospital';
    const away = !red && !hosp && (m === 'flying' || m === 'abroad');
    fab.classList.toggle('blk', red);
    fab.classList.toggle('hosp', hosp);
    fab.classList.toggle('away', away);
    root.dataset.st = red ? 'blk' : hosp ? 'hosp' : away ? 'away' : '';   // the window outline follows the main circle
    const now = root.dataset.st || 'none';
    if (now !== lastRing) { SD.log('ring', 'outline ' + (lastRing || '-') + ' -> ' + now + (d ? ' (state=' + d.state + ')' : ' (no data)')); lastRing = now; }
    if (!root.isConnected) SD.log('ring', 'WARNING: the Speed Dial element is not in the page any more', 'w');
  }

  function layout() {
    if (!root) return;
    P.x = Math.max(0, Math.min(P.x, innerWidth - FAB));
    P.y = Math.max(0, Math.min(P.y, innerHeight - FAB));
    root.style.left = P.x + 'px';
    root.style.top = P.y + 'px';
    const down = P.y < innerHeight / 2, right = P.x > innerWidth / 2;
    root.classList.toggle('r', right);
    circles.forEach((c, i) => {
      const off = GAP * (i + 1);
      c.b.style.top = (OFF + (down ? off : -off)) + 'px';
    });
  }

  function addCircle(m) {
    const b = document.createElement('button');
    b.className = 'mod';
    b.setAttribute('aria-label', m.label);
    b.innerHTML = (m.emoji ? '<span class="emo"></span>' : '<svg viewBox="0 0 24 24">' + m.icon + '</svg>') + '<span class="lb"></span>';
    if (m.emoji) b.querySelector('.emo').textContent = m.emoji;
    b.querySelector('.lb').textContent = m.label;
    b.addEventListener('click', () => { if (m.href) location.href = m.href; else pick(m); });
    stack.appendChild(b);
    circles.push({ m, b });
    layout();
  }

  // rebuild every circle in order (after a module is added or removed)
  function refreshCircles() {
    circles.splice(0).forEach(c => c.b.remove());
    SD.front()
      .concat(SD.mods.map((m, i) => [m, i]).filter(x => x[0].pinned)
        .sort((a, b) => ((a[0].ord || 0) - (b[0].ord || 0)) || (a[1] - b[1])).map(x => x[0]))
      .forEach(addCircle);
    markActive();
    layout();
  }

  function markActive() {
    circles.forEach(c => c.b.classList.toggle('act', wins.has(c.m.id)));
    const sub = SD.more().some(m => wins.has(m.id));   // something that lives in Show More is open
    circles.forEach(c => c.b.classList.toggle('sub', !!c.m.more && sub));
    root.classList.toggle('pnl', wins.size > 0);
  }

  const winPos = () => WP || (WP = SD.read(WIN, {}) || {});
  const clampN = (v, a, b) => Math.max(a, Math.min(v, b));

  // show the window where it wants to be (px, py) but always fully on screen; h = known height (skips the layout read while dragging)
  function place(me, h) {
    const el = me.win, ww = Math.min(me.w, innerWidth - 2 * WM);
    if (h === undefined) {
      el.style.width = ww + 'px';
      el.style.maxHeight = (innerHeight - 2 * WM) + 'px';
      h = el.offsetHeight;
    }
    me.cx = Math.round(clampN(me.px, WM, Math.max(WM, innerWidth - ww - WM)));
    me.cy = Math.round(clampN(me.py, WM, Math.max(WM, innerHeight - h - WM)));
    el.style.transform = 'translate3d(' + me.cx + 'px,' + me.cy + 'px,0)';
  }

  function front(me) {
    const i = zorder.indexOf(me);
    if (i > -1 && i === zorder.length - 1) return;
    if (i > -1) zorder.splice(i, 1);
    zorder.push(me);
    zorder.forEach((w, k) => { w.win.style.zIndex = k + 1; });
  }

  // stop everything the window's module started and throw its DOM away
  function closeWin(id) {
    const me = wins.get(id);
    if (!me) return;
    wins.delete(id);
    const i = zorder.indexOf(me);
    if (i > -1) zorder.splice(i, 1);
    me.timers.forEach(t => (t[0] === 'i' ? clearInterval(t[1]) : clearTimeout(t[1])));
    me.timers = [];
    if (me.ro) me.ro.disconnect();
    const inst = me.inst;
    me.inst = null;
    if (inst && typeof inst.unmount === 'function') { try { inst.unmount(); } catch (e) { SD.log('win', id + ' unmount() threw: ' + e.message, 'e'); } }
    me.win.remove();
    SD.log('win', 'close ' + id);
    if (root) markActive();
  }

  // drag by the title bar only; a plain tap on the bar just raises the window
  function bindWin(me) {
    const el = me.win, tb = el.querySelector('.tb');
    el.addEventListener('pointerdown', () => front(me), true);
    el.querySelector('.cl').addEventListener('click', () => closeWin(me.m.id));
    let g = null;
    tb.addEventListener('pointerdown', e => {
      if (e.button > 0 || e.target.closest('.cl')) return;
      g = { sx: e.clientX, sy: e.clientY, ox: me.cx, oy: me.cy, h: el.offsetHeight, nx: me.cx, ny: me.cy, raf: 0, moved: false };
      try { tb.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone: the drag simply does not start */ }
    });
    tb.addEventListener('pointermove', e => {
      if (!g) return;
      const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
      if (!g.moved && Math.abs(dx) + Math.abs(dy) > 3) { g.moved = true; el.classList.add('mv'); }
      if (!g.moved) return;
      g.nx = g.ox + dx;
      g.ny = g.oy + dy;
      if (g.raf) return;
      const gg = g;   // one move per frame, no layout read
      g.raf = requestAnimationFrame(() => { gg.raf = 0; me.px = gg.nx; me.py = gg.ny; place(me, gg.h); });
    });
    const end = () => {
      if (!g) return;
      const gg = g;
      g = null;
      cancelAnimationFrame(gg.raf);
      el.classList.remove('mv');
      if (!gg.moved) return;
      me.px = gg.nx;
      me.py = gg.ny;
      place(me, gg.h);
      me.px = me.cx;
      me.py = me.cy;
      winPos()[me.m.id] = [me.cx, me.cy];
      SD.write(WIN, WP);
    };
    tb.addEventListener('pointerup', end);
    tb.addEventListener('pointercancel', end);
  }

  function openWin(m, arg) {
    const el = document.createElement('div');
    el.className = 'win';
    el.innerHTML = '<div class="tb"><span class="tt"></span><button class="cl" aria-label="Close">\u2715</button></div><div class="bd"><div></div></div>';
    el.querySelector('.tt').textContent = m.label;
    const inner = el.querySelector('.bd').firstChild;
    const me = { m, win: el, w: m.width || 220, px: 0, py: 0, cx: 0, cy: 0, timers: [], inst: null, ro: null };
    const sv = winPos()[m.id];
    const saved = Array.isArray(sv) && isFinite(sv[0]) && isFinite(sv[1]);
    me.px = saved ? +sv[0] : (P.x > innerWidth / 2 ? P.x - me.w - 8 : P.x + 48);
    me.py = saved ? +sv[1] : P.y;
    wins.set(m.id, me);
    wrap.appendChild(el);
    front(me);
    bindWin(me);
    markActive();
    const ctx = {
      el: inner,
      arg,   // whatever SD.open(id, arg) was called with (or undefined)
      get alive() { return wins.get(m.id) === me; },
      every: (fn, ms) => { if (wins.get(m.id) !== me) return 0; const id = setInterval(fn, ms); me.timers.push(['i', id]); return id; },
      after: (fn, ms) => { if (wins.get(m.id) !== me) return 0; const id = setTimeout(fn, ms); me.timers.push(['t', id]); return id; },
      setWidth: w => { me.w = w; place(me); },
      close: () => closeWin(m.id)
    };
    SD.log('win', 'open ' + m.id);
    try { me.inst = m.mount(ctx) || null; } catch (e) { inner.textContent = 'Error: ' + e.message; SD.log('win', m.id + ' mount() threw: ' + e.message + (e.stack ? ' | ' + String(e.stack).split('\n').slice(1, 3).join(' | ') : ''), 'e'); }
    if (wins.get(m.id) !== me) return;
    place(me);
    // two windows never start on exactly the same spot
    for (let i = 0; i < 12 && Array.from(wins.values()).some(o => o !== me && Math.abs(o.cx - me.cx) < 10 && Math.abs(o.cy - me.cy) < 10); i++) {
      me.px = me.cx + 24;
      me.py = me.cy + 28;
      if (me.px + el.offsetWidth > innerWidth - WM) me.px = WM;
      if (me.py + el.offsetHeight > innerHeight - WM) me.py = WM;
      place(me);
    }
    if (typeof ResizeObserver === 'function') {
      me.ro = new ResizeObserver(() => { if (wins.get(m.id) === me) place(me); });
      me.ro.observe(el);
    }
  }

  function showMenu(on) {
    menuOpen = on;
    stack.classList.toggle('show', on);
    fab.classList.toggle('on', on);
  }
  function pick(m) {
    if (wins.has(m.id)) closeWin(m.id); else openWin(m);
  }
  // for modules that open other modules (Show More): open or close one window by module id
  // arg (optional) is handed to the module as ctx.arg; when given, an already open window is closed and opened again so it can start from it
  SD.open = (id, arg) => {
    const m = SD.mods.find(x => x.id === id);
    if (!m || m.href) return;
    if (wins.has(id)) { if (arg === undefined) return; closeWin(id); }
    openWin(m, arg);
  };
  SD.close = id => closeWin(id);
  SD.isOpen = id => wins.has(id);

  SD.start = function (opts) {
    if (SD.started) return;
    if (!document.body) { document.addEventListener('DOMContentLoaded', () => SD.start(opts)); return; }
    SD.started = true;
    SD.key = (opts && opts.apiKey) || '';
    SD.hasKey = !!SD.key && SD.key.indexOf('###') !== 0;
    P = Object.assign({ x: 8, y: 220 }, SD.read(POS, {}));

    SD.css('sd-core', CSS);
    root = document.createElement('div');
    root.id = 'sdial';
    root.innerHTML =
      '<button class="fab" aria-label="Speed Dial"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/></svg></button>' +
      '<div class="stack"></div><div class="wins"></div>';
    document.body.appendChild(root);
    // Torn's swipe handlers are kept away from our touches by the guard at the top of the loader/bundle (document-start)
    fab = root.querySelector('.fab');
    stack = root.querySelector('.stack');
    wrap = root.querySelector('.wins');
    refreshCircles();

    // drag + tap on the main circle
    let sx, sy, ox, oy, moved = false;
    fab.addEventListener('pointerdown', e => {
      sx = e.clientX; sy = e.clientY; ox = P.x; oy = P.y; moved = false;
      fab.setPointerCapture(e.pointerId);
    });
    fab.addEventListener('pointermove', e => {
      if (sx === undefined) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
      if (moved) { P.x = ox + dx; P.y = oy + dy; layout(); }
    });
    fab.addEventListener('pointerup', () => {
      sx = undefined;
      if (moved) {
        P.x = P.x < innerWidth / 2 ? 8 : innerWidth - 48; // snap to nearest edge
        layout(); SD.write(POS, P);
      } else { layout(); showMenu(!menuOpen); }   // the windows stay open; only the circles fold away
    });
    const refit = () => { layout(); wins.forEach(w => place(w)); };
    addEventListener('resize', refit);
    addEventListener('orientationchange', () => setTimeout(refit, 300));

    // pakai status terakhir dari cache dulu supaya outline langsung muncul di tiap halaman,
    // lalu satu pengecekan ringan per page load untuk menyegarkannya
    SD.log('boot', 'start: key=' + (SD.hasKey ? 'yes' : 'NO') + ', native storage=' + (window.__sdStore && window.__sdStore.native ? 'yes' : 'no') + ', page=' + location.pathname, SD.hasKey ? 'i' : 'w');

    // for the Terminal only (events, no timers): page changes inside Torn, and the moment our element leaves or re-enters the page
    const nav = type => SD.log('nav', type + ' -> ' + location.pathname + location.hash + ' | speed dial ' + (root.isConnected ? 'in page' : 'MISSING'), root.isConnected ? 'i' : 'w');
    addEventListener('hashchange', () => nav('hashchange'));
    addEventListener('popstate', () => nav('popstate'));
    try {
      let was = true;
      new MutationObserver(() => {
        const now = root.isConnected;
        if (now !== was) { was = now; SD.log('ui', now ? 'Speed Dial is back in the page' : 'Speed Dial was REMOVED from the page', now ? 'i' : 'w'); }
      }).observe(document.body, { childList: true });
    } catch (e) { SD.log('ui', 'could not watch the page: ' + e.message, 'w'); }

    SD.peek();
    ring();
    SD.data(false, 5000);   // cached outline first, then a fresh check unless the cache is under 5s old

    // Live status (always on, no switch): keeps the circle colour current WITHOUT reloading the page. One light API call per POLL while the page is visible.
    // It looks again right when the current status should end (hospital / jail timer, flight landing), 1.5 s after any tap on the page
    // (attacking, travelling, using items change your status), and when you come back to the app or the connection returns.
    (function live() {
      if (!SD.hasKey) { SD.log('live', 'no API key: not watching', 'w'); return; }
      const POLL = 5000;         // ms between checks while nothing is about to change
      const MIN = 2500;          // never fetch more often than this (shared cache, API rate limit)
      const key = d => d ? d.state + '|' + (d.abroad ? 'abroad' : '') + '|' + d.dest : '-';
      const endsAt = d => !d ? 0 : (d.state === 'Traveling' && d.left) ? d.t + d.left * 1000 : (d.until ? d.until * 1000 : 0);
      const gap = () => {
        const x = endsAt(SD.peek()), now = Date.now();
        if (!x) return POLL;
        if (x > now) return Math.max(3000, Math.min(POLL, x - now + 1500));   // check right after it should end
        return now - x < 120000 ? 3000 : POLL;                                // just overdue: look again soon
      };
      let next = Date.now() + gap(), busy = false;
      const tick = async () => {
        if (busy || document.hidden || Date.now() < next) return;
        busy = true;
        const was = key(SD.peek());
        try { await SD.data(false, MIN); } finally { busy = false; }
        const now = key(SD.peek());
        if (now !== was) SD.log('live', 'status changed: ' + was + ' -> ' + now);
        next = Date.now() + (SD.error() ? (SD.errorCode() === 2 ? 600000 : 60000) : gap());   // back off on API errors (bad key: 10 min)
      };
      const wake = () => { next = 0; tick(); };
      setInterval(tick, 1000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
      addEventListener('pageshow', wake);
      addEventListener('focus', wake);
      addEventListener('online', wake);
      document.addEventListener('click', () => { if (!SD.error()) next = Math.min(next, Date.now() + 1500); }, { capture: true, passive: true });   // not while backing off after an API error
      SD.log('live', 'always on: every ' + POLL / 1000 + 's while the page is visible');
    })();

    SD.features.forEach(fsync);   // switched-on features whose page matches start now
  };
})();

} catch (e) { console.error('Speed Dial: core.js:', e); try { window.SpeedDial && window.SpeedDial.log('boot', 'core.js failed: ' + (e && e.message || e), 'e'); } catch (x) { /* log not ready yet */ } }

try {
// Speed Dial module: Item Dock v0.9.4
// Tap an item, confirm, and it is used in place. Own items show stock; faction armoury items do not.
// In Edit mode, drag the handle to reorder (the list scrolls by itself near its edges). A long list scrolls inside the panel. Nothing runs until the panel is opened, except on
// Torn's own Items page, where item counts are read from the page (live, no API cache).
(function () {
  'use strict';
  const SD = window.SpeedDial;
  if (!SD) return;

  const LS = 'itemDock.v2';   // same key as the standalone Item Dock, so your items carry over
  const LOW = 2;              // stock at or below this turns yellow
  const BLOCKED = ['Jail', 'Federal', 'Traveling'];
  const LABEL = { Hospital: 'In hospital', Jail: 'In jail', Federal: 'In federal jail', Traveling: 'Traveling', Abroad: 'Abroad' };
  const ID_KEYS = ['id', 'ID', 'item_id', 'itemID'];
  const QTY_KEYS = ['amount', 'available', 'quantity', 'qty'];

  const S = SD.read(LS, null) || { items: [] };
  if (!Array.isArray(S.items)) S.items = [];
  const save = () => SD.write(LS, S);

  let ui = null;              // helpers of the currently open panel (null while closed)
  let busy = false, lastExpiry = 0;
  const refresh = () => { if (ui) ui.fillList(); };

  // ---------- stock (own items only, loaded when the panel is opened) ----------
  // okCat = inventory categories that loaded fine (so "Out" is only trusted for those)
  // Torn caches /user/inventory for up to 1 hour per category, so right after you use an item the API
  // still reports the old number. We remember our own uses (adj) and keep showing them until the API
  // number changes (it has caught up) or the cache window has passed. Saved with SD.write (native storage) so a page
  // change does not bring the old number back.
  // Counts read from Torn's Items page are live, so they are stored with base = null: they stay until
  // the window passes (and are corrected by later uses), whatever the cached API says.
  const ADJK = 'itemDock.adj', ADJ_TTL = 65 * 60 * 1000;
  let adj = SD.read(ADJK, null) || {};
  const saveAdj = () => SD.write(ADJK, adj);
  const stock = { raw: null, own: null, t: 0, warned: false, okCat: {} };

  function tally(node, map) {
    if (Array.isArray(node)) { node.forEach(n => tally(n, map)); return map; }
    if (node && typeof node === 'object') {
      const idk = ID_KEYS.find(k => typeof node[k] === 'number' || /^\d+$/.test(node[k] || ''));
      const qk = QTY_KEYS.find(k => typeof node[k] === 'number');
      if (idk && qk) map[+node[idk]] = (map[+node[idk]] || 0) + node[qk];
      else Object.values(node).forEach(v => tally(v, map));
    }
    return map;
  }

  async function apiGet(url) {
    const m = tally(await SD.api(url), {});
    return Object.keys(m).length ? m : null;
  }

  // item catalog (one API call, kept in memory): used for item types and for the Add search
  let catalog = null;
  async function loadCatalog() {
    if (catalog) return catalog;
    const j = await SD.api('https://api.torn.com/torn/?selections=items');
    catalog = Object.entries(j.items || {}).map(([id, v]) => ({ id: +id, name: v.name, type: v.type, l: String(v.name).toLowerCase() }));
    return catalog;
  }

  async function ensureTypes() {
    if (S.items.every(i => i.type)) return;
    const types = {};
    (await loadCatalog()).forEach(c => { types[c.id] = c.type; });
    S.items.forEach(i => { if (!i.type && types[i.id]) i.type = types[i.id]; });
    save();
  }

  function applyAdj() {
    if (!stock.raw) { stock.own = null; return; }
    stock.own = Object.assign({}, stock.raw);
    const now = Date.now();
    let dirty = false;
    Object.keys(adj).forEach(id => {
      const a = adj[id];
      if (now - a.t > ADJ_TTL || (a.base !== null && (stock.raw[id] || 0) !== a.base)) { delete adj[id]; dirty = true; }  // expired, or the API caught up
      else stock.own[id] = a.n;
    });
    if (dirty) saveAdj();
  }

  function bump(id, d) {
    if (!stock.raw) return;
    const n = Math.max(0, (stock.own[id] || 0) + d);
    adj[id] = { n, base: adj[id] ? adj[id].base : (stock.raw[id] || 0), t: Date.now() };
    stock.own[id] = n;
    saveAdj();
    refresh();
  }

  // stock count for an own item, or null when we do not reliably know it
  function qtyOf(it) {
    if (it.fac || !stock.own || !stock.okCat[it.type]) return null;
    return stock.own[it.id] || 0;
  }
  const outOf = it => qtyOf(it) === 0;

  async function loadStock(force) {
    if (!SD.hasKey || !S.items.length) return;
    if (!force && Date.now() - stock.t < 30000) return;
    stock.t = Date.now();
    const errs = [];
    try { await ensureTypes(); } catch (e) { errs.push('items: ' + e.message); }

    const own = S.items.filter(i => !i.fac && i.type);
    if (own.length) {
      const merged = {}, okCat = {};
      for (const cat of Array.from(new Set(own.map(i => i.type)))) {
        try {
          const m = await apiGet('https://api.torn.com/v2/user/inventory?cat=' + encodeURIComponent(cat));
          if (m) { Object.assign(merged, m); okCat[cat] = true; }
        } catch (e) { errs.push(cat + ': ' + e.message); }
      }
      stock.raw = Object.keys(merged).length ? merged : null;
      stock.okCat = stock.raw ? okCat : {};
      applyAdj();
    }
    refresh();
    if (errs.length && !stock.warned) { stock.warned = true; SD.toast('Stock unavailable (' + errs.join('; ') + ')'); }
  }

  // ---------- status (shared data, no polling of its own) ----------
  // Items cannot be used while Jail / Federal / Traveling, or in hospital while abroad.
  // Hospital at home is fine (medical items still work).
  const dd = () => SD.peek() || { state: 'Okay', until: 0, desc: '', abroad: false, cd: {}, t: 0 };
  const isBlocked = () => { const d = dd(); return BLOCKED.indexOf(d.state) > -1 || (d.state === 'Hospital' && d.abroad); };
  const stLabel = () => {
    const d = dd();
    if (d.state === 'Traveling' && d.desc) return d.desc;
    if (d.state === 'Hospital' && d.abroad) return 'In hospital abroad';
    return LABEL[d.state] || d.state;
  };

  // ---------- use item in place (one tap = one use, same request Torn itself sends) ----------
  async function go(it) {
    if (busy) return;
    if (isBlocked()) return SD.toast("Can't use items: " + stLabel());
    if (outOf(it)) return SD.toast(it.name + ' is out of stock');
    busy = true;
    SD.toast('Using ' + it.name + '...');
    try {
      const m = document.cookie.match(/(?:^|;\s*)rfc_v=([^;]+)/);
      const url = '/item.php' + (m ? '?rfcv=' + m[1] : '');
      const r = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: it.fac ? 'step=useItem&fac=1&itemID=' + it.id : 'step=useItem&id=' + it.id + '&itemID=' + it.id
      });
      const t = await r.text();
      let msg = t, ok = r.ok;
      try {
        const j = JSON.parse(t);
        msg = j.text || j.msg || j.message || t;
        if (j.success === false || j.error) ok = false;
      } catch (e) { /* reply was not JSON: the raw text is used */ }
      msg = String(msg).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      SD.log('item', 'use ' + it.name + ' (id ' + it.id + ') HTTP ' + r.status + ' -> ' + (ok ? 'ok' : 'FAILED') + ': ' + msg.slice(0, 80), ok ? 'i' : 'w');
      SD.toast(msg ? msg.slice(0, 160) : 'Done');
      if (ok && !it.fac) bump(it.id, -1);                 // update the count right away
      SD.data(true).then(() => { if (ui) ui.status(); });  // fresh status + cooldowns
    } catch (e) {
      SD.log('item', 'use ' + it.name + ' threw: ' + e.message, 'e');
      SD.toast('Failed: ' + e.message);
    }
    busy = false;
  }

  // ---------- live counts from Torn's own Items page ----------
  // Only runs on /item.php. The page shows your real, current counts, so we copy them for the dock items.
  function readPageCounts() {
    const ids = {};
    S.items.forEach(i => { if (!i.fac) ids[String(i.id)] = true; });
    if (!Object.keys(ids).length) return 0;
    let changed = 0;
    const now = Date.now();
    document.querySelectorAll('li[data-item]').forEach(li => {
      const id = li.getAttribute('data-item');
      const q = li.querySelector('.qty');
      if (!ids[id] || !q) return;
      const v = parseInt(String(q.textContent).replace(/[^\d]/g, ''), 10);
      if (!(v >= 0)) return;
      const a = adj[id];
      if (a && a.base === null && a.n === v && now - a.t < 60000) return;
      if (!(a && a.base === null && a.n === v)) changed++;
      adj[id] = { n: v, base: null, t: now };
    });
    saveAdj();
    if (changed) { if (stock.raw) applyAdj(); refresh(); }
    return changed;
  }

  function startPageSync() {
    let timer = null;
    const run = () => {
      timer = null;
      const n = readPageCounts();
      if (n) SD.toast('Item Dock: synced ' + n + ' count' + (n > 1 ? 's' : '') + ' from your Items page');
    };
    const kick = () => { if (!timer) timer = setTimeout(run, 400); };
    const inList = node => { const t = node.nodeType === 1 ? node : node.parentElement; return !!(t && t.closest && t.closest('li[data-item]')); };
    new MutationObserver(recs => {
      for (const r of recs) {
        if (inList(r.target)) return kick();
        for (const n of r.addedNodes) {
          if (n.nodeType === 1 && ((n.matches && n.matches('li[data-item]')) || (n.querySelector && n.querySelector('li[data-item]')))) return kick();
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    kick();
  }
  if (/^\/item\.php/.test(location.pathname)) startPageSync();

  // ---------- panel (built only when opened) ----------
  const CSS = `
    #sdial .idock .banner{display:none;margin-bottom:6px;padding:8px 10px;border-radius:8px;background:#3a2f1a;border:1px solid #6b5522;color:#f0d9a0;font-size:12px;line-height:1.35;text-align:center;white-space:pre-line}
    #sdial .idock .banner.blk{background:#3a1f1d;border-color:#6b2c28;color:#f1b5b0}
    #sdial .idock .banner.away{background:#2a3140;border-color:#2d4a73;color:#a9c3e8}
    #sdial .idock .banner.show{display:block}
    #sdial .idock .list{max-height:48vh;overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y}
    #sdial .idock.blocked .list{opacity:.45}
    #sdial .idock .cd{display:none;flex-wrap:wrap;gap:4px;margin-bottom:6px}
    #sdial .idock .chip{padding:3px 7px;border-radius:6px;background:var(--sd-bg2);border:1px solid var(--sd-line);color:var(--sd-text2);font-size:11px}
    #sdial .idock .ir{display:flex;align-items:center;min-height:40px;box-sizing:border-box;padding:6px 10px;border-radius:8px;color:var(--sd-text);margin-bottom:3px;background:var(--sd-bg2);border-left:3px solid #4a8f4e;user-select:none;-webkit-user-select:none}
    #sdial .idock .ir:active{background:var(--sd-hov)}
    #sdial .idock .ir.out{border-left-color:var(--sd-red);cursor:not-allowed}
    #sdial .idock .ir.out:active{background:var(--sd-bg2)}
    #sdial .idock .ir.low{border-left-color:var(--sd-yel)}
    #sdial .idock .ir.fac{border-left-color:var(--sd-blue)}
    #sdial .idock .ir.low .qty{color:var(--sd-yel)}
    #sdial .idock .ir.drag{position:relative;z-index:5;background:var(--sd-line);box-shadow:0 4px 12px rgba(0,0,0,.55);opacity:1!important}
    #sdial .idock .ir .nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #sdial .idock .ir .grip{display:none;align-items:center;justify-content:center;width:32px;height:40px;margin:0 2px 0 -8px;touch-action:none;cursor:grab}
    #sdial .idock .ir .grip svg{width:18px;height:18px;stroke:var(--sd-dim)}
    #sdial .idock.edit .ir .grip{display:flex}
    #sdial .idock .ir.drag .grip svg{stroke:var(--sd-text)}
    #sdial .idock .ir .x{display:none;width:28px;height:28px;margin-right:-6px;border:0;background:none;color:var(--sd-red);font-size:18px;padding:0}
    #sdial .idock.edit .ir .x{display:block}
    #sdial .idock .qty{margin-left:8px;color:var(--sd-dim);font-size:12px;white-space:nowrap}
    #sdial .idock .ir.out .qty{color:var(--sd-red)}
    #sdial .idock .tag{margin-left:6px;padding:1px 6px;border-radius:6px;background:#2d3b52;color:#9bb8e0;font-size:10px}
    #sdial .idock.asking .list,#sdial .idock.asking .foot{display:none}
    #sdial .idock .confirm{display:none;padding:8px 6px 4px;text-align:center;color:var(--sd-text)}
    #sdial .idock.asking .confirm{display:block}
    #sdial .idock .confirm .q{margin-bottom:10px;line-height:1.4}
    #sdial .idock .confirm .q b{display:block;font-size:14px;margin-top:2px}
    #sdial .idock .confirm .btns{display:flex;gap:6px}
    #sdial .idock .confirm button{flex:1;height:var(--sd-hl);border-radius:8px;border:1px solid var(--sd-line);background:var(--sd-bg2);color:var(--sd-text2);font-size:13px}
    #sdial .idock .confirm button.ok{background:#2f6b34;border-color:#3f8a45;color:#fff}
    #sdial .idock .empty{color:var(--sd-dim);padding:10px;text-align:center}
    #sdial .idock .foot{display:flex;gap:6px;margin-top:4px;padding-top:6px;border-top:1px solid #2c2c2c}
    #sdial .idock .foot button{flex:1;height:var(--sd-h);border-radius:8px;border:1px solid var(--sd-line);background:var(--sd-bg2);color:var(--sd-text2);font-size:12px;padding:0 4px}
    #sdial .idock .foot button:active{background:var(--sd-hov)}
    #sdial .idock .foot .ico{flex:0 0 44px}
    #sdial .idock .addv{display:none}
    #sdial .idock.adding .addv{display:block}
    #sdial .idock.adding .list,#sdial .idock.adding .foot,#sdial .idock.adding .banner,#sdial .idock.adding .cd{display:none!important}
    #sdial .idock .ah{display:flex;align-items:center;gap:8px;margin-bottom:6px;color:var(--sd-text);font-size:13px}
    #sdial .idock .ah .back{flex:0 0 var(--sd-h);height:var(--sd-h);border-radius:8px;border:1px solid var(--sd-line);background:var(--sd-bg2);display:flex;align-items:center;justify-content:center;padding:0}
    #sdial .idock .ah .back:active{background:var(--sd-hov)}
    #sdial .idock .sq{box-sizing:border-box;width:100%;height:var(--sd-hi);border-radius:8px;border:1px solid var(--sd-line2);background:var(--sd-bg2);color:var(--sd-text);font-size:16px;padding:0 10px;margin-bottom:6px;outline:none}
    #sdial .idock .sq:focus{border-color:var(--sd-blue)}
    #sdial .idock .seg{display:flex;gap:6px;margin-bottom:6px}
    #sdial .idock .seg button{flex:1;height:var(--sd-h);border-radius:8px;border:1px solid var(--sd-line);background:var(--sd-bg2);color:var(--sd-text2);font-size:12px;padding:0}
    #sdial .idock .seg button.on{background:#2a3140;border-color:var(--sd-blue);color:#fff}
    #sdial .idock .res{max-height:38vh;overflow-y:auto;touch-action:pan-y}
    #sdial .idock .res .r{display:flex;align-items:center;gap:8px;min-height:44px;padding:4px 10px;border-radius:8px;margin-bottom:3px;background:var(--sd-bg2);border-left:3px solid var(--sd-blue)}
    #sdial .idock .res .r:active{background:var(--sd-hov)}
    #sdial .idock .res .r.have{opacity:.5}
    #sdial .idock .res .t{flex:1;min-width:0}
    #sdial .idock .res .nm{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #sdial .idock .res .ty{display:block;color:var(--sd-dim);font-size:11px}
    #sdial .idock .res .pl{color:#7fd08a;font-size:18px;line-height:1}
    #sdial .idock .res .hint{color:var(--sd-dim);padding:12px 6px;text-align:center;font-size:12px}
  `;

  function mount(ctx) {
    SD.css('sd-itemdock', CSS);
    const el = ctx.el;
    el.className = 'idock';
    el.innerHTML =
      '<div class="banner"></div><div class="cd"></div>' +
      '<div class="confirm"><div class="q"></div><div class="btns"><button class="no">Cancel</button><button class="ok">Use</button></div></div>' +
      '<div class="addv">' +
        '<div class="ah"><button class="back" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button><span>Add item</span></div>' +
        '<input class="sq" type="text" placeholder="Search item name" autocomplete="off" autocapitalize="off" spellcheck="false">' +
        '<div class="seg"><button class="s1 on">My items</button><button class="s2">Faction</button></div>' +
        '<div class="res"></div>' +
      '</div>' +
      '<div class="list"></div>' +
      '<div class="foot"><button class="add">Add</button><button class="edit">Edit</button><button class="sync ico" aria-label="Refresh">' + SD.icons.refresh + '</button></div>';
    const banner = el.querySelector('.banner');
    const cdEl = el.querySelector('.cd');
    const list = el.querySelector('.list');
    let pendingItem = null, drag = null;

    // ----- list -----
    function fillList() {
      if (drag) return;                 // a refresh must not wipe the row being dragged
      const keep = list.scrollTop;      // rebuilding the list must not jump it back to the top
      list.innerHTML = '';
      if (!S.items.length) {
        list.innerHTML = '<div class="empty">No items yet.<br>Tap Add.</div>';
        return;
      }
      S.items.forEach((it, idx) => {
        const row = document.createElement('div');
        row.className = 'ir';
        row.innerHTML = '<span class=\"grip\" aria-label=\"Drag to reorder\"><svg viewBox=\"0 0 24 24\"><line x1=\"5\" y1=\"8\" x2=\"19\" y2=\"8\"/><line x1=\"5\" y1=\"12\" x2=\"19\" y2=\"12\"/><line x1=\"5\" y1=\"16\" x2=\"19\" y2=\"16\"/></svg></span><span class="nm"></span><span class="qty"></span><button class="x" aria-label="Remove">\u00d7</button>';
        const n = qtyOf(it);
        if (n !== null) {
          row.querySelector('.qty').textContent = n === 0 ? 'Out' : '\u00d7' + n;
          if (n === 0) { row.classList.add('out'); row.style.opacity = '.6'; }
          else if (n <= LOW) row.classList.add('low');
        }
        row.querySelector('.nm').textContent = it.name;
        if (it.fac) {
          row.classList.add('fac');
          const tag = document.createElement('span');
          tag.className = 'tag';
          tag.textContent = 'Faction';
          row.querySelector('.nm').appendChild(tag);
        }
        row.addEventListener('click', e => {
          if (e.target.classList.contains('x')) {
            S.items.splice(idx, 1); save(); fillList();
          } else if (!el.classList.contains('edit')) {
            if (outOf(it)) return SD.toast(it.name + ' is out of stock');
            ask(it);
          }
        });
        row._it = it;
        bindDrag(row);
        list.appendChild(row);
      });
      list.scrollTop = keep;
    }

    // ----- drag the grip handle (edit mode only) to reorder; the list scrolls itself near its top/bottom edge -----
    function bindDrag(row) {
      const grip = row.querySelector('.grip');
      grip.addEventListener('pointerdown', e => {
        if (e.button > 0 || !el.classList.contains('edit')) return;
        e.preventDefault();
        drag = { row, startY: e.clientY, y: e.clientY, raf: 0 };
        try { grip.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone: the drag simply does not start */ }
        row.classList.add('drag');
        drag.raf = requestAnimationFrame(autoScroll);
      });
      grip.addEventListener('pointermove', e => { if (drag && drag.row === row) { drag.y = e.clientY; moveDrag(); } });
      grip.addEventListener('pointerup', endDrag);
      grip.addEventListener('pointercancel', endDrag);
    }

    function moveDrag() {
      const row = drag.row;
      const h = row.offsetHeight + 3;
      let dy = drag.y - drag.startY;
      while (dy > h / 2 && row.nextElementSibling) {
        list.insertBefore(row.nextElementSibling, row); drag.startY += h; dy -= h;
      }
      while (dy < -h / 2 && row.previousElementSibling) {
        list.insertBefore(row.previousElementSibling, row.nextSibling); drag.startY -= h; dy += h;   // move the neighbour, not the dragged row
      }
      row.style.transform = 'translateY(' + dy + 'px)';
    }

    const EDGE = 44;   // px from the list's top/bottom edge where scrolling starts
    function autoScroll() {
      if (!drag) return;
      if (!ctx.alive) { drag = null; return; }
      const r = list.getBoundingClientRect();
      let v = 0;
      if (drag.y < r.top + EDGE) v = -(2 + 10 * Math.min(1, (r.top + EDGE - drag.y) / EDGE));
      else if (drag.y > r.bottom - EDGE) v = 2 + 10 * Math.min(1, (drag.y - (r.bottom - EDGE)) / EDGE);
      if (v) {
        const before = list.scrollTop;
        list.scrollTop = before + v;
        const moved = list.scrollTop - before;
        if (moved) { drag.startY -= moved; moveDrag(); }   // the row keeps following the finger
      }
      drag.raf = requestAnimationFrame(autoScroll);
    }

    function endDrag() {
      if (!drag) return;
      cancelAnimationFrame(drag.raf);
      const order = Array.from(list.children).map(r => r._it).filter(Boolean);
      drag = null;
      if (order.length === S.items.length) { S.items = order; save(); }
      fillList();
    }

    // ----- confirm -----
    function ask(it) {
      if (isBlocked()) return SD.toast("Can't use items: " + stLabel());
      if (outOf(it)) return SD.toast(it.name + ' is out of stock');
      pendingItem = it;
      el.querySelector('.q').innerHTML = 'Use this item?<b></b>';
      const sq = qtyOf(it);
      el.querySelector('.q b').textContent = it.name + (it.fac ? ' (Faction armoury)' : '') + (sq !== null ? ' \u00b7 stock ' + sq : '');
      el.classList.add('asking');
    }
    function endAsk() { pendingItem = null; el.classList.remove('asking'); }
    el.querySelector('.no').addEventListener('click', endAsk);
    el.querySelector('.ok').addEventListener('click', () => {
      const it = pendingItem;
      endAsk();
      if (it) go(it);
    });

    // ----- status banner + cooldown chips -----
    function updateBanner() {
      const d = dd(), blk = isBlocked();
      if (d.state === 'Okay') { banner.classList.remove('show', 'blk', 'away'); return; }
      let txt = stLabel();
      if (d.until && d.state !== 'Hospital') {
        const s = d.until - Math.floor(Date.now() / 1000);
        if (s > 0) txt += ' \u00b7 ' + SD.durS(s) + ' left';
      }
      if (blk) txt += "\nItems can't be used right now";
      if (banner.textContent !== txt) banner.textContent = txt;
      banner.classList.add('show');
      // same colours as the main circle: red = jail / federal, yellow = hospital, blue = traveling / abroad (the text says when items are blocked)
      const red = d.state === 'Jail' || d.state === 'Federal', md = SD.mode(d);
      banner.classList.toggle('blk', red);
      banner.classList.toggle('away', !red && d.state !== 'Hospital' && (md === 'flying' || md === 'abroad'));
    }

    function renderCd() {
      const d = dd(), el2 = Math.floor((Date.now() - d.t) / 1000);
      const parts = [['Drug', 'drug'], ['Med', 'medical'], ['Boost', 'booster']].map(([l, k]) => {
        const s = ((d.cd || {})[k] || 0) - el2;
        return s > 0 ? '<span class="chip">' + l + ' ' + SD.durS(s) + '</span>' : '';
      }).join('');
      if (cdEl._h === parts) return;
      cdEl._h = parts;
      cdEl.innerHTML = parts;
      cdEl.style.display = parts ? 'flex' : 'none';
    }

    function status() {
      const blk = isBlocked();
      el.classList.toggle('blocked', blk);
      if (blk) endAsk();
      updateBanner();
      renderCd();
    }

    // ----- add item view (search the catalog, tap a result to add) -----
    const addv = el.querySelector('.addv'), qIn = addv.querySelector('.sq'), res = addv.querySelector('.res');
    let addFac = false, added = false;

    function renderRes() {
      if (!catalog) return;
      const q = qIn.value.trim().toLowerCase();
      if (q.length < 2) { res.innerHTML = '<div class="hint">Type at least 2 letters</div>'; return; }
      const words = q.split(/\s+/);
      const hits = catalog.filter(c => words.every(w => c.l.indexOf(w) > -1))
        .sort((a, b) => (b.l.indexOf(q) === 0) - (a.l.indexOf(q) === 0) || a.l.localeCompare(b.l))
        .slice(0, 25);
      if (!hits.length) { res.innerHTML = '<div class="hint">No item found</div>'; return; }
      res.innerHTML = '';
      hits.forEach(c => {
        const have = S.items.some(i => i.id === c.id && !!i.fac === addFac);
        const r = document.createElement('div');
        r.className = 'r' + (have ? ' have' : '');
        r.innerHTML = '<span class="t"><span class="nm"></span><span class="ty"></span></span><span class="pl"></span>';
        r.querySelector('.nm').textContent = c.name;
        r.querySelector('.ty').textContent = c.type || '';
        r.querySelector('.pl').textContent = have ? '\u2713' : '+';
        if (!have) {
          r.addEventListener('click', () => {
            S.items.push({ id: c.id, name: c.name, type: c.type, fac: addFac });
            save(); added = true;
            SD.toast('Added ' + c.name);
            renderRes();
          });
        }
        res.appendChild(r);
      });
    }

    async function openAdd() {
      if (!SD.hasKey) return SD.toast('No API key available');
      added = false;
      el.classList.add('adding');
      qIn.value = '';
      qIn.focus();
      if (!catalog) {
        res.innerHTML = '<div class="hint">Loading items...</div>';
        try { await loadCatalog(); }
        catch (e) { res.innerHTML = '<div class="hint">Could not load items (' + SD.esc(e.message) + ')</div>'; return; }
      }
      if (ctx.alive) renderRes();
    }

    function closeAdd() {
      el.classList.remove('adding');
      qIn.blur();
      fillList();
      if (added) loadStock(true);   // show stock for the new items
    }

    qIn.addEventListener('input', renderRes);
    addv.querySelector('.back').addEventListener('click', closeAdd);
    [['.s1', false], ['.s2', true]].forEach(([sel, fac]) => {
      addv.querySelector(sel).addEventListener('click', () => {
        addFac = fac;
        addv.querySelector('.s1').classList.toggle('on', !fac);
        addv.querySelector('.s2').classList.toggle('on', fac);
        renderRes();
      });
    });

    // ----- footer buttons -----
    const syncBtn = el.querySelector('.sync');
    syncBtn.addEventListener('click', () => {
      SD.spin(syncBtn, Promise.all([loadStock(true), SD.data(true).then(() => { if (ctx.alive) status(); })])).then(() => {
        if (!ctx.alive) return;
        SD.toast(Object.keys(adj).length ? 'Refreshed. Torn caches stock for up to 1h; open your Items page to sync live counts' : 'Refreshed');
      });
    });
    el.querySelector('.add').addEventListener('click', openAdd);
    el.querySelector('.edit').addEventListener('click', e => {
      SD.editBtn(e.currentTarget, el.classList.toggle('edit'));
    });

    // ----- go -----
    ui = { fillList, status, after: ctx.after };
    fillList();
    status();
    loadStock(false);
    SD.data(false).then(() => { if (ctx.alive) status(); });

    // live countdowns only while the panel is open
    ctx.every(() => {
      renderCd();
      const d = dd();
      if (d.state === 'Okay') return;
      updateBanner();
      // when the timer runs out, re-check the status (at most every 15s)
      if (d.until && Date.now() / 1000 >= d.until && Date.now() - lastExpiry > 15000) {
        lastExpiry = Date.now();
        SD.data(true).then(() => { if (ctx.alive) status(); });
      }
    }, 1000);

    return { unmount() { ui = null; } };
  }

  SD.register({
    id: 'itemdock',
    label: 'Item Dock',
    width: 200,
    // bag
    icon: '<path d="M5.6 8h12.8l1.5 10.6a2 2 0 0 1-2 2.4H6.1a2 2 0 0 1-2-2.4L5.6 8z"/><path d="M8.5 8V7a3.5 3.5 0 0 1 7 0v1"/>',
    mount
  });
})();

} catch (e) { console.error('Speed Dial: modules/itemdock.js:', e); try { window.SpeedDial && window.SpeedDial.log('boot', 'modules/itemdock.js failed: ' + (e && e.message || e), 'e'); } catch (x) { /* log not ready yet */ } }

try {
// Speed Dial module: Travel Helper v0.6.4
// One-way and round-trip flight time, the time you will be back, and warnings when your status,
// bars or cooldowns clash with the trip. The Stocks box shows foreign shop stock with profit
// (YATA first, Prometheus as fallback). Tapping a country offers "Go to travel agency", which only opens
// Torn's travel page (nothing on that page is read or clicked). Below level 15 the whole panel shows only a red notice.
// Nothing runs until the panel is opened.
(function () {
  'use strict';
  const SD = window.SpeedDial;
  if (!SD) return;

  const LS = 'travelHelper.v1'; // same key as the standalone Travel Helper, so your settings carry over
  const S = Object.assign({ method: 0, book: false, stay: 0, sc: 'all', ss: 'profit' }, SD.read(LS, null) || {});
  const save = () => SD.write(LS, S);

  // flight times (minutes, one way) from the Torn wiki
  // a = without book, b = with "Mailing Yourself Abroad"; order: Standard, Airstrip, Private (WLT), Business
  const METHODS = ['Standard', 'Airstrip', 'Private', 'Business'];
  const STAYS = [0, 15, 30, 60, 120];
  const DEST = [
    { n: 'Mexico',         k: ['mexico'],               a: [26, 18, 13, 8],      b: [19, 14, 10, 6] },
    { n: 'Cayman Islands', k: ['cayman'],               a: [35, 25, 18, 11],     b: [26, 18, 13, 8] },
    { n: 'Canada',         k: ['canada'],               a: [41, 29, 20, 12],     b: [31, 22, 15, 9] },
    { n: 'Hawaii',         k: ['hawaii'],               a: [134, 94, 67, 40],    b: [100, 70, 50, 30] },
    { n: 'United Kingdom', k: ['united kingdom', 'uk'], a: [159, 111, 80, 48],   b: [119, 84, 60, 36] },
    { n: 'Argentina',      k: ['argentina'],            a: [167, 117, 83, 50],   b: [125, 87, 62, 37] },
    { n: 'Switzerland',    k: ['switzerland'],          a: [175, 123, 88, 53],   b: [132, 92, 66, 39] },
    { n: 'Japan',          k: ['japan'],                a: [225, 158, 113, 68],  b: [169, 118, 84, 51] },
    { n: 'China',          k: ['china'],                a: [242, 169, 121, 72],  b: [181, 127, 91, 54] },
    { n: 'UAE',            k: ['emirates', 'uae'],      a: [271, 190, 135, 81],  b: [203, 142, 102, 61] },
    { n: 'South Africa',   k: ['south africa'],         a: [297, 208, 149, 89],  b: [223, 156, 112, 67] }
  ];
  const oneWay = d => (S.book ? d.b : d.a)[S.method]; // minutes
  const findDest = name => {
    const s = String(name || '').toLowerCase();
    return DEST.find(d => d.k.some(k => s.includes(k)));
  };

  // ---------- foreign stocks ----------
  // YATA and Prometheus return the same shape: { stocks: { <code>: { update, stocks: [{ id, name, quantity, cost }] } }, timestamp }
  const CTRY = { mex: 'Mexico', cay: 'Cayman Islands', can: 'Canada', haw: 'Hawaii', uni: 'United Kingdom', arg: 'Argentina', swi: 'Switzerland', jap: 'Japan', chi: 'China', uae: 'UAE', sou: 'South Africa' };
  const SOURCES = [
    { n: 'YATA', u: 'https://yata.yt/api/v1/travel/export/' },
    { n: 'Prometheus', u: 'https://api.prombot.co.uk/api/travel' }
  ];
  const MVK = 'travelHelper.mv';          // cached market values: { t, v: { itemId: value } }
  const MV_TTL = 30 * 60 * 1000;
  const STK_TTL = 60 * 1000;
  const MVC = SD.read(MVK, null) || {};
  const mv = { t: MVC.t || 0, v: MVC.v || {}, err: '' };
  const stk = { rows: null, src: '', t: 0, ts: 0, note: '' };

  // PDA's own HTTP bridge (no CORS limits), plain fetch as a fallback; 12s timeout so the fallback source can kick in
  const http = url => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout')), 12000);
    const ok = v => { clearTimeout(t); res(v); }, bad = e => { clearTimeout(t); rej(e); };
    if (typeof PDA_httpGet === 'function') {
      PDA_httpGet(url).then(r => (r && r.status >= 400) ? bad(new Error('HTTP ' + r.status)) : ok(r.responseText), bad);
    } else {
      fetch(url).then(r => r.ok ? r.text().then(ok, bad) : bad(new Error('HTTP ' + r.status)), bad);
    }
  });

  function parseStocks(j) {
    const st = j && j.stocks, rows = [];
    if (!st || typeof st !== 'object') throw new Error('bad data');
    let ts = +j.timestamp || 0;
    Object.keys(st).forEach(c => {
      const arr = st[c] && st[c].stocks;
      if (!Array.isArray(arr)) return;
      if (!j.timestamp && st[c].update > ts) ts = st[c].update;
      arr.forEach(i => {
        if (i && i.id && i.name) rows.push({ c, id: +i.id, name: String(i.name), q: +i.quantity || 0, cost: +i.cost || 0 });
      });
    });
    if (!rows.length) throw new Error('empty');
    return { rows, ts };
  }

  // first source that answers with usable data wins
  async function fetchStocks() {
    const failed = [];
    for (const s of SOURCES) {
      try {
        const r = parseStocks(JSON.parse(await http(s.u)));
        SD.log('travel', 'stocks from ' + s.n + ': ' + r.rows.length + ' row(s)');
        return { rows: r.rows, ts: r.ts, src: s.n, t: Date.now(), note: failed.join(', ') };
      } catch (e) { failed.push(s.n + ' failed (' + e.message + ')'); SD.log('travel', 'stocks source ' + s.n + ' failed: ' + e.message, 'w'); }
    }
    throw new Error(failed.join(', '));
  }

  async function loadMV(force) {
    if (!SD.hasKey) return;
    if (!force && mv.t && Date.now() - mv.t < MV_TTL) return;
    const j = await SD.api('https://api.torn.com/torn/?selections=items');
    const v = {};
    Object.keys(j.items || {}).forEach(id => { const x = j.items[id]; if (x && x.market_value) v[id] = x.market_value; });
    mv.t = Date.now(); mv.v = v;
    SD.write(MVK, { t: mv.t, v });
  }

  const money = n => {
    const a = Math.abs(n), sg = n < 0 ? '-' : '';
    if (a >= 1e9) return sg + '$' + +(a / 1e9).toFixed(2) + 'b';
    if (a >= 1e6) return sg + '$' + +(a / 1e6).toFixed(2) + 'm';
    if (a >= 1e3) return sg + '$' + +(a / 1e3).toFixed(1) + 'k';
    return sg + '$' + Math.round(a);
  };

  // builds the Stocks box inside the panel; returns { refresh(force) }
  function setupStocks(ctx, el) {
    const btn = el.querySelector('.skb'), box = el.querySelector('.skbox');
    box.innerHTML =
      '<div class="skh"><button class="skback" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button><span>Stocks</span><button class="skr" aria-label="Refresh">' + SD.icons.refresh + '</button></div>' +
      '<div class="bar"><select class="sc"></select><button class="so" data-s="profit">Profit</button><button class="so" data-s="value">Value</button></div>' +
      '<div class="meta"></div><div class="skl"></div>';
    const sc = box.querySelector('.sc'), meta = box.querySelector('.meta'), skl = box.querySelector('.skl');
    sc.innerHTML = '<option value="all">All countries</option>' +
      Object.keys(CTRY).map(c => '<option value="' + c + '">' + CTRY[c] + '</option>').join('');
    sc.value = S.sc;
    let open = false, loading = false, err = '';

    function render() {
      box.querySelectorAll('.so').forEach(b => b.classList.toggle('on', b.dataset.s === S.ss));
      const info = [];
      if (loading) info.push('Loading...');
      if (stk.rows) {
        info.push(stk.src + (stk.ts ? ' \u00b7 updated ' + (Date.now() / 1000 - stk.ts < 90 ? 'just now' : SD.dur(Date.now() / 1000 - stk.ts) + ' ago') : ''));
        if (stk.note) info.push(stk.note);
      }
      if (err) info.push(err);
      if (stk.rows && !Object.keys(mv.v).length) info.push(SD.hasKey ? 'Values unavailable, profit hidden' : 'No API key: profit hidden');
      meta.textContent = info.join(' \u00b7 ');
      if (!stk.rows) { skl.innerHTML = ''; return; }

      const byValue = S.ss === 'value';
      let rows = stk.rows.filter(r => S.sc === 'all' || r.c === S.sc).map(r => {
        const v = mv.v[r.id] || 0;
        return { r, v, p: v ? v - r.cost : null };
      });
      const num = x => { const k = byValue ? (x.v || null) : x.p; return k == null ? -1e18 : k; };
      rows.sort((a, b) => ((b.r.q > 0) - (a.r.q > 0)) || (num(b) - num(a)));   // out-of-stock goes last
      const total = rows.length;
      rows = rows.slice(0, 60);

      skl.innerHTML = '';
      rows.forEach(x => {
        const d = document.createElement('div');
        const dir = x.p == null ? '' : (x.p >= 0 ? 'up' : 'dn');
        d.className = 'sk ' + dir + (x.r.q > 0 ? '' : ' out');
        d.innerHTML = '<div class="l1"><span class="nm">' + SD.esc(x.r.name) + '</span><span class="pf ' + dir + '">' +
          (x.p == null ? '-' : (x.p >= 0 ? '+' : '') + money(x.p)) + '</span></div><div class="l2"></div>';
        d.querySelector('.l2').textContent = (S.sc === 'all' ? (CTRY[x.r.c] || x.r.c.toUpperCase()) + ' \u00b7 ' : '') +
          (x.r.q > 0 ? '\u00d7' + x.r.q.toLocaleString() : 'out of stock') +
          ' \u00b7 cost ' + money(x.r.cost) + (x.v ? ' \u00b7 value ' + money(x.v) : '');
        skl.appendChild(d);
      });
      if (total > rows.length) {
        const n = document.createElement('div');
        n.className = 'meta'; n.style.textAlign = 'center';
        n.textContent = 'Top ' + rows.length + ' of ' + total + ' - pick a country to narrow down';
        skl.appendChild(n);
      }
    }

    async function loadStocks(force) {
      if (loading) return;
      if (!force && stk.rows && Date.now() - stk.t < STK_TTL) { render(); return; }
      loading = true; err = ''; render();
      const [rs] = await Promise.all([
        fetchStocks().then(v => v, e => { err = 'Stocks unavailable: ' + e.message; return null; }),
        loadMV(force).catch(e => { err = err || 'Values: ' + e.message; })
      ]);
      if (rs) Object.assign(stk, rs);
      loading = false;
      if (ctx.alive) render();
    }

    const setOpen = on => {
      open = on;
      el.classList.toggle('stk', on);
      if (ctx.setWidth) ctx.setWidth(on ? 300 : 230);
      if (on) loadStocks(false);
    };
    btn.addEventListener('click', () => setOpen(true));
    box.querySelector('.skback').addEventListener('click', () => setOpen(false));
    const skr = box.querySelector('.skr');
    skr.addEventListener('click', () => {
      SD.spin(skr, loadStocks(true)).then(() => { if (ctx.alive) SD.toast('Stocks updated'); });
    });
    sc.addEventListener('change', () => { S.sc = sc.value; save(); render(); });
    box.querySelectorAll('.so').forEach(b => b.addEventListener('click', () => { S.ss = b.dataset.s; save(); render(); }));

    return { refresh: force => (open ? loadStocks(force) : Promise.resolve()) };
  }

  let lastLoad = 0;
  const elapsed = () => { const d = SD.peek(); return d ? (Date.now() - d.t) / 1000 : 0; };

  // ---------- conflict checks ----------
  // secs = how long until you are back in Torn; depart = true when leaving from Torn now
  function warns(secs, depart) {
    const D = SD.peek(), w = [];
    if (!D) return w;
    const e = elapsed();
    if (depart && (D.state === 'Hospital' || D.state === 'Jail' || D.state === 'Federal')) {
      w.push(['bad', 'You are in ' + (D.state === 'Hospital' ? 'hospital' : 'jail') + " - you can't fly"]);
    }
    if (!depart && D.state === 'Hospital') {
      const left = D.until - Math.floor(Date.now() / 1000);
      w.push(['bad', 'In hospital abroad - you cannot fly back until released' + (left > 0 ? ' (' + SD.dur(left) + ')' : '')]);
    }
    [['energy', 'Energy'], ['nerve', 'Nerve']].forEach(([k, l]) => {
      const b = D[k];
      if (!b) return;
      const f = (b.fulltime || 0) - e;
      if (f > 0 && f < secs) w.push(['warn', l + ' will be full in ' + SD.dur(f) + ', before you are back']);
    });
    [['drug', 'Drug'], ['medical', 'Medical'], ['booster', 'Booster']].forEach(([k, l]) => {
      const r = ((D.cd || {})[k] || 0) - e;
      if (r > 0 && r < secs) w.push(['info', l + ' cooldown ends in ' + SD.dur(r) + ' (while you are away)']);
    });
    return w;
  }
  const warnHtml = w => w.map(x => '<div class="w ' + x[0] + '">' + SD.esc(x[1]) + '</div>').join('');

  const TRAVEL_URL = '/page.php?sid=travel';
  const MIN_LEVEL = 15;                        // Torn unlocks travelling at level 15
  const level = () => { const D = SD.peek(); return D && D.level ? D.level : 0; };   // 0 = unknown, never blocks
  const locked = () => { const l = level(); return l > 0 && l < MIN_LEVEL; };

  const CSS = `
    #sdial .trv .stat{margin-bottom:6px;padding:6px 10px;border-radius:8px;background:var(--sd-bg2);line-height:1.4}
    #sdial .trv .stat b{color:#fff}
    #sdial .trv .opts,#sdial .trv .foot{display:flex;gap:6px;margin-bottom:6px}
    #sdial .trv .foot{margin:6px 0 0;padding-top:6px;border-top:1px solid #2c2c2c}
    #sdial .trv button{flex:1;height:var(--sd-h);border-radius:8px;border:1px solid var(--sd-line);background:var(--sd-bg2);color:var(--sd-text2);font-size:12px;padding:0 4px}
    #sdial .trv button:active{background:var(--sd-hov)}
    #sdial .trv .list{max-height:30vh;overflow-y:auto;touch-action:pan-y}
    #sdial .trv .cr{display:flex;align-items:center;min-height:34px;box-sizing:border-box;padding:6px 10px;border-radius:8px;margin-bottom:3px;background:var(--sd-bg2);border-left:3px solid var(--st,#5a5a5a)}
    #sdial .trv .cr:active{background:var(--sd-hov)}
    #sdial .trv .cr.sel{background:#2a3140}
    #sdial .trv .cr .nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #sdial .trv .cr .tm{color:var(--sd-text2);font-size:12px;white-space:nowrap}
    #sdial .trv .cr .tm i{font-style:normal;color:var(--sd-dim);margin-left:6px}
    #sdial .trv .dt{margin:0 0 6px;padding:8px 10px;border-radius:8px;background:#20242c;line-height:1.4}
    #sdial .trv .dt .sub{color:var(--sd-dim);font-size:11px;margin-bottom:4px}
    #sdial .trv .go{width:100%;flex:none;margin-top:6px;height:var(--sd-h);font-size:12px}
    #sdial .trv .go:disabled{opacity:.4}
    #sdial .trv .w{margin-top:4px;padding:5px 8px;border-radius:6px;font-size:12px}
    #sdial .trv .w.info{background:#26303f;color:#a9c3e8}
    #sdial .trv .w.warn{background:#3a2f1a;color:#f0d9a0}
    #sdial .trv .w.bad{background:#3a1f1d;color:#f1b5b0}
    #sdial .trv .foot .ico{flex:0 0 44px}
    #sdial .trv .skbox{display:none}
    #sdial .trv.stk .skbox{display:block}
    #sdial .trv.stk .main{display:none}
    #sdial .trv .skh{display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:13px}
    #sdial .trv .skh span{flex:1}
    #sdial .trv .skh button{flex:0 0 36px;padding:0}
    #sdial .trv .skbox .bar{display:flex;gap:6px;margin-bottom:6px}
    #sdial .trv .skbox select{flex:1;min-width:0;height:var(--sd-h);border-radius:8px;border:1px solid var(--sd-line);background:var(--sd-bg2);color:var(--sd-text2);font-size:12px;padding:0 6px}
    #sdial .trv .skbox .so{flex:0 0 auto;padding:0 10px}
    #sdial .trv .skbox .so.on{background:#2a3140;border-color:var(--sd-blue);color:#fff}
    #sdial .trv .skbox .meta{color:var(--sd-dim);font-size:11px;margin-bottom:5px;line-height:1.35}
    #sdial .trv .skl{max-height:52vh;overflow-y:auto;touch-action:pan-y}
    #sdial .trv .sk{padding:6px 10px;border-radius:8px;margin-bottom:3px;background:var(--sd-bg2);border-left:3px solid #555}
    #sdial .trv .sk.up{border-left-color:#4a8f4e}
    #sdial .trv .sk.dn{border-left-color:var(--sd-red)}
    #sdial .trv .sk.out{opacity:.5}
    #sdial .trv .sk .l1{display:flex;align-items:center;gap:8px}
    #sdial .trv .sk .nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #sdial .trv .sk .pf{font-weight:600;white-space:nowrap;color:var(--sd-dim)}
    #sdial .trv .sk .pf.up{color:#7fd08a}
    #sdial .trv .sk .pf.dn{color:var(--sd-redt)}
    #sdial .trv .sk .l2{color:var(--sd-dim);font-size:11px;margin-top:1px}
  `;

  function build(ctx) {
    const el = ctx.el;
    el.className = 'trv';
    el.innerHTML =
      '<div class="main"><div class="stat"></div>' +
      '<div class="opts"><button class="m"></button><button class="bk"></button><button class="st"></button></div>' +
      '<div class="list"></div>' +
      '<div class="foot"><button class="skb">Stocks</button><button class="sync ico" aria-label="Refresh">' + SD.icons.refresh + '</button></div></div>' +
      '<div class="skbox"></div>';
    const statEl = el.querySelector('.stat');
    const list = el.querySelector('.list');
    const bM = el.querySelector('.m'), bBk = el.querySelector('.bk'), bSt = el.querySelector('.st');
    let sel = -1;
    const put = (e, h) => { if (e._h !== h) { e._h = h; e.innerHTML = h; } };   // skip identical writes (the clock ticks every second)

    const mode = () => SD.mode(SD.peek());

    function load(force) {
      lastLoad = Date.now();
      return SD.data(force).then(() => { if (ctx.alive) renderAll(); });
    }

    function renderOpts() {
      bM.textContent = METHODS[S.method];
      bBk.textContent = 'Book: ' + (S.book ? 'on' : 'off');
      bSt.textContent = 'Stay ' + S.stay + 'm';
    }

    function renderStat() {
      const D = SD.peek();
      if (!SD.hasKey) { statEl._h = null; statEl.textContent = 'No API key available.'; return; }
      if (SD.error() && !D) { statEl._h = null; statEl.textContent = SD.error(); return; }
      if (!D) { statEl._h = null; statEl.textContent = 'Loading...'; return; }
      const m = mode(), e = elapsed(), now = Date.now();
      if (m === 'home') {
        put(statEl, 'In Torn \u00b7 <b>' + SD.esc(D.state) + '</b>');
        return;
      }
      if (m === 'flying') {
        const dest = String(D.dest || ''), toTorn = dest.toLowerCase() === 'torn' || !dest;
        const left = Math.max(0, D.left - e);
        let html = (toTorn ? 'Returning to Torn' : 'Flying to <b>' + SD.esc(dest) + '</b>') +
          '<br>Lands \u2248 <b>' + SD.hhmm(now + left * 1000) + '</b> (' + SD.dur(left) + ' left)';
        let secs = left;
        if (!toTorn) {
          const d = findDest(dest);
          if (d) {
            secs += S.stay * 60 + oneWay(d) * 60;
            html += '<br>Back in Torn \u2248 <b>' + SD.hhmm(now + secs * 1000) + '</b>';
          }
        }
        put(statEl, html + warnHtml(warns(secs, false)));
        return;
      }
      // abroad
      const dest = String(D.dest || 'abroad'), d = findDest(dest);
      let html = 'Abroad: <b>' + SD.esc(dest) + '</b>';
      let secs = 0;
      if (d) {
        secs = oneWay(d) * 60;
        html += '<br>Return flight <b>' + SD.dur(secs) + '</b> \u00b7 back \u2248 <b>' + SD.hhmm(now + secs * 1000) + '</b>';
      }
      put(statEl, html + warnHtml(warns(secs, false)));
    }

    function detailHtml(d) {
      const secs = oneWay(d) * 120 + S.stay * 60;
      let h = '<div>Round trip <b>' + SD.dur(secs) + '</b> \u00b7 back \u2248 <b>' + SD.hhmm(Date.now() + secs * 1000) + '</b></div>' +
        '<div class="sub">' + (S.stay ? 'incl. ' + S.stay + 'm stay \u00b7 ' : '') + '\u00b13% flight variance</div>';
      h += SD.peek() ? warnHtml(warns(secs, true)) : '<div class="w info">Status and cooldown checks need the API</div>';
      return h;
    }

    function renderDetail() {
      const x = list.querySelector('.dtx');
      if (!x || sel < 0) return;
      put(x, detailHtml(DEST[sel]));
      const go = list.querySelector('.go');
      if (go) go.disabled = !!x.querySelector('.w.bad');
    }

    function renderList() {
      const m = mode();
      if (m === 'flying' || m === 'abroad') { list.style.display = 'none'; return; }
      list.style.display = 'block';
      list.innerHTML = '';
      DEST.forEach((d, i) => {
        const row = document.createElement('div');
        row.className = 'cr' + (i === sel ? ' sel' : '');
        const one = oneWay(d) * 60, rt = one * 2 + S.stay * 60;
        row.innerHTML = '<span class="nm">' + SD.esc(d.n) + '</span><span class="tm">' + SD.dur(one) + '<i>\u21c4 ' + SD.dur(rt) + '</i></span>';
        row.addEventListener('click', () => { sel = (sel === i ? -1 : i); renderList(); });
        list.appendChild(row);
        if (i === sel) {
          const box = document.createElement('div');
          box.className = 'dt';
          box.innerHTML = '<div class="dtx">' + detailHtml(d) + '</div><button class="go">Go to travel agency</button>';
          box.querySelector('.go').addEventListener('click', () => { location.href = TRAVEL_URL; });
          list.appendChild(box);
          box.querySelector('.go').disabled = !!box.querySelector('.w.bad');
        }
      });
    }

    function renderAll() { renderOpts(); renderStat(); renderList(); }

    bM.addEventListener('click', () => { S.method = (S.method + 1) % METHODS.length; save(); renderAll(); });
    bBk.addEventListener('click', () => { S.book = !S.book; save(); renderAll(); });
    bSt.addEventListener('click', () => { S.stay = STAYS[(STAYS.indexOf(S.stay) + 1) % STAYS.length]; save(); renderAll(); });
    const stocksUI = setupStocks(ctx, el);
    const syncBtn = el.querySelector('.sync');
    syncBtn.addEventListener('click', () => {
      SD.spin(syncBtn, Promise.all([load(true), stocksUI.refresh(true)])).then(() => { if (ctx.alive) SD.toast('Updated'); });
    });

    renderAll();
    load(false);

    // live clock only while the panel is open
    ctx.every(() => {
      renderStat();
      renderDetail();
      // flight just ended: refresh the status (at most every 15s)
      const D = SD.peek();
      if (D && mode() === 'flying' && D.left - elapsed() <= 0 && Date.now() - lastLoad > 15000) load(true);
    }, 1000);
  }

  // the circle stays tappable below level 15: the panel then shows only a red notice
  function mount(ctx) {
    SD.css('sd-travel', CSS);
    const el = ctx.el;
    el.className = 'trv';
    const gate = () => {
      if (!locked()) return false;
      el.innerHTML = '<div class="w bad">Travel unlocks at level ' + MIN_LEVEL + ' (you are level ' + level() + ')</div>';
      return true;
    };
    if (gate()) return;
    if (SD.hasKey && !SD.peek()) {   // level not known yet: wait for the status check
      el.textContent = 'Loading...';
      SD.data(false).then(() => { if (ctx.alive && !gate()) build(ctx); });
      return;
    }
    build(ctx);
  }

  SD.register({
    id: 'travel',
    label: 'Travel Helper',
    width: 230,
    // airplane
    icon: '<path d="M12 2.5c.9 0 1.5.9 1.5 2V9l7 4.5v2l-7-2v3.5l2 1.5V21l-3.5-1-3.5 1v-1.5l2-1.5V13.5l-7 2v-2L10.5 9V4.5c0-1.1.6-2 1.5-2z"/>',
    mount
  });
})();

} catch (e) { console.error('Speed Dial: modules/travelhelper.js:', e); try { window.SpeedDial && window.SpeedDial.log('boot', 'modules/travelhelper.js failed: ' + (e && e.message || e), 'e'); } catch (x) { /* log not ready yet */ } }

try {
// Speed Dial module: Targets v0.5.1
// Bottom bar: Add | Edit | Filter | Refresh. Add opens its own view (like Item Dock) with a search box: digits / profile link = ID,
// anything else = name search with a pick list. Filter opens a pop-up (screen dimmed) to pick the order: Sort by Default (as added), A-Z, or Time (Okay first, then the shortest cooldown).
// Each row shows name, ID (dark grey) with the player's level, and status with a live cooldown (Okay green, Hospital, Jail, ...).
// Tap a row to see the status details (for example who put them in hospital). Tap the name to open the profile.
// Refresh reloads only the targets on screen and can be used once every 30 seconds (also after closing and reopening the window).
// Auto-refresh: the targets on screen are also refreshed when the window opens, when you change page and when you change the sort.
// It only loads targets whose data is older than 30 seconds, does not start the Refresh button cooldown and stays silent unless something fails.
// From 15 targets on, the list switches to pages (15 per page, arrows with "page / total" in the middle) instead of scrolling,
// and Refresh only asks for the current page, so the number of API requests stays small.
// Nothing runs while the window is closed.
(function () {
  'use strict';
  const SD = window.SpeedDial;
  if (!SD) return;

  const LS = 'speedDial.targets1';   // { list: [{ id, name, st }], rt: last refresh (ms) }
  const PER = 15;                    // targets per page; from this many targets on, pages replace scrolling
  const MAX = 150;                   // most targets you can save
  const COOL = 30000;                // Refresh button cooldown (also the age after which auto-refresh reloads a target)
  const BATCH = 5;                   // parallel requests while refreshing

  const S = SD.read(LS, null) || {};
  if (!Array.isArray(S.list)) S.list = [];
  if (typeof S.rt !== 'number') S.rt = 0;
  const save = () => SD.write(LS, S);

  const strip = s => String(s || '').replace(/<[^>]*>/g, '').trim();
  const COLOR = { Okay: '#7fd08a', Hospital: '#d9a441', Jail: '#f1807a', Federal: '#f1807a', Traveling: '#6fa8e8', Abroad: '#6fa8e8', Fallen: '#8a8a8a' };
  const colorOf = s => COLOR[s] || '#cfcfcf';

  // one profile request -> { name, st }
  async function pull(id) {
    const j = await SD.api('https://api.torn.com/user/' + id + '?selections=profile');
    const s = j.status || {};
    return {
      name: String(j.name || ('#' + id)),
      lv: typeof j.level === 'number' ? j.level : 0,
      st: { state: s.state || 'Okay', desc: strip(s.description), det: strip(s.details), until: s.until || 0, t: Date.now() }
    };
  }

  // ---- name search (Torn API v2 user/search, flagged Unstable by Torn) ----
  // The name filter syntax could not be checked against Torn's docs, and a wrong one is NOT an error: the API just ignores it
  // and returns unrelated players. So every result is checked against what you typed, and a try only counts when it gives matches.
  // Each try = the query string part for the typed name. The first one that works is remembered (S.nt) and used first next time.
  const NAME_TRIES = [
    q => 'filters=' + encodeURIComponent('name:=:' + q),
    q => 'filters=' + encodeURIComponent('name:like:' + q),
    q => 'filters=' + encodeURIComponent('name:contains:' + q),
    q => 'name=' + encodeURIComponent(q)
  ];
  const arr = j => {   // first list of objects in the response, whatever the key is called
    if (Array.isArray(j)) return j;
    for (const v of Object.values(j || {})) {
      if (Array.isArray(v) && (!v.length || typeof v[0] === 'object')) return v;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const o = Object.values(v);
        if (o.length && typeof o[0] === 'object' && o[0] && (o[0].name || o[0].id || o[0].player_id)) return o;
      }
    }
    return [];
  };
  async function findName(q) {
    const low = q.toLowerCase();
    const order = NAME_TRIES.map((t, i) => i);
    if (typeof S.nt === 'number' && S.nt >= 0 && S.nt < order.length) order.unshift(order.splice(S.nt, 1)[0]);
    let err = null, ok = false, empty = false, junk = false;
    for (const i of order) {
      try {
        const j = await SD.api('https://api.torn.com/v2/user/search?' + NAME_TRIES[i](q));
        ok = true;
        const all = arr(j).map(o => ({ id: +(o.id || o.player_id || o.user_id || 0), name: String(o.name || ''), level: o.level || 0 })).filter(o => o.id && o.name);
        const hit = all.filter(o => o.name.toLowerCase().indexOf(low) > -1).slice(0, 15);
        if (hit.length) { if (S.nt !== i) { S.nt = i; save(); } return hit; }
        if (all.length) junk = true; else empty = true;   // unrelated players = filter ignored; nobody = filter works
      } catch (e) { err = e; SD.log('targets', 'name search attempt ' + i + ' failed: ' + e.message, 'w'); }
    }
    if (!ok) throw err || new Error('search failed');
    if (empty) return [];
    if (junk) throw new Error('the API ignored the name filter');
    return [];
  }

  // what to show right now: the saved status, but once the cooldown has run out it counts as Okay
  function view(st) {
    if (!st) return { label: '...', color: '#8a8a8a', rem: 0 };
    const rem = st.until ? st.until - Date.now() / 1000 : 0;
    if (st.state !== 'Okay' && st.until && rem <= 0) return { label: 'Okay', color: COLOR.Okay, rem: 0 };
    return { label: st.state, color: colorOf(st.state), rem: Math.max(0, rem) };
  }

  const CSS = `
    #sdial .tg button{height:var(--sd-h);border-radius:8px;border:1px solid var(--sd-line);background:var(--sd-bg2);color:var(--sd-text2);font-size:12px;padding:0 10px}
    #sdial .tg button:active{background:var(--sd-hov)}
    #sdial .tg button:disabled{opacity:.4}
    #sdial .tg input{flex:1;min-width:0;height:var(--sd-hi);border-radius:8px;border:1px solid var(--sd-line2);background:var(--sd-bg2);color:var(--sd-text);font-size:16px;padding:0 10px;outline:none}
    #sdial .tg input:focus{border-color:var(--sd-blue)}
    #sdial .tg .addv{display:none}
    #sdial .tg.adding .addv{display:block}
    #sdial .tg.adding .main{display:none}
    #sdial .tg .ah{display:flex;align-items:center;gap:8px;margin-bottom:6px;color:var(--sd-text);font-size:13px}
    #sdial .tg .ah .back{flex:0 0 32px;width:32px;padding:0;display:flex;align-items:center;justify-content:center}
    #sdial .tg .ad{display:flex;gap:6px;margin-bottom:6px}
    #sdial .tg .ad .go{flex:0 0 auto;height:var(--sd-hi);padding:0 14px}
    #sdial .tg .res{max-height:44vh;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;touch-action:pan-y}
    #sdial .tg .res .r{display:flex;align-items:center;gap:8px;min-height:44px;padding:4px 10px;border-radius:8px;margin-bottom:3px;background:var(--sd-bg2);border-left:3px solid var(--sd-blue)}
    #sdial .tg .res .r:active{background:var(--sd-hov)}
    #sdial .tg .res .r.have{opacity:.5}
    #sdial .tg .res .lv{flex:0 0 auto;color:var(--sd-dim);font-size:11px}
    #sdial .tg .res .pl{flex:0 0 18px;text-align:center;color:#7fd08a;font-size:18px;line-height:1}
    #sdial .tg .res .hint{color:var(--sd-dim);padding:12px 6px;text-align:center;font-size:12px;line-height:1.4}
    #sdial .tg .lst{max-height:46vh;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;touch-action:pan-y}
    #sdial .tg .em{padding:14px 6px;text-align:center;color:var(--sd-dim);font-size:12px;line-height:1.4}
    #sdial .tg .tr{margin-bottom:3px;padding:5px 8px;border-radius:8px;background:var(--sd-bg2);border-left:3px solid var(--c,#5a5a5a)}
    #sdial .tg .tr:active{background:var(--sd-hov)}
    #sdial .tg .r1{display:flex;align-items:center;gap:8px}
    #sdial .tg .who{flex:1;min-width:0}
    #sdial .tg .nm{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--sd-text);text-decoration:none;font-size:13px}
    #sdial .tg .id{display:block;color:#6b6b6b;font-size:11px;margin-top:1px}
    #sdial .tg .id em{font-style:normal;color:var(--sd-dim);margin-left:8px}
    #sdial .tg .sx{flex:0 0 auto;text-align:right;max-width:46%}
    #sdial .tg .sl{display:block;font-weight:600;font-size:12px;color:var(--c)}
    #sdial .tg .cd{display:block;color:var(--sd-text2);font-size:11px;margin-top:1px;min-height:13px}
    #sdial .tg .dt{display:none;margin-top:4px;padding-top:4px;border-top:1px solid #2f2f2f;color:var(--sd-dim);font-size:11px;line-height:1.35;word-break:break-word}
    #sdial .tg .tr.open .dt{display:block}
    #sdial .tg .rm{display:none;flex:0 0 var(--sd-h);width:var(--sd-h);height:var(--sd-h);padding:0;color:var(--sd-redt)}
    #sdial .tg.ed .rm{display:block}
    #sdial .tg .pg{display:none;align-items:center;gap:6px;margin:6px 0 0}
    #sdial .tg.pgd .pg{display:flex}
    #sdial .tg .pg button{flex:0 0 44px;padding:0}
    #sdial .tg .pg button svg{width:18px;height:18px}
    #sdial .tg .pn{flex:1;text-align:center;color:var(--sd-text2);font-size:13px}
    #sdial .tg .foot{display:flex;gap:6px;margin-top:6px;padding-top:6px;border-top:1px solid #2c2c2c}
    #sdial .tg .foot .add,#sdial .tg .foot .edit{flex:1;padding:0 4px}
    #sdial .tg .foot .fb{flex:0 0 40px;padding:0;display:flex;align-items:center;justify-content:center}
    #sdial .tg .foot .fb.act{background:#2a3140;border-color:var(--sd-blue)}
    #sdial .tg .foot .rf{flex:0 0 auto;min-width:52px;padding:0 8px;display:flex;align-items:center;justify-content:center;gap:4px}
    #sdial .tg .rf .rs{font-size:11px;min-width:16px;text-align:left}
    #sdial .tgpop{position:fixed;left:0;top:0;right:0;bottom:0;z-index:5000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.6)}
    #sdial .tgpop .tc{width:100%;max-width:260px;padding:12px;border-radius:14px;border:1px solid var(--st);background:var(--sd-bg);color:var(--sd-text);box-shadow:0 8px 24px rgba(0,0,0,.6)}
    #sdial .tgpop .th{padding:2px 4px 8px;font-size:14px;font-weight:700}
    #sdial .tgpop .op{display:flex;align-items:center;gap:10px;width:100%;height:44px;margin-top:4px;padding:0 12px;border-radius:10px;border:1px solid var(--sd-line);background:var(--sd-bg2);color:var(--sd-text);font-size:14px;text-align:left}
    #sdial .tgpop .op:active{background:var(--sd-hov)}
    #sdial .tgpop .op i{flex:0 0 16px;width:16px;height:16px;border-radius:50%;border:2px solid #5a5a5a}
    #sdial .tgpop .op.on{border-color:var(--sd-blue);background:#2a3140}
    #sdial .tgpop .op.on i{border-color:var(--sd-blue);background:radial-gradient(circle,var(--sd-blue) 0 40%,transparent 45%)}
    #sdial .tgpop .op span{flex:1}
    #sdial .tgpop .cx{width:100%;height:38px;margin-top:8px;border-radius:10px;border:1px solid var(--sd-line);background:none;color:var(--sd-text2);font-size:13px}
    #sdial .tgpop .cx:active{background:var(--sd-hov)}
  `;

  const ARROW_L = '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>';
  const ARROW_R = '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>';
  const FUNNEL = '<svg viewBox="0 0 24 24"><path d="M4 5h16l-6 7.5V19l-4-2v-4.5z"/></svg>';
  const SORTS = [['def', 'Sort by Default'], ['name', 'Sort by A-Z'], ['okay', 'Sort by Time']];

  function mount(ctx) {
    SD.css('sd-targets', CSS);
    const el = ctx.el;
    el.innerHTML =
      '<div class="tg">' +
        '<div class="addv">' +
          '<div class="ah"><button class="back" aria-label="Back">' + ARROW_L + '</button><span>Add target</span></div>' +
          '<div class="ad"><input class="in" type="text" placeholder="Name or ID" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="go">Go</button></div>' +
          '<div class="res"></div>' +
        '</div>' +
        '<div class="main">' +
          '<div class="lst"></div>' +
          '<div class="pg"><button class="pp" aria-label="Previous page">' + ARROW_L + '</button><span class="pn"></span><button class="pnx" aria-label="Next page">' + ARROW_R + '</button></div>' +
          '<div class="foot"><button class="add">Add</button><button class="edit">Edit</button><button class="fb" aria-label="Sort">' + FUNNEL + '</button><button class="rf" aria-label="Refresh">' + SD.icons.refresh + '<span class="rs"></span></button></div>' +
        '</div>' +
      '</div>';
    const q = s => el.querySelector(s);
    const root = q('.tg'), lst = q('.lst'), res = q('.res'), inp = q('.in'), goB = q('.go'), pn = q('.pn');
    const prev = q('.pp'), next = q('.pnx'), edit = q('.edit'), rf = q('.rf'), rs = q('.rs'), fb = q('.fb');
    let page = 0, busy = false, found = [];

    // ---- order: Default (as added), A-Z, Okay first (then the shortest cooldown first) ----
    const sortKey = () => (S.sort === 'name' || S.sort === 'okay') ? S.sort : 'def';
    function sorted() {
      const l = S.list.slice();
      const k = sortKey();
      if (k === 'name') l.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      else if (k === 'okay') {
        const w = t => { const v = view(t.st); return v.label === 'Okay' ? 0 : v.label === '...' ? 2 : 1; };
        l.sort((a, b) => (w(a) - w(b)) || (view(a.st).rem - view(b.st).rem) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      }
      return l;
    }
    const paged = () => S.list.length >= PER;
    const pages = () => Math.max(1, Math.ceil(S.list.length / PER));
    const shown = () => { const l = sorted(); return paged() ? l.slice(page * PER, page * PER + PER) : l; };

    function render() {
      if (page > pages() - 1) page = pages() - 1;
      if (page < 0) page = 0;
      root.classList.toggle('pgd', paged());
      fb.classList.toggle('act', sortKey() !== 'def');
      if (!SD.hasKey) { lst.innerHTML = '<div class="em">No API key available.</div>'; return; }
      if (!S.list.length) { lst.innerHTML = '<div class="em">No targets yet.<br>Tap Add.</div>'; return; }
      const keep = lst.scrollTop;
      lst.innerHTML = shown().map(t => {
        const v = view(t.st);
        const det = t.st ? [t.st.desc, t.st.det].filter(Boolean).join(' - ') : '';
        return '<div class="tr" data-id="' + t.id + '" style="--c:' + v.color + '">' +
          '<div class="r1">' +
            '<div class="who"><a class="nm" href="/profiles.php?XID=' + t.id + '">' + SD.esc(t.name) + '</a><span class="id">[' + t.id + ']' + (t.lv ? '<em>Lv ' + t.lv + '</em>' : '') + '</span></div>' +
            '<div class="sx"><b class="sl">' + SD.esc(v.label) + '</b><span class="cd" data-u="' + (v.rem ? t.st.until : 0) + '">' + (v.rem ? SD.durS(v.rem) : '') + '</span></div>' +
            '<button class="rm" aria-label="Remove">\u2715</button>' +
          '</div>' +
          '<div class="dt">' + SD.esc(det || 'No details') + '</div>' +
        '</div>';
      }).join('');
      lst.scrollTop = keep;
      pn.textContent = (page + 1) + ' / ' + pages();
      prev.disabled = page <= 0;
      next.disabled = page >= pages() - 1;
    }

    // every second: cooldown numbers + Refresh button; a row whose cooldown just ended is redrawn as Okay
    function tick() {
      const now = Date.now() / 1000;
      let redraw = false;
      lst.querySelectorAll('.cd[data-u]').forEach(c => {
        const u = +c.dataset.u;
        if (!u) return;
        const rem = u - now;
        if (rem <= 0) redraw = true; else c.textContent = SD.durS(rem);
      });
      if (redraw && !root.classList.contains('adding')) render();
      const left = Math.ceil((COOL - (Date.now() - S.rt)) / 1000);
      rs.textContent = left > 0 ? left + 's' : '';
      rf.disabled = left > 0 || busy;
    }

    // ---- add view (like Item Dock: its own view with a back button) ----
    function renderRes(msg) {
      if (msg) { res.innerHTML = '<div class="hint">' + SD.esc(msg) + '</div>'; return; }
      if (!found.length) { res.innerHTML = '<div class="hint">Type a name or an ID, then tap Go.</div>'; return; }
      res.innerHTML = '';
      found.forEach(o => {
        const have = S.list.some(t => t.id === o.id);
        const r = document.createElement('div');
        r.className = 'r' + (have ? ' have' : '');
        r.innerHTML = '<div class="who"><span class="nm"></span><span class="id">[' + o.id + ']</span></div>' + (o.level ? '<span class="lv">Lv ' + o.level + '</span>' : '') + '<span class="pl">' + (have ? '\u2713' : '+') + '</span>';
        r.querySelector('.nm').textContent = o.name;
        if (!have) r.addEventListener('click', () => { if (!busy) addId(o.id); });
        res.appendChild(r);
      });
    }

    function openAdd() {
      if (!SD.hasKey) return SD.toast('No API key available');
      root.classList.add('adding');
      found = [];
      inp.value = '';
      renderRes();
      inp.focus();
    }
    function closeAdd() {
      root.classList.remove('adding');
      inp.blur();
      render();
      tick();
    }

    async function addId(id) {
      if (S.list.some(t => t.id === id)) return SD.toast('Already in your list');
      if (S.list.length >= MAX) return SD.toast('Max ' + MAX + ' targets');
      busy = true; goB.disabled = true;
      try {
        const r = await pull(id);
        S.list.push({ id, name: r.name, lv: r.lv, st: r.st });
        save();
        if (ctx.alive) {
          if (sortKey() === 'def') page = pages() - 1;   // show the new one at the end
          if (!found.some(o => o.id === id)) found = [{ id, name: r.name, level: r.lv }];   // typed an ID: show it as added
          inp.value = '';
          renderRes();
        }
        SD.toast(r.name + ' added');
      } catch (e) {
        SD.log('targets', 'add failed: ' + e.message, 'e');
        SD.toast('Could not add: ' + e.message);
      }
      busy = false;
      if (ctx.alive) { goB.disabled = false; tick(); }
    }

    async function byName(name) {
      busy = true; goB.disabled = true;
      renderRes('Searching...');
      let list = null;
      try { list = await findName(name); }
      catch (e) { found = []; SD.log('targets', 'name search failed: ' + e.message, 'e'); if (ctx.alive) renderRes('Name search is not working (' + e.message + '). Use the player ID instead.'); }
      busy = false;
      if (!ctx.alive) return;
      goB.disabled = false;
      tick();
      if (!list) return;
      found = list;
      renderRes(list.length ? '' : 'No player found for "' + name + '".');
    }

    // one box: a profile link, "[123]" or plain digits = ID; anything else = a name
    function go() {
      if (busy) return;
      const raw = String(inp.value).trim();
      if (!raw) return SD.toast('Enter a name or ID');
      const m = raw.match(/XID=(\d+)/i) || raw.match(/^\[?\s*(\d+)\s*\]?$/);
      if (m) return addId(+m[1]);
      if (raw.length < 2) return SD.toast('Type at least 2 letters');
      byName(raw.replace(/^[@\s]+|\s+$/g, ''));
    }

    // ---- refresh: only the targets on screen ----
    // manual (button): at most once per 30 seconds, starts the cooldown, always shows a toast.
    // auto (window open, page change, sort change): only targets whose data is older than 30 seconds,
    // no button cooldown, and a toast only when something failed.
    async function refresh(auto) {
      if (busy) return;
      if (!SD.hasKey) return auto ? undefined : SD.toast('No API key available');
      if (!auto) {
        const left = Math.ceil((COOL - (Date.now() - S.rt)) / 1000);
        if (left > 0) return SD.toast('Wait ' + left + 's');
      }
      let todo = shown().slice();
      if (auto) todo = todo.filter(t => !t.st || Date.now() - t.st.t > COOL);   // only stale ones
      if (!todo.length) return;
      busy = true;
      if (!auto) {
        S.rt = Date.now();   // manual refresh starts the cooldown right away, so a double tap cannot send twice
        save();
      }
      tick();
      let failed = 0, last = '';
      const job = (async () => {
        for (let i = 0; i < todo.length; i += BATCH) {
          await Promise.all(todo.slice(i, i + BATCH).map(async t => {
            try {
              const r = await pull(t.id);
              t.name = r.name;
              if (r.lv) t.lv = r.lv;
              t.st = r.st;
            } catch (e) { failed++; last = e.message; SD.log('targets', 'refresh of ' + t.id + ' failed: ' + e.message, 'w'); }   // keep the old status when one request fails
          }));
        }
        save();
      })();
      await SD.spin(rf, job);
      busy = false;
      if (!ctx.alive) return;
      render();
      tick();
      if (!auto || failed) SD.toast(failed ? 'Updated, ' + failed + ' failed (' + last + ')' : 'Updated');
    }

    // ---- sort pop-up: lives in #sdial (not inside the window, which clips and moves), so it dims the whole screen ----
    let pop = null;
    function closePop() { if (pop) { pop.remove(); pop = null; } }
    function openPop() {
      closePop();
      const t = document.createElement('div');
      t.className = 'tgpop';
      t.innerHTML = '<div class="tc" role="dialog"><div class="th">Sort</div>' +
        SORTS.map(x => '<button class="op' + (x[0] === sortKey() ? ' on' : '') + '" data-s="' + x[0] + '"><i></i><span>' + x[1] + '</span></button>').join('') +
        '<button class="cx">Cancel</button></div>';
      t.addEventListener('click', e => {
        const op = e.target.closest('.op');
        if (op) { S.sort = op.dataset.s; save(); page = 0; closePop(); render(); refresh(true); return; }
        if (e.target === t || e.target.closest('.cx')) closePop();
      });
      (document.getElementById('sdial') || document.body).appendChild(t);
      pop = t;
    }

    // ---- events ----
    q('.add').addEventListener('click', openAdd);
    q('.back').addEventListener('click', closeAdd);
    goB.addEventListener('click', go);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    rf.addEventListener('click', () => refresh(false));
    fb.addEventListener('click', openPop);
    edit.addEventListener('click', () => { SD.editBtn(edit, root.classList.toggle('ed')); });
    prev.addEventListener('click', () => { if (page > 0) { page--; render(); refresh(true); } });
    next.addEventListener('click', () => { if (page < pages() - 1) { page++; render(); refresh(true); } });
    lst.addEventListener('click', e => {
      const row = e.target.closest('.tr');
      if (!row) return;
      if (e.target.closest('.rm')) {
        const id = +row.dataset.id;
        S.list = S.list.filter(t => t.id !== id);
        save();
        render();
        return;
      }
      if (e.target.closest('a')) return;   // the name opens the profile
      row.classList.toggle('open');
    });

    render();
    tick();
    ctx.every(tick, 1000);
    refresh(true);   // refresh on open
    return { unmount() { busy = false; closePop(); } };
  }

  SD.register({
    id: 'targets',
    label: 'Targets',
    width: 270,
    // crosshair
    icon: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1.5"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>',
    mount
  });
})();

} catch (e) { console.error('Speed Dial: modules/targets.js:', e); try { window.SpeedDial && window.SpeedDial.log('boot', 'modules/targets.js failed: ' + (e && e.message || e), 'e'); } catch (x) { /* log not ready yet */ } }

try {
// Speed Dial module: Calculator v0.2.0
// A plain calculator: + - x / with the usual precedence (2+3x4 = 14), %, +/-, backspace, AC.
// Display like Google's calculator: what you type is the big line, the live result sits under it (smaller, purple).
// After "=" the sum shrinks to the top and the result becomes the big line.
// % after + or - is a percentage of the number before it (200+10% = 220); otherwise it divides by 100.
// Nothing is saved and nothing is sent anywhere. No eval (Torn's CSP blocks it): the sum is worked out by hand below.
(function () {
  'use strict';
  const SD = window.SpeedDial;
  if (!SD) return;

  const CSS = `
    #sdial .calc{user-select:none;-webkit-user-select:none}
    #sdial .calc .dp{height:68px;padding:4px 8px 6px;margin-bottom:6px;border-radius:8px;background:var(--sd-bg2);display:flex;flex-direction:column;justify-content:flex-end;overflow:hidden}
    #sdial .calc .ex{height:32px;line-height:32px;font-size:26px;color:#f0f0f0;text-align:right;white-space:nowrap;overflow:hidden}
    #sdial .calc .ex.sm{font-size:20px}
    #sdial .calc .ex.xs{font-size:15px}
    #sdial .calc .ex.dn{height:18px;line-height:18px;font-size:12px;color:var(--sd-dim)}
    #sdial .calc .rs{height:20px;line-height:20px;font-size:16px;color:#9b93d4;text-align:right;white-space:nowrap;overflow:hidden}
    #sdial .calc .rs.dn{height:32px;line-height:32px;font-size:26px;color:#f0f0f0}
    #sdial .calc .rs.sm{font-size:20px}
    #sdial .calc .rs.xs{font-size:15px}
    #sdial .calc .gr{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}
    #sdial .calc .gr button{height:var(--sd-hl);border-radius:8px;border:1px solid var(--sd-line);background:var(--sd-bg2);color:var(--sd-text);font-size:16px;padding:0;touch-action:manipulation}
    #sdial .calc .gr button:active{background:var(--sd-line)}
    #sdial .calc .gr .fn{background:#2b2b2b;color:var(--sd-text2);font-size:14px}
    #sdial .calc .gr .op{background:#2f2f2f;border-color:#444;color:var(--sd-text2);font-size:18px}
    #sdial .calc .gr .op.cur{background:var(--sd-line);border-color:var(--sd-dim);color:#fff}
    #sdial .calc .gr .eq{background:#25360f;border-color:var(--sd-green);color:#c6e66a}
    #sdial .calc .gr .eq:active{background:#33491a}
  `;

  const SYM = { '+': '+', '-': '\u2212', '*': '\u00D7', '/': '\u00F7' };
  const MAXLEN = 15;

  // 12 significant digits hides 0.1+0.2 = 0.30000000000000004
  const clean = n => parseFloat(n.toPrecision(12));
  const group = s => {                              // 1234567.5 -> 1,234,567.5 (display only)
    if (/e/i.test(s)) return s;
    const m = /^(-?)(\d*)(\.?.*)$/.exec(s);
    return m[1] + m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + m[3];
  };

  // t = [number, op, number, op, number ...] ; x and / first, then + and -
  function calc(t) {
    const a = [t[0]];
    for (let i = 1; i < t.length; i += 2) {
      const op = t[i], n = t[i + 1];
      if (op === '*' || op === '/') {
        const p = a.pop();
        if (op === '/' && n === 0) throw new Error('div0');
        a.push(op === '*' ? p * n : p / n);
      } else a.push(op, n);
    }
    let r = a[0];
    for (let i = 1; i < a.length; i += 2) r = a[i] === '+' ? r + a[i + 1] : r - a[i + 1];
    if (!isFinite(r)) throw new Error('range');
    return clean(r);
  }
  const toNums = t => t.map((x, i) => (i % 2 ? x : Number(x)));

  function mount(ctx) {
    SD.css('sd-calc', CSS);
    const el = ctx.el;
    el.className = 'calc';
    const KEYS = [
      ['AC', 'fn'], ['\u232B', 'fn'], ['%', 'fn'], ['/', 'op'],
      ['7'], ['8'], ['9'], ['*', 'op'],
      ['4'], ['5'], ['6'], ['-', 'op'],
      ['1'], ['2'], ['3'], ['+', 'op'],
      ['\u00B1', 'fn'], ['0'], ['.'], ['=', 'eq']
    ];
    el.innerHTML = '<div class="dp"><div class="ex">0</div><div class="rs"></div></div><div class="gr"></div>';
    const ex = el.querySelector('.ex'), rs = el.querySelector('.rs'), gr = el.querySelector('.gr');
    const btn = {};
    KEYS.forEach(k => {
      const b = document.createElement('button');
      b.className = k[1] || '';
      b.textContent = SYM[k[0]] || k[0];
      b.dataset.k = k[0];
      if (k[0] === '\u232B') b.setAttribute('aria-label', 'Backspace');
      gr.appendChild(b);
      btn[k[0]] = b;
    });

    let exp = [];       // finished part: number strings and operators
    let cur = '';       // number being typed
    let res = null;     // result string right after "="
    let err = false;
    let line = '';      // top line after "="

    const text = () => exp.map(x => (SYM[x] || group(x))).concat(cur !== '' ? [group(cur)] : []).join(' ');
    const size = (n, s) => (s.length > (n ? 11 : 17) ? ' xs' : s.length > (n ? 8 : 11) ? ' sm' : '');
    const put = (node, base, str, sz) => {          // text in a line; long ones shrink, and the end stays in view
      node.className = base + sz;
      node.textContent = str;
      node.scrollLeft = node.scrollWidth;
    };

    function paint() {
      let top, sub = '', done = false;
      if (err) { top = 'Error'; }
      else if (res !== null) { top = group(res); sub = line; done = true; }
      else {
        top = text() || '0';
        const t = exp.slice();                       // live result under the line, once there is a sum to work out
        if (cur !== '') t.push(cur.replace(/\.$/, ''));
        if (t.length && t.length % 2 === 0) t.pop();
        if (t.length >= 3) { try { sub = group(String(calc(toNums(t)))); } catch (e) { sub = ''; /* half-typed expression: no preview yet */ } }
      }
      if (done) {                                    // after "=": sum small on top, result big below
        put(ex, 'ex dn', sub, '');
        put(rs, 'rs dn', top, size(false, top));
      } else {
        put(ex, 'ex', top, size(true, top));
        put(rs, 'rs', sub, '');
      }
      const last = exp[exp.length - 1];
      Object.keys(SYM).forEach(o => btn[o].classList.toggle('cur', cur === '' && res === null && last === o));
    }

    const reset = () => { exp = []; cur = ''; res = null; err = false; line = ''; };
    const fresh = () => { if (res !== null || err) reset(); };   // typing after "=" starts over

    function digit(d) {
      fresh();
      if (cur.replace(/[-.]/g, '').length >= MAXLEN) return;
      if (cur === '0' || cur === '-0') cur = cur.replace('0', d);
      else cur += d;
    }
    function dot() {
      fresh();
      if (cur.indexOf('.') > -1) return;
      cur = (cur === '' ? '0' : cur === '-' ? '-0' : cur) + '.';
    }
    function op(o) {
      if (err) reset();
      if (res !== null) { exp = [res]; res = null; line = ''; cur = ''; }
      if (cur !== '') {
        exp.push(cur.replace(/\.$/, ''));
        cur = '';
      } else if (!exp.length) { exp.push('0'); }
      if (exp.length % 2 === 0) exp[exp.length - 1] = o;   // operator pressed twice: replace it
      else exp.push(o);
    }
    function equals() {
      if (err || res !== null) return;
      const t = exp.slice();
      if (cur !== '') t.push(cur.replace(/\.$/, ''));
      if (t.length && t.length % 2 === 0) t.pop();         // trailing operator is dropped
      if (!t.length) return;
      try {
        const r = calc(toNums(t));
        line = t.map(x => (SYM[x] || group(x))).join(' ') + ' =';
        res = String(r);
        exp = []; cur = '';
      } catch (e) { err = true; exp = []; cur = ''; res = null; /* e.g. divide by zero: shown as an error on the display, not a bug */ }
    }
    function percent() {
      if (err) return;
      let n;
      if (res !== null) { n = Number(res); exp = []; res = null; line = ''; }
      else if (cur !== '') n = Number(cur);
      else return;
      const o = exp[exp.length - 1];
      if ((o === '+' || o === '-') && exp.length >= 2) {
        try { n = Number(calc(toNums(exp.slice(0, -1)))) * n / 100; } catch (e) { n = n / 100; /* nothing to take a percentage of: plain n/100 */ }   // 200 + 10% = 200 + 20
      } else n = n / 100;
      cur = String(clean(n));
    }
    function sign() {
      if (err) return;
      if (res !== null) { cur = res; res = null; exp = []; line = ''; }
      if (cur === '') cur = '-0';
      else cur = cur[0] === '-' ? cur.slice(1) : '-' + cur;
      if (cur === '-' ) cur = '';
    }
    function back() {
      if (res !== null || err) { reset(); return; }
      if (cur !== '') { cur = cur.slice(0, -1); if (cur === '-' || cur === '-0') cur = ''; }
      else if (exp.length) {
        exp.pop();                                          // drop the operator and carry on editing the number before it
        if (exp.length) cur = exp.pop();
      }
    }

    gr.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b || !ctx.alive) return;
      const k = b.dataset.k;
      if (/^\d$/.test(k)) digit(k);
      else if (k === '.') dot();
      else if (SYM[k]) op(k);
      else if (k === '=') equals();
      else if (k === '%') percent();
      else if (k === '\u00B1') sign();
      else if (k === '\u232B') back();
      else if (k === 'AC') reset();
      paint();
    });
    paint();
  }

  SD.register({
    id: 'calculator',
    label: 'Calculator',
    width: 224,
    // calculator: rounded body, screen, key dots
    icon: '<rect x="5" y="2.5" width="14" height="19" rx="2.5"/><rect x="8" y="5.5" width="8" height="3.5" rx=".8"/>' + [[9, 13], [12, 13], [15, 13], [9, 16.5], [12, 16.5], [15, 16.5]].map(c => '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="1.1" fill="#d0d0d0" stroke="none"/>').join(''),
    mount
  });
})();

} catch (e) { console.error('Speed Dial: modules/calculator.js:', e); try { window.SpeedDial && window.SpeedDial.log('boot', 'modules/calculator.js failed: ' + (e && e.message || e), 'e'); } catch (x) { /* log not ready yet */ } }

try {
// Speed Dial module: Show More v0.6.0
// The pinned "..." circle (sits just before Settings). It opens a launcher grid with every module that is NOT one of the
// (max 3) circles on screen: calculator, your own shortcuts, new modules. Tap a tile to open it.
//   - a module opens in its own window (the launcher closes); tap an already-open tile to close that window
//   - a shortcut (small arrow in the corner) leaves the page and opens its torn.com page
//   - Settings: opens Settings > Menu already in edit mode (the one place that reorders, pins and deletes)
// Which modules stay on screen, and the order of everything, is chosen in Settings > Menu. The newest module or shortcut always lands at the END of the grid.
(function () {
  'use strict';
  const SD = window.SpeedDial;
  if (!SD) return;

  const CSS = `
    #sdial .mr .gd{display:grid;grid-template-columns:repeat(4,1fr);gap:8px 2px}
    #sdial .mr .tl{min-width:0;padding:0;border:0;background:none;color:var(--sd-text2);display:flex;flex-direction:column;align-items:center;gap:4px;touch-action:manipulation}
    #sdial .mr .tl .bx{position:relative;width:44px;height:44px;border-radius:12px;border:1px solid var(--sd-line);background:var(--sd-bg2);display:flex;align-items:center;justify-content:center;font-size:22px;line-height:1}
    #sdial .mr .tl:active .bx{background:var(--sd-hov)}
    #sdial .mr .tl.act .bx{border-color:var(--st);background:#2b2b2b}
    #sdial .mr .tl .bx svg{width:22px;height:22px}
    #sdial .mr .tl .go{position:absolute;right:-4px;bottom:-4px;width:16px;height:16px;border-radius:50%;background:var(--sd-bg);border:1px solid var(--sd-line2);display:flex;align-items:center;justify-content:center}
    #sdial .mr .tl .go svg{width:10px;height:10px;stroke:var(--sd-bluet);stroke-width:2.6}
    #sdial .mr .tl .nm{width:100%;font-size:10.5px;line-height:1.15;text-align:center;word-break:break-word;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    #sdial .mr .em{padding:14px 6px;text-align:center;color:var(--sd-dim);font-size:12px;line-height:1.4}
    #sdial .mr .rw{display:flex;gap:6px;margin-top:10px}
    #sdial .mr .rw button{flex:1;height:var(--sd-h);border-radius:8px;border:1px solid var(--sd-line);background:var(--sd-bg2);color:var(--sd-text2);font-size:12px;padding:0}
    #sdial .mr .rw button:active{background:var(--sd-hov)}
  `;

  function mount(ctx) {
    SD.css('sd-more', CSS);
    const el = ctx.el;
    el.className = 'mr';
    el.innerHTML = '<div class="gd"></div>' +
      '<div class="rw"><button class="st-b">Settings</button></div>';
    const gd = el.querySelector('.gd');

    function render() {
      gd.innerHTML = '';
      gd.style.display = '';
      const list = SD.more();
      if (!list.length) {
        gd.style.display = 'block';
        const e = document.createElement('div');
        e.className = 'em';
        e.textContent = 'Nothing here. Every module is on screen.';
        gd.appendChild(e);
        return;
      }
      list.forEach(m => {
        const b = document.createElement('button');
        b.className = 'tl' + (SD.isOpen(m.id) ? ' act' : '');
        b._id = m.id;
        b.setAttribute('aria-label', m.label);
        b.innerHTML = '<span class="bx"></span><span class="nm"></span>';
        const bx = b.querySelector('.bx');
        if (m.emoji) bx.textContent = m.emoji; else bx.innerHTML = '<svg viewBox="0 0 24 24">' + m.icon + '</svg>';
        if (m.href) { const g = document.createElement('span'); g.className = 'go'; g.setAttribute('aria-hidden', 'true'); g.innerHTML = '<svg viewBox="0 0 24 24"><path d="M7 17L17 7"/><path d="M8 7h9v9"/></svg>'; bx.appendChild(g); }
        b.querySelector('.nm').textContent = m.label;
        b.addEventListener('click', () => {
          if (m.href) { location.href = m.href; return; }
          if (SD.isOpen(m.id)) { SD.close(m.id); render(); return; }   // already open: this tap closes it
          ctx.close();                                                  // launcher out of the way, then open the module
          SD.open(m.id);
        });
        gd.appendChild(b);
      });
    }

    // Settings = Settings > Menu in edit mode (it reorders both groups, pins/unpins and deletes shortcuts); this window only launches
    el.querySelector('.st-b').addEventListener('click', () => { ctx.close(); SD.open('settings', { page: 'pm', edit: true }); });
    render();
  }

  SD.register({
    id: 'more',
    label: 'Show More',
    width: 244,
    pinned: true,
    more: true,
    ord: 900,
    // three dots
    icon: '<circle cx="5" cy="12" r="1.7" fill="#d0d0d0" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="#d0d0d0" stroke="none"/><circle cx="19" cy="12" r="1.7" fill="#d0d0d0" stroke="none"/>',
    mount
  });
})();

} catch (e) { console.error('Speed Dial: modules/showmore.js:', e); try { window.SpeedDial && window.SpeedDial.log('boot', 'modules/showmore.js failed: ' + (e && e.message || e), 'e'); } catch (x) { /* log not ready yet */ } }

try {
// Speed Dial module: Settings v0.8.0
// The pinned gear circle (always last, cannot be hidden). Pages are chosen from a Torn-style menu:
// tap the 3-line button, a list of pages opens, tap one to go there. To add a page later, add an entry
// to PAGES (id, label, icon, optional show hook) and a matching <div class="pg ID"> in the markup.
//   Menu          - two groups: "On screen" (max 3 circles) and "Show More" (everything else). The pin moves a module
//                   between the groups. Edit mode: drag the handle to reorder inside a group, and remove your own shortcuts.
//   Features      - on/off switch for every page feature (things that run on a Torn page, outside the circles).
//                   A row of filter chips on top (All + one per category, swipe it sideways), then one section per category
//                   (title + count) with a card per feature: name, "!" and the switch. The "!" opens a small pop-up with the
//                   one-line explanation and the page it works on. The chosen filter is remembered (speedDial.featcat1).
//   Shortcut      - your own emoji circles that open a torn.com page (this is the old "Add shortcut" module).
//   Terminal      - the debug log (SD.log in core.js): what Speed Dial did, API calls, storage writes, warnings and errors.
//                   Lines live in memory only; Save keeps a copy in storage so it survives a reload (view it with Saved).
// Nothing is read from or clicked on the page. Only torn.com pages are accepted.
(function () {
  'use strict';
  const SD = window.SpeedDial;
  if (!SD) return;

  const LS = 'speedDial.shortcuts1';   // same key as the old Shortcuts module, so saved shortcuts carry over
  const MAX = 8;
  const QUICK = ['\u{1F3E0}', '\u{1F6D2}', '\u{1F3E6}', '\u{1F3B0}', '\u2694\uFE0F', '\u{1F3E5}', '\u{1F4BC}', '\u{1F4E6}', '\u{1F3AF}', '\u2B50'];
  let list = SD.read(LS, []);
  if (!Array.isArray(list)) list = [];
  const save = () => SD.write(LS, list);

  const sid = s => 'sc-' + s.id;
  const reg = s => SD.register({ id: sid(s), label: s.n, emoji: s.e, href: s.u, ord: 500 });
  list.forEach(reg);

  // torn.com page only: "/bazaar.php", "torn.com/bazaar.php" or "https://www.torn.com/bazaar.php"
  const fixUrl = raw => {
    let u = String(raw || '').trim();
    if (!u) return '';
    if (u[0] === '/') return (u[1] === '/' || u[1] === '\\') ? '' : u;
    if (/^(www\.)?torn\.com\//i.test(u)) u = 'https://' + u;
    return /^https:\/\/(www\.)?torn\.com\//i.test(u) ? u : '';
  };

  // first emoji of the input (keeps skin tones and combined emoji in one piece)
  let PICT;
  try { PICT = new RegExp('\\p{Extended_Pictographic}', 'u'); } catch (e) { PICT = /[^\x00-\x7F]/; }
  const firstChar = s => {
    try {
      if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        const it = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)[Symbol.iterator]().next();
        return it.done ? '' : it.value.segment;
      }
    } catch (e) { /* Segmenter unsupported: fall through to Array.from below */ }
    return Array.from(s)[0] || '';
  };
  const emojiOf = raw => {
    const s = String(raw || '').trim();
    if (!s) return '\u2B50';
    const g = firstChar(s);
    return PICT.test(g) ? g : '';
  };

  const PIN = '<svg viewBox="0 0 24 24"><path d="M9 3.5h6l-.8 5.2 2.8 3.3v1.2H7V12l2.8-3.3z"/><line x1="12" y1="13.2" x2="12" y2="20.5"/></svg>';
  const GRIP = '<svg viewBox="0 0 24 24"><line x1="5" y1="8" x2="19" y2="8"/><line x1="5" y1="12" x2="19" y2="12"/><line x1="5" y1="16" x2="19" y2="16"/></svg>';
  const HAMB = '<svg viewBox="0 0 24 24"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>';

  // pages shown in the menu (order = order in the list). show(): optional, runs every time the page opens
  const ICON_MENU = '<svg viewBox="0 0 24 24"><line x1="9" y1="7" x2="20" y2="7"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="17" x2="20" y2="17"/><circle cx="5" cy="7" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="5" cy="17" r="1"/></svg>';
  const ICON_FEAT = '<svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="10" rx="5"/><circle cx="16" cy="12" r="2.5"/></svg>';
  const ICON_TERM = '<svg viewBox="0 0 24 24"><polyline points="4 7 9 12 4 17"/><line x1="12" y1="17" x2="20" y2="17"/></svg>';
  const ICON_ADD = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>';

  const CSS = `
    #sdial .cz .nav{display:flex;align-items:center;gap:8px;height:34px;margin-bottom:6px}
    #sdial .cz .nav .hb{flex:0 0 auto;width:38px;height:var(--sd-h);padding:0;display:flex;align-items:center;justify-content:center}
    #sdial .cz .nav .hb svg{width:20px;height:20px;fill:none;stroke:var(--sd-text2);stroke-width:2;stroke-linecap:round}
    #sdial .cz .nav .hb.on{background:var(--sd-line);border-color:#5a5a5a}
    #sdial .cz .nav .cur{flex:1;min-width:0;font-size:13px;font-weight:700;color:var(--sd-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #sdial .cz .mn{display:none;max-height:42vh;overflow-y:auto;touch-action:pan-y;margin-bottom:2px}
    #sdial .cz.nav-open .mn{display:block}
    #sdial .cz.nav-open .pg{display:none !important}
    #sdial .cz .mn .mi{display:flex;align-items:center;gap:10px;width:100%;height:40px;padding:0 10px;margin-bottom:3px;border-radius:8px;border:1px solid transparent;background:var(--sd-bg2);color:var(--sd-text2);font-size:13px;text-align:left}
    #sdial .cz .mn .mi.on{background:var(--sd-line);color:#fff;border-color:#5a5a5a}
    #sdial .cz .mn .mi svg{flex:0 0 auto;width:18px;height:18px;fill:none;stroke:var(--sd-dim);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    #sdial .cz .mn .mi.on svg{stroke:var(--sd-text)}
    #sdial .cz .pg{display:none}
    #sdial .cz .pg.on{display:block}
    #sdial .cz .qk{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px}
    #sdial .cz .qk button{flex:0 0 auto;width:var(--sd-h);height:var(--sd-h);font-size:16px;padding:0}
    #sdial .cz .rw{display:flex;gap:6px;margin-bottom:6px}
    #sdial .cz input{min-width:0;height:var(--sd-hi);border-radius:8px;border:1px solid var(--sd-line);background:var(--sd-bg2);color:var(--sd-text);font-size:13px;padding:0 8px}
    #sdial .cz .ie{flex:0 0 64px;text-align:center;font-size:16px}
    #sdial .cz .in,#sdial .cz .iu{flex:1}
    #sdial .cz button{height:var(--sd-h);border-radius:8px;border:1px solid var(--sd-line);background:var(--sd-bg2);color:var(--sd-text2);font-size:12px;padding:0 8px}
    #sdial .cz button:active{background:var(--sd-hov)}
    #sdial .cz .add,#sdial .cz .edit{width:100%}
    #sdial .cz .lst{touch-action:pan-y;margin-bottom:6px}
    #sdial .cz .lst.lm{max-height:30vh;overflow-y:auto}
    #sdial .cz .gh{display:flex;align-items:center;justify-content:space-between;height:22px;padding:0 4px;margin-bottom:3px;font-size:11px;color:var(--sd-dim);letter-spacing:.3px;text-transform:uppercase}
    #sdial .cz .gh b{font-weight:700;color:var(--sd-text2)}
    #sdial .cz .gh b.full{color:var(--sd-green)}
    #sdial .cz .ge{padding:8px 4px 10px;font-size:12px;color:#6f6f6f;text-align:center}
    #sdial .cz .it .pin{color:var(--sd-dim)}
    #sdial .cz .it .pin svg{stroke:var(--sd-dim)}
    #sdial .cz .it .pin.on{border-color:var(--sd-green);background:#25360f}
    #sdial .cz .it .pin.on svg{stroke:var(--sd-green);fill:rgba(133,178,0,.35)}
    #sdial .cz .it{display:flex;align-items:center;gap:8px;height:34px;padding:0 4px 0 10px;border-radius:8px;background:var(--sd-bg2);margin-bottom:3px;user-select:none;-webkit-user-select:none}
    #sdial .cz .it.drag{position:relative;z-index:5;background:var(--sd-line);box-shadow:0 4px 12px rgba(0,0,0,.55)}
    #sdial .cz .it .ix{width:20px;display:flex;align-items:center;justify-content:center;font-size:16px;flex:0 0 auto}
    #sdial .cz .it .ix svg{width:18px;height:18px}
    #sdial .cz .it .nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #sdial .cz .it.off .ix,#sdial .cz .it.off .nm{opacity:.4}
    #sdial .cz .it .grip{display:none;align-items:center;justify-content:center;width:30px;height:34px;margin:0 0 0 -10px;touch-action:none;cursor:grab;flex:0 0 auto}
    #sdial .cz .it .grip svg{width:18px;height:18px;stroke:var(--sd-dim)}
    #sdial .cz.edit .it .grip{display:flex}
    #sdial .cz .it.drag .grip svg{stroke:var(--sd-text)}
    #sdial .cz .it .btn{height:26px;width:30px;padding:0;display:flex;align-items:center;justify-content:center;flex:0 0 auto}
    #sdial .cz .it .btn svg{width:16px;height:16px}
    #sdial .cz .it .del{display:none;color:var(--sd-redt)}
    #sdial .cz.edit .it.cu .del{display:flex}
    #sdial .cz .fl{max-height:42vh;overflow-y:auto;touch-action:pan-y;margin-bottom:2px}
    #sdial .cz .fc{display:flex;gap:6px;overflow-x:auto;overflow-y:hidden;touch-action:pan-x;margin:0 0 6px;padding-bottom:2px;-webkit-overflow-scrolling:touch;scrollbar-width:none}
    #sdial .cz .fc::-webkit-scrollbar{display:none}
    #sdial .cz .fc button{flex:0 0 auto;height:30px;padding:0 14px;border-radius:15px;white-space:nowrap;font-size:12px}
    #sdial .cz .fc button.on{background:#25360f;border-color:var(--sd-green);color:#c6e66a}
    #sdial .cz .fh{display:flex;align-items:center;gap:6px;margin:8px 2px 5px;font-size:11px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:var(--sd-text2)}
    #sdial .cz .fh:first-child{margin-top:2px}
    #sdial .cz .fh:before{content:'';flex:0 0 auto;width:3px;height:14px;border-radius:2px;background:var(--sd-green)}
    #sdial .cz .fh i{font-style:normal;font-weight:400;color:var(--sd-dim)}
    #sdial .cz .fe{padding:10px 4px;color:var(--sd-dim);font-size:12px;text-align:center}
    #sdial .cz .fw{border-radius:8px;background:var(--sd-bg2);border:1px solid var(--sd-line);margin-bottom:4px}
    #sdial .cz .fr{display:flex;align-items:center;gap:8px;min-height:40px;padding:0 8px 0 10px}
    #sdial .cz .fr .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #sdial .cz .fr .inf{flex:0 0 auto;width:26px;height:26px;padding:0;border-radius:50%;border:1px solid #4a4a4a;background:none;color:var(--sd-dim);font-size:13px;font-weight:700;line-height:1}
    #sdial .cz .fr .inf:active{background:var(--sd-line);border-color:var(--sd-dim);color:var(--sd-text)}
    #sdial .cz .fr .sw{flex:0 0 auto;position:relative;width:40px;height:24px;padding:0;border-radius:12px;border:1px solid #444;background:#1a1a1a;transition:background .12s,border-color .12s}
    #sdial .cz .fr .sw i{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#777;transition:transform .12s,background .12s}
    #sdial .cz .fr .sw.on{background:#25360f;border-color:var(--sd-green)}
    #sdial .cz .fr .sw.on i{transform:translateX(16px);background:var(--sd-green)}
    #sdial .cz .tm .fr{padding:0 4px 0 6px;min-height:34px;margin-bottom:4px}
    #sdial .cz .tm .fr .sw{flex:0 0 auto;position:relative;width:40px;height:24px;padding:0;border-radius:12px;border:1px solid #444;background:#1a1a1a;transition:background .12s,border-color .12s}
    #sdial .cz .tm .fr .sw i{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#777;transition:transform .12s,background .12s}
    #sdial .cz .tm .fr .sw.on{background:#25360f;border-color:var(--sd-green)}
    #sdial .cz .tm .fr .sw.on i{transform:translateX(16px);background:var(--sd-green)}
    #sdial .cz .tm .bar{display:flex;gap:4px;margin-bottom:4px}
    #sdial .cz .tm .bar button{flex:1 1 0;min-width:0;height:28px;padding:0 2px;font-size:11px}
    #sdial .cz .tm .bar button.on{background:var(--sd-line);border-color:#5a5a5a;color:#fff}
    #sdial .cz .tm .bar button:disabled{opacity:.35}
    #sdial .cz .tm .out{height:34vh;min-height:120px;overflow-y:auto;overflow-x:hidden;touch-action:pan-y;overscroll-behavior:contain;padding:4px 5px;border-radius:8px;background:#0f0f0f;border:1px solid #2c2c2c;font:10px/1.35 ui-monospace,Menlo,Consolas,monospace;margin-bottom:4px;-webkit-user-select:text;user-select:text}
    #sdial .cz .tm .ln{word-break:break-all;color:var(--sd-text2);padding:1px 0}
    #sdial .cz .tm .ln .tt{color:#6f6f6f}
    #sdial .cz .tm .ln .tg{color:#7f93b8}
    #sdial .cz .tm .ln.w{color:var(--sd-yel)}
    #sdial .cz .tm .ln.e{color:var(--sd-redt)}
    #sdial .cz .tm .ln.w .tg,#sdial .cz .tm .ln.e .tg{color:inherit}
    #sdial .cz .tm .none{padding:10px 4px;text-align:center;color:#6f6f6f}
    #sdial .cz .tm .ct{margin-bottom:4px;font-size:10px;color:var(--sd-dim);text-align:right}
    #sdial .sdtip{position:fixed;left:0;top:0;right:0;bottom:0;z-index:5000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.5)}
    #sdial .sdtip .tc{width:100%;max-width:240px;padding:12px 14px;border-radius:12px;border:1px solid var(--st);background:var(--sd-bg);color:var(--sd-text);box-shadow:0 8px 24px rgba(0,0,0,.6)}
    #sdial .sdtip .th{font-size:13px;font-weight:700}
    #sdial .sdtip .tx{margin-top:4px;font-size:12px;line-height:1.4;color:#bdbdbd}
    #sdial .sdtip .tp{display:flex;align-items:center;gap:6px;margin-top:10px;font-size:12px;color:var(--sd-bluet)}
    #sdial .sdtip .tp svg{flex:0 0 auto;width:16px;height:16px;stroke:var(--sd-bluet)}
    #sdial .sdtip .tk{width:100%;height:var(--sd-h);margin-top:10px;padding:0 8px;border-radius:8px;border:1px solid var(--sd-line);background:var(--sd-bg2);color:var(--sd-text2);font-size:12px}
    #sdial .sdtip .tk:active{background:var(--sd-hov)}
  `;

  function mount(ctx) {
    SD.css('sd-settings', CSS);
    const el = ctx.el;
    el.className = 'cz';
    el.innerHTML =
      '<div class="nav"><button class="hb" aria-label="Pages" aria-expanded="false">' + HAMB + '</button><span class="cur"></span></div>' +
      '<div class="mn"></div>' +
      '<div class="pg pm on">' +
        '<div class="gh"><span>On screen</span><b class="cnt"></b></div><div class="lst lf"></div>' +
        '<div class="gh"><span>Show More</span></div><div class="lst lm"></div>' +
        '<button class="edit">Edit</button></div>' +
      '<div class="pg pf"><div class="fc"></div><div class="fl"></div></div>' +
      '<div class="pg pt"><div class="tm">' +
        '<div class="fr"><span class="nm">Logging</span><button class="sw" role="switch" aria-label="Logging"><i></i></button></div>' +
        '<div class="bar"><button data-v="live">Live</button><button data-v="saved">Saved</button></div>' +
        '<div class="bar"><button data-f="i">All</button><button data-f="w">Warn+</button><button data-f="e">Errors</button></div>' +
        '<div class="out"></div><div class="ct"></div>' +
        '<div class="bar"><button class="tp">Pause</button><button class="tc">Clear</button><button class="tcp">Copy</button><button class="ts">Save</button></div>' +
      '</div></div>' +
      '<div class="pg pa">' +
        '<div class="qk"></div>' +
        '<div class="rw"><input class="ie" maxlength="12" placeholder="Emoji" autocomplete="off"><input class="in" maxlength="20" placeholder="Name" autocomplete="off"></div>' +
        '<div class="rw"><input class="iu" placeholder="/page.php?sid=..." autocomplete="off" autocapitalize="off" spellcheck="false"><button class="here">This page</button></div>' +
        '<button class="add">Add</button>' +
      '</div>';
    const qk = el.querySelector('.qk'), lf = el.querySelector('.lf'), lm = el.querySelector('.lm'), cnt = el.querySelector('.cnt'), fl = el.querySelector('.fl'), fc = el.querySelector('.fc');
    const inE = el.querySelector('.ie'), inN = el.querySelector('.in'), inU = el.querySelector('.iu');
    const hb = el.querySelector('.hb'), cur = el.querySelector('.cur'), mn = el.querySelector('.mn');
    let drag = null;

    // ----- page navigation: 3-line button opens the list of pages, tapping one opens that page -----
    const PAGES = [
      { id: 'pm', label: 'Menu', icon: ICON_MENU, show: () => renderList() },
      { id: 'pf', label: 'Features', icon: ICON_FEAT, show: () => renderFeat() },
      { id: 'pa', label: 'Shortcut', icon: ICON_ADD },
      { id: 'pt', label: 'Terminal', icon: ICON_TERM, show: () => startTerm() }
    ];

    function setNav(open) {
      el.classList.toggle('nav-open', open);
      hb.classList.toggle('on', open);
      hb.setAttribute('aria-expanded', open ? 'true' : 'false');
      closeTip();
    }

    function showPage(id) {
      const p = PAGES.find(x => x.id === id) || PAGES[0];
      stopTerm();
      cur.textContent = p.label;
      el.querySelectorAll('.pg').forEach(g => g.classList.toggle('on', g.classList.contains(p.id)));
      mn.querySelectorAll('.mi').forEach(b => b.classList.toggle('on', b.dataset.p === p.id));
      setNav(false);
      if (p.show) p.show();
    }

    PAGES.forEach(p => {
      const b = document.createElement('button');
      b.className = 'mi';
      b.dataset.p = p.id;
      b.innerHTML = p.icon + '<span></span>';
      b.querySelector('span').textContent = p.label;
      b.addEventListener('click', () => showPage(p.id));
      mn.appendChild(b);
    });
    hb.addEventListener('click', () => setNav(!el.classList.contains('nav-open')));

    // ----- terminal page: the debug log. Lines are only drawn while this page is open (no timers: new lines arrive as events) -----
    const tm = el.querySelector('.tm');
    const out = tm.querySelector('.out'), ct = tm.querySelector('.ct'), tsw = tm.querySelector('.sw');
    const bP = tm.querySelector('.tp'), bC = tm.querySelector('.tc'), bCp = tm.querySelector('.tcp'), bS = tm.querySelector('.ts');
    const T = { view: 'live', lvl: 'i', paused: false, unsub: null, n: 0 };
    const RANK = { i: 0, w: 1, e: 2 };
    const MAXLINES = 300;

    const source = () => (T.view === 'saved' ? SD.logSaved() : SD.logs());
    const passes = e => RANK[e.l] >= RANK[T.lvl];
    const lineEl = e => {
      const d = document.createElement('div');
      d.className = 'ln ' + e.l;
      const a = document.createElement('span'), b = document.createElement('span');
      a.className = 'tt'; a.textContent = SD.logTime(e.t) + ' ';
      b.className = 'tg'; b.textContent = e.g + ' ';
      d.appendChild(a); d.appendChild(b); d.appendChild(document.createTextNode(e.m));
      return d;
    };
    const count = () => {
      ct.textContent = T.n + ' line' + (T.n === 1 ? '' : 's') + (T.view === 'live' && T.paused ? ' (paused)' : '') + (T.view === 'live' && !SD.logIsOn() ? ' (logging is off)' : '');
    };
    function drawTerm() {
      out.innerHTML = '';
      const rows = source().filter(passes);
      T.n = rows.length;
      if (!rows.length) {
        const n = document.createElement('div');
        n.className = 'none';
        n.textContent = T.view === 'saved' ? 'Nothing saved yet. Tap Save in Live.' : 'No lines.';
        out.appendChild(n);
      } else rows.forEach(e => out.appendChild(lineEl(e)));
      out.scrollTop = out.scrollHeight;
      count();
    }
    const onLine = e => {
      if (T.view !== 'live') return;
      if (e === null) { drawTerm(); return; }                    // Clear
      if (T.paused || !passes(e)) return;
      const nearEnd = out.scrollHeight - out.scrollTop - out.clientHeight < 30;
      const none = out.querySelector('.none');
      if (none) none.remove();
      out.appendChild(lineEl(e));
      T.n++;
      while (out.children.length > MAXLINES) { out.removeChild(out.firstChild); T.n--; }
      if (nearEnd) out.scrollTop = out.scrollHeight;
      count();
    };
    function paintTerm() {
      tm.querySelectorAll('.bar button[data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === T.view));
      tm.querySelectorAll('.bar button[data-f]').forEach(b => b.classList.toggle('on', b.dataset.f === T.lvl));
      const on = SD.logIsOn();
      tsw.classList.toggle('on', on);
      tsw.setAttribute('aria-checked', on ? 'true' : 'false');
      bP.textContent = T.paused ? 'Resume' : 'Pause';
      bP.disabled = T.view !== 'live';
      bS.disabled = !SD.logIsOn() && !SD.logs().length;
    }
    function startTerm() {
      stopTerm();
      T.unsub = SD.logSub(onLine);
      paintTerm();
      drawTerm();
    }
    function stopTerm() { if (T.unsub) { T.unsub(); T.unsub = null; } }

    tm.querySelectorAll('.bar button[data-v]').forEach(b => b.addEventListener('click', () => { T.view = b.dataset.v; paintTerm(); drawTerm(); }));
    tm.querySelectorAll('.bar button[data-f]').forEach(b => b.addEventListener('click', () => { T.lvl = b.dataset.f; paintTerm(); drawTerm(); }));
    tsw.addEventListener('click', () => { SD.logSet(!SD.logIsOn()); paintTerm(); count(); });
    bP.addEventListener('click', () => { T.paused = !T.paused; if (!T.paused) drawTerm(); paintTerm(); count(); });
    bC.addEventListener('click', () => {
      if (T.view === 'saved') { SD.logUnsave(); drawTerm(); SD.toast('Saved log cleared'); } else SD.logClear();
    });
    bS.addEventListener('click', () => {
      const n = SD.logSave();
      SD.toast('Saved ' + n + ' line' + (n === 1 ? '' : 's'));
      if (T.view === 'saved') drawTerm();
    });
    bCp.addEventListener('click', () => {
      const rows = source().filter(passes);
      const head = 'Speed Dial v' + SD.ver + ' | ' + (T.view === 'saved' ? 'saved log' : 'live log') + ' | native storage: ' + (window.__sdStore && window.__sdStore.native ? 'yes' : 'no') + ' | ' + rows.length + ' line(s)';
      const text = head + '\n' + rows.map(e => SD.logTime(e.t) + ' [' + e.g + '] ' + (e.l === 'e' ? 'ERROR ' : e.l === 'w' ? 'WARN ' : '') + e.m).join('\n');
      copyText(text).then(ok => SD.toast(ok ? 'Copied ' + rows.length + ' line(s)' : 'Could not copy. Select the text and copy it by hand.'));
    });
    // clipboard API when the page allows it, otherwise the old selection trick
    function copyText(text) {
      const old = () => {
        try {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.cssText = 'position:fixed;left:0;top:0;opacity:0;width:1px;height:1px';
          (document.getElementById('sdial') || document.body).appendChild(ta);
          ta.focus(); ta.select();
          const ok = document.execCommand('copy');
          ta.remove();
          return ok;
        } catch (e) { return false; }
      };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(() => true, () => old());
      } catch (e) { /* clipboard API blocked: fall through to the execCommand copy below */ }
      return Promise.resolve(old());
    }

    // ----- features page: on/off per feature, "!" opens a small pop-up -----
    let tip = null;
    function closeTip() { if (tip) { tip.remove(); tip = null; } }
    // lives in #sdial (not inside the window, which clips and moves), so it is centred on the screen
    function openTip(f) {
      closeTip();
      const t = document.createElement('div');
      t.className = 'sdtip';
      t.innerHTML = '<div class="tc" role="dialog"><div class="th"></div><div class="tx"></div><div class="tp"><svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.2a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.5"/></svg><span></span></div><button class="tk">OK</button></div>';
      t.querySelector('.th').textContent = f.label;
      t.querySelector('.tx').textContent = f.info || '';
      const tp = t.querySelector('.tp');
      if (f.where) tp.querySelector('span').textContent = f.where; else tp.remove();
      t.addEventListener('click', e => { if (e.target === t || e.target.closest('.tk')) closeTip(); });
      (document.getElementById('sdial') || document.body).appendChild(t);
      tip = t;
    }

    const FCK = 'speedDial.featcat1';   // the filter chip you picked last
    let fcat = SD.read(FCK, 'All');
    if (typeof fcat !== 'string') fcat = 'All';
    const groupOf = f => f.group || 'Other';

    function renderFeat() {
      closeTip();
      const keep = fc.scrollLeft;
      fc.innerHTML = '';
      fl.innerHTML = '';
      if (!SD.features.length) {
        const e = document.createElement('div');
        e.className = 'fe';
        e.textContent = 'No features installed yet.';
        fl.appendChild(e);
        return;
      }
      // categories: alphabetical, "Other" last
      const names = Array.from(new Set(SD.features.map(groupOf))).sort((a, b) => (a === 'Other') - (b === 'Other') || a.localeCompare(b));
      if (fcat !== 'All' && names.indexOf(fcat) < 0) fcat = 'All';
      ['All'].concat(names).forEach(n => {
        const b = document.createElement('button');
        b.textContent = n;
        b.className = n === fcat ? 'on' : '';
        b.addEventListener('click', () => { fcat = n; SD.write(FCK, fcat); renderFeat(); });
        fc.appendChild(b);
      });
      fc.scrollLeft = keep;
      names.filter(n => fcat === 'All' || n === fcat).forEach(n => {
        const list = SD.features.filter(f => groupOf(f) === n).sort((a, b) => a.label.localeCompare(b.label));
        const h = document.createElement('div');
        h.className = 'fh';
        h.innerHTML = '<span></span><i>' + list.length + '</i>';
        h.firstChild.textContent = n;
        fl.appendChild(h);
        list.forEach(f => {
          const w = document.createElement('div');
          w.className = 'fw';
          w.innerHTML = '<div class="fr"><span class="nm"></span><button class="inf" aria-label="About this feature">!</button>' +
            '<button class="sw" role="switch"><i></i></button></div>';
          w.querySelector('.nm').textContent = f.label;
          const sw = w.querySelector('.sw');
          const paint = () => {
            const on = SD.featureOn(f.id);
            sw.classList.toggle('on', on);
            sw.setAttribute('aria-checked', on ? 'true' : 'false');
          };
          paint();
          w.querySelector('.inf').addEventListener('click', () => openTip(f));
          sw.addEventListener('click', () => {
            const now = !SD.featureOn(f.id);
            SD.setFeature(f.id, now);
            paint();
            if (now && !SD.featureFits(f.id) && f.where) SD.toast(f.label + ' is on. It starts on: ' + f.where);
          });
          fl.appendChild(w);
        });
      });
    }

    // ----- add shortcut page -----
    QUICK.forEach(e => {
      const b = document.createElement('button');
      b.textContent = e;
      b.addEventListener('click', () => { inE.value = e; });
      qk.appendChild(b);
    });

    // fill the form from the page you are on right now (address only, nothing else is read)
    el.querySelector('.here').addEventListener('click', () => {
      inU.value = location.pathname + location.search + location.hash;
      if (!inN.value) inN.value = (document.title || '').replace(/\s*[|\u2013-]\s*TORN.*$/i, '').trim().slice(0, 20);
    });

    el.querySelector('.add').addEventListener('click', () => {
      if (list.length >= MAX) { SD.toast('Maximum ' + MAX + ' shortcuts'); return; }
      const e = emojiOf(inE.value), n = inN.value.trim().slice(0, 20), u = fixUrl(inU.value);
      if (!e) { SD.toast('Emoji must be an emoji'); return; }
      if (!n) { SD.toast('Enter a name'); return; }
      if (!u) { SD.toast('Use a torn.com page'); return; }
      const s = { id: Date.now().toString(36), e, n, u };
      list.push(s);
      save();
      reg(s);
      inE.value = inN.value = inU.value = '';
      SD.toast('Added ' + n);
    });

    // ----- menu page: "On screen" (max SD.maxFront) and "Show More" -----
    const frontIds = () => SD.front().map(m => m.id);
    const moreIds = () => SD.more().map(m => m.id);

    function empty(box, txt) {
      const e = document.createElement('div');
      e.className = 'ge';
      e.textContent = txt;
      box.appendChild(e);
    }

    function togglePin(id) {
      const A = frontIds(), B = moreIds();
      if (A.indexOf(id) > -1) {                         // back to Show More: it goes to the END, like anything new
        A.splice(A.indexOf(id), 1);
        B.push(id);
      } else {
        if (A.length >= SD.maxFront) { SD.toast('Max ' + SD.maxFront + ' on screen. Unpin one first.'); return; }
        B.splice(B.indexOf(id), 1);
        A.push(id);
      }
      SD.setLayout(A.concat(B), A);
      renderList();
    }

    function row(m, box, front) {
      const custom = list.some(s => sid(s) === m.id);
      const r = document.createElement('div');
      r.className = 'it' + (custom ? ' cu' : '');
      r._id = m.id;
      r.innerHTML = '<span class="grip" aria-label="Drag to reorder">' + GRIP + '</span><span class="ix"></span><span class="nm"></span>' +
        '<button class="btn del" aria-label="Delete">\u2715</button><button class="btn pin' + (front ? ' on' : '') + '" aria-label="' + (front ? 'Move to Show More' : 'Show on screen') + '">' + PIN + '</button>';
      const ix = r.querySelector('.ix');
      if (m.emoji) ix.textContent = m.emoji; else ix.innerHTML = '<svg viewBox="0 0 24 24">' + m.icon + '</svg>';
      r.querySelector('.nm').textContent = m.label;
      r.querySelector('.pin').addEventListener('click', () => togglePin(m.id));
      r.querySelector('.del').addEventListener('click', () => {
        list = list.filter(s => sid(s) !== m.id);
        save();
        SD.unregister(m.id);
        renderList();
      });
      bindDrag(r, box);
      box.appendChild(r);
    }

    function renderList() {
      if (drag) return;
      lf.innerHTML = '';
      lm.innerHTML = '';
      const A = SD.front(), B = SD.more();
      cnt.textContent = A.length + '/' + SD.maxFront;
      cnt.classList.toggle('full', A.length >= SD.maxFront);
      A.forEach(m => row(m, lf, true));
      B.forEach(m => row(m, lm, false));
      if (!A.length) empty(lf, 'Nothing on screen. Pin up to ' + SD.maxFront + '.');
      if (!B.length) empty(lm, 'Empty');
    }

    // ----- drag the grip handle (edit mode only) to reorder; the list scrolls itself near its top/bottom edge -----
    function bindDrag(row, box) {
      const grip = row.querySelector('.grip');
      grip.addEventListener('pointerdown', e => {
        if (e.button > 0 || !el.classList.contains('edit')) return;
        e.preventDefault();
        drag = { row, box, startY: e.clientY, y: e.clientY, raf: 0 };
        try { grip.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone: the drag simply does not start */ }
        row.classList.add('drag');
        drag.raf = requestAnimationFrame(autoScroll);
      });
      grip.addEventListener('pointermove', e => { if (drag && drag.row === row) { drag.y = e.clientY; moveDrag(); } });
      grip.addEventListener('pointerup', endDrag);
      grip.addEventListener('pointercancel', endDrag);
    }

    function moveDrag() {
      const row = drag.row, lst = drag.box;
      const h = row.offsetHeight + 3;
      let dy = drag.y - drag.startY;
      while (dy > h / 2 && row.nextElementSibling) {
        lst.insertBefore(row.nextElementSibling, row); drag.startY += h; dy -= h;
      }
      while (dy < -h / 2 && row.previousElementSibling) {
        lst.insertBefore(row.previousElementSibling, row.nextSibling); drag.startY -= h; dy += h;   // move the neighbour, not the dragged row
      }
      row.style.transform = 'translateY(' + dy + 'px)';
    }

    const EDGE = 36;   // px from the list's top/bottom edge where scrolling starts
    function autoScroll() {
      if (!drag) return;
      if (!ctx.alive) { drag = null; return; }
      const lst = drag.box;
      const r = lst.getBoundingClientRect();
      let v = 0;
      if (drag.y < r.top + EDGE) v = -(2 + 10 * Math.min(1, (r.top + EDGE - drag.y) / EDGE));
      else if (drag.y > r.bottom - EDGE) v = 2 + 10 * Math.min(1, (drag.y - (r.bottom - EDGE)) / EDGE);
      if (v) {
        const before = lst.scrollTop;
        lst.scrollTop = before + v;
        const moved = lst.scrollTop - before;
        if (moved) { drag.startY -= moved; moveDrag(); }   // the row keeps following the finger
      }
      drag.raf = requestAnimationFrame(autoScroll);
    }

    function endDrag() {
      if (!drag) return;
      cancelAnimationFrame(drag.raf);
      const ids = box => Array.from(box.children).map(r => r._id).filter(Boolean);
      const A = ids(lf), B = ids(lm);   // a row only moves inside its own group; the pin moves it between groups
      drag = null;
      if (A.length + B.length) SD.setLayout(A.concat(B), A);
      renderList();
    }

    el.querySelector('.edit').addEventListener('click', e => {
      SD.editBtn(e.currentTarget, el.classList.toggle('edit'));
    });

    const a = ctx.arg || {};                         // e.g. { page: 'pm', edit: true } from Show More > Arrange
    showPage(a.page || 'pm');
    if (a.edit && el.querySelector('.pm.on')) { el.classList.add('edit'); SD.editBtn(el.querySelector('.edit'), true); }
    return { unmount() { closeTip(); stopTerm(); } };
  }

  SD.register({
    id: 'settings',
    label: 'Settings',
    width: 250,
    pinned: true,
    ord: 1000,
    // gear
    icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    mount
  });
})();

} catch (e) { console.error('Speed Dial: modules/settings.js:', e); try { window.SpeedDial && window.SpeedDial.log('boot', 'modules/settings.js failed: ' + (e && e.message || e), 'e'); } catch (x) { /* log not ready yet */ } }

try {
// Speed Dial feature: Gym Guide v0.7.2
// Highlights the gym tile to train next (Baldr / Hank ratios) and shows a progress panel under the gym icons.
// Reads only what the page shows. No API. Switch it on or off in Settings > Features.
// Ratio logic (roles, eligibility checks, recommendation order) is adapted from
// GymIQ by ClasixTV, MIT License: https://github.com/CLASIX/GymIQ---Torn-Ratio-Helper
(function () {
  'use strict';
  const SD = window.SpeedDial;
  if (!SD) return;

  const LS = 'gymGuide.v2';   // same key as the old standalone script, so your ratio / high stat / war mode carry over

  const KEYS = ['str', 'def', 'spd', 'dex'];
  const NAMES = { str: 'Strength', def: 'Defense', spd: 'Speed', dex: 'Dexterity' };
  const SHORT = { str: 'STR', def: 'DEF', spd: 'SPD', dex: 'DEX' };
  const OFFENSIVE = ['str', 'spd'];
  const DEFENSIVE = ['def', 'dex'];
  const SINGLE_GYM = { str: 'Gym 3000', spd: 'Total Rebound', def: 'Mr. Isoyamas', dex: 'Elites' };
  const WAR_W = { str: 1, spd: 1, def: 1.5, dex: 1.5 };

  const MULTS = {
    baldr: { high: 1, secondary: 0.8, tert1: 0.72, tert2: 0.72 },
    hank:  { high: 1, secondary: 0.8, tert1: 0.8,  tert2: 0.28 }
  };
  const BALDR_ROLES = {
    str: { high: 'str', secondary: 'spd', tert1: 'def', tert2: 'dex' },
    spd: { high: 'spd', secondary: 'str', tert1: 'def', tert2: 'dex' },
    def: { high: 'def', secondary: 'dex', tert1: 'str', tert2: 'spd' },
    dex: { high: 'dex', secondary: 'def', tert1: 'str', tert2: 'spd' }
  };
  const HANK_ROLES = {
    str: { high: 'str', secondary: 'def', tert1: 'dex', tert2: 'spd' },
    spd: { high: 'spd', secondary: 'def', tert1: 'dex', tert2: 'str' },
    def: { high: 'def', secondary: 'str', tert1: 'spd', tert2: 'dex' },
    dex: { high: 'dex', secondary: 'str', tert1: 'spd', tert2: 'def' }
  };

  const rolesFor = (ratio, high) => (ratio === 'hank' ? HANK_ROLES : BALDR_ROLES)[high];
  const isDump = (ratio, roles, k) => ratio === 'hank' && roles.tert2 === k;

  const NUM = /^(str|strength|def|defense|defence|spd|speed|dex|dexterity)([\d,]+(?:\.\d+)?)$/;
  const KEYMAP = { str: 'str', strength: 'str', def: 'def', defense: 'def', defence: 'def', spd: 'spd', speed: 'spd', dex: 'dex', dexterity: 'dex' };

  const CSS = `
    .ggd-hl{outline:3px solid #85b200 !important;outline-offset:-3px;
      box-shadow:inset 0 0 8px rgba(133,178,0,.3), 0 0 4px rgba(133,178,0,.45) !important}
    .ggd-tag{position:absolute;right:6px;bottom:4px;height:12px;line-height:12px;padding:0 5px;
      font-size:8px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;white-space:nowrap;color:#111;background:#85b200;border-radius:2px;pointer-events:none;z-index:2}
    .ggd-hl.bad{outline-color:#e0584a !important;box-shadow:inset 0 0 8px rgba(224,88,74,.3), 0 0 4px rgba(224,88,74,.45) !important}
    .ggd-tag.bad{background:#e0584a;color:#fff}
    #ggd,#ggd-b{box-sizing:border-box;max-width:100%;font-family:inherit;font-size:12px;line-height:1.4;color:#ccc;text-align:left;font-weight:400}
    #ggd *,#ggd-b *{box-sizing:border-box;font-family:inherit}
    #ggd button,#ggd-b button{font-family:inherit;font-size:12px;font-weight:400;cursor:pointer}
    #ggd{margin:10px 0 0;width:100%}
    #ggd .hd{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;
      background:linear-gradient(to bottom,#454545,#363636);border-top:1px solid #555;border-bottom:1px solid #1c1c1c}
    #ggd .hd b{color:#fff;font-size:13px;font-weight:700}
    #ggd .badge{font-size:12px;font-weight:400}
    #ggd .bd{padding:8px 12px 10px;background:#2c2c2c;border-bottom:1px solid #1c1c1c}
    #ggd .sr{display:flex;align-items:center;gap:10px;height:24px}
    #ggd .sr .k{flex:none;width:30px;font-weight:400;color:#999}
    #ggd .sr .bar{flex:1;height:5px;border-radius:3px;background:#161616;overflow:hidden}
    #ggd .sr .bar i{display:block;height:100%;border-radius:3px;background:#5b7fa8}
    #ggd .sr .p{flex:none;width:48px;text-align:right;white-space:nowrap;color:#999}
    #ggd .sr.n .k,#ggd .sr.n .p{color:#85b200}
    #ggd .sr.n .bar i{background:#85b200}
    #ggd .sr .bar i.over{background:#d9a441}
    #ggd .sr.x{opacity:.45}
    #ggd .why{margin-top:6px;padding-top:6px;border-top:1px solid #3a3a3a;color:#ddd}
    #ggd-b{width:100%;padding:10px 12px 12px;background:#2c2c2c;border-bottom:1px solid #1c1c1c}
    #ggd-b .bt{margin-bottom:4px;color:#fff;font-weight:700}
    #ggd-b .gr{display:flex;align-items:center;gap:10px;padding:4px 0}
    #ggd-b .gr .dt{flex:none;width:8px;height:8px;border-radius:50%}
    #ggd-b .gr .gn{flex:1;min-width:0;color:#ccc}
    #ggd-b .gr .gn small{display:block;font-size:11px;color:#888}
    #ggd-b .gr .gv{flex:none;white-space:nowrap;font-weight:400;text-align:right}
    #ggd .ok,#ggd-b .ok{color:#85b200}#ggd .warn,#ggd-b .warn{color:#d9a441}#ggd .bad,#ggd-b .bad{color:#e0584a}
    #ggd-b .dt.ok{background:#85b200}#ggd-b .dt.warn{background:#d9a441}#ggd-b .dt.bad{background:#e0584a}
    #ggd-b .opt{display:flex;align-items:center;justify-content:space-between;width:100%;height:32px;margin-top:8px;padding:0 10px;
      border:1px solid #1a1a1a;border-radius:4px;color:#ccc;background:linear-gradient(to bottom,#3d3d3d,#2f2f2f)}
    #ggd-b .set{margin-top:6px}
    #ggd-b .set label{display:block;margin:8px 0 4px;font-size:11px;color:#888}
    #ggd-b .seg{display:flex}
    #ggd-b .seg button{flex:1;height:30px;border:1px solid #1a1a1a;margin-left:-1px;color:#bbb;background:linear-gradient(to bottom,#3d3d3d,#2f2f2f)}
    #ggd-b .seg button:first-child{margin-left:0;border-radius:4px 0 0 4px}
    #ggd-b .seg button:last-child{border-radius:0 4px 4px 0}
    #ggd-b .seg button.on{color:#fff;background:linear-gradient(to bottom,#555,#444);box-shadow:inset 0 -2px 0 #85b200}
  `;

  function start(ctx) {
    // the old standalone Gym Guide userscript sets this flag; two copies would fight over the same elements
    if (window.__gymGuide) throw new Error('the old standalone Gym Guide script is still installed. Remove it from PDA.');

    // ---------- prefs ----------
    let P;
    P = SD.read(LS, null);
    P = Object.assign({ ratio: 'baldr', high: 'auto', war: false }, P || {});
    if (!MULTS[P.ratio]) P.ratio = 'baldr';
    const savePrefs = () => SD.write(LS, P);

    // ---------- logic ----------
    function resolveHigh(stats) {
      if (P.high !== 'auto' && KEYS.indexOf(P.high) > -1) return P.high;
      return KEYS.reduce((a, b) => (stats[b] > stats[a] ? b : a));
    }

    function targetsFor(stats, ratio, high) {
      const roles = rolesFor(ratio, high), m = MULTS[ratio], t = {};
      Object.keys(roles).forEach(r => { t[roles[r]] = stats[high] * m[r]; });
      return t;
    }

    function eligibility(stats, ratio, high) {
      const total = KEYS.reduce((s, k) => s + stats[k], 0);
      if (total <= 0) return [];
      const second = Math.max.apply(null, KEYS.filter(k => k !== high).map(k => stats[k]));
      const highOff = OFFENSIVE.indexOf(high) > -1;
      const highSide = highOff ? OFFENSIVE : DEFENSIVE;
      const oppSide = highOff ? DEFENSIVE : OFFENSIVE;
      const primary = ratio === 'hank' ? oppSide : highSide;
      const secondary = ratio === 'hank' ? highSide : oppSide;
      const sum = a => a.reduce((s, k) => s + stats[k], 0);
      const mk = (id, gym, actual, required, qual, vs) => ({ id, gym, actual, required, margin: actual - required, ok: actual >= required, qual, vs });
      return [
        mk('single', SINGLE_GYM[high], stats[high], second * 1.25, [high], SHORT[high] + ' vs next highest stat'),
        mk('combo', primary === OFFENSIVE ? 'Frontline Fitness' : 'Balboas Gym', sum(primary), sum(secondary) * 1.25, primary,
          primary.map(k => SHORT[k]).join(' + ') + ' vs ' + secondary.map(k => SHORT[k]).join(' + '))
      ];
    }

    function recommend(stats, ratio, high, war) {
      const roles = rolesFor(ratio, high), m = MULTS[ratio], t = targetsFor(stats, ratio, high);
      const w = k => (war ? WAR_W[k] : 1);

      const el = eligibility(stats, ratio, high);
      const combo = el.find(c => c.id === 'combo' && !c.ok);
      if (combo) {
        const under = combo.qual.filter(k => t[k] > 0 && stats[k] < t[k] * 0.98);
        const cands = under.length ? under : combo.qual;
        const pick = (!under.length && cands.indexOf(high) > -1) ? high
          : cands.reduce((lo, k) => (stats[k] / (t[k] || 1) < stats[lo] / (t[lo] || 1) ? k : lo));
        return { stat: pick, reason: 'access', gym: combo.gym, need: -combo.margin };
      }
      const single = el.find(c => c.id === 'single' && !c.ok);
      if (single) return { stat: high, reason: 'access', gym: single.gym, need: -single.margin };

      let best = null;
      Object.keys(roles).forEach(r => {
        const k = roles[r];
        if (r === 'high' || isDump(ratio, roles, k) || !(t[k] > 0) || stats[k] >= t[k] * 0.98) return;
        const sev = ((t[k] - stats[k]) / t[k]) * w(k);
        if (!best || sev > best.sev) best = { stat: k, reason: 'below', sev, pct: Math.round((stats[k] / t[k]) * 100) };
      });
      if (best) return best;

      let reqHigh = stats[high];
      Object.keys(roles).forEach(r => {
        if (r === 'high' || !(m[r] > 0)) return;
        const tol = isDump(ratio, roles, roles[r]) ? 1 : 1.05;
        reqHigh = Math.max(reqHigh, stats[roles[r]] / (m[r] * tol));
      });
      if (reqHigh > stats[high] * 1.001) {
        if (ratio === 'hank') {
          let prep = null;
          ['secondary', 'tert1'].forEach(r => {
            const k = roles[r], fut = reqHigh * m[r];
            if (stats[k] >= fut * 0.98) return;
            const sev = ((fut - stats[k]) / fut) * w(k);
            if (!prep || sev > prep.sev) prep = { stat: k, reason: 'prepare', sev };
          });
          if (prep) return prep;
        }
        return { stat: high, reason: 'raise' };
      }

      if (ratio === 'hank') {
        const k = ['secondary', 'tert1'].map(r => roles[r])
          .reduce((lo, x) => (stats[x] / (t[x] || 1) / w(x) < stats[lo] / (t[lo] || 1) / w(lo) ? x : lo));
        return { stat: k, reason: 'maintain' };
      }
      return { stat: high, reason: 'maintain' };
    }

    function grade(stats, ratio, high) {
      const roles = rolesFor(ratio, high), t = targetsFor(stats, ratio, high);
      let sum = 0;
      KEYS.forEach(k => {
        const a = stats[k], g = t[k];
        if (g === 0) sum += a === 0 ? 1 : 0;
        else if (isDump(ratio, roles, k) && a <= g) sum += 1;
        else sum += Math.min(a, g) / Math.max(a, g);
      });
      const score = Math.round((sum / 4) * 100);
      const letter = score >= 98 ? 'A+' : score >= 93 ? 'A' : score >= 88 ? 'B+' : score >= 83 ? 'B'
        : score >= 78 ? 'C+' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
      return { score, letter };
    }

    // ---------- read stats (from the page only) ----------
    // Tile of a stat = the biggest ancestor of its number element that does not contain
    // the number element of any other stat (so it works whatever the tile's inner markup is).
    function tileOf(el, k) {
      const others = [];
      KEYS.forEach(o => { if (o !== k) (tiles[o] || []).forEach(x => others.push(x)); });
      let node = el;
      while (node.parentElement && node.parentElement !== document.body) {
        const p = node.parentElement;
        if (others.some(x => p.contains(x))) break;
        node = p;
      }
      return node;
    }

    let tiles = { str: [], def: [], spd: [], dex: [] };
    let blocked = {};   // stats shown as "Unavailable" in the current gym

    function readDom() {
      const out = {}, found = { str: [], def: [], spd: [], dex: [] };
      document.querySelectorAll('li, div, span, p, h3, h4').forEach(el => {
        if (el.children.length > 4 || el.closest('#ggd') || el.closest('#ggd-b')) return;
        const txt = el.textContent.replace(/[\s:]+/g, '').toLowerCase();
        if (txt.length > 20) return;
        const m = txt.match(NUM);
        if (m) { const k = KEYMAP[m[1]]; out[k] = parseFloat(m[2].replace(/,/g, '')); found[k].push(el); }
      });
      if (!KEYS.every(k => typeof out[k] === 'number')) return null;
      tiles = found;
      const bl = {};
      KEYS.forEach(k => {
        bl[k] = found[k].some(el => {
          const t = tileOf(el, k);
          return !!(t && /unavailable/i.test(t.textContent));
        });
      });
      blocked = bl;
      return out;
    }

    let curRec = null;

    function clearHighlight() {
      document.querySelectorAll('.ggd-hl').forEach(n => {
        n.classList.remove('ggd-hl', 'bad');
        if (n.dataset.ggdPos) { n.style.position = ''; delete n.dataset.ggdPos; }
      });
      document.querySelectorAll('.ggd-tag').forEach(n => n.remove());
    }

    function applyHighlight() {
      clearHighlight();
      if (!curRec) return;
      const done = [];
      (tiles[curRec] || []).forEach(el => {
        const t = tileOf(el, curRec);
        if (!t || done.indexOf(t) > -1) return;
        done.push(t);
        const bad = !!blocked[curRec];
        if (getComputedStyle(t).position === 'static') { t.style.position = 'relative'; t.dataset.ggdPos = '1'; }
        t.classList.add('ggd-hl');
        if (bad) t.classList.add('bad');
        const tag = document.createElement('span');
        tag.className = 'ggd-tag' + (bad ? ' bad' : '');
        tag.textContent = bad ? 'Not Available' : 'Recommended';
        t.appendChild(tag);
      });
    }

    // ---------- UI ----------
    ctx.css(CSS);

    const box = document.createElement('div');   // stat progress
    box.id = 'ggd';
    const bbox = document.createElement('div');  // gym access + settings
    bbox.id = 'ggd-b';
    let stats = null, optOpen = false;

    const fmtK = n => { n = Math.abs(n); return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(Math.round(n)); };

    function render() {
      if (!stats) {
        box.innerHTML = '<div class="hd"><b>Gym guide</b><span style="color:#999">Reading your stats...</span></div>';
        bbox.innerHTML = '';
        return;
      }
      const high = resolveHigh(stats);
      const ratio = P.ratio;
      const roles = rolesFor(ratio, high);
      const t = targetsFor(stats, ratio, high);
      const rec = recommend(stats, ratio, high, P.war);
      const g = grade(stats, ratio, high);
      const el = eligibility(stats, ratio, high);
      curRec = rec.stat;

      const why =
        blocked[rec.stat] ? '<b>' + NAMES[rec.stat] + '</b> is recommended but not available in this gym'
        : rec.reason === 'below' ? 'Train <b>' + NAMES[rec.stat] + '</b> \u00b7 ' + rec.pct + '% of target'
        : rec.reason === 'access' ? 'Train <b>' + NAMES[rec.stat] + '</b> to restore ' + rec.gym
        : rec.reason === 'prepare' ? 'Train <b>' + NAMES[rec.stat] + '</b> before raising ' + SHORT[high]
        : rec.reason === 'raise' ? 'Train <b>' + NAMES[rec.stat] + '</b> \u00b7 other stats are over target'
        : 'Balanced. Train <b>' + NAMES[rec.stat] + '</b> to start the next cycle';

      const gc = g.score >= 90 ? 'ok' : g.score >= 75 ? 'warn' : 'bad';
      let top = '<div class="hd"><b>Gym guide</b><span class="badge ' + gc + '">' + g.letter + ' \u00b7 ' + g.score + '%</span></div><div class="bd">';
      KEYS.forEach(k => {
        const dump = isDump(ratio, roles, k);
        const rp = t[k] > 0 ? stats[k] / t[k] : 0;
        const pct = Math.round(rp * 100);
        const over = k !== high && (dump ? rp > 1 : rp > 1.05);
        const lbl = blocked[k] ? 'n/a' : k === high ? 'High' : dump ? 'max' : pct + '%';
        top += '<div class="sr' + (k === rec.stat ? ' n' : '') + (blocked[k] ? ' x' : '') + '"><span class="k">' + SHORT[k] + '</span>' +
          '<div class="bar"><i class="' + (over ? 'over' : '') + '" style="width:' + Math.min(pct, 100) + '%"></i></div><span class="p">' + lbl + '</span></div>';
      });
      top += '<div class="why">' + why + '</div></div>';
      box.innerHTML = top;

      let bot = '<div class="bt">Your build: gym access</div>';
      el.forEach(c => {
        const near = c.ok && c.margin <= Math.max(c.required * 0.005, 1);
        const cls = !c.ok ? 'bad' : near ? 'warn' : 'ok';
        const val = c.ok ? '+' + fmtK(c.margin) : 'needs ' + fmtK(c.margin);
        bot += '<div class="gr"><span class="dt ' + cls + '"></span><span class="gn">' + c.gym + '<small>' + c.vs + '</small></span><span class="gv ' + cls + '">' + val + '</span></div>';
      });
      bot += '<button class="opt" data-o="1"><span>' + (ratio === 'hank' ? 'Hank' : 'Baldr') + ' \u00b7 High: ' + SHORT[high] +
        (P.high === 'auto' ? ' (auto)' : '') + (P.war ? ' \u00b7 War' : '') + '</span><span>' + (optOpen ? '\u25b2' : '\u25bc') + '</span></button>';
      if (optOpen) {
        bot += '<div class="set"><label>Ratio</label><div class="seg">' +
          '<button data-r="baldr" class="' + (ratio === 'baldr' ? 'on' : '') + '">Baldr</button>' +
          '<button data-r="hank" class="' + (ratio === 'hank' ? 'on' : '') + '">Hank</button></div>' +
          '<label>High stat</label><div class="seg">' +
          ['auto'].concat(KEYS).map(h => '<button data-h="' + h + '" class="' + (P.high === h ? 'on' : '') + '">' + (h === 'auto' ? 'Auto' : SHORT[h]) + '</button>').join('') +
          '</div><label>War mode (favor DEF and DEX)</label><div class="seg">' +
          '<button data-w="0" class="' + (!P.war ? 'on' : '') + '">Off</button><button data-w="1" class="' + (P.war ? 'on' : '') + '">On</button></div></div>';
      }
      bbox.innerHTML = bot;
      applyHighlight();
    }

    function onClick(e) {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.o) optOpen = !optOpen;
      else if (b.dataset.r) { P.ratio = b.dataset.r; savePrefs(); }
      else if (b.dataset.h) { P.high = b.dataset.h; savePrefs(); }
      else if (b.dataset.w) { P.war = b.dataset.w === '1'; savePrefs(); }
      else return;
      render();
    }
    box.addEventListener('click', onClick);
    bbox.addEventListener('click', onClick);

    // ---------- mounting: below the gym icon grid ----------
    function findGymGrid() {
      const items = document.querySelectorAll('li[id^="gym-"], li[class*="gymButton"], [class*="gymButton"]');
      if (items.length) {
        const last = items[items.length - 1];
        if (last.parentElement) return last.parentElement;
      }
      let found = null;
      document.querySelectorAll('ul').forEach(ul => {
        if (ul.closest('#ggd') || ul.closest('#ggd-b')) return;
        if (ul.children.length >= 12) found = ul;
      });
      return found;
    }

    let gridMisses = 0;
    function mount() {
      const grid = findGymGrid();
      if (grid) {
        // keep box + bbox directly after the grid
        if (grid.nextElementSibling !== box || box.nextElementSibling !== bbox) {
          grid.insertAdjacentElement('afterend', box);
          box.insertAdjacentElement('afterend', bbox);
        }
        return;
      }
      if (box.isConnected) return;
      if (++gridMisses < 8) return;
      // fallback: under the "What would you like to train" message
      for (const el of document.querySelectorAll('div, p, span, h3, h4')) {
        if (el.children.length < 3 && /^What would you like to train/i.test(el.textContent.trim()) && el.parentNode) {
          el.insertAdjacentElement('afterend', box);
          box.insertAdjacentElement('afterend', bbox);
          return;
        }
      }
    }

    let last = '';
    function tick() {
      if (document.hidden) return;
      mount();
      const s = readDom();
      if (!s) { if (box.isConnected && !stats) render(); return; }
      // include which stats are unavailable, so switching gyms re-renders even when the numbers are the same
      const key = KEYS.map(k => s[k]).join('|') + '#' + KEYS.map(k => (blocked[k] ? 1 : 0)).join('');
      if (key !== last) { last = key; stats = s; render(); }
      applyHighlight();
    }

    render();
    tick();
    ctx.every(tick, 1500);   // cleared by the core when the feature is switched off
    window.__gymGuide = true;

    return {
      // undo everything this feature put on the page (timer and <style> are removed by the core)
      stop() {
        box.remove();
        bbox.remove();
        clearHighlight();
        delete window.__gymGuide;
      }
    };
  }

  SD.feature({
    id: 'gymguide',
    label: 'Gym Guide',
    group: 'Gym',
    where: 'Gym',
    info: 'Highlights the best gym to train next, with stat progress and gym access info.',
    match: /^\/gym\.php/,
    start
  });
})();

} catch (e) { console.error('Speed Dial: features/gymguide.js:', e); try { window.SpeedDial && window.SpeedDial.log('boot', 'features/gymguide.js failed: ' + (e && e.message || e), 'e'); } catch (x) { /* log not ready yet */ } }

try {
// Speed Dial feature: High-Low Helper v0.2.0
// Casino High-Low (page.php?sid=highlow): the chance that YOUR face-down card is higher or lower than the DEALER's card, and which one to pick.
// Split off the old Casino Helper (one page = one feature file). Reads only the cards and buttons the page shows. It NEVER clicks anything and uses no API.
// Switch it on or off in Settings > Features.
//   - The dealer card is picked by name (a dealer ancestor), then by position. Face-down, hidden, faded-out and covered cards are ignored.
//   - Odds: a full deck minus the dealer card (51 left). The chance of the same rank is shown too and counts for neither side.
//   - Manual mode: tap the dealer card yourself if the page markup is not recognised. Settings > Terminal tells what was (not) read.
//   - Between rounds (Higher / Lower buttons gone or greyed out) the panel goes back to "waiting" and the typed-in card is cleared.
//   - Rules: ace high or low. Saved under speedDial.highlow1 (the ace rule of the old combined helper, speedDial.casino1, is carried over).
(function () {
  'use strict';
  const SD = window.SpeedDial;
  if (!SD) return;

  const LS = 'speedDial.highlow1';
  const OLD = 'speedDial.casino1';

  // ---------- cards ----------
  const RL = [null, 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];   // rank 1..13

  const RK = '13|12|11|10|[1-9]|[ajqk]|ace|king|queen|jack|ten';
  const SU = 'hearts?|diamonds?|spades?|clubs?';
  const RA = new RegExp('(?:^|[\\s_\\-./])(' + SU + ')[\\s_\\-.]*(' + RK + ')(?![a-z0-9])', 'i');                       // hearts-10, spades_A, clubs K
  const RB = new RegExp('(?:^|[\\s_\\-./])(' + RK + ')[\\s_\\-.]*(?:of[\\s_\\-.]*)?(' + SU + ')(?![a-z])', 'i');         // 7 of hearts, 10-spades
  const WORD = { a: 1, ace: 1, j: 11, jack: 11, q: 12, queen: 12, k: 13, king: 13, ten: 10 };
  const SYM = { '\u2660': 's', '\u2665': 'h', '\u2666': 'd', '\u2663': 'c' };
  const rankOf = s => { s = String(s).toLowerCase(); return WORD[s] || parseInt(s, 10) || 0; };

  // el needs: className, getAttribute(), textContent. Returns { r: 1..13, s: suit letter c/d/h/s or '?' } or null.
  function parseCard(el) {
    const cn = el.className && typeof el.className === 'object' ? (el.className.baseVal || '') : (el.className || '');
    const g = n => (el.getAttribute && el.getAttribute(n)) || '';
    const src = String(g('src')).split('/').pop();
    // every attribute is tested on its own: joining them could glue a suit from one onto a rank from another
    const fields = [cn, g('aria-label'), g('alt'), g('title'), g('data-card'), (g('data-rank') + ' ' + g('data-suit')).trim(), src];
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (!f) continue;
      let m = RA.exec(f);
      if (m) { const r = rankOf(m[2]); if (r >= 1 && r <= 13) return { r, s: m[1][0].toLowerCase() }; }
      m = RB.exec(f);
      if (m) { const r = rankOf(m[1]); if (r >= 1 && r <= 13) return { r, s: m[2][0].toLowerCase() }; }
    }
    const tx = String(el.textContent || '').trim();
    if (tx.length && tx.length <= 4) {
      const m = /^(10|[2-9]|[AJQK])\s*([\u2660\u2665\u2666\u2663])$/.exec(tx) || /^([\u2660\u2665\u2666\u2663])\s*(10|[2-9]|[AJQK])$/.exec(tx);
      if (m) {
        const sym = SYM[m[1]] ? m[1] : m[2], rk = sym === m[1] ? m[2] : m[1], r = rankOf(rk);
        if (r) return { r, s: SYM[sym] };
      }
    }
    return null;
  }


  // ---------- High-Low ----------
  // every draw comes from a full 52-card deck minus the card on the table
  function highLow(rank, o) {
    const val = r => (o.aceHigh && r === 1 ? 14 : r);
    const cur = val(rank);
    let hi = 0, lo = 0, tie = 0;
    for (let r = 1; r <= 13; r++) {
      const n = r === rank ? 3 : 4, v = val(r);
      if (v > cur) hi += n; else if (v < cur) lo += n; else tie += n;
    }
    return { higher: hi / 51, lower: lo / 51, tie: tie / 51, pick: hi >= lo ? 'Higher' : 'Lower' };
  }


  // ---------- page reading ----------
  const SEL = '[class*="hearts" i],[class*="diamonds" i],[class*="spades" i],[class*="clubs" i],[class*="heart-" i],[class*="spade-" i],[class*="club-" i],[class*="diamond-" i],' +
    '[class*="card" i],img[alt],[aria-label],[data-card],[title]';
  const DEALER = /dealer|croupier/i;
  const PLAYER = /(^|[^a-z])(player|you|your|user)([^a-z]|$)/i;
  const BTN = 'button,a,li,[role="button"],input[type="button"],input[type="submit"],[class*="btn" i],[class*="button" i],[class*="action" i]';
  // label = letters only, so "Higher" and "HIGHER" both match. Exact words only.
  const LABEL = { higher: 'U', high: 'U', lower: 'L', low: 'L' };
  const OFF = /(^|[\s_-])(disabled|inactive|unavailable)([\s_-]|$)/i;
  const mine = el => !!el.closest('#csh, #sdial');
  const seen = el => !!(el.getClientRects && el.getClientRects().length);

  const BACKS = /^(back|facedown|face-down|cardback|card-back)$/i;   // class token of a card lying face down
  const faceDown = el => String(typeof el.className === 'string' ? el.className : '').split(/\s+/).some(t => BACKS.test(t));

  function shown(el) {   // really on screen: has a size, not hidden, not (almost) transparent
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    for (let n = el, i = 0; n && n.nodeType === 1 && i < 6; i++, n = n.parentElement) {
      let cs;
      try { cs = getComputedStyle(n); } catch (e) { break; }
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.1) return false;
    }
    return true;
  }


  function onTop(el) {   // nothing unrelated is painted over the middle of the card (an old card under a new one, a flipped-away face)
    const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return true;   // cannot test off screen
    const hit = document.elementFromPoint(x, y);
    return !hit || el.contains(hit) || hit.contains(el) || mine(hit);
  }

  function readCards() {
    const root = document.querySelector('.content-wrapper') || document;   // the game only: not Torn's sidebar, chat or header
    const list = [];
    root.querySelectorAll(SEL).forEach(el => {
      if (mine(el) || !seen(el) || faceDown(el)) return;
      const c = parseCard(el);
      if (c) list.push({ el, r: c.r, s: c.s });
    });
    const inner = list.filter(a => !list.some(b => b !== a && a.el.contains(b.el)));   // innermost element of each card only
    inner.forEach((c, i) => {
      const b = c.el.getBoundingClientRect();
      c.i = i; c.x = b.left + b.width / 2;
      c.shown = shown(c.el); c.top = c.shown && onTop(c.el); c.role = roleOf(c.el);
    });
    return inner;
  }

  function roleOf(el) {
    let n = el;
    for (let i = 0; n && n !== document.body && i < 7; i++, n = n.parentElement) {
      const id = (n.id || '') + ' ' + (typeof n.className === 'string' ? n.className : '');
      if (DEALER.test(id)) return 'd';
      if (PLAYER.test(id)) return 'p';
    }
    return null;
  }

  // High-Low: the card the odds are about is the DEALER's face-up card (yours is face down until you choose).
  // Order: visible cards only, then not-yours, then named "dealer", then on top, then leftmost (the dealer sits left), then newest in the page.
  function pickDealer(cards) {
    if (!cards.length) return null;
    const vis = cards.filter(c => c.shown), pool = vis.length ? vis : cards;
    const notMine = pool.filter(c => c.role !== 'p'), base = notMine.length ? notMine : pool;
    const named = base.filter(c => c.role === 'd'), from = named.length ? named : base;
    const better = (a, b) => {
      if (a.top !== b.top) return a.top;
      if (!named.length && Math.abs(a.x - b.x) > 8) return a.x < b.x;
      return a.i > b.i;
    };
    return from.reduce((x, c) => (x === null || better(c, x) ? c : x), null);
  }

  function describe(cards, pick) {   // one short line for Settings > Terminal: what was seen and which one was used
    return cards.slice(0, 6).map(c => (c === pick ? '*' : '') + RL[c.r] + (c.s !== '?' ? c.s : '') + '/' + (c.role || '-') + (c.shown ? '' : '!hid') + (c.shown && !c.top ? '!cov' : '') + '@' + Math.round(c.x)).join(' ');
  }

  function isOff(el) {   // greyed out: disabled attribute, a disabled class on the button or its two parents, or taps ignored
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return true;
    try { if (getComputedStyle(el).pointerEvents === 'none') return true; } catch (e) { /* ignore */ }
    for (let n = el, i = 0; n && i < 3; i++, n = n.parentElement) if (OFF.test(typeof n.className === 'string' ? n.className : '')) return true;
    return false;
  }

  function readButtons() {
    const root = document.querySelector('.content-wrapper') || document;
    const st = {};
    root.querySelectorAll(BTN).forEach(el => {
      if (mine(el) || el.children.length > 3 || !seen(el)) return;
      const k = LABEL[String(el.value && el.tagName === 'INPUT' ? el.value : el.textContent || '').toLowerCase().replace(/[^a-z]/g, '')];
      if (!k) return;
      const x = st[k] || (st[k] = { n: 0, off: 0 });
      x.n++;
      if (isOff(el)) x.off++;
    });
    const on = new Set(), blocked = new Set();
    Object.keys(st).forEach(k => { if (st[k].off === st[k].n) blocked.add(k); else on.add(k); });
    return { on, blocked };
  }

  // ---------- UI ----------
  const CSS = `
    #csh,#csh *{box-sizing:border-box;font-family:inherit}
    #csh{max-width:100%;margin:10px 0 0;width:100%;font-size:12px;line-height:1.4;color:#ccc;text-align:left;font-weight:400}
    #csh button{font-family:inherit;font-size:12px;font-weight:400;cursor:pointer;touch-action:manipulation}
    #csh .hd{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:linear-gradient(to bottom,#454545,#363636);border-top:1px solid #555;border-bottom:1px solid #1c1c1c}
    #csh .hd b{color:#fff;font-size:13px;font-weight:700}
    #csh .bd{padding:10px 12px;background:#2c2c2c;border-bottom:1px solid #1c1c1c}
    #csh .big{font-size:22px;font-weight:700;letter-spacing:.02em;line-height:1.1}
    #csh .big small{font-size:12px;font-weight:400;color:#999;letter-spacing:0;margin-left:6px}
    #csh .why{margin-top:6px;color:#bbb}
    #csh .nt{margin-top:6px;color:#d9a441}
    #csh .ok{color:#85b200}#csh .warn{color:#d9a441}#csh .bad{color:#e0584a}#csh .dim{color:#999}
    #csh .hl{display:flex;align-items:center;gap:8px;padding:3px 0}
    #csh .hl .k{flex:none;width:54px;color:#999}
    #csh .hl .t{flex:1;height:6px;border-radius:3px;background:#161616;overflow:hidden}
    #csh .hl .t i{display:block;height:100%;background:#5b7fa8}
    #csh .hl.n .k{color:#85b200}#csh .hl.n .t i{background:#85b200}
    #csh .hl .v{flex:none;width:40px;text-align:right}
    #csh .ft{display:flex;gap:6px;padding:8px 12px 10px;background:#2c2c2c;border-bottom:1px solid #1c1c1c}
    #csh .ft button,#csh .opt button{flex:1;height:30px;border:1px solid #1a1a1a;border-radius:4px;color:#ccc;background:linear-gradient(to bottom,#3d3d3d,#2f2f2f)}
    #csh .ft button.on{color:#fff;box-shadow:inset 0 -2px 0 #85b200}
    #csh .pn{padding:2px 12px 10px;background:#2c2c2c;border-bottom:1px solid #1c1c1c}
    #csh .pn label{display:block;margin:8px 0 4px;font-size:11px;color:#888}
    #csh .seg{display:flex}
    #csh .seg button{flex:1;height:30px;border:1px solid #1a1a1a;margin-left:-1px;color:#bbb;background:linear-gradient(to bottom,#3d3d3d,#2f2f2f)}
    #csh .seg button:first-child{margin-left:0;border-radius:4px 0 0 4px}
    #csh .seg button:last-child{border-radius:0 4px 4px 0}
    #csh .seg button.on{color:#fff;background:linear-gradient(to bottom,#555,#444);box-shadow:inset 0 -2px 0 #85b200}
    #csh .kp{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-top:6px}
    #csh .kp button{height:32px;border:1px solid #1a1a1a;border-radius:4px;color:#ddd;background:linear-gradient(to bottom,#3d3d3d,#2f2f2f);padding:0}
    #csh .mh{display:flex;align-items:center;gap:8px;padding:4px 0}
    #csh .mh button{flex:none;min-width:64px;height:28px;border:1px solid #1a1a1a;border-radius:4px;color:#bbb;background:linear-gradient(to bottom,#3d3d3d,#2f2f2f)}
    #csh .mh button.on{color:#fff;box-shadow:inset 0 -2px 0 #85b200}
    #csh .mh span{flex:1;min-width:0;color:#fff;font-weight:700;letter-spacing:.04em}
    #csh.fx{position:fixed;left:0;right:0;bottom:0;z-index:99998;margin:0}
  `;


  const pc = x => Math.round(x * 100);
  const cls = p => (p >= 0.55 ? 'ok' : p >= 0.45 ? 'warn' : 'bad');

  function start(ctx) {
    const oldAce = (SD.read(OLD, null) || {}).aceHigh;
    let P = Object.assign({ aceHigh: typeof oldAce === 'boolean' ? oldAce : true }, SD.read(LS, null) || {});
    const save = () => SD.write(LS, P);
    const M = { on: false, cur: null };   // manual entry (not saved)
    let rulesOpen = false, last = '', misses = 0, dumped = false, readCount = '', sawTurn = false, wasOver = false, active = false;

    ctx.css(CSS);
    const box = document.createElement('div');
    box.id = 'csh';

    // ----- what the page (or the manual keypad) says right now -----
    function readState() {
      // is a round being played? Over = the Higher / Lower buttons were seen on this page and none is enabled now
      const b = readButtons(), keys = ['U', 'L'];
      if (keys.some(k => b.on.has(k) || b.blocked.has(k))) sawTurn = true;
      const turn = keys.some(k => b.on.has(k)), over = sawTurn && !turn;
      if (over !== wasOver) { wasOver = over; if (over) M.cur = null; }   // round just ended: forget the card typed in
      if (M.on) return { src: 'manual', cur: M.cur };
      if (over) return { src: 'idle' };
      const cards = readCards();
      if (!cards.length) return { src: 'none' };
      const pk = pickDealer(cards);
      return { src: 'page', cur: pk.r, count: cards.length, sig: describe(cards, pk) };
    }

    // ----- drawing -----
    function renderHL(s) {
      if (!s.cur) return '<div class="bd"><span class="dim">' + (s.src === 'manual' ? 'Tap the dealer card.' : 'Waiting for the dealer card...') + '</span></div>';
      const r = highLow(s.cur, P), top = r.pick === 'Higher' ? r.higher : r.lower;
      const row = (k, v, best) => '<div class="hl' + (best ? ' n' : '') + '"><span class="k">' + k + '</span><div class="t"><i style="width:' + v * 100 + '%"></i></div><span class="v ' + (best ? cls(v) : 'dim') + '">' + pc(v) + '%</span></div>';
      return '<div class="bd"><div class="big ' + cls(top) + '">' + r.pick.toUpperCase() + '<small>' + pc(top) + '% \u00b7 dealer ' + RL[s.cur] + '</small></div>' +
        '<div style="margin-top:6px">' + row('Higher', r.higher, r.pick === 'Higher') + row('Lower', r.lower, r.pick === 'Lower') + '</div>' +
        '<div class="why dim">Same rank: ' + pc(r.tie) + '%' + (P.aceHigh ? ' \u00b7 ace = high' : ' \u00b7 ace = low') + '</div>' +
        (top < 0.5 ? '<div class="nt">Under 50%: if the game lets you take your winnings now, that is the safer move.</div>' : '') +
        '</div>';
    }

    function renderNone() {
      return '<div class="bd"><span class="dim">Cards not found on this page yet.</span></div>';
    }

    function renderIdle() {   // standard state between rounds
      return '<div class="bd"><span class="dim">Waiting for the next round...</span></div>';
    }


    function render(s) {
      const sg = (k, la, lb) => '<div class="seg"><button data-s="' + k + '" data-v="0" class="' + (!P[k] ? 'on' : '') + '">' + la + '</button><button data-s="' + k + '" data-v="1" class="' + (P[k] ? 'on' : '') + '">' + lb + '</button></div>';
      let h = '<div class="hd"><b>High-Low Helper</b></div>';
      h += s.src === 'none' ? renderNone() : s.src === 'idle' ? renderIdle() : renderHL(s);
      h += '<div class="ft"><button data-a="man" class="' + (M.on ? 'on' : '') + '">Manual</button><button data-a="rules">Rules ' + (rulesOpen ? '\u25b2' : '\u25bc') + '</button></div>';
      if (M.on) {
        h += '<div class="pn"><div class="kp">';
        for (let r = 1; r <= 13; r++) h += '<button data-r="' + r + '">' + RL[r] + '</button>';
        h += '<button data-a="clear">\u232b</button></div></div>';
      }
      if (rulesOpen) h += '<div class="pn"><label>Ace counts as</label>' + sg('aceHigh', 'Low', 'High') + '</div>';
      box.innerHTML = h;
    }

    // ----- taps -----
    box.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      const d = b.dataset;
      if (d.a === 'man') { M.on = !M.on; last = ''; }
      else if (d.a === 'rules') { rulesOpen = !rulesOpen; last = ''; }
      else if (d.a === 'clear') { M.cur = null; last = ''; }
      else if (d.r) { M.cur = parseInt(d.r, 10); last = ''; }
      else if (d.s) { P[d.s] = d.v === '1'; save(); last = ''; }
      else return;
      tick(true);
    });

    // ----- mounting and loop -----
    // The title row (game name + its icons) is drawn late on some pages, so the panel is put right under it on every tick, not only once.
    let titleEl = null, anchor = '';
    const elName = e => e.tagName.toLowerCase() + '.' + String(typeof e.className === 'string' ? e.className : '').trim().replace(/\s+/g, '.').slice(0, 60);
    function findTitle() {
      if (titleEl && titleEl.isConnected) return titleEl;
      titleEl = document.querySelector('.content-title');
      if (titleEl) return titleEl;
      const root = document.querySelector('.content-wrapper') || document.body, want = 'high-low';
      const hs = root.querySelectorAll('h1,h2,h3,h4,[class*="title" i]');
      for (let i = 0; i < hs.length; i++) {
        const h = hs[i], tx = (h.textContent || '').trim().toLowerCase();
        if (mine(h) || box.contains(h) || tx.indexOf(want) !== 0 || tx.length > want.length + 25) continue;
        let el = h;   // up to the whole title row: the biggest ancestor that is still a thin strip
        while (el.parentElement && el.parentElement !== root && el.parentElement !== document.body && el.parentElement.getBoundingClientRect().height <= 100) el = el.parentElement;
        titleEl = el;
        return el;
      }
      return null;
    }

    function mount() {
      const t = findTitle(), w = document.querySelector('.content-wrapper');
      if (t && t.nextElementSibling === box) return;   // already right under the title
      box.classList.remove('fx');
      if (t) {
        t.insertAdjacentElement('afterend', box);
        if (anchor !== 't') { anchor = 't'; SD.log('highlow', 'panel placed under the title: ' + elName(t)); }
      } else if (!box.isConnected) {
        if (w) w.insertBefore(box, w.firstChild); else { box.classList.add('fx'); document.body.appendChild(box); }
        if (anchor !== 'f') { anchor = 'f'; SD.log('highlow', 'title not found (yet): panel put at the top of the page', 'w'); }
      }
    }

    function tick(force) {
      if (document.hidden && force !== true) return;
      const sid = (new URLSearchParams(location.search).get('sid') || '').toLowerCase();
      if (sid !== 'highlow') { if (box.isConnected) box.remove(); active = false; return; }
      if (!active) { active = true; last = ''; misses = 0; dumped = false; sawTurn = false; wasOver = false; SD.log('highlow', 'page: highlow'); }
      mount();
      const s = readState();
      if (s.src === 'none') {
        misses++;
        if (misses >= 4 && !dumped) {
          dumped = true;
          const sample = [];
          document.querySelectorAll('[class*="card" i]').forEach(el => { if (sample.length < 8 && !mine(el)) sample.push(el.tagName.toLowerCase() + '.' + String(typeof el.className === 'string' ? el.className : '').trim().replace(/\s+/g, '.').slice(0, 70)); });
          SD.log('highlow', 'no cards read. card-like elements: ' + (sample.join(' | ') || 'none'), 'w');
        }
      } else misses = 0;
      const key = JSON.stringify([s.src, s.cur, s.sig, M.on, rulesOpen, P]);
      if (key === last) return;
      last = key;
      if (s.src !== 'none') {
        const line = s.src === 'idle' ? 'round over: panel reset' : 'highlow dealer=' + (s.cur ? RL[s.cur] : '?') + ' (' + (s.count || 1) + ' on page, ' + s.src + ')' + (s.sig ? ' [' + s.sig + ']' : '');
        if (line !== readCount) { readCount = line; SD.log('highlow', line); }
      }
      render(s);
    }

    tick(true);
    ctx.every(tick, 700);   // cleared by the core when the feature is switched off

    return { stop() { box.remove(); } };
  }

  SD.feature({
    id: 'highlow',
    was: 'casinohelper',   // starts out with the switch of the old combined Casino Helper
    group: 'Casino',
    label: 'High-Low Helper',
    where: 'Casino (High-Low)',
    info: 'Win chance for Higher and Lower against the dealer card.',
    match: /^\/page\.php$/,
    start,
    engine: { parseCard, highLow, pickDealer }   // exposed for tests only
  });
})();

} catch (e) { console.error('Speed Dial: features/highlowhelper.js:', e); try { window.SpeedDial && window.SpeedDial.log('boot', 'features/highlowhelper.js failed: ' + (e && e.message || e), 'e'); } catch (x) { /* log not ready yet */ } }

try {
// Speed Dial feature: Blackjack Helper v0.2.0
// Casino Blackjack (page.php?sid=blackjack): the chance of every move and which one to take next.
// Split off the old Casino Helper (one page = one feature file). Reads only the cards and buttons the page shows. It NEVER clicks anything and uses no API.
// Switch it on or off in Settings > Features.
//   - Exact odds (win / push / lose) for Stand, Hit, Double and Split, worked out for the dealer card you see.
//     Infinite deck, dealer stands on all 17 and checks for blackjack (all changeable in Rules).
//     Only moves whose buttons are enabled on the page are recommended; a button that is not recognised counts as available.
//   - Manual mode: tap the ranks yourself if the page markup is not recognised. Settings > Terminal tells what was (not) read.
//   - Between rounds (play buttons gone or greyed out) the panel goes back to "waiting" and typed-in cards are cleared.
//   - Rules are saved under speedDial.blackjack1 (the rules of the old combined helper, speedDial.casino1, are carried over).
// No strategy beats the house over time. This only stops you from making a worse choice than necessary.
(function () {
  'use strict';
  const SD = window.SpeedDial;
  if (!SD) return;

  const LS = 'speedDial.blackjack1';
  const OLD = 'speedDial.casino1';

  // ---------- cards ----------
  const RL = [null, 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];   // rank 1..13
  const PV = [0, 11, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10];                            // blackjack value of rank (ace = 11)
  const DRAW = [[2, 1 / 13], [3, 1 / 13], [4, 1 / 13], [5, 1 / 13], [6, 1 / 13], [7, 1 / 13], [8, 1 / 13], [9, 1 / 13], [10, 4 / 13], [11, 1 / 13]];

  const RK = '13|12|11|10|[1-9]|[ajqk]|ace|king|queen|jack|ten';
  const SU = 'hearts?|diamonds?|spades?|clubs?';
  const RA = new RegExp('(?:^|[\\s_\\-./])(' + SU + ')[\\s_\\-.]*(' + RK + ')(?![a-z0-9])', 'i');                       // hearts-10, spades_A, clubs K
  const RB = new RegExp('(?:^|[\\s_\\-./])(' + RK + ')[\\s_\\-.]*(?:of[\\s_\\-.]*)?(' + SU + ')(?![a-z])', 'i');         // 7 of hearts, 10-spades
  const WORD = { a: 1, ace: 1, j: 11, jack: 11, q: 12, queen: 12, k: 13, king: 13, ten: 10 };
  const SYM = { '\u2660': 's', '\u2665': 'h', '\u2666': 'd', '\u2663': 'c' };
  const rankOf = s => { s = String(s).toLowerCase(); return WORD[s] || parseInt(s, 10) || 0; };

  // el needs: className, getAttribute(), textContent. Returns { r: 1..13, s: suit letter c/d/h/s or '?' } or null.
  function parseCard(el) {
    const cn = el.className && typeof el.className === 'object' ? (el.className.baseVal || '') : (el.className || '');
    const g = n => (el.getAttribute && el.getAttribute(n)) || '';
    const src = String(g('src')).split('/').pop();
    // every attribute is tested on its own: joining them could glue a suit from one onto a rank from another
    const fields = [cn, g('aria-label'), g('alt'), g('title'), g('data-card'), (g('data-rank') + ' ' + g('data-suit')).trim(), src];
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (!f) continue;
      let m = RA.exec(f);
      if (m) { const r = rankOf(m[2]); if (r >= 1 && r <= 13) return { r, s: m[1][0].toLowerCase() }; }
      m = RB.exec(f);
      if (m) { const r = rankOf(m[1]); if (r >= 1 && r <= 13) return { r, s: m[2][0].toLowerCase() }; }
    }
    const tx = String(el.textContent || '').trim();
    if (tx.length && tx.length <= 4) {
      const m = /^(10|[2-9]|[AJQK])\s*([\u2660\u2665\u2666\u2663])$/.exec(tx) || /^([\u2660\u2665\u2666\u2663])\s*(10|[2-9]|[AJQK])$/.exec(tx);
      if (m) {
        const sym = SYM[m[1]] ? m[1] : m[2], rk = sym === m[1] ? m[2] : m[1], r = rankOf(rk);
        if (r) return { r, s: SYM[sym] };
      }
    }
    return null;
  }


  // ---------- Blackjack ----------
  // hand state = (h: total with every ace as 1, a: has an ace). An ace counts 11 whenever that does not bust.
  const tot = (h, a) => (a && h + 10 <= 21 ? h + 10 : h);
  const nxt = (h, a, v) => [h + (v === 11 ? 1 : v), a || v === 11];

  // dealer outcome distribution: [17, 18, 19, 20, 21, blackjack, bust]
  function dealerDist(up, h17) {
    const memo = new Map();
    function go(h, a, n) {
      const key = h * 8 + (a ? 4 : 0) + Math.min(n, 3);
      if (memo.has(key)) return memo.get(key);
      const t = tot(h, a), soft = a && h + 10 <= 21;
      let r;
      if (t > 21) r = [0, 0, 0, 0, 0, 0, 1];
      else if (t >= 18 || (t === 17 && !(soft && h17))) {
        r = [0, 0, 0, 0, 0, 0, 0];
        if (t === 21 && n === 2) r[5] = 1; else r[t - 17] = 1;
      } else {
        r = [0, 0, 0, 0, 0, 0, 0];
        DRAW.forEach(d => {
          const x = nxt(h, a, d[0]), y = go(x[0], x[1], n + 1);
          for (let i = 0; i < 7; i++) r[i] += d[1] * y[i];
        });
      }
      memo.set(key, r);
      return r;
    }
    return go(up === 11 ? 1 : up, up === 11, 1);
  }

  const solvers = new Map();
  function solver(up, h17, das, peek) {
    const k = up + '|' + h17 + '|' + das + '|' + peek;
    if (solvers.has(k)) return solvers.get(k);
    const dist = dealerDist(up, h17);
    if (peek && dist[5] > 0) {   // dealer checks for blackjack first: if we are still playing, he does not have one
      const f = 1 / (1 - dist[5]);
      for (let i = 0; i < 7; i++) dist[i] = i === 5 ? 0 : dist[i] * f;
    }

    function stand(t) {   // player stops on t (not a natural): dealer blackjack counts as a loss
      let w = dist[6], p = 0;
      for (let d = 17; d <= 21; d++) { if (d < t) w += dist[d - 17]; else if (d === t) p += dist[d - 17]; }
      return { ev: w - (1 - w - p), w, p, l: 1 - w - p };
    }
    const memo = new Map();
    function best(h, a) {   // best of stand / keep hitting, with its odds
      const key = h * 2 + (a ? 1 : 0);
      if (memo.has(key)) return memo.get(key);
      const t = tot(h, a);
      let r;
      if (t > 21) r = { ev: -1, w: 0, p: 0, l: 1, act: 'B' };
      else {
        const s = stand(t);
        r = { ev: s.ev, w: s.w, p: s.p, l: s.l, act: 'S', S: s };
        if (t < 21) {
          let w = 0, p = 0, l = 0;
          DRAW.forEach(d => { const x = nxt(h, a, d[0]), y = best(x[0], x[1]); w += d[1] * y.w; p += d[1] * y.p; l += d[1] * y.l; });
          r.H = { ev: w - l, w, p, l };
          if (r.H.ev > r.ev) { r.ev = r.H.ev; r.w = w; r.p = p; r.l = l; r.act = 'H'; }
        }
      }
      memo.set(key, r);
      return r;
    }
    function dbl(h, a) {   // one card, then stand; the bet is doubled
      let w = 0, p = 0, l = 0;
      DRAW.forEach(d => {
        const x = nxt(h, a, d[0]), t = tot(x[0], x[1]);
        if (t > 21) l += d[1];
        else { const s = stand(t); w += d[1] * s.w; p += d[1] * s.p; l += d[1] * s.l; }
      });
      return { ev: 2 * (w - l), w, p, l };
    }
    function split(v) {    // per hand odds; ev is for both hands together. No re-split. Split aces get one card each.
      const h0 = v === 11 ? 1 : v, a0 = v === 11;
      let w = 0, p = 0, l = 0, e = 0;
      DRAW.forEach(d => {
        const x = nxt(h0, a0, d[0]), t = tot(x[0], x[1]);
        let st;
        if (v === 11) st = stand(t);
        else {
          const b = best(x[0], x[1]);
          st = { ev: b.ev, w: b.w, p: b.p, l: b.l };
          if (das && t < 21) { const dd = dbl(x[0], x[1]); if (dd.ev > st.ev) st = dd; }
        }
        w += d[1] * st.w; p += d[1] * st.p; l += d[1] * st.l; e += d[1] * st.ev;
      });
      return { ev: 2 * e, w, p, l };
    }
    const api = { dist, stand, best, dbl, split };
    solvers.set(k, api);
    return api;
  }

  // ranks = your cards (1..13), upRank = dealer card, blocked = Set of 'S','H','D','P' that the page shows greyed out (null = none known)
  function analyze(ranks, upRank, o, blocked) {
    const vals = ranks.map(r => PV[r]);
    let h = 0, a = false;
    vals.forEach(v => { h += v === 11 ? 1 : v; if (v === 11) a = true; });
    const t = tot(h, a), soft = a && h + 10 <= 21, n = ranks.length;
    const out = { t, soft, n, up: PV[upRank] };
    if (t > 21) { out.bust = true; return out; }
    if (n === 2 && t === 21) { out.natural = true; return out; }
    const S = solver(PV[upRank], !!o.h17, !!o.das, !!o.peek);
    const b = S.best(h, a);
    const opts = { S: b.S };
    if (b.H) opts.H = b.H;
    if (n === 2 && t < 21) opts.D = S.dbl(h, a);
    if (n === 2 && vals[0] === vals[1]) opts.P = S.split(vals[0]);
    const ok = k => !blocked || !blocked.has(k);
    const pickBest = list => list.filter(k => opts[k]).reduce((x, k) => (x === null || opts[k].ev > opts[x].ev ? k : x), null);
    let pick = pickBest(Object.keys(opts).filter(ok)) || pickBest(Object.keys(opts));
    out.opts = opts;
    out.pick = pick;
    out.stats = opts[pick];
    out.ok = {};
    Object.keys(opts).forEach(k => { out.ok[k] = ok(k); });
    if (pick === 'D' || pick === 'P') out.fallback = pickBest(['H', 'S'].filter(ok)) || pickBest(['H', 'S']);   // when the page refuses it
    return out;
  }


  // ---------- page reading ----------
  const SEL = '[class*="hearts" i],[class*="diamonds" i],[class*="spades" i],[class*="clubs" i],[class*="heart-" i],[class*="spade-" i],[class*="club-" i],[class*="diamond-" i],' +
    '[class*="card" i],img[alt],[aria-label],[data-card],[title]';
  const DEALER = /dealer|croupier/i;
  const PLAYER = /(^|[^a-z])(player|you|your|user)([^a-z]|$)/i;
  const BTN = 'button,a,li,[role="button"],input[type="button"],input[type="submit"],[class*="btn" i],[class*="button" i],[class*="action" i]';
  // label = letters only, so "HIT ME", "Double<br>Down" and "double down" all match. Exact words only (a "Hit list" link must not count).
  const LABEL = { hit: 'H', hitme: 'H', stand: 'S', double: 'D', doubledown: 'D', split: 'P' };
  const OFF = /(^|[\s_-])(disabled|inactive|unavailable)([\s_-]|$)/i;
  const mine = el => !!el.closest('#csh, #sdial');
  const seen = el => !!(el.getClientRects && el.getClientRects().length);

  const BACKS = /^(back|facedown|face-down|cardback|card-back)$/i;   // class token of a card lying face down
  const faceDown = el => String(typeof el.className === 'string' ? el.className : '').split(/\s+/).some(t => BACKS.test(t));

  function shown(el) {   // really on screen: has a size, not hidden, not (almost) transparent
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    for (let n = el, i = 0; n && n.nodeType === 1 && i < 6; i++, n = n.parentElement) {
      let cs;
      try { cs = getComputedStyle(n); } catch (e) { break; }
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.1) return false;
    }
    return true;
  }


  function readCards() {
    const root = document.querySelector('.content-wrapper') || document;   // the game only: not Torn's sidebar, chat or header
    const list = [];
    root.querySelectorAll(SEL).forEach(el => {
      if (mine(el) || !seen(el) || faceDown(el)) return;
      const c = parseCard(el);
      if (c) list.push({ el, r: c.r, s: c.s });
    });
    const inner = list.filter(a => !list.some(b => b !== a && a.el.contains(b.el)));   // innermost element of each card only
    inner.forEach(c => { c.shown = shown(c.el); });
    return inner;
  }

  function roleOf(el) {
    let n = el;
    for (let i = 0; n && n !== document.body && i < 7; i++, n = n.parentElement) {
      const id = (n.id || '') + ' ' + (typeof n.className === 'string' ? n.className : '');
      if (DEALER.test(id)) return 'd';
      if (PLAYER.test(id)) return 'p';
    }
    return null;
  }

  function split2(cards) {   // dealer / player by ancestor names first, then by how high they sit on the screen
    cards.forEach(c => { c.role = roleOf(c.el); c.top = c.el.getBoundingClientRect().top; c.hgt = c.el.getBoundingClientRect().height || 60; });
    const known = cards.filter(c => c.role), rest = cards.filter(c => !c.role);
    if (rest.length) {
      const avg = role => { const x = known.filter(c => c.role === role); return x.length ? x.reduce((s, c) => s + c.top, 0) / x.length : null; };
      const d = avg('d'), p = avg('p');
      if (d !== null && p !== null) rest.forEach(c => { c.role = Math.abs(c.top - d) <= Math.abs(c.top - p) ? 'd' : 'p'; });
      else if (!known.length) {
        const tops = rest.map(c => c.top).sort((x, y) => x - y), gap = rest[0].hgt * 0.6;
        const cut = tops.length > 1 ? tops.find((t, i) => i > 0 && t - tops[i - 1] > gap) : undefined;
        rest.forEach(c => { c.role = cut !== undefined && c.top < cut ? 'd' : 'p'; });
      } else rest.forEach(c => { c.role = known[0].role === 'd' ? 'p' : 'd'; });
    }
    return { dealer: cards.filter(c => c.role === 'd'), player: cards.filter(c => c.role === 'p') };
  }

  function hands(player) {   // several hands only when cards sit in different containers that each hold something
    const by = new Map();
    player.forEach(c => { const k = c.el.parentElement; if (!by.has(k)) by.set(k, []); by.get(k).push(c); });
    const groups = Array.from(by.values());
    if (groups.length < 2 || groups.every(g => g.length === 1)) return { list: [player], active: 0 };
    let active = groups.findIndex(g => { let n = g[0].el; for (let i = 0; n && i < 4; i++, n = n.parentElement) { if (/active|current|selected|turn/i.test(typeof n.className === 'string' ? n.className : '')) return true; } return false; });
    if (active < 0) active = Math.max(0, groups.findIndex(g => tot(g.reduce((s, c) => s + (PV[c.r] === 11 ? 1 : PV[c.r]), 0), g.some(c => c.r === 1)) < 21));
    return { list: groups, active };
  }

  function isOff(el) {   // greyed out: disabled attribute, a disabled class on the button or its two parents, or taps ignored
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return true;
    try { if (getComputedStyle(el).pointerEvents === 'none') return true; } catch (e) { /* ignore */ }
    for (let n = el, i = 0; n && i < 3; i++, n = n.parentElement) if (OFF.test(typeof n.className === 'string' ? n.className : '')) return true;
    return false;
  }

  function readButtons() {
    const root = document.querySelector('.content-wrapper') || document;
    const st = {};
    root.querySelectorAll(BTN).forEach(el => {
      if (mine(el) || el.children.length > 3 || !seen(el)) return;
      const k = LABEL[String(el.value && el.tagName === 'INPUT' ? el.value : el.textContent || '').toLowerCase().replace(/[^a-z]/g, '')];
      if (!k) return;
      const x = st[k] || (st[k] = { n: 0, off: 0 });
      x.n++;
      if (isOff(el)) x.off++;
    });
    const on = new Set(), blocked = new Set();
    Object.keys(st).forEach(k => { if (st[k].off === st[k].n) blocked.add(k); else on.add(k); });
    return { on, blocked };
  }

  // ---------- UI ----------
  const CSS = `
    #csh,#csh *{box-sizing:border-box;font-family:inherit}
    #csh{max-width:100%;margin:10px 0 0;width:100%;font-size:12px;line-height:1.4;color:#ccc;text-align:left;font-weight:400}
    #csh button{font-family:inherit;font-size:12px;font-weight:400;cursor:pointer;touch-action:manipulation}
    #csh .hd{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:linear-gradient(to bottom,#454545,#363636);border-top:1px solid #555;border-bottom:1px solid #1c1c1c}
    #csh .hd b{color:#fff;font-size:13px;font-weight:700}
    #csh .bd{padding:10px 12px;background:#2c2c2c;border-bottom:1px solid #1c1c1c}
    #csh .big{font-size:22px;font-weight:700;letter-spacing:.02em;line-height:1.1}
    #csh .big small{font-size:12px;font-weight:400;color:#999;letter-spacing:0;margin-left:6px}
    #csh .bar{display:flex;height:8px;margin:8px 0 4px;border-radius:4px;overflow:hidden;background:#161616}
    #csh .bar i{display:block;height:100%}
    #csh .bar .w{background:#85b200}#csh .bar .p{background:#777}#csh .bar .l{background:#e0584a}
    #csh .lg{display:flex;justify-content:space-between;color:#999}
    #csh .alts{margin-top:8px;padding-top:6px;border-top:1px solid #3a3a3a;color:#999}
    #csh .alts span{white-space:nowrap;margin-right:10px;display:inline-block}
    #csh .alts .b{color:#fff;font-weight:700}#csh .alts .x{opacity:.45;text-decoration:line-through}
    #csh .why{margin-top:6px;color:#bbb}
    #csh .nt{margin-top:6px;color:#d9a441}
    #csh .ok{color:#85b200}#csh .warn{color:#d9a441}#csh .bad{color:#e0584a}#csh .dim{color:#999}
    #csh .ft{display:flex;gap:6px;padding:8px 12px 10px;background:#2c2c2c;border-bottom:1px solid #1c1c1c}
    #csh .ft button,#csh .opt button{flex:1;height:30px;border:1px solid #1a1a1a;border-radius:4px;color:#ccc;background:linear-gradient(to bottom,#3d3d3d,#2f2f2f)}
    #csh .ft button.on{color:#fff;box-shadow:inset 0 -2px 0 #85b200}
    #csh .pn{padding:2px 12px 10px;background:#2c2c2c;border-bottom:1px solid #1c1c1c}
    #csh .pn label{display:block;margin:8px 0 4px;font-size:11px;color:#888}
    #csh .seg{display:flex}
    #csh .seg button{flex:1;height:30px;border:1px solid #1a1a1a;margin-left:-1px;color:#bbb;background:linear-gradient(to bottom,#3d3d3d,#2f2f2f)}
    #csh .seg button:first-child{margin-left:0;border-radius:4px 0 0 4px}
    #csh .seg button:last-child{border-radius:0 4px 4px 0}
    #csh .seg button.on{color:#fff;background:linear-gradient(to bottom,#555,#444);box-shadow:inset 0 -2px 0 #85b200}
    #csh .kp{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-top:6px}
    #csh .kp button{height:32px;border:1px solid #1a1a1a;border-radius:4px;color:#ddd;background:linear-gradient(to bottom,#3d3d3d,#2f2f2f);padding:0}
    #csh .mh{display:flex;align-items:center;gap:8px;padding:4px 0}
    #csh .mh button{flex:none;min-width:64px;height:28px;border:1px solid #1a1a1a;border-radius:4px;color:#bbb;background:linear-gradient(to bottom,#3d3d3d,#2f2f2f)}
    #csh .mh button.on{color:#fff;box-shadow:inset 0 -2px 0 #85b200}
    #csh .mh span{flex:1;min-width:0;color:#fff;font-weight:700;letter-spacing:.04em}
    #csh.fx{position:fixed;left:0;right:0;bottom:0;z-index:99998;margin:0}
  `;


  const NAME = { S: 'Stand', H: 'Hit', D: 'Double', P: 'Split' };
  const pc = x => Math.round(x * 100);
  const evs = x => (x >= 0 ? '+' : '\u2212') + Math.abs(x).toFixed(2);
  const cls = p => (p >= 0.55 ? 'ok' : p >= 0.45 ? 'warn' : 'bad');


  function start(ctx) {
    const old = SD.read(OLD, null) || {}, keep = {};
    ['h17', 'das', 'peek'].forEach(k => { if (typeof old[k] === 'boolean') keep[k] = old[k]; });
    let P = Object.assign({ h17: false, das: true, peek: true }, keep, SD.read(LS, null) || {});
    const save = () => SD.write(LS, P);
    const M = { on: false, tgt: 'd', d: [], p: [] };   // manual entry (not saved)
    let rulesOpen = false, last = '', misses = 0, dumped = false, readCount = '', sawTurn = false, wasOver = false, active = false;

    ctx.css(CSS);
    const box = document.createElement('div');
    box.id = 'csh';

    // ----- what the page (or the manual keypad) says right now -----
    function readState() {
      // is a round being played? Over = the play buttons (Hit / Stand) were seen on this page and none is enabled now
      const b = readButtons(), keys = ['H', 'S'];
      if (keys.some(k => b.on.has(k) || b.blocked.has(k))) sawTurn = true;
      const turn = keys.some(k => b.on.has(k)), over = sawTurn && !turn;
      if (over !== wasOver) { wasOver = over; if (over) { M.d = []; M.p = []; } }   // round just ended: forget the cards typed in
      if (M.on) return { src: 'manual', dealer: M.d.slice(0, 1), hand: M.p.slice(), extraDealer: Math.max(0, M.d.length - 1), blocked: b.blocked };
      if (over) return { src: 'idle' };
      const cards = readCards();
      if (!cards.length) return { src: 'none' };
      const vis = cards.filter(c => c.shown), sp = split2(vis.length ? vis : cards), hs = hands(sp.player);
      if (sp.dealer.length > 1 && !turn) return { src: 'idle' };   // dealer turned his second card and you cannot act: round over
      const h = hs.list[hs.active] || [];
      return {
        src: 'page',
        dealer: sp.dealer.slice(0, 1).map(c => c.r),
        extraDealer: Math.max(0, sp.dealer.length - 1),
        hand: h.map(c => c.r),
        multi: hs.list.length > 1 ? hs.list.length : 0,
        blocked: b.blocked
      };
    }

    // ----- drawing -----
    const bar = (w, p, l) => '<div class="bar"><i class="w" style="width:' + w * 100 + '%"></i><i class="p" style="width:' + p * 100 + '%"></i><i class="l" style="width:' + l * 100 + '%"></i></div>';

    function renderBJ(s) {
      if (!s.dealer || !s.dealer.length) return '<div class="bd"><span class="dim">' + (s.src === 'manual' ? 'Tap the dealer card first.' : 'Waiting for the dealer card...') + '</span></div>';
      if (!s.hand.length) return '<div class="bd"><span class="dim">Waiting for your cards...</span></div>';
      const a = analyze(s.hand, s.dealer[0], P, s.blocked);
      const hand = s.hand.map(r => RL[r]).join(' ');
      const info = 'Dealer ' + RL[s.dealer[0]] + ' \u00b7 You ' + hand + ' = ' + a.t + (a.soft ? ' (soft)' : '') + (s.multi ? ' \u00b7 ' + s.multi + ' hands' : '');
      if (a.bust) return '<div class="bd"><div class="big bad">BUST</div><div class="why">' + info + '</div></div>';
      if (a.natural) return '<div class="bd"><div class="big ok">BLACKJACK</div><div class="why">' + info + '</div></div>';
      const st = a.stats, c = cls(st.w + st.p / 2);
      let h = '<div class="bd"><div class="big ' + c + '">' + NAME[a.pick].toUpperCase() + (a.fallback ? '<small>or ' + NAME[a.fallback] + ' if refused</small>' : '') + '</div>' +
        bar(st.w, st.p, st.l) +
        '<div class="lg"><span class="ok">Win ' + pc(st.w) + '%</span><span>Push ' + pc(st.p) + '%</span><span class="bad">Lose ' + pc(st.l) + '%</span></div>' +
        '<div class="alts">';
      ['S', 'H', 'D', 'P'].forEach(k => {
        if (!a.opts[k]) return;
        h += '<span class="' + (k === a.pick ? 'b' : a.ok[k] ? '' : 'x') + '">' + NAME[k] + ' ' + evs(a.opts[k].ev) + '</span>';
      });
      h += '</div><div class="why">' + info + '</div>';
      if (a.pick === 'P') h += '<div class="why dim">Split: odds are per hand.</div>';
      if (a.up === 11) h += '<div class="nt">Dealer shows an ace: skip insurance.</div>';
      return h + '</div>';
    }

    function renderNone() {
      return '<div class="bd"><span class="dim">Cards not found on this page yet.</span></div>';
    }

    function renderIdle() {   // standard state between rounds
      return '<div class="bd"><span class="dim">Waiting for the next round...</span></div>';
    }


    function render(s) {
      const sg = (k, la, lb) => '<div class="seg"><button data-s="' + k + '" data-v="0" class="' + (!P[k] ? 'on' : '') + '">' + la + '</button><button data-s="' + k + '" data-v="1" class="' + (P[k] ? 'on' : '') + '">' + lb + '</button></div>';
      let h = '<div class="hd"><b>Blackjack Helper</b></div>';
      h += s.src === 'none' ? renderNone() : s.src === 'idle' ? renderIdle() : renderBJ(s);
      h += '<div class="ft"><button data-a="man" class="' + (M.on ? 'on' : '') + '">Manual</button><button data-a="rules">Rules ' + (rulesOpen ? '\u25b2' : '\u25bc') + '</button></div>';
      if (M.on) {
        const chips = a => a.length ? a.map(r => RL[r]).join(' ') : '-';
        h += '<div class="pn"><div class="mh"><button data-t="d" class="' + (M.tgt === 'd' ? 'on' : '') + '">Dealer</button><span>' + chips(M.d.slice(0, 1)) + '</span></div>' +
          '<div class="mh"><button data-t="p" class="' + (M.tgt === 'p' ? 'on' : '') + '">You</button><span>' + chips(M.p) + '</span></div><div class="kp">';
        for (let r = 1; r <= 13; r++) h += '<button data-r="' + r + '">' + RL[r] + '</button>';
        h += '<button data-a="undo">\u232b</button></div><div class="mh" style="margin-top:6px"><button data-a="clear" style="flex:1">Clear</button></div></div>';
      }
      if (rulesOpen) h += '<div class="pn"><label>Dealer on soft 17</label>' + sg('h17', 'Stands', 'Hits') + '<label>Double after split</label>' + sg('das', 'No', 'Yes') + '<label>Dealer checks for blackjack</label>' + sg('peek', 'No', 'Yes') + '</div>';
      box.innerHTML = h;
    }

    // ----- taps -----
    box.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      const d = b.dataset;
      if (d.a === 'man') { M.on = !M.on; last = ''; }
      else if (d.a === 'rules') { rulesOpen = !rulesOpen; last = ''; }
      else if (d.a === 'clear') { M.d = []; M.p = []; last = ''; }
      else if (d.a === 'undo') { (M.tgt === 'd' ? M.d : M.p).pop(); last = ''; }
      else if (d.t) { M.tgt = d.t; last = ''; }
      else if (d.r) {
        const r = parseInt(d.r, 10);
        if (M.tgt === 'd') M.d = [r];
        else if (M.p.length < 8) M.p.push(r);
        last = '';
      } else if (d.s) { P[d.s] = d.v === '1'; save(); last = ''; }
      else return;
      tick(true);
    });

    // ----- mounting and loop -----
    // The title row (game name + its icons) is drawn late on some pages, so the panel is put right under it on every tick, not only once.
    let titleEl = null, anchor = '';
    const elName = e => e.tagName.toLowerCase() + '.' + String(typeof e.className === 'string' ? e.className : '').trim().replace(/\s+/g, '.').slice(0, 60);
    function findTitle() {
      if (titleEl && titleEl.isConnected) return titleEl;
      titleEl = document.querySelector('.content-title');
      if (titleEl) return titleEl;
      const root = document.querySelector('.content-wrapper') || document.body, want = 'blackjack';
      const hs = root.querySelectorAll('h1,h2,h3,h4,[class*="title" i]');
      for (let i = 0; i < hs.length; i++) {
        const h = hs[i], tx = (h.textContent || '').trim().toLowerCase();
        if (mine(h) || box.contains(h) || tx.indexOf(want) !== 0 || tx.length > want.length + 25) continue;
        let el = h;   // up to the whole title row: the biggest ancestor that is still a thin strip
        while (el.parentElement && el.parentElement !== root && el.parentElement !== document.body && el.parentElement.getBoundingClientRect().height <= 100) el = el.parentElement;
        titleEl = el;
        return el;
      }
      return null;
    }

    function mount() {
      const t = findTitle(), w = document.querySelector('.content-wrapper');
      if (t && t.nextElementSibling === box) return;   // already right under the title
      box.classList.remove('fx');
      if (t) {
        t.insertAdjacentElement('afterend', box);
        if (anchor !== 't') { anchor = 't'; SD.log('blackjack', 'panel placed under the title: ' + elName(t)); }
      } else if (!box.isConnected) {
        if (w) w.insertBefore(box, w.firstChild); else { box.classList.add('fx'); document.body.appendChild(box); }
        if (anchor !== 'f') { anchor = 'f'; SD.log('blackjack', 'title not found (yet): panel put at the top of the page', 'w'); }
      }
    }

    function tick(force) {
      if (document.hidden && force !== true) return;
      const sid = (new URLSearchParams(location.search).get('sid') || '').toLowerCase();
      if (sid !== 'blackjack') { if (box.isConnected) box.remove(); active = false; return; }
      if (!active) { active = true; last = ''; misses = 0; dumped = false; sawTurn = false; wasOver = false; SD.log('blackjack', 'page: blackjack'); }
      mount();
      const s = readState();
      if (s.src === 'none') {
        misses++;
        if (misses >= 4 && !dumped) {
          dumped = true;
          const sample = [];
          document.querySelectorAll('[class*="card" i]').forEach(el => { if (sample.length < 8 && !mine(el)) sample.push(el.tagName.toLowerCase() + '.' + String(typeof el.className === 'string' ? el.className : '').trim().replace(/\s+/g, '.').slice(0, 70)); });
          SD.log('blackjack', 'no cards read. card-like elements: ' + (sample.join(' | ') || 'none'), 'w');
        }
      } else misses = 0;
      const key = JSON.stringify([s.src, s.dealer, s.extraDealer, s.hand, s.multi, s.blocked ? Array.from(s.blocked).sort() : null, M.on, M.tgt, rulesOpen, P]);
      if (key === last) return;
      last = key;
      if (s.src !== 'none') {
        const line = s.src === 'idle' ? 'round over: panel reset'
          : 'blackjack dealer=' + (s.dealer && s.dealer.length ? s.dealer.map(r => RL[r]) : '?') + ' you=' + (s.hand && s.hand.length ? s.hand.map(r => RL[r]).join(',') : '?') + ' greyed=' + (s.blocked && s.blocked.size ? Array.from(s.blocked).join('') : '-') + ' (' + s.src + ')';
        if (line !== readCount) { readCount = line; SD.log('blackjack', line); }
      }
      render(s);
    }

    tick(true);
    ctx.every(tick, 700);   // cleared by the core when the feature is switched off

    return { stop() { box.remove(); } };
  }

  SD.feature({
    id: 'blackjack',
    was: 'casinohelper',   // starts out with the switch of the old combined Casino Helper
    group: 'Casino',
    label: 'Blackjack Helper',
    where: 'Casino (Blackjack)',
    info: 'Win chance and the best next move (Stand, Hit, Double, Split).',
    match: /^\/page\.php$/,
    start,
    engine: { parseCard, analyze, dealerDist }   // exposed for tests only
  });
})();

} catch (e) { console.error('Speed Dial: features/blackjackhelper.js:', e); try { window.SpeedDial && window.SpeedDial.log('boot', 'features/blackjackhelper.js failed: ' + (e && e.message || e), 'e'); } catch (x) { /* log not ready yet */ } }

try {
// Speed Dial feature: Poker Helper v0.2.0
// Casino Poker (page.php?sid=holdem): your chance to win against random hands, your outs, and whether a call pays off.
// Reads only the cards the page shows. It NEVER clicks anything and uses no API. Switch it on or off in Settings > Features.
//   - Win / tie / lose chance by playing the hand out 2,500 times against the number of opponents set in Rules (random hands, so it flatters
//     your hand a little: real opponents who stay in usually hold more than random cards). The rating compares it with a fair share (1 / players).
//   - Outs (flop and turn): unseen cards that lift your hand to a better type than before AND than the board alone, with the chance to hit.
//   - Pot odds: type the pot (with their bet) and the amount to call; you see the equity you need against the equity you have.
//   - Your two cards and the board are told apart by name (hero / community ancestors) and, failing that, by position (a row of 3+ cards is the board).
//   - Manual mode: tap rank then suit yourself if the page markup is not recognised. Settings > Terminal lists every card it saw (rank+suit/role@x,y).
//   - The number of opponents is saved under speedDial.poker1.
(function () {
  'use strict';
  const SD = window.SpeedDial;
  if (!SD) return;

  const LS = 'speedDial.poker1';
  const TRIALS = 2500;

  // ---------- cards ----------
  const RL = [null, 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];   // rank 1..13

  const RK = '13|12|11|10|[1-9]|[ajqk]|ace|king|queen|jack|ten';
  const SU = 'hearts?|diamonds?|spades?|clubs?';
  const RA = new RegExp('(?:^|[\\s_\\-./])(' + SU + ')[\\s_\\-.]*(' + RK + ')(?![a-z0-9])', 'i');                       // hearts-10, spades_A, clubs K
  const RB = new RegExp('(?:^|[\\s_\\-./])(' + RK + ')[\\s_\\-.]*(?:of[\\s_\\-.]*)?(' + SU + ')(?![a-z])', 'i');         // 7 of hearts, 10-spades
  const WORD = { a: 1, ace: 1, j: 11, jack: 11, q: 12, queen: 12, k: 13, king: 13, ten: 10 };
  const SYM = { '\u2660': 's', '\u2665': 'h', '\u2666': 'd', '\u2663': 'c' };
  const rankOf = s => { s = String(s).toLowerCase(); return WORD[s] || parseInt(s, 10) || 0; };

  // el needs: className, getAttribute(), textContent. Returns { r: 1..13, s: suit letter c/d/h/s or '?' } or null.
  function parseCard(el) {
    const cn = el.className && typeof el.className === 'object' ? (el.className.baseVal || '') : (el.className || '');
    const g = n => (el.getAttribute && el.getAttribute(n)) || '';
    const src = String(g('src')).split('/').pop();
    // every attribute is tested on its own: joining them could glue a suit from one onto a rank from another
    const fields = [cn, g('aria-label'), g('alt'), g('title'), g('data-card'), (g('data-rank') + ' ' + g('data-suit')).trim(), src];
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (!f) continue;
      let m = RA.exec(f);
      if (m) { const r = rankOf(m[2]); if (r >= 1 && r <= 13) return { r, s: m[1][0].toLowerCase() }; }
      m = RB.exec(f);
      if (m) { const r = rankOf(m[1]); if (r >= 1 && r <= 13) return { r, s: m[2][0].toLowerCase() }; }
    }
    const tx = String(el.textContent || '').trim();
    if (tx.length && tx.length <= 4) {
      const m = /^(10|[2-9]|[AJQK])\s*([\u2660\u2665\u2666\u2663])$/.exec(tx) || /^([\u2660\u2665\u2666\u2663])\s*(10|[2-9]|[AJQK])$/.exec(tx);
      if (m) {
        const sym = SYM[m[1]] ? m[1] : m[2], rk = sym === m[1] ? m[2] : m[1], r = rankOf(rk);
        if (r) return { r, s: SYM[sym] };
      }
    }
    return null;
  }


  // ---------- poker maths ----------
  // a card is one number: rank (2..14, ace = 14) * 4 + suit (0 clubs, 1 diamonds, 2 hearts, 3 spades)
  const SUITS = 'cdhs';
  const SYMS = ['\u2663', '\u2666', '\u2665', '\u2660'];
  const RLC = [null, null, '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const HANDS = ['High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'];
  const toCode = c => { const s = SUITS.indexOf(c.s); return s < 0 ? null : (c.r === 1 ? 14 : c.r) * 4 + s; };
  const CAT = 759375;   // 15^5: score = category * CAT + kickers

  const CNT = new Int8Array(15), SCN = new Int8Array(4), SMK = new Int32Array(4);
  const pack = (c, a, b, d, e, f) => ((((c * 15 + (a || 0)) * 15 + (b || 0)) * 15 + (d || 0)) * 15 + (e || 0)) * 15 + (f || 0);

  function straightTop(mask) {   // bit r = rank r (2..14); the ace also counts low. Returns the top rank of the best straight, or 0
    if (mask & 16384) mask |= 2;
    for (let h = 14; h >= 5; h--) { const need = 31 << (h - 4); if ((mask & need) === need) return h; }
    return 0;
  }
  function kick(x1, x2, n) {   // the n highest ranks present that are not x1 / x2
    const k = [];
    for (let r = 14; r >= 2 && k.length < n; r--) if (CNT[r] && r !== x1 && r !== x2) k.push(r);
    return k;
  }

  // best 5-card hand out of the first n cards (n = 2..7); a higher number is a better hand, equal numbers tie
  function score(a, n) {
    CNT.fill(0); SCN.fill(0); SMK.fill(0);
    let all = 0;
    for (let i = 0; i < n; i++) { const r = a[i] >> 2, s = a[i] & 3; CNT[r]++; SCN[s]++; SMK[s] |= 1 << r; all |= 1 << r; }
    let fs = -1;
    for (let s = 0; s < 4; s++) if (SCN[s] >= 5) fs = s;
    if (fs >= 0) { const t = straightTop(SMK[fs]); if (t) return pack(8, t); }
    let quad = 0, t1 = 0, t2 = 0, p1 = 0, p2 = 0;
    for (let r = 14; r >= 2; r--) {
      const c = CNT[r];
      if (c === 4) quad = r;
      else if (c === 3) { if (!t1) t1 = r; else if (!t2) t2 = r; }
      else if (c === 2) { if (!p1) p1 = r; else if (!p2) p2 = r; }
    }
    if (quad) return pack(7, quad, kick(quad, 0, 1)[0]);
    if (t1 && (t2 || p1)) return pack(6, t1, t2 > p1 ? t2 : p1);
    if (fs >= 0) { const f = []; for (let r = 14; r >= 2 && f.length < 5; r--) if (SMK[fs] & (1 << r)) f.push(r); return pack(5, f[0], f[1], f[2], f[3], f[4]); }
    const st = straightTop(all);
    if (st) return pack(4, st);
    if (t1) { const k = kick(t1, 0, 2); return pack(3, t1, k[0], k[1]); }
    if (p2) { const k = kick(p1, p2, 1); return pack(2, p1, p2, k[0]); }
    if (p1) { const k = kick(p1, 0, 3); return pack(1, p1, k[0], k[1], k[2]); }
    const k = kick(0, 0, 5);
    return pack(0, k[0], k[1], k[2], k[3], k[4]);
  }
  const catOf = (a, n) => Math.floor(score(a, n) / CAT);

  // play the hand out `trials` times: random board for what is missing, random hands for `opp` opponents
  function equity(hand, board, opp, trials) {
    const used = new Set(hand.concat(board)), deck = [];
    for (let r = 2; r <= 14; r++) for (let s = 0; s < 4; s++) { const c = r * 4 + s; if (!used.has(c)) deck.push(c); }
    const miss = 5 - board.length, need = miss + 2 * opp, n = deck.length;
    if (hand.length !== 2 || miss < 0 || need > n) return null;
    const mine = new Int32Array(7), oth = new Int32Array(7);
    mine[0] = hand[0]; mine[1] = hand[1]; oth[2] = 0;
    let win = 0, tie = 0, share = 0;
    for (let t = 0; t < trials; t++) {
      for (let j = 0; j < need; j++) { const k = j + Math.floor(Math.random() * (n - j)), x = deck[j]; deck[j] = deck[k]; deck[k] = x; }
      for (let j = 0; j < 5; j++) { const c = j < board.length ? board[j] : deck[j - board.length]; mine[2 + j] = c; oth[2 + j] = c; }
      const ms = score(mine, 7);
      let best = -1, same = 0;
      for (let o = 0; o < opp; o++) {
        oth[0] = deck[miss + 2 * o]; oth[1] = deck[miss + 2 * o + 1];
        const sc = score(oth, 7);
        if (sc > best) { best = sc; same = 1; } else if (sc === best) same++;
      }
      if (ms > best) { win++; share += 1; } else if (ms === best) { tie++; share += 1 / (same + 1); }
    }
    return { win: win / trials, tie: tie / trials, eq: share / trials };
  }

  function preName(h) {
    let a = h[0] >> 2, b = h[1] >> 2;
    const su = (h[0] & 3) === (h[1] & 3);
    if (a < b) { const t = a; a = b; b = t; }
    return a === b ? 'Pocket ' + RLC[a] + RLC[a] : RLC[a] + ' ' + RLC[b] + (su ? ' suited' : ' offsuit');
  }

  // everything the panel shows for one situation
  function analyze(hand, board, opp, trials) {
    const q = equity(hand, board, opp, trials || TRIALS);
    if (!q) return null;
    const out = { opp, win: q.win, tie: q.tie, lose: Math.max(0, 1 - q.win - q.tie), eq: q.eq };
    const all = hand.concat(board);
    if (board.length >= 3) { out.cat = catOf(all, all.length); out.name = HANDS[out.cat]; } else out.name = preName(hand);
    const ratio = out.eq * (opp + 1);   // 1 = exactly a fair share
    out.rate = ratio >= 1.8 ? 'STRONG' : ratio >= 1.2 ? 'GOOD' : ratio >= 0.85 ? 'FAIR' : 'WEAK';
    if ((board.length === 3 || board.length === 4) && out.cat < 6) {
      const used = new Set(all);
      let n = 0, left = 0;
      for (let r = 2; r <= 14; r++) for (let s = 0; s < 4; s++) {
        const c = r * 4 + s;
        if (used.has(c)) continue;
        left++;
        const nb = board.concat([c]), a = hand.concat(nb);
        const cat = catOf(a, a.length);
        if (cat > out.cat && cat > catOf(nb, nb.length)) n++;   // better than before, and not just the board improving for everybody
      }
      if (n) { out.outs = n; out.hit = n / left; out.river = board.length === 3 ? 1 - ((left - n) * (left - n - 1)) / (left * (left - 1)) : n / left; }
    }
    return out;
  }

  // ---------- page reading ----------
  const SEL = '[class*="hearts" i],[class*="diamonds" i],[class*="spades" i],[class*="clubs" i],[class*="heart-" i],[class*="spade-" i],[class*="club-" i],[class*="diamond-" i],' +
    '[class*="card" i],img[alt],[aria-label],[data-card],[title]';
  const mine = el => !!el.closest('#csh, #sdial');
  const seen = el => !!(el.getClientRects && el.getClientRects().length);

  const BACKS = /^(back|facedown|face-down|cardback|card-back)$/i;   // class token of a card lying face down
  const faceDown = el => String(typeof el.className === 'string' ? el.className : '').split(/\s+/).some(t => BACKS.test(t));

  function shown(el) {   // really on screen: has a size, not hidden, not (almost) transparent
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    for (let n = el, i = 0; n && n.nodeType === 1 && i < 6; i++, n = n.parentElement) {
      let cs;
      try { cs = getComputedStyle(n); } catch (e) { break; }
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.1) return false;
    }
    return true;
  }


  function onTop(el) {   // nothing unrelated is painted over the middle of the card (an old card under a new one, a flipped-away face)
    const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return true;   // cannot test off screen
    const hit = document.elementFromPoint(x, y);
    return !hit || el.contains(hit) || hit.contains(el) || mine(hit);
  }

  const BOARDRE = /community|board|flop|river|table-?cards|(^|[^a-z])turn([^a-z]|$)/i;
  const HERORE = /hero|(^|[^a-z])(self|you|your|my|mine)([^a-z]|$)/i;

  function roleOf(el) {   // 'b' = board, 'h' = your hand, from the names of its ancestors
    let n = el;
    for (let i = 0; n && n !== document.body && i < 7; i++, n = n.parentElement) {
      const id = (n.id || '') + ' ' + (typeof n.className === 'string' ? n.className : '');
      if (BOARDRE.test(id)) return 'b';
      if (HERORE.test(id)) return 'h';
    }
    return null;
  }

  function readCards() {
    const root = document.querySelector('.content-wrapper') || document;   // the game only: not Torn's sidebar, chat or header
    const list = [];
    root.querySelectorAll(SEL).forEach(el => {
      if (mine(el) || !seen(el) || faceDown(el)) return;
      const c = parseCard(el);
      if (c) list.push({ el, r: c.r, s: c.s });
    });
    const inner = list.filter(a => !list.some(b => b !== a && a.el.contains(b.el)));   // innermost element of each card only
    inner.forEach((c, i) => {
      const b = c.el.getBoundingClientRect();
      c.i = i; c.x = b.left + b.width / 2; c.y = b.top + b.height / 2; c.h = b.height;
      c.shown = shown(c.el); c.top = c.shown && onTop(c.el); c.role = roleOf(c.el);
    });
    return inner;
  }

  function rowsOf(arr) {   // cards that sit on the same line
    const out = [];
    arr.slice().sort((a, b) => a.y - b.y).forEach(c => {
      const r = out[out.length - 1];
      if (r && Math.abs(c.y - r.y) <= 0.5 * (c.h || 60)) r.cs.push(c); else out.push({ y: c.y, cs: [c] });
    });
    return out;
  }
  const pickBoard = arr => {   // the fullest row of 3+ cards
    const rs = rowsOf(arr).filter(r => r.cs.length >= 3);
    return rs.length ? rs.reduce((x, r) => (r.cs.length > x.cs.length ? r : x), rs[0]).cs : [];
  };
  const pickHand = arr => {    // a row of at most 2 cards, the lowest one on the screen
    const rs = rowsOf(arr).filter(r => r.cs.length <= 2);
    return rs.length ? rs.reduce((x, r) => (r.y > x.y ? r : x), rs[0]).cs : [];
  };

  function splitPoker(cards) {
    const vis = cards.filter(c => c.shown), list = vis.length ? vis : cards;
    const byX = (a, b) => a.x - b.x;
    let hand = list.filter(c => c.role === 'h').sort(byX).slice(0, 2), board = list.filter(c => c.role === 'b').sort(byX).slice(0, 5);
    const rest = list.filter(c => !c.role);
    if (!board.length) board = pickBoard(rest).sort(byX).slice(0, 5);
    if (!hand.length) hand = pickHand(rest.filter(c => board.indexOf(c) < 0)).sort(byX).slice(0, 2);
    return { hand, board };
  }


  // ---------- UI ----------
  const CSS = `
    #csh,#csh *{box-sizing:border-box;font-family:inherit}
    #csh{max-width:100%;margin:10px 0 0;width:100%;font-size:12px;line-height:1.4;color:#ccc;text-align:left;font-weight:400}
    #csh button{font-family:inherit;font-size:12px;font-weight:400;cursor:pointer;touch-action:manipulation}
    #csh .hd{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:linear-gradient(to bottom,#454545,#363636);border-top:1px solid #555;border-bottom:1px solid #1c1c1c}
    #csh .hd b{color:#fff;font-size:13px;font-weight:700}
    #csh .bd{padding:10px 12px;background:#2c2c2c;border-bottom:1px solid #1c1c1c}
    #csh .big{font-size:22px;font-weight:700;letter-spacing:.02em;line-height:1.1}
    #csh .big small{font-size:12px;font-weight:400;color:#999;letter-spacing:0;margin-left:6px}
    #csh .bar{display:flex;height:8px;margin:8px 0 4px;border-radius:4px;overflow:hidden;background:#161616}
    #csh .bar i{display:block;height:100%}
    #csh .bar .w{background:#85b200}#csh .bar .p{background:#777}#csh .bar .l{background:#e0584a}
    #csh .lg{display:flex;justify-content:space-between;color:#999}
    #csh .why{margin-top:6px;color:#bbb}
    #csh .nt{margin-top:6px;color:#d9a441}
    #csh .ok{color:#85b200}#csh .warn{color:#d9a441}#csh .bad{color:#e0584a}#csh .dim{color:#999}
    #csh .ft{display:flex;gap:6px;padding:8px 12px 10px;background:#2c2c2c;border-bottom:1px solid #1c1c1c}
    #csh .ft button,#csh .opt button{flex:1;height:30px;border:1px solid #1a1a1a;border-radius:4px;color:#ccc;background:linear-gradient(to bottom,#3d3d3d,#2f2f2f)}
    #csh .ft button.on{color:#fff;box-shadow:inset 0 -2px 0 #85b200}
    #csh .pn{padding:2px 12px 10px;background:#2c2c2c;border-bottom:1px solid #1c1c1c}
    #csh .pn label{display:block;margin:8px 0 4px;font-size:11px;color:#888}
    #csh .seg{display:flex}
    #csh .seg button{flex:1;height:30px;border:1px solid #1a1a1a;margin-left:-1px;color:#bbb;background:linear-gradient(to bottom,#3d3d3d,#2f2f2f)}
    #csh .seg button:first-child{margin-left:0;border-radius:4px 0 0 4px}
    #csh .seg button:last-child{border-radius:0 4px 4px 0}
    #csh .seg button.on{color:#fff;background:linear-gradient(to bottom,#555,#444);box-shadow:inset 0 -2px 0 #85b200}
    #csh .kp{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-top:6px}
    #csh .kp button{height:32px;border:1px solid #1a1a1a;border-radius:4px;color:#ddd;background:linear-gradient(to bottom,#3d3d3d,#2f2f2f);padding:0}
    #csh .mh{display:flex;align-items:center;gap:8px;padding:4px 0}
    #csh .mh button{flex:none;min-width:64px;height:28px;border:1px solid #1a1a1a;border-radius:4px;color:#bbb;background:linear-gradient(to bottom,#3d3d3d,#2f2f2f)}
    #csh .mh button.on{color:#fff;box-shadow:inset 0 -2px 0 #85b200}
    #csh .mh span{flex:1;min-width:0;color:#fff;font-weight:700;letter-spacing:.04em}
    #csh.fx{position:fixed;left:0;right:0;bottom:0;z-index:99998;margin:0}
    #csh .po{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:8px 12px;background:#2c2c2c;border-bottom:1px solid #1c1c1c}
    #csh .po input{flex:1;min-width:0;width:70px;height:28px;border:1px solid #1a1a1a;border-radius:4px;background:#1c1c1c;color:#ddd;padding:0 8px;font-size:12px}
    #csh .po .pv{flex:0 0 100%}
    #csh .rd{color:#e0584a}
    #csh .seg button.rd{color:#e0584a}
  `;


  const pc = x => Math.round(x * 100);
  const num = v => parseFloat(String(v).replace(/[^0-9.]/g, '')) || 0;
  const cardsHtml = codes => codes.map(c => '<span class="' + (((c & 3) === 1 || (c & 3) === 2) ? 'rd' : '') + '">' + RLC[c >> 2] + SYMS[c & 3] + '</span>').join(' ');
  const txt = codes => codes.map(c => RLC[c >> 2] + SYMS[c & 3]).join(' ');

  function start(ctx) {
    let P = Object.assign({ opp: 3 }, SD.read(LS, null) || {});
    if (!(P.opp >= 1 && P.opp <= 8)) P.opp = 3;
    const save = () => SD.write(LS, P);
    const M = { on: false, tgt: 'h', pr: 0, ps: '', h: [], b: [] };   // manual entry (not saved)
    let rulesOpen = false, last = '', misses = 0, dumped = false, readCount = '', active = false, ckey = '', R = null;

    ctx.css(CSS);
    const box = document.createElement('div');
    box.id = 'csh';
    box.innerHTML = '<div class="hd"></div><div class="rs"></div>' +
      '<div class="po" style="display:none"><span class="dim">Pot</span><input class="ip" inputmode="decimal" placeholder="pot with bets"><span class="dim">Call</span><input class="ic" inputmode="decimal" placeholder="to call"><div class="pv"></div></div>' +
      '<div class="ft"><button data-a="man">Manual</button><button data-a="rules"></button></div><div class="mp"></div><div class="ru"></div>';
    const q = s => box.querySelector(s), hd = q('.hd'), rs = q('.rs'), po = q('.po'), ip = q('.ip'), ic = q('.ic'), pv = q('.pv'), bMan = q('[data-a="man"]'), bRules = q('[data-a="rules"]'), mp = q('.mp'), ru = q('.ru');

    // ----- what the page (or the manual keypad) says right now -----
    function readState() {
      if (M.on) return { src: 'manual', hand: M.h.slice(), board: M.b.slice() };
      const cards = readCards();
      if (!cards.length) return { src: 'none' };
      const sp = splitPoker(cards), hand = [], board = [];
      let bad = false;
      const add = (list, c) => { const x = toCode(c); if (x === null) bad = true; else if (hand.indexOf(x) < 0 && board.indexOf(x) < 0) list.push(x); };
      sp.hand.forEach(c => add(hand, c));
      sp.board.forEach(c => add(board, c));
      return { src: 'page', hand, board, bad, count: cards.length, sig: cards.slice(0, 9).map(c => RL[c.r] + c.s + '/' + (c.role || '-') + (c.shown ? '' : '!hid') + (c.shown && !c.top ? '!cov' : '') + '@' + Math.round(c.x) + ',' + Math.round(c.y)).join(' ') };
    }

    // ----- drawing -----
    const bar = (w, p, l) => '<div class="bar"><i class="w" style="width:' + w * 100 + '%"></i><i class="p" style="width:' + p * 100 + '%"></i><i class="l" style="width:' + l * 100 + '%"></i></div>';
    const wait = t => '<div class="bd"><span class="dim">' + t + '</span></div>';

    function solve(hand, board) {
      const k = hand.join(',') + '|' + board.join(',') + '|' + P.opp;
      if (k !== ckey) { ckey = k; R = analyze(hand, board, P.opp); }
      return R;
    }

    function renderBody(s) {
      if (s.src === 'none') return wait('Waiting for your cards...');
      if (s.bad) return wait('Suits are not readable on this page. Use Manual.');
      if (s.hand.length < 2) return wait(s.src === 'manual' ? 'Tap your two cards.' : 'Waiting for your two cards...');
      const a = solve(s.hand, s.board);
      if (!a) return wait('Cannot work this out (too many cards).');
      const c = a.rate === 'WEAK' ? 'bad' : a.rate === 'FAIR' ? 'warn' : 'ok';
      let h = '<div class="bd"><div class="big ' + c + '">' + a.rate + '<small>' + pc(a.eq) + '% equity \u00b7 ' + a.name + '</small></div>' + bar(a.win, a.tie, a.lose) +
        '<div class="lg"><span class="ok">Win ' + pc(a.win) + '%</span><span>Tie ' + pc(a.tie) + '%</span><span class="bad">Lose ' + pc(a.lose) + '%</span></div>' +
        '<div class="why">You ' + cardsHtml(s.hand) + (s.board.length ? ' \u00b7 Board ' + cardsHtml(s.board) : ' \u00b7 before the flop') + '</div>';
      if (a.outs) h += '<div class="why">Outs: ' + a.outs + ' \u00b7 ' + pc(a.hit) + '% next card' + (s.board.length === 3 ? ' \u00b7 ' + pc(a.river) + '% by the river' : '') + '</div>';
      return h + '<div class="why dim">vs ' + a.opp + ' random hand' + (a.opp > 1 ? 's' : '') + ' (set the number in Rules)</div></div>';
    }

    function updatePot() {
      const pot = num(ip.value), call = num(ic.value);
      if (!R || !(call > 0)) { pv.innerHTML = '<span class="dim">Type the pot and the amount to call.</span>'; return; }
      const need = call / (pot + call), ok = R.eq >= need;
      pv.innerHTML = '<span class="' + (ok ? 'ok' : 'bad') + '">' + (ok ? 'Calling pays off' : 'Calling loses money') + '</span> <span class="dim">you need ' + pc(need) + '%, you have ' + pc(R.eq) + '%</span>';
    }

    function render(s) {
      hd.innerHTML = '<b>Poker Helper</b>';
      rs.innerHTML = renderBody(s);
      const ready = s.src !== 'none' && !s.bad && s.hand.length === 2 && !!R;
      if (!ready) R = null;
      po.style.display = ready ? '' : 'none';
      if (ready) updatePot();
      bMan.classList.toggle('on', M.on);
      bRules.textContent = 'Rules ' + (rulesOpen ? '\u25b2' : '\u25bc');
      let h = '';
      if (M.on) {
        h += '<div class="pn"><div class="mh"><button data-t="h" class="' + (M.tgt === 'h' ? 'on' : '') + '">Hand</button><span>' + (M.h.length ? cardsHtml(M.h) : '-') + '</span></div>' +
          '<div class="mh"><button data-t="b" class="' + (M.tgt === 'b' ? 'on' : '') + '">Board</button><span>' + (M.b.length ? cardsHtml(M.b) : '-') + '</span></div><div class="kp">';
        for (let r = 1; r <= 13; r++) h += '<button data-r="' + r + '" class="' + (M.pr === r ? 'on' : '') + '">' + RL[r] + '</button>';
        h += '<button data-a="undo">\u232b</button></div><div class="seg" style="margin-top:6px">';
        SUITS.split('').forEach((su, i) => { h += '<button data-s="' + su + '" class="' + (M.ps === su ? 'on ' : '') + (i === 1 || i === 2 ? 'rd' : '') + '">' + SYMS[i] + '</button>'; });
        h += '</div><div class="mh" style="margin-top:6px"><button data-a="clear" style="flex:1">New hand</button></div></div>';
      }
      mp.innerHTML = h;
      let g = '';
      if (rulesOpen) {
        g = '<div class="pn"><label>Opponents still in the hand</label><div class="seg">';
        for (let n = 1; n <= 8; n++) g += '<button data-o="' + n + '" class="' + (P.opp === n ? 'on' : '') + '">' + n + '</button>';
        g += '</div></div>';
      }
      ru.innerHTML = g;
    }

    // ----- taps -----
    function tryAdd() {
      if (!M.pr || !M.ps) return;
      const code = (M.pr === 1 ? 14 : M.pr) * 4 + SUITS.indexOf(M.ps);
      M.pr = 0; M.ps = '';
      if (M.h.indexOf(code) >= 0 || M.b.indexOf(code) >= 0) { SD.toast('That card is already used'); return; }
      if (M.tgt === 'h') { if (M.h.length < 2) M.h.push(code); else { SD.toast('Hand is full'); return; } if (M.h.length === 2) M.tgt = 'b'; }
      else if (M.b.length < 5) M.b.push(code);
      else SD.toast('Board is full');
    }
    box.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      const d = b.dataset;
      if (d.a === 'man') { M.on = !M.on; last = ''; }
      else if (d.a === 'rules') { rulesOpen = !rulesOpen; last = ''; }
      else if (d.a === 'clear') { M.h = []; M.b = []; M.pr = 0; M.ps = ''; M.tgt = 'h'; last = ''; }
      else if (d.a === 'undo') { const l = M.tgt === 'h' && M.h.length ? M.h : M.b.length ? M.b : M.h; l.pop(); if (!M.h.length) M.tgt = 'h'; last = ''; }
      else if (d.t) { M.tgt = d.t; last = ''; }
      else if (d.r) { M.pr = M.pr === +d.r ? 0 : +d.r; tryAdd(); last = ''; }
      else if (d.s) { M.ps = M.ps === d.s ? '' : d.s; tryAdd(); last = ''; }
      else if (d.o) { P.opp = +d.o; save(); last = ''; }
      else return;
      tick(true);
    });
    ip.addEventListener('input', updatePot);
    ic.addEventListener('input', updatePot);

    // ----- mounting and loop -----
    // The title row (game name + its icons) is drawn late on some pages, so the panel is put right under it on every tick, not only once.
    let titleEl = null, anchor = '';
    const elName = e => e.tagName.toLowerCase() + '.' + String(typeof e.className === 'string' ? e.className : '').trim().replace(/\s+/g, '.').slice(0, 60);
    function findTitle() {
      if (titleEl && titleEl.isConnected) return titleEl;
      titleEl = document.querySelector('.content-title');
      if (titleEl) return titleEl;
      const root = document.querySelector('.content-wrapper') || document.body, want = 'poker';
      const hs = root.querySelectorAll('h1,h2,h3,h4,[class*="title" i]');
      for (let i = 0; i < hs.length; i++) {
        const h = hs[i], tx = (h.textContent || '').trim().toLowerCase();
        if (mine(h) || box.contains(h) || tx.indexOf(want) !== 0 || tx.length > want.length + 25) continue;
        let el = h;   // up to the whole title row: the biggest ancestor that is still a thin strip
        while (el.parentElement && el.parentElement !== root && el.parentElement !== document.body && el.parentElement.getBoundingClientRect().height <= 100) el = el.parentElement;
        titleEl = el;
        return el;
      }
      return null;
    }

    function mount() {
      const t = findTitle(), w = document.querySelector('.content-wrapper');
      if (t && t.nextElementSibling === box) return;   // already right under the title
      box.classList.remove('fx');
      if (t) {
        t.insertAdjacentElement('afterend', box);
        if (anchor !== 't') { anchor = 't'; SD.log('poker', 'panel placed under the title: ' + elName(t)); }
      } else if (!box.isConnected) {
        if (w) w.insertBefore(box, w.firstChild); else { box.classList.add('fx'); document.body.appendChild(box); }
        if (anchor !== 'f') { anchor = 'f'; SD.log('poker', 'title not found (yet): panel put at the top of the page', 'w'); }
      }
    }

    function tick(force) {
      if (document.hidden && force !== true) return;
      const sid = (new URLSearchParams(location.search).get('sid') || '').toLowerCase();
      if (sid !== 'holdem' && sid !== 'poker') { if (box.isConnected) box.remove(); active = false; return; }
      if (!active) { active = true; last = ''; misses = 0; dumped = false; SD.log('poker', 'page: ' + sid); }
      mount();
      const s = readState();
      if (s.src === 'none') {
        misses++;
        if (misses >= 6 && !dumped) {
          dumped = true;
          const sample = [];
          document.querySelectorAll('[class*="card" i]').forEach(el => { if (sample.length < 8 && !mine(el)) sample.push(el.tagName.toLowerCase() + '.' + String(typeof el.className === 'string' ? el.className : '').trim().replace(/\s+/g, '.').slice(0, 70)); });
          SD.log('poker', 'no cards read. card-like elements: ' + (sample.join(' | ') || 'none'), 'w');
        }
      } else misses = 0;
      const key = JSON.stringify([s.src, s.hand, s.board, s.bad, s.sig, M.on, M.tgt, M.pr, M.ps, rulesOpen, P]);
      if (key === last) return;
      last = key;
      if (s.src !== 'none') {
        const line = 'poker hand=' + (s.hand.length ? txt(s.hand) : '?') + ' board=' + (s.board.length ? txt(s.board) : '-') + ' opp=' + P.opp + ' (' + s.src + (s.bad ? ', suit unknown' : '') + ')' + (s.sig ? ' [' + s.sig + ']' : '');
        if (line !== readCount) { readCount = line; SD.log('poker', line); }
      }
      render(s);
    }

    tick(true);
    ctx.every(tick, 700);   // cleared by the core when the feature is switched off

    return { stop() { box.remove(); } };
  }

  SD.feature({
    id: 'poker',
    group: 'Casino',
    label: 'Poker Helper',
    where: 'Casino (Poker)',
    info: 'Win chance, outs and pot odds against random hands.',
    match: /^\/page\.php$/,
    start,
    engine: { parseCard, score, equity, analyze, splitPoker, toCode }   // exposed for tests only
  });
})();

} catch (e) { console.error('Speed Dial: features/pokerhelper.js:', e); try { window.SpeedDial && window.SpeedDial.log('boot', 'features/pokerhelper.js failed: ' + (e && e.message || e), 'e'); } catch (x) { /* log not ready yet */ } }

    window.SpeedDial.start({ apiKey: '###PDA-APIKEY###' }); // filled in by Torn PDA
  } catch (e) { console.error('Speed Dial:', e); }
})();
