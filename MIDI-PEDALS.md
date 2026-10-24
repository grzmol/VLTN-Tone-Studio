# MIDI pedal command presets

## GP-150 and GP-180 support

GP-150 and GP-180 share the editor protocol, preset format and performance MIDI command set. GP-150 has two footswitches and a built-in expression pedal; GP-180 has three footswitches. Both are supported over USB and for Bluetooth performance MIDI. Separate model identities and footswitch layouts are preserved. The command builder offers both models, and setup presets cover both. Existing GP-180 saved settings and cues remain compatible. Physical validation in this project used GP-180; GP-150 has not been hardware-tested in this session.

Open **Song → Performance → Performance MIDI controller → Song MIDI cues**. Choose the cue time, pedal, MIDI receive channel and a named command. Search by memory number or function. **Add pedal command** stores its label and complete MIDI sequence in the song chart. **Send pedal command now** sends that sequence through the enabled performance output.

Channel selection addresses the pedal; it does not change its physical receive-channel setting. The local library remembers each model's channel and CC assignments. Initial channels are TimeLine **1**, RC-10R **2**, IR-200 **3** and SY-200 **4**, with saved channel choices taking precedence. Both models default to channel 1 in the command builder; the automatic tempo setup uses channel 16 to avoid the TimeLine on channel 1 when the GP-180 receives OMNI. Existing cues retain their saved bytes. Chart exports include readable labels and MIDI messages, so another computer can play the chart without importing its pedal profile.

## Included profiles

| Pedal | Actions and manual reference |
| --- | --- |
| Strymon TimeLine | All 200 bank A/B memories; engage/bypass; tap; infinite repeats; looper; main and algorithm-specific controls. Supplied Rev H manual, pp. 21, 25–26. Enable MIDI CC and Patch Change. Every memory includes CC 0 bank select, including returns to bank 0. |
| BOSS RC-10R | 99 phrase memories; assigned rhythm, looper, track and level controls. Supplied MIDI Implementation v1.00, pp. 2–3, and [manufacturer's Parameter Guide](https://static.roland.com/assets/media/pdf/RC-10R_parameter_eng01_W.pdf), pp. 9–11. Use RX CONTROL CH. Bank select is ignored. Rhythm notes/kits use a separate RX NOTE CH and are not included in this control profile. |
| BOSS IR-200 | 128 memory recalls and assigned gain, level, solo, expression and switch controls. Supplied eng02 manual, pp. 20–21. Set Rx CH, PC IN and CC IN. Memory labels assume an identity PC map; custom mapping can select another memory. |
| BOSS SY-200 | 128 memory recalls and assigned parameter, direct/effect level, expression and switch controls. Supplied eng03 manual, pp. 13–14. Set RX CH, PC IN and CC IN. Custom PC mapping can select another memory or switch the effect off. |
| Valeton GP-150 / GP-180 | 200 patches; module on/off; Patch/Stomp mode; looper/drums; 129 drum patterns; tempo; volume, expression and quick-access controls. Supplied firmware v1.0.0 manual, printed pp. 75–77 (PDF pp. 78–80). Patch 129 uses CC 0 = 1 then PC 0. Tempo uses CC 73/74. Documented 0–100 volume limits are enforced. |

Configurable BOSS controls require **Assigned CC** to match the named setting on the physical pedal. Accepted assignments are 1–31 and 64–95; no fixed number is guessed. Switch actions send 127 followed by 0; test the pedal's configured switch behaviour. Continuous controls use raw MIDI values, not inferred physical units. GP-180 functions without documented on/off semantics are explicitly labelled as control values.

Profiles are manual-derived and tested at byte level. Real GP-180/TimeLine tests confirmed timed patch changes and one-time tempo commands over Bluetooth and USB with the TimeLine connected to physical MIDI OUT. Other pedals and the complete action catalogue have not been hardware-validated. Continuous app clock was unstable on this rig; see [hardware results and the recommended one-time tempo setup](BLUETOOTH.md).

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
