// Speed Dial module: Market v0.3.0
// Looks at what other players sell, straight from the official API. Four tools in one window:
//   - Price checker: Add (search) an item, then the tab Market shows its cheapest item market listings.
//   - Watchlist: the main view. Each item shows its lowest item market price; green = at or below the alert price you set.
//   - Margin: the lowest listing against Torn's market value and the shop prices (shop to market, market to shop). Before fees.
//   - Sell: a price for your own bazaar listing, a little under the lowest item market listing (Torn's API has no bazaar prices) (you choose how much). Copy puts the number on the clipboard.
// Nothing runs while the window is closed: no polling and no alerts in the background. Prices load when you open an item,
// when you tap Refresh (once every 30 seconds, with the countdown on the button like Targets) and, for watchlist items older than 2 minutes, when the window opens.
// Look and wording follow Targets and the Travel Helper Stocks box: prices are green (#7fd08a) like the Stocks profit, a loss is red,
// the bottom bar is Add | Edit | Refresh, the remove button is the red cross of Targets, header buttons are 36px like Stocks, toasts say "Updated".
(function () {
  'use strict';
  const SD = window.SpeedDial;
  if (!SD) return;

  const LS = 'speedDial.market1';   // { w: [{ id, name, th }], last: { id: { im } }, npc: { id: { mv, b, s } }, uc, rt }
  const MAX = 25;                   // most items on the watchlist (1 API call per item per refresh)
  const COOL = 30000;               // Refresh button cooldown (also the age under which an opened item is not loaded again)
  const AUTO = 120000;              // on open, watchlist items older than this are refreshed (silently)
  const BATCH = 4;                  // items refreshed in parallel
  const SHOW = 8;                   // listings shown per source
  const UC = 5;                     // default undercut for the Sell tab ($)

  const S = SD.read(LS, null) || {};
  if (!Array.isArray(S.w)) S.w = [];
  S.w = S.w.filter(w => w && typeof w.id === 'number' && w.name);
  if (!S.last || typeof S.last !== 'object') S.last = {};   // lowest listing per watched item: { im: { p, q, t } }
  if (!S.npc || typeof S.npc !== 'object') S.npc = {};      // shop numbers per watched item: { mv, b (shop price), s (shop pays) }
  if (typeof S.uc !== 'number' || !(S.uc >= 0)) S.uc = UC;
  delete S.sm;
  delete S.bz; delete S.bzna;                                // bazaar prices are gone from Torn's API (old saved data is dropped)
  Object.keys(S.last).forEach(k => { if (S.last[k]) delete S.last[k].bz; });
  if (typeof S.rt !== 'number') S.rt = 0;
  const save = () => SD.write(LS, S);

  const isW = id => S.w.some(w => w.id === id);
  const num = v => { const n = +v; return isFinite(n) ? n : 0; };
  const money = n => '$' + Math.round(n).toLocaleString('en-US');
  const srcName = () => 'Item market';
  // "850000", "850k", "1.2m", "$1,200,000" -> number; anything else -> null
  const parseMoney = s => {
    const m = /^\$?\s*(\d[\d,]*(?:\.\d+)?)\s*([kmb])?$/i.exec(String(s).trim());
    if (!m) return null;
    const n = parseFloat(m[1].replace(/,/g, '')) * ({ k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase()] || 1);
    return isFinite(n) ? Math.round(n) : null;
  };

  // ---------- API ----------
  // Item market v2 answers { itemmarket: { item: { average_price }, listings: [{ price, amount }] } }.
  // Bazaar prices are NOT available: Torn removed them from the API (v1 selections=bazaar now answers ok but empty, v2 market/{id}/bazaar only lists which bazaars specialise in an item).
  // Torn flags the v2 market as still changing, so the reader accepts a list under "listings", a plain list, or an object of listings.
  const isL = x => x && typeof x === 'object' && ('cost' in x || 'price' in x);
  function findList(node, depth) {      // first list of listings anywhere in the reply (an array, or an object of listings)
    if (!node || typeof node !== 'object' || depth > 3) return null;
    if (Array.isArray(node)) {
      if (node.some(isL)) return node;
      for (const v of node) { const r = findList(v, depth + 1); if (r) return r; }
      return null;
    }
    const vals = Object.values(node);
    if (vals.some(isL)) return vals.filter(isL);
    if (node.listings) { const r = findList(node.listings, depth + 1); if (r) return r; }
    for (const v of vals) { const r = findList(v, depth + 1); if (r) return r; }
    return null;
  }
  function parseListings(node) {
    return (findList(node, 0) || []).map(l => ({
      p: num(l.price != null ? l.price : l.cost),
      q: num(l.amount != null ? l.amount : (l.quantity != null ? l.quantity : 1))
    })).filter(l => l.p > 0).sort((a, b) => a.p - b.p);
  }
  // an empty node is a real "nobody sells it"; a node with content but no readable listings means the reply format changed
  const hasBody = node => !!node && typeof node === 'object' && (Array.isArray(node) ? node.length > 0 : Object.keys(node).some(k => k !== 'item'));

  async function fetchIM(id) {
    const j = await SD.api('https://api.torn.com/v2/market/' + id + '/itemmarket');
    const node = j && j.itemmarket;
    if (!node) throw new Error('item market reply not understood');
    return { l: parseListings(node), avg: node.item ? num(node.item.average_price) : 0, t: Date.now() };
  }

  // item list with shop prices (one call, kept in memory); Torn's buy_price is what the shop sells at, sell_price what it pays you
  let catalog = null, catById = null, catP = null;
  function loadCatalog() {
    if (catalog) return Promise.resolve(catalog);
    if (catP) return catP;
    catP = SD.api('https://api.torn.com/torn/?selections=items').then(j => {
      catalog = Object.entries(j.items || {}).map(([id, v]) => ({ id: +id, name: v.name, type: v.type, l: String(v.name).toLowerCase(), mv: num(v.market_value), b: num(v.buy_price), s: num(v.sell_price) }));
      catById = new Map(catalog.map(c => [c.id, c]));
      let ch = false;
      S.w.forEach(w => { const c = catById.get(w.id); if (c) { S.npc[w.id] = { mv: c.mv, b: c.b, s: c.s }; ch = true; } });
      if (ch) save();
      return catalog;
    }).finally(() => { catP = null; });
    return catP;
  }
  const npcOf = id => (catById && catById.get(id)) || S.npc[id] || null;

  // ---------- data ----------
  const mem = {};                   // id -> { im: { l, avg, t } } (listings of this page visit, not saved)
  let dirty = false, rbusy = false;

  function persist(id) {            // lowest listing of a watched item goes into the saved data
    const m = mem[id];
    if (!m || !isW(id)) return;
    const o = (S.last[id] = S.last[id] || {});
    if (m.im) o.im = { p: m.im.l[0] ? m.im.l[0].p : 0, q: m.im.l[0] ? m.im.l[0].q : 0, t: m.im.t };
    dirty = true;
  }
  const commit = () => { if (dirty) { dirty = false; save(); } };
  function record(id, kind, v) { (mem[id] = mem[id] || {})[kind] = v; persist(id); }

  function pickK(id, k) {
    const m = mem[id] && mem[id][k];
    if (m) return m.l[0] ? { p: m.l[0].p, q: m.l[0].q, t: m.t } : { p: 0, q: 0, t: m.t };
    const o = S.last[id] && S.last[id][k];
    return o ? { p: o.p || 0, q: o.q || 0, t: o.t || 0 } : null;
  }
  function lowOf(id) {
    const im = pickK(id, 'im');
    return { im, best: im && im.p > 0 ? { p: im.p, q: im.q, src: 'im' } : null };
  }
  const oldest = id => { const L = lowOf(id); return L.im ? L.im.t : 0; };
  const stale = id => oldest(id) < Date.now() - AUTO;

  // refresh items (both sources each). Returns { bad, first, errs: [{ id, kind, msg }] }
  async function refreshItems(ids) {
    const out = { bad: 0, first: null, errs: [] };
    if (!SD.hasKey) { SD.toast('No API key available'); return out; }
    let stop = false;
    for (let i = 0; i < ids.length && !stop; i += BATCH) {
      await Promise.all(ids.slice(i, i + BATCH).map(id => {
        const one = (kind, f) => f(id).then(v => record(id, kind, v), e => {
          out.bad++;
          out.first = out.first || e;
          out.errs.push({ id, kind, msg: (e && e.message) || 'error' });
          if (e && e.api && e.code === 5) stop = true;
          SD.log('market', srcName(kind) + ' ' + id + ' failed: ' + ((e && e.message) || e), 'w');
        });
        return one('im', fetchIM);
      }));
    }
    commit();
    SD.log('market', 'refreshed ' + ids.length + ' item(s), ' + out.bad + ' request(s) failed');
    return out;
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) { SD.log('market', 'clipboard API failed: ' + ((e && e.message) || e), 'w'); }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return !!ok;
    } catch (e) { SD.log('market', 'copy fallback failed: ' + ((e && e.message) || e), 'e'); return false; }
  }

  // ---------- panel (built only when opened) ----------
  const CSS = `
    #sdial .mk button:disabled{opacity:.4}
    #sdial .mk .mainv,#sdial .mk .srv,#sdial .mk .dtv{display:none}
    #sdial .mk:not(.searching):not(.detail) .mainv{display:block}
    #sdial .mk.searching .srv{display:block}
    #sdial .mk.detail .dtv{display:block}
    #sdial .mk .banner{display:none;margin-bottom:6px;padding:6px 10px;border-radius:8px;background:#1f3a22;border:1px solid #2f6b34;color:#b6e3bb;font-size:12px;line-height:1.35;text-align:center}
    #sdial .mk .banner.show{display:block}
    #sdial .mk .list{max-height:46vh;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;touch-action:pan-y}
    #sdial .mk .ir{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:8px;color:var(--sd-text);margin-bottom:3px;background:var(--sd-bg2);border-left:3px solid #555;user-select:none;-webkit-user-select:none}
    #sdial .mk .ir:active{background:var(--sd-hov)}
    #sdial .mk .ir.hit{border-left-color:#4a8f4e}
    #sdial .mk .ir.none{opacity:.5}
    #sdial .mk .ir .t{flex:1;min-width:0}
    #sdial .mk .ir .nm{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
    #sdial .mk .ir .sub{display:block;color:var(--sd-dim);font-size:11px;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #sdial .mk .ir .pr{flex:0 0 auto;font-size:12px;font-weight:600;white-space:nowrap;text-align:right;color:#7fd08a}
    #sdial .mk .ir.none .pr{color:var(--sd-dim)}
    #sdial .mk .ir .rm{display:none;flex:0 0 var(--sd-h);width:var(--sd-h);height:var(--sd-h);padding:0;color:var(--sd-redt)}
    #sdial .mk.edit .ir .rm{display:block}
    #sdial .mk .empty,#sdial .mk .hint{color:var(--sd-dim);padding:12px 6px;text-align:center;font-size:12px;line-height:1.4}
    #sdial .mk .stamp{color:var(--sd-dim);font-size:11px;margin-top:4px;line-height:1.35}
    #sdial .mk .foot{display:flex;gap:6px;margin-top:6px;padding-top:6px;border-top:1px solid #2c2c2c}
    #sdial .mk button{height:var(--sd-h);border-radius:8px;border:1px solid var(--sd-line);background:var(--sd-bg2);color:var(--sd-text2);font-size:12px;padding:0 10px}
    #sdial .mk button:active{background:var(--sd-hov)}
    #sdial .mk .foot .add,#sdial .mk .foot .edit{flex:1;padding:0 4px}
    #sdial .mk .foot .rf{flex:0 0 auto;min-width:52px;padding:0 8px;display:flex;align-items:center;justify-content:center;gap:4px}
    #sdial .mk .rf .rs{font-size:11px;text-align:left}
    #sdial .mk .rf .rs:empty{display:none}
    #sdial .mk .ah{display:flex;align-items:center;gap:8px;margin-bottom:6px;color:var(--sd-text);font-size:13px}
    #sdial .mk .ah .dn{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #sdial .mk .ah button{flex:0 0 36px;width:36px;padding:0;display:flex;align-items:center;justify-content:center}
    #sdial .mk .sq,#sdial .mk .fi{width:100%;height:var(--sd-hi);border-radius:8px;border:1px solid var(--sd-line2);background:var(--sd-bg2);color:var(--sd-text);font-size:16px;padding:0 10px;margin-bottom:6px;outline:none}
    #sdial .mk .sq:focus,#sdial .mk .fi:focus{border-color:var(--sd-blue)}
    #sdial .mk .seg{display:flex;gap:6px;margin-bottom:6px}
    #sdial .mk .seg button{flex:1;min-width:0;padding:0 2px}
    #sdial .mk .seg button.on{background:#2a3140;border-color:var(--sd-blue);color:#fff}
    #sdial .mk .res{max-height:44vh;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;touch-action:pan-y}
    #sdial .mk .res .r{display:flex;align-items:center;gap:8px;min-height:44px;padding:4px 10px;border-radius:8px;margin-bottom:3px;background:var(--sd-bg2);border-left:3px solid var(--sd-blue)}
    #sdial .mk .res .r:active{background:var(--sd-hov)}
    #sdial .mk .res .t{flex:1;min-width:0}
    #sdial .mk .res .nm{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #sdial .mk .res .ty{display:block;color:var(--sd-dim);font-size:11px}
    #sdial .mk .res .st{color:var(--sd-yel);font-size:14px}
    #sdial .mk .dc{max-height:46vh;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;touch-action:pan-y}
    #sdial .mk .dc .hd{display:flex;justify-content:space-between;color:var(--sd-dim);font-size:11px;margin-bottom:5px;line-height:1.35}
    #sdial .mk .dc .lr,#sdial .mk .dc .kv{display:flex;justify-content:space-between;gap:8px;padding:6px 10px;border-radius:8px;background:var(--sd-bg2);margin-bottom:3px;border-left:3px solid #555}
    #sdial .mk .dc .lr.lo{border-left-color:#4a8f4e}
    #sdial .mk .dc .lr .p,#sdial .mk .dc .kv .v.pr{font-weight:600;color:#7fd08a}
    #sdial .mk .dc .lr .q,#sdial .mk .dc .kv .k{color:var(--sd-dim)}
    #sdial .mk .dc .kv .v{text-align:right;font-weight:600}
    #sdial .mk .dc .kv .v.pos{color:#7fd08a}
    #sdial .mk .dc .kv .v.neg{color:var(--sd-redt)}
    #sdial .mk .dc .kv .v.pr.dm{color:var(--sd-dim)}
    #sdial .mk .dc .ur{display:flex;align-items:center;gap:8px;margin:2px 0 6px;color:var(--sd-text2);font-size:12px}
    #sdial .mk .dc .ur .fi{flex:1;margin:0}
    #sdial .mk .dc .sg{padding:8px 10px;border-radius:8px;background:var(--sd-bg2);border-left:3px solid #4a8f4e;text-align:center;margin-bottom:4px}
    #sdial .mk .dc .sg .k{color:var(--sd-dim);font-size:11px}
    #sdial .mk .dc .sg .v{font-size:18px;font-weight:600;color:#7fd08a;margin:2px 0 8px}
    #sdial .mk .dc .sg button{width:100%;background:var(--sd-bg)}
    #sdial .mk .wr{display:flex;gap:6px;margin-top:6px;padding-top:6px;border-top:1px solid #2c2c2c}
    #sdial .mk .wr button{flex:0 0 auto}
    #sdial .mk .wr button.on{border-color:var(--sd-yel);color:var(--sd-yel)}
    #sdial .mk .wr .fi{flex:1;min-width:0;height:var(--sd-h);margin:0;font-size:14px}
  `;

  function mount(ctx) {
    SD.css('sd-market', CSS);
    const el = ctx.el;
    el.className = 'mk';
    const backSvg = '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>';
    el.innerHTML =
      '<div class="mainv">' +
        '<div class="banner"></div><div class="list"></div><div class="stamp"></div>' +
        '<div class="foot"><button class="add">Add</button><button class="edit">Edit</button><button class="rf" aria-label="Refresh">' + SD.icons.refresh + '<span class="rs"></span></button></div>' +
      '</div>' +
      '<div class="srv">' +
        '<div class="ah"><button class="back" aria-label="Back">' + backSvg + '</button><span class="dn">Add item</span></div>' +
        '<input class="sq" type="text" placeholder="Item name" autocomplete="off" autocapitalize="off" spellcheck="false">' +
        '<div class="res"></div>' +
      '</div>' +
      '<div class="dtv">' +
        '<div class="ah"><button class="back" aria-label="Back">' + backSvg + '</button><span class="dn"></span><button class="ref" aria-label="Refresh">' + SD.icons.refresh + '</button></div>' +
        '<div class="seg"><button data-t="im" class="on">Market</button><button data-t="mg">Margin</button><button data-t="sl">Sell</button></div>' +
        '<div class="dc"></div>' +
        '<div class="wr"><button class="wt">\u2606 Watch</button><input class="fi th" type="text" inputmode="numeric" placeholder="Alert at or below $" autocomplete="off"></div>' +
      '</div>';
    const q = s => el.querySelector(s);
    const list = q('.list'), banner = q('.banner'), stamp = q('.stamp');
    const srv = q('.srv'), qIn = q('.sq'), res = q('.res');
    const dtv = q('.dtv'), dc = q('.dc'), wt = q('.wt'), thIn = q('.th'), rf = q('.rf'), rs = q('.rs');
    let cur = null;     // the item open in the detail view: { id, name, tab, from, loading, err, catTried }

    // ----- watchlist (main view) -----
    function fillList() {
      const keep = list.scrollTop;
      list.innerHTML = '';
      const hits = [];
      let latest = 0;
      if (!S.w.length) {
        list.innerHTML = '<div class="empty">Nothing watched yet.<br>Tap Add, open an item and tap Watch.</div>';
      }
      S.w.forEach(w => {
        const L = lowOf(w.id);
        const hit = !!(w.th > 0 && L.best && L.best.p <= w.th);
        if (hit) hits.push(w.name);
        latest = Math.max(latest, L.im ? L.im.t : 0);
        const row = document.createElement('div');
        row.className = 'ir' + (hit ? ' hit' : '') + (L.best ? '' : ' none');
        row.innerHTML = '<span class="t"><span class="nm"></span><span class="sub"></span></span><span class="pr"></span><button class="rm" aria-label="Remove">\u2715</button>';
        row.querySelector('.nm').textContent = w.name;
        let sub = L.best ? srcName(L.best.src) + (L.best.q > 1 ? ' \u00d7' + L.best.q : '') : (L.im ? 'No listings' : 'Not loaded yet');
        if (w.th > 0) sub += ' \u00b7 alert ' + money(w.th);
        row.querySelector('.sub').textContent = sub;
        row.querySelector('.pr').textContent = L.best ? money(L.best.p) : '\u2013';
        row.addEventListener('click', e => {
          if (e.target.closest('.rm')) {
            S.w = S.w.filter(x => x.id !== w.id);
            delete S.last[w.id]; delete S.npc[w.id];
            save();
            SD.log('market', 'removed ' + w.name + ' from the watchlist');
            fillList();
          } else if (!el.classList.contains('edit')) openDetail(w.id, w.name, 'main');
        });
        list.appendChild(row);
      });
      list.scrollTop = keep;
      if (hits.length) {
        banner.textContent = hits.length + ' at or below your price: ' + hits.slice(0, 3).join(', ') + (hits.length > 3 ? ' +' + (hits.length - 3) : '');
        banner.classList.add('show');
      } else banner.classList.remove('show');
      stamp.textContent = latest ? 'Updated ' + SD.hhmm(latest) : '';
    }

    // every second: Refresh button countdown (same as Targets)
    function tick() {
      const left = Math.ceil((COOL - (Date.now() - S.rt)) / 1000);
      rs.textContent = left > 0 ? left + 's' : '';
      rf.disabled = left > 0 || rbusy;
    }

    async function refreshWatch(manual) {
      if (rbusy) return;
      if (!SD.hasKey) return manual ? SD.toast('No API key available') : undefined;
      if (!S.w.length) return;
      if (manual) {
        const left = Math.ceil((COOL - (Date.now() - S.rt)) / 1000);
        if (left > 0) return SD.toast('Wait ' + left + 's');
        S.rt = Date.now();   // manual refresh starts the cooldown right away, so a double tap cannot send twice
        save();
      }
      const ids = manual ? S.w.map(w => w.id) : S.w.filter(w => stale(w.id)).map(w => w.id);
      if (!ids.length) return;
      rbusy = true;
      tick();
      let r;
      try { r = await refreshItems(ids); } finally { rbusy = false; }
      if (!ctx.alive) return;
      fillList();
      tick();
      if (r.bad) SD.toast('Updated, ' + r.bad + ' failed (' + ((r.first && r.first.message) || 'error') + ')');
      else if (manual) SD.toast('Updated');
    }

    // ----- search view -----
    function renderRes() {
      if (!catalog) return;
      const s = qIn.value.trim().toLowerCase();
      if (s.length < 2) { res.innerHTML = '<div class="hint">Type at least 2 letters</div>'; return; }
      const words = s.split(/\s+/);
      const hits = catalog.filter(c => words.every(w => c.l.indexOf(w) > -1))
        .sort((a, b) => (b.l.indexOf(s) === 0) - (a.l.indexOf(s) === 0) || a.l.localeCompare(b.l))
        .slice(0, 25);
      if (!hits.length) { res.innerHTML = '<div class="hint">No item found</div>'; return; }
      res.innerHTML = '';
      hits.forEach(c => {
        const r = document.createElement('div');
        r.className = 'r';
        r.innerHTML = '<span class="t"><span class="nm"></span><span class="ty"></span></span><span class="st"></span>';
        r.querySelector('.nm').textContent = c.name;
        r.querySelector('.ty').textContent = c.type || '';
        r.querySelector('.st').textContent = isW(c.id) ? '\u2605' : '';
        r.addEventListener('click', () => openDetail(c.id, c.name, 'search'));
        res.appendChild(r);
      });
    }

    async function openSearch() {
      if (!SD.hasKey) return SD.toast('No API key available');
      el.classList.add('searching');
      qIn.focus();
      if (!catalog) {
        res.innerHTML = '<div class="hint">Loading items...</div>';
        try { await loadCatalog(); }
        catch (e) {
          SD.log('market', 'item list failed: ' + ((e && e.message) || e), 'e');
          if (ctx.alive) res.innerHTML = '<div class="hint">Could not load items (' + SD.esc((e && e.message) || 'error') + ')</div>';
          return;
        }
      }
      if (ctx.alive) renderRes();
    }
    function closeSearch() { el.classList.remove('searching'); qIn.blur(); fillList(); }

    qIn.addEventListener('input', renderRes);
    srv.querySelector('.back').addEventListener('click', closeSearch);

    // ----- detail view -----
    function openDetail(id, name, from) {
      cur = { id, name, tab: 'im', from, loading: false, err: {}, catTried: false };
      el.classList.remove('searching');
      el.classList.add('detail');
      qIn.blur();
      dtv.querySelector('.dn').textContent = name;
      syncTabs();
      syncWatch();
      renderDetail();
      loadDetail(false);
      SD.log('market', 'open ' + name + ' (id ' + id + ')');
    }

    function closeDetail() {
      const from = cur && cur.from;
      cur = null;
      el.classList.remove('detail');
      if (from === 'search') { el.classList.add('searching'); renderRes(); } else fillList();
    }

    async function loadDetail(manual) {
      const c = cur;
      if (!c) return;
      const m = mem[c.id];
      if (m && m.im && Date.now() - m.im.t < COOL) {
        if (manual) SD.toast('Up to date (' + SD.hhmm(m.im.t) + ')');
        return;
      }
      c.loading = true;
      delete c.err.im;
      renderDetail();
      const r = await refreshItems([c.id]);
      if (!ctx.alive || cur !== c) return;
      c.loading = false;
      r.errs.forEach(e => { c.err[e.kind] = e.msg; });
      renderDetail();
      if (r.bad) SD.toast('Updated, ' + r.bad + ' failed (' + ((r.first && r.first.message) || 'error') + ')');
      else if (manual) SD.toast('Updated');
    }

    function syncTabs() {
      dtv.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.getAttribute('data-t') === cur.tab));
    }
    dtv.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
      if (!cur) return;
      cur.tab = b.getAttribute('data-t');
      syncTabs();
      renderDetail();
    }));
    dtv.querySelector('.back').addEventListener('click', closeDetail);
    dtv.querySelector('.ref').addEventListener('click', e => { SD.spin(e.currentTarget, loadDetail(true)); });

    function syncWatch() {
      const w = cur && S.w.find(x => x.id === cur.id);
      wt.textContent = w ? '\u2605 Watching' : '\u2606 Watch';
      wt.classList.toggle('on', !!w);
      thIn.style.display = w ? '' : 'none';
      thIn.value = w && w.th ? String(w.th) : '';
    }
    wt.addEventListener('click', () => {
      const c = cur;
      if (!c) return;
      if (isW(c.id)) {
        S.w = S.w.filter(x => x.id !== c.id);
        delete S.last[c.id]; delete S.npc[c.id];
        SD.log('market', 'unwatch ' + c.name);
      } else {
        if (S.w.length >= MAX) return SD.toast('Watchlist is full (' + MAX + ' items)');
        S.w.push({ id: c.id, name: c.name, th: 0 });
        const n = catById && catById.get(c.id);
        if (n) S.npc[c.id] = { mv: n.mv, b: n.b, s: n.s };
        persist(c.id);
        SD.log('market', 'watch ' + c.name);
      }
      dirty = false;
      save();
      syncWatch();
    });
    thIn.addEventListener('change', () => {
      const w = cur && S.w.find(x => x.id === cur.id);
      if (!w) return;
      const raw = thIn.value.trim();
      const v = raw === '' ? 0 : parseMoney(raw);
      if (v === null) { SD.toast('Use a number like 850000, 850k or 1.2m'); thIn.value = w.th ? String(w.th) : ''; return; }
      w.th = v;
      thIn.value = v ? String(v) : '';
      save();
      SD.toast(v ? 'Alert at or below ' + money(v) : 'Alert removed');
    });

    function renderDetail() {
      const c = cur;
      if (!c) return;
      dc.innerHTML = '';
      dc.appendChild(c.tab === 'mg' ? marginView(c) : c.tab === 'sl' ? sellView(c) : listView(c, c.tab));
    }

    function listView(c, kind) {
      const w = document.createElement('div');
      const d = mem[c.id] && mem[c.id][kind];
      if (!d) {
        w.innerHTML = '<div class="hint">' + (c.loading ? 'Loading...' : c.err[kind] ? 'Could not load (' + SD.esc(c.err[kind]) + ')' : 'No data yet. Tap refresh.') + '</div>';
        return w;
      }
      let h = '<div class="hd"><span>Cheapest listings' + (kind === 'im' && d.avg ? ' \u00b7 avg ' + money(d.avg) : '') + '</span><span>Updated ' + SD.hhmm(d.t) + '</span></div>';
      if (!d.l.length) h += '<div class="hint">' + 'No listings' + '</div>';
      d.l.slice(0, SHOW).forEach((x, i) => { h += '<div class="lr' + (i === 0 ? ' lo' : '') + '"><span class="p">' + money(x.p) + '</span><span class="q">\u00d7' + x.q.toLocaleString('en-US') + '</span></div>'; });
      if (d.l.length > SHOW) h += '<div class="hint">+' + (d.l.length - SHOW) + ' more</div>';
      w.innerHTML = h;
      return w;
    }

    function marginView(c) {
      const w = document.createElement('div');
      const npc = npcOf(c.id);
      if (!npc) {
        if (!c.catTried) {
          c.catTried = true;
          loadCatalog().then(() => { if (ctx.alive && cur === c && c.tab === 'mg') renderDetail(); })
            .catch(e => { SD.log('market', 'shop prices failed: ' + ((e && e.message) || e), 'e'); c.err.cat = (e && e.message) || 'error'; if (ctx.alive && cur === c && c.tab === 'mg') renderDetail(); });
          w.innerHTML = '<div class="hint">Loading shop prices...</div>';
        } else w.innerHTML = '<div class="hint">' + (c.err.cat ? 'Could not load shop prices (' + SD.esc(c.err.cat) + ')' : 'No shop prices for this item') + '</div>';
        return w;
      }
      const L = lowOf(c.id);
      const sg = n => (n >= 0 ? '+' : '\u2212') + money(Math.abs(n));
      const cls = n => (n >= 0 ? 'pos' : 'neg');
      const row = (k, v, cl) => '<div class="kv"><span class="k">' + k + '</span><span class="v' + (cl ? ' ' + cl : '') + '">' + v + '</span></div>';
      let h = row('Lowest listing', L.best ? money(L.best.p) + ' \u00b7 ' + srcName(L.best.src) : (c.loading ? 'Loading...' : 'none'), L.best ? 'pr' : 'pr dm');
      if (npc.mv > 0) {
        let t = money(npc.mv);
        if (L.best) { const p = (L.best.p - npc.mv) / npc.mv * 100; t += ' (' + (p >= 0 ? '+' : '\u2212') + Math.abs(p).toFixed(1) + '%)'; }
        h += row('Market value', t, 'pr');
      }
      if (npc.b > 0) h += row('Shop price', money(npc.b), 'pr');
      if (npc.s > 0) h += row('Shop pays', money(npc.s), 'pr');
      if (L.best && npc.b > 0) { const m = L.best.p - npc.b; h += row('Shop \u2192 market', sg(m) + ' (' + (m / npc.b * 100).toFixed(0) + '%)', cls(m)); }
      if (L.best && npc.s > 0) { const m = npc.s - L.best.p; h += row('Market \u2192 shop', sg(m) + ' (' + (m / L.best.p * 100).toFixed(0) + '%)', cls(m)); }
      if (!(npc.b > 0) && !(npc.s > 0)) h += '<div class="hint">Shops do not trade this item</div>';
      h += '<div class="hint">Before fees. Compared with the lowest listing.</div>';
      w.innerHTML = h;
      return w;
    }

    function sellView(c) {
      const w = document.createElement('div');
      const L = lowOf(c.id);
      const ref = L.best ? L.best.p : 0;
      const sug = ref > 0 ? Math.max(1, ref - S.uc) : 0;
      w.innerHTML =
        '<div class="ur"><span>Undercut by $</span><input class="fi uc" type="text" inputmode="numeric" autocomplete="off"></div>' +
        '<div class="sg"><div class="k">Suggested price</div><div class="v"></div><button class="cp">Copy</button></div>' +
        '<div class="hint"></div>';
      const uc = w.querySelector('.uc');
      uc.value = String(S.uc);
      uc.addEventListener('change', () => {
        const v = parseMoney(uc.value);
        if (v === null) { SD.toast('Use a number like 5 or 1k'); uc.value = String(S.uc); return; }
        S.uc = v;
        save();
        renderDetail();
      });
      w.querySelector('.v').textContent = sug ? money(sug) : '\u2013';
      const cp = w.querySelector('.cp');
      cp.disabled = !sug;
      cp.addEventListener('click', async () => {
        if (!sug) return;
        SD.toast((await copy(String(sug))) ? 'Copied ' + sug : 'Could not copy. Price: ' + sug);
      });
      w.querySelector('.hint').textContent = c.loading && !ref ? 'Loading...'
        : ref ? 'Lowest item market listing: ' + money(ref) + '. Your own listing counts too.'
        : 'No item market listings to compare with';
      return w;
    }

    // ----- footer -----
    q('.add').addEventListener('click', openSearch);
    q('.edit').addEventListener('click', e => { SD.editBtn(e.currentTarget, el.classList.toggle('edit')); });
    rf.addEventListener('click', () => { SD.spin(rf, refreshWatch(true)); });

    // ----- go -----
    fillList();
    tick();
    ctx.every(tick, 1000);
    refreshWatch(false);
    SD.log('market', 'opened: ' + S.w.length + ' watched item(s)');
    return { unmount() { cur = null; } };
  }

  SD.register({
    id: 'market',
    label: 'Market',
    width: 270,
    // price tag
    icon: '<path d="M12 2H2v10l9.29 9.29a2.4 2.4 0 0 0 3.42 0l6.58-6.58a2.4 2.4 0 0 0 0-3.42L12 2z"/><path d="M7 7h.01"/>',
    mount
  });
})();
