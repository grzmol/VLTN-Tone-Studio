# Changelog

All notable changes to VLTN Tone Studio. Versions match `app/package.json` and the GitHub Releases. The release workflow copies the section of the version it publishes into the release notes.

## Unreleased

### Added
- Per-song metronome first-beat alignment, with a position shortcut and reset; preserves beat/bar phase on pause and seek without moving MIDI cues.
- Stage mode with large transport/lyrics, locked seeking and editors, visible MIDI status/Panic, and renewable desktop sleep prevention during playback.
- Whole-playlist preflight with per-entry saved audio, chart, tempo and MIDI warnings, without loading tracks or sending commands.
- Dedicated MIDI scheduler worker with audio checkpoints, advisory cue/channel preflight and bounded timing diagnostics.
- GP-150 performance MIDI profiles, Bluetooth discovery names and shared GP-150 / GP-180 setup presets; existing GP-180 saved settings remain compatible.
- Portable compressed song-library export and restore as new copies, including source audio, stems, charts, lyrics, key/mix settings and ordered playlists, with streaming progress and integrity checks.
- Automatic song-key estimation from guitar with harmonic-stem/original-mix fallback, alternative keys and a saved manual override.
- Song Performance with timed lyrics/chords, MIDI cues, optional MIDI clock, transport input and a remembered metronome that follows song playback. See [Performance](PERFORMANCE.md).
- Saved songs and ordered playlists with local audio/stem storage and automatic sequential playback. See [the song library guide](SONG-LIBRARY.md).
- Remembered MIDI setup presets, pedal channels/command choices and a Show MIDI commands setting that does not affect cue execution. GP-180 presets use the hardware-tested one-time tempo command.
- Standard Bluetooth MIDI connection for performance input/output, with connection lifecycle cleanup and diagnostic counters.
- GP-180 firmware 1.1.1 USB read-only inspection and complete 200-preset backup verified on hardware.

### Changed
- Bluetooth editor management is disabled after GP-180 handshake writes produced no notifications. Use USB for presets and settings; Bluetooth MIDI remains available for performance controls.
- Removed the temporary GP-180 read-only guard and write-unlock switch. USB editor operations are available normally for both GP-150 and GP-180; hardware write validation remains outstanding.

### Fixed
- Failed prepared MIDI workers cannot be reused; missing playback acknowledgement or worker responses trigger MIDI fault cleanup.
- Reset timing counters clears Bluetooth and app timing together without cancelling queued commands. In-flight writes cannot restore old timing measurements.
- Performance MIDI now disarms on gross scheduling interruptions, binds arming to the exact output, preserves BLE note releases across duplicate stop cleanup, rejects cues past the audio end, and avoids echoed Stop feedback. Bluetooth writes time out and discard excessively late queued commands without retrying uncertain delivery.
- Pause/panic releases only channels used for note messages, avoiding unintended GP-180 looper Stop commands from blanket CC64 resets.
- Untimed bracket chords remain visible in the combined reader. Incomplete/empty MIDI tokens now block playback with an error.
- Background lyrics/key changes made during the first song save are retained. Reopening Performance no longer clears the previous key estimate while analysis runs.
- Pausing during audio pre-roll no longer leaves a negative resume offset; remote MIDI Start uses the current song tempo/channel; automatic tempo follows start-position patch recalls.
- Pedal JSON exports use a JSON file filter instead of WAV.
- Bluetooth setup rejects a connection lost while enabling notifications. Unexpected disconnects are reported, and late failures from a closed session do not overwrite a new session's error state.
- Diagnostic reports include Bluetooth availability, state, last session device and GATT/MIDI counts. Missing USB-MIDI port errors no longer name only the GP-5/GP-50.
- GP-180 backups retain the connected pedal model rather than defaulting to GP-150.

## [0.8.1] - 2026-10-21

### Fixed
- **The GP-150, GP-180, GP-200LT and GP-200JR are no longer read-only.** 0.8.0 announced full support, but the app still refused to change their memory on a real unit ("hasn't been tested on one"): presets, names, restores, imports, pedal settings, the Global EQ, SnapTone and User IR uploads were locked. They now write like the GP-5, GP-50 and GP-200. The GP-50 extras and the GP-200 family's Global EQ write stay behind *Settings › Experimental pedal commands*, as the README says.

## [0.8.0] - 2026-10-20

### Added
- **Choose the stem separation model and quality.** The Stem Splitter used to run only Demucs `htdemucs_6s`. It now offers three models: *Standard* (htdemucs_6s, six stems, 285 MB, the default; on the graphics card when it can run it), *Fine-tuned* (the htdemucs_ft bag, four stems with the cleanest vocals, drums and bass, no guitar, 662 MB) and *Best* (htdemucs_ft's drums, bass and vocals with htdemucs_6s's guitar, piano and other, six stems, 782 MB). The fine-tuned files run on the processor only: their export has an op the WebGPU runtime can't place. Splits with them take several minutes. A fine-tuned split has no guitar, so Tone match asks you to split again with a six-stem model. There are three quality presets: *Fast*, *Balanced* (half-overlapping chunks, two averaged shifts, about 3× the time) and *Max* (four shifts, about 6×). Pick them before the split or from *Split again…* on the mixer. The choice is remembered, and the mixer says which model and quality made the stems. The picker shows which models are downloaded, downloads a model's missing files (an interrupted download picks up where it stopped) and deletes a model's files to free disk space.
- **Tone Match builds a SnapTone from your captures.** A new card under Tone match ranks the amp and pedal NAM captures you have downloaded from TONE3000 (or pick one there from the card) against the song's guitar. Each capture plays the guitar part of Valeton's test signal; one without a cab goes through a cab IR designed for this song from its own output, so no recording is needed. The card ranks them by how well their gain and tone match the song's guitar, and says why. *Build the SnapTone* converts the one you choose with that IR inside (GP-5 family). On the GP-200 family it converts the capture alone and offers the IR for a User IR slot. It then waits at the Tones Write step: nothing goes to the pedal until you press Write. The IR can also be saved as a WAV. The ranking is an estimate: the song's mix and the test signal's level move the gain reading, and each capture is heard at the one setting it was captured at.
- **Search TONE3000 from the app.** Tones has a new *Search* tab: type an amp, pedal or artist and narrow the results by gear, NAM architecture, sort order and the format toggle. The search runs in the main process (the query is cleaned and capped, results are cached for ten minutes and a refused request never signs you out); a newer search wins over an older one, and when a search fails it offers the embedded *Browse TONE3000* flow.
- **Tone match refines the amp and the EQ.** A ranked capture is refined offline in the worker: a texture loss and CMA-ES tune the amp's drive and an EQ against the song's guitar, and the proposal now carries that EQ.
- **What's new.** A carousel with screenshots opens once after an update (desktop, and not on a first launch) and from *Help › What's new* and the command palette.
- **The board fits the window, with zoom.** 100% now means *fit*: the pedals are sized from the free space of the board and their real proportions, so a whole GP-200 board fits at 1280×720 and up; below that it crops and scrolls. A map-style bar beside the board zooms from 70% to 200% (also Ctrl + wheel) and remembers the setting. A loupe shows the knob you turn, magnified with its value above it; faders show none.
- **Pedals, amps and cabs that look like the real ones.** About 150 effect models have their own look after the pedal they model: colour, proportions, typeface, jewel LED, footswitch cover, wah treadle and so on (Boss compacts, Tube Screamer, MXR, Rat, Fuzz Face, Cry Baby, graphic EQs, reverbs, delays …). Amp heads follow Marshall, Orange, Mesa, Peavey, Diezel, Vox, Fender and others, with tolex, grille cloth, faceplates and knobs with a printed scale; the cab is a 4x12 stack dressed like its amp. Pedals are joined by patch cables, the board and stage have metal, fabric and wood, and the board scrolls with a brushed-metal slider.
- **Choose the model before the first split.** Opening a song no longer splits it at once: the model and quality choice comes first.

### Changed
- Page titles are one size (32 px) on every screen; Library, Tones, Device, Song, the title bar and the What's new dialog fit narrow and short windows better (icon-only toolbar, wrapping headers, split bar under the model list, tab bar that keeps its tabs).
- Empty states start at the top of their pane, unread Library slots show a dash instead of "Not read yet" 60 times, and empty Tones slots recede.
- Gear drawings no longer use SVG filters or blend modes (grain and metal are pre-rendered images) and the model picker draws its thumbnails only once, so long lists scroll smoothly.
- **Every supported pedal is fully supported.** The GP-150, GP-180, GP-200, GP-200LT and GP-200JR are no longer marked experimental or read-only: Tone Studio reads, writes, backs up, restores, imports, exports and uploads SnapTones and User IRs on all of them.

### Fixed
- **A pedal with one knob has it in the middle, and knobs stay inside a pedal's panel.**
- **A WebGPU device loss in the middle of a split no longer fails the split.** The chunk that failed runs again on WebAssembly and the rest of the split goes on the processor; the session log records it.

## [0.7.2] - 2026-10-15

### Fixed
- **A GP-200LT that doesn't answer User IR name reads connects.** A GP-200LT on firmware 1.6.0 answered the identity query, the settings and the drum state, but never *Read User IR name 1*, so every connection stopped after four tries with "The pedal answered but not like a GP-200LT". Drum state, User IR names, drum style names and SnapTone names are now optional when connecting a GP-200: when the pedal doesn't answer the first entry of a list, Tone Studio stops asking for that list, notes it in the session log ("No reply to User IR names: Tone Studio goes on without it") and goes on reading the presets. The simulator can play such a pedal (`MockGp200` option `silentQueries`, virtual port `--silent 0x1009`).
- **Slots the pedal didn't list are never treated as empty.** User IR (or SnapTone) slots of such a pedal keep their default names ("User IR 1" …) but show *contents unknown* in the slot pickers and on Tones: Tones proposes none of them for a new file, and writing to one shows the same *Replace* warning as an occupied slot. A slot written since then shows the file's name.
- **An upload the pedal confirmed no longer fails afterwards.** When the GP-200 confirms a User IR or SnapTone upload but doesn't answer the name read that follows, the write counts as done (the log notes the skipped read) instead of reporting a timeout. A refused upload still fails.
- "Not like a GP-200" (or GP-5) is only said when no reply identified the pedal. A pedal that identified itself and then stops answering a preset read is reported as "The GP-200LT stopped answering while Tone Studio read it", with the step that failed.

## [0.7.1] - 2026-10-12

### Fixed
- **A GP-200 connects.** Tone Studio waited for the pedal to answer *Read pedal mode* (SOFTWARE_STATE), which a GP-200 in normal mode never does, so every connection stopped after four tries with "GP-200 port found, but it doesn't answer". USB captures of Valeton's GP-200 editor ([phash/gp200editor](https://github.com/phash/gp200editor)) show the pedal names itself in its reply to the identity query. Tone Studio now takes the model from that reply, treats an answer to *Read pedal mode* only as firmware update mode, and resends both together when the pedal says nothing. The simulator no longer answers *Read pedal mode* in normal mode either.
- A connection that fails after the pedal sent anything at all, even a reply nobody waited for, is reported as "A port answered, but not like a GP-200" instead of a silent port held by another app.
- **Splitting a song into stems (and Tone Match) no longer looks stuck when the graphics card can't run the model.** The processor fallback ran on a single thread, about 20 s per 7.8 s chunk, with the bar at 0 % until the first chunk was done; on a laptop a song took tens of minutes. The app window is now cross-origin isolated (COOP/COEP), so the fallback uses up to 8 threads: about 4× faster in our tests. The progress card says whether the model is still starting, or which of the graphics card or the processor runs the split. The session log records the backend, why WebGPU wasn't used, and how long the start and each split took.

## [0.7.0] - 2026-10-12

### Added
- **Valeton GP-150 and GP-180 support.** Tone Studio connects to a GP-150 or GP-180 (told apart by the MIDI port name; USB ids `0186` and `0188`) and runs every screen on it:
  - *Rig*: all 12 modules (PRE, WAH, DST, NS, AMP, NR, CAB, EQ, MOD, DLY, RVB, VOL) in any order; models and knob ranges come built in; footswitches A and B per preset (A, B and C on the GP-180); tempo and volume sent live.
  - *Library*: 200 slots labelled `001` to `200`, 15-character names, *Reset to init patch*. `.prst` files are 1128 bytes, the same file as the GP-180's.
  - *Tones*: 100 SnapTone slots (50–99 yours) and 20 User IR slots, written over USB.
  - *Device*: the pedal settings, the Global EQ and its switch. The MIDI monitor decodes its messages.
  - Tone Match and the simulator (`?mock=gp150`, `?mock=gp180`, *Device › Simulate*).

  The protocol, preset file and effect list come from USB captures of a GP-180, published by [Valeton-GP180-Rev-Eng](https://github.com/majabojarska/Valeton-GP180-Rev-Eng) (GPL-3.0); the GP-150 speaks the same protocol. The effect list is generated by `app/scripts/gp150-catalog-from-gp180-re.mjs`. Neither model has been tested by this project yet, so Tone Studio doesn't write to their memory (presets, names, settings, Global EQ, uploads). Reading, backups and live edits work.
- **Your own NAM captures from Tones.** *Tones › Add NAM from disk…* (or a `.nam` opened or dropped while Tones is showing) turns a capture on your computer into a SnapTone and writes it to the user slot you pick: Tone Studio checks the file (A1 or A2), proposes a name from the capture's own metadata and the first empty slot, and offers a cab IR on the GP-5 and GP-50. Nothing is linked to TONE3000, and nothing changes on the pedal until you press Write.

### Known limitations
- GP-150 and GP-180: the expression pedal and knob 1–3 assignments of a preset are kept but can't be edited, and NAM files can't be uploaded. The checksum in their `.prst` files is cleared when Tone Studio changes a preset, which the pedal is reported to accept. External footswitch functions other than *Patch +* and *Patch −* show by number. The GP-150's USB id comes from driver databases, not from a unit.

## [0.6.0] - 2026-10-12

### Added
- **Session log.** Tone Studio logs every connection step, connection and request error, change in what the host sees (USB, driver, interfaces, Valeton apps), long job, and every MIDI message with its decoded text and all bytes in hex. It doesn't depend on the MIDI monitor being on. The desktop app writes it to `logs/` in its data folder: 4 MB files, the newest 20 MB kept. The browser build keeps it in memory for the tab. *Device › Diagnostics › Session log* saves it as one file (*Save log*) or opens the folder. The diagnostic report says where it is. The log includes the presets read from and written to the pedal.
- **Tone Match on the GP-200, GP-200LT and GP-200JR.** The proposal picks the same amps, drive, EQ, delays and reverbs from the GP-200 effect list, switches WAH off and leaves the VOL pedal alone; the audition plays it through live edits and the IR match records the pedal's USB audio, as on the GP-5 family. The cabinet comes from the amp's Auto CAB Match when an imported list has it, else from a matching GP-200 cab by name. Not tried on a real GP-200 yet.

### Fixed
- **GP-200 connection diagnostics on Windows.** The *Driver* row shows the driver Windows bound to the GP-200's MIDI interface (MI_03), or the USB MIDI 2.0 fault, instead of a false "No driver is bound". A driver other than *USB Audio Device* (such as Valeton's ASIO driver) is a warning. Models whose MIDI interface isn't measured (GP-200LT, GP-200JR) are found by USB class, and say "Couldn't tell" rather than warn when that fails.
- **Valeton's GP-200 editor is detected.** When `GP-200.exe` (or `GP-200.app`) runs, the header, *Exclusive access* row and banners say it holds the port. Texts for a GP-200 never ask to close Valeton Suite.
- A silent port on the USB MIDI 2.0 driver opens the driver guide. Otherwise the note lists what can hold the port on Windows, browsers with a MIDI page included; the browser build also points at `chrome://flags/#use-winrt-midi-api`.
- The Windows 11 guide covers Valeton's ASIO driver and ends with a restart when the old driver sticks.

### Changed
- The diagnostic report lists the USB interfaces of Valeton devices (driver, name, MIDI class) and which Valeton apps run.
- **The GP-200 effect list is built in.** Effect names and knob ranges for the GP-200, GP-200LT and GP-200JR come with the app, so blocks show their models and knobs as soon as the pedal connects. Importing `algorithm.xml` from Valeton's GP-200 editor is now optional: it adds units, Auto CAB Match and exact menu values, and *Use the built-in list* goes back. The simulator's generated presets use the list's models and defaults.
- **Tone Studio is licensed under GPL-3.0.** The built-in list is generated from [kabir0st/gp200-studio](https://github.com/kabir0st/gp200-studio) (GPL-3.0) by `app/scripts/gp200-catalog-from-studio.mjs`.

### Known limitations
- The built-in GP-200 list has no units, no Auto CAB Match and plain 0, 1, 2… menu values (the Empire OD *Mode* may need the imported list to send the right value). Drives and boosts are listed in both PRE and DST, and Auto Swell, Hold and Freeze in both PRE and MOD; Hammy only in PRE.

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

[0.8.1]: https://github.com/grzmol/VLTN-Tone-Studio/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/grzmol/VLTN-Tone-Studio/compare/v0.7.2...v0.8.0
[0.7.2]: https://github.com/grzmol/VLTN-Tone-Studio/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/grzmol/VLTN-Tone-Studio/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/grzmol/VLTN-Tone-Studio/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/grzmol/VLTN-Tone-Studio/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/grzmol/VLTN-Tone-Studio/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/grzmol/VLTN-Tone-Studio/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/grzmol/VLTN-Tone-Studio/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/grzmol/VLTN-Tone-Studio/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/grzmol/VLTN-Tone-Studio/releases/tag/v0.1.0
