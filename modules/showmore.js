// Speed Dial module: Show More v0.2.0
// The pinned "..." circle (sits just before Settings). It opens a launcher grid with every module that is NOT one of the
// (max 3) circles on screen: calculator, your own shortcuts, new modules. Tap a tile to open it.
//   - a module opens in its own window (the launcher closes); tap an already-open tile to close that window
//   - a shortcut (small arrow in the corner) leaves the page and opens its torn.com page
// Which modules stay on screen is chosen in Settings > Menu.
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
    #sdial .mr .tl .go{position:absolute;top:2px;right:4px;font-size:9px;color:#6fa3dc;line-height:1}
    #sdial .mr .tl .nm{width:100%;font-size:10.5px;line-height:1.15;text-align:center;word-break:break-word;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    #sdial .mr .em{padding:14px 6px;text-align:center;color:#8a8a8a;font-size:12px;line-height:1.4}
    #sdial .mr .ft{width:100%;height:30px;margin-top:10px;border-radius:8px;border:1px solid #2c2c2c;background:none;color:#8a8a8a;font-size:11px;padding:0}
    #sdial .mr .ft:active{background:#2e2e2e;color:#cfcfcf}
  `;

  function mount(ctx) {
    SD.css('sd-more', CSS);
    const el = ctx.el;
    el.className = 'mr';
    el.innerHTML = '<div class="gd"></div><button class="ft">Choose what stays on screen</button>';
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
        b.setAttribute('aria-label', m.label);
        b.innerHTML = '<span class="bx"></span><span class="nm"></span>';
        const bx = b.querySelector('.bx');
        if (m.emoji) bx.textContent = m.emoji; else bx.innerHTML = '<svg viewBox="0 0 24 24">' + m.icon + '</svg>';
        if (m.href) { const g = document.createElement('span'); g.className = 'go'; g.setAttribute('aria-hidden', 'true'); g.textContent = '\u2197'; bx.appendChild(g); }
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

    el.querySelector('.ft').addEventListener('click', () => { ctx.close(); SD.open('settings'); });
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
    icon: '<circle cx="5" cy="12" r="1.1"/><circle cx="12" cy="12" r="1.1"/><circle cx="19" cy="12" r="1.1"/>',
    mount
  });
})();
