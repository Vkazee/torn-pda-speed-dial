# torn-pda-speed-dial

A single floating circle for Torn PDA. Tap the main circle, then circles appear for your (at most 3) favourite tools, a **Show More** circle (`...`) for everything else, and the Settings gear. Tap a tool's circle to open it in its own **floating window**. Each tool **only runs while its window is open**: no timers, API calls, or background rendering once it is closed.

## Saved data (native storage)

Everything you save (Targets, menu order and hidden circles, shortcuts, window positions, Item Dock items, Travel Helper settings, Gym Guide choices, which features are on) is kept in Torn PDA's native per-script storage (`PDA_storage`): on disk in the app, not wiped when the browser cache is cleared. Because PDA_storage is asynchronous, `store.js` loads it once before anything else starts and then works from memory; writes reach the app in one batch about half a second later and again when the page is hidden. The first time, whatever is already in localStorage is copied into the app, so nothing is lost. localStorage still gets a copy of each write and is used alone if your PDA has no native storage. The downloaded-source cache (`speedDial.src.*`) stays in localStorage on purpose: it is only an offline backup of the code.

Because the loader is the only script installed in PDA, all data lives in the loader's own namespace (Userscripts > the script's storage button shows what it uses; the default limit is 10 MB, this project needs well under 1 MB). **After updating, paste the new `speed-dial.loader.user.js` into PDA once** (it now hands `PDA_storage` to `store.js`); everything else updates from GitHub as before. Add `store.js` to the repo root next to `core.js`.

## Windows

- Each window has a title bar (module name and ✕). Drag it by the title bar only; the content scrolls normally.
- Several windows can be open at once. Tap a module circle again to close its window. Tap any window to bring it to the front.
- ✕ closes the window and unmounts the module, so its timers stop.
- Each window's position is remembered per module (`speedDial.win1`) and always kept fully on screen, also after rotating the phone or when a module changes its own width. Which windows are open is not remembered.
- New windows start next to the main circle and are staggered, so two never sit exactly on top of each other.
- Tapping the main circle only folds the module circles away; open windows stay.
- The window outline follows the main circle's status colour.
- Touches on the circles and windows are hidden from Torn's own swipe handlers, so dragging does not pull Torn's sidebar open. The touch guard lives only in the loader (and the bundle), which is injected at document start so this guard is registered before Torn's own scripts; if it ever runs late, set its injection time to **Start** in PDA.

## Folder Contents

| File | Function |
|---|---|
| `speed-dial.loader.user.js` | The only script installed in PDA. Downloads everything listed in `manifest.json` from GitHub |
| `manifest.json` | List of files the loader downloads, in order |
| `store.js` | Saved data: loads everything once from Torn PDA's native storage (`PDA_storage`) and saves back in batches; localStorage is the copy/fallback. Always first in `manifest.json` |
| `core.js` | Core: main circle, module list, floating windows, shared player data (1 API call), toast, storage |
| `modules/itemdock.js` | Item Dock module |
| `modules/travelhelper.js` | Travel Helper module |
| `modules/targets.js` | Targets module |
| `modules/calculator.js` | Calculator module (lives in Show More by default) |
| `modules/showmore.js` | Show More module (pinned `...` circle before Settings): launcher grid with every module that is not on screen, shortcuts included |
| `modules/settings.js` | Settings module (gear circle, always last): choose which (max 3) modules stay on screen, reorder, switch page features on/off, and add your own emoji shortcuts |
| `features/gymguide.js` | Gym Guide, a page feature (runs on the Gym page, outside the circles) |
| `dist/speed-dial.bundle.user.js` | Single-file backup (no GitHub required) |
| `build.sh` | Combines `store.js` + `core.js` + every file in `manifest.json` (same order) into the bundle |

## Install

1. Create a **public** GitHub repo named `torn-pda-speed-dial`.
2. Upload `store.js`, `core.js`, `manifest.json`, and the `modules/` and `features/` folders to the repo root.
3. Open `speed-dial.loader.user.js` and make sure `BASE` matches your username, repo, and branch.
4. In Torn PDA, add `speed-dial.loader.user.js` as a new userscript.
5. Disable or delete the old Item Dock, Travel Helper, and any earlier Speed Dial scripts to avoid duplicates.
6. Reload the Torn page. A circle with a four-square icon should appear.

How the loader works: it downloads the files through PDA's `PDA_httpGet`, keeps the last good copy in localStorage (works if GitHub is unreachable), and runs them as inline scripts using the page's CSP nonce, because Torn blocks `eval`.

## Rule for every new module or feature: saved data goes through `SD.read` / `SD.write`

Never touch `localStorage` directly. `SD.read(key, default)` and `SD.write(key, value)` are what keep the data in Torn PDA's native storage (see "Saved data"). The key MUST start with `speedDial.` (or the old prefixes `itemDock.`, `travelHelper.`, `gymGuide.`); `store.js` only saves keys with those prefixes to the app, any other key silently stays in localStorage only. Read once when the module loads, keep it in memory, call `SD.write` after each change. Data that can be re-fetched (API caches) may use `sessionStorage` or memory instead.

## Adding a New Module

1. Create `modules/name.js` that calls `SpeedDial.register({ id, label, icon, width, mount })`. `width` is the window's width in px (about 200-300 fits a phone).
   - `icon` is inner SVG markup for a 24x24 stroke icon. Use `emoji` instead for an emoji circle; `href` makes the circle open a page instead of a window; `ord` sets the default order; `pinned: true` keeps it as a fixed circle after the on-screen ones (sorted by `ord`) and out of the Show More list. A new unpinned module lands in Show More; the user can pin it to the screen in Settings > Menu. Other modules can be opened from code with `SD.open(id)`, `SD.close(id)`, `SD.isOpen(id)`. `SpeedDial.unregister(id)` removes one.
   - `mount(ctx)` gets `ctx.el`, `ctx.every(fn, ms)`, `ctx.after(fn, ms)`, `ctx.alive`, `ctx.setWidth(px)` and `ctx.close()`; timers are cleared automatically when the window closes. `mount` may return `{ unmount() }`.
   - `ctx.setWidth(px)` changes the window width (for example a wider secondary view); the core keeps the window on screen. Tall content is fine: the window is capped to the screen height and its body scrolls.
   - Style your content under `#sdial` (for example `#sdial .mything{...}`); the window frame, title bar and padding come from the core.
2. Add `"modules/name.js"` to `manifest.json` (after `core.js`).
3. Push to GitHub. Nothing changes in PDA.
4. Optional: run `./build.sh` to refresh the offline bundle.

## Page Features (outside the circles)

A **feature** runs on a Torn page itself instead of inside a window (for example Gym Guide adds a panel under the gym icons). Every feature has an on/off switch in **Settings > Features**; tap the **!** next to it for a small pop-up with the feature name, a short description and the page it runs on (pin icon, blue). Features are **off by default** (`def: true` makes one start on). A feature that is off runs nothing: no timer, no style, no element on the page. Switching it off removes everything it added, without a reload.

1. Create `features/name.js` that calls `SpeedDial.feature({ id, label, info, where, match, start })`.
   - `info` is the one-line text in the **!** pop-up (keep it short, a few words); `where` is the page name shown with a pin icon in blue under the description (for example `Gym`).
   - `match` decides on which page it may run: a RegExp tested on `location.pathname` (`/^\/gym\.php/`), a function `(location) => boolean`, a path prefix string, or leave it out for every page.
   - `start(ctx)` builds whatever it needs and returns `{ stop() }`. `ctx.every(fn, ms)`, `ctx.after(fn, ms)`, `ctx.css(text)` and `ctx.on(target, type, fn)` are tracked and undone by the core when the feature stops; `stop()` only has to remove the elements the feature inserted into the page. `start` may `throw new Error('...')` to refuse; the message is shown as a toast.
2. Add `"features/name.js"` to `manifest.json` (after `core.js`).
3. Push to GitHub. It appears in Settings > Features by itself.

Features start when the page loads. A feature switched on while you are on another page starts the next time you open its page. The old standalone Gym Guide userscript must be removed from PDA (the feature refuses to start while it is installed).

## Troubleshooting

- **Red box "Speed Dial: ..."**: the message names the failing file. Open its raw URL in a browser (repo public, correct branch and path).
- **"no page nonce found" or other CSP errors**: use `dist/speed-dial.bundle.user.js` as a single pasted script instead.
- **"No API key available"**: the `###PDA-APIKEY###` placeholder was not filled in. Make sure the script is added inside PDA's userscripts.
- GitHub caches raw files for around 5 minutes, so changes may take a while to appear.

## Notes

- Travel Helper: tap a country for flight times, the time you will be back, and warnings. "Go to travel agency" only opens Torn's travel page (nothing on the page is clicked or read). The button is disabled while you are in hospital or jail.
- Targets: bottom bar **Add | Edit | Filter | Refresh**. **Add** opens its own view (like Item Dock) with a back button and one search box: digits, `[123]` or a profile link add that ID directly; anything else is searched by name (Torn API v2 `user/search`) and shows a pick list (name, ID, level, tap to add; every result is checked against what you typed, because the API ignores a wrong filter). Each row shows name, ID (dark grey) and status with a live cooldown (Okay green, Hospital, Jail, Traveling, ...). Tap a row for the status details; tap the name to open the profile. **Edit** shows a ✕ per row. **Filter** (funnel) picks the order: Default (as added), A-Z, or Okay first (then the shortest cooldown); it is remembered. Refresh reloads only the targets on screen and works once every 30 seconds (also across reopening the window). The list scrolls a little inside a height-capped window; from 15 targets on it uses pages (15 each, arrows with `page / total` between them) and Refresh only requests the current page. Max 150 targets, saved under `speedDial.targets1`.
- Settings (gear circle, always last, cannot be hidden):
  - **Menu** page: two groups. **On screen** (max 3, default Item Dock, Travel Helper, Targets) and **Show More** (everything else: Calculator, your shortcuts, new modules). Tap the pin to move a module between the groups (a 4th pin is refused with a toast). Tap **Edit** to drag the handle (≡) to reorder inside a group; your own shortcuts also get a ✕ to delete. New modules and new shortcuts start in Show More. The old eye (hide) is gone: nothing needs hiding any more.
  - **Features** page: a switch per page feature, and a **!** button that opens a pop-up with its one-line explanation.
  - **Shortcut** page: pick an emoji, name it, and enter a torn.com page (or tap "This page" while on it). Max 8. Only torn.com pages are accepted.
  - Your order and hidden list are saved under `speedDial.layout1`; saved shortcuts keep using `speedDial.shortcuts1`, so they carry over from the old Shortcuts module.
- Show More: a 4-column grid of icons with the name underneath. Tap a tile to open that module (the launcher closes); tap a tile whose window is open to close it. **Edit** (bottom left) lets you drag tiles into a new order; **Done** saves. Anything new (a new shortcut, a module you unpin from the screen) is added at the END. A tile with a small arrow is a shortcut and leaves the page. While a window of something inside Show More is open, the `...` circle shows a dot. Saved under `speedDial.layout1` as `{ order, front }` (an old `hidden` list is ignored).
- Calculator: + − × ÷ with the usual precedence (2+3×4 = 14), %, ±, backspace, AC. `200 + 10%` = 220. Nothing is saved.
- Item Dock items and Travel Helper settings use the same storage keys as the old standalone scripts, so they carry over.
- Main circle colours: blue = abroad or traveling, yellow = hospital, red = jail, federal, or hospital abroad. Status is checked once per page load.
