# torn-pda-speed-dial

A single floating circle for Torn PDA. Tap the main circle, then one circle appears for each tool. Each tool **only runs when its panel is open**: no timers, API calls, or background rendering while closed.

## Folder Contents

| File | Function |
|---|---|
| `core.js` | Core: main circle, module list, shared player data (1 API call), toast, storage |
| `modules/itemdock.js` | Item Dock module |
| `modules/travelhelper.js` | Travel Helper module |
| `manifest.json` | List of files the loader downloads (add new modules here) |
| `speed-dial.loader.user.js` | **Recommended.** The only script installed in PDA; downloads everything in `manifest.json` from GitHub |
| `speed-dial.user.js` | Older version that uses `@require` (PDA may not load it, see Troubleshooting) |
| `dist/speed-dial.bundle.user.js` | Single-file version (backup, no GitHub required) |
| `build.sh` | Combines everything into the bundle file |

## How to Use via GitHub (loader)

1. Create a **public** repo named `torn-pda-speed-dial`.
2. Upload `core.js`, `manifest.json`, and the `modules/` folder to the repo root.
3. Open `speed-dial.loader.user.js` and make sure `BASE` matches your username/repo/branch.
4. In Torn PDA, add `speed-dial.loader.user.js` as a new userscript (paste the contents, or add it by raw URL).
5. **Disable or delete** the old Item Dock, Travel Helper, and any earlier Speed Dial scripts to avoid duplicates.
6. Reload the Torn page. A circle with a four-square icon should appear.

The loader downloads files through PDA's `PDA_httpGet` bridge and keeps the last good copy in localStorage, so it still works if GitHub is unreachable.

## Adding a New Module

1. Create `modules/name.js` that calls `SpeedDial.register({ id, label, icon, width, mount })`.
2. Add `"modules/name.js"` to `manifest.json` (after `core.js`).
3. Push to GitHub. No change is needed in PDA.
4. Optional: run `./build.sh` to refresh the offline bundle.

## Troubleshooting

- **Red box "Speed Dial: ..."**: the message says which file failed. Open the raw URL in a browser to check it exists (repo public, correct branch, correct path).
- **"load failed" or eval errors**: Torn may block `eval` in your PDA version. Use `dist/speed-dial.bundle.user.js` as a single pasted script instead.
- **"@require failed"** (old `speed-dial.user.js`): PDA does not load `@require`. Use the loader or the bundle.
- **"No API key available"**: the `###PDA-APIKEY###` placeholder was not filled in. Make sure the script is added inside PDA's userscripts.
- GitHub caches raw files for around 5 minutes, so changes may take a while to appear.

## Legacy Data

The Item Dock item list and Travel Helper settings use the same storage keys as the old scripts, so they are carried over. The circle's position is reset (shifted once only).

## Notes

- From the main circle: blue = abroad or traveling, yellow = hospital, red = jail, federal, or hospital abroad. Status is checked once each time the page loads.
