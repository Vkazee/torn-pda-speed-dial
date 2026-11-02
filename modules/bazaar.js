// Speed Dial module: Bazaar v0.1.0
// Your own bazaar at a glance. Top: a summary (items, pieces, total value at your prices vs market value, how many are too cheap / too high).
// Below: every listed item with your price compared to Torn's market value (green = fair, red = cheap, yellow = high, grey = no market value).
// Tap a row for details. Bottom bar: Manage | Add | Style (open the Torn bazaar pages) and Refresh (once every 30 seconds).
// Needs an API key that is allowed to read your bazaar. Nothing runs while the window is closed; nothing is saved (everything is re-fetched).
(function () {
  'use strict';
  const SD = window.SpeedDial;
  if (!SD) return;

  const CHEAP = 0.90;      // price below 90% of market value = too cheap (red)
  const HIGH = 1.10;       // price above 110% of market value = high, may not sell (yellow)
  const COOL = 30000;      // minimum age (ms) before a refresh asks the API again
  const GREEN = '#7fd08a', YELLOW = '#d9a441', RED = '#f1807a', GREY = '#8a8a8a';

  const URLS = ['https://api.torn.com/v2/user/bazaar', 'https://api.torn.com/user/?selections=bazaar'];
  const ID_KEYS = ['ID', 'id', 'item_id', 'itemID'];
  const QTY_KEYS = ['quantity', 'amount', 'qty'];
  const PRICE_KEYS = ['price', 'cost'];
  const MV_KEYS = ['market_price', 'market_value', 'marketPrice', 'marketValue'];

  let cache = null;        // { t, rows, open } kept in memory only
  let catalog = null;      // item id -> market value (one API call, only when the bazaar answer lacks it)

  const num = v => { const n = typeof v === 'string' ? Number(v.replace(/[, $]/g, '')) : v; return typeof n === 'number' && isFinite(n) ? n : null; };
  const pick = (o, keys) => { for (const k of keys) { const n = num(o[k]); if (n != null) return n; } return null; };
  const money = n => '$' + Math.round(n).toLocaleString('en-US');
  const short = n => {
    const a = Math.abs(n);
    if (a >= 1e9) return '$' + +(n / 1e9).toFixed(2) + 'b';
    if (a >= 1e6) return '$' + +(n / 1e6).toFixed(2) + 'm';
    if (a >= 1e4) return '$' + +(n / 1e3).toFixed(1) + 'k';
    return money(n);
  };

  // finds every { id, quantity, price } object, whatever the API wraps it in
  function collect(node, out) {
    if (Array.isArray(node)) { node.forEach(n => collect(n, out)); return out; }
    if (!node || typeof node !== 'object') return out;
    const q = pick(node, QTY_KEYS), p = pick(node, PRICE_KEYS);
    const item = node.item && typeof node.item === 'object' ? node.item : null;
    const id = pick(node, ID_KEYS) != null ? pick(node, ID_KEYS) : (item ? pick(item, ID_KEYS) : null);
    if (q != null && p != null && id != null) {
      const mv = pick(node, MV_KEYS) != null ? pick(node, MV_KEYS) : (item ? pick(item, MV_KEYS) : null);
      out.push({ id, name: String(node.name || (item && item.name) || ('Item ' + id)), qty: q, price: p, mv: mv && mv > 0 ? mv : null });
    } else Object.values(node).forEach(v => collect(v, out));
    return out;
  }

  // open / closed, only when the API says so
  function findOpen(j) {
    const look = o => {
      if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
      for (const k of ['is_open', 'isOpen', 'open']) if (typeof o[k] === 'boolean') return o[k];
      if (typeof o.closed === 'boolean') return !o.closed;
      return null;
    };
    const a = look(j);
    return a != null ? a : look(j && j.bazaar);
  }

  async function loadCatalog() {
    if (catalog) return catalog;
    const j = await SD.api('https://api.torn.com/torn/?selections=items');
    catalog = {};
    Object.entries(j.items || {}).forEach(([id, v]) => { const m = num(v.market_value); if (m) catalog[id] = m; });
    return catalog;
  }

  async function fetchBazaar() {
    let j = null, firstErr = null;
    for (const u of URLS) {
      try { j = await SD.api(u); if (collect(j, []).length || findOpen(j) != null || u === URLS[URLS.length - 1]) break; }
      catch (e) { if (!firstErr) firstErr = e; j = null; }
    }
    if (!j) throw firstErr || new Error('No answer from the API');
    const rows = collect(j, []);
    if (rows.some(r => !r.mv)) {
      try { const c = await loadCatalog(); rows.forEach(r => { if (!r.mv && c[r.id]) r.mv = c[r.id]; }); } catch (e) { /* rows without a market value stay grey */ }
    }
    rows.forEach(r => {
      r.total = r.qty * r.price;
      r.ratio = r.mv ? r.price / r.mv : null;
      r.lvl = r.ratio == null ? 2 : r.ratio < CHEAP ? 0 : r.ratio > HIGH ? 1 : 3;   // 0 cheap, 1 high, 2 unknown, 3 fair
    });
    // problems first (cheap, then high), then unknown, then fair; biggest total first inside each group
    rows.sort((a, b) => (a.lvl - b.lvl) || (b.total - a.total));
    return { t: Date.now(), rows, open: findOpen(j) };
  }

  const LVL = [{ c: RED, w: 'Cheap' }, { c: YELLOW, w: 'High' }, { c: GREY, w: 'No MV' }, { c: GREEN, w: 'Fair' }];
  const pct = r => (r >= 1 ? '+' : '') + ((r - 1) * 100).toFixed(1).replace(/\.0$/, '') + '%';

  const CSS = `
    #sdial .bz button,#sdial .bz .lk{height:32px;border-radius:8px;border:1px solid #333;background:#242424;color:#cfcfcf;font-size:12px;padding:0 8px;text-decoration:none;display:flex;align-items:center;justify-content:center}
    #sdial .bz button:active,#sdial .bz .lk:active{background:#2e2e2e}
    #sdial .bz .sum{margin-bottom:6px;padding:6px 8px;border-radius:8px;background:#242424;border-left:3px solid #4a8fd9;font-size:12px;line-height:1.5;color:#cfcfcf}
    #sdial .bz .sum b{color:#e6e6e6}
    #sdial .bz .sum .o{float:right;font-weight:600}
    #sdial .bz .sum .o.on{color:#7fd08a}
    #sdial .bz .sum .o.off{color:#f1807a}
    #sdial .bz .sum .bad{color:#f1807a}
    #sdial .bz .sum .hi{color:#d9a441}
    #sdial .bz .lst{max-height:46vh;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;touch-action:pan-y}
    #sdial .bz .em{padding:14px 6px;text-align:center;color:#8a8a8a;font-size:12px;line-height:1.4}
    #sdial .bz .em.err{color:#f1807a}
    #sdial .bz .r{margin-bottom:3px;padding:5px 8px;border-radius:8px;background:#242424;border-left:3px solid var(--c,#5a5a5a)}
    #sdial .bz .r:active{background:#2e2e2e}
    #sdial .bz .r1{display:flex;align-items:center;gap:8px}
    #sdial .bz .who{flex:1;min-width:0}
    #sdial .bz .nm{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e6e6e6;font-size:13px}
    #sdial .bz .id{display:block;color:#8a8a8a;font-size:11px;margin-top:1px}
    #sdial .bz .sx{flex:0 0 auto;text-align:right}
    #sdial .bz .sl{display:block;font-weight:600;font-size:12px;color:var(--c)}
    #sdial .bz .cd{display:block;color:#9a9a9a;font-size:11px;margin-top:1px}
    #sdial .bz .dt{display:none;margin-top:4px;padding-top:4px;border-top:1px solid #2f2f2f;color:#9a9a9a;font-size:11px;line-height:1.5}
    #sdial .bz .dt b{color:#cfcfcf;font-weight:600}
    #sdial .bz .r.open .dt{display:block}
    #sdial .bz .foot{display:flex;gap:6px;margin-top:6px;padding-top:6px;border-top:1px solid #2c2c2c}
    #sdial .bz .foot .lk{flex:1;padding:0 4px}
    #sdial .bz .foot .rf{flex:0 0 44px;padding:0}
  `;

  function mount(ctx) {
    SD.css('sd-bazaar', CSS);
    const el = ctx.el;
    el.innerHTML =
      '<div class="bz">' +
        '<div class="sum" style="display:none"></div>' +
        '<div class="lst"></div>' +
        '<div class="foot">' +
          '<a class="lk" href="/bazaar.php#/manage">Manage</a>' +
          '<a class="lk" href="/bazaar.php#/add">Add</a>' +
          '<a class="lk" href="/bazaar.php#/personalize">Style</a>' +
          '<button class="rf" aria-label="Refresh">' + SD.icons.refresh + '</button>' +
        '</div>' +
      '</div>';
    const q = s => el.querySelector(s);
    const sum = q('.sum'), lst = q('.lst'), rf = q('.rf');
    let busy = false, error = '';

    function render() {
      if (!SD.hasKey) { sum.style.display = 'none'; lst.innerHTML = '<div class="em err">This module needs your API key.</div>'; return; }
      if (!cache) {
        sum.style.display = 'none';
        lst.innerHTML = '<div class="em' + (error ? ' err' : '') + '">' + SD.esc(error || 'Loading...') + '</div>';
        return;
      }
      const rows = cache.rows;
      const pcs = rows.reduce((s, r) => s + r.qty, 0);
      const val = rows.reduce((s, r) => s + r.total, 0);
      const mvv = rows.reduce((s, r) => s + (r.mv ? r.qty * r.mv : 0), 0);
      const cheap = rows.filter(r => r.lvl === 0).length, high = rows.filter(r => r.lvl === 1).length;
      const open = cache.open == null ? '' : '<span class="o ' + (cache.open ? 'on">Open' : 'off">Closed') + '</span>';
      sum.style.display = 'block';
      sum.innerHTML = open +
        '<b>' + rows.length + '</b> item' + (rows.length === 1 ? '' : 's') + ' · <b>' + pcs.toLocaleString('en-US') + '</b> pcs<br>' +
        'Value <b>' + short(val) + '</b>' + (mvv ? ' (MV ' + short(mvv) + ')' : '') +
        ((cheap || high) ? '<br>' + (cheap ? '<span class="bad">' + cheap + ' cheap</span>' : '') + (cheap && high ? ' · ' : '') + (high ? '<span class="hi">' + high + ' high</span>' : '') : '');
      if (!rows.length) {
        lst.innerHTML = '<div class="em">' + (error ? SD.esc(error) : 'No items found in your bazaar.') + '</div>';
        return;
      }
      lst.innerHTML = rows.map(r => {
        const L = LVL[r.lvl];
        return '<div class="r" style="--c:' + L.c + '">' +
          '<div class="r1"><div class="who"><span class="nm">' + SD.esc(r.name) + '</span>' +
          '<span class="id">' + r.qty.toLocaleString('en-US') + ' × ' + money(r.price) + '</span></div>' +
          '<div class="sx"><span class="sl">' + (r.ratio == null ? 'No MV' : pct(r.ratio)) + '</span>' +
          '<span class="cd">' + (r.mv ? 'MV ' + short(r.mv) : '') + '</span></div></div>' +
          '<div class="dt"><b>' + L.w + '</b>' + (r.mv ? ' · ' + (r.price - r.mv >= 0 ? '+' : '-') + money(Math.abs(r.price - r.mv)) + ' vs market value each' : '') +
          '<br>Total at your price: <b>' + money(r.total) + '</b>' + (r.mv ? '<br>Total at market value: ' + money(r.qty * r.mv) : '') + '</div>' +
          '</div>';
      }).join('');
    }

    async function load(force) {
      if (busy || !SD.hasKey) return;
      if (cache && Date.now() - cache.t < COOL) { render(); return; }
      busy = true;
      try {
        cache = await fetchBazaar();
        error = '';
      } catch (e) {
        error = 'Bazaar unavailable: ' + (e && e.message ? e.message : 'unknown error');
        if (force) SD.toast(error);
      }
      busy = false;
      if (ctx.alive) render();
    }

    lst.addEventListener('click', e => {
      const row = e.target.closest('.r');
      if (row) row.classList.toggle('open');
    });
    rf.addEventListener('click', () => {
      if (busy) return;
      if (cache && Date.now() - cache.t < COOL) { SD.toast('Wait ' + Math.ceil((COOL - (Date.now() - cache.t)) / 1000) + 's'); return; }
      SD.spin(rf, load(true));
    });

    render();     // shows the last result straight away (if any), then reloads when it is older than 30s
    load(false);
    return { unmount() { busy = false; } };
  }

  SD.register({
    id: 'bazaar',
    label: 'Bazaar',
    width: 270,
    // storefront
    icon: '<path d="M3.5 9.5L5 4h14l1.5 5.5"/><path d="M3.5 9.5a2.8 2.8 0 0 0 5.5 0 2.8 2.8 0 0 0 6 0 2.8 2.8 0 0 0 5.5 0"/><path d="M5 12.5V20h14v-7.5"/><path d="M10 20v-4.5h4V20"/>',
    mount
  });
})();
