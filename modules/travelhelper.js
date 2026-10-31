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
