# Third-party notices: generated band samples

The generated drum and bass parts (spec 50) play samples from the two CC0 libraries below. The sample files live in `samples/` next to this notice, and `samples/map.json` says which file is which. Both source repositories carry a CC0 1.0 `LICENSE` file, checked on 28 Oct 2026. The drum repository (https://github.com/sfzinstruments/virtuosity_drums, commit 9f04cf9 of 21 Apr 2026) was checked again on 13 Nov 2026 for spec 133: its `LICENSE` is the "CC0 1.0 Universal" legal code.

## Drums

Drums: Virtuosity Drums, recorded at Virtuosity Musical Instruments in Boston and performed by Austin McMahon, with SFZ mappings from the sfzinstruments project (https://github.com/sfzinstruments/virtuosity_drums). Licence: CC0 1.0 Universal. No attribution is required; credited here as a courtesy.

Files used (`samples/drums/`), from the `mid` mic set, snares on, named `<piece>-v<layer>[-rr<take>].flac`. Spec 133 replaced the first set (one take of three layers per piece) with these 84 files. The kit takes the library's layers nearest velocities 30, 55, 80, 100 and 120, which gives five layers for the snare, cross-stick and toms (the library has 36, 16 and 16), four for the kick and closed hat, and three for the open hat, pedal hat, ride and crash. The kick, hats and ride have three round-robin takes (`rr1` to `rr3`, the library's own). Cross-stick, crash and toms have one take. The library has no round robins for the snare, so its three takes are the chosen layer and the layers either side of it, about 3 velocity steps apart.

- kick (GM 36), 4 velocity layers (v1 softest), nominal velocities 31, 63, 95, 127:
  `kick-v1-rr1..3` from `mid_kick_snon_vl1_rr1.flac, mid_kick_snon_vl1_rr2.flac, mid_kick_snon_vl1_rr3.flac`;
  `kick-v2-rr1..3` from `mid_kick_snon_vl2_rr1.flac, mid_kick_snon_vl2_rr2.flac, mid_kick_snon_vl2_rr3.flac`;
  `kick-v3-rr1..3` from `mid_kick_snon_vl3_rr1.flac, mid_kick_snon_vl3_rr2.flac, mid_kick_snon_vl3_rr3.flac`;
  `kick-v4-rr1..3` from `mid_kick_snon_vl4_rr1.flac, mid_kick_snon_vl4_rr2.flac, mid_kick_snon_vl4_rr3.flac`
- crossstick (GM 37), 5 velocity layers (v1 softest), nominal velocities 32, 56, 79, 103, 119:
  `crossstick-v1` from `mid_snare_crossstick_vl4.flac`;
  `crossstick-v2` from `mid_snare_crossstick_vl7.flac`;
  `crossstick-v3` from `mid_snare_crossstick_vl10.flac`;
  `crossstick-v4` from `mid_snare_crossstick_vl13.flac`;
  `crossstick-v5` from `mid_snare_crossstick_vl15.flac`
- snare (GM 38), 5 velocity layers (v1 softest), nominal velocities 28, 56, 81, 99, 120:
  `snare-v1-rr1..3` from `mid_snare_center_vl8.flac, mid_snare_center_vl7.flac, mid_snare_center_vl9.flac`;
  `snare-v2-rr1..3` from `mid_snare_center_vl16.flac, mid_snare_center_vl15.flac, mid_snare_center_vl17.flac`;
  `snare-v3-rr1..3` from `mid_snare_center_vl23.flac, mid_snare_center_vl22.flac, mid_snare_center_vl24.flac`;
  `snare-v4-rr1..3` from `mid_snare_center_vl28.flac, mid_snare_center_vl27.flac, mid_snare_center_vl29.flac`;
  `snare-v5-rr1..3` from `mid_snare_center_vl34.flac, mid_snare_center_vl33.flac, mid_snare_center_vl35.flac`
- hat-closed (GM 42), 4 velocity layers (v1 softest), nominal velocities 31, 63, 95, 127:
  `hat-closed-v1-rr1..3` from `mid_hh_closed_vl1_rr1.flac, mid_hh_closed_vl1_rr2.flac, mid_hh_closed_vl1_rr3.flac`;
  `hat-closed-v2-rr1..3` from `mid_hh_closed_vl2_rr1.flac, mid_hh_closed_vl2_rr2.flac, mid_hh_closed_vl2_rr3.flac`;
  `hat-closed-v3-rr1..3` from `mid_hh_closed_vl3_rr1.flac, mid_hh_closed_vl3_rr2.flac, mid_hh_closed_vl3_rr3.flac`;
  `hat-closed-v4-rr1..3` from `mid_hh_closed_vl4_rr1.flac, mid_hh_closed_vl4_rr2.flac, mid_hh_closed_vl4_rr3.flac`
- hat-pedal (GM 44), 3 velocity layers (v1 softest), nominal velocities 42, 85, 127:
  `hat-pedal-v1-rr1..3` from `mid_hh_pedal_vl1_rr1.flac, mid_hh_pedal_vl1_rr2.flac, mid_hh_pedal_vl1_rr3.flac`;
  `hat-pedal-v2-rr1..3` from `mid_hh_pedal_vl2_rr1.flac, mid_hh_pedal_vl2_rr2.flac, mid_hh_pedal_vl2_rr3.flac`;
  `hat-pedal-v3-rr1..3` from `mid_hh_pedal_vl3_rr1.flac, mid_hh_pedal_vl3_rr2.flac, mid_hh_pedal_vl3_rr3.flac`
- hat-open (GM 46), 3 velocity layers (v1 softest), nominal velocities 42, 85, 127:
  `hat-open-v1-rr1..3` from `mid_hh_open_vl1_rr1.flac, mid_hh_open_vl1_rr2.flac, mid_hh_open_vl1_rr3.flac`;
  `hat-open-v2-rr1..3` from `mid_hh_open_vl2_rr1.flac, mid_hh_open_vl2_rr2.flac, mid_hh_open_vl2_rr3.flac`;
  `hat-open-v3-rr1..3` from `mid_hh_open_vl3_rr1.flac, mid_hh_open_vl3_rr2.flac, mid_hh_open_vl3_rr3.flac`
- ride (GM 51), 3 velocity layers (v1 softest), nominal velocities 42, 85, 127:
  `ride-v1-rr1..3` from `mid_ride_ride_vl1_rr1.flac, mid_ride_ride_vl1_rr2.flac, mid_ride_ride_vl1_rr3.flac`;
  `ride-v2-rr1..3` from `mid_ride_ride_vl2_rr1.flac, mid_ride_ride_vl2_rr2.flac, mid_ride_ride_vl2_rr3.flac`;
  `ride-v3-rr1..3` from `mid_ride_ride_vl3_rr1.flac, mid_ride_ride_vl3_rr2.flac, mid_ride_ride_vl3_rr3.flac`
- crash (GM 49), 3 velocity layers (v1 softest), nominal velocities 42, 85, 127:
  `crash-v1` from `mid_crash_crash_vl1_rr1.flac`;
  `crash-v2` from `mid_crash_crash_vl2_rr1.flac`;
  `crash-v3` from `mid_crash_crash_vl3_rr1.flac`
- tom-low (GM 45), 5 velocity layers (v1 softest), nominal velocities 32, 56, 79, 103, 119:
  `tom-low-v1` from `mid_ltom_center_vl4.flac`;
  `tom-low-v2` from `mid_ltom_center_vl7.flac`;
  `tom-low-v3` from `mid_ltom_center_vl10.flac`;
  `tom-low-v4` from `mid_ltom_center_vl13.flac`;
  `tom-low-v5` from `mid_ltom_center_vl15.flac`
- tom-high (GM 50), 5 velocity layers (v1 softest), nominal velocities 32, 56, 79, 103, 119:
  `tom-high-v1` from `mid_htom_center_vl4.flac`;
  `tom-high-v2` from `mid_htom_center_vl7.flac`;
  `tom-high-v3` from `mid_htom_center_vl10.flac`;
  `tom-high-v4` from `mid_htom_center_vl13.flac`;
  `tom-high-v5` from `mid_htom_center_vl15.flac`

The middle tom (GM 47) plays the low tom files, transposed up 3 semitones in the renderer.

Processing: each file is resampled from 48 kHz to 44.1 kHz (windowed sinc, Blackman window, 64 taps, cutoff at 95% of the output Nyquist), trimmed to 1 ms before its first sample above −60 dBFS and to its last sample above −48 dBFS (spec 133: the first set stopped at −60 dBFS, which kept long cymbal tails and would not fit the 12 MB budget with three takes), given a 50 ms fade-out, and saved as 24-bit stereo FLAC. Nothing is normalised. The script is kept locally (`.claude/tools/band-samples/make-drums.ts`, not committed) and reads only the audio files of a clone kept outside the repository. Only the kit's own folders are used; the VSCO 2 Pro percussion folder is not included.

## Bass

Bass: Killer KB-Simmony bass guitar, played and mapped by D. Smolken, with Fashionbass sample library by Karoryfer (https://github.com/sfzinstruments/karoryfer.fashionbass), 2014. Licence: CC0 1.0 Universal.

Files used (`samples/bass/`): the note samples from the `fashionbass_clean.sfz` mapping (no release samples), round robin 1, velocity layers `p` and `f`, for the roots F1, G#1, B1, D2, F2, G#2, B2, D3, F3, G#3 and B3. Each root is stored as `bass-<note>-<p|f>.flac`, for example `bass-f1-p.flac`.

Processing: each WAV is 44.1 kHz mono 32-bit float. It is trimmed the same way as the drums (1 ms before the onset, last sample above −60 dBFS, 50 ms fade-out) and saved as 24-bit mono FLAC. Nothing is resampled or normalised.

## Room and the heavier kit (spec 133)

`samples/room/drum-room.flac` is a stereo room impulse response (0.5 s, 44.1 kHz, 24-bit) that this project generated: seeded noise, early reflections and an exponentially decaying low-passed tail, with the direct sound at sample 0. It is not taken from any recording, so no third-party licence applies to it. The generating script is kept locally (`.claude/tools/band-samples/make-room-ir.ts`, not committed).

The "Standard, heavier" kit (`kits.rock` in `samples/map.json`) uses the same drum files as the standard kit, so it adds no files and no licence. The renderer voices them when the kit loads (`kit-voicing.ts`): a 60 Hz sine thump with a 40 ms decay and a short 3 kHz click are added to the kick, a +4 dB shelf above 4 kHz to the snare, and the toms play two semitones lower.

Candidate recordings for a separate rock kit were not used. The sfzinstruments organisation lists three other drum kits whose repository licence GitHub reports as CC0-1.0: `karoryfer.big-rusty-drums`, `karoryfer.unruly-drums` and `karoryfer.swirly-drums` (checked on 13 Nov 2026 through the GitHub API; their `LICENSE` files were not read and no files were taken). The DrumGizmo kits listed there are CC-BY-4.0, and the Naked Drums kit is too, so none of those is eligible. Nobody has listened to the CC0 candidates yet.

