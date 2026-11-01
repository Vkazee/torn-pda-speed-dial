// Speed Dial module: Targets v0.1.0
// Save players by ID. Each row shows name, ID (dark grey) and status with a live cooldown (Okay green, Hospital, Jail, ...).
// Tap a row to see the status details (for example who put them in hospital). Tap the name to open the profile.
// Refresh reloads only the targets on screen and can be used once every 30 seconds (also after closing and reopening the window).
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
  const COOL = 30000;                // Refresh button cooldown
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
      st: { state: s.state || 'Okay', desc: strip(s.description), det: strip(s.details), until: s.until || 0, t: Date.now() }
    };
  }

  // what to show right now: the saved status, but once the cooldown has run out it counts as Okay
  function view(st) {
    if (!st) return { label: '...', color: '#8a8a8a', rem: 0 };
    const rem = st.until ? st.until - Date.now() / 1000 : 0;
    if (st.state !== 'Okay' && st.until && rem <= 0) return { label: 'Okay', color: COLOR.Okay, rem: 0 };
    return { label: st.state, color: colorOf(st.state), rem: Math.max(0, rem) };
  }

  const CSS = `
    #sdial .tg .ad{display:flex;gap:6px;margin-bottom:6px}
    #sdial .tg input{flex:1;min-width:0;height:32px;border-radius:8px;border:1px solid #333;background:#242424;color:#e6e6e6;font-size:13px;padding:0 8px}
    #sdial .tg button{height:32px;border-radius:8px;border:1px solid #333;background:#242424;color:#cfcfcf;font-size:12px;padding:0 10px}
    #sdial .tg button:active{background:#2e2e2e}
    #sdial .tg button:disabled{opacity:.4}
    #sdial .tg .em{padding:14px 6px;text-align:center;color:#8a8a8a;font-size:12px;line-height:1.4}
    #sdial .tg .tr{margin-bottom:3px;padding:5px 8px;border-radius:8px;background:#242424;border-left:3px solid var(--c,#5a5a5a)}
    #sdial .tg .tr:active{background:#2e2e2e}
    #sdial .tg .r1{display:flex;align-items:center;gap:8px}
    #sdial .tg .who{flex:1;min-width:0}
    #sdial .tg .nm{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e6e6e6;text-decoration:none;font-size:13px}
    #sdial .tg .id{display:block;color:#6b6b6b;font-size:11px;margin-top:1px}
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
    #sdial .tg .foot .edit{flex:1}
    #sdial .tg.ed .foot .edit{background:#383838;color:#e6e6e6;border-color:#5a5a5a}
    #sdial .tg .foot .rf{flex:0 0 auto;min-width:56px;display:flex;align-items:center;justify-content:center;gap:5px}
    #sdial .tg .rf .rs{font-size:11px;min-width:18px;text-align:left}
  `;

  const ARROW_L = '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>';
  const ARROW_R = '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>';

  function mount(ctx) {
    SD.css('sd-targets', CSS);
    const el = ctx.el;
    el.innerHTML =
      '<div class="tg">' +
        '<div class="ad"><input class="in" type="text" inputmode="numeric" placeholder="Player ID" autocomplete="off"><button class="addb">Add</button></div>' +
        '<div class="lst"></div>' +
        '<div class="pg"><button class="pp" aria-label="Previous page">' + ARROW_L + '</button><span class="pn"></span><button class="pnx" aria-label="Next page">' + ARROW_R + '</button></div>' +
        '<div class="foot"><button class="edit">Edit</button><button class="rf" aria-label="Refresh">' + SD.icons.refresh + '<span class="rs"></span></button></div>' +
      '</div>';
    const q = s => el.querySelector(s);
    const root = q('.tg'), lst = q('.lst'), inp = q('.in'), addB = q('.addb'), pn = q('.pn');
    const prev = q('.pp'), next = q('.pnx'), edit = q('.edit'), rf = q('.rf'), rs = q('.rs');
    let page = 0, busy = false;

    const paged = () => S.list.length >= PER;
    const pages = () => Math.max(1, Math.ceil(S.list.length / PER));
    const shown = () => paged() ? S.list.slice(page * PER, page * PER + PER) : S.list;

    function render() {
      if (page > pages() - 1) page = pages() - 1;
      if (page < 0) page = 0;
      root.classList.toggle('pgd', paged());
      if (!SD.hasKey) { lst.innerHTML = '<div class="em">No API key available.</div>'; return; }
      if (!S.list.length) { lst.innerHTML = '<div class="em">No targets yet.<br>Enter a player ID and tap Add.</div>'; return; }
      lst.innerHTML = shown().map(t => {
        const v = view(t.st);
        const det = t.st ? [t.st.desc, t.st.det].filter(Boolean).join(' - ') : '';
        return '<div class="tr" data-id="' + t.id + '" style="--c:' + v.color + '">' +
          '<div class="r1">' +
            '<div class="who"><a class="nm" href="/profiles.php?XID=' + t.id + '">' + SD.esc(t.name) + '</a><span class="id">[' + t.id + ']</span></div>' +
            '<div class="sx"><b class="sl">' + SD.esc(v.label) + '</b><span class="cd" data-u="' + (v.rem ? t.st.until : 0) + '">' + (v.rem ? SD.durS(v.rem) : '') + '</span></div>' +
            '<button class="rm" aria-label="Remove">\u2715</button>' +
          '</div>' +
          '<div class="dt">' + SD.esc(det || 'No details') + '</div>' +
        '</div>';
      }).join('');
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
      if (redraw) render();
      const left = Math.ceil((COOL - (Date.now() - S.rt)) / 1000);
      rs.textContent = left > 0 ? left + 's' : '';
      rf.disabled = left > 0 || busy;
    }

    // ---- add ----
    async function add() {
      if (busy) return;
      if (!SD.hasKey) return SD.toast('No API key available');
      const m = String(inp.value).match(/\d+/);
      const id = m ? +m[0] : 0;
      if (!id) return SD.toast('Enter a player ID');
      if (S.list.some(t => t.id === id)) return SD.toast('Already in your list');
      if (S.list.length >= MAX) return SD.toast('Max ' + MAX + ' targets');
      busy = true; addB.disabled = true;
      try {
        const r = await pull(id);
        S.list.push({ id, name: r.name, st: r.st });
        save();
        inp.value = '';
        if (ctx.alive) { page = pages() - 1; render(); }   // jump to where the new target is
        SD.toast(r.name + ' added');
      } catch (e) {
        SD.toast('Could not add: ' + e.message);
      }
      busy = false;
      if (ctx.alive) { addB.disabled = false; tick(); }
    }

    // ---- refresh: only the targets on screen, at most once per 30 seconds ----
    async function refresh() {
      if (busy) return;
      if (!SD.hasKey) return SD.toast('No API key available');
      const left = Math.ceil((COOL - (Date.now() - S.rt)) / 1000);
      if (left > 0) return SD.toast('Wait ' + left + 's');
      const todo = shown().slice();
      if (!todo.length) return;
      busy = true;
      S.rt = Date.now();   // starts the cooldown right away, so a double tap cannot send twice
      save();
      tick();
      let failed = 0, last = '';
      const job = (async () => {
        for (let i = 0; i < todo.length; i += BATCH) {
          await Promise.all(todo.slice(i, i + BATCH).map(async t => {
            try {
              const r = await pull(t.id);
              t.name = r.name;
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
      SD.toast(failed ? 'Updated, ' + failed + ' failed (' + last + ')' : 'Updated');
    }

    // ---- events ----
    addB.addEventListener('click', add);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
    rf.addEventListener('click', refresh);
    edit.addEventListener('click', () => { root.classList.toggle('ed'); edit.textContent = root.classList.contains('ed') ? 'Done' : 'Edit'; });
    prev.addEventListener('click', () => { if (page > 0) { page--; render(); } });
    next.addEventListener('click', () => { if (page < pages() - 1) { page++; render(); } });
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
    return { unmount() { busy = false; } };
  }

  SD.register({
    id: 'targets',
    label: 'Targets',
    width: 260,
    // crosshair
    icon: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1.5"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>',
    mount
  });
})();
