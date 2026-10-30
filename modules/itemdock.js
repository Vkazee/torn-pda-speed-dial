// Speed Dial module: Item Dock v0.9.3
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
