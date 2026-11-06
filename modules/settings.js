// Speed Dial module: Settings v0.8.0
// The pinned gear circle (always last, cannot be hidden). Pages are chosen from a Torn-style menu:
// tap the 3-line button, a list of pages opens, tap one to go there. To add a page later, add an entry
// to PAGES (id, label, icon, optional show hook) and a matching <div class="pg ID"> in the markup.
//   Menu          - two groups: "On screen" (max 3 circles) and "Show More" (everything else). The pin moves a module
//                   between the groups. Edit mode: drag the handle to reorder inside a group, and remove your own shortcuts.
//   Features      - on/off switch for every page feature (things that run on a Torn page, outside the circles).
//                   A row of filter chips on top (All + one per category, swipe it sideways), then one section per category
//                   (title + count) with a card per feature: name, "!" and the switch. The "!" opens a small pop-up with the
//                   one-line explanation and the page it works on. The chosen filter is remembered (speedDial.featcat1).
//   Shortcut      - your own emoji circles that open a torn.com page (this is the old "Add shortcut" module).
//   Terminal      - the debug log (SD.log in core.js): what Speed Dial did, API calls, storage writes, warnings and errors.
//                   Lines live in memory only; Save keeps a copy in storage so it survives a reload (view it with Saved).
// Nothing is read from or clicked on the page. Only torn.com pages are accepted.
(function () {
  'use strict';
  const SD = window.SpeedDial;
  if (!SD) return;

  const LS = 'speedDial.shortcuts1';   // same key as the old Shortcuts module, so saved shortcuts carry over
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
    } catch (e) { /* Segmenter unsupported: fall through to Array.from below */ }
    return Array.from(s)[0] || '';
  };
  const emojiOf = raw => {
    const s = String(raw || '').trim();
    if (!s) return '\u2B50';
    const g = firstChar(s);
    return PICT.test(g) ? g : '';
  };

  const PIN = '<svg viewBox="0 0 24 24"><path d="M9 3.5h6l-.8 5.2 2.8 3.3v1.2H7V12l2.8-3.3z"/><line x1="12" y1="13.2" x2="12" y2="20.5"/></svg>';
  const GRIP = '<svg viewBox="0 0 24 24"><line x1="5" y1="8" x2="19" y2="8"/><line x1="5" y1="12" x2="19" y2="12"/><line x1="5" y1="16" x2="19" y2="16"/></svg>';
  const HAMB = '<svg viewBox="0 0 24 24"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>';

  // pages shown in the menu (order = order in the list). show(): optional, runs every time the page opens
  const ICON_MENU = '<svg viewBox="0 0 24 24"><line x1="9" y1="7" x2="20" y2="7"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="17" x2="20" y2="17"/><circle cx="5" cy="7" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="5" cy="17" r="1"/></svg>';
  const ICON_FEAT = '<svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="10" rx="5"/><circle cx="16" cy="12" r="2.5"/></svg>';
  const ICON_TERM = '<svg viewBox="0 0 24 24"><polyline points="4 7 9 12 4 17"/><line x1="12" y1="17" x2="20" y2="17"/></svg>';
  const ICON_ADD = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>';

  const CSS = `
    #sdial .cz .nav{display:flex;align-items:center;gap:8px;height:var(--sd-h);margin-bottom:6px}
    #sdial .cz .nav .hb{flex:0 0 auto;width:38px;height:var(--sd-h);padding:0;display:flex;align-items:center;justify-content:center}
    #sdial .cz .nav .hb svg{width:20px;height:20px;fill:none;stroke:var(--sd-text2);stroke-width:2;stroke-linecap:round}
    #sdial .cz .nav .hb.on{background:var(--sd-line);border-color:var(--sd-lift)}
    #sdial .cz .nav .cur{flex:1;min-width:0;font-size:13px;font-weight:700;color:var(--sd-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #sdial .cz .mn{display:none;max-height:42vh;overflow-y:auto;touch-action:pan-y;margin-bottom:2px}
    #sdial .cz.nav-open .mn{display:block}
    #sdial .cz.nav-open .pg{display:none !important}
    #sdial .cz .mn .mi{display:flex;align-items:center;gap:10px;width:100%;height:var(--sd-row);padding:0 10px;margin-bottom:3px;border-radius:8px;border:1px solid transparent;background:var(--sd-bg2);color:var(--sd-text2);font-size:13px;text-align:left}
    #sdial .cz .mn .mi.on{background:var(--sd-line);color:#fff;border-color:var(--sd-lift)}
    #sdial .cz .mn .mi svg{flex:0 0 auto;width:18px;height:18px;fill:none;stroke:var(--sd-dim);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    #sdial .cz .mn .mi.on svg{stroke:var(--sd-text)}
    #sdial .cz .pg{display:none}
    #sdial .cz .pg.on{display:block}
    #sdial .cz .qk{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px}
    #sdial .cz .qk button{flex:0 0 auto;width:var(--sd-h);height:var(--sd-h);font-size:16px;padding:0}
    #sdial .cz .rw{display:flex;gap:6px;margin-bottom:6px}
    #sdial .cz input{min-width:0;height:var(--sd-hi);border-radius:8px;border:1px solid var(--sd-line);background:var(--sd-bg2);color:var(--sd-text);font-size:13px;padding:0 8px}
    #sdial .cz .ie{flex:0 0 64px;text-align:center;font-size:16px}
    #sdial .cz .in,#sdial .cz .iu{flex:1}
    #sdial .cz button{height:var(--sd-h);border-radius:8px;border:1px solid var(--sd-line);background:var(--sd-bg2);color:var(--sd-text2);font-size:12px;padding:0 8px}
    #sdial .cz button:active{background:var(--sd-hov)}
    #sdial .cz .add,#sdial .cz .edit{width:100%}
    #sdial .cz .lst{touch-action:pan-y;margin-bottom:6px}
    #sdial .cz .lst.lm{max-height:30vh;overflow-y:auto}
    #sdial .cz .gh{display:flex;align-items:center;justify-content:space-between;height:22px;padding:0 4px;margin-bottom:3px;font-size:11px;color:var(--sd-dim);letter-spacing:.3px;text-transform:uppercase}
    #sdial .cz .gh b{font-weight:700;color:var(--sd-text2)}
    #sdial .cz .gh b.full{color:var(--sd-green)}
    #sdial .cz .ge{padding:8px 4px 10px;font-size:12px;color:var(--sd-mute);text-align:center}
    #sdial .cz .it .pin{color:var(--sd-dim)}
    #sdial .cz .it .pin svg{stroke:var(--sd-dim)}
    #sdial .cz .it .pin.on{border-color:var(--sd-green);background:var(--sd-greenbg)}
    #sdial .cz .it .pin.on svg{stroke:var(--sd-green);fill:rgba(133,178,0,.35)}
    #sdial .cz .it{display:flex;align-items:center;gap:8px;height:var(--sd-h);padding:0 4px 0 10px;border-radius:8px;background:var(--sd-bg2);margin-bottom:3px;user-select:none;-webkit-user-select:none}
    #sdial .cz .it.drag{position:relative;z-index:5;background:var(--sd-line);box-shadow:0 4px 12px rgba(0,0,0,.55)}
    #sdial .cz .it .ix{width:20px;display:flex;align-items:center;justify-content:center;font-size:16px;flex:0 0 auto}
    #sdial .cz .it .ix svg{width:18px;height:18px}
    #sdial .cz .it .nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #sdial .cz .it.off .ix,#sdial .cz .it.off .nm{opacity:.4}
    #sdial .cz .it .grip{display:none;align-items:center;justify-content:center;width:30px;height:var(--sd-h);margin:0 0 0 -10px;touch-action:none;cursor:grab;flex:0 0 auto}
    #sdial .cz .it .grip svg{width:18px;height:18px;stroke:var(--sd-dim)}
    #sdial .cz.edit .it .grip{display:flex}
    #sdial .cz .it.drag .grip svg{stroke:var(--sd-text)}
    #sdial .cz .it .btn{height:26px;width:30px;padding:0;display:flex;align-items:center;justify-content:center;flex:0 0 auto}
    #sdial .cz .it .btn svg{width:16px;height:16px}
    #sdial .cz .it .del{display:none;color:var(--sd-redt)}
    #sdial .cz.edit .it.cu .del{display:flex}
    #sdial .cz .fl{max-height:42vh;overflow-y:auto;touch-action:pan-y;margin-bottom:2px}
    #sdial .cz .fc{display:flex;gap:6px;overflow-x:auto;overflow-y:hidden;touch-action:pan-x;margin:0 0 6px;padding-bottom:2px;-webkit-overflow-scrolling:touch;scrollbar-width:none}
    #sdial .cz .fc::-webkit-scrollbar{display:none}
    #sdial .cz .fc button{flex:0 0 auto;height:var(--sd-h);padding:0 14px;border-radius:999px;white-space:nowrap;font-size:12px}
    #sdial .cz .fc button.on{background:var(--sd-greenbg);border-color:var(--sd-green);color:var(--sd-greent)}
    #sdial .cz .fh{display:flex;align-items:center;gap:6px;margin:8px 2px 5px;font-size:11px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:var(--sd-text2)}
    #sdial .cz .fh:first-child{margin-top:2px}
    #sdial .cz .fh:before{content:'';flex:0 0 auto;width:3px;height:14px;border-radius:4px;background:var(--sd-green)}
    #sdial .cz .fh i{font-style:normal;font-weight:400;color:var(--sd-dim)}
    #sdial .cz .fe{padding:10px 4px;color:var(--sd-dim);font-size:12px;text-align:center}
    #sdial .cz .fw{border-radius:8px;background:var(--sd-bg2);border:1px solid var(--sd-line);margin-bottom:4px}
    #sdial .cz .fr{display:flex;align-items:center;gap:8px;min-height:var(--sd-row);padding:0 8px 0 10px}
    #sdial .cz .fr .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #sdial .cz .fr .inf{flex:0 0 auto;width:var(--sd-h);height:var(--sd-h);padding:0;border-radius:50%;border:1px solid var(--sd-lift);background:none;color:var(--sd-dim);font-size:13px;font-weight:700;line-height:1}
    #sdial .cz .fr .inf:active{background:var(--sd-line);border-color:var(--sd-dim);color:var(--sd-text)}
    #sdial .cz .fr .sw{flex:0 0 auto;position:relative;width:40px;height:24px;padding:0;border-radius:12px;border:1px solid var(--sd-lift);background:var(--sd-sink);transition:background .12s,border-color .12s}
    #sdial .cz .fr .sw i{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:var(--sd-mute);transition:transform .12s,background .12s}
    #sdial .cz .fr .sw.on{background:var(--sd-greenbg);border-color:var(--sd-green)}
    #sdial .cz .fr .sw.on i{transform:translateX(16px);background:var(--sd-green)}
    #sdial .cz .tm .fr{padding:0 4px 0 6px;min-height:var(--sd-h);margin-bottom:4px}
    #sdial .cz .tm .fr .sw{flex:0 0 auto;position:relative;width:40px;height:24px;padding:0;border-radius:12px;border:1px solid var(--sd-lift);background:var(--sd-sink);transition:background .12s,border-color .12s}
    #sdial .cz .tm .fr .sw i{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:var(--sd-mute);transition:transform .12s,background .12s}
    #sdial .cz .tm .fr .sw.on{background:var(--sd-greenbg);border-color:var(--sd-green)}
    #sdial .cz .tm .fr .sw.on i{transform:translateX(16px);background:var(--sd-green)}
    #sdial .cz .tm .bar{display:flex;gap:4px;margin-bottom:4px}
    #sdial .cz .tm .bar button{flex:1 1 0;min-width:0;height:28px;padding:0 2px;font-size:11px}
    #sdial .cz .tm .bar button.on{background:var(--sd-line);border-color:var(--sd-lift);color:#fff}
    #sdial .cz .tm .bar button:disabled{opacity:.35}
    #sdial .cz .tm .out{height:34vh;min-height:120px;overflow-y:auto;overflow-x:hidden;touch-action:pan-y;overscroll-behavior:contain;padding:4px 5px;border-radius:8px;background:var(--sd-sink);border:1px solid var(--sd-hov);font:11px/1.35 ui-monospace,Menlo,Consolas,monospace;margin-bottom:4px;-webkit-user-select:text;user-select:text}
    #sdial .cz .tm .ln{word-break:break-all;color:var(--sd-text2);padding:1px 0}
    #sdial .cz .tm .ln .tt{color:var(--sd-mute)}
    #sdial .cz .tm .ln .tg{color:var(--sd-bluet)}
    #sdial .cz .tm .ln.w{color:var(--sd-yel)}
    #sdial .cz .tm .ln.e{color:var(--sd-redt)}
    #sdial .cz .tm .ln.w .tg,#sdial .cz .tm .ln.e .tg{color:inherit}
    #sdial .cz .tm .none{padding:10px 4px;text-align:center;color:var(--sd-mute)}
    #sdial .cz .tm .ct{margin-bottom:4px;font-size:11px;color:var(--sd-dim);text-align:right}
    #sdial .sdtip{position:fixed;left:0;top:0;right:0;bottom:0;z-index:5000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.5)}
    #sdial .sdtip .tc{width:100%;max-width:240px;padding:12px 14px;border-radius:12px;border:1px solid var(--st);background:var(--sd-bg);color:var(--sd-text);box-shadow:0 8px 24px rgba(0,0,0,.6)}
    #sdial .sdtip .th{font-size:13px;font-weight:700}
    #sdial .sdtip .tx{margin-top:4px;font-size:12px;line-height:1.4;color:var(--sd-text2)}
    #sdial .sdtip .tp{display:flex;align-items:center;gap:6px;margin-top:10px;font-size:12px;color:var(--sd-bluet)}
    #sdial .sdtip .tp svg{flex:0 0 auto;width:16px;height:16px;stroke:var(--sd-bluet)}
    #sdial .sdtip .tk{width:100%;height:var(--sd-h);margin-top:10px;padding:0 8px;border-radius:8px;border:1px solid var(--sd-line);background:var(--sd-bg2);color:var(--sd-text2);font-size:12px}
    #sdial .sdtip .tk:active{background:var(--sd-hov)}
  `;

  function mount(ctx) {
    SD.css('sd-settings', CSS);
    const el = ctx.el;
    el.className = 'cz';
    el.innerHTML =
      '<div class="nav"><button class="hb" aria-label="Pages" aria-expanded="false">' + HAMB + '</button><span class="cur"></span></div>' +
      '<div class="mn"></div>' +
      '<div class="pg pm on">' +
        '<div class="gh"><span>On screen</span><b class="cnt"></b></div><div class="lst lf"></div>' +
        '<div class="gh"><span>Show More</span></div><div class="lst lm"></div>' +
        '<button class="edit">Edit</button></div>' +
      '<div class="pg pf"><div class="fc"></div><div class="fl"></div></div>' +
      '<div class="pg pt"><div class="tm">' +
        '<div class="fr"><span class="nm">Logging</span><button class="sw" role="switch" aria-label="Logging"><i></i></button></div>' +
        '<div class="bar"><button data-v="live">Live</button><button data-v="saved">Saved</button></div>' +
        '<div class="bar"><button data-f="i">All</button><button data-f="w">Warn+</button><button data-f="e">Errors</button></div>' +
        '<div class="out"></div><div class="ct"></div>' +
        '<div class="bar"><button class="tp">Pause</button><button class="tc">Clear</button><button class="tcp">Copy</button><button class="ts">Save</button></div>' +
      '</div></div>' +
      '<div class="pg pa">' +
        '<div class="qk"></div>' +
        '<div class="rw"><input class="ie" maxlength="12" placeholder="Emoji" autocomplete="off"><input class="in" maxlength="20" placeholder="Name" autocomplete="off"></div>' +
        '<div class="rw"><input class="iu" placeholder="/page.php?sid=..." autocomplete="off" autocapitalize="off" spellcheck="false"><button class="here">This page</button></div>' +
        '<button class="add">Add</button>' +
      '</div>';
    const qk = el.querySelector('.qk'), lf = el.querySelector('.lf'), lm = el.querySelector('.lm'), cnt = el.querySelector('.cnt'), fl = el.querySelector('.fl'), fc = el.querySelector('.fc');
    const inE = el.querySelector('.ie'), inN = el.querySelector('.in'), inU = el.querySelector('.iu');
    const hb = el.querySelector('.hb'), cur = el.querySelector('.cur'), mn = el.querySelector('.mn');
    let drag = null;

    // ----- page navigation: 3-line button opens the list of pages, tapping one opens that page -----
    const PAGES = [
      { id: 'pm', label: 'Menu', icon: ICON_MENU, show: () => renderList() },
      { id: 'pf', label: 'Features', icon: ICON_FEAT, show: () => renderFeat() },
      { id: 'pa', label: 'Shortcut', icon: ICON_ADD },
      { id: 'pt', label: 'Terminal', icon: ICON_TERM, show: () => startTerm() }
    ];

    function setNav(open) {
      el.classList.toggle('nav-open', open);
      hb.classList.toggle('on', open);
      hb.setAttribute('aria-expanded', open ? 'true' : 'false');
      closeTip();
    }

    function showPage(id) {
      const p = PAGES.find(x => x.id === id) || PAGES[0];
      stopTerm();
      cur.textContent = p.label;
      el.querySelectorAll('.pg').forEach(g => g.classList.toggle('on', g.classList.contains(p.id)));
      mn.querySelectorAll('.mi').forEach(b => b.classList.toggle('on', b.dataset.p === p.id));
      setNav(false);
      if (p.show) p.show();
    }

    PAGES.forEach(p => {
      const b = document.createElement('button');
      b.className = 'mi';
      b.dataset.p = p.id;
      b.innerHTML = p.icon + '<span></span>';
      b.querySelector('span').textContent = p.label;
      b.addEventListener('click', () => showPage(p.id));
      mn.appendChild(b);
    });
    hb.addEventListener('click', () => setNav(!el.classList.contains('nav-open')));

    // ----- terminal page: the debug log. Lines are only drawn while this page is open (no timers: new lines arrive as events) -----
    const tm = el.querySelector('.tm');
    const out = tm.querySelector('.out'), ct = tm.querySelector('.ct'), tsw = tm.querySelector('.sw');
    const bP = tm.querySelector('.tp'), bC = tm.querySelector('.tc'), bCp = tm.querySelector('.tcp'), bS = tm.querySelector('.ts');
    const T = { view: 'live', lvl: 'i', paused: false, unsub: null, n: 0 };
    const RANK = { i: 0, w: 1, e: 2 };
    const MAXLINES = 300;

    const source = () => (T.view === 'saved' ? SD.logSaved() : SD.logs());
    const passes = e => RANK[e.l] >= RANK[T.lvl];
    const lineEl = e => {
      const d = document.createElement('div');
      d.className = 'ln ' + e.l;
      const a = document.createElement('span'), b = document.createElement('span');
      a.className = 'tt'; a.textContent = SD.logTime(e.t) + ' ';
      b.className = 'tg'; b.textContent = e.g + ' ';
      d.appendChild(a); d.appendChild(b); d.appendChild(document.createTextNode(e.m));
      return d;
    };
    const count = () => {
      ct.textContent = T.n + ' line' + (T.n === 1 ? '' : 's') + (T.view === 'live' && T.paused ? ' (paused)' : '') + (T.view === 'live' && !SD.logIsOn() ? ' (logging is off)' : '');
    };
    function drawTerm() {
      out.innerHTML = '';
      const rows = source().filter(passes);
      T.n = rows.length;
      if (!rows.length) {
        const n = document.createElement('div');
        n.className = 'none';
        n.textContent = T.view === 'saved' ? 'Nothing saved yet. Tap Save in Live.' : 'No lines.';
        out.appendChild(n);
      } else rows.forEach(e => out.appendChild(lineEl(e)));
      out.scrollTop = out.scrollHeight;
      count();
    }
    const onLine = e => {
      if (T.view !== 'live') return;
      if (e === null) { drawTerm(); return; }                    // Clear
      if (T.paused || !passes(e)) return;
      const nearEnd = out.scrollHeight - out.scrollTop - out.clientHeight < 30;
      const none = out.querySelector('.none');
      if (none) none.remove();
      out.appendChild(lineEl(e));
      T.n++;
      while (out.children.length > MAXLINES) { out.removeChild(out.firstChild); T.n--; }
      if (nearEnd) out.scrollTop = out.scrollHeight;
      count();
    };
    function paintTerm() {
      tm.querySelectorAll('.bar button[data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === T.view));
      tm.querySelectorAll('.bar button[data-f]').forEach(b => b.classList.toggle('on', b.dataset.f === T.lvl));
      const on = SD.logIsOn();
      tsw.classList.toggle('on', on);
      tsw.setAttribute('aria-checked', on ? 'true' : 'false');
      bP.textContent = T.paused ? 'Resume' : 'Pause';
      bP.disabled = T.view !== 'live';
      bS.disabled = !SD.logIsOn() && !SD.logs().length;
    }
    function startTerm() {
      stopTerm();
      T.unsub = SD.logSub(onLine);
      paintTerm();
      drawTerm();
    }
    function stopTerm() { if (T.unsub) { T.unsub(); T.unsub = null; } }

    tm.querySelectorAll('.bar button[data-v]').forEach(b => b.addEventListener('click', () => { T.view = b.dataset.v; paintTerm(); drawTerm(); }));
    tm.querySelectorAll('.bar button[data-f]').forEach(b => b.addEventListener('click', () => { T.lvl = b.dataset.f; paintTerm(); drawTerm(); }));
    tsw.addEventListener('click', () => { SD.logSet(!SD.logIsOn()); paintTerm(); count(); });
    bP.addEventListener('click', () => { T.paused = !T.paused; if (!T.paused) drawTerm(); paintTerm(); count(); });
    bC.addEventListener('click', () => {
      if (T.view === 'saved') { SD.logUnsave(); drawTerm(); SD.toast('Saved log cleared'); } else SD.logClear();
    });
    bS.addEventListener('click', () => {
      const n = SD.logSave();
      SD.toast('Saved ' + n + ' line' + (n === 1 ? '' : 's'));
      if (T.view === 'saved') drawTerm();
    });
    bCp.addEventListener('click', () => {
      const rows = source().filter(passes);
      const head = 'Speed Dial v' + SD.ver + ' | ' + (T.view === 'saved' ? 'saved log' : 'live log') + ' | native storage: ' + (window.__sdStore && window.__sdStore.native ? 'yes' : 'no') + ' | ' + rows.length + ' line(s)';
      const text = head + '\n' + rows.map(e => SD.logTime(e.t) + ' [' + e.g + '] ' + (e.l === 'e' ? 'ERROR ' : e.l === 'w' ? 'WARN ' : '') + e.m).join('\n');
      copyText(text).then(ok => SD.toast(ok ? 'Copied ' + rows.length + ' line(s)' : 'Could not copy. Select the text and copy it by hand.'));
    });
    // clipboard API when the page allows it, otherwise the old selection trick
    function copyText(text) {
      const old = () => {
        try {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.cssText = 'position:fixed;left:0;top:0;opacity:0;width:1px;height:1px';
          (document.getElementById('sdial') || document.body).appendChild(ta);
          ta.focus(); ta.select();
          const ok = document.execCommand('copy');
          ta.remove();
          return ok;
        } catch (e) { return false; }
      };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(() => true, () => old());
      } catch (e) { /* clipboard API blocked: fall through to the execCommand copy below */ }
      return Promise.resolve(old());
    }

    // ----- features page: on/off per feature, "!" opens a small pop-up -----
    let tip = null;
    function closeTip() { if (tip) { tip.remove(); tip = null; } }
    // lives in #sdial (not inside the window, which clips and moves), so it is centred on the screen
    function openTip(f) {
      closeTip();
      const t = document.createElement('div');
      t.className = 'sdtip';
      t.innerHTML = '<div class="tc" role="dialog"><div class="th"></div><div class="tx"></div><div class="tp"><svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.2a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.5"/></svg><span></span></div><button class="tk">OK</button></div>';
      t.querySelector('.th').textContent = f.label;
      t.querySelector('.tx').textContent = f.info || '';
      const tp = t.querySelector('.tp');
      if (f.where) tp.querySelector('span').textContent = f.where; else tp.remove();
      t.addEventListener('click', e => { if (e.target === t || e.target.closest('.tk')) closeTip(); });
      (document.getElementById('sdial') || document.body).appendChild(t);
      tip = t;
    }

    const FCK = 'speedDial.featcat1';   // the filter chip you picked last
    let fcat = SD.read(FCK, 'All');
    if (typeof fcat !== 'string') fcat = 'All';
    const groupOf = f => f.group || 'Other';

    function renderFeat() {
      closeTip();
      const keep = fc.scrollLeft;
      fc.innerHTML = '';
      fl.innerHTML = '';
      if (!SD.features.length) {
        const e = document.createElement('div');
        e.className = 'fe';
        e.textContent = 'No features installed yet.';
        fl.appendChild(e);
        return;
      }
      // categories: alphabetical, "Other" last
      const names = Array.from(new Set(SD.features.map(groupOf))).sort((a, b) => (a === 'Other') - (b === 'Other') || a.localeCompare(b));
      if (fcat !== 'All' && names.indexOf(fcat) < 0) fcat = 'All';
      ['All'].concat(names).forEach(n => {
        const b = document.createElement('button');
        b.textContent = n;
        b.className = n === fcat ? 'on' : '';
        b.addEventListener('click', () => { fcat = n; SD.write(FCK, fcat); renderFeat(); });
        fc.appendChild(b);
      });
      fc.scrollLeft = keep;
      names.filter(n => fcat === 'All' || n === fcat).forEach(n => {
        const list = SD.features.filter(f => groupOf(f) === n).sort((a, b) => a.label.localeCompare(b.label));
        const h = document.createElement('div');
        h.className = 'fh';
        h.innerHTML = '<span></span><i>' + list.length + '</i>';
        h.firstChild.textContent = n;
        fl.appendChild(h);
        list.forEach(f => {
          const w = document.createElement('div');
          w.className = 'fw';
          w.innerHTML = '<div class="fr"><span class="nm"></span><button class="inf" aria-label="About this feature">!</button>' +
            '<button class="sw" role="switch"><i></i></button></div>';
          w.querySelector('.nm').textContent = f.label;
          const sw = w.querySelector('.sw');
          const paint = () => {
            const on = SD.featureOn(f.id);
            sw.classList.toggle('on', on);
            sw.setAttribute('aria-checked', on ? 'true' : 'false');
          };
          paint();
          w.querySelector('.inf').addEventListener('click', () => openTip(f));
          sw.addEventListener('click', () => {
            const now = !SD.featureOn(f.id);
            SD.setFeature(f.id, now);
            paint();
            if (now && !SD.featureFits(f.id) && f.where) SD.toast(f.label + ' is on. It starts on: ' + f.where);
          });
          fl.appendChild(w);
        });
      });
    }

    // ----- add shortcut page -----
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
      SD.toast('Added ' + n);
    });

    // ----- menu page: "On screen" (max SD.maxFront) and "Show More" -----
    const frontIds = () => SD.front().map(m => m.id);
    const moreIds = () => SD.more().map(m => m.id);

    function empty(box, txt) {
      const e = document.createElement('div');
      e.className = 'ge';
      e.textContent = txt;
      box.appendChild(e);
    }

    function togglePin(id) {
      const A = frontIds(), B = moreIds();
      if (A.indexOf(id) > -1) {                         // back to Show More: it goes to the END, like anything new
        A.splice(A.indexOf(id), 1);
        B.push(id);
      } else {
        if (A.length >= SD.maxFront) { SD.toast('Max ' + SD.maxFront + ' on screen. Unpin one first.'); return; }
        B.splice(B.indexOf(id), 1);
        A.push(id);
      }
      SD.setLayout(A.concat(B), A);
      renderList();
    }

    function row(m, box, front) {
      const custom = list.some(s => sid(s) === m.id);
      const r = document.createElement('div');
      r.className = 'it' + (custom ? ' cu' : '');
      r._id = m.id;
      r.innerHTML = '<span class="grip" aria-label="Drag to reorder">' + GRIP + '</span><span class="ix"></span><span class="nm"></span>' +
        '<button class="btn del" aria-label="Delete">\u2715</button><button class="btn pin' + (front ? ' on' : '') + '" aria-label="' + (front ? 'Move to Show More' : 'Show on screen') + '">' + PIN + '</button>';
      const ix = r.querySelector('.ix');
      if (m.emoji) ix.textContent = m.emoji; else ix.innerHTML = '<svg viewBox="0 0 24 24">' + m.icon + '</svg>';
      r.querySelector('.nm').textContent = m.label;
      r.querySelector('.pin').addEventListener('click', () => togglePin(m.id));
      r.querySelector('.del').addEventListener('click', () => {
        list = list.filter(s => sid(s) !== m.id);
        save();
        SD.unregister(m.id);
        renderList();
      });
      bindDrag(r, box);
      box.appendChild(r);
    }

    function renderList() {
      if (drag) return;
      lf.innerHTML = '';
      lm.innerHTML = '';
      const A = SD.front(), B = SD.more();
      cnt.textContent = A.length + '/' + SD.maxFront;
      cnt.classList.toggle('full', A.length >= SD.maxFront);
      A.forEach(m => row(m, lf, true));
      B.forEach(m => row(m, lm, false));
      if (!A.length) empty(lf, 'Nothing on screen. Pin up to ' + SD.maxFront + '.');
      if (!B.length) empty(lm, 'Empty');
    }

    // ----- drag the grip handle (edit mode only) to reorder; the list scrolls itself near its top/bottom edge -----
    function bindDrag(row, box) {
      const grip = row.querySelector('.grip');
      grip.addEventListener('pointerdown', e => {
        if (e.button > 0 || !el.classList.contains('edit')) return;
        e.preventDefault();
        drag = { row, box, startY: e.clientY, y: e.clientY, raf: 0 };
        try { grip.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone: the drag simply does not start */ }
        row.classList.add('drag');
        drag.raf = requestAnimationFrame(autoScroll);
      });
      grip.addEventListener('pointermove', e => { if (drag && drag.row === row) { drag.y = e.clientY; moveDrag(); } });
      grip.addEventListener('pointerup', endDrag);
      grip.addEventListener('pointercancel', endDrag);
    }

    function moveDrag() {
      const row = drag.row, lst = drag.box;
      const h = row.offsetHeight + 3;
      let dy = drag.y - drag.startY;
      while (dy > h / 2 && row.nextElementSibling) {
        lst.insertBefore(row.nextElementSibling, row); drag.startY += h; dy -= h;
      }
      while (dy < -h / 2 && row.previousElementSibling) {
        lst.insertBefore(row.previousElementSibling, row.nextSibling); drag.startY -= h; dy += h;   // move the neighbour, not the dragged row
      }
      row.style.transform = 'translateY(' + dy + 'px)';
    }

    const EDGE = 36;   // px from the list's top/bottom edge where scrolling starts
    function autoScroll() {
      if (!drag) return;
      if (!ctx.alive) { drag = null; return; }
      const lst = drag.box;
      const r = lst.getBoundingClientRect();
      let v = 0;
      if (drag.y < r.top + EDGE) v = -(2 + 10 * Math.min(1, (r.top + EDGE - drag.y) / EDGE));
      else if (drag.y > r.bottom - EDGE) v = 2 + 10 * Math.min(1, (drag.y - (r.bottom - EDGE)) / EDGE);
      if (v) {
        const before = lst.scrollTop;
        lst.scrollTop = before + v;
        const moved = lst.scrollTop - before;
        if (moved) { drag.startY -= moved; moveDrag(); }   // the row keeps following the finger
      }
      drag.raf = requestAnimationFrame(autoScroll);
    }

    function endDrag() {
      if (!drag) return;
      cancelAnimationFrame(drag.raf);
      const ids = box => Array.from(box.children).map(r => r._id).filter(Boolean);
      const A = ids(lf), B = ids(lm);   // a row only moves inside its own group; the pin moves it between groups
      drag = null;
      if (A.length + B.length) SD.setLayout(A.concat(B), A);
      renderList();
    }

    el.querySelector('.edit').addEventListener('click', e => {
      SD.editBtn(e.currentTarget, el.classList.toggle('edit'));
    });

    const a = ctx.arg || {};                         // e.g. { page: 'pm', edit: true } from Show More > Arrange
    showPage(a.page || 'pm');
    if (a.edit && el.querySelector('.pm.on')) { el.classList.add('edit'); SD.editBtn(el.querySelector('.edit'), true); }
    return { unmount() { closeTip(); stopTerm(); } };
  }

  SD.register({
    id: 'settings',
    label: 'Settings',
    width: 250,
    pinned: true,
    ord: 1000,
    // gear
    icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    mount
  });
})();
