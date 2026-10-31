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
