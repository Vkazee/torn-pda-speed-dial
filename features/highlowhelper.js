// Speed Dial feature: High-Low Helper v0.2.0
// Casino High-Low (page.php?sid=highlow): the chance that YOUR face-down card is higher or lower than the DEALER's card, and which one to pick.
// Split off the old Casino Helper (one page = one feature file). Reads only the cards and buttons the page shows. It NEVER clicks anything and uses no API.
// Switch it on or off in Settings > Features.
//   - The dealer card is picked by name (a dealer ancestor), then by position. Face-down, hidden, faded-out and covered cards are ignored.
//   - Odds: a full deck minus the dealer card (51 left). The chance of the same rank is shown too and counts for neither side.
//   - Manual mode: tap the dealer card yourself if the page markup is not recognised. Settings > Terminal tells what was (not) read.
//   - Between rounds (Higher / Lower buttons gone or greyed out) the panel goes back to "waiting" and the typed-in card is cleared.
//   - Rules: ace high or low. Saved under speedDial.highlow1 (the ace rule of the old combined helper, speedDial.casino1, is carried over).
(function () {
  'use strict';
  const SD = window.SpeedDial;
  if (!SD) return;

  const LS = 'speedDial.highlow1';
  const OLD = 'speedDial.casino1';

  // ---------- cards ----------
  const RL = [null, 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];   // rank 1..13

  const RK = '13|12|11|10|[1-9]|[ajqk]|ace|king|queen|jack|ten';
  const SU = 'hearts?|diamonds?|spades?|clubs?';
  const RA = new RegExp('(?:^|[\\s_\\-./])(' + SU + ')[\\s_\\-.]*(' + RK + ')(?![a-z0-9])', 'i');                       // hearts-10, spades_A, clubs K
  const RB = new RegExp('(?:^|[\\s_\\-./])(' + RK + ')[\\s_\\-.]*(?:of[\\s_\\-.]*)?(' + SU + ')(?![a-z])', 'i');         // 7 of hearts, 10-spades
  const WORD = { a: 1, ace: 1, j: 11, jack: 11, q: 12, queen: 12, k: 13, king: 13, ten: 10 };
  const SYM = { '\u2660': 's', '\u2665': 'h', '\u2666': 'd', '\u2663': 'c' };
  const rankOf = s => { s = String(s).toLowerCase(); return WORD[s] || parseInt(s, 10) || 0; };

  // el needs: className, getAttribute(), textContent. Returns { r: 1..13, s: suit letter c/d/h/s or '?' } or null.
  function parseCard(el) {
    const cn = el.className && typeof el.className === 'object' ? (el.className.baseVal || '') : (el.className || '');
    const g = n => (el.getAttribute && el.getAttribute(n)) || '';
    const src = String(g('src')).split('/').pop();
    // every attribute is tested on its own: joining them could glue a suit from one onto a rank from another
    const fields = [cn, g('aria-label'), g('alt'), g('title'), g('data-card'), (g('data-rank') + ' ' + g('data-suit')).trim(), src];
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (!f) continue;
      let m = RA.exec(f);
      if (m) { const r = rankOf(m[2]); if (r >= 1 && r <= 13) return { r, s: m[1][0].toLowerCase() }; }
      m = RB.exec(f);
      if (m) { const r = rankOf(m[1]); if (r >= 1 && r <= 13) return { r, s: m[2][0].toLowerCase() }; }
    }
    const tx = String(el.textContent || '').trim();
    if (tx.length && tx.length <= 4) {
      const m = /^(10|[2-9]|[AJQK])\s*([\u2660\u2665\u2666\u2663])$/.exec(tx) || /^([\u2660\u2665\u2666\u2663])\s*(10|[2-9]|[AJQK])$/.exec(tx);
      if (m) {
        const sym = SYM[m[1]] ? m[1] : m[2], rk = sym === m[1] ? m[2] : m[1], r = rankOf(rk);
        if (r) return { r, s: SYM[sym] };
      }
    }
    return null;
  }


  // ---------- High-Low ----------
  // every draw comes from a full 52-card deck minus the card on the table
  function highLow(rank, o) {
    const val = r => (o.aceHigh && r === 1 ? 14 : r);
    const cur = val(rank);
    let hi = 0, lo = 0, tie = 0;
    for (let r = 1; r <= 13; r++) {
      const n = r === rank ? 3 : 4, v = val(r);
      if (v > cur) hi += n; else if (v < cur) lo += n; else tie += n;
    }
    return { higher: hi / 51, lower: lo / 51, tie: tie / 51, pick: hi >= lo ? 'Higher' : 'Lower' };
  }


  // ---------- page reading ----------
  const SEL = '[class*="hearts" i],[class*="diamonds" i],[class*="spades" i],[class*="clubs" i],[class*="heart-" i],[class*="spade-" i],[class*="club-" i],[class*="diamond-" i],' +
    '[class*="card" i],img[alt],[aria-label],[data-card],[title]';
  const DEALER = /dealer|croupier/i;
  const PLAYER = /(^|[^a-z])(player|you|your|user)([^a-z]|$)/i;
  const BTN = 'button,a,li,[role="button"],input[type="button"],input[type="submit"],[class*="btn" i],[class*="button" i],[class*="action" i]';
  // label = letters only, so "Higher" and "HIGHER" both match. Exact words only.
  const LABEL = { higher: 'U', high: 'U', lower: 'L', low: 'L' };
  const OFF = /(^|[\s_-])(disabled|inactive|unavailable)([\s_-]|$)/i;
  const mine = el => !!el.closest('#csh, #sdial');
  const seen = el => !!(el.getClientRects && el.getClientRects().length);

  const BACKS = /^(back|facedown|face-down|cardback|card-back)$/i;   // class token of a card lying face down
  const faceDown = el => String(typeof el.className === 'string' ? el.className : '').split(/\s+/).some(t => BACKS.test(t));

  function shown(el) {   // really on screen: has a size, not hidden, not (almost) transparent
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    for (let n = el, i = 0; n && n.nodeType === 1 && i < 6; i++, n = n.parentElement) {
      let cs;
      try { cs = getComputedStyle(n); } catch (e) { break; }
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.1) return false;
    }
    return true;
  }


  function onTop(el) {   // nothing unrelated is painted over the middle of the card (an old card under a new one, a flipped-away face)
    const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return true;   // cannot test off screen
    const hit = document.elementFromPoint(x, y);
    return !hit || el.contains(hit) || hit.contains(el) || mine(hit);
  }

  function readCards() {
    const root = document.querySelector('.content-wrapper') || document;   // the game only: not Torn's sidebar, chat or header
    const list = [];
    root.querySelectorAll(SEL).forEach(el => {
      if (mine(el) || !seen(el) || faceDown(el)) return;
      const c = parseCard(el);
      if (c) list.push({ el, r: c.r, s: c.s });
    });
    const inner = list.filter(a => !list.some(b => b !== a && a.el.contains(b.el)));   // innermost element of each card only
    inner.forEach((c, i) => {
      const b = c.el.getBoundingClientRect();
      c.i = i; c.x = b.left + b.width / 2;
      c.shown = shown(c.el); c.top = c.shown && onTop(c.el); c.role = roleOf(c.el);
    });
    return inner;
  }

  function roleOf(el) {
    let n = el;
    for (let i = 0; n && n !== document.body && i < 7; i++, n = n.parentElement) {
      const id = (n.id || '') + ' ' + (typeof n.className === 'string' ? n.className : '');
      if (DEALER.test(id)) return 'd';
      if (PLAYER.test(id)) return 'p';
    }
    return null;
  }

  // High-Low: the card the odds are about is the DEALER's face-up card (yours is face down until you choose).
  // Order: visible cards only, then not-yours, then named "dealer", then on top, then leftmost (the dealer sits left), then newest in the page.
  function pickDealer(cards) {
    if (!cards.length) return null;
    const vis = cards.filter(c => c.shown), pool = vis.length ? vis : cards;
    const notMine = pool.filter(c => c.role !== 'p'), base = notMine.length ? notMine : pool;
    const named = base.filter(c => c.role === 'd'), from = named.length ? named : base;
    const better = (a, b) => {
      if (a.top !== b.top) return a.top;
      if (!named.length && Math.abs(a.x - b.x) > 8) return a.x < b.x;
      return a.i > b.i;
    };
    return from.reduce((x, c) => (x === null || better(c, x) ? c : x), null);
  }

  function describe(cards, pick) {   // one short line for Settings > Terminal: what was seen and which one was used
    return cards.slice(0, 6).map(c => (c === pick ? '*' : '') + RL[c.r] + (c.s !== '?' ? c.s : '') + '/' + (c.role || '-') + (c.shown ? '' : '!hid') + (c.shown && !c.top ? '!cov' : '') + '@' + Math.round(c.x)).join(' ');
  }

  function isOff(el) {   // greyed out: disabled attribute, a disabled class on the button or its two parents, or taps ignored
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return true;
    try { if (getComputedStyle(el).pointerEvents === 'none') return true; } catch (e) { /* ignore */ }
    for (let n = el, i = 0; n && i < 3; i++, n = n.parentElement) if (OFF.test(typeof n.className === 'string' ? n.className : '')) return true;
    return false;
  }

  function readButtons() {
    const root = document.querySelector('.content-wrapper') || document;
    const st = {};
    root.querySelectorAll(BTN).forEach(el => {
      if (mine(el) || el.children.length > 3 || !seen(el)) return;
      const k = LABEL[String(el.value && el.tagName === 'INPUT' ? el.value : el.textContent || '').toLowerCase().replace(/[^a-z]/g, '')];
      if (!k) return;
      const x = st[k] || (st[k] = { n: 0, off: 0 });
      x.n++;
      if (isOff(el)) x.off++;
    });
    const on = new Set(), blocked = new Set();
    Object.keys(st).forEach(k => { if (st[k].off === st[k].n) blocked.add(k); else on.add(k); });
    return { on, blocked };
  }

  // ---------- UI ----------
  const CSS = `
    #csh,#csh *{box-sizing:border-box;font-family:inherit}
    #csh{max-width:100%;margin:10px 0 0;width:100%;font-size:12px;line-height:1.4;color:var(--sd-text2);text-align:left;font-weight:400}
    #csh button{font-family:inherit;font-size:12px;font-weight:400;cursor:pointer;touch-action:manipulation}
    #csh .hd{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:linear-gradient(to bottom,var(--sd-lift),var(--sd-line));border-top:1px solid var(--sd-lift);border-bottom:1px solid var(--sd-bg)}
    #csh .hd b{color:#fff;font-size:13px;font-weight:700}
    #csh .bd{padding:10px 12px;background:var(--sd-hov);border-bottom:1px solid var(--sd-bg)}
    #csh .big{font-size:22px;font-weight:700;letter-spacing:.02em;line-height:1.1}
    #csh .big small{font-size:12px;font-weight:400;color:var(--sd-dim);letter-spacing:0;margin-left:6px}
    #csh .why{margin-top:6px;color:var(--sd-text2)}
    #csh .nt{margin-top:6px;color:var(--sd-yel)}
    #csh .ok{color:var(--sd-green)}#csh .warn{color:var(--sd-yel)}#csh .bad{color:var(--sd-red)}#csh .dim{color:var(--sd-dim)}
    #csh .hl{display:flex;align-items:center;gap:8px;padding:3px 0}
    #csh .hl .k{flex:none;width:54px;color:var(--sd-dim)}
    #csh .hl .t{flex:1;height:6px;border-radius:4px;background:var(--sd-sink);overflow:hidden}
    #csh .hl .t i{display:block;height:100%;background:var(--sd-blue)}
    #csh .hl.n .k{color:var(--sd-green)}#csh .hl.n .t i{background:var(--sd-green)}
    #csh .hl .v{flex:none;width:40px;text-align:right}
    #csh .ft{display:flex;gap:6px;padding:8px 12px 10px;background:var(--sd-hov);border-bottom:1px solid var(--sd-bg)}
    #csh .ft button,#csh .opt button{flex:1;height:var(--sd-h);border:1px solid var(--sd-sink);border-radius:8px;color:var(--sd-text2);background:linear-gradient(to bottom,var(--sd-line2),var(--sd-hov))}
    #csh .ft button.on{color:#fff;box-shadow:inset 0 -2px 0 var(--sd-green)}
    #csh .pn{padding:2px 12px 10px;background:var(--sd-hov);border-bottom:1px solid var(--sd-bg)}
    #csh .pn label{display:block;margin:8px 0 4px;font-size:11px;color:var(--sd-dim)}
    #csh .seg{display:flex}
    #csh .seg button{flex:1;height:var(--sd-h);border:1px solid var(--sd-sink);margin-left:-1px;color:var(--sd-text2);background:linear-gradient(to bottom,var(--sd-line2),var(--sd-hov))}
    #csh .seg button:first-child{margin-left:0;border-radius:8px 0 0 8px}
    #csh .seg button:last-child{border-radius:0 8px 8px 0}
    #csh .seg button.on{color:#fff;background:linear-gradient(to bottom,var(--sd-lift),var(--sd-lift));box-shadow:inset 0 -2px 0 var(--sd-green)}
    #csh .kp{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-top:6px}
    #csh .kp button{height:var(--sd-h);border:1px solid var(--sd-sink);border-radius:8px;color:var(--sd-text2);background:linear-gradient(to bottom,var(--sd-line2),var(--sd-hov));padding:0}
    #csh .mh{display:flex;align-items:center;gap:8px;padding:4px 0}
    #csh .mh button{flex:none;min-width:64px;height:var(--sd-h);border:1px solid var(--sd-sink);border-radius:8px;color:var(--sd-text2);background:linear-gradient(to bottom,var(--sd-line2),var(--sd-hov))}
    #csh .mh button.on{color:#fff;box-shadow:inset 0 -2px 0 var(--sd-green)}
    #csh .mh span{flex:1;min-width:0;color:#fff;font-weight:700;letter-spacing:.04em}
    #csh.fx{position:fixed;left:0;right:0;bottom:0;z-index:99998;margin:0}
  `;


  const pc = x => Math.round(x * 100);
  const cls = p => (p >= 0.55 ? 'ok' : p >= 0.45 ? 'warn' : 'bad');

  function start(ctx) {
    const oldAce = (SD.read(OLD, null) || {}).aceHigh;
    let P = Object.assign({ aceHigh: typeof oldAce === 'boolean' ? oldAce : true }, SD.read(LS, null) || {});
    const save = () => SD.write(LS, P);
    const M = { on: false, cur: null };   // manual entry (not saved)
    let rulesOpen = false, last = '', misses = 0, dumped = false, readCount = '', sawTurn = false, wasOver = false, active = false;

    ctx.css(CSS);
    const box = document.createElement('div');
    box.id = 'csh';

    // ----- what the page (or the manual keypad) says right now -----
    function readState() {
      // is a round being played? Over = the Higher / Lower buttons were seen on this page and none is enabled now
      const b = readButtons(), keys = ['U', 'L'];
      if (keys.some(k => b.on.has(k) || b.blocked.has(k))) sawTurn = true;
      const turn = keys.some(k => b.on.has(k)), over = sawTurn && !turn;
      if (over !== wasOver) { wasOver = over; if (over) M.cur = null; }   // round just ended: forget the card typed in
      if (M.on) return { src: 'manual', cur: M.cur };
      if (over) return { src: 'idle' };
      const cards = readCards();
      if (!cards.length) return { src: 'none' };
      const pk = pickDealer(cards);
      return { src: 'page', cur: pk.r, count: cards.length, sig: describe(cards, pk) };
    }

    // ----- drawing -----
    function renderHL(s) {
      if (!s.cur) return '<div class="bd"><span class="dim">' + (s.src === 'manual' ? 'Tap the dealer card.' : 'Waiting for the dealer card...') + '</span></div>';
      const r = highLow(s.cur, P), top = r.pick === 'Higher' ? r.higher : r.lower;
      const row = (k, v, best) => '<div class="hl' + (best ? ' n' : '') + '"><span class="k">' + k + '</span><div class="t"><i style="width:' + v * 100 + '%"></i></div><span class="v ' + (best ? cls(v) : 'dim') + '">' + pc(v) + '%</span></div>';
      return '<div class="bd"><div class="big ' + cls(top) + '">' + r.pick.toUpperCase() + '<small>' + pc(top) + '% \u00b7 dealer ' + RL[s.cur] + '</small></div>' +
        '<div style="margin-top:6px">' + row('Higher', r.higher, r.pick === 'Higher') + row('Lower', r.lower, r.pick === 'Lower') + '</div>' +
        '<div class="why dim">Same rank: ' + pc(r.tie) + '%' + (P.aceHigh ? ' \u00b7 ace = high' : ' \u00b7 ace = low') + '</div>' +
        (top < 0.5 ? '<div class="nt">Under 50%: if the game lets you take your winnings now, that is the safer move.</div>' : '') +
        '</div>';
    }

    function renderNone() {
      return '<div class="bd"><span class="dim">Cards not found on this page yet.</span></div>';
    }

    function renderIdle() {   // standard state between rounds
      return '<div class="bd"><span class="dim">Waiting for the next round...</span></div>';
    }


    function render(s) {
      const sg = (k, la, lb) => '<div class="seg"><button data-s="' + k + '" data-v="0" class="' + (!P[k] ? 'on' : '') + '">' + la + '</button><button data-s="' + k + '" data-v="1" class="' + (P[k] ? 'on' : '') + '">' + lb + '</button></div>';
      let h = '<div class="hd"><b>High-Low Helper</b></div>';
      h += s.src === 'none' ? renderNone() : s.src === 'idle' ? renderIdle() : renderHL(s);
      h += '<div class="ft"><button data-a="man" class="' + (M.on ? 'on' : '') + '">Manual</button><button data-a="rules">Rules ' + (rulesOpen ? '\u25b2' : '\u25bc') + '</button></div>';
      if (M.on) {
        h += '<div class="pn"><div class="kp">';
        for (let r = 1; r <= 13; r++) h += '<button data-r="' + r + '">' + RL[r] + '</button>';
        h += '<button data-a="clear">\u232b</button></div></div>';
      }
      if (rulesOpen) h += '<div class="pn"><label>Ace counts as</label>' + sg('aceHigh', 'Low', 'High') + '</div>';
      box.innerHTML = h;
    }

    // ----- taps -----
    box.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      const d = b.dataset;
      if (d.a === 'man') { M.on = !M.on; last = ''; }
      else if (d.a === 'rules') { rulesOpen = !rulesOpen; last = ''; }
      else if (d.a === 'clear') { M.cur = null; last = ''; }
      else if (d.r) { M.cur = parseInt(d.r, 10); last = ''; }
      else if (d.s) { P[d.s] = d.v === '1'; save(); last = ''; }
      else return;
      tick(true);
    });

    // ----- mounting and loop -----
    // The title row (game name + its icons) is drawn late on some pages, so the panel is put right under it on every tick, not only once.
    let titleEl = null, anchor = '';
    const elName = e => e.tagName.toLowerCase() + '.' + String(typeof e.className === 'string' ? e.className : '').trim().replace(/\s+/g, '.').slice(0, 60);
    function findTitle() {
      if (titleEl && titleEl.isConnected) return titleEl;
      titleEl = document.querySelector('.content-title');
      if (titleEl) return titleEl;
      const root = document.querySelector('.content-wrapper') || document.body, want = 'high-low';
      const hs = root.querySelectorAll('h1,h2,h3,h4,[class*="title" i]');
      for (let i = 0; i < hs.length; i++) {
        const h = hs[i], tx = (h.textContent || '').trim().toLowerCase();
        if (mine(h) || box.contains(h) || tx.indexOf(want) !== 0 || tx.length > want.length + 25) continue;
        let el = h;   // up to the whole title row: the biggest ancestor that is still a thin strip
        while (el.parentElement && el.parentElement !== root && el.parentElement !== document.body && el.parentElement.getBoundingClientRect().height <= 100) el = el.parentElement;
        titleEl = el;
        return el;
      }
      return null;
    }

    function mount() {
      const t = findTitle(), w = document.querySelector('.content-wrapper');
      if (t && t.nextElementSibling === box) return;   // already right under the title
      box.classList.remove('fx');
      if (t) {
        t.insertAdjacentElement('afterend', box);
        if (anchor !== 't') { anchor = 't'; SD.log('highlow', 'panel placed under the title: ' + elName(t)); }
      } else if (!box.isConnected) {
        if (w) w.insertBefore(box, w.firstChild); else { box.classList.add('fx'); document.body.appendChild(box); }
        if (anchor !== 'f') { anchor = 'f'; SD.log('highlow', 'title not found (yet): panel put at the top of the page', 'w'); }
      }
    }

    function tick(force) {
      if (document.hidden && force !== true) return;
      const sid = (new URLSearchParams(location.search).get('sid') || '').toLowerCase();
      if (sid !== 'highlow') { if (box.isConnected) box.remove(); active = false; return; }
      if (!active) { active = true; last = ''; misses = 0; dumped = false; sawTurn = false; wasOver = false; SD.log('highlow', 'page: highlow'); }
      mount();
      const s = readState();
      if (s.src === 'none') {
        misses++;
        if (misses >= 4 && !dumped) {
          dumped = true;
          const sample = [];
          document.querySelectorAll('[class*="card" i]').forEach(el => { if (sample.length < 8 && !mine(el)) sample.push(el.tagName.toLowerCase() + '.' + String(typeof el.className === 'string' ? el.className : '').trim().replace(/\s+/g, '.').slice(0, 70)); });
          SD.log('highlow', 'no cards read. card-like elements: ' + (sample.join(' | ') || 'none'), 'w');
        }
      } else misses = 0;
      const key = JSON.stringify([s.src, s.cur, s.sig, M.on, rulesOpen, P]);
      if (key === last) return;
      last = key;
      if (s.src !== 'none') {
        const line = s.src === 'idle' ? 'round over: panel reset' : 'highlow dealer=' + (s.cur ? RL[s.cur] : '?') + ' (' + (s.count || 1) + ' on page, ' + s.src + ')' + (s.sig ? ' [' + s.sig + ']' : '');
        if (line !== readCount) { readCount = line; SD.log('highlow', line); }
      }
      render(s);
    }

    tick(true);
    ctx.every(tick, 700);   // cleared by the core when the feature is switched off

    return { stop() { box.remove(); } };
  }

  SD.feature({
    id: 'highlow',
    was: 'casinohelper',   // starts out with the switch of the old combined Casino Helper
    group: 'Casino',
    label: 'High-Low Helper',
    where: 'Casino (High-Low)',
    info: 'Win chance for Higher and Lower against the dealer card.',
    match: /^\/page\.php$/,
    start,
    engine: { parseCard, highLow, pickDealer }   // exposed for tests only
  });
})();
