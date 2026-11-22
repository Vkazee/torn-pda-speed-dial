// Speed Dial feature: Dashboard v0.1.0
// A multi-column page for your tools. It opens at  <any torn.com page>#sd-dashboard  and sits on top of the Torn page.
//   - Open it from Show More (tile "Dashboard"), from a Shortcut that points to  #sd-dashboard , or by opening that address.
//   - The back button of the phone (or the arrow in the page header) closes it and brings you back to the Torn page you were on.
//   - Every panel is one of your modules (Targets, Quick Notes, Daily Checklist, ...), built the same way as in its floating window.
//   - Edit: move a panel up or down, remove it, or add one from the list. Cols: Auto / 1 / 2 / 3 columns.
// On by default (it only exists as a tile until you open it). Nothing runs while the page is closed except two page-change listeners.
// A panel only runs while the Dashboard is open: closing it stops every panel's timers, like closing a window.
// Saved under speedDial.dashboard1 = { panels: [module ids], cols: 'auto' | 1 | 2 | 3 }.
(function () {
  'use strict';
  const SD = window.SpeedDial;
  if (!SD) return;

  const HASH = '#sd-dashboard';        // the page name in the address (English on purpose)
  const KEY = 'speedDial.dashboard1';
  const ENTRY = 'dashboard';           // id of the Show More tile
  const HOME = ['targets', 'notes', 'daily', 'travel'];   // panels until you choose your own
  const COLS = ['auto', 1, 2, 3];

  const CSS = `
    #sdial .sdash{position:fixed;left:0;top:0;right:0;bottom:0;z-index:0;display:flex;flex-direction:column;background:#121212;color:var(--sd-text)}
    #sdial .sdash .sdash-hd{flex:0 0 46px;display:flex;align-items:center;gap:6px;padding:0 8px;background:var(--sd-bg);border-bottom:1px solid var(--sd-line)}
    #sdial .sdash .sdash-hd .sdash-tt{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:600;color:var(--sd-text)}
    #sdial .sdash .sdash-hd button{flex:0 0 auto;height:var(--sd-h);border-radius:8px;border:1px solid var(--sd-line);background:var(--sd-bg2);color:var(--sd-text2);font-size:12px;padding:0 10px;touch-action:manipulation}
    #sdial .sdash .sdash-hd button:active{background:var(--sd-hov)}
    #sdial .sdash .sdash-hd .sdash-bk{width:var(--sd-h);padding:0;font-size:16px}
    #sdial .sdash .sdash-bd{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;touch-action:pan-y;padding:8px 8px 76px}
    #sdial .sdash .sdash-gr{display:grid;gap:8px;align-items:start}
    #sdial .sdash .sdash-pn{min-width:0;border:1px solid var(--sd-line);border-radius:12px;background:var(--sd-bg);overflow:hidden;color:var(--sd-text)}
    #sdial .sdash .sdash-pt{display:flex;align-items:center;height:var(--sd-h);padding:0 4px 0 10px;background:var(--sd-bg2);border-bottom:1px solid #2c2c2c}
    #sdial .sdash .sdash-pt .sdash-pl{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--sd-text2)}
    #sdial .sdash .sdash-pt .sdash-pc{display:none;gap:4px}
    #sdial .sdash.sdash-on .sdash-pt .sdash-pc{display:flex}
    #sdial .sdash .sdash-pt .sdash-pc button{width:32px;height:28px;border-radius:6px;border:1px solid var(--sd-line);background:var(--sd-bg);color:var(--sd-text2);font-size:11px;padding:0;touch-action:manipulation}
    #sdial .sdash .sdash-pt .sdash-pc button:active{background:var(--sd-hov)}
    #sdial .sdash .sdash-pt .sdash-pc .sdash-rm{color:var(--sd-redt)}
    #sdial .sdash .sdash-pb{padding:6px;overflow-x:auto;overflow-y:hidden}
    #sdial .sdash .sdash-em{padding:22px 10px;text-align:center;color:var(--sd-dim);font-size:12px;line-height:1.45}
    #sdial .sdash .sdash-ad{display:none;margin-top:12px;padding-top:10px;border-top:1px solid #2c2c2c}
    #sdial .sdash.sdash-on .sdash-ad{display:block}
    #sdial .sdash .sdash-ad .sdash-ah{color:var(--sd-dim);font-size:11px;margin-bottom:6px}
    #sdial .sdash .sdash-ad .sdash-al{display:flex;flex-wrap:wrap;gap:6px}
    #sdial .sdash .sdash-ad .sdash-al button{display:flex;align-items:center;gap:6px;height:var(--sd-h);border-radius:8px;border:1px solid var(--sd-line);background:var(--sd-bg2);color:var(--sd-text2);font-size:12px;padding:0 10px;touch-action:manipulation}
    #sdial .sdash .sdash-ad .sdash-al button:active{background:var(--sd-hov)}
    #sdial .sdash .sdash-ad .sdash-al button svg{width:16px;height:16px}
  `;

  const ICON = '<rect x="3.5" y="3.5" width="7" height="9" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="5" rx="1.6"/><rect x="3.5" y="15.5" width="7" height="5" rx="1.6"/><rect x="13.5" y="11.5" width="7" height="9" rx="1.6"/>';

  // modules that can be a panel: real windows only (no shortcuts, no pinned Show More / Settings, not this tile itself)
  const mod = id => SD.mods.find(m => m.id === id && !m.href && !m.pinned && m.id !== ENTRY && typeof m.mount === 'function');

  function start(ctx) {
    ctx.css(CSS);

    const v = SD.read(KEY, null);
    const cfg = {
      panels: v && Array.isArray(v.panels) ? v.panels.filter(x => typeof x === 'string') : null,   // null = never chosen: HOME is used
      cols: v && COLS.indexOf(v.cols) > -1 ? v.cols : 'auto'
    };
    const save = () => SD.write(KEY, { panels: cfg.panels || [], cols: cfg.cols });

    let page = null;        // { el, grid, em, add, colBtn, edBtn, panels: Map(id -> { el, stop() }), html }
    let viaPush = false;    // the address was set by us (so the back button is the way out)

    // ---------- one panel = one module, mounted like in its floating window ----------
    function addPanel(id) {
      const m = mod(id);
      if (!m || page.panels.has(id)) return;
      SD.close(id);   // never the same module as a window and as a panel at once
      const el = document.createElement('div');
      el.className = 'sdash-pn';
      el.dataset.id = id;
      el.innerHTML = '<div class="sdash-pt"><span class="sdash-pl"></span><span class="sdash-pc">' +
        '<button class="sdash-up" aria-label="Move up">\u25B2</button><button class="sdash-dn" aria-label="Move down">\u25BC</button><button class="sdash-rm" aria-label="Remove">\u2715</button>' +
        '</span></div><div class="sdash-pb"><div></div></div>';
      el.querySelector('.sdash-pl').textContent = m.label;
      const inner = el.querySelector('.sdash-pb').firstChild;   // modules replace className of their element, so they get a bare div of their own
      page.grid.appendChild(el);

      const timers = [];
      let alive = true, inst = null;
      const pctx = {
        el: inner,
        arg: undefined,
        get alive() { return alive; },
        every: (fn, ms) => { if (!alive) return 0; const t = setInterval(fn, ms); timers.push(['i', t]); return t; },
        after: (fn, ms) => { if (!alive) return 0; const t = setTimeout(fn, ms); timers.push(['t', t]); return t; },
        setWidth: () => {},   // the grid decides the width
        close: () => setTimeout(() => removePanel(id), 0)
      };
      SD.log('dash', 'panel open ' + id);
      try { inst = m.mount(pctx) || null; }
      catch (e) { inner.textContent = 'Error: ' + e.message; SD.log('dash', id + ' mount() threw: ' + e.message + (e.stack ? ' | ' + String(e.stack).split('\n').slice(1, 3).join(' | ') : ''), 'e'); }
      page.panels.set(id, {
        el,
        stop() {
          alive = false;
          timers.forEach(t => (t[0] === 'i' ? clearInterval(t[1]) : clearTimeout(t[1])));
          timers.length = 0;
          const i = inst;
          inst = null;
          if (i && typeof i.unmount === 'function') { try { i.unmount(); } catch (e) { SD.log('dash', id + ' unmount() threw: ' + e.message, 'e'); } }
        }
      });
    }

    function removePanel(id) {
      if (!page) return;
      const p = page.panels.get(id);
      if (!p) return;
      p.stop();
      p.el.remove();
      page.panels.delete(id);
      SD.log('dash', 'panel removed ' + id);
    }

    // the saved order follows the screen; ids of modules that are not loaded right now are kept as they were
    function keepOrder() {
      const ids = Array.from(page.grid.children).map(x => x.dataset.id);
      cfg.panels = ids.concat((cfg.panels || []).filter(i => ids.indexOf(i) < 0));
      save();
    }

    function refreshView() {
      page.em.style.display = page.panels.size ? 'none' : '';
      const avail = SD.mods.filter(m => mod(m.id) && !page.panels.has(m.id));
      const al = page.add.querySelector('.sdash-al');
      al.innerHTML = '';
      avail.forEach(m => {
        const b = document.createElement('button');
        b.dataset.id = m.id;
        const ic = document.createElement('span');
        ic.style.cssText = 'display:inline-flex;align-items:center';
        if (m.emoji) ic.textContent = m.emoji; else ic.innerHTML = '<svg viewBox="0 0 24 24">' + m.icon + '</svg>';
        const tx = document.createElement('span');
        tx.textContent = m.label;
        b.appendChild(ic);
        b.appendChild(tx);
        al.appendChild(b);
      });
      page.add.style.display = avail.length ? '' : 'none';
    }

    function applyCols() {
      const c = cfg.cols;
      page.grid.style.gridTemplateColumns = c === 'auto' ? 'repeat(auto-fill,minmax(240px,1fr))' : 'repeat(' + c + ',minmax(0,1fr))';
      page.colBtn.textContent = 'Cols: ' + (c === 'auto' ? 'Auto' : c);
    }

    // ---------- the page ----------
    function openPage() {
      if (page) return;
      const root = document.getElementById('sdial');
      if (!root) { SD.log('dash', 'cannot open: the Speed Dial element is not in the page', 'w'); return; }
      const el = document.createElement('div');
      el.className = 'sdash';
      el.innerHTML =
        '<div class="sdash-hd"><button class="sdash-bk" aria-label="Back">\u2190</button><span class="sdash-tt">Dashboard</span><button class="sdash-co"></button><button class="sdash-ed"></button></div>' +
        '<div class="sdash-bd"><div class="sdash-em">No panels yet. Tap Edit, then add one.</div><div class="sdash-gr"></div>' +
        '<div class="sdash-ad"><div class="sdash-ah">Add panel</div><div class="sdash-al"></div></div></div>';
      root.insertBefore(el, root.firstChild);   // below the circles and the floating windows
      page = {
        el,
        grid: el.querySelector('.sdash-gr'),
        em: el.querySelector('.sdash-em'),
        add: el.querySelector('.sdash-ad'),
        colBtn: el.querySelector('.sdash-co'),
        edBtn: el.querySelector('.sdash-ed'),
        panels: new Map(),
        html: document.documentElement.style.overflow
      };
      document.documentElement.style.overflow = 'hidden';   // the Torn page behind must not scroll
      SD.editBtn(page.edBtn, false);
      applyCols();

      el.querySelector('.sdash-bk').addEventListener('click', leave);
      page.colBtn.addEventListener('click', () => {
        cfg.cols = COLS[(COLS.indexOf(cfg.cols) + 1) % COLS.length];
        applyCols();
        save();
      });
      page.edBtn.addEventListener('click', () => {
        const on = !el.classList.contains('sdash-on');
        el.classList.toggle('sdash-on', on);
        SD.editBtn(page.edBtn, on);
      });
      // move / remove: only the buttons in the panel's own title bar (the module's buttons are never touched)
      page.grid.addEventListener('click', e => {
        const b = e.target.closest ? e.target.closest('.sdash-pc button') : null;
        const pn = b && b.closest('.sdash-pn');
        if (!b || !pn || pn.parentNode !== page.grid) return;
        if (b.classList.contains('sdash-rm')) { removePanel(pn.dataset.id); keepOrder(); refreshView(); return; }
        if (b.classList.contains('sdash-up')) { const p = pn.previousElementSibling; if (p) page.grid.insertBefore(pn, p); }
        if (b.classList.contains('sdash-dn')) { const n = pn.nextElementSibling; if (n) page.grid.insertBefore(n, pn); }
        keepOrder();
      });
      page.add.addEventListener('click', e => {
        const b = e.target.closest ? e.target.closest('button') : null;
        if (!b || !b.dataset.id) return;
        addPanel(b.dataset.id);
        keepOrder();
        refreshView();
      });

      (cfg.panels || HOME).forEach(addPanel);
      refreshView();
      SD.log('dash', 'page open: ' + page.panels.size + ' panel(s), cols ' + cfg.cols);
    }

    function closePage() {
      if (!page) return;
      const p = page;
      p.panels.forEach(x => x.stop());
      p.panels.clear();
      p.el.remove();
      document.documentElement.style.overflow = p.html || '';
      page = null;
      viaPush = false;
      SD.log('dash', 'page closed');
    }

    // ---------- the address decides: #sd-dashboard = page open ----------
    function sync() {
      const want = location.hash === HASH;
      if (want && !page) openPage();
      else if (!want && page) closePage();
    }
    function strip() {
      try { history.replaceState(history.state, '', location.pathname + location.search); } catch (e) { SD.log('dash', 'could not clear the address: ' + e.message, 'w'); }
      sync();
    }
    function go() {
      if (location.hash !== HASH) {
        try { history.pushState({ sdDash: 1 }, '', location.pathname + location.search + HASH); viaPush = true; }   // no reload; Torn's own page code sees no event
        catch (e) { location.hash = HASH; return; }                                                            // hashchange opens it
      }
      sync();
    }
    function leave() {
      if (viaPush && history.state && history.state.sdDash) {
        history.back();   // popstate closes the page and returns to the Torn page as it was
        ctx.after(() => { if (location.hash === HASH) strip(); }, 400);
      } else strip();
    }
    ctx.on(window, 'hashchange', sync);
    ctx.on(window, 'popstate', sync);

    if (!SD.mods.some(m => m.id === ENTRY)) {
      SD.register({
        id: ENTRY,
        label: 'Dashboard',
        width: 200,
        ord: 100,
        icon: ICON,
        mount(c) { go(); c.close(); return null; }   // no window of its own: opens the page and steps aside
      });
    }
    sync();   // opened from an address that already has #sd-dashboard

    return {
      stop() {
        closePage();
        if (location.hash === HASH) strip();
        SD.unregister(ENTRY);
      }
    };
  }

  SD.feature({
    id: 'dashboard',
    label: 'Dashboard',
    group: 'Pages',
    where: 'Any page, address ends with #sd-dashboard',
    info: 'A multi-column page of your tools. Open it from the Dashboard tile in Show More.',
    def: true,
    start
  });
})();
