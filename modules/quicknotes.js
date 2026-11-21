// Speed Dial module: Quick Notes v0.1.0
// A list of notes, each with its own title and text. Bottom bar: Add | Edit (same layout as Targets and Market).
//   - Add: opens a new empty note (title box + text box). Nothing is kept if you leave it empty.
//   - Tap a note to open it. Everything you type is saved as you type (a moment after you stop) and when you tap back or close the window.
//   - Edit: shows a red cross per note. Tap it once to arm it (it turns into "Delete?"), tap again to delete the note.
// Newest notes are on top. No API, nothing leaves the phone. Saved under speedDial.notes1 (Torn PDA's native storage, like everything else).
// Nothing runs while the window is closed.
(function () {
  'use strict';
  const SD = window.SpeedDial;
  if (!SD) return;

  const LS = 'speedDial.notes1';   // { list: [{ id, t: title, x: text, u: last change (ms) }], n: next id }
  const MAX = 60;                  // most notes
  const MAXT = 60;                 // title length
  const MAXX = 5000;               // text length
  const SAVE_MS = 400;             // wait after the last key press before saving

  const S = SD.read(LS, null) || {};
  if (!Array.isArray(S.list)) S.list = [];
  S.list = S.list.filter(n => n && typeof n.id === 'number').map(n => ({ id: n.id, t: String(n.t || ''), x: String(n.x || ''), u: +n.u || 0 }));
  if (typeof S.n !== 'number' || S.n <= S.list.reduce((m, n) => Math.max(m, n.id), 0)) S.n = S.list.reduce((m, n) => Math.max(m, n.id), 0) + 1;
  const save = () => SD.write(LS, S);

  const day = ms => {
    const d = new Date(ms), n = new Date();
    return d.toDateString() === n.toDateString() ? SD.hhmm(ms) : d.toLocaleDateString([], { day: '2-digit', month: 'short' });
  };

  const CSS = `
    #sdial .qn button{height:var(--sd-h);border-radius:8px;border:1px solid var(--sd-line);background:var(--sd-bg2);color:var(--sd-text2);font-size:12px;padding:0 10px}
    #sdial .qn button:active{background:var(--sd-hov)}
    #sdial .qn button:disabled{opacity:.4}
    #sdial .qn .mainv,#sdial .qn .ev{display:none}
    #sdial .qn:not(.editing) .mainv{display:block}
    #sdial .qn.editing .ev{display:block}
    #sdial .qn .list{max-height:46vh;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;touch-action:pan-y}
    #sdial .qn .nr{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:8px;margin-bottom:3px;background:var(--sd-bg2);border-left:3px solid #555;color:var(--sd-text);user-select:none;-webkit-user-select:none}
    #sdial .qn .nr:active{background:var(--sd-hov)}
    #sdial .qn .nr .t{flex:1;min-width:0}
    #sdial .qn .nr .nm{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
    #sdial .qn .nr .nm.un{color:var(--sd-dim)}
    #sdial .qn .nr .sub{display:block;color:var(--sd-dim);font-size:11px;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #sdial .qn .nr .dt{flex:0 0 auto;color:var(--sd-dim);font-size:11px;white-space:nowrap}
    #sdial .qn .nr .rm{display:none;flex:0 0 var(--sd-h);width:var(--sd-h);height:var(--sd-h);padding:0;color:var(--sd-redt)}
    #sdial .qn .nr .rm.arm{flex:0 0 auto;width:auto;padding:0 8px;border-color:var(--sd-red);background:#3a1f1d;color:#f1b5b0}
    #sdial .qn.ed .nr .rm{display:block}
    #sdial .qn.ed .nr .dt{display:none}
    #sdial .qn .em{padding:14px 6px;text-align:center;color:var(--sd-dim);font-size:12px;line-height:1.4}
    #sdial .qn .foot{display:flex;gap:6px;margin-top:6px;padding-top:6px;border-top:1px solid #2c2c2c}
    #sdial .qn .foot .add,#sdial .qn .foot .edit{flex:1;padding:0 4px}
    #sdial .qn .ah{display:flex;align-items:center;gap:8px;margin-bottom:6px;color:var(--sd-text);font-size:13px}
    #sdial .qn .ah .back{flex:0 0 36px;width:36px;padding:0;display:flex;align-items:center;justify-content:center}
    #sdial .qn .ti,#sdial .qn .tx{width:100%;box-sizing:border-box;border-radius:8px;border:1px solid var(--sd-line2);background:var(--sd-bg2);color:var(--sd-text);font-size:16px;padding:0 10px;outline:none;font-family:inherit}
    #sdial .qn .ti{flex:1;min-width:0;width:auto;height:var(--sd-hi)}
    #sdial .qn .tx{display:block;height:38vh;min-height:150px;padding:8px 10px;line-height:1.4;resize:none;touch-action:pan-y;overscroll-behavior:contain}
    #sdial .qn .ti:focus,#sdial .qn .tx:focus{border-color:var(--sd-blue)}
    #sdial .qn .meta{color:var(--sd-dim);font-size:11px;margin-top:5px;display:flex;justify-content:space-between;line-height:1.35}
  `;

  const BACK = '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>';

  function mount(ctx) {
    SD.css('sd-notes', CSS);
    const el = ctx.el;
    el.innerHTML =
      '<div class="qn">' +
        '<div class="mainv">' +
          '<div class="list"></div>' +
          '<div class="foot"><button class="add">Add</button><button class="edit">Edit</button></div>' +
        '</div>' +
        '<div class="ev">' +
          '<div class="ah"><button class="back" aria-label="Back">' + BACK + '</button><input class="ti" type="text" maxlength="' + MAXT + '" placeholder="Title" autocomplete="off" spellcheck="false"></div>' +
          '<textarea class="tx" maxlength="' + MAXX + '" placeholder="Write here..." spellcheck="false"></textarea>' +
          '<div class="meta"><span class="sv"></span><span class="ct"></span></div>' +
        '</div>' +
      '</div>';
    const q = s => el.querySelector(s);
    const root = q('.qn'), list = q('.list'), ti = q('.ti'), tx = q('.tx'), sv = q('.sv'), ct = q('.ct');
    let cur = null, timer = 0, armed = 0, armT = 0;   // cur = the note open in the editor

    // ----- list -----
    function render() {
      const keep = list.scrollTop;
      list.innerHTML = '';
      if (!S.list.length) {
        list.innerHTML = '<div class="em">No notes yet.<br>Tap Add.</div>';
        return;
      }
      S.list.forEach(n => {
        const row = document.createElement('div');
        row.className = 'nr';
        row.dataset.id = n.id;
        row.innerHTML = '<span class="t"><span class="nm"></span><span class="sub"></span></span><span class="dt"></span><button class="rm" aria-label="Delete">\u2715</button>';
        const nm = row.querySelector('.nm');
        nm.textContent = n.t.trim() || 'Untitled';
        if (!n.t.trim()) nm.classList.add('un');
        row.querySelector('.sub').textContent = n.x.replace(/\s+/g, ' ').trim() || 'Empty';
        row.querySelector('.dt').textContent = n.u ? day(n.u) : '';
        if (armed === n.id) { const b = row.querySelector('.rm'); b.textContent = 'Delete?'; b.classList.add('arm'); }
        list.appendChild(row);
      });
      list.scrollTop = keep;
    }

    // ----- editor -----
    function counter() { ct.textContent = tx.value.length + ' / ' + MAXX; }
    function commit() {   // DOM -> note (only touches the note when something changed)
      clearTimeout(timer); timer = 0;
      if (!cur) return;
      if (cur.t !== ti.value || cur.x !== tx.value) {
        cur.t = ti.value; cur.x = tx.value; cur.u = Date.now();
        save();
        sv.textContent = 'Saved ' + SD.hhmm(cur.u);
      }
    }
    const later = () => { counter(); sv.textContent = 'Typing...'; clearTimeout(timer); timer = setTimeout(commit, SAVE_MS); };
    ti.addEventListener('input', later);
    tx.addEventListener('input', later);

    function open(n, fresh) {
      cur = n;
      ti.value = n.t;
      tx.value = n.x;
      sv.textContent = n.u && !fresh ? 'Saved ' + day(n.u) : '';
      counter();
      root.classList.add('editing');
      if (fresh) ti.focus();
    }
    function back() {
      commit();
      const n = cur;
      cur = null;
      root.classList.remove('editing');
      ti.blur(); tx.blur();
      if (n && !n.t.trim() && !n.x.trim()) {   // nothing written: do not keep an empty note
        S.list = S.list.filter(x => x !== n);
        save();
      }
      render();
    }
    q('.back').addEventListener('click', back);

    function add() {
      if (S.list.length >= MAX) return SD.toast('Max ' + MAX + ' notes');
      const n = { id: S.n++, t: '', x: '', u: 0 };
      S.list.unshift(n);   // newest on top (dropped again by back() when left empty)
      open(n, true);
    }

    // ----- events -----
    q('.add').addEventListener('click', add);
    q('.edit').addEventListener('click', e => {
      const on = root.classList.toggle('ed');
      SD.editBtn(e.currentTarget, on);
      armed = 0; render();
    });
    list.addEventListener('click', e => {
      const row = e.target.closest('.nr');
      if (!row) return;
      const id = +row.dataset.id;
      if (e.target.closest('.rm')) {
        if (armed !== id) {   // first tap arms, second tap deletes
          armed = id;
          clearTimeout(armT);
          armT = setTimeout(() => { armed = 0; if (ctx.alive && !cur) render(); }, 3000);
          render();
          return;
        }
        S.list = S.list.filter(n => n.id !== id);
        armed = 0;
        save();
        SD.log('notes', 'deleted note ' + id);
        render();
        return;
      }
      if (root.classList.contains('ed')) return;   // in Edit mode a tap on the row does nothing (avoids opening by accident)
      const n = S.list.find(x => x.id === id);
      if (n) open(n, false);
    });

    render();
    SD.log('notes', 'opened: ' + S.list.length + ' note(s)');
    return {
      unmount() {
        commit();
        clearTimeout(armT);
        if (cur && !cur.t.trim() && !cur.x.trim()) { S.list = S.list.filter(x => x !== cur); save(); }   // window closed on an empty new note
        cur = null;
      }
    };
  }

  SD.register({
    id: 'notes',
    label: 'Quick Notes',
    width: 270,
    // note with lines
    icon: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h5"/>',
    mount
  });
})();
