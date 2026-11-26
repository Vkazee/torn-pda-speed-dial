# Changelog

The release version is the first line of `core.js`. History before 0.15.0 was not recorded here (see the Git history).

## 0.15.0 (loader 0.6.0)

> **Action needed: paste the new `speed-dial.loader.user.js` into PDA once.** Everything else arrives by itself. Before your next push, run `./build.sh` (see [docs/developing.md](docs/developing.md)).

### Changed
- **The loader downloads only what changed.** `manifest.json` now has a version per file. A saved manifest younger than two minutes is trusted without any request, files whose version is unchanged are never requested again, and a changed file is fetched from a URL that carries its version (with a size check against stale copies from GitHub's cache). A normal page load goes from about 15 downloads to none.
- **One broken file no longer stops everything.** Only `store.js` and `core.js` are required. A module or feature that fails to download, has a syntax error or throws while loading is skipped; a red box (tap to dismiss) and a Terminal line say which, and the rest starts. If GitHub is unreachable the saved copies are used, and the manifest is retried after 30 seconds.
- `build.sh` rewrites the `v` list in `manifest.json`, keeps `SD.ver` in step with `core.js`, and has a `--check` mode that changes nothing and fails when the manifest or the bundle is out of date.
- The loader writes its own lines to the Terminal (`loader`): files downloaded or reused, skipped files, manifest problems.
- The loader's saved copies now include the manifest and a version list under `speedDial.src.@...`; the old copy of the manifest and copies of files that left the manifest are removed automatically. None of it is in the Backup.

### Fixed
- `SD.ver` said 0.14.1 while the file header said 0.14.2. The version shown in the Terminal and written into backups now always comes from the first line of `core.js`.

### Docs
- The README is now short; usage and development are split into [docs/using.md](docs/using.md) and [docs/developing.md](docs/developing.md).
- Newly written down: dragging the main circle, Item Dock, Gym Guide (and its GymIQ credit), the hosts Speed Dial talks to and what is sent to each, the release steps and versioning, and a reference for the shared helpers (`SD.data`, `SD.dur`, `SD.spin`, ...).
