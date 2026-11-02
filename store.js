// Speed Dial store v0.1.0
// Keeps your saved data (Targets, menu layout, shortcuts, window positions, Item Dock items, Travel Helper settings, Gym Guide choices)
// in Torn PDA's native storage (PDA_storage): on disk in the app, not wiped when the browser cache is cleared.
// PDA_storage is asynchronous, so everything is loaded ONCE before core.js and the modules start, then read from memory.
// Writes go to memory at once and to the app in one batch about half a second later (and when the page is hidden).
// localStorage still gets a copy of every write, and is the fallback when this PDA has no native storage.
// The first time, anything already in localStorage is copied into the app, so nothing is lost.
// The loader (or bundle) hands PDA_storage over as window.__sdNative, because it only exists in the userscript's own scope.
(function () {
  'use strict';
  if (window.__sdStore) return;

  // Only keys starting with one of these go to the app. A new module must name its key 'speedDial.<name>' or it silently stays in localStorage only.
  const PFX = ['speedDial.', 'itemDock.', 'travelHelper.', 'gymGuide.'];
  const mine = k => PFX.some(p => k.indexOf(p) === 0) && !/^speedDial\.(src\.|data1$)/.test(k);   // not the downloaded-source cache
  const ls = {
    get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, s) => { try { localStorage.setItem(k, s); } catch (e) {} }
  };

  let nat = null;                       // PDA_storage, once loaded
  const cache = Object.create(null);    // key -> JSON text (only while nat is on)
  const dirty = new Set();              // keys not yet written to the app
  let timer = 0, busy = false, warned = false;

  const say = m => { try { window.SpeedDial && window.SpeedDial.toast(m); } catch (e) {} };
  const sched = ms => { if (!timer) timer = setTimeout(flush, ms); };

  async function flush() {
    if (timer) { clearTimeout(timer); timer = 0; }
    if (!nat || busy || !dirty.size) return;
    busy = true;
    const keys = Array.from(dirty);
    dirty.clear();
    const o = {};
    keys.forEach(k => { try { o[k] = JSON.parse(cache[k]); } catch (e) {} });
    let ok = true;
    try { await nat.setMany(o); }
    catch (e) {
      ok = false;
      keys.forEach(k => dirty.add(k));   // try again later
      if (!warned) { warned = true; say(e && e.code === 'QuotaExceeded' ? 'Speed Dial: PDA storage is full' : 'Speed Dial: could not save to PDA storage'); }
    }
    busy = false;
    if (dirty.size) sched(ok ? 400 : 15000);
  }

  window.__sdInit = async () => {
    const n = window.__sdNative;
    if (!n || typeof n.loadAll !== 'function' || typeof n.setMany !== 'function') return;   // old PDA: stay on localStorage
    const all = (await n.loadAll()) || {};
    Object.keys(all).forEach(k => { if (mine(k) && all[k] != null) cache[k] = JSON.stringify(all[k]); });
    const move = {};
    try {   // first run: copy what is in localStorage but not yet in the app
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !mine(k) || k in cache) continue;
        const raw = localStorage.getItem(k);
        try { move[k] = JSON.parse(raw); cache[k] = raw; } catch (e) {}
      }
    } catch (e) {}
    nat = n;
    Object.keys(move).forEach(k => dirty.add(k));
    if (dirty.size) await flush();
  };

  window.__sdStore = {
    get: k => (nat && mine(k)) ? (k in cache ? cache[k] : null) : ls.get(k),
    set(k, s) {
      ls.set(k, s);   // copy in the browser too
      if (nat && mine(k)) { cache[k] = s; dirty.add(k); sched(500); }
    },
    get native() { return !!nat; },
    flush
  };

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', () => { flush(); });
})();
