# Performance

Play a song or a whole set from one screen: stems, a metronome, lyrics and chords, and timed MIDI commands for your GP-150 or GP-180 and the pedals behind it.

- [Prepare a song](#prepare-a-song)
- [Multitrack import](#multitrack-import)
- [Audio outputs](#audio-outputs)
- [Speed and pitch](#speed-and-pitch)
- [Lyrics and chords](#lyrics-and-chords)
- [MIDI cues](#midi-cues)
- [Pedal commands](#pedal-commands)
- [Bluetooth](#bluetooth)
- [Sections](#sections)
- [Playlists](#playlists)
- [Gapless and crossfade](#gapless-and-crossfade)
- [Generated drums and bass](#generated-drums-and-bass)
- [Stage mode](#stage-mode)
- [Troubleshooting](#troubleshooting)
- [Limits](#limits)

## Overview

Open **Song → Performance**. It needs audio loaded in **Stems**; splitting into stems is optional. After a split, Performance plays the stems together with a mute switch and volume slider for each one.

The play controls, tempo and metronome stay at the top. Under them, choose a view:

- **Play**: the sections, the mixer and the lyrics and chords reader. This is what you need on stage.
- **This song**: speed and pitch, trim and fades, key, loudness, imported tracks, generated drums and bass, sections, and the song's MIDI trigger. These are saved with the song.
- **Lyrics & chords**: lyrics from the vocals, the chart editor and chords from the stems.
- **MIDI**: the MIDI check, the controller setup, and the song's MIDI file and cues.
- **Setup**: audio outputs, the audience display, band sync, remote control and loading songs from MIDI. These apply to every song.

The view you used last opens next time. Longer explanations sit behind **How this works**, and the cards in **Setup** and **MIDI** fold away with the arrow beside their title.

Everything here works in the desktop app. The browser build can play a song and send USB MIDI, but has no song library and no sleep prevention. Saved songs, backups and playlists are covered in the [song library guide](SONG-LIBRARY.md). To have an assistant map a song's sections, drums, bass and timing, export a song brief and import the reply: see the [song map guide](SONG-MAP.md).

## Prepare a song

1. Load the audio in **Stems** and split it if you want the stems.
2. Set **Song BPM** to the recording's tempo while stopped. The metronome, count-in and tempo commands start from it, and [speed](#speed-and-pitch) scales that tempo during playback. The app detects a tempo when a song is first analysed. **Detect** beside the BPM finds it again, and offers the half or the double when the beat was counted wrong. When the tempo was set by hand, tapped or taken from the chart, **Find the beat at N BPM** finds the beat again from the number you set, so the click lines up with the recording: the tracker refines it within 4% of your number. Tick **Keep exactly N** to keep the tempo as typed and find only where the beats fall. **Undo** puts back the tempo, the beat grid and the sections. The Band panel's **Find the beat** starts from your tempo too, with **Use my tempo** on by default.
3. Add lyrics, chords and MIDI cues (below).
4. Enter a title and artist and choose **Save song to library**. Use **Save song changes** after later edits.

**Key.** The song analysis estimates the song's major or minor key from its harmony (the chord stem, or the guitar, piano and other stems together, or the mix), with its bass and the chords it found, after the chords. A key and its relative (the other mode on the same notes) that are close are decided by the first and last chords and the bass. The chords can also show a Mixolydian or Dorian flavour, which the readout names, such as "G major (Mixolydian)". A section that is clearly in another key is listed under the readout, such as "Last chorus: A major". The Performance panel's own estimate reads one stem (guitar first, then the other stems, then the original mix) and shows **Unknown** rather than guess. Use **Key override** to save a correction. The key only changes how chords are displayed, never the audio or any MIDI.

**Sections.** The analysis suggests a song's sections on its bar lines: intro, verse, chorus, bridge, solo and outro. It reads them from the chords, loudness, vocals, drums and bass. Verses and choruses that share chords and vocals are still told apart. A middle section where the bass drops out is a bridge, a loud section that does not repeat is a chorus, and a last section without drums is an outro. Bars run on to the end of the song, so an outro is found. Songs analysed before this release have the old sections, so press **Analyse again** on them to get the new ones.

**Metronome.** Choose **Off**, **While stopped** (a rehearsal click on the grid), **While playing** or **Both** from the **Metronome** menu. The choice is saved for each song and starts from the last one used. To line it up with a recording that has an intro, pause on the first downbeat and choose **Metronome settings → Set first beat here**. Fine-tune with **First beat (seconds)**, or **Reset first beat**. The grid is fixed, so it cannot follow a recording that speeds up or slows down. It does not move lyrics or MIDI cues.

**Count-in, pre-roll and start delay.** In **Metronome settings**, a count-in of one or two bars clicks before the audio starts, and a pre-roll starts the audio a few beats before the current position so you can re-enter a passage. A start delay of up to 10 seconds comes before both; press Play again while it waits to cancel. The count-in, pre-roll and start delay are saved for each song. A song without its own value uses the global default, set under **Defaults for songs without their own** in **Metronome settings**. **Click sounds.** **Sound** next to **Metronome** picks what the click sounds like: the click, sticks, a closed hi-hat, kick and hat (kick on the first beat) or ride. The count-in has its own sound menu, set to the metronome's sound by default, so you can rehearse on the click and count the band in on sticks. The sounds come from the band's drum samples and play through the click output. Each song keeps its choice, and a song without one uses the default under **Defaults for songs without their own**. **More click sounds.** The **Sound** menus are grouped. **Click** has the click, a cowbell and a woodblock, which are made by the app. **Drummer** has sticks, pedal hat, hi-hat, open hat, ride and snare. **Patterns** change the drum on the beat: kick and hat; rock, with the kick on 1 and 3 and the snare on 2 and 4 (in other meters the kick on 1 and the snare on the rest); toms from high to low across the bar, staying on the low tom after the third beat; and a crash on one with a closed hat after it. Press **Listen** beside a menu to hear one bar at the song tempo through the click output without starting the song. **My samples** plays your own sounds: in **Metronome settings → My samples** load one file for the **Downbeat** and one for the **Other beats** (WAV, FLAC or MP3, at most 2 seconds; a longer file is cut with a notice). Bounce a single hit from your drum plugin and load it. The files are copied into the app's data folder, so they stay after a restart, and an empty slot uses the click. **Send the click as MIDI.** Also in **Metronome settings**, tick **Send the click as MIDI** and choose an output (turn on USB / system MIDI first). Each beat goes out as a drum note on channel 10, or the channel you pick, at velocity 100 on the downbeat and 80 on the others, with a note-off 50 ms later. The note follows the sound (37 sticks, 44 pedal hat, and so on; the click and your own samples send the side stick). Use a virtual port, for example the IAC driver on a Mac, to feed a drum plugin in another app; the app does not host plugins. **Offset (ms)** moves the notes by −100 to +100 ms to make up for the other app's delay. **Also play the click here** keeps the built-in sound on while the MIDI click is on. The MIDI click uses its own output and does not need **Send cues**; it is never sent to the cue output unless you choose that one. Its notes are timed by the same MIDI scheduler clock as cues. The count-in shows as a countdown on the beat light, and the stage view can flash its edge on each beat.

**Tap tempo.** Press **Tap tempo** or the **T** key to set the Song BPM by tapping. It averages the last four taps, and a pause of two seconds starts again. Taps set the BPM only while stopped. The beat light next to the transport shows song beats, not count-in beats.

## Multitrack import

Add tracks beyond the split stems. **Add tracks…** picks audio files, **Add folder…** takes the audio files in a folder, and dropping audio files onto the panel works too. A song can hold up to 32 imported tracks, each with its own row in the mixer. They are saved with the song, so choose **Save song changes** after adding them.

Name a file to set its options before it imports. Options go in brackets or parentheses, and a leading track number is dropped:

```text
01 Keys L [bus=Aux1] (color=blue) (group=1,2).wav
```

- `bus=` is `Main`, `Click`, `Aux1` or `Aux2`.
- `gain=` is 0 to 2, and `pan=` is −1 to 1.
- `pitch=yes` or `pitch=no` sets whether the track follows pitch.
- `group=` lists mute groups 1–6, separated by commas.
- `color=` is a colour name or a `#rrggbb` value.

An unknown or bad option is ignored, and the file still imports with its defaults.

**Lengths.** Each track is compared with the median length of the set:

- within 0.5 s, it is padded with silence and nothing is shown;
- from 0.5 s to 5 s, it is padded or cut, and the app tells you;
- more than 5 s out, it is refused.

**Track settings.** Each track in the mixer has gain, pan, solo, mute, a bus, **Follows pitch** and mute groups 1–6. Unmuting or soloing a track in a group mutes the other tracks in that group. A track whose name contains *click*, *metronome* or *guide* starts on the **Click** bus and does not follow pitch. At a speed other than 100%, a click track is still stretched, and a notice says so.

**Loudness.** **Normalise song volume to −14 LUFS** measures the song once, in the background, then applies one gain to every track. The gain is at most +6 dB, and never so much that the song's peak goes above −1 dBFS. Load the song before you turn it on.

**Similar songs.** **Apply track settings to similar songs** copies this song's track settings to saved songs whose imported tracks have exactly the same names, in the same order. No audio is copied.

**Limits.** Adding tracks is disabled while a song or playlist plays, and the panel says "Stop playback to add tracks." If a track's file cannot be read when the song loads, that track is skipped with a notice, and the song plays on without it. Files over 300 MB, tracks longer than 15 minutes, and imports that would pass 1 GiB of decoded audio are refused. Folders go through **Add folder…**; dropping a folder onto the panel is not supported.

## Audio outputs

Open **Audio outputs** in Performance to choose where each bus goes. There are four buses: **Main**, **Click**, **Aux 1** and **Aux 2**. Each has an output pair, a gain and a **Test** button that plays a short tone on that bus alone.

- **Main device** carries the main mix. The pairs offered come from its channel count, such as 1–2 or 3–4.
- **Click device** is **Same as main** by default. Pick another device to send the **Click** bus to outputs 1–2 of that device. Only one separate click device is supported.
- Each track's **Bus** choice in the mixer decides which bus it plays through.

Devices and layouts are remembered on this computer. A change re-routes the playing song without stopping it. If a saved device is missing or no longer has the channels, that output falls back to **System default** and a warning stays on screen. A device change that leaves the chosen device and layout as they were does not re-route anything.

## Speed and pitch

Use **Speed & pitch** in Performance.

- **Speed** runs from 50% to 150%. It applies when you release the slider, and resetting returns it to 100%.
- **Pitch** shifts by up to ±6 semitones, with a fine tune of ±50 cents.
- **Follows pitch** is set per track in the mixer. A track with it off gets the speed change only, so it keeps its pitch. Drums start off.
- **Apply pitch to chords** transposes the chord names in the reader by the pitch.
- **Capo** sets the fret. The reader shows the chord names and shapes as played with a capo. It changes the chords shown, not the audio.
- **Plays at N BPM** shows the effective tempo. The metronome, count-in and tempo commands use it. **Song BPM** stays the recording's tempo.

**Changes while playing.** Speed and pitch are rendered in the background, and **Rendering…** shows how many tracks are done. The current audio keeps playing. The new version starts on the next beat, at the same point in the song. A change made during a render replaces it. While stopped, changes apply at once. MIDI cues keep their song time, and MIDI clock follows the new tempo.

**Limits.** The stretch uses SoundTouch, an open-source library under LGPL-2.1, and is not yet tested on hardware. In a test on click trains, the median error was 1 to 4 ms and the worst was about 8 ms, so not every click lands within 5 ms. A transient can be dropped at extreme settings; in the test this happened at 125%, 150% and −3 semitones. The shorter analysis windows used for alignment can sound rougher on low notes than the defaults. The built-in metronome is not stretched: it runs on the effective tempo. A render briefly holds a second copy of a long song in memory, and changes swap only at beats, not bars.

## Lyrics and chords

Lyrics from the vocals are made by the analysis after a split, with the model chosen under **After the split** on the Stems tab, and are not started when this panel opens. The buttons below make or redo them: **Generate lyrics from vocals** for a song with none, and **Transcribe again** for a chart that the performer has not written.

The reader shows the lyrics with the chords above them and follows playback. Turn **Follow playback** off to scroll freely, use **A− / A+** for text size, or **Expand performance view** for a larger reader with transport buttons. Click any chord for guitar tabs in standard tuning (`x` is muted, `0` is open); they follow the displayed transposition.

To edit, choose **Edit chords, lyrics & MIDI**. Each row has a time, chords, lyrics, MIDI commands and an optional label. Playback pauses while you edit, and invalid MIDI is rejected when you save. You can also paste or import TXT, LRC or bracket-chord text under **Separate lyrics and chart editors**, and export the chart.

The chart text box under **Separate lyrics and chart editors** has search and undo. Cmd+F (Ctrl+F on Windows and Linux) opens search, and Cmd+H (Ctrl+H) opens the same panel with its replace field. F3 or Cmd+G finds the next match, Shift+F3 or Shift+Cmd+G the previous, and Escape closes the panel. Cmd+Z undoes; Cmd+Shift+Z redoes on a Mac, and Ctrl+Y on Windows (Ctrl+Shift+Z on Linux). Timestamps, chords, headings, `//` comments, colour tags, MIDI commands, `$CODE` macros and `{chase}`, `{nochase}` and `{label:…}` each have their own colour. The editor loads when you first open it. While the text box has focus, remote keys do not run, so typing a letter never triggers a remote action.

Give every line a timestamp so it follows playback:

```text
[00:00.00] [C]**Verse**
[00:12.50] [Am]Words here {midi:pc 1 0}
[00:24.00] [F]Chorus {midi:cc 1 64 127}
```

Untimed lines stay visible for manual reading. `**bold**` and `*italic*` work. A line that starts with `# ` is a heading, such as `# Chorus`, and shows as a label. A `// …` comment is for the editor and is not shown on stage. `{color:red}…{/color}` colours a span: red, amber, green, blue or violet. Transposing changes chord symbols (slash basses included) but not the audio. Chords are spelled with flats or sharps by the song's key, so a song in Bb shows Bb and not A#. Set the key under the song's details in the library.

**Autoscroll.** With **Follow playback** on, choose how the lyrics move:

- **Line by line** keeps the last timed line that has started at the reading position.
- **Between timed lines** moves smoothly from one timed line to the next, for a chart where only some lines have timestamps.
- **Constant speed** moves at **Lines per minute**, so untimed lyrics can scroll too. **Fit to song length** sets the speed so the last line lands at the end of the song.

The lyrics follow the song's position, so a speed change, a section jump or a loop is followed. Scrolling by hand, with the wheel, the touch pad or the page keys, or a remote scroll, pauses autoscroll for six seconds, then the lyrics return to the song position. The style and speed are kept on this computer.

**Importing ChordPro or chords above lyrics.** Under **Edit chords, lyrics & MIDI**, the import panel reads pasted text or a `.cho`, `.chordpro`, `.pro`, `.crd` or `.txt` file. ChordPro directives become the song's title, artist, key, tempo, capo, duration and year, and sections become headings. Chords above lyrics are merged into the lyric line below, at the column where they were typed. The summary lists the format, the song details it found, and each line it did not take as written, with its line number. Directives the app does not support are kept as `//` comments, so nothing is lost silently. Only the first song in a file is imported. **Replace chart with this import** writes the chart and applies the key and year to the song and the tempo and capo to the performance. The title and artist are shown but not changed.

An import replaces the chart, so it is refused during playback, and when the chart has MIDI commands or triggers. Remove those in the editor first, so they are not dropped without you seeing it. Imported text has no timestamps, so it is read as untimed text: it has no MIDI cues and no timed lines until you add timestamps in the editor.

**Automatic drafts.** After a split, Performance estimates chords from the guitar, piano and other stems together (from the mix when the song is not split), and, when the song has none, transcribes lyrics from the vocals with a local Whisper model. Choose **Lyrics language** first if you know it. The first run downloads the model; nothing is uploaded. Chord estimates name major, minor, power (5), seventh, major seventh, minor seventh, sus2, sus4, diminished and augmented chords, with a slash bass (C/G) when the bass clearly plays another chord note. They change on the beats of the song and lean towards its key. Treat both as drafts and check them before you play, because dense mixes and backing vocals cause mistakes. Anything in your own chart takes priority over a draft.

## MIDI cues

A cue is a MIDI message sent at a time in the song. Write them in the chart as `{midi:…}` tokens, or build them with **Song MIDI cues**. A cue can also fire at the start of a song section, such as every chorus, instead of at a time ([Cues on a section](MIDI-PEDALS.md#triggers-macros-and-song-midi-files)).

| Token | Message | Notes |
| --- | --- | --- |
| `{midi:pc ch n}` | Program change | Channel 1–16, program 0–127. |
| `{midi:cc ch n v}` | Control change | Controller and value 0–127. |
| `{midi:note ch n v}` | Note on | Needs a matching `off` later. |
| `{midi:off ch n 0}` | Note off | |
| `{midi:sysex F0 … F7}` | System exclusive | Hex bytes. |

Empty or incomplete tokens are rejected instead of being dropped silently.

To send cues, pick an output, then switch on **Send cues**. This is called arming. Send cues is remembered on this computer for the output you switched it on for, not with a song: it stays on for every song, tab and restart until you switch it off or press **Disarm**, and the Performance MIDI summary says "(remembered)" when the app armed itself. Only that output is armed. Choosing another output disarms, and you switch Send cues on again for the new one.

- Pause, seek, leaving the Song screen or changing the output clears anything queued. Switching to another Song tab does not.
- Seeking pauses; pressing Play starts cues from the new position. Earlier cues are not played as cues, but the pedals are brought to the state they would be in: just before the song starts, the app sends the latest bank select and program change for each channel, then the latest value of each controller. It does the same if a stall drops a patch or controller change.
- Looper, tap tempo, footswitch and similar trigger controllers are never replayed this way. The app skips the fixed trigger numbers, and any controller that a pedal's trigger commands use on its channel once the CC is assigned in the pedal picker (see [MIDI pedal command presets](MIDI-PEDALS.md)). Notes and clock are not replayed either, and SysEx is replayed only when the cue has `{chase}`.
- Add `{chase}` to a cue to always replay its commands, or `{nochase}` to never replay them. Cues built from a pedal's trigger commands get `{nochase}` automatically. Preflight warns about a controller that is pressed and released within half a second without `{nochase}`. It also warns about a raw controller that would be replayed on a pedal channel whose trigger CCs are not assigned yet, because the app cannot tell it from a trigger: assign the CCs, or add `{nochase}`.
- The state is sent 100 ms before the audio position it belongs to when playback is scheduled ahead, such as a planned jump. A start from a position sends the state as soon as the schedule begins, so it does not yet lead the audio by 100 ms.
- Removing the port disarms.
- Cues past the end of the audio are not scheduled.
- Messages due together in a cue go to the other pedals first, because the GP-150 / GP-180 pauses briefly while it changes patch and would hold them.

**MIDI preflight & timing** (collapsible) lists cues beyond the audio, conflicting or dense commands, missing note-offs and channel clashes. Warnings are advice; they never change or disable a cue. The app cannot read a pedal's receive channel, so check those yourself.

### Tempo and clock

For the GP-180, send the tempo once and let the pedal generate the clock. Apply the **GP-150 / GP-180 + pedals** setup preset (below), or add **Valeton GP-180 → Set tempo (BPM)** at time zero. On the pedal, set Clock Source to Internal and TRS clock output to On. Update a saved tempo cue by hand if you change the Song BPM. The preset uses the current BPM (40–300) automatically.

**Send MIDI Clock** (24 pulses per beat, with Start and Stop) is available for receivers that handle it, is remembered per song, and is switched off while automatic tempo is on. It was not stable on the tested rig, see [Hardware results](#hardware-results). Do not route output back into an input.

External **Start/Continue/Stop**, or CC 80 with a value of 64–127 on any channel, plays and pauses the song. These are default bindings, so you can change them under [Remote control](#remote-control). A GP-180 MIDI footswitch can send CC 80.

### Setup presets

Choose one under Performance and apply it:

- **GP-150 / GP-180 + pedals** (Bluetooth or USB): sends the song BPM once on playback start, with the clock left off. The tempo goes on channel 16 by default; match the pedal's receive channel, or OMNI.
- **MIDI commands only**: plays saved cues with no automatic tempo or clock.
- **Continuous clock**: turns on song MIDI clock.

The app remembers port choices, the preset, the selected pedal and command, pedal channels and assigned CCs on this computer. Bluetooth always needs a manual connection. **Show MIDI commands** hides or shows cue markers and the builder without affecting playback.

## Pedal commands

**Song MIDI cues** has named commands for the Strymon TimeLine, BOSS RC-10R, IR-200 and SY-200, and the GP-150 and GP-180. Choose the pedal, its receive channel and a memory or function, then **Add pedal command** to save it in the chart or **Send pedal command now** to test it. Search by memory number or function. Bank select is added where a pedal needs it, and **Raw MIDI command** is always available.

The channel you pick addresses the pedal; it does not change the pedal's own setting. Starting channels are TimeLine 1, RC-10R 2, IR-200 3 and SY-200 4, and your saved choices take precedence. BOSS assignable controls need the matching **Assigned CC** from the pedal. For the full list of profiles, community pedals and custom JSON, see [MIDI pedal command presets](MIDI-PEDALS.md).

Exported charts carry readable labels and the MIDI messages, so another computer can play the chart without your pedal profiles.

## Bluetooth

Bluetooth MIDI carries performance cues, transport input and clock. If the link drops, the app shows "Reconnecting… (attempt n)" and retries by itself (after 0.5, 1, 2, 4 s and so on, up to 30 s between attempts) without asking you to pick the device again. Choose **Stop reconnecting** to give up. After it reconnects the song stays disarmed: check the pedal, rearm and choose where to resume. Bluetooth editor management is off, so use USB to read or write presets and settings. Bluetooth audio and Bluetooth MIDI are separate services.

To send cues from Performance to a GP-180 and on to pedals on its MIDI OUT:

1. Open **Performance MIDI controller**, choose **Connect Bluetooth MIDI** and pick the pedal's MIDI service. This also selects it as the output.
2. On the pedal, set **MIDI IN Source** to **BT Only** or **Mixed**, and set **EXP/FS jack 2** to MIDI OUT. Set each downstream pedal's channel and check the GP-180's channel filtering.
3. In **Song MIDI cues**, add a command with its time, channel and PC or CC.
4. Switch on **Send cues** and use **Send MIDI now** to check the pedal responds. A finished write does not prove the message came out of the MIDI OUT.
5. Play the song.

Valeton's documents do not clearly describe Bluetooth-to-TRS forwarding, so test your own rig. A pedal's Bluetooth service must be a standard BLE-MIDI service. Keep the pedal's phone app disconnected and the pedal nearby.

### Hardware results

All results are from a GP-180 (firmware 1.1.1) with a Strymon TimeLine on its MIDI OUT. GP-150 has not been tested on hardware.

| Date | Test | Result |
| --- | --- | --- |
| 21 Oct 2026 | USB inspection and full 200-preset backup | Passed. |
| 26 Oct 2026 | USB editor writes (GP-180, firmware 1.1.1) | Passed. |
| 21 Oct 2026 | Bluetooth editor handshake | Connected but no replies, so editor use over Bluetooth is disabled. |
| 22 Oct 2026 | Timed patch changes over Bluetooth, 15 → 16 → 13 | Passed. The TimeLine followed, and a seek did not replay cues. |
| 22 Oct 2026 | One-time tempo command (120 and 141 BPM) over Bluetooth | Held steady on both pedals. |
| 22 Oct 2026 | One-time tempo command (90 and 120 BPM) over USB | Held steady on both pedals. |
| 22 Oct 2026 | Continuous clock over Bluetooth | Failed: large tempo jumps. |
| 22 Oct 2026 | Continuous clock over USB | Failed: drift of about 3 BPM (119–122 at 120). |

The rig had the GP-180 receiving OMNI and the TimeLine on channel 1, so tempo on channel 16 reached only the GP-180. To keep downstream program changes from recalling GP-180 patches, consider setting the GP-180 to receive on 16 as well; that has not been confirmed on hardware.

## Sections

Name the parts of a song on the waveform in the section editor: start and end times snap to the beat when a tempo is set, and each section has a mode for its end:

- **Continue:** play on. **Repeat once:** play the section twice. **Loop until released:** repeat until you release it. **Skip:** jump over it. **Pause at end:** stop there.

While playing:

- **Tap a section** to arm a jump to it. The strip shows when it will land, and **Cancel jump** stops it before then.
- **Double-tap a section** to jump now. The jump lands after the MIDI lookahead (about 120 ms over Bluetooth, 0.2 s over USB), so cues already queued still belong to the passage being left.
- **Loop** repeats the current section until you tap **Exit loop**. The current pass finishes, then the song moves on. A release within the last 150 ms before the end of a pass takes effect after that pass.
- **Save as default** writes live loops and releases into the sections' stored modes. Other live changes are not saved.

Jumps and loops keep the metronome on its bar grid and keep MIDI clock running; cues in a skipped section are not sent. In Stage the sections replace the seek bar, and seeking stays locked. A section that does not start or end on a bar line is flagged in preflight, because a loop there lands off the beat.

## Playlists

Under **Song → Songs & playlists**, make a playlist from saved songs. Entries can repeat, and edits save at once. Choose **Check playlist** to review every entry before the set (it reads saved songs, so save first), **Load set paused** to prepare, or **Play playlist** / **Play from here** to go.

A playlist can be split into headed sets, and a smart playlist picks its songs by rules; **Play set** plays one set and stops at its end. The queue shows and edits what plays next without changing the song that is playing. See [Song library](SONG-LIBRARY.md#playlist-sets-and-smart-playlists) and [Queue](SONG-LIBRARY.md#queue).

The set loads and starts each next song, then stops after the last one. Performance shows the position, the next title, **Previous song / Next song** and **Stop playlist**. Each next song loads in the background while the current one plays, so most joins are gapless. See [Gapless and crossfade](#gapless-and-crossfade).

Switching to another Song tab keeps the set playing and its queue editable. While Performance is hidden, only transport and song keys work; other keys, such as Page Down and the arrows, are left to the page. Leaving the Song screen pauses the set.

An armed MIDI output stays armed across songs while the same device stays connected, and Send cues re-arms itself when that output reconnects. For cues from the first second, choose **Load set paused**, connect and switch on **Send cues**, then press **Play playlist** in Performance. Starting a playlist again from the library arms the same remembered output.

Before a set:

1. Save each song with its audio, chart and BPM, and check any draft lyrics and chords.
2. **Load set paused**, connect the output, apply the setup preset and check each pedal's receive channel.
3. Read **MIDI preflight & timing** per song and **Check playlist** for the set.
4. Arm with **Send cues**, then play.
5. After a disconnect or timing fault, pause, check what the pedals are actually set to, reconnect, rearm and choose where to resume.

Finish analysis and backups before you start. Heavy work during playback can hurt timing.

## Gapless and crossfade

While a song plays, the next one in the playlist loads in the background. If it is ready in time, the join is gapless: the next song starts on the same clock, with no silence. If it is not ready, the set plays a short gap and shows a notice.

- **Crossfade (s)** in the playlist controls sets how long the outgoing song fades out while the next fades in. It runs from 0 to 10 seconds, and 0 gives a gapless join with no overlap. The setting is kept on this computer.
- **Crossfade to next** starts the next song now and fades this one out over the crossfade length. It needs the next song to be loaded.
- A count-in on the next song turns the crossfade off. Its clicks start when the outgoing song ends, and the audio follows.
- The next song starts at its trimmed start. Pre-roll does nothing across a join.

For each song, the **Song shape** controls in the Performance setup set how it starts and ends:

- **Trim start (s)** and **Trim end (s)** cut the ends of the song. **Auto** trims to the audible part above −60 dBFS, and **Clear trim** removes both values.
- With **Trim start** empty, the song skips the silence the song analysis found at its start, and the field shows how much. Set it to 0 to play from the very start of the file.
- **Fade in (s)** and **Fade out (s)** run from 0 to 10 seconds. A change applies from the song's next start, not mid-play.
- **At the end** chooses what follows: **Play the next song**, **Stop the playlist**, which pauses the set at that song's end, or **Loop the song**, which repeats it without moving on.

Trim changes while a song plays move its stop at once. Looping jumps back to the trimmed start a second before the end, so the loop has no gap. Sections are cut to the trimmed range, and preflight warns about cues or sections outside it, which will not play.

## Practice mute

To play along with a playlist, mute your own instrument once and every song comes up without it. Open **Practice mute** on the Play tab (next to the mixer) and tick **Guitar**, **Vocals**, **Bass**, **Drums**, **Piano** or **Other**. It applies to every song that loads: by hand, in a playlist, from a song trigger, and the next song across a gapless join, which is muted before it starts, so the instrument is not heard for a moment at the join.

- **What a kind covers.** A split stem counts as its own kind. The generated drums and bass count as drums and bass. An imported track counts by its name: "guitar" or "gtr", "vocal" or "vox", "bass", "drum", "piano" or "keys". If a name is wrong, choose **Counts as** on the track's mixer row (a kind, or none).
- **Songs keep their mix.** The practice mute is never saved into a song. Each muted row shows a **Practice** badge, and each song's own mute, solo, volume and pan are exactly as you left them when you turn the practice mute off. Unticking the muted row's checkbox turns that kind's practice mute off.
- **A song with no split** has nothing to mute by instrument (it plays as one track), so it plays whole and the banner says so.
- **The banner.** While any kind is muted, the Performance tab and stage mode say "Guitar muted in every song" with an **Unmute** button.
- **Hands free.** In **Edit remote control**, the **Practice** group has **Practice mute: guitar** (and the other kinds) and **Practice mute: all off**. Bind them to a footswitch, a key or a page-turner. A short notice says "Guitar muted in every song" or "Guitar back on". These keys also work while another Song tab is showing.
- Changing it during a song fades the track out or in with the normal mute ramp. The song does not stop.
- It is kept on this computer and comes back after a restart.

## PDF charts

A saved song can show a PDF (a lead sheet, chord chart or score) instead of its text chart. Choose **Attach PDF chart** in the reader, or **Replace** or **Remove** to change it. **Show PDF chart** and **Show text chart** switch between the two for that song. The PDF is stored in the song's library entry and goes into backups. The app never changes the PDF itself. A PDF over 50 MB is refused with a notice.

- **Scroll** shows the pages one under another at the width of the reader. **Page** shows one page at a time, or two side by side on a wide screen. **Previous** and **Next** turn pages.
- **Annotations** are a pen, a highlighter and text notes, in four colours. **Undo mark** removes the last mark on the page, and **Clear page marks** removes them all. They are saved with the song, and they survive a restart and a backup. Marks are kept as positions on the page, so they fit any zoom.
- **Page turns**: while the song plays, a page turn at a song time moves the PDF to the next page. Press **Turn page at this time** at each turn while you rehearse, and **Clear page turns** to start again. Follow playback switches this on and off.
- A PDF that cannot be read shows an error with a **Show text chart** button. The lyrics view stays available.
- A remote page action turns the PDF page when a PDF is on screen, and scrolls the lyrics otherwise. In stage mode a page action turns half a page in a scrolling PDF.

## Remote control

Every live action can run from a MIDI message on the selected input, from a key, or from a Bluetooth page-turner, which sends keys. Choose **Edit remote control** in Performance to see each action with its bindings.

The defaults:

- **Start** and **Continue** play, and **Stop** pauses. **CC 80** with a value of 64–127 on any channel plays or pauses. A footswitch that sends 127 on each press works, and repeats within 150 ms count as one press.
- **Page Down** and the right arrow go to the next section; **Page Up** and the left arrow go to the previous one. While a [PDF chart](#pdf-charts) is on screen, those same keys turn its pages instead. **T** taps the tempo.
- A key you learn to an action is never changed by this. Learn a key to **Next page** or **Previous page** to turn pages with a page-turner while the lyrics are on screen too.
- **Page up**, **Page down**, **Previous page** and **Next page** scroll the lyrics, or turn the page of a [PDF chart](#pdf-charts) when one is on screen. They work in stage mode too, so a page-turner can turn the chart.

**Learn MIDI** or **Learn key** on an action, then press the pedal, controller or key. The next message is bound. Learn shows the channel and the message it heard, such as "Ch 3 · CC 80 = 127". A message that already runs another action is not bound: Learn names that action, and you remove it first. A program change learned after a bank select (CC 0 and CC 32) is bound to that bank only.

A controller binding has three modes:

- **Momentary** fires on every message in its range.
- **Threshold** fires once, when the value rises into the range.
- **Toggle** fires on each switch, up or down.

Tick **Double press** on a binding that must not run by accident, such as Stop or Panic. The first press shows a hint, and the action runs when the second press comes within 0.6 s.

The actions cover transport (play, play or pause, stop, play from start, panic), songs (next, previous, select by number, crossfade), sections (next, previous, arm, jump now, loop, exit loop, cancel jump), lyrics (scroll and page), text size, stage mode, mute groups 1–6, click, tap tempo, speed up, down and reset, arm or disarm MIDI cues, and the [practice mute](#practice-mute) of each instrument. Lyrics pages scroll the reader by a screenful, because the app has no PDF view.

Things to know:

- Keys do nothing while you type in a field or a dialog, and a key that is held does not repeat its action. Keys with Ctrl, Alt or Cmd are not bindings.
- Our own MIDI output is ignored when it comes back in through a THRU or loop-back input for a moment, so a Stop is not taken as a second Stop.
- An action that does not apply now (a section jump in a song without sections, or next song outside a playlist) changes nothing and shows a short hint.
- In stage mode every action still runs. The stage lock refuses seeking only, so **Play from start** is refused there.
- Speed keys move the rate in 5% steps.
- Bindings are saved with the MIDI setup on this computer. **Reset to defaults** restores the list above.
- Only notes, controllers, program changes, Start, Continue and Stop can be learned. Clock, pitch bend and aftertouch cannot.

## Load songs from MIDI

A program change or Song Select on the selected MIDI input can load a saved song, for example a GP-180 patch change that also selects the backing track. Turn it on under **Load songs from MIDI** in the MIDI setup. Each song's trigger is set in its **Song trigger** panel: choose **Learn trigger** and then press the program change (after its bank select, if the pedal sends one) or the Song Select message. You can also type the channel, the program or number, and an optional bank.

- **Songs that can load** is the whole library, or only the current playlist.
- **While a song plays** is what a trigger does during a song. **Ignore** is the default, so nothing stops. **Arm as next** plays the triggered song after the current one, in a playlist. **Stop and load now** stops the song and loads the triggered one; use it only when the set should jump.
- **Start a song as soon as a trigger loads it** is off by default, so a loaded song waits for Play.

Things to know:

- A message that a remote action already claims runs that action and does not load a song. Learn names the action, and the song panel and preflight show the clash.
- If two songs have the same trigger, the first song in the library loads for that message, every time. The list under the options and the playlist preflight name the others.
- Our own program changes and Song Select, such as cues in a chart and the chase at a start, are ignored when they come back through a THRU input.
- A message for the song that is already loaded does nothing. A pedal that sends the same message twice loads the song once.
- In a playlist, a trigger for a song in the set moves the set to that song. A song outside the set loads on its own and pauses the set, with a notice.
- A song needs to be saved in the library before it can have a trigger. Anything that is not a program change or Song Select does nothing.

## MIDI timecode

The app can send MIDI Time Code (quarter frames and full frames) so that a DAW, a lighting desk or a timecode-aware device can follow the song.

- **Turn it on** in the MIDI setup with **Send MIDI timecode**, and choose the frame rate: 24, 25 or 30 fps (non-drop). 29.97 drop-frame is not offered.
- **Each song has its own offset**, `HH:MM:SS:FF`, in its MIDI setup. It is the timecode at song position zero. Frames must be below the rate: at 25 fps, `00:00:00:24` is valid and `00:00:00:25` is not. An invalid offset stops Play and is named in the preflight.
- **What is sent.** A full frame at the start, seek, jump, loop wrap and speed change, followed by quarter frames that follow song time. A speed of 50–150% stretches or shrinks the quarter-frame spacing, so the timecode stays with the audio. Nothing is sent during the count-in.
- **Gapless and crossfade.** The next song's timecode starts from its own offset with a full frame at its start. The outgoing song's quarter frames stop where the next song joins.
- **Timecode replaces app MIDI clock.** Turning timecode on turns the clock off, and the clock box is disabled while timecode is on. A receiver gets one source of time.
- **Bluetooth is not recommended.** Quarter frames come every few milliseconds, and Bluetooth cannot keep them steady. Preflight warns when timecode is on with a Bluetooth output. Use USB.
- Late quarter frames are dropped rather than sent in a burst. A late full frame is still sent, because it sets the position.

Check the receiving device on the rig before relying on it, and see the timecode rows in the hardware test plan.

## Generated drums and bass

The Band panel can generate drums and bass to play along, for a song that is missing them and for one that already has them. The split notice names a part that is missing. On the Performance screen, press **Generate drums & bass…** to open the panel and make them. Its help line says what the panel does, and the line under the button shows the state: "No drums found" or "No bass found" for a part the split missed, then the generated parts and what plays, such as "Generated: drums, bass. Playing generated drums, original bass." Once the song has generated parts the button reads **Drums & bass…**. The command palette (Ctrl/Cmd K) also has **Generate drums and bass…**, which opens the panel from the Performance screen.

**Find the beat.** Press **Find the beat** first. It listens to the drums stem if there is one, then the pitched stems, then the whole mix. The panel shows what it found, for example "120.0 BPM, steady, 16 beats, 4 per bar". The parts follow this beat grid, so check it before you generate. The bar lines follow the chord changes, and they can move partway through a song where the chords move to another beat of the bar, so a short or long bar is kept. Press **Find the beat** again on a song found before this release to get those bar lines.

If the grid is wrong, correct it:

- **Half tempo** and **Double tempo** halve or double the beats, for a song the tracker heard at the wrong speed.
- **Downbeat ←** and **Downbeat →** move the bar line by one beat.
- **Nudge −10 ms** and **Nudge +10 ms** shift the whole grid a little.
- **Use fixed BPM** builds a grid from the Song BPM and first beat, for a song with no click that the tracker cannot find. Set those first (see [Prepare a song](#prepare-a-song)).
- **Set metronome to this tempo** copies a steady grid's tempo and first beat to the metronome.

**Styles and settings.** Choose a style: Rock, Pop, Ballad, Country, Funk, Half-time, Reggae, Shuffle, Metal or 6/8. Then tune it:

- **Complexity** sets how busy the patterns are.
- **Swing** pushes the off-beats. Each style has its own default, which you can change.
- **Ghost notes** adds soft snare hits between the backbeats. **Crash on section starts** puts a crash at the start of each section.
- **Bass range** is low, normal or high.
- **Default bass part** is the part a section plays when it is on Auto and Auto has no rule of its own. See [The bass part](#the-bass-part).
- **Bass notes from** is **Original bass** by default, or **Chords**. Original bass plays the note the song's own bass stem plays on each beat, where the analysis could hear one; the chord still sets the quality of the notes around it. A beat with no clear bass note keeps the chord's own bass, and a song with no bass stem always does. Chords plays each chord's own bass, which is the one a slash chord names. Under each chord change in the grid, the strip shows the bass note when it is not the chord's root, so you can see where the bass differs.
- **Lock bass to kick** makes the bass land on the kick.
- **Humanise** adds small timing and velocity variation. **Feel** is the style default, Tight, Natural, Laid back or Pushed.
- **Follow my playing** takes the parts' accents from your playing. **Follow source** picks the stem to listen to: Auto, or a stem that the split made. In Auto, a song whose sections show no clear accents is not followed. When a part cannot follow, the panel says why after Generate, and the part keeps its normal feel.

**Fix a bass note yourself.** When the generated bass plays a wrong note, click its beat or its chord in the beat strip. The editor shows the beat's time and bar, the chord, and the note the bass plays now with where it comes from: your own note, the original bass, or the chords. Choose a note and an octave nudge, then choose where it applies: **This beat**, **This bar**, **Until the next chord change**, or **This chord everywhere in this section**. The last one sets the chord in every section with the same name, so each chorus can be fixed at once. **Apply** saves the note, **Reset** removes the note on that beat, and **Listen** plays about two bars around the beat with the choice in place, without saving it. A beat with a note of your own is marked in the strip. **Your bass notes** under the strip lists each one with its time range, and **Remove** or **Remove all** takes them out. Your notes win over the original bass and the chords. They stay through **Generate** and **Try another**, and a change marks the parts out of date, so Generate again to hear it.

**Use your own render.** Export the parts as MIDI, render them in your own DAW with your own instruments, and bring the audio back. In the Band panel, **Use my rendered drums…** or **Use my rendered bass…** picks a WAV, FLAC, MP3, M4A or OGG file. The file takes the place of that part's generated track, which keeps its name, so the mixer and **What plays** work as they do for a generated part. A file of up to 0.5 s different from the song's length is used as it is, one 0.5 to 5 s different is padded or cut with a notice, and one more than 5 s away is not used. If the file's first hit is more than 20 ms away from the part's first generated note, the panel says how far, and offers **Line up with the first note**, which moves the file that far; **Use as it is** keeps it where it is. Nothing is moved without that choice. The line-up needs a generated part to line up with, so generate the part once, or the file is used as it is. **Back to generated** renders the part again with the current settings, since the generated audio is not kept, so the generated part can differ from the one you first made if the settings have changed. **Generate** asks before it replaces a rendered part. Remove generated parts takes the rendered audio out too. The file on your disk is never changed. These actions are off during playback, like Generate.

**Bass tone.** The generated bass can play through a chain of up to six blocks, in the order you set: a pedal (a compressor or drive), a preamp, an amp, a cab IR and a space IR for room or reverb. **Add pedal…**, **Add preamp…**, **Add amp…**, **Add cab IR…** and **Add space IR…** pick a NAM capture from TONE3000 (the search starts on "bass" with that gear, and you can change it) or open a `.nam` or `.wav` file on this computer. A capture that is an older A1 model is labelled "older capture". Each block has **On**, its **In** drive, its **Out** level and its **Mix** (100% is all processed, 0% passes the block through), and **Up**, **Down** and **Remove** change the order. **Start from a preset** sets up an empty chain with the roles set, for you to fill: Bass DI + amp, Driven bass, or Studio bass (a pedal, an amp, a cab and a room IR at 20%). The chain has a **Chain wet** mix with the clean bass, and **Fast render** renders captures at their Lite size where the file has one. A full-size capture takes about 5 s to render per minute of song (less with Fast render), and the panel shows the estimate for the song. **Clean bass** goes back to the clean sample. The chain renders when you press Generate, and the preview hears it too. The whole chain is matched to the clean bass's loudness, so it changes the tone and not the level. It never renders during playback. TONE3000 has no bass tag, so the search matches on the word "bass" and can list a capture that is not for bass, so listen before you use one. If a capture or IR is no longer on the computer, the bass plays clean and the panel says which file is missing. Empty slots and off blocks play nothing. The web build can't use bass tones, so the chain is disabled there.

**Drum tone.** The generated drums can play through the same kind of chain, under **Drum tone** in the Band settings. The drums offer three kinds of block: **Add outboard…** (a compressor, preamp, console or tape capture, found under TONE3000's outboard gear), **Add preamp…** (a capture) and **Add space IR…** (a room or plate IR). Each can also be a `.nam` or `.wav` file from this computer, and each has the same **On**, **In**, **Out** and **Mix** controls, **Up**, **Down** and **Remove**, **Chain wet** and **Fast render** as the bass chain. **Start from a preset** gives empty slots to fill: **Glued kit** (an outboard capture), **Room kit** (a space IR at 30%) or **Recorded kit** (an outboard capture, then a space IR at 25%). A capture plays on the middle of the kit and the sides are added back at the same level change, so a mono capture does not narrow the kit. A stereo space IR plays its left and right on the kit's left and right, and a mono IR plays on both. The panel shows the render estimate (captures count double for the two sides). The drum tone renders when you press Generate, after the drums are made and while the footer says "Applying the drum tone…", and the preview hears it too. It never renders during playback. The kit is matched to the clean kit's loudness. If a file is no longer on the computer, the drums play clean and the panel says which file is missing, while the bass still gets its own tone. **Clean drums** goes back to the dry kit. The web build can't use drum tones, so the chain is disabled there.

**Sections.** The table has one row per section, or one row for a song without sections. Each row sets the section's style, **Energy** (1 to 5), whether it has a **Fill** at its end, and whether drums and bass play in it. Energy starts from the section's name: choruses and solos are higher, intros, verses and outros lower. The defaults also follow the original band. The generated bass rests in a section where the original bass stops, the generated drums stop where the original drums stop, and a section that is clearly louder or quieter than the rest of the song plays one energy level up or down. Your own settings for a section always win. Click a row to select it. Preview then starts from that section. Energy shapes the drums. **Bass part**, **Busy** and **Loud** shape the bass, and Loud also softens or hardens the drums. **More** opens the rest of the bass options for the row. The table scrolls sideways inside its own box when the window is narrow.

**The bass part.** Each section plays one bass part: **Ring out** (held notes, one or two a bar), **Root pulse** (quarters or eighths on the root), **Groove** (the style's rhythms), **Melodic** (groove with approach notes), **Walking**, **Pedal** (one held note that ignores the chords) or **Rest**. **Auto** picks one from the section's name, and the row shows what it picked, for example "Auto · Ring out". Intros start on a pedal for two bars, verses ring when quiet and pulse when busier, pre-chorus pulses and gets louder over its last two bars, choruses groove or go melodic at busy 4 and up, bridges go melodic an octave up (or ring when the chorus grooves), solos groove and outros ring. A section with another name plays the default part. **Busy** (1 to 5, from the energy) sets how many notes a part plays, and **Loud** (1 to 5) how hard they play. **Feel** sets how long the notes ring: Tight shortens them and Ring lets them sound on. **Octave** moves a section up or down an octave when the range allows it. **Fills** (0 to 3) set how often the bass varies the last bar of a four-bar phrase, with a pickup, an octave pop, a run into the next root or an empty last beat. A section that leads into a section with a different name plays a short run into its first note. **Hit the one** holds a chorus's first note and plays it harder. **Slides**, **Dead notes** and **Pickups** are playing techniques. Each style sets its own defaults, shown in More: funk plays dead notes, ballad slides, and the others pickups. After Generate, the panel says how far under the song each part sits, for example "Drums set 4.0 dB under the song, bass 7.2 dB under." A part that the peak limit held back says so.

**Generate, Try another, Remove, Preview and Export MIDI.**

- **Generate** writes the parts into the song as two tracks, **Drums (generated)** and **Bass (generated)**. Changing a setting does not regenerate anything. The panel says "Parts out of date" until you press Generate again.
- **Try another** keeps your settings and makes a different take.
- **Remove generated parts** takes both generated tracks out of the song. Your own tracks stay.
- **Preview** plays the parts over the song, from the section you pick in the menu next to it (or from the playhead), for the whole section, 4 bars or 8 bars. **Stop preview** ends it early. The buttons stay at the bottom of the dialog, and after **Generate** the bar offers **Close** and **Play from** the selected section.
- **Export MIDI…** saves the notes of the last Generate as `<song title> - band.mid`. Drums go on channel 10 and bass on channel 1, with the song's tempo. It is available after Generate until you close the panel. Open the file in a sequencer or a notation app to use the parts elsewhere.

Everything here works offline, and the samples ship with the app. Generating, removing, previewing and exporting are all off during playback, so press Stop first.

The parts are normal tracks in the mixer, so you can mute, solo or set their volume. The bass follows the song's pitch shift, as set by **Follows pitch** on its track. The drums do not, since a drum hit has no pitch to shift.

**What plays.** Under the Band panel's status, each part has its own choice: **Original** plays the drums or bass the split found, **Generated** plays the band's part, and **Both** plays the two together. Generated and Both need a generated part, so generate the part first. Generate switches a part that was on Original to Generated, so you hear what you made, and says so. Remove generated parts puts both parts back on Original. The choice is saved with the song, and works on a song that already has the part. Switching only changes the mute levels of the two tracks, so a switch during playback is click-free and playback keeps going. Your volume and pan on each track stay as they were. Apply to similar songs copies the choice when both songs have generated parts. Remote and MIDI bindings can toggle a part between Original and Generated with **Toggle drums: original or generated** and **Toggle bass: original or generated**.

**Limits.**

- The chords come from the chart, or from chord detection when the chart has none. Detection names the common chord types and slash basses (see [Lyrics and chords](#lyrics-and-chords)). If neither gives chords, the bass rests, and the panel says so.
- The bass notes come from the bass stem when the song has one, and from the chords otherwise. The bass stem is read once per beat, so a beat with two different notes gets the one that sounds for most of it. Check the strip where the bass differs from the chord.
- A song with no click may need beat corrections before its parts line up. Check the first and last bars of each section.
- Listen before a show. Preview a few sections, then check the whole song.

The drum and bass samples are CC0, so they need no attribution. The [sample notice](app/src/renderer/src/song/band/NOTICE.md) lists the libraries and the files used.

## Stage mode

Choose **Enter stage mode** in Performance. The window fills with large lyrics and transport buttons, and MIDI status and faults stay visible. Setup, the mixer, editors, seeking, rewind and chord popups are locked, and Escape or clicking outside does not exit.

- **Play/Pause** and **Stop playback** stay available.
- **Panic / stop MIDI** pauses playback, clears queued MIDI, disarms and turns Send cues off. It cannot undo commands a pedal already received.
- **Exit stage mode** unlocks everything. Leaving the Performance screen also exits.
- Stage mode does not arm MIDI or change the BPM, and it stays on across playlist songs.

On the desktop, playback in stage mode keeps the computer and display awake. It lets go on pause, at the end of the set, on exit or if the app closes. It does not override a closed lid or a deliberate sleep.

## Audience display

The audience display is a second window for the lyrics, chords or PDF page, on a projector or a second screen. The performer keeps the controls on the main screen. Find **Audience display** under the performance controls.

- **Open audience display** opens the window. Choose **Show on** first: the window fills that display with no title bar, and the app remembers the choice. If the display is not connected, the window opens on the main screen instead, and it moves to the display when the display is plugged back in. Unplugging the display mid-show moves the window to the main screen and does not stop playback.
- **Close audience display** closes it. Closing the audience window, or the performance window, never stops or changes playback.
- It shows the line on screen in large text, with its chords above and the next line below. It also shows the song title and **Next:** the next song of the playlist. A PDF chart on screen shows the same page. Lyrics follow playback with their own clock, so they stay in step after a seek, a loop, a speed change or a gapless join, without the performer's screen sending updates every frame.
- **Show chords** hides or shows the chord row. **Text size** and **Rotation** (0, 90, 180 or 270 degrees, for a screen mounted sideways) are kept on this computer. **Black between songs** blanks the screen while the song is stopped at its start, which covers the time between songs of a set and before a song is played. **Blackout** hides everything. Blackout is not kept after a restart; the other choices are.
- With no song on screen the window shows the app's name. Until the performance screen has sent it anything, and while blackout is on, the window is black.
- An untimed chart (a plain text or a ChordPro song with no timestamps) is shown as its text from the top and does not follow the song. PDF annotations (pen, highlighter and text) stay on the performer's screen.

In the browser build there is no second window or display list. **Open audience display** opens a pop-up with the same view. The browser cannot place a pop-up on a chosen display, so move the pop-up to the audience screen and press F11 to fill it. Allow pop-ups for the site. PDF charts need the desktop app.

## Band sync

Band sync lets bandmates follow the song on their own phones or tablets over the same Wi-Fi or Ethernet network. It is off until you start it.

- **Start:** in Song → Performance, open **Band sync on this network**. Choose the network address and a port (8787 by default), then **Start band sync**. Only private network addresses are listed.
- **Join:** the panel shows the address (for example `http://192.168.1.20:8787/`), a QR code and a six-digit PIN. A bandmate opens the address or scans the code, types the PIN, and sees the song, lyrics and chords following your playback. Each bandmate can change the text size and transpose on their own device; that changes nothing for anyone else.
- **New PIN** disconnects every bandmate and asks for the PIN again. **Stop band sync** disconnects everyone. The sync is off the next time the app opens.
- **Allow followers to play, pause and stop** is off by default. When it is on, a bandmate's play or pause runs as if you pressed the same action on a pedal. A stop needs a second press within 0.6 s, as a double-press binding does, so a stray tap cannot end a song.
- Bandmates never load songs, read your library or touch files, and they hear no audio. The sync sends the song's text and the playback clock only.
- A phone that drops off the network (a locked screen, a Wi-Fi gap) reconnects by itself, without the PIN, while the sync is still on.

### Security

- The sync listens on the one address you choose, and only private network addresses are offered. It is never open on the internet, and it is not a relay.
- The traffic is **not encrypted**. The six-digit PIN is the only protection. Use band sync on a network you trust, not a shared café, hotel or venue network, and stop it when the set is over.
- Five wrong PINs from one device lock that device out for a minute. Each later lock-out is longer, up to 15 minutes. A bandmate's session lasts 12 hours and ends when the PIN changes or the sync stops.
- The app refuses any frame over a few kilobytes, anything it does not expect, and any action other than play, play or pause, and stop.
- Your firewall may ask whether to let the app accept incoming connections. Allow it only on a private network.

## Troubleshooting

- **Nothing reaches the pedal.** Check that **Send cues** is on, the right output is selected and the channel matches the pedal. Use **Send MIDI now** to test one command.
- **"N late MIDI commands dropped" notice.** A stall (a busy window, a slow driver) never disarms the song. A program change, controller or SysEx more than 250 ms late is dropped instead of played out of place, late clock pulses are skipped, and the schedule re-syncs to the audio. Note-offs are always sent. The notice shows where it happened, and the dropped commands are counted in Diagnostics. Check the pedal if a patch looks wrong.
- **Bluetooth: "late messages dropped".** A Bluetooth command that is more than 250 ms late when it reaches the radio is dropped, counted under the Bluetooth status and never closes the link. The link closes only on a write error, a write timeout or a Bluetooth disconnect, and it then reconnects automatically.
- **Cues stopped and the output disarmed.** This now only happens when timing cannot recover: the scheduler worker failed, the audio clock stopped advancing, three re-syncs happened within five seconds, or the output disconnected. Queued commands are cleared and audio keeps playing. Check the pedal, rearm and choose where to resume.
- **Bluetooth closed by itself.** A write that waits more than 250 ms, or takes more than a second, closes the connection and is not retried, because the pedal may already have got it.
- **Tempo jumps.** Turn **Send MIDI Clock** off and use the one-time tempo command.
- **A pedal answers the wrong command.** Two pedals share a channel, or the pedal is on OMNI. Give each its own channel.
- **A looper stops by itself.** Pause and panic only release channels that sent notes, because blanket CC 64 is the GP-180 looper Stop.
- **USB output silent after the Mac sleeps.** The app requests the system's MIDI ports again on wake, and if the pedal came back as the same output, Send cues arms it again by itself. A fault (a failed send, timing that cannot recover) disarms at once and shows the fault, but Send cues stays on, so the next song or a reconnect arms again.
- **USB editor does not connect.** Connect the powered pedal by USB and use **Look for the pedal**. Make sure its MIDI input allows USB and close other MIDI apps.
- **Bug reports.** **Copy diagnostic report** and **Save log** in Diagnostics include Bluetooth state, write and notification counts and MIDI traffic. The **Bluetooth clock timing** and **Reset timing counters** controls show queue lateness.

## Limits

- Timing is best effort. The cue scheduler runs in its own worker. USB and system MIDI cues are handed to Web MIDI up to a second ahead with exact timestamps, so a busy window cannot delay them; Bluetooth cues are held about 120 ms ahead because Bluetooth cannot timestamp on the receiving side. Delivery still goes through Web MIDI or Bluetooth and the operating system. A queued command is not an acknowledgement from the pedal.
- The app cannot read a pedal's channel, routing or state. Missed commands are never reconstructed.
- Playlist joins are gapless only when the next song is ready in time. Otherwise there is a short gap, and a notice says so.
- Audio is stretched or pitch-shifted only by [speed and pitch](#speed-and-pitch). The metronome is never stretched.
- Audio outputs, speed and pitch, gapless joins and multitrack import are not yet tested on hardware.
- Chord estimates cover the common chord types only: no extended chords such as ninths or altered chords. Key estimates are less certain for modal music, relative keys and key changes, and a key in a section is only listed when it is clear. Lyrics from Whisper can be wrong. The project has not yet measured chord accuracy on real recordings.
- Pedal profiles come from manuals and are tested at byte level. Only the GP-180 and TimeLine results above come from real hardware.
- Bluetooth editor management and RTP-MIDI are not supported.
