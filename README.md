<h1 align="center">OpenGP5 Launchpad</h1>

<p align="center"><b>The desktop app for the Valeton GP-5: flash firmware, load captures and IRs, edit presets live, and back everything up.</b></p>

<p align="center">
  <a href="https://github.com/OpenGP5/Launchpad/releases/latest"><img alt="Version 0.4.0" src="https://img.shields.io/badge/version-0.4.0-3cc0c1?style=flat-square"></a>
  <img alt="macOS, Windows and Linux" src="https://img.shields.io/badge/runs%20on-macOS%20%7C%20Windows%20%7C%20Linux-5b6b7b?style=flat-square">
  <a href="LICENSE"><img alt="Licence: MIT" src="https://img.shields.io/badge/licence-MIT-3ee8b5?style=flat-square"></a>
</p>

<p align="center">
  <a href="https://opengp5.github.io/docs/launchpad/"><b>User guide</b></a> ·
  <a href="https://github.com/OpenGP5/Launchpad/releases/latest"><b>Download</b></a> ·
  <a href="https://github.com/OpenGP5/Launchpad/issues">Report a problem</a>
</p>

---

Launchpad connects to the pedal over USB and shows the tools that fit what it runs: Valeton's own firmware, or any
firmware built on [OpenGP5](https://github.com/OpenGP5/OpenGP5).

| Page | What you do there | Works with |
|---|---|---|
| **Home** | See what the pedal runs and what's on it | every firmware |
| **Flash** | Install a firmware: one that comes with Launchpad, one from [OpenGP5's catalog](https://github.com/OpenGP5/OpenGP5/blob/main/catalog/README.md), your own build, or Valeton's. Every image is checked before anything is written | every firmware, and a pedal in update mode |
| **Tones** | Load NAM captures and cab IRs, pair them, set each capture's gate and EQ, play one on the pedal | [NAM Loader](https://github.com/OpenGP5/NAM-Loader) |
| **Presets** | Edit Dreamcatcher's 8 presets while you play, name, rearrange, export and import them; or Valeton's 100 presets, every setting by name | [Dreamcatcher](https://github.com/OpenGP5/Dreamcatcher), Valeton's firmware V1.0.6 |
| **Live** | Change any firmware's settings as you play, from the firmware's own description of them | OpenGP5 1.0 firmwares |
| **Backups** | Save everything the firmware keeps on the pedal to one file, and restore it | every firmware |
| **Mods** | Enable English, Chinese, or both over USB-MIDI without flashing; or apply small changes to your own copy of Valeton's firmware, with undo | Valeton's firmware V1.0.6 |
| **Developer** | The pedal's log as it comes, and how busy each processor is | OpenGP5 0.7+ firmwares |
| **Settings** | Theme, the update check, recovery steps | |

> [!NOTE]
> **Before you flash.** Flashing custom firmware can go wrong. Read
> [Before you flash](https://opengp5.github.io/docs/get-started/safety/) first.

## Download

Get the file for your computer from [Releases](https://github.com/OpenGP5/Launchpad/releases/latest):

| System | File |
|---|---|
| macOS, Apple silicon | `OpenGP5 Launchpad-…-arm64.dmg` |
| macOS, Intel | `OpenGP5 Launchpad-….dmg` |
| Windows | `OpenGP5 Launchpad Setup … x64.exe` (installer), or `…-win.zip` (x64) / `…-arm64-win.zip` (ARM64) |
| Linux | `.AppImage` or `.deb`: `x86_64` / `amd64` for most PCs, `arm64` for ARM |

Launchpad isn't signed, so the system warns you the first time you open it:

- **macOS:** right-click the app, choose **Open**, then **Open** again. If macOS says the app is damaged, run this
  once in Terminal:
  ```bash
  xattr -cr "/Applications/OpenGP5 Launchpad.app"
  ```
- **Windows:** on "Windows protected your PC", click **More info**, then **Run anyway**.
- **Linux:** make the AppImage executable (`chmod +x`), or install the `.deb`.

Launchpad checks for a newer version when it starts (you can turn that off in Settings). Installing it is your
choice: the banner opens the download.

## Valeton's firmware

Nothing of Valeton's comes with Launchpad. When you need Valeton's firmware (to flash it back, for its preset
names, or for a mod), Launchpad downloads it from Valeton's own site, accepts it only if it is exactly V1.0.6, and
keeps it on your computer.

The Languages mod on the Mods page enables English, Chinese, or both on a stock GP-5 (Valeton V1.0.6) over USB-MIDI,
without flashing or changing presets. It is based on [Valeton Unlocker](https://github.com/flameshikari/valeton-unlocker)
and was implemented with AI assistance. The pedal confirms the command but does not report unlocked languages.

## Build from source

You need Node.js 20 or later, and a C compiler for the tests.

```bash
git clone --recursive https://github.com/OpenGP5/Launchpad.git
cd Launchpad
npm install
npm start                       # run it
npm test                        # the tests, on a simulated pedal
npm run dist:mac                # or dist:win, dist:linux: unsigned packages in dist/
node scripts/check-dist.mjs     # checks the packages before a release
```

Without a pedal, `LAUNCHPAD_SIM=dreamcatcher npm start` runs it against a simulated one (also `nam`, `tuner`,
`stock` and `loader`).

## How it's made

Everything that talks to the pedal runs in the page, as plain browser JavaScript over Web MIDI, the same code as
OpenGP5's web flasher.

| File | What |
|---|---|
| `main.js`, `services.js`, `preload.js` | The window; MIDI permission, file dialogs, the update check, bundled files; the bridge between them |
| `valeton.cjs` | Downloading Valeton's firmware |
| `src/lib/` | Flashing and USB-MIDI (`gp5flash.js`, `webmidi.js`), NAM captures (`gp5nam.js`, `namfiles.js`), the platform's settings and files (`gp5store.js`, `gp5files.js`, tested against OpenGP5's C), backups, mods, Valeton's preset protocol and a simulated pedal |
| `src/views/` | One module per page |
| `src/styles.css` | Every colour and size as a token, light and dark |
| `src/firmware/` | The bundled firmwares and `manifest.json` |
| `opengp5/` | OpenGP5, a git submodule, used by the tests |

## Licence

MIT (`LICENSE`). Fonts: Atkinson Hyperlegible Next and Mono (SIL Open Font License, `src/fonts/`). Icons: Tabler
(MIT).

Not affiliated with or endorsed by Valeton. "Valeton" and "GP-5" are Valeton's trademarks, used only to say which
pedal this works with.
