// Speed Dial module: Daily Checklist v0.2.0
// A plain checklist of your own tasks that clears itself every day at midnight Torn time (TCT = UTC).
//   - Add: type a task (several in a row is fine). Tap a row to check it.
//   - Edit: shows a red cross per task. Tap it once to arm it ("Delete?"), tap again to delete the task.
//   - Progress at the top ("3/7" with a bar, "All done" when everything is checked).
//   - Every check is cleared when a new TCT day starts; the tasks stay. The new day is noticed when the window opens
//     (and while it stays open); nothing runs while the window is closed.
// No API at all. (An earlier version had auto-checking refill and daily-log items; they were dropped on purpose.)
// Saved under speedDial.daily1.
(function () {
  'use strict';
  const SD = window.SpeedDial;
  if (!SD) return;

  const LS = 'speedDial.daily1';
  const MAX = 30;      // most tasks
  const MAXT = 60;     // task title length

  const S = SD.read(LS, null) || {};
  S.d = typeof S.d === 'string' ? S.d : '';
  S.list = (Array.isArray(S.list) ? S.list : []).filter(t => t && typeof t.id === 'number').map(t => ({ id: t.id, t: String(t.t || ''), done: !!t.done }));
  const maxId = S.list.reduce((m, t) => Math.max(m, t.id), 0);
  if (typeof S.n !== 'number' || S.n <= maxId) S.n = maxId + 1;
  ['done', 'on', 'na', 'rt', 'ft'].forEach(k => { delete S[k]; });   // leftovers of the auto-item version
  const save = () => SD.write(LS, S);

  const today = () => new Date().toISOString().slice(0, 10);   // TCT date
  function rollover() {   // new TCT day: clear every check, keep the tasks
    const d = today();
    if (S.d === d) return false;
    S.d = d;
    S.list.forEach(t => { t.done = false; });
    save();
    SD.log('daily', 'new day ' + d + ': checks cleared');
    return true;
  }

  const CSS = `
    #sdial .dl button{height:var(--sd-h);border-radius:8px;border:1px solid var(--sd-line);background:var(--sd-bg2);color:var(--sd-text2);font-size:12px;padding:0 10px}
    #sdial .dl button:active{background:var(--sd-hov)}
    #sdial .dl .mainv,#sdial .dl .addv{display:none}
    #sdial .dl:not(.adding) .mainv{display:block}
    #sdial .dl.adding .addv{display:block}
    #sdial .dl .pg{display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:12px;color:var(--sd-text2)}
    #sdial .dl .pg .bar{flex:1;height:6px;border-radius:3px;background:#2c2c2c;overflow:hidden}
    #sdial .dl .pg .bar i{display:block;height:100%;width:0;background:#4a8f4e;transition:width .2s}
    #sdial .dl .pg .tx.all{color:#7fd08a}
    #sdial .dl .list{max-height:46vh;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;touch-action:pan-y}
    #sdial .dl .tr{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:8px;margin-bottom:3px;background:var(--sd-bg2);border-left:3px solid #555;color:var(--sd-text);min-height:36px;user-select:none;-webkit-user-select:none}
    #sdial .dl .tr:active{background:var(--sd-hov)}
    #sdial .dl .tr.done{border-left-color:#4a8f4e}
    #sdial .dl .tr.done .nm{text-decoration:line-through;color:var(--sd-dim)}
    #sdial .dl .cb{flex:0 0 20px;width:20px;height:20px;border-radius:5px;border:2px solid #666;box-sizing:border-box;display:flex;align-items:center;justify-content:center}
    #sdial .dl .tr.done .cb{background:#4a8f4e;border-color:#4a8f4e}
    #sdial .dl .tr.done .cb::after{content:"\\2713";color:#fff;font-size:13px;line-height:1}
    #sdial .dl .tr .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
    #sdial .dl .tr .rm{display:none}
    #sdial .dl.ed .tr .rm{display:block;flex:0 0 var(--sd-h);width:var(--sd-h);height:var(--sd-h);padding:0;color:var(--sd-redt)}
    #sdial .dl.ed .tr .rm.arm{flex:0 0 auto;width:auto;padding:0 8px;border-color:var(--sd-red);background:#3a1f1d;color:#f1b5b0}
    #sdial .dl .em{padding:14px 6px;text-align:center;color:var(--sd-dim);font-size:12px;line-height:1.4}
    #sdial .dl .foot{display:flex;gap:6px;margin-top:6px;padding-top:6px;border-top:1px solid #2c2c2c}
    #sdial .dl .foot .add,#sdial .dl .foot .edit{flex:1;padding:0 4px}
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
          '<div class="foot"><button class="add">Add</button><button class="edit">Edit</button></div>' +
        '</div>' +
        '<div class="addv">' +
          '<div class="ah"><button class="back" aria-label="Back">' + BACK + '</button><input class="ti" type="text" maxlength="' + MAXT + '" placeholder="New task" autocomplete="off" spellcheck="false"><button class="ok">Add</button></div>' +
          '<div class="hint">Checks are cleared every day at midnight Torn time.</div>' +
        '</div>' +
      '</div>';
    const q = s => el.querySelector(s);
    const root = q('.dl'), list = q('.list'), ptx = q('.pg .tx'), pbar = q('.pg i'), ti = q('.ti');
    let armed = 0, armT = 0;

    function render() {
      const keep = list.scrollTop;
      const total = S.list.length, done = S.list.filter(t => t.done).length;
      ptx.textContent = total ? (done === total ? 'All done' : done + '/' + total) : '';
      ptx.classList.toggle('all', total > 0 && done === total);
      pbar.style.width = total ? Math.round(done / total * 100) + '%' : '0';
      list.innerHTML = '';
      if (!total) { list.innerHTML = '<div class="em">No tasks yet.<br>Tap Add.</div>'; return; }
      S.list.forEach(t => {
        const r = document.createElement('div');
        r.className = 'tr' + (t.done ? ' done' : '');
        r.dataset.id = t.id;
        r.innerHTML = '<span class="cb"></span><span class="nm"></span><button class="rm" aria-label="Delete"></button>';
        r.querySelector('.nm').textContent = t.t;
        const b = r.querySelector('.rm');
        if (armed === t.id) { b.textContent = 'Delete?'; b.classList.add('arm'); } else b.textContent = '\u2715';
        list.appendChild(r);
      });
      list.scrollTop = keep;
    }

    list.addEventListener('click', e => {
      const row = e.target.closest('.tr');
      if (!row) return;
      const id = +row.dataset.id, t = S.list.find(x => x.id === id);
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
      if (root.classList.contains('ed')) return;   // in Edit mode a tap on the row does nothing (avoids checking by accident)
      t.done = !t.done; save(); render();
    });
    q('.edit').addEventListener('click', e => {
      const on = root.classList.toggle('ed');
      SD.editBtn(e.currentTarget, on);
      armed = 0; render();
    });

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

    rollover();
    render();
    ctx.every(() => { if (rollover()) render(); }, 30000);   // a new day while the window stays open
    SD.log('daily', 'opened: ' + S.list.length + ' task(s)');
    return { unmount() { clearTimeout(armT); } };
  }

  SD.register({
    id: 'daily',
    label: 'Daily Checklist',
    width: 270,
    // checklist: boxes with a tick and lines
    icon: '<path d="M4 6l1.5 1.5L8 5"/><path d="M4 12l1.5 1.5L8 11"/><path d="M4 18l1.5 1.5L8 17"/><path d="M12 6h8M12 12h8M12 18h8"/>',
    mount
  });
})();
