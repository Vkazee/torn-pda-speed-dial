// Speed Dial feature: Casino Helper v0.1.0
// High-Low and Blackjack advisor. Shows the chance of every choice and which one to take next.
// Reads only the cards and buttons the page shows. It NEVER clicks anything and uses no API. Switch it on or off in Settings > Features.
//   - Blackjack: exact odds (win / push / lose) for Stand, Hit, Double and Split, worked out for the dealer card you see.
//     Infinite deck, dealer stands on all 17 and checks for blackjack (all changeable in Rules). Only actions whose buttons are enabled on the page are recommended.
//   - High-Low: chance that the next card is higher, lower or the same as the card on the table (full deck minus the shown card).
//   - Manual mode: tap the ranks yourself if the page markup is not recognised. Settings > Terminal tells what was (not) read.
// No strategy beats the house over time. This only stops you from making a worse choice than necessary.
(function () {
  'use strict';
  const SD = window.SpeedDial;
  if (!SD) return;

  const LS = 'speedDial.casino1';

  // ---------- cards ----------
  const RL = [null, 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];   // rank 1..13
  const PV = [0, 11, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10];                            // blackjack value of rank (ace = 11)
  const DRAW = [[2, 1 / 13], [3, 1 / 13], [4, 1 / 13], [5, 1 / 13], [6, 1 / 13], [7, 1 / 13], [8, 1 / 13], [9, 1 / 13], [10, 4 / 13], [11, 1 / 13]];

  const RK = '13|12|11|10|[1-9]|[ajqk]|ace|king|queen|jack|ten';
  const SU = 'hearts?|diamonds?|spades?|clubs?';
  const RA = new RegExp('(?:^|[\\s_\\-./])(' + SU + ')[\\s_\\-.]*(' + RK + ')(?![a-z0-9])', 'i');                       // hearts-10, spades_A, clubs K
  const RB = new RegExp('(?:^|[\\s_\\-./])(' + RK + ')[\\s_\\-.]*(?:of[\\s_\\-.]*)?(' + SU + ')(?![a-z])', 'i');         // 7 of hearts, 10-spades
  const WORD = { a: 1, ace: 1, j: 11, jack: 11, q: 12, queen: 12, k: 13, king: 13, ten: 10 };
  const rankOf = s => { s = String(s).toLowerCase(); return WORD[s] || parseInt(s, 10) || 0; };

  // el needs: className, getAttribute(), textContent. Returns { r: 1..13, s: suit letter } or null.
  function parseCard(el) {
    const cn = el.className && typeof el.className === 'object' ? (el.className.baseVal || '') : (el.className || '');
    const g = n => (el.getAttribute && el.getAttribute(n)) || '';
    const src = String(g('src')).split('/').pop();
    const s = [cn, g('aria-label'), g('alt'), g('title'), g('data-card'), g('data-rank') + ' ' + g('data-suit'), src].join(' ');
    let m = RA.exec(s);
    if (m) { const r = rankOf(m[2]); if (r >= 1 && r <= 13) return { r, s: m[1][0].toLowerCase() }; }
    m = RB.exec(s);
    if (m) { const r = rankOf(m[1]); if (r >= 1 && r <= 13) return { r, s: m[2][0].toLowerCase() }; }
    const tx = String(el.textContent || '').trim();
    if (tx.length && tx.length <= 4) {
      m = /^(10|[2-9]|[AJQK])\s*([\u2660\u2665\u2666\u2663])$/.exec(tx) || /^([\u2660\u2665\u2666\u2663])\s*(10|[2-9]|[AJQK])$/.exec(tx);
      if (m) { const rk = /^[\u2660-\u2666]$/.test(m[1]) ? m[2] : m[1]; const r = rankOf(rk); if (r) return { r, s: '?' }; }
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

  // ---------- Blackjack ----------
  // hand state = (h: total with every ace as 1, a: has an ace). An ace counts 11 whenever that does not bust.
  const tot = (h, a) => (a && h + 10 <= 21 ? h + 10 : h);
  const nxt = (h, a, v) => [h + (v === 11 ? 1 : v), a || v === 11];

  // dealer outcome distribution: [17, 18, 19, 20, 21, blackjack, bust]
  function dealerDist(up, h17) {
    const memo = new Map();
    function go(h, a, n) {
      const key = h * 8 + (a ? 4 : 0) + Math.min(n, 3);
      if (memo.has(key)) return memo.get(key);
      const t = tot(h, a), soft = a && h + 10 <= 21;
      let r;
      if (t > 21) r = [0, 0, 0, 0, 0, 0, 1];
      else if (t >= 18 || (t === 17 && !(soft && h17))) {
        r = [0, 0, 0, 0, 0, 0, 0];
        if (t === 21 && n === 2) r[5] = 1; else r[t - 17] = 1;
      } else {
        r = [0, 0, 0, 0, 0, 0, 0];
        DRAW.forEach(d => {
          const x = nxt(h, a, d[0]), y = go(x[0], x[1], n + 1);
          for (let i = 0; i < 7; i++) r[i] += d[1] * y[i];
        });
      }
      memo.set(key, r);
      return r;
    }
    return go(up === 11 ? 1 : up, up === 11, 1);
  }

  const solvers = new Map();
  function solver(up, h17, das, peek) {
    const k = up + '|' + h17 + '|' + das + '|' + peek;
    if (solvers.has(k)) return solvers.get(k);
    const dist = dealerDist(up, h17);
    if (peek && dist[5] > 0) {   // dealer checks for blackjack first: if we are still playing, he does not have one
      const f = 1 / (1 - dist[5]);
      for (let i = 0; i < 7; i++) dist[i] = i === 5 ? 0 : dist[i] * f;
    }

    function stand(t) {   // player stops on t (not a natural): dealer blackjack counts as a loss
      let w = dist[6], p = 0;
      for (let d = 17; d <= 21; d++) { if (d < t) w += dist[d - 17]; else if (d === t) p += dist[d - 17]; }
      return { ev: w - (1 - w - p), w, p, l: 1 - w - p };
    }
    const memo = new Map();
    function best(h, a) {   // best of stand / keep hitting, with its odds
      const key = h * 2 + (a ? 1 : 0);
      if (memo.has(key)) return memo.get(key);
      const t = tot(h, a);
      let r;
      if (t > 21) r = { ev: -1, w: 0, p: 0, l: 1, act: 'B' };
      else {
        const s = stand(t);
        r = { ev: s.ev, w: s.w, p: s.p, l: s.l, act: 'S', S: s };
        if (t < 21) {
          let w = 0, p = 0, l = 0;
          DRAW.forEach(d => { const x = nxt(h, a, d[0]), y = best(x[0], x[1]); w += d[1] * y.w; p += d[1] * y.p; l += d[1] * y.l; });
          r.H = { ev: w - l, w, p, l };
          if (r.H.ev > r.ev) { r.ev = r.H.ev; r.w = w; r.p = p; r.l = l; r.act = 'H'; }
        }
      }
      memo.set(key, r);
      return r;
    }
    function dbl(h, a) {   // one card, then stand; the bet is doubled
      let w = 0, p = 0, l = 0;
      DRAW.forEach(d => {
        const x = nxt(h, a, d[0]), t = tot(x[0], x[1]);
        if (t > 21) l += d[1];
        else { const s = stand(t); w += d[1] * s.w; p += d[1] * s.p; l += d[1] * s.l; }
      });
      return { ev: 2 * (w - l), w, p, l };
    }
    function split(v) {    // per hand odds; ev is for both hands together. No re-split. Split aces get one card each.
      const h0 = v === 11 ? 1 : v, a0 = v === 11;
      let w = 0, p = 0, l = 0, e = 0;
      DRAW.forEach(d => {
        const x = nxt(h0, a0, d[0]), t = tot(x[0], x[1]);
        let st;
        if (v === 11) st = stand(t);
        else {
          const b = best(x[0], x[1]);
          st = { ev: b.ev, w: b.w, p: b.p, l: b.l };
          if (das && t < 21) { const dd = dbl(x[0], x[1]); if (dd.ev > st.ev) st = dd; }
        }
        w += d[1] * st.w; p += d[1] * st.p; l += d[1] * st.l; e += d[1] * st.ev;
      });
      return { ev: 2 * e, w, p, l };
    }
    const api = { dist, stand, best, dbl, split };
    solvers.set(k, api);
    return api;
  }

  // ranks = your cards (1..13), upRank = dealer card, avail = Set of 'S','H','D','P' that the page offers (null = unknown)
  function analyze(ranks, upRank, o, avail) {
    const vals = ranks.map(r => PV[r]);
    let h = 0, a = false;
    vals.forEach(v => { h += v === 11 ? 1 : v; if (v === 11) a = true; });
    const t = tot(h, a), soft = a && h + 10 <= 21, n = ranks.length;
    const out = { t, soft, n, up: PV[upRank] };
    if (t > 21) { out.bust = true; return out; }
    if (n === 2 && t === 21) { out.natural = true; return out; }
    const S = solver(PV[upRank], !!o.h17, !!o.das, !!o.peek);
    const b = S.best(h, a);
    const opts = { S: b.S };
    if (b.H) opts.H = b.H;
    if (n === 2 && t < 21) opts.D = S.dbl(h, a);
    if (n === 2 && vals[0] === vals[1]) opts.P = S.split(vals[0]);
    const ok = k => !avail || avail.has(k);
    const pickBest = list => list.filter(k => opts[k]).reduce((x, k) => (x === null || opts[k].ev > opts[x].ev ? k : x), null);
    let pick = pickBest(Object.keys(opts).filter(ok)) || pickBest(Object.keys(opts));
    out.opts = opts;
    out.pick = pick;
    out.stats = opts[pick];
    out.ok = {};
    Object.keys(opts).forEach(k => { out.ok[k] = ok(k); });
    if (pick === 'D' || pick === 'P') out.fallback = pickBest(['H', 'S'].filter(ok)) || pickBest(['H', 'S']);   // when the page refuses it
    return out;
  }

  // ---------- page reading ----------
  const SEL = '[class*="hearts" i],[class*="diamonds" i],[class*="spades" i],[class*="clubs" i],[class*="heart-" i],[class*="spade-" i],[class*="club-" i],[class*="diamond-" i],' +
    '[class*="card" i],img[alt],[aria-label],[data-card],[title]';
  const DEALER = /dealer|croupier/i;
  const PLAYER = /(^|[^a-z])(player|you|your|user)([^a-z]|$)/i;
  const BTN = 'button,a,[role="button"],input[type="button"],input[type="submit"],[class*="btn" i],[class*="button" i]';
  const ACT = { hit: 'H', stand: 'S', double: 'D', 'double down': 'D', split: 'P' };

  const mine = el => !!el.closest('#csh, #sdial');
  const seen = el => !!(el.getClientRects && el.getClientRects().length);

  function readCards() {
    const list = [];
    document.querySelectorAll(SEL).forEach(el => {
      if (mine(el) || !seen(el)) return;
      const c = parseCard(el);
      if (c) list.push({ el, r: c.r, s: c.s });
    });
    return list.filter(a => !list.some(b => b !== a && a.el.contains(b.el)));   // innermost element of each card only
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

  function split2(cards) {   // dealer / player by ancestor names first, then by how high they sit on the screen
    cards.forEach(c => { c.role = roleOf(c.el); c.top = c.el.getBoundingClientRect().top; c.hgt = c.el.getBoundingClientRect().height || 60; });
    const known = cards.filter(c => c.role), rest = cards.filter(c => !c.role);
    if (rest.length) {
      const avg = role => { const x = known.filter(c => c.role === role); return x.length ? x.reduce((s, c) => s + c.top, 0) / x.length : null; };
      const d = avg('d'), p = avg('p');
      if (d !== null && p !== null) rest.forEach(c => { c.role = Math.abs(c.top - d) <= Math.abs(c.top - p) ? 'd' : 'p'; });
      else if (!known.length) {
        const tops = rest.map(c => c.top).sort((x, y) => x - y), gap = rest[0].hgt * 0.6;
        const cut = tops.length > 1 ? tops.find((t, i) => i > 0 && t - tops[i - 1] > gap) : undefined;
        rest.forEach(c => { c.role = cut !== undefined && c.top < cut ? 'd' : 'p'; });
      } else rest.forEach(c => { c.role = known[0].role === 'd' ? 'p' : 'd'; });
    }
    return { dealer: cards.filter(c => c.role === 'd'), player: cards.filter(c => c.role === 'p') };
  }

  function hands(player) {   // several hands only when cards sit in different containers that each hold something
    const by = new Map();
    player.forEach(c => { const k = c.el.parentElement; if (!by.has(k)) by.set(k, []); by.get(k).push(c); });
    const groups = Array.from(by.values());
    if (groups.length < 2 || groups.every(g => g.length === 1)) return { list: [player], active: 0 };
    let active = groups.findIndex(g => { let n = g[0].el; for (let i = 0; n && i < 4; i++, n = n.parentElement) { if (/active|current|selected|turn/i.test(typeof n.className === 'string' ? n.className : '')) return true; } return false; });
    if (active < 0) active = Math.max(0, groups.findIndex(g => tot(g.reduce((s, c) => s + (PV[c.r] === 11 ? 1 : PV[c.r]), 0), g.some(c => c.r === 1)) < 21));
    return { list: groups, active };
  }

  function readButtons() {   // the actions the page offers right now (enabled buttons only)
    const on = new Set(), all = new Set();
    document.querySelectorAll(BTN).forEach(el => {
      if (mine(el) || el.children.length > 3 || !seen(el)) return;
      const tx = (el.value && el.tagName === 'INPUT' ? el.value : el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (tx.length > 12 || !ACT[tx]) return;
      const off = el.disabled || el.getAttribute('aria-disabled') === 'true' || /disabled|inactive/i.test(typeof el.className === 'string' ? el.className : '');
      all.add(ACT[tx]);
      if (!off) on.add(ACT[tx]);
    });
    return all.size >= 2 ? on : null;
  }

  // ---------- UI ----------
  const CSS = `
    #csh,#csh *{box-sizing:border-box;font-family:inherit}
    #csh{max-width:100%;margin:10px 0 0;width:100%;font-size:12px;line-height:1.4;color:#ccc;text-align:left;font-weight:400}
    #csh button{font-family:inherit;font-size:12px;font-weight:400;cursor:pointer;touch-action:manipulation}
    #csh .hd{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:linear-gradient(to bottom,#454545,#363636);border-top:1px solid #555;border-bottom:1px solid #1c1c1c}
    #csh .hd b{color:#fff;font-size:13px;font-weight:700}
    #csh .bd{padding:10px 12px;background:#2c2c2c;border-bottom:1px solid #1c1c1c}
    #csh .big{font-size:22px;font-weight:700;letter-spacing:.02em;line-height:1.1}
    #csh .big small{font-size:12px;font-weight:400;color:#999;letter-spacing:0;margin-left:6px}
    #csh .bar{display:flex;height:8px;margin:8px 0 4px;border-radius:4px;overflow:hidden;background:#161616}
    #csh .bar i{display:block;height:100%}
    #csh .bar .w{background:#85b200}#csh .bar .p{background:#777}#csh .bar .l{background:#e0584a}
    #csh .lg{display:flex;justify-content:space-between;color:#999}
    #csh .alts{margin-top:8px;padding-top:6px;border-top:1px solid #3a3a3a;color:#999}
    #csh .alts span{white-space:nowrap;margin-right:10px;display:inline-block}
    #csh .alts .b{color:#fff;font-weight:700}#csh .alts .x{opacity:.45;text-decoration:line-through}
    #csh .why{margin-top:6px;color:#bbb}
    #csh .nt{margin-top:6px;color:#d9a441}
    #csh .ok{color:#85b200}#csh .warn{color:#d9a441}#csh .bad{color:#e0584a}#csh .dim{color:#999}
    #csh .hl{display:flex;align-items:center;gap:8px;padding:3px 0}
    #csh .hl .k{flex:none;width:54px;color:#999}
    #csh .hl .t{flex:1;height:6px;border-radius:3px;background:#161616;overflow:hidden}
    #csh .hl .t i{display:block;height:100%;background:#5b7fa8}
    #csh .hl.n .k{color:#85b200}#csh .hl.n .t i{background:#85b200}
    #csh .hl .v{flex:none;width:40px;text-align:right}
    #csh .ft{display:flex;gap:6px;padding:8px 12px 10px;background:#2c2c2c;border-bottom:1px solid #1c1c1c}
    #csh .ft button,#csh .opt button{flex:1;height:30px;border:1px solid #1a1a1a;border-radius:4px;color:#ccc;background:linear-gradient(to bottom,#3d3d3d,#2f2f2f)}
    #csh .ft button.on{color:#fff;box-shadow:inset 0 -2px 0 #85b200}
    #csh .pn{padding:2px 12px 10px;background:#2c2c2c;border-bottom:1px solid #1c1c1c}
    #csh .pn label{display:block;margin:8px 0 4px;font-size:11px;color:#888}
    #csh .seg{display:flex}
    #csh .seg button{flex:1;height:30px;border:1px solid #1a1a1a;margin-left:-1px;color:#bbb;background:linear-gradient(to bottom,#3d3d3d,#2f2f2f)}
    #csh .seg button:first-child{margin-left:0;border-radius:4px 0 0 4px}
    #csh .seg button:last-child{border-radius:0 4px 4px 0}
    #csh .seg button.on{color:#fff;background:linear-gradient(to bottom,#555,#444);box-shadow:inset 0 -2px 0 #85b200}
    #csh .kp{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-top:6px}
    #csh .kp button{height:32px;border:1px solid #1a1a1a;border-radius:4px;color:#ddd;background:linear-gradient(to bottom,#3d3d3d,#2f2f2f);padding:0}
    #csh .mh{display:flex;align-items:center;gap:8px;padding:4px 0}
    #csh .mh button{flex:none;min-width:64px;height:28px;border:1px solid #1a1a1a;border-radius:4px;color:#bbb;background:linear-gradient(to bottom,#3d3d3d,#2f2f2f)}
    #csh .mh button.on{color:#fff;box-shadow:inset 0 -2px 0 #85b200}
    #csh .mh span{flex:1;min-width:0;color:#fff;font-weight:700;letter-spacing:.04em}
    #csh.fx{position:fixed;left:0;right:0;bottom:0;z-index:99998;margin:0}
  `;

  const NAME = { S: 'Stand', H: 'Hit', D: 'Double', P: 'Split' };
  const pc = x => Math.round(x * 100);
  const evs = x => (x >= 0 ? '+' : '\u2212') + Math.abs(x).toFixed(2);
  const cls = p => (p >= 0.55 ? 'ok' : p >= 0.45 ? 'warn' : 'bad');

  function start(ctx) {
    let P = Object.assign({ h17: false, das: true, peek: true, aceHigh: true }, SD.read(LS, null) || {});
    const save = () => SD.write(LS, P);
    const M = { on: false, tgt: 'd', d: [], p: [], hl: null };   // manual entry (not saved)
    let rulesOpen = false, shown = null, last = '', misses = 0, dumped = false, readCount = '';

    ctx.css(CSS);
    const box = document.createElement('div');
    box.id = 'csh';

    // ----- what the page (or the manual keypad) says right now -----
    function readState(game) {
      if (M.on) {
        if (game === 'highlow') return { game, src: 'manual', cur: M.hl };
        return { game, src: 'manual', dealer: M.d.slice(0, 1), hand: M.p.slice(), extraDealer: Math.max(0, M.d.length - 1), avail: null };
      }
      const cards = readCards();
      if (!cards.length) return { game, src: 'none' };
      if (game === 'highlow') return { game, src: 'page', cur: cards[cards.length - 1].r, count: cards.length };
      const sp = split2(cards), hs = hands(sp.player);
      const h = hs.list[hs.active] || [];
      return {
        game, src: 'page',
        dealer: sp.dealer.slice(0, 1).map(c => c.r),
        extraDealer: Math.max(0, sp.dealer.length - 1),
        hand: h.map(c => c.r),
        multi: hs.list.length > 1 ? hs.list.length : 0,
        avail: readButtons()
      };
    }

    // ----- drawing -----
    const bar = (w, p, l) => '<div class="bar"><i class="w" style="width:' + w * 100 + '%"></i><i class="p" style="width:' + p * 100 + '%"></i><i class="l" style="width:' + l * 100 + '%"></i></div>';

    function renderBJ(s) {
      if (!s.dealer || !s.dealer.length) return '<div class="bd"><span class="dim">' + (s.src === 'manual' ? 'Tap the dealer card first.' : 'Waiting for the dealer card...') + '</span></div>';
      if (!s.hand.length) return '<div class="bd"><span class="dim">Waiting for your cards...</span></div>';
      const busy = s.src === 'page' && s.extraDealer > 0 && !(s.avail && s.avail.size);
      if (busy) return '<div class="bd"><span class="dim">Dealer is playing or the round is over.</span></div>';
      const a = analyze(s.hand, s.dealer[0], P, s.avail);
      const hand = s.hand.map(r => RL[r]).join(' ');
      const info = 'Dealer ' + RL[s.dealer[0]] + ' \u00b7 You ' + hand + ' = ' + a.t + (a.soft ? ' (soft)' : '') + (s.multi ? ' \u00b7 ' + s.multi + ' hands' : '');
      if (a.bust) return '<div class="bd"><div class="big bad">BUST</div><div class="why">' + info + '</div></div>';
      if (a.natural) return '<div class="bd"><div class="big ok">BLACKJACK</div><div class="why">' + info + '</div></div>';
      const st = a.stats, c = cls(st.w + st.p / 2);
      let h = '<div class="bd"><div class="big ' + c + '">' + NAME[a.pick].toUpperCase() + (a.fallback ? '<small>or ' + NAME[a.fallback] + ' if refused</small>' : '') + '</div>' +
        bar(st.w, st.p, st.l) +
        '<div class="lg"><span class="ok">Win ' + pc(st.w) + '%</span><span>Push ' + pc(st.p) + '%</span><span class="bad">Lose ' + pc(st.l) + '%</span></div>' +
        '<div class="alts">';
      ['S', 'H', 'D', 'P'].forEach(k => {
        if (!a.opts[k]) return;
        h += '<span class="' + (k === a.pick ? 'b' : a.ok[k] ? '' : 'x') + '">' + NAME[k] + ' ' + evs(a.opts[k].ev) + '</span>';
      });
      h += '</div><div class="why">' + info + '</div>';
      if (a.pick === 'P') h += '<div class="why dim">Split: odds are per hand.</div>';
      if (a.up === 11) h += '<div class="nt">Dealer shows an ace: skip insurance.</div>';
      return h + '</div>';
    }

    function renderHL(s) {
      if (!s.cur) return '<div class="bd"><span class="dim">' + (s.src === 'manual' ? 'Tap the card on the table.' : 'Waiting for the card...') + '</span></div>';
      const r = highLow(s.cur, P), top = r.pick === 'Higher' ? r.higher : r.lower;
      const row = (k, v, best) => '<div class="hl' + (best ? ' n' : '') + '"><span class="k">' + k + '</span><div class="t"><i style="width:' + v * 100 + '%"></i></div><span class="v ' + (best ? cls(v) : 'dim') + '">' + pc(v) + '%</span></div>';
      return '<div class="bd"><div class="big ' + cls(top) + '">' + r.pick.toUpperCase() + '<small>' + pc(top) + '% \u00b7 card ' + RL[s.cur] + '</small></div>' +
        '<div style="margin-top:6px">' + row('Higher', r.higher, r.pick === 'Higher') + row('Lower', r.lower, r.pick === 'Lower') + row('Same', r.tie, false) + '</div>' +
        (top < 0.5 ? '<div class="nt">Under 50%: if the game lets you take your winnings now, that is the safer move.</div>' : '') +
        '</div>';
    }

    function renderNone() {
      return '<div class="bd"><span class="dim">Cards not found on this page yet.</span>' +
        (misses >= 4 ? '<div class="nt">Still nothing. Tap Manual to enter the cards yourself. Settings &gt; Terminal lists what was found.</div>' : '') + '</div>';
    }

    function render(s) {
      const bj = s.game === 'blackjack';
      let h = '<div class="hd"><b>Casino helper</b><span class="dim">' + (bj ? 'Blackjack' : 'High-Low') + (s.src === 'manual' ? ' \u00b7 manual' : '') + '</span></div>';
      h += s.src === 'none' ? renderNone() : bj ? renderBJ(s) : renderHL(s);
      h += '<div class="ft"><button data-a="man" class="' + (M.on ? 'on' : '') + '">Manual</button><button data-a="rules">Rules ' + (rulesOpen ? '\u25b2' : '\u25bc') + '</button></div>';
      if (M.on) {
        const chips = a => a.length ? a.map(r => RL[r]).join(' ') : '-';
        h += '<div class="pn">';
        if (bj) h += '<div class="mh"><button data-t="d" class="' + (M.tgt === 'd' ? 'on' : '') + '">Dealer</button><span>' + chips(M.d.slice(0, 1)) + '</span></div>' +
          '<div class="mh"><button data-t="p" class="' + (M.tgt === 'p' ? 'on' : '') + '">You</button><span>' + chips(M.p) + '</span></div>';
        h += '<div class="kp">';
        for (let r = 1; r <= 13; r++) h += '<button data-r="' + r + '">' + RL[r] + '</button>';
        h += '<button data-a="undo">\u232b</button></div><div class="mh" style="margin-top:6px"><button data-a="clear" style="flex:1">Clear</button></div></div>';
      }
      if (rulesOpen) {
        const sg = (k, a, b, la, lb) => '<div class="seg"><button data-s="' + k + '" data-v="0" class="' + (!P[k] ? 'on' : '') + '">' + la + '</button><button data-s="' + k + '" data-v="1" class="' + (P[k] ? 'on' : '') + '">' + lb + '</button></div>';
        h += '<div class="pn">' +
          (bj ? '<label>Dealer on soft 17</label>' + sg('h17', 0, 1, 'Stands', 'Hits') + '<label>Double after split</label>' + sg('das', 0, 1, 'No', 'Yes') + '<label>Dealer checks for blackjack</label>' + sg('peek', 0, 1, 'No', 'Yes')
            : '<label>Ace counts as</label>' + sg('aceHigh', 0, 1, 'Low', 'High')) + '</div>';
      }
      box.innerHTML = h;
    }

    // ----- taps -----
    box.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      const d = b.dataset;
      if (d.a === 'man') { M.on = !M.on; last = ''; }
      else if (d.a === 'rules') { rulesOpen = !rulesOpen; last = ''; }
      else if (d.a === 'clear') { M.d = []; M.p = []; M.hl = null; last = ''; }
      else if (d.a === 'undo') { if (shown === 'highlow') M.hl = null; else (M.tgt === 'd' ? M.d : M.p).pop(); last = ''; }
      else if (d.t) { M.tgt = d.t; last = ''; }
      else if (d.r) {
        const r = parseInt(d.r, 10);
        if (shown === 'highlow') M.hl = r;
        else if (M.tgt === 'd') M.d = [r];
        else if (M.p.length < 8) M.p.push(r);
        last = '';
      } else if (d.s) { P[d.s] = d.v === '1'; save(); last = ''; }
      else return;
      tick(true);
    });

    // ----- mounting and loop -----
    function mount() {
      if (box.isConnected) return;
      const t = document.querySelector('.content-title'), w = document.querySelector('.content-wrapper');
      box.classList.remove('fx');
      if (t) t.insertAdjacentElement('afterend', box);
      else if (w) w.insertBefore(box, w.firstChild);
      else { box.classList.add('fx'); document.body.appendChild(box); }
    }

    function tick(force) {
      if (document.hidden && force !== true) return;
      const sid = (new URLSearchParams(location.search).get('sid') || '').toLowerCase();
      const game = sid === 'blackjack' || sid === 'highlow' ? sid : null;
      if (!game) { if (box.isConnected) box.remove(); shown = null; return; }
      if (game !== shown) { shown = game; last = ''; misses = 0; dumped = false; SD.log('casino', 'page: ' + game); }
      mount();
      const s = readState(game);
      if (s.src === 'none') {
        misses++;
        if (misses >= 4 && !dumped) {
          dumped = true;
          const sample = [];
          document.querySelectorAll('[class*="card" i]').forEach(el => { if (sample.length < 8 && !mine(el)) sample.push(el.tagName.toLowerCase() + '.' + String(typeof el.className === 'string' ? el.className : '').trim().replace(/\s+/g, '.').slice(0, 70)); });
          SD.log('casino', 'no cards read. card-like elements: ' + (sample.join(' | ') || 'none'), 'w');
        }
      } else misses = 0;
      const key = JSON.stringify([game, s.src, s.cur, s.dealer, s.extraDealer, s.hand, s.multi, s.avail ? Array.from(s.avail).sort() : null, M.on, M.tgt, rulesOpen, P, misses >= 4]);
      if (key === last) return;
      last = key;
      if (s.src !== 'none') {
        const line = game === 'highlow' ? 'highlow card=' + (s.cur ? RL[s.cur] : '?') + ' (' + (s.count || 1) + ' on page, ' + s.src + ')'
          : 'blackjack dealer=' + (s.dealer && s.dealer.length ? s.dealer.map(r => RL[r]) : '?') + ' you=' + (s.hand && s.hand.length ? s.hand.map(r => RL[r]).join(',') : '?') + ' buttons=' + (s.avail ? Array.from(s.avail).join('') : 'unknown') + ' (' + s.src + ')';
        if (line !== readCount) { readCount = line; SD.log('casino', line); }
      }
      render(s);
    }

    tick(true);
    ctx.every(tick, 700);   // cleared by the core when the feature is switched off

    return { stop() { box.remove(); } };
  }

  SD.feature({
    id: 'casinohelper',
    label: 'Casino Helper',
    where: 'Casino (High-Low, Blackjack)',
    info: 'Win chance and the best next move for High-Low and Blackjack. Reads the page, never clicks.',
    match: /^\/page\.php$/,
    start,
    engine: { parseCard, highLow, analyze, dealerDist }   // exposed for tests only
  });
})();
