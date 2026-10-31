// Speed Dial module: Settings v0.4.0
// The pinned gear circle (always last, cannot be hidden). Three pages:
//   Menu          - every module in your order. Eye = show/hide the circle. Edit mode: drag the handle to reorder,
//                   and remove your own shortcuts.
//   Features      - on/off switch for every page feature (things that run on a Torn page, outside the circles).
//                   The "!" next to a feature opens a small pop-up with a one-line explanation.
//   Shortcut      - your own emoji circles that open a torn.com page (this is the old "Add shortcut" module).
// Nothing is read from or clicked on the page. Only torn.com pages are accepted.
(function () {
  'use strict';
  const SD = window.SpeedDial;
  if (!SD) return;

  const LS = 'speedDial.shortcuts1';   // same key as the old Shortcuts module, so saved shortcuts carry over
  const MAX = 8;
  const QUICK = ['\u{1F3E0}', '\u{1F6D2}', '\u{1F3E6}', '\u{1F3B0}', '\u2694\uFE0F', '\u{1F3E5}', '\u{1F4BC}', '\u{1F4E6}', '\u{1F3AF}', '\u2B50'];
  let list = SD.read(LS, []);
  if (!Array.isArray(list)) list = [];
  const save = () => SD.write(LS, list);

  const sid = s => 'sc-' + s.id;
  const reg = s => SD.register({ id: sid(s), label: s.n, emoji: s.e, href: s.u, ord: 500 });
  list.forEach(reg);

  // torn.com page only: "/bazaar.php", "torn.com/bazaar.php" or "https://www.torn.com/bazaar.php"
  const fixUrl = raw => {
    let u = String(raw || '').trim();
    if (!u) return '';
    if (u[0] === '/') return (u[1] === '/' || u[1] === '\\') ? '' : u;
    if (/^(www\.)?torn\.com\//i.test(u)) u = 'https://' + u;
    return /^https:\/\/(www\.)?torn\.com\//i.test(u) ? u : '';
  };

  // first emoji of the input (keeps skin tones and combined emoji in one piece)
  let PICT;
  try { PICT = new RegExp('\\p{Extended_Pictographic}', 'u'); } catch (e) { PICT = /[^\x00-\x7F]/; }
  const firstChar = s => {
    try {
      if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        const it = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)[Symbol.iterator]().next();
        return it.done ? '' : it.value.segment;
      }
    } catch (e) {}
    return Array.from(s)[0] || '';
  };
  const emojiOf = raw => {
    const s = String(raw || '').trim();
    if (!s) return '\u2B50';
    const g = firstChar(s);
    return PICT.test(g) ? g : '';
  };

  const EYE = '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7c2 0 3.7.7 5.2 1.7M22 12s-3.6 7-10 7c-2 0-3.7-.7-5.2-1.7"/><path d="M4 4l16 16"/></svg>';
  const GRIP = '<svg viewBox="0 0 24 24"><line x1="5" y1="8" x2="19" y2="8"/><line x1="5" y1="12" x2="19" y2="12"/><line x1="5" y1="16" x2="19" y2="16"/></svg>';

  const CSS = `
    #sdial .cz .tabs{display:flex;gap:4px;margin-bottom:6px}
    #sdial .cz .tabs button{flex:1}
    #sdial .cz .tabs button.on{background:#383838;color:#e6e6e6;border-color:#5a5a5a}
    #sdial .cz .pg{display:none}
    #sdial .cz .pg.on{display:block}
    #sdial .cz .qk{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px}
    #sdial .cz .qk button{flex:0 0 auto;width:30px;height:30px;font-size:16px;padding:0}
    #sdial .cz .rw{display:flex;gap:6px;margin-bottom:6px}
    #sdial .cz input{min-width:0;height:32px;border-radius:8px;border:1px solid #333;background:#242424;color:#e6e6e6;font-size:13px;padding:0 8px}
    #sdial .cz .ie{flex:0 0 64px;text-align:center;font-size:16px}
    #sdial .cz .in,#sdial .cz .iu{flex:1}
    #sdial .cz button{height:32px;border-radius:8px;border:1px solid #333;background:#242424;color:#cfcfcf;font-size:12px;padding:0 8px}
    #sdial .cz button:active{background:#2e2e2e}
    #sdial .cz .add,#sdial .cz .edit{width:100%}
    #sdial .cz .lst{max-height:36vh;overflow-y:auto;touch-action:pan-y;margin-bottom:6px}
    #sdial .cz .it{display:flex;align-items:center;gap:8px;height:34px;padding:0 4px 0 10px;border-radius:8px;background:#242424;margin-bottom:3px;user-select:none;-webkit-user-select:none}
    #sdial .cz .it.drag{position:relative;z-index:5;background:#383838;box-shadow:0 4px 12px rgba(0,0,0,.55)}
    #sdial .cz .it .ix{width:20px;display:flex;align-items:center;justify-content:center;font-size:16px;flex:0 0 auto}
    #sdial .cz .it .ix svg{width:18px;height:18px}
    #sdial .cz .it .nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #sdial .cz .it.off .ix,#sdial .cz .it.off .nm{opacity:.4}
    #sdial .cz .it .grip{display:none;align-items:center;justify-content:center;width:30px;height:34px;margin:0 0 0 -10px;touch-action:none;cursor:grab;flex:0 0 auto}
    #sdial .cz .it .grip svg{width:18px;height:18px;stroke:#8a8a8a}
    #sdial .cz.edit .it .grip{display:flex}
    #sdial .cz .it.drag .grip svg{stroke:#e6e6e6}
    #sdial .cz .it .btn{height:26px;width:30px;padding:0;display:flex;align-items:center;justify-content:center;flex:0 0 auto}
    #sdial .cz .it .btn svg{width:16px;height:16px}
    #sdial .cz .it .del{display:none;color:#f1807a}
    #sdial .cz.edit .it.cu .del{display:flex}
    #sdial .cz .fl{max-height:42vh;overflow-y:auto;touch-action:pan-y;margin-bottom:2px}
    #sdial .cz .fe{padding:10px 4px;color:#8a8a8a;font-size:12px;text-align:center}
    #sdial .cz .fw{border-radius:8px;background:#242424;margin-bottom:3px}
    #sdial .cz .fr{display:flex;align-items:center;gap:8px;min-height:40px;padding:0 8px 0 10px}
    #sdial .cz .fr .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #sdial .cz .fr .inf{flex:0 0 auto;width:26px;height:26px;padding:0;border-radius:50%;border:1px solid #4a4a4a;background:none;color:#9a9a9a;font-size:13px;font-weight:700;line-height:1}
    #sdial .cz .fr .inf:active{background:#383838;border-color:#8a8a8a;color:#e6e6e6}
    #sdial .cz .fr .sw{flex:0 0 auto;position:relative;width:40px;height:24px;padding:0;border-radius:12px;border:1px solid #444;background:#1a1a1a;transition:background .12s,border-color .12s}
    #sdial .cz .fr .sw i{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#777;transition:transform .12s,background .12s}
    #sdial .cz .fr .sw.on{background:#25360f;border-color:#85b200}
    #sdial .cz .fr .sw.on i{transform:translateX(16px);background:#85b200}
    #sdial .sdtip{position:fixed;left:0;top:0;right:0;bottom:0;z-index:5000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.5)}
    #sdial .sdtip .tc{width:100%;max-width:240px;padding:12px 14px;border-radius:12px;border:1px solid var(--st);background:#1c1c1c;color:#e6e6e6;box-shadow:0 8px 24px rgba(0,0,0,.6)}
    #sdial .sdtip .th{font-size:13px;font-weight:700}
    #sdial .sdtip .tx{margin-top:4px;font-size:12px;line-height:1.4;color:#bdbdbd}
    #sdial .sdtip .tp{margin-top:8px;padding-top:8px;border-top:1px solid #2c2c2c;font-size:12px;color:#9a9a9a}
    #sdial .sdtip .tp b{font-weight:400;color:#e6e6e6}
    #sdial .sdtip .tk{width:100%;height:32px;margin-top:10px;padding:0 8px;border-radius:8px;border:1px solid #333;background:#242424;color:#cfcfcf;font-size:12px}
    #sdial .sdtip .tk:active{background:#2e2e2e}
  `;

  function mount(ctx) {
    SD.css('sd-settings', CSS);
    const el = ctx.el;
    el.className = 'cz';
    el.innerHTML =
      '<div class="tabs"><button class="tb on" data-p="pm">Menu</button><button class="tb" data-p="pf">Features</button><button class="tb" data-p="pa">Shortcut</button></div>' +
      '<div class="pg pm on"><div class="lst"></div><button class="edit">Edit</button></div>' +
      '<div class="pg pf"><div class="fl"></div></div>' +
      '<div class="pg pa">' +
        '<div class="qk"></div>' +
        '<div class="rw"><input class="ie" maxlength="12" placeholder="Emoji" autocomplete="off"><input class="in" maxlength="20" placeholder="Name" autocomplete="off"></div>' +
        '<div class="rw"><input class="iu" placeholder="/page.php?sid=..." autocomplete="off" autocapitalize="off" spellcheck="false"><button class="here">This page</button></div>' +
        '<button class="add">Add</button>' +
      '</div>';
    const qk = el.querySelector('.qk'), lst = el.querySelector('.lst'), fl = el.querySelector('.fl');
    const inE = el.querySelector('.ie'), inN = el.querySelector('.in'), inU = el.querySelector('.iu');
    let drag = null;

    // ----- pages -----
    el.querySelectorAll('.tb').forEach(b => b.addEventListener('click', () => {
      closeTip();
      el.querySelectorAll('.tb').forEach(x => x.classList.toggle('on', x === b));
      el.querySelectorAll('.pg').forEach(p => p.classList.toggle('on', p.classList.contains(b.dataset.p)));
      if (b.dataset.p === 'pm') renderList();
      if (b.dataset.p === 'pf') renderFeat();
    }));

    // ----- features page: on/off per feature, "!" opens a small pop-up -----
    let tip = null;
    function closeTip() { if (tip) { tip.remove(); tip = null; } }
    // lives in #sdial (not inside the window, which clips and moves), so it is centred on the screen
    function openTip(f) {
      closeTip();
      const t = document.createElement('div');
      t.className = 'sdtip';
      t.innerHTML = '<div class="tc" role="dialog"><div class="th"></div><div class="tx"></div><div class="tp"><b>Runs on:</b> <span></span></div><button class="tk">OK</button></div>';
      t.querySelector('.th').textContent = f.label;
      t.querySelector('.tx').textContent = f.info || '';
      const tp = t.querySelector('.tp');
      if (f.where) tp.querySelector('span').textContent = f.where; else tp.remove();
      t.addEventListener('click', e => { if (e.target === t || e.target.closest('.tk')) closeTip(); });
      (document.getElementById('sdial') || document.body).appendChild(t);
      tip = t;
    }

    function renderFeat() {
      closeTip();
      fl.innerHTML = '';
      if (!SD.features.length) {
        const e = document.createElement('div');
        e.className = 'fe';
        e.textContent = 'No features installed yet.';
        fl.appendChild(e);
        return;
      }
      SD.features.forEach(f => {
        const w = document.createElement('div');
        w.className = 'fw';
        w.innerHTML = '<div class="fr"><span class="nm"></span><button class="inf" aria-label="About this feature">!</button>' +
          '<button class="sw" role="switch"><i></i></button></div>';
        w.querySelector('.nm').textContent = f.label;
        const sw = w.querySelector('.sw');
        const paint = () => {
          const on = SD.featureOn(f.id);
          sw.classList.toggle('on', on);
          sw.setAttribute('aria-checked', on ? 'true' : 'false');
        };
        paint();
        w.querySelector('.inf').addEventListener('click', () => openTip(f));
        sw.addEventListener('click', () => {
          const now = !SD.featureOn(f.id);
          SD.setFeature(f.id, now);
          paint();
          if (now && !SD.featureFits(f.id) && f.where) SD.toast(f.label + ' is on. It starts on: ' + f.where);
        });
        fl.appendChild(w);
      });
    }

    // ----- add shortcut page -----
    QUICK.forEach(e => {
      const b = document.createElement('button');
      b.textContent = e;
      b.addEventListener('click', () => { inE.value = e; });
      qk.appendChild(b);
    });

    // fill the form from the page you are on right now (address only, nothing else is read)
    el.querySelector('.here').addEventListener('click', () => {
      inU.value = location.pathname + location.search + location.hash;
      if (!inN.value) inN.value = (document.title || '').replace(/\s*[|\u2013-]\s*TORN.*$/i, '').trim().slice(0, 20);
    });

    el.querySelector('.add').addEventListener('click', () => {
      if (list.length >= MAX) { SD.toast('Maximum ' + MAX + ' shortcuts'); return; }
      const e = emojiOf(inE.value), n = inN.value.trim().slice(0, 20), u = fixUrl(inU.value);
      if (!e) { SD.toast('Emoji must be an emoji'); return; }
      if (!n) { SD.toast('Enter a name'); return; }
      if (!u) { SD.toast('Use a torn.com page'); return; }
      const s = { id: Date.now().toString(36), e, n, u };
      list.push(s);
      save();
      reg(s);
      inE.value = inN.value = inU.value = '';
      SD.toast('Added ' + n);
    });

    // ----- menu page -----
    const hiddenIds = () => SD.ordered().map(m => m.id).filter(id => SD.isHidden(id));
    const orderIds = () => SD.ordered().map(m => m.id);

    function renderList() {
      if (drag) return;
      lst.innerHTML = '';
      SD.ordered().forEach(m => {
        const off = SD.isHidden(m.id);
        const custom = list.some(s => sid(s) === m.id);
        const r = document.createElement('div');
        r.className = 'it' + (off ? ' off' : '') + (custom ? ' cu' : '');
        r._id = m.id;
        r.innerHTML = '<span class="grip" aria-label="Drag to reorder">' + GRIP + '</span><span class="ix"></span><span class="nm"></span>' +
          '<button class="btn del" aria-label="Delete">\u2715</button><button class="btn eye" aria-label="Show or hide"></button>';
        const ix = r.querySelector('.ix');
        if (m.emoji) ix.textContent = m.emoji; else ix.innerHTML = '<svg viewBox="0 0 24 24">' + m.icon + '</svg>';
        r.querySelector('.nm').textContent = m.label;
        r.querySelector('.eye').innerHTML = off ? EYE_OFF : EYE;
        r.querySelector('.eye').addEventListener('click', () => {
          const h = hiddenIds().filter(id => id !== m.id);
          if (!off) h.push(m.id);
          SD.setLayout(orderIds(), h);
          renderList();
        });
        r.querySelector('.del').addEventListener('click', () => {
          list = list.filter(s => sid(s) !== m.id);
          save();
          SD.unregister(m.id);
          renderList();
        });
        bindDrag(r);
        lst.appendChild(r);
      });
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
        lst.insertBefore(row.nextElementSibling, row); drag.startY += h; dy -= h;
      }
      while (dy < -h / 2 && row.previousElementSibling) {
        lst.insertBefore(row.previousElementSibling, row.nextSibling); drag.startY -= h; dy += h;   // move the neighbour, not the dragged row
      }
      row.style.transform = 'translateY(' + dy + 'px)';
    }

    const EDGE = 36;   // px from the list's top/bottom edge where scrolling starts
    function autoScroll() {
      if (!drag) return;
      if (!ctx.alive) { drag = null; return; }
      const r = lst.getBoundingClientRect();
      let v = 0;
      if (drag.y < r.top + EDGE) v = -(2 + 10 * Math.min(1, (r.top + EDGE - drag.y) / EDGE));
      else if (drag.y > r.bottom - EDGE) v = 2 + 10 * Math.min(1, (drag.y - (r.bottom - EDGE)) / EDGE);
      if (v) {
        const before = lst.scrollTop;
        lst.scrollTop = before + v;
        const moved = lst.scrollTop - before;
        if (moved) { drag.startY -= moved; moveDrag(); }   // the row keeps following the finger
      }
      drag.raf = requestAnimationFrame(autoScroll);
    }

    function endDrag() {
      if (!drag) return;
      cancelAnimationFrame(drag.raf);
      const order = Array.from(lst.children).map(r => r._id).filter(Boolean);
      drag = null;
      if (order.length) SD.setLayout(order, hiddenIds());
      renderList();
    }

    el.querySelector('.edit').addEventListener('click', e => {
      const on = el.classList.toggle('edit');
      e.target.textContent = on ? 'Done' : 'Edit';
    });

    renderList();
    return { unmount: closeTip };
  }

  SD.register({
    id: 'settings',
    label: 'Settings',
    width: 250,
    pinned: true,
    // gear
    icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    mount
  });
})();
