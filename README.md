# torn-pda-speed-dial

One floating circle on every Torn page, for [Torn PDA](https://github.com/Manuito83/torn-pda). Tap it and your favourite tools fan out as circles; tap a tool to open it in its own floating window. Everything else lives behind a **...** (Show More) circle, and a gear circle opens Settings.

Tools only run while their window is open: no background timers, no polling, no surprise API calls. The one exception is the circle's status colour (see [Using Speed Dial](docs/using.md)).

## What is inside

| Tool (circle) | What it does |
|---|---|
| **Item Dock** | Your own short list of items: tap, confirm, used in place |
| **Travel Helper** | Flight times, return time, warnings, foreign shop stock |
| **Targets** | Players you track, with live status and a one-tap Attack button |
| **Price Checker** | Watchlist with alert prices, margin check, bazaar price helper |
| **Calculator**, **Quick Notes**, **Daily Checklist** | Small everyday tools (no API) |
| **Shortcuts** | Your own emoji circles that open a Torn page |

| Page feature (runs on a Torn page, off by default) | What it does |
|---|---|
| **Gym Guide** | Highlights the gym to train next and shows progress |
| **High-Low / Blackjack / Poker Helper** | Read-only odds panels on the casino pages |

All of it is explained in [docs/using.md](docs/using.md).

## Install

1. Create a **public** GitHub repo named `torn-pda-speed-dial` and upload the contents of this folder (`dist/` is optional).
2. Open `speed-dial.loader.user.js` and make sure `BASE` matches your username, repo and branch.
3. In Torn PDA, add `speed-dial.loader.user.js` as a new userscript. It is the only script you install.
4. Disable or delete any older Item Dock, Travel Helper, Gym Guide or Speed Dial scripts so nothing runs twice.
5. Reload a Torn page. A circle with a four-square icon should appear.

No GitHub? Paste `dist/speed-dial.bundle.user.js` instead: the same thing as one file (it does not update by itself).

## Updating

Everything except the loader updates from GitHub on its own. The loader looks at the file list every couple of minutes at most and downloads only the files that changed, so most page loads make no request at all.

You paste the loader into PDA again **only when its own version changes**; the [CHANGELOG](CHANGELOG.md) says when. Right now: **loader 0.6.0, paste it once.**

Publishing your own changes is a two-step habit: edit, then run `./build.sh` before you push. Details in [docs/developing.md](docs/developing.md).

## Troubleshooting

- **Nothing appears.** Open the loader's raw URL in a browser (repo public, right branch and path). A red box on a Torn page names the failing file.
- **Red box "N file(s) skipped".** One module or feature failed to load; everything else still works. Tap the box to dismiss it; Settings > Terminal > Problems has the detail.
- **"no page nonce found" or other CSP errors.** Use `dist/speed-dial.bundle.user.js` as a single pasted script instead.
- **"No API key available".** The script must be added inside PDA's userscripts so PDA can fill in your key.
- **An update does not show up.** Allow a few minutes (the loader's check interval plus GitHub's own caching). If you changed a file but forgot `./build.sh`, nobody receives it.
- **Something misbehaves.** Settings > Terminal shows what Speed Dial has been doing. **Copy** gives you a log that is safe to share (your API key is masked).

## Repository layout

| Path | Purpose |
|---|---|
| `speed-dial.loader.user.js` | The only script installed in PDA. Downloads and runs everything listed in `manifest.json` |
| `manifest.json` | File list (in load order) and a version per file. The versions are written by `build.sh` |
| `store.js` | Saved data: PDA's native storage, with localStorage as copy and fallback. Always first |
| `core.js` | The circle, windows, menu and the helpers shared by all tools (player data, item list, API, log) |
| `modules/` | Tools that open in a window |
| `features/` | Page features that run on a Torn page itself |
| `build.sh` | Release script: versions, manifest, offline bundle |
| `dist/` | The offline single-file bundle |
| `docs/` | [Using Speed Dial](docs/using.md) and [Developing](docs/developing.md) |
| `CHANGELOG.md` | What changed, and when the loader must be pasted again |

## Credits

The Gym Guide's ratio logic is adapted from [GymIQ](https://github.com/CLASIX/GymIQ---Torn-Ratio-Helper) by ClasixTV (MIT License). Foreign stock data in the Travel Helper comes from the community services YATA and Prometheus.
