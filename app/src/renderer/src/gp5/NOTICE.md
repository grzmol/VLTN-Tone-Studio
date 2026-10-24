# Notices

This toolkit reimplements and ports protocol knowledge and code from:

- **drewmerc302/valeton-gp50** — MIT License, Copyright (c) 2026 Andrew Mercurio. `.prst` codec (`lib/prst.mjs` is a port of `app/static/prst.js`), CRC/framing, GP-5 ⇄ GP-50 conversion, the GP-50 read/write facts (0x41 body 511 bytes, 29-frame write, Program Change select), fixtures `65-Puppy.prst`, `67-OerdriveM.prst`, `gp50_suite_write_slot0.json`, `gp50-US-Lead.prst` (the .prst from that capture), `gp50-blank.prst` (`app/static/data/presets.json`, slot 0) and `gp50-76-VoxUltNAM.prst` (`re/probes/test_out/swap/`). The model catalog (`lib/catalog-data.mjs`) is generated from its `fxid_ring.json` (GP-50) and `fxid_ring_gp5.json`, which the author notes are derived from Valeton Suite data: treat them as vendor data and do not redistribute them publicly.
- **fsanchezlme97-ui/gp5-editor** — MIT License, Copyright (c) 2026 fsanchezlme97-ui. GP-5 write/rename capture (`fixtures/gp5_suite_import.json`, `fixtures/97-FF_CC.prst`), SysEx preset select, live-edit layouts.
- **Builty/TonexOneController** — Apache License 2.0, Copyright (C) 2025 Greg Smith (the README also asks for public attribution). USB identification, pacing, global settings, save (0x4A) and patch-volume (0x42) commands, CRC routine credited to rvalladares.com.
- **helvecioneto/gp5-wc** — Apache License 2.0. Live-edit command templates and the GP-5 standard MIDI CC map.
- **cesardamien/hotone-family-firmware-fix** — MIT License, Copyright (c) 2026 Cesar Damien. USB VID/PID facts and the Windows 11 driver analysis.
- **sdatkinson/NeuralAmpModelerCore** — MIT License, Copyright (c) 2023 Steven Atkinson. SnapTone test models `../snaptone/fixtures/wavenet_a1_standard.nam` and `../snaptone/fixtures/nam_core_a2.nam` (`example_models/A2.nam` at commit b5a68c3), and the reference outputs `../snaptone/fixtures/*.lcg3003.f32` rendered with its A2 fast path at commit baf1bf8. `../snaptone/a2kernel.c` follows the operation order of its `NAM/wavenet/a2_fast.cpp` (same commit). `fixtures/snaptone-a1std.clo` and `fixtures/snaptone-a2.clo` are clones Valeton Suite 2.1.0 made from those two models.

The empty GP-50 preset built by `blankGp50Prst` (`lib/prst.mjs`) reproduces the MIT fixture `gp50-blank.prst` above. The simulator's native GP-50 bank (`lib/mock-bank.mjs`) is made of the caller's MIT presets and presets generated from the catalog; it contains no Valeton factory preset.

The GP-50 protocol implementation covers globals, patch settings, EXP records, footswitch masks, chain order, delete/copy/move, export, modified-state reads, device replies, SnapTone naming and catalog bindings. Protocol tests use facts and byte vectors; no vendor code is included.

Facts only, no code copied: flameshikari/valeton-suite-en (GPL-3.0), kabir0st/gp200-studio (GPL-3.0), majabojarska/Valeton-GP180-Rev-Eng (GPL-3.0), lshug/valeton-gp200-english-patch (GPL-3.0), lucascantarelli/gp100-nextgen-editor, lucascantarelli/gp-100-patch-architect, jmiskovic/webgp-200, leocosta1/pocket-cortex, drewmerc302/nam-a2a1-converter.

Valeton, GP-5 and Valeton Suite are trademarks of their owner. This project is not affiliated with Valeton.
