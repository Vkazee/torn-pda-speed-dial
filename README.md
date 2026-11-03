# torn-pda-speed-dial

A single floating circle for Torn PDA. Tap the main circle, then circles appear for your (at most 3) favourite tools, a **Show More** circle (`...`) for everything else, and the Settings gear. Tap a tool's circle to open it in its own **floating window**. Each tool **only runs while its window is open**: no timers, API calls, or background rendering once it is closed. The one exception is **Live status** (always on, no switch; see Notes), which keeps the circle colour current.

## Saved data (native storage)

Everything you save (Targets, menu order and hidden circles, shortcuts, window positions, Item Dock items, Travel Helper settings, Gym Guide choices, which features are on) is kept in Torn PDA's native per-script storage (`PDA_storage`): on disk in the app, not wiped when the browser cache is cleared. Because PDA_storage is asynchronous, `store.js` loads it once before anything else starts and then works from memory; writes reach the app in one batch about half a second later and again when the page is hidden. The first time, whatever is already in localStorage is copied into the app, so nothing is lost. localStorage still gets a copy of each write and is used alone if your PDA has no native storage. The downloaded-source cache (`speedDial.src.*`) stays in localStorage on purpose: it is only an offline backup of the code.

Because the loader is the only script installed in PDA, all data lives in the loader's own namespace (Userscripts > the script's storage button shows what it uses; the default limit is 10 MB, this project needs well under 1 MB). **After updating, paste the new `speed-dial.loader.user.js` into PDA once** (it now hands `PDA_storage` to `store.js`); everything else updates from GitHub as before. Add `store.js` to the repo root next to `core.js`.

## Terminal (debug log)

**Settings > Terminal** shows what Speed Dial has been doing, so errors are no longer hidden: windows opening and closing, every API call (endpoint, time taken, API error code), status checks and the outline colour changing, page changes inside Torn (and whether the Speed Dial element is still in the page), saved-data writes and failures, features starting, stopping or refusing, toasts, and errors thrown by Speed Dial's own code.

- Lines live **in memory only** (the last 300). Nothing is written to storage per line, there is no timer and no API call, and nothing is drawn unless the Terminal page is open (new lines arrive as events).
- **Save** keeps a copy of the current log under `speedDial.log1`, so it survives a reload; **Saved** shows that copy (Clear there deletes it). Use it when an error happens, you reload, and want to look afterwards.
- Buttons: Live/Saved, All/Warn+/Errors filter, Pause (stops new lines from appearing, Resume redraws), Clear, Copy (puts the lines on the clipboard with a short header: version, native storage yes/no), Save.
- The **Logging** switch turns the log off completely (`SD.log` then does nothing). On by default; saved under `speedDial.dbg1`.
- Your API key is masked (`***`) in every line, so a copied log is safe to share.
- Limits: errors thrown by Torn's own scripts are not shown, and when you run the single-file bundle instead of the loader, uncaught errors are not recognised as ours (lines written with `SD.log` still appear).

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
| `modules/showmore.js` | Show More module (pinned `...` circle before Settings): launcher grid with every module that is not on screen, shortcuts included, plus one Settings button (opens Settings > Menu in edit mode) |
| `modules/settings.js` | Settings module (gear circle, always last): choose which (max 3) modules stay on screen, reorder, switch page features on/off, add your own emoji shortcuts, and the Terminal (debug log) |
| `features/gymguide.js` | Gym Guide, a page feature (runs on the Gym page, outside the circles) |
| `features/casinohelper.js` | Casino Helper, a page feature (runs on the High-Low and Blackjack pages): win chance and the best next move |
| `dist/speed-dial.bundle.user.js` | Single-file backup (no GitHub required) |
| `build.sh` | Combines `store.js` + `core.js` + every file in `manifest.json` (same order) into the bundle. Each file sits in its own try/catch, so a runtime error in one module does not stop the others (like the loader; only the loader also survives a syntax error) |

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

## Rule for every new module or feature: log what it does with `SD.log`

`SD.log('tag', 'message')` adds a line to the Terminal (tag = short name, 10 characters at most). Use `SD.log('tag', 'message', 'w')` for a warning and `'e'` for an error. Log module opens that matter, API/HTTP calls (`SD.api` already logs its own), and **every `catch` block**: an empty `catch (e) {}` hides the problem, so log the message or write a short comment on why it is safe to ignore. Never put your API key or other secrets in a message (the key is masked anyway, but do not rely on it).

## Rule for every new module: colours and sizes come from the tokens

`core.js` defines CSS variables on `#sdial`; use them instead of hex values or fixed heights so every module looks the same and one change reaches everything.

| Token | Value | Use |
|---|---|---|
| `--sd-bg` / `--sd-bg2` / `--sd-hov` | `#1c1c1c` / `#242424` / `#2e2e2e` | window / card and button / pressed |
| `--sd-line` / `--sd-line2` | `#333` / `#3a3a3a` | border / stronger border (inputs, circles) |
| `--sd-text` / `--sd-text2` / `--sd-dim` | `#e6e6e6` / `#d0d0d0` / `#8a8a8a` | main / button text / secondary text |
| `--sd-red` / `--sd-redt` | `#e5534b` / `#f1807a` | red accent / red text |
| `--sd-blue` / `--sd-bluet` | `#4a8fd9` / `#6fa8e8` | blue accent / blue text |
| `--sd-yel`, `--sd-green` | `#d9a441`, `#85b200` | yellow, green accent |
| `--sd-h` / `--sd-hi` / `--sd-hl` | 34 / 36 / 38 px | standard button / input / large button height |

**Edit / Done buttons:** call `SD.editBtn(button, on)`; it sets the text and the green `sd-on` look, so every window's Edit mode looks the same. Green = a mode or switch that is on, blue = the chosen option, grey = the current page or tab.

Circle sizes are named constants at the top of `core.js` (`FAB` 40, `MOD` 36, `GAP`, `OFF`). Tinted status backgrounds (chips, warnings) may still use their own hex. Page features outside `#sdial` (Gym Guide) cannot see the tokens and keep their own palette. `store.js` writes a warning to the Terminal when a key has no known prefix.

## Adding a New Module

1. Create `modules/name.js` that calls `SpeedDial.register({ id, label, icon, width, mount })`. `width` is the window's width in px (about 200-300 fits a phone).
   - `icon` is inner SVG markup for a 24x24 stroke icon. Use `emoji` instead for an emoji circle; `href` makes the circle open a page instead of a window; `ord` sets the default order; `pinned: true` keeps it as a fixed circle after the on-screen ones (sorted by `ord`) and out of the Show More list. A new unpinned module lands in Show More; the user can pin it to the screen in Settings > Menu. Other modules can be opened from code with `SD.open(id, arg)` (arg arrives in `mount` as `ctx.arg`; with an arg an open window is reopened), `SD.close(id)`, `SD.isOpen(id)`. `SpeedDial.unregister(id)` removes one.
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
- Casino Helper (Settings > Features, off by default): a panel under the page title on the **Blackjack** (`page.php?sid=blackjack`) and **High-Low** (`sid=highlow`) pages. It reads the cards and the enabled buttons on the page, never clicks anything and uses no API.
  - **Blackjack**: big recommendation (Stand / Hit / Double / Split), a win / push / lose bar for that move, and the expected value per unit bet of every option. Odds are exact for the dealer card you see (infinite deck). Button labels are matched loosely ("HIT ME", "DOUBLE DOWN"); only moves whose buttons are shown greyed out are skipped, a button that is not recognised counts as available. for Double and Split it also names the fallback if the page refuses. Dealer ace shows a "skip insurance" note.
  - **High-Low**: chance that your face-down card is higher or lower than the **dealer's** card (full deck minus the dealer card), the same-rank chance, and which one to pick. The dealer card is chosen by name (dealer ancestor), then by position (dealer sits left); face-down, hidden, faded-out or covered cards, and anything outside the game area (sidebar, chat), are ignored. Settings > Terminal logs every card it saw as `rank+suit/role@x` with `*` on the one used (`!hid` = hidden, `!cov` = covered).
  - Between rounds (the Hit/Stand or Higher/Lower buttons are gone or greyed out after having been on the page) the panel goes back to its standard "Waiting for the next round..." state and cards typed in with Manual are cleared.
  - **Manual** button: tap the ranks yourself if the page markup is not recognised. **Rules** button: dealer on soft 17 (stands/hits), double after split, dealer checks for blackjack, and whether an ace is high or low in High-Low. Saved under `speedDial.casino1`.
  - If no cards are found, **Settings > Terminal** logs `casino` lines with the card-like elements it saw, which is what is needed to adjust the card detection.
  - No strategy beats the house over time; this only avoids choosing worse than necessary.
- Settings (gear circle, always last, cannot be hidden):
  - **Menu** page: two groups. **On screen** (max 3, default Item Dock, Travel Helper, Targets) and **Show More** (everything else: Calculator, your shortcuts, new modules). Tap the pin to move a module between the groups (a 4th pin is refused with a toast). Tap **Edit** to drag the handle (≡) to reorder inside a group; your own shortcuts also get a ✕ to delete. New modules and new shortcuts start in Show More. The old eye (hide) is gone: nothing needs hiding any more.
  - **Features** page: a switch per page feature, and a **!** button that opens a pop-up with its one-line explanation.
  - **Shortcut** page: pick an emoji, name it, and enter a torn.com page (or tap "This page" while on it). Max 8. Only torn.com pages are accepted.
  - Your order and hidden list are saved under `speedDial.layout1`; saved shortcuts keep using `speedDial.shortcuts1`, so they carry over from the old Shortcuts module.
- Show More: a 4-column grid of icons with the name underneath. Tap a tile to open that module (the launcher closes); tap a tile whose window is open to close it. The single **Settings** button opens Settings > Menu already in edit mode, the one place that reorders, pins/unpins and deletes shortcuts. Anything new (a new shortcut, a module you unpin from the screen) is added at the END. A tile with a small arrow is a shortcut and leaves the page. While a window of something inside Show More is open, the `...` circle shows a dot. Saved under `speedDial.layout1` as `{ order, front }` (an old `hidden` list is ignored).
- Calculator: + − × ÷ with the usual precedence (2+3×4 = 14), %, ±, backspace, AC. `200 + 10%` = 220. Nothing is saved.
- Item Dock items and Travel Helper settings use the same storage keys as the old standalone scripts, so they carry over.
- Main circle colours (the window outline, the Item Dock banner and the Targets status text use the same rule): blue = abroad or traveling, yellow = hospital (at home or abroad), red = jail or federal. The colour is kept live by **Live status** (always on, there is no switch): one light API call every 5 s while the page is visible, a check right when a hospital/jail timer or flight should end, one 1.5 s after any tap on the page (attacking, travelling and using items change your status), and one when you return to the app or the connection comes back. It never fetches more often than every 2.5 s and backs off after API errors.
