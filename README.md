# torn-pda-speed-dial

A single floating circle for Torn PDA. Tap the main circle, then one circle appears for each tool. Each tool **only runs when its panel is open**: no timers, API calls, or background rendering while closed.

## Folder Contents

| File | Function |
|---|---|
| `core.js` | Core: main circle, module list, shared player data (1 API call), toast, storage |
| `modules/itemdock.js` | Item Dock module |
| `modules/travel.js` | Travel Helper module |
| `speed-dial.user.js` | Script installed in PDA (loads the files above via `@require`) |
| `dist/speed-dial.bundle.user.js` | Single-file version (backup, no GitHub required) |
| `build.sh` | Combines everything into a bundle file |

## How to Use via GitHub

1. Create a **public** repo named `torn-pda-speed-dial`.
2. Upload `core.js`, the `modules/` folder, and `speed-dial.user.js` (Add file, Upload files).
3. Open `speed-dial.user.js` and replace all occurrences of `USERNAME` with your GitHub username.
4. In Torn PDA, add the contents of `speed-dial.user.js` as a new userscript.
5. **Disable or delete** the old Item Dock and Travel Helper scripts to avoid duplicates.
6. Reload the Torn page. A circle with a four-square icon should appear.

If the red message "Speed Dial: @require failed" appears, it means PDA does not load `@require` or the URL is incorrect. Use the backup: install the contents of `dist/speed-dial.bundle.user.js` as a single script.

## Legacy Data

The Item Dock item list and Travel Helper settings use the same storage keys as the old scripts, so they are carried over. The circle's position is reset (shifted once only).

## Adding a New Module

1. Create `modules/name.js` that calls `SpeedDial.register({ id, label, icon, width, mount })`.
2. Add one `@require` line in `speed-dial.user.js`.
3. Run `./build.sh` to update the bundle file.

## Notes

- GitHub caches raw files for around 5 minutes, so changes may take a while to appear.
- From the main circle: blue = abroad or traveling, yellow = hospital, red = jail, federal, or hospital abroad. Status is checked once each time the page loads.