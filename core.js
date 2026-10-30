// Speed Dial core v0.1.0
// One floating circle. Tap it and one circle per module fans out. Tap a module circle to open its panel.
// A module only builds its UI, timers and API calls while its panel is open (lazy).
(function () {
  'use strict';
  if (window.SpeedDial) return;

  const SD = window.SpeedDial = { mods: [], key: '', hasKey: false, version: '0.1.0', started: false };
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
    #sdial .fab{position:relative;width:40px;height:40px;border-radius:50%;border:1px solid #3a3a3a;background:#1c1c1c;display:flex;align-items:center;justify-content:center;opacity:.85;box-shadow:0 2px 6px rgba(0,0,0,.4);padding:0}
    #sdial .fab.on{opacity:1;border-color:#5a5a5a}
    #sdial .fab.away{opacity:1;border-color:#4a8fd9;box-shadow:0 0 0 2px rgba(74,143,217,.3),0 2px 6px rgba(0,0,0,.4)}
    #sdial .fab.hosp{opacity:1;border-color:#d9a441;box-shadow:0 0 0 2px rgba(217,164,65,.3),0 2px 6px rgba(0,0,0,.4)}
    #sdial .fab.blk{opacity:1;border-color:#e5534b;box-shadow:0 0 0 2px rgba(229,83,75,.35),0 2px 6px rgba(0,0,0,.4)}
    #sdial .mod{position:absolute;left:2px;width:36px;height:36px;border-radius:50%;border:1px solid #3a3a3a;background:#1c1c1c;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.4);padding:0;opacity:0;transform:scale(.5);pointer-events:none;transition:opacity .12s,transform .12s}
    #sdial .stack.show .mod{opacity:1;transform:scale(1);pointer-events:auto}
    #sdial .mod.act{border-color:#4a8fd9}
    #sdial .mod:active{background:#2e2e2e}
    #sdial .lb{position:absolute;top:50%;left:40px;transform:translateY(-50%);white-space:nowrap;padding:3px 8px;border-radius:8px;background:#1c1c1c;border:1px solid #333;color:#e6e6e6;font-size:12px;pointer-events:none}
    #sdial.r .lb{left:auto;right:40px}
    #sdial.pnl .lb{display:none}
    #sdial .panel{position:absolute;display:none;background:#1c1c1c;border:1px solid #333;border-radius:12px;padding:6px;box-shadow:0 6px 18px rgba(0,0,0,.5);color:#e6e6e6}
    #sdial .panel.show{display:block}
  `;

  function ring() {
    if (!fab) return;
    const d = D;
    const m = SD.mode(d);
    const red = !!d && (d.state === 'Jail' || d.state === 'Federal' || (d.state === 'Hospital' && d.abroad));
    fab.classList.toggle('blk', red);
    fab.classList.toggle('hosp', !!d && d.state === 'Hospital' && !d.abroad);
    fab.classList.toggle('away', !red && (m === 'flying' || m === 'abroad'));
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
      sd: SD,
      get alive() { return cur === me; },
      every: (fn, ms) => { const id = setInterval(fn, ms); timers.push(['i', id]); return id; },
      after: (fn, ms) => { const id = setTimeout(fn, ms); timers.push(['t', id]); return id; },
      close: () => closeAll()
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
