// Speed Dial module: Calculator v0.3.0
// A plain calculator: + - x / with the usual precedence (2+3x4 = 14), %, +/-, backspace, AC.
// Display like Google's calculator: what you type is the big line, the live result sits under it (smaller, purple).
// After "=" the sum shrinks to the top and the result becomes the big line.
// The typed line has a caret: tap the display to put it there, drag along the display to slide it (hold at the left/right edge to keep going).
// Keys insert at the caret and backspace deletes the character before it.
// % stays in the sum as typed (25% stays 25%); it is only worked out in the live result and at "=".
// % after + or - is a percentage of the sum before it (200+10% = 220); otherwise it divides by 100 (25% = 0.25).
// Nothing is saved and nothing is sent anywhere. No eval (Torn's CSP blocks it): the sum is worked out by hand below.
(function () {
  'use strict';
  const SD = window.SpeedDial;
  if (!SD) return;

  const CSS = `
    #sdial .calc{user-select:none;-webkit-user-select:none}
    #sdial .calc .dp{height:68px;padding:4px 8px 6px;margin-bottom:6px;border-radius:8px;background:var(--sd-bg2);display:flex;flex-direction:column;justify-content:flex-end;overflow:hidden;touch-action:none}
    #sdial .calc .ex{position:relative;height:32px;line-height:32px;font-size:26px;color:#f0f0f0;text-align:right;white-space:nowrap;overflow:hidden;cursor:text}
    #sdial .calc .ex.sm{font-size:20px}
    #sdial .calc .ex.xs{font-size:15px}
    #sdial .calc .ex.dn{height:18px;line-height:18px;font-size:12px;color:var(--sd-dim);cursor:default}
    #sdial .calc .ex .bo{margin:0 .28em}
    #sdial .calc .ex .cr{display:inline-block;width:2px;height:.9em;margin:0 -1px;vertical-align:middle;border-radius:1px;background:#c6e66a;animation:sdcalc-blink 1s steps(1) infinite}
    @keyframes sdcalc-blink{50%{opacity:0}}
    #sdial .calc .rs{height:20px;line-height:20px;font-size:16px;color:#9b93d4;text-align:right;white-space:nowrap;overflow:hidden}
    #sdial .calc .rs.dn{height:32px;line-height:32px;font-size:26px;color:#f0f0f0}
    #sdial .calc .rs.sm{font-size:20px}
    #sdial .calc .rs.xs{font-size:15px}
    #sdial .calc .gr{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}
    #sdial .calc .gr button{height:var(--sd-hl);border-radius:8px;border:1px solid var(--sd-line);background:var(--sd-bg2);color:var(--sd-text);font-size:16px;padding:0;touch-action:manipulation}
    #sdial .calc .gr button:active{background:var(--sd-line)}
    #sdial .calc .gr .fn{background:#2b2b2b;color:var(--sd-text2);font-size:14px}
    #sdial .calc .gr .op{background:#2f2f2f;border-color:#444;color:var(--sd-text2);font-size:18px}
    #sdial .calc .gr .op.cur{background:var(--sd-line);border-color:var(--sd-dim);color:#fff}
    #sdial .calc .gr .eq{background:#25360f;border-color:var(--sd-green);color:#c6e66a}
    #sdial .calc .gr .eq:active{background:#33491a}
  `;

  const SYM = { '+': '+', '-': '\u2212', '*': '\u00D7', '/': '\u00F7' };
  const MAXLEN = 15;    // digits in one number
  const MAXEXP = 200;   // characters in the whole sum

  // 12 significant digits hides 0.1+0.2 = 0.30000000000000004
  const clean = n => parseFloat(n.toPrecision(12));
  const group = s => {                              // 1234567.5 -> 1,234,567.5 (display only)
    if (/e/i.test(s)) return s;
    const m = /^(-?)(\d*)(\.?.*)$/.exec(s);
    return m[1] + m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + m[3];
  };
  // 1e-7 -> 0.0000001 : a result that carries on into a new sum must be plain digits
  const expand = str => {
    const m = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/i.exec(str);
    if (!m) return str;
    const d = m[2] + (m[3] || ''), p = m[2].length + parseInt(m[4], 10);
    return m[1] + (p <= 0 ? '0.' + '0'.repeat(-p) + d : p >= d.length ? d + '0'.repeat(p - d.length) : d.slice(0, p) + '.' + d.slice(p));
  };

  const isOp = c => c === '+' || c === '-' || c === '*' || c === '/';
  const isNum = c => !!c && (c === '.' || (c >= '0' && c <= '9'));

  // t = [number, op, number, op, number ...] ; x and / first, then + and -
  function calc(t) {
    const a = [t[0]];
    for (let i = 1; i < t.length; i += 2) {
      const op = t[i], n = t[i + 1];
      if (op === '*' || op === '/') {
        const p = a.pop();
        if (op === '/' && n === 0) throw new Error('div0');
        a.push(op === '*' ? p * n : p / n);
      } else a.push(op, n);
    }
    let r = a[0];
    for (let i = 1; i < a.length; i += 2) r = a[i] === '+' ? r + a[i + 1] : r - a[i + 1];
    if (!isFinite(r)) throw new Error('range');
    return clean(r);
  }

  // The sum is one string ("200+10%", "-5x3"). parse turns it into [{v, p}, op, {v, p} ...]  (p = has a % after it).
  // A minus right before a number is that number's sign; trailing operators are dropped; anything else odd throws.
  function parse(src) {
    const str = src.replace(/[+\-*/]+$/, '');
    const t = [];
    let i = 0;
    while (i < str.length) {
      const neg = str[i] === '-';
      if (neg) i++;
      const m = /^(\d+\.?\d*|\.\d+)(%?)/.exec(str.slice(i));
      if (!m) throw new Error('syntax');
      t.push({ v: (neg ? -1 : 1) * Number(m[1]), p: m[2] === '%' });
      i += m[0].length;
      if (i >= str.length) break;
      if (!isOp(str[i])) throw new Error('syntax');
      t.push(str[i++]);
    }
    return t;
  }

  // Works out the % signs, then the sum. 200 + 10% = 200 + 20 ; 2x3 + 10% = 6 + 0.6 ; 25% = 0.25
  function evaluate(t) {
    const n = [];
    for (let i = 0; i < t.length; i += 2) {
      let v = t[i].v;
      if (t[i].p) v = i >= 2 && (t[i - 1] === '+' || t[i - 1] === '-') ? calc(n) * v / 100 : v / 100;
      if (i) n.push(t[i - 1]);
      n.push(v);
    }
    return calc(n);
  }

  // The sum as it is drawn: one cell per typed character (i = its index in the string) plus thousand separators (i = -1).
  function cells(s) {
    const out = [];
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (isNum(c)) {
        let j = i;
        while (j < s.length && isNum(s[j])) j++;
        const run = s.slice(i, j), dot = run.indexOf('.'), ip = dot < 0 ? run.length : dot;
        for (let k = 0; k < run.length; k++) {
          if (k > 0 && k < ip && (ip - k) % 3 === 0) out.push({ c: ',', i: -1, cls: '' });
          out.push({ c: run[k], i: i + k, cls: '' });
        }
        i = j;
      } else {
        out.push({ c: SYM[c] || c, i: i, cls: isOp(c) && i > 0 && !isOp(s[i - 1]) ? 'bo' : '' });   // spaces only around a real operator, not a sign
        i++;
      }
    }
    return out;
  }
  const shown = s => cells(s).map(x => (x.cls === 'bo' ? ' ' + x.c + ' ' : x.c)).join('').trim();

  function mount(ctx) {
    SD.css('sd-calc', CSS);
    const el = ctx.el;
    el.className = 'calc';
    const KEYS = [
      ['AC', 'fn'], ['\u232B', 'fn'], ['%', 'fn'], ['/', 'op'],
      ['7'], ['8'], ['9'], ['*', 'op'],
      ['4'], ['5'], ['6'], ['-', 'op'],
      ['1'], ['2'], ['3'], ['+', 'op'],
      ['\u00B1', 'fn'], ['0'], ['.'], ['=', 'eq']
    ];
    el.innerHTML = '<div class="dp"><div class="ex">0</div><div class="rs"></div></div><div class="gr"></div>';
    const dp = el.querySelector('.dp'), ex = el.querySelector('.ex'), rs = el.querySelector('.rs'), gr = el.querySelector('.gr');
    const btn = {};
    KEYS.forEach(k => {
      const b = document.createElement('button');
      b.className = k[1] || '';
      b.textContent = SYM[k[0]] || k[0];
      b.dataset.k = k[0];
      if (k[0] === '\u232B') b.setAttribute('aria-label', 'Backspace');
      gr.appendChild(b);
      btn[k[0]] = b;
    });

    let s = '';         // the sum being typed, e.g. "200+10%"
    let pos = 0;        // caret: 0 = before the first character, s.length = at the end
    let res = null;     // result string right after "="
    let err = false;
    let line = '';      // top line after "="

    const size = (n, str) => (str.length > (n ? 11 : 17) ? ' xs' : str.length > (n ? 8 : 11) ? ' sm' : '');
    const put = (node, base, str, sz) => {          // plain text in a line; long ones shrink, and the end stays in view
      node.className = base + sz;
      node.textContent = str;
      node.scrollLeft = node.scrollWidth;
    };
    const edit = (node, cls) => {                   // the typed line with the caret in it
      const cs = cells(s), caret = '<i class="cr"></i>';
      let h = '', placed = false;
      if (!cs.length) h = '0' + caret;
      else {
        cs.forEach(c => {
          if (!placed && c.i >= pos) { h += caret; placed = true; }
          h += '<span' + (c.i >= 0 ? ' data-i="' + c.i + '"' : '') + (c.cls ? ' class="' + c.cls + '"' : '') + '>' + c.c + '</span>';
        });
        if (!placed) h += caret;
      }
      const sl = node.scrollLeft;
      node.className = cls;
      node.innerHTML = h;
      node.scrollLeft = sl;
      const cr = node.querySelector('.cr');
      if (!cr) return;
      const l = cr.offsetLeft, w = node.clientWidth;
      if (pos >= s.length) node.scrollLeft = node.scrollWidth;      // typing at the end: the end stays in view
      else if (l < node.scrollLeft + 12) node.scrollLeft = Math.max(0, l - 28);   // caret slid off to the left / right: bring it back
      else if (l > node.scrollLeft + w - 12) node.scrollLeft = l - w + 28;
    };

    function paint() {
      if (err) {
        put(ex, 'ex', 'Error', size(true, 'Error'));
        put(rs, 'rs', '', '');
      } else if (res !== null) {                     // after "=": sum small on top, result big below
        const top = group(res);
        put(ex, 'ex dn', line, '');
        put(rs, 'rs dn', top, size(false, top));
      } else {
        edit(ex, 'ex' + size(true, shown(s) || '0'));
        let sub = '';                                // live result under the line, once there is something to work out
        try {
          const t = parse(s);
          if (t.length >= 3 || t.some(x => x.p)) sub = group(String(evaluate(t)));
        } catch (e) { sub = ''; /* half-typed or odd sum: no preview yet */ }
        put(rs, 'rs', sub, '');
      }
      const last = s[s.length - 1];
      Object.keys(SYM).forEach(o => btn[o].classList.toggle('cur', res === null && !err && pos === s.length && last === o));
    }

    const reset = () => { s = ''; pos = 0; res = null; err = false; line = ''; };
    const fresh = () => { if (res !== null || err) reset(); };   // typing after "=" starts over
    const carry = () => { s = expand(res); pos = s.length; res = null; line = ''; };   // keep working on the result as a number
    const ins = str => { s = s.slice(0, pos) + str + s.slice(pos); pos += str.length; };
    const runAt = p => {                             // the number (digits and dot) touching position p
      let a = p, b = p;
      while (a > 0 && isNum(s[a - 1])) a--;
      while (b < s.length && isNum(s[b])) b++;
      return [a, b];
    };

    function digit(d) {
      fresh();
      if (s.length >= MAXEXP || s[pos - 1] === '%') return;
      const r = runAt(pos), run = s.slice(r[0], r[1]);
      if (run.replace('.', '').length >= MAXLEN) return;
      if (run === '0' && pos === r[1]) { s = s.slice(0, r[0]) + d + s.slice(r[1]); pos = r[0] + 1; }   // a lone 0 is replaced
      else ins(d);
    }
    function dot() {
      fresh();
      if (s.length >= MAXEXP || s[pos - 1] === '%') return;
      const r = runAt(pos);
      if (s.slice(r[0], r[1]).indexOf('.') > -1) return;
      ins(isNum(s[pos - 1]) ? '.' : '0.');
    }
    function op(o) {
      if (err) reset();
      if (res !== null) carry();
      if (s.length >= MAXEXP) return;
      let ran = false;
      while (pos > 0 && isOp(s[pos - 1])) { s = s.slice(0, pos - 1) + s.slice(pos); pos--; ran = true; }   // operator pressed twice: replace it
      if (pos > 0 && !ran && isOp(s[pos])) s = s.slice(0, pos) + s.slice(pos + 1);                         // caret just before an operator: replace that one
      if (pos === 0) {
        if (o === '-') { if (isOp(s[0])) return; ins('-'); }                                              // a minus at the very start is a sign
        else ins('0' + o);
      } else ins(o);
    }
    function equals() {
      if (err || res !== null || !s) return;
      try {
        const t = parse(s);
        if (!t.length) return;                                      // only operators typed: nothing to work out
        const r = evaluate(t);
        line = shown(s.replace(/[+\-*/]+$/, '')) + ' =';
        res = String(r);
        s = ''; pos = 0;
      } catch (e) { err = true; s = ''; pos = 0; res = null; /* e.g. divide by zero: shown as an error on the display, not a bug */ }
    }
    function percent() {
      if (err) return;
      if (res !== null) carry();
      if (s.length >= MAXEXP || !isNum(s[pos - 1]) || isNum(s[pos]) || s[pos] === '%') return;   // only right after a number, once
      ins('%');                                                      // stays in the sum as typed: 25% is shown as 25%
    }
    function sign() {
      if (err) return;
      if (res !== null) carry();
      const r = runAt(pos), a = r[0];
      if (a === r[1]) {                                              // no number at the caret: start a negative one
        if (s.length >= MAXEXP - 1 || s[pos - 1] === '%') return;
        ins('-0');
        return;
      }
      if (a > 0 && s[a - 1] === '-' && (a === 1 || isOp(s[a - 2]))) { s = s.slice(0, a - 1) + s.slice(a); if (pos >= a) pos--; }   // already negative: drop the sign
      else if (s.length < MAXEXP) { s = s.slice(0, a) + '-' + s.slice(a); if (pos >= a) pos++; }
    }
    function back() {
      if (res !== null || err) { reset(); return; }
      if (pos > 0) { s = s.slice(0, pos - 1) + s.slice(pos); pos--; }
    }

    gr.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b || !ctx.alive) return;
      const k = b.dataset.k;
      if (/^\d$/.test(k)) digit(k);
      else if (k === '.') dot();
      else if (SYM[k]) op(k);
      else if (k === '=') equals();
      else if (k === '%') percent();
      else if (k === '\u00B1') sign();
      else if (k === '\u232B') back();
      else if (k === 'AC') reset();
      paint();
    });

    // Caret: tap the display to put it between two characters, drag to slide it.
    // Holding the finger at the left or right edge keeps moving it (so a long sum can be walked through).
    let drag = false, edge = 0, edgeAt = 0;
    const hit = x => {                               // x on screen -> caret position
      const sp = ex.querySelectorAll('[data-i]');
      for (let k = 0; k < sp.length; k++) {
        const r = sp[k].getBoundingClientRect();
        if (x < r.left + r.width / 2) return +sp[k].dataset.i;
      }
      return s.length;
    };
    const setEdge = x => {
      const r = ex.getBoundingClientRect();
      const e = x < r.left + 14 ? -1 : x > r.right - 14 ? 1 : 0;
      if (e !== edge) { edge = e; edgeAt = Date.now(); }
    };
    dp.addEventListener('pointerdown', e => {
      if (!ctx.alive || res !== null || err) return;
      drag = true;
      try { dp.setPointerCapture(e.pointerId); } catch (x) { /* pointer already gone: a tap still places the caret */ }
      pos = hit(e.clientX);
      setEdge(e.clientX);
      paint();
    });
    dp.addEventListener('pointermove', e => {
      if (!drag || !ctx.alive) return;
      pos = hit(e.clientX);
      setEdge(e.clientX);
      paint();
    });
    const release = () => { drag = false; edge = 0; };
    dp.addEventListener('pointerup', release);
    dp.addEventListener('pointercancel', release);
    ctx.every(() => {
      if (!drag || !edge || Date.now() - edgeAt < 250) return;
      pos = Math.max(0, Math.min(s.length, pos + edge));
      paint();
    }, 80);

    paint();
  }

  SD.register({
    id: 'calculator',
    label: 'Calculator',
    width: 224,
    // calculator: rounded body, screen, key dots
    icon: '<rect x="5" y="2.5" width="14" height="19" rx="2.5"/><rect x="8" y="5.5" width="8" height="3.5" rx=".8"/>' + [[9, 13], [12, 13], [15, 13], [9, 16.5], [12, 16.5], [15, 16.5]].map(c => '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="1.1" fill="#d0d0d0" stroke="none"/>').join(''),
    mount
  });
})();
