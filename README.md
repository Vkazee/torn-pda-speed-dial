# torn-pda-speed-dial

A single floating circle for Torn PDA. Tap the main circle, then one circle appears for each tool. Each tool **only runs when its panel is open**: no timers, API calls, or background rendering while closed.

## Folder Contents

| File | Function |
|---|---|
| `speed-dial.loader.user.js` | The only script installed in PDA. Downloads everything listed in `manifest.json` from GitHub |
| `manifest.json` | List of files the loader downloads, in order |
| `core.js` | Core: main circle, module list, shared player data (1 API call), toast, storage |
| `modules/itemdock.js` | Item Dock module |
| `modules/travelhelper.js` | Travel Helper module |
| `modules/shortcuts.js` | Shortcuts module: your own emoji circles that open a Torn page, plus the "+" circle to add them |
| `dist/speed-dial.bundle.user.js` | Single-file backup (no GitHub required) |
| `build.sh` | Combines `core.js` + `modules/` into the bundle |

## Install

1. Create a **public** GitHub repo named `torn-pda-speed-dial`.
2. Upload `core.js`, `manifest.json`, and the `modules/` folder to the repo root.
3. Open `speed-dial.loader.user.js` and make sure `BASE` matches your username, repo, and branch.
4. In Torn PDA, add `speed-dial.loader.user.js` as a new userscript.
5. Disable or delete the old Item Dock, Travel Helper, and any earlier Speed Dial scripts to avoid duplicates.
6. Reload the Torn page. A circle with a four-square icon should appear.

How the loader works: it downloads the files through PDA's `PDA_httpGet`, keeps the last good copy in localStorage (works if GitHub is unreachable), and runs them as inline scripts using the page's CSP nonce, because Torn blocks `eval`.

## Adding a New Module

1. Create `modules/name.js` that calls `SpeedDial.register({ id, label, icon, width, mount })`.
   - `icon` is inner SVG markup for a 24x24 stroke icon. Use `emoji` instead for an emoji circle; `href` makes the circle open a page instead of a panel; `ord` sorts circles. `SpeedDial.unregister(id)` removes one.
   - `mount(ctx)` gets `ctx.el`, `ctx.every(fn, ms)`, `ctx.after(fn, ms)` and `ctx.alive`; timers are cleared automatically when the panel closes.
2. Add `"modules/name.js"` to `manifest.json` (after `core.js`).
3. Push to GitHub. Nothing changes in PDA.
4. Optional: run `./build.sh` to refresh the offline bundle.

## Troubleshooting

- **Red box "Speed Dial: ..."**: the message names the failing file. Open its raw URL in a browser (repo public, correct branch and path).
- **"no page nonce found" or other CSP errors**: use `dist/speed-dial.bundle.user.js` as a single pasted script instead.
- **"No API key available"**: the `###PDA-APIKEY###` placeholder was not filled in. Make sure the script is added inside PDA's userscripts.
- GitHub caches raw files for around 5 minutes, so changes may take a while to appear.

## Notes

- Travel Helper: tap a country for flight times, the time you will be back, and warnings. "Go to travel agency" only opens Torn's travel page (nothing on the page is clicked or read). The button is disabled while you are in hospital or jail.
- Shortcuts: tap the "+" circle, pick an emoji, name it, and enter a torn.com page (or tap "This page" while on it). Max 8. Tap a shortcut circle to open its page; remove it from the "+" panel. Only torn.com pages are accepted.
- Item Dock items and Travel Helper settings use the same storage keys as the old standalone scripts, so they carry over.
- Main circle colours: blue = abroad or traveling, yellow = hospital, red = jail, federal, or hospital abroad. Status is checked once per page load.
