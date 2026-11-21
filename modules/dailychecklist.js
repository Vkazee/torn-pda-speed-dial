// Speed Dial module: Daily Checklist v0.1.0
// A checklist that clears itself every day at midnight Torn time (TCT = UTC).
//   - My tasks: tasks you add yourself (Add). Tap a row to check it. Edit shows a red cross per task (tap once to arm, again to delete).
//   - Auto items: built-in items that check themselves from the Torn API. Edit shows an On/Off switch per item.
//       Refills (on by default, 1 API call: user selections=refills): free energy refill, nerve refill, token refill.
//       Daily log (off by default, 1 API call: user selections=log since midnight TCT, needs a Full Access key):
//       Xanax taken, an item bought in the city, casino tokens used.
//     An auto item only ever checks itself (never unchecks), and you can always tap it yourself, so a wrong or missing
//     answer from the API never gets in the way. If Torn refuses (key level too low) or the reply is not understood, the
//     whole group becomes manual with a small note and is only tried again after 24 hours.
//   - Bottom bar: Add | Edit | Refresh (30 s cooldown with the countdown on the button, like Targets and Market).
// The new day is noticed when the window opens (and while it stays open); nothing runs while the window is closed.
// Saved under speedDial.daily1.
(function () {
  'use strict';
  const SD = window.SpeedDial;
  if (!SD) return;

  const LS = 'speedDial.daily1';
  const MAX = 30;                    // most own tasks
  const MAXT = 60;                   // task title length
  const COOL = 30000;                // Refresh button cooldown
  const FRESH = 120000;              // opening the window reloads auto items only when the last load is older than this
  const RETRY = 24 * 3600 * 1000;    // a group that Torn refused is not asked again for this long
  const KEY_ERR = [2, 5, 8, 9, 10, 13, 14, 18, 19, 21];   // key / limit problems say nothing about the key's access level

  // Auto items. g = which API call answers it.
  const AUTO = [
    { k: 'refE', g: 'ref', t: 'Energy refill', w: 'energy' },
    { k: 'refN', g: 'ref', t: 'Nerve refill', w: 'nerve' },
    { k: 'refT', g: 'ref', t: 'Token refill', w: 'token' },
    { k: 'xan', g: 'log', t: 'Take Xanax' },
    { k: 'city', g: 'log', t: 'Buy in the city' },
    { k: 'tok', g: 'log', t: 'Use casino tokens' }
  ];
  const NA_NOTE = { ref: 'Manual', log: 'Manual \u00b7 needs Full Access' };

  const S = SD.read(LS, null) || {};
  S.d = typeof S.d === 'string' ? S.d : '';
  S.list = (Array.isArray(S.list) ? S.list : []).filter(t => t && typeof t.id === 'number').map(t => ({ id: t.id, t: String(t.t || ''), done: !!t.done }));
  const maxId = S.list.reduce((m, t) => Math.max(m, t.id), 0);
  if (typeof S.n !== 'number' || S.n <= maxId) S.n = maxId + 1;
  S.done = S.done && typeof S.done === 'object' ? S.done : {};
  S.on = Object.assign({ refE: true, refN: true, refT: true, xan: false, city: false, tok: false }, S.on && typeof S.on === 'object' ? S.on : {});
  S.na = S.na && typeof S.na === 'object' ? S.na : {};
  S.rt = +S.rt || 0;   // last manual refresh (cooldown)
  S.ft = +S.ft || 0;   // last time the auto items were loaded
  const save = () => SD.write(LS, S);

  const today = () => new Date().toISOString().slice(0, 10);   // TCT date
  const naNow = g => !!S.na[g] && Date.now() - S.na[g] < RETRY;
  function rollover() {   // new TCT day: clear every check, keep the tasks
    const d = today();
    if (S.d === d) return false;
    S.d = d; S.done = {}; S.ft = 0;
    S.list.forEach(t => { t.done = false; });
    save();
    SD.log('daily', 'new day ' + d + ': checks cleared');
    return true;
  }

  // ---------- reading the API ----------
  function flatBools(node) {   // every true/false in the reply with its key path (an object with a boolean "used" counts as that boolean)
    const out = [];
    (function walk(o, p, d) {
      if (!o || typeof o !== 'object' || d > 2) return;
      Object.keys(o).forEach(k => {
        const v = o[k], path = (p + '_' + k).toLowerCase();
        if (typeof v === 'boolean') out.push([path, v]);
        else if (v && typeof v === 'object' && typeof v.used === 'boolean') out.push([path, v.used]);
        else walk(v, path, d + 1);
      });
    })(node, '', 0);
    return out;
  }
  async function loadRefills() {
    const j = await SD.api('https://api.torn.com/user/?selections=refills');
    const node = j && j.refills !== undefined ? j.refills : j;
    const flat = flatBools(node);
    const res = {};
    let seen = 0;
    AUTO.filter(a => a.g === 'ref').forEach(a => {
      const hit = flat.find(f => f[0].indexOf(a.w) > -1 && f[0].indexOf('used') > -1) || flat.find(f => f[0].indexOf(a.w) > -1 && f[0].indexOf('avail') < 0);
      if (hit) { res[a.k] = hit[1]; seen++; }
    });
    if (!seen) throw Object.assign(new Error('refills reply not understood: ' + JSON.stringify(node).slice(0, 160)), { odd: true });
    return res;
  }
  async function loadLog() {
    const p = S.d.split('-').map(Number);
    const from = Math.floor(Date.UTC(p[0], p[1] - 1, p[2]) / 1000);
    const j = await SD.api('https://api.torn.com/user/?selections=log&from=' + from);
    if (!j || !('log' in j)) throw Object.assign(new Error('log not in reply: ' + Object.keys(j || {}).join(',')), { odd: true });
    const arr = Object.values(j.log || {}).filter(e => e && typeof e === 'object');
    const titles = {};
    arr.forEach(e => { const t = String(e.title || e.log || '?'); titles[t] = (titles[t] || 0) + 1; });
    SD.log('daily', 'log since midnight TCT: ' + arr.length + ' entr' + (arr.length === 1 ? 'y' : 'ies') + (arr.length >= 100 ? ' (limit reached, older ones are missing)' : '') + ' | ' + Object.keys(titles).slice(0, 15).join('; '));
    const text = e => (String(e.title || '') + ' ' + String(e.category || '')).toLowerCase();
    return {
      xan: arr.some(e => e.data && +e.data.item === 206 && /use/.test(text(e))),
      city: arr.some(e => /city/.test(text(e)) && /buy|bought|purchas/.test(text(e))),
      tok: arr.some(e => /casino/.test(text(e)) && /token/.test(text(e)))
    };
  }

  const CSS = `
    #sdial .dl button{height:var(--sd-h);border-radius:8px;border:1px solid var(--sd-line);background:var(--sd-bg2);color:var(--sd-text2);font-size:12px;padding:0 10px}
    #sdial .dl button:active{background:var(--sd-hov)}
    #sdial .dl button:disabled{opacity:.4}
    #sdial .dl .mainv,#sdial .dl .addv{display:none}
    #sdial .dl:not(.adding) .mainv{display:block}
    #sdial .dl.adding .addv{display:block}
    #sdial .dl .pg{display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:12px;color:var(--sd-text2)}
    #sdial .dl .pg .bar{flex:1;height:6px;border-radius:3px;background:#2c2c2c;overflow:hidden}
    #sdial .dl .pg .bar i{display:block;height:100%;width:0;background:#4a8f4e;transition:width .2s}
    #sdial .dl .pg .tx.all{color:#7fd08a}
    #sdial .dl .list{max-height:46vh;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;touch-action:pan-y}
    #sdial .dl .sec{color:var(--sd-dim);font-size:11px;margin:4px 2px 3px}
    #sdial .dl .tr{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:8px;margin-bottom:3px;background:var(--sd-bg2);border-left:3px solid #555;color:var(--sd-text);min-height:36px;user-select:none;-webkit-user-select:none}
    #sdial .dl .tr:active{background:var(--sd-hov)}
    #sdial .dl .tr.done{border-left-color:#4a8f4e}
    #sdial .dl .tr.done .nm{text-decoration:line-through;color:var(--sd-dim)}
    #sdial .dl .tr.off{opacity:.5}
    #sdial .dl .cb{flex:0 0 20px;width:20px;height:20px;border-radius:5px;border:2px solid #666;box-sizing:border-box;display:flex;align-items:center;justify-content:center}
    #sdial .dl .tr.done .cb{background:#4a8f4e;border-color:#4a8f4e}
    #sdial .dl .tr.done .cb::after{content:"\\2713";color:#fff;font-size:13px;line-height:1}
    #sdial .dl .tr .t{flex:1;min-width:0}
    #sdial .dl .tr .nm{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
    #sdial .dl .tr .sub{display:block;color:var(--sd-dim);font-size:11px;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #sdial .dl .tr .rm,#sdial .dl .tr .sw{display:none}
    #sdial .dl.ed .tr .rm{display:block;flex:0 0 var(--sd-h);width:var(--sd-h);height:var(--sd-h);padding:0;color:var(--sd-redt)}
    #sdial .dl.ed .tr .rm.arm{flex:0 0 auto;width:auto;padding:0 8px;border-color:var(--sd-red);background:#3a1f1d;color:#f1b5b0}
    #sdial .dl.ed .tr .sw{display:block;flex:0 0 auto;min-width:44px;padding:0 8px}
    #sdial .dl.ed .tr .sw.on{border-color:#4a8f4e;color:#7fd08a}
    #sdial .dl .em{padding:14px 6px;text-align:center;color:var(--sd-dim);font-size:12px;line-height:1.4}
    #sdial .dl .foot{display:flex;gap:6px;margin-top:6px;padding-top:6px;border-top:1px solid #2c2c2c}
    #sdial .dl .foot .add,#sdial .dl .foot .edit{flex:1;padding:0 4px}
    #sdial .dl .foot .rf{flex:0 0 auto;min-width:52px;padding:0 8px;display:flex;align-items:center;justify-content:center;gap:4px}
    #sdial .dl .rf .rs{font-size:11px;text-align:left}
    #sdial .dl .rf .rs:empty{display:none}
    #sdial .dl .ah{display:flex;align-items:center;gap:8px;margin-bottom:6px;color:var(--sd-text);font-size:13px}
    #sdial .dl .ah .back{flex:0 0 36px;width:36px;padding:0;display:flex;align-items:center;justify-content:center}
    #sdial .dl .ah .ok{flex:0 0 auto}
    #sdial .dl .ti{flex:1;min-width:0;height:var(--sd-hi);border-radius:8px;border:1px solid var(--sd-line2);background:var(--sd-bg2);color:var(--sd-text);font-size:16px;padding:0 10px;outline:none;box-sizing:border-box}
    #sdial .dl .ti:focus{border-color:var(--sd-blue)}
    #sdial .dl .hint{color:var(--sd-dim);padding:12px 6px;text-align:center;font-size:12px;line-height:1.4}
  `;
  const BACK = '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>';

  function mount(ctx) {
    SD.css('sd-daily', CSS);
    const el = ctx.el;
    el.innerHTML =
      '<div class="dl">' +
        '<div class="mainv">' +
          '<div class="pg"><span class="tx"></span><span class="bar"><i></i></span></div>' +
          '<div class="list"></div>' +
          '<div class="foot"><button class="add">Add</button><button class="edit">Edit</button><button class="rf" aria-label="Refresh">' + SD.icons.refresh + '<span class="rs"></span></button></div>' +
        '</div>' +
        '<div class="addv">' +
          '<div class="ah"><button class="back" aria-label="Back">' + BACK + '</button><input class="ti" type="text" maxlength="' + MAXT + '" placeholder="New task" autocomplete="off" spellcheck="false"><button class="ok">Add</button></div>' +
          '<div class="hint">Tasks you add are checked by hand and cleared every day at midnight Torn time.</div>' +
        '</div>' +
      '</div>';
    const q = s => el.querySelector(s);
    const root = q('.dl'), list = q('.list'), ptx = q('.pg .tx'), pbar = q('.pg i'), rf = q('.rf'), rs = q('.rs'), ti = q('.ti');
    let busy = false, armed = 0, armT = 0;

    // ---------- list ----------
    const visibleAuto = () => AUTO.filter(a => S.on[a.k] || root.classList.contains('ed'));
    function render() {
      const keep = list.scrollTop, ed = root.classList.contains('ed');
      const autos = visibleAuto();
      let total = 0, done = 0;
      AUTO.forEach(a => { if (S.on[a.k]) { total++; if (S.done[a.k]) done++; } });
      S.list.forEach(t => { total++; if (t.done) done++; });
      ptx.textContent = total ? (done === total ? 'All done' : done + '/' + total) : '';
      ptx.classList.toggle('all', total > 0 && done === total);
      pbar.style.width = total ? Math.round(done / total * 100) + '%' : '0';

      list.innerHTML = '';
      if (!autos.length && !S.list.length) { list.innerHTML = '<div class="em">No tasks.<br>Tap Add, or Edit to switch on auto items.</div>'; return; }
      const sec = txt => { const d = document.createElement('div'); d.className = 'sec'; d.textContent = txt; list.appendChild(d); };
      const row = (key, title, sub, isDone, isOff) => {
        const r = document.createElement('div');
        r.className = 'tr' + (isDone ? ' done' : '') + (isOff ? ' off' : '');
        r.dataset.k = key;
        r.innerHTML = '<span class="cb"></span><span class="t"><span class="nm"></span><span class="sub"></span></span>';
        r.querySelector('.nm').textContent = title;
        const s = r.querySelector('.sub');
        if (sub) s.textContent = sub; else s.remove();
        return r;
      };
      if (autos.length) {
        sec('Auto');
        autos.forEach(a => {
          const r = row('a:' + a.k, a.t, naNow(a.g) ? NA_NOTE[a.g] : 'Auto', !!S.done[a.k] && !!S.on[a.k], !S.on[a.k]);
          const b = document.createElement('button');
          b.className = 'sw' + (S.on[a.k] ? ' on' : '');
          b.textContent = S.on[a.k] ? 'On' : 'Off';
          r.appendChild(b);
          list.appendChild(r);
        });
      }
      if (S.list.length) {
        sec('My tasks');
        S.list.forEach(t => {
          const r = row('t:' + t.id, t.t, '', t.done, false);
          const b = document.createElement('button');
          b.className = 'rm';
          b.setAttribute('aria-label', 'Delete');
          if (armed === t.id) { b.textContent = 'Delete?'; b.classList.add('arm'); } else b.textContent = '\u2715';
          r.appendChild(b);
          list.appendChild(r);
        });
      }
      list.scrollTop = keep;
    }

    // ---------- refresh ----------
    function tick() {
      if (rollover()) { render(); refresh(false, true); }
      const left = Math.ceil((COOL - (Date.now() - S.rt)) / 1000);
      rs.textContent = left > 0 ? left + 's' : '';
      rf.disabled = left > 0 || busy;
    }
    // manual: user tapped Refresh (cooldown, toasts). force: ignore the "loaded recently" rule (an item was just switched on).
    async function refresh(manual, force) {
      if (busy) return;
      if (!SD.hasKey) return manual ? SD.toast('No API key available') : undefined;
      const groups = ['ref', 'log'].filter(g => AUTO.some(a => a.g === g && S.on[a.k]) && !naNow(g));
      if (!groups.length) return manual ? SD.toast('Nothing to update') : undefined;
      if (manual) {
        const left = Math.ceil((COOL - (Date.now() - S.rt)) / 1000);
        if (left > 0) return SD.toast('Wait ' + left + 's');
        S.rt = Date.now();
        save();
      } else if (!force && Date.now() - S.ft < FRESH) return;
      busy = true; tick();
      let bad = 0, first = null;
      for (const g of groups) {
        try {
          const r = g === 'ref' ? await loadRefills() : await loadLog();
          AUTO.forEach(a => { if (a.g === g && r[a.k] === true) S.done[a.k] = true; });
          delete S.na[g];
        } catch (e) {
          if (e && e.odd) {
            S.na[g] = Date.now();
            SD.log('daily', g + ' ' + e.message + ' | becomes manual for 24h', 'w');
          } else if (e && e.api && KEY_ERR.indexOf(e.code) < 0) {
            S.na[g] = Date.now();
            SD.log('daily', g + ' refused by Torn (' + e.message + '); becomes manual for 24h', 'w');
          } else { bad++; first = first || e; }
        }
      }
      S.ft = Date.now();
      save();
      busy = false;
      if (!ctx.alive) return;
      render(); tick();
      if (bad) SD.toast('Updated, ' + bad + ' failed (' + ((first && first.message) || 'error') + ')');
      else if (manual) SD.toast('Updated');
    }

    // ---------- events ----------
    list.addEventListener('click', e => {
      const row = e.target.closest('.tr');
      if (!row) return;
      const key = row.dataset.k, ed = root.classList.contains('ed');
      if (key.indexOf('a:') === 0) {
        const k = key.slice(2);
        if (e.target.closest('.sw')) {
          S.on[k] = !S.on[k]; save(); render();
          if (S.on[k]) refresh(false, true);
          return;
        }
        if (ed || !S.on[k]) return;
        S.done[k] = !S.done[k]; save(); render();
        return;
      }
      const id = +key.slice(2), t = S.list.find(x => x.id === id);
      if (!t) return;
      if (e.target.closest('.rm')) {
        if (armed !== id) {   // first tap arms, second tap deletes
          armed = id;
          clearTimeout(armT);
          armT = setTimeout(() => { armed = 0; if (ctx.alive) render(); }, 3000);
          render();
          return;
        }
        S.list = S.list.filter(x => x.id !== id);
        armed = 0; save(); render();
        return;
      }
      if (ed) return;
      t.done = !t.done; save(); render();
    });
    q('.edit').addEventListener('click', e => {
      const on = root.classList.toggle('ed');
      SD.editBtn(e.currentTarget, on);
      armed = 0; render();
    });
    rf.addEventListener('click', () => { SD.spin(rf, refresh(true)); });

    function addTask() {
      const v = ti.value.trim();
      if (!v) return ti.focus();
      if (S.list.length >= MAX) return SD.toast('Max ' + MAX + ' tasks');
      S.list.push({ id: S.n++, t: v.slice(0, MAXT), done: false });
      save();
      ti.value = '';
      SD.toast('Added');
      ti.focus();
    }
    q('.add').addEventListener('click', () => { root.classList.add('adding'); ti.value = ''; ti.focus(); });
    q('.ok').addEventListener('click', addTask);
    ti.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addTask(); } });
    q('.back').addEventListener('click', () => { root.classList.remove('adding'); ti.blur(); render(); });

    // ---------- start ----------
    rollover();
    render();
    tick();
    ctx.every(tick, 1000);
    refresh(false);
    SD.log('daily', 'opened: ' + S.list.length + ' task(s), auto on: ' + AUTO.filter(a => S.on[a.k]).map(a => a.k).join(',') + (Object.keys(S.na).filter(naNow).length ? ' | manual groups: ' + Object.keys(S.na).filter(naNow).join(',') : ''));
    return { unmount() { clearTimeout(armT); } };
  }

  SD.register({
    id: 'daily',
    label: 'Daily',
    width: 270,
    // checklist: box with a tick and lines
    icon: '<path d="M4 6l1.5 1.5L8 5"/><path d="M4 12l1.5 1.5L8 11"/><path d="M4 18l1.5 1.5L8 17"/><path d="M12 6h8M12 12h8M12 18h8"/>',
    mount
  });
})();
