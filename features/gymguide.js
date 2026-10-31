// Speed Dial feature: Gym Guide v0.7.0
// Highlights the gym tile to train next (Baldr / Hank ratios) and shows a progress panel under the gym icons.
// Reads only what the page shows. No API. Switch it on or off in Settings > Features.
//
// Ratio logic (roles, eligibility checks, recommendation order) is adapted from
// GymIQ by ClasixTV, MIT License: https://github.com/CLASIX/GymIQ---Torn-Ratio-Helper
(function () {
  'use strict';
  const SD = window.SpeedDial;
  if (!SD) return;

  const LS = 'gymGuide.v2';   // same key as the old standalone script, so your ratio / high stat / war mode carry over

  const KEYS = ['str', 'def', 'spd', 'dex'];
  const NAMES = { str: 'Strength', def: 'Defense', spd: 'Speed', dex: 'Dexterity' };
  const SHORT = { str: 'STR', def: 'DEF', spd: 'SPD', dex: 'DEX' };
  const OFFENSIVE = ['str', 'spd'];
  const DEFENSIVE = ['def', 'dex'];
  const SINGLE_GYM = { str: 'Gym 3000', spd: 'Total Rebound', def: 'Mr. Isoyamas', dex: 'Elites' };
  const WAR_W = { str: 1, spd: 1, def: 1.5, dex: 1.5 };

  const MULTS = {
    baldr: { high: 1, secondary: 0.8, tert1: 0.72, tert2: 0.72 },
    hank:  { high: 1, secondary: 0.8, tert1: 0.8,  tert2: 0.28 }
  };
  const BALDR_ROLES = {
    str: { high: 'str', secondary: 'spd', tert1: 'def', tert2: 'dex' },
    spd: { high: 'spd', secondary: 'str', tert1: 'def', tert2: 'dex' },
    def: { high: 'def', secondary: 'dex', tert1: 'str', tert2: 'spd' },
    dex: { high: 'dex', secondary: 'def', tert1: 'str', tert2: 'spd' }
  };
  const HANK_ROLES = {
    str: { high: 'str', secondary: 'def', tert1: 'dex', tert2: 'spd' },
    spd: { high: 'spd', secondary: 'def', tert1: 'dex', tert2: 'str' },
    def: { high: 'def', secondary: 'str', tert1: 'spd', tert2: 'dex' },
    dex: { high: 'dex', secondary: 'str', tert1: 'spd', tert2: 'def' }
  };

  const rolesFor = (ratio, high) => (ratio === 'hank' ? HANK_ROLES : BALDR_ROLES)[high];
  const isDump = (ratio, roles, k) => ratio === 'hank' && roles.tert2 === k;

  const NUM = /^(str|strength|def|defense|defence|spd|speed|dex|dexterity)([\d,]+(?:\.\d+)?)$/;
  const KEYMAP = { str: 'str', strength: 'str', def: 'def', defense: 'def', defence: 'def', spd: 'spd', speed: 'spd', dex: 'dex', dexterity: 'dex' };

  const CSS = `
    .ggd-hl{position:relative !important;outline:3px solid #85b200 !important;outline-offset:-3px;
      box-shadow:inset 0 0 8px rgba(133,178,0,.3), 0 0 4px rgba(133,178,0,.45) !important}
    .ggd-hl::after{content:"Recommended";position:absolute;right:6px;bottom:4px;height:12px;line-height:12px;padding:0 5px;
      font-size:8px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;white-space:nowrap;color:#111;background:#85b200;border-radius:2px;pointer-events:none;z-index:2}
    #ggd,#ggd-b{box-sizing:border-box;max-width:100%;font-family:inherit;font-size:12px;line-height:1.4;color:#ccc;text-align:left;font-weight:400}
    #ggd *,#ggd-b *{box-sizing:border-box;font-family:inherit}
    #ggd button,#ggd-b button{font-family:inherit;font-size:12px;font-weight:400;cursor:pointer}
    #ggd{margin:10px 0 0;width:100%}
    #ggd .hd{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;
      background:linear-gradient(to bottom,#454545,#363636);border-top:1px solid #555;border-bottom:1px solid #1c1c1c}
    #ggd .hd b{color:#fff;font-size:13px;font-weight:700}
    #ggd .badge{font-size:12px;font-weight:400}
    #ggd .bd{padding:8px 12px 10px;background:#2c2c2c;border-bottom:1px solid #1c1c1c}
    #ggd .sr{display:flex;align-items:center;gap:10px;height:24px}
    #ggd .sr .k{flex:none;width:30px;font-weight:400;color:#999}
    #ggd .sr .bar{flex:1;height:5px;border-radius:3px;background:#161616;overflow:hidden}
    #ggd .sr .bar i{display:block;height:100%;border-radius:3px;background:#5b7fa8}
    #ggd .sr .p{flex:none;width:48px;text-align:right;white-space:nowrap;color:#999}
    #ggd .sr.n .k,#ggd .sr.n .p{color:#85b200}
    #ggd .sr.n .bar i{background:#85b200}
    #ggd .sr .bar i.over{background:#d9a441}
    #ggd .why{margin-top:6px;padding-top:6px;border-top:1px solid #3a3a3a;color:#ddd}
    #ggd-b{width:100%;padding:10px 12px 12px;background:#2c2c2c;border-bottom:1px solid #1c1c1c}
    #ggd-b .bt{margin-bottom:4px;color:#fff;font-weight:700}
    #ggd-b .gr{display:flex;align-items:center;gap:10px;padding:4px 0}
    #ggd-b .gr .dt{flex:none;width:8px;height:8px;border-radius:50%}
    #ggd-b .gr .gn{flex:1;min-width:0;color:#ccc}
    #ggd-b .gr .gn small{display:block;font-size:11px;color:#888}
    #ggd-b .gr .gv{flex:none;white-space:nowrap;font-weight:400;text-align:right}
    #ggd .ok,#ggd-b .ok{color:#85b200}#ggd .warn,#ggd-b .warn{color:#d9a441}#ggd .bad,#ggd-b .bad{color:#e0584a}
    #ggd-b .dt.ok{background:#85b200}#ggd-b .dt.warn{background:#d9a441}#ggd-b .dt.bad{background:#e0584a}
    #ggd-b .opt{display:flex;align-items:center;justify-content:space-between;width:100%;height:32px;margin-top:8px;padding:0 10px;
      border:1px solid #1a1a1a;border-radius:4px;color:#ccc;background:linear-gradient(to bottom,#3d3d3d,#2f2f2f)}
    #ggd-b .set{margin-top:6px}
    #ggd-b .set label{display:block;margin:8px 0 4px;font-size:11px;color:#888}
    #ggd-b .seg{display:flex}
    #ggd-b .seg button{flex:1;height:30px;border:1px solid #1a1a1a;margin-left:-1px;color:#bbb;background:linear-gradient(to bottom,#3d3d3d,#2f2f2f)}
    #ggd-b .seg button:first-child{margin-left:0;border-radius:4px 0 0 4px}
    #ggd-b .seg button:last-child{border-radius:0 4px 4px 0}
    #ggd-b .seg button.on{color:#fff;background:linear-gradient(to bottom,#555,#444);box-shadow:inset 0 -2px 0 #85b200}
  `;

  function start(ctx) {
    // the old standalone Gym Guide userscript sets this flag; two copies would fight over the same elements
    if (window.__gymGuide) throw new Error('the old standalone Gym Guide script is still installed. Remove it from PDA.');

    // ---------- prefs ----------
    let P;
    try { P = JSON.parse(localStorage.getItem(LS)); } catch (e) {}
    P = Object.assign({ ratio: 'baldr', high: 'auto', war: false }, P || {});
    if (!MULTS[P.ratio]) P.ratio = 'baldr';
    const savePrefs = () => { try { localStorage.setItem(LS, JSON.stringify(P)); } catch (e) {} };

    // ---------- logic ----------
    function resolveHigh(stats) {
      if (P.high !== 'auto' && KEYS.indexOf(P.high) > -1) return P.high;
      return KEYS.reduce((a, b) => (stats[b] > stats[a] ? b : a));
    }

    function targetsFor(stats, ratio, high) {
      const roles = rolesFor(ratio, high), m = MULTS[ratio], t = {};
      Object.keys(roles).forEach(r => { t[roles[r]] = stats[high] * m[r]; });
      return t;
    }

    function eligibility(stats, ratio, high) {
      const total = KEYS.reduce((s, k) => s + stats[k], 0);
      if (total <= 0) return [];
      const second = Math.max.apply(null, KEYS.filter(k => k !== high).map(k => stats[k]));
      const highOff = OFFENSIVE.indexOf(high) > -1;
      const highSide = highOff ? OFFENSIVE : DEFENSIVE;
      const oppSide = highOff ? DEFENSIVE : OFFENSIVE;
      const primary = ratio === 'hank' ? oppSide : highSide;
      const secondary = ratio === 'hank' ? highSide : oppSide;
      const sum = a => a.reduce((s, k) => s + stats[k], 0);
      const mk = (id, gym, actual, required, qual, vs) => ({ id, gym, actual, required, margin: actual - required, ok: actual >= required, qual, vs });
      return [
        mk('single', SINGLE_GYM[high], stats[high], second * 1.25, [high], SHORT[high] + ' vs next highest stat'),
        mk('combo', primary === OFFENSIVE ? 'Frontline Fitness' : 'Balboas Gym', sum(primary), sum(secondary) * 1.25, primary,
          primary.map(k => SHORT[k]).join(' + ') + ' vs ' + secondary.map(k => SHORT[k]).join(' + '))
      ];
    }

    function recommend(stats, ratio, high, war) {
      const roles = rolesFor(ratio, high), m = MULTS[ratio], t = targetsFor(stats, ratio, high);
      const w = k => (war ? WAR_W[k] : 1);

      const el = eligibility(stats, ratio, high);
      const combo = el.find(c => c.id === 'combo' && !c.ok);
      if (combo) {
        const under = combo.qual.filter(k => t[k] > 0 && stats[k] < t[k] * 0.98);
        const cands = under.length ? under : combo.qual;
        const pick = (!under.length && cands.indexOf(high) > -1) ? high
          : cands.reduce((lo, k) => (stats[k] / (t[k] || 1) < stats[lo] / (t[lo] || 1) ? k : lo));
        return { stat: pick, reason: 'access', gym: combo.gym, need: -combo.margin };
      }
      const single = el.find(c => c.id === 'single' && !c.ok);
      if (single) return { stat: high, reason: 'access', gym: single.gym, need: -single.margin };

      let best = null;
      Object.keys(roles).forEach(r => {
        const k = roles[r];
        if (r === 'high' || isDump(ratio, roles, k) || !(t[k] > 0) || stats[k] >= t[k] * 0.98) return;
        const sev = ((t[k] - stats[k]) / t[k]) * w(k);
        if (!best || sev > best.sev) best = { stat: k, reason: 'below', sev, pct: Math.round((stats[k] / t[k]) * 100) };
      });
      if (best) return best;

      let reqHigh = stats[high];
      Object.keys(roles).forEach(r => {
        if (r === 'high' || !(m[r] > 0)) return;
        const tol = isDump(ratio, roles, roles[r]) ? 1 : 1.05;
        reqHigh = Math.max(reqHigh, stats[roles[r]] / (m[r] * tol));
      });
      if (reqHigh > stats[high] * 1.001) {
        if (ratio === 'hank') {
          let prep = null;
          ['secondary', 'tert1'].forEach(r => {
            const k = roles[r], fut = reqHigh * m[r];
            if (stats[k] >= fut * 0.98) return;
            const sev = ((fut - stats[k]) / fut) * w(k);
            if (!prep || sev > prep.sev) prep = { stat: k, reason: 'prepare', sev };
          });
          if (prep) return prep;
        }
        return { stat: high, reason: 'raise' };
      }

      if (ratio === 'hank') {
        const k = ['secondary', 'tert1'].map(r => roles[r])
          .reduce((lo, x) => (stats[x] / (t[x] || 1) / w(x) < stats[lo] / (t[lo] || 1) / w(lo) ? x : lo));
        return { stat: k, reason: 'maintain' };
      }
      return { stat: high, reason: 'maintain' };
    }

    function grade(stats, ratio, high) {
      const roles = rolesFor(ratio, high), t = targetsFor(stats, ratio, high);
      let sum = 0;
      KEYS.forEach(k => {
        const a = stats[k], g = t[k];
        if (g === 0) sum += a === 0 ? 1 : 0;
        else if (isDump(ratio, roles, k) && a <= g) sum += 1;
        else sum += Math.min(a, g) / Math.max(a, g);
      });
      const score = Math.round((sum / 4) * 100);
      const letter = score >= 98 ? 'A+' : score >= 93 ? 'A' : score >= 88 ? 'B+' : score >= 83 ? 'B'
        : score >= 78 ? 'C+' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
      return { score, letter };
    }

    // ---------- read stats (from the page only) ----------
    function tileOf(el) {
      let node = el;
      while (node.parentElement && node.parentElement !== document.body) {
        const n = (node.parentElement.textContent.match(/energy per train/gi) || []).length;
        if (n >= 2) break;
        node = node.parentElement;
      }
      return node;
    }

    let tiles = { str: [], def: [], spd: [], dex: [] };

    function readDom() {
      const out = {}, found = { str: [], def: [], spd: [], dex: [] };
      document.querySelectorAll('li, div, span, p, h3, h4').forEach(el => {
        if (el.children.length > 4 || el.closest('#ggd') || el.closest('#ggd-b')) return;
        const txt = el.textContent.replace(/[\s:]+/g, '').toLowerCase();
        if (txt.length > 20) return;
        const m = txt.match(NUM);
        if (m) { const k = KEYMAP[m[1]]; out[k] = parseFloat(m[2].replace(/,/g, '')); found[k].push(el); }
      });
      if (!KEYS.every(k => typeof out[k] === 'number')) return null;
      tiles = found;
      return out;
    }

    let curRec = null;
    function applyHighlight() {
      document.querySelectorAll('.ggd-hl').forEach(n => n.classList.remove('ggd-hl'));
      if (!curRec) return;
      (tiles[curRec] || []).forEach(el => { const t = tileOf(el); if (t) t.classList.add('ggd-hl'); });
    }

    // ---------- UI ----------
    ctx.css(CSS);

    const box = document.createElement('div');   // stat progress
    box.id = 'ggd';
    const bbox = document.createElement('div');  // gym access + settings
    bbox.id = 'ggd-b';
    let stats = null, optOpen = false;

    const fmtK = n => { n = Math.abs(n); return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(Math.round(n)); };

    function render() {
      if (!stats) {
        box.innerHTML = '<div class="hd"><b>Gym guide</b><span style="color:#999">Reading your stats...</span></div>';
        bbox.innerHTML = '';
        return;
      }
      const high = resolveHigh(stats);
      const ratio = P.ratio;
      const roles = rolesFor(ratio, high);
      const t = targetsFor(stats, ratio, high);
      const rec = recommend(stats, ratio, high, P.war);
      const g = grade(stats, ratio, high);
      const el = eligibility(stats, ratio, high);
      curRec = rec.stat;

      const why =
        rec.reason === 'below' ? 'Train <b>' + NAMES[rec.stat] + '</b> \u00b7 ' + rec.pct + '% of target'
        : rec.reason === 'access' ? 'Train <b>' + NAMES[rec.stat] + '</b> to restore ' + rec.gym
        : rec.reason === 'prepare' ? 'Train <b>' + NAMES[rec.stat] + '</b> before raising ' + SHORT[high]
        : rec.reason === 'raise' ? 'Train <b>' + NAMES[rec.stat] + '</b> \u00b7 other stats are over target'
        : 'Balanced. Train <b>' + NAMES[rec.stat] + '</b> to start the next cycle';

      const gc = g.score >= 90 ? 'ok' : g.score >= 75 ? 'warn' : 'bad';
      let top = '<div class="hd"><b>Gym guide</b><span class="badge ' + gc + '">' + g.letter + ' \u00b7 ' + g.score + '%</span></div><div class="bd">';
      KEYS.forEach(k => {
        const dump = isDump(ratio, roles, k);
        const rp = t[k] > 0 ? stats[k] / t[k] : 0;
        const pct = Math.round(rp * 100);
        const over = k !== high && (dump ? rp > 1 : rp > 1.05);
        const lbl = k === high ? 'High' : dump ? 'max' : pct + '%';
        top += '<div class="sr' + (k === rec.stat ? ' n' : '') + '"><span class="k">' + SHORT[k] + '</span>' +
          '<div class="bar"><i class="' + (over ? 'over' : '') + '" style="width:' + Math.min(pct, 100) + '%"></i></div><span class="p">' + lbl + '</span></div>';
      });
      top += '<div class="why">' + why + '</div></div>';
      box.innerHTML = top;

      let bot = '<div class="bt">Your build: gym access</div>';
      el.forEach(c => {
        const near = c.ok && c.margin <= Math.max(c.required * 0.005, 1);
        const cls = !c.ok ? 'bad' : near ? 'warn' : 'ok';
        const val = c.ok ? '+' + fmtK(c.margin) : 'needs ' + fmtK(c.margin);
        bot += '<div class="gr"><span class="dt ' + cls + '"></span><span class="gn">' + c.gym + '<small>' + c.vs + '</small></span><span class="gv ' + cls + '">' + val + '</span></div>';
      });
      bot += '<button class="opt" data-o="1"><span>' + (ratio === 'hank' ? 'Hank' : 'Baldr') + ' \u00b7 High: ' + SHORT[high] +
        (P.high === 'auto' ? ' (auto)' : '') + (P.war ? ' \u00b7 War' : '') + '</span><span>' + (optOpen ? '\u25b2' : '\u25bc') + '</span></button>';
      if (optOpen) {
        bot += '<div class="set"><label>Ratio</label><div class="seg">' +
          '<button data-r="baldr" class="' + (ratio === 'baldr' ? 'on' : '') + '">Baldr</button>' +
          '<button data-r="hank" class="' + (ratio === 'hank' ? 'on' : '') + '">Hank</button></div>' +
          '<label>High stat</label><div class="seg">' +
          ['auto'].concat(KEYS).map(h => '<button data-h="' + h + '" class="' + (P.high === h ? 'on' : '') + '">' + (h === 'auto' ? 'Auto' : SHORT[h]) + '</button>').join('') +
          '</div><label>War mode (favor DEF and DEX)</label><div class="seg">' +
          '<button data-w="0" class="' + (!P.war ? 'on' : '') + '">Off</button><button data-w="1" class="' + (P.war ? 'on' : '') + '">On</button></div></div>';
      }
      bbox.innerHTML = bot;
      applyHighlight();
    }

    function onClick(e) {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.o) optOpen = !optOpen;
      else if (b.dataset.r) { P.ratio = b.dataset.r; savePrefs(); }
      else if (b.dataset.h) { P.high = b.dataset.h; savePrefs(); }
      else if (b.dataset.w) { P.war = b.dataset.w === '1'; savePrefs(); }
      else return;
      render();
    }
    box.addEventListener('click', onClick);
    bbox.addEventListener('click', onClick);

    // ---------- mounting: below the gym icon grid ----------
    function findGymGrid() {
      const items = document.querySelectorAll('li[id^="gym-"], li[class*="gymButton"], [class*="gymButton"]');
      if (items.length) {
        const last = items[items.length - 1];
        if (last.parentElement) return last.parentElement;
      }
      let found = null;
      document.querySelectorAll('ul').forEach(ul => {
        if (ul.closest('#ggd') || ul.closest('#ggd-b')) return;
        if (ul.children.length >= 12) found = ul;
      });
      return found;
    }

    let gridMisses = 0;
    function mount() {
      const grid = findGymGrid();
      if (grid) {
        // keep box + bbox directly after the grid
        if (grid.nextElementSibling !== box || box.nextElementSibling !== bbox) {
          grid.insertAdjacentElement('afterend', box);
          box.insertAdjacentElement('afterend', bbox);
        }
        return;
      }
      if (box.isConnected) return;
      if (++gridMisses < 8) return;
      // fallback: under the "What would you like to train" message
      for (const el of document.querySelectorAll('div, p, span, h3, h4')) {
        if (el.children.length < 3 && /^What would you like to train/i.test(el.textContent.trim()) && el.parentNode) {
          el.insertAdjacentElement('afterend', box);
          box.insertAdjacentElement('afterend', bbox);
          return;
        }
      }
    }

    let last = '';
    function tick() {
      if (document.hidden) return;
      mount();
      const s = readDom();
      if (!s) { if (box.isConnected && !stats) render(); return; }
      const key = KEYS.map(k => s[k]).join('|');
      if (key !== last) { last = key; stats = s; render(); }
      applyHighlight();
    }

    render();
    tick();
    ctx.every(tick, 1500);   // cleared by the core when the feature is switched off
    window.__gymGuide = true;

    return {
      // undo everything this feature put on the page (timer and <style> are removed by the core)
      stop() {
        box.remove();
        bbox.remove();
        document.querySelectorAll('.ggd-hl').forEach(n => n.classList.remove('ggd-hl'));
        delete window.__gymGuide;
      }
    };
  }

  SD.feature({
    id: 'gymguide',
    label: 'Gym Guide',
    where: 'Gym page',
    info: 'Highlights the gym tile to train next (Baldr or Hank ratio) and adds a stat progress panel and gym access check under the gym icons. It only reads the stats already shown on the page. No API calls. Ratio, high stat and war mode are set in the panel on the Gym page.',
    match: /^\/gym\.php/,
    start
  });
})();
