// Speed Dial module: Calculator v0.2.0
// A plain calculator: + - x / with the usual precedence (2+3x4 = 14), %, +/-, backspace, AC.
// Display like Google's calculator: what you type is the big line, the live result sits under it (smaller, purple).
// After "=" the sum shrinks to the top and the result becomes the big line.
// % after + or - is a percentage of the number before it (200+10% = 220); otherwise it divides by 100.
// Nothing is saved and nothing is sent anywhere. No eval (Torn's CSP blocks it): the sum is worked out by hand below.
(function () {
  'use strict';
  const SD = window.SpeedDial;
  if (!SD) return;

  const CSS = `
    #sdial .calc{user-select:none;-webkit-user-select:none}
    #sdial .calc .dp{height:68px;padding:4px 8px 6px;margin-bottom:6px;border-radius:8px;background:#242424;display:flex;flex-direction:column;justify-content:flex-end;overflow:hidden}
    #sdial .calc .ex{height:32px;line-height:32px;font-size:26px;color:#f0f0f0;text-align:right;white-space:nowrap;overflow:hidden}
    #sdial .calc .ex.sm{font-size:20px}
    #sdial .calc .ex.xs{font-size:15px}
    #sdial .calc .ex.dn{height:18px;line-height:18px;font-size:12px;color:#8a8a8a}
    #sdial .calc .rs{height:20px;line-height:20px;font-size:16px;color:#9b93d4;text-align:right;white-space:nowrap;overflow:hidden}
    #sdial .calc .rs.dn{height:32px;line-height:32px;font-size:26px;color:#f0f0f0}
    #sdial .calc .rs.sm{font-size:20px}
    #sdial .calc .rs.xs{font-size:15px}
    #sdial .calc .gr{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}
    #sdial .calc .gr button{height:38px;border-radius:8px;border:1px solid #333;background:#242424;color:#e6e6e6;font-size:16px;padding:0;touch-action:manipulation}
    #sdial .calc .gr button:active{background:#383838}
    #sdial .calc .gr .fn{background:#2b2b2b;color:#cfcfcf;font-size:14px}
    #sdial .calc .gr .op{background:#2f2f2f;border-color:#444;color:#d4d4d4;font-size:18px}
    #sdial .calc .gr .op.cur{background:#383838;border-color:#8a8a8a;color:#fff}
    #sdial .calc .gr .eq{background:#25360f;border-color:#85b200;color:#c6e66a}
    #sdial .calc .gr .eq:active{background:#33491a}
  `;

  const SYM = { '+': '+', '-': '\u2212', '*': '\u00D7', '/': '\u00F7' };
  const MAXLEN = 15;

  // 12 significant digits hides 0.1+0.2 = 0.30000000000000004
  const clean = n => parseFloat(n.toPrecision(12));
  const group = s => {                              // 1234567.5 -> 1,234,567.5 (display only)
    if (/e/i.test(s)) return s;
    const m = /^(-?)(\d*)(\.?.*)$/.exec(s);
    return m[1] + m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + m[3];
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
  const toNums = t => t.map((x, i) => (i % 2 ? x : Number(x)));

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
    const ex = el.querySelector('.ex'), rs = el.querySelector('.rs'), gr = el.querySelector('.gr');
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

    let exp = [];       // finished part: number strings and operators
    let cur = '';       // number being typed
    let res = null;     // result string right after "="
    let err = false;
    let line = '';      // top line after "="

    const text = () => exp.map(x => (SYM[x] || group(x))).concat(cur !== '' ? [group(cur)] : []).join(' ');
    const size = (n, s) => (s.length > (n ? 11 : 17) ? ' xs' : s.length > (n ? 8 : 11) ? ' sm' : '');
    const put = (node, base, str, sz) => {          // text in a line; long ones shrink, and the end stays in view
      node.className = base + sz;
      node.textContent = str;
      node.scrollLeft = node.scrollWidth;
    };

    function paint() {
      let top, sub = '', done = false;
      if (err) { top = 'Error'; }
      else if (res !== null) { top = group(res); sub = line; done = true; }
      else {
        top = text() || '0';
        const t = exp.slice();                       // live result under the line, once there is a sum to work out
        if (cur !== '') t.push(cur.replace(/\.$/, ''));
        if (t.length && t.length % 2 === 0) t.pop();
        if (t.length >= 3) { try { sub = group(String(calc(toNums(t)))); } catch (e) { sub = ''; } }
      }
      if (done) {                                    // after "=": sum small on top, result big below
        put(ex, 'ex dn', sub, '');
        put(rs, 'rs dn', top, size(false, top));
      } else {
        put(ex, 'ex', top, size(true, top));
        put(rs, 'rs', sub, '');
      }
      const last = exp[exp.length - 1];
      Object.keys(SYM).forEach(o => btn[o].classList.toggle('cur', cur === '' && res === null && last === o));
    }

    const reset = () => { exp = []; cur = ''; res = null; err = false; line = ''; };
    const fresh = () => { if (res !== null || err) reset(); };   // typing after "=" starts over

    function digit(d) {
      fresh();
      if (cur.replace(/[-.]/g, '').length >= MAXLEN) return;
      if (cur === '0' || cur === '-0') cur = cur.replace('0', d);
      else cur += d;
    }
    function dot() {
      fresh();
      if (cur.indexOf('.') > -1) return;
      cur = (cur === '' ? '0' : cur === '-' ? '-0' : cur) + '.';
    }
    function op(o) {
      if (err) reset();
      if (res !== null) { exp = [res]; res = null; line = ''; cur = ''; }
      if (cur !== '') {
        exp.push(cur.replace(/\.$/, ''));
        cur = '';
      } else if (!exp.length) { exp.push('0'); }
      if (exp.length % 2 === 0) exp[exp.length - 1] = o;   // operator pressed twice: replace it
      else exp.push(o);
    }
    function equals() {
      if (err || res !== null) return;
      const t = exp.slice();
      if (cur !== '') t.push(cur.replace(/\.$/, ''));
      if (t.length && t.length % 2 === 0) t.pop();         // trailing operator is dropped
      if (!t.length) return;
      try {
        const r = calc(toNums(t));
        line = t.map(x => (SYM[x] || group(x))).join(' ') + ' =';
        res = String(r);
        exp = []; cur = '';
      } catch (e) { err = true; exp = []; cur = ''; res = null; }
    }
    function percent() {
      if (err) return;
      let n;
      if (res !== null) { n = Number(res); exp = []; res = null; line = ''; }
      else if (cur !== '') n = Number(cur);
      else return;
      const o = exp[exp.length - 1];
      if ((o === '+' || o === '-') && exp.length >= 2) {
        try { n = Number(calc(toNums(exp.slice(0, -1)))) * n / 100; } catch (e) { n = n / 100; }   // 200 + 10% = 200 + 20
      } else n = n / 100;
      cur = String(clean(n));
    }
    function sign() {
      if (err) return;
      if (res !== null) { cur = res; res = null; exp = []; line = ''; }
      if (cur === '') cur = '-0';
      else cur = cur[0] === '-' ? cur.slice(1) : '-' + cur;
      if (cur === '-' ) cur = '';
    }
    function back() {
      if (res !== null || err) { reset(); return; }
      if (cur !== '') { cur = cur.slice(0, -1); if (cur === '-' || cur === '-0') cur = ''; }
      else if (exp.length) {
        exp.pop();                                          // drop the operator and carry on editing the number before it
        if (exp.length) cur = exp.pop();
      }
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
