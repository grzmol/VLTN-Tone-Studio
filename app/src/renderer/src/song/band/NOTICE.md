# Third-party notices: generated band samples

The generated drum and bass parts (spec 50) play samples from the two CC0 libraries below. The sample files live in `samples/` next to this notice, and `samples/map.json` says which file is which. Both source repositories carry a CC0 1.0 `LICENSE` file, checked on 28 Oct 2026.

## Drums

Drums: Virtuosity Drums, recorded at Virtuosity Musical Instruments in Boston and performed by Austin McMahon, with SFZ mappings from the sfzinstruments project (https://github.com/sfzinstruments/virtuosity_drums). Licence: CC0 1.0 Universal. No attribution is required; credited here as a courtesy.

Files used (`samples/drums/`), from the `mid` mic set, snares on, round robin 1:

- kick: from `mid_kick_snon_vl2_rr1`, `vl3_rr1` and `vl4_rr1`
- snare (also the ghost-note layer): `mid_snare_center_vl12`, `vl25`, `vl33`
- cross-stick: `mid_snare_crossstick_vl6`, `vl11`, `vl15`
- closed hat: `mid_hh_closed_vl2_rr1`, `vl3_rr1`, `vl4_rr1`
- open hat: `mid_hh_open_vl2_rr1`, `vl3_rr1`, `vl4_rr1`
- pedal hat: `mid_hh_pedal_vl1_rr1`, `vl2_rr1`, `vl3_rr1`
- ride: `mid_ride_ride_vl1_rr1`, `vl2_rr1`, `vl3_rr1`
- crash: `mid_crash_crash_vl1_rr1`, `vl2_rr1`, `vl3_rr1`
- low tom: `mid_ltom_center_vl6`, `vl11`, `vl15`
- high tom: `mid_htom_center_vl6`, `vl11`, `vl15`

The middle tom (GM 47) plays the low tom files, transposed in the renderer. The three layers for each sound were picked as the SFZ layers nearest velocities 40, 85 and 115.

Processing: each file is resampled from 48 kHz to 44.1 kHz (windowed sinc, Blackman window, 64 taps, cutoff at 95% of the output Nyquist), trimmed to 1 ms before its onset and to its last sample above −60 dBFS, given a 50 ms fade-out, and saved as 24-bit stereo FLAC. Nothing is normalised. Only the kit's own folders are used; the VSCO 2 Pro percussion folder is not included.

## Bass

Bass: Killer KB-Simmony bass guitar, played and mapped by D. Smolken, with Fashionbass sample library by Karoryfer (https://github.com/sfzinstruments/karoryfer.fashionbass), 2014. Licence: CC0 1.0 Universal.

Files used (`samples/bass/`): the note samples from the `fashionbass_clean.sfz` mapping (no release samples), round robin 1, velocity layers `p` and `f`, for the roots F1, G#1, B1, D2, F2, G#2, B2, D3, F3, G#3 and B3. Each root is stored as `bass-<note>-<p|f>.flac`, for example `bass-f1-p.flac`.

Processing: each WAV is 44.1 kHz mono 32-bit float. It is trimmed the same way as the drums (1 ms before the onset, last sample above −60 dBFS, 50 ms fade-out) and saved as 24-bit mono FLAC. Nothing is resampled or normalised.
