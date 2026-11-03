// Speed Dial module: Show More v0.4.0
// The pinned "..." circle (sits just before Settings). It opens a launcher grid with every module that is NOT one of the
// (max 3) circles on screen: calculator, your own shortcuts, new modules. Tap a tile to open it.
//   - a module opens in its own window (the launcher closes); tap an already-open tile to close that window
//   - a shortcut (small arrow in the corner) leaves the page and opens its torn.com page
//   - Edit: drag a tile to a new place; Done saves it. The newest module or shortcut always lands at the END of the grid.
// Which modules stay on screen is chosen in Settings > Menu (that page can reorder Show More too).
(function () {
  'use strict';
  const SD = window.SpeedDial;
  if (!SD) return;

  const CSS = `
    #sdial .mr .gd{display:grid;grid-template-columns:repeat(4,1fr);gap:8px 2px}
    #sdial .mr .tl{min-width:0;padding:0;border:0;background:none;color:#cfcfcf;display:flex;flex-direction:column;align-items:center;gap:4px;touch-action:manipulation}
    #sdial .mr .tl .bx{position:relative;width:44px;height:44px;border-radius:12px;border:1px solid #333;background:#242424;display:flex;align-items:center;justify-content:center;font-size:22px;line-height:1}
    #sdial .mr .tl:active .bx{background:#2e2e2e}
    #sdial .mr .tl.act .bx{border-color:var(--st);background:#2b2b2b}
    #sdial .mr .tl .bx svg{width:22px;height:22px}
    #sdial .mr .tl .go{position:absolute;right:-4px;bottom:-4px;width:16px;height:16px;border-radius:50%;background:#1c1c1c;border:1px solid #3a3a3a;display:flex;align-items:center;justify-content:center}
    #sdial .mr .tl .go svg{width:10px;height:10px;stroke:#6fa3dc;stroke-width:2.6}
    #sdial .mr .tl .nm{width:100%;font-size:10.5px;line-height:1.15;text-align:center;word-break:break-word;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    #sdial .mr.ed .tl{touch-action:none;user-select:none;-webkit-user-select:none}
    #sdial .mr.ed .tl .bx{border-style:dashed;border-color:#5a5a5a}
    #sdial .mr .tl.drag{position:relative;z-index:5}
    #sdial .mr .tl.drag .bx{background:#383838;border-color:#8a8a8a;box-shadow:0 4px 12px rgba(0,0,0,.55)}
    #sdial .mr .em{padding:14px 6px;text-align:center;color:#8a8a8a;font-size:12px;line-height:1.4}
    #sdial .mr .hn{display:none;margin-top:8px;text-align:center;font-size:11px;color:#8a8a8a}
    #sdial .mr.ed .hn{display:block}
    #sdial .mr .rw{display:flex;gap:6px;margin-top:10px}
    #sdial .mr .rw button{flex:1;height:30px;border-radius:8px;border:1px solid #2c2c2c;background:none;color:#8a8a8a;font-size:11px;padding:0}
    #sdial .mr .rw button:active{background:#2e2e2e;color:#cfcfcf}
    #sdial .mr .rw .ed-b.on{border-color:#85b200;background:#25360f;color:#c6e66a}
  `;

  function mount(ctx) {
    SD.css('sd-more', CSS);
    const el = ctx.el;
    el.className = 'mr';
    el.innerHTML = '<div class="gd"></div><div class="hn">Drag a tile to move it</div>' +
      '<div class="rw"><button class="ed-b">Edit</button><button class="st-b">Settings</button></div>';
    const gd = el.querySelector('.gd'), eb = el.querySelector('.ed-b');
    let edit = false, drag = null;

    function render() {
      gd.innerHTML = '';
      gd.style.display = '';
      const list = SD.more();
      if (!list.length) {
        gd.style.display = 'block';
        const e = document.createElement('div');
        e.className = 'em';
        e.textContent = 'Nothing here. Every module is on screen.';
        gd.appendChild(e);
        return;
      }
      list.forEach(m => {
        const b = document.createElement('button');
        b.className = 'tl' + (SD.isOpen(m.id) ? ' act' : '');
        b._id = m.id;
        b.setAttribute('aria-label', m.label);
        b.innerHTML = '<span class="bx"></span><span class="nm"></span>';
        const bx = b.querySelector('.bx');
        if (m.emoji) bx.textContent = m.emoji; else bx.innerHTML = '<svg viewBox="0 0 24 24">' + m.icon + '</svg>';
        if (m.href) { const g = document.createElement('span'); g.className = 'go'; g.setAttribute('aria-hidden', 'true'); g.innerHTML = '<svg viewBox="0 0 24 24"><path d="M7 17L17 7"/><path d="M8 7h9v9"/></svg>'; bx.appendChild(g); }
        b.querySelector('.nm').textContent = m.label;
        b.addEventListener('click', () => {
          if (edit) return;                                             // in Edit a tap does nothing; dragging moves the tile
          if (m.href) { location.href = m.href; return; }
          if (SD.isOpen(m.id)) { SD.close(m.id); render(); return; }   // already open: this tap closes it
          ctx.close();                                                  // launcher out of the way, then open the module
          SD.open(m.id);
        });
        bindDrag(b);
        gd.appendChild(b);
      });
    }

    // ----- Edit: drag a tile; the others make room. Saved when you let go. -----
    function bindDrag(b) {
      b.addEventListener('pointerdown', e => {
        if (!edit || e.button > 0) return;
        const r = b.getBoundingClientRect();
        drag = { b, gx: e.clientX - r.left, gy: e.clientY - r.top };
        try { b.setPointerCapture(e.pointerId); } catch (err) {}
        b.classList.add('drag');
      });
      b.addEventListener('pointermove', e => {
        if (!drag || drag.b !== b) return;
        const tiles = Array.from(gd.children);
        const over = tiles.find(t => {
          if (t === b) return false;
          const r = t.getBoundingClientRect();
          return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        });
        if (over) {
          if (tiles.indexOf(over) > tiles.indexOf(b)) gd.insertBefore(b, over.nextSibling);
          else gd.insertBefore(b, over);
        }
        b.style.transform = '';                       // natural slot first, then follow the finger from there
        const n = b.getBoundingClientRect();
        b.style.transform = 'translate(' + (e.clientX - drag.gx - n.left) + 'px,' + (e.clientY - drag.gy - n.top) + 'px)';
      });
      const end = () => {
        if (!drag || drag.b !== b) return;
        drag = null;
        b.style.transform = '';
        b.classList.remove('drag');
        const ids = Array.from(gd.children).map(t => t._id).filter(Boolean);
        const A = SD.front().map(m => m.id);          // on-screen circles stay as they are; only Show More changes order
        if (ids.length) SD.setLayout(A.concat(ids), A);
        render();
      };
      b.addEventListener('pointerup', end);
      b.addEventListener('pointercancel', end);
    }

    eb.addEventListener('click', () => {
      edit = !edit;
      el.classList.toggle('ed', edit);
      eb.classList.toggle('on', edit);
      eb.textContent = edit ? 'Done' : 'Edit';
      render();
    });
    el.querySelector('.st-b').addEventListener('click', () => { ctx.close(); SD.open('settings'); });
    render();
  }

  SD.register({
    id: 'more',
    label: 'Show More',
    width: 244,
    pinned: true,
    more: true,
    ord: 900,
    // three dots
    icon: '<circle cx="5" cy="12" r="1.7" fill="#d0d0d0" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="#d0d0d0" stroke="none"/><circle cx="19" cy="12" r="1.7" fill="#d0d0d0" stroke="none"/>',
    mount
  });
})();
