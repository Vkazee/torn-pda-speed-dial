# Using Speed Dial

How Speed Dial behaves and what each tool does. Exact limits and layouts can change between versions; the source files start with a comment that describes each tool in detail.

## The circle and the windows

- **Tap** the main circle to fold the tool circles out or away. **Drag** it to move it: it snaps to the nearest screen edge and remembers where you left it.
- **Left alone for a few seconds, the main circle fades and slides partly off the screen edge** (a quarter of it), so it stays out of the way. Touch it (or any circle or window of Speed Dial) and it comes back. It never fades while the tool circles are fanned out. The state carries over to the next Torn page: a page opened while it is idle starts idle, so it does not pop back and fade again. The delay (`IDLE_MS`) and the hidden part (`IDLE_HIDE`) are set at the top of `core.js`; `IDLE_MS = 0` turns the effect off.
- A few tools stay on screen as circles (you choose which in Settings > Menu). The rest are behind the **...** circle, which shows a dot while one of its tools is open. The gear circle opens Settings.
- A tool opens in its own **floating window**. Drag it by the title bar. Close it with the ✕ or by tapping the tool's circle again. Several windows can be open at once and a tap brings one to the front.
- Window positions are remembered per tool and always kept on screen, also after you rotate the phone. Which windows are open is not remembered.
- **Closing a window stops the tool completely**: its timers and requests end with it.
- Touches on the circles and windows are hidden from Torn's own swipe handlers, so dragging does not pull Torn's sidebar open. This guard is registered by the loader at document start; if it ever runs late, set the script's injection time to **Start** in PDA.

## Status colour (the one thing that runs by itself)

The main circle's colour, and the outline of every window, shows your status: blue = abroad or travelling, yellow = hospital, red = jail or federal. To keep it current Speed Dial does a light status check every few seconds while a Torn page is visible, plus an extra check after you act on the page, when a hospital/jail timer or flight should end, and when you return to the app. It slows down after API errors. There is no switch for it.

## Tools

- **Item Dock**: a short list of your own items. Tap one, confirm, and it is used right there without leaving the page. Items you own show how many you have (low stock is highlighted); faction armoury items work too, without a count. Reorder in Edit mode. It refuses while your status blocks item use. On Torn's own Items page the counts are read from the page itself.
- **Travel Helper**: flight time (one way and round trip), when you will be back, and warnings when your status, bars or cooldowns clash with the trip. The **Stocks** box shows foreign shop stock with profit, from community services (see Network and privacy). "Go to travel agency" only opens Torn's travel page; nothing on that page is read or clicked. Below the level needed for travelling the panel only shows a notice.
- **Targets**: players you want to keep an eye on, each with live status and cooldown. Add by ID, profile link or name search; sort by order added, A-Z or "Okay first"; each row has an Attack button that opens that player's attack page (dimmed while the target is not Okay, but it still works). Refresh has a short cooldown and long lists are paged to keep API use low.
- **Price Checker**: a watchlist with alert prices, the cheapest item-market listings, a margin check against market value and shop prices, and a suggested price for your own bazaar listing. Torn's API has no bazaar prices, so that suggestion is based on the item market. Alerts only show while the window is open.
- **Calculator**: the usual operations with correct precedence and percentages; you can place the caret in the typed line. Nothing is saved.
- **Quick Notes**: titled notes, saved as you type. Nothing leaves the phone.
- **Daily Checklist**: your own tasks; the ticks clear every day at midnight Torn time (TCT = UTC). No API.
- **Shortcuts**: your own emoji circles that open a Torn page (torn.com pages only). Create them in Settings > Shortcut.
- **Show More** is the launcher for every tool that is not on screen, shortcuts included. Its **Settings** button opens the Menu page in edit mode.

## Page features

Features run on a Torn page itself instead of in a window. They are **off by default** and each has a switch in Settings > Features (tap **!** for a short description and the page it runs on). A feature that is off runs nothing; switching one off removes everything it added, without a reload. A feature you switch on while on another page starts the next time you open its page.

- **Gym Guide** (Gym page): highlights the gym tile to train next, from your chosen stat ratio, and shows a progress panel under the gym icons. It reads only what the page shows and uses no API. The old standalone Gym Guide script must be removed from PDA; the feature refuses to start while it is installed.
- **Casino helpers** (High-Low, Blackjack, Poker pages): a panel under the page title with the odds and a suggested move. They read the cards and enabled buttons on the page, never click anything and use no API. If the page layout is not recognised, use **Manual** to enter the cards yourself, and the Terminal logs what the helper saw, which is what is needed to adjust the detection. No strategy beats the house over time; this only helps you avoid picking worse than necessary.

## Settings

- **Menu**: choose which tools stay on screen and in what order; the pin moves a tool between the screen and Show More, Edit lets you drag to reorder and delete your own shortcuts.
- **Features**: the switches described above, grouped by category.
- **Shortcut**: add your own emoji circle for a torn.com page (or tap "This page" while on it).
- **Backup**: see below.
- **Terminal**: see below.

## Saved data and backup

Everything you save (targets, notes, checklist, menu layout, shortcuts, window and circle positions, tool settings, which features are on) is kept in Torn PDA's native per-script storage, on disk in the app. It survives clearing the browser cache. localStorage keeps a copy, and is used alone if your PDA has no native storage. The first time, anything already in localStorage is copied into the app. Your API key is never stored by Speed Dial.

**Settings > Backup** moves all of it in one piece (new phone, reinstall, safety copy):

- **Copy** puts everything into one compressed text (it starts with `SDB1:`) in the box and on the clipboard. Keep it somewhere safe, such as a note or a message to yourself.
- **Restore** reads the text in the box. Tap once to see how many items it found, tap again within a few seconds to restore. Items in the backup overwrite your current ones; Speed Dial waits until PDA confirms the write and then reloads the page.
- Not included, on purpose: the API key, the Terminal logs and price caches. A text that is cut off, changed or not from Speed Dial is refused and nothing is written.

## Terminal

**Settings > Terminal** shows what Speed Dial has been doing, so errors are never hidden: windows opening and closing, API calls (endpoint, time, error code), status checks, saved-data writes, features starting or refusing, loader messages and errors thrown by Speed Dial's own code.

- The live view only exists in memory (a short rolling list) and costs nothing while the Terminal is closed.
- **Problems** keeps every warning and error automatically, so one that happened while the Terminal was closed or before a reload is still there. Repeats raise a counter instead of adding lines.
- **Save** keeps a copy of the current log across reloads; **Copy** puts the log on the clipboard with a short header (version, native storage yes/no). Your API key is masked in every line.
- The **Logging** switch turns the log off completely.
- Limits: errors thrown by Torn's own scripts are not shown, and when you run the single-file bundle instead of the loader, uncaught errors are not recognised as Speed Dial's own (lines written by Speed Dial itself still appear).

## Network and privacy

Speed Dial talks to a small, fixed set of hosts:

| Host | Why | Your API key sent? |
|---|---|---|
| `api.torn.com` | Player status, items, market and target data | Yes. The only place it ever goes; the code refuses any other host |
| `www.torn.com` | Using an item (Item Dock) and your own navigation, with your normal logged-in session, like the Items page itself | No |
| `raw.githubusercontent.com` | Downloading Speed Dial's own code (the loader) | No |
| `yata.yt`, `api.prombot.co.uk` | Foreign shop stock for the Travel Helper (YATA first, Prometheus as fallback) | No |

Links (shortcuts and tools that open a page) only go to torn.com pages. Nothing is sent anywhere else.
