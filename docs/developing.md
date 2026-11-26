# Developing Speed Dial

For anyone changing the code or adding a tool. Day-to-day use is in [using.md](using.md).

## How it loads

1. PDA runs `speed-dial.loader.user.js` at document start. It first registers a touch guard so Torn's swipe handlers never see gestures that start on Speed Dial.
2. The loader reads `manifest.json` (file list in load order, plus a version per file). A saved manifest younger than a couple of minutes is trusted without any request.
3. For each file: same version as the saved copy means no request; otherwise it is downloaded (the URL carries the version, so GitHub's cache cannot serve an old copy of a new version), saved in localStorage under `speedDial.src.*`, and used. If a download fails, the saved copy is used.
4. Files run in manifest order as inline scripts with the page's CSP nonce (Torn blocks `eval`). `store.js` runs first and loads your saved data, then `core.js`, then every module and feature.
5. `store.js` and `core.js` must load. Any other file that fails (download, syntax error, runtime error) is skipped: the rest still starts, a red box says which file, and the Terminal has a line for it.

`dist/speed-dial.bundle.user.js` is the same code as a single script (each file in its own try/catch) for when GitHub or the loader is not an option. The loader is the only thing that survives a **syntax** error in one file; the bundle is one script, so a syntax error in it stops everything.

## Releasing a change

Every change to a file listed in `manifest.json` goes through the same two steps:

1. Edit. For a release, bump the version on the first line of `core.js` (`// Speed Dial core vX.Y.Z`) and add an entry to [CHANGELOG.md](../CHANGELOG.md).
2. Run `./build.sh`, then push **everything it touched** (`manifest.json`, `dist/`, and `core.js` if it synced the version).

`./build.sh` does three things:

- keeps `SD.ver` in `core.js` equal to that first line (the version shown in the Terminal and written into backups, so there is one place to bump);
- rewrites `manifest.json`: the `files` list stays exactly as you wrote it, the `v` list (a checksum and size per file) is recomputed;
- rebuilds the offline bundle.

**Forgetting step 2 means nobody gets your edit**, because the loader only downloads a file again when its version in the manifest changed. `./build.sh --check` changes nothing and exits with 1 when the manifest or the bundle is out of date; use it before a push, or in CI.

`build.sh` needs only a POSIX shell (`cksum`, `sed`, `awk`), so it runs on Termux, Linux and macOS. To check a file for syntax errors quickly: `node --check modules/name.js`.

### Versions

| What | Where | Meaning |
|---|---|---|
| Release version | first line of `core.js`, copied into `SD.ver` and the bundle | Bump on every release. This is what the Terminal and backups show |
| Per-file version | `manifest.json` `v` | Automatic (`build.sh`). Never edit by hand |
| Loader version | `@version` in `speed-dial.loader.user.js` | Bump whenever the loader changes. Users must paste the loader again, so say so in the CHANGELOG |
| `store.js` and module headers | first comment line of each file | Informational, for humans reading the file |

## Adding a tool (module)

1. Create `modules/name.js` that calls `SpeedDial.register({ id, label, icon, width, mount })`. `width` is the window width in px (a phone fits roughly 200-300).
   - `icon` is inner SVG markup for a 24x24 stroke icon; use `emoji` for an emoji circle. `href` makes the circle open a page instead of a window. `ord` sets the default order. `pinned: true` keeps it as a fixed circle after the on-screen ones and out of Show More. A new unpinned module lands in Show More; the user can pin it in Settings > Menu.
   - `mount(ctx)` gets `ctx.el`, `ctx.every(fn, ms)`, `ctx.after(fn, ms)`, `ctx.alive`, `ctx.setWidth(px)` and `ctx.close()`. Timers are cleared automatically when the window closes. `mount` may return `{ unmount() }`.
   - Style under `#sdial` (for example `#sdial .mything{...}`); the frame, title bar and padding come from the core.
   - Other code can open a tool with `SD.open(id, arg)` (the arg arrives as `ctx.arg`), close it with `SD.close(id)` and ask `SD.isOpen(id)`. `SpeedDial.unregister(id)` removes one.
2. Add `"modules/name.js"` to `manifest.json` (after `core.js`).
3. Run `./build.sh` and push.

## Adding a page feature

A feature runs on a Torn page itself. Create `features/name.js` (file name = label in lower case without spaces) that calls `SpeedDial.feature({ id, label, group, info, where, match, start })`.

- One Torn page = one feature file. Files do not share code, so something two features need (a card reader, say) is copied into both.
- `group` is the category (filter chip and section title in Settings > Features; without it: `Other`). `info` is the one-line text behind **!**; `where` is the page name shown under it. `was` (optional) is the id of an older feature this one was split off from: until the user flips its own switch it follows the old one. `def: true` makes it start switched on.
- `match` decides where it may run: a RegExp on `location.pathname`, a function `(location) => boolean`, a path prefix string, or nothing for every page.
- `start(ctx)` builds what it needs and returns `{ stop() }`. `ctx.every`, `ctx.after`, `ctx.css(text)` and `ctx.on(target, type, fn)` are tracked and undone by the core, so `stop()` only has to remove elements the feature inserted. `start` may `throw new Error('...')` to refuse; the message is shown as a toast.
- Add `"features/name.js"` to `manifest.json`, run `./build.sh`, push. It appears in Settings > Features by itself.

## Rules for every module and feature

**Saved data goes through `SD.read` / `SD.write`.** Never touch `localStorage` directly: these two keep the data in PDA's native storage. Keys must start with `speedDial.` (or the older `itemDock.`, `travelHelper.`, `gymGuide.`); `store.js` only saves those to the app, and warns in the Terminal about other keys. Read once when the module loads, keep it in memory, write after each change. Data that can be fetched again (caches) may live in `sessionStorage` or memory. A module that saves under a `speedDial.` key is in the backup automatically; only caches and logs belong in the exclusion list at the top of the Backup code in `settings.js`.

**Log what you do with `SD.log`.** `SD.log('tag', 'message')` adds a Terminal line (tag: short name, 10 characters at most); a third argument `'w'` or `'e'` marks a warning or error. `SD.api` logs its own calls. Log every `catch` block: an empty `catch (e) {}` hides the problem, so either log the message or write a short comment on why it is safe to ignore. Never put the API key or other secrets in a message.

**Colours and sizes come from the tokens.** `core.js` defines CSS variables on `#sdial`; use them rather than hex values or fixed heights so every tool looks the same and one change reaches everything. The tokens are `--sd-bg`, `--sd-bg2`, `--sd-hov` (surfaces), `--sd-line`, `--sd-line2` (borders), `--sd-text`, `--sd-text2`, `--sd-dim` (text), `--sd-red`, `--sd-redt`, `--sd-blue`, `--sd-bluet`, `--sd-yel`, `--sd-green` (accents) and `--sd-h`, `--sd-hi`, `--sd-hl` (button, input and large-button heights); the values are at the top of the style block in `core.js`. Green means a mode or switch that is on, blue the chosen option, grey the current page or tab. Page features sit outside `#sdial`, cannot see the tokens and keep their own palette.

**Security.** The API key lives only inside a closure in `core.js`; modules call `SD.api(url)` and never see it, and `SD.api` throws for any URL that is not `https://api.torn.com/...`. Navigate with `SD.go(href)` (only `/path` or `https://(www.)torn.com/...` pass), never `location.href = ...` with stored text. When you build HTML with `innerHTML`, wrap text in `SD.esc(...)` or use `textContent`, and convert numbers from storage with `+x`. Backup restore cleans every value before saving it, so a new module that writes stored values into HTML should re-check them on load as well.

## Shared helpers

| Helper | Use |
|---|---|
| `SD.read(key, default)`, `SD.write(key, value)` | Saved data (see the rule above) |
| `SD.log(tag, msg, level)` | Terminal line |
| `SD.api(url)` | Torn API call (api.torn.com only); throws on API errors with `err.api` and `err.code` set |
| `SD.items(force)` | The shared item list (`torn/?selections=items`): one call for Item Dock, Travel Helper and Price Checker, kept in memory for a while. Use it instead of calling that endpoint yourself |
| `SD.data(force, maxAge)`, `SD.peek()` | Shared player data (status, travel, cooldowns, bars): one cached call for every tool. `peek` returns the cached copy without a request. `SD.error()` and `SD.errorCode()` describe the last failure; `SD.mode(d)` gives `home`, `flying`, `abroad` or `none` |
| `SD.open(id, arg)`, `SD.close(id)`, `SD.isOpen(id)` | Windows |
| `SD.register`, `SD.unregister`, `SD.feature` | Add or remove a tool or a page feature |
| `SD.toast(msg)` | Short message at the bottom of the screen (also logged) |
| `SD.go(href)`, `SD.safeHref(href)` | Navigate / validate a link (torn.com only) |
| `SD.esc(text)` | HTML-escape text |
| `SD.dur(sec)`, `SD.durS(sec)`, `SD.hhmm(ms)` | Time formatting: minutes precision, seconds precision, clock time |
| `SD.editBtn(button, on)` | Edit / Done button with the shared look (green when on) |
| `SD.spin(button, promise)` | Spin a refresh button while a promise runs (long enough to be seen) |
| `SD.icons` | Shared icons as full `<svg>` markup |
| `SD.css(id, text)` | Add a `<style>` once under an id |

The first lines of `core.js` and the comment above each section describe the rest.

## Debugging

- **Settings > Terminal** first. Warnings and errors are kept under Problems even after a reload; the loader writes its own lines (tag `loader`: how many files were downloaded or reused, skipped files, manifest problems).
- To see exactly which version runs, read the first line of the **Copy**ed log, or the `sourceURL` of a file in the browser's dev tools (`speeddial/<file>`).
- To force a fresh download of everything, remove the `speedDial.src.*` keys from localStorage; the loader then downloads all files again on the next page load.
