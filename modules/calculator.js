// Speed Dial module: Calculator v0.3.1
// A plain calculator: + - x / with the usual precedence (2+3x4 = 14), %, +/-, backspace, AC.
// Display like Google's calculator: what you type is the big line, the live result sits under it (smaller, purple).
// Tap anywhere in the typed sum to put the blinking caret there; digits, operators, +/-, % and backspace then work at the caret,
// so a typo in a long sum can be fixed without retyping.
// After "=" the sum shrinks to the top and the result becomes the big line. Tap the sum to edit it again, tap the result to carry on from it.
// % stays visible as typed (8% , 2,000 - 20%); its value is worked out when the sum is calculated.
// % after + or - is a percentage of everything before it (200+10% = 220); otherwise it divides by 100.
// Nothing is saved and nothing is sent anywhere. No eval (Torn's CSP blocks it): the sum is worked out by hand below.
(function () {
  'use strict';
  const SD = window.SpeedDial;
  if (!SD) return;

  const CSS = `
    #sdial .calc{user-select:none;-webkit-user-select:none}
    #sdial .calc .dp{height:68px;padding:4px 8px 6px;margin-bottom:6px;border-radius:8px;background:var(--sd-bg2);display:flex;flex-direction:column;justify-content:flex-end;overflow:hidden}
    #sdial .calc .ex{position:relative;height:32px;line-height:32px;font-size:26px;color:#f0f0f0;text-align:right;white-space:nowrap;overflow:hidden}
    #sdial .calc .ex.sm{font-size:20px}
    #sdial .calc .ex.xs{font-size:15px}
    #sdial .calc .ex.dn{height:18px;line-height:18px;font-size:12px;color:var(--sd-dim)}
    #sdial .calc .ex .o{margin:0 2px}
    #sdial .calc .ex .z{color:#666}
    #sdial .calc .ex .cr{display:inline-block;width:2px;height:1.1em;margin:0 -1px;background:currentColor;vertical-align:middle;animation:sdcb 1s steps(1) infinite}
    @keyframes sdcb{50%{opacity:0}}
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
  const MAXLEN = 15;      // digits in one number
  const MAXEXP = 200;     // characters in the whole sum

  const isOp = c => typeof c === 'string' && c.length === 1 && '+-*/'.indexOf(c) > -1;

  // 12 significant digits hides 0.1+0.2 = 0.30000000000000004
  const clean = n => parseFloat(n.toPrecision(12));
  const group = s => {                              // 1234567.5 -> 1,234,567.5 (display only)
    if (/e/i.test(s)) return s;
    const m = /^(-?)(\d*)(\.?.*)$/.exec(s);
    return m[1] + m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + m[3];
  };
  // a result like 1e-7 has to become plain digits before it can be edited again
  const plain = r => {
    if (!/e/i.test(r)) return r;
    const n = Number(r);
    if (Math.abs(n) < 1) return n.toFixed(20).replace(/0+$/, '').replace(/\.$/, '');
    return n.toLocaleString('fullwide', { useGrouping: false, maximumFractionDigits: 0 });
  };

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
  // turns tokens into numbers; "20%" becomes 0.2, or after + / - a percentage of everything before it (2000 - 20% = 2000 - 400)
  const toNums = t => {
    const out = [];
    t.forEach((x, i) => {
      if (i % 2) { out.push(x); return; }
      if (/%$/.test(x)) {
        let n = Number(x.slice(0, -1)) / 100;
        if (i >= 2 && (t[i - 1] === '+' || t[i - 1] === '-')) {
          try { n = calc(out.slice(0, -1)) * n; } catch (e) { /* nothing to take a percentage of: plain n/100 */ }
        }
        out.push(clean(n));
      } else out.push(Number(x));
    });
    return out;
  };

  // typed text -> tokens ["2000","-","20%"]; null if it is not a complete sum. A trailing operator is dropped.
  function parse(s) {
    const n = s.length, t = [];
    let i = 0;
    if (!n) return null;
    for (;;) {
      let j = i;
      const neg = s[j] === '-';
      if (neg) j++;
      let k = j;
      while (k < n && /[\d.]/.test(s[k])) k++;
      let num = s.slice(j, k);
      if (!/\d/.test(num)) {
        if (i >= n && t.length >= 2) { t.pop(); break; }
        return null;
      }
      if (num.split('.').length > 2) return null;
      num = num.replace(/\.$/, '');
      if (num[0] === '.') num = '0' + num;
      let pct = '';
      if (s[k] === '%') { pct = '%'; k++; }
      t.push((neg ? '-' : '') + num + pct);
      i = k;
      if (i >= n) break;
      if (!isOp(s[i])) return null;
      t.push(s[i]);
      i++;
    }
    return t;
  }

  // one entry per shown character; i = index in the typed text, -1 for the thousands commas (display only)
  function cells(str) {
    const out = [], n = str.length;
    let i = 0;
    while (i < n) {
      if (/\d/.test(str[i])) {
        let j = i;
        while (j < n && /\d/.test(str[j])) j++;
        const frac = str[i - 1] === '.', len = j - i;
        for (let k = 0; k < len; k++) {
          if (!frac && k > 0 && (len - k) % 3 === 0) out.push({ ch: ',', i: -1 });
          out.push({ ch: str[i + k], i: i + k });
        }
        i = j;
      } else { out.push({ ch: str[i], i: i }); i++; }
    }
    return out;
  }
  const cellsText = str => cells(str).map(c => SYM[c.ch] || c.ch).join('');

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
    el.innerHTML = '<div class="dp"><div class="ex"></div><div class="rs"></div></div><div class="gr"></div>';
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

    let s = '';         // the sum as typed, e.g. "2000-20%"
    let pos = 0;        // caret: index in s where the next key lands
    let res = null;     // result string right after "="
    let src = '';       // the sum that gave res (so it can be edited again)
    let note = '';      // "Error" under the sum when "=" can't work it out; the sum itself is kept

    const reset = () => { s = ''; pos = 0; res = null; src = ''; note = ''; };
    const fresh = () => { if (res !== null) reset(); };            // typing a number after "=" starts over
    const load = str => { s = str; pos = str.length; res = null; src = ''; };
    const ins = str => {
      if (s.length + str.length > MAXEXP) return;
      s = s.slice(0, pos) + str + s.slice(pos);
      pos += str.length;
    };
    const unary = i => s[i] === '-' && (i === 0 || isOp(s[i - 1]));   // a minus that belongs to the number after it
    const run = (l, r, re) => { while (l > 0 && re.test(s[l - 1])) l--; while (r < s.length && re.test(s[r])) r++; return [l, r]; };

    const size = (n, t) => (t.length > (n ? 11 : 17) ? ' xs' : t.length > (n ? 8 : 11) ? ' sm' : '');
    const put = (node, base, str, sz) => {          // text in a line; long ones shrink, and the end stays in view
      node.className = base + sz;
      node.textContent = str;
      node.scrollLeft = node.scrollWidth;
    };
    function exprHtml() {
      let h = '', placed = false;
      cells(s).forEach(c => {
        if (c.i < 0) { h += '<span class="cm">,</span>'; return; }
        if (!placed && c.i >= pos) { h += '<span class="cr"></span>'; placed = true; }
        h += '<span data-i="' + c.i + '"' + (SYM[c.ch] ? ' class="o"' : '') + '>' + (SYM[c.ch] || c.ch) + '</span>';
      });
      if (!placed) h += '<span class="cr"></span>';
      return h;
    }

    function paint() {
      if (res !== null) {                            // after "=": sum small on top, result big below
        const big = group(res);
        put(ex, 'ex dn', cellsText(src) + ' =', '');
        put(rs, 'rs dn', big, size(false, big));
      } else {
        const sl = ex.scrollLeft;
        ex.className = 'ex' + size(true, cellsText(s));
        ex.innerHTML = s === '' ? '<span class="z">0</span><span class="cr"></span>' : exprHtml();
        ex.scrollLeft = sl;
        const cr = ex.querySelector('.cr');          // keep the caret in view
        if (cr) {
          const cl = cr.offsetLeft, w = ex.clientWidth;
          if (cl > ex.scrollLeft + w - 14) ex.scrollLeft = cl - w + 14;
          else if (cl < ex.scrollLeft + 14) ex.scrollLeft = Math.max(0, cl - 14);
        }
        let sub = note;                              // live result under the line, once there is a sum to work out
        if (!sub) {
          const t = parse(s);
          if (t && (t.length >= 3 || (t.length === 1 && /%$/.test(t[0])))) {
            try { sub = group(String(calc(toNums(t)))); } catch (e) { sub = ''; /* e.g. divide by zero: no preview */ }
          }
        }
        put(rs, 'rs', sub, '');
      }
      const last = s[pos - 1];
      Object.keys(SYM).forEach(o => btn[o].classList.toggle('cur', res === null && pos === s.length && last === o));
    }

    // a digit typed straight after a % at the very end replaces that percent number (8% then 5 -> 5)
    function startNew() {
      if (pos !== s.length) return false;
      let j = pos - 1;
      while (j > 0 && /[\d.%]/.test(s[j - 1])) j--;
      if (j > 0 && unary(j - 1)) j--;
      s = s.slice(0, j); pos = j;
      return true;
    }
    function digit(d) {
      fresh();
      if (s[pos - 1] === '%' && !startNew()) return;
      const [l, r] = run(pos, pos, /[\d.]/);
      const n = s.slice(l, r);
      if (n.replace('.', '').length >= MAXLEN) return;
      if (n === '0' && pos === r) { s = s.slice(0, l) + d + s.slice(r); pos = l + 1; }   // 0 then 5 -> 5
      else ins(d);
    }
    function dot() {
      fresh();
      if (s[pos - 1] === '%' && !startNew()) return;
      const [l, r] = run(pos, pos, /[\d.]/);
      const n = s.slice(l, r);
      if (n.indexOf('.') > -1) return;
      ins(n === '' || pos === l ? '0.' : '.');
    }
    function op(o) {
      if (res !== null) load(plain(res));
      if (s === '') { s = '0'; pos = 1; }
      const prev = s[pos - 1];
      if (isOp(prev)) {                              // operator pressed twice: replace it
        if (unary(pos - 1)) return;
        s = s.slice(0, pos - 1) + o + s.slice(pos);
        return;
      }
      if (pos === 0) { ins(o === '-' ? '-' : '0' + o); return; }
      if (isOp(s[pos]) && !unary(pos)) { s = s.slice(0, pos) + o + s.slice(pos + 1); pos++; return; }   // caret just before an operator: swap it
      ins(o);
    }
    function equals() {
      if (res !== null || !s) return;
      const t = parse(s);
      if (!t) { note = 'Error'; return; }
      try {
        const r = calc(toNums(t));
        src = t.join('');                            // trailing operator is dropped
        res = String(r);
        s = ''; pos = 0;
      } catch (e) { note = 'Error'; /* e.g. divide by zero: the sum stays so it can be fixed */ }
    }
    function percent() {
      if (res !== null) load(plain(res));
      if (!/[\d.]/.test(s[pos - 1] || '')) return;
      while (pos < s.length && /[\d.]/.test(s[pos])) pos++;   // % goes after the whole number the caret is in
      if (s[pos] === '%') return;
      if (s[pos - 1] === '.') { s = s.slice(0, pos - 1) + s.slice(pos); pos--; }
      ins('%');
    }
    function sign() {
      if (res !== null) load(plain(res));
      const [l, r] = run(pos, pos, /[\d.%]/);
      if (l === r) {
        if (pos > 0 && unary(pos - 1)) { s = s.slice(0, pos - 1) + s.slice(pos); pos--; }
        else ins('-0');
        return;
      }
      if (l > 0 && unary(l - 1)) { s = s.slice(0, l - 1) + s.slice(l); pos--; }
      else { s = s.slice(0, l) + '-' + s.slice(l); pos++; }
    }
    function back() {
      if (res !== null) { reset(); return; }
      if (pos === 0) return;
      s = s.slice(0, pos - 1) + s.slice(pos);
      pos--;
    }

    gr.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b || !ctx.alive) return;
      const k = b.dataset.k;
      note = '';
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

    // tap in the sum to move the caret; after "=" tap the sum to edit it, or the result to carry on from it
    dp.addEventListener('click', e => {
      if (!ctx.alive) return;
      note = '';
      if (res !== null) {
        if (e.target.closest('.rs')) load(plain(res));
        else load(src);
        paint();
        return;
      }
      if (e.target.closest('.rs')) return;
      let p = s.length;
      const sp = ex.querySelectorAll('[data-i]');
      for (let i = 0; i < sp.length; i++) {
        const r = sp[i].getBoundingClientRect();
        if (e.clientX < r.left + r.width / 2) { p = Number(sp[i].dataset.i); break; }
      }
      pos = p;
      paint();
    });
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
