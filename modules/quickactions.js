// Speed Dial module: Quick Actions v0.1.0
// Reads the shared player status (the same data that colours the main circle) and shows the 1-3 most useful actions
// for what you are doing right now: landed abroad, energy full, hospital over, ...
// No API of its own and no saved data: it only reads SD.peek() / SD.data(). Nothing runs while the window is closed.
// To remove it: delete this file and its line in manifest.json.
(function () {
  'use strict';
  const SD = window.SpeedDial;
  if (!SD) return;

  const MAX_ROWS = 3;
  const ATTACK_ENERGY = 25;     // an attack costs 25 energy
  const SOON = 30 * 60;         // seconds: "full in ..." is only worth showing within this time
  const PAGE = { gym: '/gym.php', crimes: '/loader.php?sid=crimes', jail: '/jailview.php', hospital: '/hospitalview.php', travel: '/page.php?sid=travel' };

  // ---------- rules: status in, ordered list of actions out (pure, no DOM) ----------
  // row = { key, kind: 'hot' (do it now) | 'go' | 'info', title(), sub(), act: { go: '/path' } | { open: 'moduleId' } | null }
  function plan(D, now) {
    const rows = [];
    const e = Math.max(0, (now - D.t) / 1000);                      // seconds since the status was fetched
    const secLeft = ts => ts - Math.floor(now / 1000);
    const bar = k => D[k] && D[k].maximum > 0 ? D[k] : null;
    const full = b => !!b && (b.current >= b.maximum || (b.fulltime || 0) - e <= 0);
    const toFull = b => Math.max(0, (b.fulltime || 0) - e);
    const cd = k => Math.max(0, ((D.cd || {})[k] || 0) - e);
    const mode = SD.mode(D);
    const add = (key, kind, title, sub, act) => rows.push({ key, kind, title, sub, act });

    if (mode === 'flying') {
      add('fly', 'info', () => { const l = Math.max(0, D.left - (Date.now() - D.t) / 1000); return l > 0 ? 'Landing in ' + SD.durS(l) : 'Landed'; }, () => D.dest || '', null);
      add('tv', 'go', () => 'Travel Helper', () => 'stock and flight times', { open: 'travel' });
    } else if (mode === 'abroad') {
      if (D.state === 'Hospital') {
        add('habroad', 'info', () => 'In hospital abroad', () => { const l = secLeft(D.until); return l > 0 ? SD.dur(l) + ' left, you cannot fly yet' : 'about to be released'; }, null);
      } else {
        add('home', 'hot', () => 'Fly home', () => 'in ' + (D.dest || 'abroad') + ' now', { go: PAGE.travel });
      }
      add('tv', 'go', () => 'Travel Helper', () => 'stock and flight times', { open: 'travel' });
    } else if (D.state === 'Hospital') {
      add('hosp', 'info', () => 'In hospital', () => { const l = secLeft(D.until); return l > 0 ? SD.dur(l) + ' left' : 'about to be released'; }, { go: PAGE.hospital });
      add('med', 'go', () => 'Item Dock', () => cd('medical') > 0 ? 'medical cooldown ' + SD.dur(cd('medical')) : 'medical cooldown ready', { open: 'itemdock' });
    } else if (D.state === 'Jail' || D.state === 'Federal') {
      add('jail', 'info', () => D.state === 'Jail' ? 'In jail' : 'In federal jail', () => { const l = secLeft(D.until); return l > 0 ? SD.dur(l) + ' left' : 'about to be released'; }, D.state === 'Jail' ? { go: PAGE.jail } : null);
    } else {
      const en = bar('energy'), nv = bar('nerve');
      if (full(en)) add('en', 'hot', () => 'Energy is full', () => en.maximum + ' / ' + en.maximum + ', go train', { go: PAGE.gym });
      if (full(nv)) add('nv', 'hot', () => 'Nerve is full', () => 'time for a crime', { go: PAGE.crimes });
      if (en && !full(en) && toFull(en) < SOON) add('ensoon', 'info', () => 'Energy full in ' + SD.dur(toFull(en)), () => '', { go: PAGE.gym });
      if (en && en.current >= ATTACK_ENERGY) add('tg', 'go', () => 'Targets', () => 'you have the energy to attack', { open: 'targets' });
      add('it', 'go', () => 'Item Dock', () => 'use an item', { open: 'itemdock' });
    }
    return rows.slice(0, MAX_ROWS);
  }

  // ---------- header + cooldown line ----------
  function headOf(D, now) {
    const mode = SD.mode(D), l = D.until - Math.floor(now / 1000);
    if (mode === 'flying') return ['var(--sd-blue)', 'Traveling'];
    if (mode === 'abroad') return ['var(--sd-blue)', 'Abroad' + (D.dest ? ' - ' + D.dest : '')];
    if (D.state === 'Hospital') return ['var(--sd-yel)', 'Hospital' + (l > 0 ? ' - ' + SD.dur(l) : '')];
    if (D.state === 'Jail' || D.state === 'Federal') return ['var(--sd-red)', (D.state === 'Jail' ? 'Jail' : 'Federal') + (l > 0 ? ' - ' + SD.dur(l) : '')];
    return ['var(--sd-green)', 'Okay'];
  }
  function cdLine(D, now) {
    const e = Math.max(0, (now - D.t) / 1000);
    return [['drug', 'Drug'], ['medical', 'Medical'], ['booster', 'Booster']].map(([k, n]) => {
      const r = Math.max(0, ((D.cd || {})[k] || 0) - e);
      return n + ' ' + (r > 0 ? SD.dur(r) : 'ready');
    }).join('  \u00b7  ');
  }

  const CSS = `
    #sdial .qa .hd{display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:13px;color:var(--sd-text)}
    #sdial .qa .hd i{flex:0 0 10px;width:10px;height:10px;border-radius:50%;background:var(--sd-dim)}
    #sdial .qa .row{display:block;width:100%;text-align:left;min-height:44px;margin-bottom:4px;padding:6px 10px;border-radius:8px;border:1px solid var(--sd-line);border-left:3px solid #555;background:var(--sd-bg2);color:var(--sd-text)}
    #sdial .qa .row:active{background:var(--sd-hov)}
    #sdial .qa .row.hot{border-left-color:var(--sd-green)}
    #sdial .qa .row.go{border-left-color:var(--sd-blue)}
    #sdial .qa .row.dead{pointer-events:none}
    #sdial .qa .row b{display:block;font-size:13px;font-weight:600}
    #sdial .qa .row span{display:block;font-size:11px;color:var(--sd-dim);min-height:14px}
    #sdial .qa .cdl{margin-top:6px;padding-top:6px;border-top:1px solid #2c2c2c;font-size:11px;color:var(--sd-dim);line-height:1.4}
    #sdial .qa .msg{padding:14px 6px;text-align:center;color:var(--sd-dim);font-size:12px;line-height:1.4}
  `;

  function mount(ctx) {
    SD.css('sd-qa', CSS);
    const el = ctx.el;
    el.innerHTML = '<div class="qa"><div class="hd"><i></i><span></span></div><div class="rows"></div><div class="msg" style="display:none"></div><div class="cdl"></div></div>';
    const dot = el.querySelector('.hd i'), hdt = el.querySelector('.hd span'), box = el.querySelector('.rows');
    const msg = el.querySelector('.msg'), cdl = el.querySelector('.cdl');
    let sig = '', cur = [];
    SD.log('quick', 'opened');

    function note(t) { msg.textContent = t; msg.style.display = 'block'; box.textContent = ''; sig = ''; cdl.textContent = ''; hdt.textContent = ''; }

    function render() {
      if (!ctx.alive) return;
      if (!SD.hasKey) return note('No API key available.');
      const D = SD.peek();
      if (!D) return note(SD.error() ? 'Status unavailable: ' + SD.error() : 'Loading...');
      msg.style.display = 'none';
      const now = Date.now();
      let rows;
      try { rows = plan(D, now); } catch (e) { SD.log('quick', 'plan failed: ' + e.message, 'e'); return note('Something went wrong, see Terminal.'); }
      const h = headOf(D, now);
      dot.style.background = h[0]; hdt.textContent = h[1];
      cdl.textContent = cdLine(D, now);
      const s = rows.map(r => r.key + (r.act ? '1' : '0')).join('|');
      if (s !== sig) {   // rebuild only when the set of actions changes, so a tap is never lost to a redraw
        sig = s; box.textContent = ''; cur = [];
        rows.forEach(r => {
          const b = document.createElement('button');
          b.className = 'row ' + r.kind + (r.act ? '' : ' dead');
          b.appendChild(document.createElement('b')); b.appendChild(document.createElement('span'));
          if (r.act) b.addEventListener('click', () => {
            SD.log('quick', 'tap ' + r.key);
            if (r.act.go) SD.go(r.act.go); else if (r.act.open) SD.open(r.act.open);
          });
          box.appendChild(b); cur.push(b);
        });
      }
      rows.forEach((r, i) => { cur[i].firstChild.textContent = r.title(); cur[i].lastChild.textContent = r.sub(); });
    }

    render();
    const pull = () => { Promise.resolve(SD.data(false, 15000)).then(render, () => render()); };
    pull();
    ctx.every(render, 1000);
    ctx.every(pull, 15000);
    return { unmount() { SD.log('quick', 'closed'); } };
  }

  SD.register({
    id: 'quick',
    label: 'Quick Actions',
    width: 240,
    // lightning bolt
    icon: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    mount
  });
})();
