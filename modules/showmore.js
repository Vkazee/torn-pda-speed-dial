// Speed Dial module: Show More v0.6.0
// The pinned "..." circle (sits just before Settings). It opens a launcher grid with every module that is NOT one of the
// (max 3) circles on screen: calculator, your own shortcuts, new modules. Tap a tile to open it.
//   - a module opens in its own window (the launcher closes); tap an already-open tile to close that window
//   - a shortcut (small arrow in the corner) leaves the page and opens its torn.com page
//   - Settings: opens Settings > Menu already in edit mode (the one place that reorders, pins and deletes)
// Which modules stay on screen, and the order of everything, is chosen in Settings > Menu. The newest module or shortcut always lands at the END of the grid.
(function () {
  'use strict';
  const SD = window.SpeedDial;
  if (!SD) return;

  const CSS = `
    #sdial .mr .gd{display:grid;grid-template-columns:repeat(4,1fr);gap:8px 2px}
    #sdial .mr .tl{min-width:0;padding:0;border:0;background:none;color:var(--sd-text2);display:flex;flex-direction:column;align-items:center;gap:4px;touch-action:manipulation}
    #sdial .mr .tl .bx{position:relative;width:44px;height:44px;border-radius:12px;border:1px solid var(--sd-line);background:var(--sd-bg2);display:flex;align-items:center;justify-content:center;font-size:22px;line-height:1}
    #sdial .mr .tl:active .bx{background:var(--sd-hov)}
    #sdial .mr .tl.act .bx{border-color:var(--st);background:#2b2b2b}
    #sdial .mr .tl .bx svg{width:22px;height:22px}
    #sdial .mr .tl .go{position:absolute;right:-4px;bottom:-4px;width:16px;height:16px;border-radius:50%;background:var(--sd-bg);border:1px solid var(--sd-line2);display:flex;align-items:center;justify-content:center}
    #sdial .mr .tl .go svg{width:10px;height:10px;stroke:var(--sd-bluet);stroke-width:2.6}
    #sdial .mr .tl .nm{width:100%;font-size:10.5px;line-height:1.15;text-align:center;word-break:break-word;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    #sdial .mr .em{padding:14px 6px;text-align:center;color:var(--sd-dim);font-size:12px;line-height:1.4}
    #sdial .mr .rw{display:flex;gap:6px;margin-top:10px}
    #sdial .mr .rw button{flex:1;height:var(--sd-h);border-radius:8px;border:1px solid var(--sd-line);background:var(--sd-bg2);color:var(--sd-text2);font-size:12px;padding:0}
    #sdial .mr .rw button:active{background:var(--sd-hov)}
  `;

  function mount(ctx) {
    SD.css('sd-more', CSS);
    const el = ctx.el;
    el.className = 'mr';
    el.innerHTML = '<div class="gd"></div>' +
      '<div class="rw"><button class="st-b">Settings</button></div>';
    const gd = el.querySelector('.gd');

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
          if (m.href) { location.href = m.href; return; }
          if (SD.isOpen(m.id)) { SD.close(m.id); render(); return; }   // already open: this tap closes it
          ctx.close();                                                  // launcher out of the way, then open the module
          SD.open(m.id);
        });
        gd.appendChild(b);
      });
    }

    // Settings = Settings > Menu in edit mode (it reorders both groups, pins/unpins and deletes shortcuts); this window only launches
    el.querySelector('.st-b').addEventListener('click', () => { ctx.close(); SD.open('settings', { page: 'pm', edit: true }); });
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
