// Speed Dial module: Item Dock v0.7.0
// Tap an item, confirm, and it is used in place. Own items show stock; faction armoury items do not.
// Long-press a row and drag to reorder. Nothing runs until the panel is opened.
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
  // adj = counts we know after a use, kept until the API catches up (it can lag a bit)
  // okCat = inventory categories that loaded fine (so "Out" is only trusted for those)
  const stock = { own: null, t: 0, warned: false, adj: {}, okCat: {} };

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

  async function ensureTypes() {
    if (S.items.every(i => i.type)) return;
    const j = await SD.api('https://api.torn.com/torn/?selections=items');
    S.items.forEach(i => { if (!i.type && j.items[i.id]) i.type = j.items[i.id].type; });
    save();
  }

  function applyAdj() {
    if (!stock.own) return;
    const now = Date.now();
    Object.keys(stock.adj).forEach(id => {
      const a = stock.adj[id];
      if (now - a.t > 120000 || (stock.own[id] || 0) <= a.n) delete stock.adj[id];
      else stock.own[id] = a.n;
    });
  }

  function bump(id, d) {
    if (!stock.own) return;
    const n = Math.max(0, (stock.own[id] || 0) + d);
    stock.own[id] = n;
    stock.adj[id] = { n, t: Date.now() };
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
      stock.own = Object.keys(merged).length ? merged : null;
      stock.okCat = stock.own ? okCat : {};
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
      if (ui) ui.after(() => loadStock(true), 2000);       // then confirm stock with the API
    } catch (e) {
      SD.toast('Failed: ' + e.message);
    }
    busy = false;
  }

  // ---------- add item (catalog fetched only when needed) ----------
  async function addItem() {
    if (!SD.hasKey) return alert('No API key available.');
    const q = (prompt('Item name (e.g. first aid, morphine, blood bag):') || '').trim().toLowerCase();
    if (!q) return;
    try {
      const j = await SD.api('https://api.torn.com/torn/?selections=items');
      const list = Object.entries(j.items)
        .map(([id, v]) => ({ id: +id, name: v.name, type: v.type }))
        .filter(i => i.name.toLowerCase().includes(q))
        .slice(0, 8);
      if (!list.length) return alert('No item found.');
      let pick = list[0];
      if (list.length > 1) {
        const n = parseInt(prompt(list.map((i, k) => (k + 1) + '. ' + i.name).join('\n') + '\n\nEnter a number:'), 10);
        if (!n || n < 1 || n > list.length) return;
        pick = list[n - 1];
      }
      const src = parseInt(prompt('Source for ' + pick.name + ':\n1. My items\n2. Faction armoury\n\nEnter a number:', '1'), 10);
      if (src !== 1 && src !== 2) return;
      const fac = src === 2;
      if (S.items.some(i => i.id === pick.id && !!i.fac === fac)) return alert('Already in your dock.');
      S.items.push({ id: pick.id, name: pick.name, type: pick.type, fac });
      save(); refresh();
    } catch (e) {
      alert('Could not load items: ' + e.message);
    }
  }

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
  `;

  function mount(ctx) {
    SD.css('sd-itemdock', CSS);
    const el = ctx.el;
    el.className = 'idock';
    el.innerHTML =
      '<div class="banner"></div><div class="cd"></div>' +
      '<div class="confirm"><div class="q"></div><div class="btns"><button class="no">Cancel</button><button class="ok">Use</button></div></div>' +
      '<div class="list"></div>' +
      '<div class="foot"><button class="add">Add</button><button class="edit">Edit</button><button class="sync">Sync</button></div>';
    const banner = el.querySelector('.banner');
    const cdEl = el.querySelector('.cd');
    const list = el.querySelector('.list');
    let pendingItem = null, drag = null, lp = null, lpTimer = null, noClick = false;

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
        row.innerHTML = '<span class="nm"></span><span class="qty"></span><button class="x" aria-label="Remove">\u00d7</button>';
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
          if (noClick) return;
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

    // ----- long-press + drag to reorder -----
    function bindDrag(row) {
      row.style.touchAction = 'none';
      row.addEventListener('pointerdown', e => {
        if (e.target.closest('button') || e.button > 0) return;
        clearTimeout(lpTimer);
        lp = { row, x: e.clientX, y: e.clientY, id: e.pointerId };
        lpTimer = setTimeout(() => startDrag(row), 400);
      });
      row.addEventListener('pointermove', e => {
        if (drag && drag.row === row) return moveDrag(e);
        if (lp && lp.row === row && Math.abs(e.clientX - lp.x) + Math.abs(e.clientY - lp.y) > 8) {
          clearTimeout(lpTimer); lp = null;
        }
      });
      row.addEventListener('pointerup', endDrag);
      row.addEventListener('pointercancel', endDrag);
    }

    function startDrag(row) {
      if (!lp || lp.row !== row) return;
      drag = { row, startY: lp.y };
      try { row.setPointerCapture(lp.id); } catch (e) {}
      row.classList.add('drag');
      try { if (navigator.vibrate) navigator.vibrate(15); } catch (e) {}
      lp = null;
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
      clearTimeout(lpTimer); lp = null;
      if (!drag) return;
      const order = Array.from(list.children).map(r => r._it).filter(Boolean);
      drag = null;
      if (order.length === S.items.length) { S.items = order; save(); }
      noClick = true;
      setTimeout(() => { noClick = false; }, 80);
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

    // ----- footer buttons -----
    el.querySelector('.add').addEventListener('click', addItem);
    el.querySelector('.sync').addEventListener('click', () => {
      SD.toast('Syncing...');
      loadStock(true);
      SD.data(true).then(() => { if (ctx.alive) status(); });
    });
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

    return { unmount() { clearTimeout(lpTimer); ui = null; } };
  }

  SD.register({
    id: 'itemdock',
    label: 'Item Dock',
    width: 200,
    // crossbody (messenger) bag
    icon: '<path d="M5.6 8h12.8l1.5 10.6a2 2 0 0 1-2 2.4H6.1a2 2 0 0 1-2-2.4L5.6 8z"/><path d="M8.5 8V7a3.5 3.5 0 0 1 7 0v1"/>',
    mount
  });
})();
