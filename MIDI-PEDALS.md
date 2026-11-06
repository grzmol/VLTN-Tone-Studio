# MIDI pedal command presets

Open **Song → Performance → Performance MIDI controller → Song MIDI cues**. Choose the cue time, pedal, MIDI receive channel and a named command. Search by memory number or function. **Add pedal command** stores its label and complete MIDI sequence in the song chart. **Send pedal command now** sends that sequence through the enabled performance output.

Channel selection addresses the pedal; it does not change its physical receive-channel setting. The local library remembers each model's channel and CC assignments. Initial channels are TimeLine **1**, RC-10R **2**, IR-200 **3** and SY-200 **4**, with saved channel choices taking precedence. Both models default to channel 1 in the command builder; the automatic tempo setup uses channel 16 to avoid the TimeLine on channel 1 when the GP-180 receives OMNI. Existing cues retain their saved bytes. Chart exports include readable labels and MIDI messages, so another computer can play the chart without importing its pedal profile.

## Triggers, macros and song MIDI files

**Triggers** send a command at a point in the song rather than at a time. Put each on its own line, with no timestamp:

```text
{midi@load: pc 1 5}          sent when the song is loaded while armed, and again each time you arm for it
{midi@play: cc 2 80 127}     sent each time playback starts or resumes
{midi@stop: cc 2 81 127}     sent when playback pauses or stops, including when a playlist song is skipped
{midi@end: pc 1 9}           sent when the song reaches its end, before the next playlist song starts
```

A trigger holds one command and is sent only while **Send cues** is on. Jumping or looping back does not send a play trigger again, and a trigger is not replayed when you start in the middle of a song. Across a gapless join, the outgoing song's end and stop are sent first, then the next song's load and play.

**More command forms** work in cues as well as triggers:

```text
[01:20.00] {midi:pc 1 5 bank 0 2}   sends CC0 = 0, CC32 = 2, then program change 5 on channel 1
[01:20.00] {midi:songselect 3}      sends song select 3
[01:20.00] {midi:start}             also {midi:continue} and {midi:stop}
```

When you start in the middle of a song, the latest song select is replayed as state. Start, Continue, Stop and triggers are one-shots and are not replayed. With **app MIDI clock** on, the app already sends Start and Stop, so preflight flags Start, Continue and Stop cues as conflicts. Turn clock off, or remove those cues.

To run a performance action, such as next section, play or pause, or tap tempo, from a footswitch or controller, learn it under **Remote control** in [Performance](PERFORMANCE.md#remote-control). To load a song from a program change or Song Select, see [Load songs from MIDI](PERFORMANCE.md#load-songs-from-midi).

**Macros** are named lists of commands. They are shared by every song and kept with your MIDI setup. Save a pedal command with **Save as macro** in the pedal picker, or a raw command in the command builder, then use it in a chart as `{midi:$CODE}`:

```text
[01:20.00] {midi:$GP_LEAD}
```

Codes are upper-case letters, digits and underscores, such as `GP_LEAD`. A macro can list other macros by code, but not itself. A reference is expanded when a song is loaded, so editing a macro updates every song that uses it. A chart that uses a missing macro, or a macro that refers to itself, does not play, and the message names the macro.

**Song MIDI files:** attach a standard MIDI file (format 0 or 1, ticks per beat) to a song in **Song MIDI cues**. Its messages play alongside the chart's cues at the same timing, follow the song's speed and are replayed when you start mid-song like the chart's own state. Channel messages, song select and SysEx are sent. Meta events other than tempo, and real-time bytes, are skipped. The app reads the file when you attach it and refuses one it cannot play. The file is saved with the song and included in backups. SMPTE timing and format 2 files are not supported.

## MIDI over the network

Network MIDI is not built into the app. The operating system provides it, and the app then sees the session as an ordinary MIDI port.

**macOS.** Open **Audio MIDI Setup** and set up a **MIDI Network Setup** session (the MIDI Studio window; menu names vary by macOS version). Enable the session and invite the other computer or device. Once it is connected, it appears in the app's output and input lists like any other MIDI port. Nothing else needs installing.

**Windows.** Windows does not have network MIDI built in. Install an RTP-MIDI driver (rtpMIDI, by Tobias Erichsen) and create a session in it. The session then appears as a MIDI port, and the app lists it once the port is connected.

Network MIDI adds the latency and jitter of the network to every cue and timecode message. Use a wired link where you can, and test the path with the pedals before a show. Hardware results are not yet recorded for network sessions.

## Included profiles

| Pedal | Actions and manual reference |
| --- | --- |
| Strymon TimeLine | All 200 bank A/B memories; engage/bypass; tap; infinite repeats; looper; main and algorithm-specific controls. Supplied Rev H manual, pp. 21, 25–26. Enable MIDI CC and Patch Change. Every memory includes CC 0 bank select, including returns to bank 0. |
| BOSS RC-10R | 99 phrase memories; assigned rhythm, looper, track and level controls. Supplied MIDI Implementation v1.00, pp. 2–3, and [manufacturer's Parameter Guide](https://static.roland.com/assets/media/pdf/RC-10R_parameter_eng01_W.pdf), pp. 9–11. Use RX CONTROL CH. Bank select is ignored. Rhythm notes/kits use a separate RX NOTE CH and are not included in this control profile. |
| BOSS IR-200 | 128 memory recalls and assigned gain, level, solo, expression and switch controls. Supplied eng02 manual, pp. 20–21. Set Rx CH, PC IN and CC IN. Memory labels assume an identity PC map; custom mapping can select another memory. |
| BOSS SY-200 | 128 memory recalls and assigned parameter, direct/effect level, expression and switch controls. Supplied eng03 manual, pp. 13–14. Set RX CH, PC IN and CC IN. Custom PC mapping can select another memory or switch the effect off. |
| Valeton GP-150 / GP-180 | 200 patches; module on/off; Patch/Stomp mode; looper/drums; 129 drum patterns; tempo; volume, expression and quick-access controls. Supplied firmware v1.0.0 manual, printed pp. 75–77 (PDF pp. 78–80). Patch 129 uses CC 0 = 1 then PC 0. Tempo uses CC 73/74. Documented 0–100 volume limits are enforced. |

Configurable BOSS controls require **Assigned CC** to match the named setting on the physical pedal. For the RC-10R, open **Song → Performance → Performance MIDI controller → Song MIDI cues**, choose **BOSS RC-10R** and a looper or rhythm command such as **Start looper**, then enter the CC that its **LOOP START CC** setting uses in the **Assigned CC** field. Do the same for each trigger you use. Starting mid-song then never replays those CCs on the RC-10R's channel, and preflight warns about any trigger that is still unassigned. A raw cue with `{chase}` is still replayed. Accepted assignments are 1–31 and 64–95; no fixed number is guessed. Switch actions send 127 followed by 0; test the pedal's configured switch behaviour. Continuous controls use raw MIDI values, not inferred physical units. GP-180 functions without documented on/off semantics are explicitly labelled as control values.

Profiles are manual-derived and tested at byte level. Real GP-180/TimeLine tests confirmed timed patch changes and one-time tempo commands over Bluetooth and USB with the TimeLine connected to physical MIDI OUT. Other pedals and the complete action catalogue have not been hardware-validated. Continuous app clock was unstable on this rig; see [hardware results and the recommended one-time tempo setup](PERFORMANCE.md#hardware-results).

## Community databases

[OpenMIDI](https://github.com/Morningstar-Engineering/openmidi) is a community MIDI implementation dataset under Apache 2.0. [MIDI Guide](https://github.com/pencilresearch/midi) provides CC/NRPN data under CC BY-SA 4.0. Open **Browse OpenMIDI community pedals** and click **Load OpenMIDI catalogue** to fetch the pinned upstream catalogue. Search/select a device and click **Import OpenMIDI pedal**. The imported profile appears in the normal pedal selector, is saved locally for offline use and can be exported with full Apache licence text and attribution. The catalogue is cached in memory for the app session; imports remain across restarts. No MIDI is sent during loading or importing.

The adapter imports explicit fixed/ranged CC entries. Invalid or incomplete entries are counted and skipped; values, PC mappings and bank sequences are not guessed from prose. Community assignment suggestions must match the actual pedal. Built-in manual-derived profiles remain separate. MIDI Guide is a reference only and is not imported. OpenMIDI downloads use revision `839e8612d311a88beb0041dd704bdcecfc13e26e`; updating the pin is a reviewed code change.

## Add and share pedals

Expand **Add or share pedal definitions**. The guided form creates a custom pedal from its name, a readable command label, a manual reference and PC/CC numbers. Reuse the pedal name to add actions; the same label updates an existing action. No JSON editing is needed for simple commands.

For sequences or variable commands, download/edit the template and import its JSON, or edit the in-app template and click **Save custom pedal**. **Export selected pedal** shares its definition. Built-in ids cannot be overwritten: change the id before importing a customised built-in profile. Reimporting a custom id updates it. Importing never sends MIDI.

```json
{
  "version": 1,
  "id": "my-midi-pedal",
  "name": "My MIDI pedal",
  "source": "Manufacturer manual, page and firmware",
  "notes": "Match the pedal receive channel to Performance.",
  "actions": [
    { "id": "memory-1", "label": "Recall memory 1", "commands": ["pc $channel 0"] }
  ]
}
```

Use a unique lowercase profile id containing letters, numbers and hyphens. Each action has a unique `id`, readable `label`, ordered `commands`, and optional plain-text `description`. Commands use the chart's `pc`, `cc`, `note`, `off` or `sysex` syntax. Note cues need a corresponding release. Bank select and program change can be grouped in one action and retain their order at the cue timestamp.

Supported substitutions:

- `$channel`: selected channel, 1–16.
- `$value`: declare `"value": { "label": "MIDI value", "min": 0, "max": 127, "default": 64 }` on the action.
- `$cc`: declare `"assignment": "The setting name on the pedal"`; the user supplies the matching controller number.
- `$msb` and `$lsb`: high and low seven-bit parts of `$value`, for documented paired-controller values.

Imports validate version, ids, integer ranges, substitutions and resulting MIDI bytes. Limits are 500 KB, 1,000 actions and 16 messages per action. Imported data is never executable HTML/code. The source field records provenance, not certification: verify definitions against the manual and test them before a performance.
