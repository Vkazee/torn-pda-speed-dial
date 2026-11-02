// Speed Dial feature: Peek Card v0.1.0
// Hold a player's name (any link to a profile) for half a second and a small card appears next to your finger:
// name, ID, level, status with a live cooldown, last action, faction, and two buttons: "+ Target" and "Profile".
// One API request (selections=profile) per peek, cached for 30 seconds. Nothing runs until you hold a name.
// The card has no timer while it is closed. Switch it on or off in Settings > Features.
(function () {
  'use strict';
  const SD = window.SpeedDial;
  if (!SD) return;

  const HOLD = 500;      // ms you hold a name before the card opens
  const SLOP = 10;       // px the finger may drift (more = you are scrolling)
  const TTL = 30000;     // how long one player's data is reused
  const XID = /[?&]XID=(\d+)/;
  const COLOR = { Okay: '#7fd08a', Hospital: '#f1807a', Jail: '#d9a441', Federal: '#f1807a', Traveling: '#6fa8e8', Abroad: '#6fa8e8', Fallen: '#8a8a8a' };
  const strip = s => String(s || '').replace(/<[^>]*>/g, '').trim();

  const CSS = `
    a[href*="XID="]{-webkit-touch-callout:none}
    #sdial .pk{position:fixed;left:0;top:0;width:236px;max-width:calc(100vw - 12px);z-index:50;padding:10px;border-radius:12px;border:1px solid var(--c,#5a5a5a);background:#1c1c1c;color:#e6e6e6;box-shadow:0 6px 18px rgba(0,0,0,.55);font-size:12px;line-height:1.35}
    #sdial .pk-h{display:flex;align-items:center;gap:6px}
    #sdial .pk-nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e6e6e6;text-decoration:none;font-size:14px;font-weight:700}
    #sdial .pk-x{flex:0 0 30px;width:30px;height:30px;border:0;background:none;color:#cfcfcf;font-size:14px;padding:0}
    #sdial .pk-id{color:#8a8a8a;font-size:11px;margin-top:1px}
    #sdial .pk-st{margin-top:6px;padding:5px 8px;border-radius:8px;background:#242424;border-left:3px solid var(--c,#5a5a5a)}
    #sdial .pk-st b{color:var(--c,#cfcfcf);font-size:12px;margin-right:8px}
    #sdial .pk-cd{color:#cfcfcf;font-size:11px}
    #sdial .pk-dt{margin-top:4px;color:#9a9a9a;font-size:11px;word-break:break-word}
    #sdial .pk-row{margin-top:4px;color:#cfcfcf;font-size:12px;word-break:break-word}
    #sdial .pk-row i{font-style:normal;color:#8a8a8a;margin-right:6px}
    #sdial .pk-b{display:flex;gap:6px;margin-top:8px}
    #sdial .pk-b button,#sdial .pk-b a{flex:1;height:36px;display:flex;align-items:center;justify-content:center;border-radius:8px;border:1px solid #3a3a3a;background:#242424;color:#e6e6e6;font-size:13px;text-decoration:none;padding:0}
    #sdial .pk-b button:active,#sdial .pk-b a:active{background:#2e2e2e}
    #sdial .pk-b button:disabled{opacity:.5}
    #sdial .pk-ld{padding:14px 4px;text-align:center;color:#8a8a8a}
  `;

  const cache = new Map();   // id -> { t, v }
  async function pull(id) {
    const c = cache.get(id);
    if (c && Date.now() - c.t < TTL) return c.v;
    const j = await SD.api('https://api.torn.com/user/' + id + '?selections=profile');
    const s = j.status || {};
    const f = j.faction || {};
    const v = {
      id,
      name: String(j.name || ('#' + id)),
      lv: typeof j.level === 'number' ? j.level : 0,
      last: strip(j.last_action && j.last_action.relative),
      fac: f.faction_name && f.faction_name !== 'None' ? strip(f.faction_name) + (f.position ? ' (' + strip(f.position) + ')' : '') : '',
      st: { state: s.state || 'Okay', desc: strip(s.description), det: strip(s.details), until: s.until || 0, t: Date.now() }
    };
    cache.set(id, { t: Date.now(), v });
    return v;
  }

  // same idea as the Targets module: a cooldown that already ended is shown as Okay
  function view(st) {
    const rem = st.until ? st.until - Date.now() / 1000 : 0;
    if (st.state !== 'Okay' && st.until && rem <= 0) return { label: 'Okay', color: COLOR.Okay, rem: 0 };
    return { label: st.state, color: COLOR[st.state] || '#cfcfcf', rem: Math.max(0, rem) };
  }

  function start(ctx) {
    const wrap = document.querySelector('#sdial .wins');   // inside #sdial, so Torn's swipe handlers never see touches on the card
    if (!wrap) throw new Error('Speed Dial is not ready yet');
    ctx.css(CSS);

    let cur = null;          // { id, el, x, y, tk }
    let timer = 0, sx = 0, sy = 0, noClick = 0, pressUntil = 0;

    function close() {
      if (!cur) return;
      clearInterval(cur.tk);
      cur.el.remove();
      cur = null;
    }

    function place() {
      if (!cur) return;
      const el = cur.el, w = el.offsetWidth, h = el.offsetHeight;
      let l = Math.min(Math.max(6, cur.x - w / 2), innerWidth - w - 6);
      let t = cur.y - h - 28;                 // above the finger, so the finger does not hide it
      if (t < 6) t = cur.y + 32;
      t = Math.min(Math.max(6, t), innerHeight - h - 6);
      el.style.transform = 'translate(' + l + 'px,' + t + 'px)';
    }

    function paint(v) {
      if (!cur || cur.id !== v.id) return;
      const el = cur.el, w = view(v.st);
      el.style.setProperty('--c', w.color);
      const addable = !!SD.targets;
      const have = addable && SD.targets.has(v.id);
      const det = [v.st.desc, v.st.det].filter(Boolean).join(' - ');
      el.innerHTML =
        '<div class="pk-h"><a class="pk-nm" href="/profiles.php?XID=' + v.id + '">' + SD.esc(v.name) + '</a><button class="pk-x" aria-label="Close">\u2715</button></div>' +
        '<div class="pk-id">[' + v.id + ']' + (v.lv ? ' \u00b7 Lv ' + v.lv : '') + '</div>' +
        '<div class="pk-st"><b>' + SD.esc(w.label) + '</b><span class="pk-cd" data-u="' + (w.rem ? v.st.until : 0) + '">' + (w.rem ? SD.durS(w.rem) : '') + '</span></div>' +
        (det && w.label !== 'Okay' ? '<div class="pk-dt">' + SD.esc(det) + '</div>' : '') +
        (v.last ? '<div class="pk-row"><i>Last action</i>' + SD.esc(v.last) + '</div>' : '') +
        (v.fac ? '<div class="pk-row"><i>Faction</i>' + SD.esc(v.fac) + '</div>' : '') +
        '<div class="pk-b">' +
          (addable ? '<button class="pk-add"' + (have ? ' disabled' : '') + '>' + (have ? '\u2713 In Targets' : '+ Target') + '</button>' : '') +
          '<a class="pk-go" href="/profiles.php?XID=' + v.id + '">Profile</a>' +
        '</div>';
      el.querySelector('.pk-x').addEventListener('click', close);
      const add = el.querySelector('.pk-add');
      if (add) add.addEventListener('click', () => {
        const r = SD.targets.add({ id: v.id, name: v.name, lv: v.lv, st: v.st });
        if (r === 'max') return SD.toast('Targets is full');
        add.disabled = true;
        add.textContent = '\u2713 In Targets';
        SD.toast(r === 'ok' ? v.name + ' added to Targets' : 'Already in Targets');
      });
      place();
      // live cooldown: this timer only exists while the card is open
      clearInterval(cur.tk);
      cur.tk = setInterval(() => {
        const cd = el.querySelector('.pk-cd');
        const u = cd ? +cd.dataset.u : 0;
        if (!u) return;
        const rem = u - Date.now() / 1000;
        if (rem <= 0) paint(v); else cd.textContent = SD.durS(rem);
      }, 1000);
    }

    async function open(id, x, y) {
      if (!SD.hasKey) return SD.toast('No API key available');
      close();
      const el = document.createElement('div');
      el.className = 'pk';
      el.innerHTML = '<div class="pk-ld">Loading...</div>';
      wrap.appendChild(el);
      cur = { id, el, x, y, tk: 0 };
      noClick = Date.now() + 800;   // the lift of your finger must not open the link you held
      place();
      try {
        const v = await pull(id);
        paint(v);
      } catch (e) {
        if (cur && cur.id === id) {
          el.innerHTML = '<div class="pk-h"><span class="pk-nm">Could not load</span><button class="pk-x" aria-label="Close">\u2715</button></div><div class="pk-dt">' + SD.esc(e.message || 'error') + '</div>';
          el.querySelector('.pk-x').addEventListener('click', close);
          place();
        }
      }
    }

    const cancel = () => { if (timer) { clearTimeout(timer); timer = 0; } };

    ctx.on(document, 'touchstart', e => {
      const inCard = cur && cur.el.contains(e.target);
      if (cur && !inCard) close();   // tap anywhere else closes the card
      cancel();
      if (e.touches.length !== 1 || !e.target.closest) return;
      const a = e.target.closest('a[href*="XID="]');
      if (!a || a.closest('#sdial')) return;
      const m = XID.exec(a.getAttribute('href') || '');
      if (!m) return;
      const t = e.touches[0];
      sx = t.clientX; sy = t.clientY;
      pressUntil = Date.now() + HOLD + 600;
      timer = setTimeout(() => { timer = 0; open(+m[1], sx, sy); }, HOLD);
    }, { capture: true, passive: true });

    ctx.on(document, 'touchmove', e => {
      if (!timer) return;
      const t = e.touches[0];
      if (!t || Math.abs(t.clientX - sx) + Math.abs(t.clientY - sy) > SLOP) cancel();
    }, { capture: true, passive: true });

    ['touchend', 'touchcancel'].forEach(type => ctx.on(document, type, () => {
      cancel();
      if (cur && Date.now() < noClick) noClick = Date.now() + 400;
    }, { capture: true, passive: true }));

    // after a long press, swallow the click that would open the link, and the browser's own link menu
    ctx.on(document, 'click', e => {
      if (Date.now() < noClick && !(cur && cur.el.contains(e.target))) { e.preventDefault(); e.stopPropagation(); }
    }, true);
    ctx.on(document, 'contextmenu', e => {
      if (Date.now() < pressUntil || (cur && Date.now() < noClick)) e.preventDefault();
    }, true);

    return { stop() { cancel(); close(); } };
  }

  SD.feature({
    id: 'peekcard',
    label: 'Peek Card',
    where: 'Any page',
    info: 'Hold a player name to see a mini profile card with a + Target button.',
    start
  });
})();
