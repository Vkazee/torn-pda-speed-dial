// Speed Dial feature: Poker v0.1.0
// Casino Texas Hold'em (page.php?sid=holdem): your chance to win against random hands, your outs, and whether a call pays off.
// Reads only the cards the page shows. It NEVER clicks anything and uses no API. Switch it on or off in Settings > Features.
//   - Win / tie / lose chance by playing the hand out 2,500 times against the number of opponents set in Rules (random hands, so it flatters
//     your hand a little: real opponents who stay in usually hold more than random cards). The rating compares it with a fair share (1 / players).
//   - Outs (flop and turn): unseen cards that lift your hand to a better type than before AND than the board alone, with the chance to hit.
//   - Pot odds: type the pot (with their bet) and the amount to call; you see the equity you need against the equity you have.
//   - Your two cards and the board are told apart by name (hero / community ancestors) and, failing that, by position (a row of 3+ cards is the board).
//   - Manual mode: tap rank then suit yourself if the page markup is not recognised. Settings > Terminal lists every card it saw (rank+suit/role@x,y).
//   - The number of opponents is saved under speedDial.poker1.
(function () {
  'use strict';
  const SD = window.SpeedDial;
  if (!SD) return;

  const LS = 'speedDial.poker1';
  const TRIALS = 2500;

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


  // ---------- poker maths ----------
  // a card is one number: rank (2..14, ace = 14) * 4 + suit (0 clubs, 1 diamonds, 2 hearts, 3 spades)
  const SUITS = 'cdhs';
  const SYMS = ['\u2663', '\u2666', '\u2665', '\u2660'];
  const RLC = [null, null, '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const HANDS = ['High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'];
  const toCode = c => { const s = SUITS.indexOf(c.s); return s < 0 ? null : (c.r === 1 ? 14 : c.r) * 4 + s; };
  const CAT = 759375;   // 15^5: score = category * CAT + kickers

  const CNT = new Int8Array(15), SCN = new Int8Array(4), SMK = new Int32Array(4);
  const pack = (c, a, b, d, e, f) => ((((c * 15 + (a || 0)) * 15 + (b || 0)) * 15 + (d || 0)) * 15 + (e || 0)) * 15 + (f || 0);

  function straightTop(mask) {   // bit r = rank r (2..14); the ace also counts low. Returns the top rank of the best straight, or 0
    if (mask & 16384) mask |= 2;
    for (let h = 14; h >= 5; h--) { const need = 31 << (h - 4); if ((mask & need) === need) return h; }
    return 0;
  }
  function kick(x1, x2, n) {   // the n highest ranks present that are not x1 / x2
    const k = [];
    for (let r = 14; r >= 2 && k.length < n; r--) if (CNT[r] && r !== x1 && r !== x2) k.push(r);
    return k;
  }

  // best 5-card hand out of the first n cards (n = 2..7); a higher number is a better hand, equal numbers tie
  function score(a, n) {
    CNT.fill(0); SCN.fill(0); SMK.fill(0);
    let all = 0;
    for (let i = 0; i < n; i++) { const r = a[i] >> 2, s = a[i] & 3; CNT[r]++; SCN[s]++; SMK[s] |= 1 << r; all |= 1 << r; }
    let fs = -1;
    for (let s = 0; s < 4; s++) if (SCN[s] >= 5) fs = s;
    if (fs >= 0) { const t = straightTop(SMK[fs]); if (t) return pack(8, t); }
    let quad = 0, t1 = 0, t2 = 0, p1 = 0, p2 = 0;
    for (let r = 14; r >= 2; r--) {
      const c = CNT[r];
      if (c === 4) quad = r;
      else if (c === 3) { if (!t1) t1 = r; else if (!t2) t2 = r; }
      else if (c === 2) { if (!p1) p1 = r; else if (!p2) p2 = r; }
    }
    if (quad) return pack(7, quad, kick(quad, 0, 1)[0]);
    if (t1 && (t2 || p1)) return pack(6, t1, t2 > p1 ? t2 : p1);
    if (fs >= 0) { const f = []; for (let r = 14; r >= 2 && f.length < 5; r--) if (SMK[fs] & (1 << r)) f.push(r); return pack(5, f[0], f[1], f[2], f[3], f[4]); }
    const st = straightTop(all);
    if (st) return pack(4, st);
    if (t1) { const k = kick(t1, 0, 2); return pack(3, t1, k[0], k[1]); }
    if (p2) { const k = kick(p1, p2, 1); return pack(2, p1, p2, k[0]); }
    if (p1) { const k = kick(p1, 0, 3); return pack(1, p1, k[0], k[1], k[2]); }
    const k = kick(0, 0, 5);
    return pack(0, k[0], k[1], k[2], k[3], k[4]);
  }
  const catOf = (a, n) => Math.floor(score(a, n) / CAT);

  // play the hand out `trials` times: random board for what is missing, random hands for `opp` opponents
  function equity(hand, board, opp, trials) {
    const used = new Set(hand.concat(board)), deck = [];
    for (let r = 2; r <= 14; r++) for (let s = 0; s < 4; s++) { const c = r * 4 + s; if (!used.has(c)) deck.push(c); }
    const miss = 5 - board.length, need = miss + 2 * opp, n = deck.length;
    if (hand.length !== 2 || miss < 0 || need > n) return null;
    const mine = new Int32Array(7), oth = new Int32Array(7);
    mine[0] = hand[0]; mine[1] = hand[1]; oth[2] = 0;
    let win = 0, tie = 0, share = 0;
    for (let t = 0; t < trials; t++) {
      for (let j = 0; j < need; j++) { const k = j + Math.floor(Math.random() * (n - j)), x = deck[j]; deck[j] = deck[k]; deck[k] = x; }
      for (let j = 0; j < 5; j++) { const c = j < board.length ? board[j] : deck[j - board.length]; mine[2 + j] = c; oth[2 + j] = c; }
      const ms = score(mine, 7);
      let best = -1, same = 0;
      for (let o = 0; o < opp; o++) {
        oth[0] = deck[miss + 2 * o]; oth[1] = deck[miss + 2 * o + 1];
        const sc = score(oth, 7);
        if (sc > best) { best = sc; same = 1; } else if (sc === best) same++;
      }
      if (ms > best) { win++; share += 1; } else if (ms === best) { tie++; share += 1 / (same + 1); }
    }
    return { win: win / trials, tie: tie / trials, eq: share / trials };
  }

  function preName(h) {
    let a = h[0] >> 2, b = h[1] >> 2;
    const su = (h[0] & 3) === (h[1] & 3);
    if (a < b) { const t = a; a = b; b = t; }
    return a === b ? 'Pocket ' + RLC[a] + RLC[a] : RLC[a] + ' ' + RLC[b] + (su ? ' suited' : ' offsuit');
  }

  // everything the panel shows for one situation
  function analyze(hand, board, opp, trials) {
    const q = equity(hand, board, opp, trials || TRIALS);
    if (!q) return null;
    const out = { opp, win: q.win, tie: q.tie, lose: Math.max(0, 1 - q.win - q.tie), eq: q.eq };
    const all = hand.concat(board);
    if (board.length >= 3) { out.cat = catOf(all, all.length); out.name = HANDS[out.cat]; } else out.name = preName(hand);
    const ratio = out.eq * (opp + 1);   // 1 = exactly a fair share
    out.rate = ratio >= 1.8 ? 'STRONG' : ratio >= 1.2 ? 'GOOD' : ratio >= 0.85 ? 'FAIR' : 'WEAK';
    if ((board.length === 3 || board.length === 4) && out.cat < 6) {
      const used = new Set(all);
      let n = 0, left = 0;
      for (let r = 2; r <= 14; r++) for (let s = 0; s < 4; s++) {
        const c = r * 4 + s;
        if (used.has(c)) continue;
        left++;
        const nb = board.concat([c]), a = hand.concat(nb);
        const cat = catOf(a, a.length);
        if (cat > out.cat && cat > catOf(nb, nb.length)) n++;   // better than before, and not just the board improving for everybody
      }
      if (n) { out.outs = n; out.hit = n / left; out.river = board.length === 3 ? 1 - ((left - n) * (left - n - 1)) / (left * (left - 1)) : n / left; }
    }
    return out;
  }

  // ---------- page reading ----------
  const SEL = '[class*="hearts" i],[class*="diamonds" i],[class*="spades" i],[class*="clubs" i],[class*="heart-" i],[class*="spade-" i],[class*="club-" i],[class*="diamond-" i],' +
    '[class*="card" i],img[alt],[aria-label],[data-card],[title]';
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

  const BOARDRE = /community|board|flop|river|table-?cards|(^|[^a-z])turn([^a-z]|$)/i;
  const HERORE = /hero|(^|[^a-z])(self|you|your|my|mine)([^a-z]|$)/i;

  function roleOf(el) {   // 'b' = board, 'h' = your hand, from the names of its ancestors
    let n = el;
    for (let i = 0; n && n !== document.body && i < 7; i++, n = n.parentElement) {
      const id = (n.id || '') + ' ' + (typeof n.className === 'string' ? n.className : '');
      if (BOARDRE.test(id)) return 'b';
      if (HERORE.test(id)) return 'h';
    }
    return null;
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
      c.i = i; c.x = b.left + b.width / 2; c.y = b.top + b.height / 2; c.h = b.height;
      c.shown = shown(c.el); c.top = c.shown && onTop(c.el); c.role = roleOf(c.el);
    });
    return inner;
  }

  function rowsOf(arr) {   // cards that sit on the same line
    const out = [];
    arr.slice().sort((a, b) => a.y - b.y).forEach(c => {
      const r = out[out.length - 1];
      if (r && Math.abs(c.y - r.y) <= 0.5 * (c.h || 60)) r.cs.push(c); else out.push({ y: c.y, cs: [c] });
    });
    return out;
  }
  const pickBoard = arr => {   // the fullest row of 3+ cards
    const rs = rowsOf(arr).filter(r => r.cs.length >= 3);
    return rs.length ? rs.reduce((x, r) => (r.cs.length > x.cs.length ? r : x), rs[0]).cs : [];
  };
  const pickHand = arr => {    // a row of at most 2 cards, the lowest one on the screen
    const rs = rowsOf(arr).filter(r => r.cs.length <= 2);
    return rs.length ? rs.reduce((x, r) => (r.y > x.y ? r : x), rs[0]).cs : [];
  };

  function splitPoker(cards) {
    const vis = cards.filter(c => c.shown), list = vis.length ? vis : cards;
    const byX = (a, b) => a.x - b.x;
    let hand = list.filter(c => c.role === 'h').sort(byX).slice(0, 2), board = list.filter(c => c.role === 'b').sort(byX).slice(0, 5);
    const rest = list.filter(c => !c.role);
    if (!board.length) board = pickBoard(rest).sort(byX).slice(0, 5);
    if (!hand.length) hand = pickHand(rest.filter(c => board.indexOf(c) < 0)).sort(byX).slice(0, 2);
    return { hand, board };
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
    #csh .why{margin-top:6px;color:#bbb}
    #csh .nt{margin-top:6px;color:#d9a441}
    #csh .ok{color:#85b200}#csh .warn{color:#d9a441}#csh .bad{color:#e0584a}#csh .dim{color:#999}
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
    #csh .po{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:8px 12px;background:#2c2c2c;border-bottom:1px solid #1c1c1c}
    #csh .po input{flex:1;min-width:0;width:70px;height:28px;border:1px solid #1a1a1a;border-radius:4px;background:#1c1c1c;color:#ddd;padding:0 8px;font-size:12px}
    #csh .po .pv{flex:0 0 100%}
    #csh .rd{color:#e0584a}
    #csh .seg button.rd{color:#e0584a}
  `;


  const pc = x => Math.round(x * 100);
  const num = v => parseFloat(String(v).replace(/[^0-9.]/g, '')) || 0;
  const cardsHtml = codes => codes.map(c => '<span class="' + (((c & 3) === 1 || (c & 3) === 2) ? 'rd' : '') + '">' + RLC[c >> 2] + SYMS[c & 3] + '</span>').join(' ');
  const txt = codes => codes.map(c => RLC[c >> 2] + SYMS[c & 3]).join(' ');

  function start(ctx) {
    let P = Object.assign({ opp: 3 }, SD.read(LS, null) || {});
    if (!(P.opp >= 1 && P.opp <= 8)) P.opp = 3;
    const save = () => SD.write(LS, P);
    const M = { on: false, tgt: 'h', pr: 0, ps: '', h: [], b: [] };   // manual entry (not saved)
    let rulesOpen = false, last = '', misses = 0, dumped = false, readCount = '', active = false, ckey = '', R = null;

    ctx.css(CSS);
    const box = document.createElement('div');
    box.id = 'csh';
    box.innerHTML = '<div class="hd"></div><div class="rs"></div>' +
      '<div class="po" style="display:none"><span class="dim">Pot</span><input class="ip" inputmode="decimal" placeholder="pot with bets"><span class="dim">Call</span><input class="ic" inputmode="decimal" placeholder="to call"><div class="pv"></div></div>' +
      '<div class="ft"><button data-a="man">Manual</button><button data-a="rules"></button></div><div class="mp"></div><div class="ru"></div>';
    const q = s => box.querySelector(s), hd = q('.hd'), rs = q('.rs'), po = q('.po'), ip = q('.ip'), ic = q('.ic'), pv = q('.pv'), bMan = q('[data-a="man"]'), bRules = q('[data-a="rules"]'), mp = q('.mp'), ru = q('.ru');

    // ----- what the page (or the manual keypad) says right now -----
    function readState() {
      if (M.on) return { src: 'manual', hand: M.h.slice(), board: M.b.slice() };
      const cards = readCards();
      if (!cards.length) return { src: 'none' };
      const sp = splitPoker(cards), hand = [], board = [];
      let bad = false;
      const add = (list, c) => { const x = toCode(c); if (x === null) bad = true; else if (hand.indexOf(x) < 0 && board.indexOf(x) < 0) list.push(x); };
      sp.hand.forEach(c => add(hand, c));
      sp.board.forEach(c => add(board, c));
      return { src: 'page', hand, board, bad, count: cards.length, sig: cards.slice(0, 9).map(c => RL[c.r] + c.s + '/' + (c.role || '-') + (c.shown ? '' : '!hid') + (c.shown && !c.top ? '!cov' : '') + '@' + Math.round(c.x) + ',' + Math.round(c.y)).join(' ') };
    }

    // ----- drawing -----
    const bar = (w, p, l) => '<div class="bar"><i class="w" style="width:' + w * 100 + '%"></i><i class="p" style="width:' + p * 100 + '%"></i><i class="l" style="width:' + l * 100 + '%"></i></div>';
    const wait = t => '<div class="bd"><span class="dim">' + t + '</span></div>';

    function solve(hand, board) {
      const k = hand.join(',') + '|' + board.join(',') + '|' + P.opp;
      if (k !== ckey) { ckey = k; R = analyze(hand, board, P.opp); }
      return R;
    }

    function renderBody(s) {
      if (s.src === 'none') return wait('Waiting for your cards...');
      if (s.bad) return wait('Suits are not readable on this page. Use Manual.');
      if (s.hand.length < 2) return wait(s.src === 'manual' ? 'Tap your two cards.' : 'Waiting for your two cards...');
      const a = solve(s.hand, s.board);
      if (!a) return wait('Cannot work this out (too many cards).');
      const c = a.rate === 'WEAK' ? 'bad' : a.rate === 'FAIR' ? 'warn' : 'ok';
      let h = '<div class="bd"><div class="big ' + c + '">' + a.rate + '<small>' + pc(a.eq) + '% equity \u00b7 ' + a.name + '</small></div>' + bar(a.win, a.tie, a.lose) +
        '<div class="lg"><span class="ok">Win ' + pc(a.win) + '%</span><span>Tie ' + pc(a.tie) + '%</span><span class="bad">Lose ' + pc(a.lose) + '%</span></div>' +
        '<div class="why">You ' + cardsHtml(s.hand) + (s.board.length ? ' \u00b7 Board ' + cardsHtml(s.board) : ' \u00b7 before the flop') + '</div>';
      if (a.outs) h += '<div class="why">Outs: ' + a.outs + ' \u00b7 ' + pc(a.hit) + '% next card' + (s.board.length === 3 ? ' \u00b7 ' + pc(a.river) + '% by the river' : '') + '</div>';
      return h + '<div class="why dim">vs ' + a.opp + ' random hand' + (a.opp > 1 ? 's' : '') + ' (set the number in Rules)</div></div>';
    }

    function updatePot() {
      const pot = num(ip.value), call = num(ic.value);
      if (!R || !(call > 0)) { pv.innerHTML = '<span class="dim">Type the pot and the amount to call.</span>'; return; }
      const need = call / (pot + call), ok = R.eq >= need;
      pv.innerHTML = '<span class="' + (ok ? 'ok' : 'bad') + '">' + (ok ? 'Calling pays off' : 'Calling loses money') + '</span> <span class="dim">you need ' + pc(need) + '%, you have ' + pc(R.eq) + '%</span>';
    }

    function render(s) {
      hd.innerHTML = '<b>Casino helper</b><span class="dim">Poker' + (s.src === 'manual' ? ' \u00b7 manual' : '') + '</span>';
      rs.innerHTML = renderBody(s);
      const ready = s.src !== 'none' && !s.bad && s.hand.length === 2 && !!R;
      if (!ready) R = null;
      po.style.display = ready ? '' : 'none';
      if (ready) updatePot();
      bMan.classList.toggle('on', M.on);
      bRules.textContent = 'Rules ' + (rulesOpen ? '\u25b2' : '\u25bc');
      let h = '';
      if (M.on) {
        h += '<div class="pn"><div class="mh"><button data-t="h" class="' + (M.tgt === 'h' ? 'on' : '') + '">Hand</button><span>' + (M.h.length ? cardsHtml(M.h) : '-') + '</span></div>' +
          '<div class="mh"><button data-t="b" class="' + (M.tgt === 'b' ? 'on' : '') + '">Board</button><span>' + (M.b.length ? cardsHtml(M.b) : '-') + '</span></div><div class="kp">';
        for (let r = 1; r <= 13; r++) h += '<button data-r="' + r + '" class="' + (M.pr === r ? 'on' : '') + '">' + RL[r] + '</button>';
        h += '<button data-a="undo">\u232b</button></div><div class="seg" style="margin-top:6px">';
        SUITS.split('').forEach((su, i) => { h += '<button data-s="' + su + '" class="' + (M.ps === su ? 'on ' : '') + (i === 1 || i === 2 ? 'rd' : '') + '">' + SYMS[i] + '</button>'; });
        h += '</div><div class="mh" style="margin-top:6px"><button data-a="clear" style="flex:1">New hand</button></div></div>';
      }
      mp.innerHTML = h;
      let g = '';
      if (rulesOpen) {
        g = '<div class="pn"><label>Opponents still in the hand</label><div class="seg">';
        for (let n = 1; n <= 8; n++) g += '<button data-o="' + n + '" class="' + (P.opp === n ? 'on' : '') + '">' + n + '</button>';
        g += '</div></div>';
      }
      ru.innerHTML = g;
    }

    // ----- taps -----
    function tryAdd() {
      if (!M.pr || !M.ps) return;
      const code = (M.pr === 1 ? 14 : M.pr) * 4 + SUITS.indexOf(M.ps);
      M.pr = 0; M.ps = '';
      if (M.h.indexOf(code) >= 0 || M.b.indexOf(code) >= 0) { SD.toast('That card is already used'); return; }
      if (M.tgt === 'h') { if (M.h.length < 2) M.h.push(code); else { SD.toast('Hand is full'); return; } if (M.h.length === 2) M.tgt = 'b'; }
      else if (M.b.length < 5) M.b.push(code);
      else SD.toast('Board is full');
    }
    box.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      const d = b.dataset;
      if (d.a === 'man') { M.on = !M.on; last = ''; }
      else if (d.a === 'rules') { rulesOpen = !rulesOpen; last = ''; }
      else if (d.a === 'clear') { M.h = []; M.b = []; M.pr = 0; M.ps = ''; M.tgt = 'h'; last = ''; }
      else if (d.a === 'undo') { const l = M.tgt === 'h' && M.h.length ? M.h : M.b.length ? M.b : M.h; l.pop(); if (!M.h.length) M.tgt = 'h'; last = ''; }
      else if (d.t) { M.tgt = d.t; last = ''; }
      else if (d.r) { M.pr = M.pr === +d.r ? 0 : +d.r; tryAdd(); last = ''; }
      else if (d.s) { M.ps = M.ps === d.s ? '' : d.s; tryAdd(); last = ''; }
      else if (d.o) { P.opp = +d.o; save(); last = ''; }
      else return;
      tick(true);
    });
    ip.addEventListener('input', updatePot);
    ic.addEventListener('input', updatePot);

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
      if (sid !== 'holdem' && sid !== 'poker') { if (box.isConnected) box.remove(); active = false; return; }
      if (!active) { active = true; last = ''; misses = 0; dumped = false; SD.log('poker', 'page: ' + sid); }
      mount();
      const s = readState();
      if (s.src === 'none') {
        misses++;
        if (misses >= 6 && !dumped) {
          dumped = true;
          const sample = [];
          document.querySelectorAll('[class*="card" i]').forEach(el => { if (sample.length < 8 && !mine(el)) sample.push(el.tagName.toLowerCase() + '.' + String(typeof el.className === 'string' ? el.className : '').trim().replace(/\s+/g, '.').slice(0, 70)); });
          SD.log('poker', 'no cards read. card-like elements: ' + (sample.join(' | ') || 'none'), 'w');
        }
      } else misses = 0;
      const key = JSON.stringify([s.src, s.hand, s.board, s.bad, s.sig, M.on, M.tgt, M.pr, M.ps, rulesOpen, P]);
      if (key === last) return;
      last = key;
      if (s.src !== 'none') {
        const line = 'poker hand=' + (s.hand.length ? txt(s.hand) : '?') + ' board=' + (s.board.length ? txt(s.board) : '-') + ' opp=' + P.opp + ' (' + s.src + (s.bad ? ', suit unknown' : '') + ')' + (s.sig ? ' [' + s.sig + ']' : '');
        if (line !== readCount) { readCount = line; SD.log('poker', line); }
      }
      render(s);
    }

    tick(true);
    ctx.every(tick, 700);   // cleared by the core when the feature is switched off

    return { stop() { box.remove(); } };
  }

  SD.feature({
    id: 'poker',
    group: 'Casino',
    label: 'Poker',
    where: 'Casino (Poker, Texas Hold\'em)',
    info: 'Win chance, outs and pot odds for Texas Hold\'em, against random hands. Reads the cards, never clicks.',
    match: /^\/page\.php$/,
    start,
    engine: { parseCard, score, equity, analyze, splitPoker, toCode }   // exposed for tests only
  });
})();
