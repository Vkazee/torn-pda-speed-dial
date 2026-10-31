// ==UserScript==
// @name         Speed Dial (bundle)
// @namespace    speeddial
// @version      0.3.0
// @description  One floating circle for Torn PDA. Tap it to fan out your tools (Item Dock, Travel Helper). Each tool only runs while its panel is open.
// @match        https://www.torn.com/*
// @grant        none
// ==/UserScript==

// Speed Dial core v0.6.1
// One floating circle. Tap it and one circle per module fans out. Tap a module circle to open or close its floating window.
// A module may also be a shortcut circle: { emoji, href } opens a page on tap instead of a panel.
// The Settings module (pinned) lets you hide/show modules and drag them into your own order.
// A module only builds its UI, timers and API calls while its window is open (lazy).
(function () {
  'use strict';
  if (window.SpeedDial) return;

  const SD = window.SpeedDial = { mods: [], key: '', hasKey: false, started: false };
  const POS = 'speedDial.pos1';
  const DK = 'speedDial.data1';
  const TTL = 30000;
  const GAP = 46;
  const LAY = 'speedDial.layout1';   // { order: [ids], hidden: [ids] }

  // ---------- helpers shared by modules ----------
  SD.read = (k, def) => {
    try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? def : v; } catch (e) { return def; }
  };
  SD.write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
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
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.style.cssText = 'position:fixed;left:50%;bottom:72px;transform:translateX(-50%);max-width:82vw;z-index:99999;display:none;background:#1c1c1c;border:1px solid #3a3a3a;color:#e6e6e6;padding:8px 12px;border-radius:10px;font:12px/1.35 -apple-system,Roboto,sans-serif;text-align:center';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.style.display = 'none'; }, 3500);
  };

  // official API (throws on API errors)
  SD.api = async url => {
    const r = await fetch(url + (url.indexOf('?') > -1 ? '&' : '?') + 'key=' + SD.key);
    const j = await r.json();
    if (j.error) throw new Error(j.error.error || 'API error');
    return j;
  };

  // ---------- shared player data: ONE call for every module, cached 30s ----------
  let D = null, inflight = null, err = '';
  const readCache = () => {
    try { const c = JSON.parse(sessionStorage.getItem(DK)); if (c && c.t) D = c; } catch (e) {}
  };
  SD.peek = () => { if (!D) readCache(); return D; };
  SD.error = () => err;

  SD.data = function (force) {
    if (!SD.hasKey) return Promise.resolve(null);
    SD.peek();
    if (!force && D && Date.now() - D.t < TTL) { ring(); return Promise.resolve(D); }   // cache masih segar: tetap gambar outline
    if (inflight) return inflight;
    inflight = fetch('https://api.torn.com/user/?selections=basic,travel,cooldowns,bars&key=' + SD.key)
      .then(r => r.json())
      .then(j => {
        if (j.error) { err = j.error.error || 'API error'; return D; }
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
        err = '';
        try { sessionStorage.setItem(DK, JSON.stringify(D)); } catch (e) {}
        return D;
      })
      .catch(() => { err = 'Network error'; return D; })
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
  // pinned: true keeps the circle last and always visible (used by Settings, so you can never lock yourself out)
  SD.register = m => {
    SD.mods.push(m);
    if (stack) refreshCircles();
  };
  SD.unregister = id => {
    const i = SD.mods.findIndex(m => m.id === id);
    if (i < 0) return;
    const m = SD.mods[i];
    closeWin(id);
    SD.mods.splice(i, 1);
    const ly = layout0();                       // forget a removed module in the saved layout
    ly.order = ly.order.filter(x => x !== id);
    ly.hidden = ly.hidden.filter(x => x !== id);
    SD.write(LAY, ly);
    if (stack) refreshCircles();
  };

  // ---------- menu layout: your order + hidden modules (edited in Settings) ----------
  let LY = null;
  const layout0 = () => {
    if (!LY) {
      const v = SD.read(LAY, {}) || {};
      const ids = a => (Array.isArray(a) ? a.filter(x => typeof x === 'string') : []);
      LY = { order: ids(v.order), hidden: ids(v.hidden) };
    }
    return LY;
  };
  // every module except pinned ones, in menu order, hidden ones included.
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
  SD.isHidden = id => layout0().hidden.indexOf(id) > -1;
  // order / hidden = arrays of module ids. Ids of modules that are not loaded right now are kept as they were.
  SD.setLayout = (order, hidden) => {
    const ly = layout0();
    const here = id => SD.mods.some(m => m.id === id);
    LY = {
      order: order.concat(ly.order.filter(id => order.indexOf(id) < 0 && !here(id))),
      hidden: hidden.filter(id => here(id)).concat(ly.hidden.filter(id => !here(id)))
    };
    SD.write(LAY, LY);
    if (stack) refreshCircles();
  };

  // ---------- hub UI ----------
  let root, fab, stack, wrap, P, menuOpen = false, WP = null;
  const circles = [];
  const wins = new Map();
  const zorder = [];
  const WIN = 'speedDial.win1';   // { moduleId: [x, y] }
  const WM = 4;

  const CSS = `
    #sdial{position:fixed;z-index:99998;font:13px/1.25 -apple-system,Roboto,sans-serif;-webkit-tap-highlight-color:transparent;--st:#5a5a5a}
    #sdial *{box-sizing:border-box}
    #sdial svg{width:20px;height:20px;stroke:#d0d0d0;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
    @keyframes sdspin{to{transform:rotate(360deg)}}
    #sdial .spin svg{animation:sdspin .8s linear infinite}
    #sdial .fab{position:relative;z-index:2000;touch-action:none;width:40px;height:40px;border-radius:50%;border:1px solid #3a3a3a;background:#1c1c1c;display:flex;align-items:center;justify-content:center;opacity:.85;box-shadow:0 2px 6px rgba(0,0,0,.4);padding:0}
    #sdial .fab.on{opacity:1;border-color:#5a5a5a}
    #sdial .fab.away{opacity:1;border-color:#4a8fd9;box-shadow:0 0 0 2px rgba(74,143,217,.3),0 2px 6px rgba(0,0,0,.4)}
    #sdial .fab.hosp{opacity:1;border-color:#d9a441;box-shadow:0 0 0 2px rgba(217,164,65,.3),0 2px 6px rgba(0,0,0,.4)}
    #sdial .fab.blk{opacity:1;border-color:#e5534b;box-shadow:0 0 0 2px rgba(229,83,75,.35),0 2px 6px rgba(0,0,0,.4)}
    #sdial .mod{position:absolute;z-index:2000;left:2px;width:36px;height:36px;border-radius:50%;border:1px solid #3a3a3a;background:#1c1c1c;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.4);padding:0;opacity:0;transform:scale(.5);pointer-events:none;transition:opacity .12s,transform .12s}
    #sdial .stack.show .mod{opacity:1;transform:scale(1);pointer-events:auto}
    #sdial[data-st="away"]{--st:#4a8fd9}
    #sdial[data-st="hosp"]{--st:#d9a441}
    #sdial[data-st="blk"]{--st:#e5534b}
    #sdial .mod.act{border-color:var(--st)}
    #sdial .mod:active{background:#2e2e2e}
    #sdial .emo{font-size:18px;line-height:1;pointer-events:none}
    #sdial .lb{position:absolute;top:50%;left:40px;transform:translateY(-50%);white-space:nowrap;padding:3px 8px;border-radius:8px;background:#1c1c1c;border:1px solid #333;color:#e6e6e6;font-size:12px;pointer-events:none}
    #sdial.r .lb{left:auto;right:40px}
    #sdial.pnl .lb{display:none}
    #sdial .win{position:fixed;left:0;top:0;display:flex;flex-direction:column;overflow:hidden;background:#1c1c1c;border:1px solid var(--st);border-radius:12px;box-shadow:0 6px 18px rgba(0,0,0,.5);color:#e6e6e6;max-height:calc(100vh - 8px)}
    #sdial .win.mv{will-change:transform}
    #sdial[data-st="away"] .win{box-shadow:0 0 0 2px rgba(74,143,217,.3),0 6px 18px rgba(0,0,0,.5)}
    #sdial[data-st="hosp"] .win{box-shadow:0 0 0 2px rgba(217,164,65,.3),0 6px 18px rgba(0,0,0,.5)}
    #sdial[data-st="blk"] .win{box-shadow:0 0 0 2px rgba(229,83,75,.35),0 6px 18px rgba(0,0,0,.5)}
    #sdial .win .tb{flex:0 0 30px;height:30px;display:flex;align-items:center;padding:0 0 0 10px;background:#242424;border-bottom:1px solid #2c2c2c;touch-action:none;cursor:grab;user-select:none;-webkit-user-select:none}
    #sdial .win.mv .tb{cursor:grabbing}
    #sdial .win .tt{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:#cfcfcf;pointer-events:none}
    #sdial .win .cl{flex:0 0 38px;width:38px;height:30px;border:0;background:none;color:#cfcfcf;font-size:14px;padding:0}
    #sdial .win .cl:active{background:#2e2e2e}
    #sdial .win .bd{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;touch-action:pan-y;padding:6px}
  `;

  function ring() {
    if (!fab) return;
    const d = D;
    const m = SD.mode(d);
    const red = !!d && (d.state === 'Jail' || d.state === 'Federal' || (d.state === 'Hospital' && d.abroad));
    fab.classList.toggle('blk', red);
    fab.classList.toggle('hosp', !!d && d.state === 'Hospital' && !d.abroad);
    fab.classList.toggle('away', !red && (m === 'flying' || m === 'abroad'));
    const hosp = !!d && d.state === 'Hospital' && !d.abroad, away = !red && (m === 'flying' || m === 'abroad');
    root.dataset.st = red ? 'blk' : hosp ? 'hosp' : away ? 'away' : '';   // the window outline follows the main circle
  }

  function layout() {
    if (!root) return;
    P.x = Math.max(0, Math.min(P.x, innerWidth - 40));
    P.y = Math.max(0, Math.min(P.y, innerHeight - 40));
    root.style.left = P.x + 'px';
    root.style.top = P.y + 'px';
    const down = P.y < innerHeight / 2, right = P.x > innerWidth / 2;
    root.classList.toggle('r', right);
    circles.forEach((c, i) => {
      const off = GAP * (i + 1);
      c.b.style.top = (2 + (down ? off : -off)) + 'px';
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
    SD.ordered().filter(m => !SD.isHidden(m.id))
      .concat(SD.mods.filter(m => m.pinned))
      .forEach(addCircle);
    markActive();
    layout();
  }

  function markActive() {
    circles.forEach(c => c.b.classList.toggle('act', wins.has(c.m.id)));
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
    if (inst && typeof inst.unmount === 'function') { try { inst.unmount(); } catch (e) {} }
    me.win.remove();
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
      try { tb.setPointerCapture(e.pointerId); } catch (err) {}
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

  function openWin(m) {
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
      get alive() { return wins.get(m.id) === me; },
      every: (fn, ms) => { if (wins.get(m.id) !== me) return 0; const id = setInterval(fn, ms); me.timers.push(['i', id]); return id; },
      after: (fn, ms) => { if (wins.get(m.id) !== me) return 0; const id = setTimeout(fn, ms); me.timers.push(['t', id]); return id; },
      setWidth: w => { me.w = w; place(me); },
      close: () => closeWin(m.id)
    };
    try { me.inst = m.mount(ctx) || null; } catch (e) { inner.textContent = 'Error: ' + e.message; }
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
    ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(t => root.addEventListener(t, e => e.stopPropagation(), { passive: true }));   // Torn's own swipe handlers never see touches on our circle or windows
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
    SD.peek();
    ring();
    SD.data(false);
  };
})();

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
  // number changes (it has caught up) or the cache window has passed. Kept in localStorage so a page
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
      } catch (e) {}
      msg = String(msg).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      SD.toast(msg ? msg.slice(0, 160) : 'Done');
      if (ok && !it.fac) bump(it.id, -1);                 // update the count right away
      SD.data(true).then(() => { if (ui) ui.status(); });  // fresh status + cooldowns
    } catch (e) {
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
    #sdial .idock .banner.show{display:block}
    #sdial .idock .list{max-height:48vh;overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y}
    #sdial .idock.blocked .list{opacity:.45}
    #sdial .idock .cd{display:none;flex-wrap:wrap;gap:4px;margin-bottom:6px}
    #sdial .idock .chip{padding:3px 7px;border-radius:6px;background:#242424;border:1px solid #333;color:#cfcfcf;font-size:11px}
    #sdial .idock .ir{display:flex;align-items:center;min-height:40px;box-sizing:border-box;padding:6px 10px;border-radius:8px;color:#e6e6e6;margin-bottom:3px;background:#242424;border-left:3px solid #4a8f4e;user-select:none;-webkit-user-select:none}
    #sdial .idock .ir:active{background:#2e2e2e}
    #sdial .idock .ir.out{border-left-color:#e5534b;cursor:not-allowed}
    #sdial .idock .ir.out:active{background:#242424}
    #sdial .idock .ir.low{border-left-color:#d9a441}
    #sdial .idock .ir.fac{border-left-color:#4a8fd9}
    #sdial .idock .ir.low .qty{color:#d9a441}
    #sdial .idock .ir.drag{position:relative;z-index:5;background:#383838;box-shadow:0 4px 12px rgba(0,0,0,.55);opacity:1!important}
    #sdial .idock .ir .nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #sdial .idock .ir .grip{display:none;align-items:center;justify-content:center;width:32px;height:40px;margin:0 2px 0 -8px;touch-action:none;cursor:grab}
    #sdial .idock .ir .grip svg{width:18px;height:18px;stroke:#8a8a8a}
    #sdial .idock.edit .ir .grip{display:flex}
    #sdial .idock .ir.drag .grip svg{stroke:#e6e6e6}
    #sdial .idock .ir .x{display:none;width:28px;height:28px;margin-right:-6px;border:0;background:none;color:#e5534b;font-size:18px;padding:0}
    #sdial .idock.edit .ir .x{display:block}
    #sdial .idock .qty{margin-left:8px;color:#9a9a9a;font-size:12px;white-space:nowrap}
    #sdial .idock .ir.out .qty{color:#e5534b}
    #sdial .idock .tag{margin-left:6px;padding:1px 6px;border-radius:6px;background:#2d3b52;color:#9bb8e0;font-size:10px}
    #sdial .idock.asking .list,#sdial .idock.asking .foot{display:none}
    #sdial .idock .confirm{display:none;padding:8px 6px 4px;text-align:center;color:#e6e6e6}
    #sdial .idock.asking .confirm{display:block}
    #sdial .idock .confirm .q{margin-bottom:10px;line-height:1.4}
    #sdial .idock .confirm .q b{display:block;font-size:14px;margin-top:2px}
    #sdial .idock .confirm .btns{display:flex;gap:6px}
    #sdial .idock .confirm button{flex:1;height:38px;border-radius:8px;border:1px solid #333;background:#242424;color:#cfcfcf;font-size:13px}
    #sdial .idock .confirm button.ok{background:#2f6b34;border-color:#3f8a45;color:#fff}
    #sdial .idock .empty{color:#8a8a8a;padding:10px;text-align:center}
    #sdial .idock .foot{display:flex;gap:6px;margin-top:4px;padding-top:6px;border-top:1px solid #2c2c2c}
    #sdial .idock .foot button{flex:1;height:34px;border-radius:8px;border:1px solid #333;background:#242424;color:#cfcfcf;font-size:12px;padding:0 4px}
    #sdial .idock .foot button:active{background:#2e2e2e}
    #sdial .idock .foot .ico{flex:0 0 44px}
    #sdial .idock .addv{display:none}
    #sdial .idock.adding .addv{display:block}
    #sdial .idock.adding .list,#sdial .idock.adding .foot,#sdial .idock.adding .banner,#sdial .idock.adding .cd{display:none!important}
    #sdial .idock .ah{display:flex;align-items:center;gap:8px;margin-bottom:6px;color:#e6e6e6;font-size:13px}
    #sdial .idock .ah .back{flex:0 0 32px;height:32px;border-radius:8px;border:1px solid #333;background:#242424;display:flex;align-items:center;justify-content:center;padding:0}
    #sdial .idock .ah .back:active{background:#2e2e2e}
    #sdial .idock .sq{box-sizing:border-box;width:100%;height:38px;border-radius:8px;border:1px solid #3a3a3a;background:#242424;color:#e6e6e6;font-size:16px;padding:0 10px;margin-bottom:6px;outline:none}
    #sdial .idock .sq:focus{border-color:#4a8fd9}
    #sdial .idock .seg{display:flex;gap:6px;margin-bottom:6px}
    #sdial .idock .seg button{flex:1;height:30px;border-radius:8px;border:1px solid #333;background:#242424;color:#cfcfcf;font-size:12px;padding:0}
    #sdial .idock .seg button.on{background:#2a3140;border-color:#4a8fd9;color:#fff}
    #sdial .idock .res{max-height:38vh;overflow-y:auto;touch-action:pan-y}
    #sdial .idock .res .r{display:flex;align-items:center;gap:8px;min-height:44px;padding:4px 10px;border-radius:8px;margin-bottom:3px;background:#242424;border-left:3px solid #4a8fd9}
    #sdial .idock .res .r:active{background:#2e2e2e}
    #sdial .idock .res .r.have{opacity:.5}
    #sdial .idock .res .t{flex:1;min-width:0}
    #sdial .idock .res .nm{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #sdial .idock .res .ty{display:block;color:#8a8a8a;font-size:11px}
    #sdial .idock .res .pl{color:#7fd08a;font-size:18px;line-height:1}
    #sdial .idock .res .hint{color:#8a8a8a;padding:12px 6px;text-align:center;font-size:12px}
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
        try { grip.setPointerCapture(e.pointerId); } catch (err) {}
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
      if (d.state === 'Okay') { banner.classList.remove('show', 'blk'); return; }
      let txt = stLabel();
      if (d.until && d.state !== 'Hospital') {
        const s = d.until - Math.floor(Date.now() / 1000);
        if (s > 0) txt += ' \u00b7 ' + SD.durS(s) + ' left';
      }
      if (blk) txt += "\nItems can't be used right now";
      if (banner.textContent !== txt) banner.textContent = txt;
      banner.classList.add('show');
      banner.classList.toggle('blk', blk);
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
      const on = el.classList.toggle('edit');
      e.target.textContent = on ? 'Done' : 'Edit';
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

// Speed Dial module: Settings v0.3.0
// The pinned gear circle (always last, cannot be hidden). Two pages:
//   Menu          - every module in your order. Eye = show/hide the circle. Edit mode: drag the handle to reorder,
//                   and remove your own shortcuts.
//   Add shortcut  - your own emoji circles that open a torn.com page (this is the old "Add shortcut" module).
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
    } catch (e) {}
    return Array.from(s)[0] || '';
  };
  const emojiOf = raw => {
    const s = String(raw || '').trim();
    if (!s) return '\u2B50';
    const g = firstChar(s);
    return PICT.test(g) ? g : '';
  };

  const EYE = '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7c2 0 3.7.7 5.2 1.7M22 12s-3.6 7-10 7c-2 0-3.7-.7-5.2-1.7"/><path d="M4 4l16 16"/></svg>';
  const GRIP = '<svg viewBox="0 0 24 24"><line x1="5" y1="8" x2="19" y2="8"/><line x1="5" y1="12" x2="19" y2="12"/><line x1="5" y1="16" x2="19" y2="16"/></svg>';

  const CSS = `
    #sdial .cz .ttl{font-size:13px;margin:2px 2px 6px;color:#e6e6e6}
    #sdial .cz .tabs{display:flex;gap:4px;margin-bottom:6px}
    #sdial .cz .tabs button{flex:1}
    #sdial .cz .tabs button.on{background:#383838;color:#e6e6e6;border-color:#5a5a5a}
    #sdial .cz .pg{display:none}
    #sdial .cz .pg.on{display:block}
    #sdial .cz .qk{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px}
    #sdial .cz .qk button{flex:0 0 auto;width:30px;height:30px;font-size:16px;padding:0}
    #sdial .cz .rw{display:flex;gap:6px;margin-bottom:6px}
    #sdial .cz input{min-width:0;height:32px;border-radius:8px;border:1px solid #333;background:#242424;color:#e6e6e6;font-size:13px;padding:0 8px}
    #sdial .cz .ie{flex:0 0 64px;text-align:center;font-size:16px}
    #sdial .cz .in,#sdial .cz .iu{flex:1}
    #sdial .cz button{height:32px;border-radius:8px;border:1px solid #333;background:#242424;color:#cfcfcf;font-size:12px;padding:0 8px}
    #sdial .cz button:active{background:#2e2e2e}
    #sdial .cz .add,#sdial .cz .edit{width:100%}
    #sdial .cz .lst{max-height:36vh;overflow-y:auto;touch-action:pan-y;margin-bottom:6px}
    #sdial .cz .it{display:flex;align-items:center;gap:8px;height:34px;padding:0 4px 0 10px;border-radius:8px;background:#242424;margin-bottom:3px;user-select:none;-webkit-user-select:none}
    #sdial .cz .it.drag{position:relative;z-index:5;background:#383838;box-shadow:0 4px 12px rgba(0,0,0,.55)}
    #sdial .cz .it .ix{width:20px;display:flex;align-items:center;justify-content:center;font-size:16px;flex:0 0 auto}
    #sdial .cz .it .ix svg{width:18px;height:18px}
    #sdial .cz .it .nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #sdial .cz .it.off .ix,#sdial .cz .it.off .nm{opacity:.4}
    #sdial .cz .it .grip{display:none;align-items:center;justify-content:center;width:30px;height:34px;margin:0 0 0 -10px;touch-action:none;cursor:grab;flex:0 0 auto}
    #sdial .cz .it .grip svg{width:18px;height:18px;stroke:#8a8a8a}
    #sdial .cz.edit .it .grip{display:flex}
    #sdial .cz .it.drag .grip svg{stroke:#e6e6e6}
    #sdial .cz .it .btn{height:26px;width:30px;padding:0;display:flex;align-items:center;justify-content:center;flex:0 0 auto}
    #sdial .cz .it .btn svg{width:16px;height:16px}
    #sdial .cz .it .del{display:none;color:#f1807a}
    #sdial .cz.edit .it.cu .del{display:flex}
  `;

  function mount(ctx) {
    SD.css('sd-settings', CSS);
    const el = ctx.el;
    el.className = 'cz';
    el.innerHTML =
      '<div class="ttl">Settings</div>' +
      '<div class="tabs"><button class="tb on" data-p="pm">Menu</button><button class="tb" data-p="pa">Add shortcut</button></div>' +
      '<div class="pg pm on"><div class="lst"></div><button class="edit">Edit</button></div>' +
      '<div class="pg pa">' +
        '<div class="qk"></div>' +
        '<div class="rw"><input class="ie" maxlength="12" placeholder="Emoji" autocomplete="off"><input class="in" maxlength="20" placeholder="Name" autocomplete="off"></div>' +
        '<div class="rw"><input class="iu" placeholder="/page.php?sid=..." autocomplete="off" autocapitalize="off" spellcheck="false"><button class="here">This page</button></div>' +
        '<button class="add">Add</button>' +
      '</div>';
    const qk = el.querySelector('.qk'), lst = el.querySelector('.lst');
    const inE = el.querySelector('.ie'), inN = el.querySelector('.in'), inU = el.querySelector('.iu');
    let drag = null;

    // ----- pages -----
    el.querySelectorAll('.tb').forEach(b => b.addEventListener('click', () => {
      el.querySelectorAll('.tb').forEach(x => x.classList.toggle('on', x === b));
      el.querySelectorAll('.pg').forEach(p => p.classList.toggle('on', p.classList.contains(b.dataset.p)));
      if (b.dataset.p === 'pm') renderList();
    }));

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

    // ----- menu page -----
    const hiddenIds = () => SD.ordered().map(m => m.id).filter(id => SD.isHidden(id));
    const orderIds = () => SD.ordered().map(m => m.id);

    function renderList() {
      if (drag) return;
      lst.innerHTML = '';
      SD.ordered().forEach(m => {
        const off = SD.isHidden(m.id);
        const custom = list.some(s => sid(s) === m.id);
        const r = document.createElement('div');
        r.className = 'it' + (off ? ' off' : '') + (custom ? ' cu' : '');
        r._id = m.id;
        r.innerHTML = '<span class="grip" aria-label="Drag to reorder">' + GRIP + '</span><span class="ix"></span><span class="nm"></span>' +
          '<button class="btn del" aria-label="Delete">\u2715</button><button class="btn eye" aria-label="Show or hide"></button>';
        const ix = r.querySelector('.ix');
        if (m.emoji) ix.textContent = m.emoji; else ix.innerHTML = '<svg viewBox="0 0 24 24">' + m.icon + '</svg>';
        r.querySelector('.nm').textContent = m.label;
        r.querySelector('.eye').innerHTML = off ? EYE_OFF : EYE;
        r.querySelector('.eye').addEventListener('click', () => {
          const h = hiddenIds().filter(id => id !== m.id);
          if (!off) h.push(m.id);
          SD.setLayout(orderIds(), h);
          renderList();
        });
        r.querySelector('.del').addEventListener('click', () => {
          list = list.filter(s => sid(s) !== m.id);
          save();
          SD.unregister(m.id);
          renderList();
        });
        bindDrag(r);
        lst.appendChild(r);
      });
    }

    // ----- drag the grip handle (edit mode only) to reorder; the list scrolls itself near its top/bottom edge -----
    function bindDrag(row) {
      const grip = row.querySelector('.grip');
      grip.addEventListener('pointerdown', e => {
        if (e.button > 0 || !el.classList.contains('edit')) return;
        e.preventDefault();
        drag = { row, startY: e.clientY, y: e.clientY, raf: 0 };
        try { grip.setPointerCapture(e.pointerId); } catch (err) {}
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
      const order = Array.from(lst.children).map(r => r._id).filter(Boolean);
      drag = null;
      if (order.length) SD.setLayout(order, hiddenIds());
      renderList();
    }

    el.querySelector('.edit').addEventListener('click', e => {
      const on = el.classList.toggle('edit');
      e.target.textContent = on ? 'Done' : 'Edit';
    });

    renderList();
  }

  SD.register({
    id: 'settings',
    label: 'Settings',
    width: 250,
    pinned: true,
    // gear
    icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    mount
  });
})();

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
        return { rows: r.rows, ts: r.ts, src: s.n, t: Date.now(), note: failed.join(', ') };
      } catch (e) { failed.push(s.n + ' failed (' + e.message + ')'); }
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
    #sdial .trv .stat{margin-bottom:6px;padding:6px 10px;border-radius:8px;background:#242424;line-height:1.4}
    #sdial .trv .stat b{color:#fff}
    #sdial .trv .opts,#sdial .trv .foot{display:flex;gap:6px;margin-bottom:6px}
    #sdial .trv .foot{margin:6px 0 0;padding-top:6px;border-top:1px solid #2c2c2c}
    #sdial .trv button{flex:1;height:32px;border-radius:8px;border:1px solid #333;background:#242424;color:#cfcfcf;font-size:12px;padding:0 4px}
    #sdial .trv button:active{background:#2e2e2e}
    #sdial .trv .list{max-height:30vh;overflow-y:auto;touch-action:pan-y}
    #sdial .trv .cr{display:flex;align-items:center;min-height:34px;box-sizing:border-box;padding:6px 10px;border-radius:8px;margin-bottom:3px;background:#242424;border-left:3px solid var(--st,#5a5a5a)}
    #sdial .trv .cr:active{background:#2e2e2e}
    #sdial .trv .cr.sel{background:#2a3140}
    #sdial .trv .cr .nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #sdial .trv .cr .tm{color:#cfcfcf;font-size:12px;white-space:nowrap}
    #sdial .trv .cr .tm i{font-style:normal;color:#8a8a8a;margin-left:6px}
    #sdial .trv .dt{margin:0 0 6px;padding:8px 10px;border-radius:8px;background:#20242c;line-height:1.4}
    #sdial .trv .dt .sub{color:#8a8a8a;font-size:11px;margin-bottom:4px}
    #sdial .trv .go{width:100%;flex:none;margin-top:6px;height:30px;font-size:12px}
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
    #sdial .trv .skbox select{flex:1;min-width:0;height:32px;border-radius:8px;border:1px solid #333;background:#242424;color:#cfcfcf;font-size:12px;padding:0 6px}
    #sdial .trv .skbox .so{flex:0 0 auto;padding:0 10px}
    #sdial .trv .skbox .so.on{background:#2a3140;border-color:#4a8fd9;color:#fff}
    #sdial .trv .skbox .meta{color:#8a8a8a;font-size:11px;margin-bottom:5px;line-height:1.35}
    #sdial .trv .skl{max-height:52vh;overflow-y:auto;touch-action:pan-y}
    #sdial .trv .sk{padding:6px 10px;border-radius:8px;margin-bottom:3px;background:#242424;border-left:3px solid #555}
    #sdial .trv .sk.up{border-left-color:#4a8f4e}
    #sdial .trv .sk.dn{border-left-color:#e5534b}
    #sdial .trv .sk.out{opacity:.5}
    #sdial .trv .sk .l1{display:flex;align-items:center;gap:8px}
    #sdial .trv .sk .nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #sdial .trv .sk .pf{font-weight:600;white-space:nowrap;color:#8a8a8a}
    #sdial .trv .sk .pf.up{color:#7fd08a}
    #sdial .trv .sk .pf.dn{color:#f1807a}
    #sdial .trv .sk .l2{color:#8a8a8a;font-size:11px;margin-top:1px}
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

(function () {
  'use strict';
  window.SpeedDial.start({ apiKey: '###PDA-APIKEY###' }); // filled in by Torn PDA
})();
