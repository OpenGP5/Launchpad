# OpenGP5 Launchpad

A desktop app for the Valeton GP-5 over USB: flash firmware, manage what's on the pedal, and back it up. It works
with Valeton's own firmware and with firmwares built on [OpenGP5](https://github.com/OpenGP5/OpenGP5), and shows
the tools that fit what the pedal runs.

| Section | What it does | Works with |
|---|---|---|
| Home | what the pedal runs and what's on it | everything |
| Flash | the bundled firmwares, more from [OpenGP5's catalog](https://github.com/OpenGP5/OpenGP5/blob/main/catalog/README.md) (downloaded and checked against it), your own build, or Valeton's firmware; every image is checked before writing | any, including update mode |
| Tones | 30 slots for NAM captures (12 before NAM Loader 1.3) and 12 cab IRs, in one list with a NAM / IR switch: drop a `.nam` or `.wav` anywhere to add it; Calibrate and Normalize, each with a switch; for the one picked: play it on the pedal (1.3.1), rename, replace, remove, its IR, its gate and EQ (1.1 and 1.2: one IR per slot) | [NAM Loader](https://github.com/OpenGP5/NAM-Loader) 1.1, all of it 1.3 |
| Presets | 8 presets: edit live with the pedal's own settings, name, rearrange, export and import; tempo sync (Free / Sync, BPM) with 1.4 | [Dreamcatcher](https://github.com/OpenGP5/Dreamcatcher) 1.2 |
| Live | the settings of any firmware on OpenGP5 1.0, made from the firmware's own description: change the sound as you turn | an OpenGP5 0.7+ firmware |
| Presets (Valeton) | the 100 stock presets: browse, edit every setting by name, hear changes live, rename, reset, export and import | Valeton firmware V1.0.6 |
| Backups | one `.gp5backup` file with the installed firmware's data (any OpenGP5 1.0 firmware's settings and files); restores onto the same firmware | OpenGP5 firmwares, Valeton firmware |
| Mods | small patches for Valeton's firmware, applied to your own copy of it; undo puts the original back | Valeton firmware V1.0.6 |
| Settings | theme (system, light, dark), update check, recovery steps | |
| Developer | for firmware authors: the pedal's log (`gp5_log` on both processors) as it comes, and the load and memory of both processors | an OpenGP5 0.7+ firmware |

> **Alpha.** Flashing can go wrong. Read OpenGP5's
> [getting-started guide](https://github.com/OpenGP5/OpenGP5/blob/main/GETTING-STARTED.md), especially
> *Recovery*, first.

## Download

Get the file for your computer from [Releases](https://github.com/OpenGP5/Launchpad/releases):

| System | File |
|---|---|
| macOS (Apple Silicon and Intel) | `.dmg` |
| Windows | `Setup … x64.exe` (installer), or a `.zip` for x64 or ARM64 |
| Linux | `.AppImage` or `.deb`, for x64 or ARM64 |

The app isn't signed, so the system warns the first time:

- **macOS:** right-click the app, choose **Open**, then **Open** again. If macOS says the app is damaged, run
  `xattr -cr "/Applications/OpenGP5 Launchpad.app"` in Terminal once.
- **Windows:** on "Windows protected your PC", click **More info**, then **Run anyway**.
- **Linux:** make the AppImage executable (`chmod +x`), or install the `.deb`.

Launchpad checks this repository's releases for a newer version (Settings can turn that off). Installing an
update is your click: it opens the download.

Nothing of Valeton's is included. When you need Valeton's firmware (flashing it back, its preset names, mods),
Launchpad downloads it from Valeton's own site on your request, accepts it only if it is exactly V1.0.6, and keeps
it on your computer.

## Build from source

Needs Node.js 20 or later.

```
git clone --recursive https://github.com/OpenGP5/Launchpad.git
cd Launchpad
npm install
npm start                       # run it
npm test                        # tests on a simulated pedal (needs a C compiler: they check against OpenGP5's own C)
npm run dist:mac                # or dist:win, dist:linux: unsigned packages in dist/
node scripts/check-dist.mjs     # checks the packages before a release
```

Without a pedal, `LAUNCHPAD_SIM=dreamcatcher npm start` (or `nam`, `tuner`, `stock`, `loader`) runs it against a
simulated one.

## How it is put together

- `main.js` (the window), `services.js` (MIDI permission, file dialogs, the update check, bundled files),
  `preload.js` (the bridge), `valeton.cjs` (the Valeton download). Everything that talks to the pedal runs in the
  page, as plain browser JavaScript over Web MIDI.
- `src/lib/`: the flashing and USB-MIDI code (`gp5flash.js`, `webmidi.js`, the same as OpenGP5's web flasher),
  NAM captures (`gp5nam.js`, `namfiles.js`), the platform's settings store and files (`gp5store.js`,
  `gp5files.js`, tested against OpenGP5's C), backups, mods, Valeton's preset protocol and a simulated pedal.
- `src/views/`: one module per section. `src/styles.css`: every colour and size as a token, light and dark.
- `src/firmware/`: the bundled firmwares and `manifest.json`.
- `opengp5/`: OpenGP5, a git submodule, used by the tests.

## Licence

MIT (`LICENSE`). Fonts: Atkinson Hyperlegible Next and Mono (SIL OFL, `src/fonts/`). Icons: Tabler (MIT).
Not affiliated with or endorsed by Valeton. "Valeton" and "GP-5" are Valeton's trademarks, used only to say which
pedal this works with.
