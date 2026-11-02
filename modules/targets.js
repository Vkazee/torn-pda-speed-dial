// Speed Dial module: Targets v0.5.1
// Bottom bar: Add | Edit | Filter | Refresh. Add opens its own view (like Item Dock) with a search box: digits / profile link = ID,
// anything else = name search with a pick list. Filter opens a pop-up (screen dimmed) to pick the order: Sort by Default (as added), A-Z, or Time (Okay first, then the shortest cooldown).
// Each row shows name, ID (dark grey) with the player's level, and status with a live cooldown (Okay green, Hospital, Jail, ...).
// Tap a row to see the status details (for example who put them in hospital). Tap the name to open the profile.
// Refresh reloads only the targets on screen and can be used once every 30 seconds (also after closing and reopening the window).
// Auto-refresh: the targets on screen are also refreshed when the window opens, when you change page and when you change the sort.
// It only loads targets whose data is older than 30 seconds, does not start the Refresh button cooldown and stays silent unless something fails.
// From 15 targets on, the list switches to pages (15 per page, arrows with "page / total" in the middle) instead of scrolling,
// and Refresh only asks for the current page, so the number of API requests stays small.
// Nothing runs while the window is closed.
(function () {
  'use strict';
  const SD = window.SpeedDial;
  if (!SD) return;

  const LS = 'speedDial.targets1';   // { list: [{ id, name, st }], rt: last refresh (ms) }
  const PER = 15;                    // targets per page; from this many targets on, pages replace scrolling
  const MAX = 150;                   // most targets you can save
  const COOL = 30000;                // Refresh button cooldown (also the age after which auto-refresh reloads a target)
  const BATCH = 5;                   // parallel requests while refreshing

  const S = SD.read(LS, null) || {};
  if (!Array.isArray(S.list)) S.list = [];
  if (typeof S.rt !== 'number') S.rt = 0;
  const save = () => SD.write(LS, S);

  const strip = s => String(s || '').replace(/<[^>]*>/g, '').trim();
  const COLOR = { Okay: '#7fd08a', Hospital: '#f1807a', Jail: '#d9a441', Federal: '#f1807a', Traveling: '#6fa8e8', Abroad: '#6fa8e8', Fallen: '#8a8a8a' };
  const colorOf = s => COLOR[s] || '#cfcfcf';

  // one profile request -> { name, st }
  async function pull(id) {
    const j = await SD.api('https://api.torn.com/user/' + id + '?selections=profile');
    const s = j.status || {};
    return {
      name: String(j.name || ('#' + id)),
      lv: typeof j.level === 'number' ? j.level : 0,
      st: { state: s.state || 'Okay', desc: strip(s.description), det: strip(s.details), until: s.until || 0, t: Date.now() }
    };
  }

  // ---- name search (Torn API v2 user/search, flagged Unstable by Torn) ----
  // The name filter syntax could not be checked against Torn's docs, and a wrong one is NOT an error: the API just ignores it
  // and returns unrelated players. So every result is checked against what you typed, and a try only counts when it gives matches.
  // Each try = the query string part for the typed name. The first one that works is remembered (S.nt) and used first next time.
  const NAME_TRIES = [
    q => 'filters=' + encodeURIComponent('name:=:' + q),
    q => 'filters=' + encodeURIComponent('name:like:' + q),
    q => 'filters=' + encodeURIComponent('name:contains:' + q),
    q => 'name=' + encodeURIComponent(q)
  ];
  const arr = j => {   // first list of objects in the response, whatever the key is called
    if (Array.isArray(j)) return j;
    for (const v of Object.values(j || {})) {
      if (Array.isArray(v) && (!v.length || typeof v[0] === 'object')) return v;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const o = Object.values(v);
        if (o.length && typeof o[0] === 'object' && o[0] && (o[0].name || o[0].id || o[0].player_id)) return o;
      }
    }
    return [];
  };
  async function findName(q) {
    const low = q.toLowerCase();
    const order = NAME_TRIES.map((t, i) => i);
    if (typeof S.nt === 'number' && S.nt >= 0 && S.nt < order.length) order.unshift(order.splice(S.nt, 1)[0]);
    let err = null, ok = false, empty = false, junk = false;
    for (const i of order) {
      try {
        const j = await SD.api('https://api.torn.com/v2/user/search?' + NAME_TRIES[i](q));
        ok = true;
        const all = arr(j).map(o => ({ id: +(o.id || o.player_id || o.user_id || 0), name: String(o.name || ''), level: o.level || 0 })).filter(o => o.id && o.name);
        const hit = all.filter(o => o.name.toLowerCase().indexOf(low) > -1).slice(0, 15);
        if (hit.length) { if (S.nt !== i) { S.nt = i; save(); } return hit; }
        if (all.length) junk = true; else empty = true;   // unrelated players = filter ignored; nobody = filter works
      } catch (e) { err = e; }
    }
    if (!ok) throw err || new Error('search failed');
    if (empty) return [];
    if (junk) throw new Error('the API ignored the name filter');
    return [];
  }

  // what to show right now: the saved status, but once the cooldown has run out it counts as Okay
  function view(st) {
    if (!st) return { label: '...', color: '#8a8a8a', rem: 0 };
    const rem = st.until ? st.until - Date.now() / 1000 : 0;
    if (st.state !== 'Okay' && st.until && rem <= 0) return { label: 'Okay', color: COLOR.Okay, rem: 0 };
    return { label: st.state, color: colorOf(st.state), rem: Math.max(0, rem) };
  }

  const CSS = `
    #sdial .tg button{height:32px;border-radius:8px;border:1px solid #333;background:#242424;color:#cfcfcf;font-size:12px;padding:0 10px}
    #sdial .tg button:active{background:#2e2e2e}
    #sdial .tg button:disabled{opacity:.4}
    #sdial .tg input{flex:1;min-width:0;height:36px;border-radius:8px;border:1px solid #3a3a3a;background:#242424;color:#e6e6e6;font-size:16px;padding:0 10px;outline:none}
    #sdial .tg input:focus{border-color:#4a8fd9}
    #sdial .tg .addv{display:none}
    #sdial .tg.adding .addv{display:block}
    #sdial .tg.adding .main{display:none}
    #sdial .tg .ah{display:flex;align-items:center;gap:8px;margin-bottom:6px;color:#e6e6e6;font-size:13px}
    #sdial .tg .ah .back{flex:0 0 32px;width:32px;padding:0;display:flex;align-items:center;justify-content:center}
    #sdial .tg .ad{display:flex;gap:6px;margin-bottom:6px}
    #sdial .tg .ad .go{flex:0 0 auto;height:36px;padding:0 14px}
    #sdial .tg .res{max-height:44vh;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;touch-action:pan-y}
    #sdial .tg .res .r{display:flex;align-items:center;gap:8px;min-height:44px;padding:4px 10px;border-radius:8px;margin-bottom:3px;background:#242424;border-left:3px solid #4a8fd9}
    #sdial .tg .res .r:active{background:#2e2e2e}
    #sdial .tg .res .r.have{opacity:.5}
    #sdial .tg .res .lv{flex:0 0 auto;color:#9a9a9a;font-size:11px}
    #sdial .tg .res .pl{flex:0 0 18px;text-align:center;color:#7fd08a;font-size:18px;line-height:1}
    #sdial .tg .res .hint{color:#8a8a8a;padding:12px 6px;text-align:center;font-size:12px;line-height:1.4}
    #sdial .tg .lst{max-height:46vh;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;touch-action:pan-y}
    #sdial .tg .em{padding:14px 6px;text-align:center;color:#8a8a8a;font-size:12px;line-height:1.4}
    #sdial .tg .tr{margin-bottom:3px;padding:5px 8px;border-radius:8px;background:#242424;border-left:3px solid var(--c,#5a5a5a)}
    #sdial .tg .tr:active{background:#2e2e2e}
    #sdial .tg .r1{display:flex;align-items:center;gap:8px}
    #sdial .tg .who{flex:1;min-width:0}
    #sdial .tg .nm{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e6e6e6;text-decoration:none;font-size:13px}
    #sdial .tg .id{display:block;color:#6b6b6b;font-size:11px;margin-top:1px}
    #sdial .tg .id em{font-style:normal;color:#9a9a9a;margin-left:8px}
    #sdial .tg .sx{flex:0 0 auto;text-align:right;max-width:46%}
    #sdial .tg .sl{display:block;font-weight:600;font-size:12px;color:var(--c)}
    #sdial .tg .cd{display:block;color:#cfcfcf;font-size:11px;margin-top:1px;min-height:13px}
    #sdial .tg .dt{display:none;margin-top:4px;padding-top:4px;border-top:1px solid #2f2f2f;color:#9a9a9a;font-size:11px;line-height:1.35;word-break:break-word}
    #sdial .tg .tr.open .dt{display:block}
    #sdial .tg .rm{display:none;flex:0 0 30px;width:30px;height:30px;padding:0;color:#f1807a}
    #sdial .tg.ed .rm{display:block}
    #sdial .tg .pg{display:none;align-items:center;gap:6px;margin:6px 0 0}
    #sdial .tg.pgd .pg{display:flex}
    #sdial .tg .pg button{flex:0 0 44px;padding:0}
    #sdial .tg .pg button svg{width:18px;height:18px}
    #sdial .tg .pn{flex:1;text-align:center;color:#cfcfcf;font-size:13px}
    #sdial .tg .foot{display:flex;gap:6px;margin-top:6px;padding-top:6px;border-top:1px solid #2c2c2c}
    #sdial .tg .foot .add,#sdial .tg .foot .edit{flex:1;padding:0 4px}
    #sdial .tg.ed .foot .edit{background:#383838;color:#e6e6e6;border-color:#5a5a5a}
    #sdial .tg .foot .fb{flex:0 0 40px;padding:0;display:flex;align-items:center;justify-content:center}
    #sdial .tg .foot .fb.act{background:#2a3140;border-color:#4a8fd9}
    #sdial .tg .foot .rf{flex:0 0 auto;min-width:52px;padding:0 8px;display:flex;align-items:center;justify-content:center;gap:4px}
    #sdial .tg .rf .rs{font-size:11px;min-width:16px;text-align:left}
    #sdial .tgpop{position:fixed;left:0;top:0;right:0;bottom:0;z-index:5000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.6)}
    #sdial .tgpop .tc{width:100%;max-width:260px;padding:12px;border-radius:14px;border:1px solid var(--st);background:#1c1c1c;color:#e6e6e6;box-shadow:0 8px 24px rgba(0,0,0,.6)}
    #sdial .tgpop .th{padding:2px 4px 8px;font-size:14px;font-weight:700}
    #sdial .tgpop .op{display:flex;align-items:center;gap:10px;width:100%;height:44px;margin-top:4px;padding:0 12px;border-radius:10px;border:1px solid #333;background:#242424;color:#e6e6e6;font-size:14px;text-align:left}
    #sdial .tgpop .op:active{background:#2e2e2e}
    #sdial .tgpop .op i{flex:0 0 16px;width:16px;height:16px;border-radius:50%;border:2px solid #5a5a5a}
    #sdial .tgpop .op.on{border-color:#4a8fd9;background:#2a3140}
    #sdial .tgpop .op.on i{border-color:#4a8fd9;background:radial-gradient(circle,#4a8fd9 0 40%,transparent 45%)}
    #sdial .tgpop .op span{flex:1}
    #sdial .tgpop .cx{width:100%;height:38px;margin-top:8px;border-radius:10px;border:1px solid #333;background:none;color:#cfcfcf;font-size:13px}
    #sdial .tgpop .cx:active{background:#2e2e2e}
  `;

  const ARROW_L = '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>';
  const ARROW_R = '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>';
  const FUNNEL = '<svg viewBox="0 0 24 24"><path d="M4 5h16l-6 7.5V19l-4-2v-4.5z"/></svg>';
  const SORTS = [['def', 'Sort by Default'], ['name', 'Sort by A-Z'], ['okay', 'Sort by Time']];

  function mount(ctx) {
    SD.css('sd-targets', CSS);
    const el = ctx.el;
    el.innerHTML =
      '<div class="tg">' +
        '<div class="addv">' +
          '<div class="ah"><button class="back" aria-label="Back">' + ARROW_L + '</button><span>Add target</span></div>' +
          '<div class="ad"><input class="in" type="text" placeholder="Name or ID" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="go">Go</button></div>' +
          '<div class="res"></div>' +
        '</div>' +
        '<div class="main">' +
          '<div class="lst"></div>' +
          '<div class="pg"><button class="pp" aria-label="Previous page">' + ARROW_L + '</button><span class="pn"></span><button class="pnx" aria-label="Next page">' + ARROW_R + '</button></div>' +
          '<div class="foot"><button class="add">Add</button><button class="edit">Edit</button><button class="fb" aria-label="Sort">' + FUNNEL + '</button><button class="rf" aria-label="Refresh">' + SD.icons.refresh + '<span class="rs"></span></button></div>' +
        '</div>' +
      '</div>';
    const q = s => el.querySelector(s);
    const root = q('.tg'), lst = q('.lst'), res = q('.res'), inp = q('.in'), goB = q('.go'), pn = q('.pn');
    const prev = q('.pp'), next = q('.pnx'), edit = q('.edit'), rf = q('.rf'), rs = q('.rs'), fb = q('.fb');
    let page = 0, busy = false, found = [];

    // ---- order: Default (as added), A-Z, Okay first (then the shortest cooldown first) ----
    const sortKey = () => (S.sort === 'name' || S.sort === 'okay') ? S.sort : 'def';
    function sorted() {
      const l = S.list.slice();
      const k = sortKey();
      if (k === 'name') l.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      else if (k === 'okay') {
        const w = t => { const v = view(t.st); return v.label === 'Okay' ? 0 : v.label === '...' ? 2 : 1; };
        l.sort((a, b) => (w(a) - w(b)) || (view(a.st).rem - view(b.st).rem) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      }
      return l;
    }
    const paged = () => S.list.length >= PER;
    const pages = () => Math.max(1, Math.ceil(S.list.length / PER));
    const shown = () => { const l = sorted(); return paged() ? l.slice(page * PER, page * PER + PER) : l; };

    function render() {
      if (page > pages() - 1) page = pages() - 1;
      if (page < 0) page = 0;
      root.classList.toggle('pgd', paged());
      fb.classList.toggle('act', sortKey() !== 'def');
      if (!SD.hasKey) { lst.innerHTML = '<div class="em">No API key available.</div>'; return; }
      if (!S.list.length) { lst.innerHTML = '<div class="em">No targets yet.<br>Tap Add.</div>'; return; }
      const keep = lst.scrollTop;
      lst.innerHTML = shown().map(t => {
        const v = view(t.st);
        const det = t.st ? [t.st.desc, t.st.det].filter(Boolean).join(' - ') : '';
        return '<div class="tr" data-id="' + t.id + '" style="--c:' + v.color + '">' +
          '<div class="r1">' +
            '<div class="who"><a class="nm" href="/profiles.php?XID=' + t.id + '">' + SD.esc(t.name) + '</a><span class="id">[' + t.id + ']' + (t.lv ? '<em>Lv ' + t.lv + '</em>' : '') + '</span></div>' +
            '<div class="sx"><b class="sl">' + SD.esc(v.label) + '</b><span class="cd" data-u="' + (v.rem ? t.st.until : 0) + '">' + (v.rem ? SD.durS(v.rem) : '') + '</span></div>' +
            '<button class="rm" aria-label="Remove">\u2715</button>' +
          '</div>' +
          '<div class="dt">' + SD.esc(det || 'No details') + '</div>' +
        '</div>';
      }).join('');
      lst.scrollTop = keep;
      pn.textContent = (page + 1) + ' / ' + pages();
      prev.disabled = page <= 0;
      next.disabled = page >= pages() - 1;
    }

    // every second: cooldown numbers + Refresh button; a row whose cooldown just ended is redrawn as Okay
    function tick() {
      const now = Date.now() / 1000;
      let redraw = false;
      lst.querySelectorAll('.cd[data-u]').forEach(c => {
        const u = +c.dataset.u;
        if (!u) return;
        const rem = u - now;
        if (rem <= 0) redraw = true; else c.textContent = SD.durS(rem);
      });
      if (redraw && !root.classList.contains('adding')) render();
      const left = Math.ceil((COOL - (Date.now() - S.rt)) / 1000);
      rs.textContent = left > 0 ? left + 's' : '';
      rf.disabled = left > 0 || busy;
    }

    // ---- add view (like Item Dock: its own view with a back button) ----
    function renderRes(msg) {
      if (msg) { res.innerHTML = '<div class="hint">' + SD.esc(msg) + '</div>'; return; }
      if (!found.length) { res.innerHTML = '<div class="hint">Type a name or an ID, then tap Go.</div>'; return; }
      res.innerHTML = '';
      found.forEach(o => {
        const have = S.list.some(t => t.id === o.id);
        const r = document.createElement('div');
        r.className = 'r' + (have ? ' have' : '');
        r.innerHTML = '<div class="who"><span class="nm"></span><span class="id">[' + o.id + ']</span></div>' + (o.level ? '<span class="lv">Lv ' + o.level + '</span>' : '') + '<span class="pl">' + (have ? '\u2713' : '+') + '</span>';
        r.querySelector('.nm').textContent = o.name;
        if (!have) r.addEventListener('click', () => { if (!busy) addId(o.id); });
        res.appendChild(r);
      });
    }

    function openAdd() {
      if (!SD.hasKey) return SD.toast('No API key available');
      root.classList.add('adding');
      found = [];
      inp.value = '';
      renderRes();
      inp.focus();
    }
    function closeAdd() {
      root.classList.remove('adding');
      inp.blur();
      render();
      tick();
    }

    async function addId(id) {
      if (S.list.some(t => t.id === id)) return SD.toast('Already in your list');
      if (S.list.length >= MAX) return SD.toast('Max ' + MAX + ' targets');
      busy = true; goB.disabled = true;
      try {
        const r = await pull(id);
        S.list.push({ id, name: r.name, lv: r.lv, st: r.st });
        save();
        if (ctx.alive) {
          if (sortKey() === 'def') page = pages() - 1;   // show the new one at the end
          if (!found.some(o => o.id === id)) found = [{ id, name: r.name, level: r.lv }];   // typed an ID: show it as added
          inp.value = '';
          renderRes();
        }
        SD.toast(r.name + ' added');
      } catch (e) {
        SD.toast('Could not add: ' + e.message);
      }
      busy = false;
      if (ctx.alive) { goB.disabled = false; tick(); }
    }

    async function byName(name) {
      busy = true; goB.disabled = true;
      renderRes('Searching...');
      let list = null;
      try { list = await findName(name); }
      catch (e) { found = []; if (ctx.alive) renderRes('Name search is not working (' + e.message + '). Use the player ID instead.'); }
      busy = false;
      if (!ctx.alive) return;
      goB.disabled = false;
      tick();
      if (!list) return;
      found = list;
      renderRes(list.length ? '' : 'No player found for "' + name + '".');
    }

    // one box: a profile link, "[123]" or plain digits = ID; anything else = a name
    function go() {
      if (busy) return;
      const raw = String(inp.value).trim();
      if (!raw) return SD.toast('Enter a name or ID');
      const m = raw.match(/XID=(\d+)/i) || raw.match(/^\[?\s*(\d+)\s*\]?$/);
      if (m) return addId(+m[1]);
      if (raw.length < 2) return SD.toast('Type at least 2 letters');
      byName(raw.replace(/^[@\s]+|\s+$/g, ''));
    }

    // ---- refresh: only the targets on screen ----
    // manual (button): at most once per 30 seconds, starts the cooldown, always shows a toast.
    // auto (window open, page change, sort change): only targets whose data is older than 30 seconds,
    // no button cooldown, and a toast only when something failed.
    async function refresh(auto) {
      if (busy) return;
      if (!SD.hasKey) return auto ? undefined : SD.toast('No API key available');
      if (!auto) {
        const left = Math.ceil((COOL - (Date.now() - S.rt)) / 1000);
        if (left > 0) return SD.toast('Wait ' + left + 's');
      }
      let todo = shown().slice();
      if (auto) todo = todo.filter(t => !t.st || Date.now() - t.st.t > COOL);   // only stale ones
      if (!todo.length) return;
      busy = true;
      if (!auto) {
        S.rt = Date.now();   // manual refresh starts the cooldown right away, so a double tap cannot send twice
        save();
      }
      tick();
      let failed = 0, last = '';
      const job = (async () => {
        for (let i = 0; i < todo.length; i += BATCH) {
          await Promise.all(todo.slice(i, i + BATCH).map(async t => {
            try {
              const r = await pull(t.id);
              t.name = r.name;
              if (r.lv) t.lv = r.lv;
              t.st = r.st;
            } catch (e) { failed++; last = e.message; }   // keep the old status when one request fails
          }));
        }
        save();
      })();
      await SD.spin(rf, job);
      busy = false;
      if (!ctx.alive) return;
      render();
      tick();
      if (!auto || failed) SD.toast(failed ? 'Updated, ' + failed + ' failed (' + last + ')' : 'Updated');
    }

    // ---- sort pop-up: lives in #sdial (not inside the window, which clips and moves), so it dims the whole screen ----
    let pop = null;
    function closePop() { if (pop) { pop.remove(); pop = null; } }
    function openPop() {
      closePop();
      const t = document.createElement('div');
      t.className = 'tgpop';
      t.innerHTML = '<div class="tc" role="dialog"><div class="th">Sort</div>' +
        SORTS.map(x => '<button class="op' + (x[0] === sortKey() ? ' on' : '') + '" data-s="' + x[0] + '"><i></i><span>' + x[1] + '</span></button>').join('') +
        '<button class="cx">Cancel</button></div>';
      t.addEventListener('click', e => {
        const op = e.target.closest('.op');
        if (op) { S.sort = op.dataset.s; save(); page = 0; closePop(); render(); refresh(true); return; }
        if (e.target === t || e.target.closest('.cx')) closePop();
      });
      (document.getElementById('sdial') || document.body).appendChild(t);
      pop = t;
    }

    // ---- events ----
    q('.add').addEventListener('click', openAdd);
    q('.back').addEventListener('click', closeAdd);
    goB.addEventListener('click', go);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    rf.addEventListener('click', () => refresh(false));
    fb.addEventListener('click', openPop);
    edit.addEventListener('click', () => { root.classList.toggle('ed'); edit.textContent = root.classList.contains('ed') ? 'Done' : 'Edit'; });
    prev.addEventListener('click', () => { if (page > 0) { page--; render(); refresh(true); } });
    next.addEventListener('click', () => { if (page < pages() - 1) { page++; render(); refresh(true); } });
    lst.addEventListener('click', e => {
      const row = e.target.closest('.tr');
      if (!row) return;
      if (e.target.closest('.rm')) {
        const id = +row.dataset.id;
        S.list = S.list.filter(t => t.id !== id);
        save();
        render();
        return;
      }
      if (e.target.closest('a')) return;   // the name opens the profile
      row.classList.toggle('open');
    });

    render();
    tick();
    ctx.every(tick, 1000);
    refresh(true);   // refresh on open
    return { unmount() { busy = false; closePop(); } };
  }

  SD.register({
    id: 'targets',
    label: 'Targets',
    width: 270,
    // crosshair
    icon: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1.5"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>',
    mount
  });
})();
