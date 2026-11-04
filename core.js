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
