// Speed Dial module: Shortcuts v0.1.0
// Your own page shortcuts. Each one is a circle with an emoji; tapping it just opens that Torn page.
// The "+" circle at the end opens a small form to add one (emoji, name, page) and lists them for removal.
// Only torn.com pages are accepted. Nothing is read from or clicked on the page.
(function () {
  'use strict';
  const SD = window.SpeedDial;
  if (!SD) return;

  const LS = 'speedDial.shortcuts1';
  const MAX = 8;
  const QUICK = ['\u{1F3E0}', '\u{1F6D2}', '\u{1F3E6}', '\u{1F3B0}', '\u2694\uFE0F', '\u{1F3E5}', '\u{1F4BC}', '\u{1F4E6}', '\u{1F3AF}', '\u2B50'];
  let list = SD.read(LS, []);
  if (!Array.isArray(list)) list = [];
  const save = () => SD.write(LS, list);

  const sid = s => 'sc-' + s.id;
  const reg = s => SD.register({ id: sid(s), label: s.n, emoji: s.e, href: s.u, ord: 500 });
  list.forEach(reg);

  // torn.com page only: "/bazaar.php", "torn.com/bazaar.php" or "https://www.torn.com/bazaar.php"
  const fixUrl = raw => {
    let u = String(raw || '').trim();
    if (!u) return '';
    if (u[0] === '/') return (u[1] === '/' || u[1] === '\\') ? '' : u;
    if (/^(www\.)?torn\.com\//i.test(u)) u = 'https://' + u;
    return /^https:\/\/(www\.)?torn\.com\//i.test(u) ? u : '';
  };

  // first emoji of the input (keeps skin tones and combined emoji in one piece)
  let PICT;
  try { PICT = new RegExp('\\p{Extended_Pictographic}', 'u'); } catch (e) { PICT = /[^\x00-\x7F]/; }
  const firstChar = s => {
    try {
      if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        const it = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)[Symbol.iterator]().next();
        return it.done ? '' : it.value.segment;
      }
    } catch (e) {}
    return Array.from(s)[0] || '';
  };
  const emojiOf = raw => {
    const s = String(raw || '').trim();
    if (!s) return '\u2B50';
    const g = firstChar(s);
    return PICT.test(g) ? g : '';
  };

  const CSS = `
    #sdial .scx .ttl{font-size:13px;margin:2px 2px 6px;color:#e6e6e6}
    #sdial .scx .qk{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px}
    #sdial .scx .qk button{flex:0 0 auto;width:30px;height:30px;font-size:16px;padding:0}
    #sdial .scx .rw{display:flex;gap:6px;margin-bottom:6px}
    #sdial .scx input{min-width:0;height:32px;border-radius:8px;border:1px solid #333;background:#242424;color:#e6e6e6;font-size:13px;padding:0 8px}
    #sdial .scx .ie{flex:0 0 64px;text-align:center;font-size:16px}
    #sdial .scx .in,#sdial .scx .iu{flex:1}
    #sdial .scx button{height:32px;border-radius:8px;border:1px solid #333;background:#242424;color:#cfcfcf;font-size:12px;padding:0 8px}
    #sdial .scx button:active{background:#2e2e2e}
    #sdial .scx .add{width:100%}
    #sdial .scx .lst{margin-top:6px;max-height:30vh;overflow-y:auto;touch-action:pan-y}
    #sdial .scx .it{display:flex;align-items:center;gap:8px;height:34px;padding:0 4px 0 10px;border-radius:8px;background:#242424;margin-bottom:3px}
    #sdial .scx .it .ix{font-size:16px}
    #sdial .scx .it .nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #sdial .scx .it .del{height:26px;width:30px;padding:0;color:#f1807a}
  `;

  function mount(ctx) {
    SD.css('sd-shortcuts', CSS);
    const el = ctx.el;
    el.className = 'scx';
    el.innerHTML =
      '<div class="ttl">Add shortcut</div>' +
      '<div class="qk"></div>' +
      '<div class="rw"><input class="ie" maxlength="12" placeholder="Emoji" autocomplete="off"><input class="in" maxlength="20" placeholder="Name" autocomplete="off"></div>' +
      '<div class="rw"><input class="iu" placeholder="/page.php?sid=..." autocomplete="off" autocapitalize="off" spellcheck="false"><button class="here">This page</button></div>' +
      '<button class="add">Add</button>' +
      '<div class="lst"></div>';
    const qk = el.querySelector('.qk'), lst = el.querySelector('.lst');
    const inE = el.querySelector('.ie'), inN = el.querySelector('.in'), inU = el.querySelector('.iu');

    QUICK.forEach(e => {
      const b = document.createElement('button');
      b.textContent = e;
      b.addEventListener('click', () => { inE.value = e; });
      qk.appendChild(b);
    });

    // fill the form from the page you are on right now (address only, nothing else is read)
    el.querySelector('.here').addEventListener('click', () => {
      inU.value = location.pathname + location.search + location.hash;
      if (!inN.value) inN.value = (document.title || '').replace(/\s*[|\u2013-]\s*TORN.*$/i, '').trim().slice(0, 20);
    });

    function renderList() {
      lst.innerHTML = '';
      list.forEach(s => {
        const r = document.createElement('div');
        r.className = 'it';
        r.innerHTML = '<span class="ix"></span><span class="nm"></span><button class="del" aria-label="Delete">\u2715</button>';
        r.querySelector('.ix').textContent = s.e;
        r.querySelector('.nm').textContent = s.n;
        r.querySelector('.del').addEventListener('click', () => {
          list = list.filter(x => x.id !== s.id);
          save();
          SD.unregister(sid(s));
          renderList();
        });
        lst.appendChild(r);
      });
    }

    el.querySelector('.add').addEventListener('click', () => {
      if (list.length >= MAX) { SD.toast('Maximum ' + MAX + ' shortcuts'); return; }
      const e = emojiOf(inE.value), n = inN.value.trim().slice(0, 20), u = fixUrl(inU.value);
      if (!e) { SD.toast('Emoji must be an emoji'); return; }
      if (!n) { SD.toast('Enter a name'); return; }
      if (!u) { SD.toast('Use a torn.com page'); return; }
      const s = { id: Date.now().toString(36), e, n, u };
      list.push(s);
      save();
      reg(s);
      inE.value = inN.value = inU.value = '';
      renderList();
      SD.toast('Added ' + n);
    });

    renderList();
  }

  SD.register({
    id: 'shortcuts-add',
    label: 'Add shortcut',
    width: 240,
    ord: 1000,
    // plus
    icon: '<path d="M12 5v14M5 12h14"/>',
    mount
  });
})();
