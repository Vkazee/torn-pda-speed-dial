// ==UserScript==
// @name         Speed Dial (bundle)
// @namespace    speeddial
// @version      0.2.0
// @description  One floating circle for Torn PDA. Tap it to fan out your tools (Item Dock, Travel Helper). Each tool only runs while its panel is open.
// @match        https://www.torn.com/*
// @grant        none
// ==/UserScript==

// Speed Dial core v0.3.2
// One floating circle. Tap it and one circle per module fans out. Tap a module circle to open its panel.
// A module only builds its UI, timers and API calls while its panel is open (lazy).
(function () {
  'use strict';
  if (window.SpeedDial) return;

  const SD = window.SpeedDial = { mods: [], key: '', hasKey: false, started: false };
  const POS = 'speedDial.pos1';
  const DK = 'speedDial.data1';
  const TTL = 30000;
  const GAP = 46;

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
    if (!force && D && Date.now() - D.t < TTL) return Promise.resolve(D);
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
  // m = { id, label, icon (inner SVG markup, 24x24, stroke style), width, mount(ctx) -> { unmount() }? }
  SD.register = m => {
    SD.mods.push(m);
    if (stack) addCircle(m);
  };

  // ---------- hub UI ----------
  let root, fab, stack, panel, P, state = 'closed', cur = null, timers = [];
  const circles = [];

  const CSS = `
    #sdial{position:fixed;z-index:99998;font:13px/1.25 -apple-system,Roboto,sans-serif;touch-action:none;-webkit-tap-highlight-color:transparent}
    #sdial *{box-sizing:border-box}
    #sdial svg{width:20px;height:20px;stroke:#d0d0d0;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
    @keyframes sdspin{to{transform:rotate(360deg)}}
    #sdial .spin svg{animation:sdspin .8s linear infinite}
    #sdial .fab{position:relative;width:40px;height:40px;border-radius:50%;border:1px solid #3a3a3a;background:#1c1c1c;display:flex;align-items:center;justify-content:center;opacity:.85;box-shadow:0 2px 6px rgba(0,0,0,.4);padding:0}
    #sdial .fab.on{opacity:1;border-color:#5a5a5a}
    #sdial .fab.away{opacity:1;border-color:#4a8fd9;box-shadow:0 0 0 2px rgba(74,143,217,.3),0 2px 6px rgba(0,0,0,.4)}
    #sdial .fab.hosp{opacity:1;border-color:#d9a441;box-shadow:0 0 0 2px rgba(217,164,65,.3),0 2px 6px rgba(0,0,0,.4)}
    #sdial .fab.blk{opacity:1;border-color:#e5534b;box-shadow:0 0 0 2px rgba(229,83,75,.35),0 2px 6px rgba(0,0,0,.4)}
    #sdial .mod{position:absolute;left:2px;width:36px;height:36px;border-radius:50%;border:1px solid #3a3a3a;background:#1c1c1c;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.4);padding:0;opacity:0;transform:scale(.5);pointer-events:none;transition:opacity .12s,transform .12s}
    #sdial .stack.show .mod{opacity:1;transform:scale(1);pointer-events:auto}
    #sdial{--st:#5a5a5a}
    #sdial[data-st="away"]{--st:#4a8fd9}
    #sdial[data-st="hosp"]{--st:#d9a441}
    #sdial[data-st="blk"]{--st:#e5534b}
    #sdial .mod.act{border-color:var(--st)}
    #sdial .mod:active{background:#2e2e2e}
    #sdial .lb{position:absolute;top:50%;left:40px;transform:translateY(-50%);white-space:nowrap;padding:3px 8px;border-radius:8px;background:#1c1c1c;border:1px solid #333;color:#e6e6e6;font-size:12px;pointer-events:none}
    #sdial.r .lb{left:auto;right:40px}
    #sdial.pnl .lb{display:none}
    #sdial .panel{position:absolute;display:none;background:#1c1c1c;border:1px solid #5a5a5a;border-radius:12px;padding:6px;box-shadow:0 6px 18px rgba(0,0,0,.5);color:#e6e6e6}
    #sdial .panel.show{display:block}
    #sdial[data-st="away"] .panel{border-color:#4a8fd9;box-shadow:0 0 0 2px rgba(74,143,217,.3),0 6px 18px rgba(0,0,0,.5)}
    #sdial[data-st="hosp"] .panel{border-color:#d9a441;box-shadow:0 0 0 2px rgba(217,164,65,.3),0 6px 18px rgba(0,0,0,.5)}
    #sdial[data-st="blk"] .panel{border-color:#e5534b;box-shadow:0 0 0 2px rgba(229,83,75,.35),0 6px 18px rgba(0,0,0,.5)}
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
    root.dataset.st = red ? 'blk' : hosp ? 'hosp' : away ? 'away' : '';   // the panel outline follows the main circle
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
    panel.style.left = right ? 'auto' : '48px';
    panel.style.right = right ? '48px' : 'auto';
    panel.style.top = down ? '0' : 'auto';
    panel.style.bottom = down ? 'auto' : '0';
  }

  function addCircle(m) {
    const b = document.createElement('button');
    b.className = 'mod';
    b.setAttribute('aria-label', m.label);
    b.innerHTML = '<svg viewBox="0 0 24 24">' + m.icon + '</svg><span class="lb"></span>';
    b.querySelector('.lb').textContent = m.label;
    b.addEventListener('click', () => pick(m));
    stack.appendChild(b);
    circles.push({ m, b });
    layout();
  }

  function markActive(m) {
    circles.forEach(c => c.b.classList.toggle('act', c.m === m));
    root.classList.toggle('pnl', !!m);
  }

  // stop everything the open module started and throw its DOM away
  function unmount() {
    timers.forEach(t => (t[0] === 'i' ? clearInterval(t[1]) : clearTimeout(t[1])));
    timers = [];
    const inst = cur && cur.inst;
    cur = null;
    if (inst && typeof inst.unmount === 'function') { try { inst.unmount(); } catch (e) {} }
    panel.classList.remove('show');
    panel.innerHTML = '';
  }

  function mountMod(m) {
    unmount();
    panel.style.width = (m.width || 220) + 'px';
    const el = document.createElement('div');
    panel.appendChild(el);
    panel.classList.add('show');
    const me = { m, inst: null };
    cur = me;
    const ctx = {
      el,
      get alive() { return cur === me; },
      every: (fn, ms) => { const id = setInterval(fn, ms); timers.push(['i', id]); return id; },
      after: (fn, ms) => { const id = setTimeout(fn, ms); timers.push(['t', id]); return id; }
    };
    try { me.inst = m.mount(ctx) || null; } catch (e) { el.textContent = 'Error: ' + e.message; }
  }

  function showMenu(on) {
    stack.classList.toggle('show', on);
    fab.classList.toggle('on', on);
  }
  function closeAll() { unmount(); markActive(null); showMenu(false); state = 'closed'; }
  function openMenu() { layout(); showMenu(true); state = 'menu'; }
  function pick(m) {
    if (cur && cur.m === m) { unmount(); markActive(null); state = 'menu'; return; }
    layout();
    mountMod(m);
    markActive(m);
    state = 'panel';
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
      '<div class="stack"></div><div class="panel"></div>';
    document.body.appendChild(root);
    fab = root.querySelector('.fab');
    stack = root.querySelector('.stack');
    panel = root.querySelector('.panel');
    SD.mods.forEach(addCircle);
    layout();

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
      } else if (state === 'closed') openMenu(); else closeAll();
    });
    addEventListener('resize', layout);

    // one light status check per page load, only to colour the main circle
    SD.data(false);
  };
})();

// Speed Dial module: Item Dock v0.9.0
// Tap an item, confirm, and it is used in place. Own items show stock; faction armoury items do not.
// In Edit mode, drag the handle to reorder. Nothing runs until the panel is opened, except on
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
    #sdial .idock.blocked .list{opacity:.45}
    #sdial .idock .cd{display:none;flex-wrap:wrap;gap:4px;margin-bottom:6px}
    #sdial .idock .chip{padding:3px 7px;border-radius:6px;background:#242424;border:1px solid #333;color:#cfcfcf;font-size:11px}
    #sdial .idock .row{display:flex;align-items:center;height:40px;border-radius:8px;color:#e6e6e6;padding:0 10px;border-left:3px solid #4a8f4e;margin-bottom:3px;background:#242424;user-select:none;-webkit-user-select:none}
    #sdial .idock .row:active{background:#2e2e2e}
    #sdial .idock .row.out{border-left-color:#e5534b;cursor:not-allowed}
    #sdial .idock .row.out:active{background:#242424}
    #sdial .idock .row.low{border-left-color:#d9a441}
    #sdial .idock .row.low .qty{color:#d9a441}
    #sdial .idock .row.drag{position:relative;z-index:5;background:#383838;box-shadow:0 4px 12px rgba(0,0,0,.55);opacity:1!important}
    #sdial .idock .row .nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #sdial .idock .row .grip{display:none;align-items:center;justify-content:center;width:32px;height:40px;margin:0 2px 0 -8px;touch-action:none;cursor:grab}
    #sdial .idock .row .grip svg{width:18px;height:18px;stroke:#8a8a8a}
    #sdial .idock.edit .row .grip{display:flex}
    #sdial .idock .row.drag .grip svg{stroke:#e6e6e6}
    #sdial .idock .row .x{display:none;width:28px;height:28px;margin-right:-6px;border:0;background:none;color:#e5534b;font-size:18px;padding:0}
    #sdial .idock.edit .row .x{display:block}
    #sdial .idock .qty{margin-left:8px;color:#9a9a9a;font-size:12px;white-space:nowrap}
    #sdial .idock .row.out .qty{color:#e5534b}
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
      list.innerHTML = '';
      if (!S.items.length) {
        list.innerHTML = '<div class="empty">No items yet.<br>Tap Add.</div>';
        return;
      }
      S.items.forEach((it, idx) => {
        const row = document.createElement('div');
        row.className = 'row';
        row.innerHTML = '<span class=\"grip\" aria-label=\"Drag to reorder\"><svg viewBox=\"0 0 24 24\"><line x1=\"5\" y1=\"8\" x2=\"19\" y2=\"8\"/><line x1=\"5\" y1=\"12\" x2=\"19\" y2=\"12\"/><line x1=\"5\" y1=\"16\" x2=\"19\" y2=\"16\"/></svg></span><span class="nm"></span><span class="qty"></span><button class="x" aria-label="Remove">\u00d7</button>';
        const n = qtyOf(it);
        if (n !== null) {
          row.querySelector('.qty').textContent = n === 0 ? 'Out' : '\u00d7' + n;
          if (n === 0) { row.classList.add('out'); row.style.opacity = '.6'; }
          else if (n <= LOW) row.classList.add('low');
        }
        row.querySelector('.nm').textContent = it.name;
        if (it.fac) {
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
    }

    // ----- drag the grip handle (edit mode only) to reorder -----
    function bindDrag(row) {
      const grip = row.querySelector('.grip');
      grip.addEventListener('pointerdown', e => {
        if (e.button > 0 || !el.classList.contains('edit')) return;
        e.preventDefault();
        drag = { row, startY: e.clientY };
        try { grip.setPointerCapture(e.pointerId); } catch (err) {}
        row.classList.add('drag');
      });
      grip.addEventListener('pointermove', e => { if (drag && drag.row === row) moveDrag(e); });
      grip.addEventListener('pointerup', endDrag);
      grip.addEventListener('pointercancel', endDrag);
    }

    function moveDrag(e) {
      const row = drag.row;
      const h = row.offsetHeight + 3;
      let dy = e.clientY - drag.startY;
      while (dy > h / 2 && row.nextElementSibling) {
        list.insertBefore(row.nextElementSibling, row); drag.startY += h; dy -= h;
      }
      while (dy < -h / 2 && row.previousElementSibling) {
        list.insertBefore(row, row.previousElementSibling); drag.startY -= h; dy += h;
      }
      row.style.transform = 'translateY(' + dy + 'px)';
    }

    function endDrag() {
      if (!drag) return;
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
      banner.textContent = txt;
      banner.classList.add('show');
      banner.classList.toggle('blk', blk);
    }

    function renderCd() {
      const d = dd(), el2 = Math.floor((Date.now() - d.t) / 1000);
      const parts = [['Drug', 'drug'], ['Med', 'medical'], ['Boost', 'booster']].map(([l, k]) => {
        const s = ((d.cd || {})[k] || 0) - el2;
        return s > 0 ? '<span class="chip">' + l + ' ' + SD.durS(s) + '</span>' : '';
      }).join('');
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

// Speed Dial module: Travel Helper v0.5.1
// One-way and round-trip flight time, the time you will be back, and warnings when your status,
// bars or cooldowns clash with the trip. The Stocks box shows foreign shop stock with profit
// (YATA first, Prometheus as fallback). Tapping a country offers "Open travel agency": it opens Torn's travel page and
// tries to pick that country for you (you still press Travel yourself). Nothing runs until the panel is opened,
// except a tiny check on the travel page itself.
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
    const btn = el.querySelector('.skb'), box = el.querySelector('.skbox'), panelEl = el.parentNode;
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
      panelEl.style.width = on ? Math.min(300, window.innerWidth - 64) + 'px' : '230px';
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
    if (!w.length) w.push(['ok', 'No conflicts']);
    return w;
  }
  const warnHtml = w => w.map(x => '<div class="w ' + x[0] + '">' + SD.esc(x[1]) + '</div>').join('');

  // ---------- open the travel agency and pick the country ----------
  // Only navigates and selects. The real Travel / Continue buttons are never touched.
  const PEND = 'travelHelper.go'; // sessionStorage: { n, k, t }
  const onTravelPage = () => /[?&]sid=travel(&|$)/.test(location.href);
  let picking = false;

  function preselect() {
    if (picking) return;
    let p = null;
    try { p = JSON.parse(sessionStorage.getItem(PEND)); } catch (e) {}
    if (!p || Date.now() - p.t > 60000) { try { sessionStorage.removeItem(PEND); } catch (e) {} return; }
    picking = true;
    const names = p.k.concat([p.n.toLowerCase()]);
    const norm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const SKIP = /\b(travel|continue|back|cancel|confirm)\b/;
    // Torn names the map pin images after the country: mexico, cayman_islands, south_africa, uk ...
    const img = p.n === 'United Kingdom' ? 'uk' : p.n.toLowerCase().replace(/\s+/g, '_');
    const click = e => e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const find = () => {
      // 1) desktop layout: map pins whose background image carries the country name
      const pins = document.querySelectorAll('div[class*="pin___"]');
      for (let i = 0; i < pins.length; i++) {
        if ((pins[i].style.backgroundImage || '').toLowerCase().indexOf(img) > -1) return pins[i];
      }
      // 2) mobile layout: list buttons holding a span with the country name
      const spans = document.querySelectorAll('span[class*="country___"]');
      for (let i = 0; i < spans.length; i++) {
        if (norm(spans[i].textContent) === p.n.toLowerCase()) {
          const b = spans[i].closest('button');
          if (b) return b;
        }
      }
      // 3) fallback: any short button/link whose text is the country name
      const els = document.querySelectorAll('button, a, [role="button"]');
      for (let i = 0; i < els.length; i++) {
        const e = els[i];
        if (e.closest('#sdial')) continue;
        const t = norm(e.textContent);
        if (!t || t.length > 40 || SKIP.test(t)) continue;
        if (names.some(n => t === n || t.indexOf(n + ' ') === 0)) return e;
      }
      return null;
    };
    const t0 = Date.now();
    const iv = setInterval(() => {
      const e = find();
      if (e) {
        clearInterval(iv); picking = false;
        try { sessionStorage.removeItem(PEND); } catch (x) {}
        click(e);
        SD.toast(p.n + ' selected. Press Travel yourself.');
      } else if (Date.now() - t0 > 12000) {
        clearInterval(iv); picking = false;
        try { sessionStorage.removeItem(PEND); } catch (x) {}
        SD.toast("Couldn't find " + p.n + ' on the page. Pick it yourself.');
      }
    }, 400);
  }

  function goTravel(d) {
    try { sessionStorage.setItem(PEND, JSON.stringify({ n: d.n, k: d.k, t: Date.now() })); } catch (e) {}
    if (onTravelPage()) preselect();
    else location.href = '/page.php?sid=travel';
  }
  // arrived on the travel page with a destination waiting
  if (onTravelPage()) { try { if (sessionStorage.getItem(PEND)) setTimeout(preselect, 300); } catch (e) {} }

  const CSS = `
    #sdial .trv .stat{margin-bottom:6px;padding:6px 10px;border-radius:8px;background:#242424;line-height:1.4}
    #sdial .trv .stat b{color:#fff}
    #sdial .trv .opts,#sdial .trv .foot{display:flex;gap:6px;margin-bottom:6px}
    #sdial .trv .foot{margin:6px 0 0;padding-top:6px;border-top:1px solid #2c2c2c}
    #sdial .trv button{flex:1;height:32px;border-radius:8px;border:1px solid #333;background:#242424;color:#cfcfcf;font-size:12px;padding:0 4px}
    #sdial .trv button:active{background:#2e2e2e}
    #sdial .trv .list{max-height:30vh;overflow-y:auto;touch-action:pan-y}
    #sdial .trv .row{display:flex;align-items:center;height:34px;border-radius:8px;padding:0 10px;margin-bottom:3px;background:#242424;box-shadow:inset 3px 0 0 var(--st)}
    #sdial .trv .row:active{background:#2e2e2e}
    #sdial .trv .row.sel{background:#2a3140}
    #sdial .trv .row .nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #sdial .trv .row .tm{color:#cfcfcf;font-size:12px;white-space:nowrap}
    #sdial .trv .row .tm i{font-style:normal;color:#8a8a8a;margin-left:6px}
    #sdial .trv .dt{margin:0 0 6px;padding:8px 10px;border-radius:8px;background:#20242c;line-height:1.4}
    #sdial .trv .dt .sub{color:#8a8a8a;font-size:11px;margin-bottom:4px}
    #sdial .trv .go{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;flex:none;margin-top:10px;height:40px;border-radius:10px;border:1px solid #5aa2ea;background:#2f6fb5;color:#fff;font-size:13px;font-weight:600;box-shadow:0 2px 0 #1d4a7c,0 3px 6px rgba(0,0,0,.35)}
    #sdial .trv .go:active{background:#2a62a0;transform:translateY(1px);box-shadow:0 1px 0 #1d4a7c}
    #sdial .trv .go svg{width:16px;height:16px;stroke:#fff}
    #sdial .trv .go:disabled{opacity:.45;background:#2b2f36;border-color:#3a3a3a;box-shadow:none;color:#9a9a9a}
    #sdial .trv .w{margin-top:4px;padding:5px 8px;border-radius:6px;font-size:12px}
    #sdial .trv .w.ok{background:#1f3322;color:#a8d5ad}
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

  function mount(ctx) {
    SD.css('sd-travel', CSS);
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
      if (!SD.hasKey) { statEl.textContent = 'No API key available.'; return; }
      if (SD.error() && !D) { statEl.textContent = SD.error(); return; }
      if (!D) { statEl.textContent = 'Loading...'; return; }
      const m = mode(), e = elapsed(), now = Date.now();
      if (m === 'home') {
        statEl.innerHTML = 'In Torn \u00b7 <b>' + SD.esc(D.state) + '</b>';
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
        statEl.innerHTML = html + warnHtml(warns(secs, false));
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
      statEl.innerHTML = html + warnHtml(warns(secs, false));
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
      x.innerHTML = detailHtml(DEST[sel]);
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
        row.className = 'row' + (i === sel ? ' sel' : '');
        const one = oneWay(d) * 60, rt = one * 2 + S.stay * 60;
        row.innerHTML = '<span class="nm">' + SD.esc(d.n) + '</span><span class="tm">' + SD.dur(one) + '<i>\u21c4 ' + SD.dur(rt) + '</i></span>';
        row.addEventListener('click', () => { sel = (sel === i ? -1 : i); renderList(); });
        list.appendChild(row);
        if (i === sel) {
          const box = document.createElement('div');
          box.className = 'dt';
          box.innerHTML = '<div class="dtx">' + detailHtml(d) + '</div><button class="go"><svg viewBox="0 0 24 24"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg><span>Go to ' + SD.esc(d.n) + '</span></button>';
          box.querySelector('.go').addEventListener('click', () => goTravel(d));
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
