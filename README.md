# torn-pda-speed-dial

A single floating circle for Torn PDA. Tap the main circle, then one circle appears for each tool. Tap a tool's circle to open it in its own **floating window**. Each tool **only runs while its window is open**: no timers, API calls, or background rendering once it is closed.

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
| `core.js` | Core: main circle, module list, floating windows, shared player data (1 API call), toast, storage |
| `modules/itemdock.js` | Item Dock module |
| `modules/travelhelper.js` | Travel Helper module |
| `modules/targets.js` | Targets module |
| `modules/settings.js` | Settings module (gear circle, always last): show/hide and reorder circles, switch page features on/off, and add your own emoji shortcuts |
| `features/gymguide.js` | Gym Guide, a page feature (runs on the Gym page, outside the circles) |
| `dist/speed-dial.bundle.user.js` | Single-file backup (no GitHub required) |
| `build.sh` | Combines `core.js` + `modules/` + `features/` into the bundle |

## Install

1. Create a **public** GitHub repo named `torn-pda-speed-dial`.
2. Upload `core.js`, `manifest.json`, and the `modules/` folder to the repo root.
3. Open `speed-dial.loader.user.js` and make sure `BASE` matches your username, repo, and branch.
4. In Torn PDA, add `speed-dial.loader.user.js` as a new userscript.
5. Disable or delete the old Item Dock, Travel Helper, and any earlier Speed Dial scripts to avoid duplicates.
6. Reload the Torn page. A circle with a four-square icon should appear.

How the loader works: it downloads the files through PDA's `PDA_httpGet`, keeps the last good copy in localStorage (works if GitHub is unreachable), and runs them as inline scripts using the page's CSP nonce, because Torn blocks `eval`.

## Adding a New Module

1. Create `modules/name.js` that calls `SpeedDial.register({ id, label, icon, width, mount })`. `width` is the window's width in px (about 200-300 fits a phone).
   - `icon` is inner SVG markup for a 24x24 stroke icon. Use `emoji` instead for an emoji circle; `href` makes the circle open a page instead of a window; `ord` sets the default order; `pinned: true` keeps it last and un-hideable. `SpeedDial.unregister(id)` removes one.
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
- Targets: type a player ID (or paste a profile link) and tap Add; the name and status are fetched once. Each row shows name, ID (dark grey) and status with a live cooldown (Okay green, Hospital, Jail, Traveling, ...). Tap a row for the status details; tap the name to open the profile. **Edit** shows a ✕ per row to remove it. Refresh reloads only the targets on screen and works once every 30 seconds (also across reopening the window). From 15 targets on, the list uses pages (15 each, arrows with `page / total` between them) instead of scrolling, and Refresh only requests the current page. Max 150 targets, saved under `speedDial.targets1`.
- Settings (gear circle, always last, cannot be hidden):
  - **Menu** page: every circle in your order. Tap the eye to hide or show one. Tap **Edit** to drag the handle (≡) to reorder; your own shortcuts also get a ✕ to delete. New modules appear at the bottom until you move them.
  - **Features** page: a switch per page feature, and a **!** button that opens a pop-up with its one-line explanation.
  - **Shortcut** page: pick an emoji, name it, and enter a torn.com page (or tap "This page" while on it). Max 8. Only torn.com pages are accepted.
  - Your order and hidden list are saved under `speedDial.layout1`; saved shortcuts keep using `speedDial.shortcuts1`, so they carry over from the old Shortcuts module.
- Item Dock items and Travel Helper settings use the same storage keys as the old standalone scripts, so they carry over.
- Main circle colours: blue = abroad or traveling, yellow = hospital, red = jail, federal, or hospital abroad. Status is checked once per page load.
