# Changelog

All notable changes to VLTN Tone Studio. Versions match `app/package.json` and the GitHub Releases. The release workflow copies the section of the version it publishes into the release notes.

## [0.5.1] - 2026-10-12

### Added
- **Session log.** Tone Studio logs every connection step, connection and request error, change in what the host sees (USB, driver, interfaces, Valeton apps), long job, and every MIDI message with its decoded text and all bytes in hex. It doesn't depend on the MIDI monitor being on. The desktop app writes it to `logs/` in its data folder: 4 MB files, the newest 20 MB kept. The browser build keeps it in memory for the tab. *Device › Diagnostics › Session log* saves it as one file (*Save log*) or opens the folder. The diagnostic report says where it is. The log includes the presets read from and written to the pedal.

### Fixed
- **GP-200 connection diagnostics on Windows.** The *Driver* row shows the driver Windows bound to the GP-200's MIDI interface (MI_03), or the USB MIDI 2.0 fault, instead of a false "No driver is bound". A driver other than *USB Audio Device* (such as Valeton's ASIO driver) is a warning. Models whose MIDI interface isn't measured (GP-200LT, GP-200JR) are found by USB class, and say "Couldn't tell" rather than warn when that fails.
- **Valeton's GP-200 editor is detected.** When `GP-200.exe` (or `GP-200.app`) runs, the header, *Exclusive access* row and banners say it holds the port. Texts for a GP-200 never ask to close Valeton Suite.
- A silent port on the USB MIDI 2.0 driver opens the driver guide. Otherwise the note lists what can hold the port on Windows, browsers with a MIDI page included; the browser build also points at `chrome://flags/#use-winrt-midi-api`.
- The Windows 11 guide covers Valeton's ASIO driver and ends with a restart when the old driver sticks.

### Changed
- The diagnostic report lists the USB interfaces of Valeton devices (driver, name, MIDI class) and which Valeton apps run.

## [0.5.0] - 2026-10-11

### Added
- **Valeton GP-50 support.** Tone Studio recognises the connected model by itself (from the size of the preset it reads) and works the same on a GP-50 as on a GP-5: live editing, the library, backups and restore, SnapTones and User IRs over USB. A GP-50 has 552-byte presets, sent in 29 frames.
- **The GP-50's own effects.** On a GP-50 the model picker offers PRE AC Sim, PRE Cry Wah and the CAB AC (Dreadnought) cabinet, and delay and modulation pedals show their *Sync* switch. A GP-5 doesn't show them.
- **Presets across models.** A GP-5 preset written to a GP-50 is converted without loss. A GP-50 preset written or restored to a GP-5 loses its GP-50-only models, and the confirmation lists them first. Restore accepts backups of either model.
- **Valeton GP-200, GP-200LT and GP-200JR support.** Tone Studio connects to the GP-200 family (a GP-200R or GP-200X reports as a GP-200) and runs every screen on it:
  - *Rig*: a flat chain where every block moves, the FX loop's send and return too; CTRL 1–8 assignments per preset; patch settings (EXP 1A/1B/2, Quick Access 1–3, pan, FX loop, drum style, author, note); tempo 40–250 BPM with tap, sent to the pedal live.
  - *Library*: 256 slots (255 on the JR) labelled like the pedal, `01-A` to `64-D`, with 16-character names and *Reset to init patch*. `.prst` files are 1224 bytes; 1176-byte files from older editors open too.
  - *Tones*: 10 SnapTone slots (0–4 play in AMP, 5–9 in DST) and 20 User IR slots of 1024 samples, written over USB.
  - *Device*: the pedal settings of each model and the Global EQ. The MIDI monitor decodes the family's messages.
- **GP-200 effect list.** Valeton's effect names and knob ranges can't ship with Tone Studio. *Device › GP-200 effect list* reads `algorithm.xml` from your GP-200 editor (*Find automatically* in the desktop app, or *Choose file…*) and keeps it on your computer. Without it, effects show as numbers and their knobs can't be edited.
- **Experimental pedal commands.** *Settings › Experimental pedal commands* turns on commands known only from Valeton's software, not yet tried on a real pedal: on a GP-50, EXP settings, live tempo, footswitch and chain changes, reading a slot without selecting it, and deleting, copying and moving presets inside the pedal; on the GP-200 family, the Global EQ. It is off by default; the simulator always has them.
- **Simulated pedals.** *Device › Simulate* offers every supported model, and the browser build opens them with `?mock=gp50`, `?mock=gp200`, `?mock=gp200lt` and `?mock=gp200jr`.
- **A cab IR inside a SnapTone.** When a NAM capture becomes a SnapTone on a GP-5 or GP-50 (Tones or the capture editor), you can pick a cab IR: a downloaded TONE3000 IR or a WAV file. Tone Studio plays the capture through the IR before measuring it, at the dry capture's level, so amp-only captures sound complete where an engaged SnapTone bypasses CAB. Captures that already include the cab (TONE3000 *Amp + cab*, or the file's gear type *Amp + cab* / *Pedal + amp + cab*) offer no cab IR, and neither does the GP-200 family, where CAB keeps playing after the SnapTone.

### Changed
- Texts name the connected pedal (GP-5, GP-50 or a GP-200 model) instead of always saying GP-5. Backups go into `<model>-YYYY-MM-DD` folders (`gp50-…`, `gp200-…`) titled after the model; `backup.json` records it. Diagnostic reports are saved as `valeton-diagnostics-*.txt`.
- SnapTone and User IR links of a tone remember which model they were made on, and the Tones screen only treats a link as "on your pedal" when the model matches.
- The README is rewritten for every supported model: a section on the GP-200 family, a support table for the GP-5, GP-50, GP-200 family and GP-150 (not supported), install notes and the simulators.

### Known limitations
- The GP-50 path hasn't been tried on a real GP-50 by this project yet. Reading, writing and Program Change select on a GP-50 come from drewmerc302/valeton-gp50, which tested them on hardware. Live edits, SnapTone and User IR uploads use the protocol the two pedals share; Valeton Suite 2.1.0's own code sends a GP-50 the same bytes.
- No GP-200, GP-200LT or GP-200JR has been tried by this project yet. The GP-200 family's protocol comes from Valeton's GP-200 editor (static analysis of version 1.8.0); the LT and JR are known only from its code.
- The GP-200LT and GP-200JR are read-only on a real unit until one has been tested: Tone Studio reads them, backs them up and plays live edits, but doesn't write presets, restore, change settings or upload SnapTones and IRs. Whether they have SnapTone slots isn't known yet.
- The GP-200 Global EQ isn't read from the pedal: the panel shows what the pedal reports while connected, over the editor's factory values.
- Tone Match isn't available on the GP-200 family: it proposes presets from the GP-5 and GP-50 effects.

## [0.4.0] - 2026-10-10

### Added
- **In-app updates.** When Tone Studio starts and finds a newer release on GitHub, it asks whether to download and install it. On Windows and with the AppImage, *Download and install* fetches the update, checks it against the SHA-512 published with the release, and restarts into the new version. The progress shows in the dialog, and *Hide* lets you keep working while it downloads. On macOS and with the `.deb`, the dialog offers the release page instead.
- **Safe restarts.** The app never restarts for an update while it is writing to or backing up the GP-5. If the preset has unsaved changes, it asks first. *Later* or *Install when I quit* installs a downloaded update the next time you close the app.
- **Update controls.** *Help › Check for updates…*, the command palette and the About dialog check right away. *Settings › About* shows the version and the update status. It also has *Check for updates automatically* (on by default: at launch and every six hours). Nothing is downloaded until you agree.

### Changed
- Releases also publish `latest.yml`, `latest-linux.yml` and the installer blockmaps, which the app updates from. Each release is created as a draft and only published once every file is uploaded. The workflow stops if the update files are missing or name another version.

### Known limitations
- 0.4.0 is the first version that can update itself. To get it, download it from the Releases page; from 0.4.0 on, the app offers new versions by itself.
- macOS builds aren't signed yet, so macOS can't install updates in place. The app opens the release page instead.

## [0.3.0] - 2026-10-10

### Added
- **User IRs over USB.** Tone Studio writes cab IRs straight to the GP-5's 20 User IR slots, without Valeton Suite, on Windows, macOS and Linux. It works for IR tones from TONE3000, for a `.wav` you drop on the window or open, and for the IR made by Tone Match. The WAV is prepared the way Suite does it: first channel, resampled to 44.1 kHz, 24-bit, first 512 samples (11.6 ms, all the GP-5 keeps). Before you write to an occupied slot, the app shows what you'll replace.
- **TONE3000 app key in Settings.** Enter your publishable key under *Settings › TONE3000 account*. If you change it, the app signs you out. With no key set, Tones links to Settings.
- **Tone Match is easier to find.** It's in the command palette (*Tone match*, *Split a song into stems*), and after a split the stems view shows a *Match the guitar tone* button. The analysis starts as soon as the split finishes.

### Changed
- *Sign in to TONE3000* now signs you in and comes straight back; you no longer have to pick a tone first. *Browse TONE3000* still opens the tone picker.
- Tones opens on the *Trending* list.
- User IR slots are numbered 1–20 everywhere, like on the pedal and in the Rig.
- The Song screen remembers whether you were on Stems or Tone match.
- *Settings › Valeton Suite* is only used to find the SnapTone test signal and for firmware updates, and it's hidden on Linux.
- Builds made locally with `npm run dist` include Valeton's SnapTone test signal when it's in the git-ignored fixtures folder. Published builds still ask for the file once.

### Removed
- The Valeton Suite hand-off for IRs: the *Ready for Valeton Suite* folder, *Open Valeton Suite* and linking the slot after Suite.

### Known limitations
- Overwriting a User IR slot that already holds an IR hasn't been tested on a GP-5 yet. The pedal can't send an IR back, so keep the WAV of anything you replace.

## [0.2.0] - 2026-10-10

### Added
- NAM A2 captures become GP-5 SnapTones (bit-exact with Valeton Suite's renderer).
- Song screen: splits a song into six stems on your computer, and Tone Match proposes a GP-5 preset and a matching IR from the guitar stem.

## [0.1.0] - 2026-10-10

### Added
- Editor and librarian for the Valeton GP-5: Rig, Library, Tones, Device and Settings.
- NAM A1 captures become SnapTones in the app and are written to the pedal over USB (no Valeton Suite).
- TONE3000 sign-in, tone lists and downloads.
- Release builds for macOS (`.dmg`), Windows (NSIS) and Linux (AppImage, `.deb`).

[0.5.1]: https://github.com/grzmol/VLTN-Tone-Studio/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/grzmol/VLTN-Tone-Studio/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/grzmol/VLTN-Tone-Studio/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/grzmol/VLTN-Tone-Studio/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/grzmol/VLTN-Tone-Studio/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/grzmol/VLTN-Tone-Studio/releases/tag/v0.1.0
